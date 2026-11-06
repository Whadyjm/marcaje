import { describe, expect, it } from "vitest";
import { applyOverride, assessAttendance, scheduleOn, summarizeWeek, weekdayOf, type WeekSchedule } from "../supabase/functions/api/domain/schedule.ts";

const MON = "2026-10-05";
const TUE = "2026-10-06";
const ccs = (date: string, time: string) => `${date}T${time}:00-04:00`;
const office: WeekSchedule = { "1": { start: "08:00", end: "17:00" }, "2": { start: "08:00", end: "17:00" } };
const night: WeekSchedule = { "1": { start: "22:00", end: "06:00" } };

const assess = (o: { date?: string; at: string; week?: WeekSchedule | null; shifts?: { clockIn: string; clockOut: string | null }[]; open?: boolean; tolerance?: number }) =>
  assessAttendance({
    date: o.date ?? MON,
    now: new Date(o.at),
    week: o.week === undefined ? office : o.week,
    toleranceMin: o.tolerance ?? 10,
    shifts: o.shifts ?? [],
    hasOpenShift: o.open ?? false,
  });

describe("assessAttendance", () => {
  it("sin horario no opina", () => {
    expect(assess({ at: ccs(MON, "12:00"), week: null })).toEqual({ kind: "unscheduled" });
  });

  it("un día que no está en el horario es descanso, aunque haya trabajado", () => {
    expect(assess({ date: "2026-10-07", at: ccs("2026-10-07", "12:00") })).toEqual({ kind: "rest" });
    expect(assess({ date: "2026-10-07", at: ccs("2026-10-07", "12:00"), shifts: [{ clockIn: ccs("2026-10-07", "08:00"), clockOut: null }] })).toEqual({ kind: "rest" });
  });

  it("antes de su hora y dentro de la tolerancia está programado; después, ausente", () => {
    expect(assess({ at: ccs(MON, "07:00") }).kind).toBe("upcoming");
    expect(assess({ at: ccs(MON, "08:10") }).kind).toBe("upcoming");
    expect(assess({ at: ccs(MON, "08:11") }).kind).toBe("absent");
  });

  it("quien sigue con un turno abierto de antes no queda como ausente", () => {
    expect(assess({ at: ccs(MON, "12:00"), open: true }).kind).toBe("present");
  });

  it("retardo: solo si pasa la tolerancia, y reporta los minutos reales", () => {
    const at = (t: string) => assess({ at: ccs(MON, "12:00"), shifts: [{ clockIn: ccs(MON, t), clockOut: null }] });
    expect(at("07:50")).toMatchObject({ lateMin: 0 });
    expect(at("08:10")).toMatchObject({ lateMin: 0 });
    expect(at("08:25")).toMatchObject({ lateMin: 25 });
  });

  it("salida anticipada: solo con el turno cerrado y si pasa la tolerancia", () => {
    const out = (t: string | null) => assess({ at: ccs(MON, "18:00"), shifts: [{ clockIn: ccs(MON, "08:00"), clockOut: t && ccs(MON, t) }] });
    expect(out(null)).toMatchObject({ earlyLeaveMin: 0 });
    expect(out("16:55")).toMatchObject({ earlyLeaveMin: 0 });
    expect(out("16:20")).toMatchObject({ earlyLeaveMin: 40 });
    expect(out("18:00")).toMatchObject({ earlyLeaveMin: 0 });
  });

  it("varios turnos: mira la primera entrada y la última salida", () => {
    const r = assess({
      at: ccs(MON, "18:00"),
      shifts: [
        { clockIn: ccs(MON, "13:00"), clockOut: ccs(MON, "17:00") },
        { clockIn: ccs(MON, "08:00"), clockOut: ccs(MON, "12:00") },
      ],
    });
    expect(r).toMatchObject({ lateMin: 0, earlyLeaveMin: 0 });
  });

  it("horario nocturno: la salida es del día siguiente", () => {
    const r = assess({ week: night, at: ccs(TUE, "07:00"), shifts: [{ clockIn: ccs(MON, "22:00"), clockOut: ccs(TUE, "06:00") }] });
    expect(r).toMatchObject({ lateMin: 0, earlyLeaveMin: 0 });
    const early = assess({ week: night, at: ccs(TUE, "07:00"), shifts: [{ clockIn: ccs(MON, "22:30"), clockOut: ccs(TUE, "05:00") }] });
    expect(early).toMatchObject({ lateMin: 30, earlyLeaveMin: 60 });
    // El martes no tiene horario: su madrugada no lo convierte en ausente.
    expect(assess({ date: TUE, week: night, at: ccs(TUE, "02:00") })).toEqual({ kind: "rest" });
  });

  it("evalúa en hora de Caracas aunque el instante llegue en UTC", () => {
    expect(assess({ at: "2026-10-05T12:11:00Z" }).kind).toBe("absent"); // 08:11 en Caracas
    expect(assess({ at: ccs(MON, "12:00"), shifts: [{ clockIn: "2026-10-05T12:25:00Z", clockOut: null }] })).toMatchObject({ lateMin: 25 });
  });
});

