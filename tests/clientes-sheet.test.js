'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cargarApp, esperar, responder, sembrar } = require('./arnes');

const URL_OK = 'https://script.google.com/macros/s/AKfycbx_abc-123/exec';
const conectado = { eg_sync: { url: URL_OK, clave: 'k-clave', listo: true, pendiente: false, ultimo: null, error: '' } };
const cli = (o = {}) => ({ id: 'c1', nombre: 'Ana Gómez', telefono: '3001234567', notas: '', ...o });

function combinar(actuales, filas) {
  const a = cargarApp();
  a.run('globalThis.__act = ' + JSON.stringify(actuales) + '; globalThis.__filas = ' + JSON.stringify(filas));
  return a.ev('combinarClientes(__act, __filas)');
}

test('clientes · el mismo teléfono con otro formato no se duplica (+57, espacios, guiones)', () => {
  const r = combinar([cli()], [['Ana G.', '+57 300-123-4567', ''], ['Ana', '(300) 123 4567', '']]);
  assert.equal(r.agregados, 0);
  assert.equal(r.iguales, 2);
  assert.equal(r.lista.length, 1);
});

test('clientes · dos personas con el mismo nombre y teléfonos distintos son dos clientes', () => {
  const r = combinar([cli({ nombre: 'Juan', telefono: '3001111111' })], [['Juan', '3002222222', '']]);
  assert.equal(r.agregados, 1);
  assert.equal(r.lista.length, 2);
});

test('clientes · mismo nombre sin tildes ni mayúsculas, sin teléfono, es el mismo cliente', () => {
  const r = combinar([cli({ nombre: 'José Pérez', telefono: '' })], [['JOSE perez', '', '']]);
  assert.equal(r.agregados, 0);
  assert.equal(r.lista.length, 1);
});

test('clientes · completa teléfono y notas que faltaban, sin pisar lo que ya había', () => {
  const r = combinar([cli({ nombre: 'Luz', telefono: '', notas: 'Plaza' })], [['Luz', '3105556677', 'otra nota']]);
  assert.equal(r.actualizados, 1);
  assert.equal(r.lista[0].telefono, '3105556677');
  assert.equal(r.lista[0].notas, 'Plaza', 'no se pisa una nota existente');
});

test('clientes · filas sin nombre se omiten y los ids nuevos nunca se repiten', () => {
  const filas = [['', '3001', ''], [null], 'basura'];
  for (let i = 0; i < 600; i++) filas.push([`Cliente ${i}`, `31000${String(i).padStart(5, '0')}`, '']);
  const r = combinar([], filas);
  assert.equal(r.omitidos, 3);
  assert.equal(r.agregados, 600);
  assert.equal(new Set(r.lista.map(c => c.id)).size, 600);
});

test('clientes · repetidos dentro de la misma hoja tampoco se duplican', () => {
  const r = combinar([], [['Pedro', '3201112233', ''], ['Pedro R.', '320 111 2233', ''], ['pedro', '', '']]);
  assert.equal(r.agregados, 1);
  assert.equal(r.lista.length, 1);
});

async function traer(a) {
  const p = a.run('traerClientesDelSheet()');
  await esperar(30);
  await responder(a, true); // pide confirmación antes de traer
  await p;
}

test('clientes · traer del Sheet agrega los nuevos y repetir la acción no duplica', async () => {
  const filas = [['Ana Gómez', '300 123 4567', ''], ['Tienda Doña Rosa', '3109998877', 'Plaza'], ['', '', '']];
  const fetch = async (u, op) => ({ json: async () => (JSON.parse(op.body).accion === 'clientes' ? { ok: true, filas } : { ok: true }) });
  const a = cargarApp({ fetch, seed: { ...sembrar({ clientes: [cli()] }), ...conectado } });
  await traer(a);
  assert.equal(a.run('clientes.length'), 2);
  await a.run('traerClientesDelSheet()'); // segunda vez: nada nuevo, no pide confirmar
  assert.equal(a.run('clientes.length'), 2);
  assert.match(a.toasts().at(-1).texto, /Sin cambios/);
});

test('clientes · si cancelas la confirmación no se agrega nada', async () => {
  const fetch = async () => ({ json: async () => ({ ok: true, filas: [['Nuevo', '3001234000', '']] }) });
  const a = cargarApp({ fetch, seed: { ...sembrar(), ...conectado } });
  const p = a.run('traerClientesDelSheet()');
  await esperar(30);
  await responder(a, false);
  await p;
  assert.equal(a.run('clientes.length'), 0);
});

test('clientes · sin conexión lista no hace nada', async () => {
  const a = cargarApp({ seed: sembrar() });
  await a.run('traerClientesDelSheet()');
  assert.equal(a.run('clientes.length'), 0);
});

/* ---- Teléfonos (BUG-001) ---- */
const clave = t => { const a = cargarApp(); a.run('globalThis.__t = ' + JSON.stringify(t)); return a.ev('claveTel(__t)'); };

test('teléfono · extensión y varios números: se toma solo el primero', () => {
  assert.equal(clave('3001234567 ext 12'), clave('3001234567'));
  assert.equal(clave('3001234567 x45'), clave('3001234567'));
  assert.equal(clave('3001234567 / 3109998877'), clave('3001234567'));
  assert.equal(clave('3001234567; 3109998877'), clave('3001234567'));
  assert.notEqual(clave('3001234567'), '');
});

