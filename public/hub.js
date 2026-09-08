/* ============================================================================
   EL HUB DE LIGA: la pantalla que ven los diez o doce, abierta con un codigo.

   Se llega por /hub?c=CODIGO. El que llega VE la liga sin cuenta y despues
   reclama su equipo. Tres pestanas: Booth (power rankings narrados), History
   (todas las temporadas que Sleeper todavia conserva) y Market (trade block,
   propuestas y el voto de la liga).

   REUSA la matematica de myleagues.js a proposito (mlScoring, mlBestLineup,
   mlProjPlayer, mlLoadProps). Copiarla aqui seria tener dos precios distintos
   para el mismo jugador en dos pantallas del mismo producto, que es exactamente
   la clase de bug que este repo ya pago dos veces.
   ============================================================================ */

var HUB = {
  code: null, doc: null, myTeamId: null,
  loading: false, err: null, ready: false,
  proj: {}, rank: [], tab: 'hub-booth'
};

function hbEsc(s) { return mlEsc(s); }
function hbN(n, d) { return mlN(n, d); }

function hbCodeFromUrl() {
  try {
    var u = new URL(location.href);
    var c = (u.searchParams.get('c') || '').toUpperCase();
    return /^[A-Z2-9]{6}$/.test(c) ? c : null;
  } catch (e) { return null; }
}

// La llave de cuenta NO se pone aqui: el envoltorio global de fetch (app.js,
// arriba del archivo) la adjunta a toda llamada /api/. Ponerla a mano seria un
// segundo sitio donde recordar hacerlo, que es como se olvida en el tercero.
async function hbApi(path, body) {
  var opt = {};
  if (body) {
    opt.method = 'POST';
    opt.headers = { 'Content-Type': 'application/json' };
    opt.body = JSON.stringify(body);
  }
  var r = await fetch('/api/liga' + path, opt);
  if (!r.ok) throw new Error('liga ' + r.status);
  return r.json();
}

/* ------------------------------------------------------------------ carga */
async function hbLoad(code) {
  HUB.code = code; HUB.loading = true; HUB.err = null;
  hbPaint();
  try {
    var d = await hbApi('/' + code);
    if (!d.found) { HUB.err = 'notfound'; HUB.ready = true; HUB.loading = false; hbPaint(); return; }
    HUB.doc = d.hub;
    HUB.myTeamId = d.myTeamId != null ? d.myTeamId : null;
    try { localStorage.setItem('tm_hub_last', code); } catch (e) { }
    await hbComputar();
    HUB.ready = true;
  } catch (e) {
    HUB.err = e.message || String(e);
    HUB.ready = true;
  }
  HUB.loading = false;
  hbPaint();
}

