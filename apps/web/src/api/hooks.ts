import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthProvider";
import { api } from "./client";
import type { Availability, Booking, CreateBookingInput, PublicBusiness } from "./types";

// ─── Data hooks ──────────────────────────────────────────────────────────────
// TanStack Query keeps a cache of everything we load. That gives us, with no extra
// code: loading and error states, no duplicate requests when two components ask for
// the same thing, and instant back-navigation from the cache. A "query key" like
// ["business", "glow-salon"] is the cache's name for one piece of data.
// ──────────────────────────────────────────────────────────────────────────────

export function useBusiness(slug: string) {
  return useQuery({
    queryKey: ["business", slug],
    queryFn: async () => (await api<{ business: PublicBusiness }>(`/b/${encodeURIComponent(slug)}`, { auth: false })).business,
  });
}

export interface AvailabilityParams {
  serviceId: string;
  date: string;
  staffId?: string;
}

export function useAvailability(slug: string, { serviceId, date, staffId }: AvailabilityParams) {
  return useQuery({
    queryKey: ["availability", slug, serviceId, date, staffId ?? "any"],
    enabled: serviceId !== "" && date !== "",
    staleTime: 15_000, // open slots change as others book, so don't trust them for long
    queryFn: () => {
      const query = new URLSearchParams({ serviceId, date, ...(staffId ? { staffId } : {}) });
      return api<Availability>(`/b/${encodeURIComponent(slug)}/availability?${query}`, { auth: false });
    },
  });
}

export function useMyBookings() {
  const { status } = useAuth();
  return useQuery({
    queryKey: ["my-bookings"],
    enabled: status === "signedIn",
    queryFn: async () => (await api<{ bookings: Booking[] }>("/me/bookings")).bookings,
  });
}

export function useCreateBooking(slug: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateBookingInput) => (await api<{ booking: Booking }>(`/b/${encodeURIComponent(slug)}/bookings`, { method: "POST", body: input })).booking,
    // Whatever happened, the open slots have probably changed.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["availability", slug] });
      void queryClient.invalidateQueries({ queryKey: ["my-bookings"] });
    },
  });
}

export function useCancelBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (bookingId: string) => (await api<{ booking: Booking }>(`/me/bookings/${bookingId}/cancel`, { method: "POST" })).booking,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["my-bookings"] });
      void queryClient.invalidateQueries({ queryKey: ["availability"] });
    },
  });
}
