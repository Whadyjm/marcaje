import { useEffect, useState } from "react";
import { InstallHint } from "../components/InstallHint";
import { Logo } from "../components/Logo";
import { LogoutButton } from "../components/LogoutButton";
import { Spinner } from "../components/ui";
import type { Shift } from "../lib/api";
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
  const { today: data, queue, open, offline, loading, locked, notice, punch } = usePunches(session!.user.id);
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

              {open ? (
                <button className="punch-btn punch-out" onClick={() => punch("out")} disabled={locked}>
                  Marcar salida
                </button>
              ) : (
                <button className="punch-btn punch-in" onClick={() => punch("in")} disabled={locked}>
                  Marcar entrada
                </button>
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
