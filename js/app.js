'use strict';
/* El Gallinero · control de inventario, compras, ventas y cartera.
   Todo se guarda en el teléfono (localStorage). Las claves eg_* son las mismas de la versión anterior,
   así que los datos que ya existan se conservan. */

/* =============== Utilidades =============== */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const miles = n => String(Math.round(Math.abs(Number(n) || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const money = n => (Math.round(Number(n) || 0) < 0 ? '-' : '') + '$' + miles(n);
const num = n => (Math.round(Number(n) || 0) < 0 ? '-' : '') + miles(n);
const clonar = o => JSON.parse(JSON.stringify(o));

// Fechas en hora LOCAL (la versión anterior usaba UTC y después de las 7 p. m. en Colombia ya marcaba «mañana»).
const isoDe = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hoy = () => isoDe(new Date());
const fechaDe = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const sumarDias = (s, n) => { const d = fechaDe(s); d.setDate(d.getDate() + n); return isoDe(d); };
const diasEntre = (a, b) => Math.round((fechaDe(b) - fechaDe(a)) / 864e5);
const lunesDe = s => sumarDias(s, -((fechaDe(s).getDay() + 6) % 7));
const FECHA_RE = /^\d{4}-\d\d-\d\d$/;
const verFecha = s => { if (!s) return ''; if (typeof s !== 'string' || !FECHA_RE.test(s)) return esc(s); const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };
// Los campos numéricos de los formularios: vacío o texto raro => NaN (nunca Infinity ni 1e999).
const TOPE = 1e9;
const leerNum = s => (String(s ?? '').trim() === '' ? NaN : Number(s));
const enRango = (n, min = 0) => Number.isFinite(n) && n >= min && n <= TOPE;
// Dinero a centavos: lo que se suma o resta (abonos, pagos, totales) se redondea para que 0,1 + 0,2 no deje residuos.
const redondear = x => Math.round(x * 100) / 100;
const aCero = d => (d < 0.005 ? 0 : d); // una deuda menor a medio centavo es ruido de redondeo, no una deuda
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/* =============== Datos =============== */
const PRODUCTOS_BASE = [
  ['campo', 'Huevo de Campo', 'unidades', 'granja'], ['jumbo', 'Huevo Jumbo', 'unidades', 'granja'],
  ['extra', 'Huevo Extra', 'unidades', 'granja'], ['aa', 'Huevo AA', 'unidades', 'granja'],
  ['tipoa', 'Huevo Tipo A', 'unidades', 'granja'], ['tipob', 'Huevo Tipo B', 'unidades', 'granja'],
  ['codorniz', 'Huevo de Codorniz', 'unidades', 'granja'], ['leche', 'Leche Colanta', 'bolsas', 'vencimiento'],
  ['queso', 'Queso Colanta', 'unidades', 'vencimiento'], ['panela', 'Panela', 'libras', 'ninguno'], ['arepa', 'Arepa', 'unidades', 'vencimiento'],
].map(([id, name, unit, control]) => ({ id, name, unit, cost: 0, price: 0, stock: 0, lastCost: 0, control, panal: control === 'granja' ? 30 : 0 }));
// Cómo se controla la frescura de cada producto: huevo fresco (días en la granja), empacado (fecha de vencimiento) o nada.
const CONTROLES = ['granja', 'vencimiento', 'ninguno'];
// Unidades por panal (0 = no se vende por panal). Los huevos de datos anteriores se asumen de 30.
const rPanal = r => (r.panal == null ? (controlDe(r) === 'granja' ? 30 : 0) : Number.isInteger(r.panal) && r.panal >= 0 && r.panal <= 1000 ? r.panal : mal());
const controlDe = r => (CONTROLES.includes(r.control) ? r.control : (r.isEgg ? 'granja' : (['leche', 'queso', 'arepa'].includes(r.id) ? 'vencimiento' : 'ninguno'))); // datos de la versión anterior: los lácteos y la arepa son empacados

// SCHEMA 4: config.anulados (rastro de comprobantes con ventas anuladas) y saldoFavor de proveedores.
const SCHEMA = 4;
const CLAVE_DB = 'eg_db', CLAVE_PREV = 'eg_prev';
// Claves de la versión anterior (una por colección): solo se LEEN, para migrar al guardado único eg_db.
const CLAVES = { products: 'eg_products', entradas: 'eg_entradas', ventas: 'eg_ventas', clientes: 'eg_clientes', config: 'eg_config', ajustes: 'eg_ajustes' };
const negocioBase = () => ({ nombre: 'El Gallinero', nit: '', direccion: '', telefono: '', ciudad: '', prefijo: 'CV' });
const configBase = () => ({ margen: 25, alerta: 50, vidaUtil: 21, ultimoRespaldo: null, negocio: negocioBase(), consecutivo: 1, anulados: [], schemaVersion: SCHEMA });

let aviso_t; // se declara antes de cualquier uso: migrar() y guardar() pueden llamar a aviso() al arrancar
let products = [], entradas = [], ventas = [], clientes = [], ajustes = [], proveedores = [], config = configBase();
let errorArranque = null, avisoArranque = '';
let sync = null, syncEnCurso = false, syncTimer = null; // conexión con Google Sheets (ver más abajo)

/* ---- Validación y saneamiento: nada entra a la memoria sin pasar por aquí ---- */
const LIM = 1e15;
const MAX_NUMERO = 999999999; // tope del número de comprobante (el mismo del formulario de Ajustes)
const MAX_ANULADOS = 500;
const mal = () => { throw new Error('registro inválido'); };
const esNum = x => Number.isFinite(x) && Math.abs(x) <= LIM;
const rNum = (x, def) => (x == null ? (def === undefined ? mal() : def) : esNum(x) ? x : mal());
const rTxt = (x, def = '') => (x == null ? def : typeof x === 'string' ? x : mal());
const rSid = x => (typeof x === 'string' && x ? x : mal());
const rId = x => (Number.isSafeInteger(x) ? x : mal());
const numeroOk = x => Number.isSafeInteger(x) && x >= 1 && x <= MAX_NUMERO;
const fechaOk = s => typeof s === 'string' && FECHA_RE.test(s) && isoDe(fechaDe(s)) === s;
const rFecha = x => (fechaOk(x) ? x : mal());
const SANEAR = {
  products: r => ({ id: rSid(r.id), name: rTxt(r.name) || mal(), unit: rTxt(r.unit, 'unidades'), cost: rNum(r.cost, 0), price: rNum(r.price, 0), stock: rNum(r.stock, 0), lastCost: rNum(r.lastCost, 0), control: controlDe(r), panal: rPanal(r) }),
  clientes: r => ({ id: rSid(r.id), nombre: rTxt(r.nombre) || mal(), telefono: rTxt(r.telefono), notas: rTxt(r.notas), documento: rTxt(r.documento).slice(0, 30) }),
  proveedores: r => { const o = { id: rSid(r.id), nombre: rTxt(r.nombre) || mal(), telefono: rTxt(r.telefono), notas: rTxt(r.notas) }, sf = rNum(r.saldoFavor, 0); if (sf > 0) o.saldoFavor = redondear(sf); return o; }, // saldoFavor: lo pagado en compras anuladas
  entradas: r => {
    const cantidad = rNum(r.cantidad), costoUnitario = rNum(r.costoUnitario, 0);
    const o = { id: rId(r.id), productoId: rSid(r.productoId), cantidad, costoUnitario, total: rNum(r.total, cantidad * costoUnitario), fecha: rFecha(r.fecha), diasGranja: rNum(r.diasGranja, 0), notas: rTxt(r.notas) };
    if (r.vence != null && r.vence !== '') o.vence = rFecha(r.vence);
    if (r.panales != null) { o.panales = rNum(r.panales); o.costoPanal = rNum(r.costoPanal, 0); }
    if (r.costoPrevio != null) o.costoPrevio = rNum(r.costoPrevio);
    if (r.lastCostPrevio != null) o.lastCostPrevio = rNum(r.lastCostPrevio);
    if (r.proveedorId != null && r.proveedorId !== '') o.proveedorId = rSid(r.proveedorId);
    // Criterio: lo pagado nunca es negativo ni supera el total (un respaldo dañado no puede inventar saldo a favor ni deuda
    // negativa), y un abono de monto cero o negativo no es un pago: se descarta. Un monto que no es número invalida el registro.
    o.pagado = Math.max(0, Math.min(o.total, rNum(r.pagado, o.total)));
    o.abonos = r.abonos == null ? [] : Array.isArray(r.abonos) ? r.abonos.map(a => ({ fecha: rFecha(a.fecha), monto: rNum(a.monto) })).filter(a => a.monto > 0) : mal();
    return o;
  },
  ajustes: r => ({ id: rId(r.id), productoId: rSid(r.productoId), cantidad: rNum(r.cantidad), costoUnitario: rNum(r.costoUnitario, 0), fecha: rFecha(r.fecha), motivo: rTxt(r.motivo) }),
  ventas: r => {
    const cantidad = rNum(r.cantidad), precio = rNum(r.precio), costoUnitario = rNum(r.costoUnitario, 0), total = rNum(r.total, cantidad * precio);
    const tipoPago = r.tipoPago == null ? 'contado' : (r.tipoPago === 'contado' || r.tipoPago === 'credito' ? r.tipoPago : mal());
    const abonos = r.abonos == null ? [] : Array.isArray(r.abonos) ? r.abonos.map(a => ({ fecha: rFecha(a.fecha), monto: rNum(a.monto) })) : mal();
    return { id: rId(r.id), productoId: rSid(r.productoId), cantidad, descontado: rNum(r.descontado, cantidad), precio, total, costoUnitario, ganancia: rNum(r.ganancia, (precio - costoUnitario) * cantidad), fecha: rFecha(r.fecha), clienteId: r.clienteId == null || r.clienteId === '' ? null : rSid(r.clienteId), tipoPago, pagado: rNum(r.pagado, tipoPago === 'credito' ? 0 : total), abonos, ...(r.panales != null ? { panales: rNum(r.panales), precioPanal: rNum(r.precioPanal, 0) } : {}), ...(numeroOk(r.numero) ? { numero: r.numero } : {}) };
  },
};
function sanearConfig(c) {
  c = c && typeof c === 'object' && !Array.isArray(c) ? c : {};
  const n = (x, def, min, max) => { const v = x == null || x === '' ? NaN : Number(x); return Number.isFinite(v) && v >= min && v <= max ? v : def; };
  const base = configBase();
  return { margen: n(c.margen, base.margen, 0, 500), alerta: n(c.alerta, base.alerta, 0, TOPE), vidaUtil: n(c.vidaUtil, base.vidaUtil, 1, 365), ultimoRespaldo: fechaOk(c.ultimoRespaldo) ? c.ultimoRespaldo : null, negocio: sanearNegocio(c.negocio), consecutivo: numeroOk(c.consecutivo) ? c.consecutivo : 1, anulados: sanearAnulados(c.anulados), schemaVersion: SCHEMA };
}
// Rastro de las ventas anuladas que ya tenían número de comprobante: {numero, fecha, cliente, total}. Se conservan las últimas 500.
function sanearAnulados(l) {
  if (!Array.isArray(l)) return [];
  const ok = [];
  for (const a of l) {
    if (a && typeof a === 'object' && numeroOk(a.numero) && fechaOk(a.fecha) && esNum(a.total)) ok.push({ numero: a.numero, fecha: a.fecha, cliente: typeof a.cliente === 'string' ? a.cliente.slice(0, 100) : '', total: a.total });
  }
  return ok.slice(-MAX_ANULADOS);
}
function sanearNegocio(n) {
  n = n && typeof n === 'object' && !Array.isArray(n) ? n : {};
  const t = (x, def, max = 100) => (typeof x === 'string' ? x.trim().slice(0, max) : def), base = negocioBase();
  const prefijo = typeof n.prefijo === 'string' && /^[A-Za-z0-9]{0,6}$/.test(n.prefijo.trim()) ? n.prefijo.trim().toUpperCase() : base.prefijo;
  return { nombre: t(n.nombre, base.nombre), nit: t(n.nit, '', 30), direccion: t(n.direccion, '', 150), telefono: t(n.telefono, '', 30), ciudad: t(n.ciudad, '', 60), prefijo };
}
// Devuelve datos limpios y la lista de registros inválidos (que NO se incluyen).
function limpiar(crudo) {
  const d = crudo && typeof crudo === 'object' ? crudo : {};
  const datos = {}, errores = [];
  for (const k of ['products', 'entradas', 'ventas', 'clientes', 'ajustes', 'proveedores']) {
    datos[k] = [];
    if (d[k] == null) continue;
    if (!Array.isArray(d[k])) { errores.push(`${k}: no es una lista`); continue; }
    d[k].forEach((r, i) => {
      try { if (!r || typeof r !== 'object' || Array.isArray(r)) mal(); datos[k].push(SANEAR[k](r)); } catch { errores.push(`${k}[${i}]`); }
    });
  }
  datos.config = sanearConfig(d.config);
  // El consecutivo nunca puede quedar por debajo del mayor número ya emitido (ventas o anuladas): evita repetir números.
  const mayor = Math.max(0, ...datos.ventas.map(v => v.numero || 0), ...datos.config.anulados.map(a => a.numero));
  datos.config.consecutivo = Math.min(MAX_NUMERO, Math.max(datos.config.consecutivo, mayor + 1));
  // Una compra cuyo proveedor no existe (respaldo dañado o editado) dejaría una deuda invisible: se recrea el proveedor.
  const conocidos = new Set(datos.proveedores.map(p => p.id));
  const faltan = [...new Set(datos.entradas.map(e => e.proveedorId).filter(id => id && !conocidos.has(id)))];
  faltan.forEach(id => datos.proveedores.push({ id, nombre: 'Proveedor sin nombre', telefono: '', notas: 'Recuperado de un respaldo' }));
  return { datos, errores, recuperados: faltan.length };
}
// Migración: la versión anterior guardaba las pérdidas como entradas con cantidad negativa.
function migrar(d) {
  const viejas = d.entradas.filter(e => e.cantidad < 0);
  if (!viejas.length) return false;
  viejas.forEach(e => d.ajustes.push({ id: e.id, productoId: e.productoId, cantidad: -e.cantidad, costoUnitario: 0, fecha: e.fecha, motivo: String(e.notas || '').replace(/^PÉRDIDA:\s*/, '') }));
  d.entradas = d.entradas.filter(e => e.cantidad > 0);
  return true;
}
const estado = () => ({ products, entradas, ventas, clientes, ajustes, proveedores, config });
const poner = d => { ({ products, entradas, ventas, clientes, ajustes, proveedores, config } = d); if (!products.length) products = clonar(PRODUCTOS_BASE); };

// Un solo setItem: o se guarda todo o no se guarda nada.
function guardar() {
  try {
    config.schemaVersion = SCHEMA;
    localStorage.setItem(CLAVE_DB, JSON.stringify(estado()));
  } catch {
    aviso('No se pudo guardar. Haz un respaldo y libera espacio.', true);
    return false;
  }
  programarSync();
  return true;
}
/* Muta, guarda y, si guardar falla, devuelve la memoria al estado anterior.
   El aviso de éxito solo sale si se guardó (el de error lo pone guardar()). */
function aplicar(mutar, mensajeOk) {
  const previo = clonar(estado());
  mutar();
  if (guardar()) { if (mensajeOk) aviso(mensajeOk); return true; }
  poner(previo);
  return false;
}

function cargarEstado() {
  const rawDb = localStorage.getItem(CLAVE_DB);
  let crudo;
  if (rawDb !== null) {
    crudo = JSON.parse(rawDb);
    if (!crudo || typeof crudo !== 'object' || Array.isArray(crudo)) throw new Error('El archivo de datos no tiene el formato esperado');
  } else {
    crudo = {};
    for (const k of Object.keys(CLAVES)) { const raw = localStorage.getItem(CLAVES[k]); crudo[k] = raw === null ? null : JSON.parse(raw); }
  }
  const { datos, errores, recuperados } = limpiar(crudo);
  const nueva = !!(crudo.config && typeof crudo.config === 'object' && crudo.config.schemaVersion > SCHEMA);
  if (errores.length || nueva) {
    try { localStorage.setItem(CLAVE_PREV, rawDb ?? JSON.stringify(crudo)); } catch { /* sin espacio: se avisa igual */ }
    avisoArranque = errores.length ? `Se descartaron ${errores.length} registro(s) dañado(s). La copia original quedó en eg_prev.` : '';
  }
  if (nueva) avisoArranque += `${avisoArranque ? ' ' : ''}Estos datos se guardaron con una versión más nueva de la app: actualiza la app para no perder información (hay una copia en eg_prev).`;
  if (recuperados) avisoArranque += `${avisoArranque ? ' ' : ''}Se recuperaron ${recuperados} proveedor(es) sin nombre: ponles nombre en Proveedores.`;
  const migrado = migrar(datos);
  poner(datos);
  return rawDb === null || migrado || recuperados > 0;
}

function pantallaRecuperacion(err) {
  $('#nav').innerHTML = '';
  $('#vista').innerHTML = `<section class="card"><h3>Recuperación de datos</h3>
    <p class="muted" style="margin-bottom:12px">No se pudieron leer los datos guardados en este teléfono. No se borró nada. Descarga una copia de lo que hay antes de tocar cualquier otra cosa.</p>
    <p class="muted" style="margin-bottom:12px">${esc(err && err.message)}</p>
    <button class="btn btn-teal" id="recuperar-exportar">Descargar los datos tal como están</button></section>`;
  $('#recuperar-exportar').addEventListener('click', () => {
    const crudo = {};
    [CLAVE_DB, CLAVE_PREV, ...Object.values(CLAVES)].forEach(k => { try { const v = localStorage.getItem(k); if (v !== null) crudo[k] = v; } catch { /* ilegible */ } });
    entregarArchivo(`el-gallinero-datos-crudos-${hoy()}.json`, JSON.stringify(crudo), 'application/json');
  });
}

try { if (cargarEstado()) guardar(); } catch (e) { errorArranque = e; }
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

const prod = id => products.find(p => p.id === id);
const cliente = id => clientes.find(c => c.id === id);
const nuevoId = () => Date.now() * 1000 + Math.floor(Math.random() * 1000);

/* =============== Cálculos del negocio =============== */
const debeVenta = v => (v.tipoPago === 'credito' ? aCero(redondear(v.total - (v.pagado || 0))) : 0);
const deudaCliente = id => ventas.filter(v => v.clienteId === id).reduce((s, v) => s + debeVenta(v), 0);
const deudaTotal = () => ventas.reduce((s, v) => s + (v.clienteId ? debeVenta(v) : 0), 0);
const costoVenta = v => (v.costoUnitario || 0) * v.cantidad;
const precioSugerido = p => (p.cost > 0 ? Math.round(p.cost * (1 + config.margen / 100)) : 0);
const precioInicial = p => (p.price > 0 ? p.price : precioSugerido(p));

/* Lotes con existencias: se vende lo más viejo primero, así que lo que queda en bodega es lo más reciente. */
function lotesVivos(p) {
  let resto = p.stock;
  const out = [];
  const ls = entradas.filter(e => e.productoId === p.id).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id);
  for (const e of ls) {
    if (resto <= 0) break;
    const u = Math.min(resto, e.cantidad);
    out.push({ ...e, restante: u });
    resto -= u;
  }
  return out; // el último es el más viejo
}
// Días que le quedan a un lote: por la fecha impresa en el empaque, o (huevos) por la vida útil menos los días de granja.
const diasRestantes = e => (e.vence ? diasEntre(hoy(), e.vence) : (config.vidaUtil || 21) - diasEntre(e.fecha, hoy()) - (e.diasGranja || 0));
// De los lotes que aún quedan en bodega, el que primero se vence.
function loteUrgente(p) {
  if (p.control === 'ninguno' || p.stock <= 0) return null;
  const ls = lotesVivos(p);
  return ls.length ? ls.reduce((a, b) => (diasRestantes(b) < diasRestantes(a) ? b : a)) : null;
}

function alertasVencimiento() {
  const out = [];
  products.forEach(p => {
    const lote = loteUrgente(p);
    if (!lote) return;
    const d = diasRestantes(lote);
    if (d <= 7) out.push({ nombre: p.name, dias: d, cantidad: lote.restante, fecha: lote.fecha, vence: lote.vence || null });
  });
  return out.sort((a, b) => a.dias - b.dias);
}

function rangoPeriodo(periodo, ref) {
  const f = fechaDe(ref);
  if (periodo === 'dia') return { ini: ref, fin: ref, etiqueta: verFecha(ref) };
  if (periodo === 'semana') { const ini = lunesDe(ref), fin = sumarDias(ini, 6); return { ini, fin, etiqueta: `${verFecha(ini)} al ${verFecha(fin)}` }; }
  if (periodo === 'mes') {
    const y = f.getFullYear(), m = f.getMonth();
    return { ini: `${y}-${pad(m + 1)}-01`, fin: `${y}-${pad(m + 1)}-${pad(new Date(y, m + 1, 0).getDate())}`, etiqueta: `${MESES[m]} ${y}` };
  }
  return { ini: `${f.getFullYear()}-01-01`, fin: `${f.getFullYear()}-12-31`, etiqueta: `Año ${f.getFullYear()}` };
}
function moverRef(periodo, ref, dir) {
  const f = fechaDe(ref);
  if (periodo === 'dia') return sumarDias(ref, dir);
  if (periodo === 'semana') return sumarDias(ref, 7 * dir);
  if (periodo === 'mes') return isoDe(new Date(f.getFullYear(), f.getMonth() + dir, 1));
  return isoDe(new Date(f.getFullYear() + dir, 0, 1));
}

/* =============== Interfaz base =============== */
const ICONOS = {
  inicio: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>',
  vender: '<circle cx="12" cy="12" r="9"/><path d="M14.5 9c-.4-.9-1.4-1.4-2.6-1.4-1.5 0-2.6.8-2.6 2 0 2.8 5.4 1.4 5.4 4.2 0 1.200-1.200 2.100-2.800 2.100-1.300 0-2.400-.6-2.800-1.600M12 6v1.600M12 16.500V18"/>',
  comprar: '<path d="M2 6h11v10H2z"/><path d="M13 9h4l3 3v4h-7"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  clientes: '<circle cx="9" cy="8" r="3.500"/><path d="M2.500 20c0-3.600 2.900-6 6.500-6s6.500 2.400 6.500 6"/><circle cx="17" cy="9" r="2.500"/><path d="M17 14c2.800 0 4.500 1.900 4.500 5"/>',
  mas: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  caja: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
  factura: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  respaldo: '<path d="M12 3v12m0 0l-4-4m4 4l4-4"/><path d="M4 17v3h16v-3"/>',
  hoja: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M10 9v12"/>',
  grafico: '<path d="M4 20V11M10 20V4M16 20v-6M22 20H2"/>',
  ajustes: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.900 4.900l2.100 2.100M17 17l2.100 2.100M4.900 19.100L7 17M17 7l2.100-2.100"/>',
};
const icono = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONOS[n]}</svg>`;

const NAV = [['inicio', 'Inicio'], ['vender', 'Vender'], ['comprar', 'Comprar'], ['clientes', 'Clientes'], ['mas', 'Más']];
const SUBVISTAS = ['productos', 'proveedores', 'graficos', 'reportes', 'respaldo', 'sheets', 'ajustes'];

function aviso(msg, error = false) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'toast' + (error ? ' error' : '');
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.appendChild(t);
  clearTimeout(aviso_t);
  aviso_t = setTimeout(() => t.remove(), error ? 4000 : 2200);
}

const FOCABLES = 'a[href],button,input:not([type=hidden]),select,textarea,[tabindex]:not([tabindex="-1"])';
let focoPrevio = null; // lo que tenía el foco al abrir el primer diálogo: ahí vuelve al cerrar
function hoja(titulo, cuerpo, montar) {
  const origen = $('.sheet-wrap') ? focoPrevio : document.activeElement; // un diálogo que reemplaza a otro conserva el origen
  cerrarHoja(false);
  focoPrevio = origen || null;
  const w = document.createElement('div');
  w.className = 'sheet-wrap';
  w.innerHTML = `<div class="sheet-back" data-act="cerrar"></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(titulo)}">
      <div class="sheet-head"><h3>${esc(titulo)}</h3><button class="icon-btn" data-act="cerrar" aria-label="Cerrar">&times;</button></div>
      <div class="sheet-body">${cuerpo}</div></div>`;
  document.body.appendChild(w);
  document.body.classList.add('no-scroll');
  const cuerpoEl = $('.sheet-body', w);
  if (montar) montar(cuerpoEl);
  // El foco entra siempre al diálogo (lectores de pantalla y teclado). Con ratón se va al primer campo; en el teléfono se queda
  // en el contenedor para no abrir el teclado solo.
  const dialogo = $('.sheet', w);
  dialogo.setAttribute('tabindex', '-1');
  const primero = $('input:not([type=hidden]),select,textarea', cuerpoEl);
  if (primero && matchMedia('(pointer:fine)').matches) primero.focus(); else dialogo.focus();
  // Tab y Mayús+Tab dan la vuelta dentro del diálogo en vez de salir a la página de atrás.
  w.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const f = [...w.querySelectorAll(FOCABLES)].filter(x => !x.disabled && !x.closest('[hidden]'));
    if (!f.length) { e.preventDefault(); dialogo.focus(); return; }
    const act = document.activeElement, ini = f[0], fin = f[f.length - 1];
    if (e.shiftKey && (act === ini || act === dialogo)) { e.preventDefault(); fin.focus(); }
    else if (!e.shiftKey && act === fin) { e.preventDefault(); ini.focus(); }
  });
}
let confirmacionAbierta = null; // resolver de la confirmación en pantalla: si se cierra de otra forma, resuelve false
function cerrarHoja(devolverFoco = true) {
  const w = $('.sheet-wrap'); if (w) w.remove(); document.body.classList.remove('no-scroll');
  if (confirmacionAbierta) { const r = confirmacionAbierta; confirmacionAbierta = null; r(false); }
  if (w && devolverFoco && focoPrevio) { const f = focoPrevio; focoPrevio = null; if (f.isConnected !== false && f.focus) f.focus(); }
}
/* Evita guardar dos veces lo mismo por un doble toque: tras un envío, el formulario ignora otro durante un instante. */
document.addEventListener('submit', e => {
  const f = e.target;
  if (f.dataset.enviado) { e.preventDefault(); e.stopImmediatePropagation(); return; }
  f.dataset.enviado = '1';
  setTimeout(() => { delete f.dataset.enviado; }, 900);
}, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarHoja(); });

function confirmar({ titulo, texto, ok = 'Confirmar', peligro = false }) {
  return new Promise(res => {
    hoja(titulo, `<p class="sheet-text">${esc(texto)}</p>
      <div class="btn-row"><button class="btn btn-ghost" data-r="0">Cancelar</button><button class="btn ${peligro ? 'btn-danger' : ''}" data-r="1">${esc(ok)}</button></div>`,
      b => b.addEventListener('click', e => { const x = e.target.closest('[data-r]'); if (x) { confirmacionAbierta = null; cerrarHoja(); res(x.dataset.r === '1'); } }));
    confirmacionAbierta = res; // después de hoja(): esta llama a cerrarHoja() y resolvería en false la confirmación anterior
  });
}

/* =============== Enrutador =============== */
let vistaActual = 'inicio';
const VISTAS = {};
const MONTAR = {};
function navegar(v) { if (location.hash !== '#/' + v) location.hash = '#/' + v; else pintar(); }
function pintar() {
  const v = (location.hash.replace('#/', '') || 'inicio');
  vistaActual = VISTAS[v] ? v : 'inicio';
  const activo = SUBVISTAS.includes(vistaActual) ? 'mas' : vistaActual;
  $('#nav').innerHTML = NAV.map(([id, t]) => `<button data-act="ir" data-v="${id}" class="${id === activo ? 'on' : ''}" ${id === activo ? 'aria-current="page"' : ''}>${icono(id)}<span>${t}</span></button>`).join('');
  $('#vista').innerHTML = VISTAS[vistaActual]();
  const montar = MONTAR[vistaActual];
  if (montar) montar();
  window.scrollTo(0, 0);
}
const repintar = () => { const y = window.scrollY; pintar(); window.scrollTo(0, y); };
window.addEventListener('hashchange', () => { cerrarHoja(); pintar(); });

const cabecera = (titulo, atras) => `<div class="view-head">${atras ? `<button class="back" data-act="ir" data-v="${atras}">&larr; Más</button>` : ''}<h2>${titulo}</h2></div>`;
const opcionesProductos = (sel, conStock = true) => products.map(p => `<option value="${esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}${conStock ? ` · ${num(p.stock)} ${esc(p.unit)}` : ''}</option>`).join('');

