# Mac Draft: decisiones del rediseño de septiembre 2026

Extraído del expediente común el 8-sep-2026, cuando este proyecto salió a su propia carpeta.

El expediente completo sigue en `~/Development/_rediseno-2026-09/decisiones.md`.

---

## Lo que decide este proyecto

## Nada visual se comparte entre los cinco (Wolco, 7-sep)

La fase 3 del brief pedía definir un sistema compartido entre los cinco proyectos
(escala tipográfica, ritmo, tokens, componentes). **Queda anulada en su parte visual.**
Cada proyecto es distinto: distinto público, distinta marca, distinto stack, y ninguno
usa el mismo framework ni el mismo tipo de pantalla.

Lo que las fichas encontraron confirma que no hay nada que unificar sin dañar:

| Proyecto | Tipografía | Base de color | Stack |
|---|---|---|---|
| Detalle | Fraunces + Instrument Sans | crema y papel, acento terra | Next.js |
| Mac Draft | Familjen Grotesk | morado sobre negro casi puro | Node y HTML estático |
| Soygalith | Fraunces + Inter | lavanda claro, morado y rosa | HTML estático |
| Denuncia AI | Inter | azul marino y gris perla | HTML estático más api |
| Rina Training | Oswald + Inter | negro casi puro, acento lima | Next.js |

Cinco paletas, cinco parejas tipográficas, tres stacks y cinco públicos que no se
parecen: quien regala, quien juega fantasy, quien busca terapia, quien acaba de ser
víctima de un delito, y quien quiere entrenar. Unificarlos los volvería intercambiables,
que es justo lo que delata el trabajo hecho por IA.

**Nunca se comparte:** paleta, tipografía, escala de tamaños, radios, densidad,
componentes, tipo de pantalla, patrón de dashboard, tono de copy, motion.

**Sí se comparte, porque no es estética sino piso de calidad**, y se verifica igual en
los cinco:
- La UX obligatoria: esqueletos en vez de spinners, caché por defecto, render optimista,
  tooltips en botones de solo ícono, cero errores en consola, cero 404.
- El arranque nunca en negro: color de marca, símbolo y animación corta, con la imagen
  fija de iOS a los once tamaños y degradado vertical.
- Mobile first: tiene que verse mejor en celular que en desktop, verificado a 390px.
- Los vetos: sin em dashes, sin emojis en interfaz, sin Helvetica, Helvetica Neue,
  Archivo ni Instrument Serif.
- El piso de accesibilidad: contraste medido con número, nunca a ojo, y objetivos
  táctiles de 44px como mínimo.
- El método: snapshot antes de tocar, canvas propio por proyecto, QA con prueba por
  donde entra el usuario antes de cada entrega.

Cada proyecto tiene **su propio canvas**, con su propio vocabulario visual. No hay hoja
de componentes común y no se copia una pantalla de un proyecto a otro.

## Mac Draft

- Sin decisión pendiente de Wolco. Dos trabajos de higiene identificados, para la
  fase de ejecución: unificar los 19 valores de radio de borde, y renombrar los
  archivos y clases "sage" a "Mac", que es residuo de un nombre anterior.

## Direcciones elegidas (Wolco, 7-sep, cierre de la fase 3)

| Proyecto | Dirección elegida | Estado |
|---|---|---|
| Denuncia AI | C "Bajo palabra" | Listo para bajar a ejecución |
| Detalle | B "El sobre" | Listo para bajar a ejecución |
| Soygalith | A "Retrato" | Listo para bajar a ejecución |
| Mac Draft | A "Cabina de transmisión" | Listo para bajar a ejecución |
| Rina Training | Ninguna | Canvas se rehace antes de elegir |

Las direcciones descartadas quedan en la segunda página de cada canvas. No se
re-discuten ni se mezclan entre sí: la elegida se implementa como está.

### Mac Draft

- **El presupuesto de subasta pasó de $200 a $300.** Con $200 el mercado no cerraba nunca
  y los planteles quedaban a medio llenar: los 150 lotes de arriba del tablero suman 2941
  de valor. Con $300 cierra y los precios coinciden con los de la ficha. Es un cambio de
  regla del producto, no de diseño, y conviene que Wolco lo confirme.
- **Botón "Let Mac finish the room"**, de solo ícono con tooltip, que cierra el draft y
  lleva al resumen. Sin él, una subasta completa son unos 20 minutos de reloj real y el
  resumen quedaba inalcanzable en una demo.
