# Mac Draft: estado del proyecto

Ultima actualizacion: 2026-08-26 (noche).

## Que es
Dynasty fantasy football: mock drafts (snake y subasta) que se comportan como tu liga,
analizador de trades, radiografia de liga, y Mac (loro macaw morado) como asistente.
Dominio: macdraft.app. Deploy en Vercel, proyecto `trademind-starter`.

## Gates obligatorios antes de cualquier deploy
```
node scripts/calibrate-room.mjs   # 40 invariantes, ~35 min reales. Debe dar ALL GREEN
node scripts/qa-flows.mjs         # flujos con el motor real
node scripts/qa-trades.mjs        # 9.989 escenarios, 32 checks
node scripts/qa-perfil.mjs        # 156 checks del perfil, instantaneo
node scripts/qa-rankings.mjs      # 23 checks de My Rankings, navegador real
node scripts/qa-board.mjs         # 104 checks del tablero, barrido de anchos
node scripts/qa-nav.mjs           # navegacion CLICANDO desde la portada
node scripts/qa-live.mjs          # 24 checks de Draft Day, navegador real, entra clicando
```
Los ocho corren desde cualquier directorio. Un test que no falla contra el codigo
roto es un adorno: al anadir un gate, verificar que falla ANTES del fix.

## Sesion 2026-08-22: auditoria pre-lanzamiento
Diez agentes en paralelo, 21 bloqueantes unicos cerrados, cuatro despliegues.
Lo mas grave que se arreglo: el gate de calibracion llevaba dos dias devolviendo
fallos sobre CERO salas simuladas; Mac afirmaba que Justin Jefferson juega en
Cleveland (homonimos de Sleeper); Start/Sit daba el rival del ex equipo a 12 del
top-100; un XSS almacenado robaba la llave de cuenta.

Pendientes documentados, con derivacion escrita, NO aplicados:
- Traslado de Pro entre dispositivos: hoy un suscriptor en su segundo navegador
  cae a plan gratis. Diseno listo y prototipado.
- VAL_CURVE por tamano de liga: el #1 cuesta 36% del presupuesto en ligas de 12
  cuando lo real es 30-32%. Arreglar las rondas NO lo movio (medido).
- Reserva de presupuesto en subasta: la puerta reserva huecos de roster, no dinero.
- Escala dynasty del tablero de mock: hoy el selector declara su limite en la UI.

## Sesion 2026-08-24: perfil privado de self-scouting (Fase 1)
Tab en `/perfil` que analiza el historial REAL de Sleeper del dueno.
Solo para el, sin monetizar. Estado: **DESPLEGADO Y HABILITADO** (2026-08-24).
PERFIL_ACCTS en produccion trae los DOS acctId del dueno:
ed6e4010a6111daca7f0684f3d2c4273 (computadora) y
6c35b4ff8e6404f1833a1cf302064463 (celular). El id es POR NAVEGADOR (sha256 de la
llave de su localStorage): cada navegador nuevo hay que anadirlo a la misma lista,
separado por coma, y redesplegar, porque las variables de Vercel solo entran con
un deploy nuevo.
Verificado en produccion: /perfil 200, sin llave 401, llave no listada 403 con
su acctId en pantalla, y el mecanismo de habilitacion probado de punta a punta
en local (llave listada recibe el perfil, no listada rebota).

Archivos:
- `/Users/wolco/Development/trademind-app/server/lib/perfil.js` (motor puro)
- `/Users/wolco/Development/trademind-app/server/routes/perfil.js` (ruta)
- `renderPerfil()` y auxiliares al final de `public/app.js`
- `#screen-perfil` en `public/index.html`, bloque `.perfil-muda` al final de `public/styles.css`
- `server/index.js`: ruta montada y `/perfil` en SPA_ROUTES
- `public/robots.txt`: Disallow /perfil

Regla que gobierna la feature: solo dice lo que el dato aguanta. Toda afirmacion
lleva su n; la que no supera el umbral no se emite y se muestra como rechazada.

### Auditoria del revisor: CERRADA (2026-08-24)
Los cuatro puntos, mas dos defectos que aparecieron al cerrarlos. El motor ya
tiene gate propio (`scripts/qa-perfil.mjs`, hoy 156 checks); antes no tenia ninguno,
y se verifico que 25 de esos checks fallaban contra el codigo previo.

- **Edad por `birth_date`, no por aproximacion.** Sleeper CONGELA `age` cuando
  deja de actualizar a un jugador: Matt Ryan figura con 37 habiendo nacido en
  1985. Medido sobre el maestro del 2026-08-24, entre los 939 jugadores de
  posicion con equipo `age` acierta en 890 y se desvia hasta 9 anos en 49.
  Retroceder temporadas no corregia ese error, lo arrastraba. El sesgo no era
  neutro: los congelados son veteranos, que caen del lado que uno VENDE, justo
  el lado que define el delta de edad. `birth_date` cubre 939 de 997; para el
  resto se conserva el camino viejo y la salida DECLARA cuantas edades vinieron
  por ahi (`edad.nAprox`).
- **QB separados por formato.** En superflex el QB es el activo mas caro y en
  1QB es relleno: comprar uno en cada sitio es la decision contraria, no la
  misma. Sumados, un dueno que acumula en superflex y suelta en 1QB daba 50/50
  y el tab declaraba que no tenia ninguna tendencia teniendo las dos. Ahora
  `qb_superflex` y `qb_1qb` son afirmaciones independientes, cada una con su n
  y dentro de la familia de BH.
- **Consola limpia y 390px.** La pantalla no desborda (scrollWidth = 390),
  ningun elemento se sale del viewport, la barra fija no tapa el ultimo bloque
  y la consola queda LIMPIA con el perfil cargado. Los dos errores que salen en
  local (`_vercel/insights/script.js` 404 y `/api/odds/implied` 503) son del
  entorno, no del codigo: en produccion los dos devuelven 200, verificado por
  curl. Queda uno inevitable: Chrome registra en consola cualquier fetch que
  responde 403, y eso solo ocurre en una cuenta no habilitada.

Dos defectos encontrados de paso, ambos arreglados con su gate:
- **El 403 no pintaba el acctId.** La ruta lo devuelve en el JSON justamente
  para no obligar a abrir devtools, y la UI solo pintaba el mensaje de error.
  Sin esto el paso 1 del despliegue era imposible de completar. Ahora sale en
  pantalla, seleccionable, y cabe a 390px.
- **`p=0` y frases que sobrevivian al rechazo.** `claim()` guardaba la p con
  `toFixed(3)`, asi que cualquier reparto limpio desde n=16 imprimia "p=0": eso
  no se lee como "muy improbable" sino como "imposible por azar". Y
  `aplicarFDR` solo borraba el texto de las afirmaciones que caian FUERA del
  prefijo del step-up, asi que una p de 0.06 en buena compania quedaba marcada
  sin_senal y con su frase entera lista para pintar. Las dos son la misma clase
  de bug: el arreglo correcto ya estaba escrito en `concentracionSocios()` y
  nunca se propago al otro lado del archivo. Ahora el candado de texto va al
  final de `aplicarFDR` sobre TODAS, no sobre un subconjunto.

### Pendiente propio del perfil
Fase 2 (comportamiento en la app: que le preguntaste a Mac, que trades miraste y
no hiciste) NO se puede empezar sin tocar antes `public/privacy.html`. La Fase 1
no expone nada nuevo porque sale entera de la API publica de Sleeper; el dia que
se registre comportamiento propio eso deja de ser cierto, y la politica tiene que
decirlo ANTES de guardar el primer evento. Esta escrito en la cabecera de
`server/routes/perfil.js`.

## Sesion 2026-08-24 (tarde): motor reescrito y UI de dos ejes

**Formato de liga: una sola verdad.** `server/lib/formato.js` clasifica dynasty,
keeper y redraft. El criterio vivia copiado A MANO en dos sitios de `public/app.js`
y nunca habia llegado al servidor, por lo que el perfil mezclaba los tres formatos.
Ahora app.js tiene UN espejo (`tmClasificarLiga`) y `qa-perfil.mjs` lo EXTRAE del
archivo y lo compara caso por caso contra el canonico. Comprobado que el gate falla
si el espejo deriva.

**Historico: de 2 temporadas a todas.** Camina atras hasta dos vacias seguidas, tope
10. Del dueno salen 8 temporadas, 29 ligas, 63 trades.

**Dos ejes.** `construirPerfiles()` parte el perfil en dynasty y redraft, cada uno
con su propia familia de Benjamini-Hochberg. Keeper cae con redraft pero se cuenta y
se declara. Partir la muestra hace que cada tab afirme MENOS: es correcto, lo que el
saco mezclado afirmaba de mas eran conclusiones sobre un manager que no existe.

**El idioma de cada eje.** Prohibido vocabulario de dynasty en redraft: "bank the
future" no significa nada en una liga que acaba en enero. `edad.relevante` es false
en redraft. La regla ya existia para Mac y el perfil se la saltaba.

**Dos fuentes nuevas de dato.**
- Waiver: sale GRATIS, la ruta ya bajaba las semanas enteras y tiraba lo que no era
  trade. Test de PERMUTACION contra los rivales de la propia liga. El primer intento
  fue un binomio sobre liga-temporadas y daba n=5: el problema no era el dato, era la
  unidad de medida.
- Drafts: `/user/{id}/drafts/nfl/{season}` y `/draft/{id}/picks`, rondas 1 a 4. El
  producto ya clasificaba a sus bots como zerorb/robustrb y nunca le habia dicho al
  dueno cual es el.

**Hallazgo real confirmado** en redraft: "You build on running backs. In the first
four rounds you take more of them than 73 of the 105 rival drafters", p=0.011. En
dynasty ese mismo test da p=0.3. El contraste solo existe porque se partieron los ejes.

**UI: un solo arbol de DOM, dos repartos.** El telefono pone los dos ejes detras de
tabs; la computadora los abre en dos columnas y esconde los tabs. Lo hace el CSS. Se
descarto hacer dos disenos distintos (editorial en movil, mazo de cartas en
escritorio): el mazo es un gesto de pulgar que en computadora no existe, gasta una
pantalla grande en un dato por vez, y dos arquitecturas son dos codigos para la misma
pantalla que se separan solos. Del mazo se rescato la cifra grande. El eje inicial NO
es fijo: abre por el que mas tenga que decir. Verificado en navegador real a 390px y a
1400px: sin desborde, consola limpia, cambio de tab con aria-selected correcto.

## Yahoo Fantasy: solicitud en curso, esperando a Yahoo
Medido el 2026-08-24 contra la app real, cambiando una cosa por vez:

    redirect_uri=macdraft.app      -> invalid_request "invalid redirect uri"
    redirect_uri=trademindff.com   -> invalid_scope   "invalid scope"
    trademindff.com + scope=openid -> 302 a login.yahoo.com, entra bien

El control con openid pasa con la MISMA app y las mismas credenciales, asi que el
OAuth esta sano: falta el permiso de Fantasy Sports. Yahoo cerro el acceso
self-serve; hoy se solicita en https://sports.yahoo.com/developer/ y se espera
aprobacion manual, y la consola de apps ya no ofrece ese permiso para marcarlo.
Hasta que aprueben NO hay codigo que conecte una liga de Yahoo.

El dueno YA habia aplicado y firmado el acuerdo el 4 de agosto (hilo de Gmail
19fce100154aa018 con fantasyapideveloper@yahoosports.com). Se atasco por dos cosas:
su respuesta del 5 dejaba ambiguo cual era su email de Yahoo, y su Client ID se pego
con la palabra siguiente al hacer salto de linea, con lo que probablemente les llego
un ID invalido. El 2026-08-24 se respondio en el mismo hilo con las dos respuestas
sin ambiguedad y la evidencia de los scopes.

PREGUNTA ABIERTA: en ese correo se afirmo que la cuenta Yahoo detras de la app es
awolcovinsky@yahoo.com. Es una INFERENCIA (es la unica cuenta Yahoo que el menciono),
NO esta verificada. Si el dice que es otra, mandar correccion al mismo hilo.

Dos cosas abiertas, las dos esperando a Wolco:
1. La app de Yahoo sigue registrada con el dominio viejo (trademindff.com).
   Anadir https://macdraft.app/api/yahoo/callback a sus Redirect URI. Barato,
   pero por si solo no conecta nada: el bloqueo que manda es el scope.
2. `/api/yahoo/status` devuelve configured en cuanto existen las credenciales,
   asi que el boton "Sign in with Yahoo" esta VIVO en produccion y lleva a una
   pagina de error de Yahoo, en la pantalla de conectar cuenta. Se propuso
   esconderlo tras una variable y el dueno dijo que NO: se queda visible.

