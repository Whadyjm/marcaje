/**
 * Autenticación y autorización.
 *
 * Supabase Auth solo responde "¿quién eres?" (valida el JWT). El "¿qué puedes
 * hacer y sobre qué empresa?" se decide aquí, contra nuestras tablas:
 *   - company_admins → rol admin de esa empresa
 *   - employees      → rol colaborador (si está activo)
 * Cada consulta posterior filtra por actor.companyId: es el aislamiento entre
 * empresas (multi-tenant).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MiddlewareHandler } from "hono";
import { HttpError } from "./http.ts";

export interface Company {
  id: string;
  name: string;
  code: string;
}

export type Actor =
  | { role: "admin"; userId: string; name: string; email: string; company: Company }
  | { role: "employee"; userId: string; employeeId: string; name: string; cedula: string; company: Company };

export type AppEnv = { Variables: { actor: Actor } };

export async function resolveActor(db: SupabaseClient, authorization: string | undefined): Promise<Actor> {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new HttpError(401, "Falta el token de sesión.");

  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Sesión inválida o vencida.");
  const userId = data.user.id;

  const { data: admin, error: adminErr } = await db
    .from("company_admins")
    .select("name, email, companies (id, name, code)")
    .eq("user_id", userId)
    .maybeSingle();
  if (adminErr) throw new HttpError(500, "No se pudo validar la sesión.");
  if (admin) {
    return { role: "admin", userId, name: admin.name, email: admin.email, company: one(admin.companies) };
  }

  const { data: emp, error: empErr } = await db
    .from("employees")
    .select("id, name, cedula, active, companies (id, name, code)")
    .eq("user_id", userId)
    .maybeSingle();
  if (empErr) throw new HttpError(500, "No se pudo validar la sesión.");
  if (emp && emp.active) {
    return { role: "employee", userId, employeeId: emp.id, name: emp.name, cedula: emp.cedula, company: one(emp.companies) };
  }

  throw new HttpError(403, "Tu usuario no tiene acceso a ninguna empresa.");
}

/** PostgREST tipa los embebidos como objeto o arreglo según el esquema; normalizamos. */
function one<T>(v: T | T[] | null): T {
  const x = Array.isArray(v) ? v[0] : v;
  if (!x) throw new HttpError(500, "Empresa no encontrada.");
  return x;
}

export function authenticate(db: SupabaseClient): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set("actor", await resolveActor(db, c.req.header("Authorization")));
    await next();
  };
}

export function requireRole(role: Actor["role"]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.get("actor").role !== role) {
      throw new HttpError(403, role === "admin" ? "Solo RRHH puede hacer esto." : "Solo los colaboradores pueden marcar.");
    }
    await next();
  };
}

export function adminOf(actor: Actor): Extract<Actor, { role: "admin" }> {
  if (actor.role !== "admin") throw new HttpError(403, "Solo RRHH puede hacer esto.");
  return actor;
}

export function employeeOf(actor: Actor): Extract<Actor, { role: "employee" }> {
  if (actor.role !== "employee") throw new HttpError(403, "Solo los colaboradores pueden marcar.");
  return actor;
}