describe("scheduleOn", () => {
  const v1 = { effectiveFrom: "2026-10-01", week: office };
  const v2 = { effectiveFrom: "2026-10-10", week: night };
  const off = { effectiveFrom: "2026-10-20", week: null };

  it("un cambio de horario no reescribe lo que ya pasó", () => {
    expect(scheduleOn([v2, v1], "2026-09-30")).toBeNull();
    expect(scheduleOn([v2, v1], "2026-10-05")).toEqual(office);
    expect(scheduleOn([v2, v1], "2026-10-10")).toEqual(night);
  });

  it("quitar el horario aplica desde esa fecha", () => {
    expect(scheduleOn([v1, v2, off], "2026-10-19")).toEqual(night);
    expect(scheduleOn([v1, v2, off], "2026-10-20")).toBeNull();
  });
});

describe("cambio de turno aprobado", () => {
  it("reemplaza solo esa fecha, sin tocar el horario semanal", () => {
    const week = applyOverride(office, MON, { start: "14:00", end: "22:00" });
    expect(assess({ week, at: ccs(MON, "10:00") })).toEqual({ kind: "upcoming", start: "14:00", end: "22:00" });
    expect(office["1"]).toEqual({ start: "08:00", end: "17:00" });
  });

  it("día libre: es descanso, no ausencia", () => {
    expect(assess({ week: applyOverride(office, MON, null), at: ccs(MON, "12:00") })).toEqual({ kind: "rest" });
  });

  it("sirve para quien no tiene horario, y sin cambio no altera nada", () => {
    expect(assess({ week: applyOverride(null, MON, { start: "08:00", end: "12:00" }), at: ccs(MON, "07:00") }).kind).toBe("upcoming");
    expect(applyOverride(office, MON, undefined)).toBe(office);
  });
});

describe("resumen del horario", () => {
  it("agrupa días seguidos iguales", () => {
    const week: WeekSchedule = {};
    for (const d of ["1", "2", "3", "4", "5"] as const) week[d] = { start: "08:00", end: "17:00" };
    week["6"] = { start: "08:00", end: "12:00" };
    expect(summarizeWeek(week)).toBe("Lun–Vie 08:00–17:00 · Sáb 08:00–12:00");
  });

  it("no agrupa días separados por un descanso", () => {
    const d = { start: "08:00", end: "12:00" };
    expect(summarizeWeek({ "1": d, "3": d })).toBe("Lun 08:00–12:00 · Mié 08:00–12:00");
  });

  it("sin días es sin horario", () => {
    expect(summarizeWeek(null)).toBe("Sin horario");
    expect(summarizeWeek({})).toBe("Sin horario");
  });

  it("lunes es 1 y domingo es 7", () => {
    expect(weekdayOf(MON)).toBe("1");
    expect(weekdayOf("2026-10-11")).toBe("7");
  });
});
