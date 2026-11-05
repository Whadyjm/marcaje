/**
 * API de Marcaje. App Hono agnóstica al runtime:
 *   - producción: Supabase Edge Function (Deno) → index.ts
 *   - local:      Node → scripts/dev-server.ts
 *
 * Rutas (todas bajo /api):
 *   público      POST /register, GET /health
 *   cualquiera   GET  /session
 *   colaborador  GET  /me/today, POST /me/punches/sync
 *   RRHH         /admin/employees, /admin/day, /admin/shifts, /admin/review-queue,
 *                /admin/punch-conflicts, /admin/report(.csv)
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { adminOf, authenticate, employeeOf, requireRole, type AppEnv } from "./auth.ts";
import { periodCsv } from "./domain/csv.ts";
import { dayStatus, type DayStatus } from "./domain/day.ts";
import { resolvePunchTime } from "./domain/deferred.ts";
import { breakdownShift, minutesToHours } from "./domain/hours.ts";
import { EMPLOYEE_EMAIL_DOMAIN, employeeEmail, isValidCedula, normalizeCedula } from "./domain/identity.ts";
import { weekOf } from "./domain/periods.ts";
import { alertWindow, buildPeriodReport } from "./domain/report.ts";
import { addDays, daysBetweenInclusive, isValidDate, localDateOf, startOfLocalDay, todayInCaracas } from "./domain/time.ts";
import { dbError, HttpError, parse } from "./http.ts";

export interface AppConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  /** Orígenes permitidos separados por coma. Vacío = cualquiera (la API usa Bearer, no cookies). */
  allowedOrigins?: string;
  /** Reloj inyectable (tests). */
  now?: () => Date;
  /** Transporte WebSocket para Node < 22 (supabase-js lo exige al construir el cliente). */
  wsTransport?: unknown;
}

const MAX_PERIOD_DAYS = 62;
const MAX_SHIFT_MS = 24 * 3_600_000;
const CLOCK_SKEW_MS = 2 * 60_000;
const PAGE_SIZE = 1000;

// ---------------------------------------------------------------------------
// Tipos de filas y serialización
// ---------------------------------------------------------------------------
interface CorrectionRow {
  id: string;
  reason: string;
  corrected_by_name: string;
  previous_clock_in: string | null;
  previous_clock_out: string | null;
  new_clock_in: string;
  new_clock_out: string | null;
  created_at: string;
}

interface ShiftRow {
  id: string;
  employee_id: string;
  clock_in: string;
  clock_out: string | null;
  source: "app" | "manual" | "offline";
  needs_review: boolean;
  review_reason: string | null;
  created_at: string;
  updated_at: string;
  employees?: { name: string; cedula: string } | null;
  shift_corrections?: CorrectionRow[];
}

interface EmployeeRow {
  id: string;
  name: string;
  cedula: string;
  active: boolean;
  user_id: string | null;
  created_at: string;
}

const SHIFT_COLS = "id, employee_id, clock_in, clock_out, source, needs_review, review_reason, created_at, updated_at";
const SHIFT_FULL = `${SHIFT_COLS}, employees (name, cedula), shift_corrections (id, reason, corrected_by_name, previous_clock_in, previous_clock_out, new_clock_in, new_clock_out, created_at)`;
const EMPLOYEE_COLS = "id, name, cedula, active, user_id, created_at";

function serializeShift(r: ShiftRow, now: Date) {
  const closed = r.clock_out !== null;
  const b = closed ? breakdownShift(r.clock_in, r.clock_out!) : null;
  const corrections = (r.shift_corrections ?? [])
    .slice()
    .sort((a, z) => a.created_at.localeCompare(z.created_at))
    .map((c) => ({
      id: c.id,
      reason: c.reason,
      by: c.corrected_by_name,
      at: c.created_at,
      previous: { clockIn: c.previous_clock_in, clockOut: c.previous_clock_out },
      next: { clockIn: c.new_clock_in, clockOut: c.new_clock_out },
    }));
  return {
    id: r.id,
    employeeId: r.employee_id,
    employee: r.employees ?? undefined,
    clockIn: r.clock_in,
    clockOut: r.clock_out,
    workDate: localDateOf(r.clock_in),
    source: r.source,
    needsReview: r.needs_review,
    reviewReason: r.review_reason,
    /** Minutos del turno. Para turnos abiertos, minutos transcurridos hasta ahora (informativo). */
    minutes: b ?? null,
    elapsedMin: closed ? b!.totalMin : Math.max(0, Math.floor((now.getTime() - Date.parse(r.clock_in)) / 60_000)),
    corrections,
  };
}