// El poder de cada equipo. Dos ejes explicitos, y la pantalla los declara:
// lo que PROYECTA su alineacion titular esta semana, y lo que ya HIZO en la
// temporada. En la semana 1 no hay historia, asi que manda la proyeccion.
async function hbComputar() {
  var doc = HUB.doc; if (!doc) return;
  var players = await mlPlayersMap();
  await mlLoadProps();
  var L = {
    roster_positions: doc.roster_positions || [],
    scoring_settings: doc.scoring_settings || {}
  };
  var sc = mlScoring(L);
  HUB.proj = {};
  (doc.rosters || []).forEach(function (r) {
    var res = mlBestLineup(r.players || [], L, sc, players);
    // Fondo de armario: lo que queda DESPUES de los titulares. Un equipo con
    // los mismos titulares y mejor banca aguanta una lesion; el otro no.
    var usados = {};
    res.lineup.forEach(function (x) { if (x.x) usados[x.x.id] = 1; });
    var banca = (r.players || []).map(function (pid) {
      var p = players[pid]; if (!p || usados[pid]) return null;
      var v = mlProjPlayer(p, sc);
      return v == null ? null : v;
    }).filter(function (v) { return v != null; }).sort(function (a, b) { return b - a; }).slice(0, 5);
    HUB.proj[r.teamId] = {
      titulares: res.total,
      cobertura: res.coverage,
      fondo: Math.round(banca.reduce(function (a, b) { return a + b; }, 0) * 10) / 10,
      lineup: res.lineup
    };
  });

  var eq = (doc.rosters || []).slice();
  var maxT = Math.max.apply(null, eq.map(function (r) { return HUB.proj[r.teamId].titulares; }).concat([1]));
  var juegos = eq.reduce(function (a, r) { return a + r.wins + r.losses + r.ties; }, 0);
  var maxP = Math.max.apply(null, eq.map(function (r) { return r.fpts; }).concat([1]));
  HUB.rank = eq.map(function (r) {
    var p = HUB.proj[r.teamId];
    var fuerza = p.titulares / (maxT || 1);
    var jug = r.wins + r.losses + r.ties;
    var hecho = jug ? (r.wins + r.ties * 0.5) / jug : 0;
    var anotado = maxP ? r.fpts / maxP : 0;
    // Sin partidos jugados el historial no existe y no se finge: el peso viaja
    // entero a la proyeccion.
    var peso = juegos ? 0.45 : 0;
    var score = fuerza * (1 - peso) + (hecho * 0.6 + anotado * 0.4) * peso;
    return { teamId: r.teamId, owner: r.owner, score: score, r: r, p: p };
  }).sort(function (a, b) { return b.score - a.score; });
  HUB.rank.forEach(function (x, i) { x.pos = i + 1; });
}

/* --------------------------------------------------------- la voz de Mac */
// Una linea por equipo, y SIEMPRE derivada de un numero que esta en pantalla.
// Nada de relleno: si no hay nada que decir, se dice lo que hay.
function hbLinea(x) {
  var todos = HUB.rank;
  var n = todos.length;
  var porFondo = todos.slice().sort(function (a, b) { return b.p.fondo - a.p.fondo; });
  var puestoFondo = porFondo.map(function (y) { return y.teamId; }).indexOf(x.teamId) + 1;
  var porTit = todos.slice().sort(function (a, b) { return b.p.titulares - a.p.titulares; });
  var puestoTit = porTit.map(function (y) { return y.teamId; }).indexOf(x.teamId) + 1;
  var jug = x.r.wins + x.r.losses + x.r.ties;

  if (puestoTit === 1 && puestoFondo <= Math.ceil(n / 3)) {
    return 'Best starters in the league and the bench to survive a bad Sunday.';
  }
  if (puestoTit <= 3 && puestoFondo >= n - 1) {
    return 'Third best starters, last in depth. One injury and this whole thing tilts.';
  }
  if (puestoFondo === 1 && puestoTit > Math.ceil(n / 2)) {
    return 'Deepest roster in the league, and none of it is starting. There is a trade in here.';
  }
  if (jug >= 3) {
    var esperado = puestoTit;
    var real = todos.slice().sort(function (a, b) { return (b.r.wins - a.r.wins) || (b.r.fpts - a.r.fpts); })
      .map(function (y) { return y.teamId; }).indexOf(x.teamId) + 1;
    if (real - esperado >= 3) return 'Record is ' + (real - esperado) + ' spots worse than this roster deserves. Bad luck, not a bad team.';
    if (esperado - real >= 3) return 'Winning ' + (esperado - real) + ' spots above what the roster projects. Enjoy it while it lasts.';
  }
  if (x.pos === n) return 'Last in the room. The rebuild starts with a phone call, not a waiver claim.';
  if (x.pos === 1) return 'Top of the league. Everyone else should be calling you, so name your price.';
  return 'Middle of the pack: ' + hbN(x.p.titulares) + ' projected, ' + puestoFondo + (puestoFondo === 1 ? 'st' : puestoFondo === 2 ? 'nd' : puestoFondo === 3 ? 'rd' : 'th') + ' in depth.';
}

/* --------------------------------------------------------------- pintado */
function hbPaint() {
  var host = document.getElementById('screen-hub');
  if (!host) return;
  hbPaintHead();
  hbPaintBooth();
  hbPaintHistory();
  hbPaintMarket();
}

