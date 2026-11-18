'use strict';
/* Empleados en la app (ADR 0002, entrega 1): pantalla de entrada, sesión por dispositivo, límites por rol,
   atribución de lo registrado y administración del equipo por el dueño. El servidor es un script falso. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { cargarApp, esperar, responder, prod, sembrar, enviarVenta } = require('./arnes');

const URL_OK = 'https://script.google.com/macros/s/AKfycbx_abc-123/exec';
const FUTURO = '2099-01-01T00:00:00.000Z';
const PASADO = '2020-01-01T00:00:00.000Z';
const TOKEN = 't'.repeat(64);
const empleado = (o = {}) => ({ rol: 'empleado', usuario: 'luis', nombre: 'Luis Pérez', token: TOKEN, vence: FUTURO, ...o });

/* Un script de Google falso con lo justo para entrar, validar la sesión y administrar empleados. */
function servidor({ empleados = [], sesionViva = true, red = true } = {}) {
  const llamadas = [];
  const fetch = async (url, op) => {
    const c = JSON.parse(op.body);
    llamadas.push(c);
    if (!red) throw new Error('Failed to fetch');
    const ok = x => ({ json: async () => x });
    if (c.accion === 'login') return c.usuario === 'luis' && c.pin === '4829'
      ? ok({ ok: true, token: TOKEN, vence: FUTURO, empleado: { id: 'e1', usuario: 'luis', nombre: 'Luis Pérez' } })
      : ok({ ok: false, error: 'Usuario o PIN incorrecto, o la cuenta está bloqueada' });
    if (c.accion === 'yo') {
      if (c.token) return sesionViva ? ok({ ok: true, rol: 'empleado' }) : ok({ ok: false, error: 'La sesión venció: entra de nuevo', sesion: false });
      return c.clave === 'clave-1' ? ok({ ok: true, rol: 'dueno' }) : ok({ ok: false, error: 'Clave incorrecta' });
    }
    if (c.accion === 'salir') return ok({ ok: true });
    if (c.accion === 'empleadoListar') return ok({ ok: true, empleados });
    if (['empleadoCrear', 'empleadoPin', 'empleadoActivo'].includes(c.accion)) return ok({ ok: true, empleado: {} });
    if (c.accion === 'ping') return ok({ ok: true, tieneDatos: false });
    return ok({ ok: false, error: 'Acción desconocida' });
  };
  return { fetch, llamadas };
}
const syncDueno = { eg_sync: { url: URL_OK, clave: 'clave-1', listo: true, pendiente: false, ultimo: null, error: '' } };
const acceso = o => ({ eg_acceso: { exigir: true, url: URL_OK, sesion: null, ...o } });
const clic = (a, dataset) => (a.doc.listeners.click || []).forEach(f => f({ target: { closest: () => ({ dataset }) } }));
const ultimoToast = a => a.toasts().at(-1) || {};
const huevo = (o = {}) => prod({ stock: 100, cost: 5, price: 10, ...o });

/* ---------- sin inicio de sesión: nada cambia ---------- */
test('acceso · por defecto nadie inicia sesión: todo es del dueño y no se guarda ninguna sesión', () => {
  const a = cargarApp();
  assert.equal(a.run('esDueno()'), true);
  assert.equal(a.run('loginPendiente()'), false);
  assert.equal(a.run('usuarioActual()'), 'Dueño');
  assert.deepEqual(a.ev('registroPor()'), {});
  assert.equal(a.store.has('eg_acceso'), false);
});
test('acceso · una sesión guardada dañada o inventada no da permisos', () => {
  for (const basura of ['no es json', '{"exigir":true,"sesion":{"rol":"dueno","token":1}}'.replace('"dueno"', '"admin"'), '{"exigir":true,"sesion":{"rol":"empleado"}}', 'null', '[]']) {
    const a = cargarApp({ seed: { eg_acceso: basura } });
    assert.equal(a.run('acceso.sesion'), null, basura);
  }
  const a = cargarApp({ seed: acceso({ sesion: { rol: 'empleado', token: 'x', nombre: 'A', usuario: 'a' } }) }); // sin vencimiento
  assert.equal(a.run('loginPendiente()'), true, 'sin vencimiento no cuenta como sesión');
});

