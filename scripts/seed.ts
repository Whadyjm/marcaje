/**
 * Datos de demostración. Idempotente: borra y recrea las empresas EMPRESAA y EMPRESAB.
 * Uso: npm run seed   (lee SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY de .env)
 *
 * Empresa A
 *   - Ana Pérez: incluye EXACTAMENTE los dos turnos de ejemplo del enunciado
 *     (semana 2026-10-05 → 2026-10-11) y turnos diurnos recientes.
 *   - Luis Gómez: muchas horas extra → dispara la alerta semanal; está "dentro" hoy.
 *   - María Rodríguez: turnos nocturnos.
 *   - Carlos Méndez: dejó una entrada abierta ayer → "sin salida".
 * Empresa B: un administrador y un colaborador, para probar el aislamiento.
 */
import { createClient, type User } from "@supabase/supabase-js";
import ws from "ws";
import { employeeEmail } from "../supabase/functions/api/domain/identity.ts";
import { addDays, todayInCaracas } from "../supabase/functions/api/domain/time.ts";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env");
const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  // deno-lint-ignore no-explicit-any
  realtime: { transport: ws as any },
});

interface SeedEmployee {
  name: string;
  cedula: string;
  pin: string;
}
interface SeedCompany {
  name: string;
  code: string;
  admin: { name: string; email: string; password: string };
  employees: SeedEmployee[];
}

const COMPANIES: SeedCompany[] = [
  {
    name: "Panadería La Esquina",
    code: "EMPRESAA",
    admin: { name: "Rosa Herrera (RRHH)", email: "rrhh@empresa-a.test", password: "MarcajeA2026!" },
    employees: [
      { name: "Ana Pérez", cedula: "12345678", pin: "123456" },
      { name: "Luis Gómez", cedula: "20111222", pin: "222222" },
      { name: "María Rodríguez", cedula: "18555666", pin: "333333" },
      { name: "Carlos Méndez", cedula: "15999888", pin: "444444" },
    ],
  },
  {
    name: "Ferretería El Tornillo",
    code: "EMPRESAB",
    admin: { name: "Jorge Salas (RRHH)", email: "rrhh@empresa-b.test", password: "MarcajeB2026!" },
    employees: [{ name: "Pedro Castillo", cedula: "30123456", pin: "555555" }],
  },
];

const ccs = (date: string, time: string) => new Date(`${date}T${time}:00-04:00`).toISOString();
const dow = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = domingo

function must<T>(res: { data: T; error: unknown }, what: string): NonNullable<T> {
  if (res.error || res.data == null) throw new Error(`${what}: ${JSON.stringify(res.error)}`);
  return res.data as NonNullable<T>;
}

function userOf(res: { data: { user: User | null }; error: unknown }, what: string): User {
  if (res.error || !res.data.user) throw new Error(`${what}: ${JSON.stringify(res.error)}`);
  return res.data.user;
}

async function deleteUserByEmail(emails: Set<string>) {
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) if (u.email && emails.has(u.email)) await db.auth.admin.deleteUser(u.id);
    if (data.users.length < 1000) break;
  }
}

async function reset() {
  const codes = COMPANIES.map((c) => c.code);
  await db.from("companies").delete().in("code", codes);
  const emails = new Set<string>();
  for (const c of COMPANIES) {
    emails.add(c.admin.email);
    for (const e of c.employees) emails.add(employeeEmail(c.code, e.cedula));
  }
  await deleteUserByEmail(emails);
}

async function createCompany(c: SeedCompany) {
  const company = must(await db.from("companies").insert({ name: c.name, code: c.code }).select("id, code").single(), `empresa ${c.code}`);
  const adminUser = userOf(await db.auth.admin.createUser({ email: c.admin.email, password: c.admin.password, email_confirm: true, user_metadata: { name: c.admin.name, role: "admin" } }), `admin ${c.admin.email}`);
  must(await db.from("company_admins").insert({ user_id: adminUser.id, company_id: company.id, name: c.admin.name, email: c.admin.email }).select().single(), "company_admins");

  const employees: Record<string, string> = {};
  for (const e of c.employees) {
    const u = userOf(await db.auth.admin.createUser({ email: employeeEmail(c.code, e.cedula), password: e.pin, email_confirm: true, user_metadata: { name: e.name, role: "employee" } }), `usuario ${e.cedula}`);
    const row = must(
      await db.from("employees").insert({ company_id: company.id, user_id: u.id, name: e.name, cedula: e.cedula }).select("id").single(),
      `colaborador ${e.cedula}`,
    );
    employees[e.cedula] = row.id;
  }
  return { companyId: company.id, adminId: adminUser.id, employees };
}

async function insertShifts(companyId: string, employeeId: string, shifts: { in: string; out: string | null }[]) {
  if (!shifts.length) return [];
  const rows = shifts.map((s) => ({ company_id: companyId, employee_id: employeeId, clock_in: s.in, clock_out: s.out, source: "app" }));
  return must(await db.from("shifts").insert(rows).select("id, clock_in"), "turnos");
}

