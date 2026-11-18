# ADR 0002 · Empleados, login por PIN y un Sheet central como fuente compartida

- Estado: aceptada. Entrega 1 implementada; las entregas 2 a 4 siguen pendientes
- Fecha: 2026-11-18

## Contexto

La app guarda todo en el `localStorage` de **un** teléfono y copia el estado completo al Google Sheet («el envío reemplaza»). El ADR 0001 ya lo dice: con dos teléfonos *gana el último que guarda* y el otro pierde sus movimientos. Eso basta para un dueño con un solo celular, pero no para que los empleados registren ventas, reciban mercancía, paguen desde la caja y marquen su horario desde sus propios teléfonos.

Se pidieron cuatro cosas: **login**, **roles**, **reloj de horas** y **horarios**. Se eligió (con el dueño) un único Sheet central y PIN de 4 a 6 dígitos.

## Decisión

1. **Un script central y un Sheet como fuente compartida.** Todos los teléfonos hablan con el mismo Apps Script. No hay un Excel por empleado ni consolidación al final del día: dos copias de la verdad son la forma más fácil de duplicar o perder dinero.
2. **Empleados en una pestaña oculta `_empleados`** (id, nombre, rol, PIN con sal y hash, activo, intentos fallidos, bloqueado hasta). Solo el dueño crea, desactiva o cambia el PIN de un empleado.
3. **Login por PIN → token.** El teléfono envía `empleadoId + PIN`; el script lo verifica y devuelve un **token aleatorio** por dispositivo (se guarda solo su hash en el Sheet, con vencimiento). Las llamadas siguientes llevan el token, no el PIN. Cada empleado se puede **cerrar sesión o revocar** desde el dueño.
4. **Los roles se hacen cumplir en el script, no en la pantalla.** Ocultar botones es comodidad, no seguridad: el `localStorage` de un teléfono se puede manipular. El token de un empleado solo permite acciones de **registrar** (agregar ventas, compras, movimientos, fichajes); **anular, cerrar la caja, activar la caja, borrar y restaurar** exigen rol de dueño. El dueño entra con su propio PIN (la `CLAVE` actual del enlace deja de ser la credencial de las personas). **En la entrega 1 el dueño sigue entrando con la `CLAVE`**: así el Sheet ya publicado sigue funcionando y no se rompe nada; el PIN del dueño llega con la sincronización.
5. **PIN corto = defensa en el servidor.** Un PIN de 4 dígitos tiene solo 10.000 combinaciones; lo que lo protege es el bloqueo del lado del script (por ejemplo 5 intentos fallidos → bloqueo de 15 minutos, contado por empleado) y que el hash lleve sal. Apps Script no ofrece bcrypt: se usa SHA-256 con sal y se documenta como límite.
6. **Se pasa de «reemplazar el estado» a «agregar eventos».** Cada teléfono envía los registros **nuevos** (ventas, compras, movimientos de caja, cierres, fichajes), cada uno con id único y un campo `dispositivo`; el script los **agrega sin duplicar** (idempotente por id) y cada teléfono **trae lo que otros agregaron** desde su último cursor. El libro de caja ya está pensado así (ADR 0001, punto 3). Lo que hoy se guarda como valor mutable (por ejemplo `stock`) pasa a **calcularse sumando eventos**, o a sincronizarse como diferencia, nunca como valor absoluto.
7. **La hora la pone el servidor.** El fichaje (entrada y salida) usa la hora del script, no la del teléfono. La hora del teléfono se guarda solo como dato de apoyo. Así un empleado no puede ajustar su reloj.
8. **`por` deja de ser «Dueño».** Cada registro guarda el id y el nombre del empleado que lo hizo.
9. **Offline.** Un empleado sin señal registra en su teléfono y los eventos quedan en cola hasta que haya conexión. El servidor es quien da el orden final; las operaciones que dependen del estado compartido (cerrar la caja del día) exigen conexión.

