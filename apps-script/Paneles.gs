/**
 * EL GALLINERO — Paneles del Sheet (v3)
 * Rehace INICIO, FINANZAS, PANEL VENTAS, PANEL INVENTARIO, PANEL COMPRAS, PANEL PROVEEDORES,
 * PANEL CLIENTES, PANEL PÉRDIDAS, REPORTES y _MOTOR_CALCULOS.
 * NO toca las hojas que escribe la app: Inventario, Ventas, Compras, Proveedores, Clientes, Pérdidas, _respaldo.
 * Menú: 🐔 Gallinero → Reconstruir paneles
 *
 * Instalación: pégalo como un archivo aparte (Paneles.gs) en el mismo proyecto de Apps Script que Code.gs.
 *
 * Contrato con Code.gs (las columnas se leen por letra; el script de la app solo agrega columnas al final):
 *   Ventas:      A Fecha · B Producto · C Cantidad · D Panales · E Precio · F Total · G Cliente · H Pago · I Abonado ·
 *                J Debe · K Comprobante · L Costo unitario (costo por unidad EN EL MOMENTO de la venta)
 *   Compras:     A Fecha · B Producto · C Cantidad · D Panales · E Costo unitario · F Total · G Vence · H Días en granja ·
 *                I Notas · J Proveedor · K Pagado · L Debe · M Comprobante
 *   Proveedores: A Proveedor · B Teléfono · C Deuda · D Notas · E Saldo a favor
 *   _respaldo:   B4 alerta de stock bajo · B5 margen sugerido (%) · B6 vida útil del huevo (días)
 */

const T = {
  font: 'Inter',
  bg: '#F4F5F8', card: '#FFFFFF', line: '#E4E7EC',
  ink: '#101828', sub: '#667085', mute: '#98A2B3',
  dark: '#0B1220', dark2: '#1D2939',
  pri: '#F97316', pri2: '#FDBA74',
  ok: '#12B76A', okSoft: '#ECFDF3', okInk: '#067647',
  warn: '#F79009', warnSoft: '#FFFAEB', warnInk: '#B54708',
  bad: '#F04438', badSoft: '#FEF3F2', badInk: '#B42318',
  blue: '#2E90FA', violet: '#7A5AF8', teal: '#15B79E', slate: '#475467'
};
const MONEY = '"$"#,##0';
const PCT = '0.0%';
const INT = '#,##0';
const DATEF = 'dd/mm/yyyy';
const M = "'_MOTOR_CALCULOS'!";
const B = SpreadsheetApp.BorderStyle;

const NAV = [
  ['🏠 Inicio', 'INICIO'], ['💰 Finanzas', 'FINANZAS'], ['📈 Ventas', 'PANEL VENTAS'],
  ['📦 Inventario', 'PANEL INVENTARIO'], ['🛒 Compras', 'PANEL COMPRAS'], ['🧾 Proveedores', 'PANEL PROVEEDORES'],
  ['👥 Clientes', 'PANEL CLIENTES'], ['⚠️ Pérdidas', 'PANEL PÉRDIDAS'], ['📑 Reportes', 'REPORTES']
];

/* ---------- fechas robustas (sirve si la app guarda texto o fecha) ---------- */
const nf = r => `ARRAYFORMULA(IFERROR(DATEVALUE(LEFT(${r}&"",10)),${r}))`;
const NV = nf('Ventas!A2:A'), NC = nf('Compras!A2:A'), NP = nf("'Pérdidas'!A2:A");
const MES = f => `IFERROR((YEAR(${f})=YEAR(TODAY()))*(MONTH(${f})=MONTH(TODAY())),0)`;
// Costo de lo vendido: el costo unitario guardado en cada venta (Ventas!L). Si la columna no existe (script viejo) o está
// vacía, se usa el costo promedio actual del inventario como respaldo.
const COSTO = 'ARRAYFORMULA(IF(Ventas!L2:L<>"",Ventas!L2:L,IFERROR(VLOOKUP(Ventas!B2:B,Inventario!A2:D,4,FALSE),0)))';

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🐔 Gallinero')
    .addItem('Reconstruir paneles', 'reconstruirTodo')
    .addToUi();
}

function reconstruirTodo() {
  const ss = SpreadsheetApp.getActive();
  NAV.forEach(n => { if (!ss.getSheetByName(n[1])) ss.insertSheet(n[1]); });
  if (!ss.getSheetByName('_MOTOR_CALCULOS')) ss.insertSheet('_MOTOR_CALCULOS');
  buildMotor_();
  buildInicio_();
  buildFinanzas_();
  buildVentas_();
  buildInventario_();
  buildCompras_();
  buildProveedores_();
  buildClientes_();
  buildPerdidas_();
  buildReportes_();
  styleData_();
  ordenar_();
  ss.setActiveSheet(ss.getSheetByName('INICIO'));
  ss.toast('Paneles reconstruidos ✅', 'El Gallinero', 5);
}

/* ======================= helpers ======================= */
const ss_ = () => SpreadsheetApp.getActive();
const gid_ = n => { const s = ss_().getSheetByName(n); return s ? s.getSheetId() : 0; };
const L_ = n => String.fromCharCode(64 + n);

function resetSheet_(name, cols) {
  cols = cols || 14;
  const sh = ss_().getSheetByName(name);
  sh.getCharts().forEach(c => sh.removeChart(c));
  sh.getBandings().forEach(b => b.remove());
  sh.setConditionalFormatRules([]);
  sh.setFrozenRows(0); sh.setFrozenColumns(0);
  if (sh.getMaxRows() < 1000) sh.insertRowsAfter(sh.getMaxRows(), 1000 - sh.getMaxRows());
  if (sh.getMaxColumns() < cols) sh.insertColumnsAfter(sh.getMaxColumns(), cols - sh.getMaxColumns());
  const all = sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns());
  all.breakApart(); all.clearDataValidations(); all.clear();
  if (sh.getMaxColumns() > cols) sh.deleteColumns(cols + 1, sh.getMaxColumns() - cols);
  sh.setHiddenGridlines(true);
  sh.getRange(1, 1, sh.getMaxRows(), cols).setBackground(T.bg).setFontFamily(T.font)
    .setFontSize(10).setFontColor(T.ink).setVerticalAlignment('middle').setFontLine('none');
  sh.setRowHeights(1, sh.getMaxRows(), 24);
  sh.setColumnWidth(1, 18);
  sh.setColumnWidths(2, cols - 2, 88);
  sh.setColumnWidth(cols, 18);
  return sh;
}

function widths_(sh, arr) { arr.forEach((w, i) => sh.setColumnWidth(2 + i, w)); }

function header_(sh, title, subtitle, active) {
  sh.setRowHeight(1, 10); sh.setRowHeight(2, 40); sh.setRowHeight(3, 24); sh.setRowHeight(4, 4);
  sh.getRange('A1:N3').setBackground(T.dark);
  sh.getRange('A4:N4').setBackground(T.pri);
  sh.getRange('B2:I2').merge().setValue(title).setFontSize(18).setFontWeight('bold').setFontColor('#FFFFFF');
  sh.getRange('B3:I3').merge().setValue(subtitle).setFontSize(9).setFontColor('#98A2B3').setVerticalAlignment('top');
  sh.getRange('J2:M2').merge().setFormula('=PROPER(TEXT(TODAY(),"dddd, d mmm yyyy"))')
    .setHorizontalAlignment('right').setFontColor(T.pri2).setFontWeight('bold').setFontSize(10);
  sh.getRange('J3:M3').merge().setValue('● Conectado a la app').setHorizontalAlignment('right')
    .setFontColor('#6CE9A6').setFontSize(8).setVerticalAlignment('top');
  // barra de navegación
  sh.setRowHeight(5, 36);
  sh.getRange('A5:N5').setBackground('#FFFFFF')
    .setBorder(null, null, true, null, null, null, T.line, B.SOLID);
  NAV.forEach((n, i) => {
    const c = sh.getRange(5, 2 + i);
    c.setFormula(`=HYPERLINK("#gid=${gid_(n[1])}","${n[0]}")`)
      .setHorizontalAlignment('center').setFontSize(9).setFontWeight('bold').setFontLine('none');
    if (n[1] === active) {
      c.setBackground(T.pri).setFontColor('#FFFFFF');
    } else {
      c.setBackground('#F2F4F7').setFontColor(T.slate);
    }
    c.setBorder(true, true, true, true, null, null, '#FFFFFF', B.SOLID_THICK);
  });
  sh.setRowHeight(6, 14);
  sh.setFrozenRows(5);
}

