-- Módulo 5: notificaciones (HU-22, RF-16, RF-26, RF-27) por Web Push.
--
-- La tabla `notificacion` (sprint 0) ya sirve como historial y como "campana" dentro
-- de la app: tiene canal, estado (pendiente/enviada/fallida/leida), sent_at y read_at.
-- Solo faltan dos cosas.

-- 1) Suscripciones de Web Push. Una suscripción es la "dirección" que el navegador
--    le da al backend para poder empujarle un aviso: el `endpoint` (URL única que
--    emite el servicio push del navegador) y dos llaves de cifrado (p256dh y auth)
--    con las que el mensaje viaja cifrado de extremo a extremo.
--
--    Solo el backend (service role) lee y escribe esta tabla: las llaves permiten
--    enviar avisos a ese navegador, así que ninguna persona debe verlas. Por eso
--    se activa RLS y NO se crea ninguna política.
create table public.suscripcion_web_push (
  id_suscripcion uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_suscripcion_web_push_user on public.suscripcion_web_push (user_id);

alter table public.suscripcion_web_push enable row level security;

comment on table public.suscripcion_web_push is
  'Suscripciones Web Push de los navegadores. Solo accesible con la service role (RLS activo sin políticas).';

-- 2) Clave de idempotencia. Los recordatorios los dispara un job cada pocos minutos
--    y no deben enviarse dos veces. El backend inserta con
--    ON CONFLICT (clave) DO NOTHING, y las notificaciones normales dejan la clave
--    en NULL (en un índice único los NULL no chocan entre sí).
alter table public.notificacion add column clave text;

create unique index notificacion_clave_uq on public.notificacion (clave);

comment on column public.notificacion.clave is
  'Clave anti-duplicados de los recordatorios: ventana:cita:usuario:inicio. NULL en el resto.';
