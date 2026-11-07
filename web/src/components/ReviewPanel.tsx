import { useState } from "react";
import { api, type Shift } from "../lib/api";
import { formatDay, formatInstant, localDateOf, localTimeOf } from "../lib/format";
import { useAutoRefresh } from "../lib/useAutoRefresh";
import { ShiftEditor } from "./ShiftEditor";
import { ErrorBanner, useAsync } from "./ui";

const APPROVE_REASON = "Aprobado por RRHH: hora confirmada";

/** Lo único que requiere a RRHH del modo sin conexión: horas dudosas y marcajes que no encajaron. */
export function ReviewPanel({ onChanged }: { onChanged: () => void }) {
  const { data, error, reload, refresh } = useAsync(() => api.reviewQueue(), []);
  const [editing, setEditing] = useState<Shift | null>(null);
  useAutoRefresh(refresh, { paused: !!editing });
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    setActionError(null);
    try {
      await fn();
      await reload();
      onChanged();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (error) return <ErrorBanner error={error} onRetry={reload} />;
  if (!data || (!data.shifts.length && !data.conflicts.length)) return null;

  return (
    <section className="card review-panel">
      <h2 className="h3">Por revisar · {data.shifts.length + data.conflicts.length}</h2>
      <p className="muted small">Marcajes hechos sin conexión. No se suman al período hasta que los resuelvas.</p>
      <ErrorBanner error={actionError} />
      <ul className="list">
        {data.shifts.map((s) => (
          <li key={s.id} className="list-row">
            <div className="grow">
              <strong>{s.employee?.name}</strong> · {formatDay(s.workDate)} {localTimeOf(s.clockIn)} → {s.clockOut ? formatInstant(s.clockOut, s.workDate) : "sin salida"}
              <div className="muted small">{s.reviewReason}</div>
            </div>
            <div className="row-actions">
              <button className="btn btn-primary btn-sm" disabled={busy === s.id} onClick={() => act(s.id, () => api.correctShift(s.id, { clockIn: s.clockIn, clockOut: s.clockOut, reason: APPROVE_REASON }))}>
                Aprobar
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(s)}>
                Corregir
              </button>
            </div>
          </li>
        ))}
        {data.conflicts.map((c) => (
          <li key={c.id} className="list-row">
            <div className="grow">
              <strong>{c.employee?.name}</strong> · {c.type === "in" ? "Entrada" : "Salida"} del {formatDay(localDateOf(c.occurredAt))} a las {localTimeOf(c.occurredAt)}
              <div className="muted small">No se aplicó: {c.reason}. Si hace falta, registra o corrige el turno.</div>
            </div>
            <div className="row-actions">
              <button className="btn btn-ghost btn-sm" disabled={busy === c.id} onClick={() => act(c.id, () => api.dismissConflict(c.id))}>
                Descartar
              </button>
            </div>
          </li>
        ))}
      </ul>
      {editing && (
        <ShiftEditor
          shift={editing}
          defaultDate={editing.workDate}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
            onChanged();
          }}
        />
      )}
    </section>
  );
}
