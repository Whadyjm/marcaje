/**
 * Bitácora de decisiones de RRHH: une las solicitudes ya decididas en una sola lista.
 * Lo que el propio colaborador canceló no es una decisión de RRHH y no aparece.
 */

interface PersonRef {
  name: string;
  cedula: string;
}

export interface ShiftChangeDecisionRow {
  id: string;
  work_date: string;
  from_start: string | null;
  from_end: string | null;
  to_start: string | null;
  to_end: string | null;
  reason: string;
  status: string;
  decision_note: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  created_at: string;
  employees?: PersonRef | null;
}

export interface PinDecisionRow {
  id: string;
  created_at: string;
  resolved_at: string | null;
  resolution: string | null;
  resolution_note: string | null;
  resolved_by_name: string | null;
  employees?: PersonRef | null;
}

export type DecisionOutcome = "approved" | "rejected" | "unknown";

export interface Decision {
  id: string;
  kind: "shift_change" | "pin";
  employee: PersonRef | null;
  outcome: DecisionOutcome;
  /** Motivo de RRHH. Null en decisiones anteriores a que fuera obligatorio. */
  reason: string | null;
  decidedAt: string;
  decidedBy: string | null;
  requestedAt: string;
  /** Lo que pidió el colaborador. Solo en cambios de turno. */
  request: { workDate: string; from: { start: string; end: string } | null; to: { start: string; end: string } | null; reason: string } | null;
}

const slot = (start: string | null, end: string | null) => (start && end ? { start, end } : null);

export function buildDecisionLog(changes: ShiftChangeDecisionRow[], pins: PinDecisionRow[]): Decision[] {
  const out: Decision[] = [];
  for (const c of changes) {
    if (!c.decided_at || (c.status !== "approved" && c.status !== "rejected")) continue;
    out.push({
      id: `sc-${c.id}`,
      kind: "shift_change",
      employee: c.employees ?? null,
      outcome: c.status,
      reason: c.decision_note,
      decidedAt: c.decided_at,
      decidedBy: c.decided_by_name,
      requestedAt: c.created_at,
      request: { workDate: c.work_date, from: slot(c.from_start, c.from_end), to: slot(c.to_start, c.to_end), reason: c.reason },
    });
  }
  for (const p of pins) {
    if (!p.resolved_at) continue;
    out.push({
      id: `pin-${p.id}`,
      kind: "pin",
      employee: p.employees ?? null,
      // Las atendidas antes de esta bitácora no guardaron qué se hizo: no se inventa.
      outcome: p.resolution === "pin_generated" ? "approved" : p.resolution === "dismissed" ? "rejected" : "unknown",
      reason: p.resolution === "pin_generated" ? "Se generó un PIN nuevo" : p.resolution_note,
      decidedAt: p.resolved_at,
      decidedBy: p.resolved_by_name,
      requestedAt: p.created_at,
      request: null,
    });
  }
  return out.sort((a, b) => Date.parse(b.decidedAt) - Date.parse(a.decidedAt));
}
