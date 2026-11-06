import { WEEKDAYS, weekdayLabel, type Weekday, type WeekSchedule } from "@domain/schedule.ts";
import { useState } from "react";
import { api, type Employee } from "../lib/api";
import { SHIFT_TEMPLATES } from "../lib/shiftForm";
import { ErrorBanner, Modal } from "./ui";

type Day = { on: boolean; start: string; end: string };
type Days = Record<Weekday, Day>;

const DAY_SETS: { label: string; days: Weekday[] }[] = [
  { label: "Lun a Vie", days: ["1", "2", "3", "4", "5"] },
  { label: "Lun a Sáb", days: ["1", "2", "3", "4", "5", "6"] },
  { label: "Todos", days: [...WEEKDAYS] },
];

function initialDays(week: WeekSchedule | null): Days {
  const days = {} as Days;
  for (const d of WEEKDAYS) {
    const current = week?.[d];
    days[d] = current ? { on: true, ...current } : { on: !week && Number(d) <= 5, start: "08:00", end: "17:00" };
  }
  return days;
}

/** RRHH asigna el horario semanal a una persona o a varias a la vez. Rige desde hoy. */
export function ScheduleEditor({ employees, initial, onClose, onSaved }: { employees: Employee[]; initial: WeekSchedule | null; onClose: () => void; onSaved: () => void }) {
  const [days, setDays] = useState<Days>(() => initialDays(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setDay = (d: Weekday, patch: Partial<Day>) => setDays((all) => ({ ...all, [d]: { ...all[d], ...patch } }));
  const applyTimes = (start: string, end: string) => setDays((all) => Object.fromEntries(WEEKDAYS.map((d) => [d, { ...all[d], start, end }])) as Days);
  const applyDays = (selected: Weekday[]) => setDays((all) => Object.fromEntries(WEEKDAYS.map((d) => [d, { ...all[d], on: selected.includes(d) }])) as Days);

  const active = WEEKDAYS.filter((d) => days[d].on);
  const firstDay = days[active[0] ?? "1"];

  async function save(week: WeekSchedule | null) {
    setBusy(true);
    setError(null);
    try {
      await api.saveSchedules({ employeeIds: employees.map((e) => e.id), week });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function submit() {
    if (!active.length) return setError("Elige al menos un día, o usa “Quitar horario”.");
    if (active.some((d) => !days[d].start || !days[d].end)) return setError("Completa las horas de los días elegidos.");
    if (active.some((d) => days[d].start === days[d].end)) return setError("La entrada y la salida no pueden ser a la misma hora.");
    save(Object.fromEntries(active.map((d) => [d, { start: days[d].start, end: days[d].end }])));
  }

  const title = employees.length === 1 ? `Horario · ${employees[0].name}` : `Horario · ${employees.length} colaboradores`;

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          {initial && (
            <button className="btn btn-ghost schedule-remove" onClick={() => save(null)} disabled={busy}>
              Quitar horario
            </button>
          )}
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy} aria-busy={busy}>
            {busy && <span className="btn-spinner" aria-hidden />}
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </>
      }
    >
      <div className="form">
        {employees.length > 1 && <p className="muted small current">Reemplaza el horario de: {employees.map((e) => e.name).join(", ")}.</p>}

        <div className="field">
          <span className="field-label">Turno habitual</span>
          <div className="chips">
            {SHIFT_TEMPLATES.map((t) => (
              <button key={t.label} type="button" className={`chip${firstDay.start === t.in && firstDay.end === t.out ? " active" : ""}`} onClick={() => applyTimes(t.in, t.out)}>
                {t.label} <span className="chip-note">{t.in}–{t.out}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field-label">Días</span>
          <div className="chips">
            {DAY_SETS.map((s) => (
              <button key={s.label} type="button" className={`chip chip-sm${active.length === s.days.length && s.days.every((d) => days[d].on) ? " active" : ""}`} onClick={() => applyDays(s.days)}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <ul className="schedule-days">
          {WEEKDAYS.map((d) => {
            const day = days[d];
            return (
              <li key={d} className={day.on ? "" : "is-off"}>
                <label className="check">
                  <input type="checkbox" checked={day.on} onChange={(e) => setDay(d, { on: e.target.checked })} /> {weekdayLabel(d)}
                </label>
                {day.on ? (
                  <>
                    <input type="time" value={day.start} onChange={(e) => setDay(d, { start: e.target.value })} aria-label={`Entrada del ${weekdayLabel(d)}`} />
                    <input type="time" value={day.end} onChange={(e) => setDay(d, { end: e.target.value })} aria-label={`Salida del ${weekdayLabel(d)}`} />
                  </>
                ) : (
                  <span className="muted small schedule-rest">Descanso</span>
                )}
              </li>
            );
          })}
        </ul>

        <p className="hint">Rige desde hoy y no cambia lo que ya pasó. Solo genera avisos: las horas se siguen calculando con la entrada y la salida reales.</p>
        <ErrorBanner error={error} />
      </div>
    </Modal>
  );
}