function hbSk(n) { var h = ''; for (var i = 0; i < (n || 4); i++) h += '<div class="ml-sk"></div>'; return h; }

function hbPaintHead() {
  var el = document.getElementById('hub-head');
  if (!el) return;
  if (!HUB.code) {
    el.innerHTML = '<div class="ml-empty"><div class="ml-empty-h">Open a league</div>'
      + '<p>Paste the six character code a leaguemate sent you, or share one of your own leagues from All Leagues.</p>'
      + '<div class="ml-conn"><input id="hub-code" placeholder="Code" maxlength="6" autocapitalize="characters" '
      + 'autocorrect="off" spellcheck="false" inputmode="text" style="text-transform:uppercase">'
      + '<button class="btn-sm" onclick="hbOpenTyped()">Open</button></div>'
      + '<div id="hub-code-err" class="ml-err-line"></div></div>';
    return;
  }
  if (HUB.err === 'notfound') {
    el.innerHTML = '<div class="ml-empty"><div class="ml-empty-h">That code does not open anything</div>'
      + '<p>Codes are six characters. Check it with whoever sent it, or ask them to share the league again.</p>'
      + '<div class="ml-conn"><input id="hub-code" placeholder="Code" maxlength="6" style="text-transform:uppercase">'
      + '<button class="btn-sm" onclick="hbOpenTyped()">Open</button></div></div>';
    return;
  }
  if (!HUB.doc) { el.innerHTML = hbSk(2); return; }
  var d = HUB.doc;
  var mio = HUB.myTeamId != null;
  var link = location.origin + '/hub?c=' + d.code;
  el.innerHTML = '<div class="hb-head">'
    + '<div class="hb-title"><h2>' + hbEsc(d.name) + '</h2>'
    + '<span class="hb-meta">' + hbEsc(d.season) + ' · ' + (d.source.teams || d.rosters.length) + ' teams · '
    + Object.keys(d.members || {}).length + ' joined</span></div>'
    + '<div class="hb-code"><span class="hb-code-lbl">Invite code</span>'
    + '<b class="mono">' + hbEsc(d.code) + '</b>'
    + '<button class="btn-sm" onclick="hbCopy(\'' + hbEsc(link) + '\')">Copy link</button></div>'
    + '</div>'
    + (mio ? '' : hbClaimUI());
}

function hbClaimUI() {
  var d = HUB.doc;
  var tomados = d.members || {};
  return '<div class="hb-claim"><div class="hb-claim-h">Which team is yours?</div>'
    + '<p class="ml-sub2">Pick it once and this browser remembers. Nobody can take a team that is already claimed.</p>'
    + '<div class="hb-claim-grid">'
    + d.rosters.map(function (r) {
      var t = tomados[r.teamId];
      return '<button class="hb-team' + (t ? ' is-taken' : '') + '"' + (t ? ' disabled' : '')
        + ' onclick="hbClaim(' + r.teamId + ')">' + hbEsc(r.owner)
        + (t ? '<span>claimed</span>' : '') + '</button>';
    }).join('')
    + '</div></div>';
}

