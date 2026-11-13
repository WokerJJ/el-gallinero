'use strict';
/* Correcciones de la revisión del comprobante de venta (BUG-001..006, EVA-001..010, DIS-001..005). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { cargarApp, esperar, responder, prod, sembrar, RAIZ } = require('./arnes');

let seq = 1700000000001000;
const venta = (o = {}) => ({ id: seq++, productoId: 'campo', cantidad: 100, descontado: 100, precio: 600, total: 60000, costoUnitario: 400, ganancia: 20000, fecha: '2026-11-10', clienteId: null, tipoPago: 'contado', pagado: 60000, abonos: [], ...o });
const compra = (o = {}) => ({ id: seq++, productoId: 'campo', cantidad: 300, costoUnitario: 400, total: 120000, fecha: '2026-11-01', diasGranja: 2, notas: '', ...o });
const cli = (o = {}) => ({ id: 'c1', nombre: 'Tienda Doña Rosa', telefono: '', notas: '', documento: '', ...o });
const finca = (o = {}) => ({ id: 'f1', nombre: 'Finca La Esperanza', telefono: '', notas: '', ...o });
const negocio = { nombre: 'El Gallinero', nit: '', direccion: '', telefono: '', ciudad: '', prefijo: 'CV' };
const huevo = (o = {}) => prod({ panal: 30, ...o });
const respaldo = (o = {}) => JSON.stringify({ app: 'el-gallinero', version: 4, products: [prod()], entradas: [], ventas: [], clientes: [], ajustes: [], proveedores: [], config: {}, ...o });

async function restaurar(a, texto) {
  a.run('importarJSON')({ __texto: texto });
  await esperar(15);
  await responder(a, true);
  await esperar(15);
}
async function anularVenta(a, id) {
  const p = a.run(`ACCIONES['venta-anular']({ dataset: { id: '${id}' } })`);
  await esperar();
  const texto = a.hoja() ? a.hoja().innerHTML : '';
  await responder(a, true);
  await p;
  return texto;
}
async function anularCompra(a, id) {
  const p = a.run(`ACCIONES['entrada-anular']({ dataset: { id: '${id}' } })`);
  await esperar();
  const texto = a.hoja() ? a.hoja().innerHTML : '';
  await responder(a, true);
  await p;
  return texto;
}
const imprimirDe = (a, id) => { a.run('globalThis.__imp = 0; window.print = () => { globalThis.__imp++; }'); a.run(`ACCIONES['imprimir-doc']({ dataset: { id: '${id}' } })`); };

/* ---------- A · numeración del comprobante ---------- */
test('BUG-001 · al cargar, el consecutivo nunca queda por debajo del mayor número emitido', () => {
  const a = cargarApp({ seed: sembrar({ clientes: [cli()], ventas: [venta({ numero: 5, clienteId: 'c1' }), venta({ numero: 2 })], config: { negocio, consecutivo: 2 } }) });
  assert.equal(a.run('config.consecutivo'), 6);
});
test('BUG-001 · el consecutivo respeta el tope de 999999999', () => {
  const a = cargarApp({ seed: sembrar({ ventas: [venta({ numero: 999999999 })], config: { negocio, consecutivo: 5 } }) });
  assert.equal(a.run('config.consecutivo'), 999999999);
  const b = cargarApp({ seed: sembrar({ config: { negocio, consecutivo: 5000000000 } }) });
  assert.equal(b.run('config.consecutivo'), 1, 'un consecutivo fuera de rango se descarta');
});
test('BUG-001 · restaurar un respaldo con consecutivo bajo también lo corrige', async () => {
  const a = cargarApp();
  await restaurar(a, respaldo({ ventas: [venta({ numero: 9 })], config: { negocio, consecutivo: 1 } }));
  assert.equal(a.run('config.consecutivo'), 10);
});
test('EVA-001 · numerarGrupo salta los números ya usados', () => {
  const v1 = venta({ numero: 2, clienteId: 'c1' }), v2 = venta({ clienteId: 'c1', fecha: '2026-11-09' });
  const a = cargarApp({ seed: sembrar({ clientes: [cli()], ventas: [v1, v2], config: { negocio, consecutivo: 3 } }) });
  a.run('config.consecutivo = 2');
  assert.equal(a.run(`numerarGrupo([ventas.find(x => x.id === ${v2.id})])`), true);
  assert.equal(a.run(`ventas.find(x => x.id === ${v2.id}).numero`), 3);
  assert.equal(a.run('config.consecutivo'), 4);
});
test('BUG-007 · dos clientes con el mismo número nunca se mezclan; sin cliente es una venta sola', () => {
  const v1 = venta({ numero: 1, clienteId: 'c1' }), v2 = venta({ numero: 1, clienteId: 'c2' }), v3 = venta({ numero: 1 }), v4 = venta({ numero: 1 });
  const a = cargarApp({ seed: sembrar({ clientes: [cli(), cli({ id: 'c2', nombre: 'Panadería' })], ventas: [v1, v2, v3, v4], config: { negocio } }) });
  assert.equal(a.run(`grupoComprobante(ventas.find(x => x.id === ${v1.id})).length`), 1);
  assert.equal(a.run(`grupoComprobante(ventas.find(x => x.id === ${v3.id})).length`), 1);
  const v5 = venta({ numero: 7, clienteId: 'c1' });
  a.run(`ventas.push(${JSON.stringify(v5)})`);
  assert.equal(a.run(`grupoComprobante(ventas.find(x => x.id === ${v5.id})).length`), 1);
  a.run(`ventas.push(${JSON.stringify(venta({ numero: 7, clienteId: 'c1' }))})`);
  assert.equal(a.run(`grupoComprobante(ventas.find(x => x.id === ${v5.id})).length`), 2, 'mismo número y mismo cliente sí van juntas');
});
test('EVA-001 · el formulario «Próximo número» rechaza lo que ya se emitió y dice el mínimo', () => {
  const a = cargarApp({ seed: sembrar({ ventas: [venta({ numero: 5 })], config: { negocio } }) });
  a.ir('ajustes');
  a.q('#ng-prefijo').value = 'CV'; a.q('#ng-consec').value = '5';
  a.q('#ng-prefijo-c').value = 'CP'; a.q('#ng-consec-c').value = '1'; // la numeración de compras también se valida en este formulario
  a.q('#f-neg').listeners.submit[0]({ preventDefault() {} });
  const t = a.toasts().at(-1);
  assert.ok(t.error && /mínimo.*6/.test(t.texto), t.texto);
  assert.equal(a.run('config.consecutivo'), 6);
  a.q('#ng-consec').value = '8';
  a.q('#f-neg').listeners.submit[0]({ preventDefault() {} });
  assert.equal(a.run('config.consecutivo'), 8);
});
test('BUG-004 · abrir un comprobante no consume número: es un borrador hasta imprimir', () => {
  const v = venta({ clienteId: 'c1' });
  const a = cargarApp({ seed: sembrar({ clientes: [cli()], ventas: [v], config: { negocio } }) });
  a.run(`abrirComprobante(${v.id})`); a.run(`abrirComprobante(${v.id})`);
  assert.equal(a.run('config.consecutivo'), 1);
  assert.equal(a.run('ventas[0].numero'), undefined);
  assert.match(a.hoja().innerHTML, /Borrador/);
  assert.match(a.hoja().innerHTML, /el número se asigna al imprimir/);
});
test('BUG-004 · al imprimir se numera el grupo y recién entonces se imprime', () => {
  const v1 = venta({ clienteId: 'c1' }), v2 = venta({ clienteId: 'c1' });
  const a = cargarApp({ seed: sembrar({ clientes: [cli()], ventas: [v1, v2], config: { negocio } }) });
  a.run(`abrirComprobante(${v1.id})`);
  imprimirDe(a, v1.id);
  assert.equal(a.run('globalThis.__imp'), 1);
  assert.deepEqual(a.ev('ventas.map(v => v.numero)'), [1, 1]);
  assert.equal(a.run('config.consecutivo'), 2);
  assert.match(a.hoja().innerHTML, /CV-000001/);
  imprimirDe(a, v1.id); // reimprimir no gasta otro número
  assert.equal(a.run('globalThis.__imp'), 1);
  assert.equal(a.run('config.consecutivo'), 2);
});
test('BUG-004 · si no se puede guardar el número, no se imprime y se avisa', () => {
  const v = venta({ clienteId: 'c1' });
  const a = cargarApp({ seed: sembrar({ clientes: [cli()], ventas: [v], config: { negocio } }) });
  a.run(`abrirComprobante(${v.id})`);
  a.fallarDesde(1);
  imprimirDe(a, v.id);
  assert.equal(a.run('globalThis.__imp'), 0);
  assert.equal(a.run('ventas[0].numero'), undefined);
  assert.ok(a.toasts().some(t => t.error));
});
test('EVA-002 · anular una venta numerada advierte, deja rastro y no reutiliza el número', async () => {
  const v1 = venta({ numero: 1, clienteId: 'c1' }), v2 = venta({ numero: 1, clienteId: 'c1', total: 10000, pagado: 10000 });
  const a = cargarApp({ seed: sembrar({ clientes: [cli()], ventas: [v1, v2], config: { negocio, consecutivo: 2 } }) });
  const texto = await anularVenta(a, v2.id);
  assert.match(texto, /comprobante CV-000001/);
  assert.deepEqual(a.ev('config.anulados'), [{ numero: 1, fecha: '2026-11-10', cliente: 'Tienda Doña Rosa', total: 10000 }]);
  assert.equal(a.run('config.consecutivo'), 2);
  const html = a.run('comprobanteHTML(grupoComprobante(ventas[0]))');
  assert.match(html, /Este comprobante tuvo 1 venta anulada por \$10\.000/);
  const b = a.recargar();
  assert.equal(b.run('config.anulados.length'), 1, 'el rastro sobrevive a recargar');
});
test('EVA-002 · si se anulan todas las ventas del comprobante igualmente queda registrado y el número no vuelve', async () => {
  const v1 = venta({ numero: 1, clienteId: 'c1' }), v2 = venta({ numero: 1, clienteId: 'c1' }), v3 = venta({ clienteId: 'c1', fecha: '2026-11-09' });
  const a = cargarApp({ seed: sembrar({ clientes: [cli()], ventas: [v1, v2, v3], config: { negocio, consecutivo: 2 } }) });
  await anularVenta(a, v1.id); await anularVenta(a, v2.id);
  assert.equal(a.run('config.anulados.length'), 2);
  a.run('config.consecutivo = 1'); // aun si el consecutivo retrocediera, el número anulado no se reutiliza
  a.run(`numerarGrupo([ventas.find(x => x.id === ${v3.id})])`);
  assert.equal(a.run('ventas[0].numero'), 2);
});
test('EVA-002 · config.anulados se sanea y se limita a 500', () => {
  const a = cargarApp();
  const basura = [null, 5, { numero: 'x', fecha: '2026-11-01', cliente: '', total: 1 }, { numero: 3, fecha: 'ayer', cliente: '', total: 1 }, { numero: 3, fecha: '2026-11-01', cliente: 'ok', total: 'mucho' }];
  const buenos = Array.from({ length: 600 }, (_, i) => ({ numero: i + 1, fecha: '2026-11-01', cliente: 'C', total: 10 }));
  const r = a.ev(`sanearConfig({ anulados: ${JSON.stringify([...basura, ...buenos])} }).anulados`);
  assert.equal(r.length, 500);
  assert.equal(r.at(-1).numero, 600, 'se conservan los más recientes');
  assert.deepEqual(a.ev('sanearConfig({ anulados: "x" }).anulados'), []);
});

