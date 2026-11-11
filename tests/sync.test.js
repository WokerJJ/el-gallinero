'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cargarApp, esperar, responder, prod, sembrar } = require('./arnes');

const URL_OK = 'https://script.google.com/macros/s/AKfycbx_abc-123/exec';
const venta = { id: 1700000000000001, productoId: 'campo', cantidad: 2, descontado: 2, precio: 10, total: 20, costoUnitario: 5, ganancia: 10, fecha: '2026-11-01', clienteId: null, tipoPago: 'contado', pagado: 20, abonos: [] };

/* Un «Google Sheet» falso: guarda lo que recibe y responde como el script. */
function sheetFalso({ remoto = null, falla = null } = {}) {
  const llamadas = [];
  let guardado = remoto;
  const fetch = async (url, op) => {
    const cuerpo = JSON.parse(op.body);
    llamadas.push({ url, cuerpo, op });
    if (falla) throw new Error(falla);
    const ok = x => ({ json: async () => x });
    if (cuerpo.accion === 'ping') return ok(guardado ? { ok: true, tieneDatos: true, actualizado: '2026-11-01T10:00:00Z', ventas: JSON.parse(guardado).ventas.length, clientes: 0 } : { ok: true, tieneDatos: false });
    if (cuerpo.accion === 'guardar') { guardado = JSON.stringify(cuerpo.datos); return ok({ ok: true }); }
    if (cuerpo.accion === 'leer') return ok({ ok: true, texto: guardado });
    return ok({ ok: false, error: 'Acción desconocida' });
  };
  return { fetch, llamadas, guardado: () => guardado };
}

test('Sheets · rechaza un enlace que no sea una aplicación web de Google y no envía nada', async () => {
  const s = sheetFalso();
  const a = cargarApp({ fetch: s.fetch });
  await a.run("conectarSheet('https://ejemplo.com/exec', 'clave-1')");
  await a.run("conectarSheet('https://script.google.com.evil.com/macros/s/abc/exec', 'clave-1')");
  assert.equal(s.llamadas.length, 0);
  assert.ok(a.toasts().at(-1).error);
});

test('Sheets · con el Sheet vacío conecta y envía todo; la clave no viaja dentro de los datos', async () => {
  const s = sheetFalso();
  const a = cargarApp({ fetch: s.fetch, seed: sembrar({ ventas: [venta] }) });
  await a.run(`conectarSheet('${URL_OK}', 'mi-clave')`);
  const guardar = s.llamadas.find(l => l.cuerpo.accion === 'guardar');
  assert.ok(guardar, 'debe enviar');
  assert.equal(guardar.cuerpo.clave, 'mi-clave');
  assert.equal(guardar.cuerpo.datos.app, 'el-gallinero');
  assert.equal(guardar.cuerpo.datos.ventas.length, 1);
  assert.equal(guardar.op.headers['Content-Type'], 'text/plain;charset=utf-8'); // sin preflight CORS
  assert.ok(!JSON.stringify(guardar.cuerpo.datos).includes('mi-clave'));
  assert.ok(a.store.get('eg_sync').includes(URL_OK));
  assert.ok(!a.store.get('eg_db').includes('mi-clave'), 'la clave no se guarda con los datos');
});

test('Sheets · enviar varias veces deja exactamente los mismos datos (sin duplicar)', async () => {
  const s = sheetFalso();
  const a = cargarApp({ fetch: s.fetch, seed: sembrar({ ventas: [venta] }) });
  await a.run(`conectarSheet('${URL_OK}', 'mi-clave')`);
  const primero = s.guardado();
  await a.run('enviarSheet(true)'); await a.run('enviarSheet(true)');
  assert.equal(s.guardado().length, primero.length);
  assert.equal(JSON.parse(s.guardado()).ventas.length, 1);
});

test('Sheets · teléfono vacío + Sheet con datos: restaura desde el Sheet', async () => {
  const origen = cargarApp({ seed: sembrar({ ventas: [venta] }) });
  const respaldo = JSON.stringify({ app: 'el-gallinero', version: 3, ...origen.estadoMem() });
  const s = sheetFalso({ remoto: respaldo });
  const a = cargarApp({ fetch: s.fetch });
  const p = a.run(`conectarSheet('${URL_OK}', 'mi-clave')`);
  await esperar(30);
  await responder(a, true); // «Restaurar respaldo» pide confirmación
  await p;
  assert.equal(a.run('ventas.length'), 1);
  assert.equal(a.run('sync.listo'), true);
  assert.ok(!s.llamadas.some(l => l.cuerpo.accion === 'guardar'), 'no debe pisar el Sheet al restaurar');
});

test('Sheets · si la restauración se cancela, no queda conectado', async () => {
  const origen = cargarApp({ seed: sembrar({ ventas: [venta] }) });
  const s = sheetFalso({ remoto: JSON.stringify({ app: 'el-gallinero', version: 3, ...origen.estadoMem() }) });
  const a = cargarApp({ fetch: s.fetch });
  const p = a.run(`conectarSheet('${URL_OK}', 'mi-clave')`);
  await esperar(30);
  await responder(a, false);
  await p;
  assert.equal(a.run('sync'), null);
  assert.equal(a.run('ventas.length'), 0);
});

test('Sheets · un fallo de red deja el cambio pendiente y no impide guardar', async () => {
  const s = sheetFalso({ falla: 'Failed to fetch' });
  const a = cargarApp({
    fetch: s.fetch,
    seed: { ...sembrar(), eg_sync: { url: URL_OK, clave: 'k-clave', listo: true, pendiente: false, ultimo: null, error: '' } },
  });
  assert.equal(a.run('aplicar(() => { config.margen = 30; }, "")'), true, 'guardar funciona sin internet');
  assert.equal(a.run('sync.pendiente'), true);
  assert.equal(await a.run('enviarSheet(true)'), false);
  assert.match(a.run('sync.error'), /conexión|publicado/);
  assert.equal(JSON.parse(a.store.get('eg_sync')).pendiente, true);
});

test('Sheets · arrancar con una conexión guardada dañada no rompe la app', () => {
  const a = cargarApp({ seed: { ...sembrar(), eg_sync: '{no es json' } });
  assert.equal(a.run('sync'), null);
  const b = cargarApp({ seed: { ...sembrar(), eg_sync: { url: 'https://ejemplo.com/exec', clave: 'x', listo: true } } });
  assert.equal(b.run('sync'), null, 'una URL ajena a Google se descarta');
});

test('Sheets · con la conexión lista, cada guardado programa el envío', () => {
  const s = sheetFalso();
  const a = cargarApp({
    fetch: s.fetch,
    seed: { ...sembrar(), eg_sync: { url: URL_OK, clave: 'k-clave', listo: true, pendiente: false, ultimo: null, error: '' } },
  });
  assert.equal(a.run('sync.pendiente'), false);
  a.run('aplicar(() => { config.alerta = 60; }, "")');
  assert.equal(a.run('sync.pendiente'), true);
});

test('Sheets · el script copia las pestañas sin fórmulas peligrosas y exige la clave', () => {
  const fs = require('node:fs'), path = require('node:path');
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  assert.match(codigo, /\^\[=\+\\-@\]/, 'neutraliza = + - @ al inicio');
  assert.match(codigo, /p\.clave !== CLAVE/);
  assert.match(codigo, /CAMBIA-ESTA-CLAVE/);
});
