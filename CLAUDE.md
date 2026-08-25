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
Solo para el, sin monetizar. Estado: **DESPLEGADO Y HABILITADO** (2026-08-24).
PERFIL_ACCTS en produccion trae el acctId de la computadora del dueno. El id es
POR NAVEGADOR (sha256 de la llave de su localStorage): para entrar desde el
celular hay que anadir el suyo a la misma lista, separado por coma, y
redesplegar, porque las variables de Vercel solo entran con un deploy nuevo.
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

### Pendiente propio del perfil
Fase 2 (comportamiento en la app: que le preguntaste a Mac, que trades miraste y
no hiciste) NO se puede empezar sin tocar antes `public/privacy.html`. La Fase 1
no expone nada nuevo porque sale entera de la API publica de Sleeper; el dia que
se registre comportamiento propio eso deja de ser cierto, y la politica tiene que
decirlo ANTES de guardar el primer evento. Esta escrito en la cabecera de
`server/routes/perfil.js`.

## Yahoo Fantasy: no conecta, y no es el codigo
Medido el 2026-08-24 contra la app real, cambiando una cosa por vez:

    redirect_uri=macdraft.app      -> invalid_request "invalid redirect uri"
    redirect_uri=trademindff.com   -> invalid_scope   "invalid scope"
    trademindff.com + scope=openid -> 302 a login.yahoo.com, entra bien

El control con openid pasa con la MISMA app y las mismas credenciales, asi que el
OAuth esta sano: falta el permiso de Fantasy Sports. Yahoo cerro el acceso
self-serve; hoy se solicita en https://sports.yahoo.com/developer/ y se espera
aprobacion manual, y la consola de apps ya no ofrece ese permiso para marcarlo.
Hasta que aprueben NO hay codigo que conecte una liga de Yahoo.

Dos cosas abiertas, las dos esperando a Wolco:
1. La app de Yahoo sigue registrada con el dominio viejo (trademindff.com).
   Anadir https://macdraft.app/api/yahoo/callback a sus Redirect URI. Barato,
   pero por si solo no conecta nada: el bloqueo que manda es el scope.
2. `/api/yahoo/status` devuelve configured en cuanto existen las credenciales,
   asi que el boton "Sign in with Yahoo" esta VIVO en produccion y lleva a una
   pagina de error de Yahoo, en la pantalla de conectar cuenta. Propuesto
   esconderlo tras una variable hasta que aprueben; sin decision aun, NO aplicado.
