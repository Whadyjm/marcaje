/**
 * Reglas de cálculo de horas de un turno.
 *
 * - Un turno es una entrada y su salida; pertenece al día en que empieza.
 * - Los primeros 480 minutos (8 h) son ordinarios; lo que pase de ahí es extra.
 * - Un minuto es nocturno si cae en [19:00, 05:00) hora de Caracas.
 * - Las horas extra son las últimas del turno y se clasifican en diurnas o
 *   nocturnas según el minuto en que ocurrieron.
 * - Nocturna ordinaria = minutos nocturnos dentro de los primeros 480.
 *
 * Todo se calcula en minutos enteros. El redondeo a horas con 2 decimales se
 * hace una sola vez al final del período (ver report.ts), nunca por turno.
 */
import { DAY_MIN, toLocalMinute } from "./time.ts";

export const ORDINARY_LIMIT_MIN = 8 * 60;
export const NIGHT_START_MIN = 19 * 60; // 19:00
export const NIGHT_END_MIN = 5 * 60; // 05:00 del día siguiente

export interface ShiftBreakdown {
  totalMin: number;
  ordinaryMin: number;
  nightOrdinaryMin: number;
  overtimeDayMin: number;
  overtimeNightMin: number;
}

/**
 * Minutos nocturnos en el intervalo semiabierto [a, b), con a y b en minutos
 * locales. La franja nocturna del día d es [d·1440 + 19:00, (d+1)·1440 + 05:00).
 * Las franjas de días consecutivos no se solapan, así que basta sumar.
 */
export function nightMinutesBetween(a: number, b: number): number {
  if (b <= a) return 0;
  let total = 0;
  const firstDay = Math.floor(a / DAY_MIN) - 1; // la franja de ayer llega hasta las 05:00 de hoy
  const lastDay = Math.floor(b / DAY_MIN);
  for (let d = firstDay; d <= lastDay; d++) {
    const nightStart = d * DAY_MIN + NIGHT_START_MIN;
    const nightEnd = (d + 1) * DAY_MIN + NIGHT_END_MIN;
    total += Math.max(0, Math.min(b, nightEnd) - Math.max(a, nightStart));
  }
  return total;
}

export function breakdownShift(clockIn: Date | string, clockOut: Date | string): ShiftBreakdown {
  const start = toLocalMinute(clockIn);
  const end = toLocalMinute(clockOut);
  if (end < start) throw new Error("La salida no puede ser anterior a la entrada");

  const ordinaryEnd = Math.min(end, start + ORDINARY_LIMIT_MIN);
  const nightOrdinaryMin = nightMinutesBetween(start, ordinaryEnd);
  const overtimeNightMin = nightMinutesBetween(ordinaryEnd, end);
  const overtimeMin = end - ordinaryEnd;

  return {
    totalMin: end - start,
    ordinaryMin: ordinaryEnd - start,
    nightOrdinaryMin,
    overtimeDayMin: overtimeMin - overtimeNightMin,
    overtimeNightMin,
  };
}

/**
 * Minutos → horas con 2 decimales (redondeo half-up).
 * `min * 100` es entero, por lo que la división y el redondeo son exactos
 * en los casos .5 y no arrastran errores de coma flotante.
 */
export function minutesToHours(min: number): number {
  return Math.round((min * 100) / 60) / 100;
}
