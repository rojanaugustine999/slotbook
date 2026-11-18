import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/db.js";
import { conflict, HttpError, notFound } from "../../lib/errors.js";
import { processRefund } from "../payments/payments.refunds.js";
import type { RecordPayoutInput } from "./admin.schema.js";

// ─── The SlotBook super admin ────────────────────────────────────────────────
// Only people with users.is_platform_admin = true (granted from the command line with
// `npm run admin:grant -- email`, never through the API) can use these.
//
// Two rules for everything in this file:
//   - Access is checked against the DATABASE on every request, not the login token, so
//     taking admin away works immediately instead of when the token expires.
//   - Every change writes an audit_log row in the SAME transaction as the change itself:
//     both are saved, or neither is. There is no such thing as an unlogged admin action.
// ──────────────────────────────────────────────────────────────────────────────

/** Throws 404 (not 403) for non-admins, so the admin area doesn't even admit it exists. */
export async function assertPlatformAdmin(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isPlatformAdmin: true } });
  if (!user?.isPlatformAdmin) throw notFound();
}

async function audit(
  tx: Prisma.TransactionClient,
  entry: { actorId: string; action: string; targetType: string; targetId: string; details?: Prisma.InputJsonValue },
): Promise<void> {
  await tx.auditLog.create({ data: entry });
}

// ─── Balances ───────────────────────────────────────────────────────────────

const zero = () => ({ deposit: 0, commission: 0, refund: 0, payout: 0 });

/**
 * What SlotBook owes each salon right now. The balance is just the sum of its ledger rows:
 * deposits (+), commission, refunds and payouts (all −). Nothing is stored that could drift.
 */
export async function listBalances() {
  const [sums, businesses] = await Promise.all([
    prisma.ledgerEntry.groupBy({ by: ["businessId", "type"], _sum: { amountCents: true } }),
    prisma.business.findMany({ where: { ledgerEntries: { some: {} } }, select: { id: true, name: true, slug: true }, orderBy: { name: "asc" } }),
  ]);

  return businesses.map((b) => {
    const totals = zero();
    for (const row of sums) if (row.businessId === b.id) totals[row.type] = row._sum.amountCents ?? 0;
    const balanceCents = totals.deposit + totals.commission + totals.refund + totals.payout;
    return { ...b, totals, balanceCents };
  });
}

async function balanceOf(db: Prisma.TransactionClient, businessId: string): Promise<number> {
  const { _sum } = await db.ledgerEntry.aggregate({ where: { businessId }, _sum: { amountCents: true } });
  return _sum.amountCents ?? 0;
}

// ─── Payouts ────────────────────────────────────────────────────────────────

/**
 * Records money SlotBook has sent to a salon (the transfer itself happens in the bank).
 * It can't be more than the salon is owed, even if two admins click at the same moment.
 */
export async function recordPayout(actorId: string, businessId: string, input: RecordPayoutInput) {
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true } });
  if (!business) throw notFound("Business not found");

  return prisma.$transaction(async (tx) => {
    // One payout per salon at a time. Without this lock, two requests could both read
    // "₹2,160 owed", both pass the check below, and pay out ₹4,320. The second request
    // waits here until the first commits, then reads the reduced balance.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"payout:" + businessId}::text, 0))`;

    const owed = await balanceOf(tx, businessId);
    if (input.amountCents > owed) throw conflict(`That's more than the salon is owed (${owed} paise)`, "PAYOUT_TOO_LARGE");

    const payout = await tx.payout.create({
      data: { businessId, amountCents: input.amountCents, reference: input.reference, recordedById: actorId },
      select: { id: true, amountCents: true, reference: true, createdAt: true },
    });
    await tx.ledgerEntry.create({ data: { businessId, type: "payout", amountCents: -input.amountCents, payoutId: payout.id, note: "Payout to salon" } });
    await audit(tx, { actorId, action: "payout.record", targetType: "business", targetId: businessId, details: { payoutId: payout.id, amountCents: input.amountCents, reference: input.reference ?? null } });
    return payout;
  });
}

// ─── Refunds that need attention ────────────────────────────────────────────

/** Refunds that haven't finished: still pending (Razorpay busy, Redis was down...) or failed. */
export async function listOpenRefunds() {
  return prisma.refund.findMany({
    where: { status: { in: ["pending", "failed"] } },
    orderBy: { createdAt: "asc" }, // oldest first: those are the most urgent
    select: {
      id: true,
      amountCents: true,
      status: true,
      reason: true,
      providerRefundId: true,
      createdAt: true,
      payment: { select: { business: { select: { name: true, slug: true } } } },
    },
  });
}

/**
 * Tries a refund again now, through the same processRefund the queue uses, so its
 * "never refund twice" check still applies. A failed refund is reopened first.
 */
export async function retryRefund(actorId: string, refundId: string) {
  const refund = await prisma.refund.findUnique({ where: { id: refundId }, select: { status: true } });
  if (!refund) throw notFound("Refund not found");
  if (refund.status === "processed") throw conflict("This refund has already been processed", "REFUND_DONE");

  await prisma.$transaction(async (tx) => {
    if (refund.status === "failed") {
      // Razorpay refused the last attempt: forget its id so a fresh refund is sent.
      await tx.refund.update({ where: { id: refundId }, data: { status: "pending", providerRefundId: null } });
    }
    await audit(tx, { actorId, action: "refund.retry", targetType: "refund", targetId: refundId, details: { previousStatus: refund.status } });
  });

  try {
    await processRefund(refundId);
  } catch (err) {
    // Still pending: the queue (or another click) can try again later.
    throw Object.assign(new HttpError(502, "RAZORPAY_ERROR", "Razorpay didn't accept the refund just now. It is still pending; try again later."), { cause: err });
  }
  return prisma.refund.findUniqueOrThrow({ where: { id: refundId }, select: { id: true, status: true, providerRefundId: true } });
}

// ─── Audit log ──────────────────────────────────────────────────────────────

export async function listAuditLog(limit = 50) {
  return prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, action: true, targetType: true, targetId: true, details: true, createdAt: true, actor: { select: { name: true, email: true } } },
  });
}