/** Tarjeta KPI: 3 filas (etiqueta, valor, nota) */
function kpi_(sh, row, col, span, label, formula, sub, fmt, accent) {
  const box = sh.getRange(row, col, 3, span);
  box.setBackground(T.card);
  [0, 1, 2].forEach(i => { const rr = sh.getRange(row + i, col, 1, span); if (span > 1) rr.merge(); rr.setHorizontalAlignment('center'); });
  sh.getRange(row, col).setValue(label).setFontSize(8).setFontWeight('bold').setFontColor(T.sub);
  sh.getRange(row + 1, col).setFormula(formula).setNumberFormat(fmt || MONEY)
    .setFontSize(span >= 3 ? 20 : 17).setFontWeight('bold').setFontColor(T.ink);
  const s = sh.getRange(row + 2, col);
  if (String(sub).startsWith('=')) s.setFormula(sub); else s.setValue(sub);
  s.setFontSize(8).setFontColor(T.mute);
  box.setBorder(true, true, true, true, null, null, T.bg, B.SOLID_THICK);
  sh.getRange(row, col, 1, span).setBorder(true, null, null, null, null, null, accent || T.pri, B.SOLID_THICK);
  sh.setRowHeight(row, 26); sh.setRowHeight(row + 1, 38); sh.setRowHeight(row + 2, 22);
}

function section_(sh, row, col, span, text) {
  sh.getRange(row, col, 1, span).merge().setValue(text).setFontSize(11).setFontWeight('bold').setFontColor(T.ink);
  sh.setRowHeight(row, 30);
}

function thead_(sh, row, col, headers) {
  sh.getRange(row, col, 1, headers.length).setValues([headers]).setBackground(T.dark2)
    .setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(9).setHorizontalAlignment('center').setWrap(true);
  sh.setRowHeight(row, 30);
}

