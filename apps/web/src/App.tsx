import { Route, Routes } from "react-router";
import { BookingPage } from "./booking/BookingPage";
import { CalendarPage } from "./dashboard/CalendarPage";
import { DashboardHome, DashboardLayout } from "./dashboard/DashboardLayout";
import { ServicesPage } from "./dashboard/ServicesPage";
import { StatsPage } from "./dashboard/StatsPage";
import { Layout } from "./Layout";
import { Home, NotFound } from "./pages/Home";
import { MyBookings } from "./pages/MyBookings";

// Fixed addresses (/me, /dashboard) are listed before the "/:slug" catch-all, so they win.
export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="me" element={<MyBookings />} />
        <Route path="dashboard" element={<DashboardHome />} />
        <Route path="dashboard/:businessId" element={<DashboardLayout />}>
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="stats" element={<StatsPage />} />
          <Route path="services" element={<ServicesPage />} />
        </Route>
        <Route path=":slug" element={<BookingPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
