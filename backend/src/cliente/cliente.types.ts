import type { PropuestaView } from '../common/reprogramacion';

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

/**
 * Procedimientos que el cliente puede elegir con un barbero (paso 3).
 * `especialidades`: los asignados al barbero. `barberia`: el barbero no tiene
 * ninguno asignado, así que se ofrecen todos los activos de su barbería.
 */
export interface ProcedimientosBarberoView {
  origen: 'especialidades' | 'barberia';
  procedimientos: EspecialidadView[];
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

/** Parámetros de `GET /cliente/barberos/:id/disponibilidad`. */
export interface DisponibilidadQuery {
  /** ids de procedimientos separados por coma. */
  procedimientos?: string;
  /** AAAA-MM-DD; por defecto hoy. */
  desde?: string;
  /** 1 a 31; por defecto 14. */
  dias?: string;
  /** Cita que se está reprogramando: su horario actual cuenta como libre. */
  excluirCita?: string;
}

/** Fechas y horas libres para agendar (paso 4) con los totales de la cita (HU-20). */
export interface DisponibilidadView {
  duracionMinutos: number;
  costoTotal: number;
  desde: string;
  hasta: string;
  dias: { fecha: string; horas: string[] }[];
}

export type EstadoCitaCliente =
  | 'pendiente'
  | 'confirmada'
  | 'realizada'
  | 'cancelada'
  | 'rechazada';

/** Datos para solicitar una cita (paso 5: confirmar). */
export interface CrearCitaDto {
  idBarbero: string;
  procedimientoIds: string[];
  /** AAAA-MM-DD */
  fecha: string;
  /** HH:MM, una de las horas que devolvió la disponibilidad. */
  horaInicio: string;
  notas?: string;
}

/** Una cita vista por el cliente. */
export interface CitaClienteView {
  id: string;
  estado: EstadoCitaCliente;
  /** "Vencida" cuando la solicitud nunca fue respondida. */
  estadoLabel: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  duracionMinutos: number;
  costoTotal: number;
  notas: string;
  /** Motivo de una cancelación o rechazo, si lo hay. */
  motivo: string | null;
  /** Abierta y con al menos 1 día de antelación: se puede cancelar o reprogramar. */
  puedeModificar: boolean;
  /** Cambio de horario pendiente de respuesta (propio o de la otra parte). */
  propuesta: PropuestaView | null;
  /** La calificación que dejó el cliente, si ya calificó. */
  calificacion: { puntuacion: number; resena: string } | null;
  /** Realizada y todavía sin calificar. */
  puedeCalificar: boolean;
  barbero: { id: string; nombre: string; foto: string | null };
  barberia: { id: string; nombre: string; direccion: string };
  procedimientos: {
    id: string;
    nombre: string;
    precio: number;
    duracionMinutos: number;
  }[];
}

/** `GET /cliente/citas?grupo=proximas|historial` (el historial se pagina). */
export interface CitasClienteQuery {
  grupo?: string;
  offset?: string;
  limit?: string;
}

export interface CitasClienteResultado {
  items: CitaClienteView[];
  /** Hay más citas después de esta página (solo en el historial). */
  hayMas: boolean;
}

/** Datos para calificar una cita realizada. */
export interface CalificarCitaDto {
  /** Entero de 1 a 5. */
  puntuacion: number;
  /** Opcional, máximo 500 caracteres. */
  resena?: string;
}

export interface MotivoCitaDto {
  motivo?: string;
}

export interface ReprogramarCitaDto {
  /** AAAA-MM-DD */
  fecha: string;
  /** HH:MM, una de las horas que devolvió la disponibilidad de esa cita. */
  horaInicio: string;
}
