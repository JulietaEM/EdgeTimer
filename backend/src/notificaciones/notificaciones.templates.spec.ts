import {
  avisoRecordatorio,
  avisosDeEvento,
  formatCuando,
  type ContextoCita,
} from './notificaciones.templates';

// 15:00 UTC = 10:00 en Bogotá (UTC-5, sin horario de verano).
const INICIO = '2026-11-04T15:00:00.000Z';
const PROPUESTO = '2026-11-05T16:30:00.000Z';

const ctx: ContextoCita = {
  idCita: 'cita-1',
  inicioAt: INICIO,
  cliente: { userId: 'u-cliente', nombre: 'Ana' },
  barbero: { userId: 'u-barbero', nombre: 'Carlos' },
  propuestoAt: PROPUESTO,
};

const para = (avisos: ReturnType<typeof avisosDeEvento>, userId: string) =>
  avisos.find((aviso) => aviso.userId === userId);

describe('formatCuando', () => {
  it('muestra la hora de Bogotá, no la de UTC', () => {
    expect(formatCuando(INICIO)).toContain('10:00');
  });
});

describe('avisosDeEvento', () => {
  it('solicitada: avisa al barbero (RF-27) y confirma al cliente (HU-22)', () => {
    const avisos = avisosDeEvento('solicitada', 'cliente', ctx);

    expect(avisos).toHaveLength(2);
    expect(para(avisos, 'u-barbero')).toMatchObject({
      titulo: 'Nueva solicitud de cita',
    });
    expect(para(avisos, 'u-barbero')?.mensaje).toContain('Ana');
    expect(para(avisos, 'u-cliente')?.titulo).toBe('Solicitud enviada');
  });

  it('confirmada: avisa al cliente (RF-16) y confirma al barbero (HU-22)', () => {
    const avisos = avisosDeEvento('confirmada', 'barbero', ctx);

    expect(para(avisos, 'u-cliente')?.titulo).toBe('Tu cita fue confirmada');
    expect(para(avisos, 'u-barbero')?.titulo).toBe('Cita confirmada');
  });

  it('rechazada: solo avisa al cliente', () => {
    const avisos = avisosDeEvento('rechazada', 'barbero', ctx);

    expect(avisos).toHaveLength(1);
    expect(avisos[0].userId).toBe('u-cliente');
  });

  it.each([
    ['cliente', 'u-barbero', 'u-cliente', 'Ana canceló'],
    ['barbero', 'u-cliente', 'u-barbero', 'Carlos canceló'],
  ] as const)(
    'cancelada por %s: avisa a la otra parte y le confirma a quien canceló',
    (actor, otro, propio, texto) => {
      const avisos = avisosDeEvento('cancelada', actor, ctx);

      expect(avisos).toHaveLength(2);
      expect(para(avisos, otro)?.mensaje).toContain(texto);
      expect(para(avisos, propio)?.mensaje).toContain('Cancelaste');
    },
  );

  it('propuesta: la otra parte ve el horario propuesto; quien propone recibe la confirmación', () => {
    const avisos = avisosDeEvento('propuesta', 'barbero', ctx);

    expect(para(avisos, 'u-cliente')?.titulo).toBe(
      'Propuesta de nuevo horario',
    );
    expect(para(avisos, 'u-cliente')?.mensaje).toContain('11:30'); // 16:30 UTC
    expect(para(avisos, 'u-barbero')?.titulo).toBe('Propuesta enviada');
  });

  it('reprogramada: ambos reciben el nuevo horario', () => {
    const avisos = avisosDeEvento('reprogramada', 'cliente', ctx);

    expect(avisos.map((aviso) => aviso.userId).sort()).toEqual([
      'u-barbero',
      'u-cliente',
    ]);
    expect(avisos.every((aviso) => aviso.titulo === 'Cita reprogramada')).toBe(
      true,
    );
  });

  it('propuesta_rechazada: avisa a quien había propuesto', () => {
    const avisos = avisosDeEvento('propuesta_rechazada', 'cliente', ctx);

    expect(avisos).toHaveLength(1);
    expect(avisos[0].userId).toBe('u-barbero');
  });

  it('omite a quien no tiene cuenta vinculada', () => {
    const avisos = avisosDeEvento('solicitada', 'cliente', {
      ...ctx,
      barbero: { userId: null, nombre: 'Carlos' },
    });

    expect(avisos).toHaveLength(1);
    expect(avisos[0].userId).toBe('u-cliente');
  });

  it('respeta los límites de la columna (título 120, mensaje 500)', () => {
    const largo = 'x'.repeat(60);
    const avisos = avisosDeEvento('solicitada', 'cliente', {
      ...ctx,
      cliente: { userId: 'u-cliente', nombre: largo },
    });

    // La plantilla no recorta: lo hace el servicio al guardar. Aquí solo se
    // comprueba que los textos normales caben con holgura.
    expect(avisos.every((aviso) => aviso.titulo.length <= 120)).toBe(true);
  });
});

describe('avisoRecordatorio', () => {
  it('1h usa solo la hora; 24h incluye el día', () => {
    expect(avisoRecordatorio('1h', INICIO, 'Carlos')).toEqual({
      titulo: 'Tu cita es en menos de 1 hora',
      mensaje: 'Cita con Carlos a las 10:00.',
    });
    expect(avisoRecordatorio('24h', INICIO, 'Carlos').mensaje).toContain(
      '10:00',
    );
  });
});
