import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { isUuid, parsePage } from '../admin/admin.utils';
import { optionalText } from '../auth/auth.validation';
import { bogotaDate, bogotaHour, toInstant } from '../barbero/barbero.utils';
import type { AuthUser } from '../common/auth/auth-user';
import { mapCitaError } from '../common/cita-errors';
import { loadFreeDays, loadSchedules } from '../common/disponibilidad';
import {
  aceptar,
  loadPendientes,
  propuestaVigente,
  proponer,
  rechazar,
  retirar,
  toPropuestaView,
  type PropuestaRow,
} from '../common/reprogramacion';
import { EXPIRED_REASON, markPastCitas } from '../common/maintenance';
import { first, type One } from '../common/postgrest';
import {
  createSupabaseUserClient,
  getSignedStorageUrl,
  supabaseAdmin,
} from '../supabase';
import type {
  BarberiaView,
  BarberoListItem,
  BarberoPerfilView,
  CalificarCitaDto,
  CitaClienteView,
  CitasClienteQuery,
  CitasClienteResultado,
  CrearCitaDto,
  EstadoCitaCliente,
  MotivoCitaDto,
  ReprogramarCitaDto,
  DisponibilidadQuery,
  DisponibilidadView,
  EspecialidadView,
  ProcedimientosBarberoView,
} from './cliente.types';
import {
  addDays,
  firstName,
  parseDateRange,
  parseProcedimientoIds,
  summarizeSchedule,
} from './cliente.utils';

const BARBERIA_SELECT =
  'id_barberia, nombre, descripcion, direccion, telefono, logo_url';

const MAX_RESENAS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

const CITA_SELECT = `
  id_cita,
  estado,
  inicio_at,
  fin_at,
  notas_cliente,
  motivo_estado,
  barbero:barbero(id_barbero, nombre_barbero, foto_perfil),
  barberia:barberia(id_barberia, nombre, direccion),
  cita_procedimiento(
    precio_aplicado,
    duracion_minutos_aplicada,
    procedimiento:procedimiento(id_procedimiento, nombre)
  ),
  calificacion(puntuacion_numerica, resena)
`;

const ESTADO_LABEL: Record<EstadoCitaCliente, string> = {
  pendiente: 'Pendiente',
  confirmada: 'Confirmada',
  realizada: 'Realizada',
  cancelada: 'Cancelada',
  rechazada: 'Rechazada',
};

interface BarberiaRow {
  id_barberia: string;
  nombre: string;
  descripcion: string | null;
  direccion: string | null;
  telefono: string | null;
  logo_url: string | null;
}

interface ProcedimientoRow {
  id_procedimiento: string;
  nombre: string;
  descripcion: string | null;
  precio: number | string;
  duracion_minutos: number;
  activo: boolean;
}

interface BarberoRow {
  id_barbero: string;
  nombre_barbero: string;
  foto_perfil: string | null;
  promedio_calificacion: number | string | null;
  barbero_procedimiento?: { procedimiento: One<ProcedimientoRow> }[];
}

interface CitaRow {
  id_cita: string;
  estado: EstadoCitaCliente;
  inicio_at: string;
  fin_at: string;
  notas_cliente: string | null;
  motivo_estado: string | null;
  barbero: One<{
    id_barbero: string;
    nombre_barbero: string;
    foto_perfil: string | null;
  }>;
  barberia: One<{
    id_barberia: string;
    nombre: string;
    direccion: string | null;
  }>;
  cita_procedimiento?: {
    precio_aplicado: number | string;
    duracion_minutos_aplicada: number;
    procedimiento: One<{ id_procedimiento: string; nombre: string }>;
  }[];
  calificacion?: One<{ puntuacion_numerica: number; resena: string | null }>;
}

/** Lo mínimo de una cita para decidir si se puede cancelar o reprogramar. */
interface CitaPropiaRow {
  id_cita: string;
  id_barbero: string;
  id_cliente: string;
  estado: EstadoCitaCliente;
  inicio_at: string;
  fin_at: string;
  cita_procedimiento?: {
    precio_aplicado: number | string;
    duracion_minutos_aplicada: number;
  }[];
}

