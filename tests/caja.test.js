'use strict';
/* Caja: libro de movimientos del efectivo, cobro en efectivo o transferencia, pagos con dinero de la caja,
   cierre del día y recepción de mercancía. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { cargarApp, esperar, responder, prod, sembrar, enviarVenta } = require('./arnes');

let seq = 1700000000005000;
const huevo = (o = {}) => prod({ id: 'campo', name: 'Huevo de Campo', stock: 1000, cost: 400, price: 600, panal: 30, ...o });
const finca = (o = {}) => ({ id: 'f1', nombre: 'Finca La Esperanza', telefono: '3001112233', notas: '', ...o });
const cli = (o = {}) => ({ id: 'c1', nombre: 'Tienda Doña Rosa', telefono: '3001234567', notas: '', documento: '', ...o });
const hoyDe = a => a.run('hoy()');
const mov = (a, o = {}) => ({ id: seq++, fecha: hoyDe(a), tipo: 'ingreso', monto: 100000, concepto: 'Saldo inicial de la caja', origen: 'apertura', ref: null, por: 'Dueño', ...o });

/* App con la caja activa y 100.000 de saldo inicial. */
function conCaja(extra = {}) {
  const base = cargarApp();
  const h = hoyDe(base);
  return cargarApp({ seed: sembrar({ products: [huevo()], proveedores: [finca()], clientes: [cli()], movimientos: [mov(base)], config: { cajaActiva: true }, ...extra }), h });
}
const saldo = a => a.run('saldoCaja()');
const movs = a => a.ev('movimientos');

async function elegirOpcion(a, i) {
  await esperar();
  const b = a.hoja().querySelector('.sheet-body');
  (b.listeners.click || []).forEach(f => f({ target: { closest: () => ({ dataset: { i: String(i) } }) } }));
  await esperar();
}
async function comprar(a, { cant = 10, costo = 12500, pago = 'todo', pagado = '', prov = 'f1', origen = 'caja', recibio = '', doc = '' } = {}) {
  a.ir('comprar');
  a.q('#e-prod').value = 'campo'; a.q('#e-cant').value = String(cant); a.q('#e-costo').value = String(costo);
  a.q('#e-fecha').value = '2026-11-11'; a.q('#e-dias').value = '2'; a.q('#e-vence').value = ''; a.q('#e-notas').value = '';
  a.q('#e-prov').value = prov; a.q('#e-pagado').value = String(pagado); a.q('#e-recibio').value = recibio; a.q('#e-doc').value = doc;
  const f = a.q('#f-entrada');
  f._q['input[name=euni]:checked'] = { value: 'panal' };
  f._q['input[name=epago]:checked'] = { value: pago };
  f._q['input[name=eorigen]:checked'] = { value: origen };
  const p = f.listeners.submit[0]({ preventDefault() {} });
  await esperar();
  return p;
}
async function vender(a, { medio = 'efectivo', ...o } = {}) {
  a.ir('vender');
  a.q('#f-venta')._q['input[name=vmedio]:checked'] = { value: medio };
  await enviarVenta(a, o);
}
function abonar(a, ventaId, monto, medio = 'efectivo') {
  a.run(`formAbono({ ventaId: ${ventaId} })`);
  const b = a.hoja().querySelector('.sheet-body');
  b.querySelector('#ab-monto').value = String(monto);
  b._q['input[name=abmedio]:checked'] = { value: medio };
  b.querySelector('#f-abono').listeners.submit[0]({ preventDefault() {} });
}

/* ---------- activación ---------- */
test('caja · apagada no anota nada y la pantalla ofrece activarla', async () => {
  const a = cargarApp({ seed: sembrar({ products: [huevo()] }) });
  await vender(a, { cant: '10', precio: '600' });
  assert.equal(a.run('movimientos.length'), 0);
  assert.match(a.run('VISTAS.caja()'), /Activar la caja/);
  assert.ok(!a.run('VISTAS.inicio()').includes('En caja ahora'));
});

test('caja · activarla con un saldo inicial crea el movimiento de apertura', () => {
  const a = cargarApp({ seed: sembrar({ products: [huevo()] }) });
  a.ir('caja');
  a.q('#ci-saldo').value = '50000';
  a.q('#f-caja-ini').listeners.submit[0]({ preventDefault() {} });
  assert.equal(a.run('config.cajaActiva'), true);
  assert.equal(saldo(a), 50000);
  assert.equal(movs(a)[0].origen, 'apertura');
  assert.match(a.run('VISTAS.caja()'), /En caja ahora/);
});

