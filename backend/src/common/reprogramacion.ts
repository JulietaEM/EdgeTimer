import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { bogotaDate, bogotaHour, toInstant } from '../barbero/barbero.utils';
import { createSupabaseUserClient, supabaseAdmin } from '../supabase';
import type { AuthUser } from './auth/auth-user';
import { mapCitaError } from './cita-errors';
import { loadFreeDays } from './disponibilidad';

/**
 * Propuestas de cambio de horario. Una cita confirmada NO cambia de hora hasta
 * que la otra parte acepte: quien reprograma crea una propuesta y la cita sigue
 * en su horario original. Al aceptar, la otra parte mueve la cita con SU token,
 * así que la base sigue aplicando sus reglas (quién puede cambiar qué, el mínimo
 * de 1 día, la disponibilidad y los solapes).
 */

const logger = new Logger('Reprogramacion');

export const DAY_MS = 24 * 60 * 60 * 1000;

export type Actor = 'cliente' | 'barbero';

export interface PropuestaRow {
  id_propuesta: string;
  id_cita: string;
  propuesta_por: Actor;
  inicio_at: string;
  fin_at: string;
  estado: string;
}

/** Lo mínimo de la cita sobre la que se propone o se responde. */
export interface CitaContext {
  id_cita: string;
  id_barbero: string;
  id_cliente: string;
  estado: string;
  inicio_at: string;
}

/** La propuesta tal como la ve cada parte. */
export interface PropuestaView {
  id: string;
  propuestaPor: Actor;
  /** La hizo quien mira: puede retirarla. */
  esPropia: boolean;
  /** La hizo la otra parte: quien mira puede aceptarla o rechazarla. */
  puedeResponder: boolean;
  fecha: string;
  horaInicio: string;
  horaFin: string;
}

const SELECT =
  'id_propuesta, id_cita, propuesta_por, inicio_at, fin_at, estado';
const MIN_NOTICE_MESSAGE =
  'Solo puedes cancelar o reprogramar citas con al menos 1 día de antelación';

/** Propuestas pendientes de varias citas (a lo sumo una por cita). */
export async function loadPendientes(
  citaIds: string[],
): Promise<Map<string, PropuestaRow>> {
  const result = new Map<string, PropuestaRow>();
  if (citaIds.length === 0) {
    return result;
  }

  const { data, error } = await supabaseAdmin
    .from('propuesta_reprogramacion')
    .select(SELECT)
    .in('id_cita', citaIds)
    .eq('estado', 'pendiente');

  if (error) {
    throw new InternalServerErrorException(error.message);
  }

  for (const row of (data ?? []) as unknown as PropuestaRow[]) {
    result.set(row.id_cita, row);
  }

  return result;
}

/**
 * Una propuesta solo cuenta mientras se pueda aplicar: la cita sigue confirmada
 * y faltan al menos 24 h para su hora original.
 */
export function propuestaVigente(
  cita: { estado: string; inicio_at: string },
  propuesta: PropuestaRow | undefined,
  now: Date,
): PropuestaRow | null {
  if (!propuesta) return null;
  if (cita.estado !== 'confirmada') return null;
  if (new Date(cita.inicio_at).getTime() - now.getTime() < DAY_MS) return null;
  return propuesta;
}

export function toPropuestaView(
  row: PropuestaRow | null,
  actor: Actor,
): PropuestaView | null {
  if (!row) return null;

  const esPropia = row.propuesta_por === actor;
  return {
    id: row.id_propuesta,
    propuestaPor: row.propuesta_por,
    esPropia,
    puedeResponder: !esPropia,
    fecha: bogotaDate(row.inicio_at),
    horaInicio: bogotaHour(row.inicio_at),
    horaFin: bogotaHour(row.fin_at),
  };
}

/** Crea (o reemplaza la propia) propuesta de nuevo horario para una cita confirmada. */
export async function proponer(input: {
  actor: Actor;
  cita: CitaContext;
  duracionMinutos: number;
  fecha: string;
  horaInicio: string;
  now: Date;
}) {
  const { actor, cita, duracionMinutos, now } = input;

  if (cita.estado !== 'confirmada') {
    throw new ConflictException('Solo se propone cambio en citas confirmadas');
  }

  ensureAtLeastOneDay(cita, now);

  const inicio = toInstant(input.fecha, input.horaInicio);
  if (inicio.getTime() <= now.getTime()) {
    throw new BadRequestException(
      'No se puede programar en una fecha u hora pasada',
    );
  }

  if (inicio.getTime() === new Date(cita.inicio_at).getTime()) {
    throw new BadRequestException('Elige una hora distinta a la actual');
  }

  // La hora se comprueba contra el horario del barbero y las citas de ambos; la
  // propia cita no cuenta como ocupada, así que se puede mover a un tramo contiguo.
  await ensureHoraLibre({
    cita,
    duracionMinutos,
    inicio,
    now,
    message: 'Esa hora ya no está disponible. Elige otra',
  });

  const pendiente = (await loadPendientes([cita.id_cita])).get(cita.id_cita);
  if (pendiente) {
    if (pendiente.propuesta_por !== actor) {
      throw new ConflictException(
        'Ya hay una propuesta pendiente de la otra parte: respóndela primero',
      );
    }
    // La propia propuesta anterior se reemplaza por la nueva.
    await claim(pendiente.id_propuesta, 'retirada');
  }

  const { error } = await supabaseAdmin
    .from('propuesta_reprogramacion')
    .insert({
      id_cita: cita.id_cita,
      propuesta_por: actor,
      inicio_at: inicio.toISOString(),
      fin_at: new Date(
        inicio.getTime() + duracionMinutos * 60_000,
      ).toISOString(),
      estado: 'pendiente',
    });

  if (error) {
    if (error.code === '23505') {
      throw new ConflictException(
        'Ya hay una propuesta pendiente para esta cita',
      );
    }
    throw new InternalServerErrorException(error.message);
  }
}

