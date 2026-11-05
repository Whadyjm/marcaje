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
    create role anon; create role authenticated; create role service_role;`);
  for (const f of readdirSync(MIGRATIONS).sort()) await db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  await db.query(`insert into auth.users values ($1)`, [USER]);
  company = (await db.query<any>(`insert into public.companies(name,code) values ('Acme','ACME01') returning id`)).rows[0].id;
}, 120_000);

beforeEach(async () => {
  const ced = String(10000000 + ++seq);
  employee = (await db.query<any>(`insert into public.employees(company_id,name,cedula) values ($1,'Ana',$2) returning id`, [company, ced])).rows[0].id;
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
