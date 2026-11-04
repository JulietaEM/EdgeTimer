import { timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import * as webpush from 'web-push';
import { isUuid } from '../admin/admin.utils';
import type { AuthUser } from '../common/auth/auth-user';
import { first, type One } from '../common/postgrest';
import { createSupabaseUserClient, supabaseAdmin } from '../supabase';
import {
  avisoRecordatorio,
  avisosDeEvento,
  type Aviso,
  type ContextoCita,
} from './notificaciones.templates';
import type {
  Actor,
  BajaSuscripcionDto,
  EventoCita,
  NotificacionView,
  PushPayload,
  SuscripcionDto,
} from './notificaciones.types';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_TITULO = 120;
const MAX_MENSAJE = 500;

interface PersonaRow {
  user_id: string | null;
  nombre_cliente?: string;
  nombre_barbero?: string;
}

interface CitaRow {
  id_cita: string;
  inicio_at: string;
  cliente: One<PersonaRow>;
  barbero: One<PersonaRow>;
}

interface NotificacionRow {
  id_notificacion: string;
  user_id: string;
  id_cita: string | null;
  titulo: string;
  mensaje: string;
  estado: string;
  metadata: { tipo?: string } | null;
  created_at: string;
}

const CITA_SELECT = `
  id_cita,
  inicio_at,
  cliente:cliente(user_id, nombre_cliente),
  barbero:barbero(user_id, nombre_barbero)
`;

/**
 * Avisos de las citas. Cada aviso se guarda en `notificacion` (es la campana de
 * la app y el historial) y además se empuja (push) a los navegadores suscritos de
 * esa persona con Web Push. Enviar un aviso NUNCA debe romper la acción que lo
 * originó: todo lo que falle aquí se registra y se ignora.
 */
@Injectable()
export class NotificacionesService {
  private readonly logger = new Logger(NotificacionesService.name);
  private readonly publicKey: string | null;
  private readonly pushReady: boolean;

  constructor() {
    const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
    const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
    let ready = false;

    if (publicKey && privateKey) {
      try {
        webpush.setVapidDetails(
          process.env.VAPID_SUBJECT?.trim() ||
            process.env.FRONTEND_URL?.trim() ||
            'https://edge-timer-blue.vercel.app',
          publicKey,
          privateKey,
        );
        ready = true;
      } catch (error) {
        this.logger.error(
          `Llaves VAPID inválidas, el push queda desactivado: ${String(error)}`,
        );
      }
    } else {
      this.logger.warn(
        'Faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY: solo funcionará la campana dentro de la app.',
      );
    }

    this.pushReady = ready;
    this.publicKey = ready ? (publicKey ?? null) : null;
  }

  // ---------------------------------------------------------------------
  // Lo que usa el navegador
  // ---------------------------------------------------------------------

  /** Llave pública que el navegador necesita para suscribirse (null = push apagado). */
  getConfig() {
    return { vapidPublicKey: this.publicKey };
  }

  async suscribir(user: AuthUser, dto: SuscripcionDto, userAgent?: string) {
    const endpoint = dto?.endpoint;
    const p256dh = dto?.keys?.p256dh;
    const auth = dto?.keys?.auth;

    if (
      typeof endpoint !== 'string' ||
      !/^https:\/\//.test(endpoint) ||
      endpoint.length > 2000 ||
      typeof p256dh !== 'string' ||
      typeof auth !== 'string' ||
      !p256dh ||
      !auth ||
      p256dh.length > 300 ||
      auth.length > 300
    ) {
      throw new BadRequestException('La suscripción no es válida');
    }

    // El endpoint es único: si el mismo navegador cambia de cuenta, pasa a la nueva.
    const { error } = await supabaseAdmin.from('suscripcion_web_push').upsert(
      {
        user_id: user.userId,
        endpoint,
        p256dh,
        auth,
        user_agent: userAgent?.slice(0, 300) ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' },
    );

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return { message: 'Avisos del navegador activados' };
  }

  async desuscribir(user: AuthUser, dto: BajaSuscripcionDto) {
    if (typeof dto?.endpoint !== 'string' || !dto.endpoint) {
      throw new BadRequestException('Falta la suscripción');
    }

    const { error } = await supabaseAdmin
      .from('suscripcion_web_push')
      .delete()
      .eq('endpoint', dto.endpoint)
      .eq('user_id', user.userId);

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return { message: 'Avisos del navegador desactivados' };
  }

  // ---------------------------------------------------------------------
  // La campana: se lee con el token de la persona (RLS: solo ve las suyas)
  // ---------------------------------------------------------------------

  async listar(user: AuthUser, limite?: string) {
    const take = Math.min(Math.max(Number(limite) || 30, 1), 50);
    const client = createSupabaseUserClient(user.accessToken);

    const [lista, noLeidas] = await Promise.all([
      client
        .from('notificacion')
        .select(
          'id_notificacion, user_id, id_cita, titulo, mensaje, estado, metadata, created_at',
        )
        .in('estado', ['enviada', 'leida'])
        .order('created_at', { ascending: false })
        .limit(take),
      client
        .from('notificacion')
        .select('id_notificacion', { count: 'exact', head: true })
        .eq('estado', 'enviada'),
    ]);

    if (lista.error) {
      throw new InternalServerErrorException(lista.error.message);
    }

    return {
      items: ((lista.data ?? []) as NotificacionRow[]).map(toView),
      noLeidas: noLeidas.count ?? 0,
    };
  }

  async marcarLeida(user: AuthUser, id: string) {
    if (!isUuid(id)) {
      throw new NotFoundException('No se encontró la notificación');
    }

    const { error } = await createSupabaseUserClient(user.accessToken)
      .from('notificacion')
      .update({ estado: 'leida', read_at: new Date().toISOString() })
      .eq('id_notificacion', id)
      .eq('estado', 'enviada');

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return { message: 'Notificación leída' };
  }

  async marcarTodasLeidas(user: AuthUser) {
    const { error } = await createSupabaseUserClient(user.accessToken)
      .from('notificacion')
      .update({ estado: 'leida', read_at: new Date().toISOString() })
      .eq('estado', 'enviada');

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return { message: 'Notificaciones leídas' };
  }

  // ---------------------------------------------------------------------
  // Avisos de las citas (HU-22, RF-16, RF-27)
  // ---------------------------------------------------------------------

  /**
   * Avisa de lo que le pasó a una cita. Nunca lanza: si algo falla se registra.
   * `actor` es quien hizo la acción (el aviso va a la otra parte y se le confirma
   * a quien la hizo).
   */
  async citaEvento(idCita: string, evento: EventoCita, actor: Actor) {
    try {
      const ctx = await this.loadContexto(idCita, evento);
      if (!ctx) return;

      await this.entregar(
        avisosDeEvento(evento, actor, ctx).map((aviso) => ({
          ...aviso,
          idCita,
          tipo: evento,
        })),
      );
    } catch (error) {
      this.logger.warn(
        `No se pudo avisar "${evento}" de la cita ${idCita}: ${String(error)}`,
      );
    }
  }

  // ---------------------------------------------------------------------
  // Recordatorios (RF-26)
  // ---------------------------------------------------------------------

  /**
   * Lo llama un job cada pocos minutos. Recuerda las citas confirmadas que
   * empiezan dentro de las próximas 24 horas ("24h") y, cuando falta menos de una
   * hora, avisa de nuevo ("1h"). Cada recordatorio lleva una clave única
   * (ventana:cita:persona:inicio) y se inserta con ON CONFLICT DO NOTHING, de modo
   * que llamarlo muchas veces no duplica nada, y una cita reprogramada (otro
   * inicio) vuelve a recibir sus recordatorios.
   */
  async enviarRecordatorios(now = new Date()) {
    const { data, error } = await supabaseAdmin
      .from('cita')
      .select(CITA_SELECT)
      .eq('estado', 'confirmada')
      .gt('inicio_at', now.toISOString())
      .lte('inicio_at', new Date(now.getTime() + DAY_MS).toISOString());

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    const citas = (data ?? []) as unknown as CitaRow[];
    const pendientes: Array<Aviso & { clave: string; idCita: string }> = [];

    for (const cita of citas) {
      const cliente = first(cita.cliente);
      const barbero = first(cita.barbero);
      const ventana =
        new Date(cita.inicio_at).getTime() - now.getTime() <= HOUR_MS
          ? '1h'
          : '24h';
      const inicio = new Date(cita.inicio_at).getTime();

      const partes = [
        { userId: cliente?.user_id, conQuien: barbero?.nombre_barbero },
        { userId: barbero?.user_id, conQuien: cliente?.nombre_cliente },
      ];

      for (const { userId, conQuien } of partes) {
        if (!userId) continue;
        pendientes.push({
          userId,
          idCita: cita.id_cita,
          clave: `rec${ventana}:${cita.id_cita}:${userId}:${inicio}`,
          ...avisoRecordatorio(ventana, cita.inicio_at, conQuien ?? 'tu cita'),
        });
      }
    }

    const enviados = await this.entregar(
      pendientes.map((aviso) => ({ ...aviso, tipo: 'recordatorio' })),
    );

    return { citas: citas.length, enviados };
  }

  /** Verifica el secreto del job (se compara en tiempo constante). */
  assertCronSecret(received?: string) {
    const expected = process.env.CRON_SECRET?.trim();

    if (!expected) {
      throw new ServiceUnavailableException(
        'Los recordatorios no están configurados',
      );
    }

    const a = Buffer.from(received ?? '');
    const b = Buffer.from(expected);

    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Secreto inválido');
    }
  }

  // ---------------------------------------------------------------------
  // Internos
  // ---------------------------------------------------------------------

  private async loadContexto(
    idCita: string,
    evento: EventoCita,
  ): Promise<ContextoCita | null> {
    const { data, error } = await supabaseAdmin
      .from('cita')
      .select(CITA_SELECT)
      .eq('id_cita', idCita)
      .maybeSingle();

    if (error || !data) {
      this.logger.warn(`No se encontró la cita ${idCita} para avisar`);
      return null;
    }

    const cita = data as unknown as CitaRow;
    const cliente = first(cita.cliente);
    const barbero = first(cita.barbero);
    let propuestoAt: string | undefined;

    if (evento === 'propuesta') {
      const { data: propuestas } = await supabaseAdmin
        .from('propuesta_reprogramacion')
        .select('inicio_at')
        .eq('id_cita', idCita)
        .eq('estado', 'pendiente')
        .order('created_at', { ascending: false })
        .limit(1);

      propuestoAt = (propuestas as Array<{ inicio_at: string }> | null)?.[0]
        ?.inicio_at;
    }

    return {
      idCita,
      inicioAt: cita.inicio_at,
      cliente: {
        userId: cliente?.user_id ?? null,
        nombre: cliente?.nombre_cliente ?? 'El cliente',
      },
      barbero: {
        userId: barbero?.user_id ?? null,
        nombre: barbero?.nombre_barbero ?? 'El barbero',
      },
      propuestoAt,
    };
  }

  /**
   * Guarda los avisos y los empuja a los navegadores. Los que traen `clave`
   * (recordatorios) se insertan ignorando duplicados, y solo los que de verdad se
   * insertaron se empujan. Devuelve cuántos avisos nuevos se crearon.
   */
  private async entregar(
    avisos: Array<Aviso & { idCita: string; tipo: string; clave?: string }>,
  ) {
    if (avisos.length === 0) return 0;

    const now = new Date().toISOString();
    const rows = avisos.map((aviso) => ({
      user_id: aviso.userId,
      id_cita: aviso.idCita,
      canal: 'push',
      titulo: aviso.titulo.slice(0, MAX_TITULO),
      mensaje: aviso.mensaje.slice(0, MAX_MENSAJE),
      estado: 'enviada',
      sent_at: now,
      metadata: { tipo: aviso.tipo },
      clave: aviso.clave ?? null,
    }));

    const table = supabaseAdmin.from('notificacion');
    const { data, error } = avisos.some((aviso) => aviso.clave)
      ? await table
          .upsert(rows, { onConflict: 'clave', ignoreDuplicates: true })
          .select('user_id, id_cita, titulo, mensaje, metadata')
      : await table
          .insert(rows)
          .select('user_id, id_cita, titulo, mensaje, metadata');

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    const creadas = (data ?? []) as Array<
      Pick<
        NotificacionRow,
        'user_id' | 'id_cita' | 'titulo' | 'mensaje' | 'metadata'
      >
    >;

    await Promise.allSettled(
      creadas.map((row) =>
        this.empujar(row.user_id, {
          titulo: row.titulo,
          mensaje: row.mensaje,
          idCita: row.id_cita,
          tipo: row.metadata?.tipo ?? 'aviso',
        }),
      ),
    );

    return creadas.length;
  }

  /** Empuja un aviso a todos los navegadores suscritos de una persona. */
  private async empujar(userId: string, payload: PushPayload) {
    if (!this.pushReady) return;

    const { data, error } = await supabaseAdmin
      .from('suscripcion_web_push')
      .select('endpoint, p256dh, auth')
      .eq('user_id', userId);

    if (error || !data?.length) return;

    await Promise.allSettled(
      (data as Array<{ endpoint: string; p256dh: string; auth: string }>).map(
        async (sub) => {
          try {
            await webpush.sendNotification(
              {
                endpoint: sub.endpoint,
                keys: { p256dh: sub.p256dh, auth: sub.auth },
              },
              JSON.stringify(payload),
              { TTL: 12 * 60 * 60, urgency: 'high' },
            );
          } catch (err) {
            const status = (err as { statusCode?: number }).statusCode;

            // 404/410: el navegador ya no existe o revocó el permiso.
            if (status === 404 || status === 410) {
              await supabaseAdmin
                .from('suscripcion_web_push')
                .delete()
                .eq('endpoint', sub.endpoint);
            } else {
              this.logger.warn(`Falló un push (${status ?? 'sin código'})`);
            }
          }
        },
      ),
    );
  }
}

function toView(row: NotificacionRow): NotificacionView {
  return {
    id: row.id_notificacion,
    titulo: row.titulo,
    mensaje: row.mensaje,
    idCita: row.id_cita,
    tipo: row.metadata?.tipo ?? 'aviso',
    leida: row.estado === 'leida',
    creadaAt: row.created_at,
  };
}
