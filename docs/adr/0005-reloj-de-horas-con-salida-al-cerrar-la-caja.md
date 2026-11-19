# ADR 0005 · Reloj de horas: la entrada la ficha el empleado y la salida la marca el cierre de caja

- Estado: aceptada
- Fecha: 2026-11-19

## Contexto

Se quiere contabilizar el tiempo de los empleados (ADR 0002, entrega 3). Reglas de negocio dadas por el dueño: **los descansos no se cuentan** y **la salida se marca cuando el jefe cierra la caja**, porque el jefe es el único que cuadra la caja y ese es el momento en que termina el turno de todos.

## Decisión

1. **Entrada.** El empleado pulsa «Entrar a trabajar» en su teléfono. La hora **la pone el script** (`new Date()` del servidor), no el teléfono, para que nadie pueda adelantarla cambiando el reloj del celular. Por eso **requiere conexión**.
2. **Salida.** No hay botón de salida para el empleado. Cuando el dueño **cierra la caja**, la app le dice al script que marque la salida de **todos los turnos abiertos**, con la hora del servidor (o la del cierre si la llamada se demoró por falta de red, acotada para que no sea futura ni anterior a la entrada).
3. **Sin descansos.** Las horas de un turno son `salida − entrada`, sin restar nada, en **minutos exactos** (sin redondeo) y en hora de Colombia (UTC−5, sin horario de verano).
4. **Un turno abierto por empleado.** Pulsar «Entrar» dos veces devuelve el mismo turno (idempotente).
5. **Tope de seguridad.** Un turno que lleva más de **16 horas** abierto (el dueño olvidó cerrar la caja) se cierra solo en `entrada + 16 h`, marcado `tope` para que el dueño lo revise.
6. **Correcciones del dueño.** Solo el dueño puede corregir la entrada o la salida de un turno, o **agregar** uno que se olvidó fichar. Siempre con un **motivo**, y cada cambio queda en un registro aparte (`_fichajes_log`: quién, cuándo, qué había antes y qué hay ahora). El turno original no se pierde.
7. **Quién ve qué.** El empleado ve **solo su turno y sus horas** de hoy y de la semana. El dueño ve las horas de todo el equipo. El resto de datos de la app no cambia.

## Dónde viven los datos

En el **script**, no en el estado de la app: pestañas ocultas `_fichajes` (un turno por fila) y `_fichajes_log`. Así los fichajes **no dependen de la sincronización por turnos** (ADR 0003): cada fichaje es un registro nuevo que no puede pisar ni ser pisado por el envío del estado completo.

Acciones nuevas del script y quién puede pedirlas:

| Acción | Quién | Qué hace |
|---|---|---|
| `fichar` | empleado | Abre su turno (o devuelve el abierto) |
| `miTurno` | empleado | Su turno actual y sus horas de hoy y de la semana |
| `turnosAbiertos` | dueño | Quién está trabajando ahora (para avisar al cerrar la caja) |
| `turnosCerrar` | dueño | Marca la salida de todos los turnos abiertos |
| `turnosListar` | dueño | Turnos y horas por empleado en un rango de fechas |
| `fichajeCorregir` / `fichajeAgregar` | dueño | Corrige o agrega un turno, con motivo |

## Cierre de caja

1. Antes de cerrar, si hay Sheet conectado, la app consulta quién está trabajando y lo **muestra en la confirmación** («Se marcará la salida de Luis, desde las 8:02»).
2. El cierre se guarda y se envía como siempre; después se llama a `turnosCerrar`.
3. Si esa llamada falla (sin internet), queda anotada en el teléfono y **se reintenta** al volver la conexión o al abrir la app, con la hora del cierre como referencia.

## Consecuencias

- **Si un empleado se va antes del cierre, sus horas se cuentan hasta el cierre.** Es la consecuencia directa de la regla elegida; el dueño puede corregir la salida de ese turno con motivo.
- **Sin caja activada no hay cierre**, así que los turnos solo se cierran por el tope de 16 horas o a mano desde la pantalla de horas.
- **Entrar a trabajar sin internet no es posible** (la hora debe ser la del servidor). Es un precio aceptado para que las horas sean confiables.
- Las horas no se vuelven nómina: **no hay recargos, horas extra ni cálculos legales**. Solo se registran las horas con trazabilidad.
- En un teléfono compartido, el empleado ficha con su token y no con la clave del dueño; el dueño no puede fichar.
- Los horarios (entrega 4) quedan aparte: el dueño los arma y se comparan con lo fichado.
