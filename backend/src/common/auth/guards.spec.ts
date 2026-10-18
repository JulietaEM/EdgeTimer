import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthUser } from './auth-user';
import {
  ALLOW_PENDING_PASSWORD_KEY,
  IS_PUBLIC_KEY,
  ROLES_KEY,
} from './decorators';
import { RolesGuard } from './roles.guard';

// El guard JWT importa supabase.ts, que exige variables de entorno.
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_KEY = 'anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

import { supabaseAdmin } from '../../supabase';
import { JwtAuthGuard, extractBearerToken } from './jwt-auth.guard';
import * as profile from './profile';

function contextWith(request: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class Fake {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function reflectorReturning(values: Record<string, unknown>) {
  const reflector = new Reflector();
  jest
    .spyOn(reflector, 'getAllAndOverride')
    .mockImplementation((key) => values[key] as never);
  return reflector;
}

const barbero: AuthUser = {
  userId: 'u1',
  role: 'barbero',
  profileId: 'b1',
  idBarberia: 'bar1',
  nombre: 'Carlos',
  email: 'carlos@correo.com',
  accessToken: 't',
  mustChangePassword: false,
};

describe('extractBearerToken', () => {
  it('extrae el token del encabezado', () => {
    expect(extractBearerToken('Bearer abc.def')).toBe('abc.def');
    expect(extractBearerToken('bearer abc')).toBe('abc');
  });

  it('devuelve null si no es Bearer', () => {
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken('Basic abc')).toBeNull();
    expect(extractBearerToken('Bearer')).toBeNull();
  });
});

describe('JwtAuthGuard', () => {
  it('deja pasar las rutas @Public sin token', async () => {
    const guard = new JwtAuthGuard(
      reflectorReturning({ [IS_PUBLIC_KEY]: true }),
    );
    await expect(guard.canActivate(contextWith({ headers: {} }))).resolves.toBe(
      true,
    );
  });

  it('rechaza con 401 un token que Supabase no reconoce', async () => {
    jest.spyOn(supabaseAdmin.auth, 'getUser').mockResolvedValue({
      data: { user: null },
      error: { message: 'invalid JWT' },
    } as never);
    const guard = new JwtAuthGuard(reflectorReturning({}));

    await expect(
      guard.canActivate(
        contextWith({ headers: { authorization: 'Bearer inventado' } }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('con token válido deja el usuario en request.user', async () => {
    jest.spyOn(supabaseAdmin.auth, 'getUser').mockResolvedValue({
      data: { user: { id: 'u1' } },
      error: null,
    } as never);
    jest.spyOn(profile, 'loadAuthUser').mockResolvedValue(barbero);
    const request: Record<string, unknown> = {
      headers: { authorization: 'Bearer bueno' },
    };
    const guard = new JwtAuthGuard(reflectorReturning({}));

    await expect(guard.canActivate(contextWith(request))).resolves.toBe(true);
    expect(request.user).toEqual(barbero);
    expect(profile.loadAuthUser).toHaveBeenCalledWith('bueno', 'u1');
  });

  it('con contraseña temporal sin cambiar bloquea las rutas normales (403)', async () => {
    jest.spyOn(supabaseAdmin.auth, 'getUser').mockResolvedValue({
      data: { user: { id: 'u1' } },
      error: null,
    } as never);
    jest
      .spyOn(profile, 'loadAuthUser')
      .mockResolvedValue({ ...barbero, mustChangePassword: true });
    const guard = new JwtAuthGuard(reflectorReturning({}));

    await expect(
      guard.canActivate(
        contextWith({ headers: { authorization: 'Bearer bueno' } }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('con contraseña temporal permite las rutas marcadas para cambiarla', async () => {
    jest.spyOn(supabaseAdmin.auth, 'getUser').mockResolvedValue({
      data: { user: { id: 'u1' } },
      error: null,
    } as never);
    jest
      .spyOn(profile, 'loadAuthUser')
      .mockResolvedValue({ ...barbero, mustChangePassword: true });
    const guard = new JwtAuthGuard(
      reflectorReturning({ [ALLOW_PENDING_PASSWORD_KEY]: true }),
    );

    await expect(
      guard.canActivate(
        contextWith({ headers: { authorization: 'Bearer bueno' } }),
      ),
    ).resolves.toBe(true);
  });

  it('rechaza con 401 si falta el token en una ruta protegida', async () => {
    const guard = new JwtAuthGuard(reflectorReturning({}));
    await expect(
      guard.canActivate(contextWith({ headers: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('RolesGuard', () => {
  it('permite todo si la ruta no declara roles', () => {
    const guard = new RolesGuard(reflectorReturning({}));
    expect(guard.canActivate(contextWith({ user: barbero }))).toBe(true);
  });

  it('permite si el rol del usuario está en la lista', () => {
    const guard = new RolesGuard(
      reflectorReturning({ [ROLES_KEY]: ['barbero', 'admin'] }),
    );
    expect(guard.canActivate(contextWith({ user: barbero }))).toBe(true);
  });

  it('responde 403 si el rol no está permitido', () => {
    const guard = new RolesGuard(
      reflectorReturning({ [ROLES_KEY]: ['admin'] }),
    );
    expect(() => guard.canActivate(contextWith({ user: barbero }))).toThrow(
      ForbiddenException,
    );
  });

  it('responde 403 si no hay usuario en la petición', () => {
    const guard = new RolesGuard(
      reflectorReturning({ [ROLES_KEY]: ['admin'] }),
    );
    expect(() => guard.canActivate(contextWith({}))).toThrow(
      ForbiddenException,
    );
  });
});
