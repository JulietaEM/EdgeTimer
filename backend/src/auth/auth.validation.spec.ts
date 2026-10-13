import { BadRequestException } from '@nestjs/common';
import {
  buildUsernameBase,
  escapeLike,
  normalizeEmail,
  normalizePhone,
  optionalText,
  requireTerms,
  requireText,
  validatePassword,
} from './auth.validation';

describe('auth.validation', () => {
  describe('normalizeEmail', () => {
    it('pasa a minúsculas y recorta espacios', () => {
      expect(normalizeEmail('  Juan.Gonzalez@Gmail.COM ')).toBe(
        'juan.gonzalez@gmail.com',
      );
    });

    it.each(['', '   ', 'sin-arroba', 'a@b', 'a b@c.com', undefined, 42])(
      'rechaza %p',
      (value) => {
        expect(() => normalizeEmail(value)).toThrow(BadRequestException);
      },
    );
  });

  describe('validatePassword', () => {
    it('acepta 8+ caracteres con letras y números', () => {
      expect(validatePassword('Barber123')).toBe('Barber123');
    });

    it.each([
      ['muy corta', 'ab1'],
      ['solo letras', 'abcdefghij'],
      ['solo números', '1234567890'],
      ['vacía', ''],
      ['demasiado larga', 'a1'.repeat(40)],
    ])('rechaza contraseña %s', (_label, value) => {
      expect(() => validatePassword(value)).toThrow(BadRequestException);
    });
  });

  describe('normalizePhone', () => {
    it('devuelve null si viene vacío', () => {
      expect(normalizePhone(undefined)).toBeNull();
      expect(normalizePhone('   ')).toBeNull();
    });

    it('acepta formatos comunes', () => {
      expect(normalizePhone('+57 300 123 4567')).toBe('+57 300 123 4567');
      expect(normalizePhone('(604) 555-1234')).toBe('(604) 555-1234');
    });

    it.each(['123', 'abc1234567', '1'.repeat(20)])('rechaza %p', (value) => {
      expect(() => normalizePhone(value)).toThrow(BadRequestException);
    });
  });

  describe('requireText y optionalText', () => {
    it('requireText exige texto y respeta el máximo', () => {
      expect(requireText('  Hola ', 'falta')).toBe('Hola');
      expect(() => requireText('', 'falta')).toThrow('falta');
      expect(() => requireText('x'.repeat(11), 'falta', 10)).toThrow(
        BadRequestException,
      );
    });

    it('optionalText devuelve null para vacío', () => {
      expect(optionalText(undefined)).toBeNull();
      expect(optionalText('  ')).toBeNull();
      expect(optionalText(' Robledo ')).toBe('Robledo');
    });
  });

  describe('requireTerms', () => {
    it('solo acepta true explícito', () => {
      expect(() => requireTerms(true)).not.toThrow();
      expect(() => requireTerms(false)).toThrow(BadRequestException);
      expect(() => requireTerms('true')).toThrow(BadRequestException);
      expect(() => requireTerms(undefined)).toThrow(BadRequestException);
    });
  });

  describe('buildUsernameBase', () => {
    it('limpia caracteres no permitidos', () => {
      expect(buildUsernameBase('Juan.Gonzalez+x@gmail.com')).toBe(
        'juan_gonzalez_x',
      );
    });

    it('usa "cliente" si queda demasiado corto', () => {
      expect(buildUsernameBase('ab@gmail.com')).toBe('cliente');
    });

    it('limita a 48 caracteres', () => {
      expect(buildUsernameBase(`${'a'.repeat(80)}@x.com`)).toHaveLength(48);
    });
  });

  describe('escapeLike', () => {
    it('escapa los comodines de ILIKE', () => {
      expect(escapeLike('100%_real\\')).toBe('100\\%\\_real\\\\');
    });
  });
});
