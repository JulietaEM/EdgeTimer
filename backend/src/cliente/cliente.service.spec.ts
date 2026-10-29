import { BadRequestException, NotFoundException } from '@nestjs/common';

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
function fakeFrom(results: Record<string, Result>, calls: Call[]) {
  return (table: string) => {
    const result = { data: null, error: null, ...results[table] };

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

function fakeDatabase(admin: Record<string, Result>) {
  const calls: Call[] = [];
  jest
    .spyOn(supabase.supabaseAdmin, 'from')
    .mockImplementation(fakeFrom(admin, calls) as never);
  return calls;
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
});
