import { BadRequestException } from '@nestjs/common';

/** Colombia no usa horario de verano: Bogotá siempre es UTC-5. */
const BOGOTA_OFFSET_MS = -5 * 60 * 60 * 1000;
const STEP_MINUTES = 15;
const LAST_START_MINUTES = 23 * 60 + 45;

/** Un tramo de atención de un día: minutos desde las 00:00 (hora de Bogotá). */
export interface Block {
  /** 1 = lunes ... 7 = domingo (ISO). */
  dia: number;
  inicio: number;
  fin: number;
}

/** "09:15" -> 555. Debe ser múltiplo de 15 minutos. */
export function parseTime(value: unknown, label: string): number {
  const match =
    typeof value === 'string'
      ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value)
      : null;

  if (!match) {
    throw new BadRequestException(`${label} debe tener el formato HH:MM`);
  }

  const minutes = Number(match[1]) * 60 + Number(match[2]);

  if (minutes % STEP_MINUTES !== 0) {
    throw new BadRequestException(
      `${label} debe ser múltiplo de ${STEP_MINUTES} minutos`,
    );
  }

  return minutes;
}

/** 555 -> "09:15". */
export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/**
 * Valida los tramos que envía el barbero y los deja ordenados y unidos: los que
 * se solapan o quedan pegados (9-12 y 12-14) se funden en uno (9-14). Es
 * necesario porque la base solo acepta una cita dentro de UN tramo completo.
 */
export function normalizeBlocks(raw: unknown): Block[] {
  if (!Array.isArray(raw) || raw.length > 100) {
    throw new BadRequestException('La disponibilidad no es válida');
  }

  const blocks: Block[] = raw.map((item: unknown) => {
    const data = (item ?? {}) as Record<string, unknown>;
    const dia = data.dia;

    if (
      typeof dia !== 'number' ||
      !Number.isInteger(dia) ||
      dia < 1 ||
      dia > 7
    ) {
      throw new BadRequestException(
        'El día debe estar entre 1 (lunes) y 7 (domingo)',
      );
    }

    const inicio = parseTime(data.inicio, 'La hora de inicio');
    const fin = parseTime(data.fin, 'La hora de fin');

    if (inicio > LAST_START_MINUTES || fin > LAST_START_MINUTES) {
      throw new BadRequestException(
        'Las horas deben estar entre 00:00 y 23:45',
      );
    }

    if (fin <= inicio) {
      throw new BadRequestException(
        'La hora de fin debe ser posterior a la hora de inicio',
      );
    }

    return { dia, inicio, fin };
  });

  blocks.sort((a, b) => a.dia - b.dia || a.inicio - b.inicio);

  const merged: Block[] = [];
  for (const block of blocks) {
    const last = merged[merged.length - 1];
    if (last && last.dia === block.dia && block.inicio <= last.fin) {
      last.fin = Math.max(last.fin, block.fin);
    } else {
      merged.push({ ...block });
    }
  }

  return merged;
}

/** Fecha, minutos del día y día de la semana (ISO) de un instante, en hora de Bogotá. */
export function bogotaParts(value: string | Date) {
  const instant = typeof value === 'string' ? new Date(value) : value;
  const local = new Date(instant.getTime() + BOGOTA_OFFSET_MS);

  return {
    date: local.toISOString().slice(0, 10),
    minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
    isoDow: ((local.getUTCDay() + 6) % 7) + 1,
  };
}

export function bogotaDate(value: string) {
  return bogotaParts(value).date;
}

export function bogotaHour(value: string) {
  return formatMinutes(bogotaParts(value).minutes);
}

/** "2026-10-20" + "09:30" -> instante (hora de Bogotá). */
export function toInstant(fecha: unknown, hora: unknown): Date {
  if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw new BadRequestException('La fecha debe tener el formato AAAA-MM-DD');
  }

  const minutes = parseTime(hora, 'La hora de inicio');
  const instant = new Date(`${fecha}T${formatMinutes(minutes)}:00-05:00`);

  if (Number.isNaN(instant.getTime())) {
    throw new BadRequestException('La fecha no es válida');
  }

  return instant;
}

/** ¿La cita cabe completa, el mismo día, dentro de un solo tramo de atención? */
export function fitsInBlocks(
  blocks: Block[],
  startIso: string,
  endIso: string,
) {
  const start = bogotaParts(startIso);
  const end = bogotaParts(endIso);

  if (start.date !== end.date) {
    return false;
  }

  return blocks.some(
    (block) =>
      block.dia === start.isoDow &&
      block.inicio <= start.minutes &&
      block.fin >= end.minutes,
  );
}
