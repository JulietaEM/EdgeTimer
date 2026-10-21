import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Put,
  Query,
} from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth-user';
import { CurrentUser, Roles } from '../common/auth/decorators';
import { BarberoService } from './barbero.service';
import type {
  CitasQuery,
  DisponibilidadDto,
  MotivoDto,
  ReprogramarDto,
} from './barbero.types';

/** Todo lo de este controlador es solo para barberos y de sus propias citas. */
@Controller('barbero')
@Roles('barbero')
export class BarberoController {
  constructor(private readonly barberoService: BarberoService) {}

  @Get('resumen')
  resumen(@CurrentUser() user: AuthUser) {
    return this.barberoService.resumen(user);
  }

  @Get('disponibilidad')
  getDisponibilidad(@CurrentUser() user: AuthUser) {
    return this.barberoService.getDisponibilidad(user);
  }

  @Put('disponibilidad')
  setDisponibilidad(
    @CurrentUser() user: AuthUser,
    @Body() dto: DisponibilidadDto,
  ) {
    return this.barberoService.setDisponibilidad(user, dto);
  }

  @Get('citas')
  listCitas(@CurrentUser() user: AuthUser, @Query() query: CitasQuery) {
    return this.barberoService.listCitas(user, query);
  }

  @Patch('citas/:id/aceptar')
  aceptar(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.barberoService.aceptar(user, id);
  }

  @Patch('citas/:id/rechazar')
  rechazar(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: MotivoDto,
  ) {
    return this.barberoService.rechazar(user, id, dto);
  }

  @Patch('citas/:id/cancelar')
  cancelar(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: MotivoDto,
  ) {
    return this.barberoService.cancelar(user, id, dto);
  }

  @Patch('citas/:id/reprogramar')
  reprogramar(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ReprogramarDto,
  ) {
    return this.barberoService.reprogramar(user, id, dto);
  }
}
