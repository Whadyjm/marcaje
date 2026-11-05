/** Períodos de nómina habituales: semana (lunes a domingo) y quincena (1–15, 16–fin de mes). */
import { addDays, weekStart } from "./time.ts";

export interface Period {
  from: string;
  to: string;
}

export function weekOf(date: string): Period {
  const from = weekStart(date);
  return { from, to: addDays(from, 6) };
}

export function fortnightOf(date: string): Period {
  const [y, m, d] = date.split("-").map(Number);
  const mm = String(m).padStart(2, "0");
  if (d <= 15) return { from: `${y}-${mm}-01`, to: `${y}-${mm}-15` };
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${y}-${mm}-16`, to: `${y}-${mm}-${lastDay}` };
}

export function previousWeek(date: string): Period {
  return weekOf(addDays(weekStart(date), -1));
}

export function previousFortnight(date: string): Period {
  return fortnightOf(addDays(fortnightOf(date).from, -1));
}
