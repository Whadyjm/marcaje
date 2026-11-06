import { addDays } from "@domain/time.ts";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ShiftEditor } from "../../components/ShiftEditor";
import { Empty, ErrorBanner, Spinner, useAsync } from "../../components/ui";
import { api, type DayStatus, type DayView, type Shift } from "../../lib/api";
import { formatDay, formatHM, formatHours, formatInstant, formatLongDay, localTimeOf } from "../../lib/format";

const STATUS: Record<DayStatus, { label: string; className: string; help: string }> = {
  dentro: { label: "Dentro", className: "st-in", help: "Tiene una entrada abierta" },
  sin_salida: { label: "Sin salida", className: "st-warn", help: "Marcó entrada y no salida (posible olvido)" },
  salio: { label: "Salió", className: "st-done", help: "Marcó entrada y salida" },
  sin_marcar: { label: "No ha marcado", className: "st-none", help: "Sin marcajes en el día" },
};
// Primero lo que requiere acción de RRHH.
const ORDER: DayStatus[] = ["sin_salida", "sin_marcar", "dentro", "salio"];

type Row = DayView["rows"][number];
type Editing = { row: Row; shift?: Shift };
type Filter = DayStatus | "absent" | "late" | "early" | "all";

const isLate = (r: Row) => r.attendance.kind === "present" && r.attendance.lateMin > 0;
const leftEarly = (r: Row) => r.attendance.kind === "present" && r.attendance.earlyLeaveMin > 0;
const isAbsent = (r: Row) => r.attendance.kind === "absent";
/** Quien falta va primero; quien descansa o aún no entra no requiere nada. */
const rank = (r: Row) => (isAbsent(r) ? -1 : r.attendance.kind === "rest" || r.attendance.kind === "upcoming" ? 5 : ORDER.indexOf(r.status));

function matches(r: Row, filter: Filter) {
  if (filter === "all") return true;
  if (filter === "absent") return isAbsent(r);
  if (filter === "late") return isLate(r);
  if (filter === "early") return leftEarly(r);
  return r.status === filter;
}

