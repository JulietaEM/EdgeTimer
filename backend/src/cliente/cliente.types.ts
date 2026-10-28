/** Barbería que el cliente puede elegir (paso 1 del asistente). */
export interface BarberiaView {
  id: string;
  nombre: string;
  descripcion: string;
  direccion: string;
  telefono: string | null;
  logo: string | null;
  /** Barberos activos: sirve para avisar "sin barberos" antes de entrar. */
  totalBarberos: number;
}

/** Barbero dentro de la lista de una barbería (paso 2 del asistente). */
export interface BarberoListItem {
  id: string;
  nombre: string;
  foto: string | null;
  promedioCalificacion: number;
  especialidades: string[];
  /** Solo se puede agendar con barberos que ya definieron su disponibilidad. */
  tieneHorario: boolean;
  /** "Lun a Vie 08:00–18:00". Vacío si no tiene horario. */
  horarioResumen: string;
}

export interface EspecialidadView {
  id: string;
  nombre: string;
  descripcion: string;
  precio: number;
  duracionMinutos: number;
}

export interface ResenaPublicaView {
  id: string;
  puntuacion: number;
  comentario: string;
  fecha: string;
  /** Solo el primer nombre del cliente. */
  cliente: string;
}

/** Perfil público de un barbero. */
export interface BarberoPerfilView {
  id: string;
  nombre: string;
  foto: string | null;
  promedioCalificacion: number;
  totalResenas: number;
  barberia: {
    id: string;
    nombre: string;
    direccion: string;
    telefono: string | null;
    logo: string | null;
  };
  tieneHorario: boolean;
  horarioResumen: string;
  especialidades: EspecialidadView[];
  /** Las más recientes (máximo 10). */
  resenas: ResenaPublicaView[];
}
