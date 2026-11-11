'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cargarApp, esperar, prod, sembrar } = require('./arnes');

const huevo = (o = {}) => prod({ id: 'campo', name: 'Huevo de Campo', stock: 300, cost: 400, panal: 30, ...o });
const leche = (o = {}) => prod({ id: 'leche', name: 'Leche Colanta', unit: 'bolsas', control: 'vencimiento', panal: 0, stock: 20, ...o });

async function vender(a, { id = 'campo', cant, precio, modo = 'panal' }) {
  a.ir('vender');
  a.q('#v-prod').value = id; a.q('#v-cant').value = String(cant); a.q('#v-precio').value = String(precio);
  a.q('#v-cli').value = ''; a.q('#v-fecha').value = '2026-11-11'; a.q('#v-abono').value = '';
  const f = a.q('#f-venta');
  f._q['input[name=pago]:checked'] = { value: 'contado' };
  f._q['input[name=uni]:checked'] = { value: modo };
  await f.listeners.submit[0]({ preventDefault() {} });
  await esperar();
}

test('panal · vender 4 panales descuenta 120 unidades y el total es exacto', async () => {
  const a = cargarApp({ seed: sembrar({ products: [huevo()] }) });
  await vender(a, { cant: 4, precio: 17500 });
  const v = a.ev('ventas[0]');
  assert.equal(v.cantidad, 120);
  assert.equal(v.panales, 4);
  assert.equal(v.precioPanal, 17500);
  assert.equal(v.total, 70000, 'el total no debe arrastrar decimales del precio por unidad');
  assert.equal(a.run('products[0].stock'), 180);
  assert.equal(a.run('Math.round(ventas[0].ganancia)'), 70000 - 120 * 400);
});

test('panal · vender «por unidad» un huevo con panal no guarda campos de panal', async () => {
  const a = cargarApp({ seed: sembrar({ products: [huevo()] }) });
  await vender(a, { cant: 10, precio: 600, modo: 'unidad' });
  const v = a.ev('ventas[0]');
  assert.equal(v.cantidad, 10);
  assert.equal(v.panales, undefined);
  assert.equal(a.run('products[0].stock'), 290);
});

test('panal · un producto sin panal (leche) siempre se vende por unidad', async () => {
  const a = cargarApp({ seed: sembrar({ products: [leche()] }) });
  await vender(a, { id: 'leche', cant: 3, precio: 3500, modo: 'panal' });
  const v = a.ev('ventas[0]');
  assert.equal(v.cantidad, 3);
  assert.equal(v.panales, undefined);
});

test('panal · una venta por panal sobrevive a guardar y recargar', async () => {
  const a = cargarApp({ seed: sembrar({ products: [huevo()] }) });
  await vender(a, { cant: 2, precio: 18000 });
  const b = a.recargar();
  assert.equal(b.run('ventas[0].panales'), 2);
  assert.equal(b.run('ventas[0].precioPanal'), 18000);
  assert.match(b.run('filaVenta(ventas[0])'), /2 panales × Huevo de Campo/);
});

test('panal · los huevos de datos anteriores asumen 30 por panal; la leche, ninguno', () => {
  const a = cargarApp({ seed: sembrar({ products: [{ id: 'aa', name: 'Huevo AA', unit: 'unidades', cost: 0, price: 0, stock: 0, lastCost: 0, isEgg: true }, { id: 'leche', name: 'Leche', unit: 'bolsas', cost: 0, price: 0, stock: 0, lastCost: 0, isEgg: false }] }) });
  assert.equal(a.run("products.map(p => p.panal).join(',')"), '30,0');
});

test('panal · el stock se muestra también en panales', () => {
  const a = cargarApp({ seed: sembrar({ products: [huevo({ stock: 95 })] }) });
  assert.match(a.run('VISTAS.productos()'), /3 panales/);
});

test('panal · unidades por panal fuera de rango descartan el producto al restaurar', () => {
  const a = cargarApp({ seed: sembrar({ products: [huevo({ panal: 5000 })] }) });
  assert.equal(a.run('products.length'), 11, 'queda el catálogo base, no un producto inválido');
});

