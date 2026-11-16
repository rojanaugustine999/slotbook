import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The API allows this exact address by default (CORS_ORIGIN in apps/api/.env.example).
  server: { port: 5173, strictPort: true },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