/* =============== Inicio =============== */
VISTAS.inicio = () => {
  const h = hoy();
  const vh = ventas.filter(v => v.fecha === h);
  const total = vh.reduce((s, v) => s + v.total, 0);
  const gan = total - vh.reduce((s, v) => s + costoVenta(v), 0);
  const semIni = lunesDe(h);
  const vs = ventas.filter(v => v.fecha >= semIni && v.fecha <= h);
  const totSem = vs.reduce((s, v) => s + v.total, 0);
  const ganSem = totSem - vs.reduce((s, v) => s + costoVenta(v), 0);
  const deuda = deudaTotal();
  const deudaProv = deudaProveedores();
  const al = alertasVencimiento();
  const fechaLarga = new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }).replace(/ De /g, ' de ');

  const diasSinRespaldo = config.ultimoRespaldo ? diasEntre(config.ultimoRespaldo, h) : null;
  const hayDatos = ventas.length + entradas.length + clientes.length > 0;
  const recordatorio = hayDatos && !(sync && sync.listo) && (diasSinRespaldo === null || diasSinRespaldo >= 14)
    ? `<div class="alert info"><strong>Haz un respaldo.</strong> ${diasSinRespaldo === null ? 'Nunca has guardado uno.' : `Van ${diasSinRespaldo} días.`} Tus datos viven solo en este teléfono.
       <br><button class="btn btn-sm btn-ghost" data-act="ir" data-v="respaldo">Ir a respaldo</button></div>` : '';

  const alertasHtml = al.length
    ? al.map(a => `<div class="alert ${a.dias <= 3 ? 'danger' : ''}"><strong>${esc(a.nombre)}</strong>: ${a.dias > 0 ? `quedan ~${a.dias} días` : a.dias === 0 ? 'vence hoy' : `pasó hace ${-a.dias} días`} · ${num(a.cantidad)} u. ${a.vence ? `con vencimiento ${verFecha(a.vence)}` : `del lote del ${verFecha(a.fecha)}`}. Véndelo primero.</div>`).join('')
    : '<div class="alert ok">Nada por vencer. Todo fresco.</div>';

  const conStock = products.filter(p => p.stock > 0);
  const sinStock = products.filter(p => p.stock <= 0).length;
  const stockHtml = conStock.length
    ? conStock.map(p => `<div class="row"><div class="main"><div class="t">${esc(p.name)}</div></div><div class="r"><strong>${num(p.stock)}</strong> <span class="muted">${esc(p.unit)}${panalesTxt(p)}</span> ${p.stock < config.alerta ? '<span class="badge low">Bajo</span>' : ''}</div></div>`).join('') + (sinStock ? `<p class="muted" style="margin-top:8px">${sinStock} producto${sinStock > 1 ? 's' : ''} sin existencias.</p>` : '')
    : '<p class="empty">Aún no hay existencias. Registra lo que llegue en «Comprar».</p>';

  return `
    <p class="view-sub">${esc(fechaLarga)}</p>
    <div class="quick">
      <button class="btn" data-act="ir" data-v="vender">${icono('vender')}Vender</button>
      <button class="btn btn-sun" data-act="ir" data-v="comprar">${icono('comprar')}Llegó mercancía</button>
    </div>
    ${recordatorio}
    <section class="card"><h3>Hoy</h3>
      <div class="stats">
        <div class="stat sun"><div class="n">${money(total)}</div><div class="l">Vendido hoy</div></div>
        <div class="stat teal"><div class="n ${gan < 0 ? 'neg' : ''}">${money(gan)}</div><div class="l">Ganancia hoy</div></div>
        <div class="stat"><div class="n">${num(vh.reduce((s, v) => s + v.cantidad, 0))}</div><div class="l">Unidades vendidas</div></div>
        <div class="stat ${deuda > 0 ? 'red' : ''}"><div class="n">${money(deuda)}</div><div class="l">Me deben</div></div>
      </div>
      ${deuda > 0 ? '<button class="btn btn-sm btn-ghost" style="margin-top:12px" data-act="ir" data-v="clientes">Ver quién me debe</button>' : ''}
      ${deudaProv > 0 ? `<div class="stat red" style="margin-top:12px"><div class="n">${money(deudaProv)}</div><div class="l">Debo a proveedores</div></div><button class="btn btn-sm btn-ghost" style="margin-top:12px" data-act="ir" data-v="proveedores">Ver cuentas por pagar</button>` : ''}
    </section>
    <section class="card"><h3>Frescura</h3>${alertasHtml}</section>
    <section class="card"><h3>En bodega</h3><div class="list">${stockHtml}</div>
      <button class="btn btn-sm btn-ghost" style="margin-top:12px" data-act="ir" data-v="productos">Productos e inventario</button></section>
    <section class="card"><h3>Esta semana</h3>
      <div class="stats">
        <div class="stat"><div class="n">${money(totSem)}</div><div class="l">Vendido</div></div>
        <div class="stat"><div class="n ${ganSem < 0 ? 'neg' : 'pos'}">${money(ganSem)}</div><div class="l">Ganancia</div></div>
      </div>
      <button class="btn btn-sm btn-ghost" style="margin-top:12px" data-act="ir" data-v="graficos">Ver gráficos</button></section>`;
};

/* =============== Vender =============== */
let memoVenta = { productoId: null, clienteId: '', pago: 'contado' };

