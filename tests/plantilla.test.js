'use strict';
/* La plantilla de Excel (plantilla/El-Gallinero-plantilla.xlsx) debe tener las mismas pestañas y cabeceras que
   escribe apps-script/Code.gs. Sin dependencias: el .xlsx es un zip y se lee con node:zlib. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
const XLSX = path.join(RAIZ, 'plantilla', 'El-Gallinero-plantilla.xlsx');

function leerZip(buf) {
  const fin = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(fin >= 0, 'no es un zip');
  const total = buf.readUInt16LE(fin + 10);
  let pos = buf.readUInt32LE(fin + 16);
  const archivos = new Map();
  for (let i = 0; i < total; i++) {
    const metodo = buf.readUInt16LE(pos + 10), tam = buf.readUInt32LE(pos + 20);
    const nombre = buf.toString('utf8', pos + 46, pos + 46 + buf.readUInt16LE(pos + 28));
    const extra = buf.readUInt16LE(pos + 30), coment = buf.readUInt16LE(pos + 32), local = buf.readUInt32LE(pos + 42);
    const ini = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const datos = buf.subarray(ini, ini + tam);
    archivos.set(nombre, metodo === 8 ? zlib.inflateRawSync(datos) : datos);
    pos += 46 + buf.readUInt16LE(pos + 28) + extra + coment;
  }
  return archivos;
}

const desescapar = t => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/* {pestaña: valores de la fila 1} del .xlsx */
function cabecerasDelXlsx() {
  const z = leerZip(fs.readFileSync(XLSX));
  const txt = n => z.get(n).toString('utf8');
  const compartidas = [...(z.has('xl/sharedStrings.xml') ? txt('xl/sharedStrings.xml') : '').matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(m => desescapar([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')));
  const rels = new Map([...txt('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map(m => {
    const id = /Id="([^"]+)"/.exec(m[0])[1], destino = /Target="([^"]+)"/.exec(m[0])[1];
    return [id, destino.replace(/^\/?(xl\/)?/, 'xl/')];
  }));
  const res = {};
  for (const m of txt('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)) {
    const nombre = desescapar(/name="([^"]+)"/.exec(m[0])[1]);
    const hoja = txt(rels.get(/r:id="([^"]+)"/.exec(m[0])[1]));
    const fila1 = /<row\b[^>]*\br="1"[^>]*>([\s\S]*?)<\/row>/.exec(hoja);
    const celdas = fila1 ? [...fila1[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)] : [];
    res[nombre] = celdas.map(c => {
      const cuerpo = c[2] || '';
      if (/t="inlineStr"/.test(c[1])) return desescapar([...cuerpo.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join(''));
      const v = /<v>([\s\S]*?)<\/v>/.exec(cuerpo);
      if (!v) return null;
      return /t="s"/.test(c[1]) ? compartidas[Number(v[1])] : desescapar(v[1]);
    }).filter(v => v !== null && v !== '');
  }
  return res;
}

function contratoDeCodeGs() {
  const codigo = fs.readFileSync(path.join(RAIZ, 'apps-script', 'Code.gs'), 'utf8');
  const lista = t => [...t.matchAll(/'([^']*)'/g)].map(m => m[1]);
  const espejo = [...codigo.matchAll(/escribirHoja_\('([^']+)',\s*\[([^\]]*)\]/g)].map(m => [m[1], lista(m[2])]);
  const importar = lista(/const HOJA_IMPORTAR\s*=\s*\[([^\]]*)\]/.exec(codigo)[1]);
  return { espejo, importar };
}

test('plantilla · las pestañas y cabeceras del .xlsx son las que escribe Code.gs', () => {
  const { espejo, importar } = contratoDeCodeGs();
  assert.equal(espejo.length, 6);
  const xlsx = cabecerasDelXlsx();
  assert.deepEqual(Object.keys(xlsx).sort(), ['Instrucciones', 'Importar clientes', ...espejo.map(e => e[0])].sort());
  // «Importar clientes» lleva una nota de ayuda en la columna E: solo cuentan las columnas de la tabla.
  assert.deepEqual(xlsx['Importar clientes'].slice(0, importar.length), importar);
  for (const [nombre, cab] of espejo) assert.deepEqual(xlsx[nombre], cab, `cabecera de «${nombre}»`);
});

test('plantilla · generar_plantilla.py --check confirma que el .xlsx está al día', t => {
  const py = ['python', 'python3', 'py'].map(c => ({ c, r: spawnSync(c, ['-c', 'import openpyxl'], { encoding: 'utf8' }) })).find(x => !x.r.error && x.r.status === 0);
  if (!py) return t.skip('python u openpyxl no están disponibles');
  const r = spawnSync(py.c, [path.join('plantilla', 'generar_plantilla.py'), '--check'], { cwd: RAIZ, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});
