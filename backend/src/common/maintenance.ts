import type { Logger } from '@nestjs/common';
import { supabaseAdmin } from '../supabase';

/** Motivo con el que la base de datos vence las solicitudes sin respuesta. */
export const EXPIRED_REASON = 'Solicitud vencida sin respuesta';

/**
 * Mantenimiento de estados antes de listar: las solicitudes sin respuesta cuya
 * hora ya pasó quedan vencidas y las citas confirmadas que ya terminaron pasan
 * a realizadas. (Más adelante lo hará un job programado.)
 */
export async function markPastCitas(logger?: Logger) {
  for (const fn of ['vencer_solicitudes', 'realizar_citas_vencidas']) {
    const { error } = await supabaseAdmin.rpc(fn);
    if (error) {
      logger?.warn(`No se pudo ejecutar ${fn}: ${error.message}`);
    }
  }
}
