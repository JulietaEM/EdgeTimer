import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import type { AuthUser } from '../common/auth/auth-user';
import { CurrentUser, Public, Roles } from '../common/auth/decorators';
import { PagosService } from './pagos.service';

/** Los pagos del flujo WebCheckout se crean únicamente desde la cuenta cliente. */
@Controller('pagos')
@Roles('cliente')
export class PagosController {
  private readonly logger = new Logger(PagosController.name);

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
  async confirmar(@Body() payload: Record<string, unknown>) {
    this.logger.log('PayU confirmation received');
    try {
      const result = await this.pagosService.confirmar(payload);
      this.logger.log('PayU confirmation processed');
      return result;
    } catch (error) {
      const category =
        error instanceof BadRequestException
          ? this.badRequestCategory(error.message)
          : error instanceof NotFoundException
            ? 'payment_reference_not_found'
            : error instanceof ConflictException
              ? 'payment_state_conflict'
              : error instanceof HttpException && error.getStatus() === 503
                ? 'payu_query_unavailable'
                : error instanceof InternalServerErrorException
                  ? 'database_or_server_error'
                  : 'unexpected_error';
      this.logger.warn(`PayU confirmation rejected: ${category}`);
      throw error;
    }
  }

  @Get('citas/:idCita')
  estadoCita(@CurrentUser() user: AuthUser, @Param('idCita') idCita: string) {
    return this.pagosService.estadoCita(user, idCita);
  }

  private badRequestCategory(message: string) {
    if (message === 'Notificación PayU incompleta')
      return 'callback_incomplete';
    if (message === 'El comercio de la notificación no coincide con PayU')
      return 'merchant_mismatch';
    if (message === 'Firma de notificación inválida')
      return 'invalid_signature';
    if (message === 'Monto o moneda no coincide con el pago') {
      return 'amount_or_currency_mismatch';
    }
    if (message === 'La consulta de PayU no coincide con la notificación') {
      return 'query_data_mismatch';
    }
    if (message === 'PayU no reporta la orden como capturada') {
      return 'provider_order_not_captured';
    }
    if (message === 'PayU no encontró la orden')
      return 'provider_order_not_found';
    return 'invalid_provider_data';
  }
}
