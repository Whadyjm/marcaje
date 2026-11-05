/**
 * CSV de novedades para el motor de nómina de Kru.
 * Separador `;`, decimales con punto, una fila por colaborador, UTF-8 sin BOM
 * (el consumidor es un sistema, no Excel), saltos de línea CRLF (RFC 4180).
 */
import type { PeriodReport } from "./report.ts";

export const CSV_HEADER = [
  "cedula",
  "nombre",
  "periodo_desde",
  "periodo_hasta",
  "overtimeDayHours",
  "overtimeNightHours",
  "nightShiftHours",
] as const;

function field(value: string): string {
  return /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function periodCsv(report: PeriodReport): string {
  const lines = [CSV_HEADER.join(";")];
  for (const r of report.rows) {
    lines.push(
      [
        r.cedula,
        r.name,
        report.from,
        report.to,
        r.hours.overtimeDay.toFixed(2),
        r.hours.overtimeNight.toFixed(2),
        r.hours.nightShift.toFixed(2),
      ]
        .map(field)
        .join(";"),
    );
  }
  return lines.join("\r\n") + "\r\n";
}