/** Formato de cuerpo de tabla + bandas + chips de estado */
function tbody_(sh, row, col, ncols, fmts) {
  const n = 1000 - row;
  const r = sh.getRange(row, col, n, ncols);
  r.setFontSize(9).setHorizontalAlignment('center');
  sh.getRange(row, col, n, 1).setHorizontalAlignment('left').setFontWeight('bold');
  (fmts || []).forEach((f, i) => { if (f) sh.getRange(row, col + i, n, 1).setNumberFormat(f); });
  const Lc = L_(col);
  const mk = (t, bg, fg) => SpreadsheetApp.newConditionalFormatRule().whenTextContains(t)
    .setBackground(bg).setFontColor(fg).setBold(true).setRanges([r]).build();
  const rules = [
    mk('Agotado', T.badSoft, T.badInk), mk('Vencido', T.badSoft, T.badInk), mk('Alta', T.badSoft, T.badInk),
    mk('🚨', T.badSoft, T.badInk),
    mk('Bajo', T.warnSoft, T.warnInk), mk('pronto', T.warnSoft, T.warnInk), mk('pendiente', T.warnSoft, T.warnInk),
    mk('Media', T.warnSoft, T.warnInk),
    mk('Óptimo', T.okSoft, T.okInk), mk('Normal', T.okSoft, T.okInk), mk('Al día', T.okSoft, T.okInk),
    mk('Vigente', T.okSoft, T.okInk),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(`=AND($${Lc}${row}<>"",ISEVEN(ROW()))`)
      .setBackground('#F9FAFB').setRanges([r]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(`=$${Lc}${row}<>""`)
      .setBackground('#FFFFFF').setRanges([r]).build()
  ];
  sh.setConditionalFormatRules(sh.getConditionalFormatRules().concat(rules));
}

function chart_(sh, type, ranges, row, col, w, h, opts) {
  let b = sh.newChart().setChartType(type);
  ranges.forEach(r => { b = b.addRange(r); });
  b = b.setNumHeaders(1).setPosition(row, col, 4, 2)
    .setOption('width', w).setOption('height', h)
    .setOption('fontName', T.font)
    .setOption('backgroundColor', { fill: '#FFFFFF', stroke: T.line, strokeWidth: 1 })
    .setOption('legend', { position: 'top', alignment: 'end', textStyle: { color: T.sub, fontSize: 10, fontName: T.font } })
    .setOption('chartArea', { left: '13%', top: '13%', width: '83%', height: '72%' })
    .setOption('hAxis', { textStyle: { color: T.sub, fontSize: 9 }, gridlines: { color: 'transparent' }, baselineColor: T.line })
    .setOption('vAxis', { format: 'short', viewWindow: { min: 0 }, minValue: 0, gridlines: { color: '#EEF0F3', count: 5 }, minorGridlines: { color: 'transparent' }, textStyle: { color: T.mute, fontSize: 9 }, baselineColor: T.line })
    .setOption('tooltip', { textStyle: { fontName: T.font, fontSize: 11 } });
  Object.keys(opts || {}).forEach(k => { b = b.setOption(k, opts[k]); });
  sh.insertChart(b.build());
}

function motorR_(a1) { return ss_().getSheetByName('_MOTOR_CALCULOS').getRange(a1); }

/* ======================= MOTOR ======================= */
function buildMotor_() {
  const sh = resetSheet_('_MOTOR_CALCULOS', 26);
  sh.setColumnWidths(1, 26, 110); sh.setColumnWidth(1, 230);
  const rows = [
    ['MÉTRICA', 'VALOR'],
    ['Año seleccionado (Finanzas)', '=IFERROR(VALUE(FINANZAS!C8),YEAR(TODAY()))'],
    // La configuración de la app viene en celdas propias de _respaldo (B4:B6); en el JSON queda fuera del primer trozo.
    ['Umbral stock bajo (config app)', '=IFERROR(VALUE(_respaldo!B4),50)'],
    ['Margen objetivo (config app)', '=IFERROR(VALUE(_respaldo!B5)/100,0.25)'],
    ['Vida útil granja días (config app)', '=IFERROR(VALUE(_respaldo!B6),21)'],
    ['Ventas hoy', `=LET(f,${NV},SUMPRODUCT(IFERROR(--(INT(f)=TODAY()),0),Ventas!F2:F))`],
    ['Ventas mes actual', `=LET(f,${NV},SUMPRODUCT(${MES('f')},Ventas!F2:F))`],
    ['CMV mes actual', `=LET(f,${NV},SUMPRODUCT(${MES('f')},${COSTO},Ventas!C2:C))`],
    ['Ganancia bruta mes', '=B7-B8'],
    ['Margen bruto mes', '=IF(B7>0,B9/B7,0)'],
    ['Compras mes actual', `=LET(f,${NC},SUMPRODUCT(${MES('f')},Compras!F2:F))`],
    ['Pérdidas mes actual', `=LET(f,${NP},SUMPRODUCT(${MES('f')},'Pérdidas'!C2:C,'Pérdidas'!D2:D))`],
    ['Ventas totales', '=SUM(Ventas!F2:F)'],
    ['CMV total', `=SUMPRODUCT(${COSTO},Ventas!C2:C)`],
    ['Utilidad bruta total', '=B13-B14'],
    ['Margen bruto total', '=IF(B13>0,B15/B13,0)'],
    ['Recaudo total', '=SUM(Ventas!I2:I)'],
    ['Saldo en ventas (Debe)', '=SUM(Ventas!J2:J)'],
    ['Cartera clientes', '=SUM(Clientes!C2:C)'],
    ['Clientes con deuda', '=COUNTIF(Clientes!C2:C,">0")'],
    ['Compras totales', '=SUM(Compras!F2:F)'],
    ['Pérdidas totales', "=SUMPRODUCT('Pérdidas'!C2:C,'Pérdidas'!D2:D)"],
    ['Inventario al costo', '=SUMPRODUCT(Inventario!C2:C,Inventario!D2:D)'],
    ['Inventario a la venta', '=SUMPRODUCT(Inventario!C2:C,MAP(Inventario!A2:A,Inventario!E2:E,LAMBDA(p,x,IF(p="",0,IF(N(x)>0,x,XLOOKUP(p,Ventas!B2:B,Ventas!E2:E,0,0,-1))))))'],
    ['Unidades en stock', '=SUM(Inventario!C2:C)'],
    ['Productos stock bajo', '=COUNTIFS(Inventario!A2:A,"<>",Inventario!C2:C,">0",Inventario!C2:C,"<"&B3)'],
    ['Productos agotados', '=COUNTIFS(Inventario!A2:A,"<>",Inventario!C2:C,"<=0")'],
    ['Unidades vendidas', '=SUM(Ventas!C2:C)'],
    ['Panales vendidos', '=SUM(Ventas!D2:D)'],
    ['Número de ventas', '=COUNTA(Ventas!A2:A)'],
    ['Clientes registrados', '=COUNTA(Clientes!A2:A)'],
    ['Productos en catálogo', '=COUNTA(Inventario!A2:A)'],
    ['Unidades perdidas', "=SUM('Pérdidas'!C2:C)"],
    ['Unidades compradas', '=SUM(Compras!C2:C)'],
    ['Panales comprados', '=SUM(Compras!D2:D)'],
    ['Lotes por vencer (7 días)', `=LET(g,${nf('Compras!G2:G')},SUMPRODUCT((Compras!G2:G<>"")*IFERROR((g>=TODAY())*(g<=TODAY()+7),0)))`],
    ['Registros de compras', '=COUNTA(Compras!A2:A)'],
    ['Registros de pérdidas', "=COUNTA('Pérdidas'!A2:A)"],
    ['Utilidad potencial inventario', '=SUMPRODUCT(Inventario!C2:C,MAP(Inventario!A2:A,Inventario!E2:E,Inventario!D2:D,LAMBDA(p,x,c,IF(p="",0,LET(pr,IF(N(x)>0,x,XLOOKUP(p,Ventas!B2:B,Ventas!E2:E,0,0,-1)),IF(pr>0,pr-c,0))))))'],
    // Cuentas por pagar (hoja Proveedores y columna Debe de Compras)
    ['Debo a proveedores', '=SUM(Proveedores!C2:C)'],
    ['Proveedores con deuda', '=COUNTIF(Proveedores!C2:C,">0")'],
    ['Saldo a favor con proveedores', '=SUM(Proveedores!E2:E)'],
    ['Compras con saldo pendiente', '=COUNTIF(Compras!L2:L,">0")']
  ];
  rows.forEach((r, i) => {
    sh.getRange(i + 1, 1).setValue(r[0]);
    const c = sh.getRange(i + 1, 2);
    if (String(r[1]).startsWith('=')) c.setFormula(r[1]); else c.setValue(r[1]);
  });
  sh.getRange('B6:B43').setNumberFormat(MONEY);
  ['B10', 'B16', 'B4'].forEach(a => sh.getRange(a).setNumberFormat(PCT));
  ['B2', 'B3', 'B5', 'B20', 'B25', 'B26', 'B27', 'B28', 'B29', 'B30', 'B31', 'B32', 'B33', 'B34', 'B35', 'B36', 'B37', 'B38', 'B41', 'B43']
    .forEach(a => sh.getRange(a).setNumberFormat('0'));

  // Tabla mensual (año seleccionado)
  sh.getRange('D2:I2').setValues([['Mes', 'Ventas', 'Compras', 'Costo vendido', 'Utilidad', 'Margen']]);
  sh.getRange('D3:D14').setValues(['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'].map(m => [m]));
  const mensual = (fecha, valor) => `=LET(f,${fecha},y,$B$2,MAP(SEQUENCE(12),LAMBDA(m,SUMPRODUCT(IFERROR((YEAR(f)=y)*(MONTH(f)=m),0),${valor}))))`;
  sh.getRange('E3').setFormula(mensual(NV, 'Ventas!F2:F'));
  sh.getRange('F3').setFormula(mensual(NC, 'Compras!F2:F'));
  sh.getRange('G3').setFormula(mensual(NV, `${COSTO},Ventas!C2:C`));
  sh.getRange('H3').setFormula('=ARRAYFORMULA(E3:E14-G3:G14)');
  sh.getRange('I3').setFormula('=ARRAYFORMULA(IF(E3:E14>0,H3:H14/E3:E14,0))');
  sh.getRange('D15').setValue('Total');
  ['E', 'F', 'G', 'H'].forEach(c => sh.getRange(c + '15').setFormula(`=SUM(${c}3:${c}14)`));
  sh.getRange('I15').setFormula('=IF(E15>0,H15/E15,0)');
  sh.getRange('E3:H15').setNumberFormat(MONEY); sh.getRange('I3:I15').setNumberFormat(PCT);

  // Métodos de pago
  sh.getRange('D17:E17').setValues([['Método', 'Total']]);
  const pago = re => `=SUMPRODUCT(ARRAYFORMULA(--REGEXMATCH(LOWER(Ventas!H2:H&""),"${re}")),Ventas!F2:F)`;
  sh.getRange('D18:D20').setValues([['Efectivo / contado'], ['Transferencia'], ['Crédito']]);
  sh.getRange('E18').setFormula(pago('efect|contado'));
  sh.getRange('E19').setFormula(pago('transf|nequi|davi|banc'));
  sh.getRange('E20').setFormula(pago('cr[eé]d|fiad'));
  sh.getRange('E18:E20').setNumberFormat(MONEY);

  // Por producto (ordenado por ventas)
  sh.getRange('D23:G23').setValues([['Producto', 'Vendido $', 'Unidades vendidas', 'Existencias']]);
  sh.getRange('D24').setFormula('=IFERROR(LET(p,FILTER(Inventario!A2:A,Inventario!A2:A<>""),SORT(HSTACK(p,MAP(p,LAMBDA(x,SUMIF(Ventas!B2:B,x,Ventas!F2:F))),MAP(p,LAMBDA(x,SUMIF(Ventas!B2:B,x,Ventas!C2:C))),MAP(p,LAMBDA(x,SUMIF(Inventario!A2:A,x,Inventario!C2:C)))),2,FALSE)),"")');
  sh.getRange('E24:E60').setNumberFormat(MONEY);

  // Pérdidas por motivo
  sh.getRange('K2:L2').setValues([['Motivo', 'Impacto $']]);
  sh.getRange('K3').setFormula(`=IFERROR(LET(u,UNIQUE(FILTER('Pérdidas'!E2:E,'Pérdidas'!E2:E<>"")),HSTACK(u,MAP(u,LAMBDA(x,SUMPRODUCT(('Pérdidas'!E2:E=x)*'Pérdidas'!C2:C*'Pérdidas'!D2:D))))),{"Sin pérdidas",0})`);
  sh.getRange('L3:L30').setNumberFormat(MONEY);

  // Ventas últimos 30 días
  sh.getRange('N2:O2').setValues([['Día', 'Ventas']]);
  sh.getRange('N3').setFormula('=ARRAYFORMULA(TODAY()-30+SEQUENCE(30))');
  sh.getRange('O3').setFormula(`=LET(f,${NV},MAP(N3:N32,LAMBDA(d,SUMPRODUCT(IFERROR(--(INT(f)=d),0),Ventas!F2:F))))`);
  sh.getRange('N3:N32').setNumberFormat('d mmm'); sh.getRange('O3:O32').setNumberFormat(MONEY);

  // Listas para filtros
  sh.getRange('Q2:S2').setValues([['Métodos', 'Clientes', 'Años']]);
  sh.getRange('Q3').setValue('Todos'); sh.getRange('R3').setValue('Todos');
  sh.getRange('Q4').setFormula('=IFERROR(UNIQUE(FILTER(Ventas!H2:H,Ventas!H2:H<>"")),"")');
  sh.getRange('R4').setFormula('=IFERROR(SORT(UNIQUE(FILTER(Ventas!G2:G,Ventas!G2:G<>""))),"")');
  sh.getRange('S3').setFormula('=SEQUENCE(6,1,YEAR(TODAY())-4)');

  // Precio de referencia (precio de la app o último precio vendido)
  sh.getRange('U1:V1').setValues([['Producto', 'Precio ref.']]);
  sh.getRange('U2').setFormula('=IFERROR(LET(p,FILTER(Inventario!A2:A,Inventario!A2:A<>""),x,FILTER(Inventario!E2:E,Inventario!A2:A<>""),HSTACK(p,MAP(p,x,LAMBDA(a,b,IF(N(b)>0,b,XLOOKUP(a,Ventas!B2:B,Ventas!E2:E,0,0,-1)))))),"")');
  sh.getRange('V2:V60').setNumberFormat(MONEY);

  // Deuda por proveedor (para el gráfico de PANEL PROVEEDORES)
  sh.getRange('X2:Y2').setValues([['Proveedor', 'Deuda $']]);
  sh.getRange('X3').setFormula('=IFERROR(LET(p,FILTER(Proveedores!A2:C,Proveedores!A2:A<>"",Proveedores!C2:C>0),SORT(HSTACK(CHOOSECOLS(p,1),CHOOSECOLS(p,3)),2,FALSE)),{"Sin deudas",0})');
  sh.getRange('Y3:Y30').setNumberFormat(MONEY);

  // estilo
  [ 'A1:B1', 'D2:I2', 'D17:E17', 'D23:G23', 'K2:L2', 'N2:O2', 'Q2:S2', 'U1:V1', 'X2:Y2' ].forEach(a =>
    sh.getRange(a).setBackground(T.dark2).setFontColor('#FFFFFF').setFontWeight('bold'));
  sh.getRange('A2:A43').setFontColor(T.sub);
  sh.setFrozenRows(1);
  sh.setTabColor('#344054');
}

/* ======================= INICIO ======================= */
function buildInicio_() {
  const sh = resetSheet_('INICIO');
  widths_(sh, [130, 82, 82, 82, 82, 82, 130, 82, 82, 82, 82, 82]);
  header_(sh, '🐔 El Gallinero', 'Panel ejecutivo · Avícola & distribución', 'INICIO');
  kpi_(sh, 7, 2, 3, 'VENTAS HOY', `=${M}B6`, 'Facturado hoy', MONEY, T.pri);
  kpi_(sh, 7, 5, 3, 'VENTAS DEL MES', `=${M}B7`, '=PROPER(TEXT(TODAY(),"mmmm yyyy"))', MONEY, T.blue);
  kpi_(sh, 7, 8, 3, 'GANANCIA BRUTA DEL MES', `=${M}B9`, 'Ventas − costo de lo vendido', MONEY, T.ok);
  kpi_(sh, 7, 11, 3, 'MARGEN DEL MES', `=${M}B10`, `="Meta: "&TEXT(${M}B4,"0%")`, PCT, T.violet);
  sh.setRowHeight(10, 8);
  kpi_(sh, 11, 2, 3, 'COMPRAS DEL MES', `=${M}B11`, `="Debo a las fincas: "&TEXT(${M}B40,"$#,##0")`, MONEY, T.teal);
  kpi_(sh, 11, 5, 3, 'CARTERA POR COBRAR', `=${M}B19`, `=${M}B20&" clientes con saldo"`, MONEY, T.warn);
  kpi_(sh, 11, 8, 3, 'INVENTARIO AL COSTO', `=${M}B23`, `=${M}B25&" unidades en bodega"`, MONEY, T.slate);
  kpi_(sh, 11, 11, 3, 'PÉRDIDAS DEL MES', `=${M}B12`, 'Mermas valorizadas', MONEY, T.bad);
  sh.setRowHeight(14, 16);

  section_(sh, 15, 2, 5, '📊 Ventas vs compras por mes');
  sh.getRange('G15').setFormula(`="Año "&${M}B2`).setFontColor(T.mute).setFontSize(9).setHorizontalAlignment('right');
  section_(sh, 15, 8, 6, '🥚 Ventas por producto');
  chart_(sh, Charts.ChartType.COLUMN, [motorR_('D2:F14')], 16, 2, 526, 330, {
    colors: [T.pri, T.dark2], bar: { groupWidth: '62%' }
  });
  const np = Math.max(1, ss_().getSheetByName('Inventario').getRange('A2:A').getValues().filter(r => r[0] !== '').length);
  chart_(sh, Charts.ChartType.BAR, [motorR_('D23:E' + (23 + np))], 16, 8, 526, 330, {
    colors: [T.pri], legend: { position: 'none' }, bar: { groupWidth: '65%' },
    chartArea: { left: '24%', top: '6%', width: '70%', height: '82%' },
    hAxis: { format: 'short', viewWindow: { min: 0 }, gridlines: { color: '#EEF0F3' }, textStyle: { color: T.mute, fontSize: 9 } },
    vAxis: { textStyle: { color: T.ink, fontSize: 9 } }
  });
  for (let r = 16; r <= 29; r++) sh.setRowHeight(r, 24);
  sh.setRowHeight(30, 20);

  section_(sh, 31, 2, 5, '📦 Estado de inventario (menor stock primero)');
  section_(sh, 31, 8, 5, '💰 Cartera pendiente de cobro');
  thead_(sh, 32, 2, ['Producto', 'Unidad', 'Existencias', 'Control', 'Estado']);
  thead_(sh, 32, 8, ['Cliente', 'Teléfono', 'Saldo', 'Notas', 'Contacto']);
  sh.getRange('B33').setFormula(`=IF(COUNTA(Inventario!A2:A)=0,"Sin productos",ARRAYFORMULA(LET(n,FILTER(Inventario!A2:F,Inventario!A2:A<>""),s,CHOOSECOLS(n,3),um,${M}$B$3,SORT(HSTACK(CHOOSECOLS(n,1),CHOOSECOLS(n,2),s,CHOOSECOLS(n,6),IF(s<=0,"🚨 Agotado",IF(s<um,"⚠️ Bajo","✅ Normal"))),3,TRUE))))`);
  sh.getRange('H33').setFormula(`=IF(COUNTIF(Clientes!C2:C,">0")=0,"✅ Ningún cliente con saldo",ARRAYFORMULA(LET(c,SORT(FILTER(Clientes!A2:D,Clientes!C2:C>0),3,FALSE),t,REGEXREPLACE(CHOOSECOLS(c,2)&"","\\D",""),HSTACK(CHOOSECOLS(c,1),CHOOSECOLS(c,2),CHOOSECOLS(c,3),CHOOSECOLS(c,4),IF(t="","—",HYPERLINK("https://wa.me/"&IF(LEN(t)=10,"57"&t,t),"💬 WhatsApp"))))))`);
  tbody_(sh, 33, 2, 5, [null, null, INT, null, null]);
  tbody_(sh, 33, 8, 5, [null, '@', MONEY, null, null]);
  sh.setTabColor(T.pri);
}

/* ======================= FINANZAS ======================= */
function buildFinanzas_() {
  const sh = resetSheet_('FINANZAS');
  header_(sh, '💰 Finanzas y rentabilidad', 'Ingresos, costo de lo vendido, utilidad y márgenes', 'FINANZAS');
  // selector de año
  sh.setRowHeight(7, 8);
  sh.getRange('B8').setValue('📅 Año').setFontWeight('bold').setFontColor(T.sub).setHorizontalAlignment('right');
  const yr = sh.getRange('C8');
  yr.setFormula('=YEAR(TODAY())').setNumberFormat('0').setBackground('#FFFFFF').setFontWeight('bold')
    .setHorizontalAlignment('center').setBorder(true, true, true, true, null, null, T.pri, B.SOLID);
  yr.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(motorR_('S3:S8'), true).setAllowInvalid(false).build());
  sh.getRange('D8:I8').merge().setValue('← cambia el año para las gráficas y la tabla mensual').setFontColor(T.mute).setFontSize(8);
  sh.setRowHeight(9, 10);
  kpi_(sh, 10, 2, 2, 'INGRESOS TOTALES', `=${M}B13`, 'Ventas registradas', MONEY, T.blue);
  kpi_(sh, 10, 4, 2, 'COSTO DE VENTAS', `=${M}B14`, 'Costo al momento de la venta', MONEY, T.slate);
  kpi_(sh, 10, 6, 2, 'UTILIDAD BRUTA', `=${M}B15`, 'Ingresos − costo', MONEY, T.ok);
  kpi_(sh, 10, 8, 2, 'MARGEN BRUTO', `=${M}B16`, `="Meta: "&TEXT(${M}B4,"0%")`, PCT, T.violet);
  kpi_(sh, 10, 10, 2, 'MERMAS', `=${M}B22`, 'Pérdidas acumuladas', MONEY, T.bad);
  kpi_(sh, 10, 12, 2, 'RECAUDO EN CAJA', `=${M}B17`, 'Lo ya cobrado', MONEY, T.teal);
  sh.setRowHeight(13, 16);
  section_(sh, 14, 2, 7, '📈 Ingresos, costo y utilidad por mes');
  section_(sh, 14, 9, 5, '💳 Ventas por método de pago');
  chart_(sh, Charts.ChartType.COMBO, [motorR_('D2:E14'), motorR_('G2:H14')], 15, 2, 612, 320, {
    seriesType: 'bars', colors: [T.blue, T.mute, T.ok],
    series: { 0: { type: 'bars' }, 1: { type: 'bars' }, 2: { type: 'line', lineWidth: 3, pointSize: 6 } }, bar: { groupWidth: '65%' },
    vAxis: { format: 'short', gridlines: { color: '#EEF0F3', count: 5 }, textStyle: { color: T.mute, fontSize: 9 }, baselineColor: T.line }
  });
  chart_(sh, Charts.ChartType.PIE, [motorR_('D17:E20')], 15, 9, 436, 320, {
    pieHole: 0.62, colors: [T.ok, T.blue, T.warn], pieSliceText: 'none',
    legend: { position: 'bottom', alignment: 'center', textStyle: { color: T.ink, fontSize: 10 } },
    chartArea: { left: '4%', top: '8%', width: '92%', height: '84%' }
  });
  sh.setRowHeight(29, 16);
  section_(sh, 30, 2, 6, '🗓️ Resumen mensual del año');
  thead_(sh, 31, 2, ['Mes', 'Ventas', 'Compras', 'Costo vendido', 'Utilidad', 'Margen']);
  sh.getRange('B32').setFormula(`={${M}D3:I15}`);
  tbody_(sh, 32, 2, 6, [null, MONEY, MONEY, MONEY, MONEY, PCT]);
  sh.getRange('B44:G44').setFontWeight('bold').setBorder(true, null, null, null, null, null, T.ink, B.SOLID);
  sh.setTabColor(T.pri2);
}

