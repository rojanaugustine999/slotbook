import type { NotificationType } from "@prisma/client";
import { DateTime } from "luxon";

export interface BookingEmailData {
  customerName: string;
  serviceName: string;
  staffName: string;
  businessName: string;
  businessAddress: string | null;
  startsAt: Date;
  timezone: string; // the SALON's timezone: "09:30" must mean 09:30 where the salon is
}

// "Saturday 5 December 2026 at 09:30", in the salon's timezone.
function when(data: BookingEmailData): string {
  return DateTime.fromJSDate(data.startsAt, { zone: data.timezone }).toFormat("cccc d LLLL yyyy 'at' HH:mm");
}

function clock(data: BookingEmailData): string {
  return DateTime.fromJSDate(data.startsAt, { zone: data.timezone }).toFormat("HH:mm");
}

// Builds the subject and plain-text body for each kind of notification.
// Pure function, so the wording can be tested without sending anything.
export function buildEmail(type: NotificationType, data: BookingEmailData): { subject: string; text: string } {
  const details = [
    `Service: ${data.serviceName}`,
    `With: ${data.staffName}`,
    `When: ${when(data)}`,
    `Where: ${data.businessName}${data.businessAddress ? `, ${data.businessAddress}` : ""}`,
  ].join("\n");

  switch (type) {
    case "confirmation":
      return {
        subject: `Booking confirmed: ${data.serviceName} at ${data.businessName}`,
        text: `Hi ${data.customerName},\n\nYour booking is confirmed.\n\n${details}\n\nSee you soon!`,
      };
    case "reminder_24h":
      return {
        subject: `Reminder: ${data.serviceName} at ${data.businessName} on ${when(data)}`,
        text: `Hi ${data.customerName},\n\nA reminder that your appointment is in 24 hours.\n\n${details}`,
      };
    case "reminder_1h":
      return {
        subject: `Starting soon: ${data.serviceName} at ${clock(data)}`,
        text: `Hi ${data.customerName},\n\nYour appointment starts in about an hour.\n\n${details}`,
      };
    case "cancellation":
      return {
        subject: `Booking cancelled: ${data.serviceName} at ${data.businessName}`,
        text: `Hi ${data.customerName},\n\nYour booking has been cancelled.\n\n${details}\n\nYou can book another time whenever you like.`,
      };
  }
}
