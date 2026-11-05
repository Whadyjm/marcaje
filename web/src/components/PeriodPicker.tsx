import { fortnightOf, previousFortnight, previousWeek, weekOf, type Period } from "@domain/periods.ts";
import { todayInCaracas } from "@domain/time.ts";

export type { Period };

export function presets(): { key: string; label: string; period: Period }[] {
  const today = todayInCaracas();
  return [
    { key: "week", label: "Semana actual", period: weekOf(today) },
    { key: "prev-week", label: "Semana anterior", period: previousWeek(today) },
    { key: "fortnight", label: "Quincena actual", period: fortnightOf(today) },
    { key: "prev-fortnight", label: "Quincena anterior", period: previousFortnight(today) },
  ];
}

export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const list = presets();
  return (
    <div className="period-picker">
      <div className="chips">
        {list.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`chip${p.period.from === value.from && p.period.to === value.to ? " active" : ""}`}
            onClick={() => onChange(p.period)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="range">
        <input type="date" value={value.from} max={value.to} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} aria-label="Desde" />
        <span>→</span>
        <input type="date" value={value.to} min={value.from} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} aria-label="Hasta" />
      </div>
    </div>
  );
}
