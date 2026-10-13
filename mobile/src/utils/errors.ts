import { API_URL } from '../api';

function isAxiosLike(error: unknown): error is { code?: string; message?: string; response?: unknown } {
  return typeof error === 'object' && error !== null;
}

export function readError(error: unknown, fallback: string) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof error.response === 'object' &&
    error.response !== null &&
    'data' in error.response
  ) {
    const data = error.response.data as { message?: string | string[] };
    if (Array.isArray(data.message)) return data.message.join(', ');
    if (data.message) return data.message;
  }

  if (isAxiosLike(error) && !error.response) {
    // Sin respuesta del servidor: se explica la causa en lugar del mensaje genérico.
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return 'El servidor tardó demasiado en responder. Si estaba inactivo puede estar despertando: intenta de nuevo en un minuto.';
    }

    if (error.code === 'ERR_NETWORK' || error.message === 'Network Error') {
      // En desarrollo se muestra la URL para detectar un EXPO_PUBLIC_API_URL equivocado.
      return __DEV__
        ? `No se pudo conectar con el servidor (${API_URL}). Revisa la URL y tu conexión.`
        : 'No se pudo conectar con el servidor. Revisa tu conexión a internet.';
    }
  }

  return fallback;
}
