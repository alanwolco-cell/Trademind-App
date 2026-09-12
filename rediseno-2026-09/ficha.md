# Mac Draft: ficha de diseño y referencias

Repo: `/Users/wolco/Development/trademind-app` (nombre viejo, el producto se llama Mac Draft).
Dominios reales: macdraft.app y trademindff.com. Servido por `server/index.js` con
`express.static('../public')` y `res.sendFile('../public/index.html')` para todas las
rutas de `SPA_ROUTES`. **`public/index.html` es el HTML real.** `trade-mind.html` en la
raíz del repo (101 KB) no está referenciado en ningún lado del código ni del build: es
residuo del pivote de nombre y no se sirve nunca.

---

## TAREA 1: lo que el proyecto ya tiene

### Paleta (valores resueltos, sin redondear)

Tema oscuro, `public/styles.css:9-45` (es el que carga por defecto; el claro es
override en `[data-theme="light"]`):

| Variable | Valor | Uso |
|---|---|---|
| `--bg` | `#050507` | fondo de página, `<body>`, arranque PWA |
| `--surface` | `#121214` | tarjetas (`.card`), panel de login |
| `--surface2` | `#1c1c20` | inputs, chips, fila de liga |
| `--surface3` | `#2a2a30` | avatares placeholder, thumbs |
| `--border` | `rgba(255,255,255,.08)` | bordes por defecto |
| `--border2` | `rgba(255,255,255,.15)` | bordes de tarjeta |
| `--text` | `#ffffff` | texto principal |
| `--muted` | `#9a9aa5` | texto secundario |
| `--muted2` | `#c6c6ce` | texto terciario, algo más de contraste |
| `--accent` | `#7c5cbf` | morado base |
| `--accent-bright` | `#9b72e8` | morado de acento, CTAs secundarios, foco |
| `--accent-btn` | `#7c47e1` | fondo del botón primario |
| `--accent-dim` | `rgba(155,114,232,.13)` | fondos tenues de hover/selección |
| `--green` | `#22c55e` | positivo (ganga, sube) |
| `--red` | `#d98aa0` | negativo (un rosado apagado, no rojo puro) |
| `--yellow` | `#e6c07a` | advertencia / nota |
| `--pos-qb/rb/wr/te/k/def` | `#a78bfa #4ade80 #fbbf24 #f87171 #38bdf8 #94a3b8` | color por posición (anillo de foto, pill) |
| `--tm-grad` | `linear-gradient(90deg,#9b72e8,#67e8f9)` | único gradiente declarado, para texto (`background-clip:text`) |

Tema claro (`[data-theme="light"]`, `styles.css:935-938`): `--bg:#f6f6f7`,
`--surface:#ffffff`, `--text:#111113`, `--muted:#6c6c76`. Los `--pos-*` cambian a
versiones más oscuras para contraste sobre fondo claro (`--pos-qb:#7448f7`, etc,
`theme.css:1268`).

**Un solo acento morado, consistente.** Eso ya cumple la regla de un acento por proyecto.
Lo que NO cumple es el radio único (ver abajo).

### Tipografía

- **Display**: `'Familjen Grotesk','Inter',system-ui,sans-serif`. Cuatro pesos
  autohospedados en `/fonts/*.woff2` (400, 500, 600, 700), cargados por `@font-face` en
  el `<head>` de `index.html`. Se usa en headlines, números grandes (precio de subasta,
  bid), nombres de jugador en el board.
- **Body**: `'Inter',system-ui,sans-serif`. **Sin `@font-face` propio**: no hay ningún
  Inter autohospedado en el repo, así que en la mayoría de navegadores esto cae
  directo a `system-ui` (Inter rara vez está instalada como fuente de sistema). El
  nombre "Inter" queda solo declarado, no realmente servido.
- Tamaño base `16px`, `line-height:1.6` en `body` (`styles.css:49`).
- Pesos vistos en headlines: 700 y 800 (`font-weight:800` es el más común en números y
  títulos de sección, `font-weight:700` en subtítulos).
