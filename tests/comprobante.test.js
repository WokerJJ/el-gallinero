'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cargarApp, prod, sembrar } = require('./arnes');

let seq = 1700000000000100;
const venta = (o = {}) => ({ id: seq++, productoId: 'campo', cantidad: 100, descontado: 100, precio: 600, total: 60000, costoUnitario: 400, ganancia: 20000, fecha: '2026-11-10', clienteId: null, tipoPago: 'contado', pagado: 60000, abonos: [], ...o });
const cli = (o = {}) => ({ id: 'c1', nombre: 'Tienda Doña Rosa', telefono: '3001234567', notas: 'Plaza de mercado', documento: '900123456', ...o });
const negocio = { nombre: 'Distribuidora El Gallinero', nit: '1.234.567-8', direccion: 'Cra 5 # 10-20', ciudad: 'Roldanillo', telefono: '3100000000', prefijo: 'CV' };
// Abrir muestra un borrador; el número se asigna al imprimir. Este ayudante abre e imprime.
const abrir = (a, id) => { a.run('window.print = () => {}'); a.run(`abrirComprobante(${id})`); a.run(`ACCIONES['imprimir-doc']({ dataset: { id: '${id}' } })`); };

test('comprobante · el número lleva prefijo y ceros a la izquierda', () => {
  const a = cargarApp({ seed: sembrar({ config: { negocio: { ...negocio, prefijo: 'cv' } } }) });
  assert.equal(a.run('numeroTxt(7)'), 'CV-000007');
  const b = cargarApp({ seed: sembrar({ config: { negocio: { ...negocio, prefijo: '' } } }) });
  assert.equal(b.run('numeroTxt(123)'), '000123');
});

test('comprobante · las ventas del mismo cliente y día salen juntas con un solo número', () => {
  const v1 = venta({ clienteId: 'c1' }), v2 = venta({ clienteId: 'c1', precio: 700, total: 70000 }), otraFecha = venta({ clienteId: 'c1', fecha: '2026-11-09' });
  const a = cargarApp({ seed: sembrar({ clientes: [cli()], ventas: [v1, v2, otraFecha], config: { negocio } }) });
  abrir(a, v1.id);
  assert.equal(a.run(`ventas.find(x => x.id === ${v1.id}).numero`), 1);
  assert.equal(a.run(`ventas.find(x => x.id === ${v2.id}).numero`), 1, 'misma venta del día: mismo número');
  assert.equal(a.run(`ventas.find(x => x.id === ${otraFecha.id}).numero`), undefined, 'otro día: sin número');
  assert.equal(a.run('config.consecutivo'), 2);
});

test('comprobante · imprimir el mismo comprobante dos veces no consume otro número', () => {
  const v = venta({ clienteId: 'c1' });
  const a = cargarApp({ seed: sembrar({ clientes: [cli()], ventas: [v], config: { negocio } }) });
  abrir(a, v.id); abrir(a, v.id); abrir(a, v.id);
  assert.equal(a.run('config.consecutivo'), 2);
  assert.equal(a.run(`ventas[0].numero`), 1);
});

test('comprobante · cada cliente recibe un número consecutivo distinto', () => {
  const v1 = venta({ clienteId: 'c1' }), v2 = venta({ clienteId: 'c2' }), v3 = venta();
  const a = cargarApp({ seed: sembrar({ clientes: [cli(), cli({ id: 'c2', nombre: 'Panadería' })], ventas: [v1, v2, v3], config: { negocio } }) });
  abrir(a, v1.id); abrir(a, v2.id); abrir(a, v3.id);
  assert.deepEqual([1, 2, 3], a.ev('ventas.map(v => v.numero)'));
});

test('comprobante · una venta posterior al mismo cliente el mismo día no entra en un comprobante ya numerado', () => {
  const v1 = venta({ clienteId: 'c1' });
  const a = cargarApp({ seed: sembrar({ clientes: [cli()], ventas: [v1], config: { negocio } }) });
  abrir(a, v1.id);
  const v2 = venta({ clienteId: 'c1' });
  a.run(`ventas.push(${JSON.stringify(v2)})`);
  abrir(a, v2.id);
  assert.equal(a.run(`ventas.find(x => x.id === ${v2.id}).numero`), 2);
  assert.equal(a.run(`grupoComprobante(ventas[0]).length`), 1);
});

test('comprobante · el documento trae emisor, cliente, detalle, totales y aviso de que no es factura DIAN', () => {
  const v = venta({ clienteId: 'c1' });
  const a = cargarApp({ seed: sembrar({ clientes: [cli()], ventas: [v], config: { negocio } }) });
  abrir(a, v.id);
  const html = a.hoja().innerHTML;
  for (const t of ['Distribuidora El Gallinero', '1.234.567-8', 'Cra 5 # 10-20', 'Roldanillo', 'COMPROBANTE DE VENTA', 'CV-000001', 'Tienda Doña Rosa', '900123456', 'Plaza de mercado', 'Huevo de Campo', '$60.000', 'Contado', 'Entrega', 'Recibe', 'No es una factura electrónica']) {
    assert.ok(html.includes(t), `falta «${t}»`);
  }
});