VISTAS.vender = () => {
  const h = hoy();
  const vh = ventas.filter(v => v.fecha === h).sort((a, b) => b.id - a.id);
  const totalHoy = vh.reduce((s, v) => s + v.total, 0);
  const sel = prod(memoVenta.productoId) ? memoVenta.productoId : (products[0] && products[0].id);
  return `
    ${cabecera('Vender')}
    <form id="f-venta" class="card" novalidate>
      <label class="field"><span>Producto</span><select id="v-prod">${opcionesProductos(sel)}</select><div class="hint" id="v-hint"></div></label>
      <div class="seg" id="v-uni-box" role="radiogroup" aria-label="Se vende por" hidden>
        <label><input type="radio" name="uni" value="panal" checked><span id="v-uni-panal">Por panal</span></label>
        <label><input type="radio" name="uni" value="unidad"><span>Por unidad</span></label>
      </div>
      <div class="row2">
        <div class="field"><span id="v-cant-lbl">Cantidad</span>
          <div class="stepper"><button type="button" data-act="paso" data-t="v-cant" data-d="-1" aria-label="Menos">&minus;</button><input id="v-cant" type="number" inputmode="numeric" min="1" step="1" value="1" aria-label="Cantidad"><button type="button" data-act="paso" data-t="v-cant" data-d="1" aria-label="Más">+</button></div>
          <div class="chips"><button type="button" class="chip" data-act="paso" data-t="v-cant" data-d="10">+10</button><button type="button" class="chip" data-act="paso" data-t="v-cant" data-d="30">+30</button><button type="button" class="chip" data-act="paso" data-t="v-cant" data-d="100">+100</button></div>
        </div>
        <label class="field"><span id="v-precio-lbl">Precio por unidad</span><input id="v-precio" type="number" inputmode="decimal" min="0" step="any" placeholder="0"></label>
      </div>
      <div class="total-line"><span>Total</span><strong id="v-total">$0</strong><span class="muted" id="v-gan"></span></div>
      <div class="seg" role="radiogroup" aria-label="Tipo de pago">
        <label><input type="radio" name="pago" value="contado" ${memoVenta.pago === 'contado' ? 'checked' : ''}><span>Contado</span></label>
        <label><input type="radio" name="pago" value="credito" ${memoVenta.pago === 'credito' ? 'checked' : ''}><span>A crédito</span></label>
      </div>
      <div id="v-cli-box">
        <div class="field"><span id="v-cli-lbl">Cliente (opcional)</span>
          <div class="inline-add"><select id="v-cli" aria-labelledby="v-cli-lbl">${opcionesClientes(memoVenta.clienteId)}</select><button type="button" class="btn btn-teal" data-act="cliente-nuevo" data-vuelta="venta" aria-label="Nuevo cliente">+</button></div>
        </div>
        <label class="field" id="v-abono-box" hidden><span>Abono inicial (opcional)</span><input id="v-abono" type="number" inputmode="decimal" min="0" step="any" placeholder="0"></label>
      </div>
      <label class="field"><span>Fecha</span><input id="v-fecha" type="date" value="${h}"></label>
      <button class="btn btn-teal btn-big" type="submit">Guardar venta</button>
    </form>
    <section class="card"><h3>Ventas de hoy <small>${money(totalHoy)}</small></h3>
      ${vh.length ? `<div class="list">${vh.map(filaVenta).join('')}</div>` : '<p class="empty">Todavía no hay ventas hoy.</p>'}</section>`;
};
const opcionesClientes = sel => '<option value="">Sin cliente (mostrador)</option>' + clientes.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map(c => `<option value="${esc(c.id)}" ${c.id === sel ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('');
const cantTxt = v => (v.panales != null ? `${num(v.panales)} ${v.panales === 1 ? 'panal' : 'panales'}` : num(v.cantidad));
const precioTxt = v => (v.panales != null ? `${money(v.precioPanal)} c/panal` : `${money(v.precio)} c/u`);
const panalesTxt = p => (p.panal > 0 && p.stock >= p.panal ? ` · ${num(Math.floor(p.stock / p.panal))} panales` : '');
const filaVenta = v => {
  const p = prod(v.productoId), c = cliente(v.clienteId);
  return `<div class="row"><div class="main"><div class="t">${cantTxt(v)} × ${esc(p ? p.name : 'Producto eliminado')}</div>
    <div class="s">${precioTxt(v)} · ${v.tipoPago === 'credito' ? 'Crédito' : 'Contado'}${c ? ' · ' + esc(c.nombre) : ''}${v.fecha !== hoy() ? ' · ' + verFecha(v.fecha) : ''}</div></div>
    <div class="r"><strong>${money(v.total)}</strong><br><button class="link-btn neutro" data-act="comprobante" data-id="${esc(v.id)}">Comprobante</button> <button class="link-btn" data-act="venta-anular" data-id="${esc(v.id)}">Anular</button></div></div>`;
};

MONTAR.vender = () => {
  const f = $('#f-venta');
  // Los productos con panal (huevos) se venden por panal o por unidad; lo demás, solo por unidad.
  const modo = () => { const p = prod($('#v-prod').value), r = f.querySelector('input[name=uni]:checked'); return p && p.panal > 0 && r && r.value === 'panal' ? 'panal' : 'unidad'; };
  const factor = () => { const p = prod($('#v-prod').value); return p && modo() === 'panal' ? p.panal : 1; };
  const ajustarUnidad = () => {
    const p = prod($('#v-prod').value), tiene = !!p && p.panal > 0, m = modo();
    $('#v-uni-box').hidden = !tiene;
    if (tiene) $('#v-uni-panal').textContent = `Por panal (${p.panal})`;
    $('#v-cant-lbl').textContent = m === 'panal' ? 'Panales' : 'Cantidad';
    $('#v-precio-lbl').textContent = m === 'panal' ? 'Precio por panal' : 'Precio por unidad';
    const pasos = m === 'panal' ? [1, 5, 10] : [10, 30, 100];
    f.querySelectorAll('.chip').forEach((c, i) => { c.dataset.d = pasos[i]; c.textContent = '+' + pasos[i]; });
  };
  const ponerPrecio = () => {
    const p = prod($('#v-prod').value), k = factor(), por = k > 1 ? 'panal' : 'unidad';
    $('#v-precio').value = p ? (Math.round(precioInicial(p) * k) || '') : '';
    $('#v-hint').textContent = !p ? '' : p.price > 0 ? `Precio fijo: ${money(p.price * k)} por ${por} · costo promedio ${money(p.cost * k)}`
      : p.cost > 0 ? `Sugerido con ${config.margen}% de margen: ${money(precioSugerido(p) * k)} por ${por} · costo promedio ${money(p.cost * k)}` : 'Aún no hay costo: registra una compra para ver el precio sugerido.';
    calcular();
  };
  const calcular = () => {
    const p = prod($('#v-prod').value), k = factor();
    const c = parseFloat($('#v-cant').value) || 0, pr = parseFloat($('#v-precio').value) || 0;
    $('#v-total').textContent = money(c * pr);
    $('#v-gan').textContent = p && p.cost > 0 && c && pr ? `ganas ${money((pr - p.cost * k) * c)}` : '';
  };
  const pago = () => (f.querySelector('input[name=pago]:checked') || {}).value;
  const alternarPago = () => {
    const cr = pago() === 'credito';
    $('#v-cli-lbl').textContent = cr ? 'Cliente (obligatorio a crédito)' : 'Cliente (opcional)';
    $('#v-abono-box').hidden = !cr;
  };
  $('#v-prod').addEventListener('change', () => { const r = f.querySelector('input[name=uni][value=panal]'); if (r) r.checked = true; ajustarUnidad(); ponerPrecio(); });
  f.querySelectorAll('input[name=uni]').forEach(r => r.addEventListener('change', () => { ajustarUnidad(); ponerPrecio(); }));
  f.addEventListener('input', calcular);
  f.querySelectorAll('input[name=pago]').forEach(r => r.addEventListener('change', alternarPago));
  ajustarUnidad(); ponerPrecio(); alternarPago();

  f.addEventListener('submit', async e => {
    e.preventDefault();
    const p = prod($('#v-prod').value);
    const k = factor(), enPanal = modo() === 'panal';
    const n = leerNum($('#v-cant').value), precioIn = leerNum($('#v-precio').value);
    const cantidad = n * k; // el inventario siempre se lleva en unidades
    const tipoPago = pago(), clienteId = $('#v-cli').value || null, fecha = $('#v-fecha').value;
    const abonoTxt = String($('#v-abono').value ?? '').trim();
    if (!p) return aviso('Elige un producto', true);
    if (!(Number.isInteger(n) && enRango(n, 1) && enRango(cantidad, 1))) return aviso(enPanal ? 'Los panales deben ser un número entero mayor que cero' : 'La cantidad debe ser un número entero mayor que cero', true);
    if (!enRango(precioIn)) return aviso('Escribe el precio de venta (un número razonable)', true);
    if (!fechaOk(fecha)) return aviso('Falta la fecha', true);
    if (tipoPago === 'credito' && !clienteId) return aviso('Una venta a crédito necesita cliente', true);
    const abonoIn = tipoPago === 'credito' && abonoTxt !== '' ? leerNum(abonoTxt) : 0;
    if (!enRango(abonoIn)) return aviso('El abono no es válido', true);
    if (p.stock < cantidad && !(await confirmar({ titulo: 'Stock insuficiente', texto: `Solo hay ${num(p.stock)} ${p.unit} de ${p.name}. ¿Registrar la venta igual?`, ok: 'Sí, registrar' }))) return;
    const total = redondear(n * precioIn), precio = total / cantidad; // el total es exacto (a centavos) aunque el precio por unidad no lo sea
    aplicar(() => {
      const descontado = Math.min(p.stock, cantidad);
      p.stock -= descontado;
      let pagado = total; const abonos = [];
      if (tipoPago === 'credito') { const ab = Math.min(redondear(abonoIn), total); pagado = ab; if (ab > 0) abonos.push({ fecha, monto: ab }); }
      ventas.push({ id: nuevoId(), productoId: p.id, cantidad, descontado, precio, total, costoUnitario: p.cost || 0, ganancia: (precio - (p.cost || 0)) * cantidad, fecha, clienteId, tipoPago, pagado, abonos, ...(enPanal ? { panales: n, precioPanal: precioIn } : {}) });
    }, `Venta guardada · ${money(total)}`);
    memoVenta = { productoId: p.id, clienteId: clienteId || '', pago: tipoPago };
    repintar();
  });
};

/* =============== Comprar (entradas) =============== */
let memoCompra = { proveedorId: '', pago: 'todo' };
const opcionesProveedores = sel => '<option value="">Sin proveedor</option>' + proveedores.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map(c => `<option value="${esc(c.id)}" ${c.id === sel ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('');
VISTAS.comprar = () => {
  const rec = entradas.slice().sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id).slice(0, 12);
  return `
    ${cabecera('Llegó mercancía')}
    <form id="f-entrada" class="card" novalidate>
      <label class="field"><span>Producto</span><select id="e-prod">${opcionesProductos(products[0] && products[0].id)}</select><div class="hint" id="e-hint"></div></label>
      <div class="seg" id="e-uni-box" role="radiogroup" aria-label="Llega por" hidden>
        <label><input type="radio" name="euni" value="panal" checked><span id="e-uni-panal">Por panal</span></label>
        <label><input type="radio" name="euni" value="unidad"><span>Por unidad</span></label>
      </div>
      <div class="row2">
        <label class="field"><span id="e-cant-lbl">Cantidad</span><input id="e-cant" type="number" inputmode="numeric" min="1" step="1" placeholder="0"></label>
        <label class="field"><span id="e-costo-lbl">Costo por unidad</span><input id="e-costo" type="number" inputmode="decimal" min="0" step="any" placeholder="0"></label>
      </div>
      <button type="button" class="btn btn-sm btn-ghost" id="e-usar" style="margin:-4px 0 14px">Usar el precio de la vez anterior</button>
      <div class="total-line"><span>Total de la compra</span><strong id="e-total">$0</strong></div>
      <div class="seg" role="radiogroup" aria-label="Pago al proveedor">
        <label><input type="radio" name="epago" value="todo" ${memoCompra.pago !== 'parcial' ? 'checked' : ''}><span>Pagué todo</span></label>
        <label><input type="radio" name="epago" value="parcial" ${memoCompra.pago === 'parcial' ? 'checked' : ''}><span>Queda debiendo</span></label>
      </div>
      <label class="field" id="e-pagado-box" hidden><span>Pagué hoy (el resto queda por pagar)</span><input id="e-pagado" type="number" inputmode="decimal" min="0" step="any" placeholder="0"><div class="hint" id="e-resta"></div></label>
      <div class="row2 fechas">
        <label class="field"><span>Fecha de llegada</span><input id="e-fecha" type="date" value="${hoy()}"></label>
        <label class="field" id="e-b-granja"><span>Días en la granja</span><input id="e-dias" type="number" inputmode="numeric" min="0" max="30" value="2"><div class="hint">Cuántos días llevaba recogido</div></label>
        <label class="field" id="e-b-vence" hidden><span>Fecha de vencimiento</span><input id="e-vence" type="date"><div class="hint">La que dice el empaque</div></label>
      </div>
      <div class="field"><span id="e-prov-lbl">Finca / proveedor (opcional)</span>
        <div class="inline-add"><select id="e-prov" aria-labelledby="e-prov-lbl">${opcionesProveedores(memoCompra.proveedorId)}</select><button type="button" class="btn btn-teal" data-act="proveedor-nuevo" data-vuelta="compra" aria-label="Nuevo proveedor">+</button></div>
      </div>
      <label class="field"><span>Notas (opcional)</span><input id="e-notas" type="text" placeholder="Ej: lote de la mañana"></label>
      <button class="btn btn-teal btn-big" type="submit">Guardar entrada</button>
    </form>
    <section class="card"><h3>Últimas entradas</h3>
      ${rec.length ? `<div class="list">${rec.map(e => { const p = prod(e.productoId); return `<div class="row"><div class="main"><div class="t">${cantTxt(e)} × ${esc(p ? p.name : 'Producto eliminado')}</div><div class="s">${verFecha(e.fecha)} · ${e.panales != null ? money(e.costoPanal) + ' c/panal' : money(e.costoUnitario) + ' c/u'}${e.vence ? ' · vence ' + verFecha(e.vence) : ''}${e.proveedorId && proveedor(e.proveedorId) ? ' · ' + esc(proveedor(e.proveedorId).nombre) : ''}${e.proveedorId && debeEntrada(e) > 0 ? ' · <strong class="neg">debes ' + money(debeEntrada(e)) + '</strong>' : ''}${e.notas ? ' · ' + esc(e.notas) : ''}</div></div><div class="r"><strong>${money(e.total)}</strong><br><button class="link-btn" data-act="entrada-anular" data-id="${esc(e.id)}">Anular</button></div></div>`; }).join('')}</div>` : '<p class="empty">No hay entradas registradas.</p>'}</section>`;
};
MONTAR.comprar = () => {
  const f = $('#f-entrada');
  // Los huevos pueden llegar por panal o por unidad; lo demás, solo por unidad. El inventario siempre se lleva en unidades.
  const modo = () => { const p = prod($('#e-prod').value), r = f.querySelector('input[name=euni]:checked'); return p && p.panal > 0 && r && r.value === 'panal' ? 'panal' : 'unidad'; };
  const factor = () => { const p = prod($('#e-prod').value); return p && modo() === 'panal' ? p.panal : 1; };
  const ajustarUnidad = () => {
    const p = prod($('#e-prod').value), m = modo();
    $('#e-uni-box').hidden = !(p && p.panal > 0);
    if (p && p.panal > 0) $('#e-uni-panal').textContent = `Por panal (${p.panal})`;
    $('#e-cant-lbl').textContent = m === 'panal' ? 'Panales' : 'Cantidad';
    $('#e-costo-lbl').textContent = m === 'panal' ? 'Costo por panal' : 'Costo por unidad';
  };
  const pista = () => {
    const p = prod($('#e-prod').value), k = factor();
    const ultimo = p && (p.lastCost || p.cost);
    ajustarUnidad();
    $('#e-hint').textContent = ultimo ? `Última vez pagaste ${money(ultimo * k)} por ${k > 1 ? 'panal' : 'unidad'}.` : '';
    $('#e-usar').hidden = !ultimo;
    // El formulario se adapta al producto: huevos piden días en granja, empacados piden fecha de vencimiento.
    $('#e-b-granja').hidden = !p || p.control !== 'granja';
    $('#e-b-vence').hidden = !p || p.control !== 'vencimiento';
  };
  const pagoModo = () => (f.querySelector('input[name=epago]:checked') || {}).value;
  const calc = () => {
    const total = (parseFloat($('#e-cant').value) || 0) * (parseFloat($('#e-costo').value) || 0);
    $('#e-total').textContent = money(total);
    const pagado = parseFloat($('#e-pagado').value) || 0;
    $('#e-resta').textContent = pagoModo() === 'parcial' && total > 0 && pagado >= 0 && pagado < total ? `Quedará por pagar ${money(total - pagado)}` : '';
  };
  const alternarPago = () => {
    const parcial = pagoModo() === 'parcial';
    $('#e-pagado-box').hidden = !parcial;
    $('#e-prov-lbl').textContent = parcial ? 'Finca / proveedor (obligatorio si queda debiendo)' : 'Finca / proveedor (opcional)';
    calc();
  };
  f.querySelectorAll('input[name=epago]').forEach(r => r.addEventListener('change', alternarPago));
  $('#e-prod').addEventListener('change', () => { const r = f.querySelector('input[name=euni][value=panal]'); if (r) r.checked = true; pista(); });
  f.querySelectorAll('input[name=euni]').forEach(r => r.addEventListener('change', pista));
  f.addEventListener('input', calc);
  $('#e-usar').addEventListener('click', () => { const p = prod($('#e-prod').value); if (p) { $('#e-costo').value = Math.round((p.lastCost || p.cost) * factor() * 100) / 100; calc(); aviso('Precio anterior aplicado'); } });
  pista(); alternarPago();
  f.addEventListener('submit', e => {
    e.preventDefault();
    const p = prod($('#e-prod').value);
    const k = factor(), enPanal = modo() === 'panal';
    const n = leerNum($('#e-cant').value), costoIn = leerNum($('#e-costo').value), fecha = $('#e-fecha').value;
    const cantidad = n * k; // unidades que entran a la bodega
    if (!p) return aviso('Elige un producto', true);
    const diasGranja = p.control === 'granja' ? Math.min(30, Math.max(0, parseInt($('#e-dias').value, 10) || 0)) : 0;
    const vence = p.control === 'vencimiento' ? $('#e-vence').value : '';
    if (!(Number.isInteger(n) && enRango(n, 1) && enRango(cantidad, 1))) return aviso(enPanal ? 'Los panales deben ser un número entero mayor que cero' : 'La cantidad debe ser un número entero mayor que cero', true);
    if (!enRango(costoIn)) return aviso(`Escribe el costo por ${enPanal ? 'panal' : 'unidad'} (un número razonable)`, true);
    const total = redondear(n * costoIn), costo = Math.round(total / cantidad * 10000) / 10000; // el total es exacto; el costo por unidad lleva 4 decimales (30 huevos de un panal de 14.333,33 no caben en 2)
    if (!fechaOk(fecha)) return aviso('Falta la fecha', true);
    if (p.control === 'vencimiento' && !fechaOk(vence)) return aviso('Escribe la fecha de vencimiento', true);
    if (vence && vence < fecha) return aviso('La fecha de vencimiento es anterior a la llegada', true);
    const notas = $('#e-notas').value.trim();
    const proveedorId = $('#e-prov').value || null, parcial = pagoModo() === 'parcial';
    let pagado = total; const abonos = [];
    if (parcial) {
      if (!proveedorId) return aviso('Si queda debiendo, elige a quién (o crea el proveedor con +)', true);
      const txt = String($('#e-pagado').value ?? '').trim(), hoyPaga = txt === '' ? 0 : redondear(leerNum(txt));
      if (!enRango(hoyPaga)) return aviso('El valor pagado no es válido', true);
      if (hoyPaga >= total) return aviso('Pagaste todo: elige «Pagué todo»', true);
      pagado = hoyPaga; if (hoyPaga > 0) abonos.push({ fecha, monto: hoyPaga });
    }
    aplicar(() => {
      const stockPrevio = p.stock, costoPrevio = p.cost || 0, lastCostPrevio = p.lastCost || 0;
      p.stock = stockPrevio + cantidad;
      p.cost = p.stock > 0 ? Math.round(((stockPrevio * costoPrevio) + (cantidad * costo)) / p.stock * 10000) / 10000 : costo;
      p.lastCost = costo;
      entradas.push({ id: nuevoId(), productoId: p.id, cantidad, costoUnitario: costo, total, fecha, diasGranja, ...(vence ? { vence } : {}), ...(enPanal ? { panales: n, costoPanal: costoIn } : {}), ...(proveedorId ? { proveedorId } : {}), pagado, abonos, notas, costoPrevio, lastCostPrevio });
    }, `Entrada guardada · ${enPanal ? num(n) + ' panales de' : num(cantidad)} ${p.name}${parcial ? ' · debes ' + money(total - pagado) : ''}`);
    memoCompra = { proveedorId: proveedorId || '', pago: parcial ? 'parcial' : 'todo' };
    repintar();
  });
};

/* =============== Clientes =============== */
let filtroCliente = '';
VISTAS.clientes = () => `
  ${cabecera('Clientes')}
  <div class="card">
    <label class="field"><span>Buscar</span><input id="c-buscar" type="search" placeholder="Nombre del cliente" value="${esc(filtroCliente)}" autocomplete="off"></label>
    <button class="btn btn-teal" data-act="cliente-nuevo">+ Nuevo cliente</button>
    ${sync && sync.listo ? '<div class="btn-row"><button class="btn btn-ghost" data-act="sheets-clientes">Traer clientes del Sheet</button></div>' : ''}
  </div>
  <div id="c-lista"></div>`;
function listaClientes() {
  const q = filtroCliente.trim().toLowerCase();
  const fl = clientes.filter(c => c.nombre.toLowerCase().includes(q)).sort((a, b) => deudaCliente(b.id) - deudaCliente(a.id) || a.nombre.localeCompare(b.nombre, 'es'));
  $('#c-lista').innerHTML = fl.length ? `<div class="card"><div class="list">${fl.map(c => {
    const d = deudaCliente(c.id), np = ventas.filter(v => v.clienteId === c.id && debeVenta(v) > 0).length;
    return `<button class="row" data-act="cliente-ver" data-id="${esc(c.id)}"><div class="main"><div class="t">${esc(c.nombre)}</div><div class="s">${esc(c.telefono || 'Sin teléfono')}${np ? ` · ${np} pedido${np > 1 ? 's' : ''} pendiente${np > 1 ? 's' : ''}` : ''}</div></div><div class="r"><strong class="${d > 0 ? 'neg' : 'pos'}">${d > 0 ? money(d) : 'Al día'}</strong></div></button>`;
  }).join('')}</div></div>` : `<div class="card"><p class="empty">${clientes.length ? 'Ningún cliente coincide.' : 'Aún no tienes clientes. Crea el primero con el botón de arriba.'}</p></div>`;
}
MONTAR.clientes = () => {
  $('#c-buscar').addEventListener('input', e => { filtroCliente = e.target.value; listaClientes(); });
  listaClientes();
};

function formCliente(c, vuelta) {
  hoja(c ? 'Editar cliente' : 'Nuevo cliente', `
    <form id="f-cli" novalidate>
      <label class="field"><span>Nombre</span><input id="cl-nombre" type="text" value="${esc(c ? c.nombre : '')}" autocomplete="off"></label>
      <label class="field"><span>Celular (para WhatsApp)</span><input id="cl-tel" type="tel" inputmode="tel" placeholder="300 123 4567" value="${esc(c ? c.telefono : '')}"></label>
      <label class="field"><span>Cédula o NIT (para el comprobante)</span><input id="cl-doc" type="text" inputmode="numeric" value="${esc(c ? c.documento || '' : '')}" autocomplete="off"></label>
      <label class="field"><span>Dirección / notas</span><textarea id="cl-notas" rows="2">${esc(c ? c.notas : '')}</textarea></label>
      <button class="btn btn-teal" type="submit">Guardar</button>
      ${c && !ventas.some(v => v.clienteId === c.id) ? '<div class="btn-row"><button class="btn btn-ghost" type="button" id="cl-del">Eliminar cliente</button></div>' : ''}
    </form>`, b => {
    $('#f-cli', b).addEventListener('submit', e => {
      e.preventDefault();
      const nombre = $('#cl-nombre', b).value.trim();
      if (!nombre) return aviso('Escribe el nombre', true);
      const dato = { nombre, telefono: $('#cl-tel', b).value.trim(), notas: $('#cl-notas', b).value.trim(), documento: $('#cl-doc', b).value.trim().slice(0, 30) };
      const id = c ? c.id : 'c' + nuevoId();
      aplicar(() => { if (c) Object.assign(c, dato); else clientes.push({ id, ...dato }); }, 'Cliente guardado');
      cerrarHoja();
      if (vuelta === 'venta') { const pr = $('#v-prod'), pg = $('input[name=pago]:checked'); memoVenta = { productoId: pr ? pr.value : memoVenta.productoId, clienteId: id, pago: pg ? pg.value : memoVenta.pago }; }
      repintar();
    });
    const del = $('#cl-del', b);
    if (del) del.addEventListener('click', () => { aplicar(() => { clientes = clientes.filter(x => x.id !== c.id); }, 'Cliente eliminado'); cerrarHoja(); repintar(); });
  });
}

function verCliente(id) {
  const c = cliente(id); if (!c) return;
  const pedidos = ventas.filter(v => v.clienteId === id).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id);
  const d = deudaCliente(id);
  hoja(c.nombre, `
    <p class="muted">${esc(c.telefono || 'Sin teléfono')}${c.notas ? ' · ' + esc(c.notas) : ''}</p>
    <div class="stats" style="margin:12px 0"><div class="stat ${d > 0 ? 'red' : 'teal'}"><div class="n">${money(d)}</div><div class="l">${d > 0 ? 'Debe en total' : 'Está al día'}</div></div>
      <div class="stat"><div class="n">${pedidos.length}</div><div class="l">Pedidos</div></div></div>
    <div class="btn-row">
      ${d > 0 ? `<button class="btn btn-teal" data-act="abonar" data-cli="${esc(id)}">Registrar abono</button>` : ''}
      <button class="btn btn-wa" data-act="cliente-wa" data-id="${esc(id)}">WhatsApp</button>
      <button class="btn btn-ghost" data-act="cliente-editar" data-id="${esc(id)}">Editar</button>
    </div>
    <h3 style="margin:18px 0 10px">Pedidos</h3>
    ${pedidos.length ? pedidos.map(v => {
      const p = prod(v.productoId), ab = v.pagado || 0, resta = debeVenta(v);
      const est = v.tipoPago !== 'credito' || resta <= 0 ? ['ok', 'Pagado'] : ab > 0 ? ['low', 'Abono parcial'] : ['out', 'Pendiente'];
      return `<div class="pedido"><div class="top-line"><strong>${verFecha(v.fecha)}</strong><span class="badge ${est[0]}">${est[1]}</span></div>
        <div>${cantTxt(v)} × ${esc(p ? p.name : 'Producto eliminado')} a ${precioTxt(v).replace(' c/', ' por ')}</div>
        <div>Total ${money(v.total)}${v.tipoPago === 'credito' ? ` · abonado ${money(ab)} · <strong>debe ${money(resta)}</strong>` : ' · contado'}</div>
        <div><button class="link-btn neutro" data-act="comprobante" data-id="${esc(v.id)}">Ver comprobante${v.numero ? ' N° ' + esc(numeroTxt(v.numero)) : ''}</button></div>
        ${resta > 0 ? `<div class="btn-row"><button class="btn btn-sm btn-teal" data-act="abonar" data-venta="${esc(v.id)}">Abonar</button><button class="btn btn-sm btn-sun" data-act="pagar" data-id="${esc(v.id)}">Pagó completo</button></div>` : ''}</div>`;
    }).join('') : '<p class="empty">Todavía no tiene pedidos.</p>'}`);
}

