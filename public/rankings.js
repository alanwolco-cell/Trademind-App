/* My Rankings: la lista del dueno de la cuenta, no la del consenso.
 *
 * Por que existe como archivo aparte: app.js pasa de 17.000 lineas y esto es un
 * modulo cerrado. No toca nada de app.js salvo por dos puentes explicitos al
 * final (tmMyRankOf y tmRankingsActivos), que son los que el board del mock
 * consulta para pintar con MIS puestos en vez del ADP.
 *
 * El dato de partida sale de /api/stats/adp, el mismo board que draftea el
 * motor. El usuario reordena y lo suyo manda: se guarda por ORDEN DE IDS, no
 * por posiciones absolutas, para que el dia que Sleeper mueva su ADP la lista
 * propia no se descoloque.
 *
 * Los cortes de tier se guardan como "despues de este jugador se corta", NO
 * como indices: un tier que vive en un indice se rompe en cuanto mueves a
 * alguien por encima, y la primera version hacia exactamente eso.
 */
'use strict';

var TMR = {
  fmt: 'ppr',
  rows: [],        // [{id,name,pos,team,adp,adpRank}]
  breakAfter: {},  // id -> true: despues de este jugador se corta el tier
  filter: 'ALL',
  q: '',
  loaded: false,
  drag: null
};

var TMR_KEY = 'tm_rankings_v1';
var TMR_USE_KEY = 'tm_rankings_use';
var TMR_LIMIT = 200; // top 200: mas abajo el ADP es ruido y la lista se vuelve inmanejable

function _tmrNorm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

/* ── persistencia ───────────────────────────────────────────────────────── */
function tmrSave() {
  try {
    localStorage.setItem(TMR_KEY, JSON.stringify({
      fmt: TMR.fmt,
      order: TMR.rows.map(function (r) { return r.id; }),
      breaks: Object.keys(TMR.breakAfter).filter(function (k) { return TMR.breakAfter[k]; }),
      updated: Date.now()
    }));
  } catch (_) { /* modo privado: la sesion sigue funcionando en memoria */ }
  var st = document.getElementById('rk-saved');
  if (st) {
    st.textContent = 'Saved';
    st.style.opacity = '1';
    clearTimeout(TMR._stT);
    TMR._stT = setTimeout(function () { st.style.opacity = '0'; }, 1400);
  }
}

function tmrLoadSaved() {
  try {
    var raw = localStorage.getItem(TMR_KEY);
    if (!raw) return null;
    var d = JSON.parse(raw);
    if (!d || !Array.isArray(d.order)) return null;
    return d;
  } catch (_) { return null; }
}

/* ── carga ──────────────────────────────────────────────────────────────── */
async function renderRankings() {
  var host = document.getElementById('rk-body');
  if (!host) return;
  if (TMR.loaded) { tmrPaint(); return; }

  host.innerHTML = tmrSkeleton();

  try {
    if (typeof loadAdp === 'function') await loadAdp(TMR.fmt);
  } catch (_) { }

  var src = window._adp;
  if (!src) {
    host.innerHTML = '<div class="rk-empty">The board did not load. Check your connection and open the tab again.</div>';
    return;
  }

  // el board llega indexado por nombre normalizado: lo paso a lista y lo ordeno
  // por ADP, que es el punto de partida antes de que el usuario opine
  var list = [];
  Object.keys(src).forEach(function (k) {
    var p = src[k];
    if (!p || !p.adp || !p.pos) return;
    if (p.pos === 'K' || p.pos === 'DEF') return; // nadie hace tiers de kickers
    list.push({ id: String(p._id || k), name: p.name || k, pos: p.pos, team: p.team || '', adp: p.adp });
  });
  list.sort(function (a, b) { return a.adp - b.adp; });
  list = list.slice(0, TMR_LIMIT);
  list.forEach(function (r, i) { r.adpRank = i + 1; });

  // el orden guardado manda sobre el ADP; los que no estaban guardados caen
  // detras en su orden de consenso, para que un board nuevo no borre tu lista
  var saved = tmrLoadSaved();
  if (saved) {
    var byId = {};
    list.forEach(function (r) { byId[r.id] = r; });
    var out = [], seen = {};
    saved.order.forEach(function (id) {
      if (byId[id] && !seen[id]) { out.push(byId[id]); seen[id] = 1; }
    });
    list.forEach(function (r) { if (!seen[r.id]) out.push(r); });
    list = out;
    TMR.breakAfter = {};
    (saved.breaks || []).forEach(function (id) { TMR.breakAfter[id] = true; });
  }

  TMR.rows = list;
  TMR.loaded = true;
  tmrPaint();
}

function tmrSkeleton() {
  var out = '<div class="rk-skel-wrap">';
  for (var i = 0; i < 12; i++) {
    out += '<div class="rk-skel-row"><div class="rk-skel-num"></div><div class="rk-skel-name"></div><div class="rk-skel-tag"></div></div>';
  }
  return out + '</div>';
}

