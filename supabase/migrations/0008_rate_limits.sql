-- ============================================================
-- PicMyEvent · Migracion 0008: rate_limits
-- Fase 1 (T1.1): rate limiting sin servicios externos (ADR-003,
-- P7 del plan). Ventana deslizante por clave (evento+IP, IP, ...).
-- ============================================================

create table if not exists public.rate_limits (
  key          text primary key,
  count        int not null default 0,
  window_start timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.rate_limits is
  'Contadores de rate limiting por clave (p.ej. upload:{eventId}:{ip}). Ventana deslizante.';

create index if not exists idx_rate_limits_window on public.rate_limits (window_start);
