/* Service worker de EdgeTimer: recibe los avisos push y los muestra, aunque la
 * pestaña esté cerrada (con el navegador abierto). Un service worker es un script
 * que el navegador ejecuta en segundo plano, separado de la página; "worker"
 * viene del inglés "trabajador": hace el trabajo sin que la página lo pida. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    data = { titulo: 'EdgeTimer', mensaje: event.data ? event.data.text() : '' };
  }

  const options = {
    body: data.mensaje || '',
    icon: '/notification-icon.png',
    badge: '/notification-icon.png',
    // Una etiqueta por cita y tipo: dos avisos distintos no se pisan entre sí.
    tag: data.idCita ? `${data.tipo || 'aviso'}-${data.idCita}` : undefined,
    data: { url: '/' },
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.titulo || 'EdgeTimer', options),
      // Si la app está abierta, que refresque la campana al instante.
      self.clients
        .matchAll({ type: 'window', includeUncontrolled: true })
        .then((clients) => clients.forEach((client) => client.postMessage({ type: 'push' }))),
    ]),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
