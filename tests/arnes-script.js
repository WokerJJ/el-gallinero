'use strict';
/* Arnés compartido para probar apps-script/Code.gs en node:vm: SpreadsheetApp, ContentService, LockService y Utilities falsos.
   La hoja falsa imita los límites reales de Google Sheets (un rango fuera de la hoja o de 0 filas lanza error)
   y registra cada rango que se toca, para comprobar que el script no sale del bloque de la tabla.
   También imita la coerción de tipos de Sheets: al escribir con setValues en una columna que NO tiene formato de texto plano
   ('@'), una cadena numérica pasa a número, 'true'/'false' a booleano, '=…' se evalúa como fórmula, una cadena con forma de
   fecha (ISO o «mar-1») pasa a Date. Con setNumberFormat('@') nada se convierte.
   La coerción se activa solo en las pestañas internas (nombre con «_»: _empleados, _sesiones): los espejos legibles todavía
   escriben sin formato de texto y sus pruebas esperan el valor tal cual (ver nota en el informe de BUG-003). */
const crypto = require('node:crypto');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const CODIGO = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');

class HojaFalsa {
  constructor(nombre, { filas = 1000, columnas = 26, celdas = {}, coaccion = nombre.startsWith('_') } = {}) {
    this.nombre = nombre; this.coaccion = coaccion; this.maxFilas = filas; this.maxColumnas = columnas;
    this.celdas = new Map(Object.entries(celdas)); // 'fila,columna' -> valor
    this.formatos = new Map(); // 'fila,columna' -> formato ('@' = texto plano)
    this.toques = []; this.insertadas = { filas: 0, columnas: 0 }; this.oculta = false; this.congeladas = 0;
  }
  getLastRow() { let m = 0; for (const [k, v] of this.celdas) if (v !== '' && v != null) m = Math.max(m, Number(k.split(',')[0])); return m; }
  getMaxRows() { return this.maxFilas; }
  getMaxColumns() { return this.maxColumnas; }
  insertRowsAfter(_, n) { this.maxFilas += n; this.insertadas.filas += n; }
  insertColumnsAfter(_, n) { this.maxColumnas += n; this.insertadas.columnas += n; }
  setFrozenRows(n) { this.congeladas = n; }
  hideSheet() { this.oculta = true; }
  clearContents() { this.celdas.clear(); }
  coaccionar(valor, texto) {
    if (!this.coaccion) return valor;
    if (texto) return typeof valor === 'string' ? valor : (valor instanceof Date ? valor : (valor == null ? '' : String(valor)));
    if (typeof valor !== 'string') return valor;
    if (/^ *-?[0-9]+([.][0-9]+)? *$/.test(valor)) return Number(valor);
    if (/^(true|false)$/i.test(valor.trim())) return valor.trim().toLowerCase() === 'true';
    if (valor.startsWith('=')) { try { return /^=[-0-9+*/(). ]+$/.test(valor) ? Function('return (' + valor.slice(1) + ')')() : '#NAME?'; } catch { return '#ERROR!'; } }
    if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$/.test(valor)) return new Date(valor);
    if (/^[a-z]{3}-[0-9]{1,2}$/i.test(valor)) return new Date(2000, 0, 1);
    return valor;
  }
  getRange(f, c, nf = 1, nc = 1) {
    if (nf < 1 || nc < 1) throw new Error('El número de filas y de columnas debe ser al menos 1');
    if (f + nf - 1 > this.maxFilas || c + nc - 1 > this.maxColumnas) throw new Error('El rango está fuera de los límites de la hoja');
    const h = this, rango = { f, c, nf, nc };
    const recorrer = fn => { for (let i = 0; i < nf; i++) for (let j = 0; j < nc; j++) fn(f + i, c + j, i, j); };
    return {
      clearContent() { h.toques.push({ op: 'limpiar', ...rango }); recorrer((r, k) => h.celdas.delete(`${r},${k}`)); return this; },
      setValues(v) { h.toques.push({ op: 'escribir', ...rango }); recorrer((r, k, i, j) => h.celdas.set(`${r},${k}`, h.coaccionar(v[i][j], h.formatos.get(`${r},${k}`) === '@'))); return this; },
      setNumberFormat(f) { h.toques.push({ op: 'formato', ...rango }); recorrer((r, k) => h.formatos.set(`${r},${k}`, f)); return this; },
      setFontWeight() { h.toques.push({ op: 'formato', ...rango }); return this; },
      setFontColor() { h.toques.push({ op: 'formato', ...rango }); return this; },
      getValues() { const o = []; recorrer((r, k, i, j) => { (o[i] ||= [])[j] = h.celdas.get(`${r},${k}`) ?? ''; }); return o; },
      getValue() { return this.getValues()[0][0]; },
      getDisplayValues() { return this.getValues().map(fila => fila.map(String)); },
    };
  }
  celda(f, c) { return this.celdas.get(`${f},${c}`); }
}

function cargarScript({ clave = 'k-secreta', hojas = [], max = null } = {}) {
  const libro = new Map(hojas.map(h => [h.nombre, h]));
  const contadores = { cerrojo: 0, hojas: 0 }; // cuántas veces se pidió el cerrojo y se buscó una pestaña
  const cache = new Map(); // CacheService falso (sin caducidad: las pruebas duran milisegundos)
  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({
      getSheetByName: n => { contadores.hojas++; return libro.get(n) || null; },
      insertSheet: n => { const h = new HojaFalsa(n); libro.set(n, h); return h; },
    }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ texto: t, setMimeType() { return this; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => { contadores.cerrojo++; return true; }, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: k => (cache.has(k) ? cache.get(k) : null), put: (k, v) => { cache.set(k, String(v)); } }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      // Apps Script devuelve los bytes con signo (-128..127), como aquí.
      computeDigest: (_alg, texto) => Array.from(crypto.createHash('sha256').update(String(texto), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
      getUuid: () => crypto.randomUUID(),
    },
    Date, JSON, Math, String, Number, Array, Object,
  };
  const ctx = vm.createContext(sandbox);
  let codigo = clave === null ? CODIGO : CODIGO.replace("'CAMBIA-ESTA-CLAVE';", `'${clave}';`);
  if (max !== null) codigo = codigo.replace(/MAX_CLIENTES = \d+;/, `MAX_CLIENTES = ${max};`);
  vm.runInContext(codigo, ctx, { filename: 'Code.gs' });
  return { libro, ctx, contadores, run: c => vm.runInContext(c, ctx) };
}

const post = (s, cuerpo) => JSON.parse(s.run('doPost')({ postData: { contents: JSON.stringify(cuerpo) } }).texto);
const plano = v => JSON.parse(JSON.stringify(v));
const escribir = (s, nombre, cab, filas) => s.run('escribirHoja_')(nombre, cab, filas);

module.exports = { HojaFalsa, cargarScript, post, plano, escribir, CODIGO };