test('caja · activarla con saldo 0 no crea un movimiento vacío', () => {
  const a = cargarApp({ seed: sembrar({ products: [huevo()] }) });
  a.ir('caja'); a.q('#ci-saldo').value = '0';
  a.q('#f-caja-ini').listeners.submit[0]({ preventDefault() {} });
  assert.equal(a.run('config.cajaActiva'), true);
  assert.equal(a.run('movimientos.length'), 0);
});

test('caja · un saldo inicial inválido no la activa', () => {
  const a = cargarApp({ seed: sembrar({ products: [huevo()] }) });
  a.ir('caja'); a.q('#ci-saldo').value = '-5';
  a.q('#f-caja-ini').listeners.submit[0]({ preventDefault() {} });
  assert.equal(a.run('config.cajaActiva'), false);
});

/* ---------- ventas ---------- */
test('caja · una venta de contado en efectivo entra a la caja', async () => {
  const a = conCaja();
  await vender(a, { cant: '10', precio: '600' });
  assert.equal(saldo(a), 106000);
  const m = movs(a).at(-1);
  assert.equal(m.origen, 'venta'); assert.equal(m.tipo, 'ingreso'); assert.equal(m.ref, a.run('ventas[0].id'));
  assert.equal(a.run('ventas[0].medio'), 'efectivo');
});

test('caja · una venta por transferencia no toca la caja pero guarda el medio', async () => {
  const a = conCaja();
  await vender(a, { cant: '10', precio: '600', medio: 'transferencia' });
  assert.equal(saldo(a), 100000);
  assert.equal(a.run('ventas[0].medio'), 'transferencia');
});

test('caja · una venta a crédito sin abono no mueve la caja ni guarda medio', async () => {
  const a = conCaja();
  await vender(a, { cant: '10', precio: '600', pago: 'credito', cli: 'c1' });
  assert.equal(saldo(a), 100000);
  assert.equal(a.run('ventas[0].medio'), undefined);
});

test('caja · una venta a crédito con abono inicial en efectivo anota solo el abono', async () => {
  const a = conCaja();
  await vender(a, { cant: '10', precio: '600', pago: 'credito', cli: 'c1', abono: '2000' });
  assert.equal(saldo(a), 102000);
  assert.equal(a.run('ventas[0].medio'), 'efectivo');
});

/* ---------- abonos ---------- */
test('caja · un abono en efectivo entra a la caja; por transferencia no', async () => {
  const a = conCaja();
  await vender(a, { cant: '10', precio: '600', pago: 'credito', cli: 'c1' });
  const id = a.run('ventas[0].id');
  abonar(a, id, 1500, 'efectivo');
  assert.equal(saldo(a), 101500);
  abonar(a, id, 1000, 'transferencia');
  assert.equal(saldo(a), 101500, 'la transferencia no es efectivo');
  assert.equal(a.run('ventas[0].pagado'), 2500);
});

test('caja · «Pagó completo» pregunta cómo pagó y anota el efectivo', async () => {
  const a = conCaja();
  await vender(a, { cant: '10', precio: '600', pago: 'credito', cli: 'c1' });
  const id = a.run('ventas[0].id');
  const p = a.run(`ACCIONES.pagar({ dataset: { id: '${id}' } })`);
  await elegirOpcion(a, 0); await p;
  assert.equal(saldo(a), 106000);
  assert.equal(a.run('ventas[0].pagado'), 6000);
});

test('caja · «Pagó completo» cancelado no cambia nada', async () => {
  const a = conCaja();
  await vender(a, { cant: '10', precio: '600', pago: 'credito', cli: 'c1' });
  const id = a.run('ventas[0].id');
  const p = a.run(`ACCIONES.pagar({ dataset: { id: '${id}' } })`);
  await elegirOpcion(a, 2); await p;
  assert.equal(a.run('ventas[0].pagado'), 0);
  assert.equal(saldo(a), 100000);
});

test('caja · «Pagó completo» con la caja apagada funciona como siempre, sin preguntar', async () => {
  const a = cargarApp({ seed: sembrar({ products: [huevo()], clientes: [cli()] }) });
  await vender(a, { cant: '10', precio: '600', pago: 'credito', cli: 'c1' });
  const id = a.run('ventas[0].id');
  a.run(`ACCIONES.pagar({ dataset: { id: '${id}' } })`);
  assert.equal(a.run('ventas[0].pagado'), 6000);
  assert.equal(a.run('movimientos.length'), 0);
});

