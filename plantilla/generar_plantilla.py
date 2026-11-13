"""Genera la plantilla de Excel / Google Sheets de El Gallinero.

Uso (requiere `pip install openpyxl`):

    python plantilla/generar_plantilla.py          # genera plantilla/El-Gallinero-plantilla.xlsx
    python plantilla/generar_plantilla.py --check  # falla (código 1) si el .xlsx versionado no coincide con Code.gs

Las pestañas y columnas salen de apps-script/Code.gs (única fuente de verdad), así que la plantilla
nunca se desincroniza del script que escribe los datos. Si cambias las columnas en Code.gs, vuelve a generar.
"""
import re
import io
import sys
import zipfile
from datetime import datetime
from pathlib import Path

from openpyxl import Workbook
from openpyxl.formatting.rule import CellIsRule, FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

RAIZ = Path(__file__).resolve().parent.parent
SALIDA = RAIZ / "plantilla" / "El-Gallinero-plantilla.xlsx"
VERSION_PLANTILLA = 1
FECHA_FIJA = datetime(2026, 1, 1)  # fecha constante en las propiedades: el binario es reproducible
FILAS = 2000  # filas con formato listo (la hoja crece sola si hay más datos)

# Paleta del logo
TINTA, VERDE, SOL, NARANJA, CREMA = "1D1712", "245F50", "F7BB24", "EF7621", "FBF1DC"
ROJO_SUAVE, AMARILLO_SUAVE, VERDE_SUAVE = "F9D9D2", "FDECC0", "D8EBE2"

DINERO = '"$"#,##0'
ENTERO = "#,##0"
FECHA = "dd/mm/yyyy"
FORMATOS = {
    "Fecha": FECHA, "Vence": FECHA,
    "Precio": DINERO, "Total": DINERO, "Abonado": DINERO, "Debe": DINERO, "Deuda": DINERO,
    "Costo promedio": DINERO, "Precio de venta": DINERO, "Costo unitario": DINERO,
    "Cantidad": ENTERO, "Existencias": ENTERO, "Panales": ENTERO, "Días en granja": ENTERO,
    "Teléfono": "@",
}
ANCHOS = {
    "Fecha": 13, "Vence": 13, "Producto": 26, "Cliente": 28, "Unidad": 11, "Notas": 32, "Motivo": 30,
    "Control de frescura": 20, "Teléfono": 18, "Pago": 11, "Días en granja": 15,
}


def leer_contrato():
    """Pestañas y cabeceras tal como las escribe Code.gs: (pestañas espejo, cabecera de «Importar clientes»)."""
    codigo = (RAIZ / "apps-script" / "Code.gs").read_text(encoding="utf-8")
    contrato = []
    for nombre, cab in re.findall(r"escribirHoja_\('([^']+)',\s*\[([^\]]*)\]", codigo):
        contrato.append((nombre, re.findall(r"'([^']*)'", cab)))
    if not contrato:
        sys.exit("No encontré las pestañas en apps-script/Code.gs")
    m = re.search(r"const HOJA_IMPORTAR\s*=\s*\[([^\]]*)\]", codigo)
    importar = re.findall(r"'([^']*)'", m.group(1)) if m else []
    if not importar:
        sys.exit("No encontré HOJA_IMPORTAR en apps-script/Code.gs")
    return contrato, importar


def borde():
    lado = Side(style="thin", color="E5D3AD")
    return Border(bottom=lado)


def estilo_cabecera(ws, cabecera, fondo, color_texto):
    n = len(cabecera)
    for c in range(1, n + 1):
        celda = ws.cell(row=1, column=c, value=cabecera[c - 1])
        celda.font = Font(name="Arial", bold=True, color=color_texto, size=11)
        celda.fill = PatternFill("solid", fgColor=fondo)
        celda.alignment = Alignment(vertical="center", horizontal="left", indent=1)
    ws.row_dimensions[1].height = 26
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:{get_column_letter(n)}1"