- **Nota que afecta directo al rediseño**: la lista de fuentes vetadas de esta sesión
  incluye Inter. Hoy el sitio la declara como fallback del body. Simplemente no está
  auto-hospedada, así que el navegador casi nunca la usa de verdad, pero el nombre
  sigue en el CSS y hay que sacarlo cuando se toque `--font-body`.

### Radios, espaciado, sombras, controles

- `--radius:8px`, `--radius-lg:12px` son las únicas dos variables de radio declaradas,
  pero el CSS **no las respeta**: hay valores hardcodeados de radio en 19 variantes
  distintas conviviendo (`50%`, `100px`/`99px`/`999px` para píldoras, `2px, 3px, 4px,
  5px, 6px, 8px, 9px, 10px, 11px, 12px, 14px, 16px, 20px, 0`). Botones usan `100px`
  (cápsula, correcto), pero tarjetas van de `10px` a `16px` según el componente sin un
  criterio único. Esto es lo opuesto a la regla de "un único radio de tarjeta".
- Espaciado con clamps fluidos: `--sp-section:clamp(56px,7vw,96px)`,
  `--sp-block:clamp(32px,4vw,56px)`, `--sp-group:24px` fijo. Es decir, sí hay una escala
  pensada a nivel de sección, no improvisada.
- Sombras: consistentemente moradas y suaves, nunca negro puro
  (`0 8px 30px -16px rgba(124,92,191,.45)` en `.card`, `0 5px 30px rgba(124,92,191,.5)`
  en el botón primario). Buen patrón, coherente en todo el archivo.
- Botón primario (`.btn-primary`): padding `15px 36px`, radio `100px`, dos capas de
  sombra (una de color, un inset blanco al 18% para dar volumen). Botón `.btn-load`:
  altura implícita por padding `0 22px` dentro de un input-group de 44px según el resto
  del sistema. `.au-bid-btn` (botón de pujar en la subasta) declara
  `min-height:58px` explícito, el control más alto del sitio, coherente con que es la
  acción que hay que poder tocar rápido durante un draft en vivo.
- Iconos: casi todo en SVG inline outline (`stroke="currentColor" stroke-width="2"`),
  tamaños `14-18px` en la barra de navegación, `24px` para acentos de tarjeta. Cero
  emoji en la interfaz de producto (sí hay uno decorativo, ⚡, en el título del `<h1>`
  de las capturas de Sleeper, pero eso es Sleeper, no Mac Draft).

### Componentes reutilizables e inventario de estados

- `.card` — contenedor base de toda la superficie de producto. Con hover en algunas
  variantes (`.mpx-card` sube 3px y agrega sombra al pasar el mouse).
- `.btn-primary` / `.btn-outline` / `.btn-load` / `.btn-sm` — cuatro niveles de énfasis
  de botón, todos cápsula.
- `.tm-input` — input de texto con foco morado (`box-shadow` de anillo al enfocar).
- Skeletons: `.tm-skel`, `.tm-skel-feed` — SÍ existen y se usan (ej. dropdown de alertas
  antes de cargar). Cumple la regla de "cero spinners" en al menos ese punto; no verifiqué
  cobertura completa en las 9 pantallas.
- Toggle de tema: `.theme-toggle.icon`, 30x30px, con tooltip vía `title`.
- Tarjeta de jugador: `.player-thumb-sm` (32px, círculo, anillo de color por posición),
  variantes en `.demo-player-img` (36px) y `.mkt-mover-img` (32px) — tres tamaños de
  avatar de jugador sin una escala declarada (32/34/36/44/48/56/64/76px aparecen todos
  en algún punto del CSS).
- Sistema de "pills" de estado: `.md-flag-chip` (chip redondeado con borde, usado para
  reglas de la sala), pills de posición con color de `--pos-*`.
