# Conectar El Gallinero con Google Sheets

La app guarda los datos en el teléfono y, si conectas un Google Sheet, **copia cada cambio ahí automáticamente**. Sirve para tres cosas:

- ver las ventas, compras y deudas como una hoja de cálculo, en el computador;
- no perder nada si se daña o se cambia el celular (se restaura desde el Sheet);
- tener una copia en tu propia cuenta de Google, sin servidores de terceros.

El teléfono sigue siendo la fuente de los datos: el Sheet es un espejo. Si se corta el internet, la app sigue funcionando y envía lo pendiente al volver la conexión. Como cada envío reemplaza el contenido de las pestañas, **no se duplican filas**.

## Montaje (5 minutos, una sola vez)

1. Crea un Google Sheet nuevo y llámalo «El Gallinero».
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
