# Historial de drafts: Yahoo + Sleeper

Cómo se saca el historial de drafts de Wolco y qué se puede afirmar con él.

## Por qué existe esto

El objetivo era meter su data histórica de fantasy en Mac Draft para ver
tendencias de draft. Sleeper ya se leía solo. Yahoo costó una noche entera
porque **las dos rutas obvias están cerradas**:

1. **La API oficial de Yahoo Fantasy pide aprobación humana.** Ya no es
   self-serve: hay que aplicar en `sports.yahoo.com/developer/access/` y lo
   revisa una persona. Con cookies de sesión devuelve `401
   oauth_problem="unable_to_determine_oauth_type"`. Verificado 26-ago-2026.
2. **El import de Sleeper no soporta Yahoo.** La extensión de Chrome de
   `sleeper.com/import` responde "Yahoo leagues are not supported yet".

Lo que sí funciona: leer las páginas de Yahoo con la sesión del propio usuario,
en un perfil de Chromium **dedicado**, nunca su Chrome personal.

## Mapa de URLs de Yahoo (lo caro de descubrir)

| Qué | URL | Nota |
|---|---|---|
| Inventario de ligas | `/f1/myleagues` | **La única puerta.** La portada solo muestra la temporada en curso |
| Liga, temporada actual | `/f1/<id>` | |
| Liga, temporada vieja | `/<año>/f1/<id>` | `f1` es el prefijo del año en curso; sin el año da "There was a problem" |
| Draft | `<liga>/draftresults` | Una tabla por ronda: pick, jugador, equipo. **Sin posición** |

Rutas muertas, ya probadas: `/f1/profile`, `/f1/leagues`, `/f1/allleagues`,
`/f1/pastleagues`, `/archive/nfl`, `?season=<año>`.

Dos trampas:

- **Yahoo no redirige a login.** Sirve una portada pública con HTTP 200, así que
  chequear `login.yahoo.com` en la URL da falso positivo. La señal real es que
  sin sesión aparece "Sign in" y hay **cero links `/f1/<id>>`**.
- **`/lastseason` no encadena.** Es "final rosters de la temporada pasada"
  dentro de la misma liga, no un enlace a la liga anterior. Yahoo **no tiene**
  equivalente al `previous_league_id` de Sleeper: cada temporada es un id suelto
  y hay que descubrirlo por el inventario.
- Las tarjetas de "League Renewal" **no traen el league_id**. Se emparejan por
  orden de aparición y el extractor **verifica** cargando cada liga y comparando
  el título. Si no cuadra, esa liga se marca y no entra al análisis.

## Comandos

```bash
npm run yahoo:login     # una vez: te logueas a mano en la ventana dedicada
npm run yahoo:probe     # diagnóstico: qué ruta de data responde
npm run yahoo:extract   # inventario + drafts -> scripts/data/yahoo-history-wolco.json
node scripts/yahoo/merge-drafts.mjs   # une Yahoo + Sleeper -> drafts-wolco.json
npm run yahoo:report    # informe de tendencias
npm test                # node --test tests/
```

El perfil vive en `~/.macdraft/yahoo-profile`, **aislado del Chrome personal**.
La sesión persiste; cuando caduca, `yahoo:extract` falla claro en vez de guardar
un JSON vacío que parezca éxito.

## El análisis

`server/lib/tendencias-draft.js` extiende `server/lib/perfil.js` sin tocarlo.

La idea que lo sostiene: **se compara contra los rivales de esa misma sala**, no
contra un promedio abstracto. Si toda tu liga va RB temprano, tu 61% de RB no es
una tendencia tuya, es la sala. Solo el contraste con los que estaban sentados
en esa mesa lo convierte en información. Eso lo resuelve
`permutacionContraRivales` de `perfil.js`.

Cinco ejes: RB, WR, QB y TE en las primeras 4 rondas, más K/DEF gastados antes
de las últimas dos rondas (normalizado por largo del draft: la ronda 12 de 15 no
es la misma decisión que la ronda 12 de 20).

Se corrige por comparaciones múltiples con **Benjamini-Hochberg** (`aplicarFDR`).
Cinco pruebas a alfa 0.05 producen un hallazgo falso una de cada cuatro veces
solo por azar; sin la corrección esto sería p-hacking bien presentado.
`aplicarFDR` además **borra el texto** de toda afirmación no confirmada, para que
no exista forma de imprimirla por accidente.

### Separar dynasty de redraft no es cosmético

En un draft de novatos de dynasty la ronda 1 no significa lo mismo que en un
redraft. Medido sobre la cuenta real, sin separar salía "RB temprano" confirmado
(p=0.025) y TE se caía (p=0.26); separando redraft, RB deja de ser señal
(p=0.072) y TE sí la tiene. Una de las dos lecturas es ruido, y es la que mezcla
peras con manzanas. Por eso la ruta llama a `analizarPorEjes`.

## Lo que falta

Los drafts de Yahoo viven solo en el archivo offline `drafts-wolco.json`. El
endpoint `/api/perfil` lee **solo Sleeper**. Para que Yahoo entre al producto
hace falta decidir dónde se guarda la data de Yahoo por usuario (Blob o
Supabase, ambos ya conectados en el repo) y que la ruta la mezcle.

Yahoo solo expone de 2023 en adelante en `/f1/myleagues`. Wolco dice que juega
desde ~2014; ese hueco (2014-2022) no aparece en la UI y no se sabe si está
escondido o borrado.
