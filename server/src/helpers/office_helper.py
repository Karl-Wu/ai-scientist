"""Bounded OOXML inspection and validation for previews and the browser Office suite.
The host owns snapshots, conflict checks and atomic replacement.
"""
import io
import json
import math
import posixpath
import re
import sys
import zipfile
from pathlib import Path
from lxml import etree as E
from tables_helper import MAX_CELL, MAX_COLS, MAX_ROWS, xlsx as preview_xlsx

NS = {
    'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
    'p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
    's': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
}
MAX_ZIP = 32 * 1024 * 1024
MAX_EXPANDED = 64 * 1024 * 1024
MAX_FIELDS = 10000
MAX_INLINE_RANGES = 2_000


def xml(data):
    # No entities, DTDs, network, recovery, or huge trees, including internal entities.
    tree = E.fromstring(data, E.XMLParser(resolve_entities=False, no_network=True, load_dtd=False))
    if tree.getroottree().docinfo.doctype:
        raise ValueError('Documents containing XML DTDs are not supported')
    return tree


def q(ns, name):
    return '{' + NS[ns] + '}' + name


class Package:
    def __init__(self, filename, kind):
        with open(filename, 'rb') as f:
            raw = f.read(MAX_ZIP + 1)
        if len(raw) > MAX_ZIP:
            raise ValueError('Office files are limited to 32 MiB')
        self.z = zipfile.ZipFile(io.BytesIO(raw))
        infos = self.z.infolist()
        if len(infos) > 10000 or sum(i.file_size for i in infos) > MAX_EXPANDED:
            raise ValueError('Expanded Office content exceeds the 64 MiB preview limit')
        names = [i.filename for i in infos]
        if len(set(names)) != len(names) or any(i.flag_bits & 1 for i in infos):
            raise ValueError('Encrypted or ambiguous Office packages are not supported')
        self.names = set(names)
        required = {'docx': 'word/document.xml', 'pptx': 'ppt/presentation.xml', 'xlsx': 'xl/workbook.xml'}[kind]
        if required not in self.names:
            raise ValueError('This file is not a supported ' + kind.upper() + ' document (encrypted files are unsupported)')
        self.kind = kind
        self.signed = any(n.startswith('_xmlsignatures/') for n in names)
        # Validate XML before handing the package to a native parser in WASM.
        if '[Content_Types].xml' not in self.names:
            raise ValueError('Missing Office content types')
        for name in names:
            if name.endswith(('.xml', '.rels')):
                self.tree(name)
        expected = {'docx': q('w', 'document'), 'pptx': q('p', 'presentation'), 'xlsx': q('s', 'workbook')}[kind]
        strict = expected.replace('http://schemas.openxmlformats.org/', 'http://purl.oclc.org/ooxml/').replace('/2006/main', '/main')
        if self.tree(required).tag not in (expected, strict):
            raise ValueError('Office document type does not match its extension')

    def tree(self, name):
        return xml(self.z.read(name))

    def rels(self, name):
        rp = posixpath.join(posixpath.dirname(name), '_rels', posixpath.basename(name) + '.rels')
        if rp not in self.names:
            return {}
        return {r.get('Id'): posixpath.normpath(posixpath.join(posixpath.dirname(name), r.get('Target', ''))).lstrip('/')
                if not r.get('Target', '').startswith('/') else r.get('Target').lstrip('/')
                for r in self.tree(rp) if r.get('TargetMode') != 'External'}


def text_parts(pkg):
    if pkg.kind == 'docx':
        parts = [('Document', 'word/document.xml')]
        parts += [(posixpath.basename(n).replace('.xml', ''), n) for n in sorted(pkg.names)
                  if re.fullmatch(r'word/(header\d+|footer\d+|footnotes|endnotes)\.xml', n)]
        return parts
    tree = pkg.tree('ppt/presentation.xml')
    rels = pkg.rels('ppt/presentation.xml')
    parts = []
    if len(tree.findall('p:sldIdLst/p:sldId', NS)) > 500:
        raise ValueError('Presentations are limited to 500 slides')
    for i, slide in enumerate(tree.findall('p:sldIdLst/p:sldId', NS)):
        part = rels.get(slide.get(q('r', 'id')))
        if part not in pkg.names:
            raise ValueError('Missing slide relationship')
        parts.append((f'Slide {i + 1}', part))
        for note in pkg.rels(part).values():
            if re.fullmatch(r'ppt/notesSlides/notesSlide\d+\.xml', note):
                parts.append((f'Slide {i + 1} notes', note))
    return parts


