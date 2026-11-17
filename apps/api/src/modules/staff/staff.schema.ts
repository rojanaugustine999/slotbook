import { z } from "zod";

export const createStaffSchema = z.object({
  // The staff member's display name, e.g. "Priya"
  name: z.string().trim().min(2).max(100),
});

// Rename someone, or bring a hidden staff member back ({ "active": true }).
// Hiding is DELETE, like services: staff with past bookings can't really be deleted.
export const updateStaffSchema = createStaffSchema.partial().extend({
  active: z.boolean().optional(),
});

export const setStaffServicesSchema = z.object({
  // The full list of services this person offers. An empty list means "none".
  serviceIds: z.array(z.string().uuid()).max(50),
});

export type CreateStaffInput = z.infer<typeof createStaffSchema>;
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;
export type SetStaffServicesInput = z.infer<typeof setStaffServicesSchema>;
