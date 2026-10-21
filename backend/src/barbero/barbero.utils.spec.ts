import { BadRequestException } from '@nestjs/common';
import {
  bogotaDate,
  bogotaHour,
  bogotaParts,
  fitsInBlocks,
  formatMinutes,
  normalizeBlocks,
  parseTime,
  toInstant,
} from './barbero.utils';

const bloque = (dia: number, inicio: string, fin: string) => ({
  dia,
  inicio,
  fin,
});

describe('barbero.utils', () => {
  describe('parseTime y formatMinutes', () => {
    it('convierte HH:MM a minutos y de vuelta', () => {
      expect(parseTime('09:15', 'x')).toBe(555);
      expect(formatMinutes(555)).toBe('09:15');
      expect(formatMinutes(0)).toBe('00:00');
    });

    it.each([
      ['9:00'],
      ['24:00'],
      ['09:60'],
      ['09:10'],
      [''],
      [900],
      [undefined],
    ])('rechaza %p', (value) => {
      expect(() => parseTime(value, 'La hora')).toThrow(BadRequestException);
    });
  });

  describe('normalizeBlocks', () => {
    it('ordena los tramos por día y hora', () => {
      expect(
        normalizeBlocks([
          bloque(3, '14:00', '18:00'),
          bloque(1, '09:00', '12:00'),
        ]),
      ).toEqual([
        { dia: 1, inicio: 540, fin: 720 },
        { dia: 3, inicio: 840, fin: 1080 },
      ]);
    });

    it('une tramos pegados y solapados del mismo día', () => {
      expect(
        normalizeBlocks([
          bloque(1, '09:00', '12:00'),
          bloque(1, '12:00', '14:00'),
          bloque(1, '13:00', '15:00'),
        ]),
      ).toEqual([{ dia: 1, inicio: 540, fin: 900 }]);
    });

    it('no une tramos con un descanso en medio ni de días distintos', () => {
      expect(
        normalizeBlocks([
          bloque(1, '09:00', '12:00'),
          bloque(1, '13:00', '17:00'),
          bloque(2, '09:00', '12:00'),
        ]),
      ).toHaveLength(3);
    });

    it('acepta una lista vacía (sin disponibilidad)', () => {
      expect(normalizeBlocks([])).toEqual([]);
    });

    it.each([
      ['no es lista', 'x'],
      ['día 0', [bloque(0, '09:00', '10:00')]],
      ['día 8', [bloque(8, '09:00', '10:00')]],
      ['fin antes del inicio', [bloque(1, '10:00', '09:00')]],
      ['fin igual al inicio', [bloque(1, '10:00', '10:00')]],
      ['hora fuera de la cuadrícula', [bloque(1, '09:10', '10:00')]],
      ['hora pasada de las 23:45', [bloque(1, '09:00', '23:59')]],
      ['más de 100 tramos', Array(101).fill(bloque(1, '09:00', '10:00'))],
    ])('rechaza: %s', (_label, value) => {
      expect(() => normalizeBlocks(value)).toThrow(BadRequestException);
    });
  });

  describe('hora de Bogotá', () => {
    it('convierte un instante UTC a fecha, hora y día ISO de Bogotá', () => {
      // martes 20 de octubre de 2026, 15:00 UTC = 10:00 en Bogotá
      expect(bogotaParts('2026-10-20T15:00:00Z')).toEqual({
        date: '2026-10-20',
        minutes: 600,
        isoDow: 2,
      });
      expect(bogotaHour('2026-10-20T15:00:00Z')).toBe('10:00');
    });

    it('respeta el cambio de día: 03:00 UTC es la noche anterior en Bogotá', () => {
      expect(bogotaDate('2026-10-21T03:00:00Z')).toBe('2026-10-20');
      expect(bogotaHour('2026-10-21T03:00:00Z')).toBe('22:00');
    });

    it('calcula bien lunes (1) y domingo (7)', () => {
      expect(bogotaParts('2026-10-19T15:00:00Z').isoDow).toBe(1);
      expect(bogotaParts('2026-10-25T15:00:00Z').isoDow).toBe(7);
    });
  });

  describe('toInstant', () => {
    it('interpreta fecha y hora como hora de Bogotá', () => {
      expect(toInstant('2026-10-20', '10:00').toISOString()).toBe(
        '2026-10-20T15:00:00.000Z',
      );
    });

    it.each([['20/10/2026'], [''], [undefined]])(
      'rechaza la fecha %p',
      (fecha) => {
        expect(() => toInstant(fecha, '10:00')).toThrow(BadRequestException);
      },
    );

    it('rechaza una hora inválida', () => {
      expect(() => toInstant('2026-10-20', '25:00')).toThrow(
        BadRequestException,
      );
    });
  });

  describe('fitsInBlocks', () => {
    // martes 09:00-13:00 y 14:00-18:00
    const blocks = normalizeBlocks([
      bloque(2, '09:00', '13:00'),
      bloque(2, '14:00', '18:00'),
    ]);

    it('acepta una cita completa dentro de un tramo', () => {
      expect(
        fitsInBlocks(blocks, '2026-10-20T15:00:00Z', '2026-10-20T16:00:00Z'),
      ).toBe(true);
    });

    it('rechaza una cita que cruza el descanso', () => {
      // 12:30-14:30 hora de Bogotá
      expect(
        fitsInBlocks(blocks, '2026-10-20T17:30:00Z', '2026-10-20T19:30:00Z'),
      ).toBe(false);
    });

    it('rechaza otro día de la semana', () => {
      expect(
        fitsInBlocks(blocks, '2026-10-21T15:00:00Z', '2026-10-21T16:00:00Z'),
      ).toBe(false);
    });

    it('acepta una cita que termina justo al cierre del tramo', () => {
      // 12:00-13:00
      expect(
        fitsInBlocks(blocks, '2026-10-20T17:00:00Z', '2026-10-20T18:00:00Z'),
      ).toBe(true);
    });

    it('rechaza una cita que pasa de un día al siguiente', () => {
      expect(
        fitsInBlocks(blocks, '2026-10-21T04:30:00Z', '2026-10-21T05:30:00Z'),
      ).toBe(false);
    });
  });
});