function hbPaintBooth() {
  var el = document.getElementById('hub-booth-body');
  if (!el) return;
  if (!HUB.doc) { el.innerHTML = HUB.code ? hbSk(5) : ''; return; }
  var jugados = (HUB.doc.rosters || []).reduce(function (a, r) { return a + r.wins + r.losses + r.ties; }, 0);
  var h = '<p class="ml-sub2">Power rankings from what each roster projects this week'
    + (jugados ? ' and what it has already done' : ' (nobody has played yet, so the record does not count)') + '.</p>';
  h += '<div class="hb-rank">';
  HUB.rank.forEach(function (x) {
    var mio = x.teamId === HUB.myTeamId;
    h += '<article class="hb-row' + (mio ? ' is-mine' : '') + '">'
      + '<div class="hb-pos mono">' + x.pos + '</div>'
      + '<div class="hb-main"><b>' + hbEsc(x.owner) + (mio ? ' <span class="hb-you">you</span>' : '') + '</b>'
      + '<span class="hb-line">' + hbEsc(hbLinea(x)) + '</span></div>'
      + '<div class="hb-nums"><span class="mono">' + hbN(x.p.titulares) + '</span>'
      + '<small>' + x.r.wins + '-' + x.r.losses + (x.r.ties ? '-' + x.r.ties : '') + '</small></div>'
      + '</article>';
  });
  h += '</div>';
  var cob = HUB.rank.length ? HUB.rank.reduce(function (a, x) { return a + x.p.cobertura; }, 0) / HUB.rank.length : 0;
  h += '<p class="ml-fine">Projections are built with this league\'s own scoring rules. '
    + Math.round(cob * 100) + '% of the starters across the league have a number of their own; the rest get their position\'s median.</p>';
  el.innerHTML = h;
}

function hbPaintHistory() {
  var el = document.getElementById('hub-history-body');
  if (!el) return;
  if (!HUB.doc) { el.innerHTML = ''; return; }
  var hist = HUB.doc.historia || [];
  if (!hist.length) {
    el.innerHTML = '<div class="ml-empty"><div class="ml-empty-h">No past seasons to show</div>'
      + '<p>This league has no earlier season linked to it. That happens when the commissioner starts a brand new league each year instead of renewing, and there is no way to recover what was never linked.</p></div>';
    return;
  }
  // Palmares: quien gano y cuantas veces. Es lo primero que discute una liga.
  var titulos = {}, apariciones = {};
  hist.forEach(function (t) {
    (t.standings || []).forEach(function (s) {
      apariciones[s.owner] = (apariciones[s.owner] || 0) + 1;
      if (t.champion != null && s.teamId === t.champion) titulos[s.owner] = (titulos[s.owner] || 0) + 1;
    });
  });
  var reyes = Object.keys(titulos).sort(function (a, b) { return titulos[b] - titulos[a]; });
  var h = '';
  if (reyes.length) {
    h += '<div class="hb-cups"><h3>Rings</h3><div class="hb-cups-list">'
      + reyes.map(function (n) {
        return '<div class="hb-cup"><b>' + hbEsc(n) + '</b><span class="mono">' + titulos[n] + '</span></div>';
      }).join('') + '</div></div>';
  }
  h += '<p class="ml-sub2">' + hist.length + ' past season' + (hist.length === 1 ? '' : 's')
    + ', pulled from the league chain and frozen: a finished season never changes again.</p>';
  hist.forEach(function (t) {
    var campeon = (t.standings || []).filter(function (s) { return s.teamId === t.champion; })[0];
    h += '<section class="hb-season"><header><b>' + hbEsc(t.season) + '</b>'
      + (campeon ? '<span class="hb-champ">' + hbEsc(campeon.owner) + '</span>'
        : '<span class="hb-champ is-none">no bracket recorded</span>') + '</header>'
      + '<div class="hb-tab">'
      + (t.standings || []).slice(0, 14).map(function (s, i) {
        return '<div class="hb-tab-row"><span class="mono">' + (i + 1) + '</span>'
          + '<b>' + hbEsc(s.owner) + '</b>'
          + '<span class="mono">' + s.wins + '-' + s.losses + (s.ties ? '-' + s.ties : '') + '</span>'
          + '<span class="mono hb-pf">' + hbN(s.fpts, 0) + '</span></div>';
      }).join('')
      + '</div></section>';
  });
  el.innerHTML = h;
}

