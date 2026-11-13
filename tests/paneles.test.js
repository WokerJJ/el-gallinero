'use strict';
/* Contrato entre el script que escribe los datos (Code.gs) y los paneles del Sheet (Paneles.gs).
   Los paneles leen las columnas por LETRA: si Code.gs mueve o cambia una columna, estas pruebas fallan antes de que
   el dueño vea cifras equivocadas. */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const CODE = fs.readFileSync(path.join(RAIZ, 'apps-script', 'Code.gs'), 'utf8');
const PANELES = fs.readFileSync(path.join(RAIZ, 'apps-script', 'Paneles.gs'), 'utf8');

const cabeceras = {};
for (const [, nombre, lista] of CODE.matchAll(/escribirHoja_\('([^']+)',\s*\[([^\]]*)\]/g)) cabeceras[nombre] = [...lista.matchAll(/'([^']*)'/g)].map(m => m[1]);
const letra = (hoja, titulo) => String.fromCharCode(65 + cabeceras[hoja].indexOf(titulo));

test('paneles · ambos scripts son JavaScript válido', () => {
  for (const [n, src] of [['Code.gs', CODE], ['Paneles.gs', PANELES]]) assert.doesNotThrow(() => new vm.Script(src, { filename: n }), n);
});

test('paneles · no hay nombres globales repetidos entre Code.gs y Paneles.gs (en Apps Script comparten ámbito)', () => {
  const globales = src => new Set([...src.matchAll(/^(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]));
  const comunes = [...globales(CODE)].filter(n => globales(PANELES).has(n));
  assert.deepEqual(comunes, []);
});

test('paneles · las columnas que leen existen con ese nombre en Code.gs', () => {
  assert.equal(letra('Ventas', 'Fecha'), 'A');
  assert.equal(letra('Ventas', 'Producto'), 'B');
  assert.equal(letra('Ventas', 'Cantidad'), 'C');
  assert.equal(letra('Ventas', 'Panales'), 'D');
  assert.equal(letra('Ventas', 'Precio'), 'E');
  assert.equal(letra('Ventas', 'Total'), 'F');
  assert.equal(letra('Ventas', 'Cliente'), 'G');
  assert.equal(letra('Ventas', 'Pago'), 'H');
  assert.equal(letra('Ventas', 'Abonado'), 'I');
  assert.equal(letra('Ventas', 'Debe'), 'J');
  assert.equal(letra('Ventas', 'Costo unitario'), 'L', 'el costo de lo vendido que usa el panel');
  assert.equal(letra('Compras', 'Total'), 'F');
  assert.equal(letra('Compras', 'Vence'), 'G');
  assert.equal(letra('Compras', 'Proveedor'), 'J');
  assert.equal(letra('Compras', 'Pagado'), 'K');
  assert.equal(letra('Compras', 'Debe'), 'L');
  assert.equal(letra('Compras', 'Comprobante'), 'M');
  assert.equal(letra('Proveedores', 'Deuda'), 'C');
  assert.equal(letra('Proveedores', 'Saldo a favor'), 'E');
  assert.equal(letra('Clientes', 'Deuda'), 'C');
  assert.equal(letra('Inventario', 'Existencias'), 'C');
  assert.equal(letra('Inventario', 'Costo promedio'), 'D');
  assert.equal(letra('Inventario', 'Precio de venta'), 'E');
});

test('paneles · las columnas nuevas se agregan siempre al final: las anteriores no se mueven', () => {
  // Orden histórico: lo que ya leían los paneles no puede cambiar de letra.
  assert.deepEqual(cabeceras.Ventas.slice(0, 10), ['Fecha', 'Producto', 'Cantidad', 'Panales', 'Precio', 'Total', 'Cliente', 'Pago', 'Abonado', 'Debe']);
  assert.deepEqual(cabeceras.Compras.slice(0, 9), ['Fecha', 'Producto', 'Cantidad', 'Panales', 'Costo unitario', 'Total', 'Vence', 'Días en granja', 'Notas']);
  assert.deepEqual(cabeceras.Clientes.slice(0, 4), ['Cliente', 'Teléfono', 'Deuda', 'Notas']);
  assert.deepEqual(cabeceras.Proveedores.slice(0, 4), ['Proveedor', 'Teléfono', 'Deuda', 'Notas']);
});

test('paneles · el costo de lo vendido sale de Ventas!L y la configuración de _respaldo!B4:B6', () => {
  assert.match(PANELES, /Ventas!L2:L/);
  assert.match(PANELES, /_respaldo!B4/);
  assert.match(PANELES, /_respaldo!B5/);
  assert.match(PANELES, /_respaldo!B6/);
  assert.ok(!/REGEXEXTRACT\(_respaldo!A1/.test(PANELES), 'la configuración ya no se lee del primer trozo del JSON');
});

test('paneles · las celdas B4:B6 de _respaldo las escribe Code.gs en ese orden (alerta, margen, vida útil)', () => {
  const m = CODE.match(/escribirTexto_\('_respaldo', texto, \[([^\]]*)\]\)/);
  assert.ok(m, 'no se encontró la escritura de _respaldo');
  const meta = m[1].split(/,(?![^()]*\))/).map(s => s.trim());
  assert.equal(meta.length, 6);
  assert.match(meta[3], /alerta/);
  assert.match(meta[4], /margen/);
  assert.match(meta[5], /vidaUtil/);
});

test('paneles · el panel de proveedores lee las columnas correctas de Compras y Proveedores', () => {
  assert.match(PANELES, /Proveedores!C2:C/, 'deuda');
  assert.match(PANELES, /Proveedores!E2:E/, 'saldo a favor');
  assert.match(PANELES, /Compras!L2:L>0/, 'compras con saldo pendiente');
  // CHOOSECOLS(d, n) sobre Compras!A2:M: 1 Fecha, 10 Proveedor, 2 Producto, 6 Total, 11 Pagado, 12 Debe, 13 Comprobante
  const orden = [['Fecha', 1], ['Proveedor', 10], ['Producto', 2], ['Total', 6], ['Pagado', 11], ['Debe', 12], ['Comprobante', 13]];
  for (const [titulo, n] of orden) assert.equal(cabeceras.Compras.indexOf(titulo) + 1, n, titulo);
  assert.match(PANELES, /CHOOSECOLS\(d,1\),CHOOSECOLS\(d,10\),CHOOSECOLS\(d,2\),CHOOSECOLS\(d,6\),CHOOSECOLS\(d,11\),CHOOSECOLS\(d,12\),CHOOSECOLS\(d,13\)/);
});

test('paneles · el menú de navegación incluye PANEL PROVEEDORES y se reconstruye con el resto', () => {
  assert.match(PANELES, /\['🧾 Proveedores', 'PANEL PROVEEDORES'\]/);
  assert.match(PANELES, /buildProveedores_\(\);/);
  assert.match(PANELES, /function buildProveedores_\(\)/);
});

test('paneles · no escriben en las pestañas que reescribe la app', () => {
  const protegidas = ['Inventario', 'Ventas', 'Compras', 'Proveedores', 'Clientes', 'Pérdidas', '_respaldo'];
  // resetSheet_ solo se llama con hojas de panel
  const llamadas = [...PANELES.matchAll(/resetSheet_\('([^']+)'/g)].map(m => m[1]);
  assert.ok(llamadas.length >= 9);
  for (const n of llamadas) assert.ok(!protegidas.includes(n), `resetSheet_ no debe tocar ${n}`);
});
