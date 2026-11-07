import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';

process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_KEY = 'anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.PAYU_MERCHANT_ID = '508029';
process.env.PAYU_ACCOUNT_ID_CO = '512321';
process.env.PAYU_API_KEY = 'test-api-key';
process.env.PAYU_API_LOGIN = 'test-api-login';
process.env.PAYU_CONFIRMATION_URL =
  'https://backend.example.com/pagos/confirmacion';
process.env.PAYU_RESPONSE_URL = 'https://app.example.com/agenda?pago=resultado';

import type { AuthUser } from '../common/auth/auth-user';
import { fakeAdmin } from '../test-utils/fake-supabase';
import { PagosService } from './pagos.service';

const CITA_ID = '11111111-1111-4111-8111-111111111111';
const CLIENTE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

const user: AuthUser = {
  userId: USER_ID,
  role: 'cliente',
  profileId: CLIENTE_ID,
  idBarberia: null,
  nombre: 'Julieta Pérez',
  email: 'julieta@example.com',
  accessToken: 'access-token',
  mustChangePassword: false,
};

const cita = {
  id_cita: CITA_ID,
  id_cliente: CLIENTE_ID,
  estado: 'confirmada',
  cita_procedimiento: [
    { precio_aplicado: '25000.00' },
    { precio_aplicado: '15000.00' },
  ],
};

const pendingPayment = {
  id_pago: '44444444-4444-4444-8444-444444444444',
  id_cita: CITA_ID,
  referencia: `ET-${CITA_ID}-test`,
  monto: '40000.00',
  moneda: 'COP',
  estado: 'pendiente' as const,
};

describe('PagosService', () => {
  let service: PagosService;

  beforeEach(() => {
    service = new PagosService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('calcula el total con precios aplicados y devuelve formulario SHA256 de sandbox', async () => {
    const calls = fakeAdmin({
      cita: { data: cita },
      pago: [{ data: null }, { data: pendingPayment }],
    });

    const result = await service.crearCheckout(user, CITA_ID);
    const fields = result.checkout.fields;
    const base = [
      'test-api-key',
      '508029',
      pendingPayment.referencia,
      '40000.00',
      'COP',
    ].join('~');

    expect(result.pago.monto).toBe('40000.00');
    expect(fields.signature).toBe(
      createHash('sha256').update(base).digest('hex'),
    );
    expect(fields).toMatchObject({
      merchantId: '508029',
      accountId: '512321',
      amount: '40000.00',
      currency: 'COP',
      algorithmSignature: 'SHA256',
      tax: '0',
      taxReturnBase: '0',
      test: '1',
      buyerEmail: user.email,
    });
    expect(result.checkout).toMatchObject({
      action: 'https://sandbox.checkout.payulatam.com/ppp-web-gateway-payu/',
      method: 'POST',
    });
    expect(calls).toContainEqual({
      table: 'pago',
      method: 'insert',
      args: [
        expect.objectContaining({
          id_cita: CITA_ID,
          proveedor: 'payu',
          monto: '40000.00',
          moneda: 'COP',
          estado: 'pendiente',
        }),
      ],
    });
  });

  it('rechaza ids de cita inválidos antes de consultar Supabase', async () => {
    const calls = fakeAdmin({});

    await expect(
      service.crearCheckout(user, 'no-es-uuid'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(calls).toHaveLength(0);
  });

  it('valida la firma de confirmación con el valor redondeado que define PayU', () => {
    const payload = {
      merchant_id: '508029',
      reference_sale: 'ET-test',
      value: '40000.00',
      currency: 'COP',
      state_pol: '4',
      sign: '',
      transaction_id: 'tx-1',
      test: '1',
    };
    const base = [
      'test-api-key',
      payload.merchant_id,
      payload.reference_sale,
      '40000.0',
      payload.currency,
      payload.state_pol,
    ].join('~');
    payload.sign = createHmac('sha256', 'test-api-key')
      .update(base)
      .digest('hex');
    expect((service as any).validarFirma(payload, 'test-api-key')).toBe(true);
    payload.sign = 'invalid';
    expect((service as any).validarFirma(payload, 'test-api-key')).toBe(false);
  });

  it('mapea los estados de PayU sin tratar pendientes como aprobados', () => {
    expect((service as any).mapEstado('4')).toBe('aprobado');
    expect((service as any).mapEstado('6')).toBe('rechazado');
    expect((service as any).mapEstado('5')).toBe('expirado');
    expect((service as any).mapEstado('7')).toBe('pendiente');
  });

  it('no revela citas de otros clientes ni intenta crear pagos', async () => {
    const calls = fakeAdmin({
      cita: { data: { ...cita, id_cliente: USER_ID } },
    });

    await expect(service.crearCheckout(user, CITA_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(calls.some((call) => call.table === 'pago')).toBe(false);
  });

  it('solo permite pagar citas confirmadas', async () => {
    const calls = fakeAdmin({
      cita: { data: { ...cita, estado: 'pendiente' } },
    });

    await expect(service.crearCheckout(user, CITA_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(calls.some((call) => call.table === 'pago')).toBe(false);
  });

  it('no crea un segundo pago cuando ya existe uno aprobado', async () => {
    const calls = fakeAdmin({
      cita: { data: cita },
      pago: { data: { ...pendingPayment, estado: 'aprobado' } },
    });

    await expect(service.crearCheckout(user, CITA_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(calls.some((call) => call.method === 'insert')).toBe(false);
  });

  it('reutiliza la referencia de un pago pendiente sin insertar otro', async () => {
    const calls = fakeAdmin({
      cita: { data: cita },
      pago: { data: pendingPayment },
    });

    const result = await service.crearCheckout(user, CITA_ID);

    expect(result.pago.referencia).toBe(pendingPayment.referencia);
    expect(calls.some((call) => call.method === 'insert')).toBe(false);
  });

  it('resuelve dos solicitudes simultáneas reutilizando el pago ganador', async () => {
    const calls = fakeAdmin({
      cita: { data: cita },
      pago: [
        { data: null },
        { data: null, error: { code: '23505', message: 'unique violation' } },
        { data: pendingPayment },
      ],
    });

    const result = await service.crearCheckout(user, CITA_ID);

    expect(result.pago.referencia).toBe(pendingPayment.referencia);
    expect(calls.filter((call) => call.method === 'insert')).toHaveLength(1);
  });

  it('no reutiliza un pago pendiente si el valor aplicado a la cita cambió', async () => {
    const calls = fakeAdmin({
      cita: { data: cita },
      pago: { data: { ...pendingPayment, monto: '39999.00' } },
    });

    await expect(service.crearCheckout(user, CITA_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(calls.some((call) => call.method === 'insert')).toBe(false);
  });

  it('rechaza citas sin procedimientos o con precios inválidos', async () => {
    fakeAdmin({ cita: { data: { ...cita, cita_procedimiento: [] } } });
    await expect(service.crearCheckout(user, CITA_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    jest.restoreAllMocks();
    fakeAdmin({
      cita: {
        data: {
          ...cita,
          cita_procedimiento: [{ precio_aplicado: Number.NaN }],
        },
      },
    });
    await expect(service.crearCheckout(user, CITA_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