- **En móvil y en snake se oculta el panel de la cabina.** La cabecera ya lleva ronda,
  turno y reloj, y repetirlo empujaba el tablero fuera de pantalla. En subasta el panel se
  queda, porque lleva puja, quién la tiene y tu techo, que la cabecera no muestra.
- Las nominaciones de la subasta son automáticas, dicho en la propia pantalla.
- La barra inferior solo lleva a lo que existe: Booth, Draft y Recap. Sin pestañas muertas.
- Higiene cerrada: radios solo 6px, 22px, 999px y 50%; cero "sage" en el markup, con el
  build fallando si aparece; cuerpo en IBM Plex Sans declarado; cero em dashes, también con
  el build fallando si aparece uno.

## Estado al cierre de la noche del 7 al 8 de septiembre

Informe visual con los cinco links y las decisiones abiertas:
https://claude.ai/code/artifact/ccf00bb0-0d8a-482b-b866-a54781da0139

Los cinco sitios están construidos como HTML autocontenido en
`_rediseno-2026-09/sitios/<proyecto>/index.html`, cada uno publicado en su artifact. Cada
uno pasó por un ingeniero y por un QA independiente cuyo encargo era romperlo, no
confirmarlo. El QA tumbó a los cinco en la primera ronda.

| Proyecto | Rondas | Estado |
|---|---|---|
| Denuncia AI | 4 | **Cerrado.** Residual del agravante de transporte anotado arriba |
| Detalle | 4 | **Cerrado.** Sin fallas abiertas |
| Soygalith | 2 | Corrigiendo tres regresiones del enrutado |
| Mac Draft | 2 | Corrigiendo la subasta; su verificación no cabía en la noche |
| Rina Training | 3 | En verificación final del testimonial |

### Lo que falta, por proyecto

**Soygalith.** Los dos bloqueantes originales están muertos, pero el enrutado nuevo con
`:target` trajo tres regresiones: el enlace "saltar al contenido" cae en el 404 porque
`#contenido` es el `<main>` que contiene las páginas y `closest("[data-pagina]")` da null;
el menú no se cierra al elegir destino y sin JavaScript se queda abierto para siempre; y el
CTA de la cabecera quedó en 1.42 de contraste porque `.nav a` (0,0,1,1) le gana a
`.btn--primario` (0,0,1,0) desde que se quitó el style en línea. Medio: el enrutado en CSS
puro no funciona durante el parseo, así que un enlace directo a `#sesiones` enseña la
portada 3,8 segundos en red lenta.

**Mac Draft.** La subasta jugada como la juega un usuario deja planteles incompletos en 5
de 5 corridas. Solo se llenaban usando "Let Mac finish the room", que es otro camino de
código y el que NO usa un jugador. Mecanismo medido: `openLot` pone `S.holder` sin
comprobar que el nominador pueda alojar al jugador, y `sellLot` borra del board lo que no
puede colocar. En la sala de 8 hubo 74 lotes así, y en 29 otro equipo sí podía.
Además: el ordinal del tercer puesto dice "3th", y queda una fila fantasma cuando se toca
un jugador que no cabe en el plantel.
**Su verificación es lenta:** cada partida de prueba son 20 a 45 minutos de reloj real,
porque cada lote son 8 segundos. El QA dejó armados `reverify-ordinal.js`,
`reverify-ghost.js` y `reverify-auction.js` con criterio de éxito escrito de antemano.

**Rina Training.** Pendiente solo la verificación final del testimonial. Y un dato que no
se arregla en código: los once clips originales son de 568x320 y no hay más material, así
que el hero nunca se verá nítido en un teléfono retina.

### Corrección al dato de Mac Draft (7-sep, 21:15)

Se reportó primero que la subasta dejaba planteles incompletos en "5 de 5 corridas". **El
dato correcto es 5 de 7.** El QA lanzó dos corridas más con su script nuevo y las dos
llenaron todos los planteles, así que el fallo es intermitente y no determinista. Corrigió
su propia afirmación por iniciativa propia, sin que nadie se lo pidiera.

Lo que NO cambia, y es lo que mantiene el bloqueante: **las dos que pasaron, pasaron
raspando.** La de 10 equipos terminó con exactamente 0 jugadores en el board; la de 8, con
6. Un lote desperdiciado más y se rompen. El desagüe sigue abierto: en esas mismas dos
corridas hubo 67 y 43 lotes retenidos por quien no podía alojar al jugador, y de esos 41 y
27 tenían otro equipo que sí podía.

