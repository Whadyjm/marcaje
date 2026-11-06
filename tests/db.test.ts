/**
 * Las garantías que viven en SQL, probadas contra Postgres real (PGlite, en
 * memoria): reenviar no duplica, un diferido nunca pisa datos, cada corrección
 * deja rastro. Corre las migraciones reales del repo.
 */
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const MIGRATIONS = join(__dirname, "../supabase/migrations");
const USER = "11111111-1111-1111-1111-111111111111";
let db: PGlite;
let company: string;
let employee: string;
let seq = 0;

const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
const at = (time: string, day = "2026-10-05") => `${day}T${time}:00-04:00`;

async function punch(a: { id?: string; type: "in" | "out"; at: string; deferred?: boolean; review?: string; outId?: string; outAt?: string }) {
  const r = await db.query<{ r: any }>(`select public.apply_punch($1,$2,$3,$4,$5,$6,$7,$8,$9,null) as r`, [
    company,
    employee,
    a.id ?? uuid(),
    a.type,
    a.at,
    a.deferred ?? true,
    a.review ?? null,
    a.outId ?? null,
    a.outAt ?? null,
  ]);
  return r.rows[0].r;
}
const shifts = async () => (await db.query<any>(`select * from public.shifts where employee_id=$1 order by clock_in`, [employee])).rows;
const conflicts = async () => (await db.query<any>(`select * from public.punch_conflicts where employee_id=$1`, [employee])).rows;

beforeAll(async () => {
  db = new PGlite({ extensions: { btree_gist } });
  await db.exec(`create schema auth; create schema extensions; create table auth.users(id uuid primary key);
    create role anon; create role authenticated; create role service_role; create role supabase_auth_admin;`);
  for (const f of readdirSync(MIGRATIONS).sort()) await db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  await db.query(`insert into auth.users values ($1)`, [USER]);
  company = (await db.query<any>(`insert into public.companies(name,code) values ('Acme','ACME01') returning id`)).rows[0].id;
}, 120_000);

beforeEach(async () => {
  const ced = String(10000000 + ++seq);
  employee = (await db.query<any>(`insert into public.employees(company_id,name,cedula) values ($1,'Ana',$2) returning id`, [company, ced])).rows[0].id;
});

describe("bloqueo del PIN", () => {
  const begin = async (key: string) => (await db.query<{ r: any }>(`select public.pin_attempt_begin($1) as r`, [key])).rows[0].r;
  const clear = (key: string) => db.query(`select public.pin_attempt_clear($1)`, [key]);

  it("admite 5 intentos y luego bloquea", async () => {
    const key = `k${++seq}`;
    for (const remaining of [4, 3, 2, 1, 0]) expect(await begin(key)).toEqual({ allowed: true, remaining });
    const blocked = await begin(key);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retry_after).toBeGreaterThan(890);
    expect(blocked.retry_after).toBeLessThanOrEqual(900);
  });

  it("entrar bien o recibir un PIN nuevo reinicia el contador", async () => {
    const key = `k${++seq}`;
    for (let i = 0; i < 5; i++) await begin(key);
    await clear(key);
    expect(await begin(key)).toEqual({ allowed: true, remaining: 4 });
  });

  it("pasados 15 min sin bloqueo, la ventana vuelve a empezar", async () => {
    const key = `k${++seq}`;
    for (let i = 0; i < 4; i++) await begin(key);
    await db.query(`update public.pin_attempts set window_start = now() - interval '16 minutes' where key = $1`, [key]);
    expect(await begin(key)).toEqual({ allowed: true, remaining: 4 });
  });

  it("terminado el bloqueo se puede intentar de nuevo", async () => {
    const key = `k${++seq}`;
    for (let i = 0; i < 5; i++) await begin(key);
    await db.query(`update public.pin_attempts set locked_until = now() - interval '1 second' where key = $1`, [key]);
    expect(await begin(key)).toEqual({ allowed: true, remaining: 4 });
  });

  it("cada cuenta lleva su propio contador", async () => {
    const a = `k${++seq}`;
    const b = `k${++seq}`;
    for (let i = 0; i < 5; i++) await begin(a);
    expect((await begin(b)).allowed).toBe(true);
  });
});