/* ---------- compras y pagos con el dinero de la caja ---------- */
test('caja · una compra pagada con la caja es un egreso', async () => {
  const a = conCaja();
  await comprar(a, { cant: 4, costo: 10000 });
  assert.equal(saldo(a), 60000);
  const m = movs(a).at(-1);
  assert.equal(m.tipo, 'egreso'); assert.equal(m.origen, 'compra'); assert.equal(m.monto, 40000);
  assert.match(m.concepto, /Finca La Esperanza/);
});

test('caja · una compra pagada con banco u otro no toca la caja', async () => {
  const a = conCaja();
  await comprar(a, { cant: 4, costo: 10000, origen: 'otro' });
  assert.equal(saldo(a), 100000);
  assert.equal(a.run('entradas[0].pagado'), 40000);
});

test('caja · en una compra con pago parcial solo sale lo pagado hoy', async () => {
  const a = conCaja();
  await comprar(a, { cant: 4, costo: 10000, pago: 'parcial', pagado: 15000 });
  assert.equal(saldo(a), 85000);
  assert.equal(a.run('deudaProveedor("f1")'), 25000);
});

test('caja · si la compra pasa de lo que hay en caja pide confirmar; al cancelar no se registra nada', async () => {
  const a = conCaja();
  const p = comprar(a, { cant: 20, costo: 10000 }); // 200.000 con 100.000 en caja
  await esperar(40);
  assert.match(a.hoja().innerHTML, /La caja no alcanza/);
  await responder(a, false);
  await p;
  assert.equal(a.run('entradas.length'), 0);
  assert.equal(saldo(a), 100000);
});

test('caja · si se confirma, la compra se registra y la caja queda en negativo', async () => {
  const a = conCaja();
  const p = comprar(a, { cant: 20, costo: 10000 });
  await esperar(40);
  await responder(a, true);
  await p;
  assert.equal(a.run('entradas.length'), 1);
  assert.equal(saldo(a), -100000);
});

test('caja · un pago a proveedor con la caja es un egreso y uno con banco no', async () => {
  const a = conCaja();
  await comprar(a, { cant: 4, costo: 10000, pago: 'parcial', pagado: 0 });
  a.run('aplicarPagoProveedor("f1", null, 10000, "caja")');
  assert.equal(saldo(a), 90000);
  a.run('aplicarPagoProveedor("f1", null, 5000, "otro")');
  assert.equal(saldo(a), 90000);
  assert.equal(a.run('deudaProveedor("f1")'), 25000);
});

test('caja · «Pagar lo que falta» pregunta de dónde sale el dinero', async () => {
  const a = conCaja();
  await comprar(a, { cant: 4, costo: 10000, pago: 'parcial', pagado: 0 });
  const id = a.run('entradas[0].id');
  const p = a.run(`pagarCompraCompleta(${id})`);
  await elegirOpcion(a, 0); await p;
  assert.equal(saldo(a), 60000);
  assert.equal(a.run('deudaProveedor("f1")'), 0);
});

/* ---------- anulaciones ---------- */
test('caja · anular una venta cobrada en efectivo saca ese dinero de la caja con un contra-asiento', async () => {
  const a = conCaja();
  await vender(a, { cant: '10', precio: '600' });
  const id = a.run('ventas[0].id');
  const p = a.run(`ACCIONES['venta-anular']({ dataset: { id: '${id}' } })`);
  await esperar(30);
  assert.match(a.hoja().innerHTML, /saldrá de la caja/);
  await responder(a, true); await p;
  assert.equal(saldo(a), 100000);
  assert.equal(movs(a).filter(m => m.origen === 'anulacion').length, 1);
  assert.equal(movs(a).length, 3, 'el movimiento original no se borra');
});

test('caja · anular dos veces la misma venta no revierte dos veces', async () => {
  const a = conCaja();
  await vender(a, { cant: '10', precio: '600' });
  const v = a.ev('ventas[0]');
  a.run(`revertirCaja(${v.id}, ['venta', 'abono'], 'x')`);
  a.run(`revertirCaja(${v.id}, ['venta', 'abono'], 'x')`);
  assert.equal(saldo(a), 100000);
  assert.equal(movs(a).filter(m => m.origen === 'anulacion').length, 1);
});