function serializeEmployee(e: EmployeeRow) {
  return { id: e.id, name: e.name, cedula: e.cedula, active: e.active, hasLogin: e.user_id !== null, createdAt: e.created_at };
}

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------
const instant = z
  .string()
  .refine((s) => s.includes("T") && !Number.isNaN(Date.parse(s)), "fecha y hora inválidas")
  .transform((s) => new Date(s).toISOString());

const reason = z
  .string({ required_error: "El motivo es obligatorio." })
  .trim()
  .min(5, "El motivo es obligatorio (mínimo 5 caracteres).")
  .max(500);

const dateParam = z.string().refine(isValidDate, "fecha inválida (YYYY-MM-DD)");

function validateShiftTimes(clockIn: string, clockOut: string | null, now: Date) {
  const inMs = Date.parse(clockIn);
  const limit = now.getTime() + CLOCK_SKEW_MS;
  if (inMs > limit) throw new HttpError(422, "La entrada no puede estar en el futuro.");
  if (clockOut === null) return;
  const outMs = Date.parse(clockOut);
  if (outMs > limit) throw new HttpError(422, "La salida no puede estar en el futuro.");
  if (outMs <= inMs) throw new HttpError(422, "La salida debe ser posterior a la entrada.");
  if (outMs - inMs > MAX_SHIFT_MS) throw new HttpError(422, "Un turno no puede durar más de 24 horas.");
}

function parsePeriod(query: Record<string, string | undefined>) {
  const { from, to } = parse(z.object({ from: dateParam, to: dateParam }), query);
  if (from > to) throw new HttpError(422, "La fecha inicial debe ser anterior o igual a la final.");
  if (daysBetweenInclusive(from, to) > MAX_PERIOD_DAYS) throw new HttpError(422, `El período no puede superar ${MAX_PERIOD_DAYS} días.`);
  return { from, to };
}

const SYNC_MAX_EVENTS = 200;
const syncSchema = z.object({
  deviceNow: z.number().finite(),
  events: z
    .array(
      z.object({
        clientId: z.string().uuid(),
        type: z.enum(["in", "out"]),
        deviceTime: z.number().finite(),
        offsetMs: z.number().finite().nullable(),
      }),
    )
    .min(1)
    .max(SYNC_MAX_EVENTS),
});

type PunchOutcome = { status: "applied" | "duplicate" | "conflict" | "rejected"; shift_id?: string; reason?: string; out?: PunchOutcome };

const REJECTED_MESSAGE: Record<string, string> = {
  overlap: "Ya tienes una entrada abierta. Marca tu salida primero.",
  no_open_shift: "No tienes una entrada abierta. Marca tu entrada primero.",
  before_entry: "La salida no puede ser anterior a la entrada.",
  too_long: "Tu entrada lleva más de 24 horas abierta. Pídele a RRHH que corrija el marcaje.",
};

const CONFLICT_LABEL: Record<string, string> = {
  overlap: "Se solapa con otro turno",
  no_open_shift: "No había una entrada abierta",
  before_entry: "La salida es anterior a la entrada",
  too_long: "El turno pasaría de 24 horas",
};

function generatePin(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}

