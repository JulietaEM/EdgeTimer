import { BadRequestException } from '@nestjs/common';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** Valida una lista de ids (uuid, sin repetidos, máximo 50). undefined = no enviada. */
export function normalizeIds(value: unknown): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value) || value.length > 50) {
    throw new BadRequestException('La lista de procedimientos no es válida');
  }

  const ids = value.map((item) => {
    if (typeof item !== 'string' || !UUID_PATTERN.test(item)) {
      throw new BadRequestException('Hay un procedimiento con un id inválido');
    }
    return item.toLowerCase();
  });

  return [...new Set(ids)];
}

/** Qué agregar y qué quitar para pasar de la lista actual a la nueva. */
export function diffIds(current: string[], next: string[]) {
  const currentSet = new Set(current);
  const nextSet = new Set(next);

  return {
    toAdd: next.filter((id) => !currentSet.has(id)),
    toRemove: current.filter((id) => !nextSet.has(id)),
  };
}

const MAX_PRICE = 10_000_000;
const SLOT_MINUTES = 15;
const MAX_DURATION = 480;

/** Precio en pesos: entero entre 0 y 10.000.000 (acepta número o texto numérico). */
export function parsePrice(value: unknown): number {
  const price =
    typeof value === 'string' && value.trim() !== '' ? Number(value) : value;

  if (typeof price !== 'number' || !Number.isInteger(price)) {
    throw new BadRequestException(
      'El precio debe ser un número entero en pesos',
    );
  }

  if (price < 0 || price > MAX_PRICE) {
    throw new BadRequestException(
      'El precio debe estar entre $0 y $10.000.000',
    );
  }

  return price;
}

/** Duración en minutos: múltiplo de 15 (la agenda trabaja en bloques de 15 min), máximo 8 horas. */
export function parseDuration(value: unknown): number {
  const minutes =
    typeof value === 'string' && value.trim() !== '' ? Number(value) : value;

  if (typeof minutes !== 'number' || !Number.isInteger(minutes)) {
    throw new BadRequestException('La duración debe ser un número de minutos');
  }

  if (
    minutes < SLOT_MINUTES ||
    minutes > MAX_DURATION ||
    minutes % SLOT_MINUTES !== 0
  ) {
    throw new BadRequestException(
      `La duración debe ser múltiplo de ${SLOT_MINUTES} minutos, entre ${SLOT_MINUTES} y ${MAX_DURATION}`,
    );
  }

  return minutes;
}

/** Paginación segura: offset >= 0 y límite entre 1 y 50 (por defecto 20). */
export function parsePage(offset: unknown, limit: unknown) {
  const toInt = (value: unknown, fallback: number) => {
    if (value === undefined || value === null || value === '') return fallback;
    const n = Number(value);
    if (!Number.isInteger(n)) {
      throw new BadRequestException('Paginación inválida');
    }
    return n;
  };

  return {
    offset: Math.max(0, toInt(offset, 0)),
    limit: Math.min(50, Math.max(1, toInt(limit, 20))),
  };
}
