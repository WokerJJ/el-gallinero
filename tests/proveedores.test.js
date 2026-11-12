'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cargarApp, esperar, prod, sembrar } = require('./arnes');

const huevo = (o = {}) => prod({ id: 'campo', name: 'Huevo de Campo', stock: 0, cost: 0, panal: 30, ...o });
const finca = (o = {}) => ({ id: 'f1', nombre: 'Finca La Esperanza', telefono: '3001112233', notas: '', ...o });

async function comprar(a, { cant = 10, costo = 12500, modo = 'panal', pago = 'todo', pagado = '', prov = '', fecha = '2026-11-11' } = {}) {
  a.ir('comprar');
  a.q('#e-prod').value = 'campo'; a.q('#e-cant').value = String(cant); a.q('#e-costo').value = String(costo);
  a.q('#e-fecha').value = fecha; a.q('#e-dias').value = '2'; a.q('#e-vence').value = ''; a.q('#e-notas').value = '';
  a.q('#e-prov').value = prov; a.q('#e-pagado').value = String(pagado);
  const f = a.q('#f-entrada');
  f._q['input[name=euni]:checked'] = { value: modo };
  f._q['input[name=epago]:checked'] = { value: pago };
  await f.listeners.submit[0]({ preventDefault() {} });
  await esperar();
}

test('proveedores · una compra paga completa no genera deuda', async () => {
  const a = cargarApp({ seed: sembrar({ products: [huevo()], proveedores: [finca()] }) });
  await comprar(a, { prov: 'f1' });
  assert.equal(a.run('entradas[0].pagado'), 125000);
  assert.equal(a.run('deudaProveedores()'), 0);
});

test('proveedores · pagar una parte hoy deja el resto por pagar a ese proveedor', async () => {
  const a = cargarApp({ seed: sembrar({ products: [huevo()], proveedores: [finca()] }) });
  await comprar(a, { pago: 'parcial', pagado: 50000, prov: 'f1' });
  assert.equal(a.run('entradas[0].pagado'), 50000);
  assert.equal(a.run('entradas[0].proveedorId'), 'f1');
  assert.equal(a.run('deudaProveedor("f1")'), 75000);
  assert.equal(a.run('products[0].stock'), 300, 'la mercancía entra completa aunque no se haya pagado todo');
  assert.equal(a.run('entradas[0].abonos[0].monto'), 50000);
});

test('proveedores · quedar debiendo exige proveedor y un pago menor al total', async () => {
  const a = cargarApp({ seed: sembrar({ products: [huevo()], proveedores: [finca()] }) });
  await comprar(a, { pago: 'parcial', pagado: 50000, prov: '' });
  assert.equal(a.run('entradas.length'), 0, 'sin proveedor no se registra la deuda');
  await comprar(a, { pago: 'parcial', pagado: 125000, prov: 'f1' });
  assert.equal(a.run('entradas.length'), 0, 'si pagó todo no es una deuda');
  await comprar(a, { pago: 'parcial', pagado: 0, prov: 'f1' });
  assert.equal(a.run('deudaProveedor("f1")'), 125000, 'pagar cero también es válido: todo queda debiendo');
});

test('proveedores · un pago se aplica a las compras más viejas primero', async () => {
  const a = cargarApp({ seed: sembrar({ products: [huevo()], proveedores: [finca()] }) });
  await comprar(a, { cant: 4, costo: 10000, pago: 'parcial', pagado: 0, prov: 'f1', fecha: '2026-11-01' }); // 40.000
  await comprar(a, { cant: 4, costo: 10000, pago: 'parcial', pagado: 0, prov: 'f1', fecha: '2026-11-05' }); // 40.000
  assert.equal(a.run('deudaProveedor("f1")'), 80000);
  const detalle = a.ev('aplicarPagoProveedor("f1", null, 50000)');
  assert.equal(detalle.length, 2);
  assert.equal(detalle[0].resta, 0, 'la compra más vieja queda pagada');
  assert.equal(detalle[1].resta, 30000);
  assert.equal(a.run('deudaProveedor("f1")'), 30000);
});

test('proveedores · el resultado del pago muestra lo pagado y lo que falta', async () => {
  const a = cargarApp({ seed: sembrar({ products: [huevo()], proveedores: [finca()] }) });
  await comprar(a, { cant: 4, costo: 10000, pago: 'parcial', pagado: 10000, prov: 'f1' });
  const detalle = a.ev('aplicarPagoProveedor("f1", null, 5000)');
  a.run(`resultadoPagoProveedor('f1', 5000, ${JSON.stringify(detalle)})`);
  const html = a.hoja().innerHTML;
  assert.match(html, /Pagaste/);
  assert.match(html, /Falta por pagar/);
  assert.match(html, /\$25\.000/);
});

test('proveedores · pagar lo que falta de una compra la deja pagada', async () => {
  const a = cargarApp({ seed: sembrar({ products: [huevo()], proveedores: [finca()] }) });
  await comprar(a, { cant: 4, costo: 10000, pago: 'parcial', pagado: 15000, prov: 'f1' });
  a.run(`pagarCompraCompleta(${a.run('entradas[0].id')})`);
  assert.equal(a.run('deudaProveedor("f1")'), 0);
  assert.equal(a.run('entradas[0].pagado'), 40000);
});

test('proveedores · las compras anteriores (sin pagado ni proveedor) se leen como pagadas', () => {
  const vieja = { id: 1700000000000001, productoId: 'campo', cantidad: 100, costoUnitario: 10, total: 1000, fecha: '2026-11-01', diasGranja: 2, notas: '' };
  const a = cargarApp({ seed: sembrar({ products: [huevo()], entradas: [vieja] }) });
  assert.equal(a.run('entradas[0].pagado'), 1000);
  assert.equal(a.run('deudaProveedores()'), 0);
});

test('proveedores · sobreviven a guardar, recargar y entran al respaldo', async () => {
  const a = cargarApp({ seed: sembrar({ products: [huevo()], proveedores: [finca()] }) });
  await comprar(a, { cant: 2, costo: 10000, pago: 'parcial', pagado: 5000, prov: 'f1' });
  const b = a.recargar();
  assert.equal(b.run('proveedores.length'), 1);
  assert.equal(b.run('deudaProveedor("f1")'), 15000);
  assert.ok(b.run('Object.keys(estado())').includes('proveedores'));
});

test('proveedores · un proveedor con HTML en el nombre no inyecta marcado', () => {
  const a = cargarApp({ seed: sembrar({ proveedores: [finca({ nombre: '<img src=x onerror=1>' })] }) });
  assert.ok(!a.run('VISTAS.proveedores()').includes('<img'));
});

test('proveedores · no se puede eliminar un proveedor con compras', async () => {
  const a = cargarApp({ seed: sembrar({ products: [huevo()], proveedores: [finca()] }) });
  await comprar(a, { prov: 'f1' });
  a.run("formProveedor(proveedor('f1'))");
  assert.ok(!a.hoja().innerHTML.includes('Eliminar proveedor'));
});

test('proveedores · Inicio y Facturas muestran lo que se debe', async () => {
  const a = cargarApp({ seed: sembrar({ products: [huevo()], proveedores: [finca()] }) });
  await comprar(a, { cant: 4, costo: 10000, pago: 'parcial', pagado: 10000, prov: 'f1', fecha: a.run('hoy()') });
  assert.match(a.run('VISTAS.inicio()'), /Debo a proveedores/);
  assert.match(a.run('VISTAS.reportes()'), /Quedó por pagar/);
});
