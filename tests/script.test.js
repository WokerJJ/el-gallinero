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
