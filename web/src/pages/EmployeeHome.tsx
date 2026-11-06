import { useEffect, useState } from "react";
import { InstallHint } from "../components/InstallHint";
import { ShiftChangeForm } from "../components/ShiftChangeForm";
import { SlideToConfirm } from "../components/SlideToConfirm";
import { Logo } from "../components/Logo";
import { LogoutButton } from "../components/LogoutButton";
import { Spinner } from "../components/ui";
import { api, type Shift, type ShiftChange } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatDay, formatHM, formatHours, formatLongDay, localDateOf, localTimeOf } from "../lib/format";
import { pendingRows, readOffset, type PendingRow } from "../lib/punchQueue";
import { usePunches } from "../lib/usePunches";

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function EmployeeHome() {
  const { info, session } = useAuth();
  const { today: data, queue, open, offline, loading, locked, notice, punch, retry } = usePunches(session!.user.id);
  const [changing, setChanging] = useState(false);
  const [changeNote, setChangeNote] = useState<string | null>(null);
  const [logoutNote, setLogoutNote] = useState<string | null>(null);
  // La hora mostrada usa la misma corrección que los marcajes, para que coincidan.
  const now = useNow() + (readOffset(localStorage) ?? 0);

  function canLeave() {
    if (offline) {
      setLogoutNote("Necesitas conexión para cerrar sesión.");
      return false;
    }
    return !queue.length || confirm("Tienes marcajes sin enviar. Se conservan en este teléfono y se enviarán cuando vuelvas a entrar. ¿Salir?");
  }

  const elapsedMin = open ? Math.max(0, Math.floor((now - Date.parse(open.clockIn)) / 60_000)) : 0;
  const nowIso = new Date(now).toISOString();
  const today = localDateOf(nowIso);
  const pending = pendingRows(queue);
  const sentCount = queue.length;

  return (
    <div className="app employee">
      <header className="topbar">
        <div className="topbar-inner">
          <Logo />
          <div className="topbar-company-stack">
            <strong>{info?.name}</strong>
            <span className="muted">{info?.company.name}</span>
          </div>
          <LogoutButton canLeave={canLeave} />
        </div>
      </header>

      <main className="container narrow">
        {(offline || sentCount > 0) && (
          <div className={`sync-bar${offline ? " is-offline" : ""}`} role="status">
            {offline ? "Sin conexión" : "Enviando…"}
            {sentCount > 0 ? ` · ${sentCount} ${sentCount === 1 ? "marcaje guardado" : "marcajes guardados"} en este teléfono` : " · puedes marcar igual"}
          </div>
        )}
        {logoutNote && offline && <div className="banner banner-warn">{logoutNote}</div>}

        <section className="punch-card">
          <div className="clock" aria-live="off">
            {localTimeOf(nowIso)}
          </div>
          <div className="muted">{formatLongDay(today)} · hora de Caracas</div>
          {data?.expected?.kind === "shift" && (
            <div className="muted small">
              Tu horario de hoy: {data.expected.start}–{data.expected.end}
            </div>
          )}
          {data?.expected?.kind === "rest" && <div className="muted small">Hoy es tu día de descanso</div>}

          {!data && loading ? (
            <Spinner />
          ) : (
            <>
              <div className={`status-pill ${open ? "in" : "out"}`}>
                {open ? (
                  <>
                    Dentro desde las <strong>{localTimeOf(open.clockIn)}</strong>
                    {localDateOf(open.clockIn) !== today && <> del {formatDay(localDateOf(open.clockIn))}</>} · {formatHM(elapsedMin)}
                  </>
                ) : (
                  "Fuera de turno"
                )}
              </div>

              {/* La key reinicia la manija al pasar de entrada a salida. */}
              {open ? (
                <SlideToConfirm key="out" tone="out" label="Desliza para marcar salida" disabled={locked} onConfirm={() => punch("out")} />
              ) : (
                <SlideToConfirm key="in" tone="in" label="Desliza para marcar entrada" disabled={locked} onConfirm={() => punch("in")} />
              )}
              {open && elapsedMin >= 14 * 60 ? (
                <div className="banner banner-warn">¿Olvidaste marcar tu salida? Si ya saliste, avísale a RRHH para que la corrija.</div>
              ) : open && elapsedMin >= 8 * 60 ? (
                <p className="hint center">Llevas más de 8 h: el tiempo adicional cuenta como hora extra.</p>
              ) : null}
              {notice && (
                <div className={`banner ${notice.kind === "ok" ? "banner-ok" : notice.kind === "warn" ? "banner-warn" : "banner-error"}`} role="status">
                  {notice.kind === "ok" && "✓ "}
                  {notice.text}
                </div>
              )}
            </>
          )}
        </section>

        <InstallHint />

        {data && (
          <section className="card">
            <h2 className="h3">Esta semana</h2>
            <div className="stats">
              <div className="stat">
                <span className="stat-value">{formatHours(data.week.totalHours)}</span>
                <span className="stat-label">horas trabajadas</span>
              </div>
              <div className="stat">
                <span className="stat-value">{formatHours(data.week.overtimeHours)}</span>
                <span className="stat-label">horas extra</span>
              </div>
            </div>
            <p className="hint">
              {formatDay(data.week.from)} → {formatDay(data.week.to)} · {offline ? "hasta la última conexión" : "turnos cerrados"}
            </p>
          </section>
        )}

        {data && (
          <section className="card">
            <div className="card-head">
              <h2 className="h3">Cambios de turno</h2>
              <button className="btn btn-ghost btn-sm" disabled={offline} title={offline ? "Necesitas conexión" : undefined} onClick={() => setChanging(true)}>
                Solicitar cambio
              </button>
            </div>
            {changeNote && (
              <div className="banner banner-ok" role="status">
                ✓ {changeNote}
              </div>
            )}
            <ShiftChangeList changes={data.shiftChanges ?? []} offline={offline} onChanged={retry} />
          </section>
        )}

        {changing && (
          <ShiftChangeForm
            onClose={() => setChanging(false)}
            onSent={() => {
              setChanging(false);
              setChangeNote("Tu solicitud se envió a RRHH.");
              void retry();
            }}
          />
        )}

        {(data || pending.length > 0) && (
          <section className="card">
            <h2 className="h3">Mis últimos marcajes</h2>
            <RecentList shifts={data?.recent ?? []} pending={pending} closingOpen={queue.some((p) => p.type === "out")} />
          </section>
        )}
      </main>
    </div>
  );
}

