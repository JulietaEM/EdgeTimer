import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_KEY = 'anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.VAPID_PUBLIC_KEY = 'public-key';
process.env.VAPID_PRIVATE_KEY = 'private-key';
process.env.CRON_SECRET = 'secreto-del-job';

jest.mock('web-push');

import * as webpush from 'web-push';
import type { AuthUser } from '../common/auth/auth-user';
import { fakeAdmin, fakeUser } from '../test-utils/fake-supabase';
import { NotificacionesService } from './notificaciones.service';

const sendNotification = webpush.sendNotification as jest.Mock;

const user: AuthUser = {
  userId: 'user-1',
  role: 'cliente',
  profileId: 'c1',
  idBarberia: null,
  nombre: 'Ana',
  email: 'ana@correo.com',
  accessToken: 'token-ana',
  mustChangePassword: false,
};

const SUB = {
  endpoint: 'https://push.ejemplo.com/abc',
  p256dh: 'k1',
  auth: 'k2',
};
const DTO = { endpoint: SUB.endpoint, keys: { p256dh: 'k1', auth: 'k2' } };

const cita = (id: string, inicioAt: string) => ({
  id_cita: id,
  inicio_at: inicioAt,
  cliente: { user_id: 'u-cliente', nombre_cliente: 'Ana' },
  barbero: { user_id: 'u-barbero', nombre_barbero: 'Carlos' },
});

