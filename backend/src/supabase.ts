import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('Faltan variables de entorno de Supabase');
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    'Falta SUPABASE_SERVICE_ROLE_KEY. El backend la necesita para tareas administrativas (crear cuentas, subir archivos, notificaciones).',
  );
}

// En un servidor no se debe guardar sesión dentro del cliente: un cliente
// compartido que hace signInWithPassword quedaría "logueado" como ese usuario
// y las siguientes peticiones de otras personas usarían su token.
const statelessAuth = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};

/** Cliente con service role: se salta RLS. Úsalo solo para tareas administrativas. */
export const supabaseAdmin = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  statelessAuth,
);

/** Cliente anónimo nuevo (uno por petición) para iniciar sesión o refrescar tokens. */
export const createAnonClient = () =>
  createClient(SUPABASE_URL, SUPABASE_KEY, statelessAuth);

/** Cliente que actúa como el usuario del token, de modo que RLS sí se aplica. */
export const createSupabaseUserClient = (accessToken: string) =>
  createClient(SUPABASE_URL, SUPABASE_KEY, {
    ...statelessAuth,
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });

const STORAGE_URL_PATTERN =
  /\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/([^?]+)/;

export function parseStorageUrl(value?: string | null) {
  if (!value) {
    return null;
  }

  const match = value.match(STORAGE_URL_PATTERN);
  if (!match) {
    return null;
  }

  return { bucket: match[1], path: decodeURIComponent(match[2]) };
}

export async function getSignedStorageUrl(value?: string | null) {
  if (!value) {
    return null;
  }

  const parsed = parseStorageUrl(value);
  if (!parsed) {
    return value;
  }

  const { data, error } = await supabaseAdmin.storage
    .from(parsed.bucket)
    .createSignedUrl(parsed.path, 60 * 60 * 24 * 7);

  return error ? value : data.signedUrl;
}
