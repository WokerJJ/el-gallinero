'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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

test('script · lee «Importar clientes» y ya no borra pestañas completas', () => {
  const g = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  assert.match(g, /accion === 'clientes'/);
  assert.match(g, /getSheetByName\('Importar clientes'\)/);
  assert.ok(!/\.clearContents\(\)/.test(g.replace(/h\.clearContents\(\);\s*\n\s*const trozos/, '')), 'no debe limpiar la hoja entera (rompería las fórmulas y paneles del usuario)');
});
