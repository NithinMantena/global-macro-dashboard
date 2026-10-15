import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === "production" ? process.env.VITE_BASE_PATH ?? "/global-macro-dashboard/" : "/",
  server: { port: 5174 },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
}));
