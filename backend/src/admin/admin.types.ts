export interface CreateBarberoDto {
  nombre: string;
  email: string;
  telefono?: string;
  /** Contraseña temporal: el barbero la cambia en su primer ingreso. */
  password: string;
  procedimientoIds?: string[];
}

export interface UpdateBarberoDto {
  nombre?: string;
  email?: string;
  telefono?: string | null;
  /** Restablece la contraseña temporal (el barbero deberá cambiarla otra vez). */
  nuevaContrasenaTemporal?: string;
  procedimientoIds?: string[];
}

export interface BarberoView {
  id: string;
  nombre: string;
  usuario: string;
  email: string | null;
  telefono: string | null;
  foto: string | null;
  activo: boolean;
  promedioCalificacion: number;
  /** El barbero aún no ha cambiado la contraseña temporal. */
  pendienteCambioContrasena: boolean;
  procedimientoIds: string[];
  especialidades: { id: string; nombre: string }[];
}

export interface ProcedimientoView {
  id: string;
  nombre: string;
  descripcion: string;
  precio: number;
  duracionMinutos: number;
  activo: boolean;
}

export interface CreateProcedimientoDto {
  nombre: string;
  descripcion?: string;
  /** Pesos colombianos, entero. */
  precio: number | string;
  /** Múltiplo de 15. */
  duracionMinutos: number | string;
}

export interface UpdateProcedimientoDto {
  nombre?: string;
  descripcion?: string | null;
  precio?: number | string;
  duracionMinutos?: number | string;
  activo?: boolean;
}

export interface ResenaQuery {
  barberoId?: string;
  offset?: string;
  limit?: string;
}

export interface ResenaView {
  id: string;
  puntuacion: number;
  comentario: string;
  fecha: string;
  cliente: string;
  barbero: string;
  barberoId: string;
  servicios: string[];
}

export interface ResenasResponse {
  resumen: { promedio: number; total: number };
  items: ResenaView[];
  hayMas: boolean;
}
