import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { supabaseAdmin } from '../../supabase';
import type { RequestWithUser } from './auth-user';
import { IS_PUBLIC_KEY } from './decorators';
import { loadAuthUser } from './profile';

export function extractBearerToken(header?: string) {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/**
 * Guard global: toda ruta exige un token válido de Supabase salvo que esté
 * marcada con @Public(). Deja el usuario en request.user.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = extractBearerToken(request.headers.authorization);

    if (!token) {
      throw new UnauthorizedException('Falta el token de acceso');
    }

    const { data, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !data.user) {
      throw new UnauthorizedException('La sesión no es válida o expiró');
    }

    request.user = await loadAuthUser(token, data.user.id);
    return true;
  }
}
