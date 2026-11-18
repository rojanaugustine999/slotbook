import { prisma } from "../../lib/db.js";
import { paymentsConfigured } from "../../lib/razorpay.js";
import { getOwnedBusiness } from "../businesses/businesses.service.js";
import { COMMISSION_PERCENT } from "./payments.rules.js";

// ─── The owner's Payments tab ────────────────────────────────────────────────
// A salon owner sees their deposit settings and their own money: every ledger row about
// their salon, and what SlotBook owes them now. Read-only: owners change the settings
// through the normal salon update (PATCH /businesses/:id), and only SlotBook records payouts.
// ──────────────────────────────────────────────────────────────────────────────

const RECENT_ENTRIES = 50;

export async function getOwnerPayments(businessId: string, userId: string) {
  await getOwnedBusiness(businessId, userId); // 404 unless this person owns the salon

  const [business, sums, entries] = await Promise.all([
    prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { depositPercent: true, freeCancelHours: true } }),
    prisma.ledgerEntry.groupBy({ by: ["type"], where: { businessId }, _sum: { amountCents: true } }),
    prisma.ledgerEntry.findMany({
      where: { businessId },
      orderBy: { createdAt: "desc" },
      take: RECENT_ENTRIES,
      select: {
        id: true,
        type: true,
        amountCents: true,
        createdAt: true,
        // What the row is about: the booking behind a deposit, commission or refund...
        payment: {
          select: {
            booking: { select: { id: true, startsAt: true, service: { select: { name: true } }, customer: { select: { name: true } } } },
          },
        },
        // ...or the bank reference of a payout.
        payout: { select: { reference: true } },
      },
    }),
  ]);

  const totals = { deposit: 0, commission: 0, refund: 0, payout: 0 };
  for (const row of sums) totals[row.type] = row._sum.amountCents ?? 0;

  return {
    settings: {
      ...business,
      // false when the server has no Razorpay keys: deposits can be set but won't be charged.
      paymentsAvailable: paymentsConfigured(),
      commissionPercent: COMMISSION_PERCENT,
    },
    totals,
    balanceCents: totals.deposit + totals.commission + totals.refund + totals.payout,
    entries: entries.map(({ payment, payout, ...entry }) => ({
      ...entry,
      booking: payment?.booking ?? null,
      payoutReference: payout?.reference ?? null,
    })),
  };
}
