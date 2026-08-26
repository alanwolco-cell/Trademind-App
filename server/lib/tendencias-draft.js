'use strict';
// Auto-scouting de drafts: que dice tu propio historial sobre como drafteas.
//
// Extiende el motor de perfil.js sin tocarlo. Reusa sus primitivas
// (permutacionContraRivales, claim, MIN_N) porque ya resuelven lo dificil:
// comparar contra los RIVALES DE LA SALA, no contra un promedio abstracto.
// Esa distincion es la feature. Si toda tu liga va RB temprano, tu 61% de RB
// no es una tendencia tuya, es la sala; solo el contraste con los que estaban
// sentados en esa misma mesa lo convierte en informacion.
//
// Misma regla que perfil.js: una afirmacion que no pasa su umbral NO se emite.
// Se devuelve "insuficiente" con cuanto falta, nunca una corazonada disfrazada.

const { permutacionContraRivales, aplicarFDR, RONDAS_TEMPRANAS, MIN_N } = require('./perfil');
const { ejeDeDosLados } = require('./formato');

const FANTASY = ['QB', 'RB', 'WR', 'TE'];

// Textos por posicion. Cada uno describe los DOS lados, porque el hallazgo
// interesante puede ser tanto que tomas de mas como que tomas de menos.
const TEXTOS = {
  RB: {
    a: (g, n) => `Construyes sobre running backs. En las primeras ${RONDAS_TEMPRANAS} rondas tomas más que ${g} de los ${n} rivales contra los que has drafteado.`,
    b: (g, n) => `Eres un drafteador zero-RB. En las primeras ${RONDAS_TEMPRANAS} rondas tomas menos running backs que ${n - g} de los ${n} rivales contra los que has drafteado.`
  },
  WR: {
    a: (g, n) => `Anclas en receptores. En las primeras ${RONDAS_TEMPRANAS} rondas tomas más WR que ${g} de los ${n} rivales contra los que has drafteado.`,
    b: (g, n) => `Dejas los receptores para después. En las primeras ${RONDAS_TEMPRANAS} rondas tomas menos WR que ${n - g} de los ${n} rivales contra los que has drafteado.`
  },
  QB: {
    a: (g, n) => `Pagas por quarterback temprano. En las primeras ${RONDAS_TEMPRANAS} rondas tomas más QB que ${g} de los ${n} rivales contra los que has drafteado.`,
    b: (g, n) => `Esperas en quarterback. En las primeras ${RONDAS_TEMPRANAS} rondas tomas menos QB que ${n - g} de los ${n} rivales contra los que has drafteado.`
  },
  TE: {
    a: (g, n) => `Buscas la ventaja en tight end. En las primeras ${RONDAS_TEMPRANAS} rondas tomas más TE que ${g} de los ${n} rivales contra los que has drafteado.`,
    b: (g, n) => `Dejas el tight end para el final. En las primeras ${RONDAS_TEMPRANAS} rondas tomas menos TE que ${n - g} de los ${n} rivales contra los que has drafteado.`
  }
};

// Kicker y defensa gastados antes de las ultimas dos rondas son la fuga mas
// barata de corregir que existe en fantasy: el costo de oportunidad es un
// boleto de loteria que se tira por un puesto que rota cada semana.
const TEXTOS_KDEF = {
  a: (g, n) => `Gastas kicker y defensa antes de tiempo. Los tomas más temprano que ${g} de los ${n} rivales contra los que has drafteado, y ese pick temprano vale más que cualquier kicker.`,
  b: (g, n) => `Dejas kicker y defensa para el final, como se debe. Los tomas más tarde que ${n - g} de los ${n} rivales contra los que has drafteado.`
};

/**
 * Agrupa los picks por draft y arma los "repartos" que espera el motor:
 * cuanto tomo yo de X contra cuanto tomo cada rival en esa misma sala.
 *
 * @param {Array} picks [{ liga, temporada, roster, ronda, pos, rondasTotales }]
 * @param {Object} miRosterPorDraft  { 'liga:temporada': rosterId }
 * @param {Function} cuenta  (pick) => boolean, que se cuenta para este eje
 */
