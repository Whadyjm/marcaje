import { describe, expect, it } from "vitest";
import { periodCsv } from "../supabase/functions/api/domain/csv.ts";
import { dayStatus } from "../supabase/functions/api/domain/day.ts";
import { fortnightOf, previousFortnight, previousWeek, weekOf } from "../supabase/functions/api/domain/periods.ts";
import { alertWindow, buildPeriodReport, type ReportShift } from "../supabase/functions/api/domain/report.ts";

const ccs = (date: string, time: string) => `${date}T${time}:00-04:00`;
let seq = 0;
const shift = (employeeId: string, inDate: string, inTime: string, outDate: string | null, outTime?: string): ReportShift => ({
  id: `s${++seq}`,
  employeeId,
  clockIn: ccs(inDate, inTime),
  clockOut: outDate ? ccs(outDate, outTime!) : null,
});

const ana = { id: "ana", name: "Ana Pérez", cedula: "12345678", active: true };
const luis = { id: "luis", name: "Luis Gómez", cedula: "20111222", active: true };

describe("buildPeriodReport", () => {
  it("suma los dos ejemplos del enunciado en la semana 2026-10-05 → 2026-10-11", () => {
    const report = buildPeriodReport({
      from: "2026-10-05",
      to: "2026-10-11",
      employees: [ana],
      shifts: [shift("ana", "2026-10-05", "06:00", "2026-10-05", "16:00"), shift("ana", "2026-10-06", "14:00", "2026-10-07", "00:30")],
    });
    expect(report.rows[0].hours).toEqual({ total: 20.5, ordinary: 16, overtimeDay: 2, overtimeNight: 2.5, nightShift: 3 });
    expect(report.alerts).toHaveLength(0);
  });

  it("redondea al final del período, no turno por turno", () => {
    // 3 turnos con 20 min nocturnos ordinarios c/u: 3 × 0,33 = 0,99 si se redondeara por turno; lo correcto es 1,00
    const report = buildPeriodReport({
      from: "2026-10-05",
      to: "2026-10-11",
      employees: [ana],
      shifts: [
        shift("ana", "2026-10-05", "11:20", "2026-10-05", "19:20"),
        shift("ana", "2026-10-06", "11:20", "2026-10-06", "19:20"),
        shift("ana", "2026-10-07", "11:20", "2026-10-07", "19:20"),
      ],
    });
    expect(report.rows[0].minutes.nightOrdinaryMin).toBe(60);
    expect(report.rows[0].hours.nightShift).toBe(1);
  });

  it("un turno pertenece al día en que empieza, aunque termine en el período siguiente", () => {
    const shifts = [shift("ana", "2026-10-11", "22:00", "2026-10-12", "06:00")];
    const week1 = buildPeriodReport({ from: "2026-10-05", to: "2026-10-11", employees: [ana], shifts });
    const week2 = buildPeriodReport({ from: "2026-10-12", to: "2026-10-18", employees: [ana], shifts });
    expect(week1.rows[0].minutes.totalMin).toBe(480);
    expect(week2.rows[0].minutes.totalMin).toBe(0);
  });

  it("alerta cuando se superan 10 h extra en una semana (y no con exactamente 10)", () => {
    // 5 turnos de 10 h = 10 h extra exactas → sin alerta
    const exact = ["05", "06", "07", "08", "09"].map((d) => shift("ana", `2026-10-${d}`, "06:00", `2026-10-${d}`, "16:00"));
    // Luis: lo mismo + 1 minuto
    const over = [
      ...["05", "06", "07", "08"].map((d) => shift("luis", `2026-10-${d}`, "06:00", `2026-10-${d}`, "16:00")),
      shift("luis", "2026-10-09", "06:00", "2026-10-09", "16:01"),
    ];
    const report = buildPeriodReport({ from: "2026-10-05", to: "2026-10-11", employees: [ana, luis], shifts: [...exact, ...over] });
    const byId = Object.fromEntries(report.rows.map((r) => [r.employeeId, r]));
    expect(byId.ana.alert).toBe(false);
    expect(byId.luis.alert).toBe(true);
    expect(report.alerts).toEqual([{ employeeId: "luis", name: "Luis Gómez", weekStart: "2026-10-05", weekEnd: "2026-10-11", overtimeHours: 10.02 }]);
  });

  it("en una quincena la alerta mira la semana completa, aunque parte quede fuera del período", () => {
    // Quincena 2026-10-01 → 10-15. La semana 10-12 → 10-18 queda cortada.
    // 6 h extra el 14 (dentro) + 6 h extra el 16 (fuera) = 12 h en la semana → alerta.
    const shifts = [shift("ana", "2026-10-14", "06:00", "2026-10-14", "20:00"), shift("ana", "2026-10-16", "06:00", "2026-10-16", "20:00")];
    const report = buildPeriodReport({ from: "2026-10-01", to: "2026-10-15", employees: [ana], shifts });
    expect(report.rows[0].hours.overtimeDay + report.rows[0].hours.overtimeNight).toBe(6);
    expect(report.rows[0].alert).toBe(true);
    expect(alertWindow("2026-10-01", "2026-10-15")).toEqual({ from: "2026-09-28", to: "2026-10-18" });
  });

  it("los turnos abiertos no suman y se reportan como pendientes", () => {
    const report = buildPeriodReport({
      from: "2026-10-05",
      to: "2026-10-11",
      employees: [ana],
      shifts: [shift("ana", "2026-10-05", "08:00", null)],
    });
    expect(report.rows[0].minutes.totalMin).toBe(0);
    expect(report.rows[0].openShiftIds).toHaveLength(1);
    expect(report.openShifts).toBe(1);
  });

  it("un turno en revisión no se suma ni dispara alertas hasta que RRHH lo resuelva", () => {
    const dudoso = { ...shift("ana", "2026-10-05", "06:00", "2026-10-05", "20:00"), needsReview: true };
    const report = buildPeriodReport({ from: "2026-10-05", to: "2026-10-11", employees: [ana], shifts: [dudoso, shift("ana", "2026-10-06", "08:00", "2026-10-06", "16:00")] });
    expect(report.rows[0].minutes.totalMin).toBe(480);
    expect(report.rows[0].reviewShiftIds).toEqual([dudoso.id]);
    expect(report.reviewShifts).toBe(1);
    expect(report.rows[0].weeks[0].overtimeMin).toBe(0);
  });

  it("incluye una fila por colaborador activo aunque no tenga horas, y omite inactivos sin turnos", () => {
    const report = buildPeriodReport({
      from: "2026-10-05",
      to: "2026-10-11",
      employees: [ana, luis, { id: "x", name: "Ex Empleado", cedula: "1000000", active: false }],
      shifts: [],
    });
    expect(report.rows.map((r) => r.employeeId)).toEqual(["ana", "luis"]);
  });
});

