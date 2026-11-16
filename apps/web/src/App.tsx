import { Route, Routes } from "react-router";
import { BookingPage } from "./booking/BookingPage";
import { Layout } from "./Layout";
import { Home, NotFound } from "./pages/Home";
import { MyBookings } from "./pages/MyBookings";

// Fixed addresses (/me) are listed before the "/:slug" catch-all, so they win.
export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="me" element={<MyBookings />} />
        <Route path=":slug" element={<BookingPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
