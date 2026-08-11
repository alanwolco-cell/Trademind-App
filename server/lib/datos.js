// Acceso a Postgres (Supabase) por su API REST.
//
// Se usa REST y no una conexion directa a Postgres a proposito: no hace falta
// la contrasena de la base, no hay pool que administrar en serverless, y la
// service_role key ya vive en las variables de entorno de Vercel.
//
// service_role salta RLS por diseno. Nunca debe llegar al navegador: este
// archivo solo se importa desde server/.

const fetch = require('node-fetch');

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const configurado = () => !!(URL && KEY);

function cabeceras(esquema, extra = {}) {
  return {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    'Content-Type': 'application/json',
    // PostgREST elige el esquema por cabecera: Accept-Profile para leer,
    // Content-Profile para escribir. Sin esto pega contra "public".
    'Accept-Profile': esquema,
    'Content-Profile': esquema,
    ...extra,
  };
}

// Timeout corto y explicito: si la base no responde, quien llama decide que
// hacer. Un billing colgado es peor que un billing que falla rapido.
async function pedir(ruta, opciones = {}, esquema = 'public', ms = 6000) {
  if (!configurado()) throw new Error('SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY sin configurar');

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(`${URL}/rest/v1/${ruta}`, {
      ...opciones,
      headers: cabeceras(esquema, opciones.headers),
      signal: ctrl.signal,
    });
    const texto = await r.text();
    if (!r.ok) throw new Error(`supabase ${r.status}: ${texto.slice(0, 300)}`);
    return texto ? JSON.parse(texto) : null;
  } finally {
    clearTimeout(t);
  }
}

const seleccionar = (tabla, query, esquema) =>
  pedir(`${tabla}?${query}`, { method: 'GET' }, esquema);

// upsert de verdad: si la fila existe, se actualiza. Es lo que permite que
// esto sea repetible sin duplicar nada.
const guardar = (tabla, filas, esquema, conflicto) =>
  pedir(`${tabla}${conflicto ? `?on_conflict=${conflicto}` : ''}`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(Array.isArray(filas) ? filas : [filas]),
  }, esquema);

module.exports = { configurado, seleccionar, guardar };