describe("periodCsv", () => {
  it("genera exactamente el formato del enunciado", () => {
    const report = buildPeriodReport({
      from: "2026-10-05",
      to: "2026-10-11",
      employees: [ana],
      shifts: [shift("ana", "2026-10-05", "06:00", "2026-10-05", "16:00"), shift("ana", "2026-10-06", "14:00", "2026-10-07", "00:30")],
    });
    expect(periodCsv(report)).toBe(
      "cedula;nombre;periodo_desde;periodo_hasta;overtimeDayHours;overtimeNightHours;nightShiftHours\r\n" +
        "12345678;Ana Pérez;2026-10-05;2026-10-11;2.00;2.50;3.00\r\n",
    );
  });

  it("escapa nombres con separador o comillas", () => {
    const report = buildPeriodReport({
      from: "2026-10-05",
      to: "2026-10-11",
      employees: [{ id: "z", name: 'José "Pepe"; Díaz', cedula: "9999999", active: true }],
      shifts: [],
    });
    expect(periodCsv(report).split("\r\n")[1]).toBe('9999999;"José ""Pepe""; Díaz";2026-10-05;2026-10-11;0.00;0.00;0.00');
  });
});

describe("períodos", () => {
  it("semana lunes a domingo", () => {
    expect(weekOf("2026-10-08")).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    expect(weekOf("2026-10-11")).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    expect(previousWeek("2026-10-05")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
  });

  it("quincenas 1–15 y 16–fin de mes (incluye febrero)", () => {
    expect(fortnightOf("2026-10-15")).toEqual({ from: "2026-10-01", to: "2026-10-15" });
    expect(fortnightOf("2026-10-16")).toEqual({ from: "2026-10-16", to: "2026-10-31" });
    expect(fortnightOf("2026-02-20")).toEqual({ from: "2026-02-16", to: "2026-02-28" });
    expect(previousFortnight("2026-11-05")).toEqual({ from: "2026-10-16", to: "2026-10-31" });
  });
});

describe("dayStatus", () => {
  const today = "2026-10-05";
  const at = (t: string) => new Date(ccs(today, t));

  it("dentro / salió / sin marcar", () => {
    const open = { id: "1", clockIn: ccs(today, "08:00"), clockOut: null };
    expect(dayStatus({ date: today, today, now: at("10:00"), shiftsOfDay: [open], openShift: open })).toBe("dentro");
    const closed = { ...open, clockOut: ccs(today, "16:00") };
    expect(dayStatus({ date: today, today, now: at("17:00"), shiftsOfDay: [closed], openShift: null })).toBe("salio");
    expect(dayStatus({ date: today, today, now: at("17:00"), shiftsOfDay: [], openShift: null })).toBe("sin_marcar");
  });

  it("entrada abierta de ayer de más de 14 h = sin salida; un turno nocturno en curso no", () => {
    const forgot = { id: "1", clockIn: ccs("2026-10-04", "08:00"), clockOut: null };
    expect(dayStatus({ date: today, today, now: at("09:00"), shiftsOfDay: [], openShift: forgot })).toBe("sin_salida");
    const night = { id: "2", clockIn: ccs("2026-10-04", "22:00"), clockOut: null };
    expect(dayStatus({ date: today, today, now: at("02:00"), shiftsOfDay: [], openShift: night })).toBe("dentro");
  });

  it("en un día pasado, un turno que quedó abierto es sin salida", () => {
    const open = { id: "1", clockIn: ccs("2026-10-04", "08:00"), clockOut: null };
    expect(dayStatus({ date: "2026-10-04", today, now: at("09:00"), shiftsOfDay: [open], openShift: open })).toBe("sin_salida");
  });
});
