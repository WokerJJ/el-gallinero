'use strict';
/* Sincronización por turnos (ADR 0003): al abrir la app se carga del Sheet si otro guardó y aquí no hay nada sin enviar;
   cada envío lleva la versión cargada y el script rechaza (conflicto) en vez de pisar; cerrar la caja envía de forma obligatoria.
   El Sheet falso lleva la cuenta de versiones como lo hace el script. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { cargarApp, esperar, prod, sembrar } = require('./arnes');

const URL_OK = 'https://script.google.com/macros/s/AKfycbx_abc-123/exec';
const TOKEN = 't'.repeat(64);
const venta = { id: 1700000000000001, productoId: 'campo', cantidad: 2, descontado: 2, precio: 10, total: 20, costoUnitario: 5, ganancia: 10, fecha: '2026-11-01', clienteId: null, tipoPago: 'contado', pagado: 20, abonos: [] };
const venta2 = { ...venta, id: 1700000000000002, cantidad: 5, descontado: 5, total: 50, ganancia: 25 };
const remoto = ventas => ({ app: 'el-gallinero', version: 3, ...cargarApp({ seed: sembrar({ ventas }) }).estadoMem() });

function sheetVivo({ datos = null, version = 'v1', soporta = true } = {}) {
  let texto = datos ? JSON.stringify(datos) : null, ver = version, n = 10;
  const s = { falla: false, llamadas: [], retraso: null, retrasoGuardar: null }; // retraso: promesa que hace esperar a «leer»
  s.fetch = async (url, op) => {
    const c = JSON.parse(op.body);
    s.llamadas.push(c);
    const ok = x => ({ json: async () => x });
    if (c.accion === 'login') return c.usuario === 'luis' && c.pin === '4829' ? ok({ ok: true, token: TOKEN, vence: '2099-01-01T00:00:00.000Z', empleado: { id: 'e1', usuario: 'luis', nombre: 'Luis Pérez' } }) : ok({ ok: false, error: 'Usuario o PIN incorrecto, o la cuenta está bloqueada' });
    if (c.accion === 'yo') return ok({ ok: true, rol: c.token ? 'empleado' : 'dueno' });
    if (c.accion === 'ping') return ok(texto ? { ok: true, tieneDatos: true, ventas: 0, clientes: 0, actualizado: 'x', ...(soporta ? { version: ver } : {}) } : { ok: true, tieneDatos: false, ...(soporta ? { version: '' } : {}) });
    if (c.accion === 'leer' && s.retraso) await s.retraso;
    if (c.accion === 'leer') return texto ? ok({ ok: true, texto, ...(soporta ? { version: ver } : {}) }) : ok({ ok: false, error: 'El Sheet todavía no tiene datos guardados' });
    if (c.accion === 'guardar') {
      if (s.retrasoGuardar) { const r = s.retrasoGuardar; s.retrasoGuardar = null; await r; }
      if (s.falla) throw new Error('Failed to fetch');
      if (soporta && typeof c.base === 'string' && c.base !== ver) return ok({ ok: false, conflicto: true, error: 'El Sheet cambió desde tu última carga', version: ver });
      texto = JSON.stringify(c.datos); ver = 'v' + (++n);
      return ok({ ok: true, actualizado: 'y', ...(soporta ? { version: ver } : {}) });
    }
    return ok({ ok: false, error: 'Acción desconocida' });
  };
  s.estado = () => ({ texto, ver });
  s.poner = (d, v) => { texto = JSON.stringify(d); ver = v; };
  return s;
}
const sync0 = (o = {}) => ({ eg_sync: { url: URL_OK, clave: 'mi-clave', listo: true, pendiente: false, ultimo: null, base: 'v1', conflicto: false, error: '', ...o } });
const cuantas = (s, accion) => s.llamadas.filter(l => l.accion === accion).length;
const textoHoja = a => (a.hoja() ? a.hoja().innerHTML : '');
async function elegirOpcion(a, i) {
  await esperar();
  const b = a.hoja().querySelector('.sheet-body');
  (b.listeners.click || []).forEach(f => f({ target: { closest: () => ({ dataset: { i: String(i) } }) } }));
  await esperar();
}

/* ---------- al abrir ---------- */
test('al abrir · si otro guardó en el Sheet y aquí no hay nada sin enviar, se carga solo y no se reenvía', async () => {
  const s = sheetVivo({ datos: remoto([venta, venta2]), version: 'v2' });
  const a = cargarApp({ fetch: s.fetch, seed: { ...sembrar({ ventas: [venta] }), ...sync0({ base: 'v1' }) } });
  await esperar(60);
  assert.equal(a.run('ventas.length'), 2, 'trajo lo del Sheet');
  assert.equal(a.run('sync.base'), 'v2');
  assert.equal(a.run('sync.pendiente'), false);
  assert.equal(cuantas(s, 'guardar'), 0, 'lo recién cargado no se vuelve a enviar');
  assert.ok(a.store.has('eg_prev'), 'queda una copia de lo que había');
  assert.match(a.toasts().at(-1).texto, /al día desde el Sheet/);
});
test('al abrir · una venta registrada mientras llega la lectura del Sheet no se pierde: se pregunta (BUG-001)', async () => {
  const s = sheetVivo({ datos: remoto([venta, venta2]), version: 'v2' });
  let soltar; s.retraso = new Promise(r => { soltar = r; });
  const a = cargarApp({ fetch: s.fetch, seed: { ...sembrar({ ventas: [venta] }), ...sync0({ base: 'v1' }) } });
  await esperar(40);
  assert.equal(cuantas(s, 'leer'), 1, 'la lectura está en vuelo');
  a.run('aplicar(() => { ventas.push({ ...ventas[0], id: 1700000000000009 }); })');
  soltar();
  await esperar(60);
  assert.ok(a.run('ventas.some(v => v.id === 1700000000000009)'), 'la venta sigue ahí');
  assert.match(textoHoja(a), /El Sheet cambió/, 'se pregunta en vez de pisar');
  assert.equal(a.run('sync.pendiente'), true);
});
test('al abrir · si el Sheet no cambió desde la última carga no se lee nada', async () => {
  const s = sheetVivo({ datos: remoto([venta, venta2]), version: 'v1' });
  const a = cargarApp({ fetch: s.fetch, seed: { ...sembrar({ ventas: [venta] }), ...sync0({ base: 'v1' }) } });
  await esperar(60);
  assert.equal(cuantas(s, 'leer'), 0);
  assert.equal(a.run('ventas.length'), 1);
});
test('al abrir · con un Sheet vacío no se carga nada', async () => {
  const s = sheetVivo({ datos: null, version: '' });
  const a = cargarApp({ fetch: s.fetch, seed: { ...sembrar({ ventas: [venta] }), ...sync0({ base: '' }) } });
  await esperar(60);
  assert.equal(cuantas(s, 'leer'), 0);
  assert.equal(a.run('ventas.length'), 1);
});
test('al abrir · con cambios sin enviar y el Sheet cambiado pregunta y no pisa ni envía nada', async () => {
  const s = sheetVivo({ datos: remoto([venta, venta2]), version: 'v2' });
  const a = cargarApp({ fetch: s.fetch, seed: { ...sembrar({ ventas: [venta] }), ...sync0({ base: 'v1', pendiente: true }) } });
  await esperar(60);
  assert.match(textoHoja(a), /El Sheet cambió/);
  assert.equal(a.run('ventas.length'), 1, 'no se tocó');
  assert.equal(cuantas(s, 'leer'), 0);
  assert.equal(cuantas(s, 'guardar'), 0);
});
test('conflicto · elegir «los del Sheet» los carga y deja todo al día', async () => {
  const s = sheetVivo({ datos: remoto([venta, venta2]), version: 'v2' });
  const a = cargarApp({ fetch: s.fetch, seed: { ...sembrar({ ventas: [venta] }), ...sync0({ base: 'v1', pendiente: true }) } });
  await esperar(60);
  await elegirOpcion(a, 0);
  await esperar(40);
  assert.equal(a.run('ventas.length'), 2);
  assert.deepEqual([a.run('sync.base'), a.run('sync.pendiente'), a.run('sync.conflicto')], ['v2', false, false]);
  assert.ok(a.store.has('eg_prev'));
});
test('conflicto · elegir «los de este teléfono» los envía contra la versión vigente y el Sheet queda con ellos', async () => {
  const s = sheetVivo({ datos: remoto([venta, venta2]), version: 'v2' });
  const a = cargarApp({ fetch: s.fetch, seed: { ...sembrar({ ventas: [venta] }), ...sync0({ base: 'v1', pendiente: true }) } });
  await esperar(60);
  await elegirOpcion(a, 1);
  await esperar(40);
  const g = s.llamadas.find(l => l.accion === 'guardar');
  assert.equal(g.base, 'v2', 'se manda contra la versión que se vio');
  assert.equal(JSON.parse(s.estado().texto).ventas.length, 1);
  assert.equal(a.run('sync.base'), s.estado().ver);
  assert.equal(a.run('sync.conflicto'), false);
});
test('conflicto · «decidir después» deja el conflicto marcado y no se envía solo hasta decidir', async () => {
  const s = sheetVivo({ datos: remoto([venta, venta2]), version: 'v2' });
  const a = cargarApp({ fetch: s.fetch, seed: { ...sembrar({ ventas: [venta] }), ...sync0({ base: 'v1', pendiente: true }) } });
  await esperar(60);
  await elegirOpcion(a, 2);
  assert.equal(a.run('sync.conflicto'), true);
  a.run('programarSync()');
  assert.equal(await a.run('enviarSheet(false)'), false, 'el envío automático espera');
  assert.equal(cuantas(s, 'guardar'), 0);
  a.run('pintarEstadoSync()');
  assert.match(a.q('#sync-estado').textContent, /Sheet cambió.*Enviar ahora/, 'la pantalla de Google Sheets explica qué hacer');
});

