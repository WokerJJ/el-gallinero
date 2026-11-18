/**
 * El Gallinero · copia en Google Sheets
 *
 * Pega este script en el Google Sheet (Extensiones → Apps Script) y publícalo como «Aplicación web».
 * La app del teléfono le envía los datos; el script:
 *   1. los guarda completos en la pestaña oculta «_respaldo» (para restaurar si cambias de celular), y
 *   2. arma pestañas legibles: Inventario, Ventas, Compras, Clientes y Pérdidas.
 * Cada envío REEMPLAZA el contenido de las pestañas: no se duplican filas aunque se envíe muchas veces.
 *
 * Solo se reescribe el bloque de la tabla (las columnas de cada pestaña). Lo que agregues a la derecha, o en otras
 * pestañas (fórmulas, gráficos, un panel), no se toca. No cambies el nombre de las pestañas ni el orden de las columnas.
 * IMPORTANTE: debajo de las tablas espejo no pongas nada en esas mismas columnas (totales, notas): cada envío limpia
 * todas las filas de la pestaña, de la 2 hasta el final, solo en las columnas de la tabla.
 *
 * La pestaña oculta «_respaldo» guarda el respaldo completo en la columna A (en trozos) y, en la columna B, datos sueltos
 * que los paneles pueden leer sin tocar el JSON: B1 fecha del último envío, B2 nº de ventas, B3 nº de clientes,
 * B4 alerta de stock bajo, B5 margen sugerido (%), B6 vida útil del huevo (días) y B7 la versión (cambia en cada envío).
 *
 * Además, la pestaña «Cargar clientes» es de entrada: tú la llenas y la app la lee (acción «clientes»).
 * Úsala con la plantilla de Excel del proyecto (carpeta plantilla/).
 */

// Escribe aquí una clave tuya (la misma que pondrás en la app). Funciona como contraseña del enlace.
const CLAVE = 'CAMBIA-ESTA-CLAVE';

// «Cargar clientes»: columnas de entrada (la plantilla de Excel se genera a partir de esta lista).
const HOJA_IMPORTAR = ['Nombre', 'Teléfono', 'Notas / dirección'];
const NOMBRE_CARGAR = 'Cargar clientes'; // pestaña de ENTRADA: la app nunca la escribe ni la borra (la pestaña «Clientes» es el espejo y sí se reescribe)
const NOTA_CARGAR = ['Aquí pegas tú los clientes nuevos', 'Desde la fila 2: A nombre, B teléfono, C notas. Esta pestaña no se borra.', 'En la app: Más → Google Sheets → «Traer clientes del Sheet».'];
const MAX_CLIENTES = 5000; // tope de filas con nombre que se entregan a la app en una lectura

const TROZO = 40000; // una celda admite 50.000 caracteres; se parte el respaldo en trozos

function doGet() {
  return salida_({ ok: true, app: 'el-gallinero', mensaje: 'El script está publicado. Copia este enlace en la app (Más → Google Sheets).' });
}

