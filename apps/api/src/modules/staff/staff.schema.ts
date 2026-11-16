import { z } from "zod";

export const createStaffSchema = z.object({
  // The staff member's display name, e.g. "Priya"
  name: z.string().trim().min(2).max(100),
});

export const setStaffServicesSchema = z.object({
  // The full list of services this person offers. An empty list means "none".
  serviceIds: z.array(z.string().uuid()).max(50),
});

export type CreateStaffInput = z.infer<typeof createStaffSchema>;
export type SetStaffServicesInput = z.infer<typeof setStaffServicesSchema>;
