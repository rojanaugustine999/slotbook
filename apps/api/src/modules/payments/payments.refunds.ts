import { prisma } from "../../lib/db.js";
import { logger } from "../../lib/logger.js";
import { razorpay, type RazorpayRefund } from "../../lib/razorpay.js";
import { getQueue } from "../notifications/notifications.queue.js";
import { runSafely } from "../notifications/notifications.service.js";
import { commissionFor, depositOutcome, type DepositEvent } from "./payments.rules.js";

// ─── Settling a paid deposit: refund it, or the salon keeps it ───────────────
// A refund touches two systems that can each fail on their own: our database and Razorpay.
// So it happens in two steps:
//
//   1. DECIDE, in one database transaction (settleDeposit): the payment moves paid → refunded
//      with a guarded update (so a payment can only ever be refunded once), a Refund row is
//      created as "pending", and the ledger gets its refund row. Nothing has left yet.
//   2. SEND, from the queue, with retries (processRefund): ask Razorpay to refund, then
//      mark our Refund row processed. Razorpay being down only delays this step.
//
// The danger in step 2 is refunding TWICE: the first try may reach Razorpay and then fail
// before we save its answer. So every Razorpay refund carries our refund id in its notes,
// and each try first asks Razorpay whether a refund with that note already exists.
// ──────────────────────────────────────────────────────────────────────────────

export const REFUND_JOB = "refund";

/**
 * Called whenever something final happens to a booking with a paid deposit (cancelled,
 * completed, no-show, or paid after its hold ran out). Safe to call more than once.
 * Returns what was decided, or null when there's no paid deposit to settle.
 */
export async function settleDeposit(bookingId: string, event: DepositEvent): Promise<"refund" | "keep" | null> {
  const payment = await prisma.payment.findFirst({
    where: { bookingId, status: "paid" },
    select: { id: true, businessId: true, amountCents: true },
  });
  if (!payment) return null; // no deposit, never paid, or already refunded

  const outcome = depositOutcome(event);
  if (outcome === "keep") {
    // The salon keeps the deposit, so SlotBook's commission is now due. The unique
    // (paymentId, type) key means a second call adds nothing (skipDuplicates).
    await prisma.ledgerEntry.createMany({
      data: [{ businessId: payment.businessId, type: "commission", amountCents: -commissionFor(payment.amountCents), paymentId: payment.id, note: `SlotBook commission (${event.kind.replace("_", " ")})` }],
      skipDuplicates: true,
    });
    return "keep";
  }

  const refund = await prisma.$transaction(async (tx) => {
    // Only one caller can move paid → refunded; any other finds nothing to do.
    const { count } = await tx.payment.updateMany({ where: { id: payment.id, status: "paid" }, data: { status: "refunded" } });
    if (count === 0) return null;
    const created = await tx.refund.create({ data: { paymentId: payment.id, amountCents: payment.amountCents, reason: event.kind }, select: { id: true } });
    // Money out: the salon is no longer owed this deposit.
    await tx.ledgerEntry.create({
      data: { businessId: payment.businessId, type: "refund", amountCents: -payment.amountCents, paymentId: payment.id, refundId: created.id, note: `Deposit refunded (${event.kind.replace("_", " ")})` },
    });
    return created;
  });
  if (!refund) return null;

  // If Redis is down the refund stays "pending" in our database, where it can be retried later.
  await runSafely("queue refund", () => queueRefund(refund.id));
  return "refund";
}

export async function queueRefund(refundId: string): Promise<void> {
  await getQueue().add(
    REFUND_JOB,
    { refundId },
    // A few tries, waiting longer each time (2 s, 4 s, 8 s ...) in case Razorpay is having a bad minute.
    { jobId: `refund-${refundId}`, attempts: 6, backoff: { type: "exponential", delay: 2000 }, removeOnComplete: true, removeOnFail: 500 },
  );
}

/** The queue job: sends one refund to Razorpay. Throwing makes the queue try again later. */
export async function processRefund(refundId: string): Promise<void> {
  const refund = await prisma.refund.findUniqueOrThrow({
    where: { id: refundId },
    select: { id: true, status: true, providerRefundId: true, amountCents: true, payment: { select: { providerPaymentId: true } } },
  });
  if (refund.status !== "pending" || refund.providerRefundId) return; // done, or Razorpay already has it (its webhook finishes it)

  const paymentId = refund.payment.providerPaymentId;
  if (!paymentId) throw new Error(`Refund ${refundId}: the payment has no Razorpay payment id`);

  // Already sent by an earlier try that failed before saving the answer? Then don't send again.
  // (A refund Razorpay refused doesn't count: an admin retry must send a fresh one.)
  const existing = (await razorpay.listRefunds(paymentId)).find((r) => noteOf(r) === refund.id && r.status !== "failed");
  const sent = existing ?? (await razorpay.refundPayment(paymentId, { amountCents: refund.amountCents, notes: { refundId: refund.id } }));

  await saveRazorpayAnswer(refund.id, sent);
}

/** Copies Razorpay's view of a refund onto ours. Used by the job and by the refund webhooks. */
export async function saveRazorpayAnswer(refundId: string, sent: Pick<RazorpayRefund, "id" | "status">): Promise<void> {
  const status = sent.status === "processed" ? "processed" : sent.status === "failed" ? "failed" : "pending";
  // Never move a refund backwards (a late "pending" mustn't undo "processed").
  await prisma.refund.updateMany({
    where: { id: refundId, status: "pending" },
    data: { providerRefundId: sent.id, status, processedAt: status === "processed" ? new Date() : null },
  });
  if (status === "failed") logger.error({ refundId, providerRefundId: sent.id }, "Razorpay refused a refund: needs a person to look at it");
}

// Razorpay returns notes as an object, or as an empty array when there are none.
function noteOf(refund: RazorpayRefund): string | undefined {
  return Array.isArray(refund.notes) ? undefined : refund.notes?.refundId;
}