export function Today() {
  const [date, setDate] = useState<string | undefined>(undefined);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const { data, error, loading, reload } = useAsync(() => api.day(date), [date]);

  // Refresco automático del día en curso, en pausa mientras RRHH edita.
  const isToday = !data || data.date === data.today;
  useEffect(() => {
    if (!isToday || editing) return;
    const id = setInterval(reload, 30_000);
    return () => clearInterval(id);
  }, [isToday, editing, reload]);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.rows
      .filter((r) => matches(r, filter))
      .filter((r) => !q || r.employee.name.toLowerCase().includes(q) || r.employee.cedula.includes(q))
      .sort((a, b) => rank(a) - rank(b) || a.employee.name.localeCompare(b.employee.name, "es"));
  }, [data, filter, search]);

  if (loading && !data) return <Spinner />;
  if (!data) return <ErrorBanner error={error} onRetry={reload} />;

  const go = (days: number) => {
    const next = addDays(data.date, days);
    setDate(next >= data.today ? undefined : next);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">{isToday ? `Hoy · actualizado ${localTimeOf(data.serverTime)}` : "Día anterior"}</span>
          <h1>{formatLongDay(data.date)}</h1>
        </div>
        <div className="page-actions">
          <div className="date-nav">
            <button className="btn btn-ghost btn-sm" onClick={() => go(-1)} aria-label="Día anterior">
              ‹
            </button>
            <input type="date" value={data.date} max={data.today} onChange={(e) => setDate(e.target.value && e.target.value !== data.today ? e.target.value : undefined)} aria-label="Fecha" />
            <button className="btn btn-ghost btn-sm" onClick={() => go(1)} disabled={isToday} aria-label="Día siguiente">
              ›
            </button>
          </div>
          {!isToday && (
            <button className="btn btn-ghost btn-sm" onClick={() => setDate(undefined)}>
              Hoy
            </button>
          )}
        </div>
      </div>

      <ErrorBanner error={error} onRetry={reload} />

      {data.weekAlerts.length > 0 && (
        <div className="banner banner-warn">
          <div>
            <strong>Más de 10 h extra esta semana</strong> ({formatDay(data.week.from)} → {formatDay(data.week.to)}):{" "}
            {data.weekAlerts.map((a) => `${a.name} (${formatHours(a.overtimeHours)} h)`).join(", ")}
          </div>
          <Link className="btn btn-ghost btn-sm" to={`/admin/periodo?from=${data.week.from}&to=${data.week.to}`}>
            Ver detalle
          </Link>
        </div>
      )}

      {data.pending.review + data.pending.conflicts > 0 && (
        <div className="banner banner-warn">
          <span>
            <strong>{data.pending.review + data.pending.conflicts} por revisar:</strong> marcajes hechos sin conexión que esperan tu decisión.
          </span>
          <Link className="btn btn-ghost btn-sm" to="/admin/marcajes">
            Revisar
          </Link>
        </div>
      )}

      <div className="counters">
        {(["dentro", "sin_marcar", "sin_salida", "salio"] as DayStatus[]).map((s) => (
          <button key={s} aria-pressed={filter === s} className={`counter ${STATUS[s].className}${filter === s ? " selected" : ""}`} onClick={() => setFilter(filter === s ? "all" : s)} title={STATUS[s].help}>
            <span className="counter-label">{STATUS[s].label}</span>
            <span className="counter-value">{data.counts[s]}</span>
          </button>
        ))}
      </div>

      {data.rows.some((r) => r.attendance.kind !== "unscheduled") && (
        <div className="chips attendance-filter">
          {(
            [
              ["absent", "Ausentes", data.rows.filter(isAbsent).length],
              ["late", "Llegaron tarde", data.rows.filter(isLate).length],
              ["early", "Salieron antes", data.rows.filter(leftEarly).length],
            ] as [Filter, string, number][]
          ).map(([key, label, n]) => (
            <button key={key} aria-pressed={filter === key} className={`chip chip-sm${filter === key ? " active" : ""}`} onClick={() => setFilter(filter === key ? "all" : key)}>
              {label} <span className="chip-note">{n}</span>
            </button>
          ))}
        </div>
      )}

      {data.rows.length === 0 ? (
        <Empty>
          Aún no tienes colaboradores.{" "}
          <Link className="btn btn-primary btn-sm" to="/admin/colaboradores">
            Dar de alta al primero
          </Link>
        </Empty>
      ) : (
        <>
          {data.rows.length > 6 && <input className="search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre o cédula" aria-label="Buscar colaborador" />}
          <div className="card flush">
            {rows.length === 0 ? (
              <p className="muted center pad">Nadie coincide con este filtro.</p>
            ) : (
              <ul className="list">
                {rows.map((r) => (
                  <DayRow key={r.employee.id} row={r} date={data.date} onEdit={(shift) => setEditing({ row: r, shift })} />
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {data.rows.length > 0 && <p className="hint">Quien marcó sin señal aparece aquí cuando su teléfono recupera la conexión, así que “Ausente” puede ser provisional.</p>}

      {editing && (
        <ShiftEditor
          shift={editing.shift}
          employees={[editing.row.employee]}
          defaultEmployeeId={editing.row.employee.id}
          defaultDate={data.date}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </>
  );
}

function AttendanceBadges({ row: r }: { row: Row }) {
  const a = r.attendance;
  // Sin marcajes, el horario dice más que "no ha marcado".
  if (r.status === "sin_marcar" && a.kind === "absent") return <span className="badge st-absent">Ausente</span>;
  if (r.status === "sin_marcar" && a.kind === "upcoming") return <span className="badge st-none">Entra a las {a.start}</span>;
  if (r.status === "sin_marcar" && a.kind === "rest") return <span className="badge st-none">Descanso</span>;
  return (
    <>
      <span className={`badge ${STATUS[r.status].className}`}>{STATUS[r.status].label}</span>
      {a.kind === "present" && a.lateMin > 0 && <span className="badge st-warn">{formatHM(a.lateMin)} tarde</span>}
      {a.kind === "present" && a.earlyLeaveMin > 0 && <span className="badge st-warn">{formatHM(a.earlyLeaveMin)} antes</span>}
    </>
  );
}

function DayRow({ row: r, date, onEdit }: { row: Row; date: string; onEdit: (shift?: Shift) => void }) {
  const a = r.attendance;
  const open = r.openShift ?? r.shifts.find((s) => !s.clockOut) ?? null;
  const fromOtherDay = open && open.workDate !== date;
  return (
    <li className="list-row">
      <div className="grow">
        <div className="row-title">
          <strong>{r.employee.name}</strong>
          <AttendanceBadges row={r} />
        </div>
        <div className="muted small">
          C.I. {r.employee.cedula}
          {"start" in a && (
            <>
              {" "}
              · Horario {a.start}–{a.end}
            </>
          )}
        </div>
        {[...r.shifts].reverse().map((s) => (
          <div key={s.id} className="shift-line">
            <span>
              {localTimeOf(s.clockIn)} → {s.clockOut ? formatInstant(s.clockOut, date) : "…"}
            </span>
            <span className="muted">{formatHM(s.elapsedMin)}</span>
            {s.corrections.length > 0 && <span className="badge badge-info">corregido</span>}
            {s.source === "offline" && <span className="badge badge-info">diferido</span>}
            {s.needsReview && <span className="badge st-warn">por revisar</span>}
            {s.clockOut && (
              <button className="link-btn" onClick={() => onEdit(s)}>
                Corregir
              </button>
            )}
          </div>
        ))}
        {fromOtherDay && (
          <div className="shift-line">
            <span>{formatInstant(open.clockIn)} → …</span>
            <span className="muted">{formatHM(open.elapsedMin)}</span>
          </div>
        )}
      </div>
      {/* La acción que corresponde a cada estado, a un toque. */}
      {r.status === "sin_salida" && open && (
        <button className="btn btn-primary btn-sm" onClick={() => onEdit(open)}>
          Completar salida
        </button>
      )}
      {r.status === "dentro" && open && (
        <button className="btn btn-ghost btn-sm" onClick={() => onEdit(open)}>
          Corregir
        </button>
      )}
      {(r.status === "sin_marcar" || r.status === "salio") && (
        <button className="btn btn-ghost btn-sm" onClick={() => onEdit()}>
          Registrar turno
        </button>
      )}
    </li>
  );
}