/** La otra parte acepta: la cita se mueve con el token de quien acepta. */
export async function aceptar(input: {
  user: AuthUser;
  actor: Actor;
  cita: CitaContext;
  duracionMinutos: number;
  now: Date;
}) {
  const { user, actor, cita, duracionMinutos, now } = input;
  const propuesta = await findRespondible(actor, cita);

  if (
    cita.estado !== 'confirmada' ||
    new Date(cita.inicio_at).getTime() - now.getTime() < DAY_MS
  ) {
    await claim(propuesta.id_propuesta, 'vencida');
    throw new ConflictException(
      'La propuesta venció: la cita ya no se puede mover',
    );
  }

  const inicio = new Date(propuesta.inicio_at);
  if (inicio.getTime() <= now.getTime()) {
    await claim(propuesta.id_propuesta, 'vencida');
    throw new ConflictException('La propuesta venció: esa hora ya pasó');
  }

  // Pudo ocuparse mientras la propuesta esperaba respuesta.
  await ensureHoraLibre({
    cita,
    duracionMinutos,
    inicio,
    now,
    message:
      'Esa hora ya no está disponible. Rechaza la propuesta o pide que propongan otra',
  });

  // Se reclama primero: si dos personas responden a la vez, solo una gana.
  if (!(await claim(propuesta.id_propuesta, 'aceptada'))) {
    throw new ConflictException('Esta propuesta ya fue respondida');
  }

  const column = actor === 'cliente' ? 'id_cliente' : 'id_barbero';
  const { data, error } = await createSupabaseUserClient(user.accessToken)
    .from('cita')
    .update({ inicio_at: propuesta.inicio_at, fin_at: propuesta.fin_at })
    .eq('id_cita', cita.id_cita)
    .eq(column, user.profileId)
    .select('id_cita')
    .maybeSingle<{ id_cita: string }>();

  if (error || !data) {
    await restore(propuesta.id_propuesta);

    if (error) {
      throw mapCitaError(error.message, actor);
    }
    throw new ConflictException(
      'La cita cambió y ya no se puede actualizar. Recarga la lista.',
    );
  }
}

/** La otra parte rechaza: la cita queda en su horario original. */
export async function rechazar(actor: Actor, cita: CitaContext) {
  const propuesta = await findRespondible(actor, cita);

  if (!(await claim(propuesta.id_propuesta, 'rechazada'))) {
    throw new ConflictException('Esta propuesta ya fue respondida');
  }
}

/** Quien propuso la retira. */
export async function retirar(actor: Actor, cita: CitaContext) {
  const propuesta = await findPendiente(cita);

  if (propuesta.propuesta_por !== actor) {
    throw new ForbiddenException(
      'Solo quien hizo la propuesta puede retirarla',
    );
  }

  if (!(await claim(propuesta.id_propuesta, 'retirada'))) {
    throw new ConflictException('Esta propuesta ya fue respondida');
  }
}

// -------------------------------------------------------------------------

function ensureAtLeastOneDay(cita: CitaContext, now: Date) {
  if (new Date(cita.inicio_at).getTime() - now.getTime() < DAY_MS) {
    throw new BadRequestException(MIN_NOTICE_MESSAGE);
  }
}

async function ensureHoraLibre(input: {
  cita: CitaContext;
  duracionMinutos: number;
  inicio: Date;
  now: Date;
  message: string;
}) {
  const { cita, duracionMinutos, inicio, now, message } = input;
  const fecha = bogotaDate(inicio.toISOString());
  const dias = await loadFreeDays({
    barberoId: cita.id_barbero,
    clienteId: cita.id_cliente,
    duracionMinutos,
    desde: fecha,
    dias: 1,
    excluirCita: cita.id_cita,
    now,
  });
  const libre = dias
    .find((dia) => dia.fecha === fecha)
    ?.horas.includes(bogotaHour(inicio.toISOString()));

  if (!libre) {
    throw new ConflictException(message);
  }
}

async function findPendiente(cita: CitaContext): Promise<PropuestaRow> {
  const propuesta = (await loadPendientes([cita.id_cita])).get(cita.id_cita);

  if (!propuesta) {
    throw new NotFoundException(
      'No hay una propuesta pendiente para esta cita',
    );
  }

  return propuesta;
}

/** La propuesta pendiente que le toca responder a `actor` (la hizo la otra parte). */
async function findRespondible(actor: Actor, cita: CitaContext) {
  const propuesta = await findPendiente(cita);

  if (propuesta.propuesta_por === actor) {
    throw new ForbiddenException('No puedes responder a tu propia propuesta');
  }

  return propuesta;
}

/** Cambia el estado solo si sigue pendiente. Devuelve false si alguien se adelantó. */
async function claim(id: string, estado: string) {
  const { data, error } = await supabaseAdmin
    .from('propuesta_reprogramacion')
    .update({ estado, respondida_at: new Date().toISOString() })
    .eq('id_propuesta', id)
    .eq('estado', 'pendiente')
    .select('id_propuesta')
    .maybeSingle();

  if (error) {
    throw new InternalServerErrorException(error.message);
  }

  return !!data;
}

/** Deshace una aceptación cuando la cita no se pudo mover. */
async function restore(id: string) {
  const { error } = await supabaseAdmin
    .from('propuesta_reprogramacion')
    .update({ estado: 'pendiente', respondida_at: null })
    .eq('id_propuesta', id)
    .eq('estado', 'aceptada');

  if (error) {
    logger.warn(`No se pudo restaurar la propuesta ${id}: ${error.message}`);
  }
}
