# Mac Draft: estado del proyecto

Ultima actualizacion: 2026-08-25.

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
```
Los seis corren desde cualquier directorio. Un test que no falla contra el codigo
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
