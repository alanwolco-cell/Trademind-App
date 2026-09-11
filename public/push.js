// Push del lado del cliente: el boton, el permiso y la suscripcion.
// iOS solo lo permite con la app AÑADIDA a la pantalla de inicio (16.4+): si
// no, el boton lo explica en vez de fallar en silencio. El permiso se pide
// SIEMPRE desde un gesto del usuario, que es lo que exige el navegador.
'use strict';
(function () {

  function soportado() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }
  function esIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent); }
  function instalada() {
    try { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; }
    catch (e) { return false; }
  }

  // El estado del boton, en una palabra.
  async function estado() {
    if (esIOS() && !instalada()) return 'ios-sin-instalar';
    if (!soportado()) return 'no-soportado';
    if (Notification.permission === 'denied') return 'negado';
    try {
      var reg = await navigator.serviceWorker.getRegistration();
      var sub = reg && await reg.pushManager.getSubscription();
      return sub ? 'activo' : 'apagado';
    } catch (e) { return 'apagado'; }
  }

  function b64aBytes(b64) {
    var pad = '='.repeat((4 - b64.length % 4) % 4);
    var raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function activar(btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Turning on...'; }
    try {
      var r = await fetch('/api/push/vapid');
      var v = await r.json();
      if (!v.key) throw new Error('Notifications are not configured on the server yet.');
      var perm = await Notification.requestPermission();
      if (perm !== 'granted') { pintar(btn, await estado()); return; }
      var reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      // Con la red rota (o un navegador sin servicio de push) subscribe se
      // cuelga sin error: 20 segundos y el boton vuelve, nunca un "Turning
      // on..." eterno.
      var sub = await Promise.race([
        reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64aBytes(v.key) }),
        new Promise(function (_, rej) { setTimeout(function () { rej(new Error('Push service did not answer. Try again.')); }, 20000); })
      ]);
      var username = '';
      try { username = localStorage.getItem('tm_username') || ''; } catch (e) { }
      var rr = await fetch('/api/push/subscribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON(), username: username })
      });
      if (!rr.ok) throw new Error('Could not save this device.');
      pintar(btn, 'activo');
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Get notified'; btn.title = String(e.message || e); }
    }
  }

  async function apagar(btn) {
    if (btn) btn.disabled = true;
    try {
      var reg = await navigator.serviceWorker.getRegistration();
      var sub = reg && await reg.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/push/unsubscribe', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint })
        });
        await sub.unsubscribe();
      }
    } catch (e) { }
    pintar(btn, 'apagado');
  }

  function pintar(btn, st) {
    if (!btn) return;
    btn.disabled = false; btn.title = '';
    if (st === 'ios-sin-instalar') {
      btn.textContent = 'Get notified';
      btn.onclick = function () {
        alert('Add Mac Draft to your Home Screen first (Share, then Add to Home Screen). iPhone only allows notifications for installed apps.');
      };
      return;
    }
    if (st === 'no-soportado') { btn.style.display = 'none'; return; }
    if (st === 'negado') {
      btn.textContent = 'Notifications blocked';
      btn.onclick = function () {
        alert('Notifications are blocked for this site in your browser settings. Allow them there and try again.');
      };
      return;
    }
    if (st === 'activo') {
      btn.textContent = 'Notifications on';
      btn.onclick = function () { apagar(btn); };
      return;
    }
    btn.textContent = 'Get notified';
    btn.onclick = function () { activar(btn); };
  }

  // El boton vive en el pie de Leagues (lo pinta myleagues.js con el id).
  var _vapidCache;
  async function hayLlave() {
    if (_vapidCache !== undefined) return _vapidCache;
    try { var r = await fetch('/api/push/vapid'); var v = await r.json(); _vapidCache = !!v.key; }
    catch (e) { _vapidCache = false; }
    return _vapidCache;
  }
  async function montar() {
    var btn = document.getElementById('ml-push-btn');
    if (!btn || btn._pushListo) return;
    btn._pushListo = 1;
    // Sin llave VAPID en el servidor la feature no existe: el boton no se
    // ofrece. Una promesa que termina en error no es una feature.
    if (!(await hayLlave())) { btn.style.display = 'none'; return; }
    pintar(btn, await estado());
  }

  window.tmPushMontar = montar;
  document.addEventListener('DOMContentLoaded', montar);
})();
