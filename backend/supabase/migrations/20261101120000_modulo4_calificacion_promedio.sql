-- Módulo 4 (HU-23): calificar una cita realizada.
--
-- 1) El trigger actualizar_promedio_barbero() recalcula barbero.promedio_calificacion
--    cuando se inserta o cambia una calificación, pero corría con los permisos de
--    QUIEN califica (SECURITY INVOKER). La política de UPDATE de `barbero` solo deja
--    actualizar al propio barbero o a su administrador, así que cuando un CLIENTE
--    calificaba, el UPDATE no daba error pero afectaba 0 filas y el promedio nunca
--    cambiaba. Con SECURITY DEFINER el recálculo corre con los permisos del dueño de
--    la función; la función ya fija search_path = public y solo toca el barbero de
--    la cita calificada.
alter function public.actualizar_promedio_barbero() security definer;

-- 2) La reseña mide como máximo 500 caracteres (la app ya lo valida; esto cubre
--    también a quien escriba directo a la API con su token).
alter table public.calificacion
  add constraint calificacion_resena_longitud
  check (resena is null or char_length(resena) <= 500);
