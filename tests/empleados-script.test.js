'use strict';
/* Empleados, PIN, sesiones y permisos por rol en apps-script/Code.gs (ADR 0002, entrega 1).
   Lo que se vigila: el PIN y el token nunca quedan en claro en el Sheet, todos los fallos de entrada dan el mismo mensaje,
   el bloqueo funciona, y el empleado no puede hacer nada de lo que solo es del dueño. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { cargarScript, post, plano, CODIGO } = require('./arnes-script');

const CLAVE = 'k-secreta';
const MSJ = 'Usuario o PIN incorrecto, o la cuenta está bloqueada';
const duenoPost = (s, c) => post(s, { clave: CLAVE, ...c });
const crear = (s, o = {}) => duenoPost(s, { accion: 'empleadoCrear', nombre: 'Luis Pérez', usuario: 'luis', pin: '4829', ...o });
const entrar = (s, o = {}) => post(s, { accion: 'login', usuario: 'luis', pin: '4829', ...o });
const comoEmpleado = (s, token, c) => post(s, { token, ...c });
const celdas = h => [...h.celdas.values()].map(String);
const colEmp = { id: 1, usuario: 2, nombre: 3, sal: 4, hash: 5, activo: 6, intentos: 7, bloqueadoHasta: 8, creado: 9 };
const datosMinimos = { app: 'el-gallinero', products: [], ventas: [], entradas: [], clientes: [] };

/* ---------- alta y PIN ---------- */
test('empleados · el dueño crea un empleado y el PIN no queda en claro en ningún sitio', () => {
  const s = cargarScript();
  const r = crear(s);
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.empleado).sort(), ['activo', 'bloqueado', 'id', 'nombre', 'usuario']);
  assert.equal(r.empleado.usuario, 'luis');
  const h = s.libro.get('_empleados');
  assert.equal(h.oculta, true, 'la pestaña de empleados es oculta');
  assert.ok(celdas(h).every(c => !c.includes('4829')), 'el PIN no está en ninguna celda');
  assert.match(String(h.celda(2, colEmp.hash)), /^x[0-9a-f]{64}$/);
  assert.match(String(h.celda(2, colEmp.sal)), /^x[0-9a-f]{64}$/);
});
test('empleados · listar no devuelve el hash ni la sal', () => {
  const s = cargarScript();
  crear(s);
  const l = duenoPost(s, { accion: 'empleadoListar' });
  assert.equal(l.ok, true);
  assert.equal(l.empleados.length, 1);
  assert.ok(!JSON.stringify(l).match(/hash|sal"|x[0-9a-f]{64}/));
});
test('empleados · el PIN debe ser de 4 a 6 dígitos, sin repetir ni escalera, y siempre texto', () => {
  const s = cargarScript();
  for (const pin of ['123', '1234567', '1111', '000000', '1234', '4321', '56789', 'abcd', '12 34', 4829, null, undefined, ['4829']]) {
    const r = crear(s, { pin, usuario: 'ana' });
    assert.equal(r.ok, false, `se aceptó el PIN ${JSON.stringify(pin)}`);
  }
  for (const pin of ['4829', '0759', '135790', '9182']) assert.equal(crear(s, { pin, usuario: 'u' + pin }).ok, true, `se rechazó ${pin}`);
});
test('empleados · el usuario se normaliza, debe empezar con letra y no se repite', () => {
  const s = cargarScript();
  assert.equal(crear(s, { usuario: '  LUIS ' }).empleado.usuario, 'luis');
  assert.equal(crear(s, { usuario: 'Luis' }).ok, false, 'repetido aunque cambie la mayúscula');
  for (const usuario of ['1234', 'ab', '9luis', 'lu is', 'luis@x', 'a'.repeat(21), '', null]) assert.equal(crear(s, { usuario }).ok, false, `se aceptó ${usuario}`);
  assert.equal(crear(s, { nombre: '   ', usuario: 'zoe' }).ok, false, 'sin nombre');
});

/* ---------- entrada (login) ---------- */
test('login · entra con usuario y PIN, devuelve un token y solo se guarda su hash', () => {
  const s = cargarScript();
  crear(s);
  const r = entrar(s);
  assert.equal(r.ok, true);
  assert.match(r.token, /^[0-9a-f]{64}$/);
  assert.equal(r.empleado.nombre, 'Luis Pérez');
  assert.ok(Date.parse(r.vence) > Date.now() + 11 * 3600000 && Date.parse(r.vence) < Date.now() + 13 * 3600000, 'vence en unas 12 horas');
  const ses = s.libro.get('_sesiones');
  assert.equal(ses.oculta, true);
  assert.ok(celdas(ses).every(c => !c.includes(r.token)), 'el token no está en claro');
  assert.match(String(ses.celda(2, 1)), /^x[0-9a-f]{64}$/);
});
test('login · no pide la clave del dueño y no la deja pasar por usuario', () => {
  const s = cargarScript();
  crear(s);
  assert.equal(entrar(s).ok, true);
  assert.equal(entrar(s, { clave: 'otra' }).ok, true, 'una clave de más no estorba');
  assert.equal(post(s, { accion: 'login', usuario: 'luis', pin: CLAVE }).ok, false, 'la clave no sirve como PIN');
});
test('login · todos los fallos dan exactamente el mismo mensaje (no se averigua quién existe)', () => {
  const s = cargarScript();
  crear(s);
  crear(s, { usuario: 'ana', pin: '7351' });
  duenoPost(s, { accion: 'empleadoActivo', id: duenoPost(s, { accion: 'empleadoListar' }).empleados[1].id, activo: false });
  const mensajes = [
    entrar(s, { usuario: 'nadie' }),                // no existe
    entrar(s, { pin: '1357' }),                     // PIN mal
    entrar(s, { usuario: 'ana', pin: '7351' }),     // desactivada
    entrar(s, { pin: '' }),                         // sin PIN
    entrar(s, { pin: 4829 }),                       // PIN como número
    entrar(s, { usuario: undefined }),              // sin usuario
  ].map(r => { assert.equal(r.ok, false); return r.error; });
  assert.ok(mensajes.every(m => m === MSJ), JSON.stringify(mensajes));
});
test('login · 5 fallos bloquean la cuenta, ni el PIN correcto entra, y vuelve al pasar el tiempo', () => {
  const s = cargarScript();
  crear(s);
  for (let i = 0; i < 4; i++) assert.equal(entrar(s, { pin: '1357' }).ok, false);
  assert.equal(Number(s.libro.get('_empleados').celda(2, colEmp.intentos)), 4);
  assert.equal(entrar(s, { pin: '1357' }).ok, false);                 // quinto fallo: se bloquea
  assert.equal(duenoPost(s, { accion: 'empleadoListar' }).empleados[0].bloqueado, true);
  assert.equal(entrar(s).ok, false, 'bloqueado: ni el PIN correcto');
  s.libro.get('_empleados').celdas.set(`2,${colEmp.bloqueadoHasta}`, new Date(Date.now() - 1000).toISOString()); // pasó el tiempo
  assert.equal(entrar(s).ok, true, 'pasado el bloqueo vuelve a entrar');
  assert.equal(Number(s.libro.get('_empleados').celda(2, colEmp.intentos)), 0);
});
test('login · un acierto antes del límite reinicia el contador de fallos', () => {
  const s = cargarScript();
  crear(s);
  for (let i = 0; i < 4; i++) entrar(s, { pin: '1357' });
  assert.equal(entrar(s).ok, true);
  for (let i = 0; i < 4; i++) entrar(s, { pin: '1357' });
  assert.equal(entrar(s).ok, true, 'no acumuló los 4 fallos anteriores');
});

/* ---------- permisos ---------- */
test('permisos · un empleado no puede traer clientes del Sheet ni administrar empleados', () => {
  const s = cargarScript();
  crear(s);
  const { token } = entrar(s);
  for (const c of [{ accion: 'clientes' }, { accion: 'empleadoListar' },
    { accion: 'empleadoCrear', nombre: 'X', usuario: 'xxx', pin: '4829' }, { accion: 'empleadoPin', id: 'e1', pin: '4829' }, { accion: 'empleadoActivo', id: 'e1', activo: false }]) {
    const r = comoEmpleado(s, token, c);
    assert.equal(r.ok, false, c.accion);
    assert.equal(r.prohibido, true, c.accion);
  }
  assert.equal(s.libro.get('_respaldo'), undefined, 'no se escribió el respaldo');
  assert.equal(duenoPost(s, { accion: 'empleadoListar' }).empleados.length, 1, 'no se creó nadie');
});
test('permisos · el empleado puede preguntar quién es, y su ping no trae cifras del negocio', () => {
  const s = cargarScript();
  crear(s);
  duenoPost(s, { accion: 'guardar', datos: { ...datosMinimos, ventas: [{ id: 1 }], clientes: [{ id: 'c' }] } });
  const { token } = entrar(s);
  const yo = comoEmpleado(s, token, { accion: 'yo' });
  assert.equal(yo.rol, 'empleado');
  assert.equal(yo.empleado.usuario, 'luis');
  const ping = comoEmpleado(s, token, { accion: 'ping' });
  assert.deepEqual(Object.keys(ping).sort(), ['actualizado', 'ok', 'rol', 'tieneDatos', 'version'], 'sin cantidad de ventas ni de clientes');
  assert.match(ping.version, /^v[0-9a-z]+$/);
  assert.equal(duenoPost(s, { accion: 'ping' }).ventas, 1, 'al dueño sí le muestra el resumen');
});
test('permisos · el dueño sigue pudiendo todo y una acción inventada no existe para nadie', () => {
  const s = cargarScript();
  crear(s);
  assert.equal(duenoPost(s, { accion: 'guardar', datos: datosMinimos }).ok, true);
  assert.equal(duenoPost(s, { accion: 'leer' }).ok, true);
  assert.equal(duenoPost(s, { accion: 'yo' }).rol, 'dueno');
  assert.equal(duenoPost(s, { accion: 'borrarTodo' }).error, 'Acción desconocida');
  const { token } = entrar(s);
  assert.equal(comoEmpleado(s, token, { accion: 'borrarTodo' }).error, 'Acción desconocida');
});
test('permisos · un token inventado o una clave mala no entran', () => {
  const s = cargarScript();
  crear(s);
  assert.equal(comoEmpleado(s, 'a'.repeat(64), { accion: 'yo' }).ok, false);
  assert.equal(post(s, { token: 'corto', accion: 'yo' }).ok, false);
  assert.equal(post(s, { clave: 'mala', accion: 'guardar', datos: datosMinimos }).error, 'Clave incorrecta');
  assert.equal(post(s, { accion: 'guardar', datos: datosMinimos }).error, 'Clave incorrecta', 'sin credencial');
  assert.equal(post(s, { clave: ['k-secreta'], accion: 'yo' }).ok, false, 'la clave debe ser texto');
  assert.equal(s.libro.get('_respaldo'), undefined);
});
test('permisos · el token de un empleado no sirve si no es el suyo: cada sesión es de quien entró', () => {
  const s = cargarScript();
  crear(s);
  crear(s, { usuario: 'ana', nombre: 'Ana', pin: '7351' });
  const a = entrar(s).token, b = entrar(s, { usuario: 'ana', pin: '7351' }).token;
  assert.equal(comoEmpleado(s, a, { accion: 'yo' }).empleado.usuario, 'luis');
  assert.equal(comoEmpleado(s, b, { accion: 'yo' }).empleado.usuario, 'ana');
});

/* ---------- sesiones ---------- */
test('sesión · vencida avisa «la sesión venció» para que la app pida entrar de nuevo', () => {
  const s = cargarScript();
  crear(s);
  const { token } = entrar(s);
  s.libro.get('_sesiones').celdas.set('2,4', new Date(Date.now() - 1000).toISOString());
  const r = comoEmpleado(s, token, { accion: 'yo' });
  assert.equal(r.ok, false);
  assert.equal(r.sesion, false);
  assert.match(r.error, /venció/);
});
test('sesión · salir invalida ese token y no los de otro dispositivo', () => {
  const s = cargarScript();
  crear(s);
  const a = entrar(s).token, b = entrar(s).token;
  assert.equal(comoEmpleado(s, a, { accion: 'salir' }).ok, true);
  assert.equal(comoEmpleado(s, a, { accion: 'yo' }).ok, false);
  assert.equal(comoEmpleado(s, b, { accion: 'yo' }).ok, true);
});
test('sesión · al entrar se limpian las sesiones vencidas', () => {
  const s = cargarScript();
  crear(s);
  entrar(s);
  s.libro.get('_sesiones').celdas.set('2,4', new Date(Date.now() - 1000).toISOString());
  entrar(s);
  assert.equal(s.libro.get('_sesiones').getLastRow(), 2, 'queda solo la vigente');
});
test('sesión · desactivar a un empleado cierra sus sesiones y no puede volver a entrar', () => {
  const s = cargarScript();
  const { empleado } = crear(s);
  const { token } = entrar(s);
  assert.equal(duenoPost(s, { accion: 'empleadoActivo', id: empleado.id, activo: false }).empleado.activo, false);
  assert.equal(comoEmpleado(s, token, { accion: 'yo' }).ok, false);
  assert.equal(entrar(s).ok, false);
  duenoPost(s, { accion: 'empleadoActivo', id: empleado.id, activo: true });
  assert.equal(entrar(s).ok, true, 'reactivado, entra');
});
test('sesión · cambiar el PIN cambia el hash, cierra las sesiones y el PIN viejo deja de servir', () => {
  const s = cargarScript();
  const { empleado } = crear(s);
  const { token } = entrar(s);
  const hashViejo = s.libro.get('_empleados').celda(2, colEmp.hash);
  const r = duenoPost(s, { accion: 'empleadoPin', id: empleado.id, pin: '9182' });
  assert.equal(r.ok, true);
  assert.notEqual(s.libro.get('_empleados').celda(2, colEmp.hash), hashViejo);
  assert.equal(comoEmpleado(s, token, { accion: 'yo' }).ok, false, 'su sesión se cerró');
  assert.equal(entrar(s).ok, false, 'PIN viejo');
  assert.equal(entrar(s, { pin: '9182' }).ok, true, 'PIN nuevo');
  assert.equal(duenoPost(s, { accion: 'empleadoPin', id: empleado.id, pin: '1111' }).ok, false, 'el PIN nuevo también se valida');
  assert.equal(duenoPost(s, { accion: 'empleadoPin', id: 'no-existe', pin: '9182' }).ok, false);
});
test('sesión · cambiar el PIN desbloquea una cuenta bloqueada', () => {
  const s = cargarScript();
  const { empleado } = crear(s);
  for (let i = 0; i < 5; i++) entrar(s, { pin: '1357' });
  assert.equal(entrar(s).ok, false);
  duenoPost(s, { accion: 'empleadoPin', id: empleado.id, pin: '9182' });
  assert.equal(entrar(s, { pin: '9182' }).ok, true);
});
test('sesión · dos empleados con el mismo PIN tienen hashes distintos (sal propia)', () => {
  const s = cargarScript();
  crear(s);
  crear(s, { usuario: 'ana', nombre: 'Ana', pin: '4829' });
  const h = s.libro.get('_empleados');
  assert.notEqual(h.celda(2, colEmp.hash), h.celda(3, colEmp.hash));
  assert.notEqual(h.celda(2, colEmp.sal), h.celda(3, colEmp.sal));
});
test('compatibilidad · sin empleados el dueño con su clave funciona igual que antes', () => {
  const s = cargarScript();
  assert.equal(duenoPost(s, { accion: 'ping' }).tieneDatos, false);
  assert.equal(duenoPost(s, { accion: 'guardar', datos: datosMinimos }).ok, true);
  assert.equal(s.libro.get('_empleados'), undefined, 'no se crea ninguna pestaña de empleados si no se usan');
});

/* ---------- acciones: una sola tabla (BUG-005, EVA-002) ---------- */
test('acciones · cada acción de la tabla tiene roles y manejador, y «Acción desconocida» sale de un solo sitio', () => {
  const s = cargarScript();
  assert.equal(s.run('Object.keys(ACCIONES).length > 0 && Object.keys(ACCIONES).every(k => typeof ACCIONES[k].ejecutar === "function" && ACCIONES[k].roles.length > 0)'), true);
  assert.equal((CODIGO.match(/Acción desconocida/g) || []).length, 1, 'el mensaje existe en un solo punto del script');
});
test('acciones · nombres heredados de Object (constructor, __proto__, toString…) o que no son texto son «Acción desconocida», sin filtrar errores internos', () => {
  const s = cargarScript();
  crear(s);
  const { token } = entrar(s);
  for (const accion of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 7, null, ['guardar'], { a: 1 }]) {
    assert.equal(duenoPost(s, { accion }).error, 'Acción desconocida', `dueño: ${JSON.stringify(accion)}`);
    assert.equal(comoEmpleado(s, token, { accion }).error, 'Acción desconocida', `empleado: ${JSON.stringify(accion)}`);
  }
});
test('acciones · un origen de caja con nombre heredado («constructor») se copia como texto, no como función', () => {
  const s = cargarScript();
  const r = duenoPost(s, { accion: 'guardar', datos: { ...datosMinimos, movimientos: [{ id: 1, fecha: '2026-11-01', tipo: 'ingreso', monto: 5, origen: 'constructor' }] } });
  assert.equal(r.ok, true, r.error);
  assert.equal(s.libro.get('Caja').celda(2, 5), 'constructor');
});

/* ---------- tipos de Sheets (BUG-003, BUG-006, EVA-003) ---------- */
test('tipos · un nombre que parece fórmula o número se guarda y se devuelve tal cual', () => {
  const s = cargarScript();
  for (const [usuario, nombre] of [['ana', '=1+1'], ['beto', '1234'], ['cris', '+57 300'], ['dina', 'true']]) {
    const r = crear(s, { usuario, nombre });
    assert.equal(r.empleado.nombre, nombre);
    const l = duenoPost(s, { accion: 'empleadoListar' }).empleados.find(e => e.usuario === usuario);
    assert.equal(l.nombre, nombre, `listado de ${usuario}`);
    assert.equal(entrar(s, { usuario }).empleado.nombre, nombre, `login de ${usuario}`);
  }
});
test('tipos · un usuario que Sheets tomaría por booleano o fecha (true, mar-1) sigue entrando y se devuelve como texto', () => {
  const s = cargarScript();
  for (const usuario of ['true', 'false', 'mar-1']) {
    assert.equal(crear(s, { usuario }).ok, true, usuario);
    const r = entrar(s, { usuario });
    assert.equal(r.ok, true, `login de ${usuario}`);
    assert.equal(r.empleado.usuario, usuario);
    assert.equal(typeof duenoPost(s, { accion: 'empleadoListar' }).empleados.find(e => e.usuario === usuario).usuario, 'string');
    assert.equal(crear(s, { usuario }).ok, false, `${usuario} no se puede repetir`);
  }
});
test('tipos · las fechas de las pestañas internas se guardan como texto (no se vuelven Date)', () => {
  const s = cargarScript();
  crear(s);
  entrar(s);
  const emp = s.libro.get('_empleados'), ses = s.libro.get('_sesiones');
  assert.equal(typeof emp.celda(2, colEmp.creado), 'string', 'creado');
  assert.equal(typeof ses.celda(2, 3), 'string', 'creada');
  assert.equal(typeof ses.celda(2, 4), 'string', 'vence');
  for (let i = 0; i < 5; i++) entrar(s, { pin: '1357' });
  assert.equal(typeof emp.celda(2, colEmp.bloqueadoHasta), 'string', 'bloqueadoHasta');
});
test('tipos · si una fecha ya volvió como Date o como número, se entiende igual', () => {
  const s = cargarScript();
  crear(s);
  const { token } = entrar(s);
  const ses = s.libro.get('_sesiones');
  ses.celdas.set('2,4', new Date(Date.now() + 3600000));
  assert.equal(comoEmpleado(s, token, { accion: 'yo' }).ok, true, 'Date vigente');
  ses.celdas.set('2,4', new Date(Date.now() - 1000));
  assert.equal(comoEmpleado(s, token, { accion: 'yo' }).sesion, false, 'Date vencida');
  ses.celdas.set('2,4', Date.now() + 3600000);
  assert.equal(comoEmpleado(s, token, { accion: 'yo' }).ok, true, 'milisegundos');
  s.libro.get('_empleados').celdas.set(`2,${colEmp.bloqueadoHasta}`, new Date(Date.now() + 600000));
  assert.equal(duenoPost(s, { accion: 'empleadoListar' }).empleados[0].bloqueado, true, 'bloqueo como Date');
  assert.equal(entrar(s).ok, false);
});

/* ---------- límite global de intentos de login (BUG-004) ---------- */
test('login · pasado el límite por minuto se rechaza con el mismo mensaje, sin tomar el cerrojo ni leer hojas', () => {
  const s = cargarScript();
  crear(s);
  for (let i = 0; i < 30; i++) entrar(s, { usuario: 'nadie' });
  const antes = { ...s.contadores };
  const r = entrar(s); // ni con el PIN correcto
  assert.deepEqual(plano(r), { ok: false, error: MSJ });
  assert.deepEqual(s.contadores, antes, 'sin cerrojo ni lectura de pestañas');
  assert.equal(duenoPost(s, { accion: 'ping' }).ok, true, 'el dueño sigue entrando con su clave');
  assert.equal(s.contadores.cerrojo, antes.cerrojo + 1);
});

/* ---------- EVA-007: ping del dueño y precedencia de credenciales ---------- */
test('ping · la forma exacta de la respuesta del dueño, con datos y sin ellos', () => {
  const s = cargarScript();
  assert.deepEqual(plano(duenoPost(s, { accion: 'ping' })), { ok: true, tieneDatos: false, version: '' });
  duenoPost(s, { accion: 'guardar', datos: { ...datosMinimos, ventas: [{ id: 1 }], clientes: [{ id: 'c' }] } });
  assert.deepEqual(Object.keys(duenoPost(s, { accion: 'ping' })).sort(), ['actualizado', 'clientes', 'ok', 'tieneDatos', 'ventas', 'version']);
});
test('credenciales · clave mala con token válido es el empleado; token vencido con clave buena es el dueño; clave mala con token vencido avisa que venció', () => {
  const s = cargarScript();
  crear(s);
  const { token } = entrar(s);
  assert.equal(post(s, { clave: 'mala', token, accion: 'yo' }).rol, 'empleado', 'la clave mala no pisa un token válido');
  s.libro.get('_sesiones').celdas.set('2,4', new Date(Date.now() - 1000).toISOString());
  assert.equal(post(s, { clave: CLAVE, token, accion: 'yo' }).rol, 'dueno', 'la clave correcta manda sobre un token vencido');
  const vencida = post(s, { clave: 'mala', token, accion: 'yo' });
  assert.equal(vencida.sesion, false);
  assert.match(vencida.error, /venció/);
  const sinToken = post(s, { clave: 'mala', accion: 'yo' });
  assert.equal(sinToken.error, 'Clave incorrecta');
  assert.equal(sinToken.sesion, undefined, 'sin token no es «sesión vencida»');
});

/* ---------- EVA-008 ---------- */
test('login · lee la pestaña de sesiones una sola vez aunque haya vencidas que limpiar', () => {
  const s = cargarScript();
  crear(s);
  entrar(s); entrar(s);
  const ses = s.libro.get('_sesiones');
  ses.celdas.set('2,4', new Date(Date.now() - 1000).toISOString()); // una vencida y una vigente
  let lecturas = 0;
  const getRange = ses.getRange.bind(ses);
  ses.getRange = (...a) => { const r = getRange(...a), gv = r.getValues; r.getValues = () => { lecturas++; return gv.call(r); }; return r; };
  assert.equal(entrar(s).ok, true);
  assert.equal(lecturas, 1);
  assert.equal(ses.getLastRow(), 3, 'quedan la vigente y la nueva');
});

/* ---------- sincronización por turnos: comprobación de versión (ADR 0003) ---------- */
const guardarCon = (s, base, extra = {}) => duenoPost(s, { accion: 'guardar', datos: { ...datosMinimos, ...extra }, ...(base === undefined ? {} : { base }) });
const comoEmp = (s, token, c) => post(s, { token, ...c });

test('versión · cada envío cambia la versión y leer devuelve la vigente', () => {
  const s = cargarScript();
  const a = guardarCon(s, '');
  assert.equal(a.ok, true);
  assert.match(a.version, /^v[0-9a-z]+$/);
  const b = guardarCon(s, a.version);
  assert.equal(b.ok, true);
  assert.notEqual(b.version, a.version);
  const l = duenoPost(s, { accion: 'leer' });
  assert.equal(l.version, b.version);
  assert.equal(duenoPost(s, { accion: 'ping' }).version, b.version);
});
test('versión · un envío con una versión vieja se rechaza y NO escribe nada', () => {
  const s = cargarScript();
  const a = guardarCon(s, '', { ventas: [{ id: 1 }] });
  const b = guardarCon(s, a.version, { ventas: [{ id: 1 }, { id: 2 }] });     // otro teléfono guardó después
  const antes = duenoPost(s, { accion: 'leer' }).texto;
  const r = guardarCon(s, a.version, { ventas: [{ id: 9 }] });                  // este teléfono sigue con la versión a
  assert.equal(r.ok, false);
  assert.equal(r.conflicto, true);
  assert.equal(r.version, b.version, 'devuelve la versión vigente para poder decidir');
  assert.equal(duenoPost(s, { accion: 'leer' }).texto, antes, 'lo que había quedó intacto');
  assert.equal(duenoPost(s, { accion: 'ping' }).version, b.version);
});
test('versión · un teléfono que nunca sincronizó no pisa un Sheet que ya tiene datos', () => {
  const s = cargarScript();
  guardarCon(s, '');
  const r = guardarCon(s, '');
  assert.equal(r.conflicto, true, 'base vacía contra datos existentes = conflicto');
});
test('versión · sin «base» (una app anterior) se guarda como siempre', () => {
  const s = cargarScript();
  const a = guardarCon(s, '');
  assert.equal(guardarCon(s, undefined).ok, true);
  assert.notEqual(duenoPost(s, { accion: 'ping' }).version, a.version);
});
test('versión · un Sheet con datos de un script anterior (sin versión) se ve como «v0» y obliga a decidir una vez', () => {
  const s = cargarScript();
  guardarCon(s);                                                  // sin base: queda con versión
  s.libro.get('_respaldo').celdas.delete('7,2');                  // como lo dejaba el script de antes
  assert.equal(duenoPost(s, { accion: 'ping' }).version, 'v0');
  assert.equal(guardarCon(s, '').conflicto, true);
  assert.equal(guardarCon(s, 'v0').ok, true);
});
test('versión · el empleado carga y guarda con la misma comprobación, y no ve cifras en su ping', () => {
  const s = cargarScript();
  crear(s);
  const { token } = entrar(s);
  const a = comoEmp(s, token, { accion: 'guardar', datos: datosMinimos, base: '' });
  assert.equal(a.ok, true);
  const l = comoEmp(s, token, { accion: 'leer' });
  assert.equal(l.ok, true);
  assert.equal(l.version, a.version);
  assert.equal(comoEmp(s, token, { accion: 'guardar', datos: datosMinimos, base: 'v-vieja' }).conflicto, true);
  assert.equal(comoEmp(s, token, { accion: 'clientes' }).prohibido, true, 'lo demás sigue siendo del dueño');
});
test('versión · el empleado que guarda deja una copia anterior para recuperar', () => {
  const s = cargarScript();
  crear(s);
  const { token } = entrar(s);
  const a = comoEmp(s, token, { accion: 'guardar', datos: { ...datosMinimos, ventas: [{ id: 1 }] }, base: '' });
  comoEmp(s, token, { accion: 'guardar', datos: { ...datosMinimos, ventas: [] }, base: a.version });
  assert.ok(s.libro.get('_respaldo_anterior'), 'queda la generación anterior');
  assert.match(s.libro.get('_respaldo_anterior').celda(1, 1), /"id":1/);
});
test('versión · dos envíos seguidos con la misma base: gana el primero, el segundo es conflicto (el cerrojo los ordena)', () => {
  const s = cargarScript();
  const a = guardarCon(s, '');
  const x = guardarCon(s, a.version, { ventas: [{ id: 1 }] });
  const y = guardarCon(s, a.version, { ventas: [{ id: 2 }] });
  assert.equal(x.ok, true);
  assert.equal(y.conflicto, true);
  assert.match(duenoPost(s, { accion: 'leer' }).texto, /"id":1/);
});
