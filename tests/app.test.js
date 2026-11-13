'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cargarApp, esperar, responder, prod, sembrar, enviarVenta } = require('./arnes');

const venta = (o = {}) => ({ id: 1700000000000001, productoId: 'campo', cantidad: 1, descontado: 1, precio: 10, total: 10, costoUnitario: 0, ganancia: 10, fecha: '2026-11-01', clienteId: null, tipoPago: 'contado', pagado: 10, abonos: [], ...o });
const entrada = (o = {}) => ({ id: 1700000000000002, productoId: 'campo', cantidad: 100, costoUnitario: 10, total: 1000, fecha: '2026-11-01', diasGranja: 2, notas: '', ...o });
const cliente = (o = {}) => ({ id: 'c1', nombre: 'Ana', telefono: '', notas: '', ...o });
const ultimoToast = a => a.toasts().at(-1);

async function restaurar(a, texto) {
  a.run('importarJSON')({ __texto: texto });
  await esperar(15);
  await responder(a, true);
  await esperar(15);
}

/* ---------- A · BUG-001: XSS persistente ---------- */
test('BUG-001 · una fecha con HTML no se inyecta en la ficha del cliente', () => {
  const a = cargarApp({ seed: sembrar({ clientes: [cliente()], ventas: [venta({ fecha: '<img src=x onerror=alert(1)>', clienteId: 'c1', tipoPago: 'credito', pagado: 0 })] }) });
  a.run("verCliente('c1')");
  assert.ok(!a.hoja().innerHTML.includes('<img'), a.hoja().innerHTML);
});
test('BUG-001 · verFecha escapa lo que no es una fecha', () => {
  const a = cargarApp();
  assert.ok(!a.run("verFecha('<img src=x onerror=1>')").includes('<'));
});
test('BUG-001 · un id con HTML no llega a data-id', () => {
  const a = cargarApp({ seed: sembrar({ entradas: [entrada({ id: '1"><img src=x onerror=1>' })] }) });
  assert.ok(!a.run('VISTAS.comprar()').includes('<img'));
});
test('BUG-001 · los valores de Ajustes no inyectan HTML', () => {
  const a = cargarApp({ seed: sembrar({ config: { margen: '"><img src=x onerror=1>', alerta: '"><b>', vidaUtil: '"><i>' } }) });
  const html = a.run('VISTAS.ajustes()');
  assert.ok(!html.includes('<img') && !html.includes('<b>') && !html.includes('<i>'));
});

/* ---------- A · BUG-003 + EVA-010: importar validando todo ---------- */
test('BUG-003 · restaurar {entradas:[null], ventas:[{}]} se rechaza y no toca los datos', async () => {
  const a = cargarApp({ seed: sembrar({ products: [prod({ stock: 7 })] }) });
  const antes = a.estadoMem();
  await restaurar(a, JSON.stringify({ app: 'el-gallinero', products: [], entradas: [null], ventas: [{}], clientes: [] }));
  assert.deepEqual(a.estadoMem(), antes);
  assert.equal(ultimoToast(a).error, true);
});
test('BUG-003 · se rechaza un respaldo con números infinitos o fechas mal formadas', async () => {
  for (const malo of [
    { ventas: [venta({ precio: 'X' })] },
    { ventas: [venta({ fecha: '2026-13-45' })] },
    { entradas: [entrada({ id: 1.5 })] },
  ]) {
    const a = cargarApp({ seed: sembrar({ products: [prod({ stock: 7 })] }) });
    const antes = a.estadoMem();
    const base = { app: 'el-gallinero', products: [prod()], entradas: [], ventas: [], clientes: [], ...malo };
    let txt = JSON.stringify(base).replace('"X"', '1e999');
    await restaurar(a, txt);
    assert.deepEqual(a.estadoMem(), antes, txt);
  }
});
test('EVA-010 · un respaldo válido se normaliza, conserva el estado previo en eg_prev y marca schemaVersion', async () => {
  const a = cargarApp({ seed: sembrar({ products: [prod({ stock: 7 })] }) });
  const d = { app: 'el-gallinero', products: [prod({ stock: 3 })], entradas: [entrada()], ventas: [venta()], clientes: [cliente()], ajustes: [], config: { margen: '30', alerta: 'abc', vidaUtil: 20 } };
  await restaurar(a, JSON.stringify(d));
  const e = a.estadoMem();
  assert.equal(e.products[0].stock, 3);
  assert.equal(e.config.margen, 30);
  assert.equal(e.config.alerta, 50);
  assert.equal(e.config.schemaVersion, 4);
  const prev = JSON.parse(a.store.get('eg_prev'));
  assert.equal(prev.products[0].stock, 7);
});
test('EVA-010 · restaurar pasa por migrar(): una entrada negativa pasa a ajustes', async () => {
  const a = cargarApp();
  const d = { app: 'el-gallinero', products: [prod()], entradas: [entrada({ cantidad: -5, notas: 'PÉRDIDA: rotos' })], ventas: [], clientes: [] };
  await restaurar(a, JSON.stringify(d));
  const e = a.estadoMem();
  assert.equal(e.entradas.length, 0);
  assert.equal(e.ajustes[0].cantidad, 5);
});
test('EVA-010 · al cargar se descartan registros dañados de localStorage', () => {
  const a = cargarApp({ seed: sembrar({ ventas: [null, venta(), { x: 1 }], entradas: [null] }) });
  assert.equal(a.estadoMem().ventas.length, 1);
  assert.equal(a.estadoMem().entradas.length, 0);
});
test('EVA-010 · datos corruptos en el arranque muestran recuperación y permiten exportar lo crudo', async () => {
  const a = cargarApp({ seed: { eg_products: '{corrupt', eg_ventas: '[]' } });
  assert.match(a.q('#vista').innerHTML, /recuper/i);
  const btn = a.q('#recuperar-exportar');
  btn.listeners.click[0]();
  await esperar(20);
  assert.equal(a.estado.descargas.length, 1);
  const { resolveObjectURL } = require('node:buffer');
  const txt = await resolveObjectURL(a.estado.descargas[0].href).text();
  assert.ok(txt.includes('{corrupt'));
});

