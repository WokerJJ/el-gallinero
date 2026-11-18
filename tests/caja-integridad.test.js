'use strict';
/* Caja · integridad del libro, anulaciones de compras pagadas con la caja, diálogos que no se cuelgan,
   medio de cobro por abono y pantalla. Ver docs/adr/0001-caja-libro-de-movimientos.md. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { cargarApp, esperar, responder, prod, sembrar, enviarVenta } = require('./arnes');

const URL_OK = 'https://script.google.com/macros/s/AKfycbx_abc-123/exec';
let seq = 1700000000009000;
const huevo = (o = {}) => prod({ id: 'campo', name: 'Huevo de Campo', stock: 1000, cost: 400, price: 600, panal: 30, ...o });
const finca = (o = {}) => ({ id: 'f1', nombre: 'Finca La Esperanza', telefono: '3001112233', notas: '', ...o });
const cli = (o = {}) => ({ id: 'c1', nombre: 'Tienda Doña Rosa', telefono: '3001234567', notas: '', documento: '', ...o });
const hoyDe = a => a.run('hoy()');
const mov = (a, o = {}) => ({ id: seq++, fecha: hoyDe(a), tipo: 'ingreso', monto: 100000, concepto: 'Saldo inicial de la caja', origen: 'apertura', ref: null, por: 'Dueño', ...o });
const ventaSeed = (o = {}) => ({ id: 1700000000000101, productoId: 'campo', cantidad: 10, descontado: 10, precio: 600, total: 6000, costoUnitario: 0, ganancia: 0, fecha: '2026-11-11', clienteId: 'c1', tipoPago: 'credito', pagado: 1000, abonos: [{ fecha: '2026-11-11', monto: 1000, medio: 'efectivo' }], ...o });
const saldo = a => a.run('saldoCaja()');
const movs = a => a.ev('movimientos');

function conCaja(extra = {}) {
  const base = cargarApp();
  return cargarApp({ seed: sembrar({ products: [huevo()], proveedores: [finca()], clientes: [cli()], movimientos: [mov(base)], config: { cajaActiva: true }, ...extra }) });
}
async function elegirOpcion(a, i) {
  await esperar();
  const b = a.hoja().querySelector('.sheet-body');
  (b.listeners.click || []).forEach(f => f({ target: { closest: () => ({ dataset: { i: String(i) } }) } }));
  await esperar();
}
async function comprar(a, { cant = 4, costo = 10000, pago = 'todo', pagado = '', prov = 'f1', origen = 'caja' } = {}) {
  a.ir('comprar');
  a.q('#e-prod').value = 'campo'; a.q('#e-cant').value = String(cant); a.q('#e-costo').value = String(costo);
  a.q('#e-fecha').value = '2026-11-11'; a.q('#e-dias').value = '2'; a.q('#e-vence').value = ''; a.q('#e-notas').value = '';
  a.q('#e-prov').value = prov; a.q('#e-pagado').value = String(pagado); a.q('#e-recibio').value = ''; a.q('#e-doc').value = '';
  const f = a.q('#f-entrada');
  f._q['input[name=euni]:checked'] = { value: 'panal' };
  f._q['input[name=epago]:checked'] = { value: pago };
  f._q['input[name=eorigen]:checked'] = { value: origen };
  const p = f.listeners.submit[0]({ preventDefault() {} });
  await esperar();
  return p;
}
// Anula la compra 0: confirma el primer diálogo y deja abierto el de la devolución.
async function anularCompra(a) {
  const id = a.run('entradas[0].id');
  const p = a.run(`ACCIONES['entrada-anular']({ dataset: { id: '${id}' } })`);
  await esperar(30); await responder(a, true);
  return { fin: p }; // el diálogo de la devolución queda abierto: se contesta antes de esperar el final
}
function devolver(a, monto) {
  const b = a.hoja().querySelector('.sheet-body');
  b.querySelector('#pm-monto').value = String(monto);
  b.querySelector('#f-monto').listeners.submit[0]({ preventDefault() {} });
}
function mov_form(a, tipo, concepto, monto) {
  a.run(`formMovimientoCaja('${tipo}')`);
  const b = a.hoja().querySelector('.sheet-body');
  b.querySelector('#mv-concepto').value = concepto; b.querySelector('#mv-monto').value = String(monto);
  return b.querySelector('#f-mov').listeners.submit[0]({ preventDefault() {} });
}
function cerrar(a, contado, nota = '') {
  a.run('formCierreCaja()');
  const b = a.hoja().querySelector('.sheet-body');
  b.querySelector('#ci-contado').value = String(contado); b.querySelector('#ci-nota').value = nota;
  return b.querySelector('#f-cierre').listeners.submit[0]({ preventDefault() {} });
}

/* ---------- BUG-001 · ids únicos ---------- */
test('BUG-001 · 500 llamadas seguidas a nuevoId() no repiten y siempre crecen', () => {
  const a = cargarApp();
  const ids = a.ev('Array.from({ length: 500 }, () => nuevoId())');
  assert.equal(new Set(ids).size, 500);
  assert.ok(ids.every((x, i) => i === 0 || x > ids[i - 1]));
});

