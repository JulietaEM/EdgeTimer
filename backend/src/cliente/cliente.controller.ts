import { Controller, Get, Param } from '@nestjs/common';
import { Roles } from '../common/auth/decorators';
import { ClienteService } from './cliente.service';

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
}
