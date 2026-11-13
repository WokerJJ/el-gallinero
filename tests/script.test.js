'use strict';
/* Pruebas de apps-script/Code.gs: se carga en node:vm con SpreadsheetApp, ContentService y LockService falsos.
   La hoja falsa imita los límites reales de Google Sheets (un rango fuera de la hoja o de 0 filas lanza error)
   y registra cada rango que se toca, para comprobar que el script no sale del bloque de la tabla. */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const CODIGO = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');

class HojaFalsa {
  constructor(nombre, { filas = 1000, columnas = 26, celdas = {} } = {}) {
    this.nombre = nombre; this.maxFilas = filas; this.maxColumnas = columnas;
    this.celdas = new Map(Object.entries(celdas)); // 'fila,columna' -> valor
    this.toques = []; this.insertadas = { filas: 0, columnas: 0 }; this.oculta = false; this.congeladas = 0;
  }
  getLastRow() { let m = 0; for (const [k, v] of this.celdas) if (v !== '' && v != null) m = Math.max(m, Number(k.split(',')[0])); return m; }
  getMaxRows() { return this.maxFilas; }
  getMaxColumns() { return this.maxColumnas; }
  insertRowsAfter(_, n) { this.maxFilas += n; this.insertadas.filas += n; }
  insertColumnsAfter(_, n) { this.maxColumnas += n; this.insertadas.columnas += n; }
  setFrozenRows(n) { this.congeladas = n; }
  hideSheet() { this.oculta = true; }
  clearContents() { this.celdas.clear(); }
  getRange(f, c, nf = 1, nc = 1) {
    if (nf < 1 || nc < 1) throw new Error('El número de filas y de columnas debe ser al menos 1');
    if (f + nf - 1 > this.maxFilas || c + nc - 1 > this.maxColumnas) throw new Error('El rango está fuera de los límites de la hoja');
    const h = this, rango = { f, c, nf, nc };
    const recorrer = fn => { for (let i = 0; i < nf; i++) for (let j = 0; j < nc; j++) fn(f + i, c + j, i, j); };
    return {
      clearContent() { h.toques.push({ op: 'limpiar', ...rango }); recorrer((r, k) => h.celdas.delete(`${r},${k}`)); return this; },
      setValues(v) { h.toques.push({ op: 'escribir', ...rango }); recorrer((r, k, i, j) => h.celdas.set(`${r},${k}`, v[i][j])); return this; },
      setFontWeight() { h.toques.push({ op: 'formato', ...rango }); return this; },
      getValues() { const o = []; recorrer((r, k, i, j) => { (o[i] ||= [])[j] = h.celdas.get(`${r},${k}`) ?? ''; }); return o; },
      getDisplayValues() { return this.getValues().map(fila => fila.map(String)); },
    };
  }
  celda(f, c) { return this.celdas.get(`${f},${c}`); }
}

