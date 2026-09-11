#!/usr/bin/env node
// Gate del push: rutas con sus guardas, el service worker sin manejador de
// fetch (candado contra un cache accidental), y el disparo del hub de punta a
// punta con PUSH_DRY (nada sale a la red de push). Sin navegador: el push del
// lado del cliente necesita permisos de un navegador real y eso no se
// automatiza honesto; lo que si se mide es todo lo que decide el servidor.
'use strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.QA_PORT || 3460;
const BASE = 'http://localhost:' + PORT;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-push-'));
const DRY = path.join(TMP, 'dry.json');
const LIGAS = path.join(TMP, 'ligas');
fs.mkdirSync(LIGAS, { recursive: true });

let fallos = 0;
const ok = (n, cond, det) => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + n + (cond ? '' : '\n      ' + (det || '')));
  if (!cond) fallos++;
};

// Un hub sembrado a mano en el almacen local, con DOS miembros: el disparo
// del claim/bet necesita a alguien del otro lado.
// Las LLAVES viajan en el header; el servidor guarda su HASH (identity.js).
// El fixture del hub tiene que sembrar el hash, que es como quedaria un
// miembro real; usar la llave cruda fue el primer fallo de este gate.
const KEY_A = 'qa_push_aaaaaaaaaaaaaaaaaaaaaaaaaa';
const KEY_B = 'qa_push_bbbbbbbbbbbbbbbbbbbbbbbbbb';
import('node:crypto');
const { createHash } = await import('node:crypto');
const hashDe = (k) => createHash('sha256').update(String(k)).digest('hex').slice(0, 32);
const ACCT_A = hashDe(KEY_A), ACCT_B = hashDe(KEY_B);
const HUBDOC = {
  code: 'QAPUSH', v: 1, name: 'Push QA League', season: '2026',
  source: { teams: 4 }, createdBy: ACCT_A, createdAt: Date.now(), updatedAt: Date.now(),
  roster_positions: ['QB', 'RB', 'WR', 'BN'], scoring_settings: { rec: 1 },
  rosters: [
    { teamId: 1, owner: 'Alpha', players: [], wins: 0, losses: 0, ties: 0, fpts: 0 },
    { teamId: 2, owner: 'Bravo', players: [], wins: 0, losses: 0, ties: 0, fpts: 0 },
    { teamId: 3, owner: 'Charlie', players: [], wins: 0, losses: 0, ties: 0, fpts: 0 },
    { teamId: 4, owner: 'Delta', players: [], wins: 0, losses: 0, ties: 0, fpts: 0 }
  ],
  members: {
    [ACCT_A]: { teamId: 1, name: 'Alpha', role: 'commish', joinedAt: Date.now() }
  },
  proposals: [], bets: [], history: []
};
fs.writeFileSync(path.join(LIGAS, 'QAPUSH.json'), JSON.stringify(HUBDOC));

const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  env: {
    ...process.env, PORT: String(PORT),
    PERFIL_RK_STORE: 'local', PUSH_FILE: path.join(TMP, 'subs.json'),
    LIGA_STORE: 'local', LIGA_DIR: LIGAS,
    PUSH_DRY: '1', PUSH_DRY_FILE: DRY,
    CRON_SECRET: 'qa-secreto'
  }, stdio: 'ignore'
});
for (let i = 0; i < 40; i++) {
  try { const r = await fetch(BASE + '/'); if (r.ok) break; } catch (_) { }
  await new Promise(r => setTimeout(r, 500));
}

const j = (u, opts) => fetch(BASE + u, opts).then(async r => ({ st: r.status, ct: r.headers.get('content-type') || '', body: await r.json().catch(() => null) }));
const conAcct = (acct, body) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-tm-acct': acct },
  body: JSON.stringify(body)
});

console.log('== PUSH ==  ' + BASE + '\n');

// (a) la llave publica siempre contesta 200
const va = await j('/api/push/vapid');
ok('(a) /vapid responde 200 JSON y declara la llave (o null)', va.st === 200 && va.body && 'key' in va.body, JSON.stringify(va));

