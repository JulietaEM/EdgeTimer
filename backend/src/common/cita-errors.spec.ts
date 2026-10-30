import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { mapCitaError } from './cita-errors';

describe('mapCitaError', () => {
  it('el solape de agenda cambia según quién actúa', () => {
    const barbero = mapCitaError(
      'violates no_citas_solapadas_barbero',
      'barbero',
    );
    const cliente = mapCitaError(
      'violates no_citas_solapadas_barbero',
      'cliente',
    );

    expect(barbero).toBeInstanceOf(ConflictException);
    expect(barbero.message).toBe('Ya tienes otra cita en ese horario');
    expect(cliente).toBeInstanceOf(ConflictException);
    expect(cliente.message).toBe('Ese horario acaba de ocuparse. Elige otro');
  });

  it('el solape del cliente también depende de quién actúa', () => {
    expect(mapCitaError('no_citas_solapadas_cliente', 'barbero').message).toBe(
      'El cliente ya tiene otra cita en ese horario',
    );
    expect(mapCitaError('no_citas_solapadas_cliente', 'cliente').message).toBe(
      'Ya tienes otra cita en ese horario',
    );
  });

  it('traduce la disponibilidad configurada del barbero', () => {
    const message =
      'La cita debe estar dentro de la disponibilidad configurada del barbero';

    expect(mapCitaError(message, 'barbero').message).toBe(
      'Ese horario queda fuera de tu disponibilidad',
    );
    expect(mapCitaError(message, 'cliente')).toBeInstanceOf(
      BadRequestException,
    );
    expect(mapCitaError(message, 'cliente').message).toBe(
      'Ese horario queda fuera de la disponibilidad del barbero',
    );
  });

  it('traduce anticipación, fechas pasadas y procedimientos', () => {
    expect(mapCitaError('falta anticipacion minima', 'cliente').message).toBe(
      'Solo puedes cancelar o reprogramar citas con al menos 1 día de antelación',
    );
    expect(
      mapCitaError(
        'No se pueden crear citas en fechas u horarios pasados',
        'cliente',
      ).message,
    ).toBe('No se puede programar en una fecha u hora pasada');
    expect(
      mapCitaError('El procedimiento no esta activo', 'cliente').message,
    ).toBe('Alguno de los procedimientos ya no está disponible');
  });

  it('los permisos son 403 y lo desconocido es 500 con el mensaje original', () => {
    expect(
      mapCitaError('No tienes permisos para hacer esta transicion', 'cliente'),
    ).toBeInstanceOf(ForbiddenException);

    const unknown = mapCitaError('algo raro', 'cliente');
    expect(unknown).toBeInstanceOf(InternalServerErrorException);
    expect(unknown.message).toBe('algo raro');
  });
});
