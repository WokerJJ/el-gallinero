'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cargarApp, esperar, responder, prod, sembrar } = require('./arnes');

let seq = 1700000000001000;
const compra = (o = {}) => ({ id: seq++, productoId: 'campo', cantidad: 300, costoUnitario: 400, total: 120000, fecha: '2026-11-10', diasGranja: 2, notas: '', proveedorId: 'f1', pagado: 120000, abonos: [], ...o });
const finca = (o = {}) => ({ id: 'f1', nombre: 'Finca La Esperanza', telefono: '3001112233', notas: 'Vereda El Placer', ...o });
const negocio = { nombre: 'Distribuidora El Gallinero', nit: '1.234.567-8', direccion: 'Cra 5 # 10-20', ciudad: 'Roldanillo', telefono: '3100000000', prefijo: 'CV', prefijoCompra: 'CP' };
const sem = (o = {}) => sembrar({ proveedores: [finca(), finca({ id: 'f2', nombre: 'Granja San José' })], config: { negocio }, ...o });
const abrir = (a, id) => a.run(`abrirComprobanteCompra(${id})`);
async function imprimir(a, id) { a.run(`imprimirComprobanteCompra(${id})`); await esperar(); }

test('comprobante de compra · pagada en su totalidad: lo dice y no deja pendiente', () => {
  const e = compra();
  const a = cargarApp({ seed: sem({ entradas: [e] }) });
  abrir(a, e.id);
  const html = a.hoja().innerHTML;
  assert.match(html, /COMPROBANTE DE COMPRA/);
  assert.match(html, /Pagada en su totalidad/);
  assert.match(html, /Total de la compra<\/span><strong>\$120\.000/);
  assert.match(html, /Pagado<\/span><strong>\$120\.000/);
  assert.match(html, /Pendiente por pagar<\/span><strong>\$0/);
  assert.match(html, /Al recibir la mercancía/, 'una compra pagada al recibir muestra ese pago');
});

test('comprobante de compra · pago parcial: dice cuánto se pagó y cuánto queda pendiente', () => {
  const e = compra({ pagado: 50000, abonos: [{ fecha: '2026-11-10', monto: 50000 }] });
  const a = cargarApp({ seed: sem({ entradas: [e] }) });
  abrir(a, e.id);
  const html = a.hoja().innerHTML;
  assert.match(html, /Pago parcial/);
  assert.match(html, /Pagado<\/span><strong>\$50\.000/);
  assert.match(html, /Pendiente por pagar<\/span><strong>\$70\.000/);
  assert.match(html, /<td>10\/11\/2026<\/td><td>Abono<\/td><td class="num">\$50\.000/);
});

test('comprobante de compra · sin ningún pago: todo está pendiente', () => {
  const e = compra({ pagado: 0, abonos: [] });
  const a = cargarApp({ seed: sem({ entradas: [e] }) });
  abrir(a, e.id);
  const html = a.hoja().innerHTML;
  assert.match(html, /Sin pagos: todo está pendiente/);
  assert.match(html, /Pendiente por pagar<\/span><strong>\$120\.000/);
  assert.match(html, /Todavía no se ha registrado ningún pago/);
});

test('comprobante de compra · los abonos posteriores aparecen con su fecha y el pendiente baja', () => {
  const e = compra({ pagado: 80000, abonos: [{ fecha: '2026-11-10', monto: 30000 }, { fecha: '2026-11-12', monto: 50000 }] });
  const a = cargarApp({ seed: sem({ entradas: [e] }) });
  abrir(a, e.id);
  const html = a.hoja().innerHTML;
  assert.match(html, /<td>10\/11\/2026<\/td><td>Abono<\/td><td class="num">\$30\.000/);
  assert.match(html, /<td>12\/11\/2026<\/td><td>Abono<\/td><td class="num">\$50\.000/);
  assert.match(html, /Pendiente por pagar<\/span><strong>\$40\.000/);
});

test('comprobante de compra · una compra por panal se describe en panales y costo por panal', () => {
  const e = compra({ cantidad: 300, panales: 10, costoPanal: 12500, costoUnitario: 416.6667, total: 125000, pagado: 125000 });
  const a = cargarApp({ seed: sem({ entradas: [e] }) });
  abrir(a, e.id);
  assert.match(a.hoja().innerHTML, /panal de 30 u\./);
  assert.match(a.hoja().innerHTML, /<td class="num">10 panales<\/td><td class="num">\$12\.500<\/td><td class="num">\$125\.000<\/td>/);
});

test('comprobante de compra · las compras del mismo proveedor el mismo día salen juntas', () => {
  const e1 = compra(), e2 = compra({ total: 80000, pagado: 30000, abonos: [{ fecha: '2026-11-10', monto: 30000 }] }), otro = compra({ fecha: '2026-11-09' });
  const a = cargarApp({ seed: sem({ entradas: [e1, e2, otro] }) });
  abrir(a, e1.id);
  const html = a.hoja().innerHTML;
  assert.match(html, /Total de la compra<\/span><strong>\$200\.000/);
  assert.match(html, /Pendiente por pagar<\/span><strong>\$50\.000/);
  assert.equal(a.run(`grupoCompra(entradas[0]).length`), 2);
});

