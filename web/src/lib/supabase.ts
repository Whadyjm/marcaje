import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configError = !url || !anonKey ? "Faltan VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY (ver web/.env.example)." : null;

/**
 * Supabase en el cliente se usa SOLO para autenticación (obtener y renovar el JWT).
 * Todos los datos pasan por nuestra API, que es donde vive la autorización.
 */
export const supabase = createClient(url ?? "http://localhost", anonKey ?? "missing", {
  auth: { persistSession: true, autoRefreshToken: true },
});

export const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) || `${url}/functions/v1`).replace(/\/$/, "");
