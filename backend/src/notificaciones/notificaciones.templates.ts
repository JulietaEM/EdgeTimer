import { bogotaHour } from '../barbero/barbero.utils';
import type { Actor, EventoCita } from './notificaciones.types';

/** "mar, 4 nov, 10:00": fecha corta y hora de Bogotá. */
export function formatCuando(iso: string) {
  const dia = new Date(iso).toLocaleDateString('es-CO', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'America/Bogota',
  });

  return `${dia}, ${bogotaHour(iso)}`;
}

export interface ContextoCita {
  idCita: string;
  inicioAt: string;
  cliente: { userId: string | null; nombre: string };
  barbero: { userId: string | null; nombre: string };
  /** Horario propuesto (solo en el evento `propuesta`). */
  propuestoAt?: string;
}

export interface Aviso {
  userId: string;
  titulo: string;
  mensaje: string;
}

/**
 * Quién recibe qué aviso en cada evento. Es una función pura: no toca la base
 * ni la red, así que se prueba sola. Cada acción sobre una cita avisa a la otra
 * parte (RF-16, RF-27) y confirma a quien la hizo (RF-22 / HU-22).
 */
export function avisosDeEvento(
  evento: EventoCita,
  actor: Actor,
  ctx: ContextoCita,
): Aviso[] {
  const { cliente, barbero } = ctx;
  const cuando = formatCuando(ctx.inicioAt);
  const actorEsCliente = actor === 'cliente';
  const quien = actorEsCliente ? cliente.nombre : barbero.nombre;
  const nuevo = ctx.propuestoAt ? formatCuando(ctx.propuestoAt) : cuando;
  const avisos: Array<Omit<Aviso, 'userId'> & { userId: string | null }> = [];

  switch (evento) {
    case 'solicitada':
      avisos.push(
        {
          userId: barbero.userId,
          titulo: 'Nueva solicitud de cita',
          mensaje: `${cliente.nombre} quiere agendar el ${cuando}. Respóndela desde tu Home.`,
        },
        {
          userId: cliente.userId,
          titulo: 'Solicitud enviada',
          mensaje: `Pediste una cita con ${barbero.nombre} para el ${cuando}. Te avisaremos cuando la responda.`,
        },
      );
      break;

    case 'confirmada':
      avisos.push(
        {
          userId: cliente.userId,
          titulo: 'Tu cita fue confirmada',
          mensaje: `${barbero.nombre} aceptó tu cita del ${cuando}.`,
        },
        {
          userId: barbero.userId,
          titulo: 'Cita confirmada',
          mensaje: `Confirmaste la cita con ${cliente.nombre} del ${cuando}.`,
        },
      );
      break;

    case 'rechazada':
      avisos.push({
        userId: cliente.userId,
        titulo: 'Solicitud rechazada',
        mensaje: `${barbero.nombre} no pudo aceptar tu cita del ${cuando}. Puedes pedir otro horario.`,
      });
      break;

    case 'cancelada':
      avisos.push(
        {
          userId: actorEsCliente ? barbero.userId : cliente.userId,
          titulo: 'Cita cancelada',
          mensaje: `${quien} canceló la cita del ${cuando}.`,
        },
        {
          userId: actorEsCliente ? cliente.userId : barbero.userId,
          titulo: 'Cita cancelada',
          mensaje: `Cancelaste la cita con ${
            actorEsCliente ? barbero.nombre : cliente.nombre
          } del ${cuando}.`,
        },
      );
      break;

    case 'propuesta':
      avisos.push(
        {
          userId: actorEsCliente ? barbero.userId : cliente.userId,
          titulo: 'Propuesta de nuevo horario',
          mensaje: `${quien} propone mover la cita del ${cuando} al ${nuevo}. Respóndela en tu Agenda.`,
        },
        {
          userId: actorEsCliente ? cliente.userId : barbero.userId,
          titulo: 'Propuesta enviada',
          mensaje: `Propusiste mover la cita del ${cuando} al ${nuevo}. La cita sigue en su horario hasta que la acepten.`,
        },
      );
      break;

    case 'reprogramada':
      for (const userId of [cliente.userId, barbero.userId]) {
        avisos.push({
          userId,
          titulo: 'Cita reprogramada',
          mensaje: `La cita de ${cliente.nombre} con ${barbero.nombre} quedó para el ${cuando}.`,
        });
      }
      break;

    case 'propuesta_rechazada':
      avisos.push({
        userId: actorEsCliente ? barbero.userId : cliente.userId,
        titulo: 'Propuesta rechazada',
        mensaje: `${quien} no aceptó el cambio de horario. La cita sigue el ${cuando}.`,
      });
      break;
  }

  // Sin cuenta vinculada no hay a quién avisar.
  return avisos.filter((aviso): aviso is Aviso => !!aviso.userId);
}

/** Recordatorio de una cita próxima (RF-26) para una de las dos partes. */
export function avisoRecordatorio(
  ventana: '24h' | '1h',
  inicioAt: string,
  conQuien: string,
) {
  return ventana === '1h'
    ? {
        titulo: 'Tu cita es en menos de 1 hora',
        mensaje: `Cita con ${conQuien} a las ${bogotaHour(inicioAt)}.`,
      }
    : {
        titulo: 'Recordatorio de cita',
        mensaje: `Tienes una cita con ${conQuien} el ${formatCuando(inicioAt)}.`,
      };
}