- Board de draft: `.au-lot` (tarjeta del lote en subasta), `.au-bid-num` (precio grande,
  52px, `font-variant-numeric:tabular-nums` para que no salte el ancho al cambiar el
  número), `.au-budgets`/`.au-brow` (columna de presupuestos por equipo).
- My Rankings: rejilla de columnas compartida entre cabecera y fila (`.rk-row`,
  `.rk-colhead`), con `display:contents` en escritorio que colapsa a bloque apilado en
  móvil - documentado en el CLAUDE.md del repo como decisión deliberada, no accidente.
- Estados vacíos: no encontré un patrón de "empty state" ilustrado (con el loro, por
  ejemplo); los que existen son de una sola línea de texto gris (`No league loaded`,
  `Not compared yet`).

### Pantallas reales (las 9 de `SPA_ROUTES`)

`/` u `home` = analyze (portada + trade analyzer), `/mock` = mock draft (snake/subasta),
`/sage` = Ask Mac (chat con IA), `/analyze` = trade analyzer con tabs (Analyzer/Ideas/Desk),
`/league` = radiografía de tu liga, `/research` = tabs (Buy/Sell, Compare, Start/Sit,
Players DB, Market, My Rankings), `/community` = feed de trades + noticias + Learn,
`/learn` = contenido educativo, `/news` = noticias. `/perfil` existe pero es privada
(solo el dueño, oculta de robots.txt y del menú público).

### El copy real (transcrito, no reescrito)

**Hero:**
> Draft like it's draft night.
> Mock drafts that behave like your league. Snake or auction, with Mac on the headset.
> [Start a mock draft] [Connect your league →]

**Conectar Sleeper:**
> Connect your Sleeper account
> Mac reads your full roster, opponent tendencies, and trade history. Automatically.
> Your Sleeper username is the handle you log into the Sleeper app with, not your team
> name. Case sensitive.

**Ask Mac:**
> Ask me anything.
> Reads your roster · Knows your league · Live market values · Never emotional
> Ask Mac anything about fantasy football...

**Mock draft:**
> Build your mock draft
> Describe your room, pick your seat, draft. The bots behave like the league you
> describe, and Mac advises every pick.
> Mock boards are priced off 2026 redraft ADP. Dynasty changes how Mac reasons about
> your picks, not the draft order yet.

**Por qué existe (sección "about"):**
> Why Mac Draft exists

**404 (`public/404.html`, página propia, nunca el error nativo del navegador):**
> That page doesn't exist.
> The link is wrong or the page moved. Here is the way back in.
> [Start a mock draft] [Ask Mac]
> Back to Mac Draft

**Feedback:**
> What's working, what's not, what you wish Mac Draft did...

**Menú "refer":**
> Refer friends, earn Mac

Todo en inglés, sin em dashes visibles en el copy de cara al usuario (el CLAUDE.md sí
usa comas y guiones cortos, y hay comentarios internos en español panameño-argentino
mixto de las distintas sesiones de trabajo).

### Mac, la mascota

**Sí existe, ya dibujada, y es buena.** Es un loro macaw morado con auriculares
(headset con una "M" en la orejera), sosteniendo un balón de fútbol americano con la
garra, cola en degradado de colores (rojo, naranja, amarillo, verde, azul). Vive en
`/public/sage/`, en **7 estados emocionales** (`sage` = neutral/default, `deadpan`,
`excited`, `scrutiny`, `shocked`, `skeptical`, `thinking`) **x 4 tamaños cada uno**
(32/64/128/256px), PNG con fondo transparente. 28 archivos en total.

**El defecto que hay que arreglar, no de diseño sino de higiene:** los archivos y las
clases CSS lo siguen llamando `sage` (`sage-owl`, `sage-greet-owl`, `.sage-tag`,
`#screen-sage`) y hasta el `alt` de las imágenes dice `alt="Mac"` sobre un archivo que
se llama `sage-256.png`. Es un residuo de una identidad anterior (probablemente una
lechuza llamada Sage, antes del pivote a "Mac" el guacamayo) que nunca se renombró en
el código. Hoy funciona porque nadie ve el nombre del archivo, pero para un rediseño
serio conviene renombrar a `mac-*` de una vez, ya que se va a tocar el sistema visual
igual.

