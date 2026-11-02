import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

// El servicio importa supabase.ts, que exige variables de entorno.
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_KEY = 'anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

import * as supabase from '../supabase';
import type { AuthUser } from '../common/auth/auth-user';
import { ClienteService } from './cliente.service';

const BARBERIA_ID = '22222222-2222-4222-8222-222222222222';
const BARBERO_ID = '33333333-3333-4333-8333-333333333333';

type Result = { data?: unknown; error?: unknown; count?: number };
type Call = { table: string; method: string; args: unknown[] };

/** Constructor encadenable: from(tabla) resuelve a `results[tabla]` y anota cada llamada. */
function fakeFrom(results: Record<string, Result | Result[]>, calls: Call[]) {
  return (table: string) => {
    // Un arreglo da un resultado distinto por cada from(tabla), en orden; el
    // último se repite. Útil cuando una tabla se consulta varias veces.
    const entry = results[table];
    const picked = Array.isArray(entry)
      ? entry.length > 1
        ? entry.shift()
        : entry[0]
      : entry;
    const result = { data: null, error: null, ...picked };

    const proxy: any = new Proxy(function () {}, {
      get: (_target, prop: string) => {
        if (prop === 'then') {
          return (
            resolve: (value: unknown) => unknown,
            reject: (reason: unknown) => unknown,
          ) => Promise.resolve(result).then(resolve, reject);
        }

        return (...args: unknown[]) => {
          calls.push({ table, method: prop, args });
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return proxy;
        };
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return proxy;
  };
}

function fakeDatabase(admin: Record<string, Result | Result[]>) {
  const calls: Call[] = [];
  jest
    .spyOn(supabase.supabaseAdmin, 'from')
    .mockImplementation(fakeFrom(admin, calls) as never);
  return calls;
}

/** Cliente que actúa con el token del usuario (el que aplica RLS y triggers). */
function fakeUserClient(results: Record<string, Result | Result[]>) {
  const calls: Call[] = [];
  const spy = jest
    .spyOn(supabase, 'createSupabaseUserClient')
    .mockReturnValue({ from: fakeFrom(results, calls) } as never);
  return { calls, spy };
}

const corte = {
  id_procedimiento: 'p1',
  nombre: 'Corte clásico',
  descripcion: null,
  precio: '25000',
  duracion_minutos: 30,
  activo: true,
};
const barba = { ...corte, id_procedimiento: 'p2', nombre: 'Barba' };
const inactivo = {
  ...corte,
  id_procedimiento: 'p3',
  nombre: 'Tinte',
  activo: false,
};

describe('ClienteService (HU-17)', () => {
  let service: ClienteService;

  beforeEach(() => {
    service = new ClienteService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('listBarberias', () => {
    it('lista las barberías activas con su total de barberos', async () => {
      const calls = fakeDatabase({
        barberia: {
          data: [
            {
              id_barberia: BARBERIA_ID,
              nombre: 'AlphaCorte',
              descripcion: null,
              direccion: 'Robledo, Medellín',
              telefono: '3001234567',
              logo_url: null,
            },
          ],
        },
        barbero: {
          data: [{ id_barberia: BARBERIA_ID }, { id_barberia: BARBERIA_ID }],
        },
      });

      await expect(service.listBarberias()).resolves.toEqual([
        {
          id: BARBERIA_ID,
          nombre: 'AlphaCorte',
          descripcion: '',
          direccion: 'Robledo, Medellín',
          telefono: '3001234567',
          logo: null,
          totalBarberos: 2,
        },
      ]);
      expect(calls).toContainEqual({
        table: 'barberia',
        method: 'eq',
        args: ['activo', true],
      });
    });

    it('devuelve lista vacía sin consultar barberos si no hay barberías', async () => {
      const calls = fakeDatabase({ barberia: { data: [] } });

      await expect(service.listBarberias()).resolves.toEqual([]);
      expect(calls.some((call) => call.table === 'barbero')).toBe(false);
    });
  });

  describe('listBarberos', () => {
    it('rechaza un id que no es uuid sin consultar la base', async () => {
      const calls = fakeDatabase({});

      await expect(service.listBarberos('123')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(calls).toHaveLength(0);
    });

    it('da 404 si la barbería no existe o está inactiva', async () => {
      fakeDatabase({ barberia: { data: null } });

      await expect(service.listBarberos(BARBERIA_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('lista barberos con especialidades activas, promedio y horario', async () => {
      fakeDatabase({
        barberia: { data: { id_barberia: BARBERIA_ID } },
        barbero: {
          data: [
            {
              id_barbero: BARBERO_ID,
              nombre_barbero: 'Carlos',
              foto_perfil: null,
              promedio_calificacion: '4.5',
              barbero_procedimiento: [
                { procedimiento: barba },
                { procedimiento: corte },
                { procedimiento: inactivo },
              ],
            },
            {
              id_barbero: '44444444-4444-4444-8444-444444444444',
              nombre_barbero: 'Luis',
              foto_perfil: null,
              promedio_calificacion: null,
              barbero_procedimiento: [],
            },
          ],
        },
        disponibilidad_barbero: {
          data: [1, 2, 3].map((dia) => ({
            id_barbero: BARBERO_ID,
            dia_semana: dia,
            hora_inicio: '08:00:00',
            hora_fin: '18:00:00',
          })),
        },
      });

      const result = await service.listBarberos(BARBERIA_ID);

      expect(result).toEqual([
        {
          id: BARBERO_ID,
          nombre: 'Carlos',
          foto: null,
          promedioCalificacion: 4.5,
          especialidades: ['Barba', 'Corte clásico'],
          tieneHorario: true,
          horarioResumen: 'Lun a Mié 08:00–18:00',
        },
        {
          id: '44444444-4444-4444-8444-444444444444',
          nombre: 'Luis',
          foto: null,
          promedioCalificacion: 0,
          especialidades: [],
          tieneHorario: false,
          horarioResumen: '',
        },
      ]);
    });
  });

  describe('getBarbero', () => {
    const row = {
      id_barbero: BARBERO_ID,
      nombre_barbero: 'Carlos',
      foto_perfil: null,
      promedio_calificacion: 4.5,
      barberia: {
        id_barberia: BARBERIA_ID,
        nombre: 'AlphaCorte',
        direccion: null,
        telefono: null,
        logo_url: null,
        activo: true,
      },
      barbero_procedimiento: [
        { procedimiento: corte },
        { procedimiento: inactivo },
      ],
    };

    it('rechaza un id que no es uuid', async () => {
      fakeDatabase({});

      await expect(service.getBarbero('abc')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('da 404 si el barbero no existe o está inactivo', async () => {
      fakeDatabase({ barbero: { data: null } });

      await expect(service.getBarbero(BARBERO_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('da 404 si su barbería está inactiva', async () => {
      fakeDatabase({
        barbero: {
          data: { ...row, barberia: { ...row.barberia, activo: false } },
        },
      });

      await expect(service.getBarbero(BARBERO_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('devuelve el perfil público con reseñas que solo muestran el primer nombre', async () => {
      fakeDatabase({
        barbero: { data: row },
        disponibilidad_barbero: {
          data: [
            {
              id_barbero: BARBERO_ID,
              dia_semana: 6,
              hora_inicio: '09:00:00',
              hora_fin: '13:00:00',
            },
          ],
        },
        calificacion: {
          count: 12,
          data: [
            {
              id_calificacion: 'c1',
              puntuacion_numerica: 5,
              resena: 'Excelente corte',
              created_at: '2026-10-20T15:00:00Z',
              cita: { cliente: { nombre_cliente: 'Ana María Pérez' } },
            },
          ],
        },
      });

      const perfil = await service.getBarbero(BARBERO_ID);

      expect(perfil).toEqual({
        id: BARBERO_ID,
        nombre: 'Carlos',
        foto: null,
        promedioCalificacion: 4.5,
        totalResenas: 12,
        barberia: {
          id: BARBERIA_ID,
          nombre: 'AlphaCorte',
          direccion: '',
          telefono: null,
          logo: null,
        },
        tieneHorario: true,
        horarioResumen: 'Sáb 09:00–13:00',
        especialidades: [
          {
            id: 'p1',
            nombre: 'Corte clásico',
            descripcion: '',
            precio: 25000,
            duracionMinutos: 30,
          },
        ],
        resenas: [
          {
            id: 'c1',
            puntuacion: 5,
            comentario: 'Excelente corte',
            fecha: '2026-10-20',
            cliente: 'Ana',
          },
        ],
      });
    });

    it('propaga un error de la base como 500', async () => {
      fakeDatabase({ barbero: { error: { message: 'fallo' } } });

      await expect(service.getBarbero(BARBERO_ID)).rejects.toThrow('fallo');
    });
  });

  describe('listProcedimientos (HU-18)', () => {
    const barberoRow = (procedimientos: unknown[]) => ({
      id_barberia: BARBERIA_ID,
      barberia: { activo: true },
      barbero_procedimiento: procedimientos.map((procedimiento) => ({
        procedimiento,
      })),
    });

    it('rechaza un id que no es uuid sin consultar la base', async () => {
      const calls = fakeDatabase({});

      await expect(service.listProcedimientos('x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(calls).toHaveLength(0);
    });

    it('da 404 si el barbero no existe o su barbería está inactiva', async () => {
      fakeDatabase({ barbero: { data: null } });
      await expect(
        service.listProcedimientos(BARBERO_ID),
      ).rejects.toBeInstanceOf(NotFoundException);

      jest.restoreAllMocks();
      fakeDatabase({
        barbero: {
          data: { ...barberoRow([corte]), barberia: { activo: false } },
        },
      });
      await expect(
        service.listProcedimientos(BARBERO_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('ofrece solo las especialidades activas del barbero, sin consultar el catálogo', async () => {
      const calls = fakeDatabase({
        barbero: { data: barberoRow([barba, corte, inactivo]) },
      });

      const result = await service.listProcedimientos(BARBERO_ID);

      expect(result.origen).toBe('especialidades');
      expect(result.procedimientos.map((item) => item.nombre)).toEqual([
        'Barba',
        'Corte clásico',
      ]);
      expect(result.procedimientos[1]).toEqual({
        id: 'p1',
        nombre: 'Corte clásico',
        descripcion: '',
        precio: 25000,
        duracionMinutos: 30,
      });
      expect(calls.some((call) => call.table === 'procedimiento')).toBe(false);
    });

    it('sin especialidades activas ofrece todos los procedimientos activos de la barbería', async () => {
      const calls = fakeDatabase({
        barbero: { data: barberoRow([inactivo]) },
        procedimiento: { data: [barba, corte] },
      });

      const result = await service.listProcedimientos(BARBERO_ID);

      expect(result.origen).toBe('barberia');
      expect(result.procedimientos.map((item) => item.id)).toEqual([
        'p2',
        'p1',
      ]);
      expect(calls).toContainEqual({
        table: 'procedimiento',
        method: 'eq',
        args: ['id_barberia', BARBERIA_ID],
      });
      expect(calls).toContainEqual({
        table: 'procedimiento',
        method: 'eq',
        args: ['activo', true],
      });
    });

    it('propaga un error de la base al leer el catálogo', async () => {
      fakeDatabase({
        barbero: { data: barberoRow([]) },
        procedimiento: { error: { message: 'catálogo caído' } },
      });

      await expect(service.listProcedimientos(BARBERO_ID)).rejects.toThrow(
        'catálogo caído',
      );
    });
  });

  describe('getDisponibilidad (HU-19 / HU-20)', () => {
    const CLIENTE_ID = '55555555-5555-4555-8555-555555555555';
    const user = { profileId: CLIENTE_ID, role: 'cliente' } as AuthUser;
    // 2026-10-28 12:00 en Bogotá (miércoles). El lunes siguiente es 2026-11-02.
    const NOW = new Date('2026-10-28T17:00:00Z');

    const P1 = '88888888-8888-4888-8888-888888888881';
    const P2 = '88888888-8888-4888-8888-888888888882';
    const barbero = {
      id_barberia: BARBERIA_ID,
      barberia: { activo: true },
      barbero_procedimiento: [
        { procedimiento: { ...corte, id_procedimiento: P1 } },
        { procedimiento: { ...barba, id_procedimiento: P2 } },
      ],
    };
    const lunes = [
      {
        id_barbero: BARBERO_ID,
        dia_semana: 1,
        hora_inicio: '08:00:00',
        hora_fin: '10:00:00',
      },
    ];
    const query = { procedimientos: P1, desde: '2026-11-02', dias: '1' };

    beforeEach(() => {
      jest
        .spyOn(service as unknown as { now: () => Date }, 'now')
        .mockReturnValue(NOW);
    });

    it('devuelve las horas libres con la duración y el costo de lo elegido', async () => {
      // `corte` y `barba` duran 30 min y cuestan 25.000 cada uno.
      const calls = fakeDatabase({
        barbero: { data: barbero },
        disponibilidad_barbero: { data: lunes },
        cita: {
          data: [
            {
              inicio_at: '2026-11-02T14:00:00Z', // 09:00 Bogotá
              fin_at: '2026-11-02T14:30:00Z',
            },
          ],
        },
      });

      const result = await service.getDisponibilidad(user, BARBERO_ID, {
        ...query,
        procedimientos: `${P1},${P2}`,
      });

      expect(result).toEqual({
        duracionMinutos: 60,
        costoTotal: 50000,
        desde: '2026-11-02',
        hasta: '2026-11-02',
        dias: [{ fecha: '2026-11-02', horas: ['08:00'] }],
      });
      // Resta las citas del barbero y también las del propio cliente.
      expect(calls).toContainEqual({
        table: 'cita',
        method: 'eq',
        args: ['id_barbero', BARBERO_ID],
      });
      expect(calls).toContainEqual({
        table: 'cita',
        method: 'eq',
        args: ['id_cliente', CLIENTE_ID],
      });
      expect(calls).toContainEqual({
        table: 'cita',
        method: 'in',
        args: ['estado', ['pendiente', 'confirmada']],
      });
    });

    it('con excluirCita la cita que se reprograma no ocupa su horario', async () => {
      const calls = fakeDatabase({
        barbero: { data: barbero },
        disponibilidad_barbero: { data: lunes },
        cita: { data: [] },
      });
      const excluirCita = '66666666-6666-4666-8666-666666666666';

      await service.getDisponibilidad(user, BARBERO_ID, {
        ...query,
        excluirCita,
      });

      expect(
        calls.filter(
          (call) => call.method === 'neq' && call.args[1] === excluirCita,
        ),
      ).toHaveLength(2); // barbero y cliente
    });

    it('sin excluirCita no filtra ninguna cita', async () => {
      const calls = fakeDatabase({
        barbero: { data: barbero },
        disponibilidad_barbero: { data: lunes },
        cita: { data: [] },
      });

      await service.getDisponibilidad(user, BARBERO_ID, query);

      expect(calls.some((call) => call.method === 'neq')).toBe(false);
    });

    it('un barbero sin horario no tiene fechas y no consulta citas', async () => {
      const calls = fakeDatabase({
        barbero: { data: barbero },
        disponibilidad_barbero: { data: [] },
      });

      const result = await service.getDisponibilidad(user, BARBERO_ID, query);

      expect(result.dias).toEqual([]);
      expect(result.duracionMinutos).toBe(30);
      expect(calls.some((call) => call.table === 'cita')).toBe(false);
    });

    it('rechaza un procedimiento que el barbero no ofrece', async () => {
      fakeDatabase({ barbero: { data: barbero } });

      await expect(
        service.getDisponibilidad(user, BARBERO_ID, {
          ...query,
          procedimientos: '77777777-7777-4777-8777-777777777777',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('valida los parámetros antes de consultar la base', async () => {
      const calls = fakeDatabase({});

      for (const bad of [
        { ...query, procedimientos: undefined },
        { ...query, desde: '02-11-2026' },
        { ...query, dias: '99' },
        { ...query, excluirCita: 'no-uuid' },
      ]) {
        await expect(
          service.getDisponibilidad(user, BARBERO_ID, bad),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(calls).toHaveLength(0);
    });

    it('da 404 si el barbero no existe', async () => {
      fakeDatabase({ barbero: { data: null } });

      await expect(
        service.getDisponibilidad(user, BARBERO_ID, {
          ...query,
          procedimientos: '77777777-7777-4777-8777-777777777777',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('propaga un error de la base al leer las citas', async () => {
      fakeDatabase({
        barbero: { data: barbero },
        disponibilidad_barbero: { data: lunes },
        cita: { error: { message: 'citas caídas' } },
      });

      await expect(
        service.getDisponibilidad(user, BARBERO_ID, query),
      ).rejects.toThrow('citas caídas');
    });
  });

  describe('crearCita (HU-20)', () => {
    const CLIENTE_ID = '55555555-5555-4555-8555-555555555555';
    const CITA_ID = '99999999-9999-4999-8999-999999999999';
    const P1 = '88888888-8888-4888-8888-888888888881';
    const user = {
      profileId: CLIENTE_ID,
      role: 'cliente',
      accessToken: 'token-del-cliente',
    } as AuthUser;
    // Miércoles 2026-10-28 12:00 en Bogotá; el lunes siguiente es 2026-11-02.
    const NOW = new Date('2026-10-28T17:00:00Z');
    const dto = {
      idBarbero: BARBERO_ID,
      procedimientoIds: [P1],
      fecha: '2026-11-02',
      horaInicio: '08:00',
    };

    const barbero = {
      id_barberia: BARBERIA_ID,
      barberia: { activo: true },
      barbero_procedimiento: [
        { procedimiento: { ...corte, id_procedimiento: P1 } },
      ],
    };
    const lunes = [
      {
        id_barbero: BARBERO_ID,
        dia_semana: 1,
        hora_inicio: '08:00:00',
        hora_fin: '10:00:00',
      },
    ];
    const citaRow = {
      id_cita: CITA_ID,
      estado: 'pendiente',
      inicio_at: '2026-11-02T13:00:00Z',
      fin_at: '2026-11-02T13:30:00Z',
      notas_cliente: null,
      motivo_estado: null,
      barbero: {
        id_barbero: BARBERO_ID,
        nombre_barbero: 'Carlos',
        foto_perfil: null,
      },
      barberia: {
        id_barberia: BARBERIA_ID,
        nombre: 'AlphaCorte',
        direccion: null,
      },
      cita_procedimiento: [
        {
          precio_aplicado: '27000',
          duracion_minutos_aplicada: 30,
          procedimiento: { id_procedimiento: P1, nombre: 'Corte clásico' },
        },
      ],
    };
    /** Las dos lecturas de citas ocupadas (barbero y cliente) y luego la cita creada. */
    const adminDb = (busy: unknown[] = [], ...rest: Result[]) => ({
      barbero: { data: barbero },
      disponibilidad_barbero: { data: lunes },
      cita: [{ data: busy }, { data: busy }, ...rest],
    });

    beforeEach(() => {
      jest
        .spyOn(service as unknown as { now: () => Date }, 'now')
        .mockReturnValue(NOW);
    });

    it('crea la cita pendiente con el token del cliente y devuelve su resumen', async () => {
      fakeDatabase(adminDb([], { data: citaRow }));
      const { calls, spy } = fakeUserClient({
        cita: { data: { id_cita: CITA_ID } },
        cita_procedimiento: { error: null },
      });

      const result = await service.crearCita(user, dto);

      expect(spy).toHaveBeenCalledWith('token-del-cliente');
      expect(calls).toContainEqual({
        table: 'cita',
        method: 'insert',
        args: [
          {
            id_cliente: CLIENTE_ID,
            id_barbero: BARBERO_ID,
            inicio_at: '2026-11-02T13:00:00.000Z', // 08:00 en Bogotá
            fin_at: '2026-11-02T13:30:00.000Z',
            estado: 'pendiente',
            notas_cliente: null,
          },
        ],
      });
      expect(calls).toContainEqual({
        table: 'cita_procedimiento',
        method: 'insert',
        args: [[{ id_cita: CITA_ID, id_procedimiento: P1 }]],
      });
      expect(result.message).toBe(
        'Solicitud enviada. Espera la confirmación del barbero.',
      );
      expect(result.cita).toMatchObject({
        id: CITA_ID,
        estado: 'pendiente',
        estadoLabel: 'Pendiente',
        fecha: '2026-11-02',
        horaInicio: '08:00',
        horaFin: '08:30',
        duracionMinutos: 30,
        costoTotal: 27000, // precio_aplicado, no el precio actual del catálogo
        barbero: { id: BARBERO_ID, nombre: 'Carlos', foto: null },
        barberia: { nombre: 'AlphaCorte', direccion: '' },
      });
    });

    it('guarda las notas recortadas', async () => {
      fakeDatabase(adminDb([], { data: citaRow }));
      const { calls } = fakeUserClient({
        cita: { data: { id_cita: CITA_ID } },
        cita_procedimiento: { error: null },
      });

      await service.crearCita(user, { ...dto, notas: '  Sin máquina  ' });

      expect(calls).toContainEqual(
        expect.objectContaining({
          table: 'cita',
          method: 'insert',
          args: [expect.objectContaining({ notas_cliente: 'Sin máquina' })],
        }),
      );
    });

    it('si la hora ya se ocupó, responde 409 sin escribir nada', async () => {
      fakeDatabase(
        adminDb([
          {
            inicio_at: '2026-11-02T13:00:00Z',
            fin_at: '2026-11-02T13:30:00Z',
          },
        ]),
      );
      const { spy } = fakeUserClient({});

      await expect(service.crearCita(user, dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(spy).not.toHaveBeenCalled();
    });

    it('rechaza una hora que no es de la disponibilidad (fuera del horario)', async () => {
      fakeDatabase(adminDb([]));
      const { spy } = fakeUserClient({});

      await expect(
        service.crearCita(user, { ...dto, horaInicio: '15:00' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(spy).not.toHaveBeenCalled();
    });

    it('rechaza una fecha u hora pasada antes de consultar la base', async () => {
      const calls = fakeDatabase({});

      await expect(
        service.crearCita(user, { ...dto, fecha: '2026-10-26' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(calls).toHaveLength(0);
    });

    it('valida el cuerpo antes de consultar la base', async () => {
      const calls = fakeDatabase({});

      for (const bad of [
        { ...dto, idBarbero: 'x' },
        { ...dto, procedimientoIds: [] },
        { ...dto, procedimientoIds: 'p1' as unknown as string[] },
        { ...dto, horaInicio: '08:10' },
        { ...dto, fecha: '02/11/2026' },
      ]) {
        await expect(service.crearCita(user, bad)).rejects.toBeInstanceOf(
          BadRequestException,
        );
      }
      expect(calls).toHaveLength(0);
    });

    it('si la base detecta un solape de último momento lo traduce como 409 para el cliente', async () => {
      fakeDatabase(adminDb([]));
      const { calls } = fakeUserClient({
        cita: {
          error: {
            message:
              'conflicting key value violates exclusion constraint "no_citas_solapadas_barbero"',
          },
        },
      });

      await expect(service.crearCita(user, dto)).rejects.toThrow(
        'Ese horario acaba de ocuparse. Elige otro',
      );
      expect(calls.some((call) => call.table === 'cita_procedimiento')).toBe(
        false,
      );
    });

    it('si fallan los procedimientos retira la cita recién creada (solo esa)', async () => {
      const adminCalls = fakeDatabase(adminDb([], { data: null }));
      fakeUserClient({
        cita: { data: { id_cita: CITA_ID } },
        cita_procedimiento: {
          error: { message: 'El procedimiento no esta activo' },
        },
      });

      await expect(service.crearCita(user, dto)).rejects.toThrow(
        'Alguno de los procedimientos ya no está disponible',
      );

      const deleted = adminCalls.filter(
        (call) => call.table === 'cita' && call.method === 'delete',
      );
      expect(deleted).toHaveLength(1);
      for (const filter of [
        ['id_cita', CITA_ID],
        ['id_cliente', CLIENTE_ID],
        ['estado', 'pendiente'],
      ]) {
        expect(adminCalls).toContainEqual({
          table: 'cita',
          method: 'eq',
          args: filter,
        });
      }
    });

    it('rechaza procedimientos que el barbero no ofrece', async () => {
      fakeDatabase({ barbero: { data: barbero } });
      const { spy } = fakeUserClient({});

      await expect(
        service.crearCita(user, {
          ...dto,
          procedimientoIds: ['77777777-7777-4777-8777-777777777777'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('getCita', () => {
    const user = {
      profileId: '55555555-5555-4555-8555-555555555555',
    } as AuthUser;
    const ID = '99999999-9999-4999-8999-999999999999';

    it('da 404 con un id inválido o si la cita no es de este cliente', async () => {
      const calls = fakeDatabase({ cita: { data: null } });

      await expect(service.getCita(user, 'x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(calls).toHaveLength(0);

      await expect(service.getCita(user, ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(calls).toContainEqual({
        table: 'cita',
        method: 'eq',
        args: ['id_cliente', user.profileId],
      });
    });

    it('muestra "Vencida" para una solicitud que nadie respondió', async () => {
      fakeDatabase({
        cita: {
          data: {
            id_cita: ID,
            estado: 'rechazada',
            inicio_at: '2026-11-02T13:00:00Z',
            fin_at: '2026-11-02T13:30:00Z',
            notas_cliente: null,
            motivo_estado: 'Solicitud vencida sin respuesta',
            barbero: null,
            barberia: null,
            cita_procedimiento: [],
          },
        },
      });

      const cita = await service.getCita(user, ID);

      expect(cita.estado).toBe('rechazada');
      expect(cita.estadoLabel).toBe('Vencida');
      expect(cita.barbero.nombre).toBe('Barbero');
    });
  });

  describe('HU-21: reprogramar o cancelar', () => {
    const CLIENTE_ID = '55555555-5555-4555-8555-555555555555';
    const CITA_ID = '99999999-9999-4999-8999-999999999999';
    const user = {
      profileId: CLIENTE_ID,
      role: 'cliente',
      accessToken: 'token-del-cliente',
    } as AuthUser;
    // Miércoles 2026-10-28 12:00 en Bogotá.
    const NOW = new Date('2026-10-28T17:00:00Z');

    // Lunes 2026-11-02 08:00 Bogotá: faltan más de 4 días.
    const rawCita = (overrides: Record<string, unknown> = {}) => ({
      id_cita: CITA_ID,
      id_barbero: BARBERO_ID,
      estado: 'confirmada',
      inicio_at: '2026-11-02T13:00:00Z',
      fin_at: '2026-11-02T13:30:00Z',
      cita_procedimiento: [
        { precio_aplicado: '27000', duracion_minutos_aplicada: 30 },
      ],
      ...overrides,
    });
    const viewRow = (overrides: Record<string, unknown> = {}) => ({
      id_cita: CITA_ID,
      estado: 'confirmada',
      inicio_at: '2026-11-02T13:00:00Z',
      fin_at: '2026-11-02T13:30:00Z',
      notas_cliente: null,
      motivo_estado: null,
      barbero: {
        id_barbero: BARBERO_ID,
        nombre_barbero: 'Carlos',
        foto_perfil: null,
      },
      barberia: {
        id_barberia: BARBERIA_ID,
        nombre: 'AlphaCorte',
        direccion: null,
      },
      cita_procedimiento: [
        {
          precio_aplicado: '27000',
          duracion_minutos_aplicada: 30,
          procedimiento: { id_procedimiento: 'p1', nombre: 'Corte clásico' },
        },
      ],
      ...overrides,
    });
    const barbero = {
      id_barberia: BARBERIA_ID,
      barberia: { activo: true },
      barbero_procedimiento: [{ procedimiento: corte }],
    };
    const lunes = [
      {
        id_barbero: BARBERO_ID,
        dia_semana: 1,
        hora_inicio: '08:00:00',
        hora_fin: '10:00:00',
      },
    ];

    beforeEach(() => {
      jest
        .spyOn(service as unknown as { now: () => Date }, 'now')
        .mockReturnValue(NOW);
    });

    describe('disponibilidad para reprogramar (excluirCita sin procedimientos)', () => {
      const query = { excluirCita: CITA_ID, desde: '2026-11-02', dias: '1' };

      it('usa la duración congelada de la cita y no la cuenta a ella como ocupada', async () => {
        const calls = fakeDatabase({
          barbero: { data: barbero },
          disponibilidad_barbero: { data: lunes },
          cita: [{ data: rawCita() }, { data: [] }, { data: [] }],
        });

        const result = await service.getDisponibilidad(user, BARBERO_ID, query);

        expect(result.duracionMinutos).toBe(30);
        expect(result.costoTotal).toBe(27000);
        expect(result.dias[0].horas).toContain('08:00'); // su propio horario sigue libre
        expect(
          calls.filter(
            (call) => call.method === 'neq' && call.args[1] === CITA_ID,
          ),
        ).toHaveLength(2);
        expect(calls).toContainEqual({
          table: 'cita',
          method: 'eq',
          args: ['id_cliente', CLIENTE_ID],
        });
      });

      it('da 404 si la cita no es de este cliente', async () => {
        fakeDatabase({ barbero: { data: barbero }, cita: { data: null } });

        await expect(
          service.getDisponibilidad(user, BARBERO_ID, query),
        ).rejects.toBeInstanceOf(NotFoundException);
      });

      it('rechaza una cita de otro barbero o que ya no está abierta', async () => {
        fakeDatabase({
          barbero: { data: barbero },
          cita: { data: rawCita({ id_barbero: 'otro' }) },
        });
        await expect(
          service.getDisponibilidad(user, BARBERO_ID, query),
        ).rejects.toBeInstanceOf(BadRequestException);

        jest.restoreAllMocks();
        jest
          .spyOn(service as unknown as { now: () => Date }, 'now')
          .mockReturnValue(NOW);
        fakeDatabase({
          barbero: { data: barbero },
          cita: { data: rawCita({ estado: 'cancelada' }) },
        });
        await expect(
          service.getDisponibilidad(user, BARBERO_ID, query),
        ).rejects.toBeInstanceOf(ConflictException);
      });

      it('sin procedimientos ni excluirCita sigue pidiendo procedimientos', async () => {
        const calls = fakeDatabase({});

        await expect(
          service.getDisponibilidad(user, BARBERO_ID, { desde: '2026-11-02' }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(calls).toHaveLength(0);
      });
    });

    describe('listCitas', () => {
      it('rechaza un grupo que no existe y una paginación inválida', async () => {
        const calls = fakeDatabase({});

        await expect(
          service.listCitas(user, { grupo: 'otro' }),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
          service.listCitas(user, { grupo: 'historial', offset: 'x' }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(calls).toHaveLength(0);
      });

      it('vence solicitudes antes de listar y trae solo las abiertas de este cliente', async () => {
        const rpc = jest
          .spyOn(supabase.supabaseAdmin, 'rpc')
          .mockResolvedValue({ error: null } as never);
        const calls = fakeDatabase({
          cita: {
            data: [
              viewRow(),
              viewRow({
                id_cita: 'c2',
                estado: 'pendiente',
                inicio_at: '2026-10-29T10:00:00Z', // mañana: ya no se puede modificar
                fin_at: '2026-10-29T10:30:00Z',
              }),
            ],
          },
        });

        const result = await service.listCitas(user, {});

        expect(rpc).toHaveBeenCalledWith('vencer_solicitudes');
        expect(rpc).toHaveBeenCalledWith('realizar_citas_vencidas');
        expect(calls).toContainEqual({
          table: 'cita',
          method: 'eq',
          args: ['id_cliente', CLIENTE_ID],
        });
        expect(calls).toContainEqual({
          table: 'cita',
          method: 'in',
          args: ['estado', ['pendiente', 'confirmada']],
        });
        expect(result.hayMas).toBe(false);
        expect(result.items.map((cita) => cita.puedeModificar)).toEqual([
          true,
          false,
        ]);
      });
    });

    describe('cancelarCita', () => {
      it('cancela con el token del cliente y guarda el motivo recortado', async () => {
        fakeDatabase({
          cita: [
            { data: rawCita() },
            {
              data: viewRow({
                estado: 'cancelada',
                motivo_estado: 'Imprevisto',
              }),
            },
          ],
        });
        const { calls, spy } = fakeUserClient({
          cita: { data: { id_cita: CITA_ID } },
        });

        const result = await service.cancelarCita(user, CITA_ID, {
          motivo: '  Imprevisto  ',
        });

        expect(spy).toHaveBeenCalledWith('token-del-cliente');
        expect(calls).toContainEqual({
          table: 'cita',
          method: 'update',
          args: [{ estado: 'cancelada', motivo_estado: 'Imprevisto' }],
        });
        expect(calls).toContainEqual({
          table: 'cita',
          method: 'eq',
          args: ['id_cliente', CLIENTE_ID],
        });
        expect(result.message).toBe('Cita cancelada');
        expect(result.cita.estado).toBe('cancelada');
        expect(result.cita.puedeModificar).toBe(false);
      });

      it('con menos de 1 día de antelación responde 400 sin escribir', async () => {
        fakeDatabase({
          cita: {
            data: rawCita({
              inicio_at: '2026-10-29T10:00:00Z',
              fin_at: '2026-10-29T10:30:00Z',
            }),
          },
        });
        const { spy } = fakeUserClient({});

        await expect(service.cancelarCita(user, CITA_ID, {})).rejects.toThrow(
          'al menos 1 día de antelación',
        );
        expect(spy).not.toHaveBeenCalled();
      });

      it('no cancela una cita que ya no está abierta ni una ajena', async () => {
        fakeDatabase({ cita: { data: rawCita({ estado: 'realizada' }) } });
        await expect(
          service.cancelarCita(user, CITA_ID, {}),
        ).rejects.toBeInstanceOf(ConflictException);

        jest.restoreAllMocks();
        jest
          .spyOn(service as unknown as { now: () => Date }, 'now')
          .mockReturnValue(NOW);
        fakeDatabase({ cita: { data: null } });
        await expect(
          service.cancelarCita(user, CITA_ID, {}),
        ).rejects.toBeInstanceOf(NotFoundException);
        await expect(
          service.cancelarCita(user, 'x', {}),
        ).rejects.toBeInstanceOf(NotFoundException);
      });

      it('si la cita cambió entre la lectura y la escritura responde 409', async () => {
        fakeDatabase({ cita: { data: rawCita() } });
        fakeUserClient({ cita: { data: null } });

        await expect(
          service.cancelarCita(user, CITA_ID, {}),
        ).rejects.toBeInstanceOf(ConflictException);
      });

      it('traduce los errores de la base para el cliente', async () => {
        fakeDatabase({ cita: { data: rawCita() } });
        fakeUserClient({
          cita: { error: { message: 'minimo 1 dia de anticipacion' } },
        });

        await expect(
          service.cancelarCita(user, CITA_ID, {}),
        ).rejects.toBeInstanceOf(BadRequestException);
      });
    });

    describe('reprogramarCita', () => {
      const propuestaDelCliente = {
        id_propuesta: '77777777-7777-4777-8777-777777777777',
        id_cita: CITA_ID,
        propuesta_por: 'cliente',
        inicio_at: '2026-11-02T14:00:00Z',
        fin_at: '2026-11-02T14:30:00Z',
        estado: 'pendiente',
      };
      // Misma jornada de lunes; la cita actual es a las 08:00 y el nuevo horario a las 09:00.
      const dto = { fecha: '2026-11-02', horaInicio: '09:00' };
      const adminDb = (current: unknown, busy: unknown[] = []) => ({
        barbero: { data: barbero },
        disponibilidad_barbero: { data: lunes },
        cita: [
          { data: current },
          { data: busy },
          { data: busy },
          { data: viewRow({ estado: 'pendiente' }) },
        ],
      });

      it('una cita confirmada NO se mueve: se envía una propuesta al barbero', async () => {
        const adminCalls = fakeDatabase({
          ...adminDb(rawCita()),
          // La cita sigue confirmada al releerla: solo hay una propuesta.
          cita: [
            { data: rawCita() },
            { data: [] },
            { data: [] },
            { data: viewRow() },
          ],
          propuesta_reprogramacion: [
            { data: [] }, // no hay propuesta pendiente
            { error: null }, // insert de la propuesta
            { data: [propuestaDelCliente] }, // la que ve el cliente al releer
          ],
        });
        const { spy } = fakeUserClient({});

        const result = await service.reprogramarCita(user, CITA_ID, dto);

        expect(adminCalls).toContainEqual({
          table: 'propuesta_reprogramacion',
          method: 'insert',
          args: [
            {
              id_cita: CITA_ID,
              propuesta_por: 'cliente',
              inicio_at: '2026-11-02T14:00:00.000Z', // 09:00 Bogotá
              fin_at: '2026-11-02T14:30:00.000Z', // misma duración de 30 min
              estado: 'pendiente',
            },
          ],
        });
        // La cita sigue en su horario original: no se escribe en `cita`.
        expect(spy).not.toHaveBeenCalled();
        expect(
          adminCalls.some((c) => c.table === 'cita' && c.method === 'update'),
        ).toBe(false);
        expect(result.message).toContain('Propuesta enviada');
        expect(result.cita.propuesta).toMatchObject({
          propuestaPor: 'cliente',
          esPropia: true,
          puedeResponder: false,
          fecha: '2026-11-02',
          horaInicio: '09:00',
        });
        // La propia cita no cuenta como ocupada al buscar la nueva hora.
        expect(
          adminCalls.filter(
            (call) => call.method === 'neq' && call.args[1] === CITA_ID,
          ),
        ).toHaveLength(2);
      });

      it('una solicitud pendiente sigue pendiente (no se manda estado)', async () => {
        fakeDatabase(adminDb(rawCita({ estado: 'pendiente' })));
        const { calls } = fakeUserClient({
          cita: { data: { id_cita: CITA_ID } },
        });

        const result = await service.reprogramarCita(user, CITA_ID, dto);

        const update = calls.find((call) => call.method === 'update');
        expect(update?.args[0]).not.toHaveProperty('estado');
        expect(result.message).toBe('Cita reprogramada');
      });

      it('no deja reprogramar a una hora ocupada: 409 sin escribir', async () => {
        fakeDatabase(
          adminDb(rawCita(), [
            {
              inicio_at: '2026-11-02T14:00:00Z',
              fin_at: '2026-11-02T14:30:00Z',
            },
          ]),
        );
        const { spy } = fakeUserClient({});

        await expect(
          service.reprogramarCita(user, CITA_ID, dto),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(spy).not.toHaveBeenCalled();
      });

      it('con menos de 1 día de antelación responde 400', async () => {
        fakeDatabase(
          adminDb(
            rawCita({
              inicio_at: '2026-10-29T10:00:00Z',
              fin_at: '2026-10-29T10:30:00Z',
            }),
          ),
        );
        const { spy } = fakeUserClient({});

        await expect(
          service.reprogramarCita(user, CITA_ID, dto),
        ).rejects.toThrow('al menos 1 día de antelación');
        expect(spy).not.toHaveBeenCalled();
      });

      it('rechaza la misma hora, una hora pasada y datos mal formados', async () => {
        const cases = [
          [{ fecha: '2026-11-02', horaInicio: '08:00' }, 'hora distinta'],
          [{ fecha: '2026-10-26', horaInicio: '09:00' }, 'fecha u hora pasada'],
          [{ fecha: '2026-11-02', horaInicio: '09:10' }, ''],
        ] as const;

        for (const [body, message] of cases) {
          // El fake entrega las respuestas en orden: se reinstala en cada intento.
          fakeDatabase(adminDb(rawCita()));
          const attempt = service.reprogramarCita(user, CITA_ID, { ...body });

          await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
          if (message) {
            await expect(attempt).rejects.toThrow(message);
          }
        }
      });

      it('si la base rechaza el cambio lo traduce para el cliente', async () => {
        fakeDatabase(adminDb(rawCita({ estado: 'pendiente' })));
        fakeUserClient({
          cita: {
            error: {
              message:
                'No tienes permisos para hacer esta transicion de estado',
            },
          },
        });

        await expect(
          service.reprogramarCita(user, CITA_ID, dto),
        ).rejects.toThrow('No tienes permisos para este cambio');
      });
    });

    describe('propuestas del barbero', () => {
      const propuestaDelBarbero = {
        id_propuesta: '77777777-7777-4777-8777-777777777777',
        id_cita: CITA_ID,
        propuesta_por: 'barbero',
        inicio_at: '2026-11-02T14:00:00Z',
        fin_at: '2026-11-02T14:30:00Z',
        estado: 'pendiente',
      };
      const claimed = {
        data: { id_propuesta: propuestaDelBarbero.id_propuesta },
      };

      it('la agenda muestra la propuesta del barbero para que el cliente responda', async () => {
        jest
          .spyOn(supabase.supabaseAdmin, 'rpc')
          .mockResolvedValue({ error: null } as never);
        fakeDatabase({
          cita: { data: [viewRow()] },
          propuesta_reprogramacion: { data: [propuestaDelBarbero] },
        });

        const {
          items: [cita],
        } = await service.listCitas(user, {});

        expect(cita.propuesta).toMatchObject({
          propuestaPor: 'barbero',
          esPropia: false,
          puedeResponder: true,
          fecha: '2026-11-02',
          horaInicio: '09:00',
          horaFin: '09:30',
        });
      });

      it('no muestra una propuesta cuando faltan menos de 24 h o la cita ya no está confirmada', async () => {
        jest
          .spyOn(supabase.supabaseAdmin, 'rpc')
          .mockResolvedValue({ error: null } as never);
        fakeDatabase({
          cita: {
            data: [
              viewRow({
                id_cita: CITA_ID,
                inicio_at: '2026-10-29T10:00:00Z',
                fin_at: '2026-10-29T10:30:00Z',
              }),
            ],
          },
          propuesta_reprogramacion: { data: [propuestaDelBarbero] },
        });

        const {
          items: [cita],
        } = await service.listCitas(user, {});

        expect(cita.propuesta).toBeNull();
      });

      it('aceptar mueve la cita con el token del cliente y la deja confirmada', async () => {
        const adminCalls = fakeDatabase({
          ...{
            barbero: { data: barbero },
            disponibilidad_barbero: { data: lunes },
          },
          cita: [
            { data: rawCita() }, // la cita del cliente
            { data: [] }, // ocupadas del barbero
            { data: [] }, // ocupadas del cliente
            {
              data: viewRow({
                inicio_at: '2026-11-02T14:00:00Z',
                fin_at: '2026-11-02T14:30:00Z',
              }),
            },
          ],
          propuesta_reprogramacion: [
            { data: [propuestaDelBarbero] }, // pendiente
            claimed, // reclamada como aceptada
            { data: [] }, // ya no hay pendiente al releer
          ],
        });
        const { calls, spy } = fakeUserClient({
          cita: { data: { id_cita: CITA_ID } },
        });

        const result = await service.aceptarPropuesta(user, CITA_ID);

        expect(spy).toHaveBeenCalledWith('token-del-cliente');
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
        expect(adminCalls).toContainEqual({
          table: 'propuesta_reprogramacion',
          method: 'update',
          args: [expect.objectContaining({ estado: 'aceptada' })],
        });
        expect(result.message).toContain('Aceptaste');
        expect(result.cita.horaInicio).toBe('09:00');
        expect(result.cita.estado).toBe('confirmada');
        expect(result.cita.propuesta).toBeNull();
      });

      it('rechazar deja la cita como estaba', async () => {
        const adminCalls = fakeDatabase({
          cita: [{ data: rawCita() }, { data: viewRow() }],
          propuesta_reprogramacion: [
            { data: [propuestaDelBarbero] },
            claimed,
            { data: [] },
          ],
        });
        const { spy } = fakeUserClient({});

        const result = await service.rechazarPropuesta(user, CITA_ID);

        expect(adminCalls).toContainEqual({
          table: 'propuesta_reprogramacion',
          method: 'update',
          args: [expect.objectContaining({ estado: 'rechazada' })],
        });
        expect(spy).not.toHaveBeenCalled();
        expect(result.message).toContain('Rechazaste');
        expect(result.cita.horaInicio).toBe('08:00');
      });

      it('no se puede responder una propuesta ajena de otro cliente (404) ni retirar la del barbero (403)', async () => {
        fakeDatabase({ cita: { data: null } });
        await expect(
          service.aceptarPropuesta(user, CITA_ID),
        ).rejects.toBeInstanceOf(NotFoundException);

        fakeDatabase({
          cita: { data: rawCita() },
          propuesta_reprogramacion: { data: [propuestaDelBarbero] },
        });
        await expect(service.retirarPropuesta(user, CITA_ID)).rejects.toThrow(
          'Solo quien hizo la propuesta puede retirarla',
        );
      });

      it('el cliente retira su propia propuesta', async () => {
        const mine = { ...propuestaDelBarbero, propuesta_por: 'cliente' };
        const adminCalls = fakeDatabase({
          cita: [{ data: rawCita() }, { data: viewRow() }],
          propuesta_reprogramacion: [{ data: [mine] }, claimed, { data: [] }],
        });

        const result = await service.retirarPropuesta(user, CITA_ID);

        expect(adminCalls).toContainEqual({
          table: 'propuesta_reprogramacion',
          method: 'update',
          args: [expect.objectContaining({ estado: 'retirada' })],
        });
        expect(result.message).toBe('Propuesta retirada.');
        expect(result.cita.propuesta).toBeNull();
      });
    });
  });

  describe('HU-23: historial y calificación', () => {
    const CLIENTE_ID = '55555555-5555-4555-8555-555555555555';
    const CITA_ID = '99999999-9999-4999-8999-999999999999';
    const user = {
      profileId: CLIENTE_ID,
      role: 'cliente',
      accessToken: 'token-del-cliente',
    } as AuthUser;

    const row = (overrides: Record<string, unknown> = {}) => ({
      id_cita: CITA_ID,
      estado: 'realizada',
      inicio_at: '2026-10-20T15:00:00Z',
      fin_at: '2026-10-20T15:30:00Z',
      notas_cliente: null,
      motivo_estado: null,
      barbero: {
        id_barbero: BARBERO_ID,
        nombre_barbero: 'Carlos',
        foto_perfil: null,
      },
      barberia: {
        id_barberia: BARBERIA_ID,
        nombre: 'AlphaCorte',
        direccion: null,
      },
      cita_procedimiento: [
        {
          precio_aplicado: '27000',
          duracion_minutos_aplicada: 30,
          procedimiento: { id_procedimiento: 'p1', nombre: 'Corte clásico' },
        },
      ],
      calificacion: null,
      ...overrides,
    });
    const rpcOk = () =>
      jest
        .spyOn(supabase.supabaseAdmin, 'rpc')
        .mockResolvedValue({ error: null } as never);

    beforeEach(() => {
      jest
        .spyOn(service as unknown as { now: () => Date }, 'now')
        .mockReturnValue(new Date('2026-10-28T17:00:00Z'));
    });

    describe('historial', () => {
      it('trae realizadas, canceladas y rechazadas, de la más reciente a la más antigua', async () => {
        rpcOk();
        const calls = fakeDatabase({
          cita: {
            data: [
              row(),
              row({
                id_cita: 'c2',
                estado: 'cancelada',
                motivo_estado: 'Imprevisto',
              }),
              row({
                id_cita: 'c3',
                estado: 'rechazada',
                motivo_estado: 'Solicitud vencida sin respuesta',
              }),
            ],
          },
        });

        const result = await service.listCitas(user, { grupo: 'historial' });

        expect(calls).toContainEqual({
          table: 'cita',
          method: 'in',
          args: ['estado', ['realizada', 'cancelada', 'rechazada']],
        });
        expect(calls).toContainEqual({
          table: 'cita',
          method: 'order',
          args: ['inicio_at', { ascending: false }],
        });
        expect(calls).toContainEqual({
          table: 'cita',
          method: 'range',
          args: [0, 20],
        });
        expect(result.items.map((c) => c.estadoLabel)).toEqual([
          'Realizada',
          'Cancelada',
          'Vencida',
        ]);
        expect(result.hayMas).toBe(false);
      });

      it('pagina: pide una fila de más para saber si hay otra página', async () => {
        rpcOk();
        const calls = fakeDatabase({
          cita: {
            data: [
              row({ id_cita: 'a' }),
              row({ id_cita: 'b' }),
              row({ id_cita: 'c' }),
            ],
          },
        });

        const result = await service.listCitas(user, {
          grupo: 'historial',
          offset: '4',
          limit: '2',
        });

        expect(calls).toContainEqual({
          table: 'cita',
          method: 'range',
          args: [4, 6],
        });
        expect(result.items.map((c) => c.id)).toEqual(['a', 'b']);
        expect(result.hayMas).toBe(true);
      });

      it('marca cuáles se pueden calificar y muestra la calificación ya dada', async () => {
        rpcOk();
        fakeDatabase({
          cita: {
            data: [
              row({ id_cita: 'sin' }),
              row({
                id_cita: 'con',
                calificacion: { puntuacion_numerica: 4, resena: null },
              }),
              row({ id_cita: 'cancelada', estado: 'cancelada' }),
            ],
          },
        });

        const { items } = await service.listCitas(user, { grupo: 'historial' });

        expect(items.map((c) => c.puedeCalificar)).toEqual([
          true,
          false,
          false,
        ]);
        expect(items[0].calificacion).toBeNull();
        expect(items[1].calificacion).toEqual({ puntuacion: 4, resena: '' });
      });
    });

    describe('calificarCita', () => {
      const realizada = {
        id_cita: CITA_ID,
        id_barbero: BARBERO_ID,
        id_cliente: CLIENTE_ID,
        estado: 'realizada',
        inicio_at: '2026-10-20T15:00:00Z',
        fin_at: '2026-10-20T15:30:00Z',
      };

      it('guarda la calificación con el token del cliente y devuelve la cita calificada', async () => {
        rpcOk();
        fakeDatabase({
          cita: [
            { data: realizada },
            {
              data: row({
                calificacion: {
                  puntuacion_numerica: 5,
                  resena: 'Excelente corte',
                },
              }),
            },
          ],
        });
        const { calls, spy } = fakeUserClient({
          calificacion: { error: null },
        });

        const result = await service.calificarCita(user, CITA_ID, {
          puntuacion: 5,
          resena: '  Excelente corte  ',
        });

        expect(spy).toHaveBeenCalledWith('token-del-cliente');
        expect(calls).toContainEqual({
          table: 'calificacion',
          method: 'insert',
          args: [
            {
              id_cita: CITA_ID,
              puntuacion_numerica: 5,
              resena: 'Excelente corte',
            },
          ],
        });
        expect(result.message).toBe('¡Gracias por tu calificación!');
        expect(result.cita.calificacion).toEqual({
          puntuacion: 5,
          resena: 'Excelente corte',
        });
        expect(result.cita.puedeCalificar).toBe(false);
      });

      it('la reseña es opcional', async () => {
        rpcOk();
        fakeDatabase({ cita: [{ data: realizada }, { data: row() }] });
        const { calls } = fakeUserClient({ calificacion: { error: null } });

        await service.calificarCita(user, CITA_ID, { puntuacion: 3 });

        expect(calls).toContainEqual(
          expect.objectContaining({
            method: 'insert',
            args: [
              expect.objectContaining({ puntuacion_numerica: 3, resena: null }),
            ],
          }),
        );
      });

      it('valida la nota (entero de 1 a 5) y la reseña (máximo 500) antes de consultar', async () => {
        const calls = fakeDatabase({});

        for (const bad of [
          { puntuacion: 0 },
          { puntuacion: 6 },
          { puntuacion: 3.5 },
          { puntuacion: 'cinco' as unknown as number },
          {} as { puntuacion: number },
          { puntuacion: 4, resena: 'x'.repeat(501) },
        ]) {
          await expect(
            service.calificarCita(user, CITA_ID, bad),
          ).rejects.toBeInstanceOf(BadRequestException);
        }
        expect(calls).toHaveLength(0);
      });

      it('solo se califican citas realizadas (409) y propias (404)', async () => {
        rpcOk();
        fakeDatabase({
          cita: { data: { ...realizada, estado: 'confirmada' } },
        });
        const { spy } = fakeUserClient({});
        await expect(
          service.calificarCita(user, CITA_ID, { puntuacion: 5 }),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(spy).not.toHaveBeenCalled();

        fakeDatabase({ cita: { data: null } });
        await expect(
          service.calificarCita(user, CITA_ID, { puntuacion: 5 }),
        ).rejects.toBeInstanceOf(NotFoundException);
        await expect(
          service.calificarCita(user, 'x', { puntuacion: 5 }),
        ).rejects.toBeInstanceOf(NotFoundException);
      });

      it('una segunda calificación de la misma cita responde 409', async () => {
        rpcOk();
        fakeDatabase({ cita: { data: realizada } });
        fakeUserClient({
          calificacion: {
            error: { code: '23505', message: 'duplicate key value' },
          },
        });

        await expect(
          service.calificarCita(user, CITA_ID, { puntuacion: 5 }),
        ).rejects.toThrow('Ya calificaste esta cita');
      });

      it('si la base rechaza la calificación, traduce el error', async () => {
        rpcOk();
        fakeDatabase({ cita: { data: realizada } });
        fakeUserClient({
          calificacion: {
            error: { message: 'Solo se puede calificar una cita realizada' },
          },
        });

        await expect(
          service.calificarCita(user, CITA_ID, { puntuacion: 5 }),
        ).rejects.toBeInstanceOf(ConflictException);
      });
    });
  });
});