interface ProcedimientosRow extends Pick<BarberoRow, 'barbero_procedimiento'> {
  id_barberia: string;
  barberia: One<{ activo: boolean }>;
}

interface PerfilRow extends BarberoRow {
  barberia: One<BarberiaRow & { activo: boolean }>;
}

interface ResenaRow {
  id_calificacion: string;
  puntuacion_numerica: number;
  resena: string | null;
  created_at: string;
  cita: One<{ cliente: One<{ nombre_cliente: string }> }>;
}

/**
 * Lo que el cliente ve antes de agendar. Son lecturas con la service role,
 * acotadas a barberías y barberos activos: el cliente no puede leer esas tablas
 * directamente por las políticas de la base.
 */
@Injectable()
export class ClienteService {
  private readonly logger = new Logger(ClienteService.name);

  // ---------------------------------------------------------------------
  // HU-17: elegir barbería y barbero
  // ---------------------------------------------------------------------

  async listBarberias(): Promise<BarberiaView[]> {
    const { data, error } = await supabaseAdmin
      .from('barberia')
      .select(BARBERIA_SELECT)
      .eq('activo', true)
      .order('nombre', { ascending: true });

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    const rows = (data ?? []) as unknown as BarberiaRow[];
    if (rows.length === 0) {
      return [];
    }

    const { data: barberos, error: errBarberos } = await supabaseAdmin
      .from('barbero')
      .select('id_barberia')
      .eq('activo', true)
      .in(
        'id_barberia',
        rows.map((row) => row.id_barberia),
      );

    if (errBarberos) {
      throw new InternalServerErrorException(errBarberos.message);
    }

    const totals = new Map<string, number>();
    for (const barbero of (barberos ?? []) as unknown as {
      id_barberia: string;
    }[]) {
      totals.set(
        barbero.id_barberia,
        (totals.get(barbero.id_barberia) ?? 0) + 1,
      );
    }

    return Promise.all(
      rows.map(async (row) => ({
        id: row.id_barberia,
        nombre: row.nombre,
        descripcion: row.descripcion ?? '',
        direccion: row.direccion ?? '',
        telefono: row.telefono,
        logo: await getSignedStorageUrl(row.logo_url),
        totalBarberos: totals.get(row.id_barberia) ?? 0,
      })),
    );
  }

  async listBarberos(idBarberia: string): Promise<BarberoListItem[]> {
    if (!isUuid(idBarberia)) {
      throw new NotFoundException('No se encontró la barbería');
    }

    const { data: barberia, error: errBarberia } = await supabaseAdmin
      .from('barberia')
      .select('id_barberia')
      .eq('id_barberia', idBarberia)
      .eq('activo', true)
      .maybeSingle();

    if (errBarberia) {
      throw new InternalServerErrorException(errBarberia.message);
    }

    if (!barberia) {
      throw new NotFoundException('No se encontró la barbería');
    }

    const { data, error } = await supabaseAdmin
      .from('barbero')
      .select(
        `
          id_barbero,
          nombre_barbero,
          foto_perfil,
          promedio_calificacion,
          barbero_procedimiento(
            procedimiento:procedimiento(id_procedimiento, nombre, descripcion, precio, duracion_minutos, activo)
          )
        `,
      )
      .eq('id_barberia', idBarberia)
      .eq('activo', true)
      .order('nombre_barbero', { ascending: true });

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    const rows = (data ?? []) as unknown as BarberoRow[];
    const schedules = await loadSchedules(rows.map((row) => row.id_barbero));

    return Promise.all(
      rows.map(async (row) => {
        const horarioResumen = summarizeSchedule(
          schedules.get(row.id_barbero) ?? [],
        );

        return {
          id: row.id_barbero,
          nombre: row.nombre_barbero,
          foto: await getSignedStorageUrl(row.foto_perfil),
          promedioCalificacion: Number(row.promedio_calificacion ?? 0),
          especialidades: this.toEspecialidades(row).map((item) => item.nombre),
          tieneHorario: horarioResumen !== '',
          horarioResumen,
        };
      }),
    );
  }