test('comprobante de compra · es un borrador hasta imprimir: abrirlo no gasta número', () => {
  const e = compra();
  const a = cargarApp({ seed: sem({ entradas: [e] }) });
  abrir(a, e.id); abrir(a, e.id);
  assert.equal(a.run('config.consecutivoCompra'), 1);
  assert.equal(a.run('entradas[0].numero'), undefined);
  assert.match(a.hoja().innerHTML, /Borrador/);
});

test('comprobante de compra · al imprimir se numera con su propio prefijo y consecutivo, sin tocar el de ventas', async () => {
  const e = compra(), e2 = compra({ proveedorId: 'f2', fecha: '2026-11-11' });
  const a = cargarApp({ seed: sem({ entradas: [e, e2] }) });
  a.run('window.print = () => {}');
  await imprimir(a, e.id); await imprimir(a, e.id); await imprimir(a, e2.id);
  assert.deepEqual([1, 2], a.ev('entradas.map(x => x.numero)'));
  assert.equal(a.run('config.consecutivoCompra'), 3);
  assert.equal(a.run('config.consecutivo'), 1, 'la numeración de ventas no cambia');
  assert.equal(a.run('numeroTxtCompra(1)'), 'CP-000001');
  abrir(a, e.id);
  assert.match(a.hoja().innerHTML, /N° CP-000001/);
});

test('comprobante de compra · si no se puede guardar el número, no imprime', async () => {
  const e = compra();
  const a = cargarApp({ seed: sem({ entradas: [e] }) });
  a.run('globalThis.__imp = 0; window.print = () => { globalThis.__imp++; }');
  a.fallarDesde(1);
  await imprimir(a, e.id);
  assert.equal(a.run('globalThis.__imp'), 0);
  assert.ok(a.toasts().some(t => t.error));
});

test('comprobante de compra · el consecutivo nunca baja del mayor número usado, aunque el respaldo diga otra cosa', () => {
  const a = cargarApp({ seed: sem({ entradas: [compra({ numero: 5 }), compra({ numero: 6, proveedorId: 'f2' })], config: { negocio, consecutivoCompra: 1 } }) });
  assert.equal(a.run('config.consecutivoCompra'), 7);
  assert.equal(a.run('siguienteNumeroCompra()'), 7);
});

test('comprobante de compra · dos proveedores con el mismo número no se mezclan', () => {
  const a = cargarApp({ seed: sem({ entradas: [compra({ numero: 3 }), compra({ numero: 3, proveedorId: 'f2' })] }) });
  assert.equal(a.run('grupoCompra(entradas[0]).length'), 1);
});

test('comprobante de compra · anular una compra numerada deja rastro y el número no se reutiliza', async () => {
  const e = compra({ numero: 4 });
  const a = cargarApp({ seed: sem({ entradas: [e], products: [prod({ stock: 300 })], config: { negocio, consecutivoCompra: 5 } }) });
  const p = a.run(`ACCIONES['entrada-anular']({ dataset: { id: '${e.id}' } })`);
  await esperar(30);
  assert.match(a.hoja().innerHTML, /CP-000004/, 'la confirmación avisa que el comprobante ya pudo imprimirse');
  await responder(a, true);
  await p;
  assert.equal(a.run('entradas.length'), 0);
  assert.equal(a.run('config.anuladosCompra.length'), 1);
  assert.equal(a.run('config.anuladosCompra[0].numero'), 4);
  assert.equal(a.run('siguienteNumeroCompra()'), 5);
});

test('comprobante de compra · un comprobante con compras anuladas lo dice', () => {
  const e = compra({ numero: 4 });
  const a = cargarApp({ seed: sem({ entradas: [e], config: { negocio, anuladosCompra: [{ numero: 4, fecha: '2026-11-10', cliente: 'Finca La Esperanza', total: 50000 }] } }) });
  abrir(a, e.id);
  assert.match(a.hoja().innerHTML, /tuvo 1 compra anulada por \$50\.000/);
});

test('comprobante de compra · el número y los datos persisten al recargar', () => {
  const e = compra({ numero: 2 });
  const a = cargarApp({ seed: sem({ entradas: [e], config: { negocio, consecutivoCompra: 3 } }) });
  const b = a.recargar();
  assert.equal(b.run('entradas[0].numero'), 2);
  assert.equal(b.run('config.consecutivoCompra'), 3);
  assert.equal(b.run('config.negocio.prefijoCompra'), 'CP');
});

test('comprobante de compra · una config antigua recibe prefijo CP y consecutivo 1', () => {
  const a = cargarApp({ seed: sembrar({ config: { margen: 30, negocio: { nombre: 'X', prefijo: 'CV' } } }) });
  assert.equal(a.run('config.negocio.prefijoCompra'), 'CP');
  assert.equal(a.run('config.consecutivoCompra'), 1);
  assert.equal(a.run('config.anuladosCompra.length'), 0);
});