/* ---------- B · dinero ---------- */
test('BUG-002 · pagado se recorta a [0, total] y los abonos no positivos se descartan', () => {
  const a = cargarApp({ seed: sembrar({ proveedores: [finca()], entradas: [
    compra({ proveedorId: 'f1', pagado: 999999 }),
    compra({ proveedorId: 'f1', pagado: -50 }),
    compra({ proveedorId: 'f1', pagado: 100, abonos: [{ fecha: '2026-11-01', monto: 0 }, { fecha: '2026-11-01', monto: -5 }, { fecha: '2026-11-01', monto: 100 }] }),
  ] }) });
  assert.deepEqual(a.ev('entradas.map(e => e.pagado)'), [120000, 0, 100]);
  assert.deepEqual(a.ev('entradas[2].abonos.map(x => x.monto)'), [100]);
  assert.equal(a.run('deudaProveedor("f1")'), 120000 + 119900);
  const b = cargarApp({ seed: sembrar({ proveedores: [finca()], entradas: [compra({ proveedorId: 'f1', abonos: [{ fecha: '2026-11-01', monto: 'mucho' }] })] }) });
  assert.equal(b.run('entradas.length'), 0, 'un abono sin monto numérico invalida el registro');
});
test('BUG-003 · una compra con proveedor inexistente recrea al proveedor para poder pagarle', () => {
  const a = cargarApp({ seed: sembrar({ proveedores: [finca()], entradas: [compra({ proveedorId: 'fX', pagado: 20000 })] }) });
  assert.deepEqual(a.ev("proveedores.find(p => p.id === 'fX')"), { id: 'fX', nombre: 'Proveedor sin nombre', telefono: '', notas: 'Recuperado de un respaldo' });
  assert.equal(a.run("deudaProveedor('fX')"), 100000);
  assert.match(a.run('VISTAS.proveedores()'), /Proveedor sin nombre/);
  assert.match(a.run('avisoArranque'), /Proveedor sin nombre|proveedor/i);
  assert.ok(a.store.get('eg_db').includes('fX'), 'se guarda corregido');
});
test('BUG-003 · restaurar un respaldo con proveedores faltantes avisa', async () => {
  const a = cargarApp();
  await restaurar(a, respaldo({ entradas: [compra({ proveedorId: 'fZ', pagado: 0 })] }));
  assert.equal(a.run("proveedores.some(p => p.id === 'fZ')"), true);
  assert.ok(a.toasts().some(t => /sin nombre/i.test(t.texto)), JSON.stringify(a.toasts()));
});
test('EVA-003 · seis abonos de 100,16 a una compra de 600,96 la dejan en cero, sin botón «Pagar»', () => {
  const e = compra({ proveedorId: 'f1', cantidad: 6, costoUnitario: 100.16, total: 600.96, pagado: 0 });
  const a = cargarApp({ seed: sembrar({ products: [huevo()], proveedores: [finca()], entradas: [e] }) });
  for (let i = 0; i < 6; i++) a.run(`aplicarPagoProveedor('f1', ${e.id}, 100.16)`);
  assert.equal(a.run('debeEntrada(entradas[0])'), 0);
  assert.equal(a.run('deudaProveedores()'), 0);
  a.run("verProveedor('f1')");
  assert.ok(!a.hoja().innerHTML.includes('pagar-compra-completa'));
});
test('EVA-003 · una deuda menor a medio centavo es cero (ventas y compras)', () => {
  const a = cargarApp();
  assert.equal(a.run("debeVenta({ tipoPago: 'credito', total: 100, pagado: 99.996 })"), 0);
  assert.equal(a.run("debeVenta({ tipoPago: 'credito', total: 100, pagado: 99.99 })"), 0.01);
  assert.equal(a.run('debeEntrada({ total: 100, pagado: 99.996 })'), 0);
  assert.equal(a.run('redondear(1.005 * 100 / 100)'), 1);
});
test('EVA-003 · los abonos de un cliente suman con centavos exactos', () => {
  const v = venta({ clienteId: 'c1', tipoPago: 'credito', total: 600.96, pagado: 0, cantidad: 6, precio: 100.16 });
  const a = cargarApp({ seed: sembrar({ clientes: [cli()], ventas: [v] }) });
  for (let i = 0; i < 6; i++) {
    a.run(`formAbono({ ventaId: ${v.id} })`);
    const b = a.hoja().querySelector('.sheet-body');
    b.querySelector('#ab-monto').value = '100.16';
    b.querySelector('#f-abono').listeners.submit[0]({ preventDefault() {} });
  }
  assert.equal(a.run('debeVenta(ventas[0])'), 0);
  assert.equal(a.run('ventas[0].pagado'), 600.96);
});
test('EVA-003 · los campos de monto aceptan desde 0,01', () => {
  const e = compra({ proveedorId: 'f1', pagado: 0 });
  const a = cargarApp({ seed: sembrar({ proveedores: [finca()], entradas: [e], clientes: [cli()], ventas: [venta({ clienteId: 'c1', tipoPago: 'credito', pagado: 0 })] }) });
  a.run(`formPagoProveedor({ proveedorId: 'f1' })`);
  assert.match(a.hoja().innerHTML, /id="pp-monto"[^>]*min="0\.01"/);
  a.run(`formAbono({ clienteId: 'c1' })`);
  assert.match(a.hoja().innerHTML, /id="ab-monto"[^>]*min="0\.01"/);
});
async function comprarPanales(a, { cant, costo }) {
  a.ir('comprar');
  a.q('#e-prod').value = 'campo'; a.q('#e-cant').value = String(cant); a.q('#e-costo').value = String(costo);
  a.q('#e-fecha').value = '2026-11-11'; a.q('#e-dias').value = '2'; a.q('#e-vence').value = ''; a.q('#e-notas').value = '';
  a.q('#e-prov').value = 'f1'; a.q('#e-pagado').value = '0';
  const f = a.q('#f-entrada');
  f._q['input[name=euni]:checked'] = { value: 'panal' };
  f._q['input[name=epago]:checked'] = { value: 'parcial' };
  await f.listeners.submit[0]({ preventDefault() {} });
  await esperar();
}
test('EVA-005 · el costo por unidad de un panal se guarda con 4 decimales y el total sigue exacto', async () => {
  const a = cargarApp({ seed: sembrar({ products: [huevo()], proveedores: [finca()] }) });
  await comprarPanales(a, { cant: 3, costo: 14333.33 });
  assert.equal(a.run('entradas[0].total'), 42999.99);
  assert.equal(a.run('entradas[0].costoUnitario'), 477.7777);
  assert.equal(a.run('products[0].lastCost'), 477.7777);
  assert.equal(a.run('products[0].cost'), 477.7777);
});
test('EVA-003 · compra de 3 panales a 14.333,33 pagada en 3 abonos queda en cero y sin botón «Pagar»', async () => {
  const a = cargarApp({ seed: sembrar({ products: [huevo()], proveedores: [finca()] }) });
  await comprarPanales(a, { cant: 3, costo: 14333.33 });
  const id = a.run('entradas[0].id');
  for (let i = 0; i < 3; i++) a.run(`aplicarPagoProveedor('f1', ${id}, 14333.33)`);
  assert.equal(a.run('deudaProveedor("f1")'), 0);
  a.run("verProveedor('f1')");
  assert.ok(!a.hoja().innerHTML.includes('data-entrada'), 'sin botón Pagar');
});
test('BUG-005 · anular una compra pagada con proveedor deja lo pagado como saldo a favor', async () => {
  const e = compra({ proveedorId: 'f1', pagado: 50000, abonos: [{ fecha: '2026-11-01', monto: 50000 }] });
  const a = cargarApp({ seed: sembrar({ products: [huevo({ stock: 300 })], proveedores: [finca()], entradas: [e] }) });
  const texto = await anularCompra(a, e.id);
  assert.match(texto, /saldo a favor/i);
  assert.equal(a.run("proveedor('f1').saldoFavor"), 50000);
  assert.equal(a.run('entradas.length'), 0);
  a.run("verProveedor('f1')");
  assert.match(a.hoja().innerHTML, /Saldo a favor: \$50\.000<\/strong> · pagado en compras anuladas/);
  assert.equal(a.recargar().run("proveedor('f1').saldoFavor"), 50000);
});
test('BUG-005 · saldoFavor se sanea (negativo o no numérico no entra)', () => {
  const a = cargarApp({ seed: sembrar({ proveedores: [finca({ saldoFavor: -5 }), finca({ id: 'f2', saldoFavor: 70 })] }) });
  assert.equal(a.run("proveedor('f1').saldoFavor || 0"), 0);
  assert.equal(a.run("proveedor('f2').saldoFavor"), 70);
  const b = cargarApp({ seed: sembrar({ proveedores: [finca({ saldoFavor: 'x' })] }) });
  assert.equal(b.run('proveedores.length'), 0, 'un saldo no numérico invalida el registro');
});

