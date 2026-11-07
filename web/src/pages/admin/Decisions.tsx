import { useMemo, useState } from "react";
import { PeriodPicker, presets, type Period } from "../../components/PeriodPicker";
import { describeShift } from "../../components/ShiftChangeRequests";
import { Empty, ErrorBanner, Spinner, useAsync } from "../../components/ui";
import { api, type Decision, type DecisionOutcome } from "../../lib/api";
import { formatDay, formatInstant } from "../../lib/format";
import { useAutoRefresh } from "../../lib/useAutoRefresh";

type Filter = "all" | "approved" | "rejected" | "shift_change" | "pin";

const OUTCOME: Record<DecisionOutcome, { label: string; className: string }> = {
  approved: { label: "Aprobada", className: "st-in" },
  rejected: { label: "Rechazada", className: "st-absent" },
  unknown: { label: "Atendida", className: "st-none" },
};

function matches(d: Decision, filter: Filter) {
  if (filter === "all") return true;
  if (filter === "shift_change" || filter === "pin") return d.kind === filter;
  return d.outcome === filter;
}

export function Decisions() {
  // Quincena actual: lo que RRHH suele revisar al cerrar.
  const [period, setPeriod] = useState<Period>(() => presets()[2].period);
  const [filter, setFilter] = useState<Filter>("all");
  const [person, setPerson] = useState("");
  const { data, error, loading, reload, refresh } = useAsync(() => api.decisions(period.from, period.to), [period.from, period.to]);
  useAutoRefresh(refresh);

  const all = useMemo(() => data?.decisions ?? [], [data]);
  const people = useMemo(() => [...new Map(all.filter((d) => d.employee).map((d) => [d.employee!.cedula, d.employee!])).values()].sort((a, b) => a.name.localeCompare(b.name, "es")), [all]);
  const byPerson = all.filter((d) => !person || d.employee?.cedula === person);
  const visible = byPerson.filter((d) => matches(d, filter));
  const count = (f: Filter) => byPerson.filter((d) => matches(d, f)).length;

  const chips: [Filter, string][] = [
    ["all", "Todas"],
    ["approved", "Aprobadas"],
    ["rejected", "Rechazadas"],
    ["shift_change", "Cambios de turno"],
    ["pin", "PIN"],
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">
            {formatDay(period.from)} → {formatDay(period.to)}
          </span>
          <h1>Bitácora de decisiones</h1>
        </div>
      </div>

      <div className="card filters">
        <PeriodPicker value={period} onChange={setPeriod} />
        <select value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Colaborador">
          <option value="">Todos los colaboradores</option>
          {people.map((p) => (
            <option key={p.cedula} value={p.cedula}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="chips quick-filter">
        {chips.map(([key, label]) => (
          <button key={key} aria-pressed={filter === key} className={`chip${filter === key ? " active" : ""}`} onClick={() => setFilter(key)}>
            {label} <span className="chip-note">{count(key)}</span>
          </button>
        ))}
      </div>

      {loading && !data ? (
        <Spinner />
      ) : error ? (
        <ErrorBanner error={error} onRetry={reload} />
      ) : !visible.length ? (
        <Empty>No hay decisiones con este filtro. Se registran solas al decidir una solicitud en Equipo.</Empty>
      ) : (
        <div className="card flush">
          <ul className="list">
            {visible.map((d) => (
              <DecisionRow key={d.id} decision={d} />
            ))}
          </ul>
        </div>
      )}
      <p className="hint">Se registra automáticamente y no se puede editar. Lo que el propio colaborador cancela no aparece aquí.</p>
    </>
  );
}

function DecisionRow({ decision: d }: { decision: Decision }) {
  const outcome = OUTCOME[d.outcome];
  return (
    <li className="list-row decision">
      <div className="grow">
        <div className="row-title">
          <strong>{d.employee?.name ?? "Colaborador eliminado"}</strong>
          <span className={`badge ${outcome.className}`}>{outcome.label}</span>
        </div>
        <div className="small">
          {d.request ? (
            <>
              Cambio de turno · {formatDay(d.request.workDate)}: {d.request.from ? describeShift(d.request.from) : "Sin turno"} → <strong>{describeShift(d.request.to)}</strong>
            </>
          ) : (
            "Solicitud de PIN"
          )}
        </div>
        {d.request && <div className="muted small">Pidió: “{d.request.reason}”</div>}
        <div className="decision-reason small">
          <strong>Motivo de RRHH:</strong> {d.reason ?? <span className="muted">no registrado</span>}
        </div>
        <div className="muted small">
          {d.decidedBy ?? "RRHH"} · {formatInstant(d.decidedAt)}
        </div>
      </div>
    </li>
  );
}
