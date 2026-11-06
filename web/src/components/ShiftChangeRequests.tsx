import { useState } from "react";
import { api, type ShiftChange } from "../lib/api";
import { formatDay } from "../lib/format";
import { PIN_REQUESTS_CHANGED } from "./AdminLayout";
import { ErrorBanner, Modal, useAsync } from "./ui";

const REJECT_NOTES = ["No hay cobertura ese día", "Fuera del plazo de solicitud", "Hablemos en persona"];

export const describeShift = (t: { start: string; end: string } | null) => (t ? `${t.start}–${t.end}` : "Día libre");

/** Panel de RRHH: aprobar reemplaza el horario de esa fecha; rechazar admite una nota. */
export function ShiftChangeRequests() {
  const { data, reload } = useAsync(() => api.shiftChanges(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<ShiftChange | null>(null);
  const [note, setNote] = useState("");

  async function decide(r: ShiftChange, approve: boolean, decisionNote?: string) {
    setBusy(r.id);
    setError(null);
    try {
      await api.decideShiftChange(r.id, { approve, note: decisionNote?.trim() || undefined });
      setRejecting(null);
      setNote("");
      await reload();
      window.dispatchEvent(new Event(PIN_REQUESTS_CHANGED));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!data?.requests.length) return null;

  return (
    <section className="card pin-requests">
      <h2 className="h3">Cambios de turno por decidir · {data.requests.length}</h2>
      <p className="muted small">Al aprobar, cambia el horario esperado solo de ese día.</p>
      <ErrorBanner error={error} />
      <ul className="list">
        {data.requests.map((r) => (
          <li key={r.id} className="list-row">
            <div className="grow">
              <strong>{r.employee?.name}</strong> · {formatDay(r.workDate)}
              <div className="small">
                {r.from ? describeShift(r.from) : "Sin horario"} → <strong>{describeShift(r.to)}</strong>
              </div>
              <div className="muted small">“{r.reason}”</div>
            </div>
            <div className="row-actions">
              <button className="btn btn-primary btn-sm" disabled={busy === r.id} onClick={() => decide(r, true)}>
                Aprobar
              </button>
              <button className="btn btn-ghost btn-sm" disabled={busy === r.id} onClick={() => setRejecting(r)}>
                Rechazar
              </button>
            </div>
          </li>
        ))}
      </ul>

      {rejecting && (
        <Modal
          title={`Rechazar · ${rejecting.employee?.name}`}
          onClose={() => setRejecting(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setRejecting(null)}>
                Cancelar
              </button>
              <button className="btn btn-primary" disabled={busy === rejecting.id} onClick={() => decide(rejecting, false, note)}>
                Rechazar solicitud
              </button>
            </>
          }
        >
          <div className="form">
            <div className="field">
              <span className="field-label">
                Nota para el colaborador <span className="req">opcional</span>
              </span>
              <div className="chips">
                {REJECT_NOTES.map((n) => (
                  <button key={n} type="button" className={`chip chip-sm${note === n ? " active" : ""}`} onClick={() => setNote(n)}>
                    {n}
                  </button>
                ))}
              </div>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} aria-label="Nota" />
            </div>
            <ErrorBanner error={error} />
          </div>
        </Modal>
      )}
    </section>
  );
}