**Lo que falta del personaje:** los 7 estados son expresiones de cara/cuerpo estático,
no poses de acción (no hay un Mac "señalando una tabla", "con un micrófono de
transmisión", "con un trofeo"). Para un hero que se apoye más en el personaje (en vez
de en el video del producto, que es lo que hace hoy) haría falta encargar 2-3 poses
nuevas a Higgsfield o Codex, nunca a mano ni de stock.

### El problema real que muestran las capturas

Las dos capturas de hoy (`/Users/wolco/Development/_snapshots/2026-09-07/mac-draft/`)
muestran el hero completo y After eso, **una franja negra sólida enorme** (más de
10.000px en desktop, la mayor parte del scroll) antes de llegar al footer, tanto en
escritorio como en móvil. El código de `index.html` sí declara contenido real detrás
del hero (tarjetas de conexión a Sleeper, analyzer, etc.), así que esa franja negra casi
seguro es un artefacto de captura (contenido que carga con JS y no llegó a pintar a
tiempo de la screenshot) y no un vacío real en producción. No lo tomo como el hallazgo
de diseño porque no pude confirmarlo contra el producto vivo; lo señalo para que QA lo
revise antes de decidir nada sobre esa zona.

---

## TAREA 2: referencias del rubro

**Fuentes consultadas, en el orden pedido:**
1. Swipe file (`/Users/wolco/Development/swipe-file`): Sleeper ya está ahí, aprobado
   19-ago-2026, con la nota textual "mirar cómo resuelve densidad de datos sin verse
   pesado". No se vuelve a buscar desde cero; se usa como piso.
2. **recent.design y refero.design: NO accesibles esta sesión.** Los dos bloquearon el
   fetch automatizado (recent.design devolvió 403; refero.design es una SPA que no
   entregó contenido real al fetch, solo el título). No tengo capturas nuevas de esas
   dos fuentes para este informe. Si quieres esa dirección estética/motion específica,
   se puede reintentar con navegador real (Playwright) o pedirte que compartas
   capturas.
3. Búsqueda directa de los referentes del rubro (WebSearch + WebFetch donde el sitio lo
   permitió).

Con eso, cinco referencias reales del rubro, Sleeper como piso y cuatro por encima:

### 1. Sleeper (piso, ya aprobado - swipe file)
sleeper.com · captura en swipe file, `sleeper-com-2026-08-19.png` (home de scores, no el
draft room)
- **Qué hace bien, aplicable aquí**: la captura que ya tenés es la home de "Scores", no
  el draft room, pero el patrón vale igual: fondo casi negro (`#0d1117`-ish) con
  columnas de tarjetas de 3 en 3 a 1440px, cada tarjeta es una fila comprimida
  (escudo 24px + nombre + marcador + hora/canal a la derecha), sin líneas divisorias
  entre filas, solo el espacio en blanco vertical hace de separador. Nueve tarjetas
  visibles en el primer viewport sin scroll. Eso es la lección: la densidad se resuelve
  con jerarquía tipográfica (bold para el dato que importa, gris apagado para el
  contexto) y no con más aire entre elementos.
- **Qué se puede replicar**: la proporción escudo/nombre/dato de cada fila, y el uso de
  un solo tono de gris azulado para todo lo secundario en vez de tres grises distintos
  (Mac Draft hoy usa `--muted` y `--muted2`, dos tonos, ya va en esa dirección).
- **Qué no**: su paleta (azul/negro con acento cian) y su logo con casco de astronauta.
  Ya está resuelto: Mac Draft es morado con su propio loro.