test('BUG-001 · un respaldo con el MISMO id en dos movimientos: se renumeran y anular ambas ventas deja la caja en 0', async () => {
  const base = cargarApp();
  const v1 = ventaSeed({ id: 1700000000000101 }), v2 = ventaSeed({ id: 1700000000000102 });
  const a = cargarApp({ seed: sembrar({ products: [huevo()], clientes: [cli()], proveedores: [finca()], ventas: [v1, v2], config: { cajaActiva: true },
    movimientos: [mov(base, { id: 777, monto: 1000, origen: 'abono', ref: v1.id }), mov(base, { id: 777, monto: 1000, origen: 'abono', ref: v2.id })] }) });
  const ids = movs(a).map(m => m.id);
  assert.equal(new Set(ids).size, 2, 'ids únicos tras cargar');
  assert.equal(saldo(a), 2000);
  for (const v of [v2, v1]) { // en orden inverso: lo que más confunde a un Set de ids
    const p = a.run(`ACCIONES['venta-anular']({ dataset: { id: '${v.id}' } })`);
    await esperar(30); await responder(a, true); await p;
  }
  assert.equal(a.run('ventas.length'), 0);
  assert.equal(saldo(a), 0);
  assert.equal(movs(a).filter(m => m.origen === 'anulacion').length, 2);
});

test('BUG-001 · un contra-asiento que apuntaba a un id repetido queda ligado a su original', () => {
  const base = cargarApp();
  const a = cargarApp({ seed: sembrar({ products: [huevo()], config: { cajaActiva: true }, movimientos: [
    mov(base, { id: 50, monto: 700, origen: 'manual', tipo: 'ingreso', concepto: 'A' }),
    mov(base, { id: 50, monto: 900, origen: 'manual', tipo: 'ingreso', concepto: 'B' }),
    mov(base, { id: 60, monto: 700, origen: 'anulacion', tipo: 'egreso', concepto: 'Anulación: A', ref: 50 }),
  ] }) });
  const pend = a.ev('movimientosPendientes().map(m => m.concepto)');
  assert.deepEqual(pend, ['B'], 'solo B sigue sin revertir');
});

test('BUG-001 · los cierres con id repetido también se renumeran', () => {
  const base = cargarApp();
  const c = (o = {}) => ({ id: 9, fecha: hoyDe(base), esperado: 1, contado: 1, diferencia: 0, nota: '', por: 'Dueño', ...o });
  const a = cargarApp({ seed: sembrar({ products: [huevo()], cierres: [c(), c({ nota: 'otro' })], config: { cajaActiva: true } }) });
  assert.equal(a.run('cierres.length'), 2);
  assert.equal(new Set(a.ev('cierres.map(c => c.id)')).size, 2);
});