def text_model(pkg):
    ns = 'w' if pkg.kind == 'docx' else 'a'
    groups, lookup = [], {}
    protected = pkg.signed
    if pkg.kind == 'docx' and 'word/settings.xml' in pkg.names:
        for dp in pkg.tree('word/settings.xml').findall('w:documentProtection', NS):
            protected |= dp.get(q('w', 'enforcement')) in ('1', 'true', 'on')
    for label, part in text_parts(pkg):
        root = pkg.tree(part)
        nodes = list(root.iter(q(ns, 't')))
        for index, node in enumerate(nodes):
            lookup[f'{part}#{index}'] = (root, node, part)
        indices = {node: i for i, node in enumerate(nodes)}
        fields = []
        for pi, paragraph in enumerate(root.iter(q(ns, 'p'))):
            runs = []
            for node in paragraph.iter(q(ns, 't')):
                if node not in indices:
                    continue
                props = node.getparent().find(q(ns, 'rPr'))
                def flag(name):
                    if props is None:
                        return False
                    if ns == 'a':
                        return props.get(name) in ('1', 'true')
                    el = props.find(q(ns, name))
                    return el is not None and el.get(q(ns, 'val'), '1') not in ('0', 'false', 'off', 'none')
                runs.append({'id': f'{part}#{indices[node]}', 'text': node.text or '',
                             'bold': flag('b'), 'italic': flag('i')})
            if runs:
                fields.append({'label': f'Paragraph {pi + 1}', 'runs': runs})
        groups.append({'label': label, 'paragraphs': fields})
    if len(lookup) > MAX_FIELDS:
        raise ValueError('Document exceeds the 10,000 text-run preview limit')
    return {'kind': pkg.kind, 'groups': groups, 'readOnly': bool(protected)}, lookup


def col_number(name):
    value = 0
    for c in name:
        value = value * 26 + ord(c) - 64
    return value


def col_name(value):
    result = ''
    while value:
        value, rem = divmod(value - 1, 26)
        result = chr(65 + rem) + result
    return result


def address(ref):
    m = re.fullmatch(r'([A-Z]{1,3})([1-9][0-9]{0,6})', ref or '')
    if not m or col_number(m[1]) > 16384 or int(m[2]) > 1048576:
        raise ValueError('Invalid cell address')
    return int(m[2]), col_number(m[1])


def in_range(ref, span):
    try:
        a, _, b = span.partition(':')
        r, c = address(ref)
        r1, c1 = address(a.replace('$', ''))
        r2, c2 = address((b or a).replace('$', ''))
        return r1 <= r <= r2 and c1 <= c <= c2
    except ValueError:
        return False


def sheets(pkg):
    book = pkg.tree('xl/workbook.xml')
    rels = pkg.rels('xl/workbook.xml')
    result = []
    for sheet in book.findall('s:sheets/s:sheet', NS):
        part = rels.get(sheet.get(q('r', 'id')))
        if part and part.startswith('xl/worksheets/') and part in pkg.names:
            result.append({'name': sheet.get('name'), 'part': part, 'hidden': sheet.get('state', 'visible') != 'visible'})
    if not result:
        raise ValueError('Workbook has no worksheets')
    if len(result) > 500:
        raise ValueError('Workbook exceeds the 500-sheet preview limit')
    return result


def protected_ranges(root):
    return [f.get('ref') for f in root.findall('.//s:f', NS) if f.get('ref') and f.get('t') in ('array', 'shared', 'dataTable')]


