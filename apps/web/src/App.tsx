import { Route, Routes } from "react-router";
import { BookingPage } from "./booking/BookingPage";
import { CalendarPage } from "./dashboard/CalendarPage";
import { DashboardHome, DashboardLayout, DashboardNew } from "./dashboard/DashboardLayout";
import { ServicesPage } from "./dashboard/ServicesPage";
import { StaffMemberPage } from "./dashboard/StaffMemberPage";
import { StaffPage } from "./dashboard/StaffPage";
import { PaymentsPage } from "./dashboard/PaymentsPage";
import { StatsPage } from "./dashboard/StatsPage";
import { Layout } from "./Layout";
import { Home, NotFound } from "./pages/Home";
import { AdminPage } from "./pages/AdminPage";
import { MyBookings } from "./pages/MyBookings";

// Fixed addresses (/me, /dashboard) are listed before the "/:slug" catch-all, so they win.
export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="me" element={<MyBookings />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="dashboard" element={<DashboardHome />} />
        <Route path="dashboard/new" element={<DashboardNew />} />
        <Route path="dashboard/:businessId" element={<DashboardLayout />}>
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="stats" element={<StatsPage />} />
          <Route path="services" element={<ServicesPage />} />
          <Route path="staff" element={<StaffPage />} />
          <Route path="staff/:staffId" element={<StaffMemberPage />} />
          <Route path="payments" element={<PaymentsPage />} />
        </Route>
        <Route path=":slug" element={<BookingPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