### 2. FanDraft (fandraft.com) - rediseño 2026 del board completo
fandraft.com/blog/a-completely-refreshed-design-for-fandraft
- **Qué hace bien, aplicable aquí**: es la referencia MÁS directa porque hace
  exactamente lo mismo que Mac Draft dice que hace ("draft like it's draft night").
  Encabezado fijo "estilo transmisión" que siempre muestra: reloj de la pick, ronda
  actual, quién está en el reloj, y las picks anterior/siguiente - o sea, el contexto
  temporal completo cabe en una franja, sin que el usuario tenga que buscarlo. Tarjetas
  de jugador con color por posición de MAYOR contraste que el estándar (no un tinte
  sutil, un color que se lee desde lejos). Las picks entran al tablero con animación de
  deslizamiento, no aparecen de golpe. Un ticker horizontal tipo "chyron" de TV corre
  las últimas picks.
- **Qué se puede replicar aquí**: el encabezado de contexto persistente (Mac Draft ya
  tiene algo parecido en la subasta con `#au-budgets`, pero podría llevar el mismo
  criterio al snake). La animación de "la pick entra deslizándose" es barata de hacer y
  sube mucho la sensación de "esto está pasando en vivo", que es justo lo que Draft Day
  (la función de subasta real narrada) necesita.
- **Qué no**: su optimización para pantalla grande tipo living room/TV (letras enormes
  pensadas para verse desde el sillón) no aplica: la regla de este proyecto es mobile
  primero, y ahí el ticker horizontal compite por espacio con la barra de navegación
  inferior.

