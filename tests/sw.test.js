'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cargarSW } = require('./arnes');

const req = (path, mode = 'no-cors') => ({ url: 'http://x/' + path, method: 'GET', mode });

test('BUG-008 · la instalación tolera que falle un archivo', async () => {
  const sw = cargarSW({ fallarAdd: ['icons/logo-96.png'] });
  await sw.instalar();
  assert.ok(sw.almacen.has('js/app.js'));
});
test('BUG-008 · sin red, solo las navegaciones caen a index.html', async () => {
  const sw = cargarSW();
  sw.almacen.set('index.html', new Response('INDEX'));
  const nav = await sw.pedir(req('otra/ruta', 'navigate'));
  assert.equal(await nav.text(), 'INDEX');
  const img = await sw.pedir(req('icons/no-existe.png')).catch(() => null);
  assert.ok(!img || (await img.text()) !== 'INDEX', 'un recurso no debe responder con index.html');
});
test('EVA-003 · stale-while-revalidate: responde del caché y actualiza en segundo plano', async () => {
  const sw = cargarSW({ red: async () => new Response('nuevo') });
  sw.almacen.set('js/app.js', new Response('viejo'));
  const r = await sw.pedir(req('js/app.js'));
  assert.equal(await r.text(), 'viejo');
  assert.equal(await sw.almacen.get('js/app.js').text(), 'nuevo');
});