  async getBarbero(id: string): Promise<BarberoPerfilView> {
    if (!isUuid(id)) {
      throw new NotFoundException('No se encontró el barbero');
    }

    const { data, error } = await supabaseAdmin
      .from('barbero')
      .select(
        `
          id_barbero,
          nombre_barbero,
          foto_perfil,
          promedio_calificacion,
          barberia:barberia(id_barberia, nombre, descripcion, direccion, telefono, logo_url, activo),
          barbero_procedimiento(
            procedimiento:procedimiento(id_procedimiento, nombre, descripcion, precio, duracion_minutos, activo)
          )
        `,
      )
      .eq('id_barbero', id)
      .eq('activo', true)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    const row = data as unknown as PerfilRow | null;
    const barberia = first(row?.barberia);

    if (!row || !barberia?.activo) {
      throw new NotFoundException('No se encontró el barbero');
    }

    const [schedules, resenas] = await Promise.all([
      loadSchedules([id]),
      this.loadResenas(id),
    ]);
    const horarioResumen = summarizeSchedule(schedules.get(id) ?? []);

    return {
      id: row.id_barbero,
      nombre: row.nombre_barbero,
      foto: await getSignedStorageUrl(row.foto_perfil),
      promedioCalificacion: Number(row.promedio_calificacion ?? 0),
      totalResenas: resenas.total,
      barberia: {
        id: barberia.id_barberia,
        nombre: barberia.nombre,
        direccion: barberia.direccion ?? '',
        telefono: barberia.telefono,
        logo: await getSignedStorageUrl(barberia.logo_url),
      },
      tieneHorario: horarioResumen !== '',
      horarioResumen,
      especialidades: this.toEspecialidades(row),
      resenas: resenas.items,
    };
  }

  // ---------------------------------------------------------------------
  // HU-18: elegir uno o varios procedimientos
  // ---------------------------------------------------------------------

  async listProcedimientos(
    barberoId: string,
  ): Promise<ProcedimientosBarberoView> {
    if (!isUuid(barberoId)) {
      throw new NotFoundException('No se encontró el barbero');
    }

    const { data, error } = await supabaseAdmin
      .from('barbero')
      .select(
        `
          id_barberia,
          barberia:barberia(activo),
          barbero_procedimiento(
            procedimiento:procedimiento(id_procedimiento, nombre, descripcion, precio, duracion_minutos, activo)
          )
        `,
      )
      .eq('id_barbero', barberoId)
      .eq('activo', true)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    const row = data as unknown as ProcedimientosRow | null;

    if (!row || !first(row.barberia)?.activo) {
      throw new NotFoundException('No se encontró el barbero');
    }

    const especialidades = this.toEspecialidades(row);
    if (especialidades.length > 0) {
      return { origen: 'especialidades', procedimientos: especialidades };
    }

    // Sin especialidades asignadas: se ofrece todo el catálogo activo de la barbería.
    const { data: catalogo, error: errCatalogo } = await supabaseAdmin
      .from('procedimiento')
      .select(
        'id_procedimiento, nombre, descripcion, precio, duracion_minutos, activo',
      )
      .eq('id_barberia', row.id_barberia)
      .eq('activo', true)
      .order('nombre', { ascending: true });

    if (errCatalogo) {
      throw new InternalServerErrorException(errCatalogo.message);
    }

    return {
      origen: 'barberia',
      procedimientos: ((catalogo ?? []) as unknown as ProcedimientoRow[]).map(
        (item) => this.toEspecialidad(item),
      ),
    };
  }

  // ---------------------------------------------------------------------
  // HU-19: solo fechas y horas disponibles (con la duración y el costo de HU-20)
  // ---------------------------------------------------------------------

