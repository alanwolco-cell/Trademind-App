'use strict';
/* ── Mac's weekly sheet ──────────────────────────────────────────────────────
 * Rankings SEMANALES por posicion (QB/RB/WR/TE), publicos para todo el mundo
 * y editables SOLO por el dueno (la misma regla permitido() del servidor, via
 * GET /api/perfil/weekly que ya dice `owner`). Decidido el 2026-09-11:
 * firma del producto ("Mac's weekly sheet"), sin nombre propio.
 *
 * El documento vive en el servidor (perfil.js, Blob): UN doc con todas las
 * semanas. El publico solo recibe semanas publicadas; el dueno recibe tambien
 * sus borradores y edita desde cualquiera de sus dispositivos vinculados.
 * Start/Sit cita esta hoja por nombre (wkCite): señal declarada, nunca
 * mezclada en silencio con las proyecciones. */

var WK = {
  doc: null,        // el documento del servidor (borradores incluidos si owner)
  owner: false,
  players: null,    // id -> {name, pos, team, inj}
  proj: null,       // id -> pts (media PPR del feed oficial), para sembrar y como contexto
  projWeek: 0,
  week: 0,          // semana NFL en curso
  pos: 'RB',        // pestana de posicion activa
  editing: false,
  dirty: false,     // hay cambios sin confirmar por el servidor
  loaded: false,
  _syncT: null,
  _cargando: null
};
var WK_POS = ['QB', 'RB', 'WR', 'TE'];
// Cuantos siembra la proyeccion por posicion. El dueno recorta o añade.
var WK_SEED = { QB: 25, RB: 40, WR: 45, TE: 25 };

function wkEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function wkNorm(s) {
  return String(s || '').toLowerCase().replace(/[.'`]/g, '')
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/, '').replace(/\s+/g, ' ').trim();
}

/* ── datos ────────────────────────────────────────────────────────────────── */
async function wkPlayers() {
  if (WK.players) return WK.players;
  var r = await fetch('/api/sleeper/players/nfl/slim');
  if (!r.ok) throw new Error('players ' + r.status);
  var d = await r.json();
  var map = {};
  Object.keys(d).forEach(function (id) {
    var p = d[id];
    var pos = (p.fantasy_positions || []).filter(function (x) { return WK_POS.indexOf(x) >= 0; })[0];
    if (!pos) return; // K y DEF no van en la hoja (decidido 2026-09-11)
    map[id] = {
      name: ((p.first_name || '') + ' ' + (p.last_name || '')).trim(),
      pos: pos, team: p.team || 'FA', inj: p.injury_status || null
    };
  });
  WK.players = map;
  return map;
}

async function wkState() {
  if (WK.week) return WK.week;
  try {
    var r = await fetch('/api/sleeper/state/nfl');
    var st = r.ok ? await r.json() : null;
    WK.week = Math.max(1, Number(st && st.week) || 1);
  } catch (_) { WK.week = 1; }
  return WK.week;
}

async function wkProj(week) {
  if (WK.proj && WK.projWeek === week) return WK.proj;
  try {
    var r = await fetch('/api/sleeper/projections/' + week);
    var d = r.ok ? await r.json() : null;
    var out = {};
    Object.keys((d && d.players) || {}).forEach(function (id) {
      var s = d.players[id];
      var pts = s.pts_half_ppr != null ? s.pts_half_ppr : (s.pts_ppr != null ? s.pts_ppr : s.pts_std);
      if (typeof pts === 'number' && isFinite(pts)) out[id] = Math.round(pts * 10) / 10;
    });
    WK.proj = out; WK.projWeek = week;
  } catch (_) { WK.proj = WK.proj || {}; }
  return WK.proj;
}

async function wkDoc() {
  var r = await fetch('/api/perfil/weekly', { cache: 'no-store' });
  if (!r.ok) throw new Error('weekly ' + r.status);
  var j = await r.json();
  WK.owner = !!j.owner;
  WK.doc = (j.doc && typeof j.doc === 'object') ? j.doc : { v: 1, weeks: {} };
  if (!WK.doc.weeks || typeof WK.doc.weeks !== 'object') WK.doc.weeks = {};
  return WK.doc;
}

/* La ultima semana PUBLICADA que no sea futura. 0 = ninguna. */
function wkSemanaVisible() {
  var mejor = 0;
  Object.keys((WK.doc && WK.doc.weeks) || {}).forEach(function (w) {
    var n = Number(w), sem = WK.doc.weeks[w];
    if (sem && Number(sem.publishedAt) > 0 && n <= WK.week && n > mejor) mejor = n;
  });
  return mejor;
}

/* ── entrada del tab ─────────────────────────────────────────────────────── */
async function renderWeekly() {
  var host = document.getElementById('wk-body');
  if (!host) return;
  if (!WK.loaded) {
    host.innerHTML = '<div class="tm-skel-feed"><div class="tm-skel"></div><div class="tm-skel"></div><div class="tm-skel"></div></div>';
  }
  if (WK._cargando) return WK._cargando;
  WK._cargando = (async function () {
    try {
      await Promise.all([wkPlayers(), wkState(), wkDoc()]);
      await wkProj(WK.week);
      WK.loaded = true;
      wkPaint();
    } catch (e) {
      host.innerHTML = '<div class="rk-empty">Could not load the weekly sheet. <button class="ml-link" onclick="WK.loaded=false;WK._cargando=null;renderWeekly()">Try again</button></div>';
    } finally { WK._cargando = null; }
  })();
  return WK._cargando;
}

/* ── pintar ──────────────────────────────────────────────────────────────── */
function wkSemActiva() {
  // Editando: la semana en curso. Mirando: la ultima publicada.
  return WK.editing ? WK.week : wkSemanaVisible();
}

function wkPaint() {
  var host = document.getElementById('wk-body');
  if (!host) return;
  var sem = wkSemActiva();
  var datos = sem ? (WK.doc.weeks[String(sem)] || null) : null;
  var h = '';

  // Cabecera: que es esto, de que semana, y cuando se actualizo.
  var pub = datos && Number(datos.publishedAt) > 0 ? new Date(Number(datos.publishedAt)) : null;
  h += '<div class="wk-head">'
    + '<div><div class="wk-title">Mac\'s weekly sheet</div>'
    + '<div class="wk-sub">' + (sem
      ? 'Week ' + sem + ' · hand-ranked' + (pub ? ' · updated ' + pub.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : (WK.editing ? ' · draft, not published yet' : ''))
      : 'Start/Sit-ready ranks for the week, hand-made every week')
    + '</div></div>';
  if (WK.owner) {
    h += '<div class="wk-tools">'
      + (WK.editing
        ? '<button class="btn-sm" onclick="wkPublicar()">Publish week ' + WK.week + '</button>'
        + '<button class="ml-link" onclick="wkEditar(false)">Done</button>'
        : '<button class="btn-sm" onclick="wkEditar(true)">Edit week ' + WK.week + '</button>')
      + '<span id="wk-sync" class="rk-sync"></span></div>';
  }
  h += '</div>';

  if (!sem || !datos) {
    h += '<div class="rk-empty">'
      + (WK.owner
        ? 'No sheet for week ' + WK.week + ' yet. Hit <b>Edit week ' + WK.week + '</b>: it starts pre-seeded from the projections and you drag what you disagree with.'
        : 'No sheet published for this week yet. Check back before kickoff.')
      + '</div>';
    host.innerHTML = h;
    return;
  }

  // Selector de posicion, con el mismo seg control del resto del sitio.
  h += '<div class="ctx-seg wk-seg">' + WK_POS.map(function (p) {
    return '<button type="button" class="ctx-seg-btn' + (WK.pos === p ? ' active' : '') + '" onclick="wkPos(\'' + p + '\')">' + p + '</button>';
  }).join('') + '</div>';

  var ids = (datos.pos && datos.pos[WK.pos]) || [];
  if (!ids.length) {
    h += '<div class="rk-empty">No ' + WK.pos + 's ranked this week.</div>';
  } else {
    h += '<div class="wk-list">' + ids.map(function (id, i) { return wkFila(id, i, ids.length); }).join('') + '</div>';
  }

  if (WK.editing) {
    h += '<div class="wk-add"><input id="wk-add-q" class="tm-input" placeholder="Add a ' + WK.pos + ' to the list..." autocomplete="off" oninput="wkAddSugerir()">'
      + '<div id="wk-add-dd" class="ac-dropdown"></div></div>';
  }
  host.innerHTML = h;
}

function wkFila(id, i, total) {
  var p = WK.players[id] || { name: id, pos: '', team: '' };
  var proj = WK.proj && WK.proj[id];
  var edit = WK.editing;
  return '<div class="wk-row" data-id="' + wkEsc(id) + '"'
    + (edit ? ' draggable="true" ondragstart="wkDragStart(event,' + i + ')" ondragover="event.preventDefault()" ondrop="wkDrop(event,' + i + ')"' : '')
    + '>'
    + '<span class="wk-num mono">' + (i + 1) + '</span>'
    + '<span class="wk-pic"><img src="https://sleepercdn.com/content/nfl/players/thumb/' + wkEsc(id) + '.jpg" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'"></span>'
    + '<span class="wk-name">' + wkEsc(p.name)
    + (p.inj ? '<em class="wk-inj">' + wkEsc(p.inj) + '</em>' : '') + '</span>'
    + '<span class="wk-meta"><span class="wk-team">' + wkEsc(p.team || 'FA') + '</span>'
    + (proj != null ? '<span class="wk-proj mono" title="Official weekly projection, half PPR">' + proj.toFixed(1) + '</span>' : '')
    + '</span>'
    + (edit
      ? '<span class="rk-acts">'
      + '<button type="button" class="rk-ib" title="Move up" aria-label="Move up ' + wkEsc(p.name) + '" ' + (i === 0 ? 'disabled' : '') + ' onclick="wkMove(' + i + ',-1)">' + WK_SVG_UP + '</button>'
      + '<button type="button" class="rk-ib" title="Move down" aria-label="Move down ' + wkEsc(p.name) + '" ' + (i === total - 1 ? 'disabled' : '') + ' onclick="wkMove(' + i + ',1)">' + WK_SVG_DOWN + '</button>'
      + '<button type="button" class="rk-ib wk-del" title="Remove from the list" aria-label="Remove ' + wkEsc(p.name) + '" onclick="wkQuitar(' + i + ')">' + WK_SVG_X + '</button>'
      + '</span>'
      : '')
    + '</div>';
}
var WK_SVG_UP = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
var WK_SVG_DOWN = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>';
var WK_SVG_X = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

function wkPos(p) { WK.pos = p; wkPaint(); }

/* ── edicion (solo dueno) ────────────────────────────────────────────────── */
function wkEditar(on) {
  if (!WK.owner) return;
  WK.editing = !!on;
  if (on) {
    var w = String(WK.week);
    if (!WK.doc.weeks[w]) {
      // Sembrar del feed oficial: el dueno arrastra lo que no le cuadre,
      // nunca rankea 130 jugadores desde cero.
      var porPos = { QB: [], RB: [], WR: [], TE: [] };
      Object.keys(WK.proj || {}).forEach(function (id) {
        var p = WK.players[id];
        if (p && porPos[p.pos]) porPos[p.pos].push(id);
      });
      WK_POS.forEach(function (p) {
        porPos[p].sort(function (a, b) { return WK.proj[b] - WK.proj[a]; });
        porPos[p] = porPos[p].slice(0, WK_SEED[p]);
      });
      WK.doc.weeks[w] = { pos: porPos };
      wkGuardar();
    }
  }
  wkPaint();
}

function wkLista() {
  var sem = WK.doc.weeks[String(WK.week)];
  return sem && sem.pos && sem.pos[WK.pos];
}
function wkMove(i, d) {
  var ids = wkLista(); if (!ids) return;
  var j = i + d; if (j < 0 || j >= ids.length) return;
  var t = ids[i]; ids[i] = ids[j]; ids[j] = t;
  wkGuardar(); wkPaint();
}
function wkQuitar(i) {
  var ids = wkLista(); if (!ids) return;
  ids.splice(i, 1);
  wkGuardar(); wkPaint();
}
var _wkDragI = -1;
function wkDragStart(e, i) { _wkDragI = i; try { e.dataTransfer.effectAllowed = 'move'; } catch (_) { } }
function wkDrop(e, i) {
  e.preventDefault();
  var ids = wkLista(); if (!ids || _wkDragI < 0 || _wkDragI === i) { _wkDragI = -1; return; }
  var mov = ids.splice(_wkDragI, 1)[0];
  ids.splice(i, 0, mov);
  _wkDragI = -1;
  wkGuardar(); wkPaint();
}

function wkAddSugerir() {
  var q = wkNorm((document.getElementById('wk-add-q') || {}).value);
  var dd = document.getElementById('wk-add-dd');
  if (!dd) return;
  if (q.length < 2) { dd.innerHTML = ''; dd.style.display = 'none'; return; }
  var ids = wkLista() || [];
  var enLista = {}; ids.forEach(function (id) { enLista[id] = 1; });
  var hits = [];
  Object.keys(WK.players).some(function (id) {
    var p = WK.players[id];
    if (p.pos !== WK.pos || enLista[id]) return false;
    if (wkNorm(p.name).indexOf(q) < 0) return false;
    hits.push(id);
    return hits.length >= 6;
  });
  dd.innerHTML = hits.map(function (id) {
    var p = WK.players[id];
    return '<div class="ac-item" onmousedown="wkAdd(\'' + wkEsc(id) + '\')">' + wkEsc(p.name) + ' <span style="color:var(--muted);font-size:11px">' + wkEsc(p.team || 'FA') + '</span></div>';
  }).join('');
  dd.style.display = hits.length ? 'block' : 'none';
}
function wkAdd(id) {
  var ids = wkLista(); if (!ids) return;
  ids.push(id);
  wkGuardar(); wkPaint();
}

/* Guardado con debounce, como el booth: optimista en pantalla, el servidor
 * confirma detras. Si falla, queda dicho y se reintenta con el proximo toque. */
function wkGuardar() {
  WK.dirty = true;
  wkSync('Saving...');
  clearTimeout(WK._syncT);
  WK._syncT = setTimeout(wkPut, 700);
}
async function wkPut() {
  if (!WK.owner) return;
  WK.doc.updatedAt = Date.now();
  try {
    var r = await fetch('/api/perfil/weekly', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(WK.doc)
    });
    if (!r.ok) throw new Error('put ' + r.status);
    WK.dirty = false;
    wkSync('Saved');
    setTimeout(function () { if (!WK.dirty) wkSync(''); }, 1800);
  } catch (_) {
    wkSync('Not saved yet. It retries with your next change.', true);
  }
}
function wkSync(txt, warn) {
  var el = document.getElementById('wk-sync');
  if (el) { el.textContent = txt || ''; el.className = 'rk-sync' + (warn ? ' is-warn' : ''); }
}
async function wkPublicar() {
  var w = String(WK.week);
  var sem = WK.doc.weeks[w]; if (!sem) return;
  sem.publishedAt = Date.now();
  clearTimeout(WK._syncT);
  await wkPut();
  WK.editing = false;
  wkPaint();
}