test('caja · anular una compra pagada con la caja: si el proveedor devolvió el dinero, vuelve a la caja', async () => {
  const a = conCaja({ products: [huevo({ stock: 0 })] });
  await comprar(a, { cant: 4, costo: 10000 });
  assert.equal(saldo(a), 60000);
  const id = a.run('entradas[0].id');
  const p = a.run(`ACCIONES['entrada-anular']({ dataset: { id: '${id}' } })`);
  await esperar(30); await responder(a, true);
  await elegirOpcion(a, 0); await p;
  assert.equal(saldo(a), 100000);
  assert.equal(a.run('proveedores[0].saldoFavor'), undefined, 'si volvió a la caja no queda saldo a favor');
});

test('caja · anular una compra pagada con la caja: si no devolvió, queda saldo a favor y la caja no cambia', async () => {
  const a = conCaja({ products: [huevo({ stock: 0 })] });
  await comprar(a, { cant: 4, costo: 10000 });
  const id = a.run('entradas[0].id');
  const p = a.run(`ACCIONES['entrada-anular']({ dataset: { id: '${id}' } })`);
  await esperar(30); await responder(a, true);
  await elegirOpcion(a, 1); await p;
  assert.equal(saldo(a), 60000);
  assert.equal(a.run('proveedores[0].saldoFavor'), 40000);
});

test('caja · cancelar la pregunta del proveedor deja todo como estaba', async () => {
  const a = conCaja({ products: [huevo({ stock: 0 })] });
  await comprar(a, { cant: 4, costo: 10000 });
  const id = a.run('entradas[0].id');
  const p = a.run(`ACCIONES['entrada-anular']({ dataset: { id: '${id}' } })`);
  await esperar(30); await responder(a, true);
  await elegirOpcion(a, 2); await p;
  assert.equal(a.run('entradas.length'), 1);
  assert.equal(saldo(a), 60000);
});

test('caja · una compra pagada con banco se anula como siempre (saldo a favor), sin preguntar por la caja', async () => {
  const a = conCaja({ products: [huevo({ stock: 0 })] });
  await comprar(a, { cant: 4, costo: 10000, origen: 'otro' });
  const id = a.run('entradas[0].id');
  const p = a.run(`ACCIONES['entrada-anular']({ dataset: { id: '${id}' } })`);
  await esperar(30); await responder(a, true); await p;
  assert.equal(a.run('entradas.length'), 0);
  assert.equal(a.run('proveedores[0].saldoFavor'), 40000);
  assert.equal(saldo(a), 100000);
});

/* ---------- gastos, ingresos y cierre ---------- */
function mov_form(a, tipo, concepto, monto) {
  a.run(`formMovimientoCaja('${tipo}')`);
  const b = a.hoja().querySelector('.sheet-body');
  b.querySelector('#mv-concepto').value = concepto; b.querySelector('#mv-monto').value = String(monto);
  return b.querySelector('#f-mov').listeners.submit[0]({ preventDefault() {} });
}
test('caja · un gasto manual es un egreso con su concepto', async () => {
  const a = conCaja();
  await mov_form(a, 'egreso', 'Transporte', 8000);
  assert.equal(saldo(a), 92000);
  const m = movs(a).at(-1);
  assert.equal(m.origen, 'manual'); assert.equal(m.concepto, 'Transporte'); assert.equal(m.tipo, 'egreso');
});
test('caja · un ingreso manual suma', async () => {
  const a = conCaja();
  await mov_form(a, 'ingreso', 'Cambio', 20000);
  assert.equal(saldo(a), 120000);
});
test('caja · un gasto sin concepto o sin monto no se registra', async () => {
  const a = conCaja();
  await mov_form(a, 'egreso', '', 5000);
  await mov_form(a, 'egreso', 'Algo', 0);
  assert.equal(movs(a).length, 1);
});
test('caja · un gasto mayor al saldo pide confirmar', async () => {
  const a = conCaja();
  const p = mov_form(a, 'egreso', 'Compra grande', 500000);
  await esperar(40);
  assert.match(a.hoja().innerHTML, /La caja no alcanza/);
  await responder(a, false); await p;
  assert.equal(saldo(a), 100000);
});
test('caja · anular un movimiento manual agrega el contrario y no se puede anular dos veces', async () => {
  const a = conCaja();
  await mov_form(a, 'egreso', 'Transporte', 8000);
  const id = movs(a).at(-1).id;
  const p = a.run(`ACCIONES['caja-anular']({ dataset: { id: '${id}' } })`);
  await esperar(30); await responder(a, true); await p;
  assert.equal(saldo(a), 100000);
  assert.ok(!a.run('VISTAS.caja()').includes(`data-act="caja-anular" data-id="${id}"`), 'ya anulado: sin botón');
});