def cell_styles(pkg):
    from openpyxl.styles.numbers import BUILTIN_FORMATS
    if 'xl/styles.xml' not in pkg.names:
        return []
    root = pkg.tree('xl/styles.xml')
    formats = dict(BUILTIN_FORMATS)
    formats.update({int(n.get('numFmtId')): n.get('formatCode', 'General') for n in root.findall('s:numFmts/s:numFmt', NS)})
    fonts, fills = root.findall('s:fonts/s:font', NS), root.findall('s:fills/s:fill', NS)
    result = []
    def color(node):
        rgb = node.get('rgb', '') if node is not None else ''
        return '#' + rgb[-6:] if re.fullmatch(r'[0-9a-fA-F]{6}|[0-9a-fA-F]{8}', rgb) else None
    for xf in root.findall('s:cellXfs/s:xf', NS):
        font_id, fill_id = int(xf.get('fontId', '0')), int(xf.get('fillId', '0'))
        font = fonts[font_id] if font_id < len(fonts) else E.Element('font')
        fill = fills[fill_id] if fill_id < len(fills) else E.Element('fill')
        result.append({'format': formats.get(int(xf.get('numFmtId', '0')), 'General'),
                       'bold': font.find('s:b', NS) is not None, 'italic': font.find('s:i', NS) is not None,
                       'color': color(font.find('s:color', NS)),
                       'background': color(fill.find('s:patternFill[@patternType="solid"]/s:fgColor', NS))})
    return result


def formatted_number(value, fmt, epoch1904):
    from openpyxl.styles.numbers import is_date_format
    from openpyxl.utils.datetime import from_excel, CALENDAR_MAC_1904, CALENDAR_WINDOWS_1900
    if not value or fmt == 'General':
        return value
    try:
        number = float(value)
        if not math.isfinite(number):
            return value
        if is_date_format(fmt):
            date = from_excel(number, epoch=CALENDAR_MAC_1904 if epoch1904 else CALENDAR_WINDOWS_1900)
            return date.isoformat(sep=' ') if hasattr(date, 'date') else date.isoformat()
        # Common fixed-point/percentage/currency formats; leave unsupported
        # accounting, fraction and conditional formats as exact stored values.
        simple = fmt.split(';')[0]
        if re.fullmatch(r'[$€£]?\#?,?\#*0(?:\.[0#]+)?%?', simple):
            decimals = len(simple.split('.')[1].rstrip('%')) if '.' in simple else 0
            rendered = format(number * (100 if simple.endswith('%') else 1), (',' if ',' in simple else '') + f'.{decimals}f')
            return (simple[0] if simple[0] in '$€£' else '') + rendered + ('%' if simple.endswith('%') else '')
    except (ValueError, OverflowError):
        pass
    return value