/* ======================= VENTAS ======================= */
function buildVentas_() {
  const sh = resetSheet_('PANEL VENTAS');
  widths_(sh, [88, 130, 80, 84, 85, 95, 130, 95, 90, 90, 40, 40]);
  header_(sh, '📈 Ventas y despachos', 'Facturación, recaudo y créditos · filtra por fecha, método o cliente', 'PANEL VENTAS');
  // filtros
  sh.setRowHeight(7, 34);
  sh.getRange('B7').setValue('🔎 Filtros').setFontWeight('bold');
  const lab = (a, t) => sh.getRange(a).setValue(t).setFontColor(T.sub).setFontSize(9).setHorizontalAlignment('right');
  const inp = r => r.setBackground('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center')
    .setBorder(true, true, true, true, null, null, T.pri, B.SOLID);
  lab('C7', 'Desde'); lab('E7', 'Hasta'); lab('G7', 'Método'); lab('I7', 'Cliente');
  const dv = SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).build();
  inp(sh.getRange('D7')).setFormula('=DATE(YEAR(TODAY()),1,1)').setNumberFormat(DATEF).setDataValidation(dv);
  inp(sh.getRange('F7')).setFormula('=TODAY()').setNumberFormat(DATEF).setDataValidation(dv);
  inp(sh.getRange('H7')).setValue('Todos').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(motorR_('Q3:Q40'), true).build());
  inp(sh.getRange('J7:K7').merge()).setValue('Todos').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(motorR_('R3:R300'), true).build());
  sh.setRowHeight(8, 10);

  const VM = `ARRAYFORMULA((Ventas!A2:A<>"")*IFERROR((INT(${NV})>=$D$7)*(INT(${NV})<=$F$7),0)*((($H$7="Todos")+(LOWER(Ventas!H2:H&"")=LOWER($H$7)))>0)*((($J$7="Todos")+(Ventas!G2:G=$J$7))>0))`;
  const sp = (x) => `=SUMPRODUCT(${VM},${x})`;
  const spRe = (re, x) => `=SUMPRODUCT(${VM},ARRAYFORMULA(--REGEXMATCH(LOWER(Ventas!H2:H&""),"${re}")),${x})`;
  kpi_(sh, 9, 2, 2, 'TOTAL FACTURADO', sp('Ventas!F2:F'), 'Según filtros', MONEY, T.pri);
  kpi_(sh, 9, 4, 2, 'Nº DE VENTAS', `=SUMPRODUCT(${VM})`, 'Despachos', INT, T.dark2);
  kpi_(sh, 9, 6, 2, 'UNIDADES', sp('Ventas!C2:C'), `="Panales: "&TEXT(SUMPRODUCT(${VM},Ventas!D2:D),"#,##0")`, INT, T.blue);
  kpi_(sh, 9, 8, 2, 'CONTADO', spRe('efect|contado|transf|nequi|davi|banc', 'Ventas!F2:F'), 'Efectivo + transferencia', MONEY, T.ok);
  kpi_(sh, 9, 10, 2, 'A CRÉDITO', spRe('cr[eé]d|fiad', 'Ventas!F2:F'), 'Facturado con saldo', MONEY, T.warn);
  kpi_(sh, 9, 12, 2, 'RECAUDADO', sp('Ventas!I2:I'), 'Abonos + pago inmediato', MONEY, T.teal);
  sh.setRowHeight(12, 16);
  section_(sh, 13, 2, 8, '📆 Ventas de los últimos 30 días');
  chart_(sh, Charts.ChartType.AREA, [motorR_('N2:O32')], 14, 2, 1010, 250, {
    colors: [T.pri], areaOpacity: 0.12, lineWidth: 3, pointSize: 4, legend: { position: 'none' },
    chartArea: { left: '7%', top: '8%', width: '91%', height: '76%' },
    hAxis: { format: 'd MMM', textStyle: { color: T.sub, fontSize: 9 }, gridlines: { color: 'transparent' }, slantedText: false, showTextEvery: 3 }
  });
  for (let r = 14; r <= 24; r++) sh.setRowHeight(r, 24);
  sh.setRowHeight(25, 16);
  section_(sh, 26, 2, 7, '🧾 Detalle de ventas (más recientes primero)');
  sh.getRange('I26:K26').merge().setFormula(`="Registros: "&SUMPRODUCT(${VM})`).setHorizontalAlignment('right').setFontColor(T.sub).setFontSize(9);
  thead_(sh, 27, 2, ['Fecha', 'Producto', 'Cantidad', 'Panales', 'Precio', 'Total', 'Cliente', 'Pago', 'Abonado', 'Debe']);
  sh.getRange('B28').setFormula(`=IFERROR(SORT(FILTER(Ventas!A2:J,${VM}=1),1,FALSE),"Sin ventas para los filtros seleccionados")`);
  tbody_(sh, 28, 2, 10, [DATEF, null, INT, INT, MONEY, MONEY, null, null, MONEY, MONEY]);
  sh.getRange(28, 3, 972, 1).setFontWeight('bold');
  sh.setTabColor(T.pri2);
}