function repartosPorDraft(picks, miRosterPorDraft, cuenta) {
  const porDraft = {};
  for (const k of picks || []) {
    const key = k.liga + ':' + k.temporada;
    (porDraft[key] = porDraft[key] || []).push(k);
  }
  const repartos = [];
  let mias = 0, misPicks = 0, drafts = 0;
  for (const [key, ks] of Object.entries(porDraft)) {
    // Se acepta la llave por draft ('liga:temporada') y tambien la llave por
    // liga a secas, que es como la arma la ruta /api/perfil. Ahi `liga` ya es
    // el league_id de Sleeper, unico por temporada, asi que no hay colision.
    // Con un nombre de liga repetido entre años SI la habria, y por eso la
    // llave por draft se intenta primero.
    const liga = ks[0].liga;
    const mio = miRosterPorDraft[key] !== undefined && miRosterPorDraft[key] !== null
      ? miRosterPorDraft[key]
      : miRosterPorDraft[liga];
    if (mio === undefined || mio === null) continue;
    // Todo roster presente en el draft entra al denominador, aunque tomara
    // CERO de la posicion: si solo contaran los que tomaron alguno, el extremo
    // de abajo desaparece y nadie podria salir por ese lado.
    const conteo = {};
    for (const k of ks) {
      conteo[k.roster] = conteo[k.roster] || 0;
      if (cuenta(k)) conteo[k.roster]++;
    }
    if (!(mio in conteo)) continue;
    drafts++;
    mias += conteo[mio];
    misPicks += ks.filter(k => k.roster === mio).length;
    const otros = Object.entries(conteo)
      .filter(([r]) => String(r) !== String(mio))
      .map(([, n]) => n);
    if (otros.length >= 2) repartos.push({ mio: conteo[mio], otros });
  }
  return { repartos, mias, misPicks, drafts };
}

/** Tendencia por posicion en rondas tempranas, contra los rivales de la sala. */
function tendenciaPosicion(picks, miRosterPorDraft, pos, corridas) {
  const tempranos = (picks || []).filter(k => k.ronda <= RONDAS_TEMPRANAS);
  const { repartos, mias, drafts } = repartosPorDraft(
    tempranos, miRosterPorDraft, k => k.pos === pos
  );
  // Semilla derivada del dato para que el resultado sea reproducible.
  const semilla = mias * 7919 + drafts * 31 + pos.charCodeAt(0);
  return permutacionContraRivales(
    'draft_' + pos.toLowerCase() + '_temprano', repartos, semilla, TEXTOS[pos], corridas
  );
}

/**
 * K/DEF gastados antes de las ultimas dos rondas.
 * Se normaliza por largo del draft: la ronda 12 de un draft de 15 no es la
 * misma decision que la ronda 12 de uno de 20.
 */
function tendenciaKickerDefensa(picks, miRosterPorDraft, corridas) {
  const esPronto = k => (k.pos === 'K' || k.pos === 'DEF')
    && k.rondasTotales && k.ronda <= k.rondasTotales - 2;
  const { repartos, mias, drafts } = repartosPorDraft(picks, miRosterPorDraft, esPronto);
  return permutacionContraRivales(
    'draft_kdef_temprano', repartos, mias * 7919 + drafts * 17, TEXTOS_KDEF, corridas
  );
}

/**
 * Descriptivo, NO inferencial: como se reparten tus picks tempranos por año.
 * No lleva p-valor y no debe presentarse como hallazgo, solo como historia.
 * Los años con menos de MIN_DRAFTS_ANIO drafts se marcan como flojos.
 */
