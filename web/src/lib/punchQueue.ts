/**
 * Cola local de marcajes: el núcleo del offline-first.
 *
 * Marcar siempre escribe aquí primero y de forma síncrona, así el marcaje queda
 * guardado aunque el teléfono se apague un instante después. Un marcaje solo sale
 * de la cola cuando el servidor confirma qué hizo con él.
 *
 * La cola es por usuario, para que un teléfono compartido no mezcle marcajes y
 * sobreviva a cerrar sesión.
 */

export type PunchType = "in" | "out";

export interface QueuedPunch {
  clientId: string;
  type: PunchType;
  deviceTime: number;
  offsetMs: number | null;
}

export type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

const queueKey = (userId: string) => `marcaje.queue.${userId}`;
const OFFSET_KEY = "marcaje.clockOffset";

export function readQueue(store: KeyValueStore, userId: string): QueuedPunch[] {
  try {
    const parsed = JSON.parse(store.getItem(queueKey(userId)) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(store: KeyValueStore, userId: string, queue: QueuedPunch[]) {
  store.setItem(queueKey(userId), JSON.stringify(queue));
}

export function enqueue(store: KeyValueStore, userId: string, punch: QueuedPunch): QueuedPunch[] {
  const queue = [...readQueue(store, userId), punch];
  writeQueue(store, userId, queue);
  return queue;
}

export function removeFromQueue(store: KeyValueStore, userId: string, clientIds: string[]): QueuedPunch[] {
  const done = new Set(clientIds);
  // Se relee la cola: pudo entrar un marcaje nuevo mientras viajaba el envío.
  const queue = readQueue(store, userId).filter((p) => !done.has(p.clientId));
  writeQueue(store, userId, queue);
  return queue;
}

export function readOffset(store: KeyValueStore): number | null {
  const n = Number(store.getItem(OFFSET_KEY));
  return store.getItem(OFFSET_KEY) === null || !Number.isFinite(n) ? null : n;
}

export function saveOffset(store: KeyValueStore, offsetMs: number) {
  store.setItem(OFFSET_KEY, String(Math.round(offsetMs)));
}

/** Servidor − teléfono, tomando la mitad del viaje de ida y vuelta como momento de la respuesta. */
export function measureOffset(sentAt: number, receivedAt: number, serverTimeIso: string): number {
  return Date.parse(serverTimeIso) - (sentAt + receivedAt) / 2;
}

export const punchInstant = (p: QueuedPunch) => new Date(p.deviceTime + (p.offsetMs ?? 0)).toISOString();

/** Entrada abierta según lo último del servidor más lo que aún no se ha enviado. */
export function effectiveOpen(serverOpen: { clockIn: string } | null, queue: QueuedPunch[]): { clockIn: string; pending: boolean } | null {
  let open: { clockIn: string; pending: boolean } | null = serverOpen ? { clockIn: serverOpen.clockIn, pending: false } : null;
  for (const p of queue) open = p.type === "in" ? { clockIn: punchInstant(p), pending: true } : null;
  return open;
}

/** Lo mínimo del estado del servidor que hay que actualizar al confirmar un envío. */
export interface DayState<S> {
  openShift: S | null;
  recent: S[];
}

/**
 * Aplica al estado local lo que el servidor acaba de aceptar. La cola se vacía antes
 * de que llegue el estado nuevo, y con mala señal eso tarda: sin esto la pantalla
 * volvería a ofrecer "Marcar entrada" justo después de marcar.
 */
export function mergeSent<S extends { clockIn: string; clockOut: string | null }>(state: DayState<S>, sent: QueuedPunch[], makeShift: (clockIn: string, clockOut: string | null, key: string) => S): DayState<S> {
  let open = state.openShift;
  let recent = state.recent;
  for (const p of sent) {
    const at = punchInstant(p);
    if (p.type === "in") {
      open = makeShift(at, null, p.clientId);
      recent = [open, ...recent];
    } else if (open) {
      const closed = { ...open, clockOut: at };
      // El turno abierto y su fila en la lista son copias distintas: se reconocen por la entrada.
      const isOpenRow = (s: S) => s.clockOut === null && s.clockIn === closed.clockIn;
      recent = recent.some(isOpenRow) ? recent.map((s) => (isOpenRow(s) ? closed : s)) : [closed, ...recent];
      open = null;
    }
  }
  return { openShift: open, recent };
}

export interface PendingRow {
  key: string;
  clockIn: string | null;
  clockOut: string | null;
}

/** Filas para mostrar lo que falta por enviar, emparejando entradas con sus salidas. Lo más reciente primero. */
export function pendingRows(queue: QueuedPunch[]): PendingRow[] {
  const rows: PendingRow[] = [];
  for (const p of queue) {
    const last = rows[rows.length - 1];
    if (p.type === "out" && last && last.clockIn && !last.clockOut) last.clockOut = punchInstant(p);
    else rows.push({ key: p.clientId, clockIn: p.type === "in" ? punchInstant(p) : null, clockOut: p.type === "out" ? punchInstant(p) : null });
  }
  return rows.reverse();
}