/* ── pintado ────────────────────────────────────────────────────────────── */
function tmrPaint() {
  var host = document.getElementById('rk-body');
  if (!host) return;

  var q = _tmrNorm(TMR.q);
  var tier = 1, html = '', shown = 0;

  for (var i = 0; i < TMR.rows.length; i++) {
    var r = TMR.rows[i];
    var passPos = TMR.filter === 'ALL' || r.pos === TMR.filter;
    var passQ = !q || _tmrNorm(r.name).indexOf(q) >= 0 || _tmrNorm(r.team).indexOf(q) >= 0;

    if (passPos && passQ) {
      shown++;
      var mine = i + 1;
      var delta = r.adpRank - mine; // + = lo tengo mas alto que el consenso
      var dTxt = delta === 0 ? '' : (delta > 0 ? '+' + delta : String(delta));
      var dCls = delta > 0 ? 'rk-up' : (delta < 0 ? 'rk-down' : '');
      html += '<div class="rk-row" draggable="true" data-i="' + i + '" data-id="' + r.id + '"'
        + ' ondragstart="tmrDragStart(event,' + i + ')" ondragover="tmrDragOver(event,' + i + ')"'
        + ' ondrop="tmrDrop(event,' + i + ')" ondragend="tmrDragEnd(event)">'
        + '<span class="rk-num">' + mine + '</span>'
        + '<span class="rk-main">'
        + '<span class="rk-name">' + tmrEsc(r.name) + '</span>'
        + '<span class="rk-meta"><span class="rk-pos rk-' + r.pos + '">' + r.pos + '</span>'
        + (r.team ? '<span class="rk-team">' + tmrEsc(r.team) + '</span>' : '')
        + '<span class="rk-adp">ADP ' + r.adp.toFixed(1) + '</span>'
        + (dTxt ? '<span class="rk-delta ' + dCls + '" title="How far you move him off the consensus">' + dTxt + '</span>' : '')
        + '</span></span>'
        + '<span class="rk-acts">'
        + '<button type="button" class="rk-ib" title="Move up" aria-label="Move up ' + tmrEsc(r.name) + '" onclick="tmrMove(' + i + ',-1)">' + TMR_SVG_UP + '</button>'
        + '<button type="button" class="rk-ib" title="Move down" aria-label="Move down ' + tmrEsc(r.name) + '" onclick="tmrMove(' + i + ',1)">' + TMR_SVG_DOWN + '</button>'
        + '<button type="button" class="rk-ib rk-cut' + (TMR.breakAfter[r.id] ? ' on' : '') + '" title="Tier break after this player" aria-label="Tier break after ' + tmrEsc(r.name) + '" onclick="tmrCut(\'' + r.id + '\')">' + 'TIER' + '</button>'
        + '</span></div>';
    }

    if (TMR.breakAfter[r.id]) {
      tier++;
      // el separador solo se pinta si hay algo visible debajo: con un filtro
      // puesto, dos cortes seguidos dejaban rotulos de tier huerfanos
      if (passPos && passQ) html += '<div class="rk-tier"><span>Tier ' + tier + '</span></div>';
    }
  }

  if (!shown) {
    host.innerHTML = '<div class="rk-empty">No players match that filter.</div>';
  } else {
    host.innerHTML = '<div class="rk-tier rk-tier-first"><span>Tier 1</span></div>' + html;
  }

  var c = document.getElementById('rk-count');
  if (c) c.textContent = shown + ' of ' + TMR.rows.length;
}

function tmrEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

var TMR_SVG_UP = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 3.5 3.5 8h3v4.5h3V8h3z" fill="currentColor"/></svg>';
var TMR_SVG_DOWN = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 12.5 12.5 8h-3V3.5h-3V8h-3z" fill="currentColor"/></svg>';

/* ── edicion ────────────────────────────────────────────────────────────── */
function tmrMove(i, dir) {
  var j = i + dir;
  if (j < 0 || j >= TMR.rows.length) return;
  var t = TMR.rows[i];
  TMR.rows[i] = TMR.rows[j];
  TMR.rows[j] = t;
  tmrSave();
  tmrPaint();
}

function tmrCut(id) {
  if (TMR.breakAfter[id]) delete TMR.breakAfter[id];
  else TMR.breakAfter[id] = true;
  tmrSave();
  tmrPaint();
}

function tmrDragStart(e, i) {
  TMR.drag = i;
  try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); } catch (_) { }
  if (e.currentTarget && e.currentTarget.classList) e.currentTarget.classList.add('rk-dragging');
}
function tmrDragOver(e) { e.preventDefault(); try { e.dataTransfer.dropEffect = 'move'; } catch (_) { } }
function tmrDrop(e, to) {
  e.preventDefault();
  var from = TMR.drag;
  if (from == null || from === to) return;
  var moved = TMR.rows.splice(from, 1)[0];
  TMR.rows.splice(to, 0, moved);
  TMR.drag = null;
  tmrSave();
  tmrPaint();
}
function tmrDragEnd(e) {
  TMR.drag = null;
  if (e.currentTarget && e.currentTarget.classList) e.currentTarget.classList.remove('rk-dragging');
}