/* ======================= INVENTARIO ======================= */
function buildInventario_() {
  const sh = resetSheet_('PANEL INVENTARIO');
  widths_(sh, [130, 75, 85, 85, 85, 95, 95, 85, 75, 90, 100, 40]);
  header_(sh, '📦 Inventario y stock', 'Existencias, valorización al costo / venta y semáforo de stock', 'PANEL INVENTARIO');
  kpi_(sh, 7, 2, 2, 'PRODUCTOS', `=${M}B32`, 'En catálogo', INT, T.dark2);
  kpi_(sh, 7, 4, 2, 'UNIDADES EN STOCK', `=${M}B25`, 'Volumen físico', INT, T.blue);
  kpi_(sh, 7, 6, 2, 'VALOR AL COSTO', `=${M}B23`, 'Costo promedio', MONEY, T.slate);
  kpi_(sh, 7, 8, 2, 'VALOR A LA VENTA', `=${M}B24`, 'Precio de venta', MONEY, T.teal);
  kpi_(sh, 7, 10, 2, 'UTILIDAD POTENCIAL', `=${M}B39`, 'Si se vende todo', MONEY, T.ok);
  kpi_(sh, 7, 12, 2, 'CON ALERTA', `=${M}B26+${M}B27`, `="Agotados: "&${M}B27&" · Bajo: "&${M}B26`, INT, T.bad);
  sh.setRowHeight(10, 16);
  section_(sh, 11, 2, 8, '📊 Existencias por producto');
  sh.getRange('J11:L11').merge().setFormula(`="Alerta bajo: < "&${M}B3&" unidades"`).setHorizontalAlignment('right').setFontColor(T.sub).setFontSize(9);
  const np = Math.max(1, ss_().getSheetByName('Inventario').getRange('A2:A').getValues().filter(r => r[0] !== '').length);
  const inv = ss_().getSheetByName('Inventario');
  chart_(sh, Charts.ChartType.COLUMN, [inv.getRange('A1:A' + (np + 1)), inv.getRange('C1:C' + (np + 1))], 12, 2, 1000, 250, {
    colors: [T.pri], legend: { position: 'none' }, bar: { groupWidth: '55%' },
    chartArea: { left: '6%', top: '8%', width: '92%', height: '68%' },
    vAxis: { format: '#,##0', viewWindow: { min: 0 }, gridlines: { color: '#EEF0F3', count: 5 }, textStyle: { color: T.mute, fontSize: 9 } }
  });
  for (let r = 12; r <= 22; r++) sh.setRowHeight(r, 24);
  sh.setRowHeight(23, 16);
  section_(sh, 24, 2, 8, '🗂️ Inventario valorizado');
  sh.getRange('J24:L24').merge().setValue('* si la app no tiene precio, se usa el último precio vendido').setHorizontalAlignment('right').setFontColor(T.mute).setFontSize(8);
  thead_(sh, 25, 2, ['Producto', 'Unidad', 'Existencias', 'Costo prom.', 'Precio venta*', 'Valor costo', 'Valor venta', 'Margen unit.', 'Margen %', 'Control', 'Semáforo']);
  sh.getRange('B26').setFormula(`=IF(COUNTA(Inventario!A2:A)=0,"Sin productos",ARRAYFORMULA(LET(n,FILTER(Inventario!A2:F,Inventario!A2:A<>""),s,CHOOSECOLS(n,3),c,CHOOSECOLS(n,4),v,IFERROR(VLOOKUP(CHOOSECOLS(n,1),${M}$U$2:$V,2,FALSE),0),um,${M}$B$3,HSTACK(CHOOSECOLS(n,1),CHOOSECOLS(n,2),s,c,IF(v>0,v,"—"),s*c,IF(v>0,s*v,0),IF(v>0,v-c,"—"),IF(v>0,(v-c)/v,"—"),CHOOSECOLS(n,6),IF(s<=0,"🚨 Agotado",IF(s<um,"⚠️ Bajo","✅ Óptimo"))))))`);
  tbody_(sh, 26, 2, 11, [null, null, INT, MONEY, MONEY, MONEY, MONEY, MONEY, PCT, null, null]);
  sh.setTabColor(T.pri2);
}

