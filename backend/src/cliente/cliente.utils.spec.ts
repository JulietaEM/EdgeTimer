import { BadRequestException } from '@nestjs/common';
import {
  addDays,
  computeFreeSlots,
  firstName,
  parseDateRange,
  parseProcedimientoIds,
  summarizeSchedule,
} from './cliente.utils';

describe('summarizeSchedule', () => {
  it('devuelve vacío sin tramos', () => {
    expect(summarizeSchedule([])).toBe('');
  });

  it('agrupa días consecutivos con las mismas horas', () => {
    const blocks = [1, 2, 3, 4, 5].map((dia) => ({
      dia,
      inicio: '08:00',
      fin: '18:00',
    }));

    expect(summarizeSchedule(blocks)).toBe('Lun a Vie 08:00–18:00');
  });

  it('separa grupos con horas distintas y muestra varios tramos del día', () => {
    const blocks = [
      { dia: 1, inicio: '14:00', fin: '18:00' },
      { dia: 1, inicio: '08:00', fin: '12:00' },
      { dia: 2, inicio: '08:00', fin: '12:00' },
      { dia: 2, inicio: '14:00', fin: '18:00' },
      { dia: 6, inicio: '09:00', fin: '13:00' },
    ];

    expect(summarizeSchedule(blocks)).toBe(
      'Lun y Mar 08:00–12:00, 14:00–18:00; Sáb 09:00–13:00',
    );
  });

  it('no agrupa días con el mismo horario si hay un día sin atención en medio', () => {
    const blocks = [
      { dia: 1, inicio: '09:00', fin: '12:00' },
      { dia: 3, inicio: '09:00', fin: '12:00' },
    ];

    expect(summarizeSchedule(blocks)).toBe('Lun 09:00–12:00; Mié 09:00–12:00');
  });
});

describe('firstName', () => {
  it('deja solo el primer nombre', () => {
    expect(firstName('  Ana María Pérez ')).toBe('Ana');
  });

  it('usa "Cliente" si no hay nombre', () => {
    expect(firstName('')).toBe('Cliente');
    expect(firstName(null)).toBe('Cliente');
  });
});

// 2026-11-02 es lunes.
const MONDAY = '2026-11-02';
const LONG_AGO = new Date('2026-10-01T00:00:00Z');
const morning = [{ dia: 1, inicio: 8 * 60, fin: 10 * 60 }];

/** Hora de Bogotá (UTC-5) como instante ISO. */
const at = (fecha: string, hora: string) => `${fecha}T${hora}:00-05:00`;

describe('addDays', () => {
  it('cruza meses y años', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-11-02', 0)).toBe('2026-11-02');
  });
});

describe('parseProcedimientoIds', () => {
  const a = '11111111-1111-4111-8111-111111111111';
  const b = '22222222-2222-4222-8222-222222222222';

  it('lee ids separados por coma, sin repetidos ni espacios', () => {
    expect(parseProcedimientoIds(` ${a}, ${b},${a} `)).toEqual([a, b]);
  });

  it('exige al menos uno', () => {
    expect(() => parseProcedimientoIds(undefined)).toThrow(BadRequestException);
    expect(() => parseProcedimientoIds('')).toThrow(BadRequestException);
    expect(() => parseProcedimientoIds(' , ')).toThrow(BadRequestException);
  });

  it('rechaza ids que no son uuid', () => {
    expect(() => parseProcedimientoIds(`${a},123`)).toThrow(
      BadRequestException,
    );
  });
});

