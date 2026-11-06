// Punto de entrada de la Supabase Edge Function (Deno).
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase automáticamente.
import { createApp } from "./app.ts";

const app = createApp({
  supabaseUrl: Deno.env.get("SUPABASE_URL")!,
  serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  // Nunca "cualquier origen" en producción: si falta la variable, solo los dominios oficiales.
  allowedOrigins: Deno.env.get("ALLOWED_ORIGINS") || "https://marcaje.whady.dev,https://marcaje-a65.pages.dev",
});

Deno.serve(app.fetch);