/* ---------- EVA-003 · refTipo ---------- */
test('EVA-003 · una venta con id 5 y una compra con id 5 no se afectan entre sí', () => {
  const base = cargarApp();
  const a = cargarApp({ seed: sembrar({ products: [huevo()], config: { cajaActiva: true }, movimientos: [
    mov(base, { monto: 1000, origen: 'venta', ref: 5, refTipo: 'venta' }),
    mov(base, { tipo: 'egreso', monto: 400, origen: 'compra', ref: 5, refTipo: 'compra' }),
  ] }) });
  assert.equal(a.run("salidaNetaCaja(5, 'compra')"), 400);
  assert.equal(a.run("salidaNetaCaja(5, 'venta')"), 0);
  a.run("revertirCaja(5, 'venta', 'x')");
  assert.equal(saldo(a), -400, 'la compra no se tocó');
  assert.equal(a.run("salidaNetaCaja(5, 'compra')"), 400);
});

test('EVA-003 · los datos anteriores sin refTipo se infieren del origen; un valor desconocido queda en null', () => {
  const base = cargarApp();
  const a = cargarApp({ seed: sembrar({ products: [huevo()], config: { cajaActiva: true }, movimientos: [
    mov(base, { origen: 'venta', ref: 1 }), mov(base, { origen: 'abono', ref: 2 }), mov(base, { origen: 'compra', ref: 3, tipo: 'egreso' }),
    mov(base, { origen: 'pago', ref: 4, tipo: 'egreso' }), mov(base, { origen: 'anulacion', ref: 5 }), mov(base, { origen: 'manual', ref: null }),
    mov(base, { origen: 'venta', ref: 6, refTipo: 'raro' }),
  ] }) });
  assert.deepEqual(a.ev('movimientos.map(m => m.refTipo)'), ['venta', 'venta', 'compra', 'compra', 'mov', null, null]);
});

test('EVA-003 · los movimientos nuevos guardan refTipo', async () => {
  const a = conCaja();
  await enviarVentaMedio(a, { cant: '10', precio: '600' });
  assert.equal(movs(a).at(-1).refTipo, 'venta');
  await comprar(a, { cant: 1 });
  assert.equal(movs(a).at(-1).refTipo, 'compra');
});
async function enviarVentaMedio(a, { medio = 'efectivo', ...o } = {}) {
  a.ir('vender');
  a.q('#f-venta')._q['input[name=vmedio]:checked'] = { value: medio };
  await enviarVenta(a, o);
}

/* ---------- EVA-006 · un cierre por día ---------- */
test('EVA-006 · el segundo cierre del mismo día pide confirmación; si se cancela no se registra y el formulario se conserva', async () => {
  const a = conCaja();
  await cerrar(a, 100000);
  assert.equal(a.run('cierres.length'), 1);
  const p = cerrar(a, 100000, 'otra vez');
  await esperar(40);
  assert.match(a.hoja().innerHTML, /Ya cerraste hoy: ¿cerrar otra vez\?/);
  await responder(a, false); await p;
  assert.equal(a.run('cierres.length'), 1);
  assert.match(a.hoja().innerHTML, /Cerrar la caja/, 'vuelve al formulario');
  assert.match(a.hoja().innerHTML, /value="100000"/);
  assert.match(a.hoja().innerHTML, /otra vez/);
});

test('EVA-006 · si se confirma, el segundo cierre se registra', async () => {
  const a = conCaja();
  await cerrar(a, 100000);
  const p = cerrar(a, 100000);
  await esperar(40); await responder(a, true); await p;
  assert.equal(a.run('cierres.length'), 2);
});