function formAbono({ clienteId, ventaId }) {
  const v = ventaId ? ventas.find(x => x.id === ventaId) : null;
  const cid = clienteId || (v && v.clienteId);
  const maximo = v ? debeVenta(v) : deudaCliente(cid);
  hoja('Registrar abono', `
    <form id="f-abono" novalidate>
      <p class="muted" style="margin-bottom:12px">${v ? 'Abono a este pedido.' : 'Se aplica primero a los pedidos más viejos.'} Debe ${money(maximo)}.</p>
      <label class="field"><span>Monto que abona</span><input id="ab-monto" type="number" inputmode="decimal" min="0.01" step="any" max="${esc(maximo)}" placeholder="0"></label>
      <button class="btn btn-teal" type="submit">Guardar abono</button>
    </form>`, b => $('#f-abono', b).addEventListener('submit', e => {
    e.preventDefault();
    let monto = redondear(leerNum($('#ab-monto', b).value));
    if (!(monto > 0 && enRango(monto))) return aviso('Escribe un monto', true);
    if (monto > maximo) monto = maximo;
    aplicar(() => {
      const objetivo = v ? ventas.filter(x => x.id === v.id) : ventas.filter(x => x.clienteId === cid && debeVenta(x) > 0).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id);
      let resto = monto;
      for (const x of objetivo) { if (resto <= 0) break; const aplica = Math.min(resto, debeVenta(x)); x.pagado = redondear((x.pagado || 0) + aplica); (x.abonos = x.abonos || []).push({ fecha: hoy(), monto: aplica }); resto = redondear(resto - aplica); }
    }, `Abono de ${money(monto)} guardado`);
    cerrarHoja(); verCliente(cid); repintar();
  }));
}

function whatsapp(id) {
  const c = cliente(id); if (!c || !c.telefono) return aviso('El cliente no tiene teléfono', true);
  let tel = c.telefono.replace(/\D/g, '');
  if (tel.length === 10 && tel[0] === '3') tel = '57' + tel; // celulares de Colombia
  const d = deudaCliente(id);
  let msg = `Hola ${c.nombre}, te escribo de El Gallinero.\n\n`;
  if (d > 0) {
    msg += `Tu saldo pendiente es de ${money(d)}.\n\nDetalle:\n`;
    ventas.filter(v => v.clienteId === id && debeVenta(v) > 0).sort((a, b) => a.fecha.localeCompare(b.fecha)).forEach(v => { const p = prod(v.productoId); msg += `• ${verFecha(v.fecha)}: ${cantTxt(v)} ${p ? p.name : ''} - debe ${money(debeVenta(v))}\n`; });
    msg += '\nPor favor confirma el pago o un abono. ¡Gracias!';
  } else msg += 'Tu cuenta está al día. ¡Gracias por tu compra!';
  window.open(`https://wa.me/${tel}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
}

/* =============== Proveedores y cuentas por pagar =============== */
/* Lo que se le debe a las fincas: una compra puede pagarse en parte el día que llega y abonarse después. Es el espejo de
   «clientes que me deben», pero al revés. Las compras anteriores se consideran pagadas por completo. */
const debeEntrada = e => aCero(redondear(e.total - (e.pagado ?? e.total)));
const proveedor = id => proveedores.find(x => x.id === id);
const deudaProveedor = id => entradas.reduce((s, e) => s + (e.proveedorId === id ? debeEntrada(e) : 0), 0);
const deudaProveedores = () => entradas.reduce((s, e) => s + (e.proveedorId ? debeEntrada(e) : 0), 0);

VISTAS.proveedores = () => {
  const total = deudaProveedores();
  const lista = proveedores.slice().sort((a, b) => deudaProveedor(b.id) - deudaProveedor(a.id) || a.nombre.localeCompare(b.nombre, 'es'));
  return `
    ${cabecera('Proveedores', 'mas')}
    <div class="card">
      <div class="stats" style="margin-bottom:12px"><div class="stat ${total > 0 ? 'red' : 'teal'}"><div class="n">${money(total)}</div><div class="l">${total > 0 ? 'Debo en total' : 'Estás al día'}</div></div>
        <div class="stat"><div class="n">${proveedores.length}</div><div class="l">Proveedores</div></div></div>
      <button class="btn btn-teal" data-act="proveedor-nuevo">+ Nuevo proveedor</button>
    </div>
    <div class="card">${lista.length ? `<div class="list">${lista.map(p => {
      const d = deudaProveedor(p.id), np = entradas.filter(e => e.proveedorId === p.id && debeEntrada(e) > 0).length;
      return `<button class="row" data-act="proveedor-ver" data-id="${esc(p.id)}"><div class="main"><div class="t">${esc(p.nombre)}</div><div class="s">${esc(p.telefono || 'Sin teléfono')}${np ? ` · ${np} compra${np > 1 ? 's' : ''} por pagar` : ''}</div></div><div class="r"><strong class="${d > 0 ? 'neg' : 'pos'}">${d > 0 ? money(d) : 'Al día'}</strong></div></button>`;
    }).join('')}</div>` : '<p class="empty">Aún no tienes proveedores. Crea uno aquí, o desde Comprar con el botón +.</p>'}</div>`;
};

function formProveedor(pv, vuelta) {
  hoja(pv ? 'Editar proveedor' : 'Nuevo proveedor', `
    <form id="f-prov" novalidate>
      <label class="field"><span>Nombre (finca o proveedor)</span><input id="pv-nombre" type="text" value="${esc(pv ? pv.nombre : '')}" autocomplete="off"></label>
      <label class="field"><span>Teléfono</span><input id="pv-tel" type="tel" inputmode="tel" value="${esc(pv ? pv.telefono : '')}"></label>
      <label class="field"><span>Notas</span><textarea id="pv-notas" rows="2">${esc(pv ? pv.notas : '')}</textarea></label>
      <button class="btn btn-teal" type="submit">Guardar</button>
      ${pv && !entradas.some(e => e.proveedorId === pv.id) ? '<div class="btn-row"><button class="btn btn-ghost" type="button" id="pv-del">Eliminar proveedor</button></div>' : ''}
    </form>`, b => {
    $('#f-prov', b).addEventListener('submit', e => {
      e.preventDefault();
      const nombre = $('#pv-nombre', b).value.trim();
      if (!nombre) return aviso('Escribe el nombre', true);
      const dato = { nombre: nombre.slice(0, 100), telefono: $('#pv-tel', b).value.trim().slice(0, 30), notas: $('#pv-notas', b).value.trim().slice(0, 300) };
      let id;
      if (pv) id = pv.id; else id = 'f' + nuevoId();
      aplicar(() => { if (pv) Object.assign(pv, dato); else proveedores.push({ id, ...dato }); }, 'Proveedor guardado');
      cerrarHoja();
      if (vuelta === 'compra') { const pg = $('input[name=epago]:checked'); memoCompra = { proveedorId: id, pago: pg ? pg.value : memoCompra.pago }; }
      repintar();
    });
    const del = $('#pv-del', b);
    if (del) del.addEventListener('click', () => { aplicar(() => { proveedores = proveedores.filter(x => x.id !== pv.id); }, 'Proveedor eliminado'); cerrarHoja(); repintar(); });
  });
}

function verProveedor(id) {
  const pv = proveedor(id); if (!pv) return;
  const compras = entradas.filter(e => e.proveedorId === id).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id);
  const d = deudaProveedor(id);
  hoja(pv.nombre, `
    <p class="muted">${esc(pv.telefono || 'Sin teléfono')}${pv.notas ? ' · ' + esc(pv.notas) : ''}</p>
    <div class="stats" style="margin:12px 0"><div class="stat ${d > 0 ? 'red' : 'teal'}"><div class="n">${money(d)}</div><div class="l">${d > 0 ? 'Le debes en total' : 'Estás al día'}</div></div>
      <div class="stat"><div class="n">${compras.length}</div><div class="l">Compras</div></div></div>
    ${pv.saldoFavor > 0 ? `<p class="muted" style="margin-bottom:12px"><strong>Saldo a favor: ${money(pv.saldoFavor)}</strong> · pagado en compras anuladas</p>` : ''}
    <div class="btn-row">
      ${d > 0 ? `<button class="btn btn-teal" data-act="pagar-proveedor" data-prov="${esc(id)}">Registrar pago</button>` : ''}
      <button class="btn btn-ghost" data-act="proveedor-editar" data-id="${esc(id)}">Editar</button>
    </div>
    <h3 style="margin:18px 0 10px">Compras</h3>
    ${compras.length ? compras.map(e => {
      const p = prod(e.productoId), pag = e.pagado ?? e.total, resta = debeEntrada(e);
      const est = resta <= 0 ? ['ok', 'Pagada'] : pag > 0 ? ['low', 'Pago parcial'] : ['out', 'Sin pagar'];
      return `<div class="pedido"><div class="top-line"><strong>${verFecha(e.fecha)}</strong><span class="badge ${est[0]}">${est[1]}</span></div>
        <div>${cantTxt(e)} × ${esc(p ? p.name : 'Producto eliminado')}</div>
        <div>Total ${money(e.total)} · pagado ${money(pag)} · <strong>falta ${money(resta)}</strong></div>
        ${resta > 0 ? `<div class="btn-row"><button class="btn btn-sm btn-teal" data-act="pagar-proveedor" data-prov="${esc(id)}" data-entrada="${esc(e.id)}">Pagar</button><button class="btn btn-sm btn-sun" data-act="pagar-compra-completa" data-id="${esc(e.id)}">Pagar lo que falta</button></div>` : ''}</div>`;
    }).join('') : '<p class="empty">Todavía no hay compras a este proveedor.</p>'}`);
}

// Aplica un pago a las compras (la indicada, o las más viejas primero) y devuelve el detalle para mostrarlo.
function aplicarPagoProveedor(provId, entradaId, monto) {
  const detalle = [];
  const ok = aplicar(() => {
    const objetivo = entradaId ? entradas.filter(x => x.id === entradaId) : entradas.filter(x => x.proveedorId === provId && debeEntrada(x) > 0).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id);
    let resto = monto;
    for (const x of objetivo) {
      if (resto <= 0) break;
      const aplica = Math.min(resto, debeEntrada(x));
      x.pagado = redondear((x.pagado ?? x.total) + aplica); (x.abonos = x.abonos || []).push({ fecha: hoy(), monto: aplica }); resto = redondear(resto - aplica);
      detalle.push({ id: x.id, fecha: x.fecha, productoId: x.productoId, aplicado: aplica, resta: debeEntrada(x), total: x.total });
    }
  }, '');
  return ok ? detalle : null;
}
// Después de pagar: dice cuánto se pagó y cuánto falta por pagar.
function resultadoPagoProveedor(provId, pagado, detalle) {
  const pv = proveedor(provId), falta = deudaProveedor(provId);
  hoja('Pago registrado', `
    <div class="no-print">
    <div class="stats" style="margin-bottom:12px"><div class="stat teal"><div class="n">${money(pagado)}</div><div class="l">Pagaste</div></div>
      <div class="stat ${falta > 0 ? 'red' : 'teal'}"><div class="n">${money(falta)}</div><div class="l">${falta > 0 ? 'Falta por pagar' : 'Estás al día'}</div></div></div>
    <p class="muted" style="margin-bottom:8px">${esc(pv ? pv.nombre : 'Proveedor')} · ${verFecha(hoy())}</p>
    ${detalle.map(d => { const p = prod(d.productoId); return `<div class="row"><div class="main"><div class="t">${verFecha(d.fecha)} · ${esc(p ? p.name : 'Producto eliminado')}</div><div class="s">Pagaste ${money(d.aplicado)} de ${money(d.total)}</div></div><div class="r"><strong class="${d.resta > 0 ? 'neg' : 'pos'}">${d.resta > 0 ? 'faltan ' + money(d.resta) : 'Pagada'}</strong></div></div>`; }).join('')}
    </div>
    ${comprobantePagoHTML(provId, pagado, detalle)}
    <div class="btn-row no-print"><button class="btn btn-teal" data-act="imprimir-doc">Imprimir comprobante</button><button class="btn btn-ghost" data-act="cerrar">Cerrar</button></div>`);
}
function formPagoProveedor({ proveedorId, entradaId }) {
  const e0 = entradaId ? entradas.find(x => x.id === entradaId) : null;
  const pid = proveedorId || (e0 && e0.proveedorId);
  const maximo = e0 ? debeEntrada(e0) : deudaProveedor(pid);
  hoja('Registrar pago', `
    <form id="f-pago-prov" novalidate>
      <p class="muted" style="margin-bottom:12px">${e0 ? 'Pago a esta compra.' : 'Se aplica primero a las compras más viejas.'} Le debes ${money(maximo)}.</p>
      <label class="field"><span>Monto que pagas</span><input id="pp-monto" type="number" inputmode="decimal" min="0.01" step="any" max="${esc(maximo)}" placeholder="0"></label>
      <button class="btn btn-teal" type="submit">Guardar pago</button>
    </form>`, b => $('#f-pago-prov', b).addEventListener('submit', ev => {
    ev.preventDefault();
    let monto = redondear(leerNum($('#pp-monto', b).value));
    if (!(monto > 0 && enRango(monto))) return aviso('Escribe un monto', true);
    if (monto > maximo) monto = maximo;
    const detalle = aplicarPagoProveedor(pid, entradaId, monto);
    if (!detalle) return;
    cerrarHoja(); resultadoPagoProveedor(pid, monto, detalle); repintar();
  }));
}
function pagarCompraCompleta(entradaId) {
  const e = entradas.find(x => x.id === entradaId); if (!e || !e.proveedorId) return;
  const monto = debeEntrada(e); if (monto <= 0) return;
  const detalle = aplicarPagoProveedor(e.proveedorId, entradaId, monto);
  if (!detalle) return;
  cerrarHoja(); resultadoPagoProveedor(e.proveedorId, monto, detalle); repintar();
}

/* =============== Gráficos de ganancias =============== */
/* Gráficos dibujados con SVG propio (sin librerías, funcionan sin internet). La ganancia es la misma de todo el resto
   de la app: lo vendido menos lo que costó lo vendido. */
let grafTipo = 'semanas';
const GRAF = { semanas: 'Últimas 8 semanas', meses: 'Últimos 6 meses', anio: 'Últimos 12 meses' };

function periodosGrafico(tipo) {
  const out = [], h = hoy();
  if (tipo === 'semanas') {
    const lunes = lunesDe(h);
    for (let i = 7; i >= 0; i--) { const ini = sumarDias(lunes, -7 * i); out.push({ ini, fin: sumarDias(ini, 6), etiqueta: verFecha(ini).slice(0, 5), nombre: `Semana del ${verFecha(ini).slice(0, 5)}` }); }
  } else {
    const n = tipo === 'anio' ? 12 : 6, f = fechaDe(h);
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(f.getFullYear(), f.getMonth() - i, 1), y = d.getFullYear(), m = d.getMonth();
      out.push({ ini: `${y}-${pad(m + 1)}-01`, fin: `${y}-${pad(m + 1)}-${pad(new Date(y, m + 1, 0).getDate())}`, etiqueta: MESES[m].slice(0, 3), nombre: `${MESES[m]} ${y}` });
    }
  }
  return out;
}
function datosGrafico(tipo) {
  return periodosGrafico(tipo).map(p => {
    const en = f => f >= p.ini && f <= p.fin;
    const ven = ventas.filter(v => en(v.fecha)), vendido = ven.reduce((s, v) => s + v.total, 0);
    return { ...p, vendido, compras: entradas.filter(e => en(e.fecha)).reduce((s, e) => s + e.total, 0), ganancia: vendido - ven.reduce((s, v) => s + costoVenta(v), 0),
      perdidas: ajustes.filter(a => en(a.fecha)).reduce((s, a) => s + a.cantidad * (a.costoUnitario || 0), 0) };
  });
}
// $1,2 M · $350 mil · $800
function corto(n) {
  const a = Math.abs(n), sg = n < 0 ? '-' : '';
  if (a >= 1e6) return `${sg}$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace('.', ',')} M`;
  if (a >= 1e3) return `${sg}$${Math.round(a / 1e3)} mil`;
  return `${sg}$${Math.round(a)}`;
}
const bonito = x => { const p = Math.pow(10, Math.floor(Math.log10(x))), f = x / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };

function graficoBarras({ titulo, etiquetas, series }) {
  const W = 340, H = 200, ml = 48, mr = 8, mt = 12, mb = 24;
  const todos = series.flatMap(s => s.valores), max = Math.max(0, ...todos), min = Math.min(0, ...todos);
  const paso = bonito(((max - min) || 1) / 4);
  const top = Math.ceil(max / paso) * paso || paso, bot = Math.floor(min / paso) * paso;
  const y = v => mt + (top - v) / (top - bot) * (H - mt - mb);
  const n = etiquetas.length, gw = (W - ml - mr) / n, bw = Math.min(28, gw * 0.78 / series.length);
  const trama = series.length > 1; // la segunda serie lleva trama diagonal: se distingue sin depender del color
  let g = '';
  const lineas = Math.round((top - bot) / paso);
  for (let i = 0; i <= lineas; i++) { const v = bot + i * paso; g += `<line class="g-grid" x1="${ml}" x2="${W - mr}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="g-txt" x="${ml - 5}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${esc(corto(v))}</text>`; }
  g += `<line class="g-zero" x1="${ml}" x2="${W - mr}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"/>`;
  etiquetas.forEach((et, i) => {
    const x0 = ml + i * gw + (gw - bw * series.length) / 2;
    series.forEach((s, k) => {
      const v = s.valores[i]; if (!v) return;
      const alto = Math.max(Math.abs(y(v) - y(0)), 1.5), yy = v >= 0 ? y(0) - alto : y(0);
      g += `<rect class="g-bar ${v < 0 && s.neg ? 'g-neg' : 'g-s' + k}${trama && k === 1 ? ' g-trama' : ''}" x="${(x0 + k * bw).toFixed(1)}" y="${yy.toFixed(1)}" width="${bw.toFixed(1)}" height="${alto.toFixed(1)}" rx="2"><title>${esc(et)} · ${esc(s.nombre)}: ${esc(money(v))}</title></rect>`;
    });
    if (gw >= 30 || (n - 1 - i) % 2 === 0) g += `<text class="g-txt" x="${(ml + i * gw + gw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(et)}</text>`; // grupos angostos: una etiqueta de cada dos, siempre la última
  });
  const tabla = `<details class="datos"><summary>Ver los números</summary><table class="tbl"><thead><tr><th>${etiquetas.length ? 'Período' : ''}</th>${series.map(s => `<th class="num">${esc(s.nombre)}</th>`).join('')}</tr></thead><tbody>${etiquetas.map((et, i) => `<tr><td>${esc(et)}</td>${series.map(s => `<td class="num">${money(s.valores[i])}</td>`).join('')}</tr>`).join('')}</tbody></table></details>`;
  const leyenda = series.length > 1 ? `<div class="leyenda">${series.map((s, k) => `<span><i class="g-s${k}"></i>${esc(s.nombre)}</span>`).join('')}</div>` : '';
  const defs = trama ? '<defs><pattern id="g-trama" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" style="fill:var(--sun)"/><line x1="0" y1="0" x2="0" y2="6" style="stroke:var(--ink);stroke-width:2.5"/></pattern></defs>' : '';
  return `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(titulo)}"><title>${esc(titulo)}</title>${defs}${g}</svg>${leyenda}${tabla}`;
}