/* ---------------------------------------------------------------- mercado */
function hbPaintMarket() {
  var el = document.getElementById('hub-market-body');
  if (!el) return;
  if (!HUB.doc) { el.innerHTML = ''; return; }
  var d = HUB.doc;
  var players = ML.players || {};
  var nombre = function (pid) {
    var p = players[pid];
    return p ? p.name : ('#' + pid);
  };
  var equipo = function (id) {
    var r = (d.rosters || []).filter(function (x) { return x.teamId === id; })[0];
    return r ? r.owner : ('Team ' + id);
  };

  var h = '';
  if (HUB.myTeamId == null) {
    h += '<div class="ml-empty"><div class="ml-empty-h">Claim your team to trade</div>'
      + '<p>You can read the market without claiming, but putting players on the block, proposing a trade or voting needs a team.</p></div>';
  } else {
    var mio = (d.block || {})[HUB.myTeamId] || {};
    h += '<section class="hb-mine"><h3>Your block</h3>'
      + '<p class="ml-sub2">What you are willing to move, and what you want back. Everyone in the league sees it.</p>'
      + '<textarea id="hb-block-note" class="hb-ta" maxlength="140" placeholder="One line: what you are after">'
      + hbEsc(mio.note || '') + '</textarea>'
      + '<div class="hb-sell">' + hbSellUI() + '</div>'
      + '<button class="btn-sm" onclick="hbSaveBlock()">Publish to the league</button>'
      + '<span id="hb-block-msg" class="ml-hint"></span></section>';
  }

  h += '<section class="hb-board"><h3>On the block</h3>';
  var conBloque = Object.keys(d.block || {}).filter(function (t) {
    var b = d.block[t];
    return b && ((b.selling || []).length || (b.note || '').trim());
  });
  if (!conBloque.length) {
    h += '<p class="ml-sub2">Nobody has posted yet. The first one to publish usually gets the best call back.</p>';
  } else {
    conBloque.forEach(function (t) {
      var b = d.block[t];
      h += '<div class="hb-blk"><div class="hb-blk-h"><b>' + hbEsc(equipo(Number(t))) + '</b>'
        + (b.note ? '<span>' + hbEsc(b.note) + '</span>' : '') + '</div>'
        + '<div class="hb-blk-list">'
        + (b.selling || []).map(function (pid) { return '<span class="hb-chip">' + hbEsc(nombre(pid)) + '</span>'; }).join('')
        + '</div></div>';
    });
  }
  h += '</section>';

  h += '<section class="hb-props"><h3>Proposals</h3>';
  var props = (d.proposals || []).slice().reverse();
  if (!props.length) {
    h += '<p class="ml-sub2">No proposals yet. A trade posted here is visible to the whole league, and the league votes on it.</p>';
  } else {
    props.forEach(function (p) {
      var si = 0, no = 0;
      Object.keys(p.votes || {}).forEach(function (k) { p.votes[k] === 'yes' ? si++ : no++; });
      var puedoVotar = HUB.myTeamId != null && HUB.myTeamId !== p.from && HUB.myTeamId !== p.to;
      var yaVote = HUB.myTeamId != null && (p.votes || {})[String(HUB.myTeamId)];
      h += '<div class="hb-prop"><div class="hb-prop-h"><b>' + hbEsc(equipo(p.from)) + '</b>'
        + '<span class="hb-arrow">gives</span>'
        + '<span>' + (p.give || []).map(nombre).map(hbEsc).join(', ') + '</span></div>'
        + '<div class="hb-prop-h"><b>' + hbEsc(equipo(p.to)) + '</b>'
        + '<span class="hb-arrow">gives</span>'
        + '<span>' + (p.get || []).map(nombre).map(hbEsc).join(', ') + '</span></div>'
        + (p.note ? '<p class="hb-prop-note">' + hbEsc(p.note) + '</p>' : '')
        + '<div class="hb-vote"><span class="mono">' + si + ' fair · ' + no + ' veto</span>'
        + (puedoVotar && !yaVote
          ? '<button class="btn-sm" onclick="hbVote(\'' + hbEsc(p.id) + '\',\'yes\')">Fair</button>'
            + '<button class="btn-sm" onclick="hbVote(\'' + hbEsc(p.id) + '\',\'no\')">Veto</button>'
          : '<span class="ml-hint">' + (yaVote ? 'you voted ' + yaVote
            : (HUB.myTeamId == null ? 'claim a team to vote' : 'you are in this trade')) + '</span>')
        + '</div></div>';
    });
  }
  h += '</section>';
  el.innerHTML = h;
}