const CHANGE_STATUS: Record<ShiftChange["status"], { label: string; className: string }> = {
  pending: { label: "Pendiente", className: "st-warn" },
  approved: { label: "Aprobado", className: "st-in" },
  rejected: { label: "Rechazado", className: "st-absent" },
  cancelled: { label: "Cancelado", className: "st-none" },
};

function ShiftChangeList({ changes, offline, onChanged }: { changes: ShiftChange[]; offline: boolean; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!changes.length) return <p className="muted small">¿Necesitas otro horario o un día libre? Solicítalo a RRHH.</p>;

  async function cancel(id: string) {
    setBusy(id);
    setError(null);
    try {
      await api.cancelShiftChange(id);
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {error && <div className="banner banner-error">{error}</div>}
      <ul className="list">
        {changes.map((c) => (
          <li key={c.id} className="list-row">
            <div className="grow">
              <strong>{formatDay(c.workDate)}</strong> · {c.to ? `${c.to.start}–${c.to.end}` : "Día libre"}
              <span className={`badge ${CHANGE_STATUS[c.status].className}`}>{CHANGE_STATUS[c.status].label}</span>
              <div className="muted small">{c.status === "rejected" && c.decisionNote ? c.decisionNote : c.reason}</div>
            </div>
            {c.status === "pending" && !offline && (
              <button className="link-btn" disabled={busy === c.id} onClick={() => cancel(c.id)}>
                Cancelar
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function RecentList({ shifts, pending, closingOpen }: { shifts: Shift[]; pending: PendingRow[]; closingOpen: boolean }) {
  // Si una salida espera en cola, la fila abierta del servidor ya está representada arriba.
  const visible = closingOpen ? shifts.filter((s) => s.clockOut) : shifts;
  if (!visible.length && !pending.length) return <p className="muted">Aún no tienes marcajes en las últimas dos semanas.</p>;
  return (
    <ul className="list">
      {pending.map((p) => {
        const ref = p.clockIn ?? p.clockOut!;
        return (
          <li key={p.key} className="list-row">
            <div>
              <strong>{formatDay(localDateOf(ref))}</strong>
              <div className="muted small">
                {p.clockIn ? localTimeOf(p.clockIn) : "…"} → {p.clockOut ? localTimeOf(p.clockOut) : "sin salida"}
              </div>
            </div>
            <span className="badge badge-info">por enviar</span>
          </li>
        );
      })}
      {visible.map((s) => (
        <li key={s.id} className="list-row">
          <div>
            <strong>{formatDay(s.workDate)}</strong>
            <div className="muted small">
              {localTimeOf(s.clockIn)} → {s.clockOut ? localTimeOf(s.clockOut) : "sin salida"}
              {s.corrections.length > 0 && <span className="badge badge-info">corregido</span>}
              {s.needsReview && <span className="badge st-warn">en revisión</span>}
            </div>
          </div>
          <div className="right">{s.clockOut ? formatHM(s.minutes ? s.elapsedMin : Math.max(0, Math.floor((Date.parse(s.clockOut) - Date.parse(s.clockIn)) / 60_000))) : <span className="badge badge-warn">abierto</span>}</div>
        </li>
      ))}
    </ul>
  );
}