VISTAS.graficos = () => {
  const datos = datosGrafico(grafTipo), et = datos.map(d => d.etiqueta);
  const ini = datos[0].ini, fin = datos[datos.length - 1].fin;
  const tot = datos.reduce((a, d) => ({ vendido: a.vendido + d.vendido, ganancia: a.ganancia + d.ganancia, compras: a.compras + d.compras, perdidas: a.perdidas + d.perdidas }), { vendido: 0, ganancia: 0, compras: 0, perdidas: 0 });
  const hay = datos.some(d => d.vendido || d.compras);
  const mejor = datos.reduce((a, d) => (d.ganancia > a.ganancia ? d : a), datos[0]);
  const margen = tot.vendido > 0 ? Math.round(tot.ganancia / tot.vendido * 100) : 0;
  const porProd = new Map();
  ventas.filter(v => v.fecha >= ini && v.fecha <= fin).forEach(v => porProd.set(v.productoId, (porProd.get(v.productoId) || 0) + v.total - costoVenta(v)));
  const top = [...porProd.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6), maxTop = Math.max(1, ...top.map(t => t[1]));
  const deben = deudaTotal(), debo = deudaProveedores();
  return `
    ${cabecera('Gráficos', 'mas')}
    <div class="tabs tres no-print" role="tablist">${Object.entries(GRAF).map(([k, t]) => `<button role="tab" aria-selected="${k === grafTipo}" class="${k === grafTipo ? 'on' : ''}" data-act="graf-tipo" data-t="${k}">${t.replace('Últimas ', '').replace('Últimos ', '')}</button>`).join('')}</div>
    <p class="view-sub" style="margin-top:0">${GRAF[grafTipo]}</p>
    <section class="card"><div class="stats una">
      <div class="stat teal"><div class="n ${tot.ganancia < 0 ? 'neg' : ''}">${money(tot.ganancia)}</div><div class="l">Ganancia del período</div></div>
      <div class="stat sun"><div class="n">${money(tot.vendido)}</div><div class="l">Vendido</div></div></div>
      <div class="stats" style="margin-top:10px">
      <div class="stat"><div class="n">${margen}%</div><div class="l">Margen sobre lo vendido</div></div>
      <div class="stat"><div class="n">${mejor.ganancia > 0 ? esc(mejor.etiqueta) : '—'}</div><div class="l">${mejor.ganancia > 0 ? `Mejor ${grafTipo === 'semanas' ? 'semana' : 'mes'}: ${money(mejor.ganancia)}` : 'Aún sin ganancias'}</div></div>
    </div></section>
    ${hay ? `
    <section class="card"><h3>Ganancia por ${grafTipo === 'semanas' ? 'semana' : 'mes'}</h3>
      ${graficoBarras({ titulo: `Ganancia por ${grafTipo === 'semanas' ? 'semana' : 'mes'}, ${GRAF[grafTipo].toLowerCase()}`, etiquetas: et, series: [{ nombre: 'Ganancia', valores: datos.map(d => d.ganancia), neg: true }] })}</section>
    <section class="card"><h3>Ventas y compras</h3>
      ${graficoBarras({ titulo: `Ventas y compras, ${GRAF[grafTipo].toLowerCase()}`, etiquetas: et, series: [{ nombre: 'Vendido', valores: datos.map(d => d.vendido) }, { nombre: 'Comprado', valores: datos.map(d => d.compras) }] })}</section>
    <section class="card"><h3>Lo que más deja</h3>${top.length ? `<div class="list">${top.map(([id, g]) => { const p = prod(id); return `<div class="row"><div class="main"><div class="t">${esc(p ? p.name : 'Producto eliminado')}</div><div class="hbar"><span style="width:${Math.max(0, Math.round(g / maxTop * 100))}%"></span></div></div><div class="r"><strong class="${g < 0 ? 'neg' : ''}">${money(g)}</strong></div></div>`; }).join('')}</div>` : '<p class="empty">Sin ventas en este período.</p>'}</section>
    <section class="card"><h3>Pendiente hoy</h3><div class="stats">
      <div class="stat ${deben > 0 ? 'red' : ''}"><div class="n">${money(deben)}</div><div class="l">Me deben los clientes</div></div>
      <div class="stat ${debo > 0 ? 'red' : ''}"><div class="n">${money(debo)}</div><div class="l">Debo a proveedores</div></div></div>
      ${tot.perdidas > 0 ? `<p class="muted" style="margin-top:10px">Pérdidas del período (huevos rotos, vencidos): ${money(tot.perdidas)}.</p>` : ''}</section>`
    : '<section class="card"><p class="empty">Todavía no hay ventas ni compras en este período. Cuando registres movimientos, aquí verás cómo van tus ganancias.</p></section>'}`;
};

/* =============== Comprobante de venta =============== */
/* Documento formal para imprimir: encabezado del negocio, número consecutivo, cliente, detalle, totales, saldo y firmas.
   Es una base de control interno que ya reúne los datos que pide una factura (emisor, adquirente, consecutivo, detalle,
   valores, forma de pago), pero NO es una factura electrónica de venta ante la DIAN. */
const numeroTxt = n => { const pf = (config.negocio && config.negocio.prefijo) || ''; return `${pf}${pf ? '-' : ''}${String(n).padStart(6, '0')}`; };

// Las ventas de un mismo cliente en el mismo día salen juntas en un comprobante; una vez numerado, el grupo queda fijo.
// Un número solo agrupa ventas del MISMO cliente (dos clientes con el mismo número nunca se mezclan) y el mostrador va solo.
function grupoComprobante(v) {
  if (!v.clienteId) return [v];
  if (v.numero) return ventas.filter(x => x.numero === v.numero && x.clienteId === v.clienteId);
  return ventas.filter(x => x.clienteId === v.clienteId && x.fecha === v.fecha && !x.numero);
}
// Mayor número emitido: de las ventas vivas y de las anuladas (un número impreso nunca se reutiliza).
const mayorNumero = () => Math.max(0, ...ventas.map(v => v.numero || 0), ...config.anulados.map(a => a.numero));
function siguienteNumero() {
  const usados = new Set([...ventas.map(v => v.numero), ...config.anulados.map(a => a.numero)]);
  let n = Math.max(1, config.consecutivo);
  while (usados.has(n)) n++;
  return n;
}
// Asigna el siguiente número libre a todo el grupo y avanza el consecutivo. Devuelve false si no se pudo guardar.
function numerarGrupo(grupo) {
  const n = siguienteNumero();
  if (n > MAX_NUMERO) { aviso('Se acabaron los números de comprobante (el máximo es 999999999).', true); return false; }
  const ids = new Set(grupo.map(x => x.id));
  return aplicar(() => { ventas.forEach(x => { if (ids.has(x.id)) x.numero = n; }); config.consecutivo = n + 1; }, '');
}
function comprobanteHTML(grupo) {
  const neg = config.negocio, v0 = grupo[0], c = cliente(v0.clienteId);
  const total = grupo.reduce((s, v) => s + v.total, 0), saldo = grupo.reduce((s, v) => s + debeVenta(v), 0), pagado = total - saldo;
  const credito = grupo.some(v => v.tipoPago === 'credito');
  const filas = grupo.map(v => {
    const p = prod(v.productoId), panal = v.panales != null && v.panales > 0;
    return `<tr><td>${esc(p ? p.name : 'Producto eliminado')}${panal ? `<small> · panal de ${num(v.cantidad / v.panales)} u.</small>` : ''}</td><td class="num">${panal ? num(v.panales) + (v.panales === 1 ? ' panal' : ' panales') : num(v.cantidad) + ' ' + esc(p ? p.unit : '')}</td><td class="num">${money(panal ? v.precioPanal : v.precio)}</td><td class="num">${money(v.total)}</td></tr>`;
  }).join('');
  const linea = (t, v) => (v ? `<div>${t}${esc(v)}</div>` : '');
  const anul = v0.numero ? config.anulados.filter(a => a.numero === v0.numero) : [];
  const notaAnulados = anul.length ? `<p class="doc-nota doc-anulados"><strong>Este comprobante tuvo ${anul.length} ${anul.length === 1 ? 'venta anulada' : 'ventas anuladas'} por ${money(anul.reduce((s, a) => s + a.total, 0))}.</strong></p>` : '';
  return `<article class="doc">
    <header class="doc-head">
      <div class="doc-emisor"><h2>${esc(neg.nombre || 'El Gallinero')}</h2>${linea('NIT / CC: ', neg.nit)}${linea('', neg.direccion)}${linea('', [neg.ciudad, neg.telefono].filter(Boolean).join(' · '))}</div>
      <div class="doc-num"><div class="doc-tipo">COMPROBANTE DE VENTA</div><div class="doc-n">${v0.numero ? 'N° ' + esc(numeroTxt(v0.numero)) : 'Borrador · el número se asigna al imprimir'}</div><div>Fecha: ${verFecha(v0.fecha)}</div></div>
    </header>
    <section class="doc-cliente"><h3>Cliente</h3>
      <div><strong>${esc(c ? c.nombre : 'Consumidor final (mostrador)')}</strong></div>${c ? linea('Cédula / NIT: ', c.documento) + linea('Teléfono: ', c.telefono) + linea('Dirección / notas: ', c.notas) : ''}</section>
    <table class="doc-tabla"><thead><tr><th>Descripción</th><th class="num">Cantidad</th><th class="num">V. unitario</th><th class="num">V. total</th></tr></thead><tbody>${filas}</tbody></table>
    <div class="doc-totales">
      <div><span>Forma de pago</span><strong>${credito ? 'Crédito' : 'Contado'}</strong></div>
      <div><span>Total</span><strong>${money(total)}</strong></div>
      ${credito ? `<div><span>Abonado</span><strong>${money(pagado)}</strong></div><div class="doc-saldo"><span>Saldo pendiente</span><strong>${money(saldo)}</strong></div>` : ''}
    </div>
    <div class="doc-firmas"><div>Entrega</div><div>Recibe</div></div>
    ${notaAnulados}<p class="doc-nota">Comprobante de venta de control interno. No es una factura electrónica de venta ni reemplaza la expedida ante la DIAN.</p>
  </article>`;
}
function comprobantePagoHTML(provId, pagado, detalle) {
  const neg = config.negocio, pv = proveedor(provId), falta = deudaProveedor(provId);
  const filas = detalle.map(d => { const p = prod(d.productoId); return `<tr><td>${verFecha(d.fecha)} · ${esc(p ? p.name : 'Producto eliminado')}</td><td class="num">${money(d.total)}</td><td class="num">${money(d.aplicado)}</td><td class="num">${money(d.resta)}</td></tr>`; }).join('');
  return `<article class="doc">
    <header class="doc-head"><div class="doc-emisor"><h2>${esc(neg.nombre || 'El Gallinero')}</h2>${neg.nit ? `<div>NIT / CC: ${esc(neg.nit)}</div>` : ''}</div>
      <div class="doc-num"><div class="doc-tipo">COMPROBANTE DE PAGO A PROVEEDOR</div><div>Fecha: ${verFecha(hoy())}</div></div></header>
    <section class="doc-cliente"><h3>Proveedor</h3><div><strong>${esc(pv ? pv.nombre : 'Proveedor')}</strong></div>${pv && pv.telefono ? `<div>Teléfono: ${esc(pv.telefono)}</div>` : ''}</section>
    <table class="doc-tabla"><thead><tr><th>Compra</th><th class="num">Valor</th><th class="num">Pagado ahora</th><th class="num">Saldo</th></tr></thead><tbody>${filas}</tbody></table>
    <div class="doc-totales"><div><span>Total pagado</span><strong>${money(pagado)}</strong></div><div class="doc-saldo"><span>Falta por pagar</span><strong>${money(falta)}</strong></div></div>
    <div class="doc-firmas"><div>Paga</div><div>Recibe</div></div>
  </article>`;
}
// Abrir un comprobante NO gasta número: sin número es una vista previa (borrador). El número se asigna al imprimir.
function abrirComprobante(id) {
  const v = ventas.find(x => x.id === id); if (!v) return;
  hoja('Comprobante de venta', `${comprobanteHTML(grupoComprobante(v))}<div class="btn-row no-print"><button class="btn btn-teal" data-act="imprimir-doc" data-id="${esc(v.id)}">Imprimir</button><button class="btn btn-ghost" data-act="cerrar">Cerrar</button></div>`);
}
// Imprime un comprobante de venta: si aún no tiene número se le asigna antes (y si no se puede guardar, no se imprime).
function imprimirComprobante(id) {
  const v = ventas.find(x => x.id === id); if (!v) return;
  if (!v.numero) {
    if (!numerarGrupo(grupoComprobante(v))) return aviso('No se pudo guardar el número del comprobante, así que no se imprimió. Libera espacio e inténtalo de nuevo.', true);
    abrirComprobante(id); repintar(); // ya con su número
  }
  imprimirDocumento();
}
function imprimirDocumento() {
  document.body.classList.add('imprime-doc');
  try { window.print(); }
  catch { document.body.classList.remove('imprime-doc'); aviso('No se pudo abrir la impresión en este navegador', true); }
  finally { setTimeout(() => document.body.classList.remove('imprime-doc'), 1000); } // por si el navegador no avisa al terminar
}

