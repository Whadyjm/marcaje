import { describe, expect, it } from "vitest";
import { breakdownShift, minutesToHours, nightMinutesBetween } from "../supabase/functions/api/domain/hours.ts";
import { toLocalMinute } from "../supabase/functions/api/domain/time.ts";

/** Hora local de Caracas → ISO con offset explícito, como lo envía el cliente. */
const ccs = (date: string, time: string) => `${date}T${time}:00-04:00`;

const hours = (clockIn: string, clockOut: string) => {
  const b = breakdownShift(clockIn, clockOut);
  return {
    total: minutesToHours(b.totalMin),
    overtimeDay: minutesToHours(b.overtimeDayMin),
    overtimeNight: minutesToHours(b.overtimeNightMin),
    nightOrdinary: minutesToHours(b.nightOrdinaryMin),
  };
};

describe("ejemplos del enunciado", () => {
  it("Lun 06:00 → 16:00: 10 h, 2 extra diurnas", () => {
    expect(hours(ccs("2026-10-05", "06:00"), ccs("2026-10-05", "16:00"))).toEqual({
      total: 10,
      overtimeDay: 2,
      overtimeNight: 0,
      nightOrdinary: 0,
    });
  });

  it("Mar 14:00 → Mié 00:30: 10,5 h, 2,5 extra nocturnas, 3 nocturnas ordinarias", () => {
    expect(hours(ccs("2026-10-06", "14:00"), ccs("2026-10-07", "00:30"))).toEqual({
      total: 10.5,
      overtimeDay: 0,
      overtimeNight: 2.5,
      nightOrdinary: 3,
    });
  });
});

describe("breakdownShift", () => {
  it("turno de exactamente 8 h no genera extra", () => {
    const b = breakdownShift(ccs("2026-10-05", "08:00"), ccs("2026-10-05", "16:00"));
    expect(b).toEqual({ totalMin: 480, ordinaryMin: 480, nightOrdinaryMin: 0, overtimeDayMin: 0, overtimeNightMin: 0 });
  });

  it("turno nocturno completo 22:00 → 07:00: la extra cae de día (06:00–07:00)", () => {
    const b = breakdownShift(ccs("2026-10-05", "22:00"), ccs("2026-10-06", "07:00"));
    expect(b.totalMin).toBe(540);
    expect(b.nightOrdinaryMin).toBe(7 * 60); // 22:00–05:00
    expect(b.overtimeDayMin).toBe(60);
    expect(b.overtimeNightMin).toBe(0);
  });

  it("la extra que cruza las 19:00 se divide entre diurna y nocturna", () => {
    // 10:00 → 20:30: ordinarias 10–18, extra 18:00–19:00 diurna y 19:00–20:30 nocturna
    const b = breakdownShift(ccs("2026-10-05", "10:00"), ccs("2026-10-05", "20:30"));
    expect(b.overtimeDayMin).toBe(60);
    expect(b.overtimeNightMin).toBe(90);
    expect(b.nightOrdinaryMin).toBe(0);
  });

  it("la madrugada antes de las 05:00 es nocturna y luego deja de serlo", () => {
    // 03:00 → 13:00: ordinarias 03–11 (2 h nocturnas), extra 11–13 diurna
    const b = breakdownShift(ccs("2026-10-05", "03:00"), ccs("2026-10-05", "13:00"));
    expect(b.nightOrdinaryMin).toBe(120);
    expect(b.overtimeDayMin).toBe(120);
    expect(b.overtimeNightMin).toBe(0);
  });

  it("extra nocturna que termina después de las 05:00 vuelve a ser diurna", () => {
    // 19:00 → 07:00 (12 h): ordinarias 19–03 (todas nocturnas), extra 03–05 nocturna + 05–07 diurna
    const b = breakdownShift(ccs("2026-10-05", "19:00"), ccs("2026-10-06", "07:00"));
    expect(b.nightOrdinaryMin).toBe(480);
    expect(b.overtimeNightMin).toBe(120);
    expect(b.overtimeDayMin).toBe(120);
  });

  it("los límites 19:00 y 05:00 son [19:00, 05:00): 18:00–19:00 y 05:00–06:00 son diurnas", () => {
    expect(nightMinutesBetween(toLocalMinute(ccs("2026-10-05", "18:00")), toLocalMinute(ccs("2026-10-05", "19:00")))).toBe(0);
    expect(nightMinutesBetween(toLocalMinute(ccs("2026-10-05", "05:00")), toLocalMinute(ccs("2026-10-05", "06:00")))).toBe(0);
    expect(nightMinutesBetween(toLocalMinute(ccs("2026-10-05", "04:59")), toLocalMinute(ccs("2026-10-05", "05:00")))).toBe(1);
  });

  it("interpreta en hora de Caracas instantes que llegan en UTC", () => {
    // 2026-10-05 23:00Z = 19:00 en Caracas → 1 h nocturna
    const b = breakdownShift("2026-10-05T23:00:00Z", "2026-10-06T00:00:00Z");
    expect(b.nightOrdinaryMin).toBe(60);
  });

  it("trunca los segundos: suma minutos completos", () => {
    const b = breakdownShift("2026-10-05T10:00:59-04:00", "2026-10-05T10:30:10-04:00");
    expect(b.totalMin).toBe(30);
  });

  it("turno de 24 h cubre una franja nocturna completa", () => {
    const b = breakdownShift(ccs("2026-10-05", "08:00"), ccs("2026-10-06", "08:00"));
    expect(b.totalMin).toBe(1440);
    expect(b.nightOrdinaryMin + b.overtimeNightMin).toBe(600); // 19:00–05:00
  });

  it("rechaza salida anterior a la entrada", () => {
    expect(() => breakdownShift(ccs("2026-10-05", "10:00"), ccs("2026-10-05", "09:00"))).toThrow();
  });
});

describe("minutesToHours", () => {
  it("redondea a 2 decimales", () => {
    expect(minutesToHours(1)).toBe(0.02);
    expect(minutesToHours(20)).toBe(0.33);
    expect(minutesToHours(150)).toBe(2.5);
    expect(minutesToHours(0)).toBe(0);
  });
});