Y el caso peor (plantel del usuario a 14 de 15, sin QB titular, en la sala de 10 que es la
configuración por defecto) ocurrió una vez en siete. Sigue siendo inaceptable, pero no es lo
que le pasa a todo el mundo.

**Consecuencia para verificar el arreglo:** con un fallo intermitente, una sola partida
limpia no prueba nada. Hay que mirar los dos números deterministas: que los lotes
desperdiciados con otro equipo capaz caigan a cero, y que sobren jugadores en el board al
final en vez de quedar en cero. Si el margen sigue siendo cero, el bug sigue ahí aunque esa
vez los planteles salgan llenos.

## Estado final de la noche (act. 8-sep, 02:33)

Cuatro de los cinco cerrados y verificados por su QA independiente. Solo Mac Draft queda
abierto, y no por una falla sin resolver sino porque su verificación es lenta.

| Proyecto | Rondas | Estado |
|---|---|---|
| Denuncia AI | 4 | **Cerrado.** Residual del agravante de transporte anotado |
| Detalle | 4 | **Cerrado.** Sin fallas abiertas |
| Soygalith | 4 | **Cerrado.** Dos residuos que solo afectan sin JavaScript |
| Rina Training | 5 | **Cerrada.** Cero fallas abiertas |
| Mac Draft | 3 | Arreglado y republicado; su verificación sigue corriendo |

### Lo que falta en Mac Draft

El arreglo está hecho y publicado: `nextNomination()` elige nominador y lote juntos, así que
quien abre reteniendo a un dólar siempre puede colocar al jugador, y `sellLot` ofrece el
lote al siguiente equipo que quepa antes de descartarlo. Los dos caminos, el del usuario y
el del atajo, pasaron a usar la misma nominación para que no puedan volver a divergir.

La prueba dirigida al mecanismo ya da bien: los lotes retenidos por quien no podía alojar al
jugador pasan de 74 a 0, y la aritmética cierra en las tres salas (120+73, 150+43 y 180+13
dan los 193 jugadores). Falta la prueba por donde entra el usuario: partidas completas
jugadas lote por lote sin usar el atajo, que tardan de 20 a 45 minutos cada una.

**Criterio para darlo por cerrado**, escrito antes de ver los resultados: con un fallo
intermitente una sola partida limpia no prueba nada. Mandan los dos números deterministas,
que los lotes desperdiciados con otro equipo capaz caigan a cero, y que sobren jugadores en
el board al final en vez de quedar en cero. Si los planteles salen llenos pero el margen
sigue en cero, el bug sigue ahí.

Los scripts del QA están en `scratchpad/qa-macdraft/`: `reverify-ordinal.js`,
`reverify-ghost.js` y `reverify-auction.js`, los tres con su criterio de éxito dentro.

### Mac Draft: la subasta arreglada, verificada por donde entra el usuario (8-sep, 03:15)

Partida de 10 equipos con puja agresiva, la configuración por defecto y el patrón que
producía el caso peor, jugada lote por lote sin usar el atajo:

| | Antes | Ahora |
|---|---|---|
| Lotes con holder incapaz de alojar | 46 | 0 |
| De esos, con otro equipo capaz | 24 | 0 |
| Jugadores sobrando en el board | 0 | 43 |
| Equipos incompletos | 5 de 10 | 0 de 10 |

La aritmética cierra sola: 150 colocados más 43 en el board dan los 193 del pool. Ni un
jugador destruido. Los dos criterios que el QA dejó escritos antes de ver el resultado se
cumplen los dos.

Fila fantasma y ordinal también cerrados. Faltan dos partidas más, de 8 y de 12 en agresiva,
para decir que aguanta en todas las configuraciones.

## LOS CINCO CERRADOS (8-sep, 03:20)

Mac Draft cerró último. Las tres configuraciones de puja agresiva, que es donde vivía el
fallo (antes fallaba 4 de 5), jugadas lote por lote sin usar el atajo:

| Sala | Antes | Ahora |
|---|---|---|
| 10 equipos | 46 / 24, board 0, 5 cortos | 0 / 0, board 43, 0 cortos |
| 8 equipos | 74 / 29, board 0, 2 cortos | 0 / 0, board 73, 0 cortos |
| 12 equipos | 23 / 23, board 0, 5 cortos, plantel propio 9 de 15 | 0 / 0, board 13, 0 cortos, plantel 15 de 15 |