## Sesion 2026-08-25: auditoria de confianza de los mock drafts

Pregunta del dueno: "puedo confiar en los mock drafts de Mac, los de auction tambien".
Se midio con el arnes REAL (`scripts/calibrate-room.mjs` copiado y reapuntado), contra
los boards en vivo. Nada de esto es opinion: los scripts del barrido quedaron en el
scratchpad de la sesion y son reproducibles copiando las primeras 437 lineas del gate.

**El gate oficial: ALL GREEN.** 40 invariantes, 600 salas por formato.

**Barrido fuera de la jaula: 13 configuraciones nuevas, CERO fallos.** Subasta en 8, 10,
12 y 14 equipos, superflex, standard, $100, $300 y 20 rondas; snake en 8, 10 y 14
equipos y superflex a 10. El motor aguanta donde el gate nunca lo corre.

**HALLAZGO 1: el precio del #1 se desliza con el tamano de la sala.** Mediana de venta
como % del presupuesto (real: 30-32%): 8 equipos 25.0%, 10 equipos 30.5%, 12 equipos
35.0%, 14 equipos 38.5%. El pendiente viejo decia "36% en ligas de 12"; la forma real es
una PENDIENTE, ~4 puntos por cada dos equipos, y el unico tamano donde acierta es 10, no
12. El scoring mete otro escalon: standard 29.5% vs PPR 35.0% en la misma sala.
Causa: `auPoolInit` ancla en el ultimo jugador draftable, asi que una sala mas profunda
baja el replacement y le regala value-above-replacement al #1. Es VORP de manual, pero
las subastas reales no tienen esa amplitud. VAL_CURVE=0.86 es una constante global.

**HALLAZGO 2: en snake todos los equipos empatan.** Mejor vs peor roster de la sala: 3.0%
(mediana, n=40). Coeficiente de variacion entre los 12 asientos: 0.8%. Dos tercios de las
600 salas del gate producen el MISMO numero exacto de QBs por R5. Consecuencia: el asiento
del usuario, jugando la recomendacion del propio motor, gana la sala el 65% de las veces
(azar 8,3%) con una ventaja de 0.07% sobre el mejor bot. La victoria es ruido.
MATIZ HONESTO: la serpentina iguala por construccion y la medida usa `dv`, la propia
metrica del motor, asi que es en parte circular. Lo que SI queda probado es que el mock de
snake no distingue estrategias: no premia una buena ni castiga una mala.
La nota que ve el usuario (`letter`, linea ~15242) sale de `avgEdge` contra el rank, NO de
compararlo con los otros equipos, asi que la app NO le dice "ganaste la sala". Bien.

**HALLAZGO 3: la subasta es MAS confiable que el snake, al reves de lo que cubre el gate.**
Dispersion mejor-vs-peor 21.3%, CV 6.8%: es un mercado de verdad. Y el autopilot del motor
termina 5.6% POR DEBAJO del mejor bot, o sea el motor no se favorece a si mismo.

**HALLAZGO 4: el invariante (f) es un adorno.** "Los sobreprecios tempranos enfrian el
resto" se ejercio en 2 de 600 salas del gate (0,3%) y en 0 de 540 del barrido: ninguna sala
arranca caliente. Un cambio que rompa esa dinamica pasaria el gate casi seguro. Ademas es
en si una desviacion de realismo: las subastas reales arrancan calientes seguido.

**HALLAZGO 5: `auGradeBuy` no discrimina.** Devuelve 'B' de entrada cuando el precio esta a
menos de $2 del sticker, y como la mayoria de los lotes son de $1 a $5 casi todo cae ahi:
89.0% B en el gate ($200), 96.9% en salas de $100. Una nota que da B a 9 de cada 10 compras
no informa. La banda absoluta tiene su razon ($1 vs $3 es 3x en ratio), pero deberia
escalar con el presupuesto de la sala.

**HALLAZGO 6: el ADP no sabe de que tamano es tu liga.** Fuente primaria Sleeper (ADP
global); el respaldo pide literalmente `teams=12` (`server/routes/stats.js:357`).

**HALLAZGO 7 (ya sabido, aqui confirmado): el board nunca es dynasty.** `md-mode` en Dynasty
solo cambia como razona Mac; el tablero sigue precificado con ADP de redraft 2026. La UI lo
declara en la nota amarilla de `index.html:1113`.

NINGUNO de estos se arreglo en esta sesion: es una auditoria, no un cambio. El orden de
impacto propuesto es 1 (precio por tamano de sala), luego 5 y 4 (los dos baratos), luego 2.

## Sesion 2026-08-25 (tarde): My Rankings, la lista propia del usuario

Pedido del dueno: "un tab de rankings editable y saviable para poder setiar mis tiers".
Referencia que dio: el video de YouTube eD7Y1UW7iF0, "My Updated Top 60 Overall Rankings
for Fantasy Football". NO se pudo ver su contenido visual (YouTube solo devuelve el
titulo), asi que la ESTETICA esta pendiente de que el mande una captura. La
funcionalidad no dependia de eso y esta entera.

**Donde vive.** `public/rankings.js` (modulo nuevo, no toca app.js salvo por un puente),
tab "My Rankings" dentro de `screen-research`, bloque `.rk-*` al final de `styles.css`.
Se hizo archivo aparte a proposito: app.js va por 17.400 lineas y esto es un modulo
cerrado. `rankings.js` se carga en index.html detras de app.js.

**Que hace.** Arranca del ADP real (`/api/stats/adp`, top 200, sin K ni DEF), el usuario
reordena arrastrando o con los botones, corta tiers donde quiere, y todo se guarda en
localStorage. Cada fila muestra el ADP de consenso y el DELTA contra el, que es la unica
cifra que dice algo: cuanto te separas del mercado.

**Dos decisiones de modelo que importan:**
- El orden se guarda por ORDEN DE IDS, no por posiciones absolutas: el dia que Sleeper
  mueva su ADP, la lista propia no se descoloca. Los jugadores nuevos caen detras en su
  orden de consenso, nunca borran lo que el usuario ordeno.
- Los cortes de tier se guardan como "despues de ESTE jugador se corta", no como
  indices. Un tier anclado a un indice se rompe en cuanto mueves a alguien por encima.

**El puente al mock draft** (`public/app.js`, dentro de `mdFilterChoices`, justo antes de
crear la fila `md-bd-row`). Con la casilla "Use in mock drafts" encendida, el board pinta
`MY #n` en la linea meta de cada jugador, y lo pone en verde cuando cae 6 puestos o mas
por debajo de donde el usuario lo tiene. Ese contraste ES la razon de hacerse una lista
propia. Va en la linea meta y NO en una columna nueva: la rejilla de columnas comparte
plantilla con la cabecera y anadir una las descuadra (bug ya conocido en el archivo).

**Gate propio: `node scripts/qa-rankings.mjs`, 18 checks, navegador real.** Arranca su
propio servidor en el 3211. Playwright NO esta en package.json a proposito: su
postinstall se baja los navegadores y eso entraria en cada build de Vercel; el script lo
resuelve de donde ya exista en la maquina y dice como instalarlo si falta.
El check (o) es un CONTROL NEGATIVO: con la casilla apagada el board no puede pintar
nada. Sin el, el check siguiente pasaria aunque el puente estuviera cableado al reves.
Verificado: apagado 0 marcas, encendido 25.

**Dos defectos encontrados y arreglados durante el QA:**
- **ReferenceError al abrir el tab con red lenta.** El onclick inline llamaba
  `renderRankings()` directo; si el usuario pulsaba antes de que `rankings.js` cargara,
  saltaba un error en consola y el tab quedaba muerto para siempre. Ahora el onclick va
  guardado (`window.renderRankings&&...`) y el modulo, al terminar de cargar, se pinta
  solo si el tab quedo abierto. El gate lo cazo, no la lectura del codigo.
- **La UI estaba escrita en espanol** y toda la app esta en ingles (Compare, Start/Sit,
  Players, Market). Traducida entera. Los comentarios del codigo siguen en espanol, que
  es el estilo del repo.

PENDIENTE DE GUSTO: la captura del video para ajustar la estetica. Y el boton de corte de
tier lleva la palabra TIER en vez de un icono, porque en el telefono no hay hover que
revele el tooltip y el glifo se leia como un guion.

## Reel del hero: cuatro defectos EN PRODUCCION, sin arreglar

Auditado el 2026-08-25 extrayendo fotogramas de `public/promo-reel.mp4` con ffmpeg.
El video se hizo A MANO y no hay ningun script en el repo que lo genere: por eso se
desincronizo del producto. Lo que se encontro:
1. **Muestra un jugador que no existe**: "J. Love RB ARI" en la tarjeta destacada.
   Verificado contra el maestro de Sleeper: los unicos J. Love son Jordan Love (QB, GB)
   y Josh Love (QB, sin equipo). Es lo primero que ve un visitante.
2. **Nombre truncado**: "J. Smith-Njigb", cortado en seco.
3. **Tipografiado en Archivo**, la fuente vetada en agosto. El commit que lo genero
   (5dd3efd) lo dice literal. El sitio ya migro a Familjen Grotesk; el video no.
4. **Encuadre**: el archivo es 1920x1080 y solo la franja superior tiene contenido; el
   HTML lo declara `width="1080" height="1080"`. Primer fotograma negro puro.

DECISION YA TOMADA (aprobada por el dueno): los reels se generan desde el PRODUCTO REAL
con Playwright contra localhost, versionado en scripts/, para que un comando los
regenere con la fuente y los datos del dia. NO con IA generativa: un video de la UI hecho
con IA muestra un producto que no existe. El auction room ya se comprobo que se filma
bien (captura en la sesion): la tarjeta del lote con foto grande, el precio, OFFER $55 y
la columna de presupuestos.
NO EMPEZADO. Es el primer punto de la sesion que sigue, junto con reposicionar el hero
para que la subasta sea el gancho de entrada en vez del snake (idea aprobada por el
dueno el 2026-08-25, con los datos del HALLAZGO 3 detras).

## Sesion 2026-08-25 (noche): el tablero de subasta se rompia en toda la franja de un MacBook

Aparecio filmando. Preparando el generador de reels, la PRIMERA captura de la sala de
subasta mostro los nombres de la tabla partidos letra por letra. No era del video.

**Lo que pasaba.** En subasta la lista de jugadores se quedaba con 220px a 1280px de
ventana, y con 40px a 1100px. `overflow-wrap:anywhere` convertia esa falta de ancho en
"Jahmyr Gibbs" repartido en once renglones de una letra, y el panel "My team" se le
montaba encima. Medido: bien a 1920 y 1600, roto de 1500 para abajo, bien otra vez en el
telefono. Snake nunca se vio afectado.
O sea que los dos anchos que el repo ya vigilaba (1920 y 390) son exactamente los dos
donde el bug NO se ve. En medio queda toda la franja de un MacBook.

**Por que.** Tres cosas encadenadas, cada una razonable por separado:
- `#au-zones` (theme.css:608) reparte `360px minmax(0,1fr) 250px` y solo colapsa por
  debajo de 999px. Con el padding de `#screen-mock` y el panel `#md-roster` de 300px,
  1002px de la ventana estaban comprometidos ANTES de que la lista recibiera un pixel.
  A 1280 eso dejaba la lista en 220px y el panel "My team", VACIO, mas ancho que ella.
- `mdBoardCols()` elegia las columnas por `window.innerWidth`, no por el ancho del
  contenedor, asi que armaba la plantilla de escritorio (pide 428px) dentro de 220px.
- `overflow-wrap:anywhere` hace que el ancho minimo de contenido de un nombre sea UNA
  LETRA. Eso es lo que autoriza a la rejilla a colapsar la pista a cero: sin el, el
  minimo habria sido la palabra mas larga y el fallo se habria visto como desborde.

**Lo que se arreglo, en cuatro piezas.**
- `mdBoardCols(pf,proj,anchoCaja)` separa DOS EJES que estaban confundidos en uno:
  `phone`/`narrow` siguen mirando la VENTANA, porque gobiernan el layout tactil (blancos
  de 44px) y ese diseno de movil ya estaba aprobado; el ancho de la CAJA decide que
  columnas caben. Mezclarlos fue un error intermedio propio: con un solo umbral de caja
  la columna AAV desaparecia a 1600px, donde cabia perfecta. El gate lo cazo.
- `_mdFitCols()` suelta columnas de menos a mas util (reparto, Bye, rank, Proj) hasta que
  la pista del nombre conserva 120px. AAV/ADP NO se suelta nunca: en una subasta la
  columna del dinero es el punto entero de la pantalla, y hay un check dedicado a eso.
