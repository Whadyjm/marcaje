import { addDays, todayInCaracas } from "@domain/time.ts";
import { useState } from "react";
import { api } from "../lib/api";
import { hasReason, SHIFT_TEMPLATES, toggleReason } from "../lib/shiftForm";
import { ErrorBanner, Modal } from "./ui";

const REASONS = ["Cita médica", "Asunto familiar", "Estudios", "Acordado con un compañero"];

/** El colaborador pide otro horario, o el día libre, para una fecha. RRHH decide. */
export function ShiftChangeForm({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const today = todayInCaracas();
  const [date, setDate] = useState(addDays(today, 1));
  const [dayOff, setDayOff] = useState(false);
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("17:00");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!dayOff && start === end) return setError("La entrada y la salida no pueden ser a la misma hora.");
    if (reason.trim().length < 5) return setError("Indica el motivo: toca una opción o escríbelo.");
    setBusy(true);
    setError(null);
    try {
      await api.requestShiftChange({ workDate: date, to: dayOff ? null : { start, end }, reason: reason.trim() });
      onSent();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Solicitar cambio de turno"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy} aria-busy={busy}>
            {busy && <span className="btn-spinner" aria-hidden />}
            {busy ? "Enviando…" : "Enviar a RRHH"}
          </button>
        </>
      }
    >
      <div className="form">
        <label>
          Día
          <input type="date" value={date} min={today} max={addDays(today, 90)} onChange={(e) => setDate(e.target.value)} />
        </label>

        <div className="field">
          <span className="field-label">Turno que necesitas</span>
          <div className="chips">
            {SHIFT_TEMPLATES.map((t) => (
              <button
                key={t.label}
                type="button"
                className={`chip chip-sm${!dayOff && start === t.in && end === t.out ? " active" : ""}`}
                onClick={() => {
                  setDayOff(false);
                  setStart(t.in);
                  setEnd(t.out);
                }}
              >
                {t.label} <span className="chip-note">{t.in}–{t.out}</span>
              </button>
            ))}
            <button type="button" aria-pressed={dayOff} className={`chip chip-sm${dayOff ? " active" : ""}`} onClick={() => setDayOff(true)}>
              Día libre
            </button>
          </div>
        </div>

        {!dayOff && (
          <div className="row2-even">
            <label>
              Entrada
              <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label>
              Salida
              <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
          </div>
        )}

        <div className="field">
          <span className="field-label">
            Motivo <span className="req">obligatorio</span>
          </span>
          <div className="chips">
            {REASONS.map((r) => (
              <button key={r} type="button" aria-pressed={hasReason(reason, r)} className={`chip chip-sm${hasReason(reason, r) ? " active" : ""}`} onClick={() => {
                  setReason(toggleReason(reason, r));
                  setError(null);
                }}>
                {r}
              </button>
            ))}
          </div>
          <textarea
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setError(null);
            }}
            rows={2}
            maxLength={300} placeholder="Toca una opción o escribe el motivo" aria-label="Motivo" />
        </div>

        <ErrorBanner error={error} />
      </div>
    </Modal>
  );
}
