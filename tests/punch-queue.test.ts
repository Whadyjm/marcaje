import { describe, expect, it } from "vitest";
import { effectiveOpen, enqueue, measureOffset, mergeSent, pendingRows, readOffset, readQueue, removeFromQueue, saveOffset, type QueuedPunch } from "../web/src/lib/punchQueue.ts";

const store = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const T = Date.parse("2026-10-05T12:00:00Z");
const punch = (id: string, type: "in" | "out", min = 0, offsetMs: number | null = 0): QueuedPunch => ({ clientId: id, type, deviceTime: T + min * 60_000, offsetMs });

describe("cola de marcajes", () => {
  it("conserva el orden y es independiente por usuario", () => {
    const s = store();
    enqueue(s, "ana", punch("a", "in"));
    enqueue(s, "ana", punch("b", "out"));
    enqueue(s, "luis", punch("c", "in"));
    expect(readQueue(s, "ana").map((p) => p.clientId)).toEqual(["a", "b"]);
    expect(readQueue(s, "luis").map((p) => p.clientId)).toEqual(["c"]);
  });

  it("al confirmar conserva lo que entró mientras viajaba el envío", () => {
    const s = store();
    enqueue(s, "ana", punch("a", "in"));
    enqueue(s, "ana", punch("b", "out"));
    expect(removeFromQueue(s, "ana", ["a"]).map((p) => p.clientId)).toEqual(["b"]);
  });

  it("un dato dañado no rompe la app", () => {
    const s = store();
    s.setItem("marcaje.queue.ana", "{no es json");
    expect(readQueue(s, "ana")).toEqual([]);
  });

  it("guarda la diferencia con el reloj del servidor, incluido el cero", () => {
    const s = store();
    expect(readOffset(s)).toBeNull();
    saveOffset(s, 0);
    expect(readOffset(s)).toBe(0);
    saveOffset(s, -1500);
    expect(readOffset(s)).toBe(-1500);
  });

  it("mide la diferencia a mitad del viaje de ida y vuelta", () => {
    expect(measureOffset(T, T + 2000, new Date(T + 61_000).toISOString())).toBe(60_000);
  });
});

describe("estado tras confirmar un envío", () => {
  type S = { clockIn: string; clockOut: string | null };
  const make = (clockIn: string, clockOut: string | null): S => ({ clockIn, clockOut });
  const iso = (min: number) => new Date(T + min * 60_000).toISOString();

  it("una entrada aceptada deja al colaborador dentro, sin esperar la recarga", () => {
    const r = mergeSent<S>({ openShift: null, recent: [] }, [punch("a", "in", 0)], make);
    expect(r.openShift?.clockIn).toBe(iso(0));
    expect(r.recent).toHaveLength(1);
  });

  it("entrada y salida aceptadas quedan como un turno cerrado", () => {
    const r = mergeSent<S>({ openShift: null, recent: [] }, [punch("a", "in", 0), punch("b", "out", 30)], make);
    expect(r.openShift).toBeNull();
    expect(r.recent).toEqual([{ clockIn: iso(0), clockOut: iso(30) }]);
  });

  it("una salida cierra el turno abierto que ya estaba en la lista", () => {
    const open = make(iso(-60), null);
    const old = make(iso(-600), iso(-500));
    const r = mergeSent<S>({ openShift: open, recent: [{ ...open }, old] }, [punch("b", "out", 0)], make);
    expect(r.openShift).toBeNull();
    expect(r.recent).toEqual([{ clockIn: iso(-60), clockOut: iso(0) }, old]);
  });

  it("sin nada aceptado el estado no cambia", () => {
    const open = make(iso(-60), null);
    expect(mergeSent<S>({ openShift: open, recent: [open] }, [], make)).toEqual({ openShift: open, recent: [open] });
  });
});

describe("estado mostrado sin conexión", () => {
  const server = { clockIn: "2026-10-05T08:00:00.000Z" };

  it("sin cola manda el servidor", () => {
    expect(effectiveOpen(server, [])).toEqual({ clockIn: server.clockIn, pending: false });
    expect(effectiveOpen(null, [])).toBeNull();
  });

  it("lo que está en cola se aplica encima, y la hora usa la corrección del reloj", () => {
    expect(effectiveOpen(server, [punch("a", "out")])).toBeNull();
    expect(effectiveOpen(null, [punch("a", "in", 0, 60_000)])).toEqual({ clockIn: new Date(T + 60_000).toISOString(), pending: true });
    expect(effectiveOpen(null, [punch("a", "in"), punch("b", "out"), punch("c", "in", 30)])?.clockIn).toBe(new Date(T + 30 * 60_000).toISOString());
  });

  it("empareja entradas con salidas, con lo más reciente primero", () => {
    const rows = pendingRows([punch("x", "out", 0), punch("a", "in", 10), punch("b", "out", 20), punch("c", "in", 30)]);
    expect(rows.map((r) => [r.key, !!r.clockIn, !!r.clockOut])).toEqual([
      ["c", true, false],
      ["a", true, true],
      ["x", false, true],
    ]);
  });
});
