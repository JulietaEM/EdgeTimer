import type { Actor } from '../common/reprogramacion';

/** Cada cosa que le puede pasar a una cita y que genera un aviso. */
export type EventoCita =
  | 'solicitada'
  | 'confirmada'
  | 'rechazada'
  | 'cancelada'
  | 'propuesta'
  | 'reprogramada'
  | 'propuesta_rechazada';

export type { Actor };

/** Lo que recibe el navegador (service worker) en cada aviso push. */
export interface PushPayload {
  titulo: string;
  mensaje: string;
  idCita: string | null;
  tipo: string;
}

export interface NotificacionView {
  id: string;
  titulo: string;
  mensaje: string;
  idCita: string | null;
  tipo: string;
  leida: boolean;
  creadaAt: string;
}

/** Forma que tiene `PushSubscription.toJSON()` en el navegador. */
export interface SuscripcionDto {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface BajaSuscripcionDto {
  endpoint: string;
}
