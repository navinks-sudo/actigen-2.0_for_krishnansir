import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Windows + folders like Downloads/OneDrive often miss FS events; polling makes HMR reliable.
    watch: {
      usePolling: true,
      interval: 400,
    },
    proxy: {
      "/api": "http://localhost:8003",
      "/files": "http://localhost:8003",
    },
  },
  // `vite preview` does not inherit `server` — mirror proxy so sign-in and uploads work locally.
  preview: {
    port: 4173,
    proxy: {
      "/api": "http://localhost:8003",
      "/files": "http://localhost:8003",
    },
  },
});
