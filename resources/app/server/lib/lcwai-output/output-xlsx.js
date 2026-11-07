'use strict';

/*
 * WORKBOOK JSON → .xlsx (Buyer Log temalı).
 *
 * SheetJS topluluk sürümü hücre biçimi (renk, kalın başlık, sayı biçimi)
 * yazmadığı için küçük bir SpreadsheetML yazıcısı kullanılır.
 *
 * Varsayılan SADEDİR: belge paletinin gri tablo başlığı, ince satır
 * çizgileri, sayılar sağa / metin sola, ilk satır dondurulmuş, otomatik
 * filtre, sütun genişlikleri içerikten; zebra, veri çubuğu ya da başka
 * koşullu biçim YOKTUR. Kullanıcı isterse sözleşmedeki beyaz liste
 * (bkz. BLOutputLayout.normalizeXlsxColumnFormat / normalizeXlsxSheetFormat)
 * hizalama, genişlik, toplam satırı, veri çubuğu, vurgu kuralı, zebra ve
 * sütun dondurmayı açar; renkler daima paletin durum tonlarıdır.
 * Doğrulanmış giriş (bkz. output-contracts.normalizeWorkbook) beklenir.
 */
const { createZip, xmlText } = require('./output-zip');
const BLOutputLayout = require('../../../public/lcwai-output-layout');
const { theme, ooxml } = require('./output-theme');

const NUMFMT = { general: 0, integer: 164, number: 165, percent: 166, currency: 167, date: 168 };
const FONT = { body: 0, header: 1, title: 2, label: 3, note: 4, subtitle: 5, total: 6 };
const FILL = { none: 0, header: 2 };
const BORDER = { none: 0, row: 1, header: 2, total: 3 };
// dxfs sırası — koşullu biçimler: 0 zebra, ardından durum tonları.
const DXF = { zebra: 0, ok: 1, warn: 2, risk: 3, info: 4 };
const NUMERIC = ['integer', 'number', 'percent', 'currency'];

function colName(index) {
  let n = index + 1;
  let name = '';
  while (n > 0) { const r = (n - 1) % 26; name = String.fromCharCode(65 + r) + name; n = Math.floor((n - 1) / 26); }
  return name;
}

function excelDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!match) return null;
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (!Number.isFinite(utc)) return null;
  return Math.round((utc - Date.UTC(1899, 11, 30)) / 86400000);
}

function currencyFormat(code) {
  const symbol = { TRY: '₺', USD: '$', EUR: '€', GBP: '£' }[String(code || '').toUpperCase()] || '';
  return symbol ? `#,##0.00 "${symbol}"` : '#,##0.00';
}

/* Hücre stilleri (cellXfs) kullanıldıkça kaydedilir; styles.xml en sonda yazılır. */
function createStyles() {
  const list = [];
  const index = new Map();
  const xf = ({ numFmt = NUMFMT.general, font = FONT.body, fill = FILL.none, border = BORDER.none, h = '', v = '', wrap = false } = {}) => {
    const key = [numFmt, font, fill, border, h, v, wrap ? 1 : 0].join('|');
    if (!index.has(key)) { index.set(key, list.length); list.push({ numFmt, font, fill, border, h, v, wrap }); }
    return index.get(key);
  };
  xf(); // 0: varsayılan
  return { xf, list };
}

function xfXml(item) {
  const attrs = [`numFmtId="${item.numFmt}"`, `fontId="${item.font}"`, `fillId="${item.fill}"`, `borderId="${item.border}"`, 'xfId="0"'];
  if (item.numFmt) attrs.push('applyNumberFormat="1"');
  if (item.font) attrs.push('applyFont="1"');
  if (item.fill) attrs.push('applyFill="1"');
  if (item.border) attrs.push('applyBorder="1"');
  const align = [item.h ? `horizontal="${item.h}"` : '', item.v ? `vertical="${item.v}"` : '', item.wrap ? 'wrapText="1"' : ''].filter(Boolean).join(' ');
  return align ? `<xf ${attrs.join(' ')} applyAlignment="1"><alignment ${align}/></xf>` : `<xf ${attrs.join(' ')}/>`;
}

