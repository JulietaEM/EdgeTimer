import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { isUuid } from '../admin/admin.utils';
import type { AuthUser } from '../common/auth/auth-user';
import { supabaseAdmin } from '../supabase';

type EstadoPago =
  | 'pendiente'
  | 'aprobado'
  | 'rechazado'
  | 'expirado'
  | 'error'
  | 'anulado';

interface CitaPagoRow {
  id_cita: string;
  id_cliente: string;
  estado: string;
  cita_procedimiento?: { precio_aplicado: string | number }[];
}

interface PagoRow {
  id_pago: string;
  id_cita: string;
  referencia: string;
  monto: string | number;
  moneda: string;
  estado: EstadoPago;
}

interface PayUConfig {
  merchantId: string;
  accountId: string;
  apiKey: string;
  checkoutUrl: string;
  confirmationUrl: string;
  responseUrl: string;
  apiLogin: string;
  queryUrl: string;
}

const PAYMENT_FIELDS = 'id_pago, id_cita, referencia, monto, moneda, estado';
const SANDBOX_CHECKOUT_URL =
  'https://sandbox.checkout.payulatam.com/ppp-web-gateway-payu/';
const SANDBOX_QUERY_URL =
  'https://sandbox.api.payulatam.com/reports-api/4.0/service.cgi';

interface ConfirmacionPayU {
  merchant_id?: string;
  reference_sale?: string;
  value?: string;
  currency?: string;
  state_pol?: string;
  sign?: string;
  transaction_id?: string;
  test?: string;
  [key: string]: unknown;
}

@Injectable()
export class PagosService {
  async estadoCita(user: AuthUser, idCita: string) {
    if (!isUuid(idCita) || user.role !== 'cliente') {
      throw new NotFoundException('No se encontró la cita');
    }
    const { data: citaRaw, error: citaError } = await supabaseAdmin
      .from('cita')
      .select('id_cita, id_cliente')
      .eq('id_cita', idCita)
      .maybeSingle();
    if (citaError) throw new InternalServerErrorException(citaError.message);
    const cita = citaRaw as { id_cliente: string } | null;
    if (!cita || cita.id_cliente !== user.profileId) {
      throw new NotFoundException('No se encontró la cita');
    }
    const { data, error } = await supabaseAdmin
      .from('pago')
      .select(PAYMENT_FIELDS)
      .eq('id_cita', idCita)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    const pago = data as (PagoRow & { created_at?: string }) | null;
    return {
      pago: pago
        ? {
            id: pago.id_pago,
            referencia: pago.referencia,
            monto: Number(pago.monto).toFixed(2),
            moneda: pago.moneda,
            estado: pago.estado,
          }
        : null,
    };
  }

