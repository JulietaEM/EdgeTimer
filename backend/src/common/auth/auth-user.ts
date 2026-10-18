import type { Request } from 'express';
import type { UserRole } from '../../auth/auth.types';

/** Usuario autenticado que el guard deja disponible en cada petición. */
export interface AuthUser {
  userId: string;
  role: UserRole;
  /** id_cliente, id_barbero o id_administrador, según el rol. */
  profileId: string;
  idBarberia: string | null;
  nombre: string;
  email: string | null;
  accessToken: string;
  /** Contraseña temporal sin cambiar: solo puede usar las rutas de cambio de contraseña. */
  mustChangePassword: boolean;
}

export type RequestWithUser = Request & { user?: AuthUser };
