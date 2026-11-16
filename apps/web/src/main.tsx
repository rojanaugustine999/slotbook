import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { ApiError } from "./api/client";
import { AuthDialogProvider } from "./auth/AuthDialog";
import { AuthProvider } from "./auth/AuthProvider";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Retrying a "not found" or "not allowed" answer never helps; retry only real trouble.
      retry: (failureCount, error) => !(error instanceof ApiError && error.status < 500) && failureCount < 2,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <AuthDialogProvider>
            <App />
          </AuthDialogProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
