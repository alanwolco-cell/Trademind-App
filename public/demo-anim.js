/* ============================================================================
   La demostracion del hero: el producto funcionando, en codigo.

   POR QUE NO ES UN VIDEO. El reel anterior se hizo a mano y se pudrio: llego a
   produccion enseñando un jugador que no existe ("J. Love RB ARI"), un nombre
   cortado y la fuente vetada, porque un video no sabe nada del producto. Esto
   pesa unos kilobytes en vez de 600 KB, se ve nitido en retina, y se corrige
   editando este archivo.

   Y una vuelta de tuerca sobre esa idea: las escenas pintan el MARKUP REAL
   (.ml-card, .ml-shield, .ml-vs, .ml-chip...). Si mañana cambia el diseño de
   una tarjeta de liga, la animacion cambia con ella. Lo unico inventado son los
   datos, y son datos limpios a proposito: la portada la ve un desconocido y los
   nombres de las ligas de un grupo de amigos no son publicables.

   Reglas que respeta:
   - Arranca sola cuando entra en pantalla, sin sonido y sin boton de play.
   - Se detiene cuando sale de pantalla y cuando la pestana pasa a segundo plano:
     una animacion corriendo sobre una pestana que nadie mira es bateria robada.
   - Con "reducir movimiento" activado NO corre: se queda la imagen fija que ya
     estaba en el HTML, que es una captura del mismo producto.
   - Si algo falla, la imagen fija se queda. Nunca un hueco.

   El reparto del tiempo es a proposito, no parejo: lo mecanico (conectar, que
   aparezcan las ligas) va rapido, y donde se ve la profundidad (la linea del
   duelo, el tablero del domingo, el cruce entre ligas) va lento.
   ============================================================================ */
