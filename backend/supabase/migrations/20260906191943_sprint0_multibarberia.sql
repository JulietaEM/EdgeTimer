-- ============================================================
-- EdgeTimer - Sprint tecnico 0: base multi-barberia
-- ============================================================
-- Objetivo:
--   Convertir el modelo actual centrado en AlphaCorte en una base
--   multi-barberia con administrador por barberia, servicios propios,
--   disponibilidad configurable, notificaciones, auditoria y reportes.
--
-- Uso:
--   Ejecutar en Supabase SQL Editor o por MCP de Supabase.
--   La migracion es idempotente y conserva datos actuales asignandolos
--   a una barberia heredada llamada AlphaCorte.
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE SCHEMA IF NOT EXISTS private;

-- ============================================================
-- Tipos
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rol_usuario') THEN
    CREATE TYPE rol_usuario AS ENUM ('cliente', 'barbero', 'admin');
  ELSIF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'rol_usuario'
      AND e.enumlabel = 'admin'
  ) THEN
    ALTER TYPE rol_usuario ADD VALUE 'admin';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'canal_notificacion') THEN
    CREATE TYPE canal_notificacion AS ENUM ('push', 'email', 'in_app');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estado_notificacion') THEN
    CREATE TYPE estado_notificacion AS ENUM ('pendiente', 'enviada', 'fallida', 'leida');
  END IF;
END $$;

-- ============================================================
-- Barberias y administradores
-- ============================================================

