export type Role = 'cliente' | 'barbero' | 'admin';
export type AuthScreen = 'login' | 'register' | 'registerBarberia';
export type AppScreen = 'home' | 'agenda' | 'perfil';
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