function stylesXml(currency, metrics, styles) {
  const c = theme().colors;
  const font = theme().fonts.excel;
  const body = metrics.bodySize;
  const tone = (ink, bg) => `<dxf><font><color rgb="FF${ooxml(ink)}"/></font><fill><patternFill patternType="solid"><bgColor rgb="FF${ooxml(bg)}"/></patternFill></fill></dxf>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="5"><numFmt numFmtId="164" formatCode="#,##0"/><numFmt numFmtId="165" formatCode="#,##0.00"/><numFmt numFmtId="166" formatCode="0.0%"/><numFmt numFmtId="167" formatCode="${xmlText(currencyFormat(currency))}"/><numFmt numFmtId="168" formatCode="dd.mm.yyyy"/></numFmts>
<fonts count="7">
<font><sz val="${body}"/><color rgb="FF${ooxml(c.ink)}"/><name val="${font}"/><family val="2"/></font>
<font><b/><sz val="${body}"/><color rgb="FF${ooxml(c.logo)}"/><name val="${font}"/><family val="2"/></font>
<font><b/><sz val="${metrics.titleSize}"/><color rgb="FF${ooxml(c.logo)}"/><name val="${font}"/><family val="2"/></font>
<font><b/><sz val="${body}"/><color rgb="FF${ooxml(c.logo)}"/><name val="${font}"/><family val="2"/></font>
<font><i/><sz val="${Math.max(8, body - 1)}"/><color rgb="FF${ooxml(c.muted)}"/><name val="${font}"/><family val="2"/></font>
<font><sz val="${body}"/><color rgb="FF${ooxml(c.ink2)}"/><name val="${font}"/><family val="2"/></font>
<font><b/><sz val="${body}"/><color rgb="FF${ooxml(c.ink)}"/><name val="${font}"/><family val="2"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF${ooxml(c['thead-bg'])}"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="4">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color rgb="FF${ooxml(c.line)}"/></bottom><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color rgb="FF${ooxml(c['thead-line'])}"/></bottom><diagonal/></border>
<border><left/><right/><top style="thin"><color rgb="FF${ooxml(c['thead-line'])}"/></top><bottom/><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${styles.list.length}">
${styles.list.map(xfXml).join('\n')}
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
<dxfs count="5"><dxf><fill><patternFill patternType="solid"><bgColor rgb="FF${ooxml(c.card2)}"/></patternFill></fill></dxf>${tone(c.green, c['green-bg'])}${tone(c.orange, c['orange-bg'])}${tone(c.red, c['red-bg'])}${tone(c['acc-ink'], c['acc-bg'])}</dxfs>
</styleSheet>`;
}

function cellXml(ref, value, style, type) {
  if (value && typeof value === 'object' && typeof value.f === 'string') {
    return `<c r="${ref}" s="${style}"><f>${xmlText(value.f.replace(/^=/, ''))}</f></c>`;
  }
  if (value == null || value === '') return `<c r="${ref}" s="${style}"/>`;
  if (type === 'date') {
    const serial = excelDate(value);
    if (serial != null) return `<c r="${ref}" s="${style}"><v>${serial}</v></c>`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  if (typeof value === 'boolean') return `<c r="${ref}" s="${style}" t="b"><v>${value ? 1 : 0}</v></c>`;
  const text = String(value).slice(0, 32000);
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlText(text)}</t></is></c>`;
}

const typeFormat = type => (NUMFMT[type] && type !== 'general' ? NUMFMT[type] : NUMFMT.general);

function textWidth(value, type) {
  if (value == null) return 0;
  if (typeof value === 'object') return 12;
  if (type === 'date') return 11;
  if (typeof value === 'number') return Math.min(18, String(Math.round(value)).length + 5);
  return Math.max(...String(value).split('\n').map(line => line.length));
}

/* Vurgu kuralı → Excel formülü (sol üst hücreye göre göreli). Boş hücre hiçbir
   kurala uymaz (cellIs boşu 0 sayardı; bu yüzden ifade kuralı kullanılır). */
const textLiteral = value => `"${String(value).replace(/"/g, '""')}"`;
function ruleFormula(rule, ref, type) {
  if (type === 'text') {
    // SEARCH'te * ? ~ jokerdir; önizlemedeki düz "içerir" ile aynı anlam için kaçışlanır.
    if (rule.op === 'contains') return `ISNUMBER(SEARCH(${textLiteral(String(rule.value).replace(/[~*?]/g, '~$&'))},${ref}))`;
    if (rule.op === '=') return `${ref}=${textLiteral(rule.value)}`;
    return `AND(${ref}<>"",${ref}<>${textLiteral(rule.value)})`;
  }
  const lit = value => String(type === 'date' ? excelDate(value) : value);
  if (rule.op === 'between') return `AND(ISNUMBER(${ref}),${ref}>=${lit(rule.value)},${ref}<=${lit(rule.value2)})`;
  const op = rule.op === '!=' ? '<>' : rule.op;
  return `AND(ISNUMBER(${ref}),${ref}${op}${lit(rule.value)})`;
}

