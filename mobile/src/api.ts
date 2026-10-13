import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import type { Session } from './types';

const baseURL =
  process.env.EXPO_PUBLIC_API_URL || 'https://edgetimer-backend.onrender.com';

const api = axios.create({
  baseURL,
  timeout: 10000,
});

let session: Session | null = null;
let onSessionExpired: (() => void) | null = null;
let refreshing: Promise<string | null> | null = null;

/** Guarda (o borra) la sesión y la deja puesta en el encabezado de todas las peticiones. */
export function setSession(next: Session | null) {
  session = next;

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

async function refreshSession(): Promise<string | null> {
  if (!session?.refreshToken) {
    return null;
  }

  try {
    // Se usa axios directo (no `api`) para no entrar al interceptor otra vez.
    const response = await axios.post(
      `${baseURL}/auth/refresh`,
      { refreshToken: session.refreshToken },
      { timeout: 10000 },
    );
    const next = response.data.session as Session;
    setSession(next);
    return next.accessToken;
  } catch {
    return null;
  }
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

      const token = await refreshing;
      if (token) {
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      }

      setSession(null);
      onSessionExpired?.();
    }

    return Promise.reject(error);
  },
);

export default api;