(function () {
  'use strict';

  var HOST = null, IMG = null, ESCENA = null, reloj = null, idx = -1, viva = false;

  // Seis ligas inventadas. Mismos campos que usa la tarjeta real.
  var LIGAS = [
    { n: 'Sunday Money', c: 'Dynasty', s: 'PPR', t: 12, rec: '8-3', mio: 128.4, suyo: 121.7, riv: 'The Commissioner', camp: true },
    { n: 'The Group Chat', c: 'Redraft', s: 'Half PPR', t: 10, rec: '7-4', mio: 116.9, suyo: 124.2, riv: 'Waiver Wire Willy' },
    { n: 'Dinner Table', c: 'Redraft', s: 'PPR', t: 12, rec: '6-5', mio: 109.5, suyo: 98.1, riv: 'Backup Plan' },
    { n: 'The Office', c: 'Redraft', s: 'Standard', t: 10, rec: '9-2', mio: 121.0, suyo: 118.8, riv: 'Copy Room Kings', yahoo: true },
    { n: 'Dynasty Warehouse', c: 'Dynasty', s: 'PPR', t: 12, rec: '5-6', mio: 132.7, suyo: 126.3, riv: 'Rebuild Rick' },
    { n: 'Last Call', c: 'Redraft', s: 'Half PPR', t: 14, rec: '4-7', mio: 104.2, suyo: 112.6, riv: 'Sunday Scaries' }
  ];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // El mismo hash y la misma regla de tono que myleagues.js: la liga se ve del
  // mismo color en la portada y dentro del producto.
  function color(nombre) {
    var h = 0;
    for (var i = 0; i < nombre.length; i++) h = (h * 31 + nombre.charCodeAt(i)) >>> 0;
    var t = h % 360;
    if (t > 245 && t < 295) t = (t + 70) % 360;
    return 'hsl(' + t + ' 62% 58%)';
  }
  function iniciales(n) {
    var p = String(n).trim().split(/\s+/).filter(Boolean);
    return (p.length > 1 ? p[0][0] + p[1][0] : p[0].slice(0, 2)).toUpperCase();
  }
  function escudo(nombre, clase) {
    return '<span class="ml-mono ' + (clase || '') + '" style="--c:' + color(nombre) + '">'
      + esc(iniciales(nombre)) + '</span>';
  }
  function num(n) { return (Math.round(n * 10) / 10).toFixed(1); }
  function americano(p) {
    var v = p >= 0.5 ? -(100 * p / (1 - p)) : (100 * (1 - p) / p);
    var r = Math.round(v / 5) * 5;
    if (r > 0 && r < 100) r = 100;
    if (r < 0 && r > -100) r = -100;
    return (r > 0 ? '+' : '') + r;
  }
  function prob(a, b) {
    var sd = Math.sqrt(2) * Math.max(16, 0.24 * a);
    var z = (a - b) / sd;
    var t = 1 / (1 + 0.2316419 * Math.abs(z));
    var d = 0.3989422804014327 * Math.exp(-z * z / 2);
    var p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return z > 0 ? 1 - p : p;
  }

  function tarjeta(L, conLinea) {
    var p = prob(L.mio, L.suyo), fav = L.mio >= L.suyo;
    var sp = Math.round(Math.abs(L.mio - L.suyo) * 2) / 2 || 0.5;
    return '<article class="ml-card" style="--liga:' + color(L.n) + '">'
      + '<header class="ml-card-h">' + escudo(L.n, 'is-lg')
      + '<div class="ml-card-id"><h3>' + esc(L.n) + '</h3>'
      + '<span class="ml-card-sub">' + (L.yahoo ? 'Yahoo' : 'Sleeper') + ' · You</span></div>'
      + '<span class="ml-rec mono">' + esc(L.rec) + '</span></header>'
      + (L.camp ? '<div class="ml-champ-tag">Defending champion</div>' : '')
      + '<div class="ml-flags"><span>' + esc(L.c) + '</span><span>' + esc(L.s) + '</span><span>' + L.t + ' teams</span></div>'
      + '<div class="ml-vs">'
      + '<div class="ml-vs-side">' + escudo('You', 'is-sm')
      + '<span class="ml-vs-lbl">You</span><span class="mono ml-vs-num">' + num(L.mio) + '</span></div>'
      + '<div class="ml-vs-mid"><span class="ml-vs-at">vs</span></div>'
      + '<div class="ml-vs-side ml-vs-opp">' + escudo(L.riv, 'is-sm')
      + '<span class="ml-vs-lbl">' + esc(L.riv) + '</span>'
      + '<span class="mono ml-vs-num">' + num(L.suyo) + '</span></div>'
      + '</div>'
      + '<div class="ml-vs-odds ' + (fav ? 'is-fav' : 'is-dog') + '"' + (conLinea ? '' : ' style="opacity:0"') + '>'
      + '<span class="mono">' + (fav ? '-' : '+') + sp + '</span>'
      + '<span class="ml-dot">·</span><span class="mono">' + americano(p) + '</span>'
      + '<span class="ml-dot">·</span><span>' + (Math.round(p * 1000) / 10) + '% to win</span>'
      + '</div></article>';
  }

  /* ------------------------------------------------------------- las escenas */
  // ms = cuanto dura. El reparto NO es parejo: rapido lo mecanico, lento donde
  // se ve por que esto sirve.
  var GUION = [
    { id: 'conectar', ms: 2200, pinta: function () {
      HOST.innerHTML = '<div class="da-pane da-center">'
        + '<div class="da-connect"><span class="da-lbl">Sleeper username</span>'
        + '<span class="da-input"><b id="da-typed"></b><i class="da-caret"></i></span></div>'
        + '<div class="da-note">or one Yahoo sign in</div></div>';
      var destino = 'wolco', el = HOST.querySelector('#da-typed'), i = 0;
      var t = setInterval(function () {
        if (!el || !el.isConnected) return clearInterval(t);
        el.textContent = destino.slice(0, ++i);
        if (i >= destino.length) clearInterval(t);
      }, 130);
    } },
    { id: 'ligas', ms: 3400, pinta: function () {
      HOST.innerHTML = '<div class="da-pane"><div class="da-head">'
        + '<b>6 leagues</b><span>Sleeper and Yahoo, one screen</span></div>'
        + '<div class="ml-grid da-grid">'
        + LIGAS.map(function (L) { return tarjeta(L, true); }).join('')
        + '</div></div>';
      // Caen una a una: es lo que cuenta la historia de "todas tus ligas".
      var cards = HOST.querySelectorAll('.ml-card');
      for (var i = 0; i < cards.length; i++) {
        cards[i].style.animationDelay = (i * 110) + 'ms';
        cards[i].classList.add('da-in');
      }
    } },
    { id: 'linea', ms: 3600, pinta: function () {
      var L = LIGAS[1];
      HOST.innerHTML = '<div class="da-pane da-center">'
        + '<div class="da-solo">' + tarjeta(L, false) + '</div>'
        + '<div class="da-cap">Priced with <b>your league\'s</b> rules, not a generic number</div></div>';
      var linea = HOST.querySelector('.ml-vs-odds');
      setTimeout(function () {
        if (linea && linea.isConnected) { linea.style.transition = 'opacity .5s ease'; linea.style.opacity = '1'; }
      }, 900);
    } },
    { id: 'tablero', ms: 4200, pinta: function () {
      var filas = LIGAS.slice(0, 4).map(function (L) {
        var p = prob(L.mio, L.suyo), fav = L.mio >= L.suyo;
        var sp = Math.round(Math.abs(L.mio - L.suyo) * 2) / 2 || 0.5;
        return '<div class="ml-game"><div class="ml-game-tag">' + esc(L.n) + '</div>'
          + '<div class="ml-bd-row"><div class="ml-bd-team"><b>You vs ' + esc(L.riv) + '</b>'
          + '<span class="mono">' + num(L.mio) + ' - ' + num(L.suyo) + '</span></div>'
          + '<div class="ml-cell mono">' + (fav ? '-' : '+') + sp + '</div>'
          + '<div class="ml-cell mono ' + (p >= 0.5 ? 'is-fav' : '') + '">' + americano(p) + '</div>'
          + '<div class="ml-cell mono">' + (Math.round(p * 1000) / 10) + '%</div></div></div>';
      }).join('');
      HOST.innerHTML = '<div class="da-pane">'
        + '<div class="ml-slate"><div class="ml-slate-n"><b>4</b><span>of 6 games favored</span></div>'
        + '<div class="ml-slate-n"><b class="mono">712</b><span>points on the field</span></div>'
        + '<div class="ml-slate-n"><b class="mono">54.8%</b><span>average shot</span></div></div>'
        + '<div class="ml-board"><div class="ml-board-h"><span>Your matchup</span><span>Spread</span><span>Money</span><span>Win</span></div>'
        + filas + '</div></div>';
      var g = HOST.querySelectorAll('.ml-game');
      for (var i = 0; i < g.length; i++) { g[i].style.animationDelay = (i * 90) + 'ms'; g[i].classList.add('da-in'); }
    } },
    { id: 'cruce', ms: 3200, pinta: function () {
      HOST.innerHTML = '<div class="da-pane da-center">'
        + '<div class="ml-conf da-conf"><h3>Rooting against yourself</h3>'
        + '<p class="ml-sub2">Yours in one league, across the field in another.</p>'
        + '<div class="ml-conf-list">'
        + [['Bijan Robinson', 4, 1], ['Puka Nacua', 3, 2], ['Brock Bowers', 2, 1]].map(function (r, i) {
          return '<div class="ml-conf-row da-in" style="animation-delay:' + (i * 140) + 'ms">'
            + escudo(r[0], 'is-sm')
            + '<div class="ml-conf-txt"><b>' + esc(r[0]) + '</b>'
            + '<span>' + r[1] + ' for you · ' + r[2] + ' against you</span></div>'
            + '<span class="ml-conf-tag mono">' + r[1] + 'v' + r[2] + '</span></div>';
        }).join('')
        + '</div></div></div>';
    } },
    { id: 'hub', ms: 3600, pinta: function () {
      HOST.innerHTML = '<div class="da-pane da-center">'
        + '<div class="da-hub"><div class="hb-code"><span class="hb-code-lbl">Invite code</span>'
        + '<b class="mono">7K2QW3</b></div>'
        + '<div class="da-join"><span id="da-joined">2</span> of 12 joined</div>'
        + '<div class="da-cap">One code opens your league to everyone in it</div></div></div>';
      var el = HOST.querySelector('#da-joined'), n = 2;
      var t = setInterval(function () {
        if (!el || !el.isConnected) return clearInterval(t);
        n++; el.textContent = n;
        el.classList.remove('da-bump'); void el.offsetWidth; el.classList.add('da-bump');
        if (n >= 9) clearInterval(t);
      }, 380);
    } }
  ];

  function siguiente() {
    if (!viva) return;
    idx = (idx + 1) % GUION.length;
    var e = GUION[idx];
    try { e.pinta(); } catch (_) { return parar(); }
    var barra = document.getElementById('da-bar');
    if (barra) {
      barra.style.transition = 'none'; barra.style.width = '0%';
      void barra.offsetWidth;
      barra.style.transition = 'width ' + e.ms + 'ms linear';
      barra.style.width = '100%';
    }
    reloj = setTimeout(siguiente, e.ms);
  }
  function arrancar() {
    if (viva) return;
    viva = true;
    // visibility, NO display: la imagen es la que le da altura al contenedor, y
    // con display:none la caja se aplasta y la animacion sale como una franja.
    // Sigue ocupando su sitio y sirviendo de medida.
    if (IMG) IMG.style.visibility = 'hidden';
    HOST.hidden = false;
    siguiente();
  }
  function parar() {
    viva = false;
    if (reloj) { clearTimeout(reloj); reloj = null; }
  }

  function init() {
    var caja = document.querySelector('.mk-hero-shot');
    if (!caja) return;
    IMG = caja.querySelector('img');
    // Movimiento reducido: se queda la captura fija, que enseña lo mismo.
    var reduce = false;
    try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { }
    if (reduce) return;

    HOST = document.createElement('div');
    HOST.className = 'da-frame';
    HOST.hidden = true;
    HOST.setAttribute('aria-hidden', 'true');
    var barra = document.createElement('div');
    barra.className = 'da-progress';
    barra.innerHTML = '<i id="da-bar"></i>';
    caja.appendChild(HOST);
    caja.appendChild(barra);

    // Arranca sola al entrar en pantalla; se para al salir y al irse la pestana
    // a segundo plano.
    try {
      var io = new IntersectionObserver(function (ent) {
        ent.forEach(function (x) { x.isIntersecting ? arrancar() : parar(); });
      }, { threshold: 0.25 });
      io.observe(caja);
    } catch (_) { arrancar(); }
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) parar();
      else if (HOST && !HOST.hidden) { viva = true; siguiente(); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
