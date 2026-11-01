import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

// supabase.ts exige variables de entorno al importarse.
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_KEY = 'anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

import { fakeAdmin, fakeUser, type Results } from '../test-utils/fake-supabase';
import type { AuthUser } from './auth/auth-user';
import {
  aceptar,
  loadPendientes,
  propuestaVigente,
  proponer,
  rechazar,
  retirar,
  toPropuestaView,
  type CitaContext,
  type PropuestaRow,
} from './reprogramacion';

const CITA_ID = '99999999-9999-4999-8999-999999999999';
const BARBERO_ID = '33333333-3333-4333-8333-333333333333';
const CLIENTE_ID = '55555555-5555-4555-8555-555555555555';
const PROPUESTA_ID = '77777777-7777-4777-8777-777777777777';

// Miércoles 2026-10-28 12:00 en Bogotá. El lunes siguiente es 2026-11-02.
const NOW = new Date('2026-10-28T17:00:00Z');

const cita = (overrides: Partial<CitaContext> = {}): CitaContext => ({
  id_cita: CITA_ID,
  id_barbero: BARBERO_ID,
  id_cliente: CLIENTE_ID,
  estado: 'confirmada',
  inicio_at: '2026-11-02T13:00:00Z', // lunes 08:00 Bogotá
  ...overrides,
});

const propuestaRow = (overrides: Partial<PropuestaRow> = {}): PropuestaRow => ({
  id_propuesta: PROPUESTA_ID,
  id_cita: CITA_ID,
  propuesta_por: 'barbero',
  inicio_at: '2026-11-02T14:00:00Z', // lunes 09:00 Bogotá
  fin_at: '2026-11-02T14:30:00Z',
  estado: 'pendiente',
  ...overrides,
});

const lunes = [
  {
    id_barbero: BARBERO_ID,
    dia_semana: 1,
    hora_inicio: '08:00:00',
    hora_fin: '10:00:00',
  },
];

/** Base de datos con el horario de lunes y las citas ocupadas indicadas. */
const db = (extra: Results = {}, busy: unknown[] = []): Results => ({
  disponibilidad_barbero: { data: lunes },
  cita: { data: busy },
  ...extra,
});

const user = {
  profileId: CLIENTE_ID,
  userId: 'u1',
  accessToken: 'token-de-quien-acepta',
} as AuthUser;

afterEach(() => {
  jest.restoreAllMocks();
});

describe('propuestaVigente / toPropuestaView', () => {
  it('solo cuenta mientras la cita siga confirmada y falte 1 día o más', () => {
    const row = propuestaRow();

    expect(propuestaVigente(cita(), row, NOW)).toBe(row);
    expect(
      propuestaVigente(cita({ estado: 'cancelada' }), row, NOW),
    ).toBeNull();
    expect(
      propuestaVigente(cita({ inicio_at: '2026-10-29T10:00:00Z' }), row, NOW),
    ).toBeNull();
    expect(propuestaVigente(cita(), undefined, NOW)).toBeNull();
  });

  it('cada parte la ve distinto: quien propone la retira, la otra responde', () => {
    const row = propuestaRow({ propuesta_por: 'barbero' });

    expect(toPropuestaView(row, 'barbero')).toMatchObject({
      esPropia: true,
      puedeResponder: false,
      propuestaPor: 'barbero',
      fecha: '2026-11-02',
      horaInicio: '09:00',
      horaFin: '09:30',
    });
    expect(toPropuestaView(row, 'cliente')).toMatchObject({
      esPropia: false,
      puedeResponder: true,
    });
    expect(toPropuestaView(null, 'cliente')).toBeNull();
  });
});

describe('loadPendientes', () => {
  it('no consulta si no hay citas y agrupa por cita', async () => {
    const calls = fakeAdmin({});
    expect((await loadPendientes([])).size).toBe(0);
    expect(calls).toHaveLength(0);

    fakeAdmin({ propuesta_reprogramacion: { data: [propuestaRow()] } });
    const map = await loadPendientes([CITA_ID]);
    expect(map.get(CITA_ID)?.id_propuesta).toBe(PROPUESTA_ID);
  });
});

