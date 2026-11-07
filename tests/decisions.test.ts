import { describe, expect, it } from "vitest";
import { buildDecisionLog, type PinDecisionRow, type ShiftChangeDecisionRow } from "../supabase/functions/api/domain/decisions.ts";

const change = (o: Partial<ShiftChangeDecisionRow>): ShiftChangeDecisionRow => ({
  id: "1",
  work_date: "2026-11-10",
  from_start: "08:00",
  from_end: "17:00",
  to_start: "14:00",
  to_end: "22:00",
  reason: "Cita médica",
  status: "approved",
  decision_note: "Hay cobertura",
  decided_by_name: "Rosa",
  decided_at: "2026-11-05T12:00:00Z",
  created_at: "2026-11-05T10:00:00Z",
  employees: { name: "Ana", cedula: "1" },
  ...o,
});
const pin = (o: Partial<PinDecisionRow>): PinDecisionRow => ({
  id: "9",
  created_at: "2026-11-05T09:00:00Z",
  resolved_at: "2026-11-05T13:00:00Z",
  resolution: "pin_generated",
  resolution_note: null,
  resolved_by_name: "Rosa",
  employees: { name: "Luis", cedula: "2" },
  ...o,
});

describe("buildDecisionLog", () => {
  it("muestra aprobadas y rechazadas con el motivo de RRHH y lo que se pidió", () => {
    const [d] = buildDecisionLog([change({ status: "rejected", decision_note: "No hay cobertura" })], []);
    expect(d).toMatchObject({ kind: "shift_change", outcome: "rejected", reason: "No hay cobertura", decidedBy: "Rosa" });
    expect(d.request).toEqual({ workDate: "2026-11-10", from: { start: "08:00", end: "17:00" }, to: { start: "14:00", end: "22:00" }, reason: "Cita médica" });
  });

  it("el día libre se ve como un turno vacío", () => {
    const [d] = buildDecisionLog([change({ to_start: null, to_end: null })], []);
    expect(d.request?.to).toBeNull();
  });

  it("ni lo pendiente ni lo que canceló el colaborador son decisiones de RRHH", () => {
    expect(buildDecisionLog([change({ status: "pending", decided_at: null }), change({ status: "cancelled", decided_at: null })], [pin({ resolved_at: null })])).toEqual([]);
  });

  it("PIN generado cuenta como aprobado; descartado, como rechazado con su motivo", () => {
    const [a] = buildDecisionLog([], [pin({})]);
    expect(a).toMatchObject({ kind: "pin", outcome: "approved", reason: "Se generó un PIN nuevo", request: null });
    const [b] = buildDecisionLog([], [pin({ resolution: "dismissed", resolution_note: "No la reconozco" })]);
    expect(b).toMatchObject({ outcome: "rejected", reason: "No la reconozco" });
  });

  it("lo atendido antes de existir la bitácora no inventa un resultado", () => {
    const [d] = buildDecisionLog([], [pin({ resolution: null })]);
    expect(d).toMatchObject({ outcome: "unknown", reason: null });
  });

  it("une ambos tipos con lo más reciente primero", () => {
    const log = buildDecisionLog([change({ id: "a", decided_at: "2026-11-05T12:00:00Z" }), change({ id: "b", decided_at: "2026-11-05T14:00:00Z" })], [pin({ resolved_at: "2026-11-05T13:00:00Z" })]);
    expect(log.map((d) => d.id)).toEqual(["sc-b", "pin-9", "sc-a"]);
  });
});
