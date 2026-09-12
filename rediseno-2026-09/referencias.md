# Referencias: Mac Draft (fantasy football)

Fuentes: recent.design y refero.design, navegadas con Playwright. Tres referencias con
captura: recent.design no tiene un rubro de "dashboard denso" real en su feed actual (sus
fichas son en su mayoria una sola foto de hero, no pantallas de producto), asi que el peso
de la densidad de dato viene de refero.design.

## 1. Wealthsimple
- URL: https://refero.design/search?site_id[id][]=764
- Captura: `macdraft/wealthsimple-refero.png`
- Que hace bien: la pantalla "Invest your way, commission-free" pone una tarjeta chica de
  grafico de linea (mini dashboard real, no decorativo) flotando sobre una foto de producto,
  ocupando menos del 25% del ancho de la pantalla: el dato acompana, no domina. La pantalla
  de servicios (chequing, credit card, stocks & ETFs, crypto, gold...) es una lista de texto
  en dos columnas sin iconos por item, solo una etiqueta "New" en los nuevos: la densidad
  viene de cuantos items entran, no de decoracion por item.
- Que se puede replicar: la tarjeta de grafico chica y flotante (no a pantalla completa) para
  mostrar puntaje o proyeccion de un jugador; la lista de dos columnas sin icono por fila para
  el listado de jugadores o ligas, reservando el icono solo para "nuevo" o "en vivo".
- Que no: el color lila de marca ni el mockup de iPhone.

## 2. The Athletic
- URL: https://refero.design/search?site_id[id][]=55
- Captura: `macdraft/theathletic-refero.png`
- Que hace bien: la barra de navegacion superior es oscura y cabe una fila completa de
  ligas (NFL, MLB, NCAAF, NBA, NHL, Soccer, Women's World Cup...) en una sola linea sin
  wrap ni menu hamburguesa, con un CTA rojo aislado a la derecha (Subscribe). Debajo, el
  feed es una columna de tarjetas de articulo con miniatura + titular + linea de contexto,
  separadas por una regla delgada, sin card con sombra.
- Que se puede replicar: la barra de categorias (ligas/posiciones/semanas) en una sola fila
  oscura con un solo CTA de color aislado, y el feed de tarjetas separadas por linea fina en
  vez de card con sombra, para el listado de partidos o jugadores de Mac Draft.
- Que no: el negro total ni el rojo de marca.

## 3. Increase
- URL: https://recent.design/i/gum9nh3-increase
- Captura: `macdraft/increase-recent.png`
- Que hace bien: el hero es partido: izquierda un titular enorme en dos pesos ("Build" en
  negro grueso, "your bank" mas fino), derecha dos parrafos cortos con dato concreto ("From
  the Federal Reserve, directly to our own API endpoints"). Abajo, en vez de un grafico real,
  hay dos barras geometricas extruidas en 3D con gradiente que sugieren "datos" sin ser un
  chart literal.
- Que se puede replicar: usar una forma geometrica abstracta (no un chart real) en el hero
  para sugerir "esto tiene datos" sin adelantar el dashboard completo, guardando la densidad
  real para la pantalla de producto.
- Que no: el gradiente lima/verde de marca.

## Las tres movidas que mas subirian el nivel (por impacto)

1. Bajar la decoracion por fila en las listas de jugadores/ligas al patron de Wealthsimple:
   texto en columnas, icono solo para estados especiales (en vivo, nuevo), no un icono por
   fila.
2. Meter toda la navegacion de ligas/semanas en una sola barra oscura de una linea (patron
   The Athletic) con un unico CTA de color aislado, en vez de tabs que hacen wrap.
3. En el hero, reemplazar cualquier captura de dashboard real por una forma geometrica
   abstracta tipo Increase que insinue "hay datos" sin mostrar la pantalla completa todavia.
