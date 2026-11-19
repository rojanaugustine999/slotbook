import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthProvider";
import { payDeposit } from "../lib/razorpay";
import { api } from "./client";
import type { AdminSalon, AuditEntry, Availability, Booking, Calendar, CreateBookingInput, DepositCheckout, OwnedBusiness, OwnerBooking, OwnerService, OpenRefund, OwnerPayments, OwnerStatusChange, PublicBusiness, PublicBusinessCard, RazorpayResult, SalonBalance, ServiceInput, StaffMember, Stats, TimeOff, User } from "./types";
import type { HoursBlock } from "../dashboard/hours";

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

/** The salons ready to take bookings, for the home page. */
export function usePublicBusinesses(search = "") {
  const q = search.trim();
  return useQuery({
    // Under ["business"], so the owner's changes to services or staff (which invalidate
    // ["business"]) refresh this list too. An object can never clash with a salon's slug.
    // Each search is cached on its own, so going back to an earlier search is instant.
    queryKey: ["business", { list: true, q }],
    queryFn: async () => (await api<{ businesses: PublicBusinessCard[] }>(q ? `/b?q=${encodeURIComponent(q)}` : "/b", { auth: false })).businesses,
    placeholderData: keepPreviousData, // keep showing the last results while the next ones load
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
    // payment is null when no deposit is due; otherwise the booking is only held until it's paid.
    mutationFn: async (input: CreateBookingInput) =>
      api<{ booking: Booking; payment: DepositCheckout | null }>(`/b/${encodeURIComponent(slug)}/bookings`, { method: "POST", body: input }),
    // Whatever happened, the open slots have probably changed.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["availability", slug] });
      void queryClient.invalidateQueries({ queryKey: ["my-bookings"] });
    },
  });
}

/**
 * Pays a held booking's deposit, start to finish:
 *   1. the order: passed in right after booking, or fetched again (e.g. from "My bookings");
 *   2. Razorpay's window, where the customer pays;
 *   3. our API, which checks Razorpay's signature and only then confirms the booking.
 * Rejects with CheckoutClosed when the customer just closes the window.
 */
export function usePayDeposit() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ booking, checkout }: { booking: Booking; checkout?: DepositCheckout }) => {
      const order = checkout ?? (await api<{ payment: DepositCheckout }>(`/me/bookings/${booking.id}/payment`)).payment;
      const result: RazorpayResult = await payDeposit(order, { description: `${booking.service.name} deposit`, name: user?.name, email: user?.email });
      const confirmed = (await api<{ booking: Pick<Booking, "id" | "status"> }>(`/me/bookings/${booking.id}/pay`, { method: "POST", body: result })).booking;
      return { status: confirmed.status, order };
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["my-bookings"] });
      void queryClient.invalidateQueries({ queryKey: ["availability"] });
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

/**
 * Saves some of a salon's settings (only the fields given). The answer is the whole salon,
 * which replaces it in the owner's list, so the dashboard header shows the new name at once.
 */
export function useUpdateBusiness(businessId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<Pick<OwnedBusiness, "name" | "address" | "slug" | "timezone" | "minNoticeMinutes" | "maxAdvanceDays">>) =>
      (await api<{ business: OwnedBusiness }>(`/businesses/${businessId}`, { method: "PATCH", body: input })).business,
    onSuccess: (business) => {
      queryClient.setQueryData<OwnedBusiness[]>(["my-businesses"], (old) => old?.map((b) => (b.id === business.id ? business : b)));
      void queryClient.invalidateQueries({ queryKey: ["my-businesses"] });
      void queryClient.invalidateQueries({ queryKey: ["business"] }); // the public page and the home list
      void queryClient.invalidateQueries({ queryKey: ["availability"] }); // notice and advance limits change the open times
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

// ─── Staff (owner) ───────────────────────────────────────────────────────────
// Changing who works, what they offer, their hours or their time off all change which
// times customers can book. So after each one we also mark the public booking page and
// every availability answer as stale.
// ──────────────────────────────────────────────────────────────────────────────
function useRefreshAfterStaffChange(businessId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["staff", businessId] });
    void queryClient.invalidateQueries({ queryKey: ["business"] });
    void queryClient.invalidateQueries({ queryKey: ["availability"] });
  };
}

const staffUrl = (businessId: string, staffId: string) => `/businesses/${businessId}/staff/${staffId}`;

export function useAddStaff(businessId: string) {
  const refresh = useRefreshAfterStaffChange(businessId);
  return useMutation({
    mutationFn: async (name: string) => (await api<{ staff: StaffMember }>(`/businesses/${businessId}/staff`, { method: "POST", body: { name } })).staff,
    onSuccess: refresh,
  });
}

/** Rename someone, or hide / show them (active: false is a DELETE in the API). */
export function useUpdateStaff(businessId: string) {
  const refresh = useRefreshAfterStaffChange(businessId);
  return useMutation({
    mutationFn: async ({ id, name, active }: { id: string; name?: string; active?: boolean }) =>
      active === false
        ? api(staffUrl(businessId, id), { method: "DELETE" })
        : api(staffUrl(businessId, id), { method: "PATCH", body: { name, active } }),
    onSuccess: refresh,
  });
}

export function useSetStaffServices(businessId: string, staffId: string) {
  const refresh = useRefreshAfterStaffChange(businessId);
  return useMutation({
    mutationFn: async (serviceIds: string[]) => (await api<{ staff: StaffMember }>(`${staffUrl(businessId, staffId)}/services`, { method: "PUT", body: { serviceIds } })).staff,
    onSuccess: refresh,
  });
}