/* =============== Más =============== */
VISTAS.mas = () => `
  ${cabecera('Más')}
  <div class="card menu"><div class="list">
    ${[['productos', 'caja', 'Productos e inventario', 'Existencias, precios y pérdidas'], ['proveedores', 'comprar', 'Proveedores y cuentas por pagar', 'Lo que debes a las fincas'], ['graficos', 'grafico', 'Gráficos de ganancias', 'Cómo van tus ventas y tus ganancias'], ['reportes', 'factura', 'Facturas y reportes', 'Por día, semana, mes o año'], ['respaldo', 'respaldo', 'Respaldo y datos', 'Guardar copia, exportar a Excel'], ['sheets', 'hoja', 'Google Sheets', 'Copia automática en tu hoja de cálculo'], ['ajustes', 'ajustes', 'Ajustes', 'Margen, alerta de stock, vida útil']]
      .map(([v, i, t, s]) => `<button class="row" data-act="ir" data-v="${v}"><span class="ico">${icono(i)}</span><span class="main"><span class="t">${t}</span><br><span class="s">${s}</span></span><span class="chev">&rsaquo;</span></button>`).join('')}
  </div></div>
  <div class="card"><h3>Instalar en el celular</h3>
    <p class="muted"><strong>iPhone:</strong> abre esta página en Safari, toca Compartir y luego «Agregar a pantalla de inicio».<br><strong>Android:</strong> en Chrome, menú ⋮ y «Instalar aplicación».</p></div>`;

/* =============== Productos e inventario =============== */
VISTAS.productos = () => `
  ${cabecera('Productos', 'mas')}
  <div class="btn-row" style="margin:0 0 16px"><button class="btn btn-teal" data-act="prod-nuevo">+ Agregar producto</button><button class="btn btn-wa" data-act="lista-precios">Lista de precios</button></div>
  <div class="card"><div class="list">${products.map(p => {
    let b = ['ok', 'OK']; if (p.stock <= 0) b = ['out', 'Sin stock']; else if (p.stock < config.alerta) b = ['low', 'Bajo'];
    let frescura = '';
    const lote = loteUrgente(p);
    if (lote) { const d = diasRestantes(lote); frescura = ` · ${d > 0 ? (lote.vence ? `vence en ${d} días` : `~${d} días de vida`) : d === 0 ? 'vence hoy' : 'pasado de fecha'}`; }
    return `<div class="row"><div class="main"><div class="t">${esc(p.name)}</div>
      <div class="s"><strong>${num(p.stock)}</strong> ${esc(p.unit)}${panalesTxt(p)} <span class="badge ${b[0]}">${b[1]}</span>${frescura}</div>
      <div class="s">Costo ${p.cost > 0 ? money(p.cost) : '—'} · Venta ${p.price > 0 ? money(p.price) + ' (fijo)' : (precioSugerido(p) ? money(precioSugerido(p)) + ' (sugerido)' : '—')}</div></div>
      <div class="r" style="display:flex;flex-direction:column;gap:6px"><button class="btn btn-sm" data-act="prod-editar" data-id="${esc(p.id)}">Editar</button><button class="btn btn-sm btn-ghost" data-act="perdida" data-id="${esc(p.id)}" ${p.stock > 0 ? '' : 'disabled'}>Pérdida</button></div></div>`;
  }).join('')}</div></div>
  ${ajustes.length ? `<div class="card"><h3>Últimas pérdidas y ajustes</h3><div class="list">${ajustes.slice().sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id).slice(0, 8).map(a => { const p = prod(a.productoId); return `<div class="row"><div class="main"><div class="t">−${num(a.cantidad)} ${esc(p ? p.name : 'Producto eliminado')}</div><div class="s">${verFecha(a.fecha)}${a.motivo ? ' · ' + esc(a.motivo) : ''}</div></div><div class="r"><button class="link-btn" data-act="ajuste-anular" data-id="${esc(a.id)}">Anular</button></div></div>`; }).join('')}</div></div>` : ''}`;

function formProducto(p) {
  hoja(p ? 'Editar producto' : 'Nuevo producto', `
    <form id="f-prod" novalidate>
      <label class="field"><span>Nombre</span><input id="pr-nombre" type="text" value="${esc(p ? p.name : '')}" autocomplete="off"></label>
      <div class="row2">
        <label class="field"><span>Unidad</span><input id="pr-unidad" type="text" value="${esc(p ? p.unit : 'unidades')}"></label>
        <label class="field"><span>Precio de venta fijo</span><input id="pr-precio" type="number" inputmode="decimal" min="0" step="any" value="${p && p.price > 0 ? esc(p.price) : ''}" placeholder="Opcional"></label>
      </div>
      <label class="field"><span>Control de frescura</span><select id="pr-control">
        ${[['granja', 'Huevo fresco: días en la granja'], ['vencimiento', 'Empacado: fecha de vencimiento'], ['ninguno', 'Sin control']].map(([v, t]) => `<option value="${v}" ${(p ? p.control : 'ninguno') === v ? 'selected' : ''}>${t}</option>`).join('')}
      </select><div class="hint">Cambia lo que se pide al registrar una compra de este producto.</div></label>
      <label class="field" id="pr-b-panal" ${(p ? p.control : 'ninguno') === 'granja' ? '' : 'hidden'}><span>Unidades por panal</span><input id="pr-panal" type="number" inputmode="numeric" min="0" max="1000" step="1" value="${esc(p ? p.panal : 30)}"><div class="hint">Permite vender por panal. Pon 0 si este producto no se vende así.</div></label>
      <button class="btn btn-teal" type="submit">Guardar</button>
      ${p ? '<div class="btn-row"><button class="btn btn-ghost" type="button" id="pr-del">Eliminar producto</button></div>' : ''}
    </form>`, b => {
    $('#f-prod', b).addEventListener('submit', e => {
      e.preventDefault();
      const name = $('#pr-nombre', b).value.trim();
      if (!name) return aviso('Escribe el nombre', true);
      const precioTxt = $('#pr-precio', b).value;
      const price = String(precioTxt).trim() === '' ? 0 : leerNum(precioTxt);
      if (!enRango(price)) return aviso('El precio de venta no es válido', true);
      const control = $('#pr-control', b).value;
      const panal = control === 'granja' ? leerNum($('#pr-panal', b).value) : 0;
      if (!(Number.isInteger(panal) && panal >= 0 && panal <= 1000)) return aviso('Las unidades por panal deben ser un entero entre 0 y 1000', true);
      const dato = { name, unit: $('#pr-unidad', b).value.trim() || 'unidades', price, control, panal };
      aplicar(() => { if (p) Object.assign(p, dato); else products.push({ id: 'p' + nuevoId(), cost: 0, stock: 0, lastCost: 0, ...dato }); }, 'Producto guardado');
      cerrarHoja(); repintar();
    });
    $('#pr-control', b).addEventListener('change', e => { $('#pr-b-panal', b).hidden = e.target.value !== 'granja'; });
    const del = $('#pr-del', b);
    if (del) del.addEventListener('click', () => {
      const uso = ventas.some(v => v.productoId === p.id) || entradas.some(x => x.productoId === p.id) || ajustes.some(x => x.productoId === p.id);
      if (uso || p.stock > 0) return aviso('Tiene movimientos o existencias: no se puede eliminar', true);
      aplicar(() => { products = products.filter(x => x.id !== p.id); }, 'Producto eliminado'); cerrarHoja(); repintar();
    });
  });
}

/* Texto listo para pegar en WhatsApp Business (estado, respuesta rápida o lo que el asistente de IA del negocio necesite saber). */
function textoListaPrecios() {
  const items = products.filter(p => p.stock > 0 && (p.price > 0 || precioSugerido(p) > 0));
  if (!items.length) return '';
  const fecha = new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'long' }).replace(/ De /g, ' de ');
  return `*El Gallinero · frescura y calidad*\nPrecios del ${fecha}:\n\n` + items.map(p => { const u = p.price > 0 ? p.price : precioSugerido(p); return p.panal > 0 ? `• ${p.name}: ${money(u * p.panal)} el panal de ${p.panal} (${money(u)} c/u)` : `• ${p.name}: ${money(u)} por ${p.unit.replace(/s$/, '')}`; }).join('\n') + '\n\nEscríbenos para tu pedido.';
}
function listaPrecios() {
  const texto = textoListaPrecios();
  hoja('Lista de precios', texto ? `
    <p class="muted" style="margin-bottom:10px">Solo productos con existencias. Usa el precio fijo o el sugerido. Puedes editar el texto antes de enviarlo.</p>
    <label class="field"><span>Mensaje</span><textarea id="lp-texto" rows="9">${esc(texto)}</textarea></label>
    <div class="btn-row"><button class="btn btn-ghost" data-act="lp-copiar">Copiar</button><button class="btn btn-wa" data-act="lp-wa">Enviar por WhatsApp</button></div>`
    : '<p class="empty">No hay productos con existencias y precio. Registra una compra o fija un precio de venta.</p>');
}

function formPerdida(p) {
  hoja(`Pérdida · ${p.name}`, `
    <form id="f-per" novalidate>
      <p class="muted" style="margin-bottom:12px">Hay ${num(p.stock)} ${esc(p.unit)} en bodega.</p>
      <label class="field"><span>Cantidad que se pierde</span><input id="pe-cant" type="number" inputmode="numeric" min="1" max="${esc(p.stock)}" step="1"></label>
      <label class="field"><span>Motivo</span><input id="pe-motivo" type="text" placeholder="Huevos rotos, vencidos, regalo…"></label>
      <button class="btn btn-danger" type="submit">Registrar pérdida</button>
    </form>`, b => $('#f-per', b).addEventListener('submit', e => {
    e.preventDefault();
    const cant = leerNum($('#pe-cant', b).value);
    if (!(Number.isInteger(cant) && enRango(cant, 1))) return aviso('Escribe la cantidad (un número entero)', true);
    if (cant > p.stock) return aviso('No hay tanto en bodega', true);
    const motivo = $('#pe-motivo', b).value.trim();
    aplicar(() => {
      p.stock -= cant;
      ajustes.push({ id: nuevoId(), productoId: p.id, cantidad: cant, costoUnitario: p.cost || 0, fecha: hoy(), motivo });
    }, `Se restaron ${num(cant)} de ${p.name}`);
    cerrarHoja(); repintar();
  }));
}

/* =============== Reportes =============== */
let periodo = 'semana', refFecha = hoy();
VISTAS.reportes = () => {
  const r = rangoPeriodo(periodo, refFecha);
  const en = f => f >= r.ini && f <= r.fin;
  const ent = entradas.filter(e => en(e.fecha)), ven = ventas.filter(v => en(v.fecha)), per = ajustes.filter(a => en(a.fecha));
  const totCompras = ent.reduce((s, e) => s + e.total, 0), totVentas = ven.reduce((s, v) => s + v.total, 0);
  const gan = totVentas - ven.reduce((s, v) => s + costoVenta(v), 0);
  const totPer = per.reduce((s, a) => s + a.cantidad * (a.costoUnitario || 0), 0);
  const porCobrar = ven.reduce((s, v) => s + (v.clienteId ? debeVenta(v) : 0), 0);
  const porPagar = ent.reduce((s, e) => s + (e.proveedorId ? debeEntrada(e) : 0), 0);
  const agrupar = (arr, f) => { const m = new Map(); arr.forEach(x => { const o = m.get(x.productoId) || { c: 0, t: 0, k: 0 }; f(o, x); m.set(x.productoId, o); }); return [...m.entries()]; };
  const nombre = id => { const p = prod(id); return esc(p ? p.name : 'Producto eliminado'); };
  const gEnt = agrupar(ent, (o, e) => { o.c += e.cantidad; o.t += e.total; });
  const gVen = agrupar(ven, (o, v) => { o.c += v.cantidad; o.t += v.total; o.k += costoVenta(v); });
  const gPer = agrupar(per, (o, a) => { o.c += a.cantidad; o.t += a.cantidad * (a.costoUnitario || 0); });
  const tabla = (cab, filas, pie) => `<table class="tbl"><thead><tr>${cab.map((c, i) => `<th class="${i ? 'num' : ''}">${c}</th>`).join('')}</tr></thead><tbody>${filas.join('')}<tr class="total">${pie.map((c, i) => `<td class="${i ? 'num' : ''}">${c}</td>`).join('')}</tr></tbody></table>`;
  return `
    ${cabecera('Facturas', 'mas')}
    <div class="tabs no-print" role="tablist">${[['dia', 'Día'], ['semana', 'Semana'], ['mes', 'Mes'], ['anio', 'Año']].map(([k, t]) => `<button role="tab" aria-selected="${k === periodo}" class="${k === periodo ? 'on' : ''}" data-act="periodo" data-p="${k}">${t}</button>`).join('')}</div>
    <div class="period-nav no-print"><button class="icon-btn" data-act="ref" data-d="-1" aria-label="Anterior">&lsaquo;</button><div class="lbl">${esc(r.etiqueta)}</div><button class="icon-btn" data-act="ref" data-d="1" aria-label="Siguiente">&rsaquo;</button></div>
    <section class="card ticket"><h3>El Gallinero · ${esc(r.etiqueta)}</h3>
      <div class="stats" style="margin-bottom:16px">
        <div class="stat sun"><div class="n">${money(totVentas)}</div><div class="l">Vendido</div></div>
        <div class="stat teal"><div class="n ${gan < 0 ? 'neg' : ''}">${money(gan)}</div><div class="l">Ganancia bruta</div></div>
        <div class="stat"><div class="n">${money(totCompras)}</div><div class="l">Compras del período</div></div>
        <div class="stat ${porCobrar > 0 ? 'red' : ''}"><div class="n">${money(porCobrar)}</div><div class="l">Quedó por cobrar</div></div>
        <div class="stat ${porPagar > 0 ? 'red' : ''}"><div class="n">${money(porPagar)}</div><div class="l">Quedó por pagar</div></div>
      </div>
      <div class="sec-title">Ventas</div>${gVen.length ? tabla(['Producto', 'Cant.', 'Total', 'Ganancia'], gVen.map(([id, o]) => `<tr><td>${nombre(id)}</td><td class="num">${num(o.c)}</td><td class="num">${money(o.t)}</td><td class="num ${o.t - o.k < 0 ? 'neg' : ''}">${money(o.t - o.k)}</td></tr>`), ['Total', num(gVen.reduce((s, [, o]) => s + o.c, 0)), money(totVentas), money(gan)]) : '<p class="empty">Sin ventas en este período.</p>'}
      <div class="sec-title" style="margin-top:18px">Compras y llegadas</div>${gEnt.length ? tabla(['Producto', 'Cant.', 'Valor'], gEnt.map(([id, o]) => `<tr><td>${nombre(id)}</td><td class="num">${num(o.c)}</td><td class="num">${money(o.t)}</td></tr>`), ['Total', num(gEnt.reduce((s, [, o]) => s + o.c, 0)), money(totCompras)]) : '<p class="empty">Sin compras en este período.</p>'}
      ${gPer.length ? `<div class="sec-title" style="margin-top:18px">Pérdidas</div>${tabla(['Producto', 'Cant.', 'Costo'], gPer.map(([id, o]) => `<tr><td>${nombre(id)}</td><td class="num">${num(o.c)}</td><td class="num">${money(o.t)}</td></tr>`), ['Total', num(gPer.reduce((s, [, o]) => s + o.c, 0)), money(totPer)])}` : ''}
    </section>
    <div class="btn-row no-print"><button class="btn btn-ghost" data-act="imprimir">Imprimir / PDF</button><button class="btn btn-ghost" data-act="csv">Exportar a Excel</button></div>`;
};