function cerrar(a, contado, nota = '') {
  a.run('formCierreCaja()');
  const b = a.hoja().querySelector('.sheet-body');
  b.querySelector('#ci-contado').value = String(contado); b.querySelector('#ci-nota').value = nota;
  return b.querySelector('#f-cierre').listeners.submit[0]({ preventDefault() {} });
}
test('caja · un cierre que cuadra queda registrado sin ajustes', async () => {
  const a = conCaja();
  await cerrar(a, 100000, 'Todo bien');
  assert.equal(a.run('cierres.length'), 1);
  assert.equal(a.run('cierres[0].diferencia'), 0);
  assert.equal(movs(a).length, 1);
  assert.match(a.run('VISTAS.caja()'), /Cuadró/);
});
test('caja · un faltante se confirma, se anota como ajuste y la caja queda en lo contado', async () => {
  const a = conCaja();
  const p = cerrar(a, 98000);
  await esperar(40);
  assert.match(a.hoja().innerHTML, /faltan/);
  await responder(a, true); await p;
  assert.equal(saldo(a), 98000);
  assert.equal(a.run('cierres[0].diferencia'), -2000);
  assert.equal(movs(a).at(-1).origen, 'ajuste');
  assert.equal(movs(a).at(-1).concepto, 'Faltante en el cierre');
});
test('caja · un sobrante también se ajusta', async () => {
  const a = conCaja();
  const p = cerrar(a, 105000);
  await esperar(40); await responder(a, true); await p;
  assert.equal(saldo(a), 105000);
  assert.equal(movs(a).at(-1).concepto, 'Sobrante en el cierre');
});
test('caja · cancelar la diferencia no cierra', async () => {
  const a = conCaja();
  const p = cerrar(a, 90000);
  await esperar(40); await responder(a, false); await p;
  assert.equal(a.run('cierres.length'), 0);
  assert.equal(saldo(a), 100000);
});
test('caja · el cierre sin dinero contado no se registra', async () => {
  const a = conCaja();
  await cerrar(a, '');
  assert.equal(a.run('cierres.length'), 0);
});

/* ---------- datos ---------- */
test('caja · los movimientos y cierres sobreviven a guardar y recargar', async () => {
  const a = conCaja();
  await vender(a, { cant: '10', precio: '600' });
  await cerrar(a, 106000);
  const b = a.recargar();
  assert.equal(b.run('movimientos.length'), 2);
  assert.equal(b.run('cierres.length'), 1);
  assert.equal(b.run('saldoCaja()'), 106000);
  assert.equal(b.run('config.cajaActiva'), true);
});
test('caja · un movimiento con monto cero, negativo o tipo inválido se descarta al cargar', () => {
  const base = cargarApp();
  const h = hoyDe(base);
  const a = cargarApp({ seed: sembrar({ movimientos: [mov(base), mov(base, { monto: 0 }), mov(base, { monto: -5 }), mov(base, { tipo: 'robo' })], config: { cajaActiva: true } }) });
  assert.equal(a.run('movimientos.length'), 1);
  assert.equal(saldo(a), 100000);
  assert.ok(h);
});
test('caja · el origen desconocido se lee como manual y el «registró» vacío como Dueño', () => {
  const base = cargarApp();
  const a = cargarApp({ seed: sembrar({ movimientos: [mov(base, { origen: 'raro', por: '' })], config: { cajaActiva: true } }) });
  assert.equal(a.run('movimientos[0].origen'), 'manual');
  assert.equal(a.run('movimientos[0].por'), 'Dueño');
});
test('caja · si guardar falla no queda ningún movimiento a medias', async () => {
  const a = conCaja();
  a.run('globalThis.__antes = movimientos.length');
  a.fallarDesde(1);
  await vender(a, { cant: '10', precio: '600' });
  assert.equal(a.run('movimientos.length'), a.run('globalThis.__antes'));
  assert.equal(saldo(a), 100000);
});
test('caja · el concepto de un movimiento se escapa al mostrarse', () => {
  const base = cargarApp();
  const a = cargarApp({ seed: sembrar({ movimientos: [mov(base, { concepto: '<img src=x onerror=1>', por: '<b>x</b>' })], config: { cajaActiva: true } }) });
  assert.ok(!a.run('VISTAS.caja()').includes('<img'));
  assert.ok(!a.run('VISTAS.caja()').includes('<b>x'));
});
test('caja · los respaldos incluyen la caja y borrar todos los datos la apaga', async () => {
  const a = conCaja();
  assert.ok(a.run('Object.keys(estado())').includes('movimientos'));
  assert.ok(a.run('Object.keys(estado())').includes('cierres'));
  const p = a.run("ACCIONES['borrar-todo']()");
  await esperar(30); await responder(a, true); await p;
  assert.equal(a.run('movimientos.length'), 0);
  assert.equal(a.run('config.cajaActiva'), false);
});