/* ======================= COMPRAS ======================= */
function buildCompras_() {
  const sh = resetSheet_('PANEL COMPRAS');
  widths_(sh, [88, 130, 84, 84, 85, 95, 88, 75, 130, 110, 40, 40]);
  header_(sh, '🛒 Compras y reposición', 'Entradas de granja, costos de reposición y control de lotes', 'PANEL COMPRAS');
  kpi_(sh, 7, 2, 2, 'COMPRAS DEL MES', `=${M}B11`, 'Inversión mensual', MONEY, T.pri);
  kpi_(sh, 7, 4, 2, 'COMPRAS TOTALES', `=${M}B21`, 'Histórico', MONEY, T.slate);
  kpi_(sh, 7, 6, 2, 'UNIDADES', `=${M}B34`, 'Volumen recibido', INT, T.blue);
  kpi_(sh, 7, 8, 2, 'PANALES', `=${M}B35`, 'Cubetas de 30', INT, T.teal);
  kpi_(sh, 7, 10, 2, 'COSTO UNIT. PROM.', `=IF(${M}B34>0,${M}B21/${M}B34,0)`, 'Ponderado', MONEY, T.violet);
  kpi_(sh, 7, 12, 2, 'POR VENCER', `=${M}B36`, 'Lotes en ≤ 7 días', INT, T.bad);
  sh.setRowHeight(10, 16);
  section_(sh, 11, 2, 7, '📥 Historial de compras (más recientes primero)');
  sh.getRange('I11:K11').merge().setFormula(`="Lotes: "&${M}B37`).setHorizontalAlignment('right').setFontColor(T.sub).setFontSize(9);
  thead_(sh, 12, 2, ['Fecha', 'Producto', 'Cantidad', 'Panales', 'Costo unit.', 'Total', 'Vence', 'Días granja', 'Notas', 'Estado lote']);
  sh.getRange('B13').setFormula('=IF(COUNTA(Compras!A2:A)=0,"Sin compras registradas",ARRAYFORMULA(LET(d,FILTER(Compras!A2:I,Compras!A2:A<>""),v,CHOOSECOLS(d,7),g,IFERROR(DATEVALUE(LEFT(v&"",10)),v),SORT(HSTACK(d,IF(v="","—",IF(g<TODAY(),"❌ Vencido",IF(g<=TODAY()+3,"⚠️ Vence pronto","✅ Vigente")))),1,FALSE))))');
  tbody_(sh, 13, 2, 10, [DATEF, null, INT, INT, MONEY, MONEY, DATEF, INT, null, null]);
  sh.getRange(13, 3, 987, 1).setFontWeight('bold');
  sh.setTabColor(T.pri2);
}