function doPost(e) {
  let p;
  try { p = JSON.parse(e.postData.contents); } catch (err) { return salida_({ ok: false, error: 'Solicitud inválida' }); }
  if (CLAVE === 'CAMBIA-ESTA-CLAVE') return salida_({ ok: false, error: 'Falta cambiar la CLAVE dentro del script' });
  if (!p || typeof p !== 'object') return salida_({ ok: false, error: 'Solicitud inválida' });
  // Sin la clave del dueño ni un token no hay nada que hacer (salvo entrar con usuario y PIN): se rechaza sin tomar el cerrojo.
  const claveOk = typeof p.clave === 'string' && igualesCte_(p.clave, CLAVE);
  if (p.accion !== 'login' && !claveOk && typeof p.token !== 'string') return salida_({ ok: false, error: 'Clave incorrecta' });

  // Tope global de entradas por minuto: así un chorro de intentos no ocupa el cerrojo ni deja al dueño sin poder entrar.
  if (p.accion === 'login' && loginExcedido_()) return salida_({ ok: false, error: MSJ_LOGIN });

  const cerrojo = LockService.getScriptLock();
  if (!cerrojo.tryLock(20000)) return salida_({ ok: false, error: 'El Sheet está ocupado, intenta de nuevo' });
  try {
    if (p.accion === 'login') return salida_(login_(p));
    const quien = autenticar_(p);
    if (!quien) return salida_(typeof p.token === 'string' && !claveOk ? { ok: false, error: 'La sesión venció: entra de nuevo', sesion: false } : { ok: false, error: 'Clave incorrecta' });
    // Solo existe lo que está en la tabla ACCIONES (propiedades propias: «constructor» o «__proto__» no cuentan).
    const accion = typeof p.accion === 'string' && Object.prototype.hasOwnProperty.call(ACCIONES, p.accion) ? ACCIONES[p.accion] : null;
    if (!accion) return salida_({ ok: false, error: 'Acción desconocida' });
    if (accion.roles.indexOf(quien.rol) < 0) return salida_({ ok: false, error: 'No tienes permiso para esta acción', prohibido: true });
    return salida_(accion.ejecutar(p, quien));
  } catch (err) {
    return salida_({ ok: false, error: String((err && err.message) || err) });
  } finally {
    cerrojo.releaseLock();
  }
}

/* ---------- Empleados, PIN y sesiones (ADR 0002) ----------
 * El dueño sigue entrando con la CLAVE de arriba. Cada empleado tiene un usuario y un PIN de 4 a 6 dígitos que crea el dueño.
 * El PIN se guarda con sal y hash (nunca en claro) en la pestaña oculta «_empleados»; al entrar se entrega un token que se
 * guarda solo como hash en «_sesiones». Los permisos de cada rol se deciden AQUÍ (ACCIONES), no en la pantalla del teléfono.
 * Límite conocido: un PIN corto tiene pocas combinaciones; lo protege el bloqueo (MAX_INTENTOS fallos → BLOQUEO_MIN minutos). */
const HOJA_EMPLEADOS = '_empleados';
const CAB_EMPLEADOS = ['id', 'usuario', 'nombre', 'sal', 'hash', 'activo', 'intentos', 'bloqueadoHasta', 'creado'];
const HOJA_SESIONES = '_sesiones';
const CAB_SESIONES = ['hashToken', 'empleadoId', 'creada', 'vence'];
const MAX_INTENTOS = 5;
const BLOQUEO_MIN = 15;
const SESION_HORAS = 12;
const MSJ_LOGIN = 'Usuario o PIN incorrecto, o la cuenta está bloqueada';
const MSJ_PIN = 'El PIN debe tener de 4 a 6 dígitos, sin repetir el mismo número ni ser una escalera (1234)';
const MAX_LOGIN_MINUTO = 30; // entradas (acertadas o no) que acepta todo el script por minuto

// Todo lo que el script sabe hacer (salvo «login», que no exige credenciales): qué roles pueden pedirlo y quién lo ejecuta.
// Lo que no está aquí no existe. El empleado nunca puede guardar, leer ni administrar: mientras el Sheet sea un espejo
// por reemplazo, un envío suyo pisaría los datos del negocio.
const ACCIONES = {
  ping: { roles: ['dueno', 'empleado'], ejecutar: function (p, q) { return estado_(q.rol !== 'dueno'); } },
  yo: { roles: ['dueno', 'empleado'], ejecutar: function (p, q) { return yo_(q); } },
  salir: { roles: ['dueno', 'empleado'], ejecutar: function (p, q) { return salir_(q); } },
  guardar: { roles: ['dueno', 'empleado'], ejecutar: function (p) { return guardar_(p.datos, p.base); } },
  leer: { roles: ['dueno', 'empleado'], ejecutar: function () { return leer_(); } },
  clientes: { roles: ['dueno'], ejecutar: function () { return clientesImportar_(); } },
  empleadoCrear: { roles: ['dueno'], ejecutar: function (p) { return empleadoCrear_(p); } },
  empleadoListar: { roles: ['dueno'], ejecutar: function () { return empleadoListar_(); } },
  empleadoPin: { roles: ['dueno'], ejecutar: function (p) { return empleadoPin_(p); } },
  empleadoActivo: { roles: ['dueno'], ejecutar: function (p) { return empleadoActivo_(p); } }
};

