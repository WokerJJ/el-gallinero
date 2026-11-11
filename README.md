# El Gallinero

Aplicación web instalable (PWA) para llevar el control de una distribuidora de huevos: inventario, compras a las fincas, ventas, clientes con deudas y reportes. Funciona sin internet y guarda los datos en el propio teléfono.

## Qué hace

- **Inicio:** ventas y ganancia del día, cuánto le deben, alertas de productos por vencer y existencias.
- **Vender:** ventas de contado o a crédito, con precio sugerido según el margen y abono inicial.
- **Comprar:** entradas de mercancía con costo promedio ponderado. El formulario se adapta al producto: huevos piden *días en la granja*, productos empacados piden *fecha de vencimiento*.
- **Clientes:** deuda por pedido, abonos (también a la deuda más vieja primero) y cobro por WhatsApp.
- **Productos:** existencias, precio fijo, pérdidas y una *lista de precios* lista para enviar por WhatsApp.
- **Facturas:** reportes por día, semana, mes o año; imprimir o exportar a Excel (CSV).
- **Google Sheets:** copia automática de los datos a una hoja de cálculo propia (con plantilla lista en `plantilla/`), restauración en un teléfono nuevo e importación de clientes desde la hoja, sin duplicados. Ver [docs/google-sheets.md](docs/google-sheets.md).
- **Respaldo:** copia de seguridad y restauración en JSON, con validación del archivo antes de reemplazar los datos.

## Decisiones de diseño

- **Sin servidor ni dependencias:** HTML, CSS y JavaScript puros. Los datos viven en `localStorage` bajo una sola clave (`eg_db`) que se escribe de una vez, para que un fallo a mitad de guardado no deje datos a medias.
- **Compatibilidad:** lee las claves `eg_*` de la versión anterior de un solo archivo y las migra.
- **Seguridad:** todo texto del usuario se escapa antes de pintarse y todo respaldo se valida registro por registro.
- **Offline:** el service worker responde desde el caché y se actualiza en segundo plano; la app avisa cuando hay una versión nueva.
- **Frescura:** cada producto declara su control (`granja`, `vencimiento` o `ninguno`); las alertas usan el lote que primero se vence.

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