test('EVA-006 · la vista de un día pasado muestra el cierre guardado de ese día además del saldo', () => {
  const base = cargarApp();
  const ayer = base.run('sumarDias(hoy(), -1)');
  const a = cargarApp({ seed: sembrar({ products: [huevo()], config: { cajaActiva: true },
    movimientos: [mov(base, { fecha: ayer })], cierres: [{ id: seq++, fecha: ayer, esperado: 100000, contado: 98000, diferencia: -2000, nota: '', por: 'Dueño' }] }) });
  a.run("ACCIONES['caja-dia']({ dataset: { d: '-1' } })");
  const html = a.run('VISTAS.caja()');
  assert.match(html, /Cierre de este día/);
  assert.match(html, /contó \$98\.000/);
  assert.match(html, /Faltan \$2\.000/);
  assert.match(html, /Saldo al terminar el día/);
});

/* ---------- caja-anular valida ---------- */
test('caja-anular · un movimiento que no es manual, que no existe o que ya se anuló no hace nada', async () => {
  const a = conCaja();
  await mov_form(a, 'egreso', 'Transporte', 8000);
  const manual = movs(a).at(-1).id, apertura = movs(a)[0].id;
  const antes = () => movs(a).length;
  const n0 = antes();
  await a.run(`ACCIONES['caja-anular']({ dataset: { id: '${apertura}' } })`);
  await a.run("ACCIONES['caja-anular']({ dataset: { id: '123' } })");
  assert.equal(a.hoja(), null, 'ni siquiera pregunta');
  assert.equal(antes(), n0);
  let p = a.run(`ACCIONES['caja-anular']({ dataset: { id: '${manual}' } })`);
  await esperar(30); await responder(a, true); await p;
  assert.equal(antes(), n0 + 1);
  await a.run(`ACCIONES['caja-anular']({ dataset: { id: '${manual}' } })`);
  assert.equal(a.hoja(), null);
  assert.equal(antes(), n0 + 1);
  assert.equal(saldo(a), 100000);
});

/* ---------- BUG-003 / EVA-004 · anular compras pagadas con la caja ---------- */
test('BUG-003 · una compra sin proveedor pagada con la caja solo ofrece «volvió a la caja» o cancelar', async () => {
  const a = conCaja({ products: [huevo({ stock: 0 })] });
  await comprar(a, { prov: '' });
  assert.equal(saldo(a), 60000);
  const { fin: p } = await anularCompra(a);
  await esperar(30);
  const html = a.hoja().innerHTML;
  assert.match(html, /volvió a la caja/);
  assert.ok(!/queda como saldo a favor/i.test(html), 'no se ofrece dejarlo como saldo a favor: sin proveedor no existe');
  assert.ok(html.includes('data-i="1"') && !html.includes('data-i="2"'), 'solo dos opciones');
  await elegirOpcion(a, 0); await p;
  assert.equal(a.run('entradas.length'), 0);
  assert.equal(saldo(a), 100000, 'el dinero no queda sin rastro');
});

test('BUG-003 · cancelar esa pregunta deja la compra y la caja como estaban', async () => {
  const a = conCaja({ products: [huevo({ stock: 0 })] });
  await comprar(a, { prov: '' });
  const { fin: p } = await anularCompra(a);
  await elegirOpcion(a, 1); await p;
  assert.equal(a.run('entradas.length'), 1);
  assert.equal(saldo(a), 60000);
});

test('EVA-004 · devolución parcial: la caja recupera x y el saldo a favor queda en pagado − x', async () => {
  const a = conCaja({ products: [huevo({ stock: 0 })] });
  await comprar(a); // 40.000 de la caja
  const { fin: p } = await anularCompra(a);
  await esperar(30);
  assert.match(a.hoja().innerHTML, /Cuánto te devolvió/);
  devolver(a, 15000); await p;
  assert.equal(saldo(a), 75000);
  assert.equal(a.run('proveedores[0].saldoFavor'), 25000);
  assert.equal(a.run('entradas.length'), 0);
});