/* ---------- pantalla de entrada ---------- */
test('entrada · con inicio de sesión pedido y sin sesión se muestra Entrar, sin menú ni datos', () => {
  const a = cargarApp({ seed: { ...sembrar({ products: [huevo()] }), ...acceso() } });
  assert.equal(a.run('loginPendiente()'), true);
  assert.equal(a.run('vistaActual'), 'entrada');
  const vista = a.q('#vista').innerHTML;
  assert.match(vista, /Entrar/);
  assert.match(vista, /Soy empleado/);
  assert.ok(!/Vendido hoy|Huevo/.test(vista), 'no se ven los datos del negocio');
  assert.equal(a.q('#nav').innerHTML, '');
});
test('entrada · una sesión de empleado vencida vuelve a pedir entrar', () => {
  const a = cargarApp({ seed: acceso({ sesion: empleado({ vence: PASADO }) }) });
  assert.equal(a.run('loginPendiente()'), true);
  assert.equal(a.run('esDueno()'), false, 'un empleado vencido no es dueño');
});
test('entrada · el empleado entra con usuario y PIN; el token queda en el dispositivo y nunca en los datos', async () => {
  const s = servidor();
  const a = cargarApp({ fetch: s.fetch, seed: { ...sembrar({ products: [huevo()] }), ...acceso() } });
  await a.run("entrarEmpleado('', '  LUIS ', '4829')");
  assert.equal(s.llamadas[0].accion, 'login');
  assert.equal(s.llamadas[0].usuario, 'luis', 'el usuario se normaliza');
  assert.ok(!('clave' in s.llamadas[0]), 'el empleado nunca manda la clave del dueño');
  assert.equal(a.run('loginPendiente()'), false);
  assert.equal(a.run('esDueno()'), false);
  assert.equal(a.run('usuarioActual()'), 'Luis Pérez');
  assert.match(a.store.get('eg_acceso'), new RegExp(TOKEN));
  assert.ok(![...a.store.entries()].some(([k, v]) => k !== 'eg_acceso' && v.includes(TOKEN)), 'el token no está en ninguna otra clave (ni respaldos)');
  assert.ok(!JSON.stringify(a.ev('estado()')).includes(TOKEN), 'ni dentro del estado que se respalda');
});
test('entrada · PIN o usuario mal escritos no llaman al servidor, y un fallo no deja entrar', async () => {
  const s = servidor();
  const a = cargarApp({ fetch: s.fetch, seed: acceso() });
  for (const [u, p] of [['luis', '12'], ['luis', 'abcd'], ['luis', '1234567'], ['', '4829']]) await a.run(`entrarEmpleado('', ${JSON.stringify(u)}, ${JSON.stringify(p)})`);
  assert.equal(s.llamadas.length, 0);
  await a.run("entrarEmpleado('', 'luis', '9182')");
  assert.equal(s.llamadas.length, 1);
  assert.equal(ultimoToast(a).error, true);
  assert.equal(a.run('loginPendiente()'), true);
  assert.equal(a.run('acceso.sesion'), null);
});
test('entrada · en un teléfono nuevo el empleado debe dar el enlace, y solo se acepta uno de Google', async () => {
  const s = servidor();
  const a = cargarApp({ fetch: s.fetch, seed: { eg_acceso: { exigir: true, url: '', sesion: null } } });
  assert.match(a.q('#vista').innerHTML, /Enlace de la aplicación web/);
  await a.run("entrarEmpleado('https://ejemplo.com/exec', 'luis', '4829')");
  await a.run("entrarEmpleado('', 'luis', '4829')");
  assert.equal(s.llamadas.length, 0, 'no se manda el PIN a otro dominio ni sin enlace');
  await a.run(`entrarEmpleado('${URL_OK}', 'luis', '4829')`);
  assert.equal(a.run('acceso.url'), URL_OK, 'queda guardado para la próxima');
  assert.equal(a.run('loginPendiente()'), false);
});
test('entrada · el dueño entra con su clave: en su teléfono se compara sin internet', async () => {
  const s = servidor({ red: false });
  const a = cargarApp({ fetch: s.fetch, seed: { ...syncDueno, ...acceso() } });
  await a.run("entrarDueno('', 'mala')");
  assert.equal(a.run('loginPendiente()'), true);
  await a.run("entrarDueno('', 'clave-1')");
  assert.equal(a.run('esDueno()'), true);
  assert.equal(s.llamadas.length, 0, 'sin tocar la red');
});
test('entrada · el dueño en un teléfono sin su clave guardada la valida con el script', async () => {
  const s = servidor();
  const a = cargarApp({ fetch: s.fetch, seed: acceso() });
  await a.run("entrarDueno('', 'mala')");
  assert.equal(a.run('esDueno()'), false);
  await a.run("entrarDueno('', 'clave-1')");
  assert.equal(a.run('esDueno()'), true);
  assert.equal(s.llamadas.at(-1).clave, 'clave-1');
});
test('entrada · cerrar sesión avisa al script, borra la sesión y vuelve a pedir entrar', async () => {
  const s = servidor();
  const a = cargarApp({ fetch: s.fetch, seed: acceso({ sesion: empleado() }) });
  await a.run('cerrarSesion()');
  await esperar();
  assert.equal(a.run('acceso.sesion'), null);
  assert.equal(a.run('loginPendiente()'), true);
  const salir = s.llamadas.filter(l => l.accion === 'salir'); // (antes hubo un «yo»: la validación al abrir la app)
  assert.equal(salir.length, 1);
  assert.equal(salir[0].token, TOKEN);
});
test('entrada · si el script ya no reconoce la sesión (desactivado o PIN cambiado) se sale al abrir', async () => {
  const s = servidor({ sesionViva: false });
  const a = cargarApp({ fetch: s.fetch, seed: acceso({ sesion: empleado() }) });
  await esperar(20);
  assert.equal(a.run('acceso.sesion'), null);
  assert.equal(a.run('loginPendiente()'), true);
});
test('entrada · sin conexión la sesión no se cierra (se sigue trabajando)', async () => {
  const s = servidor({ red: false });
  const a = cargarApp({ fetch: s.fetch, seed: acceso({ sesion: empleado() }) });
  await esperar(20);
  assert.equal(a.run('loginPendiente()'), false);
  assert.equal(a.run('usuarioActual()'), 'Luis Pérez');
});

