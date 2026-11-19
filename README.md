# El Gallinero

Aplicación web instalable (PWA) para llevar el control de una distribuidora de huevos: inventario, compras a las fincas, ventas, clientes con deudas y reportes. Funciona sin internet y guarda los datos en el propio teléfono.

## Qué hace

- **Inicio:** ventas y ganancia del día, cuánto le deben, alertas de productos por vencer y existencias.
- **Vender:** ventas de contado o a crédito, con precio sugerido según el margen y abono inicial.
- **Comprar:** entradas de mercancía con costo promedio ponderado. El formulario se adapta al producto: huevos piden *días en la granja*, productos empacados piden *fecha de vencimiento*.
- **Caja:** libro del efectivo del negocio. Las ventas y abonos cobrados en efectivo entran solos; las compras y pagos a las fincas pueden salir de la caja; hay gastos e ingresos manuales y cierre del día contando el dinero (con sobrante o faltante). Las ventas se cobran en efectivo o por transferencia.
- **Recepción de mercancía:** cada compra guarda quién la recibió y el número de remisión o factura del proveedor.
- **Reloj de horas:** el empleado ficha su entrada desde su teléfono (la hora la pone el servidor) y la salida se marca sola cuando el dueño cierra la caja (**requiere activar la Caja**: sin ella los turnos se cierran solos a las 16 h y hay que corregirlos); sin descansos, en minutos exactos y en hora de Colombia. El dueño ve las horas por persona en Más → Horas del equipo y puede corregir o agregar turnos con motivo. Ver `docs/adr/0005-reloj-de-horas-con-salida-al-cerrar-la-caja.md`.
- **Varios teléfonos:** la app carga el Sheet al abrirse, envía tras cada cambio y de forma obligatoria al cerrar la caja, y nunca pisa en silencio lo que otro guardó (comprueba la versión y pregunta). Ver `docs/adr/0003-sincronizacion-por-turnos-con-version.md`.
- **Empleados (opcional):** el dueño crea empleados con usuario y PIN desde Más → Empleados; en un teléfono compartido cada uno entra con su PIN, y la pantalla le deja hacer lo suyo (vender, recibir mercancía, cobrar, pagar desde la caja) y registra su nombre. Los límites por rol ordenan la pantalla; la barrera real es el script (el empleado puede preguntar quién es, salir, leer y guardar con comprobación de versión; no puede traer clientes ni administrar empleados). También puede trabajar desde su propio teléfono con la sincronización por turnos (`docs/adr/0003-sincronizacion-por-turnos-con-version.md`); riesgo: su teléfono guarda todos los datos del negocio. Ver `docs/adr/0002-empleados-login-y-sincronizacion-central.md`.
- **Clientes:** deuda por pedido, abonos (también a la deuda más vieja primero) y cobro por WhatsApp.
- **Productos:** existencias, precio fijo, pérdidas y una *lista de precios* lista para enviar por WhatsApp.
- **Facturas:** reportes por día, semana, mes o año; imprimir o exportar a Excel (CSV).
- **Google Sheets:** copia automática de los datos a una hoja de cálculo propia (con plantilla lista en `plantilla/`), restauración en un teléfono nuevo e importación de clientes desde la hoja, sin duplicados. Incluye un script de **paneles con gráficos** (`apps-script/Paneles.gs`) para el Sheet. Ver [docs/google-sheets.md](docs/google-sheets.md).
- **Respaldo:** copia de seguridad y restauración en JSON, con validación del archivo antes de reemplazar los datos.

## Decisiones de diseño

- **Sin servidor ni dependencias:** HTML, CSS y JavaScript puros. Los datos viven en `localStorage` bajo una sola clave (`eg_db`) que se escribe de una vez, para que un fallo a mitad de guardado no deje datos a medias.
- **Compatibilidad:** lee las claves `eg_*` de la versión anterior de un solo archivo y las migra.
- **Seguridad:** todo texto del usuario se escapa antes de pintarse y todo respaldo se valida registro por registro.
- **Offline:** el service worker responde desde el caché y se actualiza en segundo plano; la app avisa cuando hay una versión nueva.
- **Frescura:** cada producto declara su control (`granja`, `vencimiento` o `ninguno`); las alertas usan el lote que primero se vence.
- **Caja:** libro de movimientos que solo se agrega (las anulaciones son contra-asientos), de un solo dispositivo por ahora. El porqué y sus límites están en [docs/adr/0001-caja-libro-de-movimientos.md](docs/adr/0001-caja-libro-de-movimientos.md).

## Probarla en local

```bash
python -m http.server 8777
```

Abre `http://127.0.0.1:8777/`. El service worker solo funciona sobre `http://localhost` o `https`.

## Pruebas

```bash
node --test tests/*.test.js
```

Un arnés propio carga `js/app.js` en `node:vm` con un DOM simulado, sin dependencias.

## Instalar en el celular

- **iPhone:** abrir la dirección en Safari → Compartir → *Agregar a pantalla de inicio*.
- **Android:** en Chrome, menú ⋮ → *Instalar aplicación*.

## Créditos

Tipografía [Alfa Slab One](https://fonts.google.com/specimen/Alfa+Slab+One) (SIL Open Font License). El logo pertenece al negocio El Gallinero.
