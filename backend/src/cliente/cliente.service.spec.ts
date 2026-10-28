import { NotFoundException } from '@nestjs/common';

// El servicio importa supabase.ts, que exige variables de entorno.
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_KEY = 'anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

import * as supabase from '../supabase';
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
});
