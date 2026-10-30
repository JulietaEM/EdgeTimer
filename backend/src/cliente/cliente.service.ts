import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { isUuid } from '../admin/admin.utils';
import { optionalText } from '../auth/auth.validation';
import { bogotaDate, bogotaHour, toInstant } from '../barbero/barbero.utils';
import type { AuthUser } from '../common/auth/auth-user';
import { mapCitaError } from '../common/cita-errors';
import { EXPIRED_REASON } from '../common/maintenance';
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
  CitaClienteView,
  CrearCitaDto,
  EstadoCitaCliente,
  DisponibilidadQuery,
  DisponibilidadView,
  EspecialidadView,
  ProcedimientosBarberoView,
} from './cliente.types';
import {
  addDays,
  computeFreeSlots,
  firstName,
  parseDateRange,
  parseProcedimientoIds,
  summarizeSchedule,
  type BusyRange,
  type ScheduleBlock,
} from './cliente.utils';

const BARBERIA_SELECT =
  'id_barberia, nombre, descripcion, direccion, telefono, logo_url';

const MAX_RESENAS = 10;

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
  )
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
}

interface ProcedimientosRow extends Pick<BarberoRow, 'barbero_procedimiento'> {
  id_barberia: string;
  barberia: One<{ activo: boolean }>;
}

interface PerfilRow extends BarberoRow {
  barberia: One<BarberiaRow & { activo: boolean }>;
}

interface DisponibilidadRow {
  id_barbero: string;
  dia_semana: number;
  hora_inicio: string;
  hora_fin: string;
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
    const schedules = await this.loadSchedules(
      rows.map((row) => row.id_barbero),
    );

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
      this.loadSchedules([id]),
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
    const ids = parseProcedimientoIds(query?.procedimientos);
    const now = this.now();
    const { desde, dias } = parseDateRange(query ?? {}, now);
    const excluirCita = this.parseExcluirCita(query?.excluirCita);

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

    const duracionMinutos = elegidos.reduce(
      (total, item) => total + (item?.duracionMinutos ?? 0),
      0,
    );
    const costoTotal = elegidos.reduce(
      (total, item) => total + (item?.precio ?? 0),
      0,
    );
    const hasta = addDays(desde, dias - 1);
    const base = { duracionMinutos, costoTotal, desde, hasta };

    const schedule =
      (await this.loadSchedules([barberoId])).get(barberoId) ?? [];
    if (schedule.length === 0) {
      return { ...base, dias: [] };
    }

    const windowEnd = new Date(`${addDays(desde, dias)}T00:00:00-05:00`);
    const [barberoBusy, clienteBusy] = await Promise.all([
      this.loadBusy('id_barbero', barberoId, now, windowEnd, excluirCita),
      this.loadBusy('id_cliente', user.profileId, now, windowEnd, excluirCita),
    ]);

    return {
      ...base,
      dias: computeFreeSlots({
        blocks: schedule.map((block) => ({
          dia: block.dia,
          inicio: this.toMinutes(block.inicio),
          fin: this.toMinutes(block.fin),
        })),
        busy: [...barberoBusy, ...clienteBusy],
        desde,
        dias,
        duracionMinutos,
        now,
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

    return this.toCitaView(data);
  }

  private async toCitaView(row: CitaRow): Promise<CitaClienteView> {
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

  private toMinutes(hora: string) {
    const [hours, minutes] = hora.split(':').map(Number);
    return hours * 60 + minutes;
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

  /** Citas activas (pendientes o confirmadas) que aún no terminan dentro de la ventana. */
  private async loadBusy(
    column: 'id_barbero' | 'id_cliente',
    id: string,
    now: Date,
    windowEnd: Date,
    excluirCita: string | null,
  ): Promise<BusyRange[]> {
    let request = supabaseAdmin
      .from('cita')
      .select('inicio_at, fin_at')
      .eq(column, id)
      .in('estado', ['pendiente', 'confirmada'])
      .gt('fin_at', now.toISOString())
      .lt('inicio_at', windowEnd.toISOString());

    if (excluirCita) {
      request = request.neq('id_cita', excluirCita);
    }

    const { data, error } = await request;

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return data ?? [];
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

  /** Tramos semanales activos, agrupados por barbero. */
  private async loadSchedules(barberoIds: string[]) {
    const result = new Map<string, ScheduleBlock[]>();
    if (barberoIds.length === 0) {
      return result;
    }

    const { data, error } = await supabaseAdmin
      .from('disponibilidad_barbero')
      .select('id_barbero, dia_semana, hora_inicio, hora_fin')
      .in('id_barbero', barberoIds)
      .eq('activo', true);

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    for (const row of (data ?? []) as unknown as DisponibilidadRow[]) {
      const list = result.get(row.id_barbero) ?? [];
      list.push({
        dia: row.dia_semana,
        inicio: row.hora_inicio.slice(0, 5),
        fin: row.hora_fin.slice(0, 5),
      });
      result.set(row.id_barbero, list);
    }

    return result;
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
