from pathlib import Path
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'outputs/management/老子道学书院_技术架构说明_管理层阅读版.docx'
SOURCE = ROOT / 'docs/35-technical-overview-for-management.md'
doc = Document()
section = doc.sections[0]
section.page_width, section.page_height = Inches(8.5), Inches(11)
section.top_margin = section.bottom_margin = Inches(.7)
section.left_margin = section.right_margin = Inches(.8)
section.header_distance = section.footer_distance = Inches(.3)
grid = section._sectPr.find(qn('w:docGrid'))
if grid is not None:
    section._sectPr.remove(grid)


def set_font(style, size, bold=False):
    style.font.name = 'Microsoft YaHei'
    style.font.size = Pt(size)
    style.font.bold = bold
    style.font.color.rgb = RGBColor(0, 0, 0)
    style.element.get_or_add_rPr().rFonts.set(qn('w:eastAsia'), '微软雅黑')
    for attr in ['asciiTheme', 'hAnsiTheme', 'eastAsiaTheme', 'cstheme']:
        style.element.rPr.rFonts.attrib.pop(qn('w:' + attr), None)
    ppr = style.element.get_or_add_pPr()
    snap = OxmlElement('w:snapToGrid')
    snap.set(qn('w:val'), '0')
    ppr.append(snap)
    border = ppr.find(qn('w:pBdr'))
    if border is not None:
        ppr.remove(border)


set_font(doc.styles['Normal'], 11)
doc.styles['Normal'].paragraph_format.line_spacing = Pt(17)
doc.styles['Normal'].paragraph_format.space_after = Pt(7)
set_font(doc.styles['Title'], 24, True)
doc.styles['Title'].paragraph_format.space_after = Pt(9)
doc.styles['Title'].paragraph_format.line_spacing = Pt(30)
for name, size in [('Heading 1', 16), ('Heading 2', 12)]:
    set_font(doc.styles[name], size, True)
    doc.styles[name].paragraph_format.space_before = Pt(12)
    doc.styles[name].paragraph_format.space_after = Pt(7)
    doc.styles[name].paragraph_format.keep_with_next = True
    doc.styles[name].paragraph_format.line_spacing = Pt(size + 5)

header = section.header.paragraphs[0]
header.text = '老子道学书院   技术说明'
header.runs[0].font.size = Pt(9)
header.runs[0].font.color.rgb = RGBColor(0, 0, 0)
footer = section.footer.paragraphs[0]
footer.alignment = WD_ALIGN_PARAGRAPH.RIGHT
footer.add_run('管理层阅读版  ·  第 ')
field = OxmlElement('w:fldSimple')
field.set(qn('w:instr'), 'PAGE')
footer._p.append(field)
footer.add_run(' 页')
for run in footer.runs:
    run.font.size = Pt(9)

md = []


def heading(text, level=1):
    doc.add_heading(text, level=level)
    md.append('#' * (level + 1) + ' ' + text + '\n')


def para(text, lead=None):
    p = doc.add_paragraph()
    if lead and text.startswith(lead):
        p.add_run(lead).bold = True
        p.add_run(text[len(lead):])
    else:
        p.add_run(text)
    md.append(text + '\n')
    return p


def table(headers, rows, widths):
    t = doc.add_table(rows=1, cols=len(headers))
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False
    for col, width in zip(t.columns, widths):
        col.width = Inches(width)
    for cell, text, width in zip(t.rows[0].cells, headers, widths):
        cell.text = text
        cell.width = Inches(width)
    for row in rows:
        cells = t.add_row().cells
        for cell, text, width in zip(cells, row, widths):
            cell.text = text
            cell.width = Inches(width)
    borders = OxmlElement('w:tblBorders')
    for edge in ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']:
        elem = OxmlElement('w:' + edge)
        for k, v in [('val', 'single'), ('sz', '4'), ('color', 'D9D9D9')]:
            elem.set(qn('w:' + k), v)
        borders.append(elem)
    t._tbl.tblPr.append(borders)
    for i, row in enumerate(t.rows):
        if i == 0:
            repeat = OxmlElement('w:tblHeader')
            row._tr.get_or_add_trPr().append(repeat)
        cant_split = OxmlElement('w:cantSplit')
        row._tr.get_or_add_trPr().append(cant_split)
        for j, cell in enumerate(row.cells):
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            tcpr = cell._tc.get_or_add_tcPr()
            margins = OxmlElement('w:tcMar')
            for edge, val in [('top', 95), ('bottom', 95), ('left', 100), ('right', 100)]:
                el = OxmlElement('w:' + edge)
                el.set(qn('w:w'), str(val))
                el.set(qn('w:type'), 'dxa')
                margins.append(el)
            tcpr.append(margins)
            if i == 0:
                shade = OxmlElement('w:shd')
                shade.set(qn('w:fill'), 'E8EDF0')
                tcpr.append(shade)
            for p in cell.paragraphs:
                p.paragraph_format.space_after = Pt(0)
                p.paragraph_format.line_spacing = Pt(15)
                if j == 0:
                    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                for run in p.runs:
                    run.font.size = Pt(10)
                    run.font.bold = i == 0
    md.append('| ' + ' | '.join(headers) + ' |')
    md.append('| ' + ' | '.join(['---'] * len(headers)) + ' |')
    md.extend('| ' + ' | '.join(row) + ' |' for row in rows)
    md.append('')
    spacer = doc.add_paragraph()
    spacer.paragraph_format.space_after = Pt(0)
    spacer.paragraph_format.line_spacing = Pt(3)


def page():
    doc.add_page_break()
    md.append('')



from management_technical_content import write_content

write_content(doc, md, heading, para, table, page)
doc.core_properties.title = '老子道学书院技术说明'
doc.core_properties.subject = '管理层阅读版 技术架构 选型 数据处理 内容交付 安全与部署'
doc.core_properties.author = '道学书院项目'
OUT.parent.mkdir(parents=True, exist_ok=True)
doc.save(OUT)
SOURCE.write_text('\n'.join(md), encoding='utf-8')
print(OUT)