describe('parseDateRange', () => {
  // 2026-10-28 15:00 en Bogotá.
  const now = new Date('2026-10-28T20:00:00Z');

  it('por defecto: desde hoy (Bogotá) durante 14 días', () => {
    expect(parseDateRange({}, now)).toEqual({ desde: '2026-10-28', dias: 14 });
  });

  it('usa la fecha de Bogotá aunque en UTC ya sea el día siguiente', () => {
    const lateNight = new Date('2026-10-29T03:00:00Z'); // 22:00 del 28 en Bogotá
    expect(parseDateRange({}, lateNight).desde).toBe('2026-10-28');
  });

  it('acepta una fecha futura y un número de días válido', () => {
    expect(parseDateRange({ desde: '2026-11-05', dias: '7' }, now)).toEqual({
      desde: '2026-11-05',
      dias: 7,
    });
  });

  it('no deja empezar en el pasado: usa hoy', () => {
    expect(parseDateRange({ desde: '2026-01-01' }, now).desde).toBe(
      '2026-10-28',
    );
  });

  it('rechaza fechas mal formadas o inexistentes', () => {
    expect(() => parseDateRange({ desde: '28/10/2026' }, now)).toThrow(
      BadRequestException,
    );
    expect(() => parseDateRange({ desde: '2026-02-30' }, now)).toThrow(
      BadRequestException,
    );
  });

  it('rechaza días fuera de 1 a 31', () => {
    for (const dias of ['0', '32', '1.5', 'abc']) {
      expect(() => parseDateRange({ dias }, now)).toThrow(BadRequestException);
    }
    expect(parseDateRange({ dias: '31' }, now).dias).toBe(31);
  });
});

describe('computeFreeSlots', () => {
  const slots = (overrides: Partial<Parameters<typeof computeFreeSlots>[0]>) =>
    computeFreeSlots({
      blocks: morning,
      busy: [],
      desde: MONDAY,
      dias: 1,
      duracionMinutos: 30,
      now: LONG_AGO,
      ...overrides,
    });

  it('genera inicios cada 15 minutos mientras la cita quepa en el tramo', () => {
    expect(slots({})).toEqual([
      {
        fecha: MONDAY,
        horas: ['08:00', '08:15', '08:30', '08:45', '09:00', '09:15', '09:30'],
      },
    ]);
  });

  it('una cita más larga deja menos inicios', () => {
    expect(slots({ duracionMinutos: 90 })[0].horas).toEqual([
      '08:00',
      '08:15',
      '08:30',
    ]);
  });

  it('una cita que no cabe en ningún tramo no deja ninguna hora', () => {
    expect(slots({ duracionMinutos: 150 })).toEqual([]);
  });

  it('la cita completa debe caber en UN tramo: no cruza el descanso', () => {
    const split = [
      { dia: 1, inicio: 8 * 60, fin: 9 * 60 },
      { dia: 1, inicio: 10 * 60, fin: 11 * 60 },
    ];
    expect(slots({ blocks: split, duracionMinutos: 45 })[0].horas).toEqual([
      '08:00',
      '08:15',
      '10:00',
      '10:15',
    ]);
  });

  it('quita las horas que se solapan con citas ocupadas (el borde exacto sí es libre)', () => {
    const busy = [
      { inicio_at: at(MONDAY, '09:00'), fin_at: at(MONDAY, '09:30') },
    ];

    expect(slots({ busy })[0].horas).toEqual([
      '08:00',
      '08:15',
      '08:30', // termina justo a las 09:00
      '09:30', // empieza justo cuando termina la otra
    ]);
  });

  it('exige 60 minutos de anticipación', () => {
    // 07:30 en Bogotá: la primera hora posible es 08:30.
    const now = new Date(at(MONDAY, '07:30'));
    expect(slots({ now })[0].horas[0]).toBe('08:30');
  });

  it('un día que ya no tiene horas libres no aparece', () => {
    const now = new Date(at(MONDAY, '09:30'));
    expect(slots({ now })).toEqual([]);
  });

  it('solo incluye los días con tramo y respeta la ventana', () => {
    const week = [1, 3].map((dia) => ({ dia, inicio: 8 * 60, fin: 9 * 60 }));
    const result = slots({ blocks: week, dias: 7 });

    expect(result.map((day) => day.fecha)).toEqual([
      '2026-11-02',
      '2026-11-04',
    ]);
    expect(slots({ blocks: week, dias: 2 }).map((day) => day.fecha)).toEqual([
      '2026-11-02',
    ]);
  });

  it('sin tramos o con duración inválida no hay horas', () => {
    expect(slots({ blocks: [] })).toEqual([]);
    expect(slots({ duracionMinutos: 0 })).toEqual([]);
  });
});