// Límite global de entradas por minuto, con la caché del script (ventana fija de un minuto). Es de mejor esfuerzo: la lectura y la
// escritura no son atómicas, así que bajo carga extrema pueden colarse unas pocas de más. Si la caché falla, no bloquea a nadie.
function loginExcedido_() {
  try {
    const cache = CacheService.getScriptCache(), clave = 'login:' + Math.floor(Date.now() / 60000);
    const n = Number(cache.get(clave)) || 0;
    if (n >= MAX_LOGIN_MINUTO) return true;
    cache.put(clave, String(n + 1), 120);
  } catch (err) { /* sin caché no hay límite, pero tampoco se impide entrar */ }
  return false;
}

// Los hashes y tokens llevan una «x» delante: así Sheets nunca los toma por un número ni por una fórmula.
function sha_(texto) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texto, Utilities.Charset.UTF_8);
  return 'x' + bytes.map(function (b) { return ((b < 0 ? b + 256 : b) + 256).toString(16).slice(1); }).join('');
}
function aleatorio_() { return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); }
function igualesCte_(a, b) {
  a = String(a); b = String(b);
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
function hashPin_(sal, pin) { return sha_(sal + ':' + pin); }

// Un PIN de 4 a 6 dígitos, sin repetir el mismo dígito ni ser una escalera (1234, 4321).
function pinValido_(pin) {
  if (typeof pin !== 'string' || !/^\d{4,6}$/.test(pin)) return false;
  if (/^(\d)\1+$/.test(pin)) return false;
  let sube = true, baja = true;
  for (let i = 1; i < pin.length; i++) {
    const d = Number(pin[i]) - Number(pin[i - 1]);
    if (d !== 1) sube = false;
    if (d !== -1) baja = false;
  }
  return !(sube || baja);
}
// Fecha guardada como texto ISO (lo normal), como Date o como milisegundos (si se guardó así): siempre devuelve milisegundos.
function ms_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return v.getTime();
  const t = String(v == null ? '' : v);
  return /^[0-9]+$/.test(t) ? Number(t) : Date.parse(t); // milisegundos (tabla_ los entrega como texto) o texto ISO
}
function usuarioNorm_(u) { return String(u == null ? '' : u).trim().toLowerCase(); }

// Una pestaña oculta con cabecera; se crea sola. Devuelve las filas como objetos (con su número de fila).
function tabla_(nombre, cab) {
  const libro = libro_();
  let h = libro.getSheetByName(nombre);
  if (!h) {
    h = libro.insertSheet(nombre);
    h.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold');
    h.setFrozenRows(1);
    h.hideSheet();
  }
  const filas = [];
  const ultima = h.getLastRow();
  if (ultima >= 2) {
    h.getRange(2, 1, ultima - 1, cab.length).getValues().forEach(function (v, i) {
      const o = { fila: i + 2 };
      // Todo vuelve como texto (Sheets puede haber convertido «true», «1234» o «mar-1»); solo las fechas se dejan tal cual para ms_().
      cab.forEach(function (k, j) { o[k] = Object.prototype.toString.call(v[j]) === '[object Date]' ? v[j] : String(v[j] == null ? '' : v[j]); });
      filas.push(o);
    });
  }
  return { h: h, cab: cab, filas: filas };
}
function escribirFila_(t, fila, obj) {
  if (t.h.getMaxRows() < fila) t.h.insertRowsAfter(t.h.getMaxRows(), fila - t.h.getMaxRows());
  // Texto plano ('@') en todas las columnas ANTES de escribir: así Sheets no evalúa «=…» ni convierte «1234», «true» o una fecha ISO.
  const r = t.h.getRange(fila, 1, 1, t.cab.length);
  r.setNumberFormat('@');
  r.setValues([t.cab.map(function (k) { return obj[k] == null ? '' : obj[k]; })]);
}
function agregarFila_(t, obj) { escribirFila_(t, Math.max(t.h.getLastRow(), 1) + 1, obj); }
// Reescribe la tabla solo con las filas que cumplen el filtro y devuelve la tabla al día (sin volver a leer la hoja).
function conservarFilas_(t, cumple) {
  const quedan = t.filas.filter(cumple);
  if (quedan.length === t.filas.length) return t;
  if (t.h.getMaxRows() > 1) t.h.getRange(2, 1, t.h.getMaxRows() - 1, t.cab.length).clearContent();
  quedan.forEach(function (o, i) { o.fila = i + 2; escribirFila_(t, i + 2, o); });
  return { h: t.h, cab: t.cab, filas: quedan };
}
const activo_ = function (e) { return String(e.activo) === 'si'; };

