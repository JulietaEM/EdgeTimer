import { BadRequestException } from '@nestjs/common';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
