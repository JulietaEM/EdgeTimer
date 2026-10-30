import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  type HttpException,
} from '@nestjs/common';

/** Quién ejecuta la acción: cambia el "tú" de los mensajes. */
export type CitaActor = 'barbero' | 'cliente';

/**
 * Traduce los mensajes de las reglas de la base de datos (restricciones de
 * solapes y triggers de `cita`) a respuestas claras para quien actúa.
 */
export function mapCitaError(message: string, actor: CitaActor): HttpException {
  const isBarbero = actor === 'barbero';

  if (message.includes('no_citas_solapadas_barbero')) {
    return new ConflictException(
      isBarbero
        ? 'Ya tienes otra cita en ese horario'
        : 'Ese horario acaba de ocuparse. Elige otro',
    );
  }
  if (message.includes('no_citas_solapadas_cliente')) {
    return new ConflictException(
      isBarbero
        ? 'El cliente ya tiene otra cita en ese horario'
        : 'Ya tienes otra cita en ese horario',
    );
  }
  if (/disponibilidad/i.test(message)) {
    return new BadRequestException(
      isBarbero
        ? 'Ese horario queda fuera de tu disponibilidad'
        : 'Ese horario queda fuera de la disponibilidad del barbero',
    );
  }
  if (/anticipacion/i.test(message)) {
    return new BadRequestException(
      'Solo puedes cancelar o reprogramar citas con al menos 1 día de antelación',
    );
  }
  if (/pasad/i.test(message)) {
    return new BadRequestException(
      'No se puede programar en una fecha u hora pasada',
    );
  }
  if (/procedimiento/i.test(message)) {
    return new BadRequestException(
      'Alguno de los procedimientos ya no está disponible',
    );
  }
  if (/permisos|transicion/i.test(message)) {
    return new ForbiddenException('No tienes permisos para este cambio');
  }
  return new InternalServerErrorException(message);
}