test('teléfono · +1 y +57 con los mismos 10 dígitos no son el mismo número', () => {
  assert.notEqual(clave('+1 305 300 1234'), clave('+57 305 300 1234'));
  assert.equal(clave('+57 305 300 1234'), clave('3053001234'));
});

test('teléfono · prefijo 00 57 equivale al número local y lo demasiado largo o corto no es teléfono', () => {
  assert.equal(clave('00 57 300 123 4567'), clave('3001234567'));
  assert.equal(clave('+57 300 123 4567'), clave('3001234567'));
  assert.equal(clave('1234567890123456'), '');
  assert.equal(clave('123456'), '');
  assert.equal(clave(null), '');
});

test('teléfono · notación científica y errores de hoja de cálculo no son teléfonos', () => {
  assert.equal(clave('3.00123E+11'), '');
  assert.equal(clave('#ERROR!'), '');
  assert.equal(clave('#N/A'), '');
});

test('clientes · un teléfono «#ERROR!» entra como cliente sin teléfono; nombre o notas con error se vacían', () => {
  const r = combinar([], [['Ana', '#ERROR!', '#REF!'], ['#N/A', '3001234567', ''], ['Luis', '3.1E+11', '#VALUE!']]);
  assert.equal(r.agregados, 2);
  assert.equal(r.omitidos, 1);
  assert.deepEqual(r.lista.map(c => [c.nombre, c.telefono, c.notas]), [['Ana', '', ''], ['Luis', '', '']]);
});

/* ---- Ambigüedad por nombre (EVA-003) ---- */
test('clientes · si varios clientes sin teléfono tienen ese nombre, no se fusiona con ninguno y se cuenta', () => {
  const act = [cli({ id: 'a', nombre: 'Juan', telefono: '' }), cli({ id: 'b', nombre: 'juan', telefono: '' })];
  const r = combinar(act, [['Juan', '', 'nota'], ['Juan', '3105556677', '']]);
  assert.equal(r.ambiguos, 2);
  assert.equal(r.agregados, 0);
  assert.equal(r.actualizados, 0);
  assert.deepEqual(r.lista, act);
});

test('clientes · con un único candidato sin teléfono sí se fusiona; con teléfono distinto del que ya tiene, no', () => {
  const r = combinar([cli({ id: 'a', nombre: 'Juan', telefono: '' }), cli({ id: 'b', nombre: 'Juan', telefono: '3001111111' })], [['Juan', '3002222222', '']]);
  assert.equal(r.ambiguos, 0);
  assert.equal(r.actualizados, 1);
  assert.equal(r.lista.find(c => c.id === 'a').telefono, '3002222222');
  assert.equal(r.lista.length, 2);
});

test('clientes · un cliente existente sin nombre no rompe el índice', () => {
  const r = combinar([{ id: 'x', telefono: '3001234567' }], [['Ana', '3109998877', '']]);
  assert.equal(r.agregados, 1);
});

/* ---- Tope, truncado y versión vieja del script (BUG-005, EVA-007) ---- */
test('clientes · si el script avisa que truncó, la app lo dice', async () => {
  const filas = [['Ana', '3001234567', '']];
  const fetch = async () => ({ json: async () => ({ ok: true, filas, truncado: true, max: 5000 }) });
  const a = cargarApp({ fetch, seed: { ...sembrar(), ...conectado } });
  const p = a.run('traerClientesDelSheet()');
  await esperar(30);
  const w = a.hoja();
  assert.match(w.innerHTML, /primeras 5000 filas/);
  await responder(a, false);
  await p;
});

test('clientes · el script viejo («Acción desconocida») recibe una guía para actualizarlo', async () => {
  const fetch = async () => ({ json: async () => ({ ok: false, error: 'Acción desconocida' }) });
  const a = cargarApp({ fetch, seed: { ...sembrar(), ...conectado } });
  await a.run('traerClientesDelSheet()');
  assert.match(a.toasts().at(-1).texto, /versión anterior.*Nueva versión/);
});

test('clientes · el aviso de confirmación incluye los ambiguos', async () => {
  const act = [cli({ id: 'a', nombre: 'Juan', telefono: '' }), cli({ id: 'b', nombre: 'Juan', telefono: '' })];
  const filas = [['Juan', '', ''], ['Nuevo', '3001230000', '']];
  const fetch = async () => ({ json: async () => ({ ok: true, filas }) });
  const a = cargarApp({ fetch, seed: { ...sembrar({ clientes: act }), ...conectado } });
  const p = a.run('traerClientesDelSheet()');
  await esperar(30);
  assert.match(a.hoja().innerHTML, /1 fila\(s\) ambiguo/);
  await responder(a, false);
  await p;
});

/* ---- Exportación CSV (BUG-004) ---- */
test('csv · un texto que parece fórmula se neutraliza y los números no se tocan', () => {
  const a = cargarApp();
  const apos = '"' + "'";
  assert.ok(a.run("csvCelda('=1+1')").startsWith(apos));
  for (const t of ['+1', '-1', '@x', '\tx', '\rx']) assert.ok(a.run(`csvCelda(${JSON.stringify(t)})`).startsWith(apos), JSON.stringify(t));
  assert.equal(a.run('csvCelda(-5)'), '"-5"');
  assert.equal(a.run("csvCelda('Huevo AA')"), '"Huevo AA"');
});
