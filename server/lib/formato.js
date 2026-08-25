'use strict';
// Que clase de liga es esta: dynasty, keeper o redraft.
//
// Existe porque la respuesta cambia el significado de casi todo lo que el
// producto afirma. Acumular picks en dynasty es construir; en redraft es mover
// fichas de una temporada que se acaba. La edad de un jugador manda en dynasty y
// no significa nada en redraft. Un perfil que mezcle los tres formatos no esta
// midiendo a un manager, esta promediando a tres managers distintos.
//
// Hasta hoy esta decision vivia copiada A MANO en dos sitios de public/app.js,
// identica y sin nombre, y NUNCA habia llegado al motor del perfil, que por eso
// mezclaba los tres formatos en el mismo saco. Es la misma clase de fallo que ya
// habia mordido al proyecto: el criterio correcto escrito y sin propagar.
//
// El keeper es el tercer formato y no es un detalle: Sleeper lo marca aparte
// (type 1) y el propio Mac ya lo trata distinto ("redraft values are the
// baseline... never apply full dynasty logic", server/routes/sage.js). Meterlo
// en dynasty inflaba las conclusiones de dynasty; meterlo en redraft en
// silencio las ensuciaba. Aqui se clasifica como lo que es y quien lo agrupe
// que lo haga a sabiendas.

// Sleeper: league.settings.type. 0 = redraft, 1 = keeper, 2 = dynasty.
const TIPO_SLEEPER = { 0: 'redraft', 1: 'keeper', 2: 'dynasty' };

/**
 * @param {Object} liga  liga de Sleeper (necesita settings.type, o name para el respaldo)
 * @returns {{formato:'dynasty'|'keeper'|'redraft', fuente:'settings'|'nombre'|'defecto'}}
 *
 * `fuente` no es decorativa: dice si la clasificacion es un DATO o una
 * ADIVINANZA. Quien la use para afirmar algo tiene que poder decir cuantas
 * ligas entraron por el respaldo, porque el respaldo se equivoca (una liga de
 * redraft llamada "Dynasty Warriors" cae del lado que no es).
 */
function clasificarLiga(liga) {
  const t = liga && liga.settings && liga.settings.type;
  if (t != null && TIPO_SLEEPER[t]) return { formato: TIPO_SLEEPER[t], fuente: 'settings' };

  // Respaldo solo cuando Sleeper no dijo nada. Se busca la palabra entera: sin
  // el limite, "dynastic" o un nombre que la lleve pegada disparaban igual.
  const nombre = String((liga && liga.name) || '').toLowerCase();
  if (/\bdynasty\b/.test(nombre)) return { formato: 'dynasty', fuente: 'nombre' };
  if (/\bkeeper\b/.test(nombre)) return { formato: 'keeper', fuente: 'nombre' };

  // Sin senal de ningun tipo, redraft es lo mas comun con diferencia. Se declara
  // como defecto para que nadie lo confunda con una lectura.
  return { formato: 'redraft', fuente: 'defecto' };
}

/**
 * El eje de DOS lados que ve el usuario, que no es el mismo que los tres
 * formatos reales. Keeper cae del lado de redraft porque su base de valor es la
 * de redraft, pero quien agrupe tiene que contar cuantas eran keeper y decirlo:
 * la agrupacion es una decision de producto, no un hecho de la liga.
 */
function ejeDeDosLados(formato) {
  return formato === 'dynasty' ? 'dynasty' : 'redraft';
}

module.exports = { clasificarLiga, ejeDeDosLados, TIPO_SLEEPER };