La aritmética cierra en las tres (150+43, 120+73, 180+13 dan 193), que es la prueba de que
ya no se destruye ningún jugador. Y el atajo y el camino del usuario dejaron de divergir,
que era la raíz de que las 30 corridas con el botón dieran bien y las de a mano no.

**Estado final: los cinco cerrados**, con entre 2 y 5 rondas de QA independiente cada uno.

### Residuales anotados, ninguno bloquea

- **Denuncia AI**: el detector automático reconoce 1 de cada 4 casos sensibles contados con
  palabras nuevas; la garantía es la salida manual. Cinco frases pierden el agravante de
  transporte. La salida no existe durante los primeros 271 ms ni sin JavaScript.
- **Soygalith**: sin JavaScript, el salto al contenido devuelve a la portada y un enlace
  directo tarda entre 2,4 y 3,5 s en mostrar su sección.
- **Rina Training**: el hero nunca se verá nítido en un teléfono retina, porque el material
  de origen son clips de 568x320 y no hay más. Hace falta regrabar.
- **Mac Draft**: si el jugador que tienes enfocado lo draftea otro, el foco cae a body. El
  puesto 12 del ordinal no se observó en vivo. El loro sigue leyéndose como ilustración
  generada.
- **Detalle**: dos pestañas son dos demos independientes, y se acepta $0.01 como aporte.

### Una nota de método que vale para todo lo que venga

El QA de Mac Draft dejó escrito algo que conviene heredar: esa noche tres de sus mediciones
dieron falsos resultados por instrumentos suyos mal calibrados, y las tres las cazó antes de
que salieran como veredicto. Su regla: **cuando un número mío contradiga lo que dice el
ingeniero, el primer sospechoso es mi medidor.**

**Cierre definitivo de Mac Draft:** las cinco corridas completas pasan, con los dos
conteos en cero absoluto, cero equipos incompletos y la aritmética cerrando en las cinco
(150+43, 120+73, 180+13, 150+43, 180+13, todas dan 193). De 7 fallos en 10 partidas, y 4 de
cada 5 con puja agresiva, a 0 de 5.

### Mac Draft: el pool y el cambio de motor (8-sep, 00:11)

El QA comprobó que 228 alcanzaba por el total pero no por posición: había 14 pateadores y
14 defensas, y una sala de doce necesita 12 de cada uno. Margen de dos. Y ese margen se
podía comer, porque una casilla de banca aceptaba cualquier posición, así que un pateador
sobrante podía acabar ahí y dejar sin K al último equipo.

Arreglado con dos cambios, uno de ellos **en el motor**:

- **Pool de 228 a 264**, subiendo solo lo que faltaba: K de 14 a 32 y DEF de 14 a 32, uno
  por franquicia, que es el techo real del deporte. El margen de K y DEF en la sala de doce
  pasa de 2 a 20.
- **`fits` cambió**: un pateador o una defensa ya solo caben en su propia casilla. Si está
  llena, no caen en banca, ni en FLEX, ni en ningún lado. Además de cerrar el desagüe es la
  jugada correcta: nadie guarda un segundo pateador en el banquillo.

Efecto visible: una vez que tienes tu K, todos los pateadores del tablero se muestran
bloqueados con "no open spot". Es correcto e informa, pero cambia lo que se ve en las
últimas rondas.

**Riesgo que abre este arreglo y que hay que vigilar:** la banca era la válvula de escape.
Sin ella, hay que comprobar que ningún equipo se pueda quedar colgado si le queda una
casilla y en el board solo quedan pateadores y defensas.

**Mac Draft, verificación definitiva:** cuatro subastas completas jugadas a mano contra el
pool de 264, más 36 partidas del cazador de atascos. **40 partidas completas sin un solo
equipo incompleto.** Los dos conteos del desagüe en cero en todas, la aritmética cerrando en
264 en todas, cero pateadores o defensas en banca, y ningún equipo atascado pese a haber
quitado la banca como válvula de escape.

El riesgo que abría el cambio de motor no se materializa, y hay margen de sobra por
aritmética: con K y DEF fuera de la banca quedan 13 casillas por equipo que solo pueden
llenar los otros 200 jugadores, y la sala más exigente, la de doce, necesita 156.

---

## Soygalith salió de este expediente (8-sep-2026)