const MIN_DRAFTS_ANIO = 2;
function mezclaPorAnio(picks, miRosterPorDraft) {
  const porAnio = {};
  const draftsVistos = {};
  for (const k of picks || []) {
    if (k.ronda > RONDAS_TEMPRANAS) continue;
    const key = k.liga + ':' + k.temporada;
    const mio = miRosterPorDraft[key] !== undefined && miRosterPorDraft[key] !== null
      ? miRosterPorDraft[key] : miRosterPorDraft[k.liga];
    if (mio === undefined || String(mio) !== String(k.roster)) continue;
    const a = k.temporada;
    porAnio[a] = porAnio[a] || { total: 0 };
    porAnio[a][k.pos] = (porAnio[a][k.pos] || 0) + 1;
    porAnio[a].total++;
    (draftsVistos[a] = draftsVistos[a] || new Set()).add(key);
  }
  return Object.entries(porAnio)
    .map(([anio, c]) => {
      const drafts = draftsVistos[anio].size;
      const pct = {};
      for (const p of FANTASY) pct[p] = c.total ? Math.round(100 * (c[p] || 0) / c.total) : 0;
      return {
        anio: +anio, drafts, picks: c.total, pct,
        solido: drafts >= MIN_DRAFTS_ANIO
      };
    })
    .sort((a, b) => a.anio - b.anio);
}

/**
 * Filtra los picks a un solo eje (dynasty o redraft).
 *
 * Es obligatorio y no cosmetico: en un draft de novatos de dynasty la ronda 1
 * no significa lo mismo que en un redraft, y mezclarlos mueve los resultados.
 * Medido sobre la cuenta real de Wolco (26-ago-2026): sin separar, "RB
 * temprano" salia confirmado con p=0.025 y TE se caia a p=0.26; separando
 * redraft, RB deja de ser señal (p=0.072) y TE si la tiene. Una de las dos
 * lecturas es ruido, y es la que mezcla peras con manzanas.
 */
function filtrarPorEje(picks, formatoPorLiga, eje) {
  if (!eje) return picks || [];
  return (picks || []).filter(
    k => ejeDeDosLados((formatoPorLiga || {})[k.liga] || 'redraft') === eje
  );
}

/**
 * Informe completo. Solo emite claims que pasan su umbral.
 *
 * Se corrige por comparaciones multiples (Benjamini-Hochberg, el aplicarFDR de
 * perfil.js): aqui se prueban cinco ejes de una sentada, y a cinco pruebas
 * independientes con alfa 0.05 le sale un "hallazgo" falso una de cada cuatro
 * veces solo por azar. Sin esta correccion el informe seria p-hacking con
 * buena presentacion. aplicarFDR ademas borra el texto de toda afirmacion no
 * confirmada, para que no exista forma de imprimirla por accidente.
 *
 * @param {Object} opciones { formatoPorLiga, eje, corridas }
 */
function analizar(picks, miRosterPorDraft, opciones) {
  const { corridas, formatoPorLiga, eje } = opciones || {};
  const p = filtrarPorEje(picks, formatoPorLiga, eje);
  const claims = aplicarFDR([
    ...FANTASY.map(x => tendenciaPosicion(p, miRosterPorDraft, x, corridas)),
    tendenciaKickerDefensa(p, miRosterPorDraft, corridas)
  ]);
  return {
    eje: eje || 'todos',
    claims,
    confirmados: claims.filter(c => c.estado === 'confirmado'),
    sinSenal: claims.filter(c => c.estado === 'sin_senal'),
    insuficientes: claims.filter(c => c.estado === 'insuficiente'),
    mezcla: mezclaPorAnio(p, miRosterPorDraft)
  };
}

/** Los dos ejes por separado, igual que construirPerfiles(). */
function analizarPorEjes(picks, miRosterPorDraft, opciones) {
  const salida = {};
  for (const eje of ['dynasty', 'redraft']) {
    salida[eje] = analizar(picks, miRosterPorDraft, { ...(opciones || {}), eje });
  }
  return salida;
}

module.exports = {
  analizar, analizarPorEjes, filtrarPorEje, tendenciaPosicion, tendenciaKickerDefensa,
  mezclaPorAnio, repartosPorDraft,
  FANTASY, RONDAS_TEMPRANAS, MIN_N, MIN_DRAFTS_ANIO
};