/* ---------- C · robustez ---------- */
test('BUG-006 · si window.print() lanza, la clase de impresión se quita igual', () => {
  const a = cargarApp();
  a.run(`globalThis.__cl = []; document.body.classList = { add: c => __cl.push('+' + c), remove: c => __cl.push('-' + c), contains: () => false };
    globalThis.setTimeout = f => f(); window.print = () => { throw new Error('sin impresora'); };`);
  assert.doesNotThrow(() => a.run('imprimirDocumento()'));
  assert.deepEqual(a.ev('__cl').filter(x => x === '-imprime-doc').length > 0, true);
  assert.equal(a.ev('__cl').at(-1), '-imprime-doc');
});
test('EVA-006 · SCHEMA es 4 y se guarda en los datos', () => {
  const a = cargarApp();
  assert.equal(a.run('SCHEMA'), 4);
  assert.equal(a.run('config.schemaVersion'), 4);
});
test('EVA-006 · se restauran respaldos v3 y v4; uno v5 se rechaza con un mensaje claro', async () => {
  const a = cargarApp({ seed: sembrar({ products: [prod({ stock: 7 })] }) });
  await restaurar(a, respaldo({ version: 3, products: [prod({ stock: 3 })] }));
  assert.equal(a.run('products[0].stock'), 3);
  assert.deepEqual(a.ev('config.anulados'), []);
  await restaurar(a, respaldo({ version: 4, products: [prod({ stock: 4 })] }));
  assert.equal(a.run('products[0].stock'), 4);
  await restaurar(a, respaldo({ version: 5, products: [prod({ stock: 99 })] }));
  assert.equal(a.run('products[0].stock'), 4, 'no se tocó nada');
  const t = a.toasts().at(-1);
  assert.ok(t.error && /versión más nueva de la app: actualiza la app/.test(t.texto), t.texto);
});
test('EVA-006 · datos guardados por una versión más nueva avisan al arrancar y conservan copia', () => {
  const a = cargarApp({ seed: sembrar({ proveedores: [finca()], config: { schemaVersion: 5 } }) });
  assert.match(a.run('avisoArranque'), /versión más nueva/);
  assert.ok(a.store.has('eg_prev'));
});

