/**
 * Utilidades de tiempo en hora de Caracas.
 *
 * Venezuela usa UTC−4 fijo desde mayo de 2016 (sin horario de verano), así que
 * trabajamos con un desfase constante en lugar de depender de la base de datos
 * de zonas horarias del runtime. Esto hace el cálculo determinista e idéntico
 * en Deno (producción), Node (local/tests) y el navegador.
 */

export const CARACAS_OFFSET_MIN = -240; // UTC−4
export const MINUTE_MS = 60_000;
export const DAY_MIN = 1440;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Convierte un instante a "minutos de pared" en Caracas contados desde
 * 1970-01-01 00:00 hora local. Los segundos se truncan: el cálculo suma
 * minutos completos.
 */
export function toLocalMinute(instant: Date | string | number): number {
  const ms = new Date(instant).getTime();
  if (Number.isNaN(ms)) throw new Error(`Instante inválido: ${String(instant)}`);
  return Math.floor(ms / MINUTE_MS) + CARACAS_OFFSET_MIN;
}

/** Fecha local (YYYY-MM-DD) en Caracas de un instante. */
export function localDateOf(instant: Date | string | number): string {
  const ms = new Date(instant).getTime() + CARACAS_OFFSET_MIN * MINUTE_MS;
  return new Date(ms).toISOString().slice(0, 10);
}

export function isValidDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

/** Instante UTC en que empieza el día local `date` (00:00 en Caracas). */
export function startOfLocalDay(date: string): Date {
  if (!isValidDate(date)) throw new Error(`Fecha inválida: ${date}`);
  return new Date(Date.parse(`${date}T00:00:00Z`) - CARACAS_OFFSET_MIN * MINUTE_MS);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Lunes de la semana (lunes a domingo) que contiene `date`. */
export function weekStart(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = domingo
  return addDays(date, -((dow + 6) % 7));
}

export function daysBetweenInclusive(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Fecha de hoy en Caracas. */
export function todayInCaracas(now: Date = new Date()): string {
  return localDateOf(now);
}