function cargarScript({ clave = 'k-secreta', hojas = [], max = null } = {}) {
  const libro = new Map(hojas.map(h => [h.nombre, h]));
  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({
      getSheetByName: n => libro.get(n) || null,
      insertSheet: n => { const h = new HojaFalsa(n); libro.set(n, h); return h; },
    }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ texto: t, setMimeType() { return this; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Date, JSON, Math, String, Number, Array, Object,
  };
  const ctx = vm.createContext(sandbox);
  let codigo = clave === null ? CODIGO : CODIGO.replace("'CAMBIA-ESTA-CLAVE';", `'${clave}';`);
  if (max !== null) codigo = codigo.replace(/MAX_CLIENTES = \d+;/, `MAX_CLIENTES = ${max};`);
  vm.runInContext(codigo, ctx, { filename: 'Code.gs' });
  return { libro, ctx, run: c => vm.runInContext(c, ctx) };
}

const post = (s, cuerpo) => JSON.parse(s.run('doPost')({ postData: { contents: JSON.stringify(cuerpo) } }).texto);
const plano = v => JSON.parse(JSON.stringify(v));
const escribir = (s, nombre, cab, filas) => s.run('escribirHoja_')(nombre, cab, filas);

test('script · escribirHoja_ no toca las columnas a la derecha de la tabla', () => {
  const h = new HojaFalsa('Clientes', { celdas: { '1,5': 'Mi fórmula', '2,5': '=SUM(A2:A)', '9,6': 'panel' } });
  const s = cargarScript({ hojas: [h] });
  escribir(s, 'Clientes', ['Cliente', 'Teléfono'], [['Ana', '1'], ['Luis', '2']]);
  assert.ok(h.toques.length > 0);
  for (const t of h.toques) assert.ok(t.c + t.nc - 1 <= 2, `tocó la columna ${t.c + t.nc - 1}: ${JSON.stringify(t)}`);
  assert.equal(h.celda(1, 5), 'Mi fórmula');
  assert.equal(h.celda(2, 5), '=SUM(A2:A)');
  assert.equal(h.celda(9, 6), 'panel');
  assert.equal(h.celda(2, 1), 'Ana');
});

test('script · cero filas no falla, ni siquiera en una pestaña de una sola fila', () => {
  const h = new HojaFalsa('Pérdidas', { filas: 1 });
  const s = cargarScript({ hojas: [h] });
  assert.doesNotThrow(() => escribir(s, 'Pérdidas', ['Fecha', 'Producto'], []));
  assert.deepEqual(h.getRange(1, 1, 1, 2).getValues(), [['Fecha', 'Producto']]);
  assert.equal(h.congeladas, 1);
});

test('script · con más filas que las que tiene la pestaña, la amplía y escribe todo', () => {
  const h = new HojaFalsa('Ventas', { filas: 3, columnas: 1 });
  const s = cargarScript({ hojas: [h] });
  const filas = Array.from({ length: 50 }, (_, i) => [`v${i}`, i]);
  escribir(s, 'Ventas', ['A', 'B'], filas);
  assert.ok(h.maxFilas >= 51);
  assert.ok(h.maxColumnas >= 2);
  assert.equal(h.celda(51, 1), 'v49');
});

test('script · si la tabla se encoge no quedan filas viejas, hasta el final de la pestaña', () => {
  const h = new HojaFalsa('Compras', { filas: 100 });
  const s = cargarScript({ hojas: [h] });
  escribir(s, 'Compras', ['A', 'B'], Array.from({ length: 80 }, (_, i) => [`x${i}`, i]));
  escribir(s, 'Compras', ['A', 'B'], [['solo', 1]]);
  assert.equal(h.getLastRow(), 2);
  assert.equal(h.celda(2, 1), 'solo');
  assert.equal(h.celda(60, 1), undefined);
});

test('script · un texto que parece fórmula se escribe neutralizado', () => {
  const h = new HojaFalsa('Clientes');
  const s = cargarScript({ hojas: [h] });
  escribir(s, 'Clientes', ['Cliente'], [['=HYPERLINK("x")'], ['+57']]);
  assert.equal(h.celda(2, 1), "'=HYPERLINK(\"x\")");
  assert.equal(h.celda(3, 1), "'+57");
});

test('script · «Importar clientes» devuelve solo las filas con nombre, tal como se ven', () => {
  const h = new HojaFalsa('Importar clientes', { celdas: {
    '1,1': 'Nombre', '2,1': 'Ana', '2,2': '300', '2,3': 'Plaza', '3,1': '', '3,2': '999', '4,1': '  ', '5,1': 'Luis',
  } });
  const s = cargarScript({ hojas: [h] });
  const r = s.run('clientesImportar_')();
  assert.equal(r.ok, true);
  assert.deepEqual(r.filas.map(f => f[0]), ['Ana', 'Luis']);
  assert.equal(r.filas[0].length, 3);
  assert.equal(r.truncado, false);
});

test('script · el tope se aplica después de descartar las filas vacías y avisa si truncó', () => {
  const celdas = { '1,1': 'Nombre' };
  for (let i = 0; i < 20; i++) celdas[`${2 + i * 2},1`] = `Cliente ${i}`; // una fila con nombre y una vacía, alternadas
  const h = new HojaFalsa('Importar clientes', { filas: 1000, celdas });
  const s = cargarScript({ hojas: [h] });
  const max = s.run('MAX_CLIENTES');
  assert.ok(max >= 1000);
  assert.equal(s.run('clientesImportar_')().filas.length, 20, 'las filas vacías intermedias no gastan el tope');
  const r = plano(cargarScript({ hojas: [h], max: 5 }).run('clientesImportar_')());
  assert.equal(r.filas.length, 5);
  assert.equal(r.truncado, true);
  assert.equal(r.max, 5);
});

test('script · sin la pestaña «Importar clientes» la crea con su cabecera en vez de fallar', () => {
  const s = cargarScript();
  const r = plano(s.run('clientesImportar_')());
  assert.equal(r.ok, true);
  assert.deepEqual(r.filas, []);
  const h = s.libro.get('Importar clientes');
  assert.ok(h, 'la pestaña se creó');
  assert.deepEqual(plano(h.getRange(1, 1, 1, 3).getValues()), [['Nombre', 'Teléfono', 'Notas / dirección']]);
});

test('script · doPost rechaza una clave incorrecta y la clave por defecto', () => {
  const s = cargarScript({ clave: 'k-secreta' });
  assert.deepEqual(post(s, { clave: 'otra', accion: 'ping' }), { ok: false, error: 'Clave incorrecta' });
  assert.deepEqual(post(s, { accion: 'ping' }), { ok: false, error: 'Clave incorrecta' });
  assert.equal(post(s, { clave: 'k-secreta', accion: 'ping' }).ok, true);
  const d = cargarScript({ clave: null });
  const r = post(d, { clave: 'CAMBIA-ESTA-CLAVE', accion: 'ping' });
  assert.equal(r.ok, false);
  assert.match(r.error, /cambiar la CLAVE/);
});

test('script · una acción desconocida responde «Acción desconocida» (la app lo usa para avisar de un script viejo)', () => {
  const s = cargarScript({ clave: 'k' });
  assert.deepEqual(post(s, { clave: 'k', accion: 'inexistente' }), { ok: false, error: 'Acción desconocida' });
});

/* ---------- guardar_: el contenido de cada pestaña (EVA-007) ---------- */
const prodS = { id: 'campo', name: 'Huevo de Campo', unit: 'unidades', cost: 400, price: 600, stock: 10, control: 'granja' };
const datosS = (o = {}) => ({
  app: 'el-gallinero', products: [prodS], clientes: [{ id: 'c1', nombre: 'Tienda Doña Rosa', telefono: '300', notas: 'Plaza', documento: '900123456' }],
  proveedores: [{ id: 'f1', nombre: 'Finca Nueva', telefono: '311', notas: 'Antes: La Esperanza' }], ajustes: [],
  ventas: [
    { id: 1, productoId: 'campo', cantidad: 100, precio: 600, total: 60000, fecha: '2026-11-12', clienteId: 'c1', tipoPago: 'credito', pagado: 20000, numero: 12 },
    { id: 2, productoId: 'campo', cantidad: 10, precio: 600, total: 6000, fecha: '2026-11-11', clienteId: null, tipoPago: 'contado', pagado: 6000 },
  ],
  entradas: [
    { id: 3, productoId: 'campo', cantidad: 300, costoUnitario: 400, total: 1000, fecha: '2026-11-05', proveedorId: 'f1' }, // compra antigua: sin «pagado»
    { id: 4, productoId: 'campo', cantidad: 300, costoUnitario: 400, total: 5000, fecha: '2026-11-06', proveedorId: 'f1', pagado: 2000 },
  ],
  config: { negocio: { prefijo: 'CV' } },
  ...o,
});
const guardarS = (datos = datosS()) => { const s = cargarScript({ clave: 'k' }); const r = plano(s.run('guardar_')(datos)); return { s, r, hoja: n => s.libro.get(n) }; };

test('script · guardar_ escribe Ventas con el número de comprobante con prefijo', () => {
  const { r, hoja } = guardarS();
  assert.equal(r.ok, true);
  const v = hoja('Ventas');
  assert.deepEqual(plano(v.getRange(1, 1, 1, 11).getValues())[0].slice(-1), ['Comprobante']);
  assert.equal(v.celda(2, 11), 'CV-000012');
  assert.equal(v.celda(2, 7), 'Tienda Doña Rosa');
  assert.equal(v.celda(2, 9), 20000);
  assert.equal(v.celda(2, 10), 40000, 'Debe = total - abonado');
  assert.equal(v.celda(3, 11), '', 'una venta sin número no lleva comprobante');
  assert.equal(v.celda(3, 10), 0);
});
test('script · con el prefijo vacío el comprobante es solo el número con ceros', () => {
  const { hoja } = guardarS(datosS({ config: { negocio: { prefijo: '' } } }));
  assert.equal(hoja('Ventas').celda(2, 11), '000012');
  const sin = guardarS(datosS({ config: {} }));
  assert.equal(sin.hoja('Ventas').celda(2, 11), '000012', 'sin datos del negocio tampoco falla');
});
test('script · una compra antigua sin «pagado» sale pagada por completo y sin deuda', () => {
  const c = guardarS().hoja('Compras');
  assert.equal(c.celda(3, 1), '2026-11-05');
  assert.equal(c.celda(3, 11), 1000, 'Pagado = Total');
  assert.equal(c.celda(3, 12), 0, 'Debe = 0');
});
test('script · una compra con proveedor y deuda muestra lo pagado y lo que falta', () => {
  const c = guardarS().hoja('Compras');
  assert.equal(c.celda(2, 6), 5000);
  assert.equal(c.celda(2, 11), 2000);
  assert.equal(c.celda(2, 12), 3000);
});
test('script · un proveedor renombrado aparece con el nombre actual en Compras y Proveedores (con su deuda)', () => {
  const { hoja } = guardarS();
  assert.equal(hoja('Compras').celda(2, 10), 'Finca Nueva');
  assert.equal(hoja('Compras').celda(3, 10), 'Finca Nueva');
  const p = hoja('Proveedores');
  assert.equal(p.celda(2, 1), 'Finca Nueva');
  assert.equal(p.celda(2, 3), 3000, 'Deuda');
  assert.equal(p.celda(2, 4), 'Antes: La Esperanza');
});
test('script · Clientes incluye el documento y la deuda', () => {
  const c = guardarS().hoja('Clientes');
  assert.equal(c.celda(1, 5), 'Documento');
  assert.equal(c.celda(2, 5), '900123456');
  assert.equal(c.celda(2, 3), 40000);
  const sin = guardarS(datosS({ clientes: [{ id: 'c1', nombre: 'Ana' }] })).hoja('Clientes');
  assert.equal(sin.celda(2, 5), '', 'un cliente anterior sin documento deja la celda vacía');
});
