import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

// El servicio importa supabase.ts, que exige variables de entorno.
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_KEY = 'anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

import { AccountsService } from '../common/accounts.service';
import type { AuthUser } from '../common/auth/auth-user';
import * as supabase from '../supabase';
import { fakeAdmin, fakeUser } from '../test-utils/fake-supabase';
import { BarberoService } from './barbero.service';
import { bogotaDate } from './barbero.utils';

const barbero: AuthUser = {
  userId: 'user-b1',
  role: 'barbero',
  profileId: 'b1',
  idBarberia: 'bar-1',
  nombre: 'Carlos',
  email: 'carlos@correo.com',
  accessToken: 'token-barbero',
  mustChangePassword: false,
};

const CITA_ID = '11111111-1111-4111-8111-111111111111';

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

function fakeDatabase(
  admin: Record<string, Result>,
  user: Record<string, Result> = {},
) {
  const adminCalls: Call[] = [];
  const userCalls: Call[] = [];

  jest
    .spyOn(supabase.supabaseAdmin, 'from')
    .mockImplementation(fakeFrom(admin, adminCalls) as never);
  jest
    .spyOn(supabase.supabaseAdmin, 'rpc')
    .mockResolvedValue({ error: null } as never);
  jest.spyOn(supabase, 'createSupabaseUserClient').mockReturnValue({
    from: fakeFrom(user, userCalls),
  } as never);

  return { adminCalls, userCalls };
}

const inDays = (days: number, hour = 10) => {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const day = bogotaDate(date.toISOString());
  return {
    fecha: day,
    inicio: new Date(`${day}T${String(hour).padStart(2, '0')}:00:00-05:00`),
  };
};