/* ---------- límites del empleado ---------- */
const comoEmpleado = (extra = {}) => cargarApp({ seed: { ...sembrar({ products: [huevo()], ventas: [{ id: 1700000000000001, productoId: 'campo', cantidad: 2, descontado: 2, precio: 10, total: 20, costoUnitario: 5, ganancia: 10, fecha: '2026-11-01', clienteId: null, tipoPago: 'contado', pagado: 20, abonos: [] }] }), ...acceso({ sesion: empleado() }), ...extra } });

test('permisos · cada acción de la app está clasificada: libre o solo del dueño (y no en las dos)', () => {
  const a = cargarApp();
  const todas = a.ev('Object.keys(ACCIONES)'), libres = new Set(a.ev('[...ACCIONES_LIBRES]')), dueno = new Set(a.ev('[...ACCIONES_DUENO]'));
  for (const k of todas) assert.ok(libres.has(k) !== dueno.has(k), `la acción «${k}» debe estar en exactamente una lista`);
  for (const k of [...libres, ...dueno]) assert.ok(todas.includes(k), `«${k}» está clasificada pero ya no existe`);
});
test('permisos · el empleado no puede anular, cerrar la caja, borrar, exportar ni administrar', () => {
  const a = comoEmpleado();
  const bloqueadas = ['venta-anular', 'entrada-anular', 'ajuste-anular', 'caja-cierre', 'caja-anular', 'borrar-todo', 'prod-editar', 'prod-nuevo', 'perdida', 'proveedor-nuevo', 'cliente-editar', 'csv', 'json-export', 'json-import', 'sheets-enviar', 'sheets-restaurar', 'sheets-desconectar', 'emp-nuevo', 'emp-exigir', 'emp-pin', 'emp-activo'];
  const antes = JSON.stringify(a.ev('({ ventas, entradas, movimientos, config, products })'));
  for (const act of bloqueadas) {
    clic(a, { act, id: '1700000000000001' });
    assert.match(ultimoToast(a).texto, /Solo el dueño/, act);
    assert.equal(ultimoToast(a).error, true, act);
  }
  assert.equal(JSON.stringify(a.ev('({ ventas, entradas, movimientos, config, products })')), antes, 'no cambió ningún dato');
});
test('permisos · lo que sí hace el empleado funciona: navegar y abrir un cliente', () => {
  const a = comoEmpleado();
  clic(a, { act: 'ir', v: 'caja' });
  assert.equal(a.run('vistaActual'), 'caja');
  clic(a, { act: 'ir', v: 'vender' });
  assert.equal(a.run('vistaActual'), 'vender');
});
test('permisos · el empleado no entra a las vistas del dueño ni escribiendo la dirección', () => {
  const a = comoEmpleado();
  for (const v of ['productos', 'proveedores', 'graficos', 'reportes', 'respaldo', 'sheets', 'ajustes', 'empleados']) {
    a.ir(v);
    assert.equal(a.run('vistaActual'), 'inicio', v);
  }
});
test('permisos · el Inicio del empleado no muestra ganancias, deudas ni la semana; el del dueño sí', () => {
  const emp = comoEmpleado().run('VISTAS.inicio()');
  for (const t of [/Ganancia hoy/, /Me deben/, /Esta semana/, /Debo a proveedores/, /Haz un respaldo/]) assert.ok(!t.test(emp), String(t));
  assert.match(emp, /Vendido hoy/);
  assert.match(emp, /Llegó mercancía/);
  const dueno = cargarApp({ seed: sembrar({ products: [huevo()] }) }).run('VISTAS.inicio()');
  for (const t of [/Ganancia hoy/, /Me deben/, /Esta semana/]) assert.match(dueno, t);
});
test('permisos · la caja la activa el dueño: al empleado se le pide que avise', () => {
  const a = comoEmpleado();
  const v = a.run('VISTAS.caja()');
  assert.match(v, /todavía no está activada/);
  assert.ok(!/ci-saldo/.test(v), 'no aparece el formulario de activar');
  assert.equal(a.run('config.cajaActiva'), false);
});
test('permisos · con la sesión del dueño dentro (inicio de sesión pedido) todo sigue disponible', () => {
  const a = cargarApp({ seed: { ...sembrar({ products: [huevo()] }), ...acceso({ sesion: { rol: 'dueno' } }) } });
  assert.equal(a.run('esDueno()'), true);
  a.ir('productos');
  assert.equal(a.run('vistaActual'), 'productos');
  assert.ok(!/Solo el dueño/.test(ultimoToast(a).texto || ''));
});