describe("cambios de turno", () => {
  const request = (date = "2026-10-20") => db.query(`insert into public.shift_change_requests(company_id, employee_id, work_date, to_start, to_end, reason) values ($1,$2,$3,'14:00','22:00','Cita médica')`, [company, employee, date]);

  it("una sola pendiente por persona y fecha; resuelta, puede pedir otra", async () => {
    await request();
    await expect(request()).rejects.toMatchObject({ code: "23505" });
    await expect(request("2026-10-21")).resolves.toBeTruthy();
    await db.query(`update public.shift_change_requests set status='rejected' where employee_id=$1 and work_date='2026-10-20'`, [employee]);
    await expect(request()).resolves.toBeTruthy();
  });

  it("exige motivo y horas completas", async () => {
    await expect(db.query(`insert into public.shift_change_requests(company_id, employee_id, work_date, reason) values ($1,$2,'2026-10-20','  ')`, [company, employee])).rejects.toMatchObject({ code: "23514" });
    await expect(db.query(`insert into public.shift_change_requests(company_id, employee_id, work_date, to_start, reason) values ($1,$2,'2026-10-20','08:00','Cita médica')`, [company, employee])).rejects.toMatchObject({ code: "23514" });
  });
});

describe("horarios", () => {
  it("una versión por colaborador y fecha", async () => {
    const insert = () => db.query(`insert into public.employee_schedules(employee_id, company_id, effective_from, week) values ($1,$2,'2026-10-01','{}')`, [employee, company]);
    await insert();
    await expect(insert()).rejects.toMatchObject({ code: "23505" });
  });

  it("la tolerancia tiene límites", async () => {
    await expect(db.query(`update public.companies set late_tolerance_min = 500 where id = $1`, [company])).rejects.toMatchObject({ code: "23514" });
  });
});

describe("solicitudes de PIN", () => {
  const request = () => db.query(`insert into public.pin_requests(company_id, employee_id) values ($1,$2)`, [company, employee]);

  it("solo admite una pendiente por colaborador; resuelta, puede pedir otra", async () => {
    await request();
    await expect(request()).rejects.toMatchObject({ code: "23505" });
    await db.query(`update public.pin_requests set resolved_at = now() where employee_id = $1`, [employee]);
    await expect(request()).resolves.toBeTruthy();
  });
});

describe("apply_punch", () => {
  it("entrada y salida en línea forman un turno", async () => {
    expect((await punch({ type: "in", at: at("08:00"), deferred: false })).status).toBe("applied");
    expect((await punch({ type: "out", at: at("16:00"), deferred: false })).status).toBe("applied");
    const [s] = await shifts();
    expect(s.source).toBe("app");
    expect(s.clock_out).not.toBeNull();
  });

  it("reenviar el mismo marcaje no lo duplica", async () => {
    const id = uuid();
    const first = await punch({ id, type: "in", at: at("08:00") });
    const again = await punch({ id, type: "in", at: at("08:05") });
    expect(again).toEqual({ status: "duplicate", shift_id: first.shift_id });
    expect(await shifts()).toHaveLength(1);
  });

  it("un marcaje en línea rechazado se informa y no queda como conflicto", async () => {
    await punch({ type: "in", at: at("08:00"), deferred: false });
    expect(await punch({ type: "in", at: at("09:00"), deferred: false })).toEqual({ status: "rejected", reason: "overlap" });
    expect(await conflicts()).toHaveLength(0);
  });

  it("un diferido que choca queda para RRHH y no pisa el turno existente", async () => {
    await punch({ type: "in", at: at("08:00"), deferred: false });
    await punch({ type: "out", at: at("16:00"), deferred: false });
    const before = await shifts();
    const id = uuid();
    expect(await punch({ id, type: "in", at: at("10:00") })).toEqual({ status: "conflict", reason: "overlap" });
    expect(await shifts()).toEqual(before);
    expect(await conflicts()).toHaveLength(1);
    // Reenviarlo tampoco duplica el conflicto.
    expect(await punch({ id, type: "in", at: at("10:00") })).toEqual({ status: "conflict", reason: "overlap" });
    expect(await conflicts()).toHaveLength(1);
  });

  it("una salida diferida sin entrada abierta queda para RRHH", async () => {
    expect(await punch({ type: "out", at: at("16:00") })).toEqual({ status: "conflict", reason: "no_open_shift" });
  });

  it("no cierra con salida anterior a la entrada ni con más de 24 h", async () => {
    await punch({ type: "in", at: at("08:00"), deferred: false });
    expect((await punch({ type: "out", at: at("07:00") })).reason).toBe("before_entry");
    expect((await punch({ type: "out", at: at("09:00", "2026-10-06") })).reason).toBe("too_long");
    expect((await shifts())[0].clock_out).toBeNull();
  });

  it("un turno completo sin señal entra aunque ya exista un turno posterior", async () => {
    await punch({ type: "in", at: at("08:00", "2026-10-07"), deferred: false });
    const r = await punch({ type: "in", at: at("08:00"), outId: uuid(), outAt: at("16:00") });
    expect(r.status).toBe("applied");
    expect(r.out.status).toBe("applied");
    expect((await shifts()).map((s) => s.source)).toEqual(["offline", "app"]);
  });

  it("par reenviado: si la entrada ya llegó sola, solo aplica la salida", async () => {
    const inId = uuid();
    const outId = uuid();
    await punch({ id: inId, type: "in", at: at("08:00") });
    const r = await punch({ id: inId, type: "in", at: at("08:00"), outId, outAt: at("16:00") });
    expect(r.status).toBe("duplicate");
    expect(r.out.status).toBe("applied");
    expect(await shifts()).toHaveLength(1);
    const again = await punch({ id: inId, type: "in", at: at("08:00"), outId, outAt: at("16:00") });
    expect(again.out.status).toBe("duplicate");
  });

  it("par que choca: ambos marcajes quedan para RRHH", async () => {
    await punch({ type: "in", at: at("07:00"), deferred: false });
    await punch({ type: "out", at: at("20:00"), deferred: false });
    const r = await punch({ type: "in", at: at("08:00"), outId: uuid(), outAt: at("16:00") });
    expect(r.status).toBe("conflict");
    expect(r.out.status).toBe("conflict");
    expect(await conflicts()).toHaveLength(2);
  });

  it("guarda la revisión, y corregir el turno la resuelve dejando rastro", async () => {
    const r = await punch({ type: "in", at: at("08:00"), review: "El reloj del teléfono cambió" });
    let [s] = await shifts();
    expect(s.needs_review).toBe(true);
    expect(s.review_reason).toBe("El reloj del teléfono cambió");
    await db.query(`select public.correct_shift($1,$2,$3,$4,'Hora confirmada',$5,'RRHH')`, [r.shift_id, company, at("08:00"), at("16:00"), USER]);
    [s] = await shifts();
    expect(s.needs_review).toBe(false);
    expect(s.review_reason).toBeNull();
    const log = await db.query(`select * from public.shift_corrections where shift_id=$1`, [r.shift_id]);
    expect(log.rows).toHaveLength(1);
  });
});