test('comprobante de compra · un número fuera de rango se descarta pero la compra se conserva', () => {
  const a = cargarApp({ seed: sem({ entradas: [compra({ numero: 9007199254740993 }), compra({ numero: -4 })] }) });
  assert.equal(a.run('entradas.length'), 2);
  assert.equal(a.run('entradas.some(e => e.numero)'), false);
});

test('comprobante de compra · todo texto del usuario se escapa', () => {
  const e = compra();
  const a = cargarApp({ seed: sem({ entradas: [e], products: [prod({ name: '<b>x</b>' })], proveedores: [finca({ nombre: '<img src=x onerror=1>', notas: '<i>n</i>' })], config: { negocio: { ...negocio, nombre: '<script>1</script>' } } }) });
  abrir(a, e.id);
  assert.ok(!/<img|<script|<b>x|<i>n/.test(a.hoja().innerHTML));
});

test('comprobante de compra · Ajustes valida el prefijo y el próximo número de compras', () => {
  const a = cargarApp({ seed: sem({ entradas: [compra({ numero: 5 })] }) });
  a.ir('ajustes');
  a.q('#ng-prefijo').value = 'CV'; a.q('#ng-consec').value = '1';
  a.q('#ng-prefijo-c').value = 'CP'; a.q('#ng-consec-c').value = '3';
  a.q('#f-neg').listeners.submit[0]({ preventDefault() {} });
  assert.ok(a.toasts().at(-1).error && /6/.test(a.toasts().at(-1).texto), a.toasts().at(-1).texto);
  a.q('#ng-prefijo-c').value = '!!'; a.q('#ng-consec-c').value = '9';
  a.q('#f-neg').listeners.submit[0]({ preventDefault() {} });
  assert.ok(a.toasts().at(-1).error);
  a.q('#ng-prefijo-c').value = 'cp'; a.q('#ng-consec-c').value = '9';
  a.q('#f-neg').listeners.submit[0]({ preventDefault() {} });
  assert.equal(a.run('config.consecutivoCompra'), 9);
  assert.equal(a.run('config.negocio.prefijoCompra'), 'CP');
});

test('comprobante de compra · hay botón en la lista de compras y en el detalle del proveedor', () => {
  const e = compra({ pagado: 0, abonos: [] });
  const a = cargarApp({ seed: sem({ entradas: [e] }) });
  assert.match(a.run('VISTAS.comprar()'), /data-act="comprobante-compra"/);
  a.run("verProveedor('f1')");
  assert.match(a.hoja().innerHTML, /Ver comprobante/);
});

test('comprobante de compra · se abre solo al guardar una compra y dice cuánto quedó pendiente', async () => {
  const a = cargarApp({ seed: sem({ products: [prod({ stock: 0, cost: 0, panal: 30 })] }) });
  a.ir('comprar');
  a.q('#e-prod').value = 'campo'; a.q('#e-cant').value = '10'; a.q('#e-costo').value = '12500';
  a.q('#e-fecha').value = '2026-11-11'; a.q('#e-dias').value = '2'; a.q('#e-vence').value = ''; a.q('#e-notas').value = '';
  a.q('#e-prov').value = 'f1'; a.q('#e-pagado').value = '50000';
  const f = a.q('#f-entrada');
  f._q['input[name=euni]:checked'] = { value: 'panal' };
  f._q['input[name=epago]:checked'] = { value: 'parcial' };
  await f.listeners.submit[0]({ preventDefault() {} });
  await esperar();
  const html = a.hoja().innerHTML;
  assert.match(html, /COMPROBANTE DE COMPRA/);
  assert.match(html, /Pago parcial/);
  assert.match(html, /Pendiente por pagar<\/span><strong>\$75\.000/);
});

test('comprobante de compra · si la compra no se pudo guardar no se abre ningún comprobante', async () => {
  const vieja = compra();
  const a = cargarApp({ seed: sem({ entradas: [vieja], products: [prod({ stock: 0, cost: 0, panal: 30 })] }) });
  a.ir('comprar');
  a.q('#e-prod').value = 'campo'; a.q('#e-cant').value = '10'; a.q('#e-costo').value = '12500';
  a.q('#e-fecha').value = '2026-11-11'; a.q('#e-dias').value = '2'; a.q('#e-vence').value = ''; a.q('#e-notas').value = '';
  a.q('#e-prov').value = 'f1'; a.q('#e-pagado').value = '';
  const f = a.q('#f-entrada');
  f._q['input[name=euni]:checked'] = { value: 'panal' };
  f._q['input[name=epago]:checked'] = { value: 'todo' };
  a.fallarDesde(1);
  await f.listeners.submit[0]({ preventDefault() {} });
  await esperar();
  assert.equal(a.run('entradas.length'), 1, 'el estado se revirtió');
  assert.ok(!a.hoja() || !/COMPROBANTE DE COMPRA/.test(a.hoja().innerHTML), 'no se abre el comprobante de otra compra');
});