test('EVA-004 · devolver todo (por defecto) o nada se comporta como antes', async () => {
  const a = conCaja({ products: [huevo({ stock: 0 })] });
  await comprar(a);
  let { fin: p } = await anularCompra(a); await esperar(30); devolver(a, 40000); await p;
  assert.equal(saldo(a), 100000);
  assert.equal(a.run('proveedores[0].saldoFavor'), undefined);
  const b = conCaja({ products: [huevo({ stock: 0 })] });
  await comprar(b);
  ({ fin: p } = await anularCompra(b)); await esperar(30); devolver(b, 0); await p;
  assert.equal(saldo(b), 60000);
  assert.equal(b.run('proveedores[0].saldoFavor'), 40000);
});

test('EVA-004 · un monto devuelto mayor a lo que salió de la caja no se acepta', async () => {
  const a = conCaja({ products: [huevo({ stock: 0 })] });
  await comprar(a);
  const { fin: p } = await anularCompra(a); await esperar(30);
  devolver(a, 50000);
  assert.ok(a.hoja(), 'el diálogo sigue abierto');
  assert.equal(a.run('entradas.length'), 1);
  devolver(a, 40000); await p;
  assert.equal(saldo(a), 100000);
});

test('EVA-004 · compra con pago mixto (caja + banco) anulada: solo lo de la caja puede volver', async () => {
  const a = conCaja({ products: [huevo({ stock: 0 })] });
  await comprar(a, { pago: 'parcial', pagado: 15000 });
  const id = a.run('entradas[0].id');
  a.run(`aplicarPagoProveedor("f1", ${id}, 10000, "otro")`);
  assert.equal(a.run('entradas[0].pagado'), 25000);
  const { fin: p } = await anularCompra(a); await esperar(30);
  assert.match(a.hoja().innerHTML, /\$15\.000/);
  devolver(a, 15000); await p;
  assert.equal(saldo(a), 100000);
  assert.equal(a.run('proveedores[0].saldoFavor'), 10000, 'lo pagado por banco queda a favor');
});

/* ---------- EVA-005 · anteriores a la caja ---------- */
test('EVA-005 · anular una venta anterior a la caja lo dice y no toca el efectivo', async () => {
  const base = cargarApp();
  const v = ventaSeed({ tipoPago: 'contado', pagado: 6000, abonos: [], medio: 'efectivo', clienteId: null });
  const a = cargarApp({ seed: sembrar({ products: [huevo({ stock: 0 })], ventas: [v], movimientos: [mov(base)], config: { cajaActiva: true } }) });
  const p = a.run(`ACCIONES['venta-anular']({ dataset: { id: '${v.id}' } })`);
  await esperar(30);
  assert.match(a.hoja().innerHTML, /anterior a la caja/);
  assert.ok(!/saldrá de la caja/.test(a.hoja().innerHTML));
  await responder(a, true); await p;
  assert.equal(a.run('ventas.length'), 0);
  assert.equal(movs(a).length, 1);
  assert.equal(saldo(a), 100000);
});

test('EVA-005 · anular una compra anterior a la caja lo dice, no pregunta por devolución y no crea movimientos', async () => {
  const base = cargarApp();
  const e = { id: 1700000000000201, productoId: 'campo', cantidad: 100, costoUnitario: 400, total: 40000, fecha: '2026-11-01', diasGranja: 0, notas: '', pagado: 40000, abonos: [], proveedorId: 'f1' };
  const a = cargarApp({ seed: sembrar({ products: [huevo({ stock: 500 })], entradas: [e], proveedores: [finca()], movimientos: [mov(base)], config: { cajaActiva: true } }) });
  const p = a.run(`ACCIONES['entrada-anular']({ dataset: { id: '${e.id}' } })`);
  await esperar(30);
  assert.match(a.hoja().innerHTML, /anterior a la caja/);
  await responder(a, true); await p;
  assert.equal(a.run('entradas.length'), 0);
  assert.equal(movs(a).length, 1);
  assert.equal(a.run('proveedores[0].saldoFavor'), 40000);
});