function companyCodeFrom(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 4)
    .padEnd(4, "X");
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // sin 0/O ni 1/I
  const rnd = crypto.getRandomValues(new Uint8Array(2));
  return base + [...rnd].map((b) => alphabet[b % alphabet.length]).join("");
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
export function createApp(config: AppConfig) {
  const db: SupabaseClient = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    // deno-lint-ignore no-explicit-any
    ...(config.wsTransport ? { realtime: { transport: config.wsTransport as any } } : {}),
  });
  const now = config.now ?? (() => new Date());
  const origins = (config.allowedOrigins ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const app = new Hono<AppEnv>().basePath("/api");

  app.use(
    "*",
    cors({
      origin: origins.length ? origins : "*",
      allowHeaders: ["Authorization", "Content-Type", "apikey", "x-client-info"],
      allowMethods: ["GET", "POST", "PATCH", "OPTIONS"],
      exposeHeaders: ["Content-Disposition"],
      maxAge: 86_400,
    }),
  );

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message, code: err.code }, err.status);
    console.error("[api] error no controlado:", err);
    return c.json({ error: "Error interno del servidor." }, 500);
  });
  app.notFound((c) => c.json({ error: "Ruta no encontrada." }, 404));

  // ---- helpers de datos ----------------------------------------------------
  async function fetchShiftsRange(companyId: string, fromDate: string, toDate: string, select: string, employeeId?: string) {
    const out: ShiftRow[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      let q = db
        .from("shifts")
        .select(select)
        .eq("company_id", companyId)
        .gte("clock_in", startOfLocalDay(fromDate).toISOString())
        .lt("clock_in", startOfLocalDay(addDays(toDate, 1)).toISOString());
      if (employeeId) q = q.eq("employee_id", employeeId);
      const { data, error } = await q.order("clock_in", { ascending: true }).order("id").range(offset, offset + PAGE_SIZE - 1);
      if (error) throw dbError(error, "turnos");
      const rows = data as unknown as ShiftRow[];
      out.push(...rows);
      if (rows.length < PAGE_SIZE) break;
    }
    return out;
  }

  async function fetchEmployees(companyId: string, onlyActive = false) {
    let q = db.from("employees").select(EMPLOYEE_COLS).eq("company_id", companyId);
    if (onlyActive) q = q.eq("active", true);
    const { data, error } = await q.order("name");
    if (error) throw dbError(error, "colaboradores");
    return data as EmployeeRow[];
  }

  async function getEmployee(companyId: string, id: string) {
    const { data, error } = await db.from("employees").select(EMPLOYEE_COLS).eq("company_id", companyId).eq("id", id).maybeSingle();
    if (error) throw dbError(error, "colaboradores");
    if (!data) throw new HttpError(404, "Colaborador no encontrado.");
    return data as EmployeeRow;
  }

  async function loadReport(companyId: string, from: string, to: string) {
    const win = alertWindow(from, to);
    const [employees, shifts] = await Promise.all([fetchEmployees(companyId), fetchShiftsRange(companyId, win.from, win.to, SHIFT_COLS)]);
    return {
      shifts,
      report: buildPeriodReport({
        from,
        to,
        employees: employees.map((e) => ({ id: e.id, name: e.name, cedula: e.cedula, active: e.active })),
        shifts: shifts.map((s) => ({ id: s.id, employeeId: s.employee_id, clockIn: s.clock_in, clockOut: s.clock_out, needsReview: s.needs_review })),
      }),
    };
  }

  /** Cuántos marcajes esperan a RRHH, de cualquier fecha. */
  async function pendingCounts(companyId: string) {
    const [reviews, conflicts] = await Promise.all([
      db.from("shifts").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("needs_review", true),
      db.from("punch_conflicts").select("id", { count: "exact", head: true }).eq("company_id", companyId).is("resolved_at", null),
    ]);
    if (reviews.error) throw dbError(reviews.error, "revisión");
    if (conflicts.error) throw dbError(conflicts.error, "conflictos");
    return { review: reviews.count ?? 0, conflicts: conflicts.count ?? 0 };
  }

  // ---- público -------------------------------------------------------------
  app.get("/health", (c) => c.json({ ok: true, time: now().toISOString() }));

  const registerSchema = z.object({
    companyName: z.string().trim().min(2, "Nombre de empresa muy corto").max(120),
    adminName: z.string().trim().min(2, "Nombre muy corto").max(120),
    email: z.string().trim().toLowerCase().email("Correo inválido"),
    password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres").max(72),
  });

  app.post("/register", async (c) => {
    const body = parse(registerSchema, await c.req.json().catch(() => ({})));
    if (body.email.endsWith(`@${EMPLOYEE_EMAIL_DOMAIN}`)) throw new HttpError(422, "Correo inválido.");

    const { data: created, error } = await db.auth.admin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: true,
      user_metadata: { name: body.adminName, role: "admin" },
    });
    if (error || !created.user) {
      if (/already|registered|exists/i.test(error?.message ?? "")) throw new HttpError(409, "Ya existe una cuenta con ese correo.");
      console.error("[register] createUser:", error);
      throw new HttpError(500, "No se pudo crear la cuenta.");
    }
    const userId = created.user.id;

    let companyId: string | null = null;
    try {
      let company: { id: string; name: string; code: string } | null = null;
      for (let attempt = 0; attempt < 5 && !company; attempt++) {
        const { data, error: cErr } = await db
          .from("companies")
          .insert({ name: body.companyName, code: companyCodeFrom(body.companyName) })
          .select("id, name, code")
          .single();
        if (cErr && cErr.code !== "23505") throw dbError(cErr, "empresa");
        company = data;
      }
      if (!company) throw new HttpError(500, "No se pudo generar el código de empresa.");
      companyId = company.id;

      const { error: aErr } = await db.from("company_admins").insert({ user_id: userId, company_id: company.id, name: body.adminName, email: body.email });
      if (aErr) throw dbError(aErr, "administrador");
      return c.json({ company }, 201);
    } catch (e) {
      // Compensación: no dejamos usuarios ni empresas huérfanas.
      if (companyId) await db.from("companies").delete().eq("id", companyId);
      await db.auth.admin.deleteUser(userId);
      throw e;
    }
  });

  // ---- sesión --------------------------------------------------------------
  app.get("/session", authenticate(db), (c) => {
    const a = c.get("actor");
    return c.json(
      a.role === "admin"
        ? { role: a.role, name: a.name, email: a.email, company: a.company }
        : { role: a.role, name: a.name, cedula: a.cedula, employeeId: a.employeeId, company: a.company },
    );
  });

  // ---- colaborador ---------------------------------------------------------
  const me = new Hono<AppEnv>();
  me.use("*", authenticate(db), requireRole("employee"));

  me.get("/today", async (c) => {
    const a = employeeOf(c.get("actor"));
    const t = now();
    const today = todayInCaracas(t);
    const week = weekOf(today);
    const [{ data: open, error: oErr }, shifts] = await Promise.all([
      db.from("shifts").select(SHIFT_COLS).eq("employee_id", a.employeeId).is("clock_out", null).maybeSingle(),
      fetchShiftsRange(a.company.id, addDays(today, -13), today, SHIFT_COLS, a.employeeId),
    ]);
    if (oErr) throw dbError(oErr, "turnos");

    const weekShifts = shifts.filter((s) => s.clock_out && !s.needs_review && localDateOf(s.clock_in) >= week.from);
    const weekMinutes = weekShifts.reduce(
      (acc, s) => {
        const b = breakdownShift(s.clock_in, s.clock_out!);
        acc.total += b.totalMin;
        acc.overtime += b.overtimeDayMin + b.overtimeNightMin;
        return acc;
      },
      { total: 0, overtime: 0 },
    );

    return c.json({
      today,
      serverTime: t.toISOString(),
      openShift: open ? serializeShift(open as ShiftRow, t) : null,
      week: { ...week, totalHours: minutesToHours(weekMinutes.total), overtimeHours: minutesToHours(weekMinutes.overtime) },
      recent: shifts.reverse().map((s) => serializeShift(s, t)),
    });
  });

  /**
   * Recibe la cola de marcajes del teléfono, en orden. Es seguro reenviarla: cada
   * marcaje trae su ID y se aplica una sola vez. Toda la app marca por aquí, con o
   * sin conexión, para que exista un solo camino.
   */
  me.post("/punches/sync", async (c) => {
    const a = employeeOf(c.get("actor"));
    const body = parse(syncSchema, await c.req.json().catch(() => ({})));
    const serverNow = now();
    const results: { clientId: string; status: PunchOutcome["status"]; deferred: boolean; review: string | null; reason?: string; message?: string }[] = [];

    const report = (clientId: string, o: PunchOutcome, deferred: boolean, review: string | null) =>
      results.push({ clientId, status: o.status, deferred, review, reason: o.reason, message: o.status === "rejected" && o.reason ? REJECTED_MESSAGE[o.reason] : undefined });

    for (let i = 0; i < body.events.length; i++) {
      const e = body.events[i];
      const resolve = (ev: typeof e, index: number) =>
        resolvePunchTime({ deviceTime: ev.deviceTime, offsetMs: ev.offsetMs, deviceNow: body.deviceNow, serverNow: serverNow.getTime(), immediateAllowed: index === body.events.length - 1 });
      const inPunch = resolve(e, i);
      // Entrada y salida juntas en la cola: un turno completo trabajado sin señal.
      const next = e.type === "in" && body.events[i + 1]?.type === "out" ? body.events[i + 1] : null;
      const outPunch = next ? resolve(next, i + 1) : null;

      const { data, error } = await db.rpc("apply_punch", {
        p_company_id: a.company.id,
        p_employee_id: a.employeeId,
        p_client_id: e.clientId,
        p_type: e.type,
        p_at: inPunch.at,
        p_deferred: inPunch.deferred || !!outPunch?.deferred,
        p_review: inPunch.review,
        p_out_client_id: next?.clientId ?? null,
        p_out_at: outPunch?.at ?? null,
        p_out_review: outPunch?.review ?? null,
      });
      if (error) throw dbError(error, "marcaje"); // lo ya aplicado no se repite al reintentar

      const outcome = data as PunchOutcome;
      report(e.clientId, outcome, inPunch.deferred, inPunch.review);
      if (next && outPunch && outcome.out) {
        report(next.clientId, outcome.out, outPunch.deferred, outPunch.review);
        i++;
      }
    }
    return c.json({ serverTime: serverNow.toISOString(), results });
  });

  app.route("/me", me);

  // ---- RRHH ----------------------------------------------------------------
  const admin = new Hono<AppEnv>();
  admin.use("*", authenticate(db), requireRole("admin"));

  // Colaboradores
  admin.get("/employees", async (c) => {
    const a = adminOf(c.get("actor"));
    return c.json({ employees: (await fetchEmployees(a.company.id)).map(serializeEmployee) });
  });

  const newEmployeeSchema = z.object({
    name: z.string().trim().min(2, "Nombre muy corto").max(120),
    cedula: z.string().transform(normalizeCedula).refine(isValidCedula, "Cédula inválida (5 a 10 dígitos)"),
  });

  admin.post("/employees", async (c) => {
    const a = adminOf(c.get("actor"));
    const body = parse(newEmployeeSchema, await c.req.json().catch(() => ({})));

    const { data: existing } = await db.from("employees").select("id").eq("company_id", a.company.id).eq("cedula", body.cedula).maybeSingle();
    if (existing) throw new HttpError(409, "Ya existe un colaborador con esa cédula en la empresa.", "duplicate_cedula");

    const pin = generatePin();
    const { data: created, error } = await db.auth.admin.createUser({
      email: employeeEmail(a.company.code, body.cedula),
      password: pin,
      email_confirm: true,
      user_metadata: { name: body.name, role: "employee" },
    });
    if (error || !created.user) {
      console.error("[employees] createUser:", error);
      throw new HttpError(500, "No se pudo crear el acceso del colaborador.");
    }

    const { data, error: eErr } = await db
      .from("employees")
      .insert({ company_id: a.company.id, user_id: created.user.id, name: body.name, cedula: body.cedula })
      .select(EMPLOYEE_COLS)
      .single();
    if (eErr) {
      await db.auth.admin.deleteUser(created.user.id);
      throw dbError(eErr, "colaborador");
    }
    // El PIN se muestra una sola vez; no lo guardamos en claro en ningún lado.
    return c.json({ employee: serializeEmployee(data as EmployeeRow), pin, companyCode: a.company.code }, 201);
  });

  admin.patch("/employees/:id", async (c) => {
    const a = adminOf(c.get("actor"));
    const body = parse(
      z.object({ name: z.string().trim().min(2).max(120).optional(), active: z.boolean().optional() }),
      await c.req.json().catch(() => ({})),
    );
    const emp = await getEmployee(a.company.id, c.req.param("id"));
    const { data, error } = await db.from("employees").update(body).eq("id", emp.id).select(EMPLOYEE_COLS).single();
    if (error) throw dbError(error, "colaborador");
    if (body.active !== undefined && emp.user_id) {
      // Un colaborador desactivado no puede iniciar sesión (además de ser rechazado por resolveActor).
      await db.auth.admin.updateUserById(emp.user_id, { ban_duration: body.active ? "none" : "876000h" });
    }
    return c.json({ employee: serializeEmployee(data as EmployeeRow) });
  });

  admin.post("/employees/:id/reset-pin", async (c) => {
    const a = adminOf(c.get("actor"));
    const emp = await getEmployee(a.company.id, c.req.param("id"));
    if (!emp.user_id) throw new HttpError(409, "El colaborador no tiene acceso configurado.");
    const pin = generatePin();
    const { error } = await db.auth.admin.updateUserById(emp.user_id, { password: pin });
    if (error) throw new HttpError(500, "No se pudo restablecer el PIN.");
    return c.json({ pin, companyCode: a.company.code });
  });

  // Vista del día
  admin.get("/day", async (c) => {
    const a = adminOf(c.get("actor"));
    const t = now();
    const today = todayInCaracas(t);
    const date = c.req.query("date") ?? today;
    if (!isValidDate(date)) throw new HttpError(422, "Fecha inválida.");

    const week = weekOf(date);
    const [employees, shifts, openRes, { report }, pending] = await Promise.all([
      fetchEmployees(a.company.id, true),
      fetchShiftsRange(a.company.id, date, date, SHIFT_FULL),
      db.from("shifts").select(SHIFT_FULL).eq("company_id", a.company.id).is("clock_out", null),
      loadReport(a.company.id, week.from, week.to),
      pendingCounts(a.company.id),
    ]);
    if (openRes.error) throw dbError(openRes.error, "turnos");
    const open = openRes.data as unknown as ShiftRow[];

    const rows = employees.map((e) => {
      const ofDay = shifts.filter((s) => s.employee_id === e.id);
      const openShift = open.find((s) => s.employee_id === e.id) ?? null;
      const status: DayStatus = dayStatus({
        date,
        today,
        now: t,
        shiftsOfDay: ofDay.map((s) => ({ id: s.id, clockIn: s.clock_in, clockOut: s.clock_out })),
        openShift: openShift ? { id: openShift.id, clockIn: openShift.clock_in, clockOut: null } : null,
      });
      return {
        employee: serializeEmployee(e),
        status,
        shifts: ofDay.map((s) => serializeShift(s, t)),
        // Solo mostramos el turno abierto si es relevante para el día consultado.
        openShift: openShift && (date === today || localDateOf(openShift.clock_in) === date) ? serializeShift(openShift, t) : null,
      };
    });

    const counts = { dentro: 0, sin_salida: 0, salio: 0, sin_marcar: 0 } satisfies Record<DayStatus, number>;
    for (const r of rows) counts[r.status]++;

    return c.json({ date, today, serverTime: t.toISOString(), counts, rows, weekAlerts: report.alerts, week, pending });
  });

  // Marcajes y correcciones
  admin.get("/shifts", async (c) => {
    const a = adminOf(c.get("actor"));
    const { from, to } = parsePeriod(c.req.query());
    const employeeId = c.req.query("employeeId") || undefined;
    if (employeeId) await getEmployee(a.company.id, employeeId);
    const t = now();
    const shifts = await fetchShiftsRange(a.company.id, from, to, SHIFT_FULL, employeeId);
    return c.json({ from, to, shifts: shifts.reverse().map((s) => serializeShift(s, t)) });
  });

  admin.post("/shifts", async (c) => {
    const a = adminOf(c.get("actor"));
    const body = parse(
      z.object({ employeeId: z.string().uuid(), clockIn: instant, clockOut: instant.nullable().default(null), reason }),
      await c.req.json().catch(() => ({})),
    );
    const t = now();
    validateShiftTimes(body.clockIn, body.clockOut, t);
    await getEmployee(a.company.id, body.employeeId);

    const { data, error } = await db.rpc("create_manual_shift", {
      p_company_id: a.company.id,
      p_employee_id: body.employeeId,
      p_clock_in: body.clockIn,
      p_clock_out: body.clockOut,
      p_reason: body.reason,
      p_user_id: a.userId,
      p_user_name: a.name,
    });
    if (error) throw dbError(error, "turno");
    return c.json({ shift: await fetchShiftFull(a.company.id, (data as ShiftRow).id, t) }, 201);
  });

  admin.patch("/shifts/:id", async (c) => {
    const a = adminOf(c.get("actor"));
    const body = parse(z.object({ clockIn: instant, clockOut: instant.nullable(), reason }), await c.req.json().catch(() => ({})));
    const t = now();
    validateShiftTimes(body.clockIn, body.clockOut, t);

    const { error } = await db.rpc("correct_shift", {
      p_shift_id: c.req.param("id"),
      p_company_id: a.company.id, // la función también filtra por empresa
      p_clock_in: body.clockIn,
      p_clock_out: body.clockOut,
      p_reason: body.reason,
      p_user_id: a.userId,
      p_user_name: a.name,
    });
    if (error) throw dbError(error, "corrección");
    return c.json({ shift: await fetchShiftFull(a.company.id, c.req.param("id"), t) });
  });

  async function fetchShiftFull(companyId: string, id: string, t: Date) {
    const { data, error } = await db.from("shifts").select(SHIFT_FULL).eq("company_id", companyId).eq("id", id).maybeSingle();
    if (error) throw dbError(error, "turno");
    if (!data) throw new HttpError(404, "Turno no encontrado.");
    return serializeShift(data as unknown as ShiftRow, t);
  }

  // Marcajes diferidos que esperan a RRHH
  admin.get("/review-queue", async (c) => {
    const a = adminOf(c.get("actor"));
    const t = now();
    const [shiftsRes, conflictsRes] = await Promise.all([
      db.from("shifts").select(SHIFT_FULL).eq("company_id", a.company.id).eq("needs_review", true).order("clock_in", { ascending: false }).limit(200),
      db
        .from("punch_conflicts")
        .select("id, employee_id, type, occurred_at, reason, created_at, employees (name, cedula)")
        .eq("company_id", a.company.id)
        .is("resolved_at", null)
        .order("occurred_at", { ascending: false })
        .limit(200),
    ]);
    if (shiftsRes.error) throw dbError(shiftsRes.error, "revisión");
    if (conflictsRes.error) throw dbError(conflictsRes.error, "conflictos");
    const conflicts = conflictsRes.data as unknown as { id: string; employee_id: string; type: "in" | "out"; occurred_at: string; reason: string; employees: { name: string; cedula: string } | null }[];
    return c.json({
      shifts: (shiftsRes.data as unknown as ShiftRow[]).map((s) => serializeShift(s, t)),
      conflicts: conflicts.map((x) => ({
        id: x.id,
        employeeId: x.employee_id,
        employee: x.employees,
        type: x.type,
        occurredAt: x.occurred_at,
        reason: CONFLICT_LABEL[x.reason] ?? x.reason,
      })),
    });
  });

  admin.post("/punch-conflicts/:id/dismiss", async (c) => {
    const a = adminOf(c.get("actor"));
    const { data, error } = await db
      .from("punch_conflicts")
      .update({ resolved_at: now().toISOString(), resolved_by: a.userId })
      .eq("company_id", a.company.id) // aislamiento entre empresas
      .eq("id", c.req.param("id"))
      .is("resolved_at", null)
      .select("id")
      .maybeSingle();
    if (error) throw dbError(error, "conflicto");
    if (!data) throw new HttpError(404, "Marcaje no encontrado.");
    return c.json({ ok: true });
  });

  // Período
  admin.get("/report", async (c) => {
    const a = adminOf(c.get("actor"));
    const { from, to } = parsePeriod(c.req.query());
    const [{ report, shifts }, { data: lastExport, error }] = await Promise.all([
      loadReport(a.company.id, from, to),
      db
        .from("period_exports")
        .select("period_from, period_to, exported_at")
        .eq("company_id", a.company.id)
        .lte("period_from", to)
        .gte("period_to", from)
        .order("exported_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (error) throw dbError(error, "exportaciones");
    // Lo que cambió después de exportar (marcajes diferidos, correcciones) ya no coincide con lo enviado a nómina.
    const changedSinceExport = lastExport
      ? shifts.filter((s) => {
          const day = localDateOf(s.clock_in);
          return day >= from && day <= to && day >= lastExport.period_from && day <= lastExport.period_to && Date.parse(s.updated_at) > Date.parse(lastExport.exported_at);
        }).length
      : 0;
    return c.json({ ...report, lastExportAt: lastExport?.exported_at ?? null, changedSinceExport });
  });

  admin.get("/report.csv", async (c) => {
    const a = adminOf(c.get("actor"));
    const { from, to } = parsePeriod(c.req.query());
    const { report } = await loadReport(a.company.id, from, to);
    const csv = periodCsv(report);
    const { error: logErr } = await db.from("period_exports").insert({ company_id: a.company.id, period_from: from, period_to: to, exported_by: a.userId });
    if (logErr) console.error("[export] no se pudo registrar:", logErr); // no impide descargar
    return c.body(csv, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="marcaje_${a.company.code}_${from}_${to}.csv"`,
    });
  });

  app.route("/admin", admin);

  return app;
}
