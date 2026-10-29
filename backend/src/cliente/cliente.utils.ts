import { BadRequestException } from '@nestjs/common';
import { isUuid } from '../admin/admin.utils';
import {
  bogotaParts,
  formatMinutes,
  type Block,
} from '../barbero/barbero.utils';

const DAY_NAMES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export interface ScheduleBlock {
  /** 1 = lunes ... 7 = domingo (ISO). */
  dia: number;
  inicio: string;
  fin: string;
}

/**
 * Resume el horario semanal para mostrarlo en una línea: agrupa los días
 * consecutivos con las mismas horas ("Lun a Vie 08:00–12:00, 14:00–18:00; Sáb 09:00–13:00").
 */
export function summarizeSchedule(blocks: ScheduleBlock[]): string {
  const byDay = new Map<number, string[]>();

  [...blocks]
    .filter((block) => block.dia >= 1 && block.dia <= 7)
    .sort((a, b) => a.dia - b.dia || a.inicio.localeCompare(b.inicio))
    .forEach((block) => {
      const list = byDay.get(block.dia) ?? [];
      list.push(`${block.inicio}–${block.fin}`);
      byDay.set(block.dia, list);
    });

  const groups: { days: number[]; hours: string }[] = [];

  for (const [dia, ranges] of [...byDay.entries()].sort(
    (a, b) => a[0] - b[0],
  )) {
    const hours = ranges.join(', ');
    const last = groups[groups.length - 1];

    if (
      last &&
      last.hours === hours &&
      last.days[last.days.length - 1] === dia - 1
    ) {
      last.days.push(dia);
    } else {
      groups.push({ days: [dia], hours });
    }
  }

  return groups
    .map(({ days, hours }) => {
      const first = DAY_NAMES[days[0] - 1];
      const last = DAY_NAMES[days[days.length - 1] - 1];
      const label =
        days.length === 1
          ? first
          : days.length === 2
            ? `${first} y ${last}`
            : `${first} a ${last}`;
      return `${label} ${hours}`;
    })
    .join('; ');
}

/** Primer nombre: las reseñas públicas no muestran el nombre completo del cliente. */
export function firstName(value: string | null | undefined): string {
  return value?.trim().split(/\s+/)[0] || 'Cliente';
}

// ---------------------------------------------------------------------------
// HU-19: horas disponibles
// ---------------------------------------------------------------------------

/** Las citas empiezan cada 15 minutos. */
export const SLOT_STEP_MINUTES = 15;
/** Anticipación mínima para agendar: 60 minutos. */
export const MIN_LEAD_MINUTES = 60;
export const DEFAULT_DIAS = 14;
export const MAX_DIAS = 31;
const MAX_PROCEDIMIENTOS = 20;

export interface BusyRange {
  inicio_at: string;
  fin_at: string;
}

export interface DiaDisponible {
  fecha: string;
  horas: string[];
}

/** "2026-10-30" + 3 -> "2026-11-02". */
export function addDays(fecha: string, days: number): string {
  const [year, month, day] = fecha.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

function isRealDate(fecha: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Lee `?procedimientos=id1,id2`: sin repetidos, todos uuid y al menos uno. */
export function parseProcedimientoIds(raw: unknown): string[] {
  const ids =
    typeof raw === 'string'
      ? [
          ...new Set(
            raw
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean),
          ),
        ]
      : [];

  if (ids.length === 0) {
    throw new BadRequestException('Selecciona al menos un procedimiento');
  }

  if (ids.length > MAX_PROCEDIMIENTOS || !ids.every((id) => isUuid(id))) {
    throw new BadRequestException('Los procedimientos no son válidos');
  }

  return ids;
}

/**
 * Lee `?desde=AAAA-MM-DD&dias=N`. Por defecto empieza hoy (hora de Bogotá) y
 * dura 14 días; no se puede empezar en el pasado ni pedir más de 31 días.
 */
export function parseDateRange(
  query: { desde?: unknown; dias?: unknown },
  now: Date,
): { desde: string; dias: number } {
  const today = bogotaParts(now).date;
  let desde = today;

  if (query.desde !== undefined && query.desde !== '') {
    if (typeof query.desde !== 'string' || !isRealDate(query.desde)) {
      throw new BadRequestException(
        'La fecha debe tener el formato AAAA-MM-DD',
      );
    }
    desde = query.desde < today ? today : query.desde;
  }

  let dias = DEFAULT_DIAS;
  if (query.dias !== undefined && query.dias !== '') {
    dias = Number(query.dias);
    if (!Number.isInteger(dias) || dias < 1 || dias > MAX_DIAS) {
      throw new BadRequestException(
        `Los días deben estar entre 1 y ${MAX_DIAS}`,
      );
    }
  }

  return { desde, dias };
}

/**
 * Horas de inicio libres para una cita de `duracionMinutos`:
 * - la cita completa cabe en UN tramo de atención del mismo día,
 * - empieza en bloques de 15 minutos y con al menos 60 minutos de anticipación,
 * - no se solapa con ninguna cita activa (del barbero o del cliente).
 * Solo devuelve los días que tienen alguna hora libre.
 */
export function computeFreeSlots(input: {
  blocks: Block[];
  busy: BusyRange[];
  desde: string;
  dias: number;
  duracionMinutos: number;
  now: Date;
}): DiaDisponible[] {
  const { blocks, busy, desde, dias, duracionMinutos, now } = input;
  const earliest = now.getTime() + MIN_LEAD_MINUTES * 60_000;
  const durationMs = duracionMinutos * 60_000;
  const busyMs = busy.map((range) => ({
    start: new Date(range.inicio_at).getTime(),
    end: new Date(range.fin_at).getTime(),
  }));
  const result: DiaDisponible[] = [];

  if (!(duracionMinutos > 0)) {
    return result;
  }

  for (let offset = 0; offset < dias; offset++) {
    const fecha = addDays(desde, offset);
    const dow = bogotaParts(new Date(`${fecha}T12:00:00-05:00`)).isoDow;
    const horas: string[] = [];

    for (const block of blocks.filter((item) => item.dia === dow)) {
      for (
        let start = block.inicio;
        start + duracionMinutos <= block.fin;
        start += SLOT_STEP_MINUTES
      ) {
        const hora = formatMinutes(start);
        const startMs = new Date(`${fecha}T${hora}:00-05:00`).getTime();
        const endMs = startMs + durationMs;

        if (startMs < earliest) continue;
        if (
          busyMs.some((range) => range.start < endMs && range.end > startMs)
        ) {
          continue;
        }

        horas.push(hora);
      }
    }

    if (horas.length > 0) {
      result.push({ fecha, horas: horas.sort() });
    }
  }

  return result;
}
