-- Bitácora de decisiones de RRHH sobre solicitudes de colaboradores. Se arma con las mismas
-- solicitudes: cada decisión queda en su fila y la API no permite editarla después.

alter table public.pin_requests
  add column resolution text check (resolution in ('pin_generated', 'dismissed')),
  add column resolution_note text,
  add column resolved_by_name text;

create index pin_requests_decided on public.pin_requests (company_id, resolved_at) where resolved_at is not null;
create index shift_change_decided on public.shift_change_requests (company_id, decided_at) where decided_at is not null;