/* ── la cita para Start/Sit ──────────────────────────────────────────────────
 * Devuelve el HTML de la linea que declara la hoja como fuente ('' si esta
 * semana no hay hoja o ninguno de los nombres esta en ella). La llama
 * askSageStartSit ANTES de la respuesta de Mac: la cita no depende del modelo. */
async function wkCite(nombres) {
  try {
    if (!WK.doc || !WK.players) { await Promise.all([wkPlayers(), wkState(), wkDoc()]); }
    var sem = wkSemanaVisible();
    if (!sem) return '';
    var datos = WK.doc.weeks[String(sem)];
    if (!datos || !datos.pos) return '';
    var idx = {};
    WK_POS.forEach(function (p) {
      (datos.pos[p] || []).forEach(function (id, i) {
        var pl = WK.players[id];
        if (pl) idx[wkNorm(pl.name)] = p + (i + 1);
      });
    });
    var partes = [];
    (nombres || []).forEach(function (n) {
      var rk = idx[wkNorm(n)];
      if (rk) partes.push(wkEsc(n) + ' is ' + rk);
    });
    if (!partes.length) return '';
    return '<div class="wk-cite">On <b>Mac\'s weekly sheet</b> (week ' + sem + '): ' + partes.join(' · ')
      + ' · <a href="#" onclick="event.preventDefault();switchScreen(\'research\');switchInnerTab(document.querySelector(\'#screen-research .inner-tab[onclick*=tab-weekly]\'),\'tab-weekly\',\'screen-research\');renderWeekly()">see the full sheet</a></div>';
  } catch (_) { return ''; }
}

window.renderWeekly = renderWeekly;
window.wkCite = wkCite;