describe("endurecimiento de seguridad", () => {
  const hook = async (valid: boolean) =>
    (await db.query<{ r: any }>(`select public.hook_password_verification_attempt(jsonb_build_object('user_id',$1::text,'valid',$2::boolean)) as r`, [USER, valid])).rows[0].r;

  it("bloquea la cuenta tras 5 PIN errados, incluso si luego acierta", async () => {
    await db.query(`delete from public.auth_attempts`);
    for (let i = 0; i < 5; i++) expect((await hook(false)).decision).toBe("continue");
    expect((await hook(true)).decision).toBe("reject");
    expect((await hook(false)).decision).toBe("reject");
  });

  it("un acierto antes del límite reinicia el contador", async () => {
    await db.query(`delete from public.auth_attempts`);
    for (let i = 0; i < 4; i++) await hook(false);
    expect((await hook(true)).decision).toBe("continue");
    for (let i = 0; i < 4; i++) await hook(false);
    expect((await hook(true)).decision).toBe("continue");
  });

  it("el bloqueo expira", async () => {
    await db.query(`delete from public.auth_attempts`);
    for (let i = 0; i < 5; i++) await hook(false);
    await db.query(`update public.auth_attempts set locked_until = now() - interval '1 second'`);
    expect((await hook(true)).decision).toBe("continue");
  });

  it("el rate limit corta al pasar el máximo y se reinicia con la ventana", async () => {
    const hit = async (k: string) => (await db.query<{ r: boolean }>(`select public.rate_limit_hit($1, 3, 60) as r`, [k])).rows[0].r;
    expect([await hit("a"), await hit("a"), await hit("a"), await hit("a")]).toEqual([true, true, true, false]);
    expect(await hit("b")).toBe(true); // otra clave no se ve afectada
    await db.query(`update public.rate_limits set window_start = now() - interval '2 minutes' where key = 'a'`);
    expect(await hit("a")).toBe(true);
  });

  it("anon y authenticated no pueden tocar las tablas ni las funciones de seguridad", async () => {
    const { rows } = await db.query<{ t: string }>(`
      select table_name t from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon','authenticated')`);
    expect(rows).toEqual([]);
    const fn = await db.query<{ ok: boolean }>(`select has_function_privilege('anon','public.rate_limit_hit(text,int,int)','execute') as ok`);
    expect(fn.rows[0].ok).toBe(false);
  });
});
