'use strict';
/* Arnés de pruebas: carga js/app.js (y sw.js) en node:vm con un DOM mínimo simulado.
   Sin dependencias: se ejecuta con `node --test tests/`. */
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');

class El {
  constructor(tag = 'stub') {
    this.tagName = tag; this.children = []; this.dataset = {}; this.attrs = {}; this.listeners = {};
    this.className = ''; this.innerHTML = ''; this.textContent = ''; this.value = ''; this.hidden = false;
    this.parent = null; this._q = {}; this.style = {};
    this.classList = { add() {}, remove() {}, contains: () => false };
  }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter(x => x !== this); this.parent = null; } }
  querySelector(sel) { return (this._q[sel] ||= new El('stub')); }
  querySelectorAll() { return []; }
  closest() { return null; }
  focus() {}
  click() { if (this.tagName === 'a' && this.owner) this.owner.descargas.push({ download: this.download, href: this.href }); }
}

function cargarApp({ seed = {}, fallarDesde = null, protocol = 'file:', serviceWorker, caches, fetch } = {}) {
  const store = new Map(Object.entries(seed).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  let umbral = fallarDesde, llamadas = 0;
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { llamadas++; if (umbral !== null && llamadas >= umbral) throw new Error('QuotaExceededError'); store.set(k, String(v)); },
    removeItem: k => { store.delete(k); },
  };
  const estado = { descargas: [], recargas: 0 };
  const body = new El('body');
  const globales = {};
  const doc = {
    body,
    listeners: {},
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); },
    createElement(tag) { const e = new El(tag); e.owner = estado; return e; },
    querySelector(sel) {
      if (sel.startsWith('.')) return body.children.find(c => c.className.split(' ').includes(sel.slice(1))) || null;
      return (globales[sel] ||= new El('stub'));
    },
    querySelectorAll(sel) { return sel.startsWith('.') ? body.children.filter(c => c.className.split(' ').includes(sel.slice(1))) : []; },
  };
  const ventana = { listeners: {}, scrollY: 0, addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }, scrollTo() {}, open() {}, print() {} };
  let hash = '';
  const location = { protocol, reload() { estado.recargas++; } };
  Object.defineProperty(location, 'hash', {
    get: () => hash,
    set: v => { hash = v; (ventana.listeners.hashchange || []).forEach(f => f()); },
  });
  class FakeFR { readAsText(f) { setTimeout(() => { this.result = f.__texto; this.onload(); }, 0); } }
  const timer = (f, ms) => { const t = setTimeout(f, ms); if (t.unref) t.unref(); return t; };
  const sandbox = {
    document: doc, window: ventana, localStorage, location, console,
    navigator: { serviceWorker }, matchMedia: () => ({ matches: false }),
    setTimeout: timer, clearTimeout, Blob, File, URL, Event, FileReader: FakeFR, caches, fetch,
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js', 'app.js'), 'utf8'), ctx, { filename: 'app.js' });

  const api = {
    store, doc, ventana, location, estado, ctx,
    run: code => vm.runInContext(code, ctx),
    ev: code => JSON.parse(vm.runInContext(`JSON.stringify((${code}))`, ctx) ?? 'null'),
    q: sel => doc.querySelector(sel),
    fallarDesde(n) { llamadas = 0; umbral = n; },
    sinFallos() { umbral = null; },
    estadoMem: () => api.ev('({ products, entradas, ventas, clientes, ajustes, config })'),
    toasts: () => doc.querySelectorAll('.toast').map(t => ({ texto: t.textContent, error: t.className.includes('error') })),
    hoja: () => doc.querySelector('.sheet-wrap'),
    ir(v) { location.hash = '#/' + v; },
    recargar: () => cargarApp({ seed: Object.fromEntries(store), protocol, serviceWorker, caches }),
  };
  return api;
}

const esperar = (ms = 5) => new Promise(r => setTimeout(r, ms));

/* Responde la confirmación abierta (si la hay). Devuelve true si había una. */
async function responder(a, ok = true) {
  await esperar();
  const w = a.hoja(); if (!w) return false;
  const b = w.querySelector('.sheet-body');
  (b.listeners.click || []).forEach(f => f({ target: { closest: () => ({ dataset: { r: ok ? '1' : '0' } }) } }));
  await esperar();
  return true;
}

const prod = (o = {}) => ({ id: 'campo', name: 'Huevo de Campo', unit: 'unidades', cost: 0, price: 0, stock: 0, lastCost: 0, control: 'granja', ...o });
const sembrar = ({ products = [prod()], entradas = [], ventas = [], clientes = [], ajustes = [], proveedores = [], config = {} } = {}) => (proveedores.length
  // con proveedores se siembra el guardado único actual (eg_db); sin ellos, las claves por colección de la versión anterior
  ? { eg_db: { products, entradas, ventas, clientes, ajustes, proveedores, config } }
  : { eg_products: products, eg_entradas: entradas, eg_ventas: ventas, eg_clientes: clientes, eg_ajustes: ajustes, eg_config: config });

/* Llena el formulario de venta y lo envía. */
async function enviarVenta(a, { cant = '1', precio = '10', pago = 'contado', cli = '', abono = '', fecha = '2026-11-11' } = {}) {
  a.ir('vender');
  a.q('#v-prod').value = 'campo'; a.q('#v-cant').value = cant; a.q('#v-precio').value = precio;
  a.q('#v-cli').value = cli; a.q('#v-fecha').value = fecha; a.q('#v-abono').value = abono;
  const f = a.q('#f-venta');
  f._q['input[name=pago]:checked'] = { value: pago };
  const h = f.listeners.submit[0];
  await h({ preventDefault() {} });
  await esperar();
}

/* Service worker */
function cargarSW({ red, almacen = new Map(), fallarAdd = [] } = {}) {
  const clave = r => (typeof r === 'string' ? r : new URL(r.url).pathname.replace(/^\//, ''));
  const cache = {
    add: async u => { if (fallarAdd.includes(u)) throw new Error('404 ' + u); almacen.set(clave(u), new Response('copia:' + u)); },
    addAll: us => Promise.all(us.map(u => cache.add(u))),
    match: async r => { const v = almacen.get(clave(r)); return v ? v.clone() : undefined; },
    put: async (r, res) => { almacen.set(clave(r), res); },
  };
  const cachesFake = { open: async () => cache, match: (r, o) => cache.match(r, o), keys: async () => [], delete: async () => true };
  const escuchas = {};
  const self = { location: { origin: 'http://x' }, addEventListener: (t, f) => { escuchas[t] = f; }, skipWaiting: async () => {}, clients: { claim: async () => {} } };
  const sandbox = { self, caches: cachesFake, fetch: red || (async () => { throw new Error('sin red'); }), URL, Response, Promise, console };
  vm.runInContext(fs.readFileSync(path.join(RAIZ, 'sw.js'), 'utf8'), vm.createContext(sandbox), { filename: 'sw.js' });
  const evento = extra => { const e = { esperas: [], waitUntil(p) { this.esperas.push(p); }, respondWith(p) { this.resp = p; }, ...extra }; return e; };
  return {
    almacen, escuchas,
    async instalar() { const e = evento(); escuchas.install(e); await Promise.all(e.esperas); },
    async pedir(req) { const e = evento({ request: req }); escuchas.fetch(e); const r = await e.resp; await Promise.all(e.esperas); return r; },
  };
}

module.exports = { cargarApp, cargarSW, esperar, responder, prod, sembrar, enviarVenta, RAIZ };