/* =============== Respaldo, exportación y ajustes =============== */
// Un texto que empieza por = + - @ (tab o CR) se interpretaría como fórmula al abrir el CSV: se neutraliza. Los números reales no se tocan.
function csvCelda(v) { let s = String(v ?? ''); if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; }
function csvTodo() {
  const f = [['Tipo', 'Fecha', 'Producto', 'Cantidad', 'Precio o costo', 'Total', 'Cliente', 'Pago', 'Notas']];
  ventas.forEach(v => { const p = prod(v.productoId), c = cliente(v.clienteId); f.push(['Venta', v.fecha, p ? p.name : '', v.cantidad, v.precio, v.total, c ? c.nombre : '', v.tipoPago, v.tipoPago === 'credito' ? `Abonado ${v.pagado || 0}` : '']); });
  entradas.forEach(e => { const p = prod(e.productoId); f.push(['Entrada', e.fecha, p ? p.name : '', e.cantidad, e.costoUnitario, e.total, '', '', e.notas || '']); });
  ajustes.forEach(a => { const p = prod(a.productoId); f.push(['Pérdida', a.fecha, p ? p.name : '', a.cantidad, a.costoUnitario || 0, a.cantidad * (a.costoUnitario || 0), '', '', a.motivo || '']); });
  // BOM para que Excel respete las tildes; «;» porque Excel en español lo usa como separador.
  return '﻿' + f.map(r => r.map(csvCelda).join(';')).join('\r\n');
}
async function entregarArchivo(nombre, contenido, tipo) {
  const blob = new Blob([contenido], { type: tipo });
  try {
    const file = new File([blob], nombre, { type: tipo });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: nombre }); return true; }
  } catch (e) { if (e && e.name === 'AbortError') return false; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return true;
}
async function exportarJSON() {
  const datos = { app: 'el-gallinero', version: SCHEMA, exportado: new Date().toISOString(), ...estado() };
  if (await entregarArchivo(`el-gallinero-respaldo-${hoy()}.json`, JSON.stringify(datos), 'application/json')) { aplicar(() => { config.ultimoRespaldo = hoy(); }, 'Respaldo listo'); if (vistaActual === 'respaldo') repintar(); }
}
// Valida TODO antes de tocar nada; guarda el estado previo en eg_prev; recién entonces reemplaza.
async function restaurarTexto(texto) {
  let d;
  try { d = JSON.parse(texto); } catch { return aviso('El archivo no es un respaldo válido', true); }
  if (!d || d.app !== 'el-gallinero' || !Array.isArray(d.products) || !Array.isArray(d.ventas) || !Array.isArray(d.entradas) || !Array.isArray(d.clientes)) return aviso('El archivo no es un respaldo de El Gallinero', true);
  if (Number.isFinite(d.version) && d.version > SCHEMA) return aviso('Este respaldo viene de una versión más nueva de la app: actualiza la app para poder restaurarlo.', true);
  const { datos, errores, recuperados } = limpiar(d);
  if (errores.length) return aviso(`El respaldo tiene ${errores.length} registro(s) con datos inválidos (${errores.slice(0, 3).join(', ')}). No se restauró nada.`, true);
  migrar(datos);
  if (!(await confirmar({ titulo: 'Restaurar respaldo', texto: `Se reemplazarán TODOS los datos de este teléfono por los del respaldo (${datos.ventas.length} ventas, ${datos.clientes.length} clientes). ¿Continuar?`, ok: 'Restaurar', peligro: true }))) return;
  try { localStorage.setItem(CLAVE_PREV, JSON.stringify(estado())); } catch { return aviso('No hay espacio para guardar una copia de lo actual. No se restauró nada.', true); }
  const ok = aplicar(() => poner(datos), recuperados ? `Datos restaurados. Se recuperaron ${recuperados} proveedor(es) sin nombre: ponles nombre en Proveedores.` : 'Datos restaurados');
  repintar();
  return ok;
}
function importarJSON(archivo) {
  const lector = new FileReader();
  lector.onload = () => restaurarTexto(lector.result);
  lector.readAsText(archivo);
}

VISTAS.respaldo = () => `
  ${cabecera('Respaldo y datos', 'mas')}
  <div class="card"><h3>Copia de seguridad</h3>
    ${sync && sync.listo
      ? `<p class="muted" style="margin-bottom:12px">Tus datos se copian automáticamente a tu Google Sheet, y desde ahí se pueden restaurar si pierdes el celular. Aun así, guarda un respaldo de vez en cuando.</p>
         <button class="btn btn-sm btn-ghost" data-act="ir" data-v="sheets" style="margin-bottom:14px">Ver Google Sheets</button>`
      : `<p class="muted" style="margin-bottom:12px">Los datos están solo en este teléfono. Si borras el navegador o pierdes el celular, se pierden. Conecta un Google Sheet para que se copien solos, o guarda una copia seguido y envíatela por WhatsApp o correo.</p>
         <button class="btn btn-sm btn-ghost" data-act="ir" data-v="sheets" style="margin-bottom:14px">Conectar Google Sheets</button>`}
    <p style="margin-bottom:12px" id="almacen-estado"><strong>Almacenamiento:</strong> comprobando…</p>
    <p style="margin-bottom:12px"><strong>Último respaldo:</strong> ${config.ultimoRespaldo ? verFecha(config.ultimoRespaldo) : 'nunca'}</p>
    <button class="btn btn-teal" data-act="json-export">Guardar respaldo</button>
    <div class="btn-row"><button class="btn btn-ghost" data-act="json-import">Restaurar desde un respaldo</button></div>
    <input type="file" id="archivo-json" accept="application/json,.json" hidden></div>
  <div class="card"><h3>Excel</h3><p class="muted" style="margin-bottom:12px">Todas las ventas, entradas y pérdidas en un archivo .csv.</p><button class="btn btn-ghost" data-act="csv">Exportar a Excel</button></div>
  <div class="card"><h3>Empezar de cero</h3><p class="muted" style="margin-bottom:12px">Borra productos, ventas, clientes y entradas. No se puede deshacer: haz un respaldo antes.</p><button class="btn btn-danger" data-act="borrar-todo">Borrar todos los datos</button></div>`;
MONTAR.respaldo = () => {
  const est = $('#almacen-estado');
  if (est) {
    const p = navigator.storage && navigator.storage.persisted ? navigator.storage.persisted() : Promise.resolve(false);
    p.then(ok => { est.innerHTML = ok ? '<strong>Almacenamiento:</strong> protegido (el navegador no lo borra solo).' : '<strong>Almacenamiento:</strong> normal. Instala la app y haz respaldos seguido.'; }).catch(() => {});
  }
  $('#archivo-json').addEventListener('change', e => { if (e.target.files[0]) importarJSON(e.target.files[0]); e.target.value = ''; }); };

VISTAS.ajustes = () => `
  ${cabecera('Ajustes', 'mas')}
  <form id="f-aj" class="card" novalidate>
    <label class="field"><span>Margen de ganancia sugerido (%)</span><input id="aj-margen" type="number" inputmode="decimal" min="0" max="500" value="${esc(config.margen)}"><div class="hint">Con esto se calcula el precio de venta sugerido a partir del costo.</div></label>
    <label class="field"><span>Avisar de stock bajo (unidades)</span><input id="aj-alerta" type="number" inputmode="numeric" min="0" value="${esc(config.alerta)}"></label>
    <label class="field"><span>Vida útil del huevo (días)</span><input id="aj-vida" type="number" inputmode="numeric" min="7" max="60" value="${esc(config.vidaUtil)}"><div class="hint">Contada desde que sale de la granja. En clima cálido, entre 15 y 25 días.</div></label>
    <button class="btn btn-teal" type="submit">Guardar ajustes</button>
  </form>
  <form id="f-neg" class="card" novalidate>
    <h3>Datos del negocio</h3>
    <p class="muted" style="margin-bottom:12px">Salen en el encabezado del comprobante de venta.</p>
    <label class="field"><span>Nombre o razón social</span><input id="ng-nombre" type="text" value="${esc(config.negocio.nombre)}" autocomplete="off"></label>
    <label class="field"><span>NIT o cédula</span><input id="ng-nit" type="text" value="${esc(config.negocio.nit)}" autocomplete="off"></label>
    <label class="field"><span>Dirección</span><input id="ng-dir" type="text" value="${esc(config.negocio.direccion)}" autocomplete="off"></label>
    <div class="row2">
      <label class="field"><span>Ciudad</span><input id="ng-ciudad" type="text" value="${esc(config.negocio.ciudad)}" autocomplete="off"></label>
      <label class="field"><span>Teléfono</span><input id="ng-tel" type="tel" inputmode="tel" value="${esc(config.negocio.telefono)}"></label>
    </div>
    <div class="row2">
      <label class="field"><span>Prefijo</span><input id="ng-prefijo" type="text" maxlength="6" value="${esc(config.negocio.prefijo)}" autocomplete="off"><div class="hint">Hasta 6 letras o números. Ej: CV</div></label>
      <label class="field"><span>Próximo número</span><input id="ng-consec" type="number" inputmode="numeric" min="${esc(mayorNumero() + 1)}" step="1" value="${esc(config.consecutivo)}"><div class="hint">Para seguir tu propia numeración. No puede ser menor a lo ya emitido.</div></label>
    </div>
    <button class="btn btn-teal" type="submit">Guardar datos del negocio</button>
  </form>
  <p class="muted" style="margin-top:12px">Versión de la app: <span id="aj-version">—</span></p>`;
MONTAR.ajustes = () => {
  if (typeof caches !== 'undefined' && caches && caches.keys) caches.keys().then(ks => { $('#aj-version').textContent = ks.find(k => k.startsWith('el-gallinero-')) || 'sin caché'; }).catch(() => {});
  $('#f-aj').addEventListener('submit', e => {
    e.preventDefault();
    const m = leerNum($('#aj-margen').value), a = leerNum($('#aj-alerta').value), v = leerNum($('#aj-vida').value);
    if (!(enRango(m) && m <= 500) || !(Number.isInteger(a) && enRango(a)) || !(Number.isInteger(v) && v >= 1 && v <= 365)) return aviso('Revisa los valores', true);
    aplicar(() => { config.margen = m; config.alerta = a; config.vidaUtil = v; }, 'Ajustes guardados');
  });
  $('#f-neg').addEventListener('submit', e => {
    e.preventDefault();
    const prefijo = $('#ng-prefijo').value.trim(), consec = leerNum($('#ng-consec').value);
    if (!/^[A-Za-z0-9]{0,6}$/.test(prefijo)) return aviso('El prefijo solo admite hasta 6 letras o números', true);
    if (!(Number.isInteger(consec) && consec >= 1 && consec <= MAX_NUMERO)) return aviso('El próximo número debe ser un entero desde 1', true);
    const minimo = mayorNumero() + 1;
    if (consec < minimo) return aviso(`Ya se emitió el comprobante ${numeroTxt(minimo - 1)}: el próximo número debe ser ${minimo} o más (mínimo ${minimo}).`, true);
    const t = (id, max) => $(id).value.trim().slice(0, max);
    aplicar(() => { config.negocio = { nombre: t('#ng-nombre', 100) || 'El Gallinero', nit: t('#ng-nit', 30), direccion: t('#ng-dir', 150), telefono: t('#ng-tel', 30), ciudad: t('#ng-ciudad', 60), prefijo: prefijo.toUpperCase() }; config.consecutivo = consec; }, 'Datos del negocio guardados');
  });
};

/* =============== Sincronización con Google Sheets =============== */
/* El teléfono es la fuente de los datos; el Sheet es un espejo (y sirve para restaurar). Cada envío REEMPLAZA el
   contenido del Sheet con el estado completo, así que enviar varias veces nunca duplica filas.
   El script que recibe los datos vive en apps-script/Code.gs; el enlace y la clave se guardan aparte de los datos
   (clave eg_sync) para que no viajen dentro de los respaldos. */
const CLAVE_SYNC = 'eg_sync';
// Solo se envían datos a una aplicación web de Google Apps Script: nunca a otro dominio.
const URL_SCRIPT_RE = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;
function leerSync() {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE_SYNC));
    if (!v || typeof v !== 'object' || !URL_SCRIPT_RE.test(v.url || '') || typeof v.clave !== 'string' || !v.clave) return null;
    return { url: v.url, clave: v.clave, listo: v.listo === true, pendiente: !!v.pendiente, ultimo: typeof v.ultimo === 'string' ? v.ultimo : null, error: typeof v.error === 'string' ? v.error : '' };
  } catch { return null; }
}
function guardarSync() {
  try { if (sync) localStorage.setItem(CLAVE_SYNC, JSON.stringify(sync)); else localStorage.removeItem(CLAVE_SYNC); } catch { /* sin espacio: el envío sigue funcionando */ }
}
const tieneDatos = () => ventas.length + entradas.length + clientes.length + ajustes.length > 0 || products.some(p => p.stock > 0 || p.cost > 0 || p.price > 0);
function mensajeSync(e) {
  const m = String((e && e.message) || e);
  if (m === 'timeout') return 'tardó demasiado en responder';
  if (/failed to fetch|networkerror|load failed/i.test(m)) return 'no hay conexión, o el enlace no está publicado para «Cualquier persona»';
  return m;
}
function llamarSheet(cuerpo, ms = 30000) {
  let t;
  // text/plain evita la verificación previa (CORS preflight), que Apps Script no responde.
  const envio = fetch(sync.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ clave: sync.clave, ...cuerpo }) }).then(r => r.json());
  const limite = new Promise((_, rechazar) => { t = setTimeout(() => rechazar(new Error('timeout')), ms); });
  return Promise.race([envio, limite]).finally(() => clearTimeout(t)).then(j => {
    if (!j || !j.ok) throw new Error((j && j.error) || 'respuesta no válida del script');
    return j;
  });
}
function pintarEstadoSync() {
  const el = $('#sync-estado');
  if (!el || !sync) return;
  el.textContent = syncEnCurso ? 'Enviando…'
    : sync.error ? `No se pudo enviar (${sync.error}). Se reintentará solo.`
    : sync.pendiente ? 'Hay cambios pendientes de enviar.'
    : sync.ultimo ? `Al día · último envío ${new Date(sync.ultimo).toLocaleString('es-CO')}` : 'Todavía no se ha enviado nada.';
}
// Tras cada guardado se espera unos segundos (por si siguen más cambios) y se envía todo junto.
function programarSync() {
  try {
    if (!sync || !sync.listo) return;
    sync.pendiente = true; guardarSync();
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { enviarSheet(false); }, 4000);
  } catch { /* la sincronización nunca debe impedir guardar */ }
}
async function enviarSheet(manual) {
  if (!sync) return false;
  if (syncEnCurso) { if (!manual) programarSync(); return false; }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { if (manual) aviso('Sin internet: se enviará al volver la conexión', true); return false; }
  syncEnCurso = true; pintarEstadoSync();
  try {
    await llamarSheet({ accion: 'guardar', datos: { app: 'el-gallinero', version: SCHEMA, exportado: new Date().toISOString(), ...estado() } });
    sync.ultimo = new Date().toISOString(); sync.pendiente = false; sync.error = ''; guardarSync();
    if (manual) aviso('Enviado a Google Sheets');
    return true;
  } catch (e) {
    sync.pendiente = true; sync.error = mensajeSync(e); guardarSync();
    if (manual) aviso('No se pudo enviar: ' + sync.error, true);
    else { clearTimeout(syncTimer); syncTimer = setTimeout(() => { enviarSheet(false); }, 60000); }
    return false;
  } finally { syncEnCurso = false; pintarEstadoSync(); }
}
async function traerDelSheet() {
  if (!sync) return false;
  let j;
  try { j = await llamarSheet({ accion: 'leer' }); } catch (e) { aviso('No se pudo leer el Sheet: ' + mensajeSync(e), true); return false; }
  return !!(await restaurarTexto(j.texto));
}
// Diálogo con varias opciones (confirmar() solo admite sí/no).
function elegir(titulo, texto, opciones) {
  return new Promise(res => {
    hoja(titulo, `<p class="sheet-text">${esc(texto)}</p><div class="btn-row" style="flex-direction:column">${opciones.map((o, i) => `<button class="btn ${o.cls || ''}" data-i="${i}">${esc(o.t)}</button>`).join('')}</div>`,
      b => b.addEventListener('click', e => { const x = e.target.closest('[data-i]'); if (x) { cerrarHoja(); res(opciones[Number(x.dataset.i)].v); } }));
  });
}
async function conectarSheet(url, clave) {
  url = String(url).trim(); clave = String(clave).trim();
  if (!URL_SCRIPT_RE.test(url)) return aviso('El enlace debe ser el de la aplicación web de Google (script.google.com/macros/s/…/exec)', true);
  if (clave.length < 4) return aviso('Escribe la clave que pusiste dentro del script', true);
  const anterior = sync;
  sync = { url, clave, listo: false, pendiente: false, ultimo: null, error: '' };
  let info;
  try { info = await llamarSheet({ accion: 'ping' }); } catch (e) { sync = anterior; return aviso('No se pudo conectar: ' + mensajeSync(e), true); }
  let decision = 'enviar';
  if (info.tieneDatos) {
    const cuando = info.actualizado ? `, actualizado ${new Date(info.actualizado).toLocaleString('es-CO')}` : '';
    const resumen = `El Sheet ya tiene datos (${info.ventas || 0} ventas, ${info.clientes || 0} clientes${cuando}).`;
    decision = !tieneDatos() ? 'restaurar'
      : await elegir('El Sheet ya tiene datos', `${resumen} Este teléfono también tiene datos. ¿Cuáles conservas? Lo que no elijas no se borra del todo: el Sheet guarda una copia anterior y el teléfono, una en eg_prev.`,
        [{ v: 'restaurar', t: 'Usar los del Sheet' }, { v: 'enviar', t: 'Usar los de este teléfono', cls: 'btn-ghost' }, { v: 'cancelar', t: 'Cancelar', cls: 'btn-ghost' }]);
    if (decision === 'cancelar') { sync = anterior; return; }
  }
  if (decision === 'restaurar' && !(await traerDelSheet())) { sync = anterior; return; }
  sync.listo = true; guardarSync();
  if (decision === 'enviar') await enviarSheet(true);
  else { sync.ultimo = new Date().toISOString(); guardarSync(); aviso('Conectado y restaurado desde Google Sheets'); }
  if (vistaActual === 'sheets') repintar();
}

/* ---- Clientes que llegan desde el Sheet ----
   La pestaña «Importar clientes» es de entrada: el dueño pega ahí sus contactos (por ejemplo, exportados de la agenda
   donde WhatsApp los guarda) y la app los trae SIN duplicar: un cliente es el mismo si coincide el teléfono (últimos 10
   dígitos) o, si no hay teléfono, el nombre sin tildes ni mayúsculas. Nunca se borra ni se pisa un dato ya escrito. */