/* ---------- quién registró ---------- */
test('registro · lo que vende o recibe el empleado queda con su nombre', async () => {
  const a = comoEmpleado();
  await enviarVenta(a, { cant: '3', precio: '10' });
  const v = a.ev('ventas').at(-1);
  assert.equal(v.por, 'Luis Pérez');
  assert.match(a.run('VISTAS.comprar()'), /value="Luis Pérez"/, 'en una compra, «Recibió» ya trae su nombre');
});
test('registro · sin inicio de sesión las ventas quedan exactamente como antes (sin «por»)', async () => {
  const a = cargarApp({ seed: sembrar({ products: [huevo()] }) });
  await enviarVenta(a, { cant: '3', precio: '10' });
  assert.ok(!('por' in a.ev('ventas').at(-1)));
});
test('registro · «por» sobrevive al guardado y se recorta a 40 caracteres', () => {
  const a = cargarApp();
  const base = { id: 1700000000000009, productoId: 'campo', cantidad: 1, precio: 10, total: 10, fecha: '2026-11-01', tipoPago: 'contado' };
  assert.equal(a.ev(`SANEAR.ventas(${JSON.stringify({ ...base, por: 'Ana' })})`).por, 'Ana');
  assert.equal(a.ev(`SANEAR.ventas(${JSON.stringify({ ...base, por: 'x'.repeat(60) })})`).por.length, 40);
  assert.ok(!('por' in a.ev(`SANEAR.ventas(${JSON.stringify({ ...base, por: 7 })})`)), 'un «por» que no es texto se ignora');
});

/* ---------- administración del equipo (dueño) ---------- */
const equipo = [{ id: 'e1', usuario: 'luis', nombre: 'Luis Pérez', activo: true, bloqueado: false }, { id: 'e2', usuario: 'ana', nombre: 'Ana', activo: false, bloqueado: false }, { id: 'e3', usuario: 'jose', nombre: 'José', activo: true, bloqueado: true }];