- La pista pasa de `minmax(0,1fr)` a `minmax(96px,1fr)` y `.md-bd-name` de
  `overflow-wrap:anywhere` a `break-word`. Si algo no cabe, ahora se nota como desborde
  (visible, arreglable) en vez de como un nombre triturado en silencio.
- Un `ResizeObserver` sobre `#md-choices` sustituye al listener de `resize`, que solo
  repintaba al cruzar 700 o 340. Al reescalar de 1920 a 1366 no se cruzaba ninguno, asi
  que la plantilla vieja se quedaba puesta sobre una caja mas chica. Tambien lo cazo el
  gate, no la lectura del codigo.

**La decision de layout la tomo el dueno**, sobre cuatro opciones medidas: entre 1081 y
1499px, y SOLO en subasta, se esconde `#md-roster`. La lista pasa de 220 a 536px a 1280,
y de 40 a 356 a 1100. El corte va acotado por los DOS lados a proposito: por debajo de
700 ese mismo `#md-roster` ES la barra fija del telefono, y esconderlo alli seria una
regresion. Verificado, no supuesto: el tab "Team" del riel derecho (`#au-z-right`) lista
QB/RB/WR/TE/FLEX/K/DEF/BN con sus huecos, asi que no se pierde informacion.

**Gate nuevo: `node scripts/qa-board.mjs`, 104 checks, navegador real.** Diez anchos en
subasta, tres en snake, mas un reescalado en vivo. Se verifico que falla contra el codigo
roto: 28 fallos antes, 12 tras la primera pieza, 6 tras la segunda, ALL GREEN al final.
Snake es el CONTROL: pasaba con el codigo roto y sigue pasando, asi que el gate no esta
midiendo el clima.

Arruga menor, sin arreglar y sin decidir: entre 1500 y 1699px la lista es MAS estrecha
(440-540px) que a 1440px (696px), porque ahi el panel todavia se muestra. Todo pasa los
invariantes en esa franja; es una arruga de monotonia, no un defecto.

Archivos tocados: `public/app.js` (`mdBoardCols`, `_mdFitCols`, `_mdWatchCols`,
`mdShowChoices`), `public/theme.css` (`.md-bd-name`, el bloque nuevo tras `.md-cols`),
`scripts/qa-board.mjs` (nuevo).

### El generador de reels: ESCRITO Y FUNCIONANDO, pendiente el encuadre
`scripts/gen-reel.mjs`. `node scripts/gen-reel.mjs --dry` deja la salida en un temporal
sin tocar public/; sin `--dry` escribe `public/promo-reel.mp4` y su poster. Se comprueba
solo: jugadores contra el maestro de Sleeper (con CONTROL NEGATIVO, un nombre cebo que el
conjunto debe rechazar), nombres sin cortar, Familjen Grotesk, consola limpia, primer
fotograma no negro por luminancia media, y duracion.
Tres tropiezos propios que quedaron resueltos y conviene no repetir:
- `-fps_mode passthrough` choca con `-r`: para pasar de un webm de framerate variable a
  un mp4 constante va el filtro `fps=30`, no `-r` suelto.
- Playwright graba desde que se crea el CONTEXTO, no desde que uno empieza a filmar: sin
  recortar, el reel arrancaba con los once segundos de armar la sala. Se guarda el
  instante de creacion y se recorta con `-ss`.
- El maestro slim viene como OBJETO indexado por id con `first_name`/`last_name`, NO con
  `name`. Armarlo con `p.name` daba un conjunto de cadenas vacias y acusaba de inexistente
  a Bijan Robinson. De ahi que el control negativo sea obligatorio.

FALTA: que el dueno elija el encuadre. Hoy recorta a 16:9 alrededor de `#au-lot`,
`#au-budgets` y `#md-choices`, y sale 1476x830. Se ve la puja subiendo ($52 a $76 sobre
Jahmyr Gibbs) cambiando de dueno y moviendose la insignia por la columna de presupuestos,
que es exactamente el gancho de la subasta. Dos arrugas sin decidir: el borde superior
corta el rotulo "DRAFT BOARD", y a 1920 de ventana el panel "My team" (vacio) entra en el
cuadro. Filmar a ~1400 de ventana lo esconderia solo, por la regla de layout de esta misma
sesion, y todo saldria ~20% mas grande.
Tambien falta corregir `public/index.html:264`: sigue declarando `width="1080"
height="1080"`. Se cambia AL desplegar el reel nuevo, a las medidas reales del que salga.

El mapa de la sala, por si hay que rehacerlo:
- Se arranca sin clicks fragiles: `goMock('solo')`, `selectOption` sobre `#md-dtype`,
  `#md-teams`, `#md-scoring`, `#md-format`, `#md-budget`, `#md-slot`, `#md-rounds`, y
  `#md-start-btn`. No existe ninguna funcion tipo `mdSetAuctionParams`.
- La sala: `#au-wrap`, con `#au-lot` (`.au-face`, `.au-name`, `.au-sub`, `.au-bid-num`,
  `.au-holder`) y `#au-budgets` (`.au-brow`).
- El ritmo lo lleva `AU_PACE` (1400-2200ms entre pujas), pensado ya para camara.
  `_auBidOnce()` es un paso atomico si se quiere filmar cuadro a cuadro; `window._AU_FAST`
  colapsa las esperas a 1ms. `auSimLot()` NO sirve para filmar: salta al resultado.
- **El motor NO tiene semilla.** `MD.seed` solo se usa para jitter en tres puntos; el
  resto llama `Math.random()` directo. Para que el reel sea reproducible hay que sembrar
  `Math.random` con `page.addInitScript` ANTES de que cargue app.js. Probado y funciona.
- Comprobado filmando: jugador REAL (Jahmyr Gibbs RB DET, contra el maestro de Sleeper),
  Familjen Grotesk auto-hospedada en `/fonts/*.woff2` (o sea que el defecto 3 del reel
  viejo, la fuente Archivo, muere por construccion), 12 filas de presupuesto, sin nombres
  cortados. Es decir: filmar el producto real arregla solo tres de los cuatro defectos.
- El cuarto (encuadre) es de HTML: `public/index.html:264` declara el video
  `width="1080" height="1080"` cuando el archivo real es 1920x1080 a 30fps, 13s, y el CSS
  lo pinta a `min(1120px,94vw)` en apaisado. Hay que corregir los atributos al generar.


## Sesion 2026-08-26: el reel sale del script, y My Rankings se lee como herramienta

Las dos cosas que quedaron esperando respuesta del dueno al cerrar la sesion anterior.
Contesto las dos y se cerraron.

### El encuadre del reel: elegido sobre tres medidos, y BAKEADO en el generador
`scripts/gen-reel.mjs` tenia el viewport clavado en 1920x1080 en dos constantes. Ahora
son `REEL_W` / `REEL_H` (por defecto lo mismo), y con eso se filmaron las dos candidatas
que decian las notas, mas una tercera.

- **1920 (lo de antes)**: 1476x830. El panel "My team" VACIO entra por la derecha y el
  rotulo "DRAFT BOARD" sale cortado arriba.
- **1400**: 1400x830. Esconde "My team" por la regla de layout del 25-ago, PERO deja el
  riel derecho (Queue) como un bloque vacio con su texto de ayuda. Sale PEOR que la de
  1920, al reves de lo que anticipaban las notas: filmar a 1400 no era la solucion.
- **Recorte cerrado (elegida)**: 1282x806. Tarjeta del lote entera, columna de
  presupuestos con la insignia moviendose, lista de jugadores. Ningun panel vacio.
  Unica arruga: la pestana "Results" queda cortada en el borde derecho, y eso se lee
  como una tarjeta que continua, no como un defecto.

Lo que cambio en el generador, y por que:
- **Se dejo de forzar 16:9.** Ese forzado crecia el lado ancho de ~1290 a 1476 y esos
  184px de mas eran EXACTAMENTE lo que metia el panel vacio en cuadro. El hero pinta el
  video a `min(1120px,94vw)` igual, asi que la proporcion exacta nunca fue un requisito.
- **Arriba ya no va aire.** El `AIRE` de 24px por los cuatro lados metia media linea del
  rotulo "DRAFT BOARD". Media palabra cortada es peor que ninguna.
- **El recordatorio final dice las medidas REALES** del recorte, no un literal. El reel
  viejo estuvo meses en produccion declarado `width="1080" height="1080"` sobre un
  archivo de 1920x1080; el recordatorio que hubiera evitado eso decia el numero a mano.

`public/index.html` linea ~264: el video pasa a `width="1282" height="806"` y a `?v=4`.
El comentario de encima describia el reel VIEJO (snake board, "you are on the clock") y
ahora describe el que hay: la sala de subasta, filmada por el script.

Los cuatro defectos que el reel tenia EN PRODUCCION quedan cerrados: jugador inexistente
(control negativo contra el maestro de Sleeper), nombre truncado, fuente Archivo (muere
por construccion, la app sirve Familjen Grotesk) y encuadre.

### My Rankings: de lista de tarjetas a rejilla de columnas
Referencia que mando el dueno: captura de "The Basement Draft Guide", del video de
YouTube eD7Y1UW7iF0 que no se habia podido ver. Alcance que eligio: **solo estetica y
densidad**, sin funciones nuevas (se le ofrecio Undo, Target Round y estrella/descartar,
y dijo que no).

**El diagnostico no era de color, era de densidad.** Medido: en escritorio la fila media
1050px y el contenido ocupaba 260. El 75% de cada fila estaba vacio entre el nombre y los
tres botones. La referencia llena ese espacio con columnas de dato y por eso se lee como
herramienta.

Lo que se hizo:
- **Rejilla de columnas compartida entre cabecera y fila.** `.rk-row` y `.rk-colhead`
  salen de la MISMA regla CSS: es lo unico que garantiza que las cifras caigan bajo su
  rotulo. Columnas: rank, foto, jugador, rank por posicion, ADP de consenso, distancia
  contra el consenso, acciones.
- **La columna de acciones va con ancho FIJO, no `auto`.** Con `auto`, la cabecera (que
  no tiene botones) media cero en esa columna y toda la rejilla salia corrida.
- **Medida de lectura de 760px en `#tab-rankings`.** Sin tope, la fila se estiraba a
  1500px y el hueco entre el nombre y POS era de 500px. Con el tope, 238px. El tope va en
  el TAB entero para que cabecera, herramientas y filas compartan margenes.
- **Foto del jugador con anillo del color de su posicion.** El mismo dato que el pill,
  dicho sin gastar una columna.
- **El rank por posicion sale de MI orden** (`WR1`, `RB4`), no del consenso.
- **La distancia contra el consenso se pinta SIEMPRE**, tambien cuando es cero. Antes
  solo aparecia en los jugadores movidos, o sea que una lista recien abierta escondia la
  unica cifra que dice algo. El cero va sin capsula y al 55% de opacidad: con fondo, una
  lista sin tocar era una columna de doscientos recuadros grises que se leian como
  campos de texto vacios.
- **Las bandas de tier declaran su conteo**, y el conteo es de filas VISIBLES: con un
  filtro puesto, decir "200 players" encima de tres seria mentir. Ademas el rotulo se
  pinta ANTES de la primera fila visible de su tier y no despues del corte, con lo que
  un filtro que vacia un tier entero ya no deja rotulos huerfanos.
- **Telefono: un solo arbol de DOM.** El envoltorio `.rk-nums` es `display:contents` en
  escritorio (sus hijos caen directos en la rejilla, cada uno en su columna) y vuelve a
  ser una caja en el telefono, agrupando equipo, pos-rank, ADP y delta en una segunda
  linea bajo el nombre. Ahi cada cifra se rotula sola (`ADP 1.7`, `vs +3`) porque no hay
  cabecera que las explique.
- **Tinta fija oscura en el pill de posicion, NO `var(--bg)`.** En tema claro el fondo es
  casi blanco y el pill quedaba texto claro sobre azul claro. Verificado en los dos temas.

Lo que NO se copio de la referencia, a proposito: su paleta (naranja oxido sobre negro;
la nuestra sigue siendo morado sobre negro), el panel de detalle del riel derecho (es
otra feature entera y el detalle del jugador ya vive en otra pantalla) y el "?" de ayuda
en cada columna.

**El gate pasa de 18 a 23 checks.** Los cinco nuevos: la cabecera cae a plomo sobre sus
columnas (tolerancia 2px), el delta se pinta en TODAS las filas visibles, cada fila lleva
su foto con el id de Sleeper, el rank por posicion es correlativo sobre mi lista, y las
bandas de tier suman exactamente las filas que hay. **Verificado que los seis fallan
contra el codigo anterior** (se restauro `public/rankings.js` y `public/styles.css` desde
HEAD y se corrio): 0 deltas de 200 filas, no hay cabecera, 0 fotos de 200 filas, filas sin
rank por posicion, 0 bandas.