  async confirmar(payload: ConfirmacionPayU) {
    const config = this.getConfig();
    const required = [
      'merchant_id',
      'reference_sale',
      'value',
      'currency',
      'state_pol',
      'sign',
      'transaction_id',
      'test',
    ];
    if (
      required.some((key) => typeof payload[key] !== 'string' || !payload[key])
    ) {
      throw new BadRequestException('Notificación PayU incompleta');
    }
    if (payload.merchant_id !== config.merchantId) {
      throw new BadRequestException(
        'El comercio de la notificación no coincide con PayU',
      );
    }
    if (!this.validarFirma(payload, config.apiKey)) {
      throw new BadRequestException('Firma de notificación inválida');
    }
    const { data: raw, error } = await supabaseAdmin
      .from('pago')
      .select('id_pago,id_cita,referencia,monto,moneda,estado')
      .eq('referencia', payload.reference_sale!)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    const pago = raw as
      | (PagoRow & { id_transaccion_proveedor?: string })
      | null;
    if (!pago) throw new NotFoundException('No existe la referencia de pago');
    if (
      payload.currency !== pago.moneda ||
      payload.currency !== 'COP' ||
      this.toMinorUnits(payload.value!) !==
        this.toMinorUnits(String(pago.monto))
    ) {
      throw new BadRequestException('Monto o moneda no coincide con el pago');
    }

    const orden = await this.consultarOrden(pago.referencia, config);
    const tx = orden.transactions?.find(
      (item: any) => String(item.id) === payload.transaction_id,
    );
    const txValue =
      tx?.additionalValues?.TX_VALUE ?? orden.additionalValues?.TX_VALUE;
    const queryState = tx?.transactionResponse?.state;
    if (
      orden.referenceCode !== pago.referencia ||
      String(orden.merchantId) !== config.merchantId ||
      String(orden.accountId) !== config.accountId ||
      // La API sandbox de PayU confirma el modo de la orden; el campo `test`
      // de la notificación puede llegar con una representación distinta.
      orden.isTest !== true ||
      !tx ||
      !txValue ||
      txValue.currency !== pago.moneda ||
      this.toMinorUnits(String(txValue.value)) !==
        this.toMinorUnits(String(pago.monto)) ||
      queryState !== this.estadoProveedor(payload.state_pol!)
    )
      throw new BadRequestException(
        'La consulta de PayU no coincide con la notificación',
      );
    if (payload.state_pol === '4' && orden.status !== 'CAPTURED') {
      throw new BadRequestException('PayU no reporta la orden como capturada');
    }

    const estado = this.mapEstado(payload.state_pol!);
    if (pago.estado === 'aprobado') return { recibido: true };
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('pago')
      .update({
        estado,
        id_transaccion_proveedor: payload.transaction_id,
        respuesta_proveedor: { notificacion: payload, consulta: orden },
        aprobado_at: estado === 'aprobado' ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id_pago', pago.id_pago)
      .neq('estado', 'aprobado')
      .select('id_pago')
      .maybeSingle();
    if (updateError) {
      if (updateError.code === '23505') return { recibido: true };
      throw new InternalServerErrorException(updateError.message);
    }
    if (!updated) {
      const { data: latest } = await supabaseAdmin
        .from('pago')
        .select('estado')
        .eq('id_pago', pago.id_pago)
        .maybeSingle();
      if ((latest as { estado?: string } | null)?.estado !== 'aprobado')
        throw new ConflictException('No se pudo actualizar el pago');
    }
    return { recibido: true };
  }

  private validarFirma(p: ConfirmacionPayU, apiKey: string) {
    const rawValue = Number(p.value);
    if (!Number.isFinite(rawValue)) return false;
    const rounded = rawValue.toFixed(
      rawValue % 1 === 0 || Math.round(rawValue * 100) % 10 === 0 ? 1 : 2,
    );
    const source = [
      apiKey,
      p.merchant_id,
      p.reference_sale,
      rounded,
      p.currency,
      p.state_pol,
    ].join('~');
    const algo = (
      process.env.PAYU_SIGNATURE_ALGORITHM || 'HMAC-SHA256'
    ).toUpperCase();
    const hash =
      algo === 'MD5'
        ? createHash('md5').update(source).digest('hex')
        : algo === 'SHA1'
          ? createHash('sha1').update(source).digest('hex')
          : algo === 'SHA256'
            ? createHash('sha256').update(source).digest('hex')
            : algo === 'HMAC-SHA256'
              ? createHmac(
                  'sha256',
                  process.env.PAYU_SIGNATURE_HMAC_KEY || apiKey,
                )
                  .update(source)
                  .digest('hex')
              : '';
    if (!hash || !/^[a-f\d]+$/i.test(p.sign!)) return false;
    const expected = Buffer.from(hash, 'hex');
    const supplied = Buffer.from(p.sign!, 'hex');
    return (
      expected.length === supplied.length && timingSafeEqual(expected, supplied)
    );
  }

  private toMinorUnits(value: string) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n * 100) : -1;
  }

  private mapEstado(state: string): EstadoPago {
    return (
      (
        {
          '4': 'aprobado',
          '6': 'rechazado',
          '5': 'expirado',
          '104': 'error',
          '7': 'pendiente',
          '8': 'pendiente',
          '9': 'pendiente',
          '10': 'pendiente',
          '12': 'pendiente',
          '14': 'pendiente',
          '15': 'pendiente',
          '17': 'pendiente',
        } as Record<string, EstadoPago>
      )[state] ?? 'error'
    );
  }

  private estadoProveedor(state: string) {
    return (
      (
        {
          '4': 'APPROVED',
          '6': 'DECLINED',
          '5': 'EXPIRED',
          '104': 'ERROR',
          '7': 'PENDING',
          '8': 'PENDING',
          '9': 'PENDING',
          '10': 'PENDING',
          '12': 'PENDING',
          '14': 'PENDING',
          '15': 'PENDING',
          '17': 'PENDING',
        } as Record<string, string>
      )[state] ?? 'ERROR'
    );
  }

