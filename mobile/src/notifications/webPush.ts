import { Platform } from 'react-native';
import api from '../api';

/**
 * Avisos del navegador (Web Push). Solo existen en la versión web: en el
 * celular la campana de la app sigue funcionando, pero sin avisos del sistema.
 */

export type PushState = 'native' | 'unsupported' | 'unconfigured' | 'denied' | 'off' | 'on';

export function webPushSupported() {
  return (
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** La llave pública VAPID llega en base64 "seguro para URL"; el navegador la pide en bytes. */
function toKeyBytes(base64Url: string) {
  const padded = base64Url + '='.repeat((4 - (base64Url.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function getRegistration() {
  await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
}

async function currentSubscription() {
  const registration = await getRegistration();
  return registration.pushManager.getSubscription();
}

async function fetchPublicKey(): Promise<string | null> {
  const response = await api.get('/notificaciones/config');
  return (response.data?.vapidPublicKey as string | null) ?? null;
}

/** Le entrega al backend la suscripción del navegador para la cuenta actual. */
async function sendSubscription(subscription: PushSubscription) {
  await api.post('/notificaciones/suscripcion', subscription.toJSON());
}

/** En qué estado están los avisos del navegador para esta cuenta. */
export async function getPushState(): Promise<PushState> {
  if (Platform.OS !== 'web') return 'native';
  if (!webPushSupported()) return 'unsupported';

  try {
    if ((await fetchPublicKey()) === null) return 'unconfigured';
    if (Notification.permission === 'denied') return 'denied';

    const subscription = await currentSubscription();
    if (Notification.permission === 'granted' && subscription) {
      // Si cambió la cuenta en este navegador, la suscripción pasa a la nueva.
      await sendSubscription(subscription);
      return 'on';
    }
    return 'off';
  } catch {
    return 'off';
  }
}

/** Pide permiso (debe llamarse desde un clic) y suscribe el navegador. */
export async function enableWebPush(): Promise<PushState> {
  if (!webPushSupported()) return 'unsupported';

  const publicKey = await fetchPublicKey();
  if (!publicKey) return 'unconfigured';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';

  const registration = await getRegistration();
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: toKeyBytes(publicKey),
    }));

  await sendSubscription(subscription);
  return 'on';
}

/** Quita la suscripción de este navegador (al desactivar o al cerrar sesión). */
export async function disableWebPush(token?: string) {
  if (!webPushSupported()) return;

  try {
    const subscription = await currentSubscription();
    if (!subscription) return;

    // Primero se avisa al backend (mientras haya token) y luego se suelta.
    await api
      .post(
        '/notificaciones/suscripcion/baja',
        { endpoint: subscription.endpoint },
        // Al cerrar sesión el token por defecto ya se borró: se envía el de esa sesión.
        token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
      )
      .catch(() => undefined);
    await subscription.unsubscribe();
  } catch {
    // Si falla no pasa nada: el backend borra las suscripciones que caducan.
  }
}

/** Llama a `onPush` cada vez que el service worker avisa que llegó un push. */
export function onPushMessage(onPush: () => void) {
  if (!webPushSupported()) return () => undefined;

  const handler = (event: MessageEvent) => {
    if (event.data?.type === 'push') onPush();
  };
  navigator.serviceWorker.addEventListener('message', handler);
  return () => navigator.serviceWorker.removeEventListener('message', handler);
}
