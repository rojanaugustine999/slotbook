import { z } from "zod";

export const recordPayoutSchema = z.object({
  amountCents: z.number().int().positive().max(100_000_000), // up to ₹10 lakh at once
  reference: z.string().trim().min(1).max(100).optional(), // e.g. the bank transfer's UTR number
});

export type RecordPayoutInput = z.infer<typeof recordPayoutSchema>;

// Shown to the salon's owner on their dashboard, so it must say why.
export const suspendSalonSchema = z.object({
  reason: z.string().trim().min(5, "say why, in a few words").max(300),
});