describe('proponer', () => {
  const input = {
    actor: 'barbero' as const,
    cita: cita(),
    duracionMinutos: 30,
    fecha: '2026-11-02',
    horaInicio: '09:00',
    now: NOW,
  };

  it('crea la propuesta sin mover la cita', async () => {
    const calls = fakeAdmin(
      db({ propuesta_reprogramacion: [{ data: [] }, { error: null }] }),
    );

    await proponer(input);

    expect(calls).toContainEqual({
      table: 'propuesta_reprogramacion',
      method: 'insert',
      args: [
        {
          id_cita: CITA_ID,
          propuesta_por: 'barbero',
          inicio_at: '2026-11-02T14:00:00.000Z', // 09:00 Bogotá
          fin_at: '2026-11-02T14:30:00.000Z', // misma duración
          estado: 'pendiente',
        },
      ],
    });
    // Nunca se escribe sobre la cita.
    expect(
      calls.some((call) => call.table === 'cita' && call.method === 'update'),
    ).toBe(false);
  });

  it('la propia cita no cuenta como ocupada al buscar la hora', async () => {
    const calls = fakeAdmin(
      db({ propuesta_reprogramacion: [{ data: [] }, { error: null }] }),
    );

    await proponer(input);

    expect(
      calls.filter((c) => c.method === 'neq' && c.args[1] === CITA_ID),
    ).toHaveLength(2); // barbero y cliente
    expect(calls).toContainEqual({
      table: 'cita',
      method: 'eq',
      args: ['id_cliente', CLIENTE_ID],
    });
  });

  it('reemplaza la propuesta anterior de la misma persona', async () => {
    const calls = fakeAdmin(
      db({
        propuesta_reprogramacion: [
          { data: [propuestaRow({ propuesta_por: 'barbero' })] }, // pendiente
          { data: { id_propuesta: PROPUESTA_ID } }, // claim 'retirada'
          { error: null }, // insert
        ],
      }),
    );

    await proponer(input);

    expect(calls).toContainEqual({
      table: 'propuesta_reprogramacion',
      method: 'update',
      args: [expect.objectContaining({ estado: 'retirada' })],
    });
    expect(calls.filter((c) => c.method === 'insert')).toHaveLength(1);
  });

  it('no pisa la propuesta pendiente de la otra parte (409)', async () => {
    const calls = fakeAdmin(
      db({
        propuesta_reprogramacion: {
          data: [propuestaRow({ propuesta_por: 'cliente' })],
        },
      }),
    );

    await expect(proponer(input)).rejects.toThrow('respóndela primero');
    expect(calls.some((c) => c.method === 'insert')).toBe(false);
  });

  it('solo se propone sobre citas confirmadas', async () => {
    const calls = fakeAdmin({});

    await expect(
      proponer({ ...input, cita: cita({ estado: 'pendiente' }) }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(calls).toHaveLength(0);
  });

  it('exige 1 día de antelación y una hora futura distinta de la actual', async () => {
    fakeAdmin({});

    await expect(
      proponer({
        ...input,
        cita: cita({ inicio_at: '2026-10-29T10:00:00Z' }),
      }),
    ).rejects.toThrow('al menos 1 día de antelación');
    await expect(proponer({ ...input, fecha: '2026-10-26' })).rejects.toThrow(
      'fecha u hora pasada',
    );
    await expect(proponer({ ...input, horaInicio: '08:00' })).rejects.toThrow(
      'Elige una hora distinta a la actual',
    );
    await expect(
      proponer({ ...input, horaInicio: '09:10' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza una hora fuera del horario del barbero o ya ocupada (409)', async () => {
    fakeAdmin(db({ propuesta_reprogramacion: { data: [] } }));
    await expect(
      proponer({ ...input, horaInicio: '15:00' }),
    ).rejects.toBeInstanceOf(ConflictException);

    fakeAdmin(
      db({ propuesta_reprogramacion: { data: [] } }, [
        { inicio_at: '2026-11-02T14:00:00Z', fin_at: '2026-11-02T14:30:00Z' },
      ]),
    );
    await expect(proponer(input)).rejects.toBeInstanceOf(ConflictException);
  });

  it('si otra propuesta se coló justo antes, el índice único responde 409', async () => {
    fakeAdmin(
      db({
        propuesta_reprogramacion: [
          { data: [] },
          { error: { code: '23505', message: 'duplicate key' } },
        ],
      }),
    );

    await expect(proponer(input)).rejects.toThrow(
      'Ya hay una propuesta pendiente',
    );
  });
});

describe('aceptar', () => {
  // Acepta el cliente una propuesta del barbero.
  const input = {
    user,
    actor: 'cliente' as const,
    cita: cita(),
    duracionMinutos: 30,
    now: NOW,
  };
  const pendiente = (overrides: Partial<PropuestaRow> = {}) => ({
    data: [propuestaRow(overrides)],
  });
  const claimed = { data: { id_propuesta: PROPUESTA_ID } };

  it('mueve la cita con el token de quien acepta y marca la propuesta aceptada', async () => {
    const admin = fakeAdmin(
      db({ propuesta_reprogramacion: [pendiente(), claimed] }),
    );
    const { calls, spy } = fakeUser({ cita: { data: { id_cita: CITA_ID } } });

    await aceptar(input);

    expect(spy).toHaveBeenCalledWith('token-de-quien-acepta');
    expect(calls).toContainEqual({
      table: 'cita',
      method: 'update',
      args: [
        {
          inicio_at: '2026-11-02T14:00:00Z',
          fin_at: '2026-11-02T14:30:00Z',
        },
      ],
    });
    // Solo toca el horario: el estado de la cita sigue confirmado.
    expect(calls).toContainEqual({
      table: 'cita',
      method: 'eq',
      args: ['id_cliente', CLIENTE_ID],
    });
    expect(admin).toContainEqual({
      table: 'propuesta_reprogramacion',
      method: 'update',
      args: [expect.objectContaining({ estado: 'aceptada' })],
    });
  });

  it('quien acepta como barbero filtra la cita por id_barbero', async () => {
    fakeAdmin(
      db({
        propuesta_reprogramacion: [
          pendiente({ propuesta_por: 'cliente' }),
          claimed,
        ],
      }),
    );
    const { calls } = fakeUser({ cita: { data: { id_cita: CITA_ID } } });

    await aceptar({
      ...input,
      actor: 'barbero',
      user: { ...user, profileId: BARBERO_ID },
    });

    expect(calls).toContainEqual({
      table: 'cita',
      method: 'eq',
      args: ['id_barbero', BARBERO_ID],
    });
  });

  it('no responde a su propia propuesta (403) ni a una que no existe (404)', async () => {
    fakeAdmin(
      db({ propuesta_reprogramacion: pendiente({ propuesta_por: 'cliente' }) }),
    );
    await expect(aceptar(input)).rejects.toBeInstanceOf(ForbiddenException);

    fakeAdmin(db({ propuesta_reprogramacion: { data: [] } }));
    await expect(aceptar(input)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('si ya falta menos de 1 día la propuesta vence y no se mueve nada', async () => {
    const admin = fakeAdmin(
      db({ propuesta_reprogramacion: [pendiente(), claimed] }),
    );
    const { spy } = fakeUser({});

    await expect(
      aceptar({
        ...input,
        cita: cita({ inicio_at: '2026-10-29T10:00:00Z' }),
      }),
    ).rejects.toThrow('venció');

    expect(admin).toContainEqual({
      table: 'propuesta_reprogramacion',
      method: 'update',
      args: [expect.objectContaining({ estado: 'vencida' })],
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('revalida la hora: si se ocupó, 409 sin mover ni reclamar la propuesta', async () => {
    const admin = fakeAdmin(
      db({ propuesta_reprogramacion: pendiente() }, [
        { inicio_at: '2026-11-02T14:00:00Z', fin_at: '2026-11-02T14:30:00Z' },
      ]),
    );
    const { spy } = fakeUser({});

    await expect(aceptar(input)).rejects.toThrow('ya no está disponible');
    expect(spy).not.toHaveBeenCalled();
    expect(admin.some((c) => c.method === 'update')).toBe(false);
  });

  it('si dos personas responden a la vez solo una gana (409)', async () => {
    fakeAdmin(db({ propuesta_reprogramacion: [pendiente(), { data: null }] }));
    const { spy } = fakeUser({});

    await expect(aceptar(input)).rejects.toThrow('ya fue respondida');
    expect(spy).not.toHaveBeenCalled();
  });

  it('si la base rechaza el movimiento, la propuesta vuelve a pendiente', async () => {
    const admin = fakeAdmin(
      db({ propuesta_reprogramacion: [pendiente(), claimed, { error: null }] }),
    );
    fakeUser({
      cita: {
        error: { message: 'no_citas_solapadas_barbero' },
      },
    });

    await expect(aceptar(input)).rejects.toThrow(
      'Ese horario acaba de ocuparse. Elige otro',
    );

    const updates = admin.filter(
      (c) => c.table === 'propuesta_reprogramacion' && c.method === 'update',
    );
    expect(
      updates.map((c) => (c.args[0] as { estado: string }).estado),
    ).toEqual(['aceptada', 'pendiente']);
  });

  it('si la cita ya no devuelve fila, restaura la propuesta y avisa (409)', async () => {
    const admin = fakeAdmin(
      db({ propuesta_reprogramacion: [pendiente(), claimed, { error: null }] }),
    );
    fakeUser({ cita: { data: null } });

    await expect(aceptar(input)).rejects.toThrow('La cita cambió');
    expect(
      admin.filter(
        (c) =>
          c.table === 'propuesta_reprogramacion' &&
          c.method === 'update' &&
          (c.args[0] as { estado: string }).estado === 'pendiente',
      ),
    ).toHaveLength(1);
  });
});

describe('rechazar y retirar', () => {
  const claimed = { data: { id_propuesta: PROPUESTA_ID } };

  it('rechazar deja la cita como estaba y marca la propuesta rechazada', async () => {
    const calls = fakeAdmin({
      propuesta_reprogramacion: [{ data: [propuestaRow()] }, claimed],
    });

    await rechazar('cliente', cita());

    expect(calls).toContainEqual({
      table: 'propuesta_reprogramacion',
      method: 'update',
      args: [expect.objectContaining({ estado: 'rechazada' })],
    });
    expect(calls.some((c) => c.table === 'cita')).toBe(false);
  });

  it('no se puede rechazar la propia propuesta ni una ya respondida', async () => {
    fakeAdmin({
      propuesta_reprogramacion: {
        data: [propuestaRow({ propuesta_por: 'cliente' })],
      },
    });
    await expect(rechazar('cliente', cita())).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    fakeAdmin({
      propuesta_reprogramacion: [{ data: [propuestaRow()] }, { data: null }],
    });
    await expect(rechazar('cliente', cita())).rejects.toThrow(
      'ya fue respondida',
    );
  });

  it('retirar solo lo hace quien propuso', async () => {
    const calls = fakeAdmin({
      propuesta_reprogramacion: [
        { data: [propuestaRow({ propuesta_por: 'barbero' })] },
        claimed,
      ],
    });
    await retirar('barbero', cita());
    expect(calls).toContainEqual({
      table: 'propuesta_reprogramacion',
      method: 'update',
      args: [expect.objectContaining({ estado: 'retirada' })],
    });

    fakeAdmin({
      propuesta_reprogramacion: {
        data: [propuestaRow({ propuesta_por: 'barbero' })],
      },
    });
    await expect(retirar('cliente', cita())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
