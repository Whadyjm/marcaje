-- Marcaje offline-first.
--
-- El teléfono guarda cada marcaje en una cola local y lo envía al tener conexión.
-- Reglas: los diferidos cuentan de inmediato; solo los de hora dudosa o muy
-- atrasados quedan en revisión; un diferido nunca pisa lo que ya existe.

alter table public.shifts drop constraint shifts_source_check;
alter table public.shifts add constraint shifts_source_check check (source in ('app', 'manual', 'offline'));

alter table public.shifts
  -- ID generado por el teléfono: reenviar un marcaje no lo duplica.
  add column client_in_id  uuid,
  add column client_out_id uuid,
  -- En revisión: no se suma al período hasta que RRHH lo apruebe o corrija.
  add column needs_review  boolean not null default false,
  add column review_reason text;

create unique index shifts_client_in_id  on public.shifts (client_in_id)  where client_in_id  is not null;
create unique index shifts_client_out_id on public.shifts (client_out_id) where client_out_id is not null;
create index shifts_needs_review on public.shifts (company_id) where needs_review;

-- Marcajes diferidos que no se pudieron aplicar. Se conservan para RRHH: no se pierden ni pisan datos.
create table public.punch_conflicts (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  employee_id  uuid not null references public.employees (id) on delete cascade,
  client_id    uuid not null unique,
  type         text not null check (type in ('in', 'out')),
  occurred_at  timestamptz not null,
  reason       text not null check (reason in ('overlap', 'no_open_shift', 'before_entry', 'too_long')),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  resolved_by  uuid references auth.users (id) on delete set null
);
create index punch_conflicts_pending on public.punch_conflicts (company_id) where resolved_at is null;

-- Cuándo se exportó cada período: permite avisar si algo cambió después.
create table public.period_exports (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  period_from  date not null,
  period_to    date not null,
  exported_by  uuid references auth.users (id) on delete set null,
  exported_at  timestamptz not null default now()
);
create index period_exports_company on public.period_exports (company_id, exported_at desc);

-- Corregir un turno también resuelve su revisión.
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
     set clock_in = p_clock_in, clock_out = p_clock_out, updated_at = now(),
         needs_review = false, review_reason = null
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

-- Aplica un marcaje de forma idempotente. La autorización y la hora las decide el backend.
--
-- Con p_out_* aplica entrada y salida como un solo turno cerrado. Así un turno
-- trabajado sin señal no choca con turnos posteriores, como sí lo haría una
-- entrada suelta (un turno abierto se extiende hasta el infinito).
--
-- Devuelve { status: applied | duplicate | conflict | rejected, shift_id?, reason?, out? }.
-- Un marcaje inmediato rechazado se le informa al colaborador; uno diferido queda
-- guardado como conflicto para RRHH, porque quien lo hizo ya no está esperando.
create or replace function public.apply_punch(
  p_company_id uuid,
  p_employee_id uuid,
  p_client_id uuid,
  p_type text,
  p_at timestamptz,
  p_deferred boolean,
  p_review text default null,
  p_out_client_id uuid default null,
  p_out_at timestamptz default null,
  p_out_review text default null
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_id uuid;
  v_shift public.shifts;
  v_reason text;
  v_prior text;
  v_paired boolean := p_type = 'in' and p_out_client_id is not null;
  v_review text := concat_ws('; ', p_review, nullif(p_out_review, p_review));
begin
  select id into v_id from public.shifts
   where employee_id = p_employee_id and (client_in_id = p_client_id or client_out_id = p_client_id)
   limit 1;
  if found then
    if v_paired then
      -- La entrada ya llegó en un envío anterior: solo falta aplicar la salida.
      return jsonb_build_object('status', 'duplicate', 'shift_id', v_id, 'out',
        public.apply_punch(p_company_id, p_employee_id, p_out_client_id, 'out', p_out_at, p_deferred, p_out_review));
    end if;
    return jsonb_build_object('status', 'duplicate', 'shift_id', v_id);
  end if;

  select reason into v_prior from public.punch_conflicts where client_id = p_client_id;
  if found then
    return jsonb_build_object('status', 'conflict', 'reason', v_prior);
  end if;

  if p_type = 'in' then
    begin
      insert into public.shifts
        (company_id, employee_id, clock_in, clock_out, source, client_in_id, client_out_id, needs_review, review_reason)
      values
        (p_company_id, p_employee_id, p_at, p_out_at, case when p_deferred then 'offline' else 'app' end,
         p_client_id, p_out_client_id, v_review <> '', nullif(v_review, ''))
      returning id into v_id;
      if v_paired then
        return jsonb_build_object('status', 'applied', 'shift_id', v_id, 'out', jsonb_build_object('status', 'applied', 'shift_id', v_id));
      end if;
      return jsonb_build_object('status', 'applied', 'shift_id', v_id);
    exception
      when check_violation then
        v_reason := case when p_out_at is not null and p_out_at <= p_at then 'before_entry' else 'too_long' end;
      when exclusion_violation or unique_violation then
        v_reason := 'overlap';
    end;
  else
    select * into v_shift from public.shifts
     where employee_id = p_employee_id and clock_out is null
     for update;
    if not found then
      v_reason := 'no_open_shift';
    elsif p_at <= v_shift.clock_in then
      v_reason := 'before_entry';
    elsif p_at - v_shift.clock_in > interval '24 hours' then
      v_reason := 'too_long';
    else
      begin
        update public.shifts
           set clock_out = p_at,
               client_out_id = p_client_id,
               updated_at = now(),
               source = case when p_deferred and source = 'app' then 'offline' else source end,
               needs_review = needs_review or p_review is not null,
               review_reason = nullif(concat_ws('; ', review_reason, nullif(p_review, review_reason)), '')
         where id = v_shift.id;
        return jsonb_build_object('status', 'applied', 'shift_id', v_shift.id);
      exception
        when exclusion_violation or unique_violation or check_violation then
          v_reason := 'overlap';
      end;
    end if;
  end if;

  if not p_deferred then
    return jsonb_build_object('status', 'rejected', 'reason', v_reason);
  end if;

  insert into public.punch_conflicts (company_id, employee_id, client_id, type, occurred_at, reason)
  values (p_company_id, p_employee_id, p_client_id, p_type, p_at, v_reason)
  on conflict (client_id) do nothing;

  if v_paired then
    insert into public.punch_conflicts (company_id, employee_id, client_id, type, occurred_at, reason)
    values (p_company_id, p_employee_id, p_out_client_id, 'out', p_out_at, v_reason)
    on conflict (client_id) do nothing;
    return jsonb_build_object('status', 'conflict', 'reason', v_reason, 'out', jsonb_build_object('status', 'conflict', 'reason', v_reason));
  end if;
  return jsonb_build_object('status', 'conflict', 'reason', v_reason);
end;
$$;

alter table public.punch_conflicts enable row level security;
alter table public.period_exports  enable row level security;
revoke all on public.punch_conflicts, public.period_exports from anon, authenticated;

revoke execute on function public.apply_punch(uuid, uuid, uuid, text, timestamptz, boolean, text, uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.apply_punch(uuid, uuid, uuid, text, timestamptz, boolean, text, uuid, timestamptz, text) to service_role;
