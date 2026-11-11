/**
 * El Gallinero · copia en Google Sheets
 *
 * Pega este script en el Google Sheet (Extensiones → Apps Script) y publícalo como «Aplicación web».
 * La app del teléfono le envía los datos; el script:
 *   1. los guarda completos en la pestaña oculta «_respaldo» (para restaurar si cambias de celular), y
 *   2. arma pestañas legibles: Inventario, Ventas, Compras, Clientes y Pérdidas.
 * Cada envío REEMPLAZA el contenido de las pestañas: no se duplican filas aunque se envíe muchas veces.
 *
 * Solo se reescribe el bloque de la tabla (las columnas de cada pestaña). Lo que agregues a la derecha, o en otras
 * pestañas (fórmulas, gráficos, un panel), no se toca. No cambies el nombre de las pestañas ni el orden de las columnas.
 *
 * Además, la pestaña «Importar clientes» es de entrada: tú la llenas y la app la lee (acción «clientes»).
 * Úsala con la plantilla de Excel del proyecto (carpeta plantilla/).
 */

// Escribe aquí una clave tuya (la misma que pondrás en la app). Funciona como contraseña del enlace.
const CLAVE = 'CAMBIA-ESTA-CLAVE';

const TROZO = 40000; // una celda admite 50.000 caracteres; se parte el respaldo en trozos

function doGet() {
  return salida_({ ok: true, app: 'el-gallinero', mensaje: 'El script está publicado. Copia este enlace en la app (Más → Google Sheets).' });
}

function doPost(e) {
  let p;
  try { p = JSON.parse(e.postData.contents); } catch (err) { return salida_({ ok: false, error: 'Solicitud inválida' }); }
  if (CLAVE === 'CAMBIA-ESTA-CLAVE') return salida_({ ok: false, error: 'Falta cambiar la CLAVE dentro del script' });
  if (!p || p.clave !== CLAVE) return salida_({ ok: false, error: 'Clave incorrecta' });

  const cerrojo = LockService.getScriptLock();
  if (!cerrojo.tryLock(20000)) return salida_({ ok: false, error: 'El Sheet está ocupado, intenta de nuevo' });
  try {
    if (p.accion === 'ping') return salida_(estado_());
    if (p.accion === 'guardar') return salida_(guardar_(p.datos));
    if (p.accion === 'leer') return salida_(leer_());
    if (p.accion === 'clientes') return salida_(clientesImportar_());
    return salida_({ ok: false, error: 'Acción desconocida' });
  } catch (err) {
    return salida_({ ok: false, error: String((err && err.message) || err) });
  } finally {
    cerrojo.releaseLock();
  }
}

function salida_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function libro_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function hoja_(nombre) {
  const libro = libro_();
  return libro.getSheetByName(nombre) || libro.insertSheet(nombre);
}

// Un texto que empieza por = + - @ se interpretaría como fórmula: se neutraliza.
function seguro_(v) {
  return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v;
}

function escribirHoja_(nombre, cabecera, filas) {
  const h = hoja_(nombre);
  // Solo se limpia el bloque de datos (filas de datos, columnas de la tabla): lo demás queda como está.
  const ultima = Math.max(h.getLastRow(), 2);
  h.getRange(2, 1, ultima - 1, cabecera.length).clearContent();
  const valores = filas.map(function (f) { return f.map(seguro_); });
  if (h.getMaxRows() < valores.length + 1) h.insertRowsAfter(h.getMaxRows(), valores.length + 1 - h.getMaxRows());
  if (h.getMaxColumns() < cabecera.length) h.insertColumnsAfter(h.getMaxColumns(), cabecera.length - h.getMaxColumns());
  h.getRange(1, 1, 1, cabecera.length).setValues([cabecera]).setFontWeight('bold');
  if (valores.length) h.getRange(2, 1, valores.length, cabecera.length).setValues(valores);
  h.setFrozenRows(1);
}

// Lee la pestaña «Importar clientes» (Nombre, Teléfono, Notas) tal como se ve en pantalla.
function clientesImportar_() {
  const h = libro_().getSheetByName('Importar clientes');
  if (!h) return { ok: false, error: 'Falta la pestaña «Importar clientes». Usa la plantilla de Excel del proyecto.' };
  const ultima = h.getLastRow();
  if (ultima < 2) return { ok: true, filas: [] };
  const filas = h.getRange(2, 1, Math.min(ultima - 1, 5000), 3).getDisplayValues()
    .filter(function (f) { return String(f[0]).trim() !== ''; });
  return { ok: true, filas: filas };
}

function leerTexto_(nombre) {
  const h = libro_().getSheetByName(nombre);
  if (!h || h.getLastRow() < 1) return '';
  return h.getRange(1, 1, h.getLastRow(), 1).getValues().map(function (r) { return r[0]; }).join('');
}

