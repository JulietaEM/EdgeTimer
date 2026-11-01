-- Módulo 4 (HU-21): al reprogramar una cita confirmada, el cliente la devuelve a
-- "pendiente" para que el barbero vuelva a confirmar el nuevo horario.
--
-- Hasta ahora validar_cita() solo dejaba al cliente cambiar el estado a
-- 'cancelada'. Se agrega UNA transición más, y solo si el horario cambia:
--   cliente: confirmada -> pendiente (y inicio_at o fin_at distintos)
-- El resto de la función queda idéntico. La regla de "mínimo 1 día de
-- anticipación" la sigue aplicando validar_reprogramacion_cancelacion().

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
       -- NUEVO: reprogramar una cita confirmada exige que el barbero la confirme de nuevo.
       or (v_es_cliente and old.estado = 'confirmada' and new.estado = 'pendiente'
           and (new.inicio_at <> old.inicio_at or new.fin_at <> old.fin_at))
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
