# Referencias: Mac Draft pivote (hub multi-liga + odds board)

Producto nuevo: junta Sleeper y Yahoo en una pantalla, duelo de la semana, exposición por
jugador entre ligas, tablero de odds tipo casa de apuestas. Capturas reales en esta carpeta
(navegador real, Playwright, 9-sep-2026), salvo donde se marca "swipe file" o "refero.design"
(ya aprobadas antes por Wolco para este mismo proyecto).

No hay sesión de Mobbin abierta: no se usó. Godly/recent.design no tiene un rubro de
"dashboard denso" real en su feed actual, así que no aportó nada nuevo sobre lo que ya
había en `referencias.md` (Increase, forma abstracta de hero).

## 1. Sleeper — sleeper.com/fantasy-football (draft board) + swipe file sleeper.com (scores)
- Capturas: `sleeper-fantasy-football-2026-09-09.png`, y ya aprobada:
  `~/Development/swipe-file/capturas/sleeper-com-2026-08-19.png`
- Qué hace bien: en el board de scores, TRES columnas de liga (NFL/MLB/WNBA) sin scroll
  horizontal, cada partido es una fila de 60px con logo, marcador y estado (FINAL/hora), sin
  card con sombra, solo la fila oscura ligeramente más clara que el fondo. En el draft board,
  cada equipo es una COLUMNA con su color de asiento propio (verde, cian, rosa, amarillo) en
  la ficha del pick actual; el resto de picks quedan en gris oscuro neutro. El color no decora,
  marca DE QUIÉN es el turno.
- Qué se puede replicar: la fila de 60px sin card para listar partidos/duelos de varias ligas
  a la vez; reservar el color saturado para "esto es tuyo / es tu turno" y dejar todo lo demás
  en gris oscuro, exactamente el patrón que necesita "tu duelo" contra "todos los otros duelos".
- Qué no: el teal de marca de Sleeper ni sus iconos redondeados de deporte.

## 2. ESPN Fantasy Sports & More — App Store, capturas del listado (app real, no marketing)
- Captura: `espn-fantasy-appstore-2026-09-09.png`
- Qué hace bien: es el competidor más cercano al pivote exacto ("junta tus ligas"). La
  captura 2 ("Follow every matchup") pone los DOS marcadores del duelo enormes arriba
  (100.2 / 104.6, un decimal, tipografía tabular) con tabs debajo (Roster / Matchup /
  Players / League) y la lista de titulares con proyectado vs. real en dos columnas
  alineadas a la derecha del nombre. La captura 4 ("Personalized for you") resuelve el
  cruce de ligas con una fila de PÍLDORAS arriba (Football activo, Hockey y Basketball
  apagados) y debajo tarjetas de "Create New League / Join a League": es el selector de
  liga, no un dashboard que las mezcla todas de golpe.
- Qué se puede replicar: el marcador del duelo como las DOS cifras más grandes de la
  pantalla (no un ícono, no un gráfico, el número); la fila de píldoras de liga arriba
  para cambiar de contexto sin perder el resto del layout; proyectado vs. real como par
  de números alineados, nunca un solo número suelto.
- Qué no: el azul/verde neón de ESPN ni sus tarjetas de "juega esto también" (ruido).

## 3. WHOOP — App Store, capturas del listado (app real)
- Captura: `whoop-appstore-2026-09-09.png`
- Qué hace bien: es el mejor ejemplo del rubro adyacente "panel personal de datos". Un
  anillo circular con UN número grande al centro (75% Sleep, 85% Recovery, 14.2 Strain),
  color del anillo cambia por métrica (azul, verde, azul) sobre fondo casi negro, y
  DEBAJO una lista de 4-5 filas con etiqueta a la izquierda, valor a la derecha y una
  flechita de tendencia (↑↓) opcional. Nunca mezcla el anillo con la lista en el mismo
  plano: el anillo es el titular, la lista es la letra chica que lo sostiene.
- Qué se puede replicar: el patrón "un aro con un número + una lista corta de métricas
  que lo explican" para "tu exposición" a un jugador (cuánto % de tus rosters lo tiene) o
  para el resumen del duelo de la semana (probabilidad de ganar como aro, detrás los
  puntos por posición). Es el patrón que evita que un dashboard con muchos números se
  vea como una hoja de cálculo.
- Qué no: el azul/verde de marca de WHOOP ni su ícono circular "W".

