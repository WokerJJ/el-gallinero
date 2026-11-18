# ADR 0003 · Sincronización por turnos con comprobación de versión

- Estado: aceptada
- Fecha: 2026-11-18
- Reemplaza: la «entrega 2» del ADR 0002 (sincronización por eventos), que era más de lo que el negocio necesita hoy.

## Contexto

La app guarda el estado completo en cada teléfono y lo copia entero al Sheet; el último que guarda gana (ADR 0001, punto 6). Con varios teléfonos eso pierde datos **sin necesidad de que dos personas trabajen a la vez**: un empleado vende por la mañana desde el celular A y su venta llega al Sheet; por la tarde el dueño usa el celular B, que nunca recibió esa venta, y su envío la borra.

El negocio es pequeño y las personas trabajan por turnos, así que no hace falta un modelo de eventos con cursores y colas. Hace falta que **ningún envío pise en silencio lo que otro guardó**.

## Decisión

1. **Versión del Sheet.** Cada envío al script deja una versión nueva en una celda propia de `_respaldo` (`B7`, texto con prefijo `v` para que Sheets no la convierta). `ping` y `leer` la devuelven.
2. **Comprobación al guardar (compare-and-swap).** Cada teléfono recuerda la versión que cargó por última vez (`sync.base`) y la manda como `base` en cada `guardar`. Dentro del cerrojo del script, si `base` no coincide con la versión vigente, el envío **se rechaza** con `conflicto: true` y no se escribe nada. Una app anterior que no manda `base` guarda como siempre. Un teléfono que nunca sincronizó (`base: ''`) tampoco pisa un Sheet que ya tiene datos.
3. **Al abrir, al entrar y al volver tras 5 minutos fuera de la app**, el teléfono pregunta la versión. Si cambió y **no hay cambios sin enviar**, carga el Sheet solo (guardando antes una copia en `eg_prev`). Si hay cambios sin enviar, **pregunta** qué datos conservar. No lo hace con un diálogo abierto ni sin internet.
4. **Si un envío choca**, no se trata como error de red ni se reintenta en bucle: se pregunta *usar los del Sheet*, *usar los de este teléfono* (se envía contra la versión vigente; el Sheet conserva la generación anterior) o *decidir después* (el envío automático espera).
5. **Cerrar la caja envía al Sheet de forma obligatoria.** Si no llega (sin internet, error), se muestra un aviso claro: el cierre queda hecho y pendiente de enviar, y se reintenta solo. No se bloquea el cierre: no poder cerrar el día por una falla de red es peor.
6. **El empleado puede leer y guardar** con su token (nunca con la clave). Sigue sin poder traer clientes ni administrar empleados. Su `ping` no trae cifras del negocio.
7. **No se fusionan datos.** Se elige un lado completo. El inventario y la caja siguen siendo coherentes porque se reemplaza el estado entero, no registros sueltos.

## Consecuencias

- Se cumple lo que se pidió: el Sheet se carga al abrir y se envía al cerrar la caja (y, como antes, unos segundos después de cada cambio), y **nada se pisa sin que alguien lo decida**.
- **El teléfono del empleado tiene todos los datos del negocio** (costos y ganancias incluidos) aunque su pantalla no los muestre, y una app dañada o mal intencionada con un token válido podría reemplazar el Sheet. Es un riesgo aceptado para un negocio pequeño y de confianza; se mitiga con la comprobación de versión y con la copia anterior (`_respaldo_anterior`, una generación). Si algún día el equipo crece, la salida es el modelo de eventos con permisos por tipo de registro.
- **Lo que se ve puede estar hasta unos minutos desactualizado** (se carga al abrir o tras 5 minutos fuera de la app, no en vivo). Dos personas editando a la vez no se pierden: el segundo en enviar recibe el aviso de conflicto.
- Quien elige «usar los del Sheet» pierde sus cambios sin enviar (queda `eg_prev`); quien elige los de su teléfono pisa los del otro (queda la generación anterior del Sheet). Es una decisión explícita, no un accidente.
- Si el script publicado es anterior a esto, la app lo detecta (no hay versión) y sigue funcionando como antes, sin comprobación.
- La columna `B7` no la leen los paneles; no cambia el contrato con la plantilla ni con `Paneles.gs`.