def table_model(pkg, opts):
    listing = sheets(pkg)
    selected = opts.get('sheet') or listing[0]['name']
    sheet = next((s for s in listing if s['name'] == selected), None)
    if not sheet:
        raise ValueError('Worksheet not found')
    root = pkg.tree(sheet['part'])
    row = int(opts.get('row', 1))
    col = int(opts.get('col', 1))
    if not 1 <= row <= 1048576 or not 1 <= col <= 16384:
        raise ValueError('Invalid worksheet window')
    shared = []
    if 'xl/sharedStrings.xml' in pkg.names:
        shared = [''.join(t.text or '' for t in si.iter(q('s', 't')))
                  for si in pkg.tree('xl/sharedStrings.xml')]
    styles = cell_styles(pkg)
    props = pkg.tree('xl/workbook.xml').find('s:workbookPr', NS)
    epoch1904 = props is not None and props.get('date1904') in ('1', 'true')
    cells, max_row, max_col = [], 1, 1
    ranges = protected_ranges(root)
    merges = []
    for m in root.findall('s:mergeCells/s:mergeCell', NS):
        span = m.get('ref', '')
        first, _, last = span.partition(':')
        r1, c1 = address(first)
        r2, c2 = address(last or first)
        if r1 < row + 50 and r2 >= row and c1 < col + 20 and c2 >= col:
            merges.append(span)
    if len(merges) > 2000:
        raise ValueError('Too many overlapping merged cells')
    for cell in root.findall('s:sheetData/s:row/s:c', NS):
        ref = cell.get('r')
        r, c = address(ref)
        max_row, max_col = max(max_row, r), max(max_col, c)
        if not (row <= r < row + 50 and col <= c < col + 20):
            continue
        t = cell.get('t', 'n')
        value = cell.findtext('s:v', default='', namespaces=NS)
        formula = cell.find('s:f', NS)
        if t == 's':
            idx = int(value)
            value = shared[idx] if 0 <= idx < len(shared) else ''
        elif t == 'inlineStr':
            value = ''.join(n.text or '' for n in cell.findall('s:is//s:t', NS))
        kind = 'formula' if formula is not None else 'boolean' if t == 'b' else 'number' if t == 'n' and value else 'text'
        read_only = (formula is not None and formula.get('t', 'normal') != 'normal') or any(in_range(ref, span) for span in ranges)
        style_id = int(cell.get('s', '0'))
        style = styles[style_id] if style_id < len(styles) else {}
        display = ('TRUE' if value == '1' else 'FALSE') if t == 'b' else formatted_number(value, style.get('format', 'General'), epoch1904) if t == 'n' else value
        cells.append({'ref': ref, 'value': ('=' + (formula.text or '')) if formula is not None else value,
                      'display': display, 'style': style,
                      'type': kind, 'readOnly': read_only or bool(cell.get('cm') or cell.get('vm'))})
    return {'kind': 'xlsx', 'sheets': [{k: s[k] for k in ('name', 'hidden')} for s in listing],
            'sheet': selected, 'row': row, 'col': col, 'rows': max_row, 'cols': max_col, 'cells': cells,
            'merges': merges,
            'readOnly': pkg.signed or root.find('s:sheetProtection', NS) is not None}


def worksheet(pkg, name):
    sheet = next((item for item in sheets(pkg) if item['name'] == name), None)
    if sheet is None:
        raise ValueError('Worksheet not found')
    return sheet['part'], pkg.tree(sheet['part'])


def sheet_readonly(pkg, part, root):
    return (pkg.signed or root.find('s:sheetProtection', NS) is not None
            or any(target.startswith('xl/pivotTables/') for target in pkg.rels(part).values()))


def reserved_grid_ranges(root, last_row, width):
    refs = protected_ranges(root) + [node.get('ref', '') for node in root.findall('s:mergeCells/s:mergeCell', NS)]
    ranges = []
    for ref in refs:
        first, _, last = ref.replace('$', '').partition(':')
        top, left = address(first)
        bottom, right = address(last or first)
        if top <= last_row and left <= width and bottom >= 2:
            ranges.append([top, left, bottom, right])
            if len(ranges) > MAX_INLINE_RANGES:
                break
    return ranges


def cell_format(cell, styles):
    style = int(cell.get('s', '0'))
    return styles[style]['format'] if 0 <= style < len(styles) else 'General'


def complex_string(node):
    return (any(child.tag in (q('s', 'r'), q('s', 'rPh')) for child in node)
            or sum(len(text.text or '') for text in node.iter(q('s', 't'))) > MAX_CELL)


def reserved_strings(pkg):
    if 'xl/sharedStrings.xml' not in pkg.names:
        return set()
    return {str(i) for i, node in enumerate(pkg.tree('xl/sharedStrings.xml').findall('s:si', NS))
            if complex_string(node)}


