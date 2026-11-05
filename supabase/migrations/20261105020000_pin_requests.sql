-- Solicitudes de PIN: el colaborador sin acceso le avisa a RRHH desde el login.
create table public.pin_requests (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  employee_id  uuid not null references public.employees (id) on delete cascade,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  resolved_by  uuid references auth.users (id) on delete set null
);

-- La ruta es pública: como máximo una solicitud pendiente por colaborador, así repetirla no llena el panel.
create unique index pin_requests_one_pending on public.pin_requests (employee_id) where resolved_at is null;
create index pin_requests_pending on public.pin_requests (company_id) where resolved_at is null;

alter table public.pin_requests enable row level security;
revoke all on public.pin_requests from anon, authenticated;
