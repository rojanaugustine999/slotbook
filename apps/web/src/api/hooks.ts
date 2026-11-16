import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthProvider";
import { api } from "./client";
import type { Availability, Booking, Calendar, CreateBookingInput, OwnedBusiness, OwnerBooking, OwnerService, OwnerStatusChange, PublicBusiness, ServiceInput, StaffMember, Stats } from "./types";

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

// ─── Owner hooks ─────────────────────────────────────────────────────────────

/** The businesses the signed-in person owns. Empty for a plain customer. */
export function useMyBusinesses() {
  const { status } = useAuth();
  return useQuery({
    queryKey: ["my-businesses"],
    enabled: status === "signedIn",
    staleTime: 60_000,
    queryFn: async () => (await api<{ businesses: OwnedBusiness[] }>("/businesses/mine")).businesses,
  });
}

export interface CreateBusinessInput {
  name: string;
  slug: string;
  timezone: string;
  address?: string;
}

/** Creates a salon owned by the signed-in person. */
export function useCreateBusiness() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateBusinessInput) => (await api<{ business: OwnedBusiness }>("/businesses", { method: "POST", body: input })).business,
    onSuccess: (business) => {
      // Put the new salon in the cache straight away, so the dashboard can open it
      // without waiting for /businesses/mine to load again. Then refresh to be sure.
      queryClient.setQueryData<OwnedBusiness[]>(["my-businesses"], (old) => [business, ...(old ?? [])]);
      void queryClient.invalidateQueries({ queryKey: ["my-businesses"] });
    },
  });
}

// ─── Services (owner) ────────────────────────────────────────────────────────
// After any change, three caches are out of date: this list, the staff list (it shows
// service names), and the public booking page. Invalidating marks them stale, so they
// load again the next time something shows them.
// ──────────────────────────────────────────────────────────────────────────────
function useRefreshAfterServiceChange(businessId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["services", businessId] });
    void queryClient.invalidateQueries({ queryKey: ["staff", businessId] });
    void queryClient.invalidateQueries({ queryKey: ["business"] });
  };
}

export function useServices(businessId: string) {
  return useQuery({
    queryKey: ["services", businessId],
    queryFn: async () => (await api<{ services: OwnerService[] }>(`/businesses/${businessId}/services`)).services,
  });
}

/** Adds a service, or changes one when an id is given. */
export function useSaveService(businessId: string) {
  const refresh = useRefreshAfterServiceChange(businessId);
  return useMutation({
    mutationFn: async ({ id, input }: { id?: string; input: ServiceInput }) =>
      id
        ? (await api<{ service: OwnerService }>(`/businesses/${businessId}/services/${id}`, { method: "PATCH", body: input })).service
        : (await api<{ service: OwnerService }>(`/businesses/${businessId}/services`, { method: "POST", body: input })).service,
    onSuccess: refresh,
  });
}

/** Hides a service from customers, or shows it again. */
export function useSetServiceActive(businessId: string) {
  const refresh = useRefreshAfterServiceChange(businessId);
  return useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) =>
      active
        ? api(`/businesses/${businessId}/services/${id}`, { method: "PATCH", body: { active: true } })
        : api(`/businesses/${businessId}/services/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });
}

export function useStaff(businessId: string) {
  return useQuery({
    queryKey: ["staff", businessId],
    staleTime: 60_000,
    queryFn: async () => (await api<{ staff: StaffMember[] }>(`/businesses/${businessId}/staff`)).staff,
  });
}

/** Bookings grouped by day for a date range (at most 31 days). Re-checks every minute, because customers keep booking. */
export function useCalendar(businessId: string, from: string, to: string) {
  return useQuery({
    queryKey: ["calendar", businessId, from, to],
    refetchInterval: 60_000,
    placeholderData: keepPreviousData, // while the next week loads, keep showing this one instead of flashing empty
    queryFn: async () => (await api<{ calendar: Calendar }>(`/businesses/${businessId}/calendar?from=${from}&to=${to}`)).calendar,
  });
}

export function useChangeBookingStatus(businessId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ bookingId, status }: { bookingId: string; status: OwnerStatusChange }) =>
      (await api<{ booking: OwnerBooking }>(`/businesses/${businessId}/bookings/${bookingId}/status`, { method: "PATCH", body: { status } })).booking,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["calendar", businessId] });
      void queryClient.invalidateQueries({ queryKey: ["stats", businessId] }); // completing a booking changes revenue
    },
  });
}

/** Numbers and chart data for a date range (at most 92 days). Pass enabled: false while the range is invalid. */
export function useStats(businessId: string, from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ["stats", businessId, from, to],
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData, // while a new range loads, keep the old numbers on screen
    queryFn: async () => (await api<{ stats: Stats }>(`/businesses/${businessId}/stats?from=${from}&to=${to}`)).stats,
  });
}