const sinTildes = t => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
// Una celda con error de fórmula (#ERROR!, #REF!, #N/A…) se trata como vacía.
const ERROR_HOJA = /^#(ERROR|REF|N\/A|VALUE|NAME|DIV\/0|NUM|NULL)[!?]?/i;
const limpioHoja = t => { const s = String(t ?? '').trim(); return ERROR_HOJA.test(s) ? '' : s; };
// Teléfono tal como se guarda: vacío si la celda es un error o una notación científica (3.0E+11, un número que la hoja deformó).
const telefonoHoja = t => { const s = limpioHoja(t); return /E\+\d+$/i.test(s) ? '' : s; };
// Clave de comparación: se corta lo que sigue a una extensión o a otro número, y se normaliza el prefijo de país.
// Números locales (7 a 10 dígitos): tal cual. +57 (12 dígitos) equivale al local. Otro prefijo (+1…) conserva todos los dígitos: no se confunde con uno colombiano.
const claveTel = t => {
  const texto = telefonoHoja(t);
  if (!texto) return '';
  let d = texto.split(/ext|x|#|\/|;|,/i)[0].replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 12 && d.startsWith('57')) d = d.slice(2);
  return d.length >= 7 && d.length <= 12 ? d : '';
};
function combinarClientes(actuales, filas) {
  const lista = actuales.map(c => ({ ...c }));
  const r = { agregados: 0, actualizados: 0, iguales: 0, omitidos: 0, ambiguos: 0 };
  const porTel = new Map(), porNombre = new Map(), ids = new Set(lista.map(c => c.id));
  const indexar = c => {
    const t = claveTel(c.telefono); if (t) porTel.set(t, c);
    const k = sinTildes(String(c.nombre ?? '')), g = porNombre.get(k) || [];
    if (!g.includes(c)) g.push(c);
    porNombre.set(k, g);
  };
  const idNuevo = () => { let id; do { id = 'c' + nuevoId(); } while (ids.has(id)); ids.add(id); return id; }; // nuevoId puede repetirse dentro del mismo milisegundo
  lista.forEach(indexar);
  for (const f of filas) {
    const nombre = Array.isArray(f) ? limpioHoja(f[0]).slice(0, 100) : '';
    if (!nombre) { r.omitidos++; continue; }
    const telefono = telefonoHoja(f[1]).slice(0, 30), notas = limpioHoja(f[2]).slice(0, 300);
    const t = claveTel(telefono);
    let ex = t ? porTel.get(t) : null;
    if (!ex) {
      // Mismo teléfono = mismo cliente. Mismo nombre solo si alguno de los dos no tiene teléfono (dos «Juan» con teléfonos distintos son personas distintas).
      const mismos = porNombre.get(sinTildes(nombre)) || [];
      const candidatos = t ? mismos.filter(c => !claveTel(c.telefono)) : mismos;
      if (candidatos.length > 1) { r.ambiguos++; continue; } // no se adivina a quién pertenece: no se toca nada
      ex = candidatos[0] || null;
    }
    if (ex) {
      let cambio = false;
      if (!ex.telefono && telefono) { ex.telefono = telefono; cambio = true; }
      if (!ex.notas && notas) { ex.notas = notas; cambio = true; }
      indexar(ex);
      if (cambio) r.actualizados++; else r.iguales++;
    } else { const c = { id: idNuevo(), nombre, telefono, notas }; lista.push(c); indexar(c); r.agregados++; }
  }
  return { lista, ...r };
}
async function traerClientesDelSheet() {
  if (!sync || !sync.listo) return;
  let j;
  try { j = await llamarSheet({ accion: 'clientes' }); } catch (e) {
    if (/acci[oó]n desconocida/i.test(String((e && e.message) || e))) return aviso('Tu script es de una versión anterior: actualízalo (Implementar → Administrar implementaciones → Editar → Nueva versión)', true);
    return aviso('No se pudieron leer los clientes: ' + mensajeSync(e), true);
  }
  if (!j || !Array.isArray(j.filas)) return aviso('Respuesta no válida del script', true);
  const r = combinarClientes(clientes, j.filas);
  const extra = (r.omitidos ? ` (${r.omitidos} fila(s) sin nombre se ignoraron)` : '')
    + (r.ambiguos ? ` ${r.ambiguos} fila(s) ambiguo(s) no se tocaron: varios clientes tienen ese nombre.` : '')
    + (j.truncado ? ` Solo se leyeron las primeras ${j.max || j.filas.length} filas: el resto no se trajo.` : '');
  if (!r.agregados && !r.actualizados) return aviso(`Sin cambios: ${r.iguales} cliente(s) ya estaban${extra}`);
  if (!(await confirmar({ titulo: 'Traer clientes del Sheet', texto: `Se agregarán ${r.agregados} cliente(s) nuevo(s) y se completarán los datos de ${r.actualizados}. ${r.iguales} ya estaban y no se duplican${extra}.`, ok: 'Traer clientes' }))) return;
  if (aplicar(() => { clientes = r.lista; }, `Clientes: ${r.agregados} nuevos, ${r.actualizados} actualizados`)) repintar();
}

VISTAS.sheets = () => `
  ${cabecera('Google Sheets', 'mas')}
  ${sync && sync.listo ? `
  <div class="card"><h3>Conectado</h3>
    <p class="muted" style="margin-bottom:12px" id="sync-estado"></p>
    <p class="muted" style="margin-bottom:12px">Enlace: ${esc(sync.url.slice(0, 46))}…</p>
    <button class="btn btn-teal" data-act="sheets-enviar">Enviar ahora</button>
    <div class="btn-row"><button class="btn btn-ghost" data-act="sheets-clientes">Traer clientes del Sheet</button></div>
    <div class="btn-row"><button class="btn btn-ghost" data-act="sheets-restaurar">Restaurar desde el Sheet</button></div>
    <div class="btn-row"><button class="btn btn-ghost" data-act="sheets-desconectar">Desconectar</button></div>
  </div>` : `
  <form id="f-sh" class="card" novalidate>
    <h3>Conectar una hoja de cálculo</h3>
    <p class="muted" style="margin-bottom:14px">Cada venta, compra y cliente se copia automáticamente a tu Google Sheet, y puedes restaurar todo desde ahí si cambias de celular.</p>
    <label class="field"><span>Enlace de la aplicación web</span><input id="sh-url" type="url" inputmode="url" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off"></label>
    <label class="field"><span>Clave</span><input id="sh-clave" type="password" autocomplete="off"><div class="hint">La misma que escribiste dentro del script.</div></label>
    <button class="btn btn-teal" type="submit">Conectar</button>
    <div class="btn-row"><button type="button" class="btn btn-ghost" data-act="sheets-ayuda">¿Cómo lo preparo?</button><button type="button" class="btn btn-ghost" data-act="sheets-script">Copiar el script</button></div>
  </form>`}`;
MONTAR.sheets = () => {
  pintarEstadoSync();
  const f = $('#f-sh');
  if (f) f.addEventListener('submit', e => { e.preventDefault(); conectarSheet($('#sh-url').value, $('#sh-clave').value); });
};

/* =============== Acciones (clics) =============== */
/* Costo promedio de un producto reproduciendo sus entradas en orden (fecha, id). */
function recalcularCosto(p, lista) {
  const ls = lista.filter(x => x.productoId === p.id).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id);
  let st = 0, costo = 0;
  for (const x of ls) { const nuevo = st + x.cantidad; costo = nuevo > 0 ? Math.round(((st * costo) + (x.cantidad * x.costoUnitario)) / nuevo * 10000) / 10000 : x.costoUnitario; st = nuevo; }
  p.cost = costo; p.lastCost = ls.length ? ls[ls.length - 1].costoUnitario : 0;
}
const ACCIONES = {
  ir: el => navegar(el.dataset.v),
  cerrar: () => cerrarHoja(),
  paso: el => { const i = $('#' + el.dataset.t); i.value = Math.max(1, (parseInt(i.value, 10) || 0) + parseInt(el.dataset.d, 10)); i.dispatchEvent(new Event('input', { bubbles: true })); },
  'graf-tipo': el => { grafTipo = el.dataset.t; repintar(); },
  comprobante: el => abrirComprobante(Number(el.dataset.id)),
  'imprimir-doc': el => { const id = el && el.dataset ? Number(el.dataset.id) : NaN; if (id) imprimirComprobante(id); else imprimirDocumento(); },
  'cliente-nuevo': el => formCliente(null, el.dataset.vuelta),
  'proveedor-nuevo': el => formProveedor(null, el.dataset.vuelta),
  'proveedor-ver': el => verProveedor(el.dataset.id),
  'proveedor-editar': el => formProveedor(proveedor(el.dataset.id)),
  'pagar-proveedor': el => formPagoProveedor({ proveedorId: el.dataset.prov, entradaId: el.dataset.entrada ? Number(el.dataset.entrada) : null }),
  'pagar-compra-completa': el => pagarCompraCompleta(Number(el.dataset.id)),
  'cliente-ver': el => verCliente(el.dataset.id),
  'cliente-editar': el => formCliente(cliente(el.dataset.id)),
  'cliente-wa': el => whatsapp(el.dataset.id),
  abonar: el => formAbono({ clienteId: el.dataset.cli, ventaId: el.dataset.venta ? Number(el.dataset.venta) : null }),
  pagar: el => {
    const id = Number(el.dataset.id), v0 = ventas.find(x => x.id === id); if (!v0) return;
    aplicar(() => { const v = ventas.find(x => x.id === id); (v.abonos = v.abonos || []).push({ fecha: hoy(), monto: debeVenta(v) }); v.pagado = v.total; }, 'Pedido pagado completo');
    const cid = v0.clienteId; cerrarHoja(); verCliente(cid); repintar();
  },
  'venta-anular': async el => {
    const v = ventas.find(x => x.id === Number(el.dataset.id)); if (!v) return;
    const abonado = v.tipoPago === 'credito' ? (v.pagado || 0) : 0;
    const aviso_ab = abonado > 0 ? ` ATENCIÓN: esta venta ya tiene ${money(abonado)} abonados. Al anularla ese dinero deja de contar como cobrado: si ya lo recibiste, devuélvelo o anótalo aparte.` : '';
    const aviso_num = v.numero ? ` Esta venta está en el comprobante ${numeroTxt(v.numero)}, que ya se pudo imprimir: ese comprobante cambiará (el número no se reutiliza y quedará una nota de venta anulada).` : '';
    if (!(await confirmar({ titulo: 'Anular venta', texto: `Se borra la venta de ${num(v.cantidad)} y las existencias vuelven a la bodega.${aviso_ab}${aviso_num} ¿Anular?`, ok: 'Anular', peligro: true }))) return;
    aplicar(() => {
      const p = prod(v.productoId); if (p) p.stock += (v.descontado ?? v.cantidad);
      if (v.numero) { const c = cliente(v.clienteId); config.anulados = [...config.anulados, { numero: v.numero, fecha: v.fecha, cliente: c ? c.nombre.slice(0, 100) : '', total: v.total }].slice(-MAX_ANULADOS); }
      ventas = ventas.filter(x => x.id !== v.id);
    }, 'Venta anulada');
    repintar();
  },
  'entrada-anular': async el => {
    const e = entradas.find(x => x.id === Number(el.dataset.id)); if (!e) return;
    const p0 = prod(e.productoId);
    if (p0 && p0.stock < e.cantidad) return aviso(`No se puede anular: ya se vendió parte de esta entrada (en bodega quedan ${num(p0.stock)} de ${num(e.cantidad)}).`, true);
    if (!(await confirmar({ titulo: 'Anular entrada', texto: `Se borra esta entrada de ${num(e.cantidad)} y se restan de la bodega.${e.proveedorId && (e.pagado ?? 0) > 0 ? ` Ya se habían pagado ${money(e.pagado)} al proveedor: ese dinero queda como saldo a favor tuyo con ese proveedor.` : ''} ¿Anular?`, ok: 'Anular', peligro: true }))) return;
    aplicar(() => {
      const p = prod(e.productoId), resto = entradas.filter(x => x.id !== e.id);
      if (p) {
        const esUltima = !entradas.some(x => x.productoId === e.productoId && x.id > e.id);
        p.stock -= e.cantidad;
        if (esUltima && e.costoPrevio !== undefined) { p.cost = e.costoPrevio; p.lastCost = e.lastCostPrevio || 0; } else recalcularCosto(p, resto);
      }
      entradas = resto;
      const pv = e.proveedorId && (e.pagado ?? 0) > 0 ? proveedor(e.proveedorId) : null;
      if (pv) pv.saldoFavor = redondear((pv.saldoFavor || 0) + e.pagado); // lo ya pagado no se pierde: queda a favor del dueño
    }, 'Entrada anulada');
    repintar();
  },
  'ajuste-anular': async el => {
    const a = ajustes.find(x => x.id === Number(el.dataset.id)); if (!a) return;
    if (!(await confirmar({ titulo: 'Anular pérdida', texto: 'Las unidades vuelven a la bodega. ¿Anular?', ok: 'Anular', peligro: true }))) return;
    aplicar(() => { const p = prod(a.productoId); if (p) p.stock += a.cantidad; ajustes = ajustes.filter(x => x.id !== a.id); }, 'Pérdida anulada');
    repintar();
  },
  'prod-nuevo': () => formProducto(null),
  'lista-precios': () => listaPrecios(),
  'sheets-enviar': () => enviarSheet(true),
  'sheets-restaurar': () => traerDelSheet(),
  'sheets-clientes': () => traerClientesDelSheet(),
  'sheets-desconectar': async () => {
    if (!(await confirmar({ titulo: 'Desconectar', texto: 'La app deja de enviar datos al Sheet. Lo que ya está en el Sheet no se borra.', ok: 'Desconectar' }))) return;
    clearTimeout(syncTimer); sync = null; guardarSync(); aviso('Desconectado'); repintar();
  },
  'sheets-script': async () => {
    try { const r = await fetch('apps-script/Code.gs'); const t = await r.text(); await navigator.clipboard.writeText(t); aviso('Script copiado. Pégalo en Apps Script'); }
    catch { aviso('No se pudo copiar el script. Búscalo en la carpeta apps-script del proyecto', true); }
  },
  'sheets-ayuda': () => hoja('Cómo prepararlo', `<ol class="sheet-text" style="padding-left:20px;line-height:1.6">
    <li>Crea un Google Sheet nuevo.</li>
    <li>Menú <strong>Extensiones → Apps Script</strong>. Borra lo que haya y pega el script (botón «Copiar el script»).</li>
    <li>En la primera línea cambia <strong>CAMBIA-ESTA-CLAVE</strong> por una clave tuya y anótala.</li>
    <li><strong>Implementar → Nueva implementación → Aplicación web</strong>. Ejecutar como <strong>Yo</strong>; acceso: <strong>Cualquier persona</strong>. Autoriza los permisos.</li>
    <li>Copia la URL que termina en <strong>/exec</strong>, pégala aquí con la clave y pulsa Conectar.</li></ol>
    <p class="muted" style="margin-top:10px">Tip: si usas la plantilla de Excel del proyecto, ya trae las pestañas listas, incluida «Importar clientes» para pegar tus contactos.</p>
    <p class="muted" style="margin-top:10px">La URL y la clave son como una contraseña: no las compartas.</p>`),
  'lp-copiar': async () => {
    const t = $('#lp-texto'); if (!t) return;
    try { await navigator.clipboard.writeText(t.value); aviso('Texto copiado'); } catch { t.select(); aviso('Selecciona y copia el texto'); }
  },
  'lp-wa': () => { const t = $('#lp-texto'); if (t) window.open(`https://wa.me/?text=${encodeURIComponent(t.value)}`, '_blank', 'noopener'); },
  'prod-editar': el => formProducto(prod(el.dataset.id)),
  perdida: el => formPerdida(prod(el.dataset.id)),
  periodo: el => { periodo = el.dataset.p; repintar(); },
  ref: el => { refFecha = moverRef(periodo, refFecha, Number(el.dataset.d)); repintar(); },
  imprimir: () => window.print(),
  csv: async () => { if (await entregarArchivo(`el-gallinero-${hoy()}.csv`, csvTodo(), 'text/csv;charset=utf-8')) aviso('Archivo listo'); },
  'json-export': () => exportarJSON(),
  'json-import': () => $('#archivo-json').click(),
  'borrar-todo': async () => {
    if (!(await confirmar({ titulo: 'Borrar todos los datos', texto: 'Se borrarán productos, ventas, clientes y entradas de este teléfono. No se puede deshacer.', ok: 'Borrar todo', peligro: true }))) return;
    aplicar(() => { products = clonar(PRODUCTOS_BASE); entradas = []; ventas = []; clientes = []; ajustes = []; proveedores = []; config = configBase(); }, 'Datos borrados');
    navegar('inicio');
  },
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el && ACCIONES[el.dataset.act]) ACCIONES[el.dataset.act](el);
});

/* =============== Arranque =============== */
function mostrarActualizacion() {
  if ($('.update-bar')) return;
  const barra = document.createElement('div');
  barra.className = 'update-bar'; barra.setAttribute('role', 'status');
  barra.innerHTML = '<span>Hay una versión nueva ·</span><button type="button" class="btn btn-sm">Recargar</button>';
  document.body.appendChild(barra);
  $('button', barra).addEventListener('click', () => location.reload()); // nunca se recarga solo: podrías estar a mitad de una venta
}
if (errorArranque) pantallaRecuperacion(errorArranque);
else {
  sync = leerSync();
  window.addEventListener('afterprint', () => document.body.classList.remove('imprime-doc'));
  window.addEventListener('online', () => { if (sync && sync.listo && sync.pendiente) programarSync(); });
  if (sync && sync.listo && sync.pendiente) programarSync();
  try { pintar(); if (avisoArranque) aviso(avisoArranque, true); } catch (e) { pantallaRecuperacion(e); }
  if (navigator.serviceWorker && location.protocol.startsWith('http')) {
    const sw = navigator.serviceWorker, habiaControlador = !!sw.controller;
    sw.addEventListener('controllerchange', () => { if (habiaControlador) mostrarActualizacion(); });
    sw.register('sw.js').then(reg => {
      reg.onupdatefound = () => { const nuevo = reg.installing; if (nuevo) nuevo.addEventListener('statechange', () => { if (nuevo.state === 'installed' && sw.controller) mostrarActualizacion(); }); };
    }).catch(() => {});
  }
}