test('comprobante · una venta a crédito muestra lo abonado y el saldo pendiente', () => {
  const v = venta({ clienteId: 'c1', tipoPago: 'credito', pagado: 20000, total: 60000 });
  const a = cargarApp({ seed: sembrar({ clientes: [cli()], ventas: [v], config: { negocio } }) });
  abrir(a, v.id);
  const html = a.hoja().innerHTML;
  assert.match(html, /Crédito/);
  assert.match(html, /Abonado<\/span><strong>\$20\.000/);
  assert.match(html, /Saldo pendiente<\/span><strong>\$40\.000/);
});

test('comprobante · una venta por panal se describe en panales con su valor', () => {
  const v = venta({ clienteId: 'c1', cantidad: 120, descontado: 120, panales: 4, precioPanal: 17500, precio: 17500 / 30, total: 70000, pagado: 70000 });
  const a = cargarApp({ seed: sembrar({ clientes: [cli()], ventas: [v], config: { negocio } }) });
  abrir(a, v.id);
  const html = a.hoja().innerHTML;
  assert.match(html, /panal de 30 u\./);
  assert.match(html, /<td class="num">4 panales<\/td><td class="num">\$17\.500<\/td><td class="num">\$70\.000<\/td>/);
});

test('comprobante · sin cliente sale como consumidor final', () => {
  const v = venta();
  const a = cargarApp({ seed: sembrar({ ventas: [v], config: { negocio } }) });
  abrir(a, v.id);
  assert.match(a.hoja().innerHTML, /Consumidor final/);
});

test('comprobante · todo texto del usuario se escapa', () => {
  const v = venta({ clienteId: 'c1' });
  const a = cargarApp({ seed: sembrar({ products: [prod({ name: '<b>x</b>' })], clientes: [cli({ nombre: '<img src=x onerror=1>', documento: '<i>1</i>' })], ventas: [v], config: { negocio: { ...negocio, nombre: '<script>1</script>' } } }) });
  abrir(a, v.id);
  const html = a.hoja().innerHTML;
  assert.ok(!/<img|<script|<b>x|<i>1/.test(html));
});

test('comprobante · número, datos del negocio y documento del cliente sobreviven a guardar y recargar', () => {
  const v = venta({ clienteId: 'c1' });
  const a = cargarApp({ seed: sembrar({ clientes: [cli()], ventas: [v], config: { negocio } }) });
  abrir(a, v.id);
  const b = a.recargar();
  assert.equal(b.run('ventas[0].numero'), 1);
  assert.equal(b.run('config.consecutivo'), 2);
  assert.equal(b.run('config.negocio.nit'), '1.234.567-8');
  assert.equal(b.run('clientes[0].documento'), '900123456');
});

test('comprobante · los datos del negocio inválidos se sanean (prefijo y largos)', () => {
  const a = cargarApp();
  assert.equal(a.run("sanearNegocio({ prefijo: '!!!' }).prefijo"), 'CV');
  assert.equal(a.run("sanearNegocio({ prefijo: 'abc123' }).prefijo"), 'ABC123');
  assert.equal(a.run("sanearNegocio({ nombre: 'x'.repeat(500) }).nombre.length"), 100);
  assert.equal(a.run('sanearNegocio(null).nombre'), 'El Gallinero');
});

test('comprobante · una config antigua sin negocio ni consecutivo recibe valores por defecto', () => {
  const a = cargarApp({ seed: sembrar({ config: { margen: 30 } }) });
  assert.equal(a.run('config.negocio.prefijo'), 'CV');
  assert.equal(a.run('config.consecutivo'), 1);
  assert.equal(a.run('config.margen'), 30);
});

test('comprobante · Imprimir llama a la impresión del navegador', () => {
  const a = cargarApp({ seed: sembrar() });
  a.run('globalThis.__imp = 0; window.print = () => { globalThis.__imp++; }; ACCIONES["imprimir-doc"]()');
  assert.equal(a.run('globalThis.__imp'), 1);
});

test('comprobante · el pago a un proveedor tiene su comprobante con lo que falta por pagar', () => {
  const compra = { id: 1700000000000999, productoId: 'campo', cantidad: 300, costoUnitario: 400, total: 120000, fecha: '2026-11-01', diasGranja: 2, notas: '', proveedorId: 'f1', pagado: 70000, abonos: [] };
  const a = cargarApp({ seed: sembrar({ proveedores: [{ id: 'f1', nombre: 'Finca La Esperanza', telefono: '', notas: '' }], entradas: [compra], config: { negocio } }) });
  const html = a.run("comprobantePagoHTML('f1', 20000, [{ id: 1, fecha: '2026-11-01', productoId: 'campo', aplicado: 20000, resta: 30000, total: 120000 }])");
  assert.match(html, /COMPROBANTE DE PAGO A PROVEEDOR/);
  assert.match(html, /Finca La Esperanza/);
  assert.match(html, /Total pagado<\/span><strong>\$20\.000/);
  assert.match(html, /Falta por pagar<\/span><strong>\$50\.000/);
});

test('comprobante · Ajustes ofrece los datos del negocio y los botones aparecen en ventas y clientes', () => {
  const v = venta({ clienteId: 'c1' });
  const a = cargarApp({ seed: sembrar({ clientes: [cli()], ventas: [v] }) });
  assert.match(a.run('VISTAS.ajustes()'), /Datos del negocio/);
  assert.match(a.run('filaVenta(ventas[0])'), /data-act="comprobante"/);
  a.run("verCliente('c1')");
  assert.match(a.hoja().innerHTML, /Ver comprobante/);
});
