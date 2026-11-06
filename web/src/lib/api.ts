import type { Attendance, DaySchedule, WeekSchedule } from "@domain/schedule.ts";
import type { QueuedPunch } from "./punchQueue";
import { API_URL, supabase } from "./supabase";

/** Con mala señal una petición puede quedarse colgada: mejor fallar y reintentar. */
const REQUEST_TIMEOUT_MS = 30_000;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      method,
      headers: { ...(await authHeader()), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new ApiError(0, "No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiError(res.status, err.error ?? `Error ${res.status}`, err.code);
  }
  return res.json() as Promise<T>;
}

async function download(path: string, filename: string) {
  const res = await fetch(`${API_URL}/api${path}`, { headers: await authHeader() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiError(res.status, err.error ?? `Error ${res.status}`);
  }
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---- Tipos (espejo de las respuestas de la API) ---------------------------
export interface Company {
  id: string;
  name: string;
  code: string;
}

export type SessionInfo =
  | { role: "admin"; name: string; email: string; company: Company }
  | { role: "employee"; name: string; cedula: string; employeeId: string; company: Company };

export interface Employee {
  id: string;
  name: string;
  cedula: string;
  active: boolean;
  hasLogin: boolean;
  createdAt: string;
}

export interface ShiftMinutes {
  totalMin: number;
  ordinaryMin: number;
  nightOrdinaryMin: number;
  overtimeDayMin: number;
  overtimeNightMin: number;
}

export interface Correction {
  id: string;
  reason: string;
  by: string;
  at: string;
  previous: { clockIn: string | null; clockOut: string | null };
  next: { clockIn: string; clockOut: string | null };
}

export interface Shift {
  id: string;
  employeeId: string;
  employee?: { name: string; cedula: string };
  clockIn: string;
  clockOut: string | null;
  workDate: string;
  source: "app" | "manual" | "offline";
  needsReview: boolean;
  reviewReason: string | null;
  minutes: ShiftMinutes | null;
  elapsedMin: number;
  corrections: Correction[];
}

export type DayStatus = "dentro" | "sin_salida" | "salio" | "sin_marcar";

export interface WeekAlert {
  employeeId: string;
  name: string;
  weekStart: string;
  weekEnd: string;
  overtimeHours: number;
}

export interface DayView {
  date: string;
  today: string;
  serverTime: string;
  counts: Record<DayStatus, number>;
  rows: { employee: Employee; status: DayStatus; attendance: Attendance; shifts: Shift[]; openShift: Shift | null }[];
  weekAlerts: WeekAlert[];
  week: { from: string; to: string };
  pending: { review: number; conflicts: number };
}

export interface PeriodRow {
  employeeId: string;
  name: string;
  cedula: string;
  active: boolean;
  shiftCount: number;
  openShiftIds: string[];
  reviewShiftIds: string[];
  hours: { total: number; ordinary: number; overtimeDay: number; overtimeNight: number; nightShift: number };
  weeks: { weekStart: string; weekEnd: string; overtimeHours: number; alert: boolean }[];
  alert: boolean;
}

export interface PeriodReport {
  from: string;
  to: string;
  rows: PeriodRow[];
  alerts: WeekAlert[];
  openShifts: number;
  reviewShifts: number;
  lastExportAt: string | null;
  changedSinceExport: number;
}

export interface PunchResult {
  clientId: string;
  status: "applied" | "duplicate" | "conflict" | "rejected";
  deferred: boolean;
  review: string | null;
  reason?: string;
  message?: string;
}

export interface PinRequest {
  id: string;
  createdAt: string;
  employee: { id: string; name: string; cedula: string };
}

export interface PunchConflict {
  id: string;
  employeeId: string;
  employee: { name: string; cedula: string } | null;
  type: "in" | "out";
  occurredAt: string;
  reason: string;
}

export type { Attendance, WeekSchedule };

export type ExpectedToday = { kind: "none" } | { kind: "rest" } | ({ kind: "shift" } & DaySchedule);

export interface ShiftChange {
  id: string;
  employee?: { name: string; cedula: string };
  workDate: string;
  from: DaySchedule | null;
  to: DaySchedule | null;
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface EmployeeToday {
  today: string;
  /** Ausente en copias guardadas antes de existir los cambios de turno. */
  shiftChanges?: ShiftChange[];
  serverTime: string;
  /** Ausente en copias guardadas antes de existir los horarios. */
  expected?: ExpectedToday;
  openShift: Shift | null;
  week: { from: string; to: string; totalHours: number; overtimeHours: number };
  recent: Shift[];
}

const qs = (params: Record<string, string | undefined>) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();

export const api = {
  register: (body: { companyName: string; adminName: string; email: string; password: string }) =>
    request<{ company: Company }>("POST", "/register", body),
  session: () => request<SessionInfo>("GET", "/session"),
  employeeLogin: (body: { companyCode: string; cedula: string; pin: string }) => request<{ accessToken: string; refreshToken: string }>("POST", "/auth/employee-login", body),
  requestShiftChange: (body: { workDate: string; to: DaySchedule | null; reason: string }) => request<{ request: ShiftChange }>("POST", "/me/shift-changes", body),
  cancelShiftChange: (id: string) => request<{ ok: true }>("POST", `/me/shift-changes/${id}/cancel`),
  shiftChanges: () => request<{ requests: ShiftChange[] }>("GET", "/admin/shift-changes"),
  decideShiftChange: (id: string, body: { approve: boolean; note?: string }) => request<{ request: ShiftChange }>("POST", `/admin/shift-changes/${id}/decide`, body),
  requestPin: (body: { companyCode: string; cedula: string }) => request<{ ok: true }>("POST", "/pin-requests", body),

  // colaborador
  myToday: () => request<EmployeeToday>("GET", "/me/today"),
  syncPunches: (body: { deviceNow: number; events: QueuedPunch[] }) => request<{ serverTime: string; results: PunchResult[] }>("POST", "/me/punches/sync", body),

  // RRHH
  employees: () => request<{ employees: Employee[] }>("GET", "/admin/employees"),
  createEmployee: (body: { name: string; cedula: string }) =>
    request<{ employee: Employee; pin: string; companyCode: string }>("POST", "/admin/employees", body),
  updateEmployee: (id: string, body: { name?: string; active?: boolean }) =>
    request<{ employee: Employee }>("PATCH", `/admin/employees/${id}`, body),
  resetPin: (id: string) => request<{ pin: string; companyCode: string }>("POST", `/admin/employees/${id}/reset-pin`),
  day: (date?: string) => request<DayView>("GET", `/admin/day?${qs({ date })}`),
  shifts: (p: { from: string; to: string; employeeId?: string }) =>
    request<{ shifts: Shift[] }>("GET", `/admin/shifts?${qs(p)}`),
  createShift: (body: { employeeId: string; clockIn: string; clockOut: string | null; reason: string }) =>
    request<{ shift: Shift }>("POST", "/admin/shifts", body),
  correctShift: (id: string, body: { clockIn: string; clockOut: string | null; reason: string }) =>
    request<{ shift: Shift }>("PATCH", `/admin/shifts/${id}`, body),
  schedules: () => request<{ toleranceMin: number; schedules: { employeeId: string; week: WeekSchedule | null }[] }>("GET", "/admin/schedules"),
  saveSchedules: (body: { employeeIds: string[]; week: WeekSchedule | null }) => request<{ ok: true }>("POST", "/admin/schedules", body),
  saveTolerance: (lateToleranceMin: number) => request<{ toleranceMin: number }>("PATCH", "/admin/settings", { lateToleranceMin }),
  pinRequests: () => request<{ requests: PinRequest[] }>("GET", "/admin/pin-requests"),
  dismissPinRequest: (id: string) => request<{ ok: true }>("POST", `/admin/pin-requests/${id}/dismiss`),
  reviewQueue: () => request<{ shifts: Shift[]; conflicts: PunchConflict[] }>("GET", "/admin/review-queue"),
  dismissConflict: (id: string) => request<{ ok: true }>("POST", `/admin/punch-conflicts/${id}/dismiss`),
  report: (from: string, to: string) => request<PeriodReport>("GET", `/admin/report?${qs({ from, to })}`),
  downloadCsv: (from: string, to: string, code: string) =>
    download(`/admin/report.csv?${qs({ from, to })}`, `marcaje_${code}_${from}_${to}.csv`),
};
