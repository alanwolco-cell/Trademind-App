// La pagina a la que vuelve Yahoo despues del login (/api/yahoo/callback).
// Los datos llegan en #yahoo-data; aqui se decide a quien entregarle el token.
//
//   1. Hay ventana que nos abrio (popup de escritorio): postMessage a ella.
//   2. Hay vuelta pedida (popup bloqueado, login en la misma pestana): se
//      guarda el token y se regresa a donde estaba.
//   3. Ninguna de las dos. Si ESTE almacenamiento es el que pidio el login
//      (tm_yahoo_h coincide), se guarda y se va a Leagues. Si no, esto es la
//      capa de Safari de la app instalada, que no comparte almacenamiento con
//      ella: el token se sube al relevo del servidor, PERO solo tras un toque.
//      Sin ese toque, un enlace de login armado por otra persona le entregaria
//      a esa persona la sesion de quien lo abre.
(function () {
  var msg = document.getElementById('msg');
  var d = {};
  try { d = JSON.parse(document.getElementById('yahoo-data').textContent) || {}; } catch (e) { }
  var p = d.p || {};
  var ret = d.ret || '';
  function texto(t) { msg.textContent = t; }

  if (window.opener) {
    try { window.opener.postMessage({ type: 'trademind-yahoo', payload: { token: p.token, error: p.error } }, window.location.origin); } catch (e) { }
    texto(p.error ? ('Yahoo sign-in failed: ' + p.error) : 'Yahoo connected. This window closes on its own.');
    setTimeout(function () { window.close(); }, 1200);
    return;
  }
  if (p.error || !(p.token && p.token.access_token)) {
    texto('Yahoo sign-in failed: ' + (p.error || 'no token') + '. Go back to Mac Draft and tap Sign in with Yahoo again.');
    if (ret) setTimeout(function () { window.location.replace(ret); }, 2500);
    return;
  }
  var mio = null;
  try { mio = JSON.parse(localStorage.getItem('tm_yahoo_h') || 'null'); } catch (e) { }
  // Guardar el token aqui SOLO si este mismo navegador pidio este login. Sin
  // esta condicion, un enlace al callback con el codigo de OTRA cuenta metia
  // esa cuenta de Yahoo en el navegador de quien lo abria.
  var mismoAlmacen = !!(p.h && mio && mio.h === p.h);
  if (mismoAlmacen) {
    try { localStorage.setItem('tm_yahoo_tok', JSON.stringify(p.token)); } catch (e) { }
    texto('Yahoo connected. Taking you back...');
    setTimeout(function () { window.location.replace(ret || '/myleagues'); }, 400);
    return;
  }

  if (!p.h) {
    texto('Go back to Mac Draft and tap Sign in with Yahoo there.');
    return;
  }
  // Otro almacenamiento: confirmar antes de entregar nada.
  msg.innerHTML = '';
  var h1 = document.createElement('div');
  h1.style.cssText = 'font-size:20px;font-weight:700;margin-bottom:8px';
  h1.textContent = 'Connect Yahoo to Mac Draft?';
  var p1 = document.createElement('div');
  p1.style.cssText = 'color:#b8b3ab;font-size:14px';
  p1.textContent = 'Tap only if you just pressed Sign in with Yahoo inside the Mac Draft app. If someone sent you this link, close it.';
  var bt = document.createElement('button');
  bt.type = 'button';
  bt.textContent = 'Connect';
  bt.style.cssText = 'margin-top:18px;min-height:48px;min-width:180px;border:0;border-radius:999px;background:#3db8d4;color:#0e1a1e;font:inherit;font-size:16px;font-weight:700;cursor:pointer';
  msg.appendChild(h1); msg.appendChild(p1); msg.appendChild(bt);
  bt.addEventListener('click', function () {
    bt.disabled = true; bt.textContent = 'Connecting...';
    fetch('/api/yahoo/handoff', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ h: p.h, token: p.token })
    }).then(function (r) {
      if (!r.ok) throw new Error('relay ' + r.status);
      msg.innerHTML = '';
      var ok = document.createElement('div');
      ok.style.cssText = 'font-size:20px;font-weight:700;margin-bottom:8px';
      ok.textContent = 'Yahoo connected';
      var s = document.createElement('div');
      s.style.cssText = 'color:#b8b3ab;font-size:14px';
      s.textContent = 'Close this and go back to Mac Draft. Your leagues load on their own.';
      msg.appendChild(ok); msg.appendChild(s);
    }).catch(function () {
      bt.disabled = false; bt.textContent = 'Try again';
    });
  });
})();
