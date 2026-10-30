import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth-user';
import { CurrentUser, Roles } from '../common/auth/decorators';
import { ClienteService } from './cliente.service';
import type { CrearCitaDto, DisponibilidadQuery } from './cliente.types';

/** Todo lo de este controlador es solo para clientes. */
@Controller('cliente')
@Roles('cliente')
export class ClienteController {
  constructor(private readonly clienteService: ClienteService) {}

  @Get('barberias')
  barberias() {
    return this.clienteService.listBarberias();
  }

  @Get('barberias/:id/barberos')
  barberos(@Param('id') id: string) {
    return this.clienteService.listBarberos(id);
  }

  @Get('barberos/:id')
  barbero(@Param('id') id: string) {
    return this.clienteService.getBarbero(id);
  }

  @Get('barberos/:id/procedimientos')
  procedimientos(@Param('id') id: string) {
    return this.clienteService.listProcedimientos(id);
  }

  @Get('barberos/:id/disponibilidad')
  disponibilidad(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: DisponibilidadQuery,
  ) {
    return this.clienteService.getDisponibilidad(user, id, query);
  }

  @Post('citas')
  crearCita(@CurrentUser() user: AuthUser, @Body() dto: CrearCitaDto) {
    return this.clienteService.crearCita(user, dto);
  }
}