/* ======================= PROVEEDORES Y CUENTAS POR PAGAR ======================= */
function buildProveedores_() {
  const sh = resetSheet_('PANEL PROVEEDORES');
  widths_(sh, [150, 110, 100, 95, 110, 100, 105, 110, 100, 100, 40, 40]);
  header_(sh, '🧾 Proveedores y cuentas por pagar', 'Lo que se debe a las fincas, compras con saldo pendiente y pagos', 'PANEL PROVEEDORES');
  kpi_(sh, 7, 2, 3, 'DEBO A PROVEEDORES', `=${M}B40`, 'Saldo total por pagar', MONEY, T.bad);
  kpi_(sh, 7, 5, 3, 'PROVEEDORES CON DEUDA', `=${M}B41`, '=COUNTA(Proveedores!A2:A)&" registrados"', INT, T.warn);
  kpi_(sh, 7, 8, 3, 'COMPRAS PENDIENTES', `=${M}B43`, 'Con saldo por pagar', INT, T.violet);
  kpi_(sh, 7, 11, 3, 'SALDO A FAVOR', `=${M}B42`, 'Pagado en compras anuladas', MONEY, T.ok);
  sh.setRowHeight(10, 16);
  section_(sh, 11, 2, 5, '📇 Cuentas por pagar por proveedor (mayor deuda primero)');
  section_(sh, 11, 8, 6, '📊 Deuda por proveedor');
  thead_(sh, 12, 2, ['Proveedor', 'Teléfono', 'Deuda', 'Estado', 'Contacto']);
  // Hasta 15 proveedores; el resto se consulta en la hoja Proveedores. Así la tabla de abajo siempre tiene su espacio.
  sh.getRange('B13').setFormula('=IF(COUNTA(Proveedores!A2:A)=0,"Sin proveedores registrados",ARRAY_CONSTRAIN(ARRAYFORMULA(LET(c,SORT(FILTER(Proveedores!A2:C,Proveedores!A2:A<>""),3,FALSE),s,CHOOSECOLS(c,3),t,REGEXREPLACE(CHOOSECOLS(c,2)&"","\\D",""),HSTACK(CHOOSECOLS(c,1),CHOOSECOLS(c,2),s,IF(s>0,"🚨 Debe","✅ Al día"),IF(t="","—",HYPERLINK("https://wa.me/"&IF(LEN(t)=10,"57"&t,t),"💬 WhatsApp"))))),15,5))');
  tbody_(sh, 13, 2, 5, [null, '@', MONEY, null, null]);
  chart_(sh, Charts.ChartType.BAR, [motorR_('X2:Y12')], 12, 8, 480, 360, {
    colors: [T.bad], legend: { position: 'none' }, bar: { groupWidth: '60%' },
    chartArea: { left: '30%', top: '6%', width: '64%', height: '82%' },
    hAxis: { format: 'short', viewWindow: { min: 0 }, gridlines: { color: '#EEF0F3' }, textStyle: { color: T.mute, fontSize: 9 } },
    vAxis: { textStyle: { color: T.ink, fontSize: 9 } }
  });
  for (let r = 13; r <= 27; r++) sh.setRowHeight(r, 24);
  section_(sh, 30, 2, 7, '🧾 Compras con saldo pendiente (las más viejas primero)');
  thead_(sh, 31, 2, ['Fecha', 'Proveedor', 'Producto', 'Total', 'Pagado', 'Debe', 'Comprobante']);
  sh.getRange('B32').setFormula('=IFERROR(LET(d,FILTER(Compras!A2:M,Compras!A2:A<>"",Compras!L2:L>0),SORT(HSTACK(CHOOSECOLS(d,1),CHOOSECOLS(d,10),CHOOSECOLS(d,2),CHOOSECOLS(d,6),CHOOSECOLS(d,11),CHOOSECOLS(d,12),CHOOSECOLS(d,13)),1,TRUE)),"✅ No hay compras con saldo pendiente")');
  tbody_(sh, 32, 2, 7, [DATEF, null, null, MONEY, MONEY, MONEY, null]);
  sh.setTabColor(T.pri2);
}

/* ======================= CLIENTES ======================= */
function buildClientes_() {
  const sh = resetSheet_('PANEL CLIENTES');
  widths_(sh, [150, 105, 105, 170, 130, 105, 110, 100, 40, 40, 40, 40]);
  header_(sh, '👥 Clientes y cartera', 'Directorio, saldos pendientes y gestión de cobro por WhatsApp', 'PANEL CLIENTES');
  kpi_(sh, 7, 2, 2, 'CLIENTES', `=${M}B31`, 'Registrados', INT, T.dark2);
  kpi_(sh, 7, 4, 2, 'CARTERA TOTAL', `=${M}B19`, 'Saldo por cobrar', MONEY, T.warn);
  kpi_(sh, 7, 6, 1, 'CON SALDO', `=${M}B20`, 'Clientes', INT, T.bad);
  kpi_(sh, 7, 7, 2, 'DEUDA PROMEDIO', `=IF(${M}B20>0,${M}B19/${M}B20,0)`, 'Por cliente con saldo', MONEY, T.violet);
  sh.setRowHeight(10, 16);
  section_(sh, 11, 2, 7, '📇 Directorio y estado de cuenta (mayor saldo primero)');
  thead_(sh, 12, 2, ['Cliente', 'Teléfono', 'Saldo', 'Notas', 'Estado', 'Prioridad', 'Contacto']);
  sh.getRange('B13').setFormula('=IF(COUNTA(Clientes!A2:A)=0,"Sin clientes registrados",ARRAYFORMULA(LET(c,SORT(FILTER(Clientes!A2:D,Clientes!A2:A<>""),3,FALSE),s,CHOOSECOLS(c,3),t,REGEXREPLACE(CHOOSECOLS(c,2)&"","\\D",""),HSTACK(c,IF(s>0,"🚨 Saldo pendiente","✅ Al día"),IF(s>100000,"🔴 Alta",IF(s>0,"🟠 Media","🟢 Normal")),IF(t="","—",HYPERLINK("https://wa.me/"&IF(LEN(t)=10,"57"&t,t),"💬 WhatsApp"))))))');
  tbody_(sh, 13, 2, 7, [null, '@', MONEY, null, null, null, null]);
  sh.setTabColor(T.pri2);
}

