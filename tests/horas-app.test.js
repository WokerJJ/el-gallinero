'use strict';
/* Reloj de horas en la app (ADR 0005) contra el script REAL (arnes-script.js): el empleado ficha su entrada con su token, el dueño ve
   y corrige las horas, y el cierre de caja avisa a quién le marca la salida y la marca (con reintento si no hay red). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { cargarApp, esperar, responder, prod, sembrar } = require('./arnes');
const { cargarScript, post } = require('./arnes-script');

const URL_OK = 'https://script.google.com/macros/s/AKfycbx_abc-123/exec';
const CLAVE = 'mi-clave';
const MIN = 60000, HORA = 3600000;
const hace = ms => new Date(Date.now() - ms).toISOString();
const duenoPost = (s, c) => post(s, { clave: CLAVE, ...c });
const sync0 = (o = {}) => ({ eg_sync: { url: URL_OK, clave: CLAVE, listo: true, pendiente: false, ultimo: null, base: '', conflicto: false, turnosPorCerrar: [], error: '', ...o } });
const acceso0 = o => ({ eg_acceso: { exigir: true, url: URL_OK, sesion: null, ...o } });

// El fetch de la app llega al doPost real, y se anotan las llamadas (con la opción de hacer fallar algunas).
function red(s, falla = () => false) {
  const r = { llamadas: [], falla };
  r.fetch = async (_u, op) => {
    const c = JSON.parse(op.body);
    r.llamadas.push(c);
    if (r.falla(c)) throw new Error('Failed to fetch');
    const x = post(s, c);
    return { json: async () => x };
  };
  return r;
}
function mundo({ empleados = ['luis'] } = {}) {
  const s = cargarScript({ clave: CLAVE });
  const datos = { luis: ['Luis Pérez', '4829'], ana: ['Ana Gil', '7351'] };
  for (const u of empleados) duenoPost(s, { accion: 'empleadoCrear', nombre: datos[u][0], usuario: u, pin: datos[u][1] });
  return s;
}
const hojaF = s => s.libro.get('_fichajes');
const abiertos = s => duenoPost(s, { accion: 'turnosAbiertos' }).abiertos;
async function telefonoDeEmpleado(s, r = red(s), usuario = 'luis', pin = '4829') {
  const a = cargarApp({ fetch: r.fetch, seed: acceso0() });
  await a.run(`entrarEmpleado('', '${usuario}', '${pin}')`);
  await esperar(80);
  return { a, r };
}
const textoHoja = a => (a.hoja() ? a.hoja().innerHTML : '');

/* ---------- el empleado ---------- */
test('empleado · «Mi turno» aparece en su Inicio y al pulsar «Entrar a trabajar» abre el turno con la hora del servidor', async () => {
  const s = mundo();
  const { a } = await telefonoDeEmpleado(s);
  assert.match(a.run('VISTAS.inicio()'), /id="mi-turno"/);
  assert.match(a.run('htmlMiTurno()'), /Entrar a trabajar/);
  await a.run('ficharEntrada()');
  await esperar(60);
  assert.equal(abiertos(s).length, 1);
  assert.equal(abiertos(s)[0].nombre, 'Luis Pérez');
  assert.match(a.q('#mi-turno').innerHTML, /Trabajando desde las/);
  assert.match(a.q('#mi-turno').innerHTML, /Tu salida se marca cuando el dueño cierra la caja/);
  assert.ok(!/Entrar a trabajar/.test(a.run('htmlMiTurno()')), 'ya no se ofrece entrar de nuevo');
  assert.match(a.toasts().at(-1).texto, /Turno iniciado/);
});
test('empleado · fichar dos veces no abre otro turno y lo dice', async () => {
  const s = mundo();
  const { a } = await telefonoDeEmpleado(s);
  await a.run('ficharEntrada()'); await esperar(60);
  await a.run('ficharEntrada()'); await esperar(60);
  assert.equal(hojaF(s).getLastRow(), 2);
  assert.match(a.toasts().at(-1).texto, /Ya tenías un turno abierto/);
});
test('empleado · ficha con SU token y nunca con la clave, aunque el teléfono tenga guardada la del dueño', async () => {
  const s = mundo();
  const r = red(s);
  const a = cargarApp({ fetch: r.fetch, seed: { ...sembrar(), ...sync0(), ...acceso0() } });   // teléfono del dueño con un empleado entrando
  await a.run("entrarEmpleado('', 'luis', '4829')");
  await esperar(80);
  await a.run('ficharEntrada()'); await esperar(60);
  const f = r.llamadas.filter(l => l.accion === 'fichar' || l.accion === 'miTurno');
  assert.ok(f.length >= 2);
  for (const l of f) { assert.ok(l.token, l.accion); assert.ok(!('clave' in l), `${l.accion} no lleva la clave`); }
  assert.equal(abiertos(s).length, 1, 'y el script lo aceptó como empleado');
});
test('empleado · sin internet no ficha: la hora la pone el servidor', async () => {
  const s = mundo();
  const { a, r } = await telefonoDeEmpleado(s);
  const antes = r.llamadas.length;
  a.run('navigator.onLine = false');
  await a.run('ficharEntrada()');
  assert.equal(r.llamadas.length, antes, 'no se llamó al script');
  assert.match(a.toasts().at(-1).texto, /Necesitas internet para fichar/);
  assert.equal(a.toasts().at(-1).error, true);
  assert.equal(abiertos(s).length, 0);
});
test('empleado · con un script anterior al reloj lo explica en vez de quedarse cargando', async () => {
  const s = mundo();
  const r = red(s);
  r.fetch = async (_u, op) => { const c = JSON.parse(op.body); const x = ['miTurno', 'fichar'].includes(c.accion) ? { ok: false, error: 'Acción desconocida' } : post(s, c); return { json: async () => x }; };
  const { a } = await telefonoDeEmpleado(s, r);
  assert.match(a.run('htmlMiTurno()'), /anterior al reloj de horas/);
});
test('empleado · el dueño no ve la tarjeta «Mi turno» y un empleado no entra a la pantalla de horas', async () => {
  const s = mundo();
  const dueno = cargarApp({ fetch: red(s).fetch, seed: { ...sembrar(), ...sync0() } });
  assert.ok(!/id="mi-turno"/.test(dueno.run('VISTAS.inicio()')));
  const { a } = await telefonoDeEmpleado(s);
  a.ir('horas');
  assert.equal(a.run('vistaActual'), 'inicio');
  assert.equal(a.run("ACCIONES_DUENO.has('horas-corregir') && ACCIONES_DUENO.has('horas-agregar') && VISTAS_DUENO.has('horas')"), true, 'corregir, agregar y la pantalla son solo del dueño');
});