describe('NotificacionesService', () => {
  let service: NotificacionesService;

  beforeEach(() => {
    sendNotification.mockReset().mockResolvedValue({});
    service = new NotificacionesService();
  });

  afterEach(() => jest.restoreAllMocks());

  describe('configuración', () => {
    it('entrega la llave pública cuando hay llaves VAPID', () => {
      expect(service.getConfig()).toEqual({ vapidPublicKey: 'public-key' });
    });

    it('sin llaves VAPID apaga el push pero no falla', () => {
      const publica = process.env.VAPID_PUBLIC_KEY;
      delete process.env.VAPID_PUBLIC_KEY;

      expect(new NotificacionesService().getConfig()).toEqual({
        vapidPublicKey: null,
      });

      process.env.VAPID_PUBLIC_KEY = publica;
    });
  });

  describe('suscripciones', () => {
    it('guarda la suscripción con el usuario del token, no con uno enviado', async () => {
      const calls = fakeAdmin({ suscripcion_web_push: { data: null } });

      await service.suscribir(user, DTO, 'Mozilla/5.0');

      const upsert = calls.find((call) => call.method === 'upsert');
      expect(upsert?.table).toBe('suscripcion_web_push');
      expect(upsert?.args[0]).toMatchObject({
        user_id: 'user-1',
        endpoint: SUB.endpoint,
        p256dh: 'k1',
        auth: 'k2',
        user_agent: 'Mozilla/5.0',
      });
      expect(upsert?.args[1]).toEqual({ onConflict: 'endpoint' });
    });

    it.each([
      ['sin cuerpo', undefined],
      ['endpoint no https', { ...DTO, endpoint: 'http://push.ejemplo.com/a' }],
      ['sin llaves', { endpoint: SUB.endpoint }],
      [
        'llave vacía',
        { endpoint: SUB.endpoint, keys: { p256dh: '', auth: 'x' } },
      ],
    ])('rechaza una suscripción inválida: %s (400)', async (_name, dto) => {
      const calls = fakeAdmin({});

      await expect(service.suscribir(user, dto as never)).rejects.toThrow(
        BadRequestException,
      );
      expect(calls).toHaveLength(0);
    });

    it('la baja solo borra la suscripción de quien la pide', async () => {
      const calls = fakeAdmin({ suscripcion_web_push: { data: null } });

      await service.desuscribir(user, { endpoint: SUB.endpoint });

      expect(calls.map((c) => [c.method, c.args])).toEqual([
        ['delete', []],
        ['eq', ['endpoint', SUB.endpoint]],
        ['eq', ['user_id', 'user-1']],
      ]);
    });
  });

  describe('avisos de una cita', () => {
    const rows = [
      {
        user_id: 'u-barbero',
        id_cita: 'cita-1',
        titulo: 'Nueva solicitud de cita',
        mensaje: 'm1',
        metadata: { tipo: 'solicitada' },
      },
      {
        user_id: 'u-cliente',
        id_cita: 'cita-1',
        titulo: 'Solicitud enviada',
        mensaje: 'm2',
        metadata: { tipo: 'solicitada' },
      },
    ];

    it('guarda un aviso por persona y empuja a cada navegador suscrito', async () => {
      const calls = fakeAdmin({
        cita: { data: cita('cita-1', '2026-11-04T15:00:00.000Z') },
        notificacion: { data: rows },
        suscripcion_web_push: { data: [SUB] },
      });

      await service.citaEvento('cita-1', 'solicitada', 'cliente');

      const insert = calls.find(
        (call) => call.table === 'notificacion' && call.method === 'insert',
      );
      const guardadas = insert?.args[0] as Array<Record<string, unknown>>;
      expect(guardadas).toHaveLength(2);
      expect(guardadas.map((row) => row.user_id).sort()).toEqual([
        'u-barbero',
        'u-cliente',
      ]);
      expect(guardadas[0]).toMatchObject({
        canal: 'push',
        estado: 'enviada',
        id_cita: 'cita-1',
        clave: null,
        metadata: { tipo: 'solicitada' },
      });

      expect(sendNotification).toHaveBeenCalledTimes(2);
      const [subscription, body] = sendNotification.mock.calls[0] as [
        { endpoint: string; keys: Record<string, string> },
        string,
      ];
      expect(subscription).toEqual({
        endpoint: SUB.endpoint,
        keys: { p256dh: 'k1', auth: 'k2' },
      });
      expect(JSON.parse(body)).toMatchObject({
        idCita: 'cita-1',
        tipo: 'solicitada',
      });
    });

    it('en una propuesta lee el horario propuesto', async () => {
      const calls = fakeAdmin({
        cita: { data: cita('cita-1', '2026-11-04T15:00:00.000Z') },
        propuesta_reprogramacion: {
          data: [{ inicio_at: '2026-11-05T16:30:00.000Z' }],
        },
        notificacion: { data: [] },
        suscripcion_web_push: { data: [] },
      });

      await service.citaEvento('cita-1', 'propuesta', 'barbero');

      const insert = calls.find((call) => call.method === 'insert');
      const mensajes = (insert?.args[0] as Array<{ mensaje: string }>).map(
        (row) => row.mensaje,
      );
      expect(mensajes.some((mensaje) => mensaje.includes('11:30'))).toBe(true);
    });

    it('si falla la base no lanza: avisar nunca rompe la acción original', async () => {
      fakeAdmin({ cita: { data: null, error: { message: 'boom' } } });

      await expect(
        service.citaEvento('cita-1', 'solicitada', 'cliente'),
      ).resolves.toBeUndefined();
      expect(sendNotification).not.toHaveBeenCalled();
    });

    it('si falla el guardado tampoco lanza', async () => {
      fakeAdmin({
        cita: { data: cita('cita-1', '2026-11-04T15:00:00.000Z') },
        notificacion: { data: null, error: { message: 'boom' } },
      });

      await expect(
        service.citaEvento('cita-1', 'cancelada', 'cliente'),
      ).resolves.toBeUndefined();
    });

    it('borra la suscripción cuando el navegador responde 410 (ya no existe)', async () => {
      sendNotification.mockRejectedValue({ statusCode: 410 });
      const calls = fakeAdmin({
        cita: { data: cita('cita-1', '2026-11-04T15:00:00.000Z') },
        notificacion: { data: [rows[0]] },
        suscripcion_web_push: { data: [SUB] },
      });

      await service.citaEvento('cita-1', 'solicitada', 'cliente');

      const borrado = calls.find(
        (call) =>
          call.table === 'suscripcion_web_push' && call.method === 'delete',
      );
      expect(borrado).toBeDefined();
      expect(
        calls.some(
          (call) => call.method === 'eq' && call.args[1] === SUB.endpoint,
        ),
      ).toBe(true);
    });

    it('un error pasajero del push (500) no borra la suscripción', async () => {
      sendNotification.mockRejectedValue({ statusCode: 500 });
      const calls = fakeAdmin({
        cita: { data: cita('cita-1', '2026-11-04T15:00:00.000Z') },
        notificacion: { data: [rows[0]] },
        suscripcion_web_push: { data: [SUB] },
      });

      await service.citaEvento('cita-1', 'solicitada', 'cliente');

      expect(calls.some((call) => call.method === 'delete')).toBe(false);
    });

    it('sin suscripciones el aviso queda en la campana y no se llama al push', async () => {
      fakeAdmin({
        cita: { data: cita('cita-1', '2026-11-04T15:00:00.000Z') },
        notificacion: { data: rows },
        suscripcion_web_push: { data: [] },
      });

      await service.citaEvento('cita-1', 'solicitada', 'cliente');

      expect(sendNotification).not.toHaveBeenCalled();
    });
  });

  describe('recordatorios (RF-26)', () => {
    const NOW = new Date('2026-11-04T10:00:00.000Z');

    it('usa la ventana "24h" o "1h" y una clave única por persona e inicio', async () => {
      const lejana = '2026-11-04T20:00:00.000Z'; // en 10 h
      const cercana = '2026-11-04T10:30:00.000Z'; // en 30 min
      const calls = fakeAdmin({
        cita: { data: [cita('c-lejana', lejana), cita('c-cercana', cercana)] },
        notificacion: {
          data: [
            {
              user_id: 'u-cliente',
              id_cita: 'c-lejana',
              titulo: 't',
              mensaje: 'm',
              metadata: { tipo: 'recordatorio' },
            },
          ],
        },
        suscripcion_web_push: { data: [SUB] },
      });

      const resultado = await service.enviarRecordatorios(NOW);

      const upsert = calls.find((call) => call.method === 'upsert');
      const filas = upsert?.args[0] as Array<{
        clave: string;
        titulo: string;
        user_id: string;
      }>;

      expect(upsert?.args[1]).toEqual({
        onConflict: 'clave',
        ignoreDuplicates: true,
      });
      expect(filas.map((fila) => fila.clave).sort()).toEqual([
        `rec1h:c-cercana:u-barbero:${new Date(cercana).getTime()}`,
        `rec1h:c-cercana:u-cliente:${new Date(cercana).getTime()}`,
        `rec24h:c-lejana:u-barbero:${new Date(lejana).getTime()}`,
        `rec24h:c-lejana:u-cliente:${new Date(lejana).getTime()}`,
      ]);
      expect(filas.find((f) => f.clave.startsWith('rec1h'))?.titulo).toBe(
        'Tu cita es en menos de 1 hora',
      );

      // Solo se empuja lo que de verdad se insertó (la base ignoró los duplicados).
      expect(resultado).toEqual({ citas: 2, enviados: 1 });
      expect(sendNotification).toHaveBeenCalledTimes(1);
    });

    it('solo consulta citas confirmadas dentro de las próximas 24 horas', async () => {
      const calls = fakeAdmin({ cita: { data: [] } });

      const resultado = await service.enviarRecordatorios(NOW);

      expect(resultado).toEqual({ citas: 0, enviados: 0 });
      expect(calls.filter((c) => c.method === 'upsert')).toHaveLength(0);
      expect(calls.find((c) => c.method === 'eq')?.args).toEqual([
        'estado',
        'confirmada',
      ]);
      expect(calls.find((c) => c.method === 'gt')?.args).toEqual([
        'inicio_at',
        NOW.toISOString(),
      ]);
      expect(calls.find((c) => c.method === 'lte')?.args).toEqual([
        'inicio_at',
        '2026-11-05T10:00:00.000Z',
      ]);
    });

    it('omite a quien no tiene cuenta vinculada', async () => {
      const sinCuenta = {
        ...cita('c1', '2026-11-04T20:00:00.000Z'),
        barbero: { user_id: null, nombre_barbero: 'Carlos' },
      };
      const calls = fakeAdmin({
        cita: { data: [sinCuenta] },
        notificacion: { data: [] },
      });

      await service.enviarRecordatorios(NOW);

      const filas = calls.find((c) => c.method === 'upsert')?.args[0] as Array<{
        user_id: string;
      }>;
      expect(filas.map((fila) => fila.user_id)).toEqual(['u-cliente']);
    });
  });

  describe('secreto del job', () => {
    it('acepta el secreto correcto', () => {
      expect(() => service.assertCronSecret('secreto-del-job')).not.toThrow();
    });

    it.each([[undefined], [''], ['otro'], ['secreto-del-jobX']])(
      'rechaza %p con 401',
      (secreto) => {
        expect(() => service.assertCronSecret(secreto)).toThrow(
          UnauthorizedException,
        );
      },
    );

    it('sin CRON_SECRET configurado responde 503 y nunca deja pasar', () => {
      const guardado = process.env.CRON_SECRET;
      delete process.env.CRON_SECRET;

      expect(() => service.assertCronSecret('')).toThrow(
        ServiceUnavailableException,
      );
      expect(() => service.assertCronSecret(undefined)).toThrow(
        ServiceUnavailableException,
      );

      process.env.CRON_SECRET = guardado;
    });
  });

  describe('la campana', () => {
    const fila = {
      id_notificacion: 'n1',
      user_id: 'user-1',
      id_cita: 'cita-1',
      titulo: 'Cita cancelada',
      mensaje: 'x',
      estado: 'enviada',
      metadata: { tipo: 'cancelada' },
      created_at: '2026-11-04T15:00:00.000Z',
    };

    it('lista con el token de la persona (RLS) y cuenta las no leídas', async () => {
      const { calls, spy } = fakeUser({
        notificacion: [
          { data: [fila, { ...fila, id_notificacion: 'n2', estado: 'leida' }] },
          { count: 3 },
        ],
      });

      const resultado = await service.listar(user, '500');

      expect(spy).toHaveBeenCalledWith('token-ana');
      expect(resultado.noLeidas).toBe(3);
      expect(resultado.items.map((i) => [i.id, i.leida, i.tipo])).toEqual([
        ['n1', false, 'cancelada'],
        ['n2', true, 'cancelada'],
      ]);
      // El límite se acota a 50 aunque pidan 500.
      expect(calls.find((c) => c.method === 'limit')?.args).toEqual([50]);
    });

    it('marcar leída rechaza ids inválidos (404) sin consultar', async () => {
      const { calls } = fakeUser({});

      await expect(service.marcarLeida(user, 'no-es-uuid')).rejects.toThrow(
        NotFoundException,
      );
      expect(calls).toHaveLength(0);
    });

    it('marcar leída solo toca las propias pendientes de leer', async () => {
      const { calls } = fakeUser({ notificacion: { data: null } });

      await service.marcarLeida(user, '11111111-1111-4111-8111-111111111111');

      expect(calls.find((c) => c.method === 'update')?.args[0]).toMatchObject({
        estado: 'leida',
      });
      expect(calls.filter((c) => c.method === 'eq').map((c) => c.args)).toEqual(
        [
          ['id_notificacion', '11111111-1111-4111-8111-111111111111'],
          ['estado', 'enviada'],
        ],
      );
    });

    it('marcar todas deja leídas las no leídas', async () => {
      const { calls } = fakeUser({ notificacion: { data: null } });

      await service.marcarTodasLeidas(user);

      expect(calls.find((c) => c.method === 'update')).toBeDefined();
      expect(calls.find((c) => c.method === 'eq')?.args).toEqual([
        'estado',
        'enviada',
      ]);
    });
  });
});