function tmrFilter(pos, el) {
  TMR.filter = pos;
  var bar = document.getElementById('rk-filters');
  if (bar) Array.prototype.forEach.call(bar.querySelectorAll('.rk-fb'), function (b) { b.classList.remove('active'); });
  if (el) el.classList.add('active');
  tmrPaint();
}

function tmrSearch(v) { TMR.q = v || ''; tmrPaint(); }

function tmrReset() {
  if (!confirm('This puts the list back in consensus order and clears your tiers. It cannot be undone.')) return;
  try { localStorage.removeItem(TMR_KEY); } catch (_) { }
  TMR.breakAfter = {};
  TMR.loaded = false;
  renderRankings();
}

/* Exportar en texto plano: es lo que la gente pega en su chat de liga o en una
 * hoja. Nada de descargas: el visor de artefactos y varios navegadores movil
 * bloquean la descarga que inicia la propia pagina. */
function tmrExport() {
  var out = [], tier = 1;
  out.push('Tier 1');
  TMR.rows.forEach(function (r, i) {
    out.push((i + 1) + '. ' + r.name + ' (' + r.pos + (r.team ? ' ' + r.team : '') + ')');
    if (TMR.breakAfter[r.id] && i < TMR.rows.length - 1) { tier++; out.push(''); out.push('Tier ' + tier); }
  });
  var txt = out.join('\n');
  var box = document.getElementById('rk-export-box');
  var ta = document.getElementById('rk-export-ta');
  if (box && ta) {
    ta.value = txt;
    box.style.display = 'block';
    ta.focus();
    ta.select();
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt);
  } catch (_) { }
}

function tmrCloseExport() {
  var box = document.getElementById('rk-export-box');
  if (box) box.style.display = 'none';
}

/* ── puentes hacia el resto de la app ───────────────────────────────────── */
/* El board del mock pregunta por aqui. Devuelve MI puesto (1-based) o null si
 * el jugador no esta en mi lista, para que quien llame decida si cae de vuelta
 * al ADP en vez de recibir un cero que parece un puesto buenisimo. */
function tmMyRankOf(name) {
  if (!TMR.loaded || !TMR.rows.length) return null;
  var n = _tmrNorm(name);
  if (!TMR._idx || TMR._idxN !== TMR.rows.length) {
    TMR._idx = {};
    TMR.rows.forEach(function (r, i) { TMR._idx[_tmrNorm(r.name)] = i + 1; });
    TMR._idxN = TMR.rows.length;
  }
  return TMR._idx[n] || null;
}

function tmRankingsActivos() {
  try { return localStorage.getItem(TMR_USE_KEY) === '1' && TMR.loaded && TMR.rows.length > 0; } catch (_) { return false; }
}

function tmrToggleUse(on) {
  try { localStorage.setItem(TMR_USE_KEY, on ? '1' : '0'); } catch (_) { }
}

/* El indice cacheado tiene que morir con cada reordenamiento, o el mock sigue
 * leyendo los puestos viejos. Se invalida donde se guarda, que es el unico
 * punto por el que pasan TODAS las ediciones. */
var _tmrSaveInner = tmrSave;
tmrSave = function () { TMR._idx = null; TMR._idxN = -1; _tmrSaveInner(); };

if (typeof window !== 'undefined') {
  window.renderRankings = renderRankings;
  window.tmrMove = tmrMove;
  window.tmrCut = tmrCut;
  window.tmrFilter = tmrFilter;
  window.tmrSearch = tmrSearch;
  window.tmrReset = tmrReset;
  window.tmrExport = tmrExport;
  window.tmrCloseExport = tmrCloseExport;
  window.tmrDragStart = tmrDragStart;
  window.tmrDragOver = tmrDragOver;
  window.tmrDrop = tmrDrop;
  window.tmrDragEnd = tmrDragEnd;
  window.tmrToggleUse = tmrToggleUse;
  window.tmMyRankOf = tmMyRankOf;
  window.tmRankingsActivos = tmRankingsActivos;

  /* Red de seguridad de la carrera de carga: el tab lo abre un onclick inline, y
   * con la red lenta el usuario puede pulsarlo ANTES de que este archivo exista.
   * El onclick va guardado con window.renderRankings&&... asi que no revienta,
   * pero entonces nadie pinta nunca. Al terminar de cargar, si el tab ya quedo
   * abierto, se pinta solo. Medido: sin esto el tab se queda en blanco y la
   * consola imprime un ReferenceError, que cuenta como bug. */
  try {
    var _t = document.getElementById('tab-rankings');
    if (_t && (_t.classList.contains('active') || _t.style.display === 'block')) renderRankings();
  } catch (_) { }
}
