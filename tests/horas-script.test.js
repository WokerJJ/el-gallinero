'use strict';
/* Reloj de horas en apps-script/Code.gs (ADR 0005): el empleado ficha su entrada con la hora del SERVIDOR, la salida la marca el
   cierre de caja del dueño, sin descansos, en minutos exactos y con los días en hora de Colombia. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { cargarScript, post } = require('./arnes-script');

const CLAVE = 'k-secreta';
const dueno = (s, c) => post(s, { clave: CLAVE, ...c });
const crear = (s, o = {}) => dueno(s, { accion: 'empleadoCrear', nombre: 'Luis Pérez', usuario: 'luis', pin: '4829', ...o });
const entrar = (s, o = {}) => post(s, { accion: 'login', usuario: 'luis', pin: '4829', ...o }).token;
const emp = (s, token, c) => post(s, { token, ...c });
const hace = ms => new Date(Date.now() - ms).toISOString();
const MIN = 60000, HORA = 3600000;
const fichajes = s => s.libro.get('_fichajes');
// columnas de _fichajes: id 1, empleadoId 2, nombre 3, entrada 4, salida 5, cierre 6, nota 7, creado 8
const ponerEntrada = (s, fila, iso) => fichajes(s).celdas.set(`${fila},4`, iso);
function equipo() {
  const s = cargarScript();
  crear(s); crear(s, { usuario: 'ana', nombre: 'Ana Gil', pin: '7351' });
  return { s, luis: entrar(s), ana: entrar(s, { usuario: 'ana', pin: '7351' }) };
}

/* ---------- entrada ---------- */
test('fichar · el empleado abre su turno con la hora del servidor, no la del teléfono', () => {
  const { s, luis } = equipo();
  const r = emp(s, luis, { accion: 'fichar', entrada: '2000-01-01T00:00:00Z', ahora: '2000-01-01T00:00:00Z', hora: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.yaAbierto, false);
  assert.ok(Math.abs(Date.parse(r.turno.entrada) - Date.now()) < 5000, 'la hora que manda el teléfono se ignora');
  assert.equal(r.turno.abierto, true);
  assert.equal(r.turno.nombre, 'Luis Pérez');
  assert.equal(fichajes(s).oculta, true, 'la pestaña de turnos es oculta');
});
test('fichar · pulsar dos veces devuelve el mismo turno y no crea otro', () => {
  const { s, luis } = equipo();
  const a = emp(s, luis, { accion: 'fichar' }), b = emp(s, luis, { accion: 'fichar' });
  assert.equal(b.yaAbierto, true);
  assert.equal(b.turno.id, a.turno.id);
  assert.equal(fichajes(s).getLastRow(), 2, 'una sola fila de turno (más la cabecera)');
});
test('fichar · solo el empleado ficha: el dueño y quien no entró no pueden', () => {
  const { s } = equipo();
  assert.equal(dueno(s, { accion: 'fichar' }).prohibido, true);
  assert.equal(post(s, { accion: 'fichar' }).ok, false);
  assert.equal(emp(s, 'a'.repeat(64), { accion: 'fichar' }).ok, false);
});
test('fichar · cada empleado tiene su propio turno abierto', () => {
  const { s, luis, ana } = equipo();
  const a = emp(s, luis, { accion: 'fichar' }), b = emp(s, ana, { accion: 'fichar' });
  assert.notEqual(a.turno.id, b.turno.id);
  assert.equal(fichajes(s).getLastRow(), 3);
});

/* ---------- lo que ve el empleado ---------- */
test('miTurno · muestra su turno abierto y sus minutos de hoy, sin datos de los demás', () => {
  const { s, luis, ana } = equipo();
  emp(s, luis, { accion: 'fichar' }); emp(s, ana, { accion: 'fichar' });
  ponerEntrada(s, 2, hace(90 * MIN));
  const r = emp(s, luis, { accion: 'miTurno' });
  assert.equal(r.ok, true);
  assert.equal(r.turno.abierto, true);
  assert.ok(r.turno.minutos >= 89 && r.turno.minutos <= 91, `minutos ${r.turno.minutos}`);
  assert.deepEqual(Object.keys(r).sort(), ['ahora', 'hoyMin', 'ok', 'semanaMin', 'turno']);
  assert.ok(!JSON.stringify(r).includes('Ana'), 'no trae nada de otro empleado');
  assert.ok(r.semanaMin >= r.hoyMin);
});
test('miTurno · sin turno abierto dice «turno: null» y el dueño no lo usa', () => {
  const { s, luis } = equipo();
  assert.equal(emp(s, luis, { accion: 'miTurno' }).turno, null);
  assert.equal(dueno(s, { accion: 'miTurno' }).prohibido, true);
});
test('miTurno · las horas son salida − entrada, sin restar descansos', () => {
  const { s, luis } = equipo();
  emp(s, luis, { accion: 'fichar' });
  ponerEntrada(s, 2, hace(3 * HORA));
  dueno(s, { accion: 'turnosCerrar' });
  const t = dueno(s, { accion: 'turnosListar', desde: '2020-01-01', hasta: '2099-12-31' });
  assert.equal(t.ok, false, 'rango de más de 92 días');
  const hoy = new Date(Date.now() - 5 * HORA).toISOString().slice(0, 10);
  const ayer = new Date(Date.now() - 5 * HORA - 86400000).toISOString().slice(0, 10);
  const l = dueno(s, { accion: 'turnosListar', desde: ayer, hasta: hoy });
  assert.ok(l.turnos[0].minutos >= 179 && l.turnos[0].minutos <= 181, `3 horas exactas, no menos: ${l.turnos[0].minutos}`);
});

/* ---------- el cierre de caja marca la salida ---------- */
test('cierre · turnosCerrar marca la salida de todos los turnos abiertos, solo el dueño, y una segunda vez no cierra nada', () => {
  const { s, luis, ana } = equipo();
  emp(s, luis, { accion: 'fichar' }); emp(s, ana, { accion: 'fichar' });
  assert.equal(emp(s, luis, { accion: 'turnosCerrar' }).prohibido, true, 'el empleado no cierra turnos');
  const r = dueno(s, { accion: 'turnosCerrar' });
  assert.equal(r.ok, true);
  assert.equal(r.cerrados.length, 2);
  assert.ok(r.cerrados.every(c => c.abierto === false && c.cierre === 'cierre'));
  assert.equal(emp(s, luis, { accion: 'miTurno' }).turno, null);
  assert.equal(dueno(s, { accion: 'turnosCerrar' }).cerrados.length, 0, 'idempotente');
  assert.equal(dueno(s, { accion: 'turnosAbiertos' }).abiertos.length, 0);
});
test('cierre · si la llamada se demoró, usa la hora del cierre; nunca una futura; y no toca turnos que empezaron después', () => {
  const { s, luis, ana } = equipo();
  emp(s, luis, { accion: 'fichar' }); emp(s, ana, { accion: 'fichar' });
  ponerEntrada(s, 2, hace(3 * HORA));               // Luis entró hace 3 h
  ponerEntrada(s, 3, hace(30 * MIN));               // Ana entró hace 30 min (después del cierre)
  const r = dueno(s, { accion: 'turnosCerrar', cierreEn: hace(HORA) });
  assert.equal(r.cerrados.length, 1, 'Ana empezó después del cierre: sigue abierta');
  assert.equal(r.cerrados[0].nombre, 'Luis Pérez');
  assert.ok(r.cerrados[0].minutos >= 119 && r.cerrados[0].minutos <= 121, `2 h hasta el cierre: ${r.cerrados[0].minutos}`);
  assert.equal(emp(s, ana, { accion: 'miTurno' }).turno.abierto, true);
  // una hora de cierre futura se acota a «ahora»
  const f = dueno(s, { accion: 'turnosCerrar', cierreEn: new Date(Date.now() + 5 * HORA).toISOString() });
  assert.ok(Date.parse(f.cerrados[0].salida) <= Date.now() + 1000);
});
test('tope · un turno abierto más de 16 horas se cierra solo, marcado «tope», y el empleado puede fichar de nuevo', () => {
  const { s, luis } = equipo();
  emp(s, luis, { accion: 'fichar' });
  ponerEntrada(s, 2, hace(20 * HORA));
  const r = emp(s, luis, { accion: 'fichar' });
  assert.equal(r.yaAbierto, false, 'el viejo se cerró y se abrió uno nuevo');
  assert.equal(fichajes(s).celda(2, 6), 'tope');
  const salida = Date.parse(fichajes(s).celda(2, 5)), entrada = Date.parse(fichajes(s).celda(2, 4));
  assert.equal(salida - entrada, 16 * HORA);
  assert.equal(fichajes(s).getLastRow(), 3);
});

/* ---------- días en hora de Colombia ---------- */
test('hora de Colombia · el día y la semana empiezan a las 05:00 UTC y la semana el lunes', () => {
  const s = cargarScript();
  // 2026-11-18 03:00 UTC = 22:00 del 17 en Colombia
  assert.equal(new Date(s.run("inicioDiaCo_(Date.parse('2026-11-18T03:00:00Z'))")).toISOString(), '2026-11-17T05:00:00.000Z');
  // 2026-11-18 (miércoles) → la semana empezó el lunes 16 a las 00:00 de Colombia
  assert.equal(new Date(s.run("inicioSemanaCo_(Date.parse('2026-11-18T15:00:00Z'))")).toISOString(), '2026-11-16T05:00:00.000Z');
  // domingo 22 → sigue en la semana del lunes 16
  assert.equal(new Date(s.run("inicioSemanaCo_(Date.parse('2026-11-22T15:00:00Z'))")).toISOString(), '2026-11-16T05:00:00.000Z');
});
test('hora de Colombia · un turno que cruza la medianoche cuenta cada día lo suyo', () => {
  const { s } = equipo();
  dueno(s, { accion: 'turnosListar', desde: '2026-11-01', hasta: '2026-11-02' });       // crea la tabla
  // 23:00 del 9 → 01:00 del 10, hora de Colombia
  const h = fichajes(s);
  [['f1', 'e1', 'Luis Pérez', '2026-11-10T04:00:00.000Z', '2026-11-10T06:00:00.000Z', 'cierre', '', '2026-11-10T04:00:00.000Z']].forEach(fila => fila.forEach((v, i) => h.celdas.set(`2,${i + 1}`, v)));
  const min = (a, b) => dueno(s, { accion: 'turnosListar', desde: a, hasta: b }).totales[0].minutos;
  assert.equal(min('2026-11-09', '2026-11-09'), 60);
  assert.equal(min('2026-11-10', '2026-11-10'), 60);
  assert.equal(min('2026-11-09', '2026-11-10'), 120);
});

/* ---------- listar ---------- */
test('turnosListar · totales por empleado, rango validado y solo para el dueño', () => {
  const { s, luis, ana } = equipo();
  emp(s, luis, { accion: 'fichar' }); emp(s, ana, { accion: 'fichar' });
  ponerEntrada(s, 2, hace(2 * HORA)); ponerEntrada(s, 3, hace(HORA));
  dueno(s, { accion: 'turnosCerrar' });
  const hoy = new Date(Date.now() - 5 * HORA).toISOString().slice(0, 10), ayer = new Date(Date.now() - 5 * HORA - 86400000).toISOString().slice(0, 10);
  const l = dueno(s, { accion: 'turnosListar', desde: ayer, hasta: hoy });
  assert.equal(l.ok, true);
  assert.equal(l.turnos.length, 2);
  const por = Object.fromEntries(l.totales.map(t => [t.nombre, t.minutos]));
  assert.ok(por['Luis Pérez'] >= 119 && por['Ana Gil'] >= 59);
  assert.equal(dueno(s, { accion: 'turnosListar', desde: 'mañana', hasta: hoy }).ok, false);
  assert.equal(dueno(s, { accion: 'turnosListar', desde: hoy, hasta: ayer }).ok, false, 'rango al revés');
  assert.equal(emp(s, luis, { accion: 'turnosListar', desde: ayer, hasta: hoy }).prohibido, true);
});

/* ---------- correcciones del dueño, con rastro ---------- */
test('corregir · pide motivo, valida las horas y deja el antes y el después en el registro', () => {
  const { s, luis } = equipo();
  emp(s, luis, { accion: 'fichar' });
  ponerEntrada(s, 2, hace(5 * HORA));
  dueno(s, { accion: 'turnosCerrar' });
  const id = fichajes(s).celda(2, 1);
  const nueva = hace(6 * HORA);
  assert.equal(dueno(s, { accion: 'fichajeCorregir', id, entrada: nueva }).ok, false, 'sin motivo');
  assert.equal(dueno(s, { accion: 'fichajeCorregir', id, entrada: nueva, motivo: 'ab' }).ok, false, 'motivo muy corto');
  assert.equal(dueno(s, { accion: 'fichajeCorregir', id, entrada: new Date(Date.now() + 9 * HORA).toISOString(), motivo: 'prueba' }).ok, false, 'futura');
  assert.equal(dueno(s, { accion: 'fichajeCorregir', id, salida: hace(10 * HORA), motivo: 'prueba' }).ok, false, 'salida antes de la entrada');
  assert.equal(dueno(s, { accion: 'fichajeCorregir', id: 'no-existe', entrada: nueva, motivo: 'prueba' }).ok, false);
  assert.equal(dueno(s, { accion: 'fichajeCorregir', id, motivo: 'sin cambios' }).ok, false, 'no cambió nada');
  const r = dueno(s, { accion: 'fichajeCorregir', id, entrada: nueva, motivo: 'Llegó una hora antes' });
  assert.equal(r.ok, true);
  assert.equal(r.turno.cierre, 'corregido');
  const log = s.libro.get('_fichajes_log');
  assert.equal(log.oculta, true);
  assert.equal(log.celda(2, 2), 'Dueño');
  assert.equal(log.celda(2, 3), id);
  assert.equal(log.celda(2, 4), 'entrada');
  assert.ok(Date.parse(log.celda(2, 5)) > Date.parse(log.celda(2, 6)), 'quedó lo de antes y lo de después');
  assert.equal(log.celda(2, 7), 'Llegó una hora antes');
  assert.equal(emp(s, entrar(s), { accion: 'fichajeCorregir', id, entrada: nueva, motivo: 'trampa' }).prohibido, true, 'el empleado no corrige horas');
});
test('agregar · un turno olvidado se agrega con motivo, no puede cruzarse con otro ni ser futuro, y queda en el registro', () => {
  const { s, luis } = equipo();
  const id = dueno(s, { accion: 'empleadoListar' }).empleados.find(e => e.usuario === 'luis').id;
  const e = hace(30 * HORA), sal = hace(22 * HORA);
  assert.equal(dueno(s, { accion: 'fichajeAgregar', empleadoId: id, entrada: e, salida: sal }).ok, false, 'sin motivo');
  const r = dueno(s, { accion: 'fichajeAgregar', empleadoId: id, entrada: e, salida: sal, motivo: 'Olvidó fichar' });
  assert.equal(r.ok, true);
  assert.equal(r.turno.cierre, 'manual');
  assert.equal(r.turno.minutos, 8 * 60);
  assert.equal(dueno(s, { accion: 'fichajeAgregar', empleadoId: id, entrada: hace(26 * HORA), salida: hace(24 * HORA), motivo: 'se cruza' }).ok, false, 'se cruza con el anterior');
  assert.equal(dueno(s, { accion: 'fichajeAgregar', empleadoId: id, entrada: hace(HORA), salida: new Date(Date.now() + 9 * HORA).toISOString(), motivo: 'futuro' }).ok, false);
  assert.equal(dueno(s, { accion: 'fichajeAgregar', empleadoId: 'no-existe', entrada: e, salida: sal, motivo: 'nadie' }).ok, false);
  assert.equal(dueno(s, { accion: 'fichajeAgregar', empleadoId: id, entrada: sal, salida: e, motivo: 'al revés' }).ok, false);
  assert.equal(s.libro.get('_fichajes_log').celda(2, 4), 'agregado');
  assert.equal(emp(s, luis, { accion: 'fichajeAgregar', empleadoId: id, entrada: e, salida: sal, motivo: 'trampa' }).prohibido, true);
});

/* ---------- independencia del respaldo y de la sesión ---------- */
test('turnos · el envío del estado completo no los pisa y los datos de la app no los modifican', () => {
  const { s, luis } = equipo();
  emp(s, luis, { accion: 'fichar' });
  const datos = { app: 'el-gallinero', products: [], ventas: [], entradas: [], clientes: [] };
  assert.equal(dueno(s, { accion: 'guardar', datos }).ok, true);
  assert.equal(emp(s, luis, { accion: 'miTurno' }).turno.abierto, true, 'el turno sigue abierto tras un guardado');
  assert.equal(fichajes(s).getLastRow(), 2);
});
test('turnos · un empleado desactivado ya no ficha, y su turno abierto lo cierra el cierre de caja', () => {
  const { s, luis } = equipo();
  const id = dueno(s, { accion: 'empleadoListar' }).empleados.find(e => e.usuario === 'luis').id;
  emp(s, luis, { accion: 'fichar' });
  dueno(s, { accion: 'empleadoActivo', id, activo: false });
  assert.equal(emp(s, luis, { accion: 'fichar' }).ok, false, 'su token dejó de valer');
  assert.equal(dueno(s, { accion: 'turnosCerrar' }).cerrados.length, 1, 'el turno abierto igual se cierra');
});
test('turnos · el nombre con fórmula o números se guarda como texto y los turnos se leen igual', () => {
  const s = cargarScript();
  crear(s, { nombre: '=1+1', usuario: 'zoe', pin: '4829' });
  const t = entrar(s, { usuario: 'zoe' });
  assert.equal(emp(s, t, { accion: 'fichar' }).turno.nombre, '=1+1');
  assert.equal(emp(s, t, { accion: 'miTurno' }).turno.nombre, '=1+1');
});
test('acciones · las del reloj están en la tabla con el rol correcto', () => {
  const s = cargarScript();
  const tabla = JSON.parse(s.run("JSON.stringify(Object.keys(ACCIONES).reduce(function (o, k) { o[k] = ACCIONES[k].roles; return o; }, {}))"));
  assert.deepEqual(tabla.fichar, ['empleado']);
  assert.deepEqual(tabla.miTurno, ['empleado']);
  for (const a of ['turnosAbiertos', 'turnosCerrar', 'turnosListar', 'fichajeCorregir', 'fichajeAgregar']) assert.deepEqual(tabla[a], ['dueno'], a);
});
