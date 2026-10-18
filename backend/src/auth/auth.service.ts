import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth-user';
import { AccountsService } from '../common/accounts.service';
import { loadAuthUser } from '../common/auth/profile';
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  removeStoredFile,
  uploadProfilePhoto,
  type UploadedFile,
} from '../common/storage';
import {
  createAnonClient,
  getSignedStorageUrl,
  supabaseAdmin,
} from '../supabase';
import type {
  AuthProfile,
  DeleteAccountDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshDto,
  RegisterBarberiaDto,
  RegisterClientDto,
  ResetPasswordDto,
  UpdateProfileDto,
  UserRole,
} from './auth.types';
import {
  TERMS_VERSION,
  escapeLike,
  normalizeEmail,
  normalizePhone,
  optionalText,
  requireText,
  requireTerms,
  validatePassword,
} from './auth.validation';

/** Tabla, columnas, bucket y carpeta de cada rol. */
const ROLE_CONFIG = {
  cliente: {
    table: 'cliente',
    idColumn: 'id_cliente',
    nameColumn: 'nombre_cliente',
    bucket: 'clientes',
    folder: 'clientes',
  },
  barbero: {
    table: 'barbero',
    idColumn: 'id_barbero',
    nameColumn: 'nombre_barbero',
    bucket: 'barberos',
    folder: 'barberos',
  },
  admin: {
    table: 'administrador',
    idColumn: 'id_administrador',
    nameColumn: 'nombre_administrador',
    bucket: 'barberos',
    folder: 'administradores',
  },
} as const satisfies Record<UserRole, Record<string, string>>;

/** Página a la que lleva el enlace del correo (el frontend web). */
const FRONTEND_URL = (
  process.env.FRONTEND_URL ?? 'https://edge-timer-blue.vercel.app'
).replace(/\/+$/, '');

const FORGOT_PASSWORD_MESSAGE =
  'Si el correo está registrado, te enviamos un enlace para restablecer tu contraseña.';