/* ---------- el dueño ---------- */
test('dueño · la pantalla Horas muestra a quien está trabajando y los totales del rango', async () => {
  const s = mundo({ empleados: ['luis', 'ana'] });
  await (await telefonoDeEmpleado(s)).a.run('ficharEntrada()');
  hojaF(s).celdas.set('2,4', hace(2 * HORA));                      // Luis entró hace 2 horas
  const r = red(s);
  const a = cargarApp({ fetch: r.fetch, seed: { ...sembrar(), ...sync0() } });
  a.ir('horas');
  await esperar(80);
  const v = a.run('VISTAS.horas()');
  assert.match(v, /Luis Pérez/);
  assert.match(v, /En curso/);
  assert.match(v, /sigue trabajando/);
  assert.match(v, /2 h \d+ min|1 h 59 min/);
  const l = r.llamadas.find(x => x.accion === 'turnosListar');
  assert.match(l.desde, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(l.desde <= l.hasta);
  assert.equal(new Date(l.desde + 'T00:00:00Z').getUTCDay(), 1, 'la semana empieza el lunes');
  assert.equal(a.run('rangoHoras("mes").desde').endsWith('-01'), true);
});
test('dueño · sin Google Sheets conectado la pantalla Horas lo pide y no llama a nadie', async () => {
  const s = mundo();
  const r = red(s);
  const a = cargarApp({ fetch: r.fetch });
  a.ir('horas'); await esperar(40);
  assert.match(a.run('VISTAS.horas()'), /Conéctalo primero/);
  assert.equal(r.llamadas.length, 0);
});
test('dueño · corregir un turno pide motivo, lo corrige en el script y deja el rastro', async () => {
  const s = mundo();
  await (await telefonoDeEmpleado(s)).a.run('ficharEntrada()');
  hojaF(s).celdas.set('2,4', hace(5 * HORA));
  duenoPost(s, { accion: 'turnosCerrar' });
  const r = red(s);
  const a = cargarApp({ fetch: r.fetch, seed: { ...sembrar(), ...sync0() } });
  a.ir('horas'); await esperar(80);
  const id = hojaF(s).celda(2, 1);
  a.run(`formHoras('${id}')`);
  const b = a.hoja().querySelector('.sheet-body');
  const local = ms => new Date(ms - 5 * HORA).toISOString().slice(0, 16);   // valor del campo, en hora de Colombia
  const sal = hojaF(s).celda(2, 5);
  Object.assign(b._q, { '#hc-entrada': { value: local(Date.now() - 6 * HORA) }, '#hc-salida': { value: local(Date.parse(sal)) }, '#hc-motivo': { value: '' } });
  const enviar = () => b._q['#f-horas'].listeners.submit[0]({ preventDefault() {} });
  await enviar();
  assert.equal(r.llamadas.some(l => l.accion === 'fichajeCorregir'), false, 'sin motivo no se envía');
  b._q['#hc-motivo'].value = 'Llegó una hora antes';
  await enviar(); await esperar(80);
  const c = r.llamadas.find(l => l.accion === 'fichajeCorregir');
  assert.ok(c && c.motivo === 'Llegó una hora antes' && c.entrada);
  assert.equal(s.libro.get('_fichajes_log').celda(2, 7), 'Llegó una hora antes');
  assert.match(a.toasts().at(-1).texto, /Turno corregido/);
});
test('dueño · agregar un turno olvidado elige al empleado y lo guarda con motivo', async () => {
  const s = mundo();
  const r = red(s);
  const a = cargarApp({ fetch: r.fetch, seed: { ...sembrar(), ...sync0() } });
  await a.run('abrirAgregarTurno()'); await esperar(60);
  assert.match(textoHoja(a), /Luis Pérez/);
  const b = a.hoja().querySelector('.sheet-body');
  const id = duenoPost(s, { accion: 'empleadoListar' }).empleados[0].id;
  const local = ms => new Date(ms - 5 * HORA).toISOString().slice(0, 16);
  Object.assign(b._q, { '#hc-emp': { value: id }, '#hc-entrada': { value: local(Date.now() - 30 * HORA) }, '#hc-salida': { value: local(Date.now() - 22 * HORA) }, '#hc-motivo': { value: 'Olvidó fichar' } });
  await b._q['#f-horas'].listeners.submit[0]({ preventDefault() {} });
  await esperar(80);
  assert.equal(hojaF(s).celda(2, 6), 'manual');
  assert.equal(hojaF(s).celda(2, 7), 'Olvidó fichar');
});

/* ---------- cierre de caja ---------- */
const movCaja = a => ({ id: 1700000000005000, fecha: a.run('hoy()'), tipo: 'ingreso', monto: 100000, concepto: 'Saldo inicial de la caja', origen: 'apertura', ref: null, refTipo: null, por: 'Dueño' });
function duenoConCaja(s, r) {
  const base = cargarApp();
  return cargarApp({ fetch: r.fetch, seed: { ...sembrar({ products: [prod({ stock: 10, price: 10, cost: 5 })], movimientos: [movCaja(base)], config: { cajaActiva: true } }), ...sync0() } });
}
function cerrar(a, contado = 100000) {
  a.run('formCierreCaja()');
  const b = a.hoja().querySelector('.sheet-body');
  b.querySelector('#ci-contado').value = String(contado); b.querySelector('#ci-nota').value = '';
  return b.querySelector('#f-cierre').listeners.submit[0]({ preventDefault() {} });
}
async function conTurnoAbierto(s) {
  await (await telefonoDeEmpleado(s)).a.run('ficharEntrada()');
  await esperar(40);
  hojaF(s).celdas.set('2,4', hace(3 * HORA));
}

test('cierre · avisa a quién se le marca la salida y, al confirmar, la marca y el cierre queda hecho', async () => {
  const s = mundo();
  await conTurnoAbierto(s);
  const r = red(s);
  const a = duenoConCaja(s, r);
  await esperar(60);
  const p = cerrar(a);
  await esperar(80);
  assert.match(textoHoja(a), /Se marcará la salida/);
  assert.match(textoHoja(a), /Luis Pérez/);
  assert.equal(abiertos(s).length, 1, 'todavía no: falta confirmar');
  await responder(a, true);
  await p;
  await esperar(60);
  assert.equal(abiertos(s).length, 0, 'la salida quedó marcada');
  assert.equal(a.run('cierres.length'), 1);
  assert.equal(a.run('sync.turnosPorCerrar.length'), 0);
  const c = r.llamadas.find(l => l.accion === 'turnosCerrar');
  assert.ok(c && !('cierreEn' in c) && c.demoraMs >= 0 && c.demoraMs < 60000, 'manda cuánto pasó desde el cierre, no la hora del teléfono');
  assert.equal(hojaF(s).celda(2, 6), 'cierre');
});
test('cierre · si el dueño cancela la confirmación no se cierra la caja ni los turnos', async () => {
  const s = mundo();
  await conTurnoAbierto(s);
  const a = duenoConCaja(s, red(s));
  await esperar(60);
  const p = cerrar(a);
  await esperar(80);
  await responder(a, false);
  await p;
  assert.equal(a.run('cierres.length'), 0);
  assert.equal(abiertos(s).length, 1);
});
test('cierre · sin nadie trabajando no pregunta nada y cierra como siempre', async () => {
  const s = mundo();
  const a = duenoConCaja(s, red(s));
  await esperar(60);
  await cerrar(a);
  assert.ok(!/Se marcará la salida/.test(textoHoja(a)));
  assert.equal(a.run('cierres.length'), 1);
});
test('cierre · sin conexión las salidas quedan anotadas con la hora del cierre y se marcan al volver la red', async () => {
  const s = mundo();
  await conTurnoAbierto(s);
  const r = red(s);
  const a = duenoConCaja(s, r);
  await esperar(60);
  const p = cerrar(a);
  await esperar(80);
  r.falla = c => c.accion === 'turnosCerrar';                  // se cae la red justo al marcar las salidas
  await responder(a, true);
  await p;
  await esperar(60);
  assert.equal(abiertos(s).length, 1, 'no se pudieron marcar');
  const anotada = a.run('sync.turnosPorCerrar[0]');
  assert.equal(a.run('sync.turnosPorCerrar.length'), 1);
  assert.ok(anotada, 'quedó anotada la hora del cierre');
  r.falla = () => false;
  await a.run('reintentarSalidas()');
  await esperar(40);
  assert.equal(abiertos(s).length, 0);
  assert.equal(a.run('sync.turnosPorCerrar.length'), 0);
  assert.ok(Date.parse(hojaF(s).celda(2, 5)) <= Date.parse(anotada) + 5000, 'la salida es la hora del cierre, no la de ahora');
});
test('cierre · una hora del cierre demorada no cierra el turno de quien entró después', async () => {
  const s = mundo({ empleados: ['luis', 'ana'] });
  await (await telefonoDeEmpleado(s)).a.run('ficharEntrada()');
  await (await telefonoDeEmpleado(s, red(s), 'ana', '7351')).a.run('ficharEntrada()');
  await esperar(40);
  hojaF(s).celdas.set('2,4', hace(3 * HORA));                  // Luis entró hace 3 h; Ana acaba de entrar (después del cierre)
    duenoPost(s, { accion: 'turnosCerrar', demoraMs: HORA });
  const quedan = abiertos(s);
  assert.equal(quedan.length, 1);
  assert.equal(quedan[0].nombre, 'Ana Gil');
});
test('cierre · con un script anterior al reloj el cierre funciona igual y no queda nada pendiente', async () => {
  const s = mundo();
  const r = red(s);
  r.fetch = async (_u, op) => { const c = JSON.parse(op.body); const x = /^turnos/.test(c.accion) ? { ok: false, error: 'Acción desconocida' } : post(s, c); return { json: async () => x }; };
  const a = duenoConCaja(s, r);
  await esperar(60);
  await cerrar(a);
  await esperar(40);
  assert.equal(a.run('cierres.length'), 1);
  assert.equal(a.run('sync.turnosPorCerrar.length'), 0, 'no se reintenta para siempre');
});

test('cierre · dos cierres con la llamada caída, luego vuelve la red: cada turno queda con la salida de su cierre', async () => {
  const s = mundo({ empleados: ['luis', 'ana'] });
  await (await telefonoDeEmpleado(s)).a.run('ficharEntrada()');
  await esperar(40);
  hojaF(s).celdas.set('2,4', hace(5 * HORA));                                  // Luis entró hace 5 h
  const r = red(s, c => c.accion === 'turnosCerrar');                          // sin red para marcar salidas
  const a = duenoConCaja(s, r);
  await esperar(60);
  const p1 = cerrar(a); await esperar(80); await responder(a, true); await p1;  // 1.er cierre (Luis trabajando)
  const primero = a.run('sync.turnosPorCerrar[0]');
  await esperar(1200);                                                          // pasa el tiempo
  await (await telefonoDeEmpleado(s, red(s), 'ana', '7351')).a.run('ficharEntrada()');
  await esperar(40);
  hojaF(s).celdas.set('3,4', hace(1000));                                       // Ana entró después del primer cierre
  const p2 = cerrar(a); await esperar(30); await responder(a, true);          // «Ya cerraste hoy»
  await esperar(80); await responder(a, true); await p2;   // 2.º cierre (Ana trabajando)
  assert.equal(a.run('sync.turnosPorCerrar.length'), 2, 'el segundo cierre no descarta el primero');
  assert.equal(a.run('sync.turnosPorCerrar[0]'), primero, 'en orden');
  assert.equal(abiertos(s).length, 2);
  r.falla = () => false;
  await a.run('reintentarSalidas()'); await esperar(40);
  assert.equal(abiertos(s).length, 0);
  assert.equal(a.run('sync.turnosPorCerrar.length'), 0);
  const msLuis = Date.parse(hojaF(s).celda(2, 5)), msAna = Date.parse(hojaF(s).celda(3, 5));
  // El script redondea la salida al minuto hacia abajo: hasta 60 s antes del cierre.
  assert.ok(msLuis <= Date.parse(primero) + 1000 && msLuis > Date.parse(primero) - 61000, 'Luis sale en su cierre (el primero), no en el segundo');
  assert.ok(msAna >= Date.parse(hojaF(s).celda(3, 4)) && hojaF(s).celda(3, 6) === 'cierre', 'Ana sale con el segundo cierre');
});
test('cierre · la sincronización lee el texto antiguo de turnosPorCerrar como una lista y descarta la basura', () => {
  const ok = new Date().toISOString();
  const a = cargarApp({ seed: { ...sembrar(), ...sync0({ turnosPorCerrar: ok }) } });
  assert.equal(a.run('JSON.stringify(sync.turnosPorCerrar)'), JSON.stringify([ok]));
  const b = cargarApp({ seed: { ...sembrar(), ...sync0({ turnosPorCerrar: [ok, 'hola', 5, null, ok] }) } });
  assert.equal(b.run('JSON.stringify(sync.turnosPorCerrar)'), JSON.stringify([ok, ok]));
  const c = cargarApp({ seed: { ...sembrar(), ...sync0({ turnosPorCerrar: 42 }) } });
  assert.equal(c.run('sync.turnosPorCerrar.length'), 0);
});
test('cierre · pulsar «Cerrar caja» dos veces con la consulta de turnos lenta deja un solo cierre', async () => {
  const s = mundo();
  const r = red(s);
  const base = r.fetch;
  r.fetch = async (u, op) => { if (JSON.parse(op.body).accion === 'turnosAbiertos') await esperar(150); return base(u, op); };
  const a = duenoConCaja(s, r);
  await esperar(60);
  a.run('formCierreCaja()');
  const b = a.hoja().querySelector('.sheet-body');
  b.querySelector('#ci-contado').value = '100000'; b.querySelector('#ci-nota').value = '';
  const enviar = () => b.querySelector('#f-cierre').listeners.submit[0]({ preventDefault() {} });
  const p1 = enviar(), p2 = enviar();
  await Promise.all([p1, p2]); await esperar(60);
  assert.equal(a.run('cierres.length'), 1);
});
test('cierre · el momento del cierre queda anotado ANTES de enviar al Sheet (si se cierra la pestaña, no se pierde)', async () => {
  const s = mundo();
  await conTurnoAbierto(s);
  const r = red(s);
  const base = r.fetch;
  let anotado = null, a;
  r.fetch = async (u, op) => {
    if (anotado === null && a.run('cierres.length') === 1) anotado = a.run('JSON.parse(localStorage.getItem("eg_sync")).turnosPorCerrar.length'); // la primera llamada tras anotar el cierre
    return base(u, op);
  };
  a = duenoConCaja(s, r);
  await esperar(60);
  const p = cerrar(a); await esperar(80); await responder(a, true); await p; await esperar(40);
  assert.equal(anotado, 1, 'al enviar los datos el momento ya estaba guardado');
});
test('conexión · reconectar el mismo enlace conserva las salidas por marcar y desconectar avisa de ellas', async () => {
  const s = mundo();
  const ok = new Date().toISOString();
  const a = cargarApp({ fetch: red(s, c => c.accion === 'turnosCerrar').fetch, seed: { ...sembrar(), ...sync0({ listo: false, turnosPorCerrar: [ok] }) } });
  await a.run(`conectarSheet('${URL_OK}', '${CLAVE}')`); await esperar(60);
  assert.equal(a.run('JSON.stringify(sync.turnosPorCerrar)'), JSON.stringify([ok]));
  a.run("ACCIONES['sheets-desconectar']()"); await esperar(30);
  assert.match(textoHoja(a), /1 cierre\(s\) de caja cuyas salidas/);
});
test('empleado · en un teléfono compartido el Inicio del siguiente no muestra el turno del anterior', async () => {
  const s = mundo({ empleados: ['luis', 'ana'] });
  const r = red(s);
  const base = r.fetch;
  let soltar; const gate = new Promise(res => { soltar = res; }); let retener = false;
  r.fetch = async (u, op) => { if (retener && JSON.parse(op.body).accion === 'miTurno') await gate; return base(u, op); };
  const { a } = await telefonoDeEmpleado(s, r);
  await a.run('ficharEntrada()'); await esperar(60);
  assert.match(a.run('htmlMiTurno()'), /Trabajando desde/);
  await a.run('cerrarSesion()');
  assert.ok(!/Trabajando desde|Hoy:/.test(a.run('htmlMiTurno()')), 'al salir se limpia');
  retener = true;
  await a.run("entrarEmpleado('', 'ana', '7351')"); await esperar(30);
  assert.ok(!/Trabajando desde|Hoy:/.test(a.run('htmlMiTurno()')), 'Ana no ve lo de Luis mientras carga el suyo');
  soltar(); await esperar(60);
  assert.match(a.run('htmlMiTurno()'), /Entrar a trabajar/);
});
test('dueño · a un turno en curso se le puede poner la salida (opcional) y se envía con motivo', async () => {
  const s = mundo();
  await (await telefonoDeEmpleado(s)).a.run('ficharEntrada()');
  await esperar(40);
  hojaF(s).celdas.set('2,4', hace(3 * HORA));
  const r = red(s);
  const a = cargarApp({ fetch: r.fetch, seed: { ...sembrar(), ...sync0() } });
  a.ir('horas'); await esperar(80);
  const id = hojaF(s).celda(2, 1);
  a.run(`formHoras('${id}')`);
  assert.match(textoHoja(a), /id="hc-salida"/);
  assert.match(textoHoja(a), /normalmente la salida la marca el cierre de caja/);
  const b = a.hoja().querySelector('.sheet-body');
  const local = ms => new Date(ms - 5 * HORA).toISOString().slice(0, 16);
  Object.assign(b._q, { '#hc-entrada': { value: local(Date.now() - 3 * HORA) }, '#hc-salida': { value: local(Date.now() - HORA) }, '#hc-motivo': { value: 'Se fue sin cerrar caja' } });
  await b._q['#f-horas'].listeners.submit[0]({ preventDefault() {} }); await esperar(80);
  const c = r.llamadas.find(l => l.accion === 'fichajeCorregir');
  assert.ok(c && c.salida && c.motivo === 'Se fue sin cerrar caja');
  assert.equal(abiertos(s).length, 0, 'el turno quedó cerrado');
  assert.equal(hojaF(s).celda(2, 6), 'corregido');
});
test('dueño · sin la Caja activada la pantalla de horas avisa que los turnos se cerrarán solos a las 16 h', async () => {
  const s = mundo();
  const sin = cargarApp({ fetch: red(s).fetch, seed: { ...sembrar(), ...sync0() } });
  assert.match(sin.run('VISTAS.horas()'), /Activa la Caja[\s\S]*16 h/);
  const con = duenoConCaja(s, red(s));
  assert.ok(!/Activa la Caja/.test(con.run('VISTAS.horas()')));
});
test('script anterior · se reconoce por el código o, en scripts viejos, por el texto', () => {
  const a = cargarApp();
  assert.equal(a.run("scriptAnterior({ codigo: 'accion_desconocida', message: 'x' })"), true);
  assert.equal(a.run("scriptAnterior(new Error('Acción desconocida'))"), true);
  assert.equal(a.run("scriptAnterior(new Error('accion desconocida'))"), true);
  assert.equal(a.run("scriptAnterior(new Error('timeout'))"), false);
  assert.equal(a.run('scriptAnterior(null)'), false);
});
test('script anterior · postScript copia el código del error', async () => {
  const a = cargarApp({ fetch: async () => ({ json: async () => ({ ok: false, error: 'otra cosa', codigo: 'accion_desconocida' }) }) });
  const e = await a.run(`postScript('${URL_OK}', {}).catch(e => e)`);
  assert.equal(e.codigo, 'accion_desconocida');
});

/* ---------- utilidades ---------- */
test('formato · horas y minutos, la hora de Colombia y el rango de la semana', () => {
  const a = cargarApp();
  assert.equal(a.run('fmtHM(0)'), '0 min');
  assert.equal(a.run('fmtHM(59)'), '59 min');
  assert.equal(a.run('fmtHM(60)'), '1 h 0 min');
  assert.equal(a.run('fmtHM(192)'), '3 h 12 min');
  assert.equal(a.run('fmtHM(-5)'), '0 min');
  assert.match(a.run("horaCo('2026-11-18T13:02:00Z')"), /8:02/, '13:02 UTC es 8:02 en Colombia');
  assert.equal(a.run("fechaCo(Date.parse('2026-11-18T03:00:00Z'))"), '2026-11-17', 'las 3 a. m. UTC todavía es el día anterior en Colombia');
});