  async getDisponibilidad(
    user: AuthUser,
    barberoId: string,
    query: DisponibilidadQuery,
  ): Promise<DisponibilidadView> {
    const now = this.now();
    const { desde, dias } = parseDateRange(query ?? {}, now);
    const excluirCita = this.parseExcluirCita(query?.excluirCita);
    const sinProcedimientos =
      typeof query?.procedimientos !== 'string' ||
      query.procedimientos.trim() === '';

    let duracionMinutos: number;
    let costoTotal: number;

    if (sinProcedimientos && excluirCita) {
      // Reprogramar: se conserva la duración con la que se agendó la cita.
      await this.listProcedimientos(barberoId); // 404 si el barbero ya no está activo
      const cita = await this.findCitaPropia(user, excluirCita);

      if (cita.id_barbero !== barberoId) {
        throw new BadRequestException('Esa cita no es con este barbero');
      }

      this.ensureAbierta(cita);
      ({ duracionMinutos, costoTotal } = this.totalesCita(cita));
    } else {
      const ids = parseProcedimientoIds(query?.procedimientos);

      // También comprueba que el barbero y su barbería existan y estén activos.
      const { procedimientos } = await this.listProcedimientos(barberoId);
      const elegidos = ids.map((id) =>
        procedimientos.find((item) => item.id === id),
      );

      if (elegidos.some((item) => !item)) {
        throw new BadRequestException(
          'Alguno de los procedimientos no lo ofrece este barbero',
        );
      }

      duracionMinutos = elegidos.reduce(
        (total, item) => total + (item?.duracionMinutos ?? 0),
        0,
      );
      costoTotal = elegidos.reduce(
        (total, item) => total + (item?.precio ?? 0),
        0,
      );
    }

    return this.freeSlots(user, barberoId, {
      duracionMinutos,
      costoTotal,
      desde,
      dias,
      excluirCita,
      now,
    });
  }

  /** Horas libres de un barbero para una cita de esa duración (ver `loadFreeDays`). */
  private async freeSlots(
    user: AuthUser,
    barberoId: string,
    input: {
      duracionMinutos: number;
      costoTotal: number;
      desde: string;
      dias: number;
      excluirCita: string | null;
      now: Date;
    },
  ): Promise<DisponibilidadView> {
    const { duracionMinutos, costoTotal, desde, dias } = input;

    return {
      duracionMinutos,
      costoTotal,
      desde,
      hasta: addDays(desde, dias - 1),
      dias: await loadFreeDays({
        barberoId,
        clienteId: user.profileId,
        duracionMinutos,
        desde,
        dias,
        excluirCita: input.excluirCita,
        now: input.now,
      }),
    };
  }

  // ---------------------------------------------------------------------
  // HU-20: confirmar y solicitar la cita
  // ---------------------------------------------------------------------

  /**
   * Crea la solicitud (nace pendiente: el barbero la acepta o la rechaza).
   * Se escribe con el token del cliente para que apliquen las políticas y los
   * triggers de la base, que son la última barrera (solapes, disponibilidad,
   * procedimientos de la barbería).
   */
  async crearCita(user: AuthUser, dto: CrearCitaDto) {
    const idBarbero = this.requireUuid(dto?.idBarbero, 'Selecciona un barbero');
    const procedimientoIds = this.requireIds(dto?.procedimientoIds);
    const inicio = toInstant(dto?.fecha, dto?.horaInicio);
    const notas = optionalText(dto?.notas, 300);

    if (inicio.getTime() <= this.now().getTime()) {
      throw new BadRequestException(
        'No se puede programar en una fecha u hora pasada',
      );
    }

    // La hora se vuelve a comprobar justo antes de guardar: pudo ocuparse mientras
    // el cliente confirmaba. Esto reutiliza todas las reglas de la disponibilidad.
    const disponibilidad = await this.getDisponibilidad(user, idBarbero, {
      procedimientos: procedimientoIds.join(','),
      desde: dto.fecha,
      dias: '1',
    });
    const libre = disponibilidad.dias
      .find((dia) => dia.fecha === dto.fecha)
      ?.horas.includes(dto.horaInicio);

    if (!libre) {
      throw new ConflictException('Esa hora ya no está disponible. Elige otra');
    }

    const fin = new Date(
      inicio.getTime() + disponibilidad.duracionMinutos * 60_000,
    );
    const client = createSupabaseUserClient(user.accessToken);

    const { data, error } = await client
      .from('cita')
      .insert({
        id_cliente: user.profileId,
        id_barbero: idBarbero,
        inicio_at: inicio.toISOString(),
        fin_at: fin.toISOString(),
        estado: 'pendiente',
        notas_cliente: notas,
      })
      .select('id_cita')
      .single<{ id_cita: string }>();

    if (error || !data) {
      throw mapCitaError(
        error?.message ?? 'No se pudo crear la cita',
        'cliente',
      );
    }

    const idCita = data.id_cita;
    // El precio y la duración aplicados los congela un trigger de la base.
    const { error: errProcedimientos } = await client
      .from('cita_procedimiento')
      .insert(
        procedimientoIds.map((id) => ({
          id_cita: idCita,
          id_procedimiento: id,
        })),
      );

    if (errProcedimientos) {
      // Sin procedimientos la cita no sirve: se retira (el cliente no puede borrar
      // citas por política, así que se limpia con la service role y solo esta cita).
      await supabaseAdmin
        .from('cita')
        .delete()
        .eq('id_cita', idCita)
        .eq('id_cliente', user.profileId)
        .eq('estado', 'pendiente');

      throw mapCitaError(errProcedimientos.message, 'cliente');
    }

    return {
      message: 'Solicitud enviada. Espera la confirmación del barbero.',
      cita: await this.getCita(user, idCita),
    };
  }