CREATE TABLE IF NOT EXISTS public.barberia (
  id_barberia UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre VARCHAR(128) NOT NULL CHECK (LENGTH(TRIM(nombre)) > 0),
  descripcion VARCHAR(500),
  direccion VARCHAR(255),
  telefono VARCHAR(20),
  email VARCHAR(255),
  logo_url TEXT,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_barberia_nombre_unique
  ON public.barberia (LOWER(nombre));

INSERT INTO public.barberia (nombre, descripcion, activo)
SELECT
  'AlphaCorte',
  'Barberia heredada creada para conservar los datos existentes de la primera version.',
  TRUE
WHERE NOT EXISTS (
  SELECT 1
  FROM public.barberia
  WHERE LOWER(nombre) = LOWER('AlphaCorte')
);

CREATE TABLE IF NOT EXISTS public.administrador (
  id_administrador UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  id_barberia UUID NOT NULL REFERENCES public.barberia(id_barberia) ON DELETE CASCADE,
  nombre_administrador VARCHAR(128) NOT NULL CHECK (LENGTH(TRIM(nombre_administrador)) > 0),
  telefono VARCHAR(20),
  foto_perfil TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_administrador_barberia
  ON public.administrador(id_barberia);

-- ============================================================
-- Asociar entidades existentes a barberia
-- ============================================================

ALTER TABLE public.barbero
  ADD COLUMN IF NOT EXISTS id_barberia UUID REFERENCES public.barberia(id_barberia) ON DELETE RESTRICT;

UPDATE public.barbero
SET id_barberia = (SELECT id_barberia FROM public.barberia WHERE LOWER(nombre) = LOWER('AlphaCorte') LIMIT 1)
WHERE id_barberia IS NULL;

ALTER TABLE public.barbero
  ALTER COLUMN id_barberia SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_barbero_barberia_activo
  ON public.barbero(id_barberia, activo);

ALTER TABLE public.procedimiento
  ADD COLUMN IF NOT EXISTS id_barberia UUID REFERENCES public.barberia(id_barberia) ON DELETE CASCADE;

UPDATE public.procedimiento
SET id_barberia = (SELECT id_barberia FROM public.barberia WHERE LOWER(nombre) = LOWER('AlphaCorte') LIMIT 1)
WHERE id_barberia IS NULL;

ALTER TABLE public.procedimiento
  ALTER COLUMN id_barberia SET NOT NULL;

ALTER TABLE public.procedimiento
  DROP CONSTRAINT IF EXISTS procedimiento_nombre_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_procedimiento_barberia_nombre_unique
  ON public.procedimiento(id_barberia, LOWER(nombre));

CREATE INDEX IF NOT EXISTS idx_procedimiento_barberia_activo
  ON public.procedimiento(id_barberia, activo);

ALTER TABLE public.slot_cita
  ADD COLUMN IF NOT EXISTS id_barberia UUID REFERENCES public.barberia(id_barberia) ON DELETE CASCADE;

UPDATE public.slot_cita sl
SET id_barberia = ba.id_barberia
FROM public.barbero ba
WHERE sl.id_barbero = ba.id_barbero
  AND sl.id_barberia IS NULL;

ALTER TABLE public.slot_cita
  ALTER COLUMN id_barberia SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_slot_barberia_inicio
  ON public.slot_cita(id_barberia, inicio_at);

ALTER TABLE public.cita
  ADD COLUMN IF NOT EXISTS id_barberia UUID REFERENCES public.barberia(id_barberia) ON DELETE RESTRICT;

UPDATE public.cita ci
SET id_barberia = ba.id_barberia
FROM public.barbero ba
WHERE ci.id_barbero = ba.id_barbero
  AND ci.id_barberia IS NULL;

ALTER TABLE public.cita
  ALTER COLUMN id_barberia SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cita_barberia_inicio
  ON public.cita(id_barberia, inicio_at);

-- ============================================================
-- Disponibilidad configurable
-- ============================================================

CREATE TABLE IF NOT EXISTS public.disponibilidad_barbero (
  id_disponibilidad UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_barbero UUID NOT NULL REFERENCES public.barbero(id_barbero) ON DELETE CASCADE,
  dia_semana INT NOT NULL CHECK (dia_semana BETWEEN 1 AND 7),
  hora_inicio TIME NOT NULL,
  hora_fin TIME NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (hora_fin > hora_inicio)
);

CREATE INDEX IF NOT EXISTS idx_disponibilidad_barbero_dia
  ON public.disponibilidad_barbero(id_barbero, dia_semana, activo);

INSERT INTO public.disponibilidad_barbero (id_barbero, dia_semana, hora_inicio, hora_fin)
SELECT ba.id_barbero, day_number, TIME '08:00', TIME '18:00'
FROM public.barbero ba
CROSS JOIN generate_series(1, 5) AS day_number
WHERE NOT EXISTS (
  SELECT 1
  FROM public.disponibilidad_barbero db
  WHERE db.id_barbero = ba.id_barbero
);

-- ============================================================
-- Notificaciones y tokens push
-- ============================================================

CREATE TABLE IF NOT EXISTS public.dispositivo_push (
  id_dispositivo UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expo_push_token TEXT NOT NULL UNIQUE,
  plataforma VARCHAR(20),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dispositivo_push_user
  ON public.dispositivo_push(user_id, activo);

CREATE TABLE IF NOT EXISTS public.notificacion (
  id_notificacion UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  id_cita UUID REFERENCES public.cita(id_cita) ON DELETE SET NULL,
  canal canal_notificacion NOT NULL DEFAULT 'push',
  titulo VARCHAR(120) NOT NULL,
  mensaje VARCHAR(500) NOT NULL,
  estado estado_notificacion NOT NULL DEFAULT 'pendiente',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notificacion_user_estado
  ON public.notificacion(user_id, estado, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notificacion_scheduled
  ON public.notificacion(estado, scheduled_at)
  WHERE scheduled_at IS NOT NULL;

-- ============================================================
-- Auditoria para acciones criticas
-- ============================================================

CREATE TABLE IF NOT EXISTS public.auditoria_accion (
  id_auditoria UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  rol rol_usuario,
  entidad VARCHAR(80) NOT NULL,
  entidad_id UUID,
  accion VARCHAR(80) NOT NULL,
  detalles JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auditoria_entidad
  ON public.auditoria_accion(entidad, entidad_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auditoria_user
  ON public.auditoria_accion(user_id, created_at DESC);

-- ============================================================
-- Funciones de permisos
-- ============================================================

CREATE OR REPLACE FUNCTION private.es_admin()
RETURNS BOOLEAN AS $$
BEGIN
  IF (SELECT auth.role()) = 'service_role' THEN
    RETURN TRUE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.perfil pe
    WHERE pe.user_id = (SELECT auth.uid())
      AND pe.rol = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;

CREATE OR REPLACE FUNCTION private.es_admin_de_barberia(p_id_barberia UUID)
RETURNS BOOLEAN AS $$
BEGIN
  IF (SELECT auth.role()) = 'service_role' THEN
    RETURN TRUE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.administrador ad
    WHERE ad.user_id = (SELECT auth.uid())
      AND ad.id_barberia = p_id_barberia
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;

CREATE OR REPLACE FUNCTION private.es_barbero_propio(p_id_barbero UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.barbero ba
    WHERE ba.id_barbero = p_id_barbero
      AND ba.user_id = (SELECT auth.uid())
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;

CREATE OR REPLACE FUNCTION private.es_cliente_propio(p_id_cliente UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.cliente cl
    WHERE cl.id_cliente = p_id_cliente
      AND cl.user_id = (SELECT auth.uid())
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;

CREATE OR REPLACE FUNCTION private.es_cliente_visible_para_barbero(p_id_cliente UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.cita ci
    JOIN public.barbero ba ON ba.id_barbero = ci.id_barbero
    WHERE ci.id_cliente = p_id_cliente
      AND ba.user_id = (SELECT auth.uid())
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private;

GRANT USAGE ON SCHEMA private TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.es_admin() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.es_admin_de_barberia(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.es_barbero_propio(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.es_cliente_propio(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.es_cliente_visible_para_barbero(UUID) TO anon, authenticated, service_role;

-- ============================================================
-- Triggers de consistencia
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_barberia_updated_at ON public.barberia;
CREATE TRIGGER trg_barberia_updated_at
BEFORE UPDATE ON public.barberia
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_dispositivo_push_updated_at ON public.dispositivo_push;
CREATE TRIGGER trg_dispositivo_push_updated_at
BEFORE UPDATE ON public.dispositivo_push
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.sincronizar_barberia_cita_slot()
RETURNS TRIGGER AS $$
DECLARE
  v_id_barberia UUID;
BEGIN
  SELECT ba.id_barberia
  INTO v_id_barberia
  FROM public.barbero ba
  WHERE ba.id_barbero = NEW.id_barbero;

  IF v_id_barberia IS NULL THEN
    RAISE EXCEPTION 'El barbero seleccionado no existe o no tiene barberia asociada';
  END IF;

  IF NEW.id_barberia IS NULL THEN
    NEW.id_barberia := v_id_barberia;
  ELSIF NEW.id_barberia <> v_id_barberia THEN
    RAISE EXCEPTION 'La cita debe pertenecer a la misma barberia del barbero';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_sincronizar_barberia_cita ON public.cita;
CREATE TRIGGER trg_sincronizar_barberia_cita
BEFORE INSERT OR UPDATE OF id_barbero, id_barberia ON public.cita
FOR EACH ROW
EXECUTE FUNCTION public.sincronizar_barberia_cita_slot();

CREATE OR REPLACE FUNCTION public.sincronizar_barberia_slot()
RETURNS TRIGGER AS $$
DECLARE
  v_id_barberia UUID;
BEGIN
  SELECT ba.id_barberia
  INTO v_id_barberia
  FROM public.barbero ba
  WHERE ba.id_barbero = NEW.id_barbero;

  IF v_id_barberia IS NULL THEN
    RAISE EXCEPTION 'El barbero seleccionado no existe o no tiene barberia asociada';
  END IF;

  IF NEW.id_barberia IS NULL THEN
    NEW.id_barberia := v_id_barberia;
  ELSIF NEW.id_barberia <> v_id_barberia THEN
    RAISE EXCEPTION 'El horario debe pertenecer a la misma barberia del barbero';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_sincronizar_barberia_slot ON public.slot_cita;
CREATE TRIGGER trg_sincronizar_barberia_slot
BEFORE INSERT OR UPDATE OF id_barbero, id_barberia ON public.slot_cita
FOR EACH ROW
EXECUTE FUNCTION public.sincronizar_barberia_slot();

CREATE OR REPLACE FUNCTION public.cita_dentro_disponibilidad(
  p_id_barbero UUID,
  p_inicio_at TIMESTAMPTZ,
  p_fin_at TIMESTAMPTZ
)
RETURNS BOOLEAN AS $$
DECLARE
  v_dia INT;
  v_inicio TIME;
  v_fin TIME;
BEGIN
  v_dia := EXTRACT(ISODOW FROM p_inicio_at AT TIME ZONE 'America/Bogota');
  v_inicio := (p_inicio_at AT TIME ZONE 'America/Bogota')::time;
  v_fin := (p_fin_at AT TIME ZONE 'America/Bogota')::time;

  IF (p_inicio_at AT TIME ZONE 'America/Bogota')::date
     <> (p_fin_at AT TIME ZONE 'America/Bogota')::date THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.disponibilidad_barbero db
    WHERE db.id_barbero = p_id_barbero
      AND db.activo = TRUE
      AND db.dia_semana = v_dia
      AND db.hora_inicio <= v_inicio
      AND db.hora_fin >= v_fin
  );
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;

CREATE OR REPLACE FUNCTION public.validar_cita_sprint0()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.fin_at <= NEW.inicio_at THEN
    RAISE EXCEPTION 'La hora de fin debe ser posterior a la hora de inicio';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.inicio_at < NOW() THEN
    RAISE EXCEPTION 'No se pueden crear citas en fechas u horarios pasados';
  END IF;

  IF TG_OP = 'UPDATE'
     AND (NEW.inicio_at <> OLD.inicio_at OR NEW.fin_at <> OLD.fin_at)
     AND NEW.inicio_at < NOW() THEN
    RAISE EXCEPTION 'No se pueden reprogramar citas a fechas u horarios pasados';
  END IF;

  IF NOT public.cita_dentro_disponibilidad(NEW.id_barbero, NEW.inicio_at, NEW.fin_at) THEN
    RAISE EXCEPTION 'La cita debe estar dentro de la disponibilidad configurada del barbero';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_validar_cita_sprint0 ON public.cita;
CREATE TRIGGER trg_validar_cita_sprint0
BEFORE INSERT OR UPDATE OF id_barbero, inicio_at, fin_at ON public.cita
FOR EACH ROW
EXECUTE FUNCTION public.validar_cita_sprint0();

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE public.barberia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.administrador ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disponibilidad_barbero ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispositivo_push ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notificacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria_accion ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON public.barberia TO anon, authenticated;
GRANT SELECT ON public.administrador TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.disponibilidad_barbero TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.dispositivo_push TO authenticated;
GRANT SELECT, UPDATE ON public.notificacion TO authenticated;
GRANT SELECT ON public.auditoria_accion TO authenticated;
GRANT ALL ON public.barberia TO service_role;
GRANT ALL ON public.administrador TO service_role;
GRANT ALL ON public.disponibilidad_barbero TO service_role;
GRANT ALL ON public.dispositivo_push TO service_role;
GRANT ALL ON public.notificacion TO service_role;
GRANT ALL ON public.auditoria_accion TO service_role;

DROP POLICY IF EXISTS "barberia_select_activas" ON public.barberia;
CREATE POLICY "barberia_select_activas"
ON public.barberia FOR SELECT
USING (activo = TRUE OR private.es_admin_de_barberia(id_barberia));

DROP POLICY IF EXISTS "barberia_admin_all" ON public.barberia;
CREATE POLICY "barberia_admin_all"
ON public.barberia FOR ALL
USING (private.es_admin_de_barberia(id_barberia))
WITH CHECK (private.es_admin_de_barberia(id_barberia));

DROP POLICY IF EXISTS "administrador_select_propio" ON public.administrador;
CREATE POLICY "administrador_select_propio"
ON public.administrador FOR SELECT
USING (user_id = (SELECT auth.uid()) OR private.es_admin_de_barberia(id_barberia));

DROP POLICY IF EXISTS "administrador_admin_all" ON public.administrador;
CREATE POLICY "administrador_admin_all"
ON public.administrador FOR ALL
USING (private.es_admin_de_barberia(id_barberia))
WITH CHECK (private.es_admin_de_barberia(id_barberia));

DROP POLICY IF EXISTS "barbero_select_activos" ON public.barbero;
CREATE POLICY "barbero_select_activos"
ON public.barbero FOR SELECT
USING (
  activo = TRUE
  OR user_id = (SELECT auth.uid())
  OR private.es_admin_de_barberia(id_barberia)
);

DROP POLICY IF EXISTS "barbero_update_propio" ON public.barbero;
DROP POLICY IF EXISTS "barbero_update_propio_o_admin_barberia" ON public.barbero;
CREATE POLICY "barbero_update_propio_o_admin_barberia"
ON public.barbero FOR UPDATE
USING (user_id = (SELECT auth.uid()) OR private.es_admin_de_barberia(id_barberia))
WITH CHECK (user_id = (SELECT auth.uid()) OR private.es_admin_de_barberia(id_barberia));

DROP POLICY IF EXISTS "procedimiento_select_activos" ON public.procedimiento;
CREATE POLICY "procedimiento_select_activos"
ON public.procedimiento FOR SELECT
USING (activo = TRUE OR private.es_admin_de_barberia(id_barberia));

DROP POLICY IF EXISTS "procedimiento_admin_all" ON public.procedimiento;
DROP POLICY IF EXISTS "procedimiento_admin_barberia_all" ON public.procedimiento;
CREATE POLICY "procedimiento_admin_barberia_all"
ON public.procedimiento FOR ALL
USING (private.es_admin_de_barberia(id_barberia))
WITH CHECK (private.es_admin_de_barberia(id_barberia));

DROP POLICY IF EXISTS "barbero_procedimiento_select" ON public.barbero_procedimiento;
CREATE POLICY "barbero_procedimiento_select"
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

DROP POLICY IF EXISTS "barbero_procedimiento_admin_all" ON public.barbero_procedimiento;
DROP POLICY IF EXISTS "barbero_procedimiento_admin_barberia_all" ON public.barbero_procedimiento;
CREATE POLICY "barbero_procedimiento_admin_barberia_all"
ON public.barbero_procedimiento FOR ALL
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

DROP POLICY IF EXISTS "disponibilidad_select_publica" ON public.disponibilidad_barbero;
CREATE POLICY "disponibilidad_select_publica"
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

DROP POLICY IF EXISTS "disponibilidad_barbero_o_admin_all" ON public.disponibilidad_barbero;
CREATE POLICY "disponibilidad_barbero_o_admin_all"
ON public.disponibilidad_barbero FOR ALL
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

DROP POLICY IF EXISTS "slot_select_disponibles_o_propios" ON public.slot_cita;
CREATE POLICY "slot_select_disponibles_o_propios"
ON public.slot_cita FOR SELECT
USING (
  (estado = 'pendiente' AND inicio_at >= NOW())
  OR private.es_barbero_propio(id_barbero)
  OR private.es_admin_de_barberia(id_barberia)
);

DROP POLICY IF EXISTS "cita_select_participantes" ON public.cita;
CREATE POLICY "cita_select_participantes"
ON public.cita FOR SELECT
USING (
  private.es_cliente_propio(id_cliente)
  OR private.es_barbero_propio(id_barbero)
  OR private.es_admin_de_barberia(id_barberia)
);

DROP POLICY IF EXISTS "cita_insert_cliente" ON public.cita;
CREATE POLICY "cita_insert_cliente"
ON public.cita FOR INSERT
WITH CHECK (
  private.es_cliente_propio(id_cliente)
  OR private.es_admin_de_barberia(id_barberia)
);

DROP POLICY IF EXISTS "cita_update_participantes" ON public.cita;
CREATE POLICY "cita_update_participantes"
ON public.cita FOR UPDATE
USING (
  private.es_cliente_propio(id_cliente)
  OR private.es_barbero_propio(id_barbero)
  OR private.es_admin_de_barberia(id_barberia)
)
WITH CHECK (
  private.es_cliente_propio(id_cliente)
  OR private.es_barbero_propio(id_barbero)
  OR private.es_admin_de_barberia(id_barberia)
);

DROP POLICY IF EXISTS "dispositivo_push_select_propio" ON public.dispositivo_push;
CREATE POLICY "dispositivo_push_select_propio"
ON public.dispositivo_push FOR SELECT
USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "dispositivo_push_insert_propio" ON public.dispositivo_push;
CREATE POLICY "dispositivo_push_insert_propio"
ON public.dispositivo_push FOR INSERT
WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "dispositivo_push_update_propio" ON public.dispositivo_push;
CREATE POLICY "dispositivo_push_update_propio"
ON public.dispositivo_push FOR UPDATE
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "notificacion_select_propia" ON public.notificacion;
CREATE POLICY "notificacion_select_propia"
ON public.notificacion FOR SELECT
USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "notificacion_update_lectura_propia" ON public.notificacion;
CREATE POLICY "notificacion_update_lectura_propia"
ON public.notificacion FOR UPDATE
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "auditoria_select_admin_barberia" ON public.auditoria_accion;
CREATE POLICY "auditoria_select_admin_barberia"
ON public.auditoria_accion FOR SELECT
USING (private.es_admin());

COMMIT;
