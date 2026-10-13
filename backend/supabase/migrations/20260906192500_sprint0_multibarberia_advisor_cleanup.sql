-- ============================================================
-- EdgeTimer - Sprint tecnico 0: limpieza de advisors
-- ============================================================
-- Reduce politicas permisivas duplicadas y agrega el indice faltante
-- para consultas por cita en notificaciones.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_notificacion_cita
  ON public.notificacion(id_cita);

DROP POLICY IF EXISTS "barberia_select_activas" ON public.barberia;
DROP POLICY IF EXISTS "barberia_admin_all" ON public.barberia;
CREATE POLICY "barberia_select_controlado"
ON public.barberia FOR SELECT
USING (activo = TRUE OR private.es_admin_de_barberia(id_barberia));
CREATE POLICY "barberia_insert_admin"
ON public.barberia FOR INSERT
WITH CHECK (private.es_admin_de_barberia(id_barberia));
CREATE POLICY "barberia_update_admin"
ON public.barberia FOR UPDATE
USING (private.es_admin_de_barberia(id_barberia))
WITH CHECK (private.es_admin_de_barberia(id_barberia));
CREATE POLICY "barberia_delete_admin"
ON public.barberia FOR DELETE
USING (private.es_admin_de_barberia(id_barberia));

DROP POLICY IF EXISTS "administrador_select_propio" ON public.administrador;
DROP POLICY IF EXISTS "administrador_admin_all" ON public.administrador;
CREATE POLICY "administrador_select_controlado"
ON public.administrador FOR SELECT
USING (user_id = (SELECT auth.uid()) OR private.es_admin_de_barberia(id_barberia));
CREATE POLICY "administrador_insert_admin"
ON public.administrador FOR INSERT
WITH CHECK (private.es_admin_de_barberia(id_barberia));
CREATE POLICY "administrador_update_admin"
ON public.administrador FOR UPDATE
USING (private.es_admin_de_barberia(id_barberia))
WITH CHECK (private.es_admin_de_barberia(id_barberia));
CREATE POLICY "administrador_delete_admin"
ON public.administrador FOR DELETE
USING (private.es_admin_de_barberia(id_barberia));

DROP POLICY IF EXISTS "procedimiento_select_activos" ON public.procedimiento;
DROP POLICY IF EXISTS "procedimiento_admin_all" ON public.procedimiento;
DROP POLICY IF EXISTS "procedimiento_admin_barberia_all" ON public.procedimiento;
DROP POLICY IF EXISTS "procedimiento_admin_insert" ON public.procedimiento;
DROP POLICY IF EXISTS "procedimiento_admin_update" ON public.procedimiento;
DROP POLICY IF EXISTS "procedimiento_admin_delete" ON public.procedimiento;
CREATE POLICY "procedimiento_select_controlado"
ON public.procedimiento FOR SELECT
USING (activo = TRUE OR private.es_admin_de_barberia(id_barberia));
CREATE POLICY "procedimiento_insert_admin_barberia"
ON public.procedimiento FOR INSERT
WITH CHECK (private.es_admin_de_barberia(id_barberia));
CREATE POLICY "procedimiento_update_admin_barberia"
ON public.procedimiento FOR UPDATE
USING (private.es_admin_de_barberia(id_barberia))
WITH CHECK (private.es_admin_de_barberia(id_barberia));
CREATE POLICY "procedimiento_delete_admin_barberia"
ON public.procedimiento FOR DELETE
USING (private.es_admin_de_barberia(id_barberia));

DROP POLICY IF EXISTS "barbero_procedimiento_select" ON public.barbero_procedimiento;
DROP POLICY IF EXISTS "barbero_procedimiento_admin_all" ON public.barbero_procedimiento;
DROP POLICY IF EXISTS "barbero_procedimiento_admin_barberia_all" ON public.barbero_procedimiento;
CREATE POLICY "barbero_procedimiento_select_controlado"
ON public.barbero_procedimiento FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.barbero ba
    WHERE ba.id_barbero = barbero_procedimiento.id_barbero
      AND (
        ba.activo = TRUE
        OR private.es_barbero_propio(ba.id_barbero)
        OR private.es_admin_de_barberia(ba.id_barberia)
      )
  )
);
CREATE POLICY "barbero_procedimiento_insert_admin_barberia"
ON public.barbero_procedimiento FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.barbero ba
    WHERE ba.id_barbero = barbero_procedimiento.id_barbero
      AND private.es_admin_de_barberia(ba.id_barberia)
  )
);
CREATE POLICY "barbero_procedimiento_update_admin_barberia"
ON public.barbero_procedimiento FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.barbero ba
    WHERE ba.id_barbero = barbero_procedimiento.id_barbero
      AND private.es_admin_de_barberia(ba.id_barberia)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.barbero ba
    WHERE ba.id_barbero = barbero_procedimiento.id_barbero
      AND private.es_admin_de_barberia(ba.id_barberia)
  )
);
CREATE POLICY "barbero_procedimiento_delete_admin_barberia"
ON public.barbero_procedimiento FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM public.barbero ba
    WHERE ba.id_barbero = barbero_procedimiento.id_barbero
      AND private.es_admin_de_barberia(ba.id_barberia)
  )
);

DROP POLICY IF EXISTS "disponibilidad_select_publica" ON public.disponibilidad_barbero;
DROP POLICY IF EXISTS "disponibilidad_barbero_o_admin_all" ON public.disponibilidad_barbero;
CREATE POLICY "disponibilidad_select_controlado"
ON public.disponibilidad_barbero FOR SELECT
USING (
  activo = TRUE
  OR private.es_barbero_propio(id_barbero)
  OR EXISTS (
    SELECT 1
    FROM public.barbero ba
    WHERE ba.id_barbero = disponibilidad_barbero.id_barbero
      AND private.es_admin_de_barberia(ba.id_barberia)
  )
);
CREATE POLICY "disponibilidad_insert_barbero_o_admin"
ON public.disponibilidad_barbero FOR INSERT
WITH CHECK (
  private.es_barbero_propio(id_barbero)
  OR EXISTS (
    SELECT 1
    FROM public.barbero ba
    WHERE ba.id_barbero = disponibilidad_barbero.id_barbero
      AND private.es_admin_de_barberia(ba.id_barberia)
  )
);
CREATE POLICY "disponibilidad_update_barbero_o_admin"
ON public.disponibilidad_barbero FOR UPDATE
USING (
  private.es_barbero_propio(id_barbero)
  OR EXISTS (
    SELECT 1
    FROM public.barbero ba
    WHERE ba.id_barbero = disponibilidad_barbero.id_barbero
      AND private.es_admin_de_barberia(ba.id_barberia)
  )
)
WITH CHECK (
  private.es_barbero_propio(id_barbero)
  OR EXISTS (
    SELECT 1
    FROM public.barbero ba
    WHERE ba.id_barbero = disponibilidad_barbero.id_barbero
      AND private.es_admin_de_barberia(ba.id_barberia)
  )
);
CREATE POLICY "disponibilidad_delete_barbero_o_admin"
ON public.disponibilidad_barbero FOR DELETE
USING (
  private.es_barbero_propio(id_barbero)
  OR EXISTS (
    SELECT 1
    FROM public.barbero ba
    WHERE ba.id_barbero = disponibilidad_barbero.id_barbero
      AND private.es_admin_de_barberia(ba.id_barberia)
  )
);

