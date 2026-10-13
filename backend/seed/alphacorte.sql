-- =====================================================================
-- EdgeTimer · Siembra de la barbería AlphaCorte y sus procedimientos
-- YA APLICADO en EdgeTimerDB. Se guarda aquí para poder reproducirlo
-- en otro entorno (por ejemplo, una base de pruebas).
-- Los precios (COP) y duraciones son iniciales: el administrador puede
-- cambiarlos desde la app (RF-11).
-- Solo ejecutar sobre una base SIN la barbería (no es idempotente).
-- =====================================================================
with b as (
  insert into public.barberia (nombre, direccion, activo)
  values ('AlphaCorte', 'Robledo, Medellín', true)
  returning id_barberia
)
insert into public.procedimiento (id_barberia, nombre, descripcion, precio, duracion_minutos, activo)
select b.id_barberia, p.nombre, p.descripcion, p.precio, p.duracion, true
from b,
(values
  ('Corte clásico',                'Corte de cabello con máquina y tijera',                  35000, 45),
  ('Corte infantil',               'Corte de cabello para niños hasta los 12 años',          25000, 30),
  ('Arreglo de barba',             'Perfilado y recorte de barba',                           20000, 30),
  ('Corte + barba',                'Corte clásico con arreglo de barba',                     50000, 60),
  ('Afeitado con toalla caliente', 'Afeitado tradicional con toalla caliente y navaja',      30000, 30),
  ('Perfilado de cejas',           'Perfilado de cejas con navaja',                          10000, 15),
  ('Lavado y peinado',             'Lavado de cabello y peinado',                            15000, 30),
  ('Tinte',                        'Aplicación de tinte para cabello',                       60000, 90)
) as p(nombre, descripcion, precio, duracion);