/* ---------- pantalla ---------- */
test('caja · la pantalla muestra saldo, entradas, salidas y los movimientos del día', async () => {
  const a = conCaja();
  await vender(a, { cant: '10', precio: '600' });
  await mov_form(a, 'egreso', 'Bolsas', 3000);
  const html = a.run('VISTAS.caja()');
  assert.match(html, /En caja ahora/);
  assert.match(html, /\$103\.000/);
  assert.match(html, /Bolsas/);
  assert.match(html, /\+\$6\.000/);
  assert.match(html, /Registrar gasto/);
});
test('caja · Inicio muestra la caja solo si está activa y el menú Más la lista', () => {
  const a = conCaja();
  assert.match(a.run('VISTAS.inicio()'), /En caja ahora/);
  assert.match(a.run('VISTAS.mas()'), /Efectivo, gastos y cierre del día/);
});
test('caja · se puede ver el día anterior y no pasar de hoy', () => {
  const a = conCaja();
  a.run("ACCIONES['caja-dia']({ dataset: { d: '-1' } })");
  assert.notEqual(a.run('cajaDia'), '');
  assert.match(a.run('VISTAS.caja()'), /Saldo al terminar el día/);
  a.run("ACCIONES['caja-dia']({ dataset: { d: '1' } })");
  assert.equal(a.run('cajaDia'), '');
});

/* ---------- recepción de mercancía ---------- */
test('recepción · la compra guarda quién recibió y el número de remisión o factura', async () => {
  const a = conCaja();
  await comprar(a, { cant: 4, costo: 10000, recibio: 'Luis Pérez', doc: 'F-1234' });
  assert.equal(a.run('entradas[0].recibidoPor'), 'Luis Pérez');
  assert.equal(a.run('entradas[0].documentoProveedor'), 'F-1234');
});
test('recepción · el comprobante de compra muestra quién recibió y el documento del proveedor', async () => {
  const a = conCaja();
  await comprar(a, { cant: 4, costo: 10000, recibio: 'Luis Pérez', doc: 'F-1234' });
  const html = a.hoja().innerHTML;
  assert.match(html, /Remisión \/ factura del proveedor: F-1234/);
  assert.match(html, /Recibe la mercancía · Luis Pérez/);
});
test('recepción · el último nombre que recibió se recuerda para la siguiente compra', async () => {
  const a = conCaja();
  await comprar(a, { cant: 4, costo: 10000, recibio: 'Luis Pérez' });
  assert.match(a.run('VISTAS.comprar()'), /value="Luis Pérez"/);
});
test('recepción · sin esos datos la compra se guarda igual', async () => {
  const a = conCaja();
  await comprar(a, { cant: 4, costo: 10000 });
  assert.equal(a.run('entradas.length'), 1);
  assert.equal(a.run('entradas[0].recibidoPor'), undefined);
});
test('recepción · los datos de recepción sobreviven a recargar y se escapan', async () => {
  const a = conCaja();
  await comprar(a, { cant: 4, costo: 10000, recibio: '<img src=x onerror=1>', doc: '<b>1</b>' });
  const b = a.recargar();
  assert.equal(b.run('entradas[0].recibidoPor'), '<img src=x onerror=1>');
  b.run('abrirComprobanteCompra(entradas[0].id)');
  assert.ok(!b.hoja().innerHTML.includes('<img') && !b.hoja().innerHTML.includes('<b>1'));
});
test('caja · en Comprar con la caja apagada no aparece la pregunta de dónde sale el pago', () => {
  const a = cargarApp({ seed: sembrar({ products: [huevo()] }) });
  assert.ok(!a.run('VISTAS.comprar()').includes('Lo que pagas hoy sale de'));
  const b = conCaja();
  assert.match(b.run('VISTAS.comprar()'), /Lo que pagas hoy sale de/);
});
