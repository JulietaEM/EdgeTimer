import { BadRequestException } from '@nestjs/common';

// El servicio importa supabase.ts, que exige variables de entorno.
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_KEY = 'anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
// Fija la URL de la prueba para que no dependa del .env de quien la corra.
// (Lleva "/" al final a propósito: el servicio debe quitarla.)
process.env.FRONTEND_URL = 'https://app.ejemplo.com/';

import { AccountsService } from '../common/accounts.service';
import * as supabase from '../supabase';
import { AuthService } from './auth.service';

const GENERIC =
  'Si el correo está registrado, te enviamos un enlace para restablecer tu contraseña.';

function mockAnonClient(auth: Record<string, jest.Mock>) {
  jest
    .spyOn(supabase, 'createAnonClient')
    .mockReturnValue({ auth } as unknown as ReturnType<
      typeof supabase.createAnonClient
    >);
}

describe('AuthService · recuperar contraseña', () => {
  let service: AuthService;

  beforeEach(() => {
    service = new AuthService(new AccountsService());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('forgotPassword', () => {
    it('pide a Supabase el correo con la URL del frontend', async () => {
      const resetPasswordForEmail = jest
        .fn()
        .mockResolvedValue({ error: null });
      mockAnonClient({ resetPasswordForEmail });

      const result = await service.forgotPassword({
        email: ' Ana@Correo.com ',
      });

      expect(result.message).toBe(GENERIC);
      expect(resetPasswordForEmail).toHaveBeenCalledWith('ana@correo.com', {
        redirectTo: 'https://app.ejemplo.com',
      });
    });

    it('responde igual aunque Supabase falle (no revela qué correos existen)', async () => {
      const resetPasswordForEmail = jest
        .fn()
        .mockResolvedValue({ error: { message: 'rate limit' } });
      mockAnonClient({ resetPasswordForEmail });

      await expect(
        service.forgotPassword({ email: 'ana@correo.com' }),
      ).resolves.toEqual({ message: GENERIC });
    });

    it('rechaza un correo con formato inválido', async () => {
      await expect(
        service.forgotPassword({ email: 'no-es-correo' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('resetPassword', () => {
    it('rechaza una contraseña débil sin consumir el token', async () => {
      const verifyOtp = jest.fn();
      mockAnonClient({ verifyOtp });

      await expect(
        service.resetPassword({ tokenHash: 'abc', password: 'corta' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(verifyOtp).not.toHaveBeenCalled();
    });

    it('rechaza un enlace vencido o ya usado', async () => {
      const verifyOtp = jest
        .fn()
        .mockResolvedValue({ data: {}, error: { message: 'expired' } });
      mockAnonClient({ verifyOtp });

      await expect(
        service.resetPassword({ tokenHash: 'abc', password: 'Clave12345' }),
      ).rejects.toThrow('El enlace no es válido o ya expiró');
    });

    it('cambia la contraseña y cierra todas las sesiones', async () => {
      const verifyOtp = jest.fn().mockResolvedValue({
        data: { user: { id: 'u1' }, session: { access_token: 'tok' } },
        error: null,
      });
      mockAnonClient({ verifyOtp });

      const updateUserById = jest.fn().mockResolvedValue({ error: null });
      const signOut = jest.fn().mockResolvedValue({ error: null });
      jest
        .spyOn(supabase.supabaseAdmin.auth.admin, 'updateUserById')
        .mockImplementation(updateUserById);
      jest
        .spyOn(supabase.supabaseAdmin.auth.admin, 'signOut')
        .mockImplementation(signOut);

      const result = await service.resetPassword({
        tokenHash: 'abc',
        password: 'Clave12345',
      });

      expect(verifyOtp).toHaveBeenCalledWith({
        token_hash: 'abc',
        type: 'recovery',
      });
      expect(updateUserById).toHaveBeenCalledWith('u1', {
        password: 'Clave12345',
      });
      expect(signOut).toHaveBeenCalledWith('tok', 'global');
      expect(result.message).toContain('Contraseña actualizada');
    });

    it('explica cuando la contraseña nueva es igual a la anterior', async () => {
      const verifyOtp = jest.fn().mockResolvedValue({
        data: { user: { id: 'u1' }, session: { access_token: 'tok' } },
        error: null,
      });
      mockAnonClient({ verifyOtp });
      jest
        .spyOn(supabase.supabaseAdmin.auth.admin, 'updateUserById')
        .mockResolvedValue({ error: { code: 'same_password' } } as never);

      await expect(
        service.resetPassword({ tokenHash: 'abc', password: 'Clave12345' }),
      ).rejects.toThrow('distinta a la anterior');
    });
  });
});
