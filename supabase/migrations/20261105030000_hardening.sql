-- Endurecimiento de seguridad.
--
-- 1. Bloqueo de fuerza bruta sobre el PIN (hook de Supabase Auth).
-- 2. Rate limit para los endpoints públicos (/register, /pin-requests).
-- 3. Tablas y funciones futuras nacen cerradas para anon/authenticated.

-- ---------------------------------------------------------------------------
-- 1. Intentos fallidos de contraseña/PIN
-- ---------------------------------------------------------------------------
-- El PIN tiene 6 dígitos (1.000.000 de combinaciones): sin límite por cuenta se adivina.
-- Supabase Auth llama a este hook en cada verificación de contraseña. Tras 5 fallos en
-- 15 minutos la cuenta se bloquea 15 minutos: adivinar el PIN pasa de minutos a años.
-- Importante: hay que habilitar el hook en el panel (Authentication → Hooks → Password
-- verification attempt → esta función) o con `supabase config push`.
create table public.auth_attempts (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  failures      int not null default 0,
  window_start  timestamptz not null default now(),
  locked_until  timestamptz
);
alter table public.auth_attempts enable row level security;
alter table public.auth_attempts force row level security;
revoke all on public.auth_attempts from public, anon, authenticated;

create or replace function public.hook_password_verification_attempt(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user  uuid := (event ->> 'user_id')::uuid;
  v_valid boolean := coalesce((event ->> 'valid')::boolean, false);
  v_row   public.auth_attempts;
begin
  insert into public.auth_attempts (user_id) values (v_user) on conflict do nothing;
  select * into v_row from public.auth_attempts where user_id = v_user for update;

  -- Bloqueada: se rechaza incluso con el PIN correcto, para que el atacante no sepa si acertó.
  if v_row.locked_until is not null and v_row.locked_until > now() then
    return jsonb_build_object(
      'decision', 'reject',
      'message', 'Demasiados intentos. Espera 15 minutos o pide un PIN nuevo a RRHH.',
      'should_logout_user', false
    );
  end if;

  if v_valid then
    update public.auth_attempts set failures = 0, window_start = now(), locked_until = null where user_id = v_user;
    return jsonb_build_object('decision', 'continue');
  end if;

  if now() - v_row.window_start > interval '15 minutes' then
    update public.auth_attempts set failures = 1, window_start = now(), locked_until = null where user_id = v_user;
  elsif v_row.failures + 1 >= 5 then
    update public.auth_attempts set failures = 0, window_start = now(), locked_until = now() + interval '15 minutes' where user_id = v_user;
  else
    update public.auth_attempts set failures = failures + 1 where user_id = v_user;
  end if;
  return jsonb_build_object('decision', 'continue');
end;
$$;

-- Solo el servicio de Auth puede invocar el hook (el rol existe en Supabase).
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function public.hook_password_verification_attempt(jsonb) to supabase_auth_admin;
    grant select, insert, update on public.auth_attempts to supabase_auth_admin;
  end if;
end $$;
revoke execute on function public.hook_password_verification_attempt(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Rate limit genérico (ventana fija) para rutas públicas
-- ---------------------------------------------------------------------------
create table public.rate_limits (
  key           text primary key,
  hits          int not null,
  window_start  timestamptz not null default now()
);
alter table public.rate_limits enable row level security;
alter table public.rate_limits force row level security;
revoke all on public.rate_limits from public, anon, authenticated;

-- Registra un intento y devuelve true si sigue dentro del límite.
create or replace function public.rate_limit_hit(p_key text, p_max int, p_window_seconds int)
returns boolean
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_hits int;
begin
  insert into public.rate_limits as r (key, hits, window_start)
  values (p_key, 1, now())
  on conflict (key) do update
    set hits = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
        window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning hits into v_hits;

  -- Limpieza oportunista para que la tabla no crezca.
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;
  return v_hits <= p_max;
end;
$$;
revoke execute on function public.rate_limit_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Lo que se cree en el futuro nace cerrado
-- ---------------------------------------------------------------------------
-- Sin esto, una tabla nueva en `public` queda abierta a anon/authenticated hasta que alguien
-- recuerde el `revoke`. RLS la protegería, pero no debe depender de un solo seguro.
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- RLS también para el dueño de las tablas (service_role lo salta de todos modos).
alter table public.companies         force row level security;
alter table public.company_admins    force row level security;
alter table public.employees         force row level security;
alter table public.shifts            force row level security;
alter table public.shift_corrections force row level security;
alter table public.punch_conflicts   force row level security;
alter table public.period_exports    force row level security;
alter table public.pin_requests      force row level security;
