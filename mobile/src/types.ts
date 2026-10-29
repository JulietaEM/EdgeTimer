export type Role = 'cliente' | 'barbero' | 'admin';
export type AuthScreen =
  | 'login'
  | 'register'
  | 'registerBarberia'
  | 'forgotPassword'
  | 'resetPassword';
export type AppScreen = 'home' | 'agenda' | 'disponibilidad' | 'perfil';
export type Screen = AuthScreen | AppScreen;

export interface BarberiaResumen {
  id: string;
  nombre: string;
  direccion: string | null;
  telefono: string | null;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  expiresAt?: number;
}

export interface SessionProfile {
  id: string;
  nombre: string;
  usuario: string;
  role: Role;
  email?: string | null;
  telefono?: string | null;
  foto?: string | null;
  createdAt?: string | null;
  idBarberia?: string | null;
  barberia?: BarberiaResumen | null;
  /** Cuenta creada por un administrador: debe elegir su propia contraseña. */
  debeCambiarContrasena?: boolean;
  /** Aún no ha aceptado la política de tratamiento de datos. */
  terminosPendientes?: boolean;
}

export interface BarberoAdmin {
  id: string;
  nombre: string;
  usuario: string;
  email: string | null;
  telefono: string | null;
  foto: string | null;
  promedioCalificacion: number;
  pendienteCambioContrasena: boolean;
  procedimientoIds: string[];
  especialidades: { id: string; nombre: string }[];
}

export interface ProcedimientoAdmin {
  id: string;
  nombre: string;
  descripcion: string;
  precio: number;
  duracionMinutos: number;
  activo: boolean;
}

export type EstadoCita =
  | 'pendiente'
  | 'confirmada'
  | 'realizada'
  | 'cancelada'
  | 'rechazada';

export interface Procedimiento {
  id: string;
  nombre: string;
  descripcion?: string;
  precio: number;
  duracionMinutos: number;
}

export interface Barbero {
  id: string;
  nombre: string;
  foto: string | null;
  promedioCalificacion: number;
  especialidades: Procedimiento[];
  horarioLaboral: string;
}

export interface SlotDisponible {
  id: string;
  barbero: Pick<Barbero, 'id' | 'nombre' | 'foto' | 'promedioCalificacion'>;
  inicioAt: string;
  finAt: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  estado: string;
}

export interface Cita {
  id: string;
  cliente: {
    id: string;
    nombre: string;
    foto: string | null;
  };
  barbero: Pick<Barbero, 'id' | 'nombre' | 'foto' | 'promedioCalificacion'>;
  slotId: string | null;
  procedimientos: Procedimiento[];
  costoTotal: number;
  inicioAt: string;
  finAt: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  estado: EstadoCita;
  estadoLabel: string;
  notas: string;
  puedeModificar: boolean;
  calificacion: {
    puntuacion: number;
    resena: string;
  } | null;
}

export interface ResenaAdmin {
  id: string;
  puntuacion: number;
  comentario: string;
  fecha: string;
  cliente: string;
  barbero: string;
  barberoId: string;
  servicios: string[];
}

export interface ResenasAdmin {
  resumen: { promedio: number; total: number };
  items: ResenaAdmin[];
  hayMas: boolean;
}

export interface BloqueDisponibilidad {
  /** 1 = lunes ... 7 = domingo. */
  dia: number;
  inicio: string;
  fin: string;
}

export interface ResumenBarbero {
  solicitudesPendientes: number;
  citasHoy: number;
  tieneDisponibilidad: boolean;
}

export interface CitaBarbero {
  id: string;
  cliente: { id: string; nombre: string; telefono: string | null; foto: string | null };
  procedimientos: { nombre: string; precio: number; duracionMinutos: number }[];
  costoTotal: number;
  duracionTotal: number;
  inicioAt: string;
  finAt: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  estado: 'pendiente' | 'confirmada' | 'realizada' | 'cancelada' | 'rechazada';
  estadoLabel: string;
  notas: string;
  motivo: string;
  puedeModificar: boolean;
  calificacion: { puntuacion: number; resena: string } | null;
}

export interface CitasBarbero {
  items: CitaBarbero[];
  hayMas: boolean;
}

// ---- Cliente: elegir barbería y barbero (HU-17) ----

export interface BarberiaCliente {
  id: string;
  nombre: string;
  descripcion: string;
  direccion: string;
  telefono: string | null;
  logo: string | null;
  totalBarberos: number;
}

export interface BarberoListaCliente {
  id: string;
  nombre: string;
  foto: string | null;
  promedioCalificacion: number;
  especialidades: string[];
  tieneHorario: boolean;
  horarioResumen: string;
}

export interface EspecialidadCliente {
  id: string;
  nombre: string;
  descripcion: string;
  precio: number;
  duracionMinutos: number;
}

export interface ResenaPublica {
  id: string;
  puntuacion: number;
  comentario: string;
  fecha: string;
  cliente: string;
}

export interface BarberoPerfilCliente {
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
  especialidades: EspecialidadCliente[];
  resenas: ResenaPublica[];
}

// ---- Cliente: elegir procedimientos (HU-18) ----

export interface ProcedimientosBarberoCliente {
  origen: 'especialidades' | 'barberia';
  procedimientos: EspecialidadCliente[];
}

/** Barbero elegido al empezar a agendar. */
export interface BarberoElegido {
  id: string;
  nombre: string;
}

// ---- Cliente: fechas y horas disponibles (HU-19) ----

export interface DisponibilidadCliente {
  duracionMinutos: number;
  costoTotal: number;
  desde: string;
  hasta: string;
  dias: { fecha: string; horas: string[] }[];
}