/* ---------- al enviar ---------- */
test('enviar · lleva la versión cargada y guarda la que devuelve el script', async () => {
  const s = sheetVivo({ datos: remoto([venta]), version: 'v1' });
  const a = cargarApp({ fetch: s.fetch, seed: { ...sembrar({ ventas: [venta] }), ...sync0({ base: 'v1' }) } });
  await esperar(40);
  assert.equal(await a.run('enviarSheet(true)'), true);
  const g = s.llamadas.find(l => l.accion === 'guardar');
  assert.equal(g.base, 'v1');
  assert.equal(a.run('sync.base'), s.estado().ver);
  assert.notEqual(s.estado().ver, 'v1');
});
test('enviar · si otro guardó antes, se pregunta en vez de dar error ni reintentar en bucle', async () => {
  const s = sheetVivo({ datos: remoto([venta]), version: 'v1' });
  const a = cargarApp({ fetch: s.fetch, seed: { ...sembrar({ ventas: [venta] }), ...sync0({ base: 'v1' }) } });
  await esperar(40);
  s.poner(remoto([venta, venta2]), 'v9');                 // otro teléfono guardó
  assert.equal(await a.run('enviarSheet(true)'), false);
  await esperar(20);
  assert.match(textoHoja(a), /El Sheet cambió/);
  assert.equal(a.run('sync.error'), '', 'un conflicto no es un error de red');
  assert.equal(a.run('sync.conflicto'), true);
  assert.equal(cuantas(s, 'guardar'), 1, 'un solo intento');
  assert.equal(JSON.parse(s.estado().texto).ventas.length, 2, 'lo del otro teléfono sigue en el Sheet');
});
test('enviar · con un script anterior (sin versión) todo sigue funcionando como antes', async () => {
  const s = sheetVivo({ datos: remoto([venta]), version: 'v1', soporta: false });
  const a = cargarApp({ fetch: s.fetch, seed: { ...sembrar({ ventas: [venta] }), ...sync0({ base: '' }) } });
  await esperar(40);
  assert.equal(cuantas(s, 'leer'), 0, 'sin versión no hay nada que comparar');
  assert.equal(await a.run('enviarSheet(true)'), true);
  assert.equal(a.run('sync.base'), '');
});
test('abrir · sin internet o con un diálogo abierto no se toca nada', async () => {
  const s = sheetVivo({ datos: remoto([venta, venta2]), version: 'v2' });
  const a = cargarApp({ fetch: s.fetch, seed: { ...sembrar({ ventas: [venta] }), ...sync0({ base: 'v2' }) } });
  await esperar(40);
  s.poner(remoto([venta, venta2]), 'v3');
  const antes = s.llamadas.length;
  a.run('navigator.onLine = false');
  await a.run('sincronizarAlAbrir()');
  assert.equal(s.llamadas.length, antes, 'sin internet');
  a.run('navigator.onLine = true');
  a.run("hoja('Gasto', '<p>algo a medias</p>')");
  await a.run('sincronizarAlAbrir()');
  assert.equal(s.llamadas.length, antes, 'con un diálogo abierto no se cambia lo que se está haciendo');
});
test('abrir · tras un rato fuera de la app, al volver se mira el Sheet', async () => {
  const s = sheetVivo({ datos: remoto([venta]), version: 'v1' });
  const a = cargarApp({ fetch: s.fetch, seed: { ...sembrar({ ventas: [venta] }), ...sync0({ base: 'v1' }) } });
  await esperar(40);
  s.poner(remoto([venta, venta2]), 'v2');
  a.run("document.visibilityState = 'hidden'");
  (a.doc.listeners.visibilitychange || []).forEach(f => f());
  a.run('ocultoDesde = Date.now() - REPOSO_MS - 1000; document.visibilityState = "visible"');
  (a.doc.listeners.visibilitychange || []).forEach(f => f());
  await esperar(60);
  assert.equal(a.run('ventas.length'), 2);
});

