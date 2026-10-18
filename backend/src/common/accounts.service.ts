import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import type { UserRole } from '../auth/auth.types';
import { TERMS_VERSION, buildUsernameBase } from '../auth/auth.validation';
import { supabaseAdmin } from '../supabase';

/**
 * Operaciones sobre cuentas que comparten el registro de clientes/barberías
 * (AuthService) y el alta de barberos por parte del administrador (AdminService).
 */
@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  /** El correo no puede estar en las tablas cliente/barbero (Auth lo valida al crear). */
  async ensureEmailIsFree(email: string, exceptUserId?: string) {
    for (const table of ['cliente', 'barbero'] as const) {
      let query = supabaseAdmin
        .from(table)
        .select('user_id')
        .eq('email', email)
        .limit(1);

      if (exceptUserId) {
        query = query.neq('user_id', exceptUserId);
      }

      const { data, error } = await query;

      if (error) {
        throw new InternalServerErrorException(error.message);
      }

      if (data && data.length > 0) {
        throw new ConflictException('Este email ya está registrado');
      }
    }
  }

  async createAuthUser(
    email: string,
    password: string,
    metadata: Record<string, unknown>,
  ) {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: metadata,
    });

    if (error || !data.user) {
      throw this.authError(error, 'No fue posible crear la cuenta');
    }

    return data.user.id;
  }

  /**
   * Crea el perfil con su rol. Las cuentas que crea un administrador (barberos)
   * nacen sin la política aceptada y con la contraseña temporal por cambiar.
   */
  async insertPerfil(
    userId: string,
    role: UserRole,
    options: { acceptedTerms?: boolean; mustChangePassword?: boolean } = {},
  ) {
    const { acceptedTerms = true, mustChangePassword = false } = options;

    const { error } = await supabaseAdmin.from('perfil').insert({
      user_id: userId,
      rol: role,
      terminos_aceptados_at: acceptedTerms ? new Date().toISOString() : null,
      version_terminos: acceptedTerms ? TERMS_VERSION : null,
      debe_cambiar_contrasena: mustChangePassword,
    });

    if (error) {
      throw new InternalServerErrorException(error.message);
    }
  }

  async generateUsername(email: string) {
    const base = buildUsernameBase(email);
    let candidate = base;

    for (let attempt = 1; attempt <= 50; attempt += 1) {
      const [{ data: clientes }, { data: barberos }] = await Promise.all([
        supabaseAdmin
          .from('cliente')
          .select('id_cliente')
          .eq('usuario', candidate)
          .limit(1),
        supabaseAdmin
          .from('barbero')
          .select('id_barbero')
          .eq('usuario', candidate)
          .limit(1),
      ]);

      if (!clientes?.length && !barberos?.length) {
        return candidate;
      }

      candidate = `${base.slice(0, 48)}_${attempt}`;
    }

    return `${base.slice(0, 40)}_${Date.now().toString(36)}`;
  }

  authError(
    error: { message?: string; code?: string; status?: number } | null,
    fallback: string,
  ) {
    const message = error?.message ?? '';

    if (
      error?.code === 'email_exists' ||
      error?.code === 'user_already_exists' ||
      /already|registered|exists/i.test(message)
    ) {
      return new ConflictException('Este email ya está registrado');
    }

    return new InternalServerErrorException(message || fallback);
  }

  /** RNF-08: deja rastro de acciones críticas. Nunca interrumpe la operación. */
  async audit(entry: {
    userId: string;
    role: UserRole;
    entity: string;
    entityId: string;
    action: string;
    details: Record<string, unknown>;
    idBarberia: string | null;
  }) {
    const { error } = await supabaseAdmin.from('auditoria_accion').insert({
      user_id: entry.userId,
      rol: entry.role,
      entidad: entry.entity,
      entidad_id: entry.entityId,
      accion: entry.action,
      detalles: entry.details,
      id_barberia: entry.idBarberia,
    });

    if (error) {
      this.logger.warn(`No se pudo registrar la auditoría: ${error.message}`);
    }
  }
}
