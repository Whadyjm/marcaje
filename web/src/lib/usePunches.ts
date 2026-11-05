import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type EmployeeToday, type Shift } from "./api";
import { localDateOf } from "./format";
import { effectiveOpen, enqueue, measureOffset, mergeSent, punchInstant, readOffset, readQueue, removeFromQueue, saveOffset, type PunchType, type QueuedPunch } from "./punchQueue";

const RETRY_MS = 30_000;
/** Bloqueo tras marcar: un doble toque no puede convertir una entrada en salida. */
const PUNCH_LOCK_MS = 1500;
const todayKey = (userId: string) => `marcaje.today.${userId}`;

function readToday(userId: string): EmployeeToday | null {
  try {
    return JSON.parse(localStorage.getItem(todayKey(userId)) ?? "null");
  } catch {
    return null;
  }
}

function saveToday(userId: string, today: EmployeeToday) {
  try {
    localStorage.setItem(todayKey(userId), JSON.stringify(today));
  } catch {
    /* es solo una copia para abrir sin conexión */
  }
}

/** Turno provisional hasta que llegue el estado real del servidor. */
function makeLocalShift(clockIn: string, clockOut: string | null, key: string): Shift {
  return { id: key, employeeId: "", clockIn, clockOut, workDate: localDateOf(clockIn), source: "app", needsReview: false, reviewReason: null, minutes: null, elapsedMin: 0, corrections: [] };
}

export interface PunchNotice {
  kind: "ok" | "warn" | "error";
  text: string;
}

/**
 * Estado del colaborador, offline-first: abre con lo último guardado, marcar nunca
 * espera a la red, y la cola se envía al abrir, al reconectar, al volver a la app
 * y cada 30 s mientras quede algo pendiente.
 */
export function usePunches(userId: string) {
  const [today, setToday] = useState<EmployeeToday | null>(() => readToday(userId));
  const [queue, setQueue] = useState<QueuedPunch[]>(() => readQueue(localStorage, userId));
  const [offline, setOffline] = useState(() => !navigator.onLine);
  const [loading, setLoading] = useState(false);
  const [locked, setLocked] = useState(false);
  const [notice, setNotice] = useState<PunchNotice | null>(null);
  const flushing = useRef<Promise<void> | null>(null);

  const noteFailure = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 0) setOffline(true);
    else if (e instanceof ApiError && e.status === 401) setNotice({ kind: "warn", text: "Tu sesión venció. Tus marcajes siguen guardados: entra de nuevo para enviarlos." });
    else setNotice({ kind: "error", text: (e as Error).message });
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const sentAt = Date.now();
      const t = await api.myToday();
      saveOffset(localStorage, measureOffset(sentAt, Date.now(), t.serverTime));
      setToday(t);
      saveToday(userId, t);
      setOffline(false);
    } catch (e) {
      noteFailure(e);
    } finally {
      setLoading(false);
    }
  }, [userId, noteFailure]);

  const flush = useCallback((): Promise<void> => {
    if (flushing.current) return flushing.current;
    const run = (async () => {
      const events = readQueue(localStorage, userId);
      if (!events.length) return;
      try {
        const sentAt = Date.now();
        const { serverTime, results } = await api.syncPunches({ deviceNow: sentAt, events });
        saveOffset(localStorage, measureOffset(sentAt, Date.now(), serverTime));
        setOffline(false);
        const accepted = new Set(results.filter((r) => r.status === "applied" || r.status === "duplicate").map((r) => r.clientId));
        const base = readToday(userId);
        if (base) {
          const merged = { ...base, ...mergeSent<Shift>(base, events.filter((e) => accepted.has(e.clientId)), makeLocalShift) };
          setToday(merged);
          saveToday(userId, merged); // también si la recarga falla: al reabrir no vuelve al estado viejo
        }
        setQueue(removeFromQueue(localStorage, userId, results.map((r) => r.clientId)));

        const rejected = results.find((r) => r.status === "rejected");
        const conflicts = results.filter((r) => r.status === "conflict").length;
        const reviews = results.filter((r) => r.review && r.status === "applied").length;
        const deferred = results.filter((r) => r.deferred && r.status === "applied").length;
        if (rejected) setNotice({ kind: "error", text: rejected.message ?? "No se pudo registrar el marcaje." });
        else if (conflicts) setNotice({ kind: "warn", text: `${conflicts === 1 ? "Un marcaje no coincidió" : `${conflicts} marcajes no coincidieron`} con lo registrado. Quedó para que RRHH lo revise.` });
        else if (reviews) setNotice({ kind: "warn", text: "Tu marcaje se envió. RRHH revisará la hora antes de sumarla." });
        else if (deferred) setNotice({ kind: "ok", text: deferred === 1 ? "Tu marcaje guardado ya se envió." : `Tus ${deferred} marcajes guardados ya se enviaron.` });
        await refresh();
      } catch (e) {
        noteFailure(e); // la cola queda intacta: se reintenta sin perder nada
      }
    })().finally(() => {
      flushing.current = null;
    });
    flushing.current = run;
    return run;
  }, [userId, refresh, noteFailure]);

  const sync = useCallback(async () => {
    if (readQueue(localStorage, userId).length) await flush();
    else await refresh();
  }, [userId, flush, refresh]);

  useEffect(() => {
    if (navigator.onLine) void sync();
    const onOnline = () => {
      setOffline(false);
      void sync();
    };
    const onOffline = () => setOffline(true);
    const onVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void sync();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    // Pide al navegador no borrar la cola si le falta espacio.
    void navigator.storage?.persist?.();
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [sync]);

  useEffect(() => {
    if (!queue.length) return;
    const id = setInterval(() => void flush(), RETRY_MS);
    return () => clearInterval(id);
  }, [queue.length, flush]);

  const open = effectiveOpen(today?.openShift ?? null, queue);

  const punch = useCallback(
    (type: PunchType) => {
      if (locked) return;
      setLocked(true);
      setTimeout(() => setLocked(false), PUNCH_LOCK_MS);
      const event: QueuedPunch = { clientId: crypto.randomUUID(), type, deviceTime: Date.now(), offsetMs: readOffset(localStorage) };
      let saved = true;
      try {
        setQueue(enqueue(localStorage, userId, event));
      } catch {
        saved = false;
      }
      if (!saved) {
        setNotice({ kind: "error", text: "No se pudo guardar el marcaje en este teléfono. Revisa el espacio disponible." });
        return;
      }
      navigator.vibrate?.(60);
      const time = new Date(Date.parse(punchInstant(event)) - 4 * 3_600_000).toISOString().slice(11, 16);
      setNotice({ kind: "ok", text: `${type === "in" ? "Entrada registrada" : "Salida registrada"} a las ${time}${navigator.onLine ? "" : ". Se enviará al volver la conexión"}` });
      if (navigator.onLine) void flush();
    },
    [locked, userId, flush],
  );

  useEffect(() => {
    if (notice?.kind !== "ok") return;
    const id = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(id);
  }, [notice]);

  return { today, queue, open, offline, loading, locked, notice, punch, retry: sync };
}
