// Service worker de Mac Draft: SOLO para push. A PROPOSITO no hay manejador
// de fetch ni cache: el cache-busting del producto va por ?v= en index.html y
// un SW que cachea mal es un bug eterno. Que nadie le anada un 'fetch' aqui
// sin repensar toda la estrategia de cache (hay un check del gate que lo
// vigila).
'use strict';

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { }
  var titulo = d.title || 'Mac Draft';
  var opts = {
    body: d.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: d.url || '/myleagues' }
  };
  e.waitUntil(self.registration.showNotification(titulo, opts));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/myleagues';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (ws) {
    for (var i = 0; i < ws.length; i++) {
      if ('focus' in ws[i]) { ws[i].navigate(url); return ws[i].focus(); }
    }
    return clients.openWindow(url);
  }));
});
