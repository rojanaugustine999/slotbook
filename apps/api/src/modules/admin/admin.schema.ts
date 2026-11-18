import { z } from "zod";

export const recordPayoutSchema = z.object({
  amountCents: z.number().int().positive().max(100_000_000), // up to ₹10 lakh at once
  reference: z.string().trim().min(1).max(100).optional(), // e.g. the bank transfer's UTR number
});

export type RecordPayoutInput = z.infer<typeof recordPayoutSchema>;
