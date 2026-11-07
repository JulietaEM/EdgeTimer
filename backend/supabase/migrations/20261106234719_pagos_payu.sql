-- EdgeTimer - Entrega A: registro de pagos de citas con PayU.
-- El backend escribe con service_role. authenticated solo puede consultar
-- sus propios pagos y no recibe acceso a la respuesta cruda del proveedor.

BEGIN;

CREATE TABLE public.pago (
  id_pago UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_cita UUID NOT NULL REFERENCES public.cita(id_cita) ON DELETE RESTRICT,
  proveedor TEXT NOT NULL DEFAULT 'payu' CHECK (proveedor = 'payu'),
  referencia TEXT NOT NULL UNIQUE,
  monto NUMERIC(12, 2) NOT NULL CHECK (monto > 0),
  moneda CHAR(3) NOT NULL DEFAULT 'COP' CHECK (moneda = 'COP'),
  estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'aprobado', 'rechazado', 'expirado', 'error', 'anulado')),
  id_transaccion_proveedor TEXT,
  respuesta_proveedor JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  aprobado_at TIMESTAMPTZ
);

CREATE INDEX pago_id_cita_creado_idx
  ON public.pago (id_cita, created_at DESC);

-- Un pago pendiente reserva el intento; uno aprobado bloquea todo nuevo cobro.
CREATE UNIQUE INDEX pago_una_reserva_activa_por_cita_idx
  ON public.pago (id_cita)
  WHERE estado IN ('pendiente', 'aprobado');

ALTER TABLE public.pago ENABLE ROW LEVEL SECURITY;

CREATE POLICY pago_select_cliente_propio
  ON public.pago
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.cita AS ci
      WHERE ci.id_cita = pago.id_cita
        AND private.es_cliente_propio(ci.id_cliente)
    )
  );

REVOKE ALL PRIVILEGES ON TABLE public.pago FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id_pago,
  id_cita,
  proveedor,
  referencia,
  monto,
  moneda,
  estado,
  created_at,
  updated_at,
  aprobado_at
) ON public.pago TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.pago TO service_role;

COMMIT;