export function useWorkingHours(businessId: string, staffId: string) {
  return useQuery({
    queryKey: ["hours", staffId],
    queryFn: async () => (await api<{ hours: HoursBlock[] }>(`${staffUrl(businessId, staffId)}/working-hours`)).hours,
  });
}

export function useSetWorkingHours(businessId: string, staffId: string) {
  const queryClient = useQueryClient();
  const refresh = useRefreshAfterStaffChange(businessId);
  return useMutation({
    mutationFn: async (hours: HoursBlock[]) => (await api<{ hours: HoursBlock[] }>(`${staffUrl(businessId, staffId)}/working-hours`, { method: "PUT", body: { hours } })).hours,
    onSuccess: (hours) => {
      queryClient.setQueryData(["hours", staffId], hours); // the API answers with the saved week
      refresh();
    },
  });
}

export function useTimeOff(businessId: string, staffId: string) {
  return useQuery({
    queryKey: ["time-off", staffId],
    queryFn: async () => (await api<{ timeOff: TimeOff[] }>(`${staffUrl(businessId, staffId)}/time-off`)).timeOff,
  });
}

export function useAddTimeOff(businessId: string, staffId: string) {
  const queryClient = useQueryClient();
  const refresh = useRefreshAfterStaffChange(businessId);
  return useMutation({
    mutationFn: async (input: { startsAt: string; endsAt: string; reason?: string }) =>
      (await api<{ timeOff: TimeOff }>(`${staffUrl(businessId, staffId)}/time-off`, { method: "POST", body: input })).timeOff,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["time-off", staffId] });
      refresh();
    },
  });
}

export function useDeleteTimeOff(businessId: string, staffId: string) {
  const queryClient = useQueryClient();
  const refresh = useRefreshAfterStaffChange(businessId);
  return useMutation({
    mutationFn: async (timeOffId: string) => api(`${staffUrl(businessId, staffId)}/time-off/${timeOffId}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["time-off", staffId] });
      refresh();
    },
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

// ─── Super admin hooks (/admin) ──────────────────────────────────────────────

export function useAdminBalances() {
  const { status } = useAuth();
  return useQuery({ queryKey: ["admin", "balances"], enabled: status === "signedIn", queryFn: async () => (await api<{ balances: SalonBalance[] }>("/admin/balances")).balances });
}

export function useOpenRefunds() {
  return useQuery({ queryKey: ["admin", "refunds"], queryFn: async () => (await api<{ refunds: OpenRefund[] }>("/admin/refunds")).refunds });
}

export function useAuditLog() {
  return useQuery({ queryKey: ["admin", "audit"], queryFn: async () => (await api<{ entries: AuditEntry[] }>("/admin/audit")).entries });
}

// Every admin change can move balances, refunds and the audit log, so all three refresh.
function useAdminMutation<TInput>(mutationFn: (input: TInput) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn, onSettled: () => void queryClient.invalidateQueries({ queryKey: ["admin"] }) });
}

export function useAdminSalons() {
  return useQuery({ queryKey: ["admin", "salons"], queryFn: async () => (await api<{ businesses: AdminSalon[] }>("/admin/businesses")).businesses });
}

export function useSuspendSalon() {
  return useAdminMutation(({ businessId, reason }: { businessId: string; reason: string }) =>
    api(`/admin/businesses/${businessId}/suspend`, { method: "POST", body: { reason } }),
  );
}

export function useRestoreSalon() {
  return useAdminMutation((businessId: string) => api(`/admin/businesses/${businessId}/restore`, { method: "POST" }));
}

export function useRecordPayout() {
  return useAdminMutation(({ businessId, amountCents, reference }: { businessId: string; amountCents: number; reference?: string }) =>
    api(`/admin/businesses/${businessId}/payouts`, { method: "POST", body: { amountCents, reference } }),
  );
}

export function useRetryRefund() {
  return useAdminMutation((refundId: string) => api(`/admin/refunds/${refundId}/retry`, { method: "POST" }));
}

// ─── Owner: Payments tab ─────────────────────────────────────────────────────

export function useOwnerPayments(businessId: string) {
  return useQuery({
    queryKey: ["owner-payments", businessId],
    queryFn: async () => api<OwnerPayments>(`/businesses/${businessId}/payments`),
  });
}

export function useSaveDepositSettings(businessId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { depositPercent: number | null; freeCancelHours: number }) => api(`/businesses/${businessId}`, { method: "PATCH", body: input }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["owner-payments", businessId] });
      void queryClient.invalidateQueries({ queryKey: ["business"] }); // the public booking page shows the deposit
    },
  });
}

// ─── Your own account (/account) ─────────────────────────────────────────────

export function useUpdateMe() {
  const { updateUser } = useAuth();
  return useMutation({
    mutationFn: async (input: { name?: string; phone?: string | null }) => (await api<{ user: User }>("/auth/me", { method: "PATCH", body: input })).user,
    onSuccess: (user) => updateUser(user), // the header and My bookings show the new details at once
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: async (input: { currentPassword: string; newPassword: string }) =>
      api<{ signedOutOtherDevices: number }>("/auth/password", { method: "POST", body: input }),
  });
}

export function useSignOutOtherDevices() {
  return useMutation({
    mutationFn: async () => api<{ signedOutOtherDevices: number }>("/auth/sessions/revoke-others", { method: "POST" }),
  });
}

/**
 * Deletes (anonymises) the signed-in account. The caller then signs out locally:
 * the API has already ended every session and cleared the sign-in cookie.
 */
export function useDeleteAccount() {
  return useMutation({
    mutationFn: async (password: string) => api<{ cancelledBookings: number }>("/auth/me/delete", { method: "POST", body: { password } }),
  });
}
