import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// El cliente reutiliza el dominio del backend (zona horaria, períodos, identidad)
// para que exista una sola implementación de esas reglas.
export default defineConfig({
  plugins: [
    react(),
    // Guarda la app en el teléfono para abrirla sin conexión. La API no se guarda:
    // los datos del colaborador los maneja la cola (lib/usePunches.ts).
    VitePWA({
      registerType: "autoUpdate",
      manifest: false, // usamos public/manifest.webmanifest
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
        navigateFallback: "/index.html",
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "fuentes", expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { "@domain": fileURLToPath(new URL("../supabase/functions/api/domain", import.meta.url)) },
  },
  server: { port: 5173 },
});