def formato_cuerpo(ws, cabecera):
    for c, nombre in enumerate(cabecera, start=1):
        ws.column_dimensions[get_column_letter(c)].width = ANCHOS.get(nombre, 15)
        fmt = FORMATOS.get(nombre)
        for r in range(2, FILAS + 2):
            celda = ws.cell(row=r, column=c)
            celda.font = Font(name="Arial", size=10, color=TINTA)
            celda.border = borde()
            if fmt:
                celda.number_format = fmt
            if fmt in (DINERO, ENTERO):
                celda.alignment = Alignment(horizontal="right")
    ultima = get_column_letter(len(cabecera))
    # Filas alternas en crema, solo si la fila tiene algo
    ws.conditional_formatting.add(
        f"A2:{ultima}{FILAS + 1}",
        FormulaRule(formula=['AND($A2<>"",MOD(ROW(),2)=0)'], fill=PatternFill("solid", bgColor=CREMA, fgColor=CREMA)),
    )


def hoja_datos(wb, nombre, cabecera):
    ws = wb.create_sheet(nombre)
    ws.sheet_properties.tabColor = VERDE
    estilo_cabecera(ws, cabecera, VERDE, "FFFFFF")
    formato_cuerpo(ws, cabecera)
    rojo = PatternFill("solid", bgColor=ROJO_SUAVE, fgColor=ROJO_SUAVE)
    amarillo = PatternFill("solid", bgColor=AMARILLO_SUAVE, fgColor=AMARILLO_SUAVE)
    fuente_roja = Font(name="Arial", size=10, bold=True, color="8A2A1B")

    def col(n):
        return get_column_letter(cabecera.index(n) + 1)

    if nombre == "Ventas" and "Debe" in cabecera:
        c = col("Debe")
        ws.conditional_formatting.add(f"{c}2:{c}{FILAS + 1}", CellIsRule(operator="greaterThan", formula=["0"], fill=rojo, font=fuente_roja))
    if nombre == "Clientes" and "Deuda" in cabecera:
        c = col("Deuda")
        ws.conditional_formatting.add(f"{c}2:{c}{FILAS + 1}", CellIsRule(operator="greaterThan", formula=["0"], fill=rojo, font=fuente_roja))
    if nombre == "Inventario" and "Existencias" in cabecera:
        c = col("Existencias")
        ws.conditional_formatting.add(f"{c}2:{c}{FILAS + 1}", FormulaRule(formula=[f'AND({c}2<>"",{c}2<=0)'], fill=rojo, font=fuente_roja))
    if nombre == "Compras" and "Vence" in cabecera:
        c = col("Vence")
        ws.conditional_formatting.add(f"{c}2:{c}{FILAS + 1}", FormulaRule(formula=[f'AND({c}2<>"",{c}2<TODAY())'], fill=rojo, font=fuente_roja))
        ws.conditional_formatting.add(f"{c}2:{c}{FILAS + 1}", FormulaRule(formula=[f'AND({c}2<>"",{c}2-TODAY()<=7)'], fill=amarillo))
    return ws


def hoja_importar_clientes(wb, cab):
    ws = wb.create_sheet("Importar clientes")
    ws.sheet_properties.tabColor = NARANJA
    estilo_cabecera(ws, cab, NARANJA, TINTA)
    for c, ancho in zip("ABC", (32, 20, 38)):  # las tres columnas de HOJA_IMPORTAR
        ws.column_dimensions[c].width = ancho
    for r in range(2, FILAS + 2):
        for c in range(1, 4):
            celda = ws.cell(row=r, column=c)
            celda.font = Font(name="Arial", size=10, color=TINTA)
            celda.border = borde()
            if c == 2:
                celda.number_format = "@"  # texto: conserva el + y los ceros del teléfono
    ws.column_dimensions["D"].width = 3
    ws.column_dimensions["E"].width = 62
    nota = [
        ("Aquí llenas tú los clientes", True),
        ("Pega tus contactos en las columnas A (nombre), B (teléfono) y C (notas), desde la fila 2.", False),
        ("En la app: Más → Google Sheets → «Traer clientes del Sheet».", False),
        ("No se duplican: un cliente es el mismo si coincide el teléfono o, sin teléfono, el nombre.", False),
        ("Las filas sin nombre se ignoran. Puedes volver a pegar la lista completa cuando quieras.", False),
        ("Esta es la única pestaña que se llena a mano; las demás las escribe la app.", False),
    ]
    for i, (texto, negrita) in enumerate(nota, start=1):
        c = ws.cell(row=i, column=5, value=texto)
        c.font = Font(name="Arial", size=10, bold=negrita, color=TINTA)
        c.alignment = Alignment(wrap_text=True, vertical="top")
        c.fill = PatternFill("solid", fgColor=CREMA)
    return ws