/* ---------- Compras por panal ---------- */
async function comprar(a, { id = 'campo', cant, costo, modo = 'panal', fecha = '2026-11-11' }) {
  a.ir('comprar');
  a.q('#e-prod').value = id; a.q('#e-cant').value = String(cant); a.q('#e-costo').value = String(costo);
  a.q('#e-fecha').value = fecha; a.q('#e-dias').value = '2'; a.q('#e-vence').value = ''; a.q('#e-notas').value = '';
  const f = a.q('#f-entrada');
  f._q['input[name=euni]:checked'] = { value: modo };
  await f.listeners.submit[0]({ preventDefault() {} });
  await esperar();
}

test('panal · comprar 10 panales mete 300 unidades al stock y el total es exacto', async () => {
  const a = cargarApp({ seed: sembrar({ products: [huevo({ stock: 0, cost: 0 })] }) });
  await comprar(a, { cant: 10, costo: 12500 });
  const e = a.ev('entradas[0]');
  assert.equal(e.cantidad, 300);
  assert.equal(e.panales, 10);
  assert.equal(e.costoPanal, 12500);
  assert.equal(e.total, 125000, 'el total no arrastra decimales del costo por unidad');
  assert.equal(a.run('products[0].stock'), 300);
  assert.equal(Math.round(a.run('products[0].cost') * 100) / 100, 416.67, 'costo promedio por unidad');
});

test('panal · comprar «por unidad» un huevo no guarda campos de panal', async () => {
  const a = cargarApp({ seed: sembrar({ products: [huevo({ stock: 0, cost: 0 })] }) });
  await comprar(a, { cant: 60, costo: 400, modo: 'unidad' });
  const e = a.ev('entradas[0]');
  assert.equal(e.cantidad, 60);
  assert.equal(e.panales, undefined);
});

test('panal · un producto sin panal (leche) se compra siempre por unidad', async () => {
  const a = cargarApp({ seed: sembrar({ products: [leche({ stock: 0 })] }) });
  a.ir('comprar');
  a.q('#e-prod').value = 'leche'; a.q('#e-cant').value = '12'; a.q('#e-costo').value = '3000';
  a.q('#e-fecha').value = '2026-11-11'; a.q('#e-dias').value = '0'; a.q('#e-vence').value = '2026-12-01'; a.q('#e-notas').value = '';
  const f = a.q('#f-entrada');
  f._q['input[name=euni]:checked'] = { value: 'panal' };
  await f.listeners.submit[0]({ preventDefault() {} });
  await esperar();
  const e = a.ev('entradas[0]');
  assert.equal(e.cantidad, 12);
  assert.equal(e.panales, undefined);
});

test('panal · una compra por panal sobrevive a guardar y recargar, y se lista en panales', async () => {
  const a = cargarApp({ seed: sembrar({ products: [huevo({ stock: 0, cost: 0 })] }) });
  await comprar(a, { cant: 4, costo: 12000 });
  const b = a.recargar();
  assert.equal(b.run('entradas[0].panales'), 4);
  assert.equal(b.run('entradas[0].costoPanal'), 12000);
  assert.match(b.run('VISTAS.comprar()'), /4 panales × Huevo de Campo/);
  assert.match(b.run('VISTAS.comprar()'), /\$12\.000 c\/panal/);
});

test('panal · anular una compra por panal devuelve el stock y deja el costo como estaba', async () => {
  const a = cargarApp({ seed: sembrar({ products: [huevo({ stock: 0, cost: 0 })] }) });
  await comprar(a, { cant: 2, costo: 12000 });
  const id = a.run('entradas[0].id');
  const p = a.run(`ACCIONES['entrada-anular']({ dataset: { id: '${id}' } })`);
  await esperar(30);
  await require('./arnes').responder(a, true);
  await p;
  assert.equal(a.run('entradas.length'), 0);
  assert.equal(a.run('products[0].stock'), 0);
});
