/**
 * Hora de un marcaje que llega desde la cola del teléfono.
 *
 * Con conexión manda el servidor: un marcaje enviado de inmediato usa su hora,
 * y el reloj del teléfono no influye. Sin conexión solo existe el reloj del
 * teléfono, así que se corrige con la diferencia medida la última vez que hubo
 * conexión. Al reconectar se mide de nuevo: si cambió, alguien movió el reloj.
 *
 * Límite conocido: quien cambie el reloj y lo restaure antes de reconectar no se
 * detecta. Por eso todo diferido queda etiquetado y visible para RRHH.
 */

/** Enviado hasta 60 s después de marcar: se considera en línea. */
export const IMMEDIATE_WINDOW_MS = 60_000;
export const MAX_DEFERRED_AGE_MS = 72 * 3_600_000;
export const CLOCK_DRIFT_TOLERANCE_MS = 5 * 60_000;
export const FUTURE_SKEW_MS = 2 * 60_000;

export const REVIEW_CLOCK = "El reloj del teléfono cambió";
export const REVIEW_LATE = "Llegó con más de 72 h de retraso";
export const REVIEW_FUTURE = "La hora quedó en el futuro";

export interface PunchClock {
  /** Date.now() del teléfono al marcar. */
  deviceTime: number;
  /** Servidor − teléfono, medido con la última conexión. Null si nunca se midió. */
  offsetMs: number | null;
  /** Date.now() del teléfono al enviar. */
  deviceNow: number;
  serverNow: number;
  /** En un envío con varios marcajes solo el último puede ser inmediato. */
  immediateAllowed: boolean;
}

export interface ResolvedPunch {
  at: string;
  deferred: boolean;
  review: string | null;
}

export function resolvePunchTime(c: PunchClock): ResolvedPunch {
  const waited = c.deviceNow - c.deviceTime;
  if (c.immediateAllowed && waited >= 0 && waited <= IMMEDIATE_WINDOW_MS) {
    return { at: new Date(c.serverNow).toISOString(), deferred: false, review: null };
  }

  const currentOffset = c.serverNow - c.deviceNow;
  const offset = c.offsetMs ?? currentOffset;
  let at = c.deviceTime + offset;
  const reasons: string[] = [];

  if (Math.abs(currentOffset - offset) > CLOCK_DRIFT_TOLERANCE_MS) reasons.push(REVIEW_CLOCK);
  if (at > c.serverNow + FUTURE_SKEW_MS) {
    reasons.push(REVIEW_FUTURE);
    at = c.serverNow;
  }
  if (c.serverNow - at > MAX_DEFERRED_AGE_MS) reasons.push(REVIEW_LATE);

  return { at: new Date(at).toISOString(), deferred: true, review: reasons.length ? reasons.join("; ") : null };
}
