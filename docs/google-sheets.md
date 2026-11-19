# Conectar El Gallinero con Google Sheets

La app guarda los datos en el teléfono y, si conectas un Google Sheet, **copia cada cambio ahí automáticamente**. Sirve para tres cosas:

- ver las ventas, compras y deudas como una hoja de cálculo, en el computador;
- no perder nada si se daña o se cambia el celular (se restaura desde el Sheet);
- tener una copia en tu propia cuenta de Google, sin servidores de terceros.

El teléfono sigue siendo la fuente de los datos: el Sheet es un espejo. Si se corta el internet, la app sigue funcionando y envía lo pendiente al volver la conexión. Como cada envío reemplaza el contenido de las pestañas, **no se duplican filas**.

## Montaje (5 minutos, una sola vez)

1. Sube la plantilla [`plantilla/El-Gallinero-plantilla.xlsx`](../plantilla/El-Gallinero-plantilla.xlsx) a Google Drive y ábrela con Hojas de cálculo (*Archivo → Guardar como Hojas de cálculo de Google*). Ya trae todas las pestañas con su formato. Llámala «El Gallinero». (Si prefieres empezar de cero, un Google Sheet vacío también sirve: el script crea las pestañas.)
2. Menú **Extensiones → Apps Script**. Borra lo que haya y pega el contenido de [`apps-script/Code.gs`](../apps-script/Code.gs). En la app puedes copiarlo con un toque: **Más → Google Sheets → Copiar el script**.
3. En la primera línea, cambia `CAMBIA-ESTA-CLAVE` por una clave tuya (por ejemplo `huevos-2026-roldanillo`). Es la contraseña del enlace; anótala.
4. **Implementar → Nueva implementación → Aplicación web**:
   - *Ejecutar como*: **Yo**.
   - *Quién tiene acceso*: **Cualquier persona**.
   - Pulsa **Implementar** y autoriza los permisos. Google avisará que la app no está verificada: es tu propio script, elige *Configuración avanzada → Ir a (nombre del proyecto)*.
   - Copia la **URL de la aplicación web** (termina en `/exec`).
5. En la app: **Más → Google Sheets**, pega la URL y la clave, y pulsa **Conectar**.

## Cosas a saber

- **La URL y la clave son como una contraseña.** Quien tenga ambas puede leer y escribir los datos. No las publiques.
- Si más adelante cambias el script, vuelve a **Implementar → Administrar implementaciones → Editar → Nueva versión**, o la app seguirá usando la versión anterior.
- Pestañas que verás: **Inventario, Ventas, Compras, Proveedores, Clientes, Pérdidas**. Las pestañas `_respaldo` y `_respaldo_anterior` están ocultas y guardan la copia completa; no las borres.
- **No edites las pestañas legibles a mano:** se reescriben en cada envío. Los cambios se hacen en la app.
- **Nada debajo de las tablas:** cada envío limpia todas las filas de la pestaña (de la 2 al final) en las columnas de la tabla. Totales o notas ponlos a la derecha o en otra pestaña.
- **Saldo a favor de proveedores:** si anulas una compra que ya tenía pagos, lo pagado queda como «saldo a favor» del proveedor dentro de la app. Ese dato viaja en el respaldo completo (`_respaldo`), pero **no tiene columna en la pestaña Proveedores** (no se cambió el formato de las pestañas): en el Sheet solo verás la deuda.
- Es una copia de un solo sentido (teléfono → Sheet). Si usas **dos teléfonos a la vez**, el último que envíe gana: para eso habría que construir una sincronización bidireccional.
- **Restaurar:** en un teléfono nuevo, conecta el mismo enlace y la app ofrece traer los datos del Sheet.

## Cargar los clientes desde WhatsApp

WhatsApp no deja exportar la lista de clientes: los clientes son los **contactos guardados en el teléfono**. La ruta es sacarlos de la agenda y pegarlos en la plantilla:

