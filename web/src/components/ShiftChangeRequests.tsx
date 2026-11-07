import { useState } from "react";
import { api, type ShiftChange } from "../lib/api";
import { formatDay } from "../lib/format";
import { useAutoRefresh } from "../lib/useAutoRefresh";
import { PIN_REQUESTS_CHANGED } from "./AdminLayout";
import { DecisionModal } from "./DecisionModal";
import { useAsync } from "./ui";

const APPROVE_REASONS = ["Hay cobertura ese día", "Acordado con el supervisor", "Motivo justificado"];
const REJECT_REASONS = ["No hay cobertura ese día", "Fuera del plazo de solicitud", "Hablemos en persona"];

export const describeShift = (t: { start: string; end: string } | null) => (t ? `${t.start}–${t.end}` : "Día libre");

/** Panel de RRHH: aprobar reemplaza el horario de esa fecha. Cada decisión queda en la bitácora. */
export function ShiftChangeRequests() {
  const { data, reload, refresh } = useAsync(() => api.shiftChanges(), []);
  const [deciding, setDeciding] = useState<{ request: ShiftChange; approve: boolean } | null>(null);
  useAutoRefresh(refresh, { paused: !!deciding });

  async function decide(reason: string) {
    await api.decideShiftChange(deciding!.request.id, { approve: deciding!.approve, note: reason });
    setDeciding(null);
    await reload();
    window.dispatchEvent(new Event(PIN_REQUESTS_CHANGED));
  }

  if (!data?.requests.length) return null;

  return (
    <section className="card pin-requests">
      <h2 className="h3">Cambios de turno por decidir · {data.requests.length}</h2>
      <p className="muted small">Al aprobar, cambia el horario esperado solo de ese día.</p>
      <ul className="list">
        {data.requests.map((r) => (
          <li key={r.id} className="list-row">
            <div className="grow">
              <strong>{r.employee?.name}</strong> · {formatDay(r.workDate)}
              <div className="small">
                {r.from ? describeShift(r.from) : "Sin turno"} → <strong>{describeShift(r.to)}</strong>
              </div>
              <div className="muted small">“{r.reason}”</div>
            </div>
            <div className="row-actions">
              <button className="btn btn-primary btn-sm" onClick={() => setDeciding({ request: r, approve: true })}>
                Aprobar
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setDeciding({ request: r, approve: false })}>
                Rechazar
              </button>
            </div>
          </li>
        ))}
      </ul>

      {deciding && (
        <DecisionModal
          title={`${deciding.approve ? "Aprobar" : "Rechazar"} · ${deciding.request.employee?.name}`}
          summary={`${formatDay(deciding.request.workDate)}: ${deciding.request.from ? describeShift(deciding.request.from) : "Sin turno"} → ${describeShift(deciding.request.to)}`}
          reasons={deciding.approve ? APPROVE_REASONS : REJECT_REASONS}
          confirmLabel={deciding.approve ? "Aprobar solicitud" : "Rechazar solicitud"}
          onClose={() => setDeciding(null)}
          onConfirm={decide}
        />
      )}
    </section>
  );
}
