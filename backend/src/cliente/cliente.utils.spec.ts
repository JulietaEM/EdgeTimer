import { firstName, summarizeSchedule } from './cliente.utils';

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
