import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, Public } from '../common/auth/decorators';
import type { AuthUser } from '../common/auth/auth-user';
import { NotificacionesService } from './notificaciones.service';
import type {
  BajaSuscripcionDto,
  SuscripcionDto,
} from './notificaciones.types';

@Controller('notificaciones')
export class NotificacionesController {
  constructor(private readonly notificaciones: NotificacionesService) {}

  @Get('config')
  config() {
    return this.notificaciones.getConfig();
  }

  @Get()
  listar(@CurrentUser() user: AuthUser, @Query('limite') limite?: string) {
    return this.notificaciones.listar(user, limite);
  }

  @Post('suscripcion')
  suscribir(
    @CurrentUser() user: AuthUser,
    @Body() dto: SuscripcionDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.notificaciones.suscribir(user, dto, userAgent);
  }

  @Post('suscripcion/baja')
  @HttpCode(200)
  desuscribir(@CurrentUser() user: AuthUser, @Body() dto: BajaSuscripcionDto) {
    return this.notificaciones.desuscribir(user, dto);
  }

  @Post('leer-todas')
  @HttpCode(200)
  leerTodas(@CurrentUser() user: AuthUser) {
    return this.notificaciones.marcarTodasLeidas(user);
  }

  @Patch(':id/leer')
  leer(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notificaciones.marcarLeida(user, id);
  }

  /**
   * La llama el job programado de Supabase (pg_cron) con el secreto compartido.
   * No lleva token de usuario: se protege con el encabezado x-cron-secret.
   */
  @Public()
  @Post('recordatorios')
  @HttpCode(200)
  async recordatorios(@Headers('x-cron-secret') secret?: string) {
    this.notificaciones.assertCronSecret(secret);
    return this.notificaciones.enviarRecordatorios();
  }
}