### 3. KeepTradeCut (keeptradecut.com) - autoridad específica de dynasty
keeptradecut.com/dynasty-rankings, keeptradecut.com/trade-calculator (confirmado por
fetch directo)
- **Qué hace bien, aplicable aquí**: es EL sitio de referencia para dynasty
  específicamente (no redraft), que es el formato de Mac Draft. Su credibilidad no viene
  de diseño vistoso, viene de mostrar el número que respalda cada valor ("27.073.208
  data points y contando") en la misma línea donde se usa ese valor, no en un about
  aparte. El trade calculator es de dos columnas simétricas ("Team 1 gets... / Team 2
  gets...") con un contador de piezas y una métrica de "dispersión de valor" debajo,
  nada de decoración alrededor.
- **Qué se puede replicar aquí**: la costumbre de anclar cada afirmación fuerte a su
  fuente de dato en la misma línea (Mac Draft ya hace esto en el perfil privado del
  dueño con el criterio de "solo dice lo que el dato aguanta" - KTC es la prueba de que
  ese principio también funciona de cara al público general).
- **Qué no**: KTC no tiene mascota ni tono de personaje, es deliberadamente frío y
  numérico. Mac Draft SÍ tiene personaje (el loro) y esa calidez es una ventaja
  competitiva real frente a KTC, no hay que sacrificarla por parecer "más serio".

### 4. Fantasy Life (fantasylife.com) - Matthew Berry, editorial + producto
fantasylife.com (confirmado por fetch directo)
- **Qué hace bien, aplicable aquí**: mezcla autoridad editorial (la cara y la voz de un
  analista reconocido) con las herramientas de producto en el MISMO scroll, no en
  secciones separadas: un artículo destacado arriba, después una fila de personalidades,
  después "Mock Draft Simulator" / "Draft Companion" / "Start/Sit" como bloques de
  herramienta, con un llamado a suscripción intercalado a la mitad del scroll, no al
  final. La densidad se resuelve por repetición de un mismo formato de tarjeta
  (imagen + título + autor + fecha), nunca mezclando tres formatos de tarjeta distintos
  en la misma fila.
- **Qué se puede replicar aquí**: Mac Draft no tiene una cara humana detrás (tiene a
  Mac, el personaje), pero el patrón de intercalar "prueba de autoridad" antes de cada
  bloque de herramienta es válido igual: en vez de un analista humano, puede ser Mac
  mismo comentando el hallazgo del día (ya existe la voz de Mac en el chat; falta
  llevarla al home).
- **Qué no**: su exceso de logos de sponsors en el home (Xfinity, Hims, Fire TV) rompe
  la paleta con marcas ajenas; no aplica a un producto sin ese modelo de negocio hoy.

### 5. Underdog Fantasy (underdogfantasy.com / underdogsports.com)
- **Qué hace bien, aplicable aquí**: es el caso de estudio más cercano a "producto de
  fantasy con mascota como marca" (un perro), con interfaz mobile-first, navegación por
  pestañas simples (Pick'em / Drafts / My Entries) pensada para construir una entrada en
  pocos toques. No pude confirmar el detalle visual con fetch (bloqueado), así que esto
  se apoya en reseñas de producto, no en una captura propia - es el más débil de los
  cinco en verificación directa y conviene revisarlo con una captura real antes de
  decidir algo sobre él.
- **Qué se puede replicar aquí, con esa reserva**: la idea de que la mascota vive en la
  MARCA (logo, ilustraciones de campaña) y no necesariamente dentro de cada pantalla de
  producto - a diferencia de Mac Draft, donde Mac aparece dentro de la UI (el chat, el
  logo del nav). Vale la pregunta de si Mac debería tener más presencia de marca por
  fuera del producto (redes, og:image) y no solo dentro.
- **Qué no**: no hay dato verificado suficiente para decir más sin fabricar detalle.

---

## Tres direcciones estéticas para Mac Draft

### Dirección A: "Cabina de transmisión" (de FanDraft + el propio hero-video de Mac Draft)
Eje: la app ya se siente como una transmisión en vivo (el hero tiene un video real del
auction room); esta dirección lo lleva más lejos. Encabezado persistente de contexto
(ronda, reloj, on the clock) igual en snake y en subasta, no solo en subasta como hoy.
Ticker horizontal de picks recientes. Animación de "la pick entra deslizándose" en vez
de aparecer. Sale de FanDraft, con la calidez del loro (Mac comentando en el ticker en
vez de un chyron frío) para no perder personalidad.
**Contra**: pelea por espacio vertical en móvil, donde ya hay barra de navegación
inferior + header fijo; hay que ganar ese espacio quitando algo, no sumando encima.

### Dirección B: "Autoridad de dato, con calidez" (de KeepTradeCut + Fantasy Life)
Eje: cada afirmación fuerte de Mac lleva su número al lado, en la misma línea, siempre
(el patrón que el perfil privado ya usa, llevado al producto público). El home
intercala hallazgos de Mac (con su cara/expresión cambiando según el hallazgo: shocked
para una sobreprecio, excited para una ganga) entre los bloques de herramienta, como
Fantasy Life intercala autoridad editorial. Resuelve la densidad por REPETICIÓN de un
solo formato de tarjeta en vez de mezclar.
**Contra**: exige que el motor exponga "por qué" en cada número, y esa capa de
explicación no está escrita para todas las pantallas hoy (sí existe para el perfil).

### Dirección C: "El loro es la marca" (de Underdog Fantasy, con reserva por falta de
verificación visual directa)
Eje: Mac sale del chat y del logo pequeño y pasa a protagonizar el marketing (og:image,
compartidos, el momento de "gran jugada" en el draft), separado de la UI de trabajo, que
se mantiene sobria y de datos. La marca vive afuera del producto (redes, referidos,
compartir un draft), la herramienta adentro se mantiene disciplinada.
**Contra**: es la dirección con menos evidencia sólida detrás (Underdog no se pudo
confirmar visualmente), así que es la más especulativa de las tres; conviene validarla
con una captura real de Underdog antes de comprometerse.

---

**Corrección (cuartel, 7-sep):** si en este informe se trató a Inter como fuente vetada,
es un error introducido por el cuartel en el encargo. El veto global de Wolco, en
`~/.claude/briefs/wolco-estandar.md` línea 38, es exactamente Helvetica, Helvetica Neue,
Archivo e **Instrument Serif**. Inter no está vetada por él. Evitarla sigue siendo una
recomendación de diseño razonable, porque es una de las fuentes sobreexpuestas que delatan
trabajo hecho por IA, pero es criterio, no regla, y lo decide Wolco.
