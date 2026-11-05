/**
 * Reporte de un período (semana, quincena o rango libre).
 *
 * - Un turno entra al período si su fecha de inicio (hora de Caracas) está en
 *   [from, to]. Un turno del domingo 22:00 al lunes 06:00 es del domingo.
 * - Los turnos abiertos (sin salida) no se suman: se reportan como pendientes
 *   para que RRHH los corrija antes de exportar.
 * - La alerta de horas extra se evalúa por semana calendario (lunes a domingo)
 *   completa, aunque el período sea una quincena que corta una semana. Por eso
 *   quien llama debe pasar los turnos de las semanas completas que tocan el
 *   período (ver `alertWindow`).
 */
import { breakdownShift, minutesToHours } from "./hours.ts";
import { addDays, localDateOf, weekStart } from "./time.ts";

export const WEEKLY_OVERTIME_ALERT_MIN = 10 * 60; // alerta si se SUPERA este valor

export interface ReportEmployee {
  id: string;
  name: string;
  cedula: string;
  active: boolean;
}

export interface ReportShift {
  id: string;
  employeeId: string;
  clockIn: string;
  clockOut: string | null;
  /** Diferido con hora dudosa o muy atrasado: no se suma hasta que RRHH lo resuelva. */
  needsReview?: boolean;
}

export interface Totals {
  totalMin: number;
  ordinaryMin: number;
  nightOrdinaryMin: number;
  overtimeDayMin: number;
  overtimeNightMin: number;
}

export interface WeeklyOvertime {
  weekStart: string;
  weekEnd: string;
  overtimeMin: number;
  overtimeHours: number;
  alert: boolean;
}

export interface PeriodRow {
  employeeId: string;
  name: string;
  cedula: string;
  active: boolean;
  shiftCount: number;
  openShiftIds: string[];
  reviewShiftIds: string[];
  minutes: Totals;
  hours: {
    total: number;
    ordinary: number;
    overtimeDay: number;
    overtimeNight: number;
    nightShift: number;
  };
  weeks: WeeklyOvertime[];
  alert: boolean;
}

export interface PeriodReport {
  from: string;
  to: string;
  rows: PeriodRow[];
  alerts: { employeeId: string; name: string; weekStart: string; weekEnd: string; overtimeHours: number }[];
  openShifts: number;
  reviewShifts: number;
}

/** Rango de fechas cuyos turnos hacen falta para evaluar las alertas semanales. */
export function alertWindow(from: string, to: string): { from: string; to: string } {
  return { from: weekStart(from), to: addDays(weekStart(to), 6) };
}

const emptyTotals = (): Totals => ({
  totalMin: 0,
  ordinaryMin: 0,
  nightOrdinaryMin: 0,
  overtimeDayMin: 0,
  overtimeNightMin: 0,
});

export function buildPeriodReport(input: {
  from: string;
  to: string;
  employees: ReportEmployee[];
  shifts: ReportShift[];
}): PeriodReport {
  const { from, to } = input;
  const byEmployee = new Map<string, ReportShift[]>();
  for (const s of input.shifts) {
    const list = byEmployee.get(s.employeeId) ?? [];
    list.push(s);
    byEmployee.set(s.employeeId, list);
  }

  const rows: PeriodRow[] = [];
  for (const emp of input.employees) {
    const shifts = byEmployee.get(emp.id) ?? [];
    const totals = emptyTotals();
    const weekly = new Map<string, number>();
    const openShiftIds: string[] = [];
    const reviewShiftIds: string[] = [];
    let shiftCount = 0;

    for (const s of shifts) {
      const day = localDateOf(s.clockIn);
      const inPeriod = day >= from && day <= to;
      if (s.needsReview) {
        if (inPeriod) reviewShiftIds.push(s.id);
        continue;
      }
      if (!s.clockOut) {
        if (inPeriod) openShiftIds.push(s.id);
        continue;
      }
      const b = breakdownShift(s.clockIn, s.clockOut);
      const wk = weekStart(day);
      weekly.set(wk, (weekly.get(wk) ?? 0) + b.overtimeDayMin + b.overtimeNightMin);
      if (!inPeriod) continue;
      shiftCount++;
      totals.totalMin += b.totalMin;
      totals.ordinaryMin += b.ordinaryMin;
      totals.nightOrdinaryMin += b.nightOrdinaryMin;
      totals.overtimeDayMin += b.overtimeDayMin;
      totals.overtimeNightMin += b.overtimeNightMin;
    }

    // Solo nos importan las semanas que tocan el período.
    const weeks: WeeklyOvertime[] = [...weekly.entries()]
      .filter(([wk]) => addDays(wk, 6) >= from && wk <= to)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([wk, min]) => ({
        weekStart: wk,
        weekEnd: addDays(wk, 6),
        overtimeMin: min,
        overtimeHours: minutesToHours(min),
        alert: min > WEEKLY_OVERTIME_ALERT_MIN,
      }));

    // Colaboradores inactivos solo aparecen si trabajaron en el período.
    if (!emp.active && shiftCount === 0 && openShiftIds.length === 0 && reviewShiftIds.length === 0) continue;

    rows.push({
      employeeId: emp.id,
      name: emp.name,
      cedula: emp.cedula,
      active: emp.active,
      shiftCount,
      openShiftIds,
      reviewShiftIds,
      minutes: totals,
      hours: {
        total: minutesToHours(totals.totalMin),
        ordinary: minutesToHours(totals.ordinaryMin),
        overtimeDay: minutesToHours(totals.overtimeDayMin),
        overtimeNight: minutesToHours(totals.overtimeNightMin),
        nightShift: minutesToHours(totals.nightOrdinaryMin),
      },
      weeks,
      alert: weeks.some((w) => w.alert),
    });
  }

  rows.sort((a, b) => a.name.localeCompare(b.name, "es"));

  return {
    from,
    to,
    rows,
    alerts: rows.flatMap((r) =>
      r.weeks
        .filter((w) => w.alert)
        .map((w) => ({
          employeeId: r.employeeId,
          name: r.name,
          weekStart: w.weekStart,
          weekEnd: w.weekEnd,
          overtimeHours: w.overtimeHours,
        })),
    ),
    openShifts: rows.reduce((n, r) => n + r.openShiftIds.length, 0),
    reviewShifts: rows.reduce((n, r) => n + r.reviewShiftIds.length, 0),
  };
}
