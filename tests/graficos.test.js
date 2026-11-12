'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cargarApp, prod, sembrar } = require('./arnes');

const venta = (o = {}) => ({ id: 1700000000000001, productoId: 'campo', cantidad: 100, descontado: 100, precio: 600, total: 60000, costoUnitario: 400, ganancia: 20000, fecha: '2026-11-01', clienteId: null, tipoPago: 'contado', pagado: 60000, abonos: [], ...o });
const compra = (o = {}) => ({ id: 1700000000000002, productoId: 'campo', cantidad: 300, costoUnitario: 400, total: 120000, fecha: '2026-11-01', diasGranja: 2, notas: '', pagado: 120000, abonos: [], ...o });

test('gráficos · periodos: 8 semanas, 6 meses y 12 meses, contiguos y terminando en el actual', () => {
  const a = cargarApp();
  const sem = a.ev("periodosGrafico('semanas')"), mes = a.ev("periodosGrafico('meses')"), anio = a.ev("periodosGrafico('anio')");
  assert.equal(sem.length, 8); assert.equal(mes.length, 6); assert.equal(anio.length, 12);
  for (let i = 1; i < sem.length; i++) assert.equal(a.run(`sumarDias('${sem[i - 1].fin}', 1)`), sem[i].ini, 'las semanas no dejan huecos');
  for (let i = 1; i < anio.length; i++) assert.equal(a.run(`sumarDias('${anio[i - 1].fin}', 1)`), anio[i].ini, 'los meses no dejan huecos');
  const hoy = a.run('hoy()');
  assert.ok(sem.at(-1).ini <= hoy && hoy <= sem.at(-1).fin, 'la última semana contiene hoy');
  assert.ok(mes.at(-1).ini <= hoy && hoy <= mes.at(-1).fin, 'el último mes contiene hoy');
});

test('gráficos · agrupa ventas, compras y pérdidas por período y ignora lo que queda fuera', () => {
  const a0 = cargarApp();
  const h = a0.run('hoy()'), vieja = a0.run("sumarDias(hoy(), -400)");
  const a = cargarApp({ seed: sembrar({ products: [prod()], ventas: [venta({ fecha: h }), venta({ id: 1700000000000003, fecha: h, precio: 700, total: 70000 }), venta({ id: 1700000000000004, fecha: vieja })], entradas: [compra({ fecha: h })], ajustes: [{ id: 1700000000000005, productoId: 'campo', cantidad: 10, costoUnitario: 400, fecha: h, motivo: '' }] }) });
  const d = a.ev("datosGrafico('semanas')").at(-1);
  assert.equal(d.vendido, 130000);
  assert.equal(d.ganancia, 130000 - 2 * 100 * 400);
  assert.equal(d.compras, 120000);
  assert.equal(d.perdidas, 4000);
  assert.equal(a.ev("datosGrafico('semanas')").reduce((s, x) => s + x.vendido, 0), 130000, 'la venta de hace más de un año no cuenta');
});

test('gráficos · corto() abrevia el dinero para los ejes', () => {
  const a = cargarApp();
  assert.equal(a.run('corto(800)'), '$800');
  assert.equal(a.run('corto(350000)'), '$350 mil');
  assert.equal(a.run('corto(1200000)'), '$1,2 M');
  assert.equal(a.run('corto(12000000)'), '$12 M');
  assert.equal(a.run('corto(-350000)'), '-$350 mil');
});

test('gráficos · el SVG es accesible, tiene una barra por dato y pinta de rojo lo negativo', () => {
  const a = cargarApp();
  const svg = a.run("graficoBarras({ titulo: 'Prueba', etiquetas: ['a', 'b', 'c'], series: [{ nombre: 'Ganancia', valores: [100, -50, 0], neg: true }] })");
  assert.match(svg, /<svg class="grafico"[^>]*role="img"[^>]*aria-label="Prueba"/);
  assert.equal((svg.match(/<rect /g) || []).length, 2, 'el valor 0 no dibuja barra');
  assert.match(svg, /class="g-bar g-neg"/);
  assert.match(svg, /<details class="datos">/, 'los números también se ofrecen como tabla');
});

test('gráficos · las escalas funcionan con todo en cero, un solo dato o solo negativos', () => {
  const a = cargarApp();
  for (const v of [[0, 0], [5], [-100, -20], [1e9, 2e9]]) {
    const svg = a.run(`graficoBarras({ titulo: 't', etiquetas: ${JSON.stringify(v.map((_, i) => 'e' + i))}, series: [{ nombre: 's', valores: ${JSON.stringify(v)} }] })`);
    assert.ok(!/NaN|Infinity/.test(svg), `sin NaN con ${JSON.stringify(v)}`);
  }
});

test('gráficos · sin movimientos muestra un mensaje en vez de gráficos vacíos', () => {
  const a = cargarApp({ seed: sembrar() });
  const html = a.run('VISTAS.graficos()');
  assert.match(html, /Todavía no hay ventas ni compras/);
  assert.ok(!html.includes('<svg'));
});

test('gráficos · con datos muestra ganancia, margen, mejor período y lo que más deja', () => {
  const a0 = cargarApp(); const h = a0.run('hoy()');
  const a = cargarApp({ seed: sembrar({ products: [prod(), prod({ id: 'aa', name: 'Huevo AA' })], ventas: [venta({ fecha: h }), venta({ id: 1700000000000003, productoId: 'aa', fecha: h, precio: 900, total: 90000 })], entradas: [compra({ fecha: h })] }) });
  const html = a.run('VISTAS.graficos()');
  assert.match(html, /Ganancia del período/);
  assert.match(html, /Margen sobre lo vendido/);
  assert.match(html, /Mejor semana/);
  assert.match(html, /Lo que más deja/);
  assert.ok(html.indexOf('Huevo AA') < html.indexOf('Huevo de Campo'), 'el producto que más deja va primero');
  assert.equal((html.match(/<svg class="grafico"/g) || []).length, 2);
});

test('gráficos · cambiar de período cambia el encabezado', () => {
  const a = cargarApp({ seed: sembrar() });
  assert.match(a.run('VISTAS.graficos()'), /Últimas 8 semanas/);
  a.run("ACCIONES['graf-tipo']({ dataset: { t: 'meses' } })");
  assert.match(a.run('VISTAS.graficos()'), /Últimos 6 meses/);
  a.run("ACCIONES['graf-tipo']({ dataset: { t: 'anio' } })");
  assert.match(a.run('VISTAS.graficos()'), /Últimos 12 meses/);
});

test('gráficos · el nombre de un producto con HTML no inyecta marcado', () => {
  const a0 = cargarApp(); const h = a0.run('hoy()');
  const a = cargarApp({ seed: sembrar({ products: [prod({ name: '<img src=x onerror=1>' })], ventas: [venta({ fecha: h })] }) });
  assert.ok(!a.run('VISTAS.graficos()').includes('<img'));
});

test('gráficos · aparece en el menú Más y en Inicio', () => {
  const a = cargarApp({ seed: sembrar() });
  assert.match(a.run('VISTAS.mas()'), /Gráficos de ganancias/);
  assert.match(a.run('VISTAS.inicio()'), /Ver gráficos/);
});