/* İsteğe bağlı koşullu biçimler: vurgu kuralları, veri çubukları, zebra.
   Hiçbiri istenmediyse boş döner (varsayılan sade tablo). */
function conditionalFormats(columns, rowCount, style) {
  if (!rowCount) return '';
  const last = rowCount + 1;
  const parts = [];
  let priority = 1;
  columns.forEach((column, index) => {
    if (!column.highlight || !column.highlight.length) return;
    const ref = `${colName(index)}2`;
    const rules = column.highlight.map(rule => `<cfRule type="expression" dxfId="${DXF[rule.tone] == null ? DXF.risk : DXF[rule.tone]}" priority="${priority++}"><formula>${xmlText(ruleFormula(rule, ref, column.type))}</formula></cfRule>`).join('');
    parts.push(`<conditionalFormatting sqref="${ref}:${colName(index)}${last}">${rules}</conditionalFormatting>`);
  });
  const barColor = ooxml(theme().colors['acc-lite']);
  columns.forEach((column, index) => {
    if (!column.bar || !NUMERIC.includes(column.type) || rowCount < 2) return;
    const ref = `${colName(index)}2:${colName(index)}${last}`;
    parts.push(`<conditionalFormatting sqref="${ref}"><cfRule type="dataBar" priority="${priority++}"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="FF${barColor}"/></dataBar></cfRule></conditionalFormatting>`);
  });
  if (style && style.zebra) {
    const all = `A2:${colName(Math.max(0, columns.length - 1))}${last}`;
    parts.push(`<conditionalFormatting sqref="${all}"><cfRule type="expression" dxfId="${DXF.zebra}" priority="${priority++}"><formula>MOD(ROW(),2)=1</formula></cfRule></conditionalFormatting>`);
  }
  return parts.join('');
}

const SUBTOTAL = { sum: 109, avg: 101, min: 105, max: 104 };
/* Toplam satırı: filtreye duyarlı SUBTOTAL; önbellek değeri düz değerlerden. */
function totalsRowXml(columns, rows, styles, english) {
  if (!rows.length || !columns.some(column => column.total)) return '';
  const r = rows.length + 2;
  const labelAt = columns.findIndex(column => !column.total && column.type !== 'image');
  const cells = columns.map((column, index) => {
    const ref = `${colName(index)}${r}`;
    if (!column.total) {
      const h = BLOutputLayout.xlsxAlign(column);
      const s = styles.xf({ font: FONT.total, border: BORDER.total, h, v: 'center' });
      return labelAt === index && labelAt < columns.findIndex(item => item.total) ? cellXml(ref, english ? 'Total' : 'Toplam', s) : `<c r="${ref}" s="${s}"/>`;
    }
    const range = `${colName(index)}2:${colName(index)}${r - 1}`;
    const fn = column.total === 'count' ? (column.type === 'text' ? 103 : 102) : SUBTOTAL[column.total];
    const cached = BLOutputLayout.xlsxTotalValue(column.total, rows.map(row => row[index]), column.type);
    const numFmt = column.total === 'count' ? NUMFMT.integer
      : column.total === 'avg' && column.type === 'integer' ? NUMFMT.number : typeFormat(column.type);
    const s = styles.xf({ numFmt, font: FONT.total, border: BORDER.total, h: BLOutputLayout.xlsxAlign(column), v: 'center' });
    const value = cached == null ? '' : column.type === 'date' && column.total !== 'count' ? excelDate(cached) : cached;
    return `<c r="${ref}" s="${s}"><f>SUBTOTAL(${fn},${range})</f>${value === '' || value == null ? '' : `<v>${value}</v>`}</c>`;
  });
  return `<row r="${r}">${cells.join('')}</row>`;
}

// Hücredeki görsel kutusu ve satır/yazı boyutları Yerleşim'den gelir (xlsxMetrics).
let METRICS = BLOutputLayout.xlsxMetrics(null);
const EMU_PER_PT = 12700;
const EMU_PER_PX = 9525;

