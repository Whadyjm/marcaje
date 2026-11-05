import { breakdownShift } from "@domain/hours.ts";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { api, type Employee, type Shift } from "../lib/api";
import { formatDay, formatHM, formatInstant, localDateOf, localTimeOf, toInstant } from "../lib/format";
import { addToTime, hasReason, outDateFor, REASONS, SHIFT_TEMPLATES, toggleReason, type ShiftMode } from "../lib/shiftForm";
import { ErrorBanner, Modal } from "./ui";

const TITLES: Record<ShiftMode, string> = {
  new: "Registrar turno",
  complete: "Completar salida",
  correct: "Corregir marcaje",
};
const SAVE: Record<ShiftMode, string> = { new: "Registrar turno", complete: "Guardar salida", correct: "Guardar corrección" };
const SKEW_MS = 2 * 60_000;

/**
 * Registrar un turno, completar una salida olvidada o corregir un marcaje.
 * Atajos para no escribir: turnos habituales, duraciones y motivos frecuentes.
 * El motivo sigue siendo obligatorio y queda en la bitácora del turno.
 */
export function ShiftEditor({
  shift,
  employees,
  defaultEmployeeId,
  defaultDate,
  onClose,
  onSaved,
}: {
  shift?: Shift;
  employees?: Employee[];
  defaultEmployeeId?: string;
  defaultDate: string;
  onClose: () => void;
  onSaved: (s: Shift) => void;
}) {
  const mode: ShiftMode = !shift ? "new" : shift.clockOut ? "correct" : "complete";
  const [employeeId, setEmployeeId] = useState(shift?.employeeId ?? defaultEmployeeId ?? "");
  const [inDate, setInDate] = useState(shift ? localDateOf(shift.clockIn) : defaultDate);
  const [inTime, setInTime] = useState(shift ? localTimeOf(shift.clockIn) : "08:00");
  const nowTime = localTimeOf(new Date().toISOString());
  const [hasOut, setHasOut] = useState(true);
  const [outTime, setOutTime] = useState(() => {
    // Turno de hoy que aún no llega a las 17:00: propone la hora actual para no abrir con un error.
    if (!shift) return defaultDate === localDateOf(new Date().toISOString()) && nowTime < "17:00" && nowTime > "08:00" ? nowTime : "17:00";
    if (shift.clockOut) return localTimeOf(shift.clockOut);
    // Salida olvidada: propone 8 h de turno, sin pasarse de la hora actual.
    return localTimeOf(new Date(Math.min(Date.parse(shift.clockIn) + 8 * 3_600_000, Date.now())).toISOString());
  });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  const outDate = outDateFor(inDate, inTime, outTime);
  const clockIn = inDate && inTime ? toInstant(inDate, inTime) : "";
  const clockOut = hasOut && clockIn && outTime ? toInstant(outDate, outTime) : null;
  const nextDay = hasOut && outDate !== inDate;

  const problem = useMemo(() => {
    if (!clockIn || (hasOut && !clockOut)) return "Completa la fecha y las horas.";
    const limit = Date.now() + SKEW_MS;
    if (Date.parse(clockIn) > limit) return "La entrada no puede estar en el futuro.";
    if (clockOut && Date.parse(clockOut) > limit) return "La salida no puede estar en el futuro.";
    return null;
  }, [clockIn, clockOut, hasOut]);

  const preview = clockOut && !problem ? breakdownShift(clockIn, clockOut) : null;
  const canUseNow = clockIn && Date.now() - Date.parse(clockIn) > 0 && Date.now() - Date.parse(clockIn) <= 24 * 3_600_000;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (problem) return setError(problem);
    if (mode === "new" && !employeeId) return setError("Selecciona el colaborador.");
    if (reason.trim().length < 5) {
      setError("Indica el motivo: toca una opción o escríbelo.");
      reasonRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { shift: saved } =
        mode === "new"
          ? await api.createShift({ employeeId, clockIn, clockOut, reason: reason.trim() })
          : await api.correctShift(shift!.id, { clockIn, clockOut, reason: reason.trim() });
      onSaved(saved);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const candidates = employees?.filter((e) => e.active) ?? [];
  const name = shift?.employee?.name ?? employees?.find((e) => e.id === employeeId)?.name;

  return (
    <Modal
      title={`${TITLES[mode]}${name ? ` · ${name}` : ""}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} type="button">
            Cancelar
          </button>
          <button className="btn btn-primary" form="shift-editor" disabled={busy}>
            {busy ? "Guardando…" : SAVE[mode]}
          </button>
        </>
      }
    >
      <form id="shift-editor" className="form" onSubmit={submit}>
        {mode === "new" && candidates.length > 1 && (
          <label>
            Colaborador
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} required>
              <option value="">Selecciona…</option>
              {candidates.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} · {e.cedula}
                </option>
              ))}
            </select>
          </label>
        )}

        {shift && (
          <p className="muted small current">
            Registrado: {formatInstant(shift.clockIn)} → {shift.clockOut ? formatInstant(shift.clockOut) : "sin salida"}
          </p>
        )}

        {mode === "new" && (
          <div className="field">
            <span className="field-label">Turno habitual</span>
            <div className="chips">
              {SHIFT_TEMPLATES.map((t) => (
                <button
                  key={t.label}
                  type="button"
                  className={`chip${inTime === t.in && outTime === t.out ? " active" : ""}`}
                  onClick={() => {
                    setInTime(t.in);
                    setOutTime(t.out);
                    setHasOut(true);
                  }}
                >
                  {t.label} <span className="chip-note">{t.in}–{t.out}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="time-grid">
          <label>
            Día
            <input type="date" value={inDate} max={localDateOf(new Date().toISOString())} onChange={(e) => setInDate(e.target.value)} required />
          </label>
          <label>
            Entrada
            <input type="time" value={inTime} onChange={(e) => setInTime(e.target.value)} required />
          </label>
          <label className={hasOut ? "" : "is-off"}>
            Salida
            <input type="time" value={outTime} onChange={(e) => setOutTime(e.target.value)} disabled={!hasOut} required={hasOut} />
          </label>
        </div>

        {hasOut && (
          <div className="chips">
            {[8, 9, 10].map((h) => (
              <button key={h} type="button" className="chip chip-sm" onClick={() => setOutTime(addToTime(inTime, h * 60))}>
                {h} h de turno
              </button>
            ))}
            {canUseNow && (
              <button type="button" className="chip chip-sm" onClick={() => setOutTime(localTimeOf(new Date().toISOString()))}>
                Salió ahora
              </button>
            )}
          </div>
        )}

        <label className="check">
          <input type="checkbox" checked={!hasOut} onChange={(e) => setHasOut(!e.target.checked)} /> Sigue dentro, todavía sin salida
        </label>

        {problem ? (
          <div className="preview preview-bad">{problem}</div>
        ) : preview ? (
          <div className="preview">
            <div className="preview-head">
              <strong>{formatHM(preview.totalMin)}</strong>
              {nextDay && <span className="muted"> · termina el {formatDay(outDate)}</span>}
            </div>
            <dl className="preview-grid">
              <div>
                <dt>Extra diurna</dt>
                <dd>{formatHM(preview.overtimeDayMin)}</dd>
              </div>
              <div>
                <dt>Extra nocturna</dt>
                <dd>{formatHM(preview.overtimeNightMin)}</dd>
              </div>
              <div>
                <dt>Nocturna ord.</dt>
                <dd>{formatHM(preview.nightOrdinaryMin)}</dd>
              </div>
            </dl>
          </div>
        ) : null}

        <div className="field">
          <span className="field-label">
            Motivo <span className="req">obligatorio</span>
          </span>
          <div className="chips">
            {REASONS[mode].map((r) => (
              <button key={r} type="button" aria-pressed={hasReason(reason, r)} className={`chip chip-sm${hasReason(reason, r) ? " active" : ""}`} onClick={() => setReason(toggleReason(reason, r))}>
                {r}
              </button>
            ))}
          </div>
          <textarea ref={reasonRef} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Toca una opción o escribe el motivo" maxLength={500} aria-label="Motivo" />
        </div>

        <ErrorBanner error={error} />
        {shift && <CorrectionHistory shift={shift} />}
      </form>
    </Modal>
  );
}

export function CorrectionHistory({ shift }: { shift: Shift }) {
  if (!shift.corrections.length) return null;
  return (
    <ul className="history">
      {shift.corrections.map((c) => (
        <li key={c.id}>
          <div>
            <strong>{c.by}</strong> · {formatInstant(c.at)}
          </div>
          <div className="muted small">
            {c.previous.clockIn ? (
              <>
                {formatInstant(c.previous.clockIn)} → {c.previous.clockOut ? formatInstant(c.previous.clockOut) : "sin salida"}
              </>
            ) : (
              "Turno registrado por RRHH"
            )}{" "}
            ⇒ {formatInstant(c.next.clockIn)} → {c.next.clockOut ? formatInstant(c.next.clockOut) : "sin salida"}
          </div>
          <div className="reason">“{c.reason}”</div>
        </li>
      ))}
    </ul>
  );
}