/* ---------- cerrar la caja ---------- */
const mov = a => ({ id: 1700000000005000, fecha: a.run('hoy()'), tipo: 'ingreso', monto: 100000, concepto: 'Saldo inicial de la caja', origen: 'apertura', ref: null, refTipo: null, por: 'Dueño' });
function conCaja(s, extra = {}) {
  const base = cargarApp();
  return cargarApp({ fetch: s.fetch, seed: { ...sembrar({ products: [prod({ stock: 10, price: 10, cost: 5 })], movimientos: [mov(base)], config: { cajaActiva: true } }), ...sync0({ base: 'v1' }), ...extra } });
}
function cerrar(a, contado) {
  a.run('formCierreCaja()');
  const b = a.hoja().querySelector('.sheet-body');
  b.querySelector('#ci-contado').value = String(contado); b.querySelector('#ci-nota').value = '';
  return b.querySelector('#f-cierre').listeners.submit[0]({ preventDefault() {} });
}
test('cerrar la caja · envía al Sheet de forma obligatoria y el cierre viaja en los datos', async () => {
  const s = sheetVivo({ datos: remoto([]), version: 'v1' });
  const a = conCaja(s);
  await esperar(40);
  await cerrar(a, 100000);
  const g = s.llamadas.filter(l => l.accion === 'guardar');
  assert.equal(g.length, 1);
  assert.equal(g[0].datos.cierres.length, 1);
  assert.equal(a.run('sync.pendiente'), false);
  assert.equal(a.run('cierres.length'), 1);
});
test('cerrar la caja · si no llega al Sheet avisa con claridad; el cierre queda hecho y pendiente de enviar', async () => {
  const s = sheetVivo({ datos: remoto([]), version: 'v1' });
  const a = conCaja(s);
  await esperar(40);
  s.falla = true;
  const p = cerrar(a, 100000);
  await esperar(60);
  assert.match(textoHoja(a), /El cierre no llegó al Sheet/);
  await elegirOpcion(a, 0);
  await p;
  assert.equal(a.run('cierres.length'), 1, 'el cierre quedó registrado');
  assert.equal(a.run('sync.pendiente'), true, 'se reintentará solo');
  s.falla = false; // vuelve la red: el reintento envía el cierre
  assert.equal(await a.run('enviarSheet(false)'), true);
  assert.equal(a.run('sync.pendiente'), false);
  assert.equal(JSON.parse(s.estado().texto).cierres.length, 1);
});
test('cerrar la caja · si otro guardó antes, pregunta qué datos conservar en vez de pisar al otro', async () => {
  const s = sheetVivo({ datos: remoto([]), version: 'v1' });
  const a = conCaja(s);
  await esperar(40);
  s.poner(remoto([venta]), 'v9');
  cerrar(a, 100000);
  await esperar(80);
  assert.match(textoHoja(a), /El Sheet cambió/);
  assert.ok(!/El cierre no llegó/.test(textoHoja(a)));
  assert.equal(JSON.parse(s.estado().texto).ventas.length, 1, 'lo del otro teléfono sigue ahí');
  await elegirOpcion(a, 2);
  assert.equal(a.run('cierres.length'), 1);
});
test('cerrar la caja · sin Google Sheets conectado funciona igual que siempre, sin avisos de envío', async () => {
  const a = cargarApp({ seed: sembrar({ products: [prod()], movimientos: [mov(cargarApp())], config: { cajaActiva: true } }) });
  await cerrar(a, 100000);
  assert.equal(a.run('cierres.length'), 1);
  assert.ok(!a.hoja(), 'ningún diálogo de envío');
});