1. **Contactos a un archivo.** En Android (o un iPhone con los contactos en Google): [contacts.google.com](https://contacts.google.com) → seleccionar → *Exportar* → *CSV de Google*. En un iPhone sin Google: [icloud.com](https://www.icloud.com) → Contactos → seleccionar todos → *Exportar vCard*, súbelo en contacts.google.com (*Importar*) y expórtalo como CSV.
2. Abre el CSV en Hojas de cálculo y copia a la pestaña **Cargar clientes** de la plantilla (desde la fila 2):
   - **Columna A (nombre):** la columna del nombre completo (*Name*) o, si no la hay, junta **First Name** y **Last Name**.
   - **Columna B (teléfono):** solo **Phone 1 - Value**. Ignora las demás columnas de teléfono (*Phone 2*, *Phone 3*…) y, si una celda trae varios números separados por ` ::: `, la app toma el primero.
   - **Columna C (notas o dirección):** opcional.
   - Pega como **solo valores** (*Edición → Pegado especial → Solo valores*): así no llegan fórmulas ni errores (`#ERROR!`, `#REF!`), que la app trata como celdas vacías.
3. En la app: **Más → Google Sheets → Traer clientes del Sheet** (o el mismo botón en **Clientes**). La app muestra cuántos agregará y pide confirmar.

**Límites y cuidados:**

- Se leen hasta **5.000 filas con nombre** (las filas vacías no cuentan). Si hay más, la app avisa: «Solo se leyeron las primeras 5000 filas».
- **Clientes** y **Cargar clientes** no son lo mismo: *Clientes* es el espejo de la app (la app la reescribe en cada envío; no pegues nada ahí) y *Cargar clientes* es de entrada (la llenas tú y la app solo la lee). *PANEL CLIENTES* solo resume lo que hay en *Clientes*.
- La pestaña **Cargar clientes NO entra en el respaldo oculto** (`_respaldo`): los clientes que traigas quedan en la app, y de ahí sí se respaldan, pero la lista pegada en esa pestaña se pierde si borras el Sheet. Guarda el CSV original o vuelve a pegarlo cuando haga falta.
- Si falta esa pestaña, el script la crea (con su cabecera) la primera vez que pulsas **Traer clientes del Sheet**.
- Teléfonos: de cada celda se toma solo el primer número (se corta en «ext», «x», `/`, `;` o `,`) y deben tener entre 7 y 12 dígitos; lo demás se guarda sin teléfono. El +57 y el prefijo 00 se ignoran, pero otro país (+1…) cuenta como un número distinto.
- Si varias personas ya guardadas **sin teléfono** tienen el mismo nombre que una fila, la app no adivina a cuál pertenece: no toca ninguna y lo cuenta como *ambiguo* en el aviso de confirmación.
- **¿Instalaste el script antes de esta función?** Actualízalo: pega de nuevo `apps-script/Code.gs` (conservando tu clave) y **Implementar → Administrar implementaciones → Editar → Nueva versión**. Mientras tanto, la app avisa «Tu script es de una versión anterior».

Si algún cliente solo aparece en WhatsApp con su número (sin guardar como contacto), guárdalo primero en la agenda con un nombre.

**No se duplican.** Un cliente es el mismo si coincide el teléfono (se ignoran espacios, guiones y el +57) o, si no hay teléfono, el nombre sin tildes ni mayúsculas. Dos personas con el mismo nombre pero teléfonos distintos son dos clientes. Nunca se borra ni se pisa un dato que ya está en la app: solo se completan teléfono o notas que faltaban. Puedes volver a pegar la lista completa cuando quieras.

## Para agregarle un panel o interfaz gráfica

El script solo reescribe el bloque de la tabla (las columnas de cada pestaña, desde la fila 2). Todo lo demás es tuyo:

- Puedes agregar **columnas a la derecha**, **otras pestañas**, fórmulas, tablas dinámicas y gráficos que lean esas pestañas: no se tocan.
- **Contrato de columnas** (no cambies el nombre de las pestañas ni el orden):

| Pestaña | Columnas |
| --- | --- |
| Inventario | Producto · Unidad · Existencias · Costo promedio · Precio de venta · Control de frescura |
| Ventas | Fecha · Producto · Cantidad · Panales · Precio · Total · Cliente · Pago · Abonado · Debe · Comprobante · Costo unitario · Medio de cobro · Abonado en efectivo · Abonado por transferencia |
| Compras | Fecha · Producto · Cantidad · Panales · Costo unitario · Total · Vence · Días en granja · Notas · Proveedor · Pagado · Debe · Comprobante · Recibió · Documento proveedor |
| Proveedores | Proveedor · Teléfono · Deuda · Notas · Saldo a favor |
| Clientes | Cliente · Teléfono · Deuda · Notas · Documento |
| Pérdidas | Fecha · Producto · Cantidad · Costo unitario · Motivo |
| Caja | Fecha · Concepto · Ingreso · Egreso · Origen · Registró |
| Cierres | Fecha · Esperado · Contado · Diferencia · Nota · Registró |
| Cargar clientes (se llena a mano) | Nombre · Teléfono · Notas / dirección |

- En **Compras**, *Debe* es lo que falta por pagar al proveedor (cuentas por pagar); las compras anteriores a esta función se toman como pagadas por completo.
- En **Compras**, *Comprobante* es el número del comprobante de compra (con su propio prefijo y consecutivo, por ejemplo `CP-000001`).
- En **Ventas**, *Comprobante* es el número consecutivo del comprobante de venta (vacío si todavía no se ha generado uno).
- En **Ventas**, *Costo unitario* es el costo por unidad **en el momento de la venta** (el mismo que usa la app para su ganancia). Úsalo para calcular la ganancia: el costo actual del inventario cambia con cada compra y daría otra cifra. En **Proveedores**, *Saldo a favor* es lo pagado en compras que luego se anularon.
- La pestaña oculta `_respaldo` guarda, en la columna B, datos sueltos para paneles: **B1** fecha del último envío, **B2** nº de ventas, **B3** nº de clientes, **B4** alerta de stock bajo, **B5** margen sugerido (%) y **B6** vida útil del huevo (días). Léelos de ahí, no del JSON de la columna A: con muchos datos el JSON se parte en trozos y la configuración queda fuera del primero.
- **Caja** es el libro de movimientos del efectivo (el más reciente primero): cada fila es un *Ingreso* o un *Egreso*, nunca los dos. Los saldos se calculan sumando; una anulación aparece como un movimiento contrario, no borra el original. **Cierres** guarda cada conteo del día con lo que debía haber y la diferencia.
- En **Ventas**, *Medio de cobro* dice si lo cobrado hoy fue en *Efectivo* o por *Transferencia* (vacío en una venta a crédito sin abono inicial). *Abonado en efectivo* y *Abonado por transferencia* separan lo abonado a una venta a crédito según el medio de **cada** abono (un abono anterior a esta función no tiene medio y cuenta como efectivo); la fila Cobrado de **Finanzas** suma contado más abonos por medio. En la app, el selector Efectivo / Transferencia solo se oculta si la caja está apagada y la venta es a crédito sin abono inicial: si se cobra algo se guarda el medio, aunque la caja esté apagada, porque alimenta el Sheet. «Pagó completo» con la caja apagada no pregunta y deja ese abono sin medio. En **Compras**, *Recibió* y *Documento proveedor* identifican quién recibió la mercancía y el número de remisión o factura.
- *Cantidad* siempre está en unidades; *Panales* solo se llena cuando la venta o la compra fue por panal.
- Para referenciar toda una columna usa rangos abiertos (por ejemplo `Ventas!F2:F`), porque el número de filas cambia en cada envío.

La plantilla se genera con `python plantilla/generar_plantilla.py` a partir de `apps-script/Code.gs`, así que siempre coincide con el script.

## Paneles del Sheet (`apps-script/Paneles.gs`)

[`apps-script/Paneles.gs`](../apps-script/Paneles.gs) arma los paneles con gráficos: **INICIO, FINANZAS, PANEL VENTAS, PANEL INVENTARIO, PANEL COMPRAS, PANEL PROVEEDORES, PANEL CLIENTES, PANEL PÉRDIDAS y REPORTES**, más una hoja de cálculos `_MOTOR_CALCULOS`. Los paneles se alimentan solos con cada envío de la app.

1. En Apps Script, crea un archivo nuevo llamado `Paneles.gs` (al lado de `Code.gs`) y pega su contenido.
2. Recarga el Sheet: aparece el menú **🐔 Gallinero → Reconstruir paneles**. Púlsalo (la primera vez pide permisos).
3. Cada vez que cambies el script de la app o agregues muchos productos nuevos, vuelve a pulsar **Reconstruir paneles**: los gráficos de productos se arman con los que haya en ese momento.

Cosas a saber:

- **Los paneles solo leen** las pestañas de datos (Inventario, Ventas, Compras, Proveedores, Clientes, Pérdidas); no las modifican, salvo el formato de la fila de encabezados.
- **Contrato:** leen las columnas por letra. El script de la app solo agrega columnas **al final**, así que lo que ya leían los paneles no se mueve. Una prueba automática (`tests/paneles.test.js`) verifica que `Code.gs` y `Paneles.gs` sigan de acuerdo.
- **Ganancia:** se calcula con la columna *Costo unitario* de Ventas (el costo en el momento de la venta), igual que en la app. Con un script anterior que no traiga esa columna, usa el costo promedio actual del inventario como respaldo.
- **Configuración:** el stock bajo, el margen y la vida útil se leen de `_respaldo!B4:B6`, que escribe `Code.gs`. Si el Sheet todavía tiene el script anterior, los paneles usan los valores por defecto (50, 25 % y 21 días) hasta que se actualice.
- **Cuentas por pagar:** **PANEL PROVEEDORES** muestra la deuda total, la deuda por proveedor (con enlace a WhatsApp) y las compras con saldo pendiente; INICIO y REPORTES también la incluyen.
- **Al actualizar el script de la app** (`Code.gs`): pega el contenido nuevo **conservando tu clave**, publica una **nueva versión** (Implementar → Administrar implementaciones → Editar → Nueva versión) y reconstruye los paneles. Si cambia la URL de la aplicación web, en el teléfono ve a **Más → Google Sheets → Desconectar** y conéctalo de nuevo con la URL nueva.
- **No compartas la URL ni la clave** (por ejemplo en un chat): juntas permiten leer y escribir todos los datos. Si se filtran, cambia la clave en `Code.gs` y publica una versión nueva.

## Empleados (opcional)

Si quieres que tu equipo entre con un PIN, el script guarda a los empleados en dos pestañas **ocultas**: `_empleados` (usuario, nombre, PIN con sal y hash, intentos, bloqueo) y `_sesiones` (tokens, solo como hash). No las edites a mano: se administran desde la app en **Más → Empleados**.

1. Actualiza `Code.gs` (conservando tu `CLAVE`) y publica una **nueva versión** de la misma implementación.
2. En la app: **Más → Empleados → + Nuevo empleado** (nombre, usuario y un PIN de 4 a 6 números, sin repetir el mismo ni escalera como 1234).
3. Activa **Pedir inicio de sesión** en el teléfono que compartirán. El empleado entra con su usuario y su PIN; tú entras con tu clave.
4. Si alguien olvida su PIN o su cuenta se bloquea (5 fallos seguidos, 15 minutos), cámbiale el PIN desde la misma pantalla.

En la pantalla del teléfono compartido, un empleado no ve ganancias ni deudas a proveedores y no puede anular, cerrar la caja, cambiar precios, borrar ni tocar los respaldos. Esos límites ordenan la pantalla; la barrera real es el script, que a un empleado le deja preguntar quién es, salir, leer y guardar (con comprobación de versión) pero no traer clientes ni administrar empleados. **Puede trabajar desde su propio teléfono** con la sincronización por turnos (ver abajo y el ADR 0003); ten en cuenta que ese teléfono guarda todos los datos del negocio, costos y ganancias incluidos, aunque su pantalla no los muestre. **Comparte el Sheet solo contigo**: los empleados no necesitan acceso al archivo.

## Varios teléfonos (por turnos)

Si el dueño y los empleados usan teléfonos distintos, el Sheet es el punto de encuentro:

- **Al abrir la app** (y al volver a ella tras unos minutos) el teléfono mira si alguien guardó en el Sheet; si aquí no hay cambios sin enviar, **carga los datos solo**.
- **Cada cambio se envía** a los pocos segundos, y **al cerrar la caja el envío es obligatorio**: si no llega, la app te lo dice con claridad y lo reintenta sola.
- **Nunca se pisa en silencio.** Cada envío lleva la versión del Sheet que el teléfono cargó; si otro guardó después, el envío se rechaza y la app pregunta qué datos conservar (*los del Sheet*, *los de este teléfono* o *decidir después*). Lo que no elijas no se borra del todo: el teléfono guarda una copia y el Sheet, la generación anterior.
- Para que esto funcione hay que **actualizar `Code.gs` y publicar una nueva versión** de la misma implementación. Con un script anterior la app sigue funcionando como siempre, sin esta protección.
- **Ojo:** el teléfono de cada empleado guarda todos los datos del negocio (también costos y ganancias, aunque su pantalla no los muestre). Dáselo solo a gente de confianza.

## Horas del equipo

El reloj de horas guarda los turnos en dos pestañas **ocultas** del Sheet, `_fichajes` (un turno por fila) y `_fichajes_log` (cada corrección, con lo que había antes y el motivo). No las edites a mano: se ven y se corrigen desde la app, en **Más → Horas del equipo**. Los turnos **no dependen del respaldo**: el envío del estado completo nunca los pisa.

1. Actualiza `Code.gs` (conservando tu `CLAVE`) y publica una **nueva versión** de la misma implementación.
2. El empleado entra con su PIN y, en su Inicio, pulsa **Entrar a trabajar**. La hora la pone el script, así que hace falta internet.
3. **La salida la marca el cierre de caja:** al cerrar, la app te dice a quién se le marca la salida y la marca. Si en ese momento no hay internet, queda anotada y se marca al volver la conexión, con la hora del cierre.
4. No se descuentan descansos. Un turno abierto más de 16 horas (olvidaste cerrar la caja) se cierra solo y aparece marcado para revisar.
5. Para un turno que se olvidó fichar, o una hora mal marcada, usa **Agregar un turno olvidado** o **Corregir**: siempre piden un motivo y queda el rastro.

Si un empleado se va antes del cierre, sus horas se cuentan hasta el cierre: corrige su salida con motivo. Esto no calcula recargos, horas extra ni nómina.
