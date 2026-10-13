export type UserRole = 'cliente' | 'barbero' | 'admin';

export interface RegisterClientDto {
  nombre: string;
  email: string;
  telefono?: string;
  password: string;
  aceptaTerminos: boolean;
}

export interface RegisterBarberiaDto {
  barberia: {
    nombre: string;
    direccion?: string;
    telefono?: string;
    descripcion?: string;
  };
  admin: {
    nombre: string;
    email: string;
    telefono?: string;
    password: string;
  };
  aceptaTerminos: boolean;
}

export interface LoginDto {
  email: string;
  password: string;
  /** Obsoleto: el rol ahora se deduce de la cuenta. Se ignora si llega. */
  role?: UserRole;
}

export interface RefreshDto {
  refreshToken: string;
}

export interface ForgotPasswordDto {
  email: string;
}

export interface ResetPasswordDto {
  /** Token de un solo uso que llega en el enlace del correo. */
  tokenHash: string;
  password: string;
}

export interface UpdateProfileDto {
  nombre?: string;
  telefono?: string | null;
  email?: string;
}

export interface DeleteAccountDto {
  password: string;
}

export interface AuthProfile {
  id: string;
  nombre: string;
  usuario: string;
  email: string | null;
  telefono: string | null;
  role: UserRole;
  foto: string | null;
  createdAt: string | null;
  idBarberia: string | null;
  barberia: {
    id: string;
    nombre: string;
    direccion: string | null;
    telefono: string | null;
  } | null;
}