/* Hücreye gömülü model görselleri: twoCellAnchor değil oneCellAnchor (hücre
   boyutundan bağımsız, en-boy korunur). Desteklenmeyen tür → hücre boş. */
function drawingXml(anchors) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchors.map((anchor, index) => `<xdr:oneCellAnchor><xdr:from><xdr:col>${anchor.col}</xdr:col><xdr:colOff>${anchor.offX}</xdr:colOff><xdr:row>${anchor.row}</xdr:row><xdr:rowOff>${anchor.offY}</xdr:rowOff></xdr:from><xdr:ext cx="${anchor.cx}" cy="${anchor.cy}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${index + 2}" name="Picture ${index + 1}" descr="${xmlText(anchor.token)}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="${anchor.rel}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${anchor.cx}" cy="${anchor.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`).join('')}</xdr:wsDr>`;
}

function dataSheetXml(sheet, styles, { imageCells = new Map(), metrics = METRICS, english = false } = {}) {
  const columns = sheet.columns;
  const rows = sheet.rows;
  const style = sheet.style || { zebra: false, freezeColumns: 0 };
  const widths = columns.map((column, index) => {
    if (column.type === 'image') return metrics.imageColChars;
    if (column.width) return column.width;
    let width = Math.max(8, String(column.header).length + 2);
    for (const row of rows.slice(0, 300)) width = Math.max(width, textWidth(row[index], column.type) + 2);
    return Math.min(width, 60);
  });
  const hasTotals = rows.length > 0 && columns.some(column => column.total);
  const lastCol = colName(Math.max(0, columns.length - 1));
  const lastRef = `${lastCol}${rows.length + 1}`;
  const headerXf = columns.map(column => styles.xf({ font: FONT.header, fill: FILL.header, border: BORDER.header, h: BLOutputLayout.xlsxAlign(column), v: 'center', wrap: true }));
  const bodyXf = columns.map(column => styles.xf({ numFmt: typeFormat(column.type), border: BORDER.row, h: BLOutputLayout.xlsxAlign(column), v: column.type === 'image' ? 'center' : 'top', wrap: column.type === 'text' }));
  const lines = [];
  lines.push(`<row r="1" ht="${metrics.headerHeight}" customHeight="1">${columns.map((column, index) => cellXml(`${colName(index)}1`, column.header, headerXf[index])).join('')}</row>`);
  rows.forEach((row, rowIndex) => {
    const r = rowIndex + 2;
    const tall = columns.some((column, index) => column.type === 'image' && imageCells.has(`${rowIndex}:${index}`));
    // Görsel sütunu hücresi metin taşımaz (anahtar dosyada görünmez).
    lines.push(`<row r="${r}"${tall ? ` ht="${metrics.imageRow}" customHeight="1"` : ''}>${columns.map((column, index) => cellXml(`${colName(index)}${r}`, column.type === 'image' ? null : row[index], bodyXf[index], column.type)).join('')}</row>`);
  });
  if (hasTotals) lines.push(totalsRowXml(columns, rows, styles, english));
  const freeze = Math.max(0, Math.min(style.freezeColumns || 0, columns.length - 1));
  const pane = freeze
    ? `<pane xSplit="${freeze}" ySplit="1" topLeftCell="${colName(freeze)}2" activePane="bottomRight" state="frozen"/><selection pane="topRight"/><selection pane="bottomLeft"/><selection pane="bottomRight" activeCell="${colName(freeze)}2" sqref="${colName(freeze)}2"/>`
    : '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<dimension ref="A1:${lastCol}${rows.length + (hasTotals ? 2 : 1)}"/>
<sheetViews><sheetView workbookViewId="0" showGridLines="0">${pane}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>
<sheetData>${lines.join('')}</sheetData>
<autoFilter ref="A1:${lastRef}"/>
${conditionalFormats(columns, rows.length, style)}
<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>
<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>${imageCells.size ? '\n<drawing r:id="rId1"/>' : ''}
</worksheet>`;
}