Por decisión de Wolco, Soygalith pasó a trabajarse por separado. Todo lo suyo vive ahora en
`~/Development/soygalith/rediseno-2026-09/`: el sitio construido, el canvas, las
referencias, la ficha y sus decisiones extraídas.

El sitio publicado sigue en https://claude.ai/code/artifact/f0643f20-8d81-45e9-b985-90c52772d28f

Este expediente queda para los otros cuatro: Denuncia AI, Detalle, Mac Draft y Rina Training.

## MAC DRAFT CERRADO. Los cinco (8-sep, 12:30)

Último pase sin fallos nuevos. Lo que se verificó en él:

- El contador separa lo que hay de lo que te sirve, y las tres frases caben en una línea a
  320 y 390. La coletilla de subasta solo sale en el caso corto.
- Las cápsulas K y DEF apagadas se ven apagadas y quedan fuera del recorrido de tabulación.
- La concordancia del resumen, correcta en 1, 2, 3 y 15 casillas vacías.
- Las seis ramas de macAdvice recorridas turno por turno contra el plantel real: quince
  turnos, cero contradicciones.
- Un solo repintado del tablero al draftear con filtro puesto, medido con MutationObserver.
- Regresión limpia después de tocar render y macAdvice.

**Observación del QA que queda anotada, y que él mismo considera suficiente:** en las últimas
rondas, cuando solo quedan K y DEF por llenar, las cápsulas de QB, RB, WR, TE y FLEX siguen
encendidas y llevan a un tablero con las filas bloqueadas. Lo que salva ese callejón es el
contador nuevo, que dice "14 on the board, none for you", más la barra que remata con "Your
last spots take a K or DEF". El callejón queda rotulado en vez de cerrado.

**Lo único abierto en los cinco proyectos: el loro de Mac Draft**, que el QA lee como
ilustración generada por IA. Lo decide Wolco.

---

## Contexto común de los cinco, que sigue aplicando

## Transversales

- El diseño se dibuja en HTML, como artboards de canvas. El código de cada proyecto
  se queda en su stack: Detalle y Rina Training en Next.js, Soygalith y Denuncia AI
  en HTML estático. Nadie migra de framework.
- Los artboards de dirección van estáticos. Solo la pantalla ganadora se vuelve
  clicable, después de que Wolco elija.
- Referencias antes de dibujar: swipe file propio, recent.design y refero.design.
  Sin Mobbin, no hay sesión.
- **Inter NO está vetada.** El veto global es Helvetica, Helvetica Neue, Archivo e
  Instrument Serif. Evitar Inter es criterio de diseño, no regla de Wolco.

## Lo que encontró el QA independiente (7-sep, fase 4)

Los cinco ingenieros reportaron que su trabajo pasaba. El QA independiente tumbó a los
cinco. Ninguno mintió: sus números eran correctos. Lo que falló fueron los huecos que deja
cualquier verificación hecha por quien construyó.

### Cómo se trabajó, para repetirlo

Un ingeniero y un QA independiente por proyecto, en paralelo. Al QA se le encarga
explícitamente romper, no confirmar, y se le exige evidencia con número o captura: sin
evidencia no es falla. Los cinco ingenieros reportaron que su trabajo pasaba y los cinco
tenían fallas reales, ninguno mintiendo: sus números eran correctos, sus huecos no.

Lo que más rindió: pedirle al QA que valide su propio instrumento con un canario antes de
medir. Varios falsos verdes y falsos rojos se cazaron así, en las dos direcciones.

## El loro se queda como está (Wolco, 8-sep-2026)

Único punto que quedaba abierto en los cinco proyectos. El QA lo leía como ilustración
generada por IA: vector plano, ala arcoíris, brillo de asset. **Wolco decidió que se queda
tal cual.** Mac es su mascota y la conoce mejor que el QA.

No se re-discute. Si vuelve a aparecer en un informe de QA, se anota como observación
cerrada, no como falla.

Para quien tenga que tocarlo algún día: no es una imagen, son cinco usos del mismo PNG en
base64 dentro de `sitio/index.html` (pantalla de arranque, logo de la barra superior,
portada a 76px, 404 a 112px, ícono de la pestaña Recap) más el set de expresiones del
objeto `MAC` en el JS, que alimenta el consejo durante el draft. Los originales están en
`canvas/mac-*.png`.

**Con esto Mac Draft no tiene nada abierto.**
