import {
  createParamDecorator,
  SetMetadata,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { UserRole } from '../../auth/auth.types';
import type { AuthUser, RequestWithUser } from './auth-user';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';
export const ALLOW_PENDING_PASSWORD_KEY = 'allowPendingPasswordChange';

/** Marca una ruta como pública (no exige token). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Permite usar la ruta aunque la cuenta tenga una contraseña temporal sin
 * cambiar (ver perfil, cambiar la contraseña, cerrar sesión).
 */
export const AllowPendingPasswordChange = () =>
  SetMetadata(ALLOW_PENDING_PASSWORD_KEY, true);

/** Restringe una ruta a ciertos roles. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/** Inyecta el usuario autenticado en el parámetro del controlador. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (!request.user) {
      throw new UnauthorizedException('No autenticado');
    }
    return request.user;
  },
);
