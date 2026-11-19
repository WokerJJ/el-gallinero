# ADR 0004 · Infraestructura: Google Sheets hoy, y cuándo y cómo migrar

- Estado: aceptada. **Decisión actual: seguir con Google Sheets.** La migración queda propuesta, sin fecha, para cuando el proyecto tenga ingresos que la respalden.
- Fecha: 2026-11-19

## Contexto

La app guarda todo en el teléfono (`localStorage`) y usa un **Google Sheet con Apps Script como base de datos compartida**: un respaldo completo en una pestaña oculta y pestañas legibles que se reescriben en cada envío. Con las entregas de caja, empleados y sincronización por turnos (ADR 0001 a 0003) se vio que ese diseño **se queda corto**, aunque hoy funciona y **no tiene costo de operación**, que es un requisito del proyecto.

Dónde se queda corto:

- **Seguridad.** No hay permisos reales por usuario. Los roles se hacen cumplir en el script, pero el empleado necesita `leer` y `guardar` el estado completo, así que **su teléfono guarda todos los datos del negocio** (costos y ganancias incluidos) aunque su pantalla no se los muestre. Una clave compartida protege al dueño.
- **Sincronización.** Se envía el estado completo en cada cambio. La comprobación de versión (ADR 0003) evita pisar datos, pero es un parche sobre la falta de una base de datos con transacciones: el costo de un conflicto es elegir un lado entero.
- **Techo de tamaño.** `Code.gs` rechaza más de 4 MB por envío y el `localStorage` del navegador tiene su propio límite.
- **Un solo cerrojo** para todo el script, sin datos en vivo entre teléfonos, y cada envío reescribe todas las pestañas.

## Decisión

1. **Se sigue con Sheets por ahora.** Es gratis, ya funciona, está probado contra el Sheet real (ADR 0003 y su prueba de campo) y el negocio es pequeño y de confianza.
2. **Se deja anotado el camino de migración** para no rehacer este análisis cuando se retome. Los criterios para migrar están más abajo.
3. **Mientras tanto**, lo que sí se hace sin costo: mantener las pruebas y la documentación al día, cambiar la clave por una larga y aleatoria, y arreglar los ceros a la izquierda de los comprobantes en las pestañas espejo.

## Opciones sin costo mensual

Los límites son de **fuentes de terceros** (blogs y comparativas de 2026), no de las páginas oficiales: confírmalos antes de decidir.

| Opción | Límites gratuitos | Ventajas | Riesgos |
|---|---|---|---|
| **Supabase** (Postgres) | 500 MB por proyecto; 2 proyectos; se **pausa tras una semana sin actividad** y se reactiva a mano ([fuente](https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/)) | SQL real, permisos por fila (RLS), autenticación, datos en vivo; encaja con Postgres y Prisma | La pausa; la autenticación estándar pide contraseñas de al menos 6 caracteres, así que los PIN de 4 dígitos no encajan tal cual |
| **Firebase** (plan Spark) | 1 GiB; 50 mil lecturas y 20 mil escrituras al día; no cobra: al pasarse deja de responder hasta el reinicio ([fuente](https://www.activepieces.com/blog/firebase-pricing-2026-plans-costs-and-free-limits.md)) | Trabajo sin conexión y sincronización integrados; reglas de seguridad por rol | NoSQL (menos natural para ventas, compras y caja); dependencia fuerte del proveedor |
| **Cloudflare Workers + D1** (SQLite) | 5 GB; 5 millones de lecturas y 100 mil escrituras al día; desde el 1 de septiembre de 2026 las consultas fallan al pasarse ([fuente](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/)) | Sin pausa por inactividad; SQL | Hay que escribir toda la API y la autenticación |

## Recomendación al migrar: Supabase

- Es relacional, que es la forma natural de este dominio (ventas, compras, movimientos de caja, empleados), y ya se maneja Postgres.
- Los **permisos por fila** harían cumplir en el servidor lo que hoy solo ordena la pantalla: el empleado solo vería y escribiría lo suyo, y **su teléfono dejaría de guardar todo el negocio**.
- La sincronización pasaría a ser **incremental** (solo lo nuevo), sin comparar versiones del estado completo.
- Mitigación de la pausa: una tarea programada gratuita (por ejemplo en GitHub Actions) que consulte la base cada pocos días. Hay que conocer que existe y aceptarla como riesgo.
- Si el equipo prefiere lo más simple para trabajar sin conexión, Firebase es la alternativa; se pierde lo relacional.

## Cómo se haría, sin perder lo hecho

La app **sigue guardando en el teléfono** (funciona sin internet). El Sheet pasa a ser **respaldo y reporte**, no la fuente de verdad, así que el negocio no pierde su hoja ni sus paneles. Entregas propuestas:

1. Esquema, autenticación y permisos por fila, con pruebas de las reglas.
2. Envío incremental de ventas, compras, movimientos y cierres, con identificadores únicos; el inventario y la caja se calculan a partir de ellos.
3. Empleados y PIN sobre la nueva autenticación (probablemente PIN de 6 dígitos).
4. Migración de los datos del Sheet y corte; el Sheet queda como exportación.
5. Entonces sí: reloj de horas y horarios, que con una base real son sencillos.

## Cuándo migrar (criterios)

Se retoma si ocurre cualquiera de estos casos: hay ingresos que justifiquen el trabajo; el equipo crece más allá de gente de plena confianza; el volumen se acerca a los 4 MB del envío; o se necesitan datos en vivo entre teléfonos.

## Consecuencias

- El riesgo de que el teléfono del empleado tenga todos los datos **sigue aceptado** mientras se use Sheets (ADR 0003).
- Con Sheets no hay costo de operación; con cualquiera de las opciones gratuitas tampoco, pero cada una trae una condición (pausa, cuota diaria) que hay que vigilar.
- Los ADR 0001 a 0003 siguen vigentes mientras no se migre. El 0002 y el 0003 quedarían parcialmente sustituidos por la entrega 3 de la migración.
