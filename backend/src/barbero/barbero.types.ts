export type GrupoCitas = 'solicitudes' | 'proximas' | 'historial';

export interface DisponibilidadDto {
  bloques: { dia: number; inicio: string; fin: string }[];
}

export interface CitasQuery {
  grupo?: string;
  offset?: string;
  limit?: string;
}

export interface MotivoDto {
  motivo?: string;
}

export interface ReprogramarDto {
  fecha: string;
  horaInicio: string;
}

export interface CitaBarberoView {
  id: string;
  cliente: {
    id: string;
    nombre: string;
    telefono: string | null;
    foto: string | null;
  };
  procedimientos: { nombre: string; precio: number; duracionMinutos: number }[];
  costoTotal: number;
  duracionTotal: number;
  inicioAt: string;
  finAt: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  estado: string;
  estadoLabel: string;
  notas: string;
  motivo: string;
  /** Se puede cancelar o reprogramar: falta al menos 1 día. */
  puedeModificar: boolean;
  calificacion: { puntuacion: number; resena: string } | null;
}