// El selector de a quien pones en venta: tu propio plantel, nada mas.
function hbSellUI() {
  var d = HUB.doc;
  var mio = (d.rosters || []).filter(function (r) { return r.teamId === HUB.myTeamId; })[0];
  if (!mio) return '';
  var players = ML.players || {};
  var yaVende = ((d.block || {})[HUB.myTeamId] || {}).selling || [];
  return (mio.players || []).map(function (pid) {
    var p = players[pid]; if (!p) return '';
    var on = yaVende.indexOf(pid) !== -1;
    return '<label class="hb-sell-item' + (on ? ' is-on' : '') + '">'
      + '<input type="checkbox" value="' + hbEsc(pid) + '"' + (on ? ' checked' : '') + '>'
      + hbEsc(p.name) + ' <small>' + hbEsc(p.pos) + '</small></label>';
  }).join('');
}

/* ------------------------------------------------------------- acciones */
function hbOpenTyped() {
  var el = document.getElementById('hub-code');
  var v = ((el && el.value) || '').toUpperCase().replace(/[^A-Z2-9]/g, '');
  var err = document.getElementById('hub-code-err');
  if (v.length !== 6) { if (err) err.textContent = 'A code is six characters.'; return; }
  hbGo(v);
}
function hbGo(code) {
  try { history.pushState({ screen: 'hub' }, '', '/hub?c=' + code); } catch (e) { }
  HUB.doc = null; HUB.ready = false; HUB.err = null; HUB.myTeamId = null;
  hbLoad(code);
}
async function hbClaim(teamId) {
  try {
    var d = await hbApi('/' + HUB.code + '/claim', { teamId: teamId });
    if (d.taken) { alert('Someone already claimed that team.'); await hbLoad(HUB.code); return; }
    if (d.ok) { HUB.doc = d.hub; HUB.myTeamId = d.myTeamId; await hbComputar(); hbPaint(); }
  } catch (e) { alert('Could not claim that team. Try again.'); }
}
async function hbSaveBlock() {
  var msg = document.getElementById('hb-block-msg');
  var nota = (document.getElementById('hb-block-note') || {}).value || '';
  var sel = [].slice.call(document.querySelectorAll('.hb-sell-item input:checked')).map(function (i) { return i.value; });
  if (msg) msg.textContent = 'Publishing...';
  try {
    var d = await hbApi('/' + HUB.code + '/block', { selling: sel, wanting: [], note: nota });
    if (d.ok) { HUB.doc = d.hub; hbPaintMarket(); var m2 = document.getElementById('hb-block-msg'); if (m2) m2.textContent = 'Published'; }
    else if (msg) msg.textContent = 'Claim your team first.';
  } catch (e) { if (msg) msg.textContent = 'Could not publish. Try again.'; }
}
async function hbVote(id, v) {
  try {
    var d = await hbApi('/' + HUB.code + '/vote', { id: id, vote: v });
    if (d.ok) { HUB.doc = d.hub; hbPaintMarket(); }
  } catch (e) { }
}
function hbCopy(link) {
  try {
    navigator.clipboard.writeText(link);
    if (window.__macToast) window.__macToast('Link copied. Paste it in the league chat.');
  } catch (e) { prompt('Copy this link', link); }
}

/* --------------------------------------------------------------- entrada */
function renderHub() {
  var c = hbCodeFromUrl();
  if (c && c !== HUB.code) { hbLoad(c); return; }
  if (!c && !HUB.code) { hbPaint(); return; }
  hbPaint();
}

(function () {
  var s = document.getElementById('screen-hub');
  if (s && s.classList.contains('active')) renderHub();
})();

window.renderHub = renderHub;
window.hbOpenTyped = hbOpenTyped;
window.hbGo = hbGo;
window.hbClaim = hbClaim;
window.hbSaveBlock = hbSaveBlock;
window.hbVote = hbVote;
window.hbCopy = hbCopy;
