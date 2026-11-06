-- Horario esperado por colaborador. Solo genera avisos (ausencias, retardos, salidas
-- anticipadas): no interviene en el cálculo de horas ni en el CSV.

alter table public.companies
  add column late_tolerance_min int not null default 10 check (late_tolerance_min between 0 and 120);

-- Cada fila es una versión del horario semanal, vigente desde effective_from hasta la
-- siguiente. Cambiar un horario no reescribe lo que ya pasó.
-- week: { "1": { "start": "08:00", "end": "17:00" }, ... } con lunes = 1. Un día que no
-- aparece es descanso. week null = dejó de tener horario.
create table public.employee_schedules (
  employee_id     uuid not null references public.employees (id) on delete cascade,
  company_id      uuid not null references public.companies (id) on delete cascade,
  effective_from  date not null,
  week            jsonb check (week is null or jsonb_typeof(week) = 'object'),
  created_by      uuid references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now(),
  primary key (employee_id, effective_from)
);
create index employee_schedules_company on public.employee_schedules (company_id, effective_from);

alter table public.employee_schedules enable row level security;
revoke all on public.employee_schedules from anon, authenticated;
