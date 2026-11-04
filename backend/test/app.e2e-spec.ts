import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';

// Variables falsas: estas pruebas no tocan Supabase. Todas las peticiones se
// rechazan (401/400) antes de llegar a la base de datos.
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_KEY = 'anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

import { AppModule } from './../src/app.module';

describe('API (e2e, sin base de datos)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET / es público', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Servidor funcionando');
  });

  // Las rutas del dominio antiguo (AlphaCorte) confiaban en el profileId que
  // enviaba el cliente. Se eliminaron: deben responder 404, no 401.
  it.each([
    ['GET', '/citas'],
    ['POST', '/citas/solicitar'],
    ['POST', '/citas/reservar'],
    ['PATCH', '/citas/123/aceptar'],
    ['GET', '/slots'],
    ['POST', '/slots'],
    ['GET', '/catalogos/barberos'],
    ['GET', '/catalogos/procedimientos'],
    ['POST', '/catalogos/barberos/123/foto'],
  ])('%s %s (ruta antigua) ya no existe (404)', async (method, path) => {
    const res = await request(app.getHttpServer())[
      method.toLowerCase() as 'get'
    ](path);
    expect(res.status).toBe(404);
  });

  it.each([
    ['GET', '/auth/me'],
    ['PATCH', '/auth/me'],
    ['DELETE', '/auth/me'],
    ['POST', '/auth/logout'],
    ['POST', '/auth/me/password'],
    ['GET', '/admin/barberos'],
    ['POST', '/admin/barberos'],
    ['PATCH', '/admin/barberos/123'],
    ['DELETE', '/admin/barberos/123'],
    ['GET', '/admin/procedimientos'],
    ['POST', '/admin/procedimientos'],
    ['PATCH', '/admin/procedimientos/123'],
    ['GET', '/admin/resenas'],
    ['GET', '/barbero/resumen'],
    ['GET', '/barbero/disponibilidad'],
    ['PUT', '/barbero/disponibilidad'],
    ['GET', '/barbero/citas'],
    ['PATCH', '/barbero/citas/123/aceptar'],
    ['PATCH', '/barbero/citas/123/rechazar'],
    ['PATCH', '/barbero/citas/123/cancelar'],
    ['PATCH', '/barbero/citas/123/reprogramar'],
    ['PATCH', '/barbero/citas/123/propuesta/aceptar'],
    ['PATCH', '/barbero/citas/123/propuesta/rechazar'],
    ['PATCH', '/barbero/citas/123/propuesta/retirar'],
    ['GET', '/cliente/barberias'],
    ['GET', '/cliente/barberias/123/barberos'],
    ['GET', '/cliente/barberos/123'],
    ['GET', '/cliente/barberos/123/procedimientos'],
    ['GET', '/cliente/barberos/123/disponibilidad'],
    ['POST', '/cliente/citas'],
    ['GET', '/cliente/citas'],
    ['PATCH', '/cliente/citas/123/cancelar'],
    ['POST', '/cliente/citas/123/calificar'],
    ['PATCH', '/cliente/citas/123/reprogramar'],
    ['PATCH', '/cliente/citas/123/propuesta/aceptar'],
    ['PATCH', '/cliente/citas/123/propuesta/rechazar'],
    ['PATCH', '/cliente/citas/123/propuesta/retirar'],
    ['GET', '/notificaciones'],
    ['GET', '/notificaciones/config'],
    ['POST', '/notificaciones/suscripcion'],
    ['POST', '/notificaciones/suscripcion/baja'],
    ['POST', '/notificaciones/leer-todas'],
    ['PATCH', '/notificaciones/123/leer'],
  ])('%s %s exige token (401)', (method, path) => {
    return request(app.getHttpServer())
      [method.toLowerCase() as 'get'](path)
      .expect(401);
  });

  it('POST /auth/login valida el correo antes de consultar nada (400)', () => {
    return request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'no-es-correo', password: 'Clave1234' })
      .expect(400);
  });

  it('POST /auth/register-client exige aceptar la política de datos (400)', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/register-client')
      .send({
        nombre: 'Ana',
        email: 'ana@correo.com',
        password: 'Clave1234',
        aceptaTerminos: false,
      })
      .expect(400);

    expect(response.body.message).toContain('política');
  });

  it('POST /auth/forgot-password es público y valida el correo (400)', () => {
    return request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: 'no-es-correo' })
      .expect(400);
  });

  it('POST /auth/reset-password es público y valida la contraseña (400)', () => {
    return request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ tokenHash: 'abc', password: 'corta' })
      .expect(400);
  });

  it('POST /auth/register-barberia valida la contraseña (400)', () => {
    return request(app.getHttpServer())
      .post('/auth/register-barberia')
      .send({
        barberia: { nombre: 'Barbería Prueba' },
        admin: { nombre: 'Luis', email: 'luis@correo.com', password: 'corta' },
        aceptaTerminos: true,
      })
      .expect(400);
  });

  describe('POST /notificaciones/recordatorios (lo llama el job, sin token de usuario)', () => {
    const guardado = process.env.CRON_SECRET;

    afterEach(() => {
      process.env.CRON_SECRET = guardado;
      if (guardado === undefined) delete process.env.CRON_SECRET;
    });

    it('sin CRON_SECRET configurado responde 503 (nunca queda abierto)', () => {
      delete process.env.CRON_SECRET;

      return request(app.getHttpServer())
        .post('/notificaciones/recordatorios')
        .set('x-cron-secret', 'lo-que-sea')
        .expect(503);
    });

    it.each([[undefined], ['incorrecto']])(
      'con el secreto %p responde 401',
      (secreto) => {
        process.env.CRON_SECRET = 'secreto-del-job';
        const req = request(app.getHttpServer()).post(
          '/notificaciones/recordatorios',
        );

        return (secreto ? req.set('x-cron-secret', secreto) : req).expect(401);
      },
    );
  });
});
