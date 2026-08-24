# Mac Draft: estado del proyecto

Ultima actualizacion: 2026-08-24.

## Que es
Dynasty fantasy football: mock drafts (snake y subasta) que se comportan como tu liga,
analizador de trades, radiografia de liga, y Mac (loro macaw morado) como asistente.
Dominio: macdraft.app. Deploy en Vercel, proyecto `trademind-starter`.

## Gates obligatorios antes de cualquier deploy
```
node scripts/calibrate-room.mjs   # 40 invariantes, ~10 min. Debe dar ALL GREEN
node scripts/qa-flows.mjs         # flujos con el motor real
node scripts/qa-trades.mjs        # 9.989 escenarios, 32 checks
node scripts/qa-perfil.mjs        # 54 checks del motor del perfil, instantaneo
```
Los cuatro corren desde cualquier directorio. Un test que no falla contra el codigo
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
Solo para el, sin monetizar. Estado: COMPLETO EN LOCAL, NO DESPLEGADO.

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
tiene gate propio (`scripts/qa-perfil.mjs`, 54 checks); antes no tenia ninguno,
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

Falta para desplegar:
1. Poner el acctId real del dueno en la variable de entorno PERFIL_ACCTS en Vercel.
   Se obtiene abriendo /perfil: el 403 MUESTRA el acctId propio en pantalla.
   Es POR NAVEGADOR (sha256 de la llave de su localStorage), asi que cada
   navegador desde el que quiera entrar necesita su propia entrada en la lista.
   Sin la variable la ruta falla cerrada y no entra nadie, el dueno incluido:
   por eso se puede desplegar antes de tener el id.