/* ---------- BUG-002 · datos que cuentan ---------- */
function sheetFalso(remoto) {
  const fetch = async (url, op) => {
    const c = JSON.parse(op.body), ok = x => ({ json: async () => x });
    if (c.accion === 'ping') return ok({ ok: true, tieneDatos: true, actualizado: '2026-11-01T10:00:00Z', ventas: 1, clientes: 0 });
    if (c.accion === 'leer') return ok({ ok: true, texto: remoto });
    return ok({ ok: true });
  };
  return fetch;
}
test('BUG-002 · con la caja activa y sin ventas, conectar un Sheet con datos pregunta qué conservar', async () => {
  const origen = cargarApp({ seed: sembrar({ ventas: [ventaSeed({ clienteId: null })] }) });
  const remoto = JSON.stringify({ app: 'el-gallinero', version: 5, ...origen.estadoMem() });
  const a = cargarApp({ fetch: sheetFalso(remoto), seed: sembrar({ products: [huevo({ stock: 0, cost: 0, price: 0 })], config: { cajaActiva: true } }) });
  assert.equal(a.run('tieneDatos()'), true);
  const p = a.run(`conectarSheet('${URL_OK}', 'mi-clave')`);
  await esperar(30);
  assert.match(a.hoja().innerHTML, /El Sheet ya tiene datos/);
  await elegirOpcion(a, 2); await p; // cancelar
  assert.equal(a.run('config.cajaActiva'), true, 'nada se restauró solo');
});

test('BUG-002 · los movimientos y los cierres también cuentan como datos', () => {
  const base = cargarApp();
  const a = cargarApp({ seed: sembrar({ products: [huevo({ stock: 0, cost: 0, price: 0 })], movimientos: [mov(base)] }) });
  assert.equal(a.run('tieneDatos()'), true);
  assert.equal(cargarApp({ seed: sembrar({ products: [huevo({ stock: 0, cost: 0, price: 0 })] }) }).run('tieneDatos()'), false);
});

test('BUG-002 · el recordatorio de respaldo también cuenta la caja', () => {
  const base = cargarApp();
  const a = cargarApp({ seed: sembrar({ products: [huevo({ stock: 0, cost: 0, price: 0 })], movimientos: [mov(base)], config: { cajaActiva: true } }) });
  assert.match(a.run('VISTAS.inicio()'), /Haz un respaldo/);
});

/* ---------- BUG-004 · diálogos que no se cuelgan ---------- */
test('BUG-004 · elegir() resuelve «cancelar» al cerrarse con Escape, con el fondo o al cambiar de ruta', async () => {
  const a = cargarApp();
  const abrir = () => a.run("elegir('Título', 'texto', [{ v: 'a', t: 'A' }, { v: 'cancelar', t: 'Cancelar' }])");
  let p = abrir(); await esperar();
  a.doc.listeners.keydown.forEach(f => f({ key: 'Escape' }));
  assert.equal(await p, 'cancelar');
  p = abrir(); await esperar();
  a.run("ACCIONES.cerrar()");
  assert.equal(await p, 'cancelar');
  p = abrir(); await esperar();
  a.ir('vender');
  assert.equal(await p, 'cancelar');
});

test('BUG-004 · «Pagó completo» cerrado con Escape no se queda colgado ni cobra', async () => {
  const a = conCaja();
  await enviarVentaMedio(a, { cant: '10', precio: '600', pago: 'credito', cli: 'c1' });
  const id = a.run('ventas[0].id');
  const p = a.run(`ACCIONES.pagar({ dataset: { id: '${id}' } })`);
  await esperar();
  a.doc.listeners.keydown.forEach(f => f({ key: 'Escape' }));
  await p;
  assert.equal(a.run('ventas[0].pagado'), 0);
});

/* ---------- UX · no perder lo tecleado ---------- */
test('UX · cancelar «La caja no alcanza» conserva lo tecleado en el gasto', async () => {
  const a = conCaja();
  const p = mov_form(a, 'egreso', 'Compra grande', 500000);
  await esperar(40);
  assert.match(a.hoja().innerHTML, /La caja no alcanza/);
  await responder(a, false); await p;
  assert.equal(saldo(a), 100000);
  assert.match(a.hoja().innerHTML, /Registrar gasto/);
  assert.match(a.hoja().innerHTML, /value="Compra grande"/);
  assert.match(a.hoja().innerHTML, /value="500000"/);
});