/* Özet sayfası (yalnız KPI ya da not varsa): başlık, alt başlık, KPI'lar, notlar. */
function summarySheetXml(workbook, lang, styles) {
  const english = lang === 'en';
  const X = {
    title: styles.xf({ font: FONT.title }),
    subtitle: styles.xf({ font: FONT.subtitle }),
    note: styles.xf({ font: FONT.note, v: 'top', wrap: true }),
    headLeft: styles.xf({ font: FONT.header, fill: FILL.header, border: BORDER.header, h: 'left', v: 'center' }),
    headRight: styles.xf({ font: FONT.header, fill: FILL.header, border: BORDER.header, h: 'right', v: 'center' }),
    label: styles.xf({ font: FONT.label, border: BORDER.row, v: 'top' }),
    text: styles.xf({ border: BORDER.row, v: 'top', wrap: true }),
    integer: styles.xf({ numFmt: NUMFMT.integer, border: BORDER.row, h: 'right', v: 'top' }),
    number: styles.xf({ numFmt: NUMFMT.number, border: BORDER.row, h: 'right', v: 'top' }),
    valueText: styles.xf({ border: BORDER.row, h: 'right', v: 'top' }),
    bullet: styles.xf({ v: 'top', wrap: true }),
    section: styles.xf({ font: FONT.label }),
  };
  const rows = [];
  let r = 1;
  rows.push(`<row r="${r}" ht="${Math.round(METRICS.titleSize * 1.6)}" customHeight="1">${cellXml(`A${r}`, workbook.title, X.title)}</row>`); r++;
  if (workbook.subtitle) { rows.push(`<row r="${r}">${cellXml(`A${r}`, workbook.subtitle, X.subtitle)}</row>`); r++; }
  rows.push(`<row r="${r}">${cellXml(`A${r}`, `${english ? 'Created' : 'Oluşturma'}: ${workbook.date} · Buyer Log · LCW AI`, X.note)}</row>`); r += 2;
  if (workbook.kpis.length) {
    rows.push(`<row r="${r}" ht="${METRICS.headerHeight}" customHeight="1">${cellXml(`A${r}`, english ? 'Metric' : 'Gösterge', X.headLeft)}${cellXml(`B${r}`, english ? 'Value' : 'Değer', X.headRight)}${cellXml(`C${r}`, english ? 'Note' : 'Not', X.headLeft)}</row>`); r++;
    for (const kpi of workbook.kpis) {
      const valueXf = typeof kpi.value === 'number' ? (Number.isInteger(kpi.value) ? X.integer : X.number) : X.valueText;
      rows.push(`<row r="${r}">${cellXml(`A${r}`, kpi.label, X.label)}${cellXml(`B${r}`, kpi.value, valueXf)}${cellXml(`C${r}`, kpi.note, X.text)}</row>`); r++;
    }
    r++;
  }
  if (workbook.notes.length) {
    rows.push(`<row r="${r}">${cellXml(`A${r}`, english ? 'Notes' : 'Notlar', X.section)}</row>`); r++;
    for (const note of workbook.notes) { rows.push(`<row r="${r}">${cellXml(`A${r}`, `• ${note}`, X.bullet)}</row>`); r++; }
    r++;
  }
  rows.push(`<row r="${r}">${cellXml(`A${r}`, english ? 'Generated with LCW AI in Buyer Log. Verify figures against Buyer Log data.' : 'Buyer Log içinde LCW AI ile oluşturuldu. Rakamları Buyer Log verisiyle doğrulayın.', X.note)}</row>`);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols><col min="1" max="1" width="48" customWidth="1"/><col min="2" max="2" width="22" customWidth="1"/><col min="3" max="3" width="60" customWidth="1"/></cols>
<sheetData>${rows.join('')}</sheetData>
<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>
</worksheet>`;
}

function quoteSheet(name) { return `'${String(name).replace(/'/g, "''")}'`; }

