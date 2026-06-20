import path from "node:path";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

const readApiTarget = () => {
  const value = (process.env.VITE_API_BASE ?? process.env.VITE_API_URL)?.trim();
  const normalized = value?.toLowerCase();
  if (
    !value ||
    !normalized ||
    value.startsWith("/") ||
    normalized === "replace_me" ||
    normalized.startsWith("replace_me_")
  ) {
    return "http://127.0.0.1:8000";
  }
  return value;
};

const apiTarget = readApiTarget();

export default defineConfig({
  // Allow env files to live one level above the frontend directory
  envDir: path.resolve(__dirname, ".."),
  plugins: [react()],
  server: {
    port: 3000,
    host: "0.0.0.0",
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
      "/health": {
        target: apiTarget,
        changeOrigin: true,
      },
      "/scripts/create-session": {
        target: apiTarget,
        changeOrigin: true,
        rewrite: () => "/api/create-session",
      },
    },
  },
});
