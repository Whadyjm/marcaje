import { todayInCaracas } from "@domain/time.ts";
import { Fragment, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PeriodPicker, presets, type Period } from "../../components/PeriodPicker";
import { ReviewPanel } from "../../components/ReviewPanel";
import { CorrectionHistory, ShiftEditor } from "../../components/ShiftEditor";
import { Empty, ErrorBanner, Spinner, useAsync } from "../../components/ui";
import { api, type Shift } from "../../lib/api";
import { formatDay, formatHM, formatInstant, localTimeOf } from "../../lib/format";
import { useAutoRefresh } from "../../lib/useAutoRefresh";

type Only = "all" | "open" | "corrected";

/** Los ceros como guion: así resaltan las horas que importan. */
const hm = (min: number) => (min === 0 ? "—" : formatHM(min));

export function Shifts() {
  const [params] = useSearchParams();
  const [period, setPeriod] = useState<Period>(() => {
    const from = params.get("from");
    const to = params.get("to");
    return from && to ? { from, to } : presets()[0].period;
  });
  const [employeeId, setEmployeeId] = useState(params.get("employeeId") ?? "");
  const [only, setOnly] = useState<Only>(params.get("only") === "open" ? "open" : "all");
  const [editing, setEditing] = useState<Shift | "new" | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const employees = useAsync(() => api.employees(), []);
  const shifts = useAsync(() => api.shifts({ ...period, employeeId: employeeId || undefined }), [period.from, period.to, employeeId]);

  useAutoRefresh(shifts.refresh, { paused: !!editing });

  const all = shifts.data?.shifts ?? [];
  const counts = { all: all.length, open: all.filter((s) => !s.clockOut).length, corrected: all.filter((s) => s.corrections.length > 0).length };
  const visible = all.filter((s) => only === "all" || (only === "open" ? !s.clockOut : s.corrections.length > 0));

  const today = todayInCaracas();
  const defaultDate = today >= period.from && today <= period.to ? today : period.to < today ? period.to : today;

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">
            {formatDay(period.from)} → {formatDay(period.to)}
          </span>
          <h1>Marcajes</h1>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => setEditing("new")} disabled={!employees.data}>
            Registrar turno
          </button>
        </div>
      </div>

      <ReviewPanel onChanged={shifts.reload} />

      <div className="card filters">
        <PeriodPicker value={period} onChange={setPeriod} />
        <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} aria-label="Colaborador">
          <option value="">Todos los colaboradores</option>
          {employees.data?.employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
              {e.active ? "" : " (inactivo)"}
            </option>
          ))}
        </select>
      </div>

      <div className="chips quick-filter">
        {(
          [
            ["all", "Todos"],
            ["open", "Sin salida"],
            ["corrected", "Corregidos"],
          ] as [Only, string][]
        ).map(([key, label]) => (
          <button key={key} aria-pressed={only === key} className={`chip${only === key ? " active" : ""}`} onClick={() => setOnly(key)}>
            {label} <span className="chip-note">{counts[key]}</span>
          </button>
        ))}
      </div>

      {shifts.loading && !shifts.data ? (
        <Spinner />
      ) : shifts.error ? (
        <ErrorBanner error={shifts.error} onRetry={shifts.reload} />
      ) : !visible.length ? (
        <Empty>{only === "open" ? "No hay turnos sin salida en este período. ✓" : "No hay marcajes con este filtro."}</Empty>
      ) : (
        <div className="card flush">
          <table className="table">
            <thead>
              <tr>
                <th>Día</th>
                <th>Colaborador</th>
                <th>Turno</th>
                <th className="right">Total</th>
                <th className="right">Extra D / N</th>
                <th className="right">Noct. ord.</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => (
                <Fragment key={s.id}>
                  <tr className={s.clockOut ? "" : "row-warn"}>
                    <td data-label="Día">{formatDay(s.workDate)}</td>
                    <td data-label="Colaborador">{s.employee?.name}</td>
                    <td data-label="Turno">
                      <span>
                        {localTimeOf(s.clockIn)} → {s.clockOut ? formatInstant(s.clockOut, s.workDate) : <span className="badge st-warn">sin salida</span>}
                        {s.source === "manual" && <span className="badge badge-info">manual</span>}
                        {s.source === "offline" && (
                          <span className="badge badge-info" title="Marcado sin conexión: la hora viene del teléfono, corregida con el servidor">
                            diferido
                          </span>
                        )}
                        {s.needsReview && <span className="badge st-warn">por revisar</span>}
                        {s.corrections.length > 0 && (
                          <button className="badge badge-info as-btn" aria-expanded={expanded === s.id} onClick={() => setExpanded(expanded === s.id ? null : s.id)}>
                            {s.corrections.length === 1 ? "1 corrección" : `${s.corrections.length} correcciones`}
                          </button>
                        )}
                      </span>
                    </td>
                    <td data-label="Total" className="right num">
                      {s.minutes ? formatHM(s.minutes.totalMin) : "—"}
                    </td>
                    <td data-label="Extra D / N" className="right num">
                      {s.minutes ? `${hm(s.minutes.overtimeDayMin)} / ${hm(s.minutes.overtimeNightMin)}` : "—"}
                    </td>
                    <td data-label="Noct. ord." className="right num">
                      {s.minutes ? hm(s.minutes.nightOrdinaryMin) : "—"}
                    </td>
                    <td className="right">
                      {s.clockOut ? (
                        <button className="link-btn" onClick={() => setEditing(s)}>
                          Corregir
                        </button>
                      ) : (
                        <button className="btn btn-primary btn-sm" onClick={() => setEditing(s)}>
                          Completar salida
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded === s.id && (
                    <tr className="history-row">
                      <td colSpan={7}>
                        <CorrectionHistory shift={s} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ShiftEditor
          shift={editing === "new" ? undefined : editing}
          employees={employees.data?.employees}
          defaultEmployeeId={employeeId || undefined}
          defaultDate={defaultDate}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            shifts.reload();
          }}
        />
      )}
    </>
  );
}