function revocarSesiones_(empleadoId) {
  const t = tabla_(HOJA_SESIONES, CAB_SESIONES);
  conservarFilas_(t, function (s) { return String(s.empleadoId) !== String(empleadoId); });
}

function empleadoPublico_(e) {
  return { id: e.id, usuario: e.usuario, nombre: e.nombre, activo: activo_(e), bloqueado: !!e.bloqueadoHasta && ms_(e.bloqueadoHasta) > Date.now() };
}

function empleadoCrear_(p) {
  const nombre = String(p.nombre == null ? '' : p.nombre).trim().slice(0, 40);
  const usuario = usuarioNorm_(p.usuario);
  if (!nombre) return { ok: false, error: 'Escribe el nombre del empleado' };
  if (!/^[a-z][a-z0-9._-]{2,19}$/.test(usuario)) return { ok: false, error: 'El usuario debe empezar con una letra y tener de 3 a 20 letras, números, punto, guion o guion bajo' };
  if (!pinValido_(p.pin)) return { ok: false, error: MSJ_PIN };
  const t = tabla_(HOJA_EMPLEADOS, CAB_EMPLEADOS);
  if (t.filas.some(function (e) { return String(e.usuario) === usuario; })) return { ok: false, error: 'Ya existe un empleado con ese usuario' };
  const sal = aleatorio_();
  const e = { id: 'e' + Utilities.getUuid().replace(/-/g, '').slice(0, 10), usuario: usuario, nombre: nombre, sal: 'x' + sal, hash: hashPin_('x' + sal, p.pin), activo: 'si', intentos: 0, bloqueadoHasta: '', creado: new Date().toISOString() };
  agregarFila_(t, e);
  return { ok: true, empleado: empleadoPublico_(e) };
}

function empleadoListar_() {
  return { ok: true, empleados: tabla_(HOJA_EMPLEADOS, CAB_EMPLEADOS).filas.map(empleadoPublico_) };
}

function buscarEmpleado_(t, id) {
  for (let i = 0; i < t.filas.length; i++) if (String(t.filas[i].id) === String(id)) return t.filas[i];
  return null;
}

function empleadoPin_(p) {
  if (!pinValido_(p.pin)) return { ok: false, error: MSJ_PIN };
  const t = tabla_(HOJA_EMPLEADOS, CAB_EMPLEADOS);
  const e = buscarEmpleado_(t, p.id);
  if (!e) return { ok: false, error: 'No existe ese empleado' };
  const sal = 'x' + aleatorio_();
  e.sal = sal; e.hash = hashPin_(sal, p.pin); e.intentos = 0; e.bloqueadoHasta = '';
  escribirFila_(t, e.fila, e);
  revocarSesiones_(e.id); // cambiar el PIN cierra las sesiones abiertas
  return { ok: true, empleado: empleadoPublico_(e) };
}

function empleadoActivo_(p) {
  const t = tabla_(HOJA_EMPLEADOS, CAB_EMPLEADOS);
  const e = buscarEmpleado_(t, p.id);
  if (!e) return { ok: false, error: 'No existe ese empleado' };
  e.activo = p.activo === true ? 'si' : 'no';
  escribirFila_(t, e.fila, e);
  if (!activo_(e)) revocarSesiones_(e.id);
  return { ok: true, empleado: empleadoPublico_(e) };
}

