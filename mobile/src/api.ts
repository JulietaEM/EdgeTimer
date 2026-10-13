import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import type { Session, SessionProfile } from './types';
import { loadRefreshToken, saveRefreshToken } from './utils/sessionStore';

const baseURL =
  process.env.EXPO_PUBLIC_API_URL || 'https://edgetimer-backend.onrender.com';

const api = axios.create({
  baseURL,
  timeout: 10000,
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