De paso, el gate se endurecio: usaba `$eval`, que LANZA si el elemento no existe, y con el
codigo roto reventaba en el segundo fallo llevandose por delante los quince checks
siguientes. Ahora todos reportan FAIL en vez de tumbar la corrida.

Archivos tocados: `public/rankings.js` (`tmrPaint` reescrito, `tmrSkeleton` con la forma
nueva), `public/styles.css` (bloque `.rk-*` entero), `public/index.html` (video y su
comentario), `scripts/gen-reel.mjs`, `scripts/qa-rankings.mjs`.

### Estado al cerrar la sesion del 2026-08-26: DESPLEGADO Y VERIFICADO
HEAD 6b270f2, empujado a main, arbol limpio. Los SEIS gates en verde antes del commit
(calibrate-room ALL GREEN, qa-flows, qa-trades, qa-perfil 156, qa-rankings 23, qa-board 104).

Verificado por curl contra macdraft.app, no supuesto:
- cache-bust 2026082601 servido en sus 7 apariciones
- el <video> declara width="1282" height="806" con ?v=4
- styles.css, rankings.js, app.js, theme.css y promo-reel.mp4 los cinco 200
- "rk-colhead" y "rk-posrank" presentes en el rankings.js desplegado
- "#tab-rankings{max-width:760px}" y "rk-nums{display:contents}" en el styles.css desplegado
- promo-reel.mp4 servido con los mismos 600.879 bytes que el local
- "_mdFitCols" sigue en app.js y "My Rankings" en el HTML: sin regresion de las dos
  sesiones anteriores

## Sesion 2026-08-26 (tarde): ningun tab funcionaba, y el gate que faltaba

Reporte del dueno, en produccion: "no me salen los rankings" y "ningun tab esta
funcionando, todo me manda al home page". Los seis gates estaban en VERDE.

**Los dos fallos, y por que ningun gate los veia.**

1. **My Rankings no tenia puerta.** La pestana vivia solo en `.inner-tab-bar`, que en el
   telefono se sale de la ventana: medido, el tab cae en x=451 con la ventana en 390 y en
   320. Y el cajon de navegacion (`#mob-menu`) no lo listaba: el grupo Research tenia
   cinco entradas y esta no estaba. O sea que la feature se desplego entera, con su gate
   propio en verde, y no habia forma de llegar a ella.

2. **Carrera de historial al entrar desde el cajon.** `mobGo()` cerraba el cajon con
   `mobMenuToggle()`, que llama a `_overlayClosed()`, que cierra con `history.back()`.
   `history.back()` es ASINCRONO: su `popstate` aterrizaba DESPUES del `switchScreen()` de
   la linea siguiente, y el manejador restauraba la ruta anterior, la portada. Mismo fallo
   en `tabGo()` cuando la barra inferior se toca con el cajon abierto.
   Solo ocurre con el cajon ABIERTO, que es exactamente como llega una persona.

   NO ES REGRESION DE ESTA SESION: se levanto 7aa60b2 en un worktree aparte y falla igual.

**El arreglo.** `mobMenuCloseForNav()` cierra el cajon sin devolver la historia: saca el
cierre de `_overlays` (solo si es el de arriba, para no dejar colgado otro overlay) y
REAPROVECHA la entrada que empujo el cajon con `replaceState` en vez de devolverla, con lo
que el boton atras sigue saliendo a la portada de una. `mobGo` y `tabGo` la usan.
Y `My Rankings` se anadio al grupo Research del cajon.

**Gate nuevo: `node scripts/qa-nav.mjs`.** Recorre la app CLICANDO desde la portada: abre
el cajon con el control que este visible (More en el telefono, la hamburguesa en
escritorio), toca cada destino, y comprueba que la pantalla queda activa Y que el hero de
la portada ya no ocupa la ventana. Tambien el boton atras, y la barra inferior con el
cajon abierto encima. **Verificado que falla contra el codigo roto: 14 FALLOS.**

**La leccion, que ya es regla global del dueno:** un gate que entra por la puerta de
servicio no prueba la puerta de entrada. Los cinco gates viejos entraban llamando
`switchScreen()` y `renderX()` directo, y por eso estaban todos en verde sobre una app en
la que no se podia navegar. Toda feature nueva necesita su entrada en el menu y al menos
un check que llegue por clic.

Archivos tocados: `public/app.js` (`mobMenuCloseForNav` nuevo, `mobGo`, `tabGo`),
`public/index.html` (entrada My Rankings en el cajon, cache-bust a 2026082602),
`scripts/qa-nav.mjs` (nuevo).


## Sesion 2026-08-26 (noche): Draft Day, la subasta REAL conducida por el dueno

**El plazo que manda.** El dueno tiene una subasta real el domingo 30 de agosto de 2026
en Yahoo, liga Fantazy 2026. Yahoo no da API (la solicitud de Fantasy Sports sigue sin
respuesta desde el 4 de agosto). Pidio una herramienta para usar EN VIVO durante ese draft:
"que vaya tanteando la sala", "reaction time muy rapido sin perder accuracy", "basado en mis
rankings", y consejos en cristiano del tipo "este es el ultimo RB de tu tier, quemate la
plata y despues usa tu talento para un receiver de 5 dolares".

**Su liga ya estaba en el codigo.** `FZ26_SEATS` (app.js ~9772) y `mdFantazy26Toggle`:
10 equipos, $200, subasta, half PPR, 1QB, 15 rondas, TD de pase a 6, el en el asiento 9,
diez rivales con nombre y arquetipo. El dueno CONFIRMO que la liga del domingo es esa.
Tres datos suyos que gobiernan el diseno: es el PRIMER auction de casi todos sus rivales;
el cree que Gibbs y Bijan se van "como en 80"; y se declara bueno en la franja media de WR
pero "a veces me dejo llevar por top receivers".

**Decision de arquitectura: NO se escribio un motor nuevo.** `auMyWorth`, `auBotMax`,
`auInflation` y `auSell` ya hacian todo lo que pidio. Lo unico que faltaba era que la sala
la condujera la realidad en vez de los bots. Eso es `AU.live`: TRES cortes en `app.js`
(`auAdvance` sale temprano, `auOpenLot` no arranca el reloj de pujas, `auSell` no encadena
la siguiente nominacion y llama a `lvAfterSale`). Con `AU.live` apagado el comportamiento
es IDENTICO, que es lo que mantuvo el gate de 40 invariantes en verde. El domingo corre el
mismo codigo que paso las 600 salas del gate.

**`public/live.js` (nuevo).** Panel flotante y arrastrable en escritorio, hoja pegada abajo
en el telefono, un solo DOM decidido por CSS (bloques `.lv-*` al final de `styles.css`).
Entrada de una caja: escribir `gibbs` pinta el techo mientras teclea; `gibbs 74 3` y Enter
registra la venta (jugador, precio, asiento). Se entra por "Draft Day (live auction)" en el
cajon, arriba del todo, porque el dia que se usa no hay tiempo de buscarla.

Lo que hace, y de donde sale cada cosa (nada inventado):
- **Techo con desglose**: mercado (`auMyWorth`), mi lista, gusto, reserva y ley del
  presupuesto, cada parte pintada. Y SIEMPRE al lado el numero limpio sin gusto, con lo
  que le cuesta su emocion en dolares.
- **Mis rankings entran en el precio**: el jugador que tengo en el puesto k vale lo que
  ESTA sala paga por su k-esimo mas caro (la curva que `auPoolInit` ya normalizo). Peso
  50% por defecto. Quien no esta en mi lista se queda con el mercado puro, no se castiga.
- **Listas de gusto pegadas** (Love +15%, Not so much -15%, Not my guy -35%). NINGUNA veta:
  regla textual del dueno, "quiero llevarme jugadores que no me gustan si el valor es
  correcto; que mis emociones afecten pero hasta un punto". Los nombres no reconocidos se
  DECLARAN, nunca se tragan.
- **Ganga**: solo cuando vale mucho mas que la puja Y se calculo (via `auBotMax`) que
  ningun rival con hueco llega al precio. La primera version comparaba precio contra valor
  a secas y, como todo lote abre en $1, gritaba ganga en cada nominacion. Lo cazo el test.