test('UX · cancelar «Hay una diferencia» conserva lo contado y la nota', async () => {
  const a = conCaja();
  const p = cerrar(a, 90000, 'faltó cambio');
  await esperar(40); assert.match(a.hoja().innerHTML, /Hay una diferencia/);
  await responder(a, false); await p;
  assert.equal(a.run('cierres.length'), 0);
  assert.match(a.hoja().innerHTML, /value="90000"/);
  assert.match(a.hoja().innerHTML, /value="faltó cambio"/);
});

test('UX · si el usuario cambió de pantalla mientras decidía, no se reabre el formulario', async () => {
  const a = conCaja();
  a.ir('caja');
  const p = mov_form(a, 'egreso', 'Compra grande', 500000);
  await esperar(40);
  a.ir('inicio');
  await p;
  assert.equal(a.hoja(), null);
});

/* ---------- EVA-007 · medio por abono ---------- */
function abonar(a, ventaId, monto, medio) {
  a.run(`formAbono({ ventaId: ${ventaId} })`);
  const b = a.hoja().querySelector('.sheet-body');
  b.querySelector('#ab-monto').value = String(monto);
  if (medio) b._q['input[name=abmedio]:checked'] = { value: medio };
  b.querySelector('#f-abono').listeners.submit[0]({ preventDefault() {} });
}
test('EVA-007 · cada abono guarda su medio (venta con abono inicial, abono suelto y «Pagó completo»)', async () => {
  const a = conCaja();
  await enviarVentaMedio(a, { cant: '10', precio: '600', pago: 'credito', cli: 'c1', abono: '1000', medio: 'transferencia' });
  const id = a.run('ventas[0].id');
  assert.equal(a.run('ventas[0].abonos[0].medio'), 'transferencia');
  abonar(a, id, 500, 'efectivo');
  assert.equal(a.run('ventas[0].abonos[1].medio'), 'efectivo');
  abonar(a, id, 500, 'transferencia');
  assert.equal(a.run('ventas[0].abonos[2].medio'), 'transferencia');
  const p = a.run(`ACCIONES.pagar({ dataset: { id: '${id}' } })`);
  await elegirOpcion(a, 1); await p;
  assert.equal(a.run('ventas[0].abonos[3].medio'), 'transferencia');
  assert.equal(saldo(a), 100500, 'solo el abono en efectivo entró a la caja');
});

test('EVA-007 · el medio de un abono se sanea al cargar y sobrevive a recargar', () => {
  const v = ventaSeed({ abonos: [{ fecha: '2026-11-11', monto: 300, medio: 'efectivo' }, { fecha: '2026-11-11', monto: 300, medio: 'bitcoin' }, { fecha: '2026-11-11', monto: 400 }], pagado: 1000 });
  const a = cargarApp({ seed: sembrar({ products: [huevo()], clientes: [cli()], ventas: [v] }) });
  assert.deepEqual(a.ev('ventas[0].abonos.map(x => x.medio)'), ['efectivo', undefined, undefined].map(x => x ?? null));
  assert.equal(a.recargar().run('ventas[0].abonos[0].medio'), 'efectivo');
});

test('EVA-007 · «Efectivo / Transferencia» se oculta solo con la caja apagada y una venta a crédito sin abono', () => {
  const probar = (a, pago, abono) => {
    a.ir('vender');
    const f = a.q('#f-venta');
    a.q('#v-prod').value = 'campo'; a.q('#v-cant').value = '1'; a.q('#v-precio').value = '10';
    f._q['input[name=pago]:checked'] = { value: pago }; a.q('#v-abono').value = abono;
    (f.listeners.input || []).forEach(h => h({}));
    return a.q('#v-medio-box').hidden;
  };
  const apagada = cargarApp({ seed: sembrar({ products: [huevo()] }) });
  assert.equal(probar(apagada, 'credito', ''), true);
  assert.equal(probar(apagada, 'credito', '500'), false, 'si se cobra algo, el medio sigue guardándose para el Sheet');
  assert.equal(probar(apagada, 'contado', ''), false);
  assert.equal(probar(conCaja(), 'credito', ''), false);
});