/* workbook: normalizeWorkbook() çıktısı. Döner: Buffer (.xlsx). */
function renderWorkbook(workbook, { lang = 'tr', date = new Date(), images = {} } = {}) {
  const english = lang === 'en';
  METRICS = BLOutputLayout.xlsxMetrics(workbook.layout || null);
  const styles = createStyles();
  const sheets = [];
  // Özet sayfası yalnız KPI ya da not taşıyorsa açılır; tek başına alt başlık
  // ayrı sayfa açtırmaz (belge özelliklerine yazılır).
  const hasSummary = workbook.kpis.length || workbook.notes.length;
  if (hasSummary) sheets.push({ name: english ? 'Summary' : 'Özet', xml: summarySheetXml(workbook, lang, styles) });
  const used = new Set(sheets.map(sheet => sheet.name.toLowerCase()));
  // Model görselleri (yalnız PNG/JPEG/GIF): sayfa başına bir çizim parçası.
  const usable = Object.fromEntries(Object.entries(images || {}).filter(([, image]) => ['png', 'jpg', 'gif'].includes(image.ext)));
  const mediaFiles = [];
  const mediaName = new Map();
  const mediaFor = token => {
    if (!mediaName.has(token)) { const image = usable[token]; const name = `image${mediaName.size + 1}.${image.ext}`; mediaName.set(token, name); mediaFiles.push({ name: `xl/media/${name}`, data: image.buffer }); }
    return mediaName.get(token);
  };
  for (const sheet of workbook.sheets) {
    const imageCells = new Map();
    sheet.columns.forEach((column, col) => {
      if (column.type !== 'image') return;
      sheet.rows.forEach((row, rowIndex) => { const token = row[col]; if (token && usable[token]) imageCells.set(`${rowIndex}:${col}`, token); });
    });
    sheet.imageCells = imageCells;
    let name = sheet.name;
    for (let n = 2; used.has(name.toLowerCase()); n++) { const suffix = ` (${n})`; name = `${sheet.name.slice(0, 31 - suffix.length)}${suffix}`; }
    used.add(name.toLowerCase());
    sheets.push({ name, xml: dataSheetXml(sheet, styles, { imageCells, english }), filter: sheet, imageCells });
  }
  const definedNames = sheets.map((sheet, index) => sheet.filter
    ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${index}" hidden="1">${xmlText(quoteSheet(sheet.name))}!$A$1:$${colName(Math.max(0, sheet.filter.columns.length - 1))}$${sheet.filter.rows.length + 1}</definedName>`
    : '').join('');
  const drawings = [];
  sheets.forEach((sheet, index) => {
    if (!sheet.imageCells || !sheet.imageCells.size) return;
    const rels = [];
    const anchors = [];
    for (const [key, token] of sheet.imageCells) {
      const [rowIndex, col] = key.split(':').map(Number);
      const image = usable[token];
      const file = mediaFor(token);
      let rel = rels.find(entry => entry.file === file);
      if (!rel) { rel = { id: `rId${rels.length + 1}`, file }; rels.push(rel); }
      const ratio = Math.max(0.05, image.width / Math.max(1, image.height));
      const colPx = METRICS.imageColChars * 7 + 5; // sütun genişliği (karakter) → px
      const boxW = colPx - 9, boxH = METRICS.imageBoxPx;
      let pw = boxW, ph = boxW / ratio;
      if (ph > boxH) { ph = boxH; pw = boxH * ratio; }
      anchors.push({ col, row: rowIndex + 1, offX: Math.round((colPx - pw) / 2 * EMU_PER_PX), offY: Math.round(3 * EMU_PER_PT), cx: Math.round(pw * EMU_PER_PX), cy: Math.round(ph * EMU_PER_PX), rel: rel.id, token });
    }
    drawings.push({ sheet: index + 1, number: drawings.length + 1, anchors, rels });
  });
  const created = (date instanceof Date ? date : new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const entries = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/>${drawings.map(drawing => `<Override PartName="/xl/drawings/drawing${drawing.number}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`).join('')}<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>` },
    { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlText(workbook.title)}</dc:title>${workbook.subtitle ? `<dc:description>${xmlText(workbook.subtitle)}</dc:description>` : ''}<dc:creator>Buyer Log · LCW AI</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified></cp:coreProperties>` },
    { name: 'docProps/app.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Buyer Log</Application></Properties>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets.map((sheet, index) => `<sheet name="${xmlText(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets>${definedNames ? `<definedNames>${definedNames}</definedNames>` : ''}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: stylesXml(workbook.currency, METRICS, styles) },
    ...sheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, data: sheet.xml })),
    ...drawings.flatMap(drawing => [
      { name: `xl/worksheets/_rels/sheet${drawing.sheet}.xml.rels`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawing.number}.xml"/></Relationships>` },
      { name: `xl/drawings/drawing${drawing.number}.xml`, data: drawingXml(drawing.anchors) },
      { name: `xl/drawings/_rels/drawing${drawing.number}.xml.rels`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${drawing.rels.map(rel => `<Relationship Id="${rel.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${rel.file}"/>`).join('')}</Relationships>` },
    ]),
    ...mediaFiles,
  ];
  return createZip(entries, { date });
}

module.exports = { renderWorkbook, colName, excelDate };
