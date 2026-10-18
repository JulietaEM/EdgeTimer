import { UnauthorizedException } from '@nestjs/common';
import type { UserRole } from '../../auth/auth.types';
import { createSupabaseUserClient, supabaseAdmin } from '../../supabase';
import type { AuthUser } from './auth-user';

interface RpcProfile {
  id: string;
  nombre: string;
  email?: string | null;
  role: UserRole;
  idBarberia?: string | null;
}

/**
 * Pide a la base de datos quién es el dueño del token (función
 * get_current_auth_profile) y lo convierte en un AuthUser.
 */
export async function loadAuthUser(
  accessToken: string,
  userId: string,
): Promise<AuthUser> {
  const response = await createSupabaseUserClient(accessToken).rpc(
    'get_current_auth_profile',
  );
  const data: unknown = response.data;

  if (response.error || !data) {
    throw new UnauthorizedException('No hay perfil asociado a esta cuenta');
  }

  const profile = data as RpcProfile;

  const { data: perfil } = await supabaseAdmin
    .from('perfil')
    .select('debe_cambiar_contrasena')
    .eq('user_id', userId)
    .maybeSingle();

  return {
    userId,
    role: profile.role,
    profileId: profile.id,
    idBarberia: profile.idBarberia ?? null,
    nombre: profile.nombre,
    email: profile.email ?? null,
    accessToken,
    mustChangePassword:
      (perfil as { debe_cambiar_contrasena?: boolean } | null)
        ?.debe_cambiar_contrasena === true,
  };
}
