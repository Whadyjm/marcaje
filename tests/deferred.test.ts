import { describe, expect, it } from "vitest";
import { REVIEW_CLOCK, REVIEW_FUTURE, REVIEW_LATE, resolvePunchTime } from "../supabase/functions/api/domain/deferred.ts";

const SERVER = Date.parse("2026-10-05T20:00:00Z");
const H = 3_600_000;
const MIN = 60_000;
const base = { serverNow: SERVER, deviceNow: SERVER, offsetMs: 0, immediateAllowed: true };

describe("resolvePunchTime", () => {
  it("enviado de inmediato: manda la hora del servidor, aunque el reloj del teléfono mienta", () => {
    const deviceNow = SERVER + 3 * H; // teléfono adelantado 3 h
    const r = resolvePunchTime({ ...base, deviceNow, deviceTime: deviceNow - 5_000, offsetMs: -3 * H });
    expect(r).toEqual({ at: new Date(SERVER).toISOString(), deferred: false, review: null });
  });

  it("diferido normal: cuenta sin revisión con su hora de origen", () => {
    const r = resolvePunchTime({ ...base, deviceTime: SERVER - 2 * H });
    expect(r).toEqual({ at: new Date(SERVER - 2 * H).toISOString(), deferred: true, review: null });
  });

  it("corrige con la diferencia medida: un teléfono atrasado 10 min de forma estable no es sospechoso", () => {
    const offset = 10 * MIN;
    const deviceNow = SERVER - offset;
    const r = resolvePunchTime({ ...base, deviceNow, deviceTime: deviceNow - 2 * H, offsetMs: offset });
    expect(r.at).toBe(new Date(SERVER - 2 * H).toISOString());
    expect(r.review).toBeNull();
  });

  it("el reloj cambió entre marcar y reconectar: va a revisión", () => {
    const deviceNow = SERVER + H; // ahora está 1 h adelantado, antes estaba bien
    const r = resolvePunchTime({ ...base, deviceNow, deviceTime: SERVER - 2 * H, offsetMs: 0 });
    expect(r.deferred).toBe(true);
    expect(r.review).toBe(REVIEW_CLOCK);
  });

  it("tolera diferencias de hasta 5 min y marca lo que las pasa", () => {
    expect(resolvePunchTime({ ...base, deviceNow: SERVER + 5 * MIN, deviceTime: SERVER - H }).review).toBeNull();
    expect(resolvePunchTime({ ...base, deviceNow: SERVER + 5 * MIN + 1, deviceTime: SERVER - H }).review).toBe(REVIEW_CLOCK);
  });

  it("sin diferencia medida usa la actual y no acusa cambio de reloj", () => {
    const deviceNow = SERVER + H;
    const r = resolvePunchTime({ ...base, deviceNow, deviceTime: deviceNow - 2 * H, offsetMs: null });
    expect(r.at).toBe(new Date(SERVER - 2 * H).toISOString());
    expect(r.review).toBeNull();
  });

  it("más de 72 h de retraso va a revisión; 72 h exactas no", () => {
    expect(resolvePunchTime({ ...base, deviceTime: SERVER - 72 * H }).review).toBeNull();
    expect(resolvePunchTime({ ...base, deviceTime: SERVER - 72 * H - 1 }).review).toBe(REVIEW_LATE);
  });

  it("una hora en el futuro se limita a la del servidor y va a revisión", () => {
    const r = resolvePunchTime({ ...base, deviceTime: SERVER + H });
    expect(r.at).toBe(new Date(SERVER).toISOString());
    expect(r.review).toBe(REVIEW_FUTURE);
  });

  it("en un envío con varios marcajes, solo el último puede usar la hora del servidor", () => {
    const r = resolvePunchTime({ ...base, deviceTime: SERVER - 10_000, immediateAllowed: false });
    expect(r).toEqual({ at: new Date(SERVER - 10_000).toISOString(), deferred: true, review: null });
  });
});