/* ---------- EVA-009 · casos de dinero y numeración ---------- */
test('EVA-009 · un pago mayor a la deuda se recorta en el formulario', () => {
  const e = compra({ proveedorId: 'f1', pagado: 20000 });
  const a = cargarApp({ seed: sembrar({ proveedores: [finca()], entradas: [e] }) });
  a.run("formPagoProveedor({ proveedorId: 'f1' })");
  const b = a.hoja().querySelector('.sheet-body');
  b.querySelector('#pp-monto').value = '999999';
  b.querySelector('#f-pago-prov').listeners.submit[0]({ preventDefault() {} });
  assert.equal(a.run('entradas[0].pagado'), 120000);
  assert.equal(a.run('entradas[0].abonos.at(-1).monto'), 100000);
});
test('EVA-009 · un pago con entradaId y monto mayor al de esa compra no toca las demás', () => {
  const e1 = compra({ proveedorId: 'f1', pagado: 0, total: 1000, fecha: '2026-11-02' }), e2 = compra({ proveedorId: 'f1', pagado: 0, total: 5000, fecha: '2026-11-03' });
  const a = cargarApp({ seed: sembrar({ proveedores: [finca()], entradas: [e1, e2] }) });
  const det = a.ev(`aplicarPagoProveedor('f1', ${e1.id}, 3000)`);
  assert.equal(det.length, 1);
  assert.equal(det[0].aplicado, 1000);
  assert.deepEqual(a.ev('entradas.map(e => e.pagado)'), [1000, 0]);
});
test('EVA-009 · pagos sucesivos con decimales no dejan residuos', () => {
  const e = compra({ proveedorId: 'f1', pagado: 0, total: 0.3 });
  const a = cargarApp({ seed: sembrar({ proveedores: [finca()], entradas: [e] }) });
  a.run(`aplicarPagoProveedor('f1', ${e.id}, 0.1)`); a.run(`aplicarPagoProveedor('f1', ${e.id}, 0.2)`);
  assert.equal(a.run('entradas[0].pagado'), 0.3);
  assert.equal(a.run('debeEntrada(entradas[0])'), 0);
});

