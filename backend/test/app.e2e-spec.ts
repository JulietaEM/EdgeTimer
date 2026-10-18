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

  it.each([
    ['GET', '/citas'],
    ['GET', '/slots'],
    ['GET', '/catalogos/barberos'],
    ['GET', '/catalogos/procedimientos'],
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
});