function escribirTexto_(nombre, texto, meta) {
  const h = hoja_(nombre);
  h.clearContents();
  const trozos = [];
  for (let i = 0; i < texto.length; i += TROZO) trozos.push([texto.substring(i, i + TROZO)]);
  if (trozos.length) h.getRange(1, 1, trozos.length, 1).setValues(trozos);
  if (meta) h.getRange(1, 2, meta.length, 1).setValues(meta.map(function (m) { return [m]; }));
  h.hideSheet();
}

function estado_() {
  const h = libro_().getSheetByName('_respaldo');
  if (!h || h.getLastRow() < 1) return { ok: true, tieneDatos: false };
  const meta = h.getRange(1, 2, 3, 1).getValues().map(function (r) { return r[0]; });
  return { ok: true, tieneDatos: true, actualizado: meta[0], ventas: Number(meta[1]) || 0, clientes: Number(meta[2]) || 0 };
}

function leer_() {
  const texto = leerTexto_('_respaldo');
  if (!texto) return { ok: false, error: 'El Sheet todavía no tiene datos guardados' };
  return { ok: true, texto: texto };
}

function guardar_(d) {
  if (!d || d.app !== 'el-gallinero' || !Array.isArray(d.products) || !Array.isArray(d.ventas) || !Array.isArray(d.entradas) || !Array.isArray(d.clientes)) {
    return { ok: false, error: 'Datos inválidos' };
  }
  const texto = JSON.stringify(d);
  if (texto.length > 4000000) return { ok: false, error: 'Hay demasiados datos para este método' };

  // Una generación anterior de seguridad, por si un envío sale mal.
  const previo = leerTexto_('_respaldo');
  if (previo) escribirTexto_('_respaldo_anterior', previo, null);

  const ahora = new Date().toISOString();
  escribirTexto_('_respaldo', texto, [ahora, d.ventas.length, d.clientes.length]);

  const prod = {}; d.products.forEach(function (p) { prod[p.id] = p; });
  const cli = {}; d.clientes.forEach(function (c) { cli[c.id] = c; });
  const nombreProd = function (id) { return prod[id] ? prod[id].name : '(eliminado)'; };
  const porFechaDesc = function (a, b) { return String(b.fecha).localeCompare(String(a.fecha)); };

  escribirHoja_('Inventario', ['Producto', 'Unidad', 'Existencias', 'Costo promedio', 'Precio de venta', 'Control de frescura'],
    d.products.map(function (p) { return [p.name, p.unit, p.stock, p.cost, p.price || '', p.control || '']; }));

  escribirHoja_('Ventas', ['Fecha', 'Producto', 'Cantidad', 'Panales', 'Precio', 'Total', 'Cliente', 'Pago', 'Abonado', 'Debe'],
    d.ventas.slice().sort(porFechaDesc).map(function (v) {
      const debe = v.tipoPago === 'credito' ? Math.max(0, v.total - (v.pagado || 0)) : 0;
      return [v.fecha, nombreProd(v.productoId), v.cantidad, v.panales || '', v.precio, v.total, v.clienteId && cli[v.clienteId] ? cli[v.clienteId].nombre : '', v.tipoPago === 'credito' ? 'Crédito' : 'Contado', v.pagado || 0, debe];
    }));

  escribirHoja_('Compras', ['Fecha', 'Producto', 'Cantidad', 'Costo unitario', 'Total', 'Vence', 'Días en granja', 'Notas'],
    d.entradas.slice().sort(porFechaDesc).map(function (e) {
      return [e.fecha, nombreProd(e.productoId), e.cantidad, e.costoUnitario, e.total, e.vence || '', e.diasGranja || '', e.notas || ''];
    }));

  escribirHoja_('Clientes', ['Cliente', 'Teléfono', 'Deuda', 'Notas'],
    d.clientes.map(function (c) {
      const deuda = d.ventas.reduce(function (s, v) {
        return s + (v.clienteId === c.id && v.tipoPago === 'credito' ? Math.max(0, v.total - (v.pagado || 0)) : 0);
      }, 0);
      return [c.nombre, c.telefono || '', deuda, c.notas || ''];
    }));

  escribirHoja_('Pérdidas', ['Fecha', 'Producto', 'Cantidad', 'Costo unitario', 'Motivo'],
    (d.ajustes || []).slice().sort(porFechaDesc).map(function (a) {
      return [a.fecha, nombreProd(a.productoId), a.cantidad, a.costoUnitario || 0, a.motivo || ''];
    }));

  return { ok: true, actualizado: ahora, ventas: d.ventas.length, clientes: d.clientes.length };
}
