import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  normalizeEmail,
  normalizePhone,
  requireText,
  validatePassword,
} from '../auth/auth.validation';
import { AccountsService } from '../common/accounts.service';
import type { AuthUser } from '../common/auth/auth-user';
import { removeStoredFile } from '../common/storage';
import { getSignedStorageUrl, supabaseAdmin } from '../supabase';
import { diffIds, normalizeIds } from './admin.utils';
import type {
  BarberoView,
  CreateBarberoDto,
  ProcedimientoView,
  UpdateBarberoDto,
} from './admin.types';

const BARBERO_SELECT = `
  id_barbero,
  user_id,
  nombre_barbero,
  usuario,
  email,
  telefono,
  foto_perfil,
  activo,
  promedio_calificacion,
  barbero_procedimiento(
    id_procedimiento,
    procedimiento:procedimiento(id_procedimiento, nombre)
  )
`;

interface BarberoRow {
  id_barbero: string;
  user_id: string | null;
  nombre_barbero: string;
  usuario: string;
  email: string | null;
  telefono: string | null;
  foto_perfil: string | null;
  activo: boolean;
  promedio_calificacion: number | string | null;
  barbero_procedimiento?: {
    id_procedimiento: string;
    procedimiento: { id_procedimiento: string; nombre: string } | null;
  }[];
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private readonly accounts: AccountsService) {}

  // ---------------------------------------------------------------------
  // Barberos (RF-07, RF-08, RF-09)
  // ---------------------------------------------------------------------

  async listBarberos(user: AuthUser): Promise<BarberoView[]> {
    const idBarberia = await this.barberiaIdOf(user);

    const { data, error } = await supabaseAdmin
      .from('barbero')
      .select(BARBERO_SELECT)
      .eq('id_barberia', idBarberia)
      .eq('activo', true)
      .order('nombre_barbero', { ascending: true });

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    const rows = (data ?? []) as unknown as BarberoRow[];
    const pending = await this.pendingPasswordUsers(rows);

    return Promise.all(rows.map((row) => this.toView(row, pending)));
  }

  async createBarbero(user: AuthUser, dto: CreateBarberoDto) {
    const idBarberia = await this.barberiaIdOf(user);

    const nombre = requireText(dto.nombre, 'El nombre es obligatorio');
    const email = normalizeEmail(dto.email);
    const password = validatePassword(dto.password);
    const telefono = normalizePhone(dto.telefono);
    const procedimientoIds = normalizeIds(dto.procedimientoIds) ?? [];

    await this.assertProcedimientosOfBarberia(procedimientoIds, idBarberia);
    await this.accounts.ensureEmailIsFree(email);

    let userId: string | null = null;
    let barberoId: string | null = null;

    try {
      userId = await this.accounts.createAuthUser(email, password, {
        nombre,
        rol: 'barbero',
      });

      await this.accounts.insertPerfil(userId, 'barbero', {
        acceptedTerms: false,
        mustChangePassword: true,
      });

      const usuario = await this.accounts.generateUsername(email);

      const { data, error } = await supabaseAdmin
        .from('barbero')
        .insert({
          user_id: userId,
          id_barberia: idBarberia,
          nombre_barbero: nombre,
          usuario,
          email,
          telefono,
          activo: true,
        })
        .select('id_barbero')
        .single();

      if (error || !data) {
        throw new InternalServerErrorException(
          error?.message || 'No fue posible crear el barbero',
        );
      }
      barberoId = data.id_barbero as string;

      await this.setEspecialidades(barberoId, procedimientoIds);

      await this.accounts.audit({
        userId: user.userId,
        role: 'admin',
        entity: 'barbero',
        entityId: barberoId,
        action: 'crear_barbero',
        details: { nombre },
        idBarberia,
      });

      return {
        message:
          'Barbero creado. Entrégale la contraseña temporal: la cambiará en su primer ingreso.',
        barbero: await this.getBarbero(barberoId, idBarberia),
      };
    } catch (error) {
      await this.rollbackBarbero(userId, barberoId);
      throw error;
    }
  }

  async updateBarbero(user: AuthUser, id: string, dto: UpdateBarberoDto) {
    const idBarberia = await this.barberiaIdOf(user);
    const barbero = await this.findOwnedBarbero(id, idBarberia);

    const changes: Record<string, string | null> = {};

    if (dto.nombre !== undefined) {
      changes.nombre_barbero = requireText(
        dto.nombre,
        'El nombre es obligatorio',
      );
    }

    if (dto.telefono !== undefined) {
      changes.telefono = normalizePhone(dto.telefono);
    }

    const procedimientoIds = normalizeIds(dto.procedimientoIds);
    if (procedimientoIds) {
      await this.assertProcedimientosOfBarberia(procedimientoIds, idBarberia);
    }

    let newEmail: string | null = null;
    if (dto.email !== undefined) {
      newEmail = normalizeEmail(dto.email);
      if (newEmail !== barbero.email) {
        await this.accounts.ensureEmailIsFree(
          newEmail,
          barbero.user_id ?? undefined,
        );
      } else {
        newEmail = null;
      }
    }

    const temporaryPassword =
      dto.nuevaContrasenaTemporal !== undefined
        ? validatePassword(dto.nuevaContrasenaTemporal)
        : null;

    if (
      Object.keys(changes).length === 0 &&
      !newEmail &&
      !temporaryPassword &&
      !procedimientoIds
    ) {
      throw new BadRequestException('No hay cambios para guardar');
    }

    if ((newEmail || temporaryPassword) && !barbero.user_id) {
      throw new BadRequestException(
        'Este barbero no tiene una cuenta de acceso',
      );
    }

    if (newEmail || temporaryPassword) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(
        barbero.user_id as string,
        {
          ...(newEmail ? { email: newEmail, email_confirm: true } : {}),
          ...(temporaryPassword ? { password: temporaryPassword } : {}),
        },
      );

      if (error) {
        throw this.accounts.authError(
          error,
          'No fue posible actualizar la cuenta',
        );
      }

      if (newEmail) changes.email = newEmail;

      if (temporaryPassword) {
        await supabaseAdmin
          .from('perfil')
          .update({ debe_cambiar_contrasena: true })
          .eq('user_id', barbero.user_id);
      }
    }

    if (Object.keys(changes).length > 0) {
      const { error } = await supabaseAdmin
        .from('barbero')
        .update(changes)
        .eq('id_barbero', id);

      if (error) {
        throw new InternalServerErrorException(error.message);
      }
    }

    if (procedimientoIds) {
      await this.setEspecialidades(id, procedimientoIds);
    }

    await this.accounts.audit({
      userId: user.userId,
      role: 'admin',
      entity: 'barbero',
      entityId: id,
      action: 'editar_barbero',
      details: {
        campos: [
          ...Object.keys(changes),
          ...(temporaryPassword ? ['contrasena_temporal'] : []),
          ...(procedimientoIds ? ['especialidades'] : []),
        ],
      },
      idBarberia,
    });

    return {
      message: 'Barbero actualizado',
      barbero: await this.getBarbero(id, idBarberia),
    };
  }

  /**
   * Da de baja a un barbero (RF-09). Política: no se puede con citas próximas;
   * si no las tiene, queda desactivado y sin datos personales, su cuenta de
   * acceso se elimina y se conserva el historial de citas con su nombre.
   */
  async deleteBarbero(user: AuthUser, id: string) {
    const idBarberia = await this.barberiaIdOf(user);
    const barbero = await this.findOwnedBarbero(id, idBarberia);

    const { count, error: errCount } = await supabaseAdmin
      .from('cita')
      .select('id_cita', { count: 'exact', head: true })
      .eq('id_barbero', id)
      .in('estado', ['pendiente', 'confirmada'])
      .gt('fin_at', new Date().toISOString());

    if (errCount) {
      throw new InternalServerErrorException(errCount.message);
    }

    if ((count ?? 0) > 0) {
      throw new ConflictException(
        'Este barbero tiene citas próximas. Reprográmalas o cancélalas antes de darlo de baja.',
      );
    }

    const photoUrl = barbero.foto_perfil;

    const { error } = await supabaseAdmin
      .from('barbero')
      .update({ activo: false, email: null, telefono: null, foto_perfil: null })
      .eq('id_barbero', id);

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    await supabaseAdmin
      .from('barbero_procedimiento')
      .delete()
      .eq('id_barbero', id);
    await supabaseAdmin
      .from('disponibilidad_barbero')
      .delete()
      .eq('id_barbero', id);

    if (barbero.user_id) {
      // Elimina perfil y dispositivos en cascada; barbero.user_id queda en NULL.
      const { error: errUser } = await supabaseAdmin.auth.admin.deleteUser(
        barbero.user_id,
      );
      if (errUser) {
        throw new InternalServerErrorException(
          'El barbero se desactivó, pero no se pudo eliminar su cuenta. Vuelve a intentarlo.',
        );
      }
    }

    await removeStoredFile(photoUrl);

    await this.accounts.audit({
      userId: user.userId,
      role: 'admin',
      entity: 'barbero',
      entityId: id,
      action: 'eliminar_barbero',
      details: { nombre: barbero.nombre_barbero },
      idBarberia,
    });

    return { message: 'Barbero dado de baja' };
  }

  // ---------------------------------------------------------------------
  // Procedimientos (solo lectura por ahora; el CRUD llega en el siguiente tramo)
  // ---------------------------------------------------------------------

  async listProcedimientos(user: AuthUser): Promise<ProcedimientoView[]> {
    const idBarberia = await this.barberiaIdOf(user);

    const { data, error } = await supabaseAdmin
      .from('procedimiento')
      .select(
        'id_procedimiento, nombre, descripcion, precio, duracion_minutos, activo',
      )
      .eq('id_barberia', idBarberia)
      .order('nombre', { ascending: true });

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return ((data ?? []) as unknown as Record<string, unknown>[]).map(
      (item) => ({
        id: item.id_procedimiento as string,
        nombre: item.nombre as string,
        descripcion: (item.descripcion as string | null) ?? '',
        precio: Number(item.precio ?? 0),
        duracionMinutos: item.duracion_minutos as number,
        activo: item.activo === true,
      }),
    );
  }

  // ---------------------------------------------------------------------
  // Utilidades internas
  // ---------------------------------------------------------------------

  /** Barbería del administrador: del token o, si no viene, de la tabla administrador. */
  private async barberiaIdOf(user: AuthUser): Promise<string> {
    if (user.idBarberia) {
      return user.idBarberia;
    }

    const { data } = await supabaseAdmin
      .from('administrador')
      .select('id_barberia')
      .eq('user_id', user.userId)
      .maybeSingle();

    const id = (data as { id_barberia?: string } | null)?.id_barberia;
    if (!id) {
      throw new ForbiddenException('Tu cuenta no está asociada a una barbería');
    }

    return id;
  }

  /** Un barbero solo se toca si es de la barbería del administrador. */
  private async findOwnedBarbero(id: string, idBarberia: string) {
    const { data, error } = await supabaseAdmin
      .from('barbero')
      .select('id_barbero, user_id, nombre_barbero, email, foto_perfil, activo')
      .eq('id_barbero', id)
      .eq('id_barberia', idBarberia)
      .eq('activo', true)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    if (!data) {
      throw new NotFoundException('No se encontró el barbero');
    }

    return data as unknown as Pick<
      BarberoRow,
      | 'id_barbero'
      | 'user_id'
      | 'nombre_barbero'
      | 'email'
      | 'foto_perfil'
      | 'activo'
    >;
  }

  private async getBarbero(id: string, idBarberia: string) {
    const { data, error } = await supabaseAdmin
      .from('barbero')
      .select(BARBERO_SELECT)
      .eq('id_barbero', id)
      .eq('id_barberia', idBarberia)
      .single();

    if (error || !data) {
      throw new InternalServerErrorException(
        error?.message || 'No se pudo leer el barbero',
      );
    }

    const row = data as unknown as BarberoRow;
    return this.toView(row, await this.pendingPasswordUsers([row]));
  }

  /** user_id de los barberos que aún no cambian su contraseña temporal. */
  private async pendingPasswordUsers(rows: BarberoRow[]) {
    const userIds = rows.map((row) => row.user_id).filter(Boolean) as string[];
    if (userIds.length === 0) {
      return new Set<string>();
    }

    const { data } = await supabaseAdmin
      .from('perfil')
      .select('user_id')
      .in('user_id', userIds)
      .eq('debe_cambiar_contrasena', true);

    return new Set(
      ((data ?? []) as unknown as { user_id: string }[]).map((p) => p.user_id),
    );
  }

  private async toView(
    row: BarberoRow,
    pending: Set<string>,
  ): Promise<BarberoView> {
    const especialidades = (row.barbero_procedimiento ?? [])
      .map((item) => item.procedimiento)
      .filter(
        (item): item is { id_procedimiento: string; nombre: string } => !!item,
      )
      .map((item) => ({ id: item.id_procedimiento, nombre: item.nombre }));

    return {
      id: row.id_barbero,
      nombre: row.nombre_barbero,
      usuario: row.usuario,
      email: row.email,
      telefono: row.telefono,
      foto: await getSignedStorageUrl(row.foto_perfil),
      activo: row.activo,
      promedioCalificacion: Number(row.promedio_calificacion ?? 0),
      pendienteCambioContrasena: row.user_id ? pending.has(row.user_id) : false,
      procedimientoIds: especialidades.map((item) => item.id),
      especialidades,
    };
  }

  /** Todos los procedimientos deben existir, estar activos y ser de la barbería. */
  private async assertProcedimientosOfBarberia(
    ids: string[],
    idBarberia: string,
  ) {
    if (ids.length === 0) {
      return;
    }

    const { data, error } = await supabaseAdmin
      .from('procedimiento')
      .select('id_procedimiento')
      .in('id_procedimiento', ids)
      .eq('id_barberia', idBarberia)
      .eq('activo', true);

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    if ((data ?? []).length !== ids.length) {
      throw new BadRequestException(
        'Alguno de los procedimientos no existe o no es de tu barbería',
      );
    }
  }

  /** Deja las especialidades del barbero exactamente como la lista recibida. */
  private async setEspecialidades(barberoId: string, ids: string[]) {
    const { data, error } = await supabaseAdmin
      .from('barbero_procedimiento')
      .select('id_procedimiento')
      .eq('id_barbero', barberoId);

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    const current = (
      (data ?? []) as unknown as { id_procedimiento: string }[]
    ).map((row) => row.id_procedimiento);
    const { toAdd, toRemove } = diffIds(current, ids);

    if (toRemove.length > 0) {
      const { error: errRemove } = await supabaseAdmin
        .from('barbero_procedimiento')
        .delete()
        .eq('id_barbero', barberoId)
        .in('id_procedimiento', toRemove);

      if (errRemove) {
        throw new InternalServerErrorException(errRemove.message);
      }
    }

    if (toAdd.length > 0) {
      const { error: errAdd } = await supabaseAdmin
        .from('barbero_procedimiento')
        .insert(
          toAdd.map((idProcedimiento) => ({
            id_barbero: barberoId,
            id_procedimiento: idProcedimiento,
          })),
        );

      if (errAdd) {
        throw new InternalServerErrorException(errAdd.message);
      }
    }
  }

  /** Deshace un alta a medias para no dejar cuentas ni barberos huérfanos. */
  private async rollbackBarbero(
    userId: string | null,
    barberoId: string | null,
  ) {
    try {
      if (barberoId) {
        await supabaseAdmin
          .from('barbero_procedimiento')
          .delete()
          .eq('id_barbero', barberoId);
        await supabaseAdmin
          .from('barbero')
          .delete()
          .eq('id_barbero', barberoId);
      }
      if (userId) {
        await supabaseAdmin.from('perfil').delete().eq('user_id', userId);
        await supabaseAdmin.auth.admin.deleteUser(userId);
      }
    } catch (error) {
      this.logger.error(`No se pudo limpiar el alta fallida: ${String(error)}`);
    }
  }
}