def reserved_cell(cell, styles, shared):
    from openpyxl.styles.numbers import is_date_format, is_timedelta_format

    kind = cell.get('t', 'n')
    if (kind not in ('n', 'b', 's', 'inlineStr', 'str') or cell.find('s:f', NS) is not None
            or cell.get('cm') or cell.get('vm')):
        return True
    if kind == 'n':
        fmt = cell_format(cell, styles)
        return is_date_format(fmt) or is_timedelta_format(fmt)
    if kind == 's':
        return cell.findtext('s:v', namespaces=NS) in shared
    if kind == 'inlineStr':
        inline = cell.find('s:is', NS)
        return inline is not None and complex_string(inline)
    if kind == 'str':
        return len(cell.findtext('s:v', default='', namespaces=NS)) > MAX_CELL
    return False


def editable_table(pkg, filename, selected):
    result = preview_xlsx(Path(filename), selected)
    part, root = worksheet(pkg, result['selected'])
    last_row = len(result['head']) + 1
    width = len(result['columns'])
    spans = reserved_grid_ranges(root, last_row, width)
    read_only = sheet_readonly(pkg, part, root) or len(spans) > MAX_INLINE_RANGES
    protected = []
    if not read_only:
        styles, shared = cell_styles(pkg), reserved_strings(pkg)
        for cell in root.iterfind('s:sheetData/s:row/s:c', NS):
            ref = cell.get('r')
            row, col = address(ref)
            if 2 <= row <= last_row and col <= width and reserved_cell(cell, styles, shared):
                protected.append(ref)
    result.update(format='xlsx', file_size=Path(filename).stat().st_size, readOnly=read_only,
                  protectedCells=protected, protectedRanges=[] if read_only else spans)
    return result


NUMERIC = re.compile(r'[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[Ee][+-]?[0-9]+)?')
UNAMBIGUOUS_NUMBER = re.compile(r'-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[Ee][+-]?[0-9]+)?')


def replace_value(cell, value, styles):
    kind = cell.get('t', 'n')
    stored = cell.find('s:v', NS) is not None or cell.find('s:is', NS) is not None
    cleaned = value.strip()
    number = ((stored and kind == 'n') or (not stored and cell_format(cell, styles) != '@'
                                          and UNAMBIGUOUS_NUMBER.fullmatch(value)))
    boolean = stored and kind == 'b'
    if value and number and (not NUMERIC.fullmatch(cleaned) or not math.isfinite(float(cleaned))):
        raise ValueError('Enter a valid number for ' + cell.get('r'))
    if value and boolean and cleaned.upper() not in ('TRUE', 'FALSE'):
        raise ValueError('Enter TRUE or FALSE for ' + cell.get('r'))
    for child in list(cell):
        if child.tag in (q('s', 'v'), q('s', 'is')):
            cell.remove(child)
    cell.attrib.pop('t', None)
    if not value:
        return
    if number or boolean:
        if boolean:
            cell.set('t', 'b')
        node = E.Element(q('s', 'v'))
        node.text = ('1' if cleaned.upper() == 'TRUE' else '0') if boolean else cleaned
    else:
        cell.set('t', 'inlineStr')
        node = E.Element(q('s', 'is'))
        text = E.SubElement(node, q('s', 't'))
        text.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
        # OOXML has its own escapes in string values in addition to XML entities.
        value = re.sub(r'_(?=x[0-9A-Fa-f]{4}_)', '_x005F_', value, flags=re.IGNORECASE)
        text.text = value.replace('\r', '_x000D_')
    cell.insert(0, node)