/* ---------- esquema, decimales ---------- */
test('esquema 4 · un respaldo anterior a la caja carga sin movimientos ni caja activa', async () => {
  const datos = { app: 'el-gallinero', version: 4, products: [huevo()], ventas: [], entradas: [], clientes: [], proveedores: [], config: { schemaVersion: 4 } };
  const a = cargarApp({ seed: { eg_db: datos } });
  assert.equal(a.run('movimientos.length'), 0);
  assert.equal(a.run('config.cajaActiva'), false);
  const b = cargarApp();
  const p = b.run(`restaurarTexto(${JSON.stringify(JSON.stringify(datos))})`);
  await esperar(30); await responder(b, true); await p;
  assert.equal(b.run('products[0].id'), 'campo');
  assert.equal(b.run('movimientos.length'), 0);
  assert.equal(b.run('config.cajaActiva'), false);
  assert.equal(saldo(b), 0);
});

test('decimales · el saldo suma 0,1 + 0,2 como 0,3 y deja la caja exactamente en 0', () => {
  const base = cargarApp();
  const a = cargarApp({ seed: sembrar({ products: [huevo()], config: { cajaActiva: true }, movimientos: [mov(base, { monto: 0.1 }), mov(base, { monto: 0.2 })] }) });
  assert.equal(saldo(a), 0.3);
  a.run("movimientos.push(nuevoMovimiento('egreso', 0.3, 'x', 'manual', null))");
  assert.equal(saldo(a), 0);
});

/* ---------- pantalla ---------- */
test('diseño · la diferencia del cierre alterna pos / neg', () => {
  const a = conCaja();
  a.run('formCierreCaja()');
  const b = a.hoja().querySelector('.sheet-body');
  const probar = c => { b.querySelector('#ci-contado').value = String(c); b.querySelector('#f-cierre').listeners.input.forEach(f => f({})); return b.querySelector('#ci-dif').className; };
  assert.match(probar(100000), /\bpos\b/);
  assert.match(probar(90000), /\bneg\b/);
  assert.ok(!/\bpos\b/.test(b.querySelector('#ci-dif').className));
});

test('diseño · «Últimos cierres» usa insignias ok / low / out', () => {
  const base = cargarApp();
  const h = hoyDe(base), c = (diferencia, o = {}) => ({ id: seq++, fecha: h, esperado: 100, contado: 100 + diferencia, diferencia, nota: '', por: 'Dueño', ...o });
  const a = cargarApp({ seed: sembrar({ products: [huevo()], config: { cajaActiva: true }, movimientos: [mov(base)], cierres: [c(0), c(500), c(-300)] }) });
  const html = a.run('VISTAS.caja()');
  assert.match(html, /badge ok">Cuadró/);
  assert.match(html, /badge low">Sobran \$500/);
  assert.match(html, /badge out">Faltan \$300/);
});

test('diseño · los movimientos anulados y sus contra-asientos salen atenuados (row dim)', async () => {
  const a = conCaja();
  await mov_form(a, 'egreso', 'Transporte', 8000);
  await mov_form(a, 'egreso', 'Bolsas', 1000);
  assert.ok(!a.run('VISTAS.caja()').includes('row dim'));
  const id = movs(a).find(m => m.concepto === 'Transporte').id;
  const p = a.run(`ACCIONES['caja-anular']({ dataset: { id: '${id}' } })`);
  await esperar(30); await responder(a, true); await p;
  const html = a.run('VISTAS.caja()');
  assert.equal(html.split('row dim').length - 1, 2, 'el original y su contra-asiento');
});
