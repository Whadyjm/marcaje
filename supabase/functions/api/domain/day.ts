/**
 * Estado del día de cada colaborador para la vista de RRHH.
 *
 * - dentro:     tiene una entrada abierta razonable (menos de STALE_OPEN_MIN).
 * - sin_salida: marcó entrada pero no salida. Se usa cuando la entrada abierta
 *               ya es "vieja" (probable olvido) o cuando se consulta un día
 *               pasado y el turno sigue abierto.
 * - salio:      marcó entrada y salida (todos sus turnos del día cerrados).
 * - sin_marcar: no tiene turnos ese día.
 *
 * El umbral evita marcar como olvido un turno nocturno legítimo que cruzó la
 * medianoche (p. ej. 22:00 → 06:00 consultado a las 02:00).
 */
import { localDateOf } from "./time.ts";

export const STALE_OPEN_MIN = 14 * 60;

export type DayStatus = "dentro" | "sin_salida" | "salio" | "sin_marcar";

export interface DayShift {
  id: string;
  clockIn: string;
  clockOut: string | null;
}

export function dayStatus(input: {
  date: string;
  today: string;
  now: Date;
  shiftsOfDay: DayShift[]; // turnos que empiezan en `date`
  openShift: DayShift | null; // turno abierto actual (de cualquier fecha)
}): DayStatus {
  const { date, today, now, shiftsOfDay, openShift } = input;

  if (date === today) {
    if (openShift) {
      const openMin = (now.getTime() - new Date(openShift.clockIn).getTime()) / 60_000;
      return openMin >= STALE_OPEN_MIN ? "sin_salida" : "dentro";
    }
    return shiftsOfDay.length > 0 ? "salio" : "sin_marcar";
  }

  // Día pasado: lo que quedó abierto es un marcaje incompleto.
  if (shiftsOfDay.some((s) => !s.clockOut)) return "sin_salida";
  if (openShift && localDateOf(openShift.clockIn) === date) return "sin_salida";
  return shiftsOfDay.length > 0 ? "salio" : "sin_marcar";
}
