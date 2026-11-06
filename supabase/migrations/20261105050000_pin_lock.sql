-- Bloqueo del PIN, resuelto en nuestro backend. El hook de Supabase Auth para esto solo
-- existe en los planes Teams y Enterprise.
--
-- El PIN deja de ser la contraseña de Supabase Auth: se verifica aquí, y la contraseña real
-- es un secreto aleatorio que nunca sale del backend. Así, probar PINs directamente contra
-- Supabase Auth no sirve, y el único camino pasa por el contador de intentos.

create table public.employee_pins (
  employee_id  uuid primary key references public.employees (id) on delete cascade,
  salt         text not null,
  pin_hash     text not null,
  auth_secret  text not null,
  updated_at   timestamptz not null default now()
);

-- Clave: hash de empresa + cédula, exista o no la persona. Una cédula inventada se comporta
-- igual que una real, y el bloqueo no revela quién trabaja en la empresa.
create table public.pin_attempts (
  key           text primary key,
  failures      int not null default 0,
  window_start  timestamptz not null default now(),
  locked_until  timestamptz
);

alter table public.employee_pins enable row level security;
alter table public.pin_attempts  enable row level security;
alter table public.employee_pins force row level security;
alter table public.pin_attempts  force row level security;
revoke all on public.employee_pins, public.pin_attempts from anon, authenticated;

-- Reserva un intento ANTES de verificar el PIN: varios envíos en paralelo no pueden
-- pasarse del límite. Al quinto intento de la ventana la cuenta queda bloqueada; si ese
-- era el PIN correcto, pin_attempt_clear la libera de inmediato.
create or replace function public.pin_attempt_begin(p_key text, p_max int default 5, p_window_seconds int default 900, p_lock_seconds int default 900)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_row public.pin_attempts;
begin
  insert into public.pin_attempts (key) values (p_key) on conflict do nothing;
  select * into v_row from public.pin_attempts where key = p_key for update;

  if v_row.locked_until is not null and v_row.locked_until > now() then
    return jsonb_build_object('allowed', false, 'retry_after', ceil(extract(epoch from v_row.locked_until - now()))::int);
  end if;

  if v_row.locked_until is not null or now() - v_row.window_start > make_interval(secs => p_window_seconds) then
    v_row.failures := 0;
    v_row.window_start := now();
  end if;
  v_row.failures := v_row.failures + 1;

  update public.pin_attempts
     set failures = v_row.failures,
         window_start = v_row.window_start,
         locked_until = case when v_row.failures >= p_max then now() + make_interval(secs => p_lock_seconds) end
   where key = p_key;

  -- Limpieza oportunista: las cédulas inventadas no deben hacer crecer la tabla.
  if random() < 0.01 then
    delete from public.pin_attempts where window_start < now() - interval '1 day' and (locked_until is null or locked_until < now());
  end if;

  return jsonb_build_object('allowed', true, 'remaining', greatest(p_max - v_row.failures, 0));
end;
$$;

create or replace function public.pin_attempt_clear(p_key text)
returns void
language sql
set search_path = public, pg_temp
as $$
  delete from public.pin_attempts where key = p_key;
$$;

revoke execute on function public.pin_attempt_begin(text, int, int, int) from public, anon, authenticated;
revoke execute on function public.pin_attempt_clear(text) from public, anon, authenticated;
grant execute on function public.pin_attempt_begin(text, int, int, int) to service_role;
grant execute on function public.pin_attempt_clear(text) to service_role;