def edit_worksheet(pkg, filename, output, payload):
    selected = payload['sheet']
    part, root = worksheet(pkg, selected)
    if sheet_readonly(pkg, part, root):
        raise ValueError('Open this worksheet in Office to edit it')
    summary = preview_xlsx(Path(filename), selected)
    last_row, width = len(summary['head']) + 1, len(summary['columns'])
    spans = reserved_grid_ranges(root, last_row, width)
    if len(spans) > MAX_INLINE_RANGES:
        raise ValueError('Open this worksheet in Office to edit it')
    styles, shared = cell_styles(pkg), reserved_strings(pkg)
    data = root.find('s:sheetData', NS)
    if data is None:
        raise ValueError('Worksheet does not contain data')
    rows = {int(row.get('r')): row for row in data.findall('s:row', NS)}
    seen = set()
    for change in payload['changes']:
        ref, value = change['ref'], change['value']
        row, col = address(ref)
        if not 2 <= row <= min(last_row, MAX_ROWS + 1) or not 1 <= col <= min(width, MAX_COLS) or ref in seen:
            raise ValueError('Invalid cell in the preview: ' + ref)
        seen.add(ref)
        if any(top <= row <= bottom and left <= col <= right for top, left, bottom, right in spans):
            raise ValueError('Open Office to edit ' + ref)
        row_node = rows.get(row)
        if row_node is None:
            row_node = E.Element(q('s', 'row'), r=str(row))
            next_row = next((node for node in data if int(node.get('r')) > row), None)
            data.append(row_node) if next_row is None else next_row.addprevious(row_node)
            rows[row] = row_node
        cell = next((node for node in row_node.findall('s:c', NS) if node.get('r') == ref), None)
        if cell is None:
            cell = E.Element(q('s', 'c'), r=ref)
            next_cell = next((node for node in row_node if node.tag != q('s', 'c') or address(node.get('r'))[1] > col), None)
            row_node.append(cell) if next_cell is None else next_cell.addprevious(cell)
            row_node.attrib.pop('spans', None)
        if reserved_cell(cell, styles, shared):
            raise ValueError('Open Office to edit ' + ref)
        replace_value(cell, value, styles)

    # Keep cached results and request recalculation in Excel/Calc on reopen.
    book = pkg.tree('xl/workbook.xml')
    calculation = book.find('s:calcPr', NS)
    if calculation is None:
        calculation = E.Element(q('s', 'calcPr'))
        following = {'oleSize', 'customWorkbookViews', 'pivotCaches', 'smartTagPr', 'smartTagTypes',
                     'webPublishing', 'fileRecoveryPr', 'webPublishObjects', 'extLst'}
        next_element = next((node for node in book if isinstance(node.tag, str) and E.QName(node).localname in following), None)
        book.append(calculation) if next_element is None else next_element.addprevious(calculation)
    calculation.set('fullCalcOnLoad', '1')
    patched = {part: E.tostring(root, encoding='UTF-8'), 'xl/workbook.xml': E.tostring(book, encoding='UTF-8')}
    with zipfile.ZipFile(output, 'w') as archive:
        for entry in pkg.z.infolist():
            archive.writestr(entry, patched[entry.filename] if entry.filename in patched else pkg.z.read(entry))
        archive.comment = pkg.z.comment


def main():
    command, filename, kind = sys.argv[1:4]
    pkg = Package(filename, kind)
    if command == 'validate':
        readonly = pkg.signed
        if kind == 'docx' and 'word/settings.xml' in pkg.names:
            settings = pkg.tree('word/settings.xml')
            namespace = E.QName(settings).namespace
            readonly |= any(n.get('{' + namespace + '}enforcement') in ('1', 'true', 'on') for n in settings.findall('{' + namespace + '}documentProtection'))
        print(json.dumps({'readOnly': bool(readonly)}))
    elif command == 'inspect':
        opts = json.loads(sys.argv[4]) if len(sys.argv) > 4 else {}
        result = table_model(pkg, opts) if kind == 'xlsx' else text_model(pkg)[0]
        print(json.dumps(result))
    elif command == 'table-preview' and kind == 'xlsx':
        print(json.dumps(editable_table(pkg, filename, sys.argv[4]), ensure_ascii=False, allow_nan=False))
    elif command == 'edit-table' and kind == 'xlsx':
        with open(sys.argv[5], encoding='utf-8') as changes:
            payload = json.load(changes)
        edit_worksheet(pkg, filename, sys.argv[4], payload)
        updated = Package(sys.argv[4], 'xlsx')
        print(json.dumps(editable_table(updated, sys.argv[4], payload['sheet']), ensure_ascii=False, allow_nan=False))
    else:
        raise ValueError('Unknown operation')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, IndexError, TypeError, zipfile.BadZipFile, E.XMLSyntaxError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(5)
