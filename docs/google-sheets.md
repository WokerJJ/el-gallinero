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
- Pestañas que verás: **Inventario, Ventas, Compras, Clientes, Pérdidas**. Las pestañas `_respaldo` y `_respaldo_anterior` están ocultas y guardan la copia completa; no las borres.
- **No edites las pestañas legibles a mano:** se reescriben en cada envío. Los cambios se hacen en la app.
- Es una copia de un solo sentido (teléfono → Sheet). Si usas **dos teléfonos a la vez**, el último que envíe gana: para eso habría que construir una sincronización bidireccional.
- **Restaurar:** en un teléfono nuevo, conecta el mismo enlace y la app ofrece traer los datos del Sheet.

## Cargar los clientes desde WhatsApp

WhatsApp no deja exportar la lista de clientes: los clientes son los **contactos guardados en el teléfono**. La ruta es sacarlos de la agenda y pegarlos en la plantilla:

1. **Contactos a un archivo.** En Android (o un iPhone con los contactos en Google): [contacts.google.com](https://contacts.google.com) → seleccionar → *Exportar* → *CSV de Google*. En un iPhone sin Google: [icloud.com](https://www.icloud.com) → Contactos → seleccionar todos → *Exportar vCard*, súbelo en contacts.google.com (*Importar*) y expórtalo como CSV.
2. Abre el CSV en Hojas de cálculo y copia **nombre** y **teléfono** a la pestaña **Importar clientes** de la plantilla (columnas A y B, desde la fila 2). Las notas o la dirección van en la C, si las hay.
3. En la app: **Más → Google Sheets → Traer clientes del Sheet** (o el mismo botón en **Clientes**). La app muestra cuántos agregará y pide confirmar.

Si algún cliente solo aparece en WhatsApp con su número (sin guardar como contacto), guárdalo primero en la agenda con un nombre.

**No se duplican.** Un cliente es el mismo si coincide el teléfono (se ignoran espacios, guiones y el +57) o, si no hay teléfono, el nombre sin tildes ni mayúsculas. Dos personas con el mismo nombre pero teléfonos distintos son dos clientes. Nunca se borra ni se pisa un dato que ya está en la app: solo se completan teléfono o notas que faltaban. Puedes volver a pegar la lista completa cuando quieras.

## Para agregarle un panel o interfaz gráfica

El script solo reescribe el bloque de la tabla (las columnas de cada pestaña, desde la fila 2). Todo lo demás es tuyo:

- Puedes agregar **columnas a la derecha**, **otras pestañas**, fórmulas, tablas dinámicas y gráficos que lean esas pestañas: no se tocan.
- **Contrato de columnas** (no cambies el nombre de las pestañas ni el orden):

| Pestaña | Columnas |
| --- | --- |
| Inventario | Producto · Unidad · Existencias · Costo promedio · Precio de venta · Control de frescura |
| Ventas | Fecha · Producto · Cantidad · Panales · Precio · Total · Cliente · Pago · Abonado · Debe |
| Compras | Fecha · Producto · Cantidad · Costo unitario · Total · Vence · Días en granja · Notas |
| Clientes | Cliente · Teléfono · Deuda · Notas |
| Pérdidas | Fecha · Producto · Cantidad · Costo unitario · Motivo |
| Importar clientes (se llena a mano) | Nombre · Teléfono · Notas / dirección |

- *Cantidad* siempre está en unidades; *Panales* solo se llena cuando la venta fue por panal.
- Para referenciar toda una columna usa rangos abiertos (por ejemplo `Ventas!F2:F`), porque el número de filas cambia en cada envío.

La plantilla se genera con `python plantilla/generar_plantilla.py` a partir de `apps-script/Code.gs`, así que siempre coincide con el script.