## 4. DraftKings Sportsbook & Casino — App Store, captura 4 del listado (UI real, no promo)
- Captura: `draftkings-appstore-2026-09-09.png` (la cuarta imagen, "Easily search
  sportsbook for players, games, and props")
- Qué hace bien: la fila de categorías (Football, NBA, CFB, MLB...) es una tira de
  chips horizontal con ícono chico arriba y texto abajo, todos iguales salvo el activo.
  Debajo, cada partido es una card oscura con borde de 1px del color de acento: nombre
  del equipo a la izquierda, y a la derecha TRES columnas numéricas alineadas
  (spread / total / moneyline), cada una con su etiqueta chica arriba (+3.5, O 44.5,
  -110). Los números van en fuente monoespaciada o tabular, nunca proporcional, para
  que la columna no baile de un partido a otro.
- Qué se puede replicar: la card con tres columnas numéricas alineadas a la derecha
  para el tablero de odds/proyecciones de Mac Draft, y sobre todo, números en fuente
  tabular (ya la marca usa IBM Plex Mono) para que se puedan escanear en columna sin leer
  cada uno.
- Qué no: el verde neón de DraftKings ni el tono de casino ("SPEND $5 GET $200").

## 5. The Athletic (vía refero.design, ya en `referencias.md`, 7-sep)
- Qué hace bien (recordado): la barra de navegación es UNA fila oscura con todas las
  ligas sin wrap y un único CTA de color aislado a la derecha; el feed es una columna de
  filas separadas por regla fina, sin card con sombra.
- Qué se puede replicar: la barra de una sola fila para cambiar de liga/semana con un
  único acento aislado, y filas separadas por línea en vez de tarjetas con sombra para
  listar duelos u oportunidades de trade.
- Qué no: el negro total ni el rojo de marca.

## 6. Wealthsimple (vía refero.design, ya en `referencias.md`, 7-sep)
- Qué hace bien (recordado): una tarjeta CHICA de gráfico de línea flotando sobre el
  contenido, ocupando menos del 25% del ancho, nunca a pantalla completa.
- Qué se puede replicar: una mini-tarjeta de tendencia (exposición a un jugador en el
  tiempo, o probabilidad de ganar el duelo en el tiempo) flotando sobre la pantalla
  principal en vez de un gráfico grande que se roba la pantalla.
- Qué no: el lila de marca ni el mockup de iPhone.

---

## Tres direcciones

### A — Casa de apuestas propia
DraftKings (tablero de odds, números tabulares en columna) + ESPN (marcador del duelo
gigante arriba) llevados al morado de marca. Máxima densidad numérica, se siente "casa de
apuestas real" desde el primer vistazo. Riesgo: sin la disciplina de color de Sleeper
(un solo acento por fila activa), se vuelve ruidoso rápido en celular.

### B — Panel de rendimiento
WHOOP (aro + un número + lista corta) aplicado a "tu duelo" (aro = probabilidad de ganar)
y a "tu exposición" (aro = % de rosters con ese jugador), con ESPN resolviendo el cambio
entre ligas por píldoras arriba. Se siente personal y calmo, no un mercado; es el que
mejor separa "el titular" del "detalle" en una pantalla de 390px.

### C — La redacción deportiva
The Athletic (barra de una fila, feed sin sombra) + Wealthsimple (mini-gráfico flotante)
para tratar cada duelo como una nota editorial con un dato adjunto, no como una fila de
tabla. Más premium y menos numérico; es el que menos aprovecha que "los números importan
mucho" en el pedido original, y el que más trabajo pide para no perder densidad.

## Veredicto

**B, Panel de rendimiento.** El pivote es "tu exposición, tu duelo, entre TODAS tus
ligas": eso es un panel personal, no un mercado público ni un feed editorial. El patrón
de WHOOP (un aro con un número + una lista corta que lo sostiene) es la única de las tres
referencias pensada para eso exacto, y es la que mejor resuelve mobile-first: un aro y
cinco filas caben enteros en 390px sin scroll. Se completa con dos préstamos puntuales,
no con toda la referencia: la fila de píldoras de ESPN para saltar entre ligas sin
recargar la pantalla, y los números tabulares de DraftKings (ya hay IBM Plex Mono en la
marca) para cuando SÍ hace falta el tablero de odds completo, como pantalla aparte, no
como la home.