test('equipo · el dueño ve a sus empleados con su estado, y se piden una sola vez', async () => {
  const s = servidor({ empleados: equipo });
  const a = cargarApp({ fetch: s.fetch, seed: { ...syncDueno, ...sembrar() } });
  a.ir('empleados');
  await esperar(20);
  const v = a.run('VISTAS.empleados()');
  assert.match(v, /Luis Pérez/);
  assert.match(v, /Desactivado/);
  assert.match(v, /Bloqueado por intentos/);
  assert.ok(!/hash|sal\b|token/i.test(v));
  assert.equal(s.llamadas.filter(l => l.accion === 'empleadoListar').length, 1, 'sin bucle de lecturas');
  assert.equal(s.llamadas[0].clave, 'clave-1');
});
test('equipo · sin Google Sheets conectado la pantalla lo pide primero y no llama a nadie', async () => {
  const s = servidor();
  const a = cargarApp({ fetch: s.fetch });
  a.ir('empleados');
  await esperar(10);
  assert.match(a.run('VISTAS.empleados()'), /Conéctalo primero/);
  assert.equal(s.llamadas.length, 0);
});
test('equipo · un script viejo (sin empleados) se explica y no se queda cargando', async () => {
  const fetch = async () => ({ json: async () => ({ ok: false, error: 'Acción desconocida' }) });
  const a = cargarApp({ fetch, seed: { ...syncDueno, ...sembrar() } });
  a.ir('empleados');
  await esperar(20);
  assert.match(a.run('VISTAS.empleados()'), /versión anterior/);
});
test('equipo · crear un empleado valida los dos PIN, manda todo al script y no guarda el PIN en el teléfono', async () => {
  const s = servidor({ empleados: equipo });
  const a = cargarApp({ fetch: s.fetch, seed: { ...syncDueno, ...sembrar() } });
  a.ir('empleados'); await esperar(20);
  clic(a, { act: 'emp-nuevo' });
  const b = a.hoja().querySelector('.sheet-body');
  // el DOM del arnés devuelve un elemento por selector: se llenan los campos del formulario como lo haría el usuario
  Object.assign(b._q, { '#em-nombre': { value: 'Pedro Gil' }, '#em-usuario': { value: 'pedro' }, '#em-pin': { value: '4829' }, '#em-pin2': { value: '4829' } });
  const submit = (b._q['#f-emp'].listeners.submit || [])[0];
  assert.ok(submit, 'el formulario escucha el envío');
  b._q['#em-pin2'].value = '1111';
  await submit({ preventDefault() {} });
  assert.equal(s.llamadas.some(l => l.accion === 'empleadoCrear'), false, 'PIN que no coinciden');
  b._q['#em-pin2'].value = '4829'; b._q['#em-pin'].value = '12';
  await submit({ preventDefault() {} });
  assert.equal(s.llamadas.some(l => l.accion === 'empleadoCrear'), false, 'PIN muy corto');
  b._q['#em-pin'].value = '4829';
  await submit({ preventDefault() {} });
  await esperar(10);
  const c = s.llamadas.find(l => l.accion === 'empleadoCrear');
  assert.ok(c);
  assert.deepEqual([c.nombre, c.usuario, c.pin, c.clave], ['Pedro Gil', 'pedro', '4829', 'clave-1']);
  assert.ok(![...a.store.values()].some(v => v.includes('4829')), 'el PIN no se guarda en el teléfono');
});
test('equipo · activar el inicio de sesión pide confirmación, deja al dueño dentro y se puede apagar', async () => {
  const s = servidor();
  const a = cargarApp({ fetch: s.fetch, seed: { ...syncDueno, ...sembrar() } });
  const p = a.run("ACCIONES['emp-exigir']()");
  await responder(a, false); await p;
  assert.equal(a.run('acceso.exigir'), false, 'cancelar no cambia nada');
  const p2 = a.run("ACCIONES['emp-exigir']()");
  await responder(a, true); await p2;
  assert.equal(a.run('acceso.exigir'), true);
  assert.equal(a.run('esDueno()'), true, 'el dueño no se queda fuera');
  assert.equal(a.ev('JSON.parse(localStorage.getItem("eg_acceso"))').sesion.rol, 'dueno');
  const p3 = a.run("ACCIONES['emp-exigir']()");
  await responder(a, true); await p3;
  assert.equal(a.run('acceso.exigir'), false);
});
test('equipo · desactivar a un empleado pide confirmación y se lo dice al script', async () => {
  const s = servidor({ empleados: equipo });
  const a = cargarApp({ fetch: s.fetch, seed: { ...syncDueno, ...sembrar() } });
  a.ir('empleados'); await esperar(20);
  const p = a.run("ACCIONES['emp-activo']({ dataset: { id: 'e1', a: '0' } })");
  await responder(a, false); await p;
  assert.equal(s.llamadas.some(l => l.accion === 'empleadoActivo'), false);
  const p2 = a.run("ACCIONES['emp-activo']({ dataset: { id: 'e1', a: '0' } })");
  await responder(a, true); await p2;
  const l = s.llamadas.find(x => x.accion === 'empleadoActivo');
  assert.deepEqual([l.id, l.activo], ['e1', false]);
});
test('equipo · el menú Más del dueño tiene Empleados y, con login activo, Cerrar sesión', () => {
  const a = cargarApp({ seed: { ...syncDueno, ...sembrar(), ...acceso({ sesion: { rol: 'dueno' } }) } });
  const m = a.run('VISTAS.mas()');
  assert.match(m, /Empleados/);
  assert.match(m, /Cerrar sesión/);
  assert.match(m, /Entraste como dueño/);
  const sin = cargarApp({ seed: sembrar() }).run('VISTAS.mas()');
  assert.ok(!/Cerrar sesión/.test(sin), 'sin login activo no hay sesión que cerrar');
});