/* ---------- el teléfono del empleado ---------- */
test('empleado · al entrar sincroniza con su token (nunca con la clave) y carga los datos del negocio', async () => {
  const s = sheetVivo({ datos: remoto([venta, venta2]), version: 'v5' });
  const a = cargarApp({ fetch: s.fetch, seed: { eg_acceso: { exigir: true, url: URL_OK, sesion: null } } });
  await a.run("entrarEmpleado('', 'luis', '4829')");
  await esperar(60);
  assert.equal(a.run('ventas.length'), 2, 'el teléfono nuevo carga lo del Sheet');
  assert.equal(a.run('sync.clave'), '', 'el empleado no tiene la clave');
  assert.equal(a.run('sync.base'), 'v5');
  const sync = s.llamadas.filter(l => ['ping', 'leer', 'guardar'].includes(l.accion));
  assert.ok(sync.length >= 2);
  for (const l of sync) { assert.equal(l.token, TOKEN, l.accion); assert.ok(!('clave' in l), l.accion); }
});
test('empleado · lo que vende en su teléfono se envía con su token, y sin sesión no se envía nada', async () => {
  const s = sheetVivo({ datos: remoto([venta]), version: 'v1' });
  const a = cargarApp({ fetch: s.fetch, seed: { eg_acceso: { exigir: true, url: URL_OK, sesion: null } } });
  await a.run("entrarEmpleado('', 'luis', '4829')");
  await esperar(60);
  await a.run('enviarSheet(true)');
  const g = s.llamadas.filter(l => l.accion === 'guardar').at(-1);
  assert.equal(g.token, TOKEN);
  assert.equal(typeof g.base, 'string', 'también lleva la versión que cargó');
  await a.run('cerrarSesion()');
  assert.equal(a.run('credencial()'), null);
  const antes = cuantas(s, 'guardar');
  a.run('programarSync()');
  assert.equal(a.run('sync.pendiente'), true, 'sin sesión queda pendiente y no se envía nada');
  assert.equal(cuantas(s, 'guardar'), antes);
});

