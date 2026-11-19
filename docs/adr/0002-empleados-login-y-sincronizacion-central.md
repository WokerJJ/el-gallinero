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
4. **Los roles se hacen cumplir en el script, no en la pantalla.** Ocultar botones es comodidad, no seguridad: el `localStorage` de un teléfono se puede manipular. El objetivo es que el token de un empleado permita solo acciones de **registrar** (agregar ventas, compras, movimientos, fichajes); **en la entrega 1 el empleado solo podía `ping`, `yo` y `salir`**; con el ADR 0003 también puede `leer` y `guardar` (con comprobación de versión), y todo lo demás (traer clientes, administrar empleados) se le sigue negando en el script. **Anular, cerrar la caja, activar la caja, borrar y restaurar** exigen rol de dueño. El dueño entra con su propio PIN (la `CLAVE` actual del enlace deja de ser la credencial de las personas). **En la entrega 1 el dueño sigue entrando con la `CLAVE`**: así el Sheet ya publicado sigue funcionando y no se rompe nada; el PIN del dueño llega con la sincronización.
5. **PIN corto = defensa en el servidor.** Un PIN de 4 dígitos tiene solo 10.000 combinaciones; lo que lo protege es el bloqueo del lado del script (por ejemplo 5 intentos fallidos → bloqueo de 15 minutos, contado por empleado) y que el hash lleve sal. Apps Script no ofrece bcrypt: se usa SHA-256 con sal y se documenta como límite.
6. **Se pasa de «reemplazar el estado» a «agregar eventos».** Cada teléfono envía los registros **nuevos** (ventas, compras, movimientos de caja, cierres, fichajes), cada uno con id único y un campo `dispositivo`; el script los **agrega sin duplicar** (idempotente por id) y cada teléfono **trae lo que otros agregaron** desde su último cursor. El libro de caja ya está pensado así (ADR 0001, punto 3). Lo que hoy se guarda como valor mutable (por ejemplo `stock`) pasa a **calcularse sumando eventos**, o a sincronizarse como diferencia, nunca como valor absoluto. *Nota: la entrega 2 se resolvió con el ADR 0003 (comprobación de versión, sin eventos): se sigue reemplazando el estado completo, pero un envío con versión vieja se rechaza.*
7. **La hora la pone el servidor.** El fichaje (entrada y salida) usa la hora del script, no la del teléfono. La hora del teléfono se guarda solo como dato de apoyo. Así un empleado no puede ajustar su reloj.
8. **`por` deja de ser «Dueño».** Cada registro guarda el id y el nombre del empleado que lo hizo.
9. **Offline.** Un empleado sin señal registra en su teléfono y los eventos quedan en cola hasta que haya conexión. El servidor es quien da el orden final; las operaciones que dependen del estado compartido (cerrar la caja del día) exigen conexión.

## Entregas (orden)

| # | Entrega | Qué deja funcionando |
|---|---|---|
| 1 | Empleados, login y roles | Pestaña `_empleados`, alta y baja por el dueño, login por PIN con bloqueo, token, y autorización por rol en el script. Atribución real en `por`. |
| 2 | ~~Sincronización por eventos~~ → resuelta por la sincronización por turnos del [ADR 0003](0003-sincronizacion-por-turnos-con-version.md) | ~~Varios teléfonos a la vez: envío idempotente, cursor de lectura, cola sin conexión, stock y saldos calculados.~~ Se resolvió sin eventos: carga al abrir y envío con comprobación de versión. |
| 3 | Reloj de horas → resuelta en el [ADR 0005](0005-reloj-de-horas-con-salida-al-cerrar-la-caja.md) | Entrada y salida con hora del servidor, horas por día y por empleado, y corrección por el dueño con rastro. |
| 4 | Horarios | El dueño arma turnos por empleado; el empleado los ve; comparación con lo fichado. |

## Consecuencias

