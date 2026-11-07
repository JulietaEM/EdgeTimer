import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth-user';
import { CurrentUser, Public, Roles } from '../common/auth/decorators';
import { PagosService } from './pagos.service';

/** Los pagos del flujo WebCheckout se crean únicamente desde la cuenta cliente. */
@Controller('pagos')
@Roles('cliente')
export class PagosController {
  constructor(private readonly pagosService: PagosService) {}

  @Post('citas/:idCita/checkout')
  crearCheckout(
    @CurrentUser() user: AuthUser,
    @Param('idCita') idCita: string,
  ) {
    return this.pagosService.crearCheckout(user, idCita);
  }

  @Post('confirmacion')
  @Public()
  @Roles()
  @HttpCode(200)
  confirmar(@Body() payload: Record<string, unknown>) {
    return this.pagosService.confirmar(payload);
  }

  @Get('citas/:idCita')
  estadoCita(@CurrentUser() user: AuthUser, @Param('idCita') idCita: string) {
    return this.pagosService.estadoCita(user, idCita);
  }
}
