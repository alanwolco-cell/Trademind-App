Trabajamos solo en Mac Draft. Nada de los otros proyectos del rediseño entra en esta sesión.

Lee primero, en este orden:
1. `CLAUDE.md` de este proyecto, sobre todo el bloque final del rediseño de septiembre 2026.
2. `rediseno-2026-09/decisiones.md`, que son decisiones cerradas de Wolco y no se re-discuten.
3. `rediseno-2026-09/ficha.md` si necesitas saber qué es el producto hoy.

DÓNDE ESTAMOS
El rediseño está cerrado y verificado: dirección A "Cabina de transmisión", draft jugable de
punta a punta en snake y en subasta, cuatro rondas de QA independiente y 40 partidas completas
sin un solo equipo incompleto. El producto vive en `rediseno-2026-09/sitio/index.html`, un HTML
autocontenido de 411 KB que abre con doble clic, y publicado en
https://claude.ai/code/artifact/9bc2e278-2139-4d73-80ef-2f7fc3efe5e8

LO ÚNICO ABIERTO: EL LORO
Mac el guacamayo es la mascota, pero el QA lo señaló como la única cosa del producto que se
lee como ilustración generada por IA: vector plano, ala arcoíris, brillo de asset. En la
portada aparece tres veces y es lo primero que ve un desconocido. Todo lo demás de la cabina
le pareció de lo menos vibecoded que ha revisado, así que el loro desentona hacia abajo.
Esto lo decide Wolco, no tú. Pregúntale qué quiere antes de tocarlo, y si decide rehacerlo,
los assets se generan con Higgsfield o Codex, nunca con otra herramienta.

CÓMO SE TRABAJA AQUÍ
- **El index.html se construye desde un script, no se edita a mano.** Un parche directo sobre
  el entregable desaparece en el siguiente build sin que nadie lo note.
- Antes de dar algo por terminado va un QA independiente con el encargo de romperlo, no de
  confirmarlo. En este proyecto los cinco ingenieros del rediseño dijeron que su trabajo
  pasaba y los cinco tenían fallas reales.
- Se verifica por donde entra el usuario. La subasta parecía funcionar porque se probaba con
  el botón "Let Mac finish", que es el camino que un jugador no usa. Jugada a mano fallaba
  7 de cada 10 veces.
- Móvil con emulación de dispositivo real y con toques, nunca con un viewport estrecho a
  secas: con viewport normal el meta viewport no interviene y no estás probando lo que ve un
  teléfono.
- Contraste medido sobre los píxeles del render, no leyendo variables del CSS.
- Y valida tu propio instrumento con un canario antes de fiarte de lo que mide. En este
  proyecto el QA cazó seis veces que su medidor mentía, y dos de esas habrían acusado al
  ingeniero de fallos inexistentes.

Cuando sepas dónde estás, dime qué ves y espera a que Wolco te diga por dónde seguir.