  private async consultarOrden(
    reference: string,
    config: PayUConfig,
  ): Promise<any> {
    let response: Response;
    try {
      response = await fetch(config.queryUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({
          test: false,
          language: 'es',
          command: 'ORDER_DETAIL_BY_REFERENCE_CODE',
          merchant: { apiLogin: config.apiLogin, apiKey: config.apiKey },
          details: { referenceCode: reference },
        }),
      });
    } catch {
      throw new HttpException('No se pudo consultar PayU', 503);
    }
    if (!response.ok)
      throw new HttpException('PayU no respondió correctamente', 503);
    const result: any = await response.json();
    const order = result?.result?.payload?.[0];
    if (!order) throw new BadRequestException('PayU no encontró la orden');
    return order;
  }

  async crearCheckout(user: AuthUser, idCita: string) {
    if (!isUuid(idCita)) {
      throw new BadRequestException('El id de la cita no es válido');
    }

    if (user.role !== 'cliente') {
      throw new NotFoundException('No se encontró la cita');
    }

    const config = this.getConfig();
    const { data: rawCita, error: errorCita } = await supabaseAdmin
      .from('cita')
      .select(
        'id_cita, id_cliente, estado, cita_procedimiento(precio_aplicado)',
      )
      .eq('id_cita', idCita)
      .maybeSingle();

    if (errorCita) {
      throw new InternalServerErrorException(errorCita.message);
    }

    const cita = rawCita as unknown as CitaPagoRow | null;
    if (!cita || cita.id_cliente !== user.profileId) {
      throw new NotFoundException('No se encontró la cita');
    }
    if (cita.estado !== 'confirmada') {
      throw new ConflictException(
        'Solo se pueden pagar citas confirmadas por el barbero',
      );
    }

    const monto = this.calcularMonto(cita.cita_procedimiento ?? []);
    const { data: pagoActivoRaw, error: errorPagoActivo } = await supabaseAdmin
      .from('pago')
      .select(PAYMENT_FIELDS)
      .eq('id_cita', idCita)
      .in('estado', ['pendiente', 'aprobado'])
      .maybeSingle();

    if (errorPagoActivo) {
      throw new InternalServerErrorException(errorPagoActivo.message);
    }

    const pagoActivo = pagoActivoRaw as unknown as PagoRow | null;
    if (pagoActivo?.estado === 'aprobado') {
      throw new ConflictException('Esta cita ya tiene un pago aprobado');
    }
    if (pagoActivo?.estado === 'pendiente') {
      if (Number(pagoActivo.monto).toFixed(2) !== monto) {
        throw new ConflictException(
          'El valor de la cita cambió; solicita una nueva confirmación',
        );
      }
      return this.toCheckout(pagoActivo, user, config);
    }

    const referencia = `ET-${idCita}-${randomUUID()}`;
    const { data: pagoCreadoRaw, error: errorInsert } = await supabaseAdmin
      .from('pago')
      .insert({
        id_cita: idCita,
        proveedor: 'payu',
        referencia,
        monto,
        moneda: 'COP',
        estado: 'pendiente',
      })
      .select(PAYMENT_FIELDS)
      .single();

    if (errorInsert) {
      // El índice parcial en la base arbitra solicitudes simultáneas. Si otra
      // petición creó el pago primero, se devuelve ese mismo formulario.
      if (errorInsert.code === '23505') {
        return this.leerPagoConcurrente(idCita, user, config);
      }
      throw new InternalServerErrorException(errorInsert.message);
    }

    if (!pagoCreadoRaw) {
      throw new InternalServerErrorException('No se pudo crear el pago');
    }

    return this.toCheckout(pagoCreadoRaw as unknown as PagoRow, user, config);
  }

  private calcularMonto(items: { precio_aplicado: string | number }[]) {
    if (items.length === 0) {
      throw new BadRequestException('La cita no tiene procedimientos válidos');
    }

    const amount = items.reduce((total, item) => {
      const price = Number(item.precio_aplicado);
      if (!Number.isFinite(price) || price < 0) {
        throw new BadRequestException('El precio de la cita no es válido');
      }
      return total + Math.round(price * 100);
    }, 0);

    if (amount <= 0) {
      throw new BadRequestException(
        'El total de la cita debe ser mayor a cero',
      );
    }

    return (amount / 100).toFixed(2);
  }

  private async leerPagoConcurrente(
    idCita: string,
    user: AuthUser,
    config: PayUConfig,
  ) {
    const { data, error } = await supabaseAdmin
      .from('pago')
      .select(PAYMENT_FIELDS)
      .eq('id_cita', idCita)
      .in('estado', ['pendiente', 'aprobado'])
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    const pago = data as unknown as PagoRow | null;
    if (pago?.estado === 'aprobado') {
      throw new ConflictException('Esta cita ya tiene un pago aprobado');
    }
    if (pago?.estado === 'pendiente') {
      const { data: rawCita, error: errorCita } = await supabaseAdmin
        .from('cita')
        .select('cita_procedimiento(precio_aplicado)')
        .eq('id_cita', idCita)
        .maybeSingle();
      if (errorCita) {
        throw new InternalServerErrorException(errorCita.message);
      }
      const cita = rawCita as unknown as {
        cita_procedimiento?: { precio_aplicado: string | number }[];
      } | null;
      const montoActual = this.calcularMonto(cita?.cita_procedimiento ?? []);
      if (Number(pago.monto).toFixed(2) !== montoActual) {
        throw new ConflictException(
          'El valor de la cita cambió; solicita una nueva confirmación',
        );
      }
      return this.toCheckout(pago, user, config);
    }

    throw new ConflictException('Ya hay un intento de pago en proceso');
  }

  private toCheckout(pago: PagoRow, user: AuthUser, config: PayUConfig) {
    const amount = Number(pago.monto).toFixed(2);
    const base = [
      config.apiKey,
      config.merchantId,
      pago.referencia,
      amount,
      pago.moneda,
    ].join('~');
    const signature = createHash('sha256').update(base, 'utf8').digest('hex');

    return {
      pago: {
        id: pago.id_pago,
        referencia: pago.referencia,
        monto: amount,
        moneda: pago.moneda,
        estado: pago.estado,
      },
      checkout: {
        action: config.checkoutUrl,
        method: 'POST' as const,
        fields: {
          merchantId: config.merchantId,
          accountId: config.accountId,
          description: `Pago cita ${pago.id_cita}`,
          referenceCode: pago.referencia,
          amount,
          tax: '0',
          taxReturnBase: '0',
          currency: pago.moneda,
          algorithmSignature: 'SHA256',
          signature,
          test: '1',
          buyerEmail: user.email ?? '',
          payerFullName: user.nombre,
          confirmationUrl: config.confirmationUrl,
          responseUrl: config.responseUrl,
        },
      },
    };
  }

  private getConfig(): PayUConfig {
    const config: PayUConfig = {
      merchantId: process.env.PAYU_MERCHANT_ID ?? '',
      accountId: process.env.PAYU_ACCOUNT_ID_CO ?? '',
      apiKey: process.env.PAYU_API_KEY ?? '',
      checkoutUrl: process.env.PAYU_CHECKOUT_URL || SANDBOX_CHECKOUT_URL,
      confirmationUrl: process.env.PAYU_CONFIRMATION_URL ?? '',
      responseUrl: process.env.PAYU_RESPONSE_URL ?? '',
      apiLogin: process.env.PAYU_API_LOGIN ?? '',
      queryUrl: process.env.PAYU_QUERY_URL || SANDBOX_QUERY_URL,
    };

    if (
      !config.merchantId ||
      !config.accountId ||
      !config.apiKey ||
      !config.confirmationUrl ||
      !config.responseUrl ||
      !config.apiLogin
    ) {
      throw new InternalServerErrorException(
        'Falta configurar el checkout sandbox de PayU',
      );
    }

    if (
      !config.checkoutUrl.startsWith('https://sandbox.checkout.payulatam.com/')
    ) {
      throw new InternalServerErrorException(
        'PAYU_CHECKOUT_URL debe apuntar al sandbox de PayU',
      );
    }
    if (config.queryUrl !== SANDBOX_QUERY_URL) {
      throw new InternalServerErrorException(
        'PAYU_QUERY_URL debe apuntar al endpoint sandbox oficial',
      );
    }

    return config;
  }
}
