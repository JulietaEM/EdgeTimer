import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { isUuid, parsePage } from '../admin/admin.utils';
import { optionalText } from '../auth/auth.validation';
import { AccountsService } from '../common/accounts.service';
import type { AuthUser } from '../common/auth/auth-user';
import { first, type One } from '../common/postgrest';
import {
  createSupabaseUserClient,
  getSignedStorageUrl,
  supabaseAdmin,
} from '../supabase';
import {
  bogotaDate,
  bogotaHour,
  bogotaParts,
  fitsInBlocks,
  formatMinutes,
  normalizeBlocks,
  toInstant,
  type Block,
} from './barbero.utils';
import type {
  CitaBarberoView,
  CitasQuery,
  DisponibilidadDto,
  GrupoCitas,
  MotivoDto,
  ReprogramarDto,
} from './barbero.types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Motivo con el que la base de datos vence las solicitudes sin respuesta. */
const EXPIRED_REASON = 'Solicitud vencida sin respuesta';

const CITA_SELECT = `
  id_cita,
  id_cliente,
  id_barbero,
  inicio_at,
  fin_at,
  estado,
  notas_cliente,
  motivo_estado,
  cliente:cliente(id_cliente, nombre_cliente, telefono, foto_perfil),
  cita_procedimiento(
    precio_aplicado,
    duracion_minutos_aplicada,
    procedimiento:procedimiento(nombre)
  ),
  calificacion(puntuacion_numerica, resena)
`;

interface CitaRow {
  id_cita: string;
  id_cliente: string;
  inicio_at: string;
  fin_at: string;
  estado: string;
  notas_cliente: string | null;
  motivo_estado: string | null;
  cliente: One<{
    id_cliente: string;
    nombre_cliente: string;
    telefono: string | null;
    foto_perfil: string | null;
  }>;
  cita_procedimiento?: {
    precio_aplicado: number | string;
    duracion_minutos_aplicada: number;
    procedimiento: One<{ nombre: string }>;
  }[];
  calificacion: One<{ puntuacion_numerica: number; resena: string | null }>;
}

const ESTADO_LABEL: Record<string, string> = {
  pendiente: 'Pendiente',
  confirmada: 'Confirmada',
  realizada: 'Realizada',
  cancelada: 'Cancelada',
  rechazada: 'Rechazada',
};

@Injectable()
export class BarberoService {
  private readonly logger = new Logger(BarberoService.name);

  constructor(private readonly accounts: AccountsService) {}

  // ---------------------------------------------------------------------
  // Disponibilidad (RF-12)
  // ---------------------------------------------------------------------

  async getDisponibilidad(user: AuthUser) {
    const { data, error } = await supabaseAdmin
      .from('disponibilidad_barbero')
      .select('dia_semana, hora_inicio, hora_fin')
      .eq('id_barbero', user.profileId)
      .eq('activo', true)
      .order('dia_semana', { ascending: true })
      .order('hora_inicio', { ascending: true });

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return {
      bloques: (
        (data ?? []) as unknown as {
          dia_semana: number;
          hora_inicio: string;
          hora_fin: string;
        }[]
      ).map((row) => ({
        dia: row.dia_semana,
        inicio: row.hora_inicio.slice(0, 5),
        fin: row.hora_fin.slice(0, 5),
      })),
    };
  }