- La **entrega 1 sola** no permitía todavía que un empleado trabajara con *su* teléfono sobre los datos del negocio; eso se resolvió después con la sincronización por turnos del ADR 0003. La entrega 1 es la base de identidad y permisos.
- Es un **cambio de modelo de datos y de contrato con el script**, no un añadido. El Sheet actual (espejo por reemplazo) debe seguir funcionando para quien no use empleados: la entrega 2 no activó eventos: se resolvió con la comprobación de versión del ADR 0003, que funciona igual con o sin empleados (crear empleados no cambia cómo se guardan los datos).
- Aumenta la superficie de seguridad: PIN, tokens, bloqueo y datos personales de empleados (nombre, horas). El Sheet debe quedar **compartido solo con el dueño**; el empleado nunca debe tener acceso al archivo, solo al enlace del script.
- Las horas de los empleados pueden ser **datos laborales**: se guardan solo lo necesario (nombre, horas, turnos) y se documenta quién puede verlos.
- Apps Script tiene cuotas diarias y un bloqueo por ejecución: con varios teléfonos enviando seguido hay que agrupar envíos y medir el tiempo de respuesta.

## Qué hizo la entrega 1 (y sus límites)

- **Lo hecho:** pestañas ocultas `_empleados` y `_sesiones`; alta, cambio de PIN y activación o desactivación por el dueño; entrada por PIN con bloqueo de 5 fallos durante 15 minutos; token de 12 horas que se guarda solo como hash; tabla de permisos en el script; pantalla de entrada, límites por rol y pantalla *Empleados* en la app; `por` real en ventas, compras, movimientos y cierres de caja. Cada acción de la app debe estar clasificada como libre o solo del dueño (una prueba lo exige).
- **Pedir inicio de sesión es por teléfono** (`eg_acceso`, fuera de los respaldos). Apagado, la app se comporta exactamente como antes.
- **Actualización (ADR 0003): el empleado ya tiene datos compartidos.** En la entrega 1 el servidor le negaba `guardar` y `leer`; la entrega 2 se resolvió con la sincronización por turnos del ADR 0003 (comprobación de versión, sin eventos). Hoy el empleado puede leer y guardar con su token, desde un teléfono compartido o el suyo, y todo lo que registre queda con su nombre; sigue sin poder traer clientes ni administrar empleados.
- **En un teléfono compartido los roles de la pantalla son un orden, no una barrera.** Ese teléfono guarda la clave del dueño; quien sepa abrir las herramientas del navegador puede saltarse los límites. La protección real (que el empleado solo tenga un token y nunca la clave) llega cuando cada empleado use su propio teléfono.
- **Bloqueo por denegación (NO resuelto):** quien conozca un usuario y el enlace puede bloquear esa cuenta 15 minutos intentando PIN al azar; el dueño ve «Bloqueado por intentos fallidos» y cambia el PIN para desbloquear. Es el precio de un PIN corto.
- **Límite global de entradas (mitigación parcial):** el script acepta como máximo 30 intentos de entrada por minuto en total (caché del script, ventana fija; el exceso se rechaza con el mismo mensaje genérico, sin tomar el cerrojo ni leer hojas). Así un chorro de intentos no deja al dueño con «El Sheet está ocupado». La lectura y la escritura de la caché no son atómicas: bajo carga extrema pueden colarse algunos intentos de más. No impide el bloqueo de una cuenta concreta (punto anterior).
- **La revocación es de mejor esfuerzo:** la app revalida la sesión al abrirse, al volver a primer plano y cada 5 minutos mientras esté abierta; sin red no se cierra nada. Desactivar a un empleado o cambiar su PIN invalida el token en el script al instante, pero el teléfono tarda hasta ese intervalo en enterarse. Además, quien atrase el reloj del teléfono alarga el vencimiento *local* de su sesión (el vencimiento del script no se puede engañar, pero la pantalla sí). Límite conocido de la entrega 1.
- **Tipos de Sheets:** Sheets convierte lo que se escribe (un nombre «1234» en número, «true» en booleano, «=…» en fórmula, una fecha ISO en fecha). Las pestañas internas se escriben con formato de texto plano antes de cada escritura, se leen siempre como texto y las fechas se aceptan como texto, Date o milisegundos. No se antepone apóstrofo a los nombres: en una celda de texto plano se vería literal.
- **El Sheet aún no muestra «quién registró» en Ventas y Compras:** el dato queda en la app y en el respaldo; las columnas del espejo se añaden con la sincronización (entrega 2), para no cambiar dos veces el contrato con las plantillas y los paneles.

## Fuera de alcance por ahora

Nómina y pago de salarios, permisos y vacaciones, fotos o ubicación en el fichaje, notificaciones push y más de un negocio por Sheet.