/* ---------- A · BUG-006: límites numéricos ---------- */
test('BUG-006 · precio 1e999, cantidad enorme o decimal no se guardan', async () => {
  for (const o of [{ precio: '1e999' }, { cant: '1e10' }, { cant: '2.5' }, { precio: '2e9' }]) {
    const a = cargarApp({ seed: sembrar({ products: [prod({ stock: 100 })] }) });
    await enviarVenta(a, o);
    assert.equal(a.estadoMem().ventas.length, 0, JSON.stringify(o));
    assert.equal(a.estadoMem().products[0].stock, 100);
    assert.equal(ultimoToast(a).error, true);
  }
});
test('BUG-006 · una venta normal sigue guardándose', async () => {
  const a = cargarApp({ seed: sembrar({ products: [prod({ stock: 100 })] }) });
  await enviarVenta(a, { cant: '3', precio: '1500' });
  const e = a.estadoMem();
  assert.equal(e.ventas.length, 1); assert.equal(e.ventas[0].total, 4500); assert.equal(e.products[0].stock, 97);
});

/* ---------- B · EVA-001 + BUG-004: guardado atómico ---------- */
test('EVA-001 · si el guardado falla en la 3.ª escritura, lo guardado coincide con la memoria', async () => {
  const a = cargarApp({ seed: sembrar({ products: [prod({ stock: 100 })] }) });
  a.fallarDesde(3);
  await enviarVenta(a);
  const mem = a.estadoMem();
  a.sinFallos();
  assert.deepEqual(a.recargar().estadoMem(), mem);
});
test('BUG-004 · si guardar falla se revierte la memoria y el aviso de error no se tapa', async () => {
  const a = cargarApp({ seed: sembrar({ products: [prod({ stock: 100 })] }) });
  a.fallarDesde(1);
  await enviarVenta(a);
  const e = a.estadoMem();
  assert.equal(e.ventas.length, 0); assert.equal(e.products[0].stock, 100);
  assert.equal(a.toasts().length, 1);
  assert.equal(ultimoToast(a).error, true);
  assert.ok(!/guardada/i.test(ultimoToast(a).texto));
});
test('BUG-004 · «Pagó completo» con fallo no deja el pedido pagado ni avisa éxito', async () => {
  const a = cargarApp({ seed: sembrar({ clientes: [cliente()], ventas: [venta({ clienteId: 'c1', tipoPago: 'credito', pagado: 0, total: 10 })] }) });
  a.fallarDesde(1);
  await a.run("ACCIONES.pagar({ dataset: { id: '1700000000000001' } })");
  assert.equal(a.estadoMem().ventas[0].pagado, 0);
  assert.equal(ultimoToast(a).error, true);
  assert.ok(!/pagado completo/i.test(ultimoToast(a).texto));
});
test('BUG-004 · migrar() al arrancar con fallo de guardado no revienta (TDZ de aviso_t)', () => {
  const seed = sembrar({ entradas: [entrada({ cantidad: -5, notas: 'PÉRDIDA: rotos' })] });
  let a;
  assert.doesNotThrow(() => { a = cargarApp({ seed, fallarDesde: 1 }); });
  assert.equal(a.estadoMem().ajustes.length, 1);
});
test('Compatibilidad · las claves eg_* de la versión anterior se leen y migran al guardado único', () => {
  const a = cargarApp({ seed: sembrar({ products: [prod({ stock: 9 })], ventas: [venta()] }) });
  assert.equal(a.estadoMem().products[0].stock, 9);
  assert.equal(a.estadoMem().ventas.length, 1);
  assert.deepEqual(a.recargar().estadoMem(), a.estadoMem());
});