/** Fila de cualquiera de las tablas de perfil (columnas de texto). */
type ProfileRow = Record<string, string | null | undefined>;

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly accounts: AccountsService) {}

  // ---------------------------------------------------------------------
  // Registro
  // ---------------------------------------------------------------------

  async registerClient(dto: RegisterClientDto) {
    const nombre = requireText(dto.nombre, 'El nombre es obligatorio');
    const email = normalizeEmail(dto.email);
    const password = validatePassword(dto.password);
    const telefono = normalizePhone(dto.telefono);
    requireTerms(dto.aceptaTerminos);

    await this.accounts.ensureEmailIsFree(email);

    let userId: string | null = null;

    try {
      userId = await this.accounts.createAuthUser(email, password, {
        nombre,
        rol: 'cliente',
      });

      const usuario = await this.accounts.generateUsername(email);
      await this.accounts.insertPerfil(userId, 'cliente');

      const { data, error } = await supabaseAdmin
        .from('cliente')
        .insert({
          user_id: userId,
          nombre_cliente: nombre,
          usuario,
          email,
          telefono,
        })
        .select('id_cliente')
        .single();

      if (error || !data) {
        throw new InternalServerErrorException(
          error?.message || 'No fue posible crear la cuenta',
        );
      }

      return {
        message: 'Registro exitoso. Ahora puedes iniciar sesión.',
        profile: {
          id: data.id_cliente as string,
          nombre,
          usuario,
          email,
          role: 'cliente' as const,
        },
      };
    } catch (error) {
      if (userId) {
        await this.cleanupAccount(userId);
      }
      throw error;
    }
  }

  /** HU-30: el propietario registra su barbería y su cuenta de administrador. */
  async registerBarberia(dto: RegisterBarberiaDto) {
    const barberiaDto = dto.barberia ?? ({} as RegisterBarberiaDto['barberia']);
    const adminDto = dto.admin ?? ({} as RegisterBarberiaDto['admin']);

    const nombreBarberia = requireText(
      barberiaDto.nombre,
      'El nombre de la barbería es obligatorio',
    );
    const direccion = optionalText(barberiaDto.direccion, 200);
    const telefonoBarberia = normalizePhone(barberiaDto.telefono);
    const descripcion = optionalText(barberiaDto.descripcion, 500);

    const nombreAdmin = requireText(
      adminDto.nombre,
      'El nombre del administrador es obligatorio',
    );
    const email = normalizeEmail(adminDto.email);
    const password = validatePassword(adminDto.password);
    const telefonoAdmin = normalizePhone(adminDto.telefono);
    requireTerms(dto.aceptaTerminos);

    await this.ensureBarberiaNameIsFree(nombreBarberia);
    await this.accounts.ensureEmailIsFree(email);

    let userId: string | null = null;
    let barberiaId: string | null = null;

    try {
      userId = await this.accounts.createAuthUser(email, password, {
        nombre: nombreAdmin,
        rol: 'admin',
      });

      await this.accounts.insertPerfil(userId, 'admin');

      const { data: barberia, error: errBarberia } = await supabaseAdmin
        .from('barberia')
        .insert({
          nombre: nombreBarberia,
          direccion,
          telefono: telefonoBarberia,
          descripcion,
          email,
          activo: true,
        })
        .select('id_barberia, nombre')
        .single();

      if (errBarberia || !barberia) {
        throw new InternalServerErrorException(
          errBarberia?.message || 'No fue posible crear la barbería',
        );
      }
      barberiaId = barberia.id_barberia as string;

      const { data: admin, error: errAdmin } = await supabaseAdmin
        .from('administrador')
        .insert({
          user_id: userId,
          id_barberia: barberiaId,
          nombre_administrador: nombreAdmin,
          telefono: telefonoAdmin,
        })
        .select('id_administrador')
        .single();

      if (errAdmin || !admin) {
        throw new InternalServerErrorException(
          errAdmin?.message || 'No fue posible crear el administrador',
        );
      }

      await this.accounts.audit({
        userId,
        role: 'admin',
        entity: 'barberia',
        entityId: barberiaId,
        action: 'registro_barberia',
        details: { nombre: nombreBarberia },
        idBarberia: barberiaId,
      });

      return {
        message: 'Registro exitoso. Ahora puedes iniciar sesión.',
        profile: {
          id: admin.id_administrador as string,
          nombre: nombreAdmin,
          email,
          role: 'admin' as const,
          idBarberia: barberiaId,
        },
        barberia: {
          id: barberiaId,
          nombre: barberia.nombre as string,
        },
      };
    } catch (error) {
      if (userId) {
        await this.cleanupAccount(userId, barberiaId);
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------
  // Sesión
  // ---------------------------------------------------------------------

  async login(dto: LoginDto) {
    const email = normalizeEmail(dto.email);
    const password = requireText(
      dto.password,
      'La contraseña es obligatoria',
      72,
    );

    // Un cliente nuevo por petición: nunca se comparte la sesión entre usuarios.
    const { data, error } = await createAnonClient().auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user || !data.session) {
      throw new UnauthorizedException('Usuario o contraseña incorrectos');
    }

    const user = await loadAuthUser(data.session.access_token, data.user.id);

    return {
      message: 'Inicio de sesión exitoso',
      session: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at,
      },
      profile: await this.me(user),
    };
  }

  async refresh(dto: RefreshDto) {
    const refreshToken = requireText(
      dto.refreshToken,
      'Falta el token de renovación',
      2000,
    );

    const { data, error } = await createAnonClient().auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data.session) {
      throw new UnauthorizedException(
        'La sesión expiró. Inicia sesión de nuevo',
      );
    }

    return {
      session: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at,
      },
    };
  }

  async logout(user: AuthUser) {
    const { error } = await supabaseAdmin.auth.admin.signOut(
      user.accessToken,
      'local',
    );

    if (error) {
      this.logger.warn(`No se pudo invalidar la sesión: ${error.message}`);
    }

    return { message: 'Sesión cerrada' };
  }

  // ---------------------------------------------------------------------
  // Recuperar contraseña (HU-05)
  //
  // 1) forgotPassword: Supabase envía un correo con un enlace a nuestro
  //    frontend que lleva un token_hash de un solo uso.
  // 2) resetPassword: el frontend nos manda ese token y la contraseña nueva;
  //    aquí se verifica el token (Supabase valida que no haya expirado ni se
  //    haya usado) y se cambia la contraseña.
  // ---------------------------------------------------------------------

  async forgotPassword(dto: ForgotPasswordDto) {
    const email = normalizeEmail(dto.email);

    const { error } = await createAnonClient().auth.resetPasswordForEmail(
      email,
      { redirectTo: FRONTEND_URL },
    );

    // La respuesta es siempre la misma: así nadie puede descubrir qué
    // correos están registrados probando direcciones.
    if (error) {
      this.logger.warn(
        `No se pudo enviar el correo de recuperación: ${error.message}`,
      );
    }

    return { message: FORGOT_PASSWORD_MESSAGE };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const tokenHash = requireText(dto.tokenHash, 'El enlace no es válido', 500);
    const password = validatePassword(dto.password);

    // Consume el token: si ya se usó o expiró, Supabase responde con error.
    const { data, error } = await createAnonClient().auth.verifyOtp({
      token_hash: tokenHash,
      type: 'recovery',
    });

    if (error || !data.user || !data.session) {
      throw new BadRequestException(
        'El enlace no es válido o ya expiró. Solicita uno nuevo.',
      );
    }

    const { error: errUpdate } = await supabaseAdmin.auth.admin.updateUserById(
      data.user.id,
      { password },
    );

    if (errUpdate) {
      if (errUpdate.code === 'same_password') {
        throw new BadRequestException(
          'La nueva contraseña debe ser distinta a la anterior. Solicita un nuevo enlace para intentarlo otra vez.',
        );
      }
      throw new InternalServerErrorException(
        'No fue posible cambiar la contraseña. Solicita un nuevo enlace.',
      );
    }

    // Si era una cuenta con contraseña temporal, elegir una propia cumple el cambio.
    await supabaseAdmin
      .from('perfil')
      .update({ debe_cambiar_contrasena: false })
      .eq('user_id', data.user.id);

    // Cierra todas las sesiones abiertas (incluida la temporal de recuperación):
    // quien tuviera la cuenta abierta con la contraseña vieja debe volver a entrar.
    const { error: errSignOut } = await supabaseAdmin.auth.admin.signOut(
      data.session.access_token,
      'global',
    );
    if (errSignOut) {
      this.logger.warn(
        `No se pudieron cerrar las sesiones: ${errSignOut.message}`,
      );
    }

    try {
      const user = await loadAuthUser(data.session.access_token, data.user.id);
      await this.accounts.audit({
        userId: user.userId,
        role: user.role,
        entity: ROLE_CONFIG[user.role].table,
        entityId: user.profileId,
        action: 'restablecer_contrasena',
        details: {},
        idBarberia: user.idBarberia,
      });
    } catch {
      // La auditoría nunca debe impedir el cambio de contraseña.
    }

    return {
      message: 'Contraseña actualizada. Ya puedes iniciar sesión.',
    };
  }

  // ---------------------------------------------------------------------
  // Perfil
  // ---------------------------------------------------------------------

  async me(user: AuthUser): Promise<AuthProfile> {
    const config = ROLE_CONFIG[user.role];
    const columns =
      user.role === 'cliente'
        ? 'nombre_cliente, usuario, email, telefono, foto_perfil, created_at'
        : user.role === 'barbero'
          ? 'nombre_barbero, usuario, email, telefono, foto_perfil, created_at, id_barberia'
          : 'nombre_administrador, telefono, foto_perfil, created_at, id_barberia';

    const { data, error } = await supabaseAdmin
      .from(config.table)
      .select(columns)
      .eq(config.idColumn, user.profileId)
      .single();

    if (error || !data) {
      throw new UnauthorizedException('No hay perfil asociado a esta cuenta');
    }

    const row = data as unknown as ProfileRow;
    const idBarberia: string | null = row.id_barberia ?? user.idBarberia;
    const email: string | null = row.email ?? user.email;

    const { data: perfilData } = await supabaseAdmin
      .from('perfil')
      .select('debe_cambiar_contrasena, terminos_aceptados_at')
      .eq('user_id', user.userId)
      .maybeSingle();
    const perfil = perfilData as unknown as {
      debe_cambiar_contrasena?: boolean;
      terminos_aceptados_at?: string;
    } | null;

    let barberia: AuthProfile['barberia'] = null;
    if (idBarberia) {
      const { data } = await supabaseAdmin
        .from('barberia')
        .select('id_barberia, nombre, direccion, telefono')
        .eq('id_barberia', idBarberia)
        .maybeSingle();
      const b = data as unknown as ProfileRow | null;

      if (b) {
        barberia = {
          id: b.id_barberia ?? idBarberia,
          nombre: b.nombre ?? '',
          direccion: b.direccion ?? null,
          telefono: b.telefono ?? null,
        };
      }
    }

    return {
      id: user.profileId,
      nombre: row[config.nameColumn] ?? '',
      usuario: row.usuario ?? email ?? '',
      email,
      telefono: row.telefono ?? null,
      role: user.role,
      foto: await getSignedStorageUrl(row.foto_perfil),
      createdAt: row.created_at ?? null,
      idBarberia,
      debeCambiarContrasena: perfil?.debe_cambiar_contrasena === true,
      terminosPendientes: !perfil?.terminos_aceptados_at,
      barberia,
    };
  }

  /**
   * Cambia la contraseña conociendo la actual. También es el paso obligatorio
   * del primer ingreso de una cuenta creada por un administrador: ahí además
   * se acepta la política de tratamiento de datos.
   */
  async changePassword(user: AuthUser, dto: ChangePasswordDto) {
    const current = requireText(
      dto.currentPassword,
      'Ingresa tu contraseña actual',
      72,
    );
    const next = validatePassword(dto.newPassword);

    if (current === next) {
      throw new BadRequestException(
        'La nueva contraseña debe ser distinta a la actual',
      );
    }

    if (!user.email) {
      throw new BadRequestException('La cuenta no tiene un correo asociado');
    }

    const { data: perfilData } = await supabaseAdmin
      .from('perfil')
      .select('terminos_aceptados_at')
      .eq('user_id', user.userId)
      .maybeSingle();
    const termsPending = !(
      perfilData as unknown as { terminos_aceptados_at?: string } | null
    )?.terminos_aceptados_at;

    if (termsPending) {
      requireTerms(dto.aceptaTerminos);
    }

    const { error: errLogin } =
      await createAnonClient().auth.signInWithPassword({
        email: user.email,
        password: current,
      });

    if (errLogin) {
      throw new UnauthorizedException('La contraseña actual es incorrecta');
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(
      user.userId,
      { password: next },
    );

    if (error) {
      throw error.code === 'same_password'
        ? new BadRequestException(
            'La nueva contraseña debe ser distinta a la actual',
          )
        : new InternalServerErrorException(
            'No fue posible cambiar la contraseña',
          );
    }

    const changes: Record<string, unknown> = { debe_cambiar_contrasena: false };
    if (termsPending) {
      changes.terminos_aceptados_at = new Date().toISOString();
      changes.version_terminos = TERMS_VERSION;
    }

    const { error: errPerfil } = await supabaseAdmin
      .from('perfil')
      .update(changes)
      .eq('user_id', user.userId);

    if (errPerfil) {
      throw new InternalServerErrorException(errPerfil.message);
    }

    // Cierra las demás sesiones (otros dispositivos), pero no esta.
    const { error: errSignOut } = await supabaseAdmin.auth.admin.signOut(
      user.accessToken,
      'others',
    );
    if (errSignOut) {
      this.logger.warn(
        `No se pudieron cerrar otras sesiones: ${errSignOut.message}`,
      );
    }

    await this.accounts.audit({
      userId: user.userId,
      role: user.role,
      entity: ROLE_CONFIG[user.role].table,
      entityId: user.profileId,
      action: 'cambiar_contrasena',
      details: {},
      idBarberia: user.idBarberia,
    });

    return {
      message: 'Contraseña actualizada',
      profile: await this.me({ ...user, mustChangePassword: false }),
    };
  }

  async updateMe(user: AuthUser, dto: UpdateProfileDto) {
    const config = ROLE_CONFIG[user.role];
    const changes: Record<string, string | null> = {};

    if (dto.nombre !== undefined) {
      changes[config.nameColumn] = requireText(
        dto.nombre,
        'El nombre es obligatorio',
      );
    }

    if (dto.telefono !== undefined) {
      changes.telefono = normalizePhone(dto.telefono);
    }

    let newEmail: string | null = null;
    if (dto.email !== undefined) {
      newEmail = normalizeEmail(dto.email);
      if (newEmail !== user.email) {
        await this.accounts.ensureEmailIsFree(newEmail, user.userId);
      } else {
        newEmail = null;
      }
    }

    if (Object.keys(changes).length === 0 && !newEmail) {
      throw new BadRequestException('No hay cambios para guardar');
    }

    // El correo vive en Auth (y en cliente/barbero): se cambia primero en Auth.
    if (newEmail) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(
        user.userId,
        { email: newEmail, email_confirm: true },
      );

      if (error) {
        throw this.accounts.authError(
          error,
          'No fue posible cambiar el correo',
        );
      }

      if (user.role !== 'admin') {
        changes.email = newEmail;
      }
    }

    if (Object.keys(changes).length > 0) {
      const { error } = await supabaseAdmin
        .from(config.table)
        .update(changes)
        .eq(config.idColumn, user.profileId);

      if (error) {
        if (newEmail && user.email) {
          await supabaseAdmin.auth.admin.updateUserById(user.userId, {
            email: user.email,
            email_confirm: true,
          });
        }
        throw new InternalServerErrorException(error.message);
      }
    }

    await this.accounts.audit({
      userId: user.userId,
      role: user.role,
      entity: config.table,
      entityId: user.profileId,
      action: 'actualizar_perfil',
      details: {
        campos: [...Object.keys(changes), ...(newEmail ? ['email'] : [])],
      },
      idBarberia: user.idBarberia,
    });

    return {
      message: 'Perfil actualizado',
      profile: await this.me({
        ...user,
        email: newEmail ?? user.email,
      }),
    };
  }

  async uploadMyPhoto(user: AuthUser, file?: UploadedFile) {
    if (!file?.buffer) {
      throw new BadRequestException('No se recibió ninguna imagen');
    }

    if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        'Formato no permitido. Usa JPG, PNG o WEBP',
      );
    }

    if (file.buffer.length > MAX_IMAGE_BYTES) {
      throw new BadRequestException('La imagen no puede superar 5 MB');
    }

    const config = ROLE_CONFIG[user.role];
    const extension = IMAGE_EXTENSIONS[file.mimetype] ?? 'jpg';
    const path = `${config.folder}/${user.profileId}-${Date.now()}.${extension}`;

    const { data: previous } = await supabaseAdmin
      .from(config.table)
      .select('foto_perfil')
      .eq(config.idColumn, user.profileId)
      .maybeSingle();

    const url = await uploadProfilePhoto(config.bucket, path, file);

    const { error } = await supabaseAdmin
      .from(config.table)
      .update({ foto_perfil: url })
      .eq(config.idColumn, user.profileId);

    if (error) {
      await removeStoredFile(url);
      throw new InternalServerErrorException(error.message);
    }

    await removeStoredFile(
      (previous as unknown as ProfileRow | null)?.foto_perfil,
    );

    return { url: (await getSignedStorageUrl(url)) ?? url };
  }

  // ---------------------------------------------------------------------
  // Eliminar cuenta (HU-04)
  //
  // Política de datos asociados:
  //  - Cliente: se cancelan sus citas futuras y se anonimiza su fila (se
  //    conservan las citas pasadas y calificaciones para el historial y los
  //    reportes de la barbería, sin datos personales).
  //  - Barbero: no puede eliminarse con citas próximas; se desactiva y se
  //    anonimiza igual que el cliente.
  //  - Administrador: no puede eliminarse si es el único de su barbería.
  // ---------------------------------------------------------------------

  async deleteMe(user: AuthUser, dto: DeleteAccountDto) {
    const password = requireText(dto.password, 'Confirma tu contraseña', 72);

    if (!user.email) {
      throw new BadRequestException('La cuenta no tiene un correo asociado');
    }

    const { error: errLogin } =
      await createAnonClient().auth.signInWithPassword({
        email: user.email,
        password,
      });

    if (errLogin) {
      throw new UnauthorizedException('La contraseña es incorrecta');
    }

    const config = ROLE_CONFIG[user.role];

    const { data: previous } = await supabaseAdmin
      .from(config.table)
      .select('foto_perfil')
      .eq(config.idColumn, user.profileId)
      .maybeSingle();
    const photoUrl =
      (previous as unknown as ProfileRow | null)?.foto_perfil ?? null;

    if (user.role === 'admin') {
      await this.ensureNotOnlyAdmin(user);
    } else {
      await this.cancelOrBlockUpcomingCitas(user);
      await this.anonymizeAccount(user);
    }

    await this.accounts.audit({
      userId: user.userId,
      role: user.role,
      entity: config.table,
      entityId: user.profileId,
      action: 'eliminar_cuenta',
      details: {},
      idBarberia: user.idBarberia,
    });

    // Borra la cuenta de Auth: elimina perfil, dispositivos y notificaciones en
    // cascada, y deja user_id en NULL en cliente/barbero.
    const { error } = await supabaseAdmin.auth.admin.deleteUser(user.userId);
    if (error) {
      throw this.accounts.authError(error, 'No fue posible eliminar la cuenta');
    }

    await removeStoredFile(photoUrl);

    return { message: 'Tu cuenta fue eliminada' };
  }

  // ---------------------------------------------------------------------
  // Utilidades internas
  // ---------------------------------------------------------------------

  private async ensureNotOnlyAdmin(user: AuthUser) {
    const { count, error } = await supabaseAdmin
      .from('administrador')
      .select('id_administrador', { count: 'exact', head: true })
      .eq('id_barberia', user.idBarberia ?? '');

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    if ((count ?? 0) <= 1) {
      throw new ConflictException(
        'Eres el único administrador de tu barbería. Agrega a otro administrador antes de eliminar tu cuenta.',
      );
    }
  }

  private async cancelOrBlockUpcomingCitas(user: AuthUser) {
    const column = user.role === 'barbero' ? 'id_barbero' : 'id_cliente';
    const now = new Date().toISOString();

    if (user.role === 'barbero') {
      const { count, error } = await supabaseAdmin
        .from('cita')
        .select('id_cita', { count: 'exact', head: true })
        .eq(column, user.profileId)
        .in('estado', ['pendiente', 'confirmada'])
        .gt('fin_at', now);

      if (error) {
        throw new InternalServerErrorException(error.message);
      }

      if ((count ?? 0) > 0) {
        throw new ConflictException(
          'Tienes citas próximas. Reprográmalas o cancélalas antes de eliminar tu cuenta.',
        );
      }
      return;
    }

    const { error } = await supabaseAdmin
      .from('cita')
      .update({ estado: 'cancelada' })
      .eq(column, user.profileId)
      .in('estado', ['pendiente', 'confirmada'])
      .gt('fin_at', now);

    if (error) {
      throw new InternalServerErrorException(error.message);
    }
  }

  private async anonymizeAccount(user: AuthUser) {
    const config = ROLE_CONFIG[user.role];
    const suffix = user.profileId.slice(0, 8);

    const changes: Record<string, unknown> = {
      [config.nameColumn]:
        user.role === 'cliente' ? 'Cliente eliminado' : 'Barbero eliminado',
      usuario: `eliminado_${suffix}`,
      email: null,
      telefono: null,
      foto_perfil: null,
    };

    if (user.role === 'barbero') {
      changes.activo = false;
    }

    const { error } = await supabaseAdmin
      .from(config.table)
      .update(changes)
      .eq(config.idColumn, user.profileId);

    if (error) {
      throw new InternalServerErrorException(error.message);
    }
  }

  private async ensureBarberiaNameIsFree(nombre: string) {
    const { data, error } = await supabaseAdmin
      .from('barberia')
      .select('id_barberia')
      .ilike('nombre', escapeLike(nombre))
      .limit(1);

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    if (data && data.length > 0) {
      throw new ConflictException('Ya existe una barbería con ese nombre');
    }
  }

  /** Deshace un registro a medias para no dejar cuentas huérfanas. */
  private async cleanupAccount(userId: string, barberiaId?: string | null) {
    try {
      await supabaseAdmin.from('cliente').delete().eq('user_id', userId);
      await supabaseAdmin.from('administrador').delete().eq('user_id', userId);
      if (barberiaId) {
        await supabaseAdmin
          .from('barberia')
          .delete()
          .eq('id_barberia', barberiaId);
      }
      await supabaseAdmin.from('perfil').delete().eq('user_id', userId);
      await supabaseAdmin.auth.admin.deleteUser(userId);
    } catch (error) {
      this.logger.error(
        `No se pudo limpiar el registro fallido de ${userId}: ${String(error)}`,
      );
    }
  }
}
