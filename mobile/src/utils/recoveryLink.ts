import { Platform } from 'react-native';

/**
 * El correo de recuperación lleva a la web con ?token_hash=... en la URL.
 * Solo existe en la versión web: en el celular el enlace abre el navegador.
 */
export function readRecoveryToken(): string | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return null;
  }

  return new URLSearchParams(window.location.search).get('token_hash');
}

/** Quita el token de la barra de direcciones para que no quede en el historial. */
export function clearRecoveryToken() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return;
  }

  window.history.replaceState({}, '', window.location.pathname);
}