## Entregas (orden)

| # | Entrega | Qué deja funcionando |
|---|---|---|
| 1 | Empleados, login y roles | Pestaña `_empleados`, alta y baja por el dueño, login por PIN con bloqueo, token, y autorización por rol en el script. Atribución real en `por`. |
| 2 | Sincronización por eventos | Varios teléfonos a la vez: envío idempotente, cursor de lectura, cola sin conexión, stock y saldos calculados. Es la parte más delicada. |
| 3 | Reloj de horas | Entrada y salida con hora del servidor, horas por día y por empleado, y corrección por el dueño con rastro. |
| 4 | Horarios | El dueño arma turnos por empleado; el empleado los ve; comparación con lo fichado. |

## Consecuencias

- La **entrega 1 sola** no permite todavía que un empleado trabaje con *su* teléfono sobre los datos del negocio: eso llega con la entrega 2. Es la base de identidad y permisos; si el dueño prefiere ver el valor completo antes, se pueden unir las entregas 1 y 2 en un solo PR más grande.
- Es un **cambio de modelo de datos y de contrato con el script**, no un añadido. El Sheet actual (espejo por reemplazo) debe seguir funcionando para quien no use empleados: la sincronización por eventos se activa al crear el primer empleado.
- Aumenta la superficie de seguridad: PIN, tokens, bloqueo y datos personales de empleados (nombre, horas). El Sheet debe quedar **compartido solo con el dueño**; el empleado nunca debe tener acceso al archivo, solo al enlace del script.
- Las horas de los empleados pueden ser **datos laborales**: se guardan solo lo necesario (nombre, horas, turnos) y se documenta quién puede verlos.
- Apps Script tiene cuotas diarias y un bloqueo por ejecución: con varios teléfonos enviando seguido hay que agrupar envíos y medir el tiempo de respuesta.

## Qué hizo la entrega 1 (y sus límites)

- **Lo hecho:** pestañas ocultas `_empleados` y `_sesiones`; alta, cambio de PIN y activación o desactivación por el dueño; entrada por PIN con bloqueo de 5 fallos durante 15 minutos; token de 12 horas que se guarda solo como hash; tabla de permisos en el script; pantalla de entrada, límites por rol y pantalla *Empleados* en la app; `por` real en ventas, compras, movimientos y cierres de caja. Cada acción de la app debe estar clasificada como libre o solo del dueño (una prueba lo exige).
- **Pedir inicio de sesión es por teléfono** (`eg_acceso`, fuera de los respaldos). Apagado, la app se comporta exactamente como antes.
- **El empleado todavía no tiene datos compartidos.** El servidor ya le niega `guardar` y `leer`; mientras el Sheet sea un espejo por reemplazo, un envío suyo pisaría los datos del negocio. Hoy el uso real es **un teléfono o tableta compartido**: el empleado entra con su PIN y todo lo que registre queda con su nombre. Trabajar desde su propio teléfono llega con la entrega 2.
- **En un teléfono compartido los roles de la pantalla son un orden, no una barrera.** Ese teléfono guarda la clave del dueño; quien sepa abrir las herramientas del navegador puede saltarse los límites. La protección real (que el empleado solo tenga un token y nunca la clave) llega cuando cada empleado use su propio teléfono.
- **Bloqueo por denegación:** quien conozca un usuario y el enlace puede bloquear esa cuenta 15 minutos intentando PIN al azar. Es el precio de un PIN corto; el dueño puede cambiar el PIN para desbloquear.
- **El Sheet aún no muestra «quién registró» en Ventas y Compras:** el dato queda en la app y en el respaldo; las columnas del espejo se añaden con la sincronización (entrega 2), para no cambiar dos veces el contrato con las plantillas y los paneles.

## Fuera de alcance por ahora

Nómina y pago de salarios, permisos y vacaciones, fotos o ubicación en el fichaje, notificaciones push y más de un negocio por Sheet.
