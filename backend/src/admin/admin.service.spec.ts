import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';

// El servicio importa supabase.ts, que exige variables de entorno.
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_KEY = 'anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

import { AccountsService } from '../common/accounts.service';
import type { AuthUser } from '../common/auth/auth-user';
import { supabaseAdmin } from '../supabase';
import { AdminService } from './admin.service';

const admin: AuthUser = {
  userId: 'admin-1',
  role: 'admin',
  profileId: 'adm-1',
  idBarberia: 'bar-1',
  nombre: 'Juan',
  email: 'juan@correo.com',
  accessToken: 't',
  mustChangePassword: false,
};

const barberoRow = {
  id_barbero: 'b1',
  user_id: 'u-b1',
  nombre_barbero: 'Carlos',
  usuario: 'carlos',
  email: 'carlos@correo.com',
  telefono: '3001234567',
  foto_perfil: null,
  activo: true,
  promedio_calificacion: '4.5',
  barbero_procedimiento: [
    {
      id_procedimiento: 'p1',
      procedimiento: { id_procedimiento: 'p1', nombre: 'Corte clásico' },
    },
  ],
};

type Result = { data?: unknown; error?: unknown; count?: number };

/** supabaseAdmin.from(tabla) devuelve un constructor encadenable que resuelve a `results[tabla]`. */
function fakeTables(results: Record<string, Result>) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];

  jest.spyOn(supabaseAdmin, 'from').mockImplementation(((table: string) => {
    const result = { data: null, error: null, ...results[table] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proxy: any = new Proxy(function () {}, {
      get: (_target, prop: string) => {
        if (prop === 'then') {
          return (
            resolve: (value: unknown) => unknown,
            reject: (e: unknown) => unknown,
          ) => Promise.resolve(result).then(resolve, reject);
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return (...args: unknown[]) => {
          calls.push({ table, method: prop, args });
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return proxy;
        };
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return proxy;
  }) as never);

  return calls;
}

describe('AdminService', () => {
  let accounts: AccountsService;
  let service: AdminService;

  beforeEach(() => {
    accounts = new AccountsService();
    jest.spyOn(accounts, 'audit').mockResolvedValue(undefined);
    service = new AdminService(accounts);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('lista los barberos con sus especialidades y si les falta cambiar la contraseña', async () => {
    fakeTables({
      barbero: { data: [barberoRow] },
      perfil: { data: [{ user_id: 'u-b1' }] },
    });

    const result = await service.listBarberos(admin);

    expect(result).toEqual([
      expect.objectContaining({
        id: 'b1',
        nombre: 'Carlos',
        promedioCalificacion: 4.5,
        pendienteCambioContrasena: true,
        procedimientoIds: ['p1'],
        especialidades: [{ id: 'p1', nombre: 'Corte clásico' }],
      }),
    ]);
  });

  it('filtra siempre por la barbería del administrador', async () => {
    const calls = fakeTables({ barbero: { data: [] } });

    await service.listBarberos(admin);

    expect(calls).toContainEqual({
      table: 'barbero',
      method: 'eq',
      args: ['id_barberia', 'bar-1'],
    });
  });

  it('no deja editar a un barbero de otra barbería (404)', async () => {
    fakeTables({ barbero: { data: null } });

    await expect(
      service.updateBarbero(admin, 'b-ajeno', { nombre: 'Nuevo' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('no deja dar de baja a un barbero con citas próximas (409)', async () => {
    fakeTables({
      barbero: { data: barberoRow },
      cita: { count: 2 },
    });
    const deleteUser = jest
      .spyOn(supabaseAdmin.auth.admin, 'deleteUser')
      .mockResolvedValue({ error: null } as never);

    await expect(service.deleteBarbero(admin, 'b1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('da de baja a un barbero sin citas y elimina su cuenta de acceso', async () => {
    const calls = fakeTables({
      barbero: { data: barberoRow },
      cita: { count: 0 },
    });
    const deleteUser = jest
      .spyOn(supabaseAdmin.auth.admin, 'deleteUser')
      .mockResolvedValue({ error: null } as never);

    const result = await service.deleteBarbero(admin, 'b1');

    expect(result.message).toBe('Barbero dado de baja');
    expect(deleteUser).toHaveBeenCalledWith('u-b1');
    expect(calls).toContainEqual({
      table: 'barbero',
      method: 'update',
      args: [{ activo: false, email: null, telefono: null, foto_perfil: null }],
    });
  });

  it('si falla el alta del barbero, deshace la cuenta creada', async () => {
    jest.spyOn(accounts, 'ensureEmailIsFree').mockResolvedValue(undefined);
    jest.spyOn(accounts, 'createAuthUser').mockResolvedValue('u-nuevo');
    jest.spyOn(accounts, 'insertPerfil').mockResolvedValue(undefined);
    jest.spyOn(accounts, 'generateUsername').mockResolvedValue('carlos');
    fakeTables({ barbero: { error: { message: 'fallo de base de datos' } } });
    const deleteUser = jest
      .spyOn(supabaseAdmin.auth.admin, 'deleteUser')
      .mockResolvedValue({ error: null } as never);

    await expect(
      service.createBarbero(admin, {
        nombre: 'Carlos',
        email: 'carlos@correo.com',
        password: 'Temporal123',
      }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(deleteUser).toHaveBeenCalledWith('u-nuevo');
  });

  it('crea la cuenta del barbero con contraseña temporal y sin política aceptada', async () => {
    jest.spyOn(accounts, 'ensureEmailIsFree').mockResolvedValue(undefined);
    const createAuthUser = jest
      .spyOn(accounts, 'createAuthUser')
      .mockResolvedValue('u-nuevo');
    const insertPerfil = jest
      .spyOn(accounts, 'insertPerfil')
      .mockResolvedValue(undefined);
    jest.spyOn(accounts, 'generateUsername').mockResolvedValue('carlos');
    fakeTables({
      barbero: { data: { ...barberoRow, id_barbero: 'b-nuevo' } },
      barbero_procedimiento: { data: [] },
    });

    const result = await service.createBarbero(admin, {
      nombre: 'Carlos',
      email: 'Carlos@Correo.com',
      password: 'Temporal123',
    });

    expect(createAuthUser).toHaveBeenCalledWith(
      'carlos@correo.com',
      'Temporal123',
      { nombre: 'Carlos', rol: 'barbero' },
    );
    expect(insertPerfil).toHaveBeenCalledWith('u-nuevo', 'barbero', {
      acceptedTerms: false,
      mustChangePassword: true,
    });
    expect(result.message).toContain('contraseña temporal');
  });

  describe('procedimientos', () => {
    const procedimientoRow = {
      id_procedimiento: 'p-nuevo',
      nombre: 'Corte clásico',
      descripcion: null,
      precio: '35000',
      duracion_minutos: 45,
      activo: true,
    };

    it('crea un procedimiento validando precio y duración', async () => {
      const calls = fakeTables({ procedimiento: { data: procedimientoRow } });

      const result = await service.createProcedimiento(admin, {
        nombre: ' Corte clásico ',
        precio: '35000',
        duracionMinutos: 45,
      });

      expect(result.message).toBe('Procedimiento creado');
      expect(result.procedimiento).toEqual({
        id: 'p-nuevo',
        nombre: 'Corte clásico',
        descripcion: '',
        precio: 35000,
        duracionMinutos: 45,
        activo: true,
      });
      expect(calls).toContainEqual({
        table: 'procedimiento',
        method: 'insert',
        args: [
          {
            id_barberia: 'bar-1',
            nombre: 'Corte clásico',
            descripcion: null,
            precio: 35000,
            duracion_minutos: 45,
            activo: true,
          },
        ],
      });
    });

    it('no permite dos procedimientos con el mismo nombre (409)', async () => {
      fakeTables({
        procedimiento: { data: [{ id_procedimiento: 'ya-existe' }] },
      });

      await expect(
        service.createProcedimiento(admin, {
          nombre: 'Corte clásico',
          precio: 35000,
          duracionMinutos: 45,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it.each([
      ['precio negativo', { precio: -1, duracionMinutos: 45 }],
      [
        'duración que no es múltiplo de 15',
        { precio: 1000, duracionMinutos: 20 },
      ],
    ])('rechaza %s (400)', async (_label, values) => {
      fakeTables({ procedimiento: { data: [] } });

      await expect(
        service.createProcedimiento(admin, { nombre: 'Tinte', ...values }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('no deja editar un procedimiento de otra barbería (404)', async () => {
      fakeTables({ procedimiento: { data: null } });

      await expect(
        service.updateProcedimiento(admin, 'p-ajeno', { precio: 1000 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('desactiva un procedimiento y lo informa', async () => {
      fakeTables({
        procedimiento: { data: { ...procedimientoRow, activo: false } },
      });

      const result = await service.updateProcedimiento(admin, 'p-nuevo', {
        activo: false,
      });

      expect(result.message).toBe('Procedimiento desactivado');
      expect(result.procedimiento.activo).toBe(false);
    });

    it('exige al menos un cambio (400)', async () => {
      fakeTables({ procedimiento: { data: procedimientoRow } });

      await expect(
        service.updateProcedimiento(admin, 'p-nuevo', {}),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('reseñas', () => {
    const resena = (id: string, puntos: number) => ({
      id_calificacion: id,
      puntuacion_numerica: puntos,
      resena: puntos === 5 ? 'Excelente' : null,
      created_at: '2026-10-10T10:00:00Z',
      cita: {
        id_barbero: 'b1',
        id_barberia: 'bar-1',
        cliente: { nombre_cliente: 'Ana' },
        barbero: { nombre_barbero: 'Carlos' },
        cita_procedimiento: [{ procedimiento: { nombre: 'Corte clásico' } }],
      },
    });

    it('lista las reseñas de la barbería con resumen y paginación', async () => {
      const calls = fakeTables({
        calificacion: {
          data: [resena('c1', 5), resena('c2', 4), resena('c3', 3)],
        },
      });

      const result = await service.listResenas(admin, { limit: '2' });

      expect(result.items).toHaveLength(2);
      expect(result.hayMas).toBe(true);
      expect(result.resumen).toEqual({ promedio: 4, total: 3 });
      expect(result.items[0]).toEqual({
        id: 'c1',
        puntuacion: 5,
        comentario: 'Excelente',
        fecha: '2026-10-10T10:00:00Z',
        cliente: 'Ana',
        barbero: 'Carlos',
        barberoId: 'b1',
        servicios: ['Corte clásico'],
      });
      expect(calls).toContainEqual({
        table: 'calificacion',
        method: 'eq',
        args: ['cita.id_barberia', 'bar-1'],
      });
    });

    it('filtra por barbero cuando se pide', async () => {
      const calls = fakeTables({ calificacion: { data: [] } });

      await service.listResenas(admin, {
        barberoId: '11111111-1111-4111-8111-111111111111',
      });

      expect(calls).toContainEqual({
        table: 'calificacion',
        method: 'eq',
        args: ['cita.id_barbero', '11111111-1111-4111-8111-111111111111'],
      });
    });

    it('rechaza un barbero con id inválido (400)', async () => {
      fakeTables({ calificacion: { data: [] } });

      await expect(
        service.listResenas(admin, { barberoId: 'no-es-uuid' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