// (b) sin llave de cuenta no hay alta
const sinLlave = await j('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
ok('(b) subscribe sin cuenta rebota 401', sinLlave.st === 401, JSON.stringify(sinLlave.st));

// (c) cuerpo malformado rebota 400
const malo = await j('/api/push/subscribe', conAcct(KEY_B, { subscription: { endpoint: 'ftp://no' } }));
ok('(c) una suscripcion malformada rebota 400', malo.st === 400, JSON.stringify(malo));

// (d) alta buena, y re-suscribirse NO duplica el dispositivo
const sub = { endpoint: 'https://push.example/qa-1', keys: { p256dh: 'k'.repeat(20), auth: 'a'.repeat(10) } };
const alta1 = await j('/api/push/subscribe', conAcct(KEY_B, { subscription: sub, username: 'wolco' }));
const alta2 = await j('/api/push/subscribe', conAcct(KEY_B, { subscription: sub, username: 'wolco' }));
ok('(d) el alta guarda el dispositivo y repetirla no lo duplica',
  alta1.st === 200 && alta1.body.devices === 1 && alta2.body.devices === 1,
  JSON.stringify({ alta1: alta1.body, alta2: alta2.body }));

// (e) el service worker existe, escucha push, y NO tiene manejador de fetch
const sw = await fetch(BASE + '/sw.js').then(r => r.text()).catch(() => '');
ok('(e) sw.js escucha push y notificationclick',
  /addEventListener\('push'/.test(sw) && /addEventListener\('notificationclick'/.test(sw), sw.slice(0, 80));
ok('(e2) CANDADO: sw.js no tiene manejador de fetch (nada de cache accidental)',
  !/addEventListener\(\s*['"]fetch['"]/.test(sw));

// A tambien se suscribe: el aviso solo viaja a quien tiene dispositivo, y
// sin esto el disparo se probaria contra una lista vacia (el "todos cumplen"
// sobre lista vacia que este repo ya conoce).
const subA = { endpoint: 'https://push.example/qa-A', keys: { p256dh: 'k'.repeat(20), auth: 'a'.repeat(10) } };
const altaA = await j('/api/push/subscribe', conAcct(KEY_A, { subscription: subA, username: 'demoA' }));
ok('(d2) la segunda cuenta tambien queda suscrita', altaA.st === 200 && altaA.body.devices === 1, JSON.stringify(altaA.body));

// (f) el disparo del hub: B reclama equipo -> A (miembro suscrito) recibe
const claim = await j('/api/liga/QAPUSH/claim', conAcct(KEY_B, { teamId: 2 }));
await new Promise(r => setTimeout(r, 600));
let dry = []; try { dry = JSON.parse(fs.readFileSync(DRY, 'utf8')); } catch (_) { }
const aviso = dry[dry.length - 1];
ok('(f) reclamar equipo dispara el aviso a los OTROS miembros',
  claim.st === 200 && claim.body && claim.body.ok === true && aviso
  && aviso.a.indexOf(ACCT_A) !== -1 && aviso.a.indexOf(ACCT_B) === -1
  && /claimed/.test(aviso.payload.body) && aviso.payload.url === '/hub?c=QAPUSH',
  JSON.stringify({ claim: claim.body, aviso }));

// (g) la side bet tambien avisa, y nunca al que la abrio
const antes = dry.length;
const bet = await j('/api/liga/QAPUSH/bet', conAcct(KEY_B, { desc: 'Loser wears the jersey', stake: 'Dinner' }));
await new Promise(r => setTimeout(r, 600));
try { dry = JSON.parse(fs.readFileSync(DRY, 'utf8')); } catch (_) { }
const aviso2 = dry[dry.length - 1];
ok('(g) la side bet avisa a los demas, no al que la abrio',
  bet.st === 200 && dry.length > antes && aviso2.a.indexOf(ACCT_A) !== -1 && aviso2.a.indexOf(ACCT_B) === -1
  && /side bet/.test(aviso2.payload.body), JSON.stringify({ bet: bet.body, aviso2 }));

// (h) el cron del lunes exige su secreto
const sinSec = await j('/api/push/recap');
const conSec = await j('/api/push/recap', { headers: { authorization: 'Bearer qa-secreto' } });
ok('(h) /recap sin el secreto del cron rebota 401 y con el contesta 200',
  sinSec.st === 401 && conSec.st === 200 && conSec.body && conSec.body.ok === true,
  JSON.stringify({ sin: sinSec.st, con: conSec.st, body: conSec.body }));

// (i) darse de baja borra el dispositivo
const baja = await j('/api/push/unsubscribe', conAcct(KEY_B, { endpoint: sub.endpoint }));
const altaOtra = await j('/api/push/subscribe', conAcct(KEY_B, { subscription: { endpoint: 'https://push.example/qa-2', keys: sub.keys }, username: 'wolco' }));
ok('(i) la baja borra el dispositivo (el alta siguiente vuelve a contar 1)',
  baja.st === 200 && altaOtra.body && altaOtra.body.devices === 1, JSON.stringify(altaOtra.body));

srv.kill();
console.log('\n' + (fallos ? fallos + ' FALLOS' : 'PUSH ALL GREEN'));
process.exit(fallos ? 1 : 0);
