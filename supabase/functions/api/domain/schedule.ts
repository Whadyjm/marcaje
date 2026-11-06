/**
 * Horario esperado: compara lo que se marcó con lo programado.
 *
 * Solo produce avisos. Las horas ordinarias, extra y nocturnas siguen saliendo
 * únicamente de la entrada y la salida reales (hours.ts).
 *
 * Un turno pertenece al día en que empieza: un horario de 22:00 a 06:00 del lunes se
 * evalúa el lunes y su salida es la del martes, igual que en las reglas de cálculo.
 */
import { DAY_MIN, startOfLocalDay, toLocalMinute } from "./time.ts";

export const DEFAULT_TOLERANCE_MIN = 10;
export const WEEKDAYS = ["1", "2", "3", "4", "5", "6", "7"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
const LABELS: Record<Weekday, string> = { "1": "Lun", "2": "Mar", "3": "Mié", "4": "Jue", "5": "Vie", "6": "Sáb", "7": "Dom" };

export interface DaySchedule {
  start: string; // HH:mm
  end: string;
}
export type WeekSchedule = Partial<Record<Weekday, DaySchedule>>;

export interface ScheduleVersion {
  effectiveFrom: string;
  week: WeekSchedule | null;
}

export type Attendance =
  | { kind: "unscheduled" }
  | { kind: "rest" }
  | { kind: "upcoming"; start: string; end: string }
  | { kind: "absent"; start: string; end: string }
  | { kind: "present"; start: string; end: string; lateMin: number; earlyLeaveMin: number };

export function weekdayOf(date: string): Weekday {
  return String(new Date(`${date}T12:00:00Z`).getUTCDay() || 7) as Weekday;
}

/** Horario vigente en una fecha: la versión más reciente que ya había empezado. */
export function scheduleOn(versions: ScheduleVersion[], date: string): WeekSchedule | null {
  let current: ScheduleVersion | null = null;
  for (const v of versions) {
    if (v.effectiveFrom <= date && (!current || v.effectiveFrom > current.effectiveFrom)) current = v;
  }
  return current?.week ?? null;
}

/** Un cambio de turno aprobado reemplaza solo esa fecha. `null` = día libre. */
export function applyOverride(week: WeekSchedule | null, date: string, override: DaySchedule | null | undefined): WeekSchedule | null {
  if (override === undefined) return week;
  const copy: WeekSchedule = { ...(week ?? {}) };
  const day = weekdayOf(date);
  if (override) copy[day] = override;
  else delete copy[day];
  return copy;
}

const toMinutes = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};

export function assessAttendance(input: {
  date: string;
  now: Date;
  week: WeekSchedule | null;
  toleranceMin: number;
  /** Turnos que empiezan en `date`. */
  shifts: { clockIn: string; clockOut: string | null }[];
  /** Tiene un turno abierto de antes: no se le acusa de ausente mientras tanto. */
  hasOpenShift: boolean;
}): Attendance {
  const { date, now, week, toleranceMin, shifts, hasOpenShift } = input;
  if (!week) return { kind: "unscheduled" };
  const day = week[weekdayOf(date)];
  if (!day) return { kind: "rest" };

  const dayStart = toLocalMinute(startOfLocalDay(date));
  const start = dayStart + toMinutes(day.start);
  const endOfDay = dayStart + toMinutes(day.end);
  const end = endOfDay <= start ? endOfDay + DAY_MIN : endOfDay; // cruza la medianoche
  const base = { start: day.start, end: day.end };

  if (shifts.length === 0) {
    if (hasOpenShift) return { kind: "present", ...base, lateMin: 0, earlyLeaveMin: 0 };
    return toLocalMinute(now) > start + toleranceMin ? { kind: "absent", ...base } : { kind: "upcoming", ...base };
  }

  const firstIn = Math.min(...shifts.map((s) => toLocalMinute(s.clockIn)));
  const late = firstIn - start;
  // Salida anticipada solo cuando ya terminó: quien sigue dentro todavía puede cumplir.
  const allClosed = shifts.every((s) => s.clockOut !== null);
  const early = allClosed ? end - Math.max(...shifts.map((s) => toLocalMinute(s.clockOut!))) : 0;

  return { kind: "present", ...base, lateMin: late > toleranceMin ? late : 0, earlyLeaveMin: early > toleranceMin ? early : 0 };
}

/** "Lun–Vie 08:00–17:00 · Sáb 08:00–12:00". Agrupa los días seguidos con el mismo horario. */
export function summarizeWeek(week: WeekSchedule | null): string {
  if (!week) return "Sin horario";
  const groups: { from: Weekday; to: Weekday; day: DaySchedule }[] = [];
  for (const d of WEEKDAYS) {
    const day = week[d];
    if (!day) continue;
    const last = groups[groups.length - 1];
    if (last && Number(last.to) === Number(d) - 1 && last.day.start === day.start && last.day.end === day.end) last.to = d;
    else groups.push({ from: d, to: d, day });
  }
  if (!groups.length) return "Sin horario";
  return groups.map((g) => `${g.from === g.to ? LABELS[g.from] : `${LABELS[g.from]}–${LABELS[g.to]}`} ${g.day.start}–${g.day.end}`).join(" · ");
}

export const weekdayLabel = (d: Weekday) => LABELS[d];
