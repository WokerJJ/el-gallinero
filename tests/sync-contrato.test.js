'use strict';
/* Contrato app <-> script (EVA-010): el fetch de la app se conecta al doPost REAL de apps-script/Code.gs (arnes-script.js),
   no a un Sheet falso escrito a mano. Si el script o la app cambian el contrato de versiones, estas pruebas lo detectan. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { cargarApp, esperar, sembrar } = require('./arnes');
const { cargarScript, post } = require('./arnes-script');

const URL_OK = 'https://script.google.com/macros/s/AKfycbx_abc-123/exec';
const CLAVE = 'mi-clave';
const venta = { id: 1700000000000001, productoId: 'campo', cantidad: 2, descontado: 2, precio: 10, total: 20, costoUnitario: 5, ganancia: 10, fecha: '2026-11-01', clienteId: null, tipoPago: 'contado', pagado: 20, abonos: [] };
const venta2 = { ...venta, id: 1700000000000002, cantidad: 5, descontado: 5, total: 50, ganancia: 25 };
const sync0 = (o = {}) => ({ eg_sync: { url: URL_OK, clave: CLAVE, listo: true, pendiente: false, ultimo: null, base: '', conflicto: false, error: '', ...o } });
// El fetch de la app llega al doPost real; el cuerpo se envía igual que por la red.
const conectar = s => async (_url, op) => { const r = post(s, JSON.parse(op.body)); return { json: async () => r }; };
const textoHoja = a => (a.hoja() ? a.hoja().innerHTML : '');
const guardadas = s => JSON.parse(post(s, { clave: CLAVE, accion: 'leer' }).texto).ventas.length;

async function conVentaDeA() {
  const s = cargarScript({ clave: CLAVE });
  const a = cargarApp({ fetch: conectar(s), seed: { ...sembrar({ ventas: [venta] }), ...sync0({ pendiente: true }) } });
  await esperar(60);
  await a.run('enviarSheet(true)');
  await esperar(20);
  return { s, a };
}

test('contrato · el teléfono A envía al script real y recibe una versión que el script reconoce', async () => {
  const { s, a } = await conVentaDeA();
  const real = post(s, { clave: CLAVE, accion: 'ping' }).version;
  assert.ok(real && real !== '', 'el script asignó versión');
  assert.equal(a.run('sync.base'), real);
  assert.equal(a.run('sync.pendiente'), false);
  assert.equal(guardadas(s), 1);
});

test('contrato · conflicto real: B con versión vieja no pisa lo de A y la app abre «El Sheet cambió»', async () => {
  const { s } = await conVentaDeA();
  const b = cargarApp({ fetch: conectar(s), seed: { ...sembrar({ ventas: [venta2] }), ...sync0({ base: 'v-vieja', pendiente: true }) } });
  await esperar(60);
  await b.run('enviarSheet(true)');
  await esperar(20);
  assert.match(textoHoja(b), /El Sheet cambió/);
  assert.equal(b.run('sync.conflicto'), true);
  assert.equal(guardadas(s), 1, 'lo de A sigue intacto');
  assert.equal(JSON.parse(post(s, { clave: CLAVE, accion: 'leer' }).texto).ventas[0].id, venta.id);
});

test('contrato · carga al abrir real: B sin cambios pendientes trae lo de A y su base es la versión del script', async () => {
  const { s } = await conVentaDeA();
  const b = cargarApp({ fetch: conectar(s), seed: { ...sembrar({ ventas: [] }), ...sync0({ base: 'v-vieja', pendiente: false }) } });
  await esperar(80);
  assert.equal(b.run('ventas.length'), 1, 'trajo lo que guardó A');
  assert.equal(b.run('sync.base'), post(s, { clave: CLAVE, accion: 'ping' }).version);
  assert.equal(b.run('sync.pendiente'), false);
});

test('contrato · empleado real: carga y guarda con su token contra el script y no puede traer clientes', async () => {
  const { s } = await conVentaDeA();
  assert.equal(post(s, { clave: CLAVE, accion: 'empleadoCrear', nombre: 'Luis Pérez', usuario: 'luis', pin: '4829' }).ok, true);
  const e = cargarApp({ fetch: conectar(s), seed: { eg_acceso: { exigir: true, url: URL_OK, sesion: null } } });
  await e.run("entrarEmpleado('', 'luis', '4829')");
  await esperar(80);
  assert.equal(e.run('ventas.length'), 1, 'cargó los datos del negocio con su token');
  assert.equal(e.run('sync.clave'), '');
  const antes = post(s, { clave: CLAVE, accion: 'ping' }).version;
  await e.run('enviarSheet(true)');
  await esperar(20);
  assert.notEqual(post(s, { clave: CLAVE, accion: 'ping' }).version, antes, 'el script aceptó y versionó el guardado del empleado');
  assert.equal(e.run('sync.pendiente'), false);
  assert.equal(e.run('sync.conflicto'), false);
  assert.equal(e.run('sync.base'), post(s, { clave: CLAVE, accion: 'ping' }).version, 'su guardado fue aceptado por el script');
  const token = e.run('empleadoActual().token');
  const r = post(s, { token, accion: 'clientes' });
  assert.equal(r.ok, false);
  assert.equal(r.prohibido, true);
});