  /** Una cita solo se lee si es de este cliente. */
  async getCita(user: AuthUser, id: string): Promise<CitaClienteView> {
    if (!isUuid(id)) {
      throw new NotFoundException('No se encontró la cita');
    }

    const { data, error } = await supabaseAdmin
      .from('cita')
      .select(CITA_SELECT)
      .eq('id_cita', id)
      .eq('id_cliente', user.profileId)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    if (!data) {
      throw new NotFoundException('No se encontró la cita');
    }

    return this.toCitaView(data, (await loadPendientes([id])).get(id));
  }

  // ---------------------------------------------------------------------
  // HU-21: reprogramar o cancelar con 1 día de antelación
  // ---------------------------------------------------------------------

  /**
   * - proximas: citas abiertas (pendientes o confirmadas) que aún no terminan.
   * - historial: realizadas, canceladas y rechazadas (incluye las vencidas),
   *   de la más reciente a la más antigua, paginado.
   */
  async listCitas(
    user: AuthUser,
    query: CitasClienteQuery,
  ): Promise<CitasClienteResultado> {
    const grupo = query?.grupo ?? 'proximas';
    if (grupo !== 'proximas' && grupo !== 'historial') {
      throw new BadRequestException('El grupo de citas no es válido');
    }

    const { offset, limit } = parsePage(query?.offset, query?.limit);

    // Las solicitudes cuya hora ya pasó se vencen y las citas terminadas pasan a
    // realizadas antes de listar.
    await markPastCitas(this.logger);

    let request = supabaseAdmin
      .from('cita')
      .select(CITA_SELECT)
      .eq('id_cliente', user.profileId);

    if (grupo === 'proximas') {
      request = request
        .in('estado', ['pendiente', 'confirmada'])
        .gte('fin_at', this.now().toISOString())
        .order('inicio_at', { ascending: true })
        .limit(200);
    } else {
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
    const propuestas = await loadPendientes(page.map((row) => row.id_cita));

    return {
      items: await Promise.all(
        page.map((row) => this.toCitaView(row, propuestas.get(row.id_cita))),
      ),
      hayMas: grupo === 'historial' && rows.length > limit,
    };
  }

  // ---------------------------------------------------------------------
  // HU-23: calificar una cita realizada
  // ---------------------------------------------------------------------

  /**
   * Una calificación por cita, solo si ya fue realizada: nota de 1 a 5 y reseña
   * opcional (máximo 500 caracteres). Se escribe con el token del cliente; un
   * trigger de la base recalcula el promedio del barbero.
   */
  async calificarCita(user: AuthUser, id: string, dto: CalificarCitaDto) {
    const puntuacion = Number(dto?.puntuacion);
    if (!Number.isInteger(puntuacion) || puntuacion < 1 || puntuacion > 5) {
      throw new BadRequestException('La calificación debe estar entre 1 y 5');
    }
    const resena = optionalText(dto?.resena, 500);

    // Una cita confirmada que ya terminó pasa a realizada al listar; se hace aquí
    // también por si el cliente califica sin haber recargado su historial.
    await markPastCitas(this.logger);
    const cita = await this.findCitaPropia(user, id);

    if (cita.estado !== 'realizada') {
      throw new ConflictException('Solo puedes calificar una cita realizada');
    }

    const { error } = await createSupabaseUserClient(user.accessToken)
      .from('calificacion')
      .insert({
        id_cita: id,
        puntuacion_numerica: puntuacion,
        resena,
      });

    if (error) {
      if (error.code === '23505') {
        throw new ConflictException('Ya calificaste esta cita');
      }
      if (/realizada/i.test(error.message)) {
        throw new ConflictException('Solo puedes calificar una cita realizada');
      }
      throw mapCitaError(error.message, 'cliente');
    }

    return {
      message: '¡Gracias por tu calificación!',
      cita: await this.getCita(user, id),
    };
  }

  async cancelarCita(user: AuthUser, id: string, dto: MotivoCitaDto) {
    const motivo = optionalText(dto?.motivo, 200);
    const cita = await this.findCitaPropia(user, id);
    this.ensureModificable(cita);

    await this.updateCita(user, id, {
      estado: 'cancelada',
      motivo_estado: motivo,
    });

    return { message: 'Cita cancelada', cita: await this.getCita(user, id) };
  }

  /**
   * Cambio de horario, conservando la duración con la que se agendó la cita.
   * - Cita confirmada: no se mueve. Se envía una propuesta y la cita sigue en su
   *   horario hasta que el barbero la acepte.
   * - Solicitud pendiente: el barbero aún no se comprometió, así que se mueve
   *   directo y sigue pendiente.
   */
  async reprogramarCita(user: AuthUser, id: string, dto: ReprogramarCitaDto) {
    const cita = await this.findCitaPropia(user, id);
    this.ensureModificable(cita);

    const now = this.now();
    const { duracionMinutos, costoTotal } = this.totalesCita(cita);
    await this.listProcedimientos(cita.id_barbero); // 404 si el barbero ya no está activo

    if (cita.estado === 'confirmada') {
      await proponer({
        actor: 'cliente',
        cita,
        duracionMinutos,
        fecha: dto?.fecha,
        horaInicio: dto?.horaInicio,
        now,
      });

      return {
        message:
          'Propuesta enviada. Tu cita sigue en su horario actual hasta que el barbero acepte el cambio.',
        cita: await this.getCita(user, id),
      };
    }

    const inicio = toInstant(dto?.fecha, dto?.horaInicio);

    if (inicio.getTime() <= now.getTime()) {
      throw new BadRequestException(
        'No se puede programar en una fecha u hora pasada',
      );
    }

    if (inicio.getTime() === new Date(cita.inicio_at).getTime()) {
      throw new BadRequestException('Elige una hora distinta a la actual');
    }

    // La hora se vuelve a comprobar justo antes de guardar. La propia cita no
    // ocupa su horario actual, así que se puede mover a un tramo contiguo.
    const disponibilidad = await this.freeSlots(user, cita.id_barbero, {
      duracionMinutos,
      costoTotal,
      desde: dto.fecha,
      dias: 1,
      excluirCita: id,
      now,
    });
    const libre = disponibilidad.dias
      .find((dia) => dia.fecha === dto.fecha)
      ?.horas.includes(dto.horaInicio);

    if (!libre) {
      throw new ConflictException('Esa hora ya no está disponible. Elige otra');
    }

    await this.updateCita(user, id, {
      inicio_at: inicio.toISOString(),
      fin_at: new Date(
        inicio.getTime() + duracionMinutos * 60_000,
      ).toISOString(),
    });

    return {
      message: 'Cita reprogramada',
      cita: await this.getCita(user, id),
    };
  }

  /** El barbero propuso otro horario y el cliente lo acepta: la cita se mueve. */
  async aceptarPropuesta(user: AuthUser, id: string) {
    const cita = await this.findCitaPropia(user, id);

    await aceptar({
      user,
      actor: 'cliente',
      cita,
      duracionMinutos: this.totalesCita(cita).duracionMinutos,
      now: this.now(),
    });

    return {
      message: 'Aceptaste el nuevo horario. Tu cita fue reprogramada.',
      cita: await this.getCita(user, id),
    };
  }

  /** El cliente rechaza la propuesta del barbero: la cita sigue como estaba. */
  async rechazarPropuesta(user: AuthUser, id: string) {
    const cita = await this.findCitaPropia(user, id);
    await rechazar('cliente', cita);

    return {
      message: 'Rechazaste el cambio. Tu cita sigue en su horario original.',
      cita: await this.getCita(user, id),
    };
  }

  /** El cliente retira su propia propuesta. */
  async retirarPropuesta(user: AuthUser, id: string) {
    const cita = await this.findCitaPropia(user, id);
    await retirar('cliente', cita);

    return {
      message: 'Propuesta retirada.',
      cita: await this.getCita(user, id),
    };
  }

  /** Una cita solo se toca si es de este cliente. */
  private async findCitaPropia(
    user: AuthUser,
    id: string,
  ): Promise<CitaPropiaRow> {
    if (!isUuid(id)) {
      throw new NotFoundException('No se encontró la cita');
    }

    const { data, error } = await supabaseAdmin
      .from('cita')
      .select(
        `
          id_cita,
          id_barbero,
          id_cliente,
          estado,
          inicio_at,
          fin_at,
          cita_procedimiento(precio_aplicado, duracion_minutos_aplicada)
        `,
      )
      .eq('id_cita', id)
      .eq('id_cliente', user.profileId)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    if (!data) {
      throw new NotFoundException('No se encontró la cita');
    }

    return data;
  }

  private ensureAbierta(cita: CitaPropiaRow) {
    if (cita.estado !== 'pendiente' && cita.estado !== 'confirmada') {
      throw new ConflictException('Esta cita ya no se puede modificar');
    }
  }

  /** Abierta y con al menos 1 día de antelación (la base lo exige también). */
  private ensureModificable(cita: CitaPropiaRow) {
    this.ensureAbierta(cita);

    if (!this.canModify(cita.estado, cita.inicio_at)) {
      throw new BadRequestException(
        'Solo puedes cancelar o reprogramar citas con al menos 1 día de antelación',
      );
    }
  }

  private canModify(estado: EstadoCitaCliente, inicioAt: string) {
    return (
      (estado === 'pendiente' || estado === 'confirmada') &&
      new Date(inicioAt).getTime() - this.now().getTime() >= DAY_MS
    );
  }

  /** Precio y duración congelados al agendar. */
  private totalesCita(cita: CitaPropiaRow) {
    const items = cita.cita_procedimiento ?? [];
    const duracionMinutos = items.reduce(
      (total, item) => total + Number(item.duracion_minutos_aplicada ?? 0),
      0,
    );

    if (duracionMinutos <= 0) {
      throw new BadRequestException('La cita no tiene procedimientos válidos');
    }

    return {
      duracionMinutos,
      costoTotal: items.reduce(
        (total, item) => total + Number(item.precio_aplicado ?? 0),
        0,
      ),
    };
  }

  /** Cambia la cita con el token del cliente: la base valida estados y horarios. */
  private async updateCita(
    user: AuthUser,
    id: string,
    changes: Record<string, unknown>,
  ) {
    const { data, error } = await createSupabaseUserClient(user.accessToken)
      .from('cita')
      .update(changes)
      .eq('id_cita', id)
      .eq('id_cliente', user.profileId)
      .select('id_cita')
      .maybeSingle<{ id_cita: string }>();

    if (error) {
      throw mapCitaError(error.message, 'cliente');
    }

    if (!data) {
      throw new ConflictException(
        'La cita cambió y ya no se puede actualizar. Recarga la lista.',
      );
    }
  }

  private async toCitaView(
    row: CitaRow,
    propuesta?: PropuestaRow,
  ): Promise<CitaClienteView> {
    // Precio y duración salen de las columnas congeladas al agendar.
    const procedimientos = (row.cita_procedimiento ?? []).map((item) => {
      const procedimiento = first(item.procedimiento);
      return {
        id: procedimiento?.id_procedimiento ?? '',
        nombre: procedimiento?.nombre ?? 'Procedimiento',
        precio: Number(item.precio_aplicado ?? 0),
        duracionMinutos: Number(item.duracion_minutos_aplicada ?? 0),
      };
    });
    const barbero = first(row.barbero);
    const barberia = first(row.barberia);
    const calificacion = first(row.calificacion);
    const vencida =
      row.estado === 'rechazada' && row.motivo_estado === EXPIRED_REASON;

    return {
      id: row.id_cita,
      estado: row.estado,
      estadoLabel: vencida ? 'Vencida' : ESTADO_LABEL[row.estado],
      fecha: bogotaDate(row.inicio_at),
      horaInicio: bogotaHour(row.inicio_at),
      horaFin: bogotaHour(row.fin_at),
      duracionMinutos: procedimientos.reduce(
        (total, item) => total + item.duracionMinutos,
        0,
      ),
      costoTotal: procedimientos.reduce(
        (total, item) => total + item.precio,
        0,
      ),
      notas: row.notas_cliente ?? '',
      motivo: row.motivo_estado,
      puedeModificar: this.canModify(row.estado, row.inicio_at),
      calificacion: calificacion
        ? {
            puntuacion: Number(calificacion.puntuacion_numerica),
            resena: calificacion.resena ?? '',
          }
        : null,
      puedeCalificar: row.estado === 'realizada' && !calificacion,
      propuesta: toPropuestaView(
        propuestaVigente(row, propuesta, this.now()),
        'cliente',
      ),
      barbero: {
        id: barbero?.id_barbero ?? '',
        nombre: barbero?.nombre_barbero ?? 'Barbero',
        foto: await getSignedStorageUrl(barbero?.foto_perfil),
      },
      barberia: {
        id: barberia?.id_barberia ?? '',
        nombre: barberia?.nombre ?? '',
        direccion: barberia?.direccion ?? '',
      },
      procedimientos,
    };
  }

  private requireUuid(value: unknown, message: string) {
    if (typeof value !== 'string' || !isUuid(value)) {
      throw new BadRequestException(message);
    }
    return value;
  }

  private requireIds(value: unknown) {
    return parseProcedimientoIds(Array.isArray(value) ? value.join(',') : '');
  }

  // ---------------------------------------------------------------------
  // Utilidades internas
  // ---------------------------------------------------------------------

  /** Reloj aparte para poder fijar la hora en las pruebas. */
  protected now() {
    return new Date();
  }

  private parseExcluirCita(value: unknown) {
    if (value === undefined || value === '') {
      return null;
    }

    if (typeof value !== 'string' || !isUuid(value)) {
      throw new BadRequestException('La cita a excluir no es válida');
    }

    return value;
  }

  /** Solo las especialidades activas del barbero. */
  private toEspecialidades(
    row: Pick<BarberoRow, 'barbero_procedimiento'>,
  ): EspecialidadView[] {
    return (row.barbero_procedimiento ?? [])
      .map((item) => first(item.procedimiento))
      .filter((item): item is ProcedimientoRow => !!item?.activo)
      .map((item) => this.toEspecialidad(item))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  private toEspecialidad(item: ProcedimientoRow): EspecialidadView {
    return {
      id: item.id_procedimiento,
      nombre: item.nombre,
      descripcion: item.descripcion ?? '',
      precio: Number(item.precio ?? 0),
      duracionMinutos: Number(item.duracion_minutos ?? 0),
    };
  }

  private async loadResenas(barberoId: string) {
    const { data, count, error } = await supabaseAdmin
      .from('calificacion')
      .select(
        `
          id_calificacion,
          puntuacion_numerica,
          resena,
          created_at,
          cita!inner(
            id_barbero,
            cliente:cliente(nombre_cliente)
          )
        `,
        { count: 'exact' },
      )
      .eq('cita.id_barbero', barberoId)
      .order('created_at', { ascending: false })
      .limit(MAX_RESENAS);

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    const items = ((data ?? []) as unknown as ResenaRow[]).map((row) => ({
      id: row.id_calificacion,
      puntuacion: Number(row.puntuacion_numerica),
      comentario: row.resena ?? '',
      fecha: bogotaDate(row.created_at),
      cliente: firstName(first(first(row.cita)?.cliente)?.nombre_cliente),
    }));

    return { total: count ?? items.length, items };
  }
}
