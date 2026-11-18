import { z } from "zod";

// What Razorpay Checkout hands the browser after a successful payment.
// These are only CLAIMS until the server checks the signature (payments.service.ts).
export const confirmPaymentSchema = z.object({
  razorpayOrderId: z.string().min(1).max(100),
  razorpayPaymentId: z.string().min(1).max(100),
  razorpaySignature: z.string().min(1).max(200),
});

export type ConfirmPaymentInput = z.infer<typeof confirmPaymentSchema>;
