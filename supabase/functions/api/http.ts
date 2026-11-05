import type { PostgrestError } from "@supabase/supabase-js";
import type { z } from "zod";

export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 422 | 500,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

/** Traduce errores de Postgres a respuestas HTTP con mensajes para el usuario. */
export function dbError(error: PostgrestError | null, context = "base de datos"): HttpError {
  if (!error) return new HttpError(500, `Error de ${context}`);
  const msg = `${error.message ?? ""} ${error.details ?? ""}`;
  switch (error.code) {
    case "23505":
      if (msg.includes("shifts_one_open_per_employee")) {
        return new HttpError(409, "El colaborador ya tiene una entrada abierta.", "open_shift_exists");
      }
      if (msg.includes("employees_company_id_cedula_key")) {
        return new HttpError(409, "Ya existe un colaborador con esa cédula en la empresa.", "duplicate_cedula");
      }
      return new HttpError(409, "El registro ya existe.", "duplicate");
    case "23P01":
      return new HttpError(409, "El turno se solapa con otro turno del mismo colaborador.", "overlap");
    case "23514":
      if (msg.includes("shifts_max_24h")) return new HttpError(422, "Un turno no puede durar más de 24 horas.", "too_long");
      if (msg.includes("shifts_out_after_in")) return new HttpError(422, "La salida debe ser posterior a la entrada.", "out_before_in");
      return new HttpError(422, "Datos inválidos.", "check_violation");
    case "P0002":
      return new HttpError(404, "Turno no encontrado.", "not_found");
    default:
      console.error(`[db] ${context}:`, error);
      return new HttpError(500, `Error de ${context}.`);
  }
}

export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first.path.length ? `${first.path.join(".")}: ` : "";
    throw new HttpError(422, `${where}${first.message}`, "validation");
  }
  return result.data;
}