- **Tanteo de la sala** tras cada venta: dinero real por asiento, titulares que debe,
  pagado contra valor, y la FASE en cristiano ("the room is running out of money, what
  comes next goes cheap"). Contra una sala novata que se funde el presupuesto temprano,
  gana quien sabe cuando se quedaron sin dinero.
- **Reserva de presupuesto** (pendiente viejo del repo, ahora con motivo): se descuenta
  del techo y SE LIBERA SOLA con la sala rota o con 4 huecos o menos, para no crear dinero
  muerto, que es un fallo que `auInflation` ya habia medido.
- **El consejo** (`lvAdvice`): UNA linea o silencio. Prioridad: ganga confirmada, el sesgo
  que el mismo declara ("you already have 3 WRs and still owe 3 starters, this is the pull
  you told me you fall for, let him go"), ultimo de su tier en algo que necesita (con la
  salida barata contada sobre jugadores DRAFTABLES, no sobre la cola larga), sala rota,
  pasado de precio. El orden importa: con la ganga en tercer lugar, el aviso verde y la
  frase del tier se contradecian en el segundo de decidir.

**Dos bugs del repo, medidos y arreglados de paso:**
- La casilla "Use in mock drafts" no hacia NADA por el camino real: `TMR` solo se cargaba
  al abrir el tab. `tmrHydrate()` en `rankings.js` la construye sin pintar UI (16 ms).
- El precio base era falso en half PPR: `_auRawValue` solo usaba el AAV real si
  `MD.scoring>=1`. Gibbs salia a $49 con AAV real de $67, y el #1 costaba el 24,5% del
  presupuesto contra los 30-32% documentados. Arreglo en `auPoolInit`: la ESCALA sale de la
  curva empirica de AAV reales, a QUIEN le toca cada precio lo decide el ADP del formato.
  Gibbs pasa a $57 ($67 con el premium de RB de su liga), el #1 al 28,5%, conservacion de
  dinero intacta ($2003 sobre $2000 en 150 huecos). calibrate-room: ALL GREEN, 40/40.

**Busqueda por apellido.** `chase` devolvia a Chase Brown (Chase es el nombre de pila del
otro). En una subasta eso registra la venta equivocada y envenena todo el tanteo. Ahora
manda el apellido y a igualdad gana el mas caro de la sala. Peor caso sin cache: 0,03 ms.

**El mock de Yahoo del dueno, leido del archivo que guardo con Cmd+S** (esta en
`/Users/wolco/Downloads/Live NFL Draft _ Yahoo Fantasy Sports.html`): era de 12 equipos,
no de 10, asi que sus precios ($72 Gibbs y Bijan) vienen inflados por sala profunda
(HALLAZGO 1 de la auditoria). A 10 equipos equivalen a ~$64, y con el premium de RB ~$75.
Yahoo NO deja anclas en su DOM (1.223 clases hasheadas `_ys_*`, cero `data-testid`), asi
que el lector, si se hace, va sobre el TEXTO visible (`Budget`, `Max Offer`, `Proj $`,
`$72`, `1/15`), que es producto y no cambia con un rediseno. NO ESTA ESCRITO. La
herramienta funciona igual tecleando, y eso esta probado.

### El lector de Yahoo (mismo dia, mas tarde): ESCRITO, PROBADO, NO DESPLEGADO
Sin API y sin anclas en el DOM, el lector va sobre el TEXTO visible de la sala
(`document.body.innerText`). La sala real del dueno esta en
`scripts/fixtures/yahoo-auction-room-2026-08-26.txt` y el gate la lee tal cual.
- **Transporte: un marcador de favoritos** (`lvBookmarklet`). Se arrastra UNA vez a la barra
  desde la seccion "Yahoo" del panel; en la sala de Yahoo se toca, abre Mac Draft en una
  ventana con `#draftday` (la sala arranca sola) y le manda el texto cada 1,5 s por
  `postMessage`. Sin consola, sin extension, sin servidor, sin tocar su navegador desde
  fuera. El receptor solo acepta mensajes con la forma exacta y origen `*.yahoo.com`
  (`LV.anyOrigin` lo relaja SOLO en el gate).
- **`lvParseYahoo`**: lote (ancla `Proj $`), ultima venta (`Last:`), tabla de presupuestos
  (`nombre | $N | a/b`, por ORDEN porque en el mock habia dos "Kevin", y el badge `$1` de
  la puja viva se cuela dentro y se ignora), y Results cuando la pestana esta activa.
- **`lvResolve`**: "B. Robinson" por inicial + apellido (Bijan, no Wan'Dale).
- **`lvSeatOf`**: equipos de Yahoo a asientos por nombre contra `FZ26_SEATS` (prefijo si
  el preset lo tiene truncado, "Family Feud ..."), "You" es el dueno, el resto al primer
  asiento libre y DECLARADO en el panel.
- **`lvApplyYahoo`** es idempotente (el mismo texto no vende dos veces). Ventas desde
  Results si esta visible; si no, por DIFERENCIA de presupuesto (contador +1 y dinero
  abajo = venta, precio = lo que bajo, jugador = `Last:`). Si Yahoo tiene mas compras que
  el panel, pide abrir Results una vez, con los dos numeros. Sin cartel SOLD ni sonido
  mientras aplica (nueve de golpe al conectar se montaban sobre el panel).
- `lvEnter` ahora FUERZA subasta y entra por `goMock`: en la segunda visita abria en snake
  (`AU.slotsLeft` no existia) y con la portada detras del panel. Los dos los cazo el gate.

**Gate: `node scripts/qa-live.mjs`, 43 checks** (parser sobre la sala real, idempotencia,
venta por diferencia, marcador de punta a punta con ventana emergente real, portada fuera de
pantalla, ponerse al dia, nombres repetidos, prefijo). Los ocho gates en verde.
**DESPLEGADO (verificado 2026-08-26, sesion siguiente):** `origin/main` = HEAD a84237b y
macdraft.app sirve live.js, app.js, rankings.js, styles.css e index.html byte a byte
iguales al local (sha256). `QA_BASE=https://macdraft.app` qa-live 43/43 y qa-nav en verde.
El cache-bust sigue en 2026082603 (no se subio a 04 porque los archivos ya se sirven
identicos; subirlo solo si vuelve a cambiar live.js).

**Gate original: `node scripts/qa-live.mjs`, 24 checks.** Entra CLICANDO desde la portada en
escritorio y telefono. Verificado que falla contra HEAD anterior: (b1) y (b2) rojos, la
entrada no existe, `lvEnter is not a function`.

Archivos: `public/live.js` (nuevo), `public/app.js` (3 cortes `AU.live`, `auPoolInit`),
`public/rankings.js` (`tmrHydrate`), `public/styles.css` (`.lv-*`), `public/index.html`
(entrada del cajon, carga de live.js, cache-bust 2026082603), `scripts/qa-live.mjs` (nuevo).

Pendiente: el lector de Yahoo sobre texto (opcional, no bloquea el domingo); calibrar el
premium de RB con los precios REALES de su liga cuando existan; el panel flotante de
rankings dentro del mock (opcion A que el eligio) queda ABSORBIDO por Draft Day.

## Sesion 2026-08-28: subasta real como calibracion, y My Rankings con precios

**Lo que llego.** El dueno mando la captura de una subasta REAL de Sleeper ("NFL Divas":
10 equipos, $200, 13 rondas, 1QB, publico parecido al de su liga del domingo 30) y pidio
pesarla mucho. Transcrita a `scripts/fixtures/auction-nfl-divas-2026-08-27.json` (130
lotes; ocho columnas suman $200 al dolar, kike0189 -$2 y gabhom9 -$33 declarados dentro).

**Lo que dijo la sala contra el motor** (`node scripts/compare-real-auction.mjs <fixture>
--rounds 13 --curve X`, corre el motor real con FZ26 y compara jugador por jugador):
- Con VAL_CURVE=0.86 el motor era demasiado plano: $50+ reales $990 vs $777 simulados
  (-22%); los 29 lotes de $1 reales el motor los subia a $95. La franja $15-29 estaba
  bien (+4%). Sala real = stars and scrubs: #1 al 43% del presupuesto, top-10 con el 33,5%
  de todo el dinero, 38 de 130 lotes a $1.
- **VAL_CURVE pasa de 0.86 a 1.2** (`public/app.js` ~12973, sobreescribible con
  `window.AU_VAL_CURVE`). A 1.2: Gibbs sticker $80 vs $86 real, Bijan $77 vs $79, Chase $70
  vs $73, RB total -2%, franja $15-29 -1%. Commit d14ad7f. calibrate-room ALL GREEN 40/40,
  qa-flows verde, qa-live 43/43 (el check (i) vendia a dolares fijos que con la curva
  nueva ya no eran sobreprecio; ahora deriva el sobreprecio del sticker vigente x1.2).
- Lo que 1.2 NO cubre, a proposito: QB inflado en esa sala (Burrow $30 vs $12; -25% en
  QB, la mitad es un solo lote), RB2 a precio de RB1 (Chase Brown $56, Walker $55, Hampton
  $53 contra $39/$36/$40), y mas $1 reales de los que simula el motor.

**Precios FZ26 con la curva nueva (sticker / venta simulada):** Gibbs 77/83, Bijan 75/81,
Chase 68/73, Nacua 65/70, CMC 64/69, Taylor 61/66, JSN 61/66, ASB 59/64, Cook 54/57,
Barkley 53/57, Lamb 53/56, Jefferson 51/56, Jeanty 45/48, Achane 42/45, Hampton 40/43,
Henry 39/41, C. Brown 39/40, Allen 36/38, AJB 36/37, Walker 36/37, London 35/36, Bowers
34/35, McBride 33/34, Collins 32/33, Pickens 32/33, Kyren 31/31, Love 27/26, Jacobs 26/25,
Rice 26/24, Nabers 25/22, Olave 24/21, Hall 23/21, Javonte 22/19, D. Smith 21/18, McMillan
20/17, Lamar 19/18, Skattebo 19/16, Higgins 18/16, Flowers 17/14, McConkey 17/14, Egbuka
17/14, Etienne 16/12, G. Wilson 15/10, Loveland 15/14, Irving 14/11, Montgomery 13/9,
Judkins 13/8, Swift 12/8, Maye 11/10, Warren 11/10, Henderson 11/8, Burrow 10/9, Hurts 7/6.

**Plan que se le dio al dueno** (el lo aprobo por accion): Gibbs hasta $90, tope $92;
segundo RB en Jeanty/Achane ($42-50) o tarde en la franja $25-40 (Henry, Kyren, Love,
Jacobs, Hall, Javonte), NUNCA en la franja $50-65 donde la sala pierde la cabeza; RB3
gratis (Skattebo, Judkins, Henderson); ~$53 para 3-4 WR de la franja $9-20 que la sala
regala cuando ya no tiene plata; QB a $5-11; nominar temprano los RB2 de $50 y los QB caros
para que los demas se quemen. Sesgo a vigilar: AJB/London/Collins a $35-41.
Jugadores que le gustan (textual): Swift, Hall, Etienne, Skattebo, Javonte "y ese tier".

**EN CURSO al escribir esto (agente `wolco-ingeniero`, nombre rk-precios, SIN commit):**
feature en My Rankings, SOLO para el dueno (misma `permitido(acctId)` de
`server/routes/perfil.js`, endpoint nuevo `/api/perfil/owner`):
1. Columna $ por jugador = techo limpio del motor para FZ26 (mercado + mi ranking, sin
   gusto), EDITABLE inline, manual guardado por id de Sleeper.
2. Target toggle por fila + barra Build (suma de objetivos, resto de $200, huecos de 15 con
   relleno a $1, desglose por posicion, rojo si se pasa).
3. Draft Day lee el precio manual como techo del dueno.
4. **Sync por servidor para editar desde el celular**: GET/PUT `/api/perfil/rankings`, un
   solo documento del dueno en Vercel Blob (patron de `server/routes/sage.js` ~295-320),
   compartido por sus dos acctId; localStorage como cache, PUT con debounce, indicador
   saved/saving/offline.
5. Seed de una sola vez (`tm_rk_seed_v1`): objetivos precargados (Gibbs, Jeanty, Achane,
   Henry, Kyren, Swift, Hall, Etienne, Skattebo, Javonte, Judkins, Henderson, Olave,
   McConkey, D. Smith, Egbuka, Flowers, Higgins, McMillan, Loveland, Warren, Kraft, Hurts,
   Daniels, Maye) y lista Love de Draft Day con su tier de RB.
Gates a extender: qa-rankings (ida y vuelta entre dos contextos, control negativo sin
owner) y qa-live (lee el manual). Verificar que los checks nuevos fallan contra HEAD.

**Si la sesion se corto antes de cerrar, el proximo paso es:** `git status` para ver que
dejo el agente; leer su trabajo; correr qa-rankings, qa-live, qa-nav, qa-board; subir el
cache-bust de index.html a 2026082801; commit; push a main (Vercel despliega solo);
verificar en produccion por curl (sha256 de rankings.js, live.js, app.js contra el local)
y `QA_BASE=https://macdraft.app node scripts/qa-live.mjs`. Recordarle al dueno que en el
celular la lista sale del servidor: abrir /research > My Rankings con su cuenta habilitada.

### Cierre 2026-08-28: My Rankings con precios, plan y sync, DESPLEGADO
Retomado por un agente en la nube desde `wip/rk-precios` (07b0764, columna $ editable,
Target y Build ya hechos y en verde). Lo que faltaba y se termino:

- **Solo dueno.** `GET /api/perfil/owner` -> `{owner:true|false}`, siempre 200, con la
  MISMA `permitido()` y `readAcctId` de `server/routes/perfil.js`. `rankings.js` lo
  pregunta UNA vez (`tmrOwner`), pone `.rk-owner` en `#tab-rankings`, y solo entonces
  pinta Pay, el objetivo y la barra Build. La rejilla base del CSS vuelve a ser la de
  siempre (7 columnas); `.rk-owner .rk-row,.rk-owner .rk-colhead` anade las dos del
  dinero. OJO: esa regla pesa mas que `.rk-row` y en el bloque movil hay que repetirla,
  o la plantilla de escritorio se impone en 390px (medido: right=715, lo cazo el gate).
- **Sync por servidor.** `GET/PUT /api/perfil/rankings`, tras `requireAcctId` +
  `permitido()` (401 anonimo, 403 ajeno, 400 forma mala, 413 sobre el tope). Un solo
  documento `perfil/rankings-owner.json` en Vercel Blob (patron de sage.js), compartido
  por los dos acctId. Sin token o con `PERFIL_RK_STORE=local` cae a archivo
  (`PERFIL_RK_FILE` o el tmpdir) y la respuesta lo DECLARA en `store`; el gate usa eso
  para no tocar el blob real aunque `.env.local` traiga el token. El tope efectivo es
  100 KB, no 200: lo corta antes el `express.json` global; el documento real pesa ~6 KB.
  Cliente: localStorage pinta al instante; `tmrSyncPull` al abrir y al volver el foco
  (reemplaza si `updatedAt` del servidor > `tm_rk_sync_at` local y no hay cambios
  sucios); `tmrSyncQueue` con debounce 800 ms desde `tmrSave`, `tmrPlanSave` y
  `lvSavePref`; `pagehide` manda el pendiente con `keepalive`; indicador de texto
  `#rk-sync` (Saving / Synced / Offline, will retry), sin spinner. El documento lleva
  orden, cortes, precios a mano, objetivos, las tres listas de gusto y `seeded`.
- **Seed una sola vez** (`tm_rk_seed_v1` local y `seeded` en el documento): los 25
  objetivos y los 8 Love resolvieron TODOS contra el board (verificado en el gate,
  `missing: []`); si alguno no resolviera, se declara en la barra Build.

**Gates.** qa-rankings 59 checks (eran 46 en la rama, 23 en main); los nuevos: N1-N3
control negativo (cuenta ajena: cero celdas Pay, cero barra, cero PUT/GET, 7 columnas),
S1-S4 seed y subida, R1-R4 ida y vuelta entre DOS contextos de navegador (390px el
segundo, y la vuelta al volver el foco), O1-O2 los endpoints. qa-live 47, qa-nav 16,
qa-board 104, qa-perfil 156, todos en verde. calibrate-room no se corrio (no se toco el
motor; ya habia corrido en verde hoy).
Contra main (arbol extraido con `git archive`, mismo gate nuevo): ver el reporte de
la sesion para la cifra exacta de fallos.

**Que le toca al dueno.** En el celular: abrir /research > My Rankings con la cuenta
habilitada (los dos acctId ya estan en PERFIL_ACCTS); la lista baja del servidor sola.
El indicador dice "Synced" cuando el servidor tiene lo ultimo.

Archivos: `server/routes/perfil.js` (owner + rankings), `public/rankings.js` (owner,
sync, seed), `public/live.js` (lvSavePref encola), `public/styles.css` (rejilla por
dueno, `.rk-sync`), `public/index.html` (`#rk-sync`, cache-bust 2026082801),
`scripts/qa-rankings.mjs`.

### Cierre real de la sesion (2026-08-28, escrito por el principal)
- El "agente en la nube" corrio en realidad en un worktree LOCAL
  (`.claude/worktrees/agent-...`) sobre la rama `wip/rk-precios`; el commit de la feature
  es 3974990 en esa rama. El primer merge a main tomo la rama del worktree equivocada
  (apuntaba a la base) y main se desplego un momento SIN la feature; corregido mergeando
  `wip/rk-precios`. Leccion: mergear por el hash del commit, no por el nombre de rama del
  worktree.
- Control negativo del gate nuevo contra main: **24 FAILs** (worktree detached de main
  con el `qa-rankings.mjs` nuevo copiado encima).
- `calibrate-room` corrio en verde hoy (40/40) ANTES de la feature, sobre VAL_CURVE 1.2.

### PWA: la app instalada abria en Safari (mismo dia)
Reporte del dueno: "cuando abro el app de mac draft se me abre como un website". Causa:
NO habia manifest ni `apple-mobile-web-app-capable`, asi que "Add to Home Screen" creaba
un marcador. Arreglado en b3bcd70:
- `public/manifest.webmanifest` (standalone, scope /, background_color de marca #2a1f4a,
  iconos 192/512 escalados desde apple-touch-icon.png de 180, la unica fuente que hay).
- Metas de iOS en el head y `<style>html,body{background:#050507}</style>`.
- 12 `apple-touch-startup-image` (de la SE a la 16 Pro Max, degradado VERTICAL, 1,3 MB
  entre todas) y un `#tm-splash` CSS solo en `display-mode:standalone`, mismo degradado y
  mismo icono, que se quita solo a los 1,6 s aunque el JS se caiga.
- Todo lo genera `node scripts/gen-pwa-assets.mjs` (ffmpeg; el fondo negro del icono se
  quita con colorkey para el splash). Verificado en navegador: splash oculto en modo
  web, manifest 200 `application/manifest+json`, 390px sin desborde, consola limpia salvo
  los dos del entorno local.
- **El dueno tiene que DESINSTALAR y volver a anadir la app a la pantalla de inicio** para
  que iOS tome el manifest y el modo app.

## Sesion 2026-08-28 (tarde): Tier Game y cheat sheet, con los settings de SU liga

Pedido del dueno, textual: "para los tiers me lo pudieras hacer como un juego y despues
tu mismo descifras los tiers y desde ahi los edito, para no tener que hacer todo yo. que
sea solo de los top 100 jugadores. hazme un quien prefieres y por cuanto y asi descifras
si los tengo en el mismo tier o no y a cual prefiero". Y: "basado en eso quiero que me
hagas mi cheat sheet para el auction". Las dos piezas son SOLO del dueno, por la misma
puerta `.rk-owner` / `tmrOwner()`, dentro de My Rankings y en el mismo documento
sincronizado (`/api/perfil/rankings`, ahora con `game` validado forma a forma).

### El juego, y por que la inferencia tiene DOS ejes
Cinco respuestas y no dos ("A clearly / A slightly / Same tier / B slightly / B clearly"),
porque "same tier" es justo el dato que un si/no tira a la basura: un tier ES un grupo de
jugadores entre los que da igual cual te toque.

`tmrTiersInfer` es PURA (sin DOM, sin TMR; los precios se pueden inyectar con `opts.pay`)
y resuelve DOS cosas distintas con las mismas respuestas, por Gauss-Seidel sobre un
sistema diagonalmente dominante:
- **El orden**, en puestos de lista, con SU lista como prior. El mercado no entra.
- **El corte**, en dolares, con el Pay del motor como prior.

Por que dos y no uno: regla del dueno, textual, "no tengo que picar a un jugador por
valor, puedo solo pagar por los que me gustan aunque esten mas abajo". Sus tiers son de
PREFERENCIA. El prior del dinero solo arranca la conversacion y **se rinde sin
resistencia** (ancla 0.15 contra el 1 de cada respuesta): medido, un solo "same tier" suyo
borra un escalon de mercado de $19. Y con CERO respuestas ya salen 9 tiers del escalon de
precios, que es lo que hace que una sesion de 30 preguntas valga en vez de dejar una lista
plana. En ningun sitio se dice "reach" ni "por encima del valor": en subasta se paga.

**El corte se autoescala.** Un umbral fijo en dolares daba veinte tiers arriba y ninguno
abajo: arriba los precios estan densos ($80, $75, $68) y abajo todo vale $2. El umbral es
`max(1,5% del bote, 2.2 x el salto tipico de la lista)`.

**La pareja se elige por ganancia de informacion**, no por recorrido: la que tiene el salto
de dinero mas cerca del umbral (donde menos se sabe si van juntos o separados), pesada por
el dinero en juego (por eso arranca en el top y va bajando sin una regla aparte) y
penalizada por la evidencia que ya existe. Lo que se deduce con dos "clearly" encadenados
NO se pregunta. Una de cada siete cruza posiciones dentro del top 30.

**Escalada** (regla suya, textual: "si ve que un jugador me gusta mucho quiero que hasta lo
pruebe con jugadores de mas arriba"): quien gana clearly contra alguien por encima suyo, o
encadena dos victorias, se enfrenta al tier de arriba de su posicion, y al de mas arriba,
hasta que pierda o empate; si ya no le quedan rivales arriba, se prueba al que perdio
contra alguien de mas abajo. Sube tres tiers en tres preguntas en vez de en quince.

**Contradicciones**: los ciclos A>B>C>A se detectan, se ensenan en el panel y se ofrece
re-preguntar el eslabon que cierra el circulo. Contestar una pareja otra vez REEMPLAZA la
respuesta anterior en vez de duplicarla, o el ciclo sobreviviria a su propio arreglo.

**El progreso es real**: "X of Y tier boundaries resolved", con Y = las parejas de vecinos
dentro de cada posicion del universo (96 en una lista de 100). Puede saltar varios puntos
con una respuesta, o quedarse quieto si lo que contesto ya se deducia.

"Apply tiers" avisa antes de aplicar (cuantos mueve, cuantos cortes deja) y solo toca el
top 100: los cortes de mas abajo se conservan porque el juego no pregunto por ellos.

### La cheat sheet
Vista a pantalla completa dentro del tab, con `@media print`. Arriba el plan (objetivos,
suma, resto de $200, huecos) y **los hallazgos de mercado**; despues, por posicion, cada
tier con sus jugadores, su Pay y los objetivos marcados.

- "Cheapest in: X $A, saves $B vs Y" cuando el tier tiene dos o mas y el ahorro llega a $5.
- Si el ahorro llega a $20 en RB o WR, "Spend it on <su objetivo mas caro>". Es la regla que
  el escribio: Swift en el tier de Hall significa quemarse la plata en Gibbs.
- **El hallazgo principal**: si alguien de SU tier cuesta la mitad o menos que el mas caro
  del tier, "Market has him lower: pay $X for a tier-N player", y sube al plan.
- **Sin cortes de tier la hoja se CALLA** y dice por que. Lo destapo el gate: sin tiers, el
  "tier" es la lista entera y la linea decia "el RB mas barato te ahorra $85 contra Gibbs",
  que es cierto y no significa nada.
- Las notas de la sala real son cuentas del fixture `auction-nfl-divas-2026-08-27.json`,
  verificadas al escribirlas: #1 a $86 (43% de un presupuesto), 38 de 130 lotes a $1,
  C. Brown $56 / Walker $55 / Hampton $53, Allen $38 / Burrow $30 / Jackson $25.

### Los settings de FZ26 mandan, y se FUERZAN
Regla suya: "toma en cuenta los league settings y format de la liga". `tmrRoomCfg()` para
el dueno devuelve SIEMPRE Fantazy 2026 (10 equipos, $200, 15 rondas, half PPR, 1QB), sin
tocar lo que el tenga elegido en Mock Draft. Antes leia la memoria del mock, asi que
ponerse a probar una sala de 12 equipos le movia los precios del domingo por debajo.

- **El board es el de half PPR.** Medido el 2026-08-28: entre PPR entero y half PPR se
  mueven 86 de los 100 primeros y hasta 9 puestos (los RB suben, los WR bajan). Preciar en
  half PPR con el orden de PPR entero es decir "half PPR" y cobrar otra cosa. `tmrAdpFmt`
  es un ESPEJO de app.js ~10454 y el gate lo extrae de los dos archivos y los compara.
- **El roster es el de la liga**: `tmrRosterShape` da QB1+RB2+WR2+TE1+FLEX1+K1+DEF1 = 9
  titulares y 6 de banca. La barra Build y la hoja dicen que titulares faltan por cubrir;
  K y DEF salen siempre sin cubrir a proposito (no estan en la lista y se compran a $1).
- **El TD de pase a 6 se DECLARA pero no mueve el Pay**, y se dice en el codigo en vez de
  fingir: `MD.sixPt` solo entra en `dv` (app.js ~10498), que es la proyeccion de las
  recomendaciones; `auPoolInit` no lo mira.
- La cabecera de la hoja y la barra Build declaran la liga entera con sus numeros.
- El veredicto de dueno se cachea en `tm_rk_owner` para elegir el board desde la primera
  linea. En la PRIMERA visita de un navegador nuevo la columna ADP sale en PPR entero (el
  precio ya es correcto en las dos ramas); a partir de la segunda, todo en half PPR. Se
  intento rehacer la lista al vuelo y salio peor, medido: la pantalla se vaciaba un
  instante y el gate cazo tres carreras.

### Defectos que cazo el gate, no la lectura
- Un "clearly" entre dos jugadores que en el orden nuevo dejaban de ser vecinos NO cortaba
  en ningun sitio. Ahora la separacion se cierra sobre la pareja entera, y un "same tier"
  declarado borra cualquier corte del tramo (va el ultimo: es la unica respuesta en la que
  el dueno niega el escalon con todas las letras).
- **Diez jugadores del top 200 no tienen ADP de half PPR** y salian con "$-". El pool de
  precios ahora incluye a cualquiera que este en la lista, con el ADP que tenga.
- La escalada medía el puesto DESPUES de la respuesta: un solo "clearly" ya mueve ocho
  puestos, asi que el ganador ya estaba arriba y nunca escalaba. Se mide en la lista de
  antes.

### Gates
`qa-rankings` pasa de 59 a **109 checks**. Nuevos: G1-G9 (la inferencia como funcion pura),
M1-M10 (prior del mercado, escalada, ganancia de informacion, contradicciones con su
control negativo, sesion corta), J1-J8 y K1-K3 (jugar entrando por el boton, y retomar
entre DOS navegadores), F1-F7 (los settings de FZ26, incluido que el Pay NO se mueve con la
memoria del mock puesta en 12 equipos PPR, y el espejo anti-deriva contra app.js), H-0 y
H9-H10 (la hoja), N4 (control negativo: una cuenta ajena no tiene los botones ni escondidos).
**Verificado que 50 de los 109 fallan contra el codigo previo** (worktree detached de
7abe208 con el gate nuevo copiado encima), y los 59 restantes siguen pasando.

`qa-live` 47, `qa-board` 104 y `qa-nav` en verde. `calibrate-room` NO se corrio: no se toco
el motor (VAL_CURVE, auPoolInit y app.js quedan intactos).

**Dos veces hubo que endurecer el gate**: los checks nuevos leian campos de un `eva` que
contra el codigo roto devuelve `{_err}`, y la corrida REVENTABA en el primer fallo
llevandose por delante los veinte de detras. Es la misma leccion que este repo ya pago con
`$eval`. Y de paso, el check (f) de `qa-nav` leia la lista sin esperar a su fetch (~3 s con
la cache fria) y fallaba al azar TAMBIEN contra HEAD: llevaba tiempo mintiendo en las dos
direcciones.

### Estado al cerrar: DESPLEGADO Y VERIFICADO
HEAD 6a7ed17, empujado a main. Verificado por curl contra macdraft.app, no supuesto:
rankings.js y styles.css byte a byte iguales al local (sha256), index.html igual, el
cache-bust 2026082804 en sus 8 apariciones, y los marcadores nuevos servidos
(`_tmrEscalada`, `tmrGameCycles`, "Market has him lower", `rk-owner-tools`, `rk-gm-cyc`,
`rk-sh-gaps`). Capturas a 390px del juego y de la hoja revisadas a ojo.

Archivos: `public/rankings.js` (el juego, la inferencia, la hoja, la sala forzada),
`public/styles.css` (`.rk-gm-*`, `.rk-sh-*`, impresion), `public/index.html`
(`#rk-owner-tools`, `#rk-game`, `#rk-sheet`, cache-bust), `server/routes/perfil.js`
(validacion de `game`), `scripts/qa-rankings.mjs`, `scripts/qa-nav.mjs`.

Pendiente de gusto, para cuando el juegue de verdad: si 30 preguntas le dejan los tiers
como los quiere, o hay que mover `TMR_CUT_K` (hoy 2.2) y los margenes de "clearly" y
"slightly" (8 y 2 puestos, $10 y $2 en una sala de $200).

## Sesion 2026-08-28 (noche): vincular dispositivos con un codigo

**El reporte.** El dueno reinstalo la PWA en el iPhone y dejo de ver lo suyo:
My Rankings con Pay, Tier Game, Cheat Sheet, el sync y /perfil. No era un bug de
esas features: la cuenta de esta app es POR NAVEGADOR (`tm_acct`, una llave
aleatoria del localStorage, `public/app.js:37`), y la app instalada estrena
almacenamiento, o sea acctId nuevo. Como `permitido()` solo miraba PERFIL_ACCTS,
y una variable de Vercel solo entra con un deploy, la unica salida era copiar un
hash a mano y redesplegar. Cada navegador nuevo, un deploy.

**Lo que se hizo.** `permitido(acctId)` pasa a ser la UNION de dos listas:
- la de env, que no se toca nunca, para que un Blob caido o vacio no deje fuera
  tambien al dueno de siempre;
- una segunda en el mismo Vercel Blob (`perfil/extra-accts.json`), que alimenta
  el propio dueno desde un dispositivo YA vinculado.

Se cachea 60 s en memoria porque `permitido()` es sincrona y la llaman tres
rutas por peticion; los tres puntos de control (`GET /`, `/owner`, `rkGuard`)
hacen `await extraSync()` antes. En Vercel cada instancia tiene su copia: la que
atiende un claim la recarga en el acto (`extraSync(true)`) y las demas se ponen
al dia dentro del minuto. Eso esta documentado en el codigo, no es un descuido.

De paso, el almacen de documentos se generalizo: `docRead(nombre, archivo)` y
`docWrite(...)` sirven a los TRES documentos del perfil (rankings, codigos,
cuentas), con el mismo fallback a archivo de `PERFIL_RK_STORE=local`. `rkRead` y
`rkWrite` quedan como envoltorios de una linea, asi que el gate que prueba uno
prueba el mecanismo de los tres.

**Los dos endpoints.**
- `POST /api/perfil/link/new`: SOLO una cuenta ya permitida reparte codigos. Si
  no fuera asi, cualquiera se fabricaria su propia llave de entrada. Seis
  digitos con `crypto.randomInt`, diez minutos, un solo uso.
- `POST /api/perfil/link/claim {code}`: cualquier cuenta con llave puede
  intentarlo, el codigo es lo que autoriza. **Primero entra la cuenta y despues
  se quema el codigo**: al reves, un fallo a mitad de camino dejaria el codigo
  gastado sin haber vinculado a nadie, y desde el telefono no habria como
  saberlo.

**Decision que conviene no revertir: un codigo rechazado responde 200 con
`{owner:false, error}`, no 400.** Chrome imprime en consola CUALQUIER respuesta
que no sea 2xx, y en este repo un error de consola cuenta como bug. Teclear mal
seis digitos es un camino normal de usuario, no una averia. Es el mismo criterio
que ya tenia `/owner`. Lo cazo el gate: con 400, el check de consola limpia
fallaba. Siguen siendo codigo de error las cosas que el usuario NO puede
provocar tecleando: 401 sin llave, 400 con el cuerpo mal formado (la UI nunca lo
manda) y 502 con el almacen caido.

**Por que el limite por cuenta no basta.** Fabricar cuentas nuevas es gratis
(cualquiera mina llaves), asi que 5 intentos por acctId serian 5.000 tiros cada
diez minutos con mil cuentas, sobre un millon de combinaciones. Hay ADEMAS un
tope global de intentos fallidos por ventana (`LINK_TRIES_ALL`). El codigo corto
solo es seguro con las tres cosas juntas: vida corta, un solo uso, y los dos
topes.

**La UI, dos puertas.** En My Rankings: "Link another device" en las
herramientas del dueno (codigo grande, tabular, con el tiempo que queda) y "Have
a code?" para el que llega, discreto, con casilla numerica de 44px. La segunda
vive TAMBIEN en la tarjeta del 403 de `/perfil`, que es la pantalla por la que
el dueno se entera de que algo va mal; el acctId propio sigue saliendo ahi,
porque esto no reemplaza la salida por env var, la evita. Al vincular NO se
recarga la pagina: se tira la respuesta cacheada de `tmrOwner` y se rehace la
cola del arranque que solo corre para el dueno (pull, seed, precios, pintado).
Si la pregunta no confirma, entonces si se recarga: la pantalla no se queda a
medias. `tmrOwnerTools()` maneja TRES estados, no dos (dueno, cuenta corriente,
y "todavia no se"), y por eso lleva `dataset.mode`: con el guard viejo
(`childElementCount`) el invitado que vinculaba se quedaba con su enlace puesto.

**Gate: qa-rankings pasa de 109 a 119 checks.** L1 a L10: quien puede repartir
codigos, el panel del dueno (tambien medido a 390px), el aparato nuevo con un
codigo inventado, el codigo bueno por la UI trayendo la MISMA lista sin recargar,
que el vinculo sobreviva a recargar, el codigo reutilizado, el corte por
intentos, el control negativo, la consola, y la puerta de `/perfil`.
**Verificado que 8 de los 10 fallan contra el codigo anterior** (worktree
detached de HEAD 6a16264 con el gate nuevo copiado encima, QA_PORT 3219). Los
otros dos son GUARDAS, y tienen que pasar en las dos versiones: (L8) vincular un
aparato no vincula a los demas, y (L9) la consola limpia.
Dos carreras propias que cazo el gate y conviene no repetir: esperar
`!TMR.pricing` no espera nada, porque arranca en false (hay que esperar a
`sincronizado()` y a que haya precios); y el mensaje "Linked" de `/perfil` es
transitorio, porque al vincular se repinta el perfil entero y se lo lleva por
delante, asi que lo que se mide es el efecto (la casilla ya no esta), no el
cartel.

**Los cinco gates en verde antes del commit:** qa-rankings 119, qa-perfil 156,
qa-live 47, qa-nav, qa-board 104. calibrate-room NO se corrio: no se toco el
motor.

**Desplegado y verificado en produccion** (HEAD 2ce5d6a, `origin/main` al dia):
rankings.js, app.js, styles.css e index.html sirven el mismo sha256 que el
local; cache-bust 2026082805 en sus 8 apariciones; `link/claim` y `link/new` sin
llave 401; `link/new` con cuenta ajena 403 con su acctId; `link/claim` con
codigo malo 200 y `{owner:false}`. `QA_BASE=https://macdraft.app` qa-nav y
qa-live 47 en verde contra el bundle desplegado.

**Que le toca al dueno.** En la computadora (que ya esta habilitada): /research >
My Rankings > Link another device. En el iPhone, en la app instalada: /research >
My Rankings > Have a code?, teclear los seis digitos. A partir de ahi ese
telefono ve su lista, sus precios, el Tier Game, la cheat sheet y /perfil, y
sigue viendolos aunque vuelva a reinstalar? No: reinstalar borra el localStorage
y con el la llave, asi que ese caso pide un codigo nuevo. Lo que ya no hace
falta nunca mas es un deploy.

## Sesion 2026-08-28 (noche): el precio es el de la SALA, su orden decide a quien

Dos correcciones seguidas del dueno sobre el Tier Game, y las dos tocaban el
modelo, no la interfaz. Quedan escritas porque la segunda ANULA a la primera y
sin eso el codigo no se entiende.

**Primera, textual: "no es el juego que queria. yo no se cuanto deberian valer.
yo quiero que tu me digas basado en los rankings que yo haga".**
- El juego dejo de mostrar precios. La tarjeta lleva foto, nombre, posicion y
  equipo, y nada mas; el gate comprueba que no hay un solo "$" en el DOM del
  juego. Ensenarle el Pay mientras elige es pedirle justo lo que dijo que no
  sabe, y ademas contamina la respuesta: viendo $67 al lado de un nombre deja
  de contestar a quien prefiere y empieza a contestar quien vale mas.
- El texto lo dice: "Just say who you prefer. Mac turns your order into what to
  pay."

**Segunda, textual: "no quiero que me ponga a pagar mas por Swift porque todavia
puedo pagar menos".** Esto anulo el intento intermedio (commit b84f1b2, que
llego a produccion unas horas), donde el Pay salia de SU ORDEN: subir a alguien
en la lista lo encarecia, o sea que le cobraba su propio entusiasmo. En una
subasta se paga lo que cobra la sala.

**La regla definitiva, y gobierna toda la pantalla.** Hay DOS cosas que no se
mezclan nunca:
- **EL PRECIO**, del motor sobre la sala FZ26. Dos cifras: lo que la sala paga
  (`tmrPriceOf`, el `AU.val` de auPoolInit) y el techo (`tmrCeilOf`, un margen
  corto x1.2 para no perder un lote por un dolar). Ninguna sube por su lista.
  La columna pinta el TECHO y el tooltip declara las dos cosas mas SU puesto:
  "The room pays about $13, do not go past $16. Your RB2."
- **SU ORDEN**, que NO es un precio: es prioridad. Decide a quien perseguir, por
  donde cortar los tiers, cuales son sus objetivos, el ahorro dentro de un tier
  y donde esta la ganga. En pantalla aparece como texto, nunca como dolares.

La cabecera de la hoja lo escribe: "Prices are what the room pays. Your ranking
decides who to chase, never how much to pay." Con el caso armado la hoja dice
exactamente su frase: "Cheapest in: D'Andre Swift $13, saves $40 vs James Cook.
Target: the room has him cheap. Spend it on Ashton Jeanty."

Un precio escrito a mano sigue mandando sobre las dos cifras, y ES su techo.
`public/live.js` volvio como estaba (lvCeiling con auMyWorth y su peso de
siempre): el dueno pidio explicitamente no tocarlo.

### Lo que se aprendio del gate, que es lo que mas costo
- **Cuatro veces** los checks nuevos leyeron campos de un `eva` que contra el
  codigo viejo devuelve `{_err}`, y la corrida REVENTABA en el primer fallo
  llevandose por delante los veinte de detras. Es la misma leccion que este
  repo ya pago con `$eval`. Todo bloque nuevo lleva ya su normalizador.
- **La red del hotspot tumbaba el gate a mitad**: `networkidle` espera a que
  callen TODAS las peticiones, incluidas las de fuera (Sleeper, ESPN), y con la
  conexion floja LANZA. La carga y los recargados reintentan y caen a
  `domcontentloaded`/`load` esperando a que la app este viva.
- **Dos checks median la red, no el producto**: (z6) contaba 3,5 segundos antes
  de mirar el skeleton, y la ida y vuelta entre navegadores esperaba solo a
  "owner y no pricing". Los dos median una pantalla a medio hacer y sembraban
  fallos que no existian. Ahora esperan lo que van a MEDIR.

### Estado
qa-rankings 125 checks. Contra b84f1b2, los NUEVE que describen la regla fallan
en las tres corridas del control: (y), P1-P5, H2, H3 y H10. Otros siete
(S1, S4, R1, L3, L4, L6, L10) fallan tambien contra ese arbol y NO se logro
aislar por que; pasan contra el codigo actual, asi que no tapan ninguna
regresion de lo que se subio, pero queda dicho en vez de contado como ruido.

## Sesion 2026-08-29 (noche): los tiers pasan a ser POR POSICION

**El problema, medido.** El dueno jugo 505 parejas del Tier Game (232 same, 219
slightly, 54 clearly) y Apply produjo **UN** solo corte. `tmrTiersInfer` cortaba sobre
la lista GENERAL, mezclando posiciones, y medía el escalon en DOLARES del prior de
mercado (`dinero`, `umbral`), no en sus respuestas. Dos causas, el mismo error de unidad:
- Entre dos RBs de tiers distintos se cuelan seis WRs, asi que los vecinos casi nunca
  tenian respuesta directa y la regla de vecinos no se ejercia. Y un tier mezclado no
  significa nada: lo que decide una subasta es si hay escalon entre el RB4 y el RB5.
- El mercado arrancaba la conversacion y tambien la terminaba.

Su regla, textual: **"deberia haber un corte cuando digo slightly tambien"**; same = mismo
tier.

**El algoritmo, validado contra su documento antes de escribirlo.**
1. POR POSICION (QB/RB/WR/TE), universo = los primeros `TMR_TIER_POS_N` (40) de cada una.
2. Puntaje = minimos cuadrados sobre las distancias que declaro (same 0, slightly 1,
   clearly 3), con prior debil `eps=0.02` hacia su puesto actual `(n-i)*0.3`; Gauss-Seidel
   400 iteraciones. Orden por puntaje, desempate por puesto previo.
3. CORTE entre vecinos: respuesta directa distinta de same corta SIEMPRE; un same directo
   no corta NUNCA; sin respuesta directa, corta un salto de puntaje >= 0.7.
4. Quien no entro en ninguna pareja no recibe tier: se declara "not compared yet".

**Resultado sobre su documento (congelado en `scripts/fixtures/tiers-expected-2026-08-29.json`):**
RB 14 tiers, WR 9, TE 5, QB 1. Contradicciones 3, 4, 0 y 1. 25 cortes, no uno.

**Dos defectos propios que cazo el gate, no la lectura del codigo:**
- Mandar a los no comparados al final de su posicion parecia inofensivo: con dos
  respuestas, los dos comparados saltaban a RB1 y RB2 por encima de treinta y ocho
  jugadores sobre los que el no dijo nada, y la escalada se quedaba sin nadie arriba.
  Ahora el ORDEN va sobre los cuarenta (quien no jugo conserva su puntaje de partida) y
  solo los TIERS se construyen sobre los comparados.
- El marcador "not compared yet" salia en una posicion cortada a mano sin haber jugado
  nunca ahi. Un corte a mano es un tier igual de suyo.

**Lo que cambia en la app.**
- Los cortes se guardan como `breaksPos` ({RB:[ids], WR:[ids]...}). `TMR.breakPos` y los
  ayudantes `tmrBreakSet`, `tmrIsBreak`, `tmrBreaksOut/In/Count`, `tmrTierMap`.
- **Apply es ESTABLE por posicion**: los RB vuelven a ocupar las plazas de RB en su orden
  nuevo. Concatenar las posiciones pondria los cuarenta RBs arriba del todo y le
  reescribiria un orden general que es suyo.
- **Bandas solo con filtro de posicion** ("RB Tier 3, 5 players"); en "All" cada fila lleva
  su etiqueta `RB T3` DENTRO de `.rk-name` (la rejilla comparte plantilla con la cabecera
  y un hijo mas de `.rk-nums` la descuadra entera, bug ya conocido del archivo).
- **El boton TIER manual** edita los cortes de SU posicion.
- **Cheat Sheet** y **Draft Day** usan `breaksPos`: `LV.myTier` manda en "el ultimo de tu
  tier" y `MD.tierOf` queda de respaldo donde nunca corto.
- **MIGRACION**: un documento viejo con `breaks` generales NO se convierte (un corte entre
  el RB4 y el WR9 no dice donde cae el escalon de RBs). Se declara en pantalla con su
  numero. El servidor acepta `breaksPos` y sigue aceptando `breaks`.
- El eje del dinero (`money`, `umbral`) se conserva pero YA NO CORTA: solo elige la
  siguiente pregunta, que es donde un escalon de precio si mide cuanto hay en juego.

**Consecuencia declarada:** una respuesta que CRUZA posiciones (el juego hace una de cada
siete) ya no decide ningun tier; solo alimenta el eje del dinero. Tiene su control
negativo en el gate.

**Gates:** `qa-rankings` pasa de 121 a **135 checks**, ALL GREEN. Verificado que fallan
contra 3b07588: **32 fallos** (worktree detached, QA_PORT 3219). `qa-live` 47 y `qa-nav`
16, los dos en verde. Cache-bust a 2026082808.

Archivos: `public/rankings.js` (`tmrTiersInfer` reescrito, `_tmrPosSolve` nuevo,
`tmrTierMap`, `tmrPaint`, `tmrCut`, `tmrExport`, `tmrTiersPreview/Apply`, `tmrSheetData`),
`public/live.js` (`LV.myTier`, `lvAdvice`), `public/styles.css` (`.rk-ttag`, `.rk-legacy`,
`.rk-tier-none`), `server/routes/perfil.js` (`breaksPos` en la validacion de forma),
`scripts/qa-rankings.mjs`, `scripts/fixtures/rankings-owner-2026-08-29.json` y
`scripts/fixtures/tiers-expected-2026-08-29.json` (nuevos).

### Correccion del dueno sobre sus QB (2026-08-30): preferencia y objetivo son cosas distintas
Dictado suyo: Allen y Lamar le parecen mejores y van arriba en su tier, pero **NO pagaria
por ellos**. Los que le gustan y por los que si paga son Herbert, Lawrence, Caleb Williams
y Burrow, que estan un tier mas abajo. O sea: **el tier dice a quien prefiere, el objetivo
dice a quien le da su dinero**, y meterlos en la misma escala era el error. El juego
infiere los tiers; los objetivos los marca el a mano.

En la cheat sheet, DERIVADO y sin nombrar a nadie en el codigo: quien esta en un tier mejor
que el mejor de sus objetivos de esa posicion, y no es objetivo, lleva en su fila la nota
"you rank him higher but would not pay for him". Sus objetivos declaran ademas
"expect $N" con el precio de SALA, que es lo que hay que llevar preparado. Si en una
posicion no marco ningun objetivo no hay con que comparar y la hoja calla.

Gate: 138 checks (H11, H12 y H13 nuevos). Verificado que los tres fallan contra 6628ab1.
Cache-bust 2026082809.

### Un objetivo no es una compra (2026-08-30, reportado en produccion)
La barra Build sumaba los 29 objetivos como si se los fuera a llevar todos (-$355 en rojo);
ahora arma el plan MAS BARATO que cubren (titular por titular, FLEX al mas barato de RB/WR/TE,
el resto a $1), declara la posicion sin objetivo y baja la suma de todos a nota gris. Y la
columna Pay pintaba el TECHO (Gibbs $91) en vez del expect ($77): ahora la cifra grande es
lo que paga la sala y el tope va debajo. Gate qa-rankings 142 checks, nuevos (y2)(z9)(z9b)(z10);
24 fallan contra el codigo anterior. Cache-bust 2026082811.

## Sesion 2026-08-30/31: el dia del draft real

La subasta real de la liga Fantazy fue el 2026-08-30 ~1pm. Lo que se construyo y
desplego ese dia, todo verificado en produccion por sha256 y con qa-live en 50 checks:
- **Entrada facil en Draft Day**: la caja entiende lo tecleado como se dice ("gibbs se
  fue en 86 a ness", "me lleve jeanty 48", equipo por nombre con tramo contiguo,
  `lvParseTyped`), y el bloque cierra la venta con DOS TOQUES (desplegable de equipo,
  precio, boton Sold, `lvSoldClick`).
- **Diario de ventas** (`tm_lv_journal` en localStorage): cada venta se apunta, la sala
  se reconstruye sola al recargar (`lvReplayWhenReady` reintenta hasta que las ventas
  esten APLICADAS: la sala se declara activa antes de aceptar ventas), `undo` /
  boton "Undo last" quita la ultima recargando con el flag `tm_lv_reopen` (el router
  reescribe la URL y el hash #draftday no sobrevive a un reload), y "new room" limpia.
  `lvFind` arma el indice de nombres el solo si no existe (reventaba con null al
  reproducir antes del primer render).
- La barra Build arma el plan MAS BARATO con los objetivos (no la suma de todos), Pay
  muestra el expect de mercado con el "up to" secundario (agente build-fix, 381f3d3 y
  913557d).
- Tiers dictados por el dueno aplicados a su documento (breaksPos QB:1 RB:8 WR:8 TE:3,
  script de una vez scripts/apply-owner-tiers.mjs, fixture tiers-owner-2026-08-29.json,
  sus 505 respuestas del Tier Game en rankings-owner-2026-08-29.json).
- `scripts/draft-chat.mjs`: reproducir por CLI las ventas que el dueno cuenta por chat.

Trampas de gate que costaron horas, para no repetir:
- El diario contaminaba los checks de Yahoo: el popup del marcador comparte
  localStorage y REPRODUCIA el diario de checks anteriores. El gate limpia
  `tm_lv_journal` antes de reabrir sala y antes de abrir el popup.
- `lvEnter` sobre una sala ya activa NO reabre nada (startMockDraft sale por
  `MD._starting`/sala activa y vuelve en 18 ms): reconstruir = recargar con el flag.
- Checks con ids duplicados (dos `t1/t2/t3`) y checks con dolares absolutos sobre una
  sala que ya gasto dinero: los nuevos van con id propio y presupuestos RELATIVOS.

PENDIENTES tras el draft:
1. Pedirle al dueno los precios REALES de su subasta del 30-ago, meterlos como fixture
   (formato de scripts/fixtures/auction-nfl-divas-2026-08-27.json) y recalibrar con
   scripts/compare-real-auction.mjs (sobre todo el premium de QB y la franja RB2).
2. Cosmetico reportado por el dueno EN el draft: en THE ROOM / desplegable su asiento
   sale como "YOU"/"(me)" y "Falafel" no aparece; un nombre se ve repetido cuando su
   asiento elegido desplaza a otro equipo. Revisar lvSeatName + mdFz26SetMe.
3. Preguntarle como le fue: que se llevo, contra que precios, y si el panel/consejos
   sirvieron en vivo. De ahi salen los proximos arreglos.

## Sesion 2026-08-31: la subasta real transcrita, y el motor a 1.3

**El dueno ES el equipo "Adrian Peterson"** en la liga Fantazy (lo confirmo el; Falafel
es OTRO equipo). Su draft: Gibbs $77, AJ Brown $51, Bowers $32, Loveland $12, G. Wilson
$8, Burrow $4 y nueve lotes de $1-3. $200 exactos.

- **Fixture de la subasta real**: `scripts/fixtures/auction-fantazy-2026-08-30.json`,
  los 150 picks transcritos de un video del Draft Results de Yahoo (fotogramas con
  ffmpeg a 1 fps; el video hay que pedirlo GUARDADO en el Escritorio, la miniatura
  flotante vive en una carpeta TCC que el terminal no puede leer, y el nombre lleva
  un espacio U+202F antes de "PM": copiar con glob). Commits 5b08718 + 62fb7a1.
- **Lo que dijo la sala real contra el motor** (compare-real-auction, 40 salas):
  cima -6% con 1.2; franja RB2 inflada IGUAL que en Divas (C. Brown $58 vs $38,
  Walker $55 vs $38, Hampton $58 vs $45, AJB $51 vs $39); **QB en direccion OPUESTA
  a Divas** (real $62 vs $107 simulado: la sala del dueno regala QBs, Divas los
  pagaba); TE +25%; 51 de 150 lotes a $1.
- **VAL_CURVE 1.2 -> 1.3** (c3b6c20): cima de su sala -6% -> -1%, $5-14 y $2-4 a 0%,
  Divas queda neutra. **QB sin descuento a proposito**: dos salas reales, direcciones
  opuestas; es la posicion mas dependiente de la sala. calibrate-room ALL GREEN,
  qa-live 50, qa-nav, qa-board, qa-rankings en verde. Cache-bust 2026083101.
  Verificado en produccion: sha256 iguales en app.js/index.html/live.js/styles.css
  y qa-nav en verde contra macdraft.app.
- **Consejo dado sobre su roster** (el lo pidio): tradear a Bowers y quedarse
  Loveland; candidatos SUCK IT (Javonte), Family Feud (Henry), rana jr (Skattebo).
  Su hueco es RB2. Decision suya, en curso.

**PENDIENTES:**
1. **Otro auction la PROXIMA SEMANA (~2026-09-06), mismos settings que Fantazy**: el
   preset FZ26 sirve tal cual. Lecciones dadas: el "up to" es muro (AJB le costo $12
   de mas), reservar $35-45 para RB2, QB con moneditas, un solo TE premium.
2. Cosmetico del asiento en THE ROOM/Sold ("YOU"/"(me)", Falafel ausente, nombre
   repetido; lvSeatName + mdFz26SetMe): SIGUE sin tocarse porque el dueno aun no
   contesta si uso el panel o el chat en el draft ni si el marcador de Yahoo se
   engancho. Preguntar antes de tocar Draft Day. Urge mas ahora: hay draft en una
   semana.
3. Viejos no urgentes: lector de Yahoo, traslado de Pro, auGradeBuy generoso.
