import { env } from "./env.js";
import { logger } from "./logger.js";

export interface Email {
  to: string;
  subject: string;
  text: string;
}

// Emails "sent" while no RESEND_API_KEY is set. Tests read this to check what
// would have gone out. It keeps only the latest 100 so it can't grow forever.
export const outbox: Email[] = [];

export async function sendEmail(email: Email): Promise<void> {
  if (!env.RESEND_API_KEY) {
    outbox.push(email);
    if (outbox.length > 100) outbox.shift();
    if (env.NODE_ENV === "development") logger.info({ to: email.to, subject: email.subject }, "email printed, not sent (no RESEND_API_KEY)");
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [email.to], subject: email.subject, text: email.text }),
  });

  // Throwing makes the job fail, and the queue retries it later.
  if (!res.ok) throw new Error(`Email provider answered ${res.status}`);
}
