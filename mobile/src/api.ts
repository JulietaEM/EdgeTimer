import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import type { Session, SessionProfile } from './types';
import { loadRefreshToken, saveRefreshToken } from './utils/sessionStore';

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL || 'https://edgetimer-backend.onrender.com';
const baseURL = API_URL;

// 30 s: el servidor gratuito de Render tarda en "despertar" tras un rato sin uso.
const api = axios.create({
  baseURL,
  timeout: 30000,
});

let session: Session | null = null;
let onSessionExpired: (() => void) | null = null;
let refreshing: Promise<RefreshResult> | null = null;

/**
 * Guarda (o borra) la sesión: la deja en el encabezado de todas las peticiones
 * y recuerda el token de renovación para que sobreviva al recargar o reabrir la app.
 */
export function setSession(next: Session | null) {
  session = next;
  void saveRefreshToken(next?.refreshToken ?? null);

  if (next) {
    api.defaults.headers.common.Authorization = `Bearer ${next.accessToken}`;
  } else {
    delete api.defaults.headers.common.Authorization;
  }
}

export function getAccessToken() {
  return session?.accessToken ?? null;
}

/** App.tsx registra aquí qué hacer cuando la sesión ya no se puede renovar. */
export function setSessionExpiredHandler(handler: (() => void) | null) {
  onSessionExpired = handler;
}

type RefreshResult =
  | { status: 'ok'; token: string }
  | { status: 'invalid' }
  | { status: 'unreachable' };

/** Pide un token de acceso nuevo con el token de renovación guardado. */
async function refreshSession(): Promise<RefreshResult> {
  if (!session?.refreshToken) {
    return { status: 'invalid' };
  }

  try {
    // Se usa axios directo (no `api`) para no entrar al interceptor otra vez.
    const response = await axios.post(
      `${baseURL}/auth/refresh`,
      { refreshToken: session.refreshToken },
      { timeout: 45000 },
    );
    const next = response.data.session as Session;
    setSession(next);
    return { status: 'ok', token: next.accessToken };
  } catch (error) {
    // Con respuesta del servidor (400/401/403) el token ya no sirve; sin
    // respuesta (sin internet, servidor dormido) no se debe cerrar la sesión.
    return axios.isAxiosError(error) && error.response
      ? { status: 'invalid' }
      : { status: 'unreachable' };
  }
}

/**
 * Al abrir la app: si hay un token de renovación guardado, lo usa para
 * recuperar la sesión y el perfil. Devuelve null si no hay sesión que restaurar.
 */
let restoring: Promise<SessionProfile | null> | null = null;

export function restoreSession() {
  // Una sola restauración a la vez (evita pedir dos veces el mismo token).
  restoring ??= doRestoreSession();
  return restoring;
}

async function doRestoreSession() {
  const refreshToken = await loadRefreshToken();
  if (!refreshToken) {
    return null;
  }

  // Render puede tardar en "despertar" el servidor: se espera más de lo normal.
  setSessionQuietly({ accessToken: '', refreshToken });
  const result = await refreshSession();

  if (result.status !== 'ok') {
    if (result.status === 'invalid') {
      setSession(null);
    } else {
      // Sin conexión: se conserva lo guardado en disco para reintentar luego.
      setSessionQuietly(null);
    }
    return null;
  }

  try {
    const response = await api.get('/auth/me', { timeout: 45000 });
    return response.data as SessionProfile;
  } catch {
    return null;
  }
}

/** Pone la sesión en memoria sin tocar lo guardado en disco. */
function setSessionQuietly(next: Session | null) {
  session = next;
}

/**
 * Envía un formulario con archivos (fotos). Se usa fetch y no axios porque, en
 * algunos Android, axios falla con "Network Error" al enviar FormData con
 * archivos, aunque el servidor esté bien. Si el token venció, lo renueva una vez.
 * Los errores tienen la forma de los de axios, así que readError() los entiende.
 */
export async function postForm<T = any>(
  path: string,
  body: FormData,
): Promise<{ data: T; status: number }> {
  const send = async (token: string | null) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);

    try {
      return await fetch(`${baseURL}${path}`, {
        method: 'POST',
        body,
        // Sin Content-Type: el sistema agrega solo el límite (boundary) del formulario.
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      throw aborted
        ? { code: 'ECONNABORTED', message: 'timeout' }
        : { code: 'ERR_NETWORK', message: 'Network Error' };
    } finally {
      clearTimeout(timer);
    }
  };

  let response = await send(getAccessToken());

  if (response.status === 401 && session) {
    const result = await refreshSession();
    if (result.status === 'ok') {
      response = await send(result.token);
    } else if (result.status === 'invalid') {
      setSession(null);
      onSessionExpired?.();
    }
  }

  const data = (await response.json().catch(() => ({}))) as T;

  if (!response.ok) {
    throw { response: { status: response.status, data } };
  }

  return { data, status: response.status };
}

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

// Los tokens de Supabase duran 1 hora: ante un 401 se renueva una vez y se
// repite la petición. Si no se puede renovar, se cierra la sesión.
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined;
    const isAuthRoute = /\/auth\/(login|refresh|register)/.test(original?.url ?? '');

    if (error.response?.status === 401 && session && original && !original._retried && !isAuthRoute) {
      original._retried = true;
      refreshing ??= refreshSession().finally(() => {
        refreshing = null;
      });

      const result = await refreshing;
      if (result.status === 'ok') {
        original.headers.Authorization = `Bearer ${result.token}`;
        return api(original);
      }

      // Solo se cierra la sesión si el token de verdad ya no sirve.
      if (result.status === 'invalid') {
        setSession(null);
        onSessionExpired?.();
      }
    }

    return Promise.reject(error);
  },
);

export default api;
