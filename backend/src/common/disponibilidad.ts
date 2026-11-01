import { InternalServerErrorException } from '@nestjs/common';
import {
  addDays,
  computeFreeSlots,
  type BusyRange,
  type DiaDisponible,
  type ScheduleBlock,
} from '../cliente/cliente.utils';
import { supabaseAdmin } from '../supabase';

interface DisponibilidadRow {
  id_barbero: string;
  dia_semana: number;
  hora_inicio: string;
  hora_fin: string;
}

/** Tramos semanales activos, agrupados por barbero. */
export async function loadSchedules(barberoIds: string[]) {
  const result = new Map<string, ScheduleBlock[]>();
  if (barberoIds.length === 0) {
    return result;
  }

  const { data, error } = await supabaseAdmin
    .from('disponibilidad_barbero')
    .select('id_barbero, dia_semana, hora_inicio, hora_fin')
    .in('id_barbero', barberoIds)
    .eq('activo', true);

  if (error) {
    throw new InternalServerErrorException(error.message);
  }

  for (const row of (data ?? []) as unknown as DisponibilidadRow[]) {
    const list = result.get(row.id_barbero) ?? [];
    list.push({
      dia: row.dia_semana,
      inicio: row.hora_inicio.slice(0, 5),
      fin: row.hora_fin.slice(0, 5),
    });
    result.set(row.id_barbero, list);
  }

  return result;
}

/** Citas activas (pendientes o confirmadas) que aún no terminan dentro de la ventana. */
export async function loadBusy(
  column: 'id_barbero' | 'id_cliente',
  id: string,
  now: Date,
  windowEnd: Date,
  excluirCita: string | null,
): Promise<BusyRange[]> {
  let request = supabaseAdmin
    .from('cita')
    .select('inicio_at, fin_at')
    .eq(column, id)
    .in('estado', ['pendiente', 'confirmada'])
    .gt('fin_at', now.toISOString())
    .lt('inicio_at', windowEnd.toISOString());

  if (excluirCita) {
    request = request.neq('id_cita', excluirCita);
  }

  const { data, error } = await request;

  if (error) {
    throw new InternalServerErrorException(error.message);
  }

  return data ?? [];
}

function toMinutes(hora: string) {
  const [hours, minutes] = hora.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Días y horas de inicio libres para una cita de `duracionMinutos` entre un
 * barbero y un cliente: su horario semanal menos las citas activas de AMBOS.
 * `excluirCita` es la cita que se está moviendo: su horario actual cuenta libre.
 */
export async function loadFreeDays(input: {
  barberoId: string;
  clienteId: string;
  duracionMinutos: number;
  desde: string;
  dias: number;
  excluirCita: string | null;
  now: Date;
}): Promise<DiaDisponible[]> {
  const {
    barberoId,
    clienteId,
    duracionMinutos,
    desde,
    dias,
    excluirCita,
    now,
  } = input;

  const schedule = (await loadSchedules([barberoId])).get(barberoId) ?? [];
  if (schedule.length === 0) {
    return [];
  }

  const windowEnd = new Date(`${addDays(desde, dias)}T00:00:00-05:00`);
  const [barberoBusy, clienteBusy] = await Promise.all([
    loadBusy('id_barbero', barberoId, now, windowEnd, excluirCita),
    loadBusy('id_cliente', clienteId, now, windowEnd, excluirCita),
  ]);

  return computeFreeSlots({
    blocks: schedule.map((block) => ({
      dia: block.dia,
      inicio: toMinutes(block.inicio),
      fin: toMinutes(block.fin),
    })),
    busy: [...barberoBusy, ...clienteBusy],
    desde,
    dias,
    duracionMinutos,
    now,
  });
}