def hoja_instrucciones(wb, contrato, importar):
    ws = wb.active
    ws.title = "Instrucciones"
    ws.sheet_properties.tabColor = SOL
    ws.sheet_view.showGridLines = False
    for c, ancho in zip("ABCD", (24, 22, 24, 64)):
        ws.column_dimensions[c].width = ancho
    ws.merge_cells("A1:D1")
    t = ws["A1"]
    t.value = "El Gallinero · plantilla de datos"
    t.font = Font(name="Arial", size=20, bold=True, color=SOL)
    t.fill = PatternFill("solid", fgColor=TINTA)
    t.alignment = Alignment(vertical="center", indent=1)
    ws.row_dimensions[1].height = 44
    ws.merge_cells("A2:D2")
    ws["A2"].value = f"frescura y calidad · versión de la plantilla: {VERSION_PLANTILLA}"
    ws["A2"].font = Font(name="Arial", size=10, italic=True, color=TINTA)
    ws["A2"].alignment = Alignment(indent=1)

    def titulo(fila, texto):
        c = ws.cell(row=fila, column=1, value=texto)
        c.font = Font(name="Arial", size=13, bold=True, color=VERDE)
        ws.row_dimensions[fila].height = 24

    def linea(fila, texto, negrita=False):
        ws.merge_cells(start_row=fila, start_column=1, end_row=fila, end_column=4)
        c = ws.cell(row=fila, column=1, value=texto)
        c.font = Font(name="Arial", size=10, bold=negrita, color=TINTA)
        c.alignment = Alignment(wrap_text=True, vertical="top", indent=1)
        ws.row_dimensions[fila].height = 30 if len(texto) > 95 else 18

    titulo(4, "Cómo se usa")
    pasos = [
        "1. Extensiones → Apps Script: pega el script de la app (en la app: Más → Google Sheets → «Copiar el script») y cambia la clave de la primera línea.",
        "2. Implementar → Nueva implementación → Aplicación web (Ejecutar como: Yo · Acceso: Cualquier persona). Copia la URL que termina en /exec.",
        "3. En la app: Más → Google Sheets: pega la URL y la clave y pulsa Conectar. Desde ahí cada venta, compra y cliente se copia aquí sola.",
        "4. Para cargar tus clientes: pégalos en la pestaña «Importar clientes» y, en la app, pulsa «Traer clientes del Sheet».",
    ]
    for i, p in enumerate(pasos):
        linea(5 + i, p)

    titulo(10, "Reglas para que nada falle")
    reglas = [
        "• No cambies el nombre de las pestañas ni el orden de las columnas: la app las busca por nombre.",
        "• No escribas a mano en las pestañas Inventario, Ventas, Compras, Proveedores, Clientes y Pérdidas: se reescriben en cada envío. Los cambios se hacen en la app.",
        "• Sí puedes añadir columnas a la derecha de cada tabla, otras pestañas, fórmulas, gráficos y paneles: la app no los toca.",
        "• Las pestañas ocultas _respaldo y _respaldo_anterior guardan la copia completa para restaurar. No las borres.",
    ]
    for i, r in enumerate(reglas):
        linea(11 + i, r)

    titulo(16, "Qué hay en cada pestaña")
    for c, texto in enumerate(("Pestaña", "La llena", "Se edita a mano", "Columnas"), start=1):
        cab = ws.cell(row=17, column=c, value=texto)
        cab.font = Font(name="Arial", bold=True, color="FFFFFF", size=10)
        cab.fill = PatternFill("solid", fgColor=VERDE)
        cab.alignment = Alignment(indent=1)
    filas = [("Importar clientes", "Tú", "Sí", " · ".join(importar))]
    filas += [(n, "La app", "No", " · ".join(cab)) for n, cab in contrato]
    for i, (a, b, c_, d) in enumerate(filas):
        for col, valor in enumerate((a, b, c_, d), start=1):
            cel = ws.cell(row=18 + i, column=col, value=valor)
            cel.font = Font(name="Arial", size=10, bold=(col == 1), color=TINTA)
            cel.alignment = Alignment(wrap_text=True, vertical="top", indent=1)
            cel.border = borde()
            if i % 2 == 0:
                cel.fill = PatternFill("solid", fgColor=CREMA)
        ws.row_dimensions[18 + i].height = 30