/* ---------- C · EVA-004, BUG-002, BUG-005 ---------- */
test('EVA-004 · no se anula una entrada de la que ya se vendió parte', async () => {
  const a = cargarApp({ seed: sembrar({ products: [prod({ stock: 20, cost: 10 })], entradas: [entrada()], ventas: [venta({ cantidad: 80, descontado: 80, total: 800 })] }) });
  const p = a.run("ACCIONES['entrada-anular']({ dataset: { id: '1700000000000002' } })");
  await responder(a, true); await p;
  const e = a.estadoMem();
  assert.equal(e.entradas.length, 1); assert.equal(e.products[0].stock, 20);
  assert.match(ultimoToast(a).texto, /ya se vendi/i);
});
test('BUG-002 · anular una entrada que no es la última recalcula el costo', async () => {
  const a = cargarApp({ seed: sembrar({
    products: [prod({ stock: 200, cost: 15, lastCost: 20 })],
    entradas: [entrada({ id: 1700000000000002, fecha: '2026-11-01', costoUnitario: 10, costoPrevio: 0 }), entrada({ id: 1700000000000003, fecha: '2026-11-02', costoUnitario: 20, costoPrevio: 10, lastCostPrevio: 10 })],
  }) });
  const p = a.run("ACCIONES['entrada-anular']({ dataset: { id: '1700000000000002' } })");
  await responder(a, true); await p;
  const e = a.estadoMem();
  assert.equal(e.products[0].stock, 100); assert.equal(e.products[0].cost, 20); assert.equal(e.products[0].lastCost, 20);
});
test('BUG-005 · anular una venta con abonos advierte el monto abonado', async () => {
  const a = cargarApp({ seed: sembrar({ clientes: [cliente()], ventas: [venta({ clienteId: 'c1', tipoPago: 'credito', total: 1000, pagado: 500, abonos: [{ fecha: '2026-11-01', monto: 500 }] })] }) });
  const p = a.run("ACCIONES['venta-anular']({ dataset: { id: '1700000000000001' } })");
  await esperar();
  const html = a.hoja().innerHTML;
  assert.ok(html.includes('$500'), html);
  assert.match(html, /abon/i);
  await responder(a, false); await p;
});
test('BUG-005 · confirmar() resuelve false con Esc, fondo y cambio de ruta', async () => {
  const a = cargarApp();
  const corto = p => Promise.race([p, esperar(40).then(() => 'colgado')]);
  let p = a.run("confirmar({ titulo: 't', texto: 'x' })");
  a.doc.listeners.keydown.forEach(f => f({ key: 'Escape' }));
  assert.equal(await corto(p), false);
  p = a.run("confirmar({ titulo: 't', texto: 'x' })");
  a.run("ACCIONES.cerrar()");
  assert.equal(await corto(p), false);
  p = a.run("confirmar({ titulo: 't', texto: 'x' })");
  a.ir('clientes');
  assert.equal(await corto(p), false);
});

/* ---------- D · EVA-003 + BUG-008: PWA ---------- */
test('EVA-003 · aviso «Hay una versión nueva» solo si ya había un service worker, sin recargar solo', async () => {
  const mk = controller => {
    const sw = { controller, escuchas: {}, addEventListener(t, f) { (this.escuchas[t] ||= []).push(f); }, register: () => Promise.resolve({ addEventListener() {} }) };
    return sw;
  };
  const nuevo = mk(null);
  const a0 = cargarApp({ protocol: 'https:', serviceWorker: nuevo });
  await esperar();
  (nuevo.escuchas.controllerchange || []).forEach(f => f());
  assert.equal(a0.doc.querySelector('.update-bar'), null);

  const sw = mk({});
  const a = cargarApp({ protocol: 'https:', serviceWorker: sw });
  await esperar();
  (sw.escuchas.controllerchange || []).forEach(f => f());
  const barra = a.doc.querySelector('.update-bar');
  assert.ok(barra, 'falta la barra');
  assert.match(barra.innerHTML, /Hay una versi.n nueva/);
  assert.equal(a.estado.recargas, 0);
  barra.querySelector('button').listeners.click[0]();
  assert.equal(a.estado.recargas, 1);
});
test('EVA-003 · Ajustes muestra la versión del caché', async () => {
  const a = cargarApp({ caches: { keys: async () => ['el-gallinero-v9'] } });
  assert.ok(a.run('VISTAS.ajustes()').includes('id="aj-version"'));
  a.ir('ajustes');
  await esperar(10);
  assert.match(a.q('#aj-version').textContent, /el-gallinero-v9/);
});
test('EVA-003 · el manifest declara id', () => {
  const m = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'manifest.webmanifest'), 'utf8'));
  assert.ok(m.id);
});
