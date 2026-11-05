// Servidor local: corre la misma app de la Edge Function sobre Node.
// Uso: npm run dev:api  (lee .env de la raíz)
import { serve } from "@hono/node-server";
import ws from "ws";
import { createApp } from "../supabase/functions/api/app.ts";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name} (ver .env.example)`);
  return v;
}

const app = createApp({
  supabaseUrl: required("SUPABASE_URL"),
  serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  allowedOrigins: process.env.ALLOWED_ORIGINS,
  wsTransport: ws,
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`API de Marcaje en http://localhost:${port}/api`));
