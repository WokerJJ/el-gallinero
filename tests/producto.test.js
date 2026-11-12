'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cargarApp, prod, sembrar } = require('./arnes');

const leche = (o = {}) => prod({ id: 'leche', name: 'Leche Colanta', unit: 'bolsas', control: 'vencimiento', stock: 10, ...o });
const entradaLeche = (vence, o = {}) => ({ id: 1700000000000010, productoId: 'leche', cantidad: 10, costoUnitario: 3000, total: 30000, fecha: '2026-11-01', diasGranja: 0, vence, notas: '', ...o });

test('control de frescura · los productos de la versión anterior se migran (isEgg → granja / ninguno)', () => {
  const a = cargarApp({
    seed: sembrar({ products: [{ id: 'aa', name: 'Huevo AA', unit: 'unidades', cost: 0, price: 0, stock: 0, lastCost: 0, isEgg: true }, { id: 'panela', name: 'Panela', unit: 'libras', cost: 0, price: 0, stock: 0, lastCost: 0, isEgg: false }, { id: 'leche', name: 'Leche Colanta', unit: 'bolsas', cost: 0, price: 0, stock: 0, lastCost: 0, isEgg: false }] }),
  });
  assert.equal(a.run("products.map(p => p.control).join(',')"), 'granja,ninguno,vencimiento');
});

test('control de frescura · un producto empacado alerta por su fecha de vencimiento', () => {
  const a = cargarApp({ seed: sembrar({ products: [leche()] }) });
  const vence = a.run('sumarDias(hoy(), 3)');
  const b = cargarApp({ seed: sembrar({ products: [leche()], entradas: [entradaLeche(vence)] }) });
  const al = b.run('alertasVencimiento()');
  assert.equal(al.length, 1);
  assert.equal(al[0].dias, 3);
  assert.equal(al[0].vence, vence);
});

test('control de frescura · el lote que vence primero manda, aunque haya llegado después', () => {
  const a = cargarApp();
  const pronto = a.run('sumarDias(hoy(), 2)'), tarde = a.run('sumarDias(hoy(), 40)');
  const b = cargarApp({ seed: sembrar({ products: [leche({ stock: 20 })], entradas: [entradaLeche(pronto, { id: 1700000000000011, fecha: '2026-11-10' }), entradaLeche(tarde, { id: 1700000000000012, fecha: '2026-11-02' })] }) });
  assert.equal(b.run('alertasVencimiento()')[0].dias, 2);
});

test('control de frescura · un producto «sin control» nunca alerta', () => {
  const a = cargarApp({ seed: sembrar({ products: [leche({ control: 'ninguno' })], entradas: [entradaLeche('2020-01-01')] }) });
  assert.equal(a.run('alertasVencimiento()').length, 0);
});

test('formulario adaptativo · la compra pide días en granja, vencimiento o nada según el producto', () => {
  const b = cargarApp({ seed: sembrar({ products: [prod(), leche(), prod({ id: 'panela', name: 'Panela', control: 'ninguno' })] }) });
  b.run("navegar('comprar')");
  const mostrar = id => {
    // el arnés no despacha eventos: se llama al escucha de «change» registrado por la vista
    b.run(`$('#e-prod').value = '${id}'; $('#e-prod').listeners.change.forEach(f => f())`);
    return b.run("[$('#e-b-granja').hidden, $('#e-b-vence').hidden].join(',')");
  };
  assert.equal(mostrar('campo'), 'false,true');
  assert.equal(mostrar('leche'), 'true,false');
  assert.equal(mostrar('panela'), 'true,true');
});

test('respaldo · una fecha de vencimiento inválida descarta la entrada, no rompe la app', () => {
  const a = cargarApp({ seed: sembrar({ products: [leche()], entradas: [entradaLeche('2026-13-45')] }) });
  assert.equal(a.run('entradas.length'), 0);
});

test('lista de precios · solo productos con existencias y precio, con el precio fijo primero', () => {
  const a = cargarApp({ seed: sembrar({ products: [prod({ stock: 5, price: 600 }), leche({ stock: 0, price: 3500 }), prod({ id: 'x', name: 'Sin precio', stock: 5 })] }) });
  const t = a.run('textoListaPrecios()');
  assert.match(t, /Huevo de Campo: \$18\.000 el panal de 30 \(\$600 c\/u\)/);
  assert.ok(!t.includes('Leche') && !t.includes('Sin precio'));
});

test('iPhone · la fila con fecha de llegada y días en granja pasa a una columna y los campos de fecha pueden encogerse', () => {
  const fs = require('node:fs'), path = require('node:path');
  const a = cargarApp({ seed: sembrar({ products: [prod()] }) });
  assert.match(a.run('VISTAS.comprar()'), /<div class="row2 fechas">\s*<label class="field"><span>Fecha de llegada/);
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'app.css'), 'utf8');
  assert.match(css, /\.row2 > \* \{ min-width: 0; \}/, 'las celdas de la rejilla deben poder encogerse');
  assert.match(css, /\.field input\[type="date"\][^}]*-webkit-appearance: none/, 'iOS: el campo de fecha no debe imponer su ancho');
  assert.match(css, /@media \(max-width: 440px\) \{ \.row2\.fechas \{ grid-template-columns: 1fr; \} \}/);
});
