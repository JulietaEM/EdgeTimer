import { BadRequestException } from '@nestjs/common';

/** Versión de la política de tratamiento de datos que acepta el usuario (Ley 1581 de 2012). */
export const TERMS_VERSION = process.env.TERMS_VERSION ?? '1.0';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function requireText(value: unknown, message: string, maxLength = 120) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(message);
  }

  const clean = value.trim();
  if (clean.length > maxLength) {
    throw new BadRequestException(
      `El texto es demasiado largo (máximo ${maxLength} caracteres)`,
    );
  }

  return clean;
}

export function optionalText(value: unknown, maxLength = 200) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new BadRequestException('Dato inválido');
  }

  const clean = value.trim();
  if (clean.length === 0) {
    return null;
  }
  if (clean.length > maxLength) {
    throw new BadRequestException(
      `El texto es demasiado largo (máximo ${maxLength} caracteres)`,
    );
  }

  return clean;
}

export function normalizeEmail(value: unknown) {
  const email = requireText(
    value,
    'El email es obligatorio',
    254,
  ).toLowerCase();

  if (!EMAIL_PATTERN.test(email)) {
    throw new BadRequestException('El email no es válido');
  }

  return email;
}

export function validatePassword(value: unknown) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new BadRequestException('La contraseña es obligatoria');
  }

  if (value.length < 8 || value.length > 72) {
    throw new BadRequestException(
      'La contraseña debe tener entre 8 y 72 caracteres',
    );
  }

  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
    throw new BadRequestException(
      'La contraseña debe combinar letras y números',
    );
  }

  return value;
}

export function normalizePhone(value: unknown) {
  const phone = optionalText(value, 30);
  if (phone === null) {
    return null;
  }

  const digits = phone.replace(/\D/g, '');
  if (
    !/^[0-9+()\-\s]+$/.test(phone) ||
    digits.length < 7 ||
    digits.length > 15
  ) {
    throw new BadRequestException('El teléfono no es válido');
  }

  return phone;
}

export function requireTerms(accepted: unknown) {
  if (accepted !== true) {
    throw new BadRequestException(
      'Debes aceptar la política de tratamiento de datos personales',
    );
  }
}

/** Base del nombre de usuario a partir del correo (solo a-z, 0-9 y _). */
export function buildUsernameBase(email: string) {
  const base = email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .slice(0, 48);

  return base.length >= 3 ? base : 'cliente';
}

/** Escapa los comodines de ILIKE (% y _) para comparar texto literal. */
export function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