  /**
   * Reemplaza la disponibilidad semanal. No se permite si dejaría fuera de
   * horario a citas pendientes o confirmadas: primero hay que moverlas.
   */
  async setDisponibilidad(user: AuthUser, dto: DisponibilidadDto) {
    const blocks = normalizeBlocks(dto?.bloques);

    const { data: citas, error: errCitas } = await supabaseAdmin
      .from('cita')
      .select('inicio_at, fin_at')
      .eq('id_barbero', user.profileId)
      .in('estado', ['pendiente', 'confirmada'])
      .gt('fin_at', new Date().toISOString());

    if (errCitas) {
      throw new InternalServerErrorException(errCitas.message);
    }

    const outside = (
      (citas ?? []) as unknown as { inicio_at: string; fin_at: string }[]
    )
      .filter((cita) => !fitsInBlocks(blocks, cita.inicio_at, cita.fin_at))
      .sort((a, b) => a.inicio_at.localeCompare(b.inicio_at));

    if (outside.length > 0) {
      const examples = outside
        .slice(0, 3)
        .map((cita) => this.describeInstant(cita.inicio_at))
        .join('; ');
      throw new ConflictException(
        `Con ese horario quedarían fuera ${outside.length === 1 ? 'una cita' : `${outside.length} citas`} (${examples}). Reprográmalas o cancélalas primero.`,
      );
    }

    const { data: current, error: errCurrent } = await supabaseAdmin
      .from('disponibilidad_barbero')
      .select('id_disponibilidad')
      .eq('id_barbero', user.profileId);

    if (errCurrent) {
      throw new InternalServerErrorException(errCurrent.message);
    }

    const oldIds = (
      (current ?? []) as unknown as { id_disponibilidad: string }[]
    ).map((row) => row.id_disponibilidad);

    // Primero se guardan los tramos nuevos y luego se borran los viejos: si algo
    // falla a medias, no se pierde la disponibilidad que ya existía.
    let newIds: string[] = [];
    if (blocks.length > 0) {
      const { data: inserted, error: errInsert } = await supabaseAdmin
        .from('disponibilidad_barbero')
        .insert(blocks.map((block) => this.toRow(user.profileId, block)))
        .select('id_disponibilidad');

      if (errInsert) {
        throw new InternalServerErrorException(errInsert.message);
      }

      newIds = (
        (inserted ?? []) as unknown as { id_disponibilidad: string }[]
      ).map((row) => row.id_disponibilidad);
    }

    if (oldIds.length > 0) {
      const { error: errDelete } = await supabaseAdmin
        .from('disponibilidad_barbero')
        .delete()
        .in('id_disponibilidad', oldIds);

      if (errDelete) {
        if (newIds.length > 0) {
          await supabaseAdmin
            .from('disponibilidad_barbero')
            .delete()
            .in('id_disponibilidad', newIds);
        }
        throw new InternalServerErrorException(errDelete.message);
      }
    }

    await this.accounts.audit({
      userId: user.userId,
      role: 'barbero',
      entity: 'disponibilidad_barbero',
      entityId: user.profileId,
      action: 'actualizar_disponibilidad',
      details: { tramos: blocks.length },
      idBarberia: user.idBarberia,
    });

    return {
      message: 'Disponibilidad guardada',
      ...(await this.getDisponibilidad(user)),
    };
  }

  // ---------------------------------------------------------------------
  // Citas (RF-13)
  // ---------------------------------------------------------------------

  /** Datos para el inicio del barbero: solicitudes por responder, citas de hoy, si ya tiene horario. */
  async resumen(user: AuthUser) {
    await this.markPast();

    const now = new Date();
    const today = bogotaParts(now).date;
    const dayStart = new Date(`${today}T00:00:00-05:00`);
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);

    const [solicitudes, hoy, disponibilidad] = await Promise.all([
      supabaseAdmin
        .from('cita')
        .select('id_cita', { count: 'exact', head: true })
        .eq('id_barbero', user.profileId)
        .eq('estado', 'pendiente')
        .gt('fin_at', now.toISOString()),
      supabaseAdmin
        .from('cita')
        .select('id_cita', { count: 'exact', head: true })
        .eq('id_barbero', user.profileId)
        .eq('estado', 'confirmada')
        .gte('inicio_at', dayStart.toISOString())
        .lt('inicio_at', dayEnd.toISOString()),
      supabaseAdmin
        .from('disponibilidad_barbero')
        .select('id_disponibilidad', { count: 'exact', head: true })
        .eq('id_barbero', user.profileId)
        .eq('activo', true),
    ]);

    for (const result of [solicitudes, hoy, disponibilidad]) {
      if (result.error) {
        throw new InternalServerErrorException(result.error.message);
      }
    }