def construir():
    """Arma el libro completo en memoria a partir del contrato de Code.gs."""
    contrato, importar = leer_contrato()
    wb = Workbook()
    hoja_instrucciones(wb, contrato, importar)
    hoja_importar_clientes(wb, importar)
    for nombre, cab in contrato:
        hoja_datos(wb, nombre, cab)
    wb.properties.title = "El Gallinero · plantilla"
    wb.properties.creator = "El Gallinero"
    wb.properties.created = FECHA_FIJA
    wb.properties.modified = FECHA_FIJA
    return wb, contrato, importar


def cabeceras(wb):
    """{pestaña: valores de la fila 1} (sin celdas vacías al final)."""
    resultado = {}
    for ws in wb.worksheets:
        fila = [c.value for c in ws[1]]
        while fila and fila[-1] is None:
            fila.pop()
        resultado[ws.title] = fila
    return resultado


def comprobar():
    """Compara las pestañas y cabeceras del .xlsx versionado con las que saldrían de Code.gs."""
    from openpyxl import load_workbook

    esperado, _, _ = construir()
    if not SALIDA.exists():
        print(f"Falta {SALIDA}", file=sys.stderr)
        return 1
    actual = load_workbook(SALIDA)
    a, e = cabeceras(actual), cabeceras(esperado)
    if a == e:
        print("La plantilla coincide con apps-script/Code.gs")
        return 0
    print("La plantilla NO coincide con apps-script/Code.gs; vuelve a generarla con `python plantilla/generar_plantilla.py`.", file=sys.stderr)
    for nombre in sorted(set(a) | set(e)):
        if a.get(nombre) != e.get(nombre):
            print(f"  {nombre}: plantilla={a.get(nombre)} · Code.gs={e.get(nombre)}", file=sys.stderr)
    return 1


def guardar_reproducible(wb, destino):
    """Guarda el libro con la fecha de cada entrada del zip fija: el mismo contrato produce el mismo binario."""
    memoria = io.BytesIO()
    wb.save(memoria)
    memoria.seek(0)
    with zipfile.ZipFile(memoria) as origen, zipfile.ZipFile(destino, "w", zipfile.ZIP_DEFLATED) as nuevo:
        for info in origen.infolist():
            entrada = zipfile.ZipInfo(info.filename, date_time=FECHA_FIJA.timetuple()[:6])
            entrada.compress_type = zipfile.ZIP_DEFLATED
            entrada.external_attr = info.external_attr
            datos = origen.read(info.filename)
            if info.filename == "docProps/core.xml":
                # openpyxl pone la hora actual en «modified» al guardar: se vuelve a fijar.
                fija = FECHA_FIJA.strftime("%Y-%m-%dT%H:%M:%SZ").encode()
                datos = re.sub(rb"(<dcterms:modified[^>]*>)[^<]*", rb"\g<1>" + fija, datos)
            nuevo.writestr(entrada, datos)


def main():
    if "--check" in sys.argv[1:]:
        sys.exit(comprobar())
    wb, contrato, _ = construir()
    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    guardar_reproducible(wb, SALIDA)
    print(f"Plantilla creada: {SALIDA}")
    for nombre, cab in contrato:
        print(f"  {nombre}: {' | '.join(cab)}")


if __name__ == "__main__":
    main()