/* ======================= PÉRDIDAS ======================= */
function buildPerdidas_() {
  const sh = resetSheet_('PANEL PÉRDIDAS');
  widths_(sh, [85, 125, 70, 85, 95, 100, 150, 74, 72, 72, 72, 72]);
  header_(sh, '⚠️ Pérdidas y mermas', 'Huevos rotos, vencimientos y ajustes de inventario', 'PANEL PÉRDIDAS');
  kpi_(sh, 7, 2, 2, 'PÉRDIDAS DEL MES', `=${M}B12`, 'Mes en curso', MONEY, T.bad);
  kpi_(sh, 7, 4, 2, 'ACUMULADAS', `=${M}B22`, 'Histórico', MONEY, T.slate);
  kpi_(sh, 7, 6, 2, 'UNIDADES DE BAJA', `=${M}B33`, `=${M}B38&" eventos"`, INT, T.warn);
  kpi_(sh, 7, 8, 2, '% SOBRE VENTAS', `=IF(${M}B13>0,${M}B22/${M}B13,0)`, 'Impacto en ingresos', PCT, T.violet);
  sh.setRowHeight(10, 16);
  section_(sh, 11, 2, 7, '🧾 Registro de mermas');
  section_(sh, 11, 9, 5, '🍩 Por motivo');
  thead_(sh, 12, 2, ['Fecha', 'Producto', 'Cantidad', 'Costo unit.', 'Impacto $', 'Motivo', 'Acción sugerida']);
  sh.getRange('B13').setFormula('=IF(COUNTA(\'Pérdidas\'!A2:A)=0,"Sin pérdidas registradas",ARRAYFORMULA(LET(d,FILTER(\'Pérdidas\'!A2:E,\'Pérdidas\'!A2:A<>""),m,LOWER(CHOOSECOLS(d,5)&""),SORT(HSTACK(CHOOSECOLS(d,1),CHOOSECOLS(d,2),CHOOSECOLS(d,3),CHOOSECOLS(d,4),CHOOSECOLS(d,3)*CHOOSECOLS(d,4),CHOOSECOLS(d,5),IF(REGEXMATCH(m,"rot|quebr|da[ñn]"),"Revisar transporte / empaque",IF(REGEXMATCH(m,"venc"),"Rotar lotes (FIFO)","Auditar inventario"))),1,FALSE))))');
  tbody_(sh, 13, 2, 7, [DATEF, null, INT, MONEY, MONEY, null, null]);
  chart_(sh, Charts.ChartType.PIE, [motorR_('K2:L12')], 12, 9, 350, 290, {
    pieHole: 0.6, colors: [T.bad, T.warn, T.violet, T.blue, T.slate], pieSliceText: 'none',
    legend: { position: 'bottom', textStyle: { color: T.ink, fontSize: 9 } },
    chartArea: { left: '4%', top: '6%', width: '92%', height: '74%' }
  });
  sh.setTabColor(T.pri2);
}

/* ======================= REPORTES ======================= */
function buildReportes_() {
  const sh = resetSheet_('REPORTES');
  header_(sh, '📑 Estado de resultados', 'Informe consolidado · financiero, comercial y operativo', 'REPORTES');
  const pct = x => `=IF(${M}B13>0,(${x})/${M}B13,0)`;
  let r = 7;
  const group = t => {
    sh.getRange(r, 2, 1, 12).setBackground(T.dark2);
    sh.getRange(r, 2, 1, 6).merge().setValue(t).setFontColor('#FFFFFF').setFontWeight('bold');
    sh.getRange(r, 8, 1, 2).merge().setValue('Valor').setFontColor('#FFFFFF').setHorizontalAlignment('right').setFontWeight('bold');
    sh.getRange(r, 10).setValue('% ventas').setFontColor('#FFFFFF').setHorizontalAlignment('right').setFontWeight('bold');
    sh.getRange(r, 11, 1, 3).merge().setValue('Nota').setFontColor('#FFFFFF').setFontWeight('bold');
    sh.setRowHeight(r, 30); r++;
  };
  const line = (t, f, p, note, total) => {
    const bg = total ? '#FFF4EC' : '#FFFFFF';
    sh.getRange(r, 2, 1, 12).setBackground(bg).setBorder(null, null, true, null, null, null, T.line, B.SOLID);
    sh.getRange(r, 2, 1, 6).merge().setValue(t).setFontWeight(total ? 'bold' : 'normal');
    sh.getRange(r, 8, 1, 2).merge().setFormula(f).setNumberFormat(MONEY).setHorizontalAlignment('right').setFontWeight(total ? 'bold' : 'normal');
    const pc = sh.getRange(r, 10);
    if (p) pc.setFormula(p).setNumberFormat(PCT); else pc.setValue('—');
    pc.setHorizontalAlignment('right').setFontColor(T.sub);
    sh.getRange(r, 11, 1, 3).merge().setValue(note).setFontColor(T.mute).setFontSize(8);
    sh.setRowHeight(r, 28); r++;
  };
  group('1. INGRESOS');
  line('(+) Ventas brutas', `=${M}B13`, pct(`${M}B13`), 'Total facturado en la app');
  line('(−) Devoluciones / rebajas', '=0', pct('0'), 'No registradas');
  line('(=) Ingresos netos', `=${M}B13`, pct(`${M}B13`), 'Base de liquidación', true);
  r++;
  group('2. COSTO DE MERCANCÍA');
  line('(−) Costo de lo vendido (CMV)', `=${M}B14`, pct(`${M}B14`), 'Cantidad vendida × costo al momento de la venta');
  line('(=) Utilidad bruta', `=${M}B15`, pct(`${M}B15`), 'Antes de mermas', true);
  r++;
  group('3. MERMAS Y PÉRDIDAS');
  line('(−) Rotura, vencimiento y ajustes', `=${M}B22`, pct(`${M}B22`), 'Bajas registradas');
  line('(=) Utilidad operacional estimada', `=${M}B15-${M}B22`, pct(`${M}B15-${M}B22`), 'Excedente del período', true);
  r++;
  group('4. LIQUIDEZ, ACTIVOS Y DEUDAS');
  line('Recaudo en caja y bancos', `=${M}B17`, null, 'Dinero ya recibido');
  line('Cartera por cobrar', `=${M}B19`, null, 'Saldos de clientes');
  line('Inventario al costo', `=${M}B23`, null, 'Mercancía en bodega');
  line('(=) Activo corriente operativo', `=${M}B17+${M}B19+${M}B23`, null, 'Capital circulante', true);
  line('(−) Cuentas por pagar a proveedores', `=${M}B40`, null, 'Compras sin pagar del todo');
  line('(=) Capital de trabajo neto', `=${M}B17+${M}B19+${M}B23-${M}B40`, null, 'Activo operativo menos deudas a las fincas', true);
  r += 2;
  sh.getRange(r, 2, 1, 5).merge().setValue('Gerencia: ______________________').setFontColor(T.sub);
  sh.getRange(r, 8, 1, 6).merge().setValue('Control operativo: ______________________').setFontColor(T.sub);
  r++;
  sh.getRange(r, 2, 1, 5).merge().setFormula('="Fecha de corte: "&TEXT(TODAY(),"dd/mm/yyyy")').setFontColor(T.sub);
  sh.setTabColor(T.pri2);
}

/* ======================= hojas de datos (solo estilo) ======================= */
function styleData_() {
  ['Inventario', 'Ventas', 'Compras', 'Proveedores', 'Clientes', 'Pérdidas'].forEach(n => {
    const sh = ss_().getSheetByName(n); if (!sh) return;
    const lc = Math.max(sh.getLastColumn(), 1);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, lc).setBackground(T.dark2).setFontColor('#FFFFFF').setFontWeight('bold');
    sh.setTabColor('#98A2B3');
  });
}

function ordenar_() {
  const ss = ss_();
  const order = NAV.map(n => n[1]).concat(['Inventario', 'Ventas', 'Compras', 'Proveedores', 'Clientes', 'Pérdidas', '_MOTOR_CALCULOS']);
  order.forEach((n, i) => {
    const sh = ss.getSheetByName(n); if (!sh) return;
    ss.setActiveSheet(sh); ss.moveActiveSheet(i + 1);
  });
}