// Entrada de un empleado. No pide la CLAVE (el empleado no la conoce). Todos los fallos dan el mismo mensaje.
function login_(p) {
  const usuario = usuarioNorm_(p.usuario);
  const pin = typeof p.pin === 'string' ? p.pin : '';
  const t = tabla_(HOJA_EMPLEADOS, CAB_EMPLEADOS);
  let e = null;
  for (let i = 0; i < t.filas.length; i++) if (String(t.filas[i].usuario) === usuario) e = t.filas[i];
  if (!e || !activo_(e)) return { ok: false, error: MSJ_LOGIN };
  const ahora = Date.now();
  if (e.bloqueadoHasta && ms_(e.bloqueadoHasta) > ahora) return { ok: false, error: MSJ_LOGIN };
  if (!igualesCte_(hashPin_(e.sal, pin), e.hash)) {
    e.intentos = (Number(e.intentos) || 0) + 1;
    if (e.intentos >= MAX_INTENTOS) { e.bloqueadoHasta = new Date(ahora + BLOQUEO_MIN * 60000).toISOString(); e.intentos = 0; }
    escribirFila_(t, e.fila, e);
    return { ok: false, error: MSJ_LOGIN };
  }
  e.intentos = 0; e.bloqueadoHasta = '';
  escribirFila_(t, e.fila, e);
  const token = aleatorio_();
  const vence = new Date(ahora + SESION_HORAS * 3600000).toISOString();
  // Una sola lectura de las sesiones: se limpian las vencidas y se agrega la nueva sobre la tabla ya al día.
  const ts = conservarFilas_(tabla_(HOJA_SESIONES, CAB_SESIONES), function (s) { return ms_(s.vence) > ahora; });
  agregarFila_(ts, { hashToken: sha_(token), empleadoId: e.id, creada: new Date(ahora).toISOString(), vence: vence });
  return { ok: true, token: token, vence: vence, empleado: { id: e.id, usuario: e.usuario, nombre: e.nombre } };
}

// Quién es el que llama: el dueño (CLAVE) o un empleado con una sesión vigente. null si ninguno.
function autenticar_(p) {
  if (typeof p.clave === 'string' && igualesCte_(p.clave, CLAVE)) return { rol: 'dueno' };
  if (typeof p.token !== 'string' || p.token.length < 20) return null;
  const hash = sha_(p.token);
  const ts = tabla_(HOJA_SESIONES, CAB_SESIONES);
  let s = null;
  for (let i = 0; i < ts.filas.length; i++) if (igualesCte_(ts.filas[i].hashToken, hash)) s = ts.filas[i];
  if (!s || !(ms_(s.vence) > Date.now())) return null;
  const e = buscarEmpleado_(tabla_(HOJA_EMPLEADOS, CAB_EMPLEADOS), s.empleadoId);
  if (!e || !activo_(e)) return null;
  return { rol: 'empleado', empleado: { id: e.id, usuario: e.usuario, nombre: e.nombre }, hashToken: hash };
}

function yo_(quien) {
  return quien.rol === 'dueno' ? { ok: true, rol: 'dueno' } : { ok: true, rol: 'empleado', empleado: quien.empleado };
}
function salir_(quien) {
  if (quien.rol === 'empleado') {
    const ts = tabla_(HOJA_SESIONES, CAB_SESIONES);
    conservarFilas_(ts, function (s) { return !igualesCte_(s.hashToken, quien.hashToken); });
  }
  return { ok: true };
}

function salida_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function libro_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function hoja_(nombre) {
  const libro = libro_();
  return libro.getSheetByName(nombre) || libro.insertSheet(nombre);
}

// Un texto que empieza por = + - @ se interpretaría como fórmula: se neutraliza.
function seguro_(v) {
  return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v;
}