    return {
      solicitudesPendientes: solicitudes.count ?? 0,
      citasHoy: hoy.count ?? 0,
      tieneDisponibilidad: (disponibilidad.count ?? 0) > 0,
    };
  }

  async listCitas(user: AuthUser, query: CitasQuery) {
    const grupo = this.parseGrupo(query.grupo);
    const { offset, limit } = parsePage(query.offset, query.limit);
    await this.markPast();

    const now = new Date().toISOString();
    let request = supabaseAdmin
      .from('cita')
      .select(CITA_SELECT)
      .eq('id_barbero', user.profileId);

    if (grupo === 'solicitudes') {
      request = request
        .eq('estado', 'pendiente')
        .gt('fin_at', now)
        .order('inicio_at', { ascending: true })
        .limit(200);
    } else if (grupo === 'proximas') {
      request = request
        .eq('estado', 'confirmada')
        .gte('fin_at', now)
        .order('inicio_at', { ascending: true })
        .limit(200);
    } else {
      // Historial: realizadas, canceladas y rechazadas (incluye las solicitudes vencidas).
      request = request
        .in('estado', ['realizada', 'cancelada', 'rechazada'])
        .order('inicio_at', { ascending: false })
        .range(offset, offset + limit);
    }

    const { data, error } = await request;

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    const rows = (data ?? []) as unknown as CitaRow[];
    const page = grupo === 'historial' ? rows.slice(0, limit) : rows;

    return {
      items: await Promise.all(page.map((row) => this.toView(row))),
      hayMas: grupo === 'historial' && rows.length > limit,
    };
  }

  // ---------------------------------------------------------------------
  // Aceptar, rechazar, cancelar y reprogramar (RF-14, RF-15)
  //
  // Los cambios se hacen con el token del barbero (no con la service role) para
  // que la base de datos aplique sus propias reglas: quién puede cambiar qué
  // estado, el mínimo de 1 día, la disponibilidad y los solapes.
  // ---------------------------------------------------------------------

  async aceptar(user: AuthUser, id: string) {
    const cita = await this.loadOwnedCita(user, id);

    if (cita.estado !== 'pendiente') {
      throw new ConflictException('Solo puedes aceptar solicitudes pendientes');
    }
    if (new Date(cita.fin_at) <= new Date()) {
      throw new BadRequestException('Esta solicitud ya venció');
    }

    await this.updateAsBarbero(user, id, { estado: 'confirmada' });
    await this.auditCita(user, id, 'aceptar_cita', {});

    return {
      message: 'Solicitud aceptada',
      cita: await this.getCita(user, id),
    };
  }

  async rechazar(user: AuthUser, id: string, dto: MotivoDto) {
    const motivo = optionalText(dto?.motivo, 200);
    const cita = await this.loadOwnedCita(user, id);

    if (cita.estado !== 'pendiente') {
      throw new ConflictException(
        'Solo puedes rechazar solicitudes pendientes',
      );
    }

    await this.updateAsBarbero(user, id, {
      estado: 'rechazada',
      motivo_estado: motivo,
    });
    await this.auditCita(user, id, 'rechazar_cita', { motivo });

    return {
      message: 'Solicitud rechazada',
      cita: await this.getCita(user, id),
    };
  }

  async cancelar(user: AuthUser, id: string, dto: MotivoDto) {
    const motivo = optionalText(dto?.motivo, 200);
    const cita = await this.loadOwnedCita(user, id);

    if (cita.estado !== 'pendiente' && cita.estado !== 'confirmada') {
      throw new ConflictException('Esta cita ya no se puede cancelar');
    }

    await this.updateAsBarbero(user, id, {
      estado: 'cancelada',
      motivo_estado: motivo,
    });
    await this.auditCita(user, id, 'cancelar_cita', { motivo });

    return { message: 'Cita cancelada', cita: await this.getCita(user, id) };
  }

  /** La duración no cambia: sale de los procedimientos con los que se agendó. */
  async reprogramar(user: AuthUser, id: string, dto: ReprogramarDto) {
    const cita = await this.loadOwnedCita(user, id);

    if (cita.estado !== 'pendiente' && cita.estado !== 'confirmada') {
      throw new ConflictException('Esta cita ya no se puede reprogramar');
    }

    const inicio = toInstant(dto?.fecha, dto?.horaInicio);
    if (inicio <= new Date()) {
      throw new BadRequestException(
        'No se puede programar en una fecha u hora pasada',
      );
    }

    const minutes = await this.durationOf(id);
    if (minutes <= 0) {
      throw new BadRequestException('La cita no tiene procedimientos válidos');
    }

    const fin = new Date(inicio.getTime() + minutes * 60000);

    await this.updateAsBarbero(user, id, {
      inicio_at: inicio.toISOString(),
      fin_at: fin.toISOString(),
    });
    await this.auditCita(user, id, 'reprogramar_cita', {
      desde: cita.inicio_at,
      hasta: inicio.toISOString(),
    });

    return { message: 'Cita reprogramada', cita: await this.getCita(user, id) };
  }

  // ---------------------------------------------------------------------
  // Utilidades internas
  // ---------------------------------------------------------------------

  private parseGrupo(value: unknown): GrupoCitas {
    if (value === undefined || value === '') return 'proximas';
    if (
      value === 'solicitudes' ||
      value === 'proximas' ||
      value === 'historial'
    ) {
      return value;
    }
    throw new BadRequestException('El grupo de citas no es válido');
  }

  private toRow(idBarbero: string, block: Block) {
    return {
      id_barbero: idBarbero,
      dia_semana: block.dia,
      hora_inicio: formatMinutes(block.inicio),
      hora_fin: formatMinutes(block.fin),
      activo: true,
    };
  }

  /** "lun 20 oct, 10:00" en hora de Bogotá. */
  private describeInstant(iso: string) {
    return new Date(iso).toLocaleString('es-CO', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'America/Bogota',
    });
  }

  /**
   * Mantenimiento de estados antes de listar: las solicitudes sin respuesta cuya
   * hora ya pasó quedan vencidas y las citas confirmadas que ya terminaron pasan
   * a realizadas. (Más adelante lo hará un job programado.)
   */
  private async markPast() {
    for (const fn of ['vencer_solicitudes', 'realizar_citas_vencidas']) {
      const { error } = await supabaseAdmin.rpc(fn);
      if (error) {
        this.logger.warn(`No se pudo ejecutar ${fn}: ${error.message}`);
      }
    }
  }

  /** Una cita solo se toca si es de este barbero. */
  private async loadOwnedCita(user: AuthUser, id: string) {
    if (!isUuid(id)) {
      throw new NotFoundException('No se encontró la cita');
    }

    const { data, error } = await supabaseAdmin
      .from('cita')
      .select('id_cita, estado, inicio_at, fin_at')
      .eq('id_cita', id)
      .eq('id_barbero', user.profileId)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    if (!data) {
      throw new NotFoundException('No se encontró la cita');
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    return data as unknown as {
      id_cita: string;
      estado: string;
      inicio_at: string;
      fin_at: string;
    };
  }

  private async updateAsBarbero(
    user: AuthUser,
    id: string,
    changes: Record<string, unknown>,
  ) {
    const { data, error } = await createSupabaseUserClient(user.accessToken)
      .from('cita')
      .update(changes)
      .eq('id_cita', id)
      .eq('id_barbero', user.profileId)
      .select('id_cita')
      .maybeSingle();

    if (error) {
      throw this.mapCitaError(error.message);
    }

    if (!data) {
      throw new ConflictException(
        'La cita cambió y ya no se puede actualizar. Recarga la lista.',
      );
    }
  }

  /** Traduce los mensajes de las reglas de la base de datos a respuestas claras. */
  private mapCitaError(message: string) {
    if (message.includes('no_citas_solapadas_barbero')) {
      return new ConflictException('Ya tienes otra cita en ese horario');
    }
    if (message.includes('no_citas_solapadas_cliente')) {
      return new ConflictException(
        'El cliente ya tiene otra cita en ese horario',
      );
    }
    if (/disponibilidad/i.test(message)) {
      return new BadRequestException(
        'Ese horario queda fuera de tu disponibilidad',
      );
    }
    if (/anticipacion/i.test(message)) {
      return new BadRequestException(
        'Solo puedes cancelar o reprogramar citas con al menos 1 día de antelación',
      );
    }
    if (/pasad/i.test(message)) {
      return new BadRequestException(
        'No se puede programar en una fecha u hora pasada',
      );
    }
    if (/permisos|transicion/i.test(message)) {
      return new ForbiddenException('No tienes permisos para este cambio');
    }
    return new InternalServerErrorException(message);
  }

  private async durationOf(citaId: string) {
    const { data, error } = await supabaseAdmin
      .from('cita_procedimiento')
      .select('duracion_minutos_aplicada')
      .eq('id_cita', citaId);

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return (
      (data ?? []) as unknown as { duracion_minutos_aplicada: number }[]
    ).reduce(
      (total, row) => total + Number(row.duracion_minutos_aplicada || 0),
      0,
    );
  }

  private async getCita(user: AuthUser, id: string) {
    const { data, error } = await supabaseAdmin
      .from('cita')
      .select(CITA_SELECT)
      .eq('id_cita', id)
      .eq('id_barbero', user.profileId)
      .single();

    if (error || !data) {
      throw new InternalServerErrorException(
        error?.message || 'No se pudo leer la cita',
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    return this.toView(data as unknown as CitaRow);
  }

  private async toView(row: CitaRow): Promise<CitaBarberoView> {
    const items = row.cita_procedimiento ?? [];
    const procedimientos = items.map((item) => ({
      nombre: first(item.procedimiento)?.nombre ?? 'Procedimiento',
      precio: Number(item.precio_aplicado ?? 0),
      duracionMinutos: Number(item.duracion_minutos_aplicada ?? 0),
    }));
    const cliente = first(row.cliente);
    const calificacion = first(row.calificacion);
    const now = Date.now();
    const expiredRequest =
      row.estado === 'rechazada' && row.motivo_estado === EXPIRED_REASON;

    return {
      id: row.id_cita,
      cliente: {
        id: row.id_cliente,
        nombre: cliente?.nombre_cliente ?? 'Cliente',
        telefono: cliente?.telefono ?? null,
        foto: await getSignedStorageUrl(cliente?.foto_perfil),
      },
      procedimientos,
      costoTotal: procedimientos.reduce((sum, p) => sum + p.precio, 0),
      duracionTotal: procedimientos.reduce(
        (sum, p) => sum + p.duracionMinutos,
        0,
      ),
      inicioAt: row.inicio_at,
      finAt: row.fin_at,
      fecha: bogotaDate(row.inicio_at),
      horaInicio: bogotaHour(row.inicio_at),
      horaFin: bogotaHour(row.fin_at),
      estado: row.estado,
      estadoLabel: expiredRequest
        ? 'Vencida'
        : (ESTADO_LABEL[row.estado] ?? row.estado),
      notas: row.notas_cliente ?? '',
      motivo: row.motivo_estado ?? '',
      puedeModificar:
        (row.estado === 'pendiente' || row.estado === 'confirmada') &&
        new Date(row.inicio_at).getTime() - now >= DAY_MS,
      calificacion: calificacion
        ? {
            puntuacion: Number(calificacion.puntuacion_numerica),
            resena: calificacion.resena ?? '',
          }
        : null,
    };
  }

  private async auditCita(
    user: AuthUser,
    id: string,
    action: string,
    details: Record<string, unknown>,
  ) {
    await this.accounts.audit({
      userId: user.userId,
      role: 'barbero',
      entity: 'cita',
      entityId: id,
      action,
      details,
      idBarberia: user.idBarberia,
    });
  }
}