describe('BarberoService', () => {
  let accounts: AccountsService;
  let service: BarberoService;

  beforeEach(() => {
    accounts = new AccountsService();
    jest.spyOn(accounts, 'audit').mockResolvedValue(undefined);
    service = new BarberoService(accounts);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('disponibilidad', () => {
    it('devuelve los tramos con horas HH:MM', async () => {
      fakeDatabase({
        disponibilidad_barbero: {
          data: [
            { dia_semana: 1, hora_inicio: '09:00:00', hora_fin: '13:00:00' },
          ],
        },
      });

      await expect(service.getDisponibilidad(barbero)).resolves.toEqual({
        bloques: [{ dia: 1, inicio: '09:00', fin: '13:00' }],
      });
    });

    it('guarda los tramos unidos y borra los anteriores', async () => {
      const { adminCalls } = fakeDatabase({
        cita: { data: [] },
        disponibilidad_barbero: {
          data: [
            {
              id_disponibilidad: 'd1',
              dia_semana: 1,
              hora_inicio: '09:00:00',
              hora_fin: '13:00:00',
            },
          ],
        },
      });

      const result = await service.setDisponibilidad(barbero, {
        bloques: [
          { dia: 1, inicio: '09:00', fin: '12:00' },
          { dia: 1, inicio: '12:00', fin: '13:00' },
        ],
      });

      expect(result.message).toBe('Disponibilidad guardada');
      expect(adminCalls).toContainEqual({
        table: 'disponibilidad_barbero',
        method: 'insert',
        args: [
          [
            {
              id_barbero: 'b1',
              dia_semana: 1,
              hora_inicio: '09:00',
              hora_fin: '13:00',
              activo: true,
            },
          ],
        ],
      });
      expect(adminCalls.some((c) => c.method === 'delete')).toBe(true);
    });

    it('no deja quitar un horario que dejaría citas fuera (409)', async () => {
      const { adminCalls } = fakeDatabase({
        // martes 10:00-11:00 en Bogotá
        cita: {
          data: [
            {
              inicio_at: '2026-10-20T15:00:00Z',
              fin_at: '2026-10-20T16:00:00Z',
            },
          ],
        },
      });

      await expect(
        service.setDisponibilidad(barbero, {
          bloques: [{ dia: 3, inicio: '09:00', fin: '17:00' }],
        }),
      ).rejects.toThrow(/quedarían fuera una cita/);
      expect(adminCalls.some((c) => c.method === 'insert')).toBe(false);
    });

    it('valida los tramos antes de tocar la base (400)', async () => {
      fakeDatabase({});

      await expect(
        service.setDisponibilidad(barbero, {
          bloques: [{ dia: 1, inicio: '10:00', fin: '09:00' }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('listado de citas', () => {
    it('arma la vista con precios congelados y hora de Bogotá', async () => {
      const { inicio } = inDays(3);
      const fin = new Date(inicio.getTime() + 45 * 60000);
      const { adminCalls } = fakeDatabase({
        cita: {
          data: [
            {
              id_cita: CITA_ID,
              id_cliente: 'c1',
              inicio_at: inicio.toISOString(),
              fin_at: fin.toISOString(),
              estado: 'pendiente',
              notas_cliente: 'Sin prisa',
              motivo_estado: null,
              cliente: {
                id_cliente: 'c1',
                nombre_cliente: 'Ana',
                telefono: '300',
                foto_perfil: null,
              },
              cita_procedimiento: [
                {
                  precio_aplicado: '35000',
                  duracion_minutos_aplicada: 45,
                  procedimiento: { nombre: 'Corte clásico' },
                },
              ],
              calificacion: null,
            },
          ],
        },
      });

      const result = await service.listCitas(barbero, { grupo: 'solicitudes' });

      expect(result.hayMas).toBe(false);
      expect(result.items[0]).toEqual(
        expect.objectContaining({
          id: CITA_ID,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          cliente: expect.objectContaining({ nombre: 'Ana', telefono: '300' }),
          costoTotal: 35000,
          duracionTotal: 45,
          horaInicio: '10:00',
          horaFin: '10:45',
          estadoLabel: 'Pendiente',
          notas: 'Sin prisa',
          puedeModificar: true,
        }),
      );
      expect(adminCalls).toContainEqual({
        table: 'cita',
        method: 'eq',
        args: ['id_barbero', 'b1'],
      });
    });

    it('muestra como vencida una solicitud que nadie respondió', async () => {
      fakeDatabase({
        cita: {
          data: [
            {
              id_cita: CITA_ID,
              id_cliente: 'c1',
              inicio_at: '2020-01-01T15:00:00Z',
              fin_at: '2020-01-01T16:00:00Z',
              estado: 'rechazada',
              motivo_estado: 'Solicitud vencida sin respuesta',
              cita_procedimiento: [],
            },
          ],
        },
      });

      const result = await service.listCitas(barbero, { grupo: 'historial' });

      expect(result.items[0].estadoLabel).toBe('Vencida');
      expect(result.items[0].puedeModificar).toBe(false);
    });

    it('vence las solicitudes antes de listar', async () => {
      fakeDatabase({ cita: { data: [] } });

      await service.listCitas(barbero, { grupo: 'historial' });

      expect(supabase.supabaseAdmin.rpc).toHaveBeenCalledWith(
        'vencer_solicitudes',
      );
      expect(supabase.supabaseAdmin.rpc).toHaveBeenCalledWith(
        'realizar_citas_vencidas',
      );
    });

    it('rechaza un grupo desconocido (400)', async () => {
      fakeDatabase({});

      await expect(
        service.listCitas(barbero, { grupo: 'otro' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('responder solicitudes', () => {
    const owned = (estado: string, days = 3) => {
      const { inicio } = inDays(days);
      return {
        data: {
          id_cita: CITA_ID,
          estado,
          inicio_at: inicio.toISOString(),
          fin_at: new Date(inicio.getTime() + 3600000).toISOString(),
        },
      };
    };

    it('acepta con el token del barbero, para que la base aplique sus reglas', async () => {
      const { adminCalls, userCalls } = fakeDatabase(
        { cita: owned('pendiente') },
        { cita: { data: { id_cita: CITA_ID } } },
      );

      const result = await service.aceptar(barbero, CITA_ID);

      expect(result.message).toBe('Solicitud aceptada');
      expect(userCalls).toContainEqual({
        table: 'cita',
        method: 'update',
        args: [{ estado: 'confirmada' }],
      });
      expect(adminCalls.some((c) => c.method === 'update')).toBe(false);
      expect(supabase.createSupabaseUserClient).toHaveBeenCalledWith(
        'token-barbero',
      );
    });

    it('solo acepta solicitudes pendientes (409)', async () => {
      fakeDatabase({ cita: owned('confirmada') });

      await expect(service.aceptar(barbero, CITA_ID)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('no acepta una solicitud que ya venció (400)', async () => {
      fakeDatabase({ cita: owned('pendiente', -2) });

      await expect(service.aceptar(barbero, CITA_ID)).rejects.toThrow(
        'ya venció',
      );
    });

    it('rechaza guardando el motivo', async () => {
      const { userCalls } = fakeDatabase(
        { cita: owned('pendiente') },
        { cita: { data: { id_cita: CITA_ID } } },
      );

      await service.rechazar(barbero, CITA_ID, {
        motivo: ' No trabajo ese día ',
      });

      expect(userCalls).toContainEqual({
        table: 'cita',
        method: 'update',
        args: [{ estado: 'rechazada', motivo_estado: 'No trabajo ese día' }],
      });
    });

    it('no encuentra citas de otro barbero o con id inválido (404)', async () => {
      fakeDatabase({ cita: { data: null } });

      await expect(service.aceptar(barbero, CITA_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        service.aceptar(barbero, 'no-es-uuid'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('avisa si la cita cambió mientras tanto (409)', async () => {
      fakeDatabase({ cita: owned('pendiente') }, { cita: { data: null } });

      await expect(service.aceptar(barbero, CITA_ID)).rejects.toThrow(
        'Recarga la lista',
      );
    });
  });

  describe('cancelar y reprogramar', () => {
    const owned = (estado = 'confirmada') => {
      const { inicio } = inDays(5);
      return {
        cita: {
          data: {
            id_cita: CITA_ID,
            estado,
            inicio_at: inicio.toISOString(),
            fin_at: new Date(inicio.getTime() + 3600000).toISOString(),
          },
        },
        cita_procedimiento: { data: [{ duracion_minutos_aplicada: 30 }] },
      };
    };

    it('traduce la regla de 1 día de la base a un mensaje claro (400)', async () => {
      fakeDatabase(owned(), {
        cita: {
          error: {
            message:
              'La cita solo se puede cancelar o reprogramar con minimo 1 dia de anticipacion',
          },
        },
      });

      await expect(service.cancelar(barbero, CITA_ID, {})).rejects.toThrow(
        'al menos 1 día de antelación',
      );
    });

    it('no cancela una cita que ya está cancelada (409)', async () => {
      fakeDatabase(owned('cancelada'));

      await expect(
        service.cancelar(barbero, CITA_ID, {}),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('no reprograma a una fecha pasada (400)', async () => {
      fakeDatabase(owned());

      await expect(
        service.reprogramar(barbero, CITA_ID, {
          fecha: '2020-01-01',
          horaInicio: '10:00',
        }),
      ).rejects.toThrow('pasada');
    });
  });

  describe('propuestas de cambio de horario', () => {
    const CLIENTE = 'c1';
    const PROPUESTA_ID = '77777777-7777-4777-8777-777777777777';
    const isoDow = (fecha: string) =>
      new Date(`${fecha}T12:00:00-05:00`).getUTCDay() || 7;

    /** Horario de 8 a 18 el día de la semana de `fecha`. */
    const schedule = (fecha: string) => ({
      disponibilidad_barbero: {
        data: [
          {
            id_barbero: 'b1',
            dia_semana: isoDow(fecha),
            hora_inicio: '08:00:00',
            hora_fin: '18:00:00',
          },
        ],
      },
    });
    const ownedRow = (overrides: Record<string, unknown> = {}) => {
      const { inicio } = inDays(5);
      return {
        id_cita: CITA_ID,
        id_barbero: 'b1',
        id_cliente: CLIENTE,
        estado: 'confirmada',
        inicio_at: inicio.toISOString(),
        fin_at: new Date(inicio.getTime() + 1800000).toISOString(),
        ...overrides,
      };
    };
    const viewRow = () => ({
      ...ownedRow(),
      notas_cliente: null,
      motivo_estado: null,
      cliente: {
        id_cliente: CLIENTE,
        nombre_cliente: 'Ana',
        telefono: '300',
        foto_perfil: null,
      },
      cita_procedimiento: [
        {
          precio_aplicado: '27000',
          duracion_minutos_aplicada: 30,
          procedimiento: { nombre: 'Corte clásico' },
        },
      ],
      calificacion: null,
    });
    const propuestaRow = (fecha: string, por: 'cliente' | 'barbero') => {
      const inicio = new Date(`${fecha}T15:00:00-05:00`);
      return {
        id_propuesta: PROPUESTA_ID,
        id_cita: CITA_ID,
        propuesta_por: por,
        inicio_at: inicio.toISOString(),
        fin_at: new Date(inicio.getTime() + 1800000).toISOString(),
        estado: 'pendiente',
      };
    };
    const claimed = { data: { id_propuesta: PROPUESTA_ID } };
    const duration = {
      cita_procedimiento: { data: [{ duracion_minutos_aplicada: 30 }] },
    };

    it('reprogramar una cita confirmada crea una propuesta y NO mueve la cita', async () => {
      const { fecha } = inDays(8);
      const calls = fakeAdmin({
        ...schedule(fecha),
        ...duration,
        cita: [
          { data: ownedRow() },
          { data: [] },
          { data: [] },
          { data: viewRow() },
        ],
        propuesta_reprogramacion: [
          { data: [] },
          { error: null },
          { data: [propuestaRow(fecha, 'barbero')] },
        ],
      });
      const { spy } = fakeUser({});

      const result = await service.reprogramar(barbero, CITA_ID, {
        fecha,
        horaInicio: '15:00',
      });

      const insert = calls.find(
        (c) => c.table === 'propuesta_reprogramacion' && c.method === 'insert',
      );
      const row = insert?.args[0] as {
        propuesta_por: string;
        inicio_at: string;
        fin_at: string;
      };
      expect(row.propuesta_por).toBe('barbero');
      // Conserva la duración de los procedimientos (30 min).
      expect(
        new Date(row.fin_at).getTime() - new Date(row.inicio_at).getTime(),
      ).toBe(30 * 60000);
      // La cita no se toca: ni escritura con el token ni update de la service role.
      expect(spy).not.toHaveBeenCalled();
      expect(
        calls.some((c) => c.table === 'cita' && c.method === 'update'),
      ).toBe(false);
      expect(result.message).toContain('Propuesta enviada');
      expect(result.cita.propuesta).toMatchObject({
        propuestaPor: 'barbero',
        esPropia: true,
        puedeResponder: false,
        horaInicio: '15:00',
      });
      expect(
        JSON.stringify((accounts.audit as jest.Mock).mock.calls),
      ).toContain('proponer_reprogramacion');
    });

    it('una solicitud pendiente no se reprograma: se acepta o se rechaza', async () => {
      const { fecha } = inDays(8);
      fakeAdmin({ cita: { data: ownedRow({ estado: 'pendiente' }) } });

      await expect(
        service.reprogramar(barbero, CITA_ID, { fecha, horaInicio: '15:00' }),
      ).rejects.toThrow('se aceptan o se rechazan');
    });

    it('una cita cancelada o realizada ya no se reprograma (409)', async () => {
      const { fecha } = inDays(8);
      fakeAdmin({ cita: { data: ownedRow({ estado: 'cancelada' }) } });

      await expect(
        service.reprogramar(barbero, CITA_ID, { fecha, horaInicio: '15:00' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('valida la hora nueva contra su horario y las citas de ambos (409)', async () => {
      const { fecha } = inDays(8);
      const busy = new Date(`${fecha}T15:00:00-05:00`);

      // Otra cita del barbero ocupa esa hora.
      fakeAdmin({
        ...schedule(fecha),
        ...duration,
        cita: [
          { data: ownedRow() },
          {
            data: [
              {
                inicio_at: busy.toISOString(),
                fin_at: new Date(busy.getTime() + 1800000).toISOString(),
              },
            ],
          },
          { data: [] },
        ],
      });
      await expect(
        service.reprogramar(barbero, CITA_ID, { fecha, horaInicio: '15:00' }),
      ).rejects.toThrow('ya no está disponible');

      // Fuera de su horario laboral (8 a 18).
      fakeAdmin({
        ...schedule(fecha),
        ...duration,
        cita: [{ data: ownedRow() }, { data: [] }, { data: [] }],
      });
      await expect(
        service.reprogramar(barbero, CITA_ID, { fecha, horaInicio: '19:00' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('con menos de 1 día de antelación responde 400 y no crea nada', async () => {
      const { fecha } = inDays(8);
      const soon = new Date(Date.now() + 3 * 3600000);
      const calls = fakeAdmin({
        ...duration,
        cita: {
          data: ownedRow({
            inicio_at: soon.toISOString(),
            fin_at: new Date(soon.getTime() + 1800000).toISOString(),
          }),
        },
      });

      await expect(
        service.reprogramar(barbero, CITA_ID, { fecha, horaInicio: '15:00' }),
      ).rejects.toThrow('al menos 1 día de antelación');
      expect(calls.some((c) => c.method === 'insert')).toBe(false);
    });

    it('aceptar la propuesta del cliente mueve la cita con el token del barbero', async () => {
      const { fecha } = inDays(8);
      const calls = fakeAdmin({
        ...schedule(fecha),
        ...duration,
        cita: [
          { data: ownedRow() },
          { data: [] },
          { data: [] },
          { data: viewRow() },
        ],
        propuesta_reprogramacion: [
          { data: [propuestaRow(fecha, 'cliente')] },
          claimed,
          { data: [] },
        ],
      });
      const { calls: userCalls, spy } = fakeUser({
        cita: { data: { id_cita: CITA_ID } },
      });

      const result = await service.aceptarPropuesta(barbero, CITA_ID);

      expect(spy).toHaveBeenCalledWith('token-barbero');
      expect(userCalls).toContainEqual({
        table: 'cita',
        method: 'eq',
        args: ['id_barbero', 'b1'],
      });
      expect(userCalls.find((c) => c.method === 'update')?.args[0]).toEqual({
        inicio_at: new Date(`${fecha}T15:00:00-05:00`).toISOString(),
        fin_at: new Date(`${fecha}T15:30:00-05:00`).toISOString(),
      });
      expect(calls).toContainEqual({
        table: 'propuesta_reprogramacion',
        method: 'update',
        args: [expect.objectContaining({ estado: 'aceptada' })],
      });
      expect(result.message).toContain('Aceptaste');
    });

    it('no puede aceptar ni rechazar su propia propuesta (403)', async () => {
      const { fecha } = inDays(8);
      const db = {
        ...schedule(fecha),
        ...duration,
        cita: { data: ownedRow() },
        propuesta_reprogramacion: { data: [propuestaRow(fecha, 'barbero')] },
      };

      fakeAdmin(db);
      await expect(
        service.aceptarPropuesta(barbero, CITA_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);

      fakeAdmin(db);
      await expect(
        service.rechazarPropuesta(barbero, CITA_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rechazar la propuesta del cliente deja la cita como estaba', async () => {
      const { fecha } = inDays(8);
      const calls = fakeAdmin({
        cita: [{ data: ownedRow() }, { data: viewRow() }],
        propuesta_reprogramacion: [
          { data: [propuestaRow(fecha, 'cliente')] },
          claimed,
          { data: [] },
        ],
      });
      const { spy } = fakeUser({});

      const result = await service.rechazarPropuesta(barbero, CITA_ID);

      expect(calls).toContainEqual({
        table: 'propuesta_reprogramacion',
        method: 'update',
        args: [expect.objectContaining({ estado: 'rechazada' })],
      });
      expect(spy).not.toHaveBeenCalled();
      expect(result.message).toContain('Rechazaste');
    });

    it('retira su propia propuesta, pero no la del cliente', async () => {
      const { fecha } = inDays(8);
      const calls = fakeAdmin({
        cita: [{ data: ownedRow() }, { data: viewRow() }],
        propuesta_reprogramacion: [
          { data: [propuestaRow(fecha, 'barbero')] },
          claimed,
          { data: [] },
        ],
      });

      const result = await service.retirarPropuesta(barbero, CITA_ID);
      expect(calls).toContainEqual({
        table: 'propuesta_reprogramacion',
        method: 'update',
        args: [expect.objectContaining({ estado: 'retirada' })],
      });
      expect(result.message).toBe('Propuesta retirada.');

      fakeAdmin({
        cita: { data: ownedRow() },
        propuesta_reprogramacion: { data: [propuestaRow(fecha, 'cliente')] },
      });
      await expect(
        service.retirarPropuesta(barbero, CITA_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('la agenda del barbero muestra la propuesta del cliente para que responda', async () => {
      const { fecha } = inDays(8);
      jest
        .spyOn(supabase.supabaseAdmin, 'rpc')
        .mockResolvedValue({ error: null } as never);
      fakeAdmin({
        cita: { data: [viewRow()] },
        propuesta_reprogramacion: { data: [propuestaRow(fecha, 'cliente')] },
      });

      const result = await service.listCitas(barbero, { grupo: 'proximas' });

      expect(result.items[0].propuesta).toMatchObject({
        propuestaPor: 'cliente',
        esPropia: false,
        puedeResponder: true,
        horaInicio: '15:00',
      });
    });
  });
});