function escribirHoja_(nombre, cabecera, filas) {
  const h = hoja_(nombre);
  const valores = filas.map(function (f) { return f.map(seguro_); });
  // Primero se asegura que la pestaña tenga filas y columnas suficientes: pedir un rango fuera de ella lanza error.
  if (h.getMaxRows() < valores.length + 1) h.insertRowsAfter(h.getMaxRows(), valores.length + 1 - h.getMaxRows());
  if (h.getMaxColumns() < cabecera.length) h.insertColumnsAfter(h.getMaxColumns(), cabecera.length - h.getMaxColumns());
  // Solo se limpia el bloque de datos (de la fila 2 al final de la pestaña, columnas de la tabla): lo demás queda como está.
  if (h.getMaxRows() > 1) h.getRange(2, 1, h.getMaxRows() - 1, cabecera.length).clearContent();
  h.getRange(1, 1, 1, cabecera.length).setValues([cabecera]).setFontWeight('bold');
  if (valores.length) h.getRange(2, 1, valores.length, cabecera.length).setValues(valores);
  h.setFrozenRows(1);
}

// Lee la pestaña «Cargar clientes» (Nombre, Teléfono, Notas) tal como se ve en pantalla.
// Se leen todas las filas, se descartan las que no tienen nombre y solo entonces se aplica el tope (MAX_CLIENTES).
function clientesImportar_() {
  const libro = libro_();
  let h = libro.getSheetByName(NOMBRE_CARGAR);
  if (!h) {
    h = libro.insertSheet(NOMBRE_CARGAR);
    h.getRange(1, 1, 1, HOJA_IMPORTAR.length).setValues([HOJA_IMPORTAR]).setFontWeight('bold');
    // La nota va en la columna E (la app solo lee de la A a la C), así que nunca se confunde con un cliente.
    h.getRange(1, 5, NOTA_CARGAR.length, 1).setValues(NOTA_CARGAR.map(function (t) { return [t]; })).setFontColor('#6b6b6b');
    h.setFrozenRows(1);
    return { ok: true, filas: [], truncado: false, max: MAX_CLIENTES, creada: true };
  }
  const ultima = h.getLastRow();
  if (ultima < 2) return { ok: true, filas: [], truncado: false, max: MAX_CLIENTES };
  const conNombre = h.getRange(2, 1, ultima - 1, HOJA_IMPORTAR.length).getDisplayValues()
    .filter(function (f) { return String(f[0]).trim() !== ''; });
  return { ok: true, filas: conNombre.slice(0, MAX_CLIENTES), truncado: conNombre.length > MAX_CLIENTES, max: MAX_CLIENTES };
}

function leerTexto_(nombre) {
  const h = libro_().getSheetByName(nombre);
  if (!h || h.getLastRow() < 1) return '';
  return h.getRange(1, 1, h.getLastRow(), 1).getValues().map(function (r) { return r[0]; }).join('');
}

function escribirTexto_(nombre, texto, meta) {
  const h = hoja_(nombre);
  h.clearContents();
  const trozos = [];
  for (let i = 0; i < texto.length; i += TROZO) trozos.push([texto.substring(i, i + TROZO)]);
  if (trozos.length) h.getRange(1, 1, trozos.length, 1).setValues(trozos);
  if (meta) h.getRange(1, 2, meta.length, 1).setValues(meta.map(function (m) { return [m]; }));
  h.hideSheet();
}

// Versión de lo guardado en el Sheet: cambia en cada envío. Los teléfonos mandan la que cargaron por última vez y, si ya no
// coincide, el envío se rechaza en vez de pisar lo que otro guardó. '' = todavía no hay datos; 'v0' = datos de un script anterior.
function versionActual_() {
  const h = libro_().getSheetByName('_respaldo');
  if (!h || h.getLastRow() < 1) return '';
  const v = String(h.getRange(7, 2).getValue() || '');
  return v || 'v0';
}
function estado_(minimo) {
  const h = libro_().getSheetByName('_respaldo');
  if (!h || h.getLastRow() < 1) return minimo ? { ok: true, rol: 'empleado', tieneDatos: false, version: '' } : { ok: true, tieneDatos: false, version: '' };
  const meta = h.getRange(1, 2, 7, 1).getValues().map(function (r) { return r[0]; });
  const version = String(meta[6] || '') || 'v0';
  if (minimo) return { ok: true, rol: 'empleado', tieneDatos: true, actualizado: meta[0], version: version };
  return { ok: true, tieneDatos: true, actualizado: meta[0], ventas: Number(meta[1]) || 0, clientes: Number(meta[2]) || 0, version: version };
}
function leer_() {
  const texto = leerTexto_('_respaldo');
  if (!texto) return { ok: false, error: 'El Sheet todavía no tiene datos guardados' };
  return { ok: true, texto: texto, version: versionActual_() };
}

