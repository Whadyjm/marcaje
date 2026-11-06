-- Solicitudes de cambio de turno para un día puntual. Al aprobarse reemplazan el horario
-- esperado de esa fecha. Como el horario, solo afectan los avisos: las horas se siguen
-- calculando con la entrada y la salida reales.
create table public.shift_change_requests (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  employee_id      uuid not null references public.employees (id) on delete cascade,
  work_date        date not null,
  -- Horario vigente al solicitar, para que RRHH vea el cambio completo.
  from_start       text,
  from_end         text,
  -- Ambos nulos = pide el día libre.
  to_start         text,
  to_end           text,
  reason           text not null check (char_length(trim(reason)) >= 5),
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decision_note    text,
  decided_by       uuid references auth.users (id) on delete set null,
  decided_by_name  text,
  decided_at       timestamptz,
  created_at       timestamptz not null default now(),
  constraint shift_change_times check ((to_start is null) = (to_end is null))
);

-- Una sola pendiente por persona y fecha.
create unique index shift_change_one_pending on public.shift_change_requests (employee_id, work_date) where status = 'pending';
create index shift_change_company_pending on public.shift_change_requests (company_id, created_at) where status = 'pending';
create index shift_change_approved on public.shift_change_requests (company_id, work_date) where status = 'approved';
create index shift_change_employee on public.shift_change_requests (employee_id, created_at desc);

alter table public.shift_change_requests enable row level security;
alter table public.shift_change_requests force row level security;
revoke all on public.shift_change_requests from anon, authenticated;
