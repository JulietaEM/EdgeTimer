import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// Solo se guarda el token de renovación (es corto y no sirve para llamar a la
// API por sí solo). Con él, al abrir la app se pide un token de acceso nuevo.
// Celular: almacén seguro del sistema (Keychain / Keystore).
// Web: localStorage del navegador.
const KEY = 'edgetimer.refresh';

export async function saveRefreshToken(token: string | null): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      if (typeof localStorage === 'undefined') return;
      if (token) localStorage.setItem(KEY, token);
      else localStorage.removeItem(KEY);
      return;
    }

    if (token) await SecureStore.setItemAsync(KEY, token);
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    // Almacenamiento no disponible (por ejemplo, navegación privada): la
    // sesión simplemente dura mientras la app esté abierta.
  }
}

export async function loadRefreshToken(): Promise<string | null> {
  try {
    if (Platform.OS === 'web') {
      return typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    }

    return await SecureStore.getItemAsync(KEY);
  } catch {
    return null;
  }
}
