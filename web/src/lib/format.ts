import { CARACAS_OFFSET_MIN, localDateOf } from "@domain/time.ts";

export { localDateOf };

/** "HH:mm" en hora de Caracas. */
export function localTimeOf(iso: string): string {
  return new Date(Date.parse(iso) + CARACAS_OFFSET_MIN * 60_000).toISOString().slice(11, 16);
}

/** Fecha + hora locales (Caracas) → instante ISO con offset explícito. */
export function toInstant(date: string, time: string): string {
  return `${date}T${time}:00-04:00`;
}

const dayFmt = new Intl.DateTimeFormat("es-VE", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
const longFmt = new Intl.DateTimeFormat("es-VE", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

/** "lun, 05 oct" a partir de YYYY-MM-DD. */
export function formatDay(date: string): string {
  return dayFmt.format(new Date(`${date}T12:00:00Z`));
}

export function formatLongDay(date: string): string {
  const s = longFmt.format(new Date(`${date}T12:00:00Z`));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "05 oct 14:00" (o solo la hora si es el mismo día de referencia). */
export function formatInstant(iso: string, sameDayAs?: string): string {
  const d = localDateOf(iso);
  return d === sameDayAs ? localTimeOf(iso) : `${formatDay(d)} ${localTimeOf(iso)}`;
}

/** Minutos → "8 h 30 min". */
export function formatHM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")} min`;
}

const hoursFmt = new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Horas con 2 decimales y coma decimal (UI). El CSV usa punto. */
export function formatHours(h: number): string {
  return hoursFmt.format(h);
}