async function main() {
  console.log("Reiniciando datos de demo…");
  await reset();

  const now = new Date();
  const today = todayInCaracas(now);
  const yesterday = addDays(today, -1);
  const pastDays = Array.from({ length: 21 }, (_, i) => addDays(today, -21 + i)); // hasta ayer
  const weekdays = pastDays.filter((d) => dow(d) >= 1 && dow(d) <= 5);

  // ---- Empresa A ----
  const a = await createCompany(COMPANIES[0]);
  const [ana, luis, maria, carlos] = COMPANIES[0].employees.map((e) => a.employees[e.cedula]);

  // Ana: los dos ejemplos del enunciado + jornada 08:00–17:00 (1 h extra) los días hábiles recientes.
  await insertShifts(a.companyId, ana, [
    { in: ccs("2026-10-05", "06:00"), out: ccs("2026-10-05", "16:00") },
    { in: ccs("2026-10-06", "14:00"), out: ccs("2026-10-07", "00:30") },
    ...weekdays.filter((d) => d > "2026-10-11").map((d) => ({ in: ccs(d, "08:00"), out: ccs(d, "17:00") })),
  ]);

  // Luis: 07:00–19:30 lunes a sábado → 4,5 h extra diarias → alerta semanal. Hoy está dentro desde las 06:45.
  const luisShifts = await insertShifts(a.companyId, luis, [
    ...pastDays.filter((d) => dow(d) !== 0).map((d) => ({ in: ccs(d, "07:00"), out: ccs(d, "19:30") })),
    ...(now > new Date(ccs(today, "06:50")) ? [{ in: ccs(today, "06:45"), out: null }] : []),
  ]);

  // María: turno nocturno 22:00 → 06:30 de lunes a viernes.
  await insertShifts(
    a.companyId,
    maria,
    weekdays.filter((d) => d < yesterday).map((d) => ({ in: ccs(d, "22:00"), out: ccs(addDays(d, 1), "06:30") })),
  );

  // Carlos: 08:00–16:00 días hábiles; ayer marcó entrada y nunca salida.
  await insertShifts(a.companyId, carlos, [
    ...weekdays.filter((d) => d !== yesterday).map((d) => ({ in: ccs(d, "08:00"), out: ccs(d, "16:00") })),
    { in: ccs(yesterday, "08:00"), out: null },
  ]);

  // Una corrección de ejemplo: a Luis se le olvidó marcar a tiempo un día.
  const toCorrect = luisShifts.find((s) => s.clock_in === ccs(pastDays[pastDays.length - 2] ?? today, "07:00")) ?? luisShifts[0];
  if (toCorrect) {
    const day = new Date(new Date(toCorrect.clock_in).getTime() - 4 * 3_600_000).toISOString().slice(0, 10);
    must(
      await db.rpc("correct_shift", {
        p_shift_id: toCorrect.id,
        p_company_id: a.companyId,
        p_clock_in: ccs(day, "07:00"),
        p_clock_out: ccs(day, "18:00"),
        p_reason: "Marcó salida tarde por olvido; el supervisor confirma que salió a las 18:00.",
        p_user_id: a.adminId,
        p_user_name: COMPANIES[0].admin.name,
      }),
      "corrección",
    );
  }

  // Offline: un turno diferido normal (cuenta) y uno con la hora dudosa (espera a RRHH).
  const offlineDay = pastDays[pastDays.length - 3];
  await db.from("shifts").delete().eq("employee_id", maria).eq("clock_in", ccs(offlineDay, "22:00"));
  must(
    await db
      .from("shifts")
      .insert({ company_id: a.companyId, employee_id: maria, clock_in: ccs(offlineDay, "22:00"), clock_out: ccs(addDays(offlineDay, 1), "06:30"), source: "offline" })
      .select("id"),
    "turno diferido",
  );
  must(
    await db
      .from("shifts")
      .insert({ company_id: a.companyId, employee_id: ana, clock_in: ccs(pastDays[0], "06:00"), clock_out: ccs(pastDays[0], "07:30"), source: "offline", needs_review: true, review_reason: "El reloj del teléfono cambió" })
      .select("id"),
    "turno en revisión",
  );

  // María olvidó su PIN y lo solicitó desde el login.
  must(await db.from("pin_requests").insert({ company_id: a.companyId, employee_id: maria }).select("id"), "solicitud de PIN");

  // ---- Empresa B ----
  const b = await createCompany(COMPANIES[1]);
  const pedro = b.employees[COMPANIES[1].employees[0].cedula];
  await insertShifts(b.companyId, pedro, weekdays.map((d) => ({ in: ccs(d, "07:30"), out: ccs(d, "16:30") })));

  console.log("\nListo. Credenciales:");
  for (const c of COMPANIES) {
    console.log(`\n${c.name}  (código de empresa: ${c.code})`);
    console.log(`  RRHH:  ${c.admin.email} / ${c.admin.password}`);
    for (const e of c.employees) console.log(`  Colaborador: ${e.name} — cédula ${e.cedula} / PIN ${e.pin}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