function guardar_(d, base) {
  if (!d || d.app !== 'el-gallinero' || !Array.isArray(d.products) || !Array.isArray(d.ventas) || !Array.isArray(d.entradas) || !Array.isArray(d.clientes)) {
    return { ok: false, error: 'Datos inválidos' };
  }
  const texto = JSON.stringify(d);
  if (texto.length > 4000000) return { ok: false, error: 'Hay demasiados datos para este método' };
  // Comprobación de versión (dentro del cerrojo): si el Sheet cambió desde que este teléfono lo cargó, no se pisa. Sin `base`
  // (una app anterior) se guarda como siempre.
  if (typeof base === 'string' && base !== versionActual_()) return { ok: false, conflicto: true, error: 'El Sheet cambió desde tu última carga', version: versionActual_() };

  // Una generación anterior de seguridad, por si un envío sale mal.
  const previo = leerTexto_('_respaldo');
  if (previo) escribirTexto_('_respaldo_anterior', previo, null);

  const ahora = new Date().toISOString();
  // La configuración va en celdas propias (B4:B6): en el JSON queda al final y, con muchos datos, fuera del primer trozo.
  const cfg = d.config || {};
  const numCfg = function (x, def) { const n = Number(x); return isFinite(n) && n >= 0 ? n : def; };
  const version = 'v' + Date.now().toString(36) + Math.floor(Math.random() * 1679616).toString(36);
  escribirTexto_('_respaldo', texto, [ahora, d.ventas.length, d.clientes.length, numCfg(cfg.alerta, 50), numCfg(cfg.margen, 25), numCfg(cfg.vidaUtil, 21), version]);

  const prod = Object.create(null); d.products.forEach(function (p) { prod[p.id] = p; });
  const cli = Object.create(null); d.clientes.forEach(function (c) { cli[c.id] = c; });
  const provs = d.proveedores || [];
  const neg = (d.config && d.config.negocio) || {};
  const prefijo = neg.prefijo ? neg.prefijo + '-' : '';
  const prefijoCompra = neg.prefijoCompra ? neg.prefijoCompra + '-' : '';
  const numeroComprobanteCompra = function (n) { return n ? prefijoCompra + String(n).padStart(6, '0') : ''; };
  const numeroComprobante = function (n) { return n ? prefijo + String(n).padStart(6, '0') : ''; };
  const prv = Object.create(null); provs.forEach(function (x) { prv[x.id] = x; });
  const debeCompra = function (e) { return e.proveedorId ? Math.max(0, e.total - (e.pagado == null ? e.total : e.pagado)) : 0; };
  const nombreProd = function (id) { return prod[id] ? prod[id].name : '(eliminado)'; };
  const porFechaDesc = function (a, b) { return String(b.fecha).localeCompare(String(a.fecha)); };

  escribirHoja_('Inventario', ['Producto', 'Unidad', 'Existencias', 'Costo promedio', 'Precio de venta', 'Control de frescura'],
    d.products.map(function (p) { return [p.name, p.unit, p.stock, p.cost, p.price || '', p.control || '']; }));

  // Lo abonado a una venta a crédito, separado por medio. Un abono anterior a esta función (sin medio) se cuenta como efectivo.
  const abonadoPor = function (v, transferencia) {
    if (v.tipoPago !== 'credito') return '';
    return (v.abonos || []).filter(function (a) { return (a.medio === 'transferencia') === transferencia; }).reduce(function (s, a) { return s + (Number(a.monto) || 0); }, 0);
  };

  escribirHoja_('Ventas', ['Fecha', 'Producto', 'Cantidad', 'Panales', 'Precio', 'Total', 'Cliente', 'Pago', 'Abonado', 'Debe', 'Comprobante', 'Costo unitario', 'Medio de cobro', 'Abonado en efectivo', 'Abonado por transferencia'],
    d.ventas.slice().sort(porFechaDesc).map(function (v) {
      const debe = v.tipoPago === 'credito' ? Math.max(0, v.total - (v.pagado || 0)) : 0;
      return [v.fecha, nombreProd(v.productoId), v.cantidad, v.panales || '', v.precio, v.total, v.clienteId && cli[v.clienteId] ? cli[v.clienteId].nombre : '', v.tipoPago === 'credito' ? 'Crédito' : 'Contado', v.pagado || 0, debe, numeroComprobante(v.numero), v.costoUnitario || 0, v.medio === 'efectivo' ? 'Efectivo' : (v.medio === 'transferencia' ? 'Transferencia' : ''), abonadoPor(v, false), abonadoPor(v, true)];
    }));

  escribirHoja_('Compras', ['Fecha', 'Producto', 'Cantidad', 'Panales', 'Costo unitario', 'Total', 'Vence', 'Días en granja', 'Notas', 'Proveedor', 'Pagado', 'Debe', 'Comprobante', 'Recibió', 'Documento proveedor'],
    d.entradas.slice().sort(porFechaDesc).map(function (e) {
      return [e.fecha, nombreProd(e.productoId), e.cantidad, e.panales || '', e.costoUnitario, e.total, e.vence || '', e.diasGranja || '', e.notas || '', e.proveedorId && prv[e.proveedorId] ? prv[e.proveedorId].nombre : '', e.pagado == null ? e.total : e.pagado, debeCompra(e), numeroComprobanteCompra(e.numero), e.recibidoPor || '', e.documentoProveedor || ''];
    }));

  escribirHoja_('Proveedores', ['Proveedor', 'Teléfono', 'Deuda', 'Notas', 'Saldo a favor'],
    provs.map(function (x) {
      const deuda = d.entradas.reduce(function (s, e) { return s + (e.proveedorId === x.id ? debeCompra(e) : 0); }, 0);
      return [x.nombre, x.telefono || '', deuda, x.notas || '', x.saldoFavor || 0];
    }));

  escribirHoja_('Clientes', ['Cliente', 'Teléfono', 'Deuda', 'Notas', 'Documento'],
    d.clientes.map(function (c) {
      const deuda = d.ventas.reduce(function (s, v) {
        return s + (v.clienteId === c.id && v.tipoPago === 'credito' ? Math.max(0, v.total - (v.pagado || 0)) : 0);
      }, 0);
      return [c.nombre, c.telefono || '', deuda, c.notas || '', c.documento || ''];
    }));

  escribirHoja_('Pérdidas', ['Fecha', 'Producto', 'Cantidad', 'Costo unitario', 'Motivo'],
    (d.ajustes || []).slice().sort(porFechaDesc).map(function (a) {
      return [a.fecha, nombreProd(a.productoId), a.cantidad, a.costoUnitario || 0, a.motivo || ''];
    }));

  // Caja: libro de movimientos del efectivo (el más reciente primero) y cierres del día.
  const origenCaja = Object.assign(Object.create(null), { apertura: 'Saldo inicial', venta: 'Venta', abono: 'Abono de cliente', compra: 'Compra', pago: 'Pago a proveedor', manual: 'Manual', anulacion: 'Anulación', ajuste: 'Ajuste de cierre' });
  escribirHoja_('Caja', ['Fecha', 'Concepto', 'Ingreso', 'Egreso', 'Origen', 'Registró'],
    (d.movimientos || []).slice().sort(function (a, b) { return b.id - a.id; }).map(function (m) {
      return [m.fecha, m.concepto || '', m.tipo === 'ingreso' ? m.monto : '', m.tipo === 'egreso' ? m.monto : '', origenCaja[m.origen] || m.origen || '', m.por || ''];
    }));
  escribirHoja_('Cierres', ['Fecha', 'Esperado', 'Contado', 'Diferencia', 'Nota', 'Registró'],
    (d.cierres || []).slice().sort(function (a, b) { return b.id - a.id; }).map(function (c) {
      return [c.fecha, c.esperado, c.contado, c.diferencia, c.nota || '', c.por || ''];
    }));

  return { ok: true, actualizado: ahora, version: version, ventas: d.ventas.length, clientes: d.clientes.length };
}
