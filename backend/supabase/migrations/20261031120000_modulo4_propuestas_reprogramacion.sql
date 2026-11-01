-- Módulo 4 (HU-21, ampliación): propuestas de cambio de horario.
--
-- Una cita confirmada NO cambia de horario hasta que la otra parte acepte.
-- Quien reprograma (cliente o barbero) crea una propuesta; la cita sigue en su
-- horario original. Al aceptar, la otra parte mueve la cita con su propio token,
-- de modo que siguen aplicando validar_cita(), la regla de 1 día y los solapes.
--
-- Las escrituras de la tabla las hace el backend con la service role; las
-- personas solo pueden LEER las propuestas de sus propias citas (RLS).

create table public.propuesta_reprogramacion (
  id_propuesta uuid primary key default gen_random_uuid(),
  id_cita uuid not null references public.cita(id_cita) on delete cascade,
  propuesta_por text not null check (propuesta_por in ('cliente', 'barbero')),
  inicio_at timestamptz not null,
  fin_at timestamptz not null,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'aceptada', 'rechazada', 'retirada', 'vencida')),
  created_at timestamptz not null default now(),
  respondida_at timestamptz,
  check (fin_at > inicio_at)
);

-- Una sola propuesta activa por cita.
create unique index propuesta_reprogramacion_una_pendiente
  on public.propuesta_reprogramacion (id_cita)
  where estado = 'pendiente';

create index propuesta_reprogramacion_id_cita_idx
  on public.propuesta_reprogramacion (id_cita);

alter table public.propuesta_reprogramacion enable row level security;

create policy propuesta_select_participantes
  on public.propuesta_reprogramacion
  for select
  using (
    private.es_cliente_de_cita(id_cita)
    or private.es_barbero_de_cita(id_cita)
    or private.es_admin_de_cita(id_cita)
  );

revoke all on table public.propuesta_reprogramacion from anon, authenticated;
grant select on table public.propuesta_reprogramacion to authenticated;
grant all on table public.propuesta_reprogramacion to service_role;

-- Una propuesta vence si la cita ya no está confirmada o si faltan menos de
-- 24 h para su hora original (después de eso la cita ya no se puede mover).
create or replace function public.vencer_propuestas_reprogramacion()
returns void
language plpgsql
set search_path to 'public'
as $function$
begin
  update public.propuesta_reprogramacion p
     set estado = 'vencida',
         respondida_at = now()
    from public.cita c
   where c.id_cita = p.id_cita
     and p.estado = 'pendiente'
     and (c.estado <> 'confirmada' or c.inicio_at < now() + interval '1 day');
end;
$function$;

revoke execute on function public.vencer_propuestas_reprogramacion() from public, anon, authenticated;
grant execute on function public.vencer_propuestas_reprogramacion() to service_role;

-- Se revierte la transición confirmada -> pendiente del cliente (migración
-- 20261030120000): con propuestas ya no hace falta y no debe quedar permitida.
create or replace function public.validar_cita()
returns trigger
language plpgsql
set search_path to 'public', 'private'
as $function$
declare
  v_slot public.slot_cita%rowtype;
  v_es_cliente boolean;
  v_es_barbero boolean;
  v_es_admin boolean;
begin
  if tg_op = 'INSERT' then
    if new.id_slot is null then
      if new.estado <> 'pendiente' then
        raise exception 'Una solicitud sin slot debe crearse como pendiente';
      end if;
    else
      select * into v_slot from public.slot_cita where id_slot = new.id_slot;
      if not found then raise exception 'El slot seleccionado no existe'; end if;
      if v_slot.estado <> 'pendiente' then raise exception 'El slot seleccionado no esta pendiente'; end if;
      if v_slot.id_barbero <> new.id_barbero then raise exception 'El slot no pertenece al barbero seleccionado'; end if;
      if new.inicio_at <> v_slot.inicio_at then raise exception 'La cita debe iniciar en el horario seleccionado'; end if;
      if new.fin_at <= new.inicio_at then raise exception 'La cita debe tener una duracion valida'; end if;
      if new.estado <> 'confirmada' then raise exception 'Una cita tomada desde un horario pendiente debe crearse como confirmada'; end if;
    end if;
    return new;
  end if;

  v_es_cliente := private.es_cliente_propio(old.id_cliente);
  v_es_barbero := private.es_barbero_propio(old.id_barbero);
  v_es_admin   := private.es_admin_de_barberia(old.id_barberia);

  if old.estado = 'realizada' and new.estado <> old.estado and not v_es_admin then
    raise exception 'Una cita realizada no puede cambiar de estado';
  end if;

  if not v_es_admin and (new.id_cliente <> old.id_cliente or new.id_barbero <> old.id_barbero) then
    raise exception 'No se puede cambiar el cliente ni el barbero de una cita existente';
  end if;

  if not v_es_admin
     and new.estado <> old.estado
     and not (
       (v_es_cliente and new.estado = 'cancelada')
       or (v_es_barbero and old.estado = 'pendiente' and new.estado in ('confirmada', 'rechazada'))
       or (v_es_barbero and new.estado = 'cancelada')
       or (new.estado = 'realizada' and old.estado = 'confirmada' and new.fin_at < now())
       or (new.estado = 'rechazada' and old.estado = 'pendiente' and old.inicio_at < now()
           and new.motivo_estado = 'Solicitud vencida sin respuesta')
     ) then
    raise exception 'No tienes permisos para hacer esta transicion de estado';
  end if;

  if not v_es_admin
     and (new.inicio_at <> old.inicio_at or new.fin_at <> old.fin_at)
     and not (v_es_cliente or v_es_barbero) then
    raise exception 'Solo el cliente o el barbero de la cita pueden reprogramarla';
  end if;

  return new;
end;
$function$;
