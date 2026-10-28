import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { isUuid } from '../admin/admin.utils';
import { bogotaDate } from '../barbero/barbero.utils';
import { first, type One } from '../common/postgrest';
import { getSignedStorageUrl, supabaseAdmin } from '../supabase';
import type {
  BarberiaView,
  BarberoListItem,
  BarberoPerfilView,
  EspecialidadView,
  ProcedimientosBarberoView,
} from './cliente.types';
import {
  firstName,
  summarizeSchedule,
  type ScheduleBlock,
} from './cliente.utils';

const BARBERIA_SELECT =
  'id_barberia, nombre, descripcion, direccion, telefono, logo_url';

const MAX_RESENAS = 10;

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
  // Utilidades internas
  // ---------------------------------------------------------------------

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