/* ---------- D · diseño que toca lógica ---------- */
test('DIS-001 · el service worker sube de versión cuando cambia la app (v14 o posterior)', () => {
  const v = Number((fs.readFileSync(path.join(RAIZ, 'sw.js'), 'utf8').match(/VERSION = 'el-gallinero-v(\d+)'/) || [])[1]);
  assert.ok(v >= 14, `versión del caché: ${v}`);
});
const graf = (a, n) => a.run(`graficoBarras({ titulo: 't', etiquetas: ${JSON.stringify(Array.from({ length: n }, (_, i) => 'e' + i))}, series: [{ nombre: 'Vendido', valores: ${JSON.stringify(Array.from({ length: n }, (_, i) => 100 + i))} }, { nombre: 'Comprado', valores: ${JSON.stringify(Array.from({ length: n }, (_, i) => 50 + i))} }] })`);
test('DIS-002 · la segunda serie lleva trama diagonal y la leyenda usa el mismo patrón', () => {
  const a = cargarApp();
  const h = graf(a, 4);
  assert.match(h, /<defs><pattern id="g-trama"/);
  assert.match(h, /class="g-bar g-s1 g-trama"/);
  assert.ok(!/class="g-bar g-s0 g-trama"/.test(h));
  assert.match(fs.readFileSync(path.join(RAIZ, 'css', 'app.css'), 'utf8'), /\.leyenda i\.g-s1\s*\{[^}]*repeating-linear-gradient/);
  const una = a.run("graficoBarras({ titulo: 't', etiquetas: ['a'], series: [{ nombre: 'G', valores: [5] }] })");
  assert.ok(!una.includes('<pattern'), 'una sola serie no necesita trama');
});
test('DIS-003 · con grupos angostos solo se muestra una etiqueta de cada dos, siempre la última', () => {
  const a = cargarApp();
  const et = h => [...h.matchAll(/<text class="g-txt" x="[\d.]+" y="192" text-anchor="middle">(e\d+)<\/text>/g)].map(m => m[1]);
  assert.equal(et(graf(a, 8)).length, 8, 'con espacio se ven todas');
  const doce = et(graf(a, 12));
  assert.equal(doce.length, 6);
  assert.equal(doce.at(-1), 'e11');
  assert.deepEqual(doce, ['e1', 'e3', 'e5', 'e7', 'e9', 'e11']);
});
test('DIS-005 · el comprobante de pago se ve en pantalla debajo del resumen, y al imprimir sale solo el documento', () => {
  const e = compra({ proveedorId: 'f1', pagado: 0 });
  const a = cargarApp({ seed: sembrar({ proveedores: [finca()], entradas: [e] }) });
  const det = a.ev(`aplicarPagoProveedor('f1', ${e.id}, 20000)`);
  a.run(`resultadoPagoProveedor('f1', 20000, ${JSON.stringify(det)})`);
  const h = a.hoja().innerHTML;
  assert.ok(!h.includes('solo-impresion'));
  assert.ok(h.indexOf('Pagaste') < h.indexOf('COMPROBANTE DE PAGO A PROVEEDOR'), 'el documento va debajo del resumen');
  const antes = h.slice(0, h.indexOf('<article'));
  assert.match(antes, /class="no-print"/);
  assert.match(h.slice(h.indexOf('</article>')), /no-print[\s\S]*imprimir-doc/);
});
test('EVA-010 · hoja() enfoca el diálogo, atrapa Tab y devuelve el foco al cerrar', () => {
  const a = cargarApp();
  let enfocado = 0; const attrs = {};
  const crear = a.doc.createElement;
  a.doc.createElement = tag => { const e = crear(tag); e._q['.sheet'] = { setAttribute: (k, v) => { attrs[k] = v; }, focus: () => { enfocado++; } }; return e; };
  const boton = { focus() { this.vuelto = (this.vuelto || 0) + 1; }, isConnected: true };
  a.doc.activeElement = boton;
  a.run("hoja('Prueba', '<button>a</button>')");
  assert.equal(attrs.tabindex, '-1');
  assert.equal(enfocado, 1, 'el foco entra al diálogo aunque no haya puntero fino');
  const w = a.hoja();
  const mk = () => ({ focus() { this.n = (this.n || 0) + 1; }, closest: () => null });
  const primero = mk(), ultimo = mk();
  w.querySelectorAll = () => [primero, ultimo];
  let prevenido = 0;
  a.doc.activeElement = ultimo;
  w.listeners.keydown[0]({ key: 'Tab', shiftKey: false, preventDefault() { prevenido++; } });
  assert.equal(primero.n, 1); assert.equal(prevenido, 1);
  a.doc.activeElement = primero;
  w.listeners.keydown[0]({ key: 'Tab', shiftKey: true, preventDefault() { prevenido++; } });
  assert.equal(ultimo.n, 1); assert.equal(prevenido, 2);
  a.run('cerrarHoja()');
  assert.equal(boton.vuelto, 1);
});
test('EVA-010 · al pasar de un diálogo a otro el foco vuelve al elemento original', () => {
  const a = cargarApp();
  const boton = { focus() { this.vuelto = (this.vuelto || 0) + 1; }, isConnected: true };
  a.doc.activeElement = boton;
  a.run("hoja('Uno', 'x')");
  a.doc.activeElement = { focus() {}, isConnected: true }; // un elemento del primer diálogo
  a.run("hoja('Dos', 'y')");
  a.run('cerrarHoja()');
  assert.equal(boton.vuelto, 1);
});
