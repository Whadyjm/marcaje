-- Marcaje: esquema inicial
--
-- Principio: el cliente NUNCA lee ni escribe tablas directamente. RLS está
-- activo sin políticas y se revocan permisos a anon/authenticated; solo el
-- backend (service_role) accede. La autorización vive en el backend.

create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- Empresas y usuarios
-- ---------------------------------------------------------------------------
create table public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(trim(name)) between 2 and 120),
  -- Código corto que el colaborador usa para iniciar sesión.
  code        text not null unique check (code ~ '^[A-Z0-9]{4,10}$'),
  created_at  timestamptz not null default now()
);

-- Administradores de RRHH (un usuario de Auth administra una empresa).
create table public.company_admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  company_id  uuid not null references public.companies (id) on delete cascade,
  name        text not null,
  email       text not null,
  created_at  timestamptz not null default now()
);
create index company_admins_company on public.company_admins (company_id);

-- Colaboradores. Se desactivan, nunca se borran (sus marcajes son historia de nómina).
create table public.employees (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  user_id     uuid unique references auth.users (id) on delete set null,
  name        text not null check (char_length(trim(name)) between 2 and 120),
  cedula      text not null check (cedula ~ '^[0-9]{5,10}$'),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (company_id, cedula)
);

-- ---------------------------------------------------------------------------
-- Turnos: una fila = una entrada y (opcionalmente) su salida.
-- ---------------------------------------------------------------------------
create table public.shifts (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  employee_id  uuid not null references public.employees (id) on delete cascade,
  clock_in     timestamptz not null,
  clock_out    timestamptz,
  source       text not null default 'app' check (source in ('app', 'manual')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint shifts_out_after_in check (clock_out is null or clock_out > clock_in),
  constraint shifts_max_24h check (clock_out is null or clock_out - clock_in <= interval '24 hours'),
  -- Un colaborador no puede tener dos turnos solapados (un turno abierto llega a +infinito).
  constraint shifts_no_overlap exclude using gist (
    employee_id with =,
    tstzrange(clock_in, coalesce(clock_out, 'infinity'::timestamptz)) with &&
  )
);
-- A lo sumo un turno abierto por colaborador: protege contra doble toque / reintentos.
create unique index shifts_one_open_per_employee on public.shifts (employee_id) where clock_out is null;
create index shifts_company_clock_in on public.shifts (company_id, clock_in);
create index shifts_employee_clock_in on public.shifts (employee_id, clock_in);

-- Bitácora de correcciones: inmutable, con motivo obligatorio.
create table public.shift_corrections (
  id                  uuid primary key default gen_random_uuid(),
  shift_id            uuid not null references public.shifts (id) on delete cascade,
  company_id          uuid not null references public.companies (id) on delete cascade,
  corrected_by        uuid not null references auth.users (id),
  corrected_by_name   text not null,
  reason              text not null check (char_length(trim(reason)) >= 5),
  previous_clock_in   timestamptz,          -- null cuando el turno se creó manualmente
  previous_clock_out  timestamptz,
  new_clock_in        timestamptz not null,
  new_clock_out       timestamptz,
  created_at          timestamptz not null default now()
);
create index shift_corrections_shift on public.shift_corrections (shift_id);

-- ---------------------------------------------------------------------------
-- Escrituras atómicas (turno + bitácora en una sola transacción).
-- La autorización se decide en el backend antes de llamarlas.
-- ---------------------------------------------------------------------------
create or replace function public.correct_shift(
  p_shift_id uuid,
  p_company_id uuid,
  p_clock_in timestamptz,
  p_clock_out timestamptz,
  p_reason text,
  p_user_id uuid,
  p_user_name text
) returns public.shifts
language plpgsql
set search_path = public
as $$
declare
  v_old public.shifts;
  v_new public.shifts;
begin
  select * into v_old from public.shifts
   where id = p_shift_id and company_id = p_company_id
   for update;
  if not found then
    raise exception 'shift_not_found' using errcode = 'P0002';
  end if;

  update public.shifts
     set clock_in = p_clock_in, clock_out = p_clock_out, updated_at = now()
   where id = p_shift_id
  returning * into v_new;

  insert into public.shift_corrections
    (shift_id, company_id, corrected_by, corrected_by_name, reason,
     previous_clock_in, previous_clock_out, new_clock_in, new_clock_out)
  values
    (p_shift_id, p_company_id, p_user_id, p_user_name, trim(p_reason),
     v_old.clock_in, v_old.clock_out, p_clock_in, p_clock_out);

  return v_new;
end;
$$;

create or replace function public.create_manual_shift(
  p_company_id uuid,
  p_employee_id uuid,
  p_clock_in timestamptz,
  p_clock_out timestamptz,
  p_reason text,
  p_user_id uuid,
  p_user_name text
) returns public.shifts
language plpgsql
set search_path = public
as $$
declare
  v_new public.shifts;
begin
  insert into public.shifts (company_id, employee_id, clock_in, clock_out, source)
  values (p_company_id, p_employee_id, p_clock_in, p_clock_out, 'manual')
  returning * into v_new;

  insert into public.shift_corrections
    (shift_id, company_id, corrected_by, corrected_by_name, reason,
     previous_clock_in, previous_clock_out, new_clock_in, new_clock_out)
  values
    (v_new.id, p_company_id, p_user_id, p_user_name, trim(p_reason),
     null, null, p_clock_in, p_clock_out);

  return v_new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cierre de acceso directo: solo service_role.
-- ---------------------------------------------------------------------------
alter table public.companies          enable row level security;
alter table public.company_admins     enable row level security;
alter table public.employees          enable row level security;
alter table public.shifts             enable row level security;
alter table public.shift_corrections  enable row level security;

revoke all on public.companies, public.company_admins, public.employees,
              public.shifts, public.shift_corrections
  from anon, authenticated;

revoke execute on function public.correct_shift(uuid, uuid, timestamptz, timestamptz, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.create_manual_shift(uuid, uuid, timestamptz, timestamptz, text, uuid, text) from public, anon, authenticated;
grant execute on function public.correct_shift(uuid, uuid, timestamptz, timestamptz, text, uuid, text) to service_role;
grant execute on function public.create_manual_shift(uuid, uuid, timestamptz, timestamptz, text, uuid, text) to service_role;
