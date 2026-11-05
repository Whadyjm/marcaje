/** Ayudas puras de los formularios de RRHH: atajos, motivos predeterminados y alta masiva. */
import { isValidCedula, normalizeCedula } from "@domain/identity.ts";
import { addDays } from "@domain/time.ts";

export type ShiftMode = "new" | "complete" | "correct";

/** Motivos frecuentes según lo que RRHH está haciendo. */
export const REASONS: Record<ShiftMode, string[]> = {
  new: ["Olvidó marcar entrada y salida", "Teléfono sin batería o sin datos", "Falla de la aplicación", "Trabajó fuera de la sede", "Confirmado por el supervisor"],
  complete: ["Olvidó marcar la salida", "Teléfono sin batería o sin datos", "Salió por una emergencia", "Falla de la aplicación", "Confirmado por el supervisor"],
  correct: ["Marcó la entrada tarde", "Marcó la salida después de irse", "Marcó por error", "Hora registrada incorrecta", "Confirmado por el supervisor"],
};

/** Turnos habituales: un toque llena entrada y salida. */
export const SHIFT_TEMPLATES = [
  { label: "Mañana", in: "06:00", out: "14:00" },
  { label: "Oficina", in: "08:00", out: "17:00" },
  { label: "Tarde", in: "14:00", out: "22:00" },
  { label: "Noche", in: "22:00", out: "06:00" },
];

/** Suma minutos a "HH:mm", dando la vuelta a medianoche. */
export function addToTime(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Un turno dura como máximo 24 h, así que la fecha de salida se deduce de las
 * horas: si la salida no es posterior a la entrada, terminó al día siguiente.
 * RRHH no tiene que llenar (ni equivocarse en) un segundo campo de fecha.
 */
export function outDateFor(inDate: string, inTime: string, outTime: string): string {
  return outTime > inTime ? inDate : addDays(inDate, 1);
}

/** Agrega el motivo al texto, o lo quita si ya estaba. Conserva lo que RRHH haya escrito. */
export function toggleReason(text: string, preset: string): string {
  const parts = text
    .split(/\.\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  const next = parts.includes(preset) ? parts.filter((p) => p !== preset) : [...parts, preset];
  return next.join(". ");
}

export function hasReason(text: string, preset: string): boolean {
  return text.split(/\.\s*/).some((p) => p.trim() === preset);
}

export interface ParsedLine {
  line: string;
  name?: string;
  cedula?: string;
  error?: string;
}

/**
 * Interpreta una lista pegada desde Excel o WhatsApp: una persona por línea, con
 * nombre y cédula separados por tabulador, punto y coma o coma, en cualquier orden.
 */
export function parseEmployeeList(text: string): ParsedLine[] {
  const seen = new Set<string>();
  const out: ParsedLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/c[eé]dula|nombre/i.test(line) && !/\d/.test(line)) continue; // encabezado
    const parts = line
      .split(/[\t;,]/)
      .map((p) => p.trim())
      .filter(Boolean);
    const cedulaPart = parts.find((p) => /^[VEve]?[-.\s]*[\d.\s]+$/.test(p));
    const name = parts.find((p) => p !== cedulaPart);
    const cedula = cedulaPart ? normalizeCedula(cedulaPart) : "";
    if (!cedulaPart || !isValidCedula(cedula)) out.push({ line, error: "Cédula inválida o faltante" });
    else if (!name || name.length < 2) out.push({ line, error: "Falta el nombre" });
    else if (seen.has(cedula)) out.push({ line, error: "Cédula repetida en la lista" });
    else {
      seen.add(cedula);
      out.push({ line, name, cedula });
    }
  }
  return out;
}