/* ---------- correcciones de la revisión ---------- */
const VENTA_NUEVA = 'aplicar(() => { ventas.push({ ...ventas[0], id: 1700000000000009 }); })';
test('al abrir · un teléfono que nunca sincronizó pero ya tiene datos pregunta antes de cargar encima (BUG-002)', async () => {
  const s = sheetVivo({ datos: remoto([venta, venta2]), version: 'v2' });
  const a = cargarApp({ fetch: s.fetch, seed: { ...sembrar({ ventas: [venta] }), ...sync0({ base: '', ultimo: null }) } });
  await esperar(60);
  assert.match(textoHoja(a), /El Sheet cambió/);
  assert.equal(a.run('ventas.length'), 1, 'no se tocó');
  assert.equal(cuantas(s, 'leer'), 0);
});
test('al abrir · un teléfono que nunca sincronizó y está vacío carga solo; el del dueño ya conectado (con último envío) también', async () => {
  const s = sheetVivo({ datos: remoto([venta, venta2]), version: 'v2' });
  const vacio = cargarApp({ fetch: s.fetch, seed: sync0({ base: '', ultimo: null }) });
  await esperar(60);
  assert.equal(vacio.run('ventas.length'), 2);
  assert.ok(!vacio.hoja());
  const conectado = cargarApp({ fetch: s.fetch, seed: { ...sembrar({ ventas: [venta] }), ...sync0({ base: '', ultimo: '2026-01-01T00:00:00.000Z' }) } });
  await esperar(60);
  assert.equal(conectado.run('ventas.length'), 2);
  assert.ok(!conectado.hoja());
});
test('enviar · si se guarda algo mientras viaja el envío, queda pendiente (no se da por enviado)', async () => {
  const s = sheetVivo({ datos: remoto([venta]), version: 'v1' });
  const a = cargarApp({ fetch: s.fetch, seed: { ...sembrar({ ventas: [venta] }), ...sync0({ base: 'v1' }) } });
  await esperar(40);
  let soltar; s.retrasoGuardar = new Promise(r => { soltar = r; });
  const p = a.run('enviarSheet(false)');
  a.run(VENTA_NUEVA);
  soltar();
  assert.equal(await p, true);
  assert.equal(a.run('sync.pendiente'), true, 'la venta nueva aún no está en el Sheet');
});
test('empleado · el dueño que entra en un teléfono creado por un empleado sincroniza con su clave (BUG-003)', async () => {
  const s = sheetVivo({ datos: remoto([venta]), version: 'v1' });
  const a = cargarApp({ fetch: s.fetch, seed: { eg_acceso: { exigir: true, url: URL_OK, sesion: null } } });
  await a.run("entrarEmpleado('', 'luis', '4829')");
  await esperar(60);
  await a.run('cerrarSesion()');
  a.run('pintarEstadoSync()');
  assert.match(a.q('#sync-estado').textContent, /Entra/, 'sin sesión la pantalla dice que hay que entrar');
  await a.run("entrarDueno('', 'mi-clave')");
  await esperar(60);
  assert.equal(a.run('sync.clave'), 'mi-clave');
  assert.equal(a.run('credencial().clave'), 'mi-clave');
  a.run(VENTA_NUEVA);
  assert.equal(await a.run('enviarSheet(false)'), true);
  const g = s.llamadas.filter(l => l.accion === 'guardar').at(-1);
  assert.equal(g.clave, 'mi-clave');
  assert.equal(JSON.parse(s.estado().texto).ventas.length, 2);
});
test('empleado · lo guardado sin sesión queda pendiente para enviarse al entrar', async () => {
  const s = sheetVivo({ datos: remoto([venta]), version: 'v1' });
  const a = cargarApp({ fetch: s.fetch, seed: { eg_acceso: { exigir: true, url: URL_OK, sesion: null } } });
  await a.run("entrarEmpleado('', 'luis', '4829')");
  await esperar(60);
  await a.run('cerrarSesion()');
  a.run('guardar()');
  assert.equal(a.run('sync.pendiente'), true);
});
test('conectar · si el Sheet ya tiene datos y se elige los de este teléfono, hay un solo diálogo y un solo guardado (EVA-006)', async () => {
  const s = sheetVivo({ datos: remoto([venta, venta2]), version: 'v4' });
  const a = cargarApp({ fetch: s.fetch, seed: sembrar({ ventas: [venta] }) });
  const p = a.run(`conectarSheet('${URL_OK}', 'mi-clave')`);
  await elegirOpcion(a, 1);
  await p;
  await esperar(40);
  assert.ok(!a.hoja(), 'no sale un segundo diálogo de conflicto');
  assert.equal(cuantas(s, 'guardar'), 1);
  assert.equal(JSON.parse(s.estado().texto).ventas.length, 1);
  assert.equal(a.run('sync.conflicto'), false);
});
test('conflicto · con otra hoja abierta no la reemplaza: el diálogo sale al cerrarla (BUG-004)', async () => {
  const s = sheetVivo({ datos: remoto([venta]), version: 'v1' });
  const a = cargarApp({ fetch: s.fetch, seed: { ...sembrar({ ventas: [venta] }), ...sync0({ base: 'v1' }) } });
  await esperar(40);
  s.poner(remoto([venta, venta2]), 'v9');
  a.run("hoja('Gasto', '<p>formulario a medias</p>')");
  assert.equal(await a.run('enviarSheet(false)'), false);
  await esperar(20);
  assert.match(textoHoja(a), /formulario a medias/, 'el formulario sigue');
  assert.ok(!/El Sheet cambió/.test(textoHoja(a)));
  assert.equal(a.run('sync.conflicto'), true, 'queda marcado');
  a.run('cerrarHoja()');
  await esperar(20);
  assert.match(textoHoja(a), /El Sheet cambió/);
});
test('conflicto · dos disparos seguidos abren un solo diálogo', async () => {
  const s = sheetVivo({ datos: remoto([venta]), version: 'v1' });
  const a = cargarApp({ fetch: s.fetch, seed: { ...sembrar({ ventas: [venta] }), ...sync0({ base: 'v1', pendiente: true }) } });
  await esperar(40);
  a.run('globalThis.__dialogos = 0; elegir = (orig => (...x) => { globalThis.__dialogos++; return orig(...x); })(elegir)');
  a.run("resolverConflicto('v9'); resolverConflicto('v9')");
  await esperar(20);
  assert.equal(a.run('globalThis.__dialogos'), 1);
});
test('cerrar la caja · con un envío automático en vuelo espera a que termine y reintenta, sin alarmar (BUG-005)', async () => {
  const s = sheetVivo({ datos: remoto([]), version: 'v1' });
  const a = conCaja(s);
  await esperar(40);
  let soltar; s.retrasoGuardar = new Promise(r => { soltar = r; });
  a.run('enviarSheet(false)');
  const p = cerrar(a, 100000);
  await esperar(30);
  soltar();
  await p;
  await esperar(30);
  assert.ok(!/El cierre no llegó/.test(textoHoja(a)), 'no hay falsa alarma');
  assert.equal(JSON.parse(s.estado().texto).cierres.length, 1, 'el cierre llegó al Sheet');
  assert.equal(a.run('sync.pendiente'), false);
});
test('cerrar la caja · si choca con el Sheet, el diálogo avisa de que «los del Sheet» perderían el cierre', async () => {
  const s = sheetVivo({ datos: remoto([]), version: 'v1' });
  const a = conCaja(s);
  await esperar(40);
  s.poner(remoto([venta]), 'v9');
  cerrar(a, 100000);
  await esperar(80);
  assert.match(textoHoja(a), /cierre de caja que acabas de hacer se perderá/);
});
test('enviar · tras un envío manual sin cambios nuevos no queda un segundo guardado programado (EVA-011)', async () => {
  const s = sheetVivo({ datos: remoto([venta]), version: 'v1' });
  const a = cargarApp({ fetch: s.fetch, seed: { ...sembrar({ ventas: [venta] }), ...sync0({ base: 'v1' }) } });
  await esperar(40);
  a.run(VENTA_NUEVA);
  assert.equal(await a.run('enviarSheet(true)'), true);
  await esperar(4400);
  assert.equal(cuantas(s, 'guardar'), 1, 'un solo guardado');
});
test('cargar · un respaldo del Sheet que no se puede aplicar avisa una sola vez por sesión en la carga automática (EVA-011)', async () => {
  const malo = { ...remoto([venta]), ventas: [{ id: 'x' }] };
  const s = sheetVivo({ datos: malo, version: 'v2' });
  const a = cargarApp({ fetch: s.fetch, seed: { ...sembrar({}), ...sync0({ base: 'v1' }) } });
  a.run('globalThis.__errores = 0; aviso = (o => (...x) => { if (x[1]) globalThis.__errores++; return o(...x); })(aviso)');
  await esperar(60);
  await a.run('traerDelSheet({ auto: true })');
  await a.run('traerDelSheet({ auto: true })');
  assert.equal(cuantas(s, 'leer'), 3, 'se intentó tres veces');
  assert.equal(a.run('globalThis.__errores'), 1, 'pero el aviso salió una sola vez');
});
test('cargar manual · mientras se espera la confirmación no se frena el envío de lo nuevo (EVA-011)', async () => {
  const s = sheetVivo({ datos: remoto([venta, venta2]), version: 'v2' });
  const a = cargarApp({ fetch: s.fetch, seed: { ...sembrar({ ventas: [venta] }), ...sync0({ base: 'v2' }) } });
  await esperar(40);
  const p = a.run('traerDelSheet()');
  await esperar(30);
  assert.match(textoHoja(a), /Restaurar/);
  assert.equal(a.run('sinEnviar'), false);
  a.run('cerrarHoja()');
  await p;
});
