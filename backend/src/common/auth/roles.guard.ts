import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '../../auth/auth.types';
import type { RequestWithUser } from './auth-user';
import { ROLES_KEY } from './decorators';

/** Guard global: si la ruta declara @Roles(...), el usuario debe tener uno de ellos. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!roles || roles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();

    if (!request.user || !roles.includes(request.user.role)) {
      throw new ForbiddenException('No tienes permisos para esta acción');
    }

    return true;
  }
}
