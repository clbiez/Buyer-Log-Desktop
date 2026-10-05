'use strict';

/*
 * WORKBOOK JSON → .xlsx (Buyer Log temalı).
 *
 * SheetJS topluluk sürümü hücre biçimi (renk, kalın başlık, sayı biçimi)
 * yazmadığı için küçük bir SpreadsheetML yazıcısı kullanılır: başlık satırı
 * Buyer Log vurgu renginde, ilk satır dondurulmuş, otomatik filtre açık,
 * sütun genişlikleri içerikten, sayı/yüzde/para/tarih biçimleri sütun
 * tipinden. Doğrulanmış giriş (bkz. output-contracts.normalizeWorkbook)
 * beklenir.
 */
const { createZip, xmlText } = require('./output-zip');
const { theme, ooxml } = require('./output-theme');

const NUMFMT = { integer: 164, number: 165, percent: 166, currency: 167, date: 168 };
// cellXfs sırası — styles.xml ile birebir.
const XF = { default: 0, header: 1, title: 2, integer: 3, number: 4, percent: 5, currency: 6, date: 7, text: 8, label: 9, note: 10, subtitle: 11 };

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

function stylesXml(currency) {
  const c = theme().colors;
  const font = theme().fonts.excel;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="5"><numFmt numFmtId="164" formatCode="#,##0"/><numFmt numFmtId="165" formatCode="#,##0.00"/><numFmt numFmtId="166" formatCode="0.0%"/><numFmt numFmtId="167" formatCode="${xmlText(currencyFormat(currency))}"/><numFmt numFmtId="168" formatCode="dd.mm.yyyy"/></numFmts>
<fonts count="6">
<font><sz val="11"/><color rgb="FF${ooxml(c.ink)}"/><name val="${font}"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="${font}"/><family val="2"/></font>
<font><b/><sz val="16"/><color rgb="FF${ooxml(c['acc-ink'])}"/><name val="${font}"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF${ooxml(c['acc-ink'])}"/><name val="${font}"/><family val="2"/></font>
<font><i/><sz val="10"/><color rgb="FF${ooxml(c.muted)}"/><name val="${font}"/><family val="2"/></font>
<font><sz val="11"/><color rgb="FF${ooxml(c.ink2)}"/><name val="${font}"/><family val="2"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF${ooxml(c.acc)}"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF${ooxml(c['acc-bg'])}"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color rgb="FF${ooxml(c.line)}"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="12">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="168" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
<dxfs count="1"><dxf><fill><patternFill patternType="solid"><bgColor rgb="FF${ooxml(c.card2)}"/></patternFill></fill></dxf></dxfs>
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

const typeStyle = type => ({ integer: XF.integer, number: XF.number, percent: XF.percent, currency: XF.currency, date: XF.date }[type] || XF.text);

function textWidth(value, type) {
  if (value == null) return 0;
  if (typeof value === 'object') return 12;
  if (type === 'date') return 11;
  if (typeof value === 'number') return Math.min(18, String(Math.round(value)).length + 5);
  return Math.max(...String(value).split('\n').map(line => line.length));
}

/* Görsel canlılık: zebra satırlar + sayısal sütunlarda veri çubukları
   (Excel'de düzenlenebilir koşullu biçim; veri değişince çubuk da değişir). */
function conditionalFormats(columns, rowCount) {
  if (!rowCount) return '';
  const last = rowCount + 1;
  const all = `A2:${colName(Math.max(0, columns.length - 1))}${last}`;
  const parts = [`<conditionalFormatting sqref="${all}"><cfRule type="expression" dxfId="0" priority="1"><formula>MOD(ROW(),2)=0</formula></cfRule></conditionalFormatting>`];
  let priority = 2;
  const barColor = ooxml(theme().colors['acc-lite']);
  columns.forEach((column, index) => {
    if (!['integer', 'number', 'currency', 'percent'].includes(column.type) || rowCount < 2) return;
    const ref = `${colName(index)}2:${colName(index)}${last}`;
    parts.push(`<conditionalFormatting sqref="${ref}"><cfRule type="dataBar" priority="${priority++}"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="FF${barColor}"/></dataBar></cfRule></conditionalFormatting>`);
  });
  return parts.join('');
}

function dataSheetXml(sheet) {
  const columns = sheet.columns;
  const rows = sheet.rows;
  const widths = columns.map((column, index) => {
    let width = Math.max(8, String(column.header).length + 2);
    for (const row of rows.slice(0, 300)) width = Math.max(width, textWidth(row[index], column.type) + 2);
    return Math.min(column.width || width, 60);
  });
  const lastRef = `${colName(Math.max(0, columns.length - 1))}${rows.length + 1}`;
  const lines = [];
  lines.push(`<row r="1" ht="22" customHeight="1">${columns.map((column, index) => cellXml(`${colName(index)}1`, column.header, XF.header)).join('')}</row>`);
  rows.forEach((row, rowIndex) => {
    const r = rowIndex + 2;
    lines.push(`<row r="${r}">${columns.map((column, index) => cellXml(`${colName(index)}${r}`, row[index], typeStyle(column.type), column.type)).join('')}</row>`);
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<dimension ref="A1:${lastRef}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>
<sheetData>${lines.join('')}</sheetData>
<autoFilter ref="A1:${lastRef}"/>
${conditionalFormats(columns, rows.length)}
<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>
<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
}

/* Özet sayfası: başlık, alt başlık, KPI'lar, notlar. */
function summarySheetXml(workbook, lang) {
  const english = lang === 'en';
  const rows = [];
  let r = 1;
  rows.push(`<row r="${r}" ht="26" customHeight="1">${cellXml(`A${r}`, workbook.title, XF.title)}</row>`); r++;
  if (workbook.subtitle) { rows.push(`<row r="${r}">${cellXml(`A${r}`, workbook.subtitle, XF.subtitle)}</row>`); r++; }
  rows.push(`<row r="${r}">${cellXml(`A${r}`, `${english ? 'Created' : 'Oluşturma'}: ${workbook.date} · Buyer Log · LCW AI`, XF.note)}</row>`); r += 2;
  if (workbook.kpis.length) {
    rows.push(`<row r="${r}">${cellXml(`A${r}`, english ? 'Metric' : 'Gösterge', XF.header)}${cellXml(`B${r}`, english ? 'Value' : 'Değer', XF.header)}${cellXml(`C${r}`, english ? 'Note' : 'Not', XF.header)}</row>`); r++;
    for (const kpi of workbook.kpis) {
      rows.push(`<row r="${r}">${cellXml(`A${r}`, kpi.label, XF.label)}${cellXml(`B${r}`, kpi.value, typeof kpi.value === 'number' ? (Number.isInteger(kpi.value) ? XF.integer : XF.number) : XF.text)}${cellXml(`C${r}`, kpi.note, XF.text)}</row>`); r++;
    }
    r++;
  }
  if (workbook.notes.length) {
    rows.push(`<row r="${r}">${cellXml(`A${r}`, english ? 'Notes' : 'Notlar', XF.label)}</row>`); r++;
    for (const note of workbook.notes) { rows.push(`<row r="${r}">${cellXml(`A${r}`, `• ${note}`, XF.text)}</row>`); r++; }
    r++;
  }
  rows.push(`<row r="${r}">${cellXml(`A${r}`, english ? 'Generated with LCW AI in Buyer Log. Verify figures against Buyer Log data.' : 'Buyer Log içinde LCW AI ile oluşturuldu. Rakamları Buyer Log verisiyle doğrulayın.', XF.note)}</row>`);
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
function renderWorkbook(workbook, { lang = 'tr', date = new Date() } = {}) {
  const english = lang === 'en';
  const sheets = [];
  const hasSummary = workbook.kpis.length || workbook.notes.length || workbook.subtitle;
  if (hasSummary) sheets.push({ name: english ? 'Summary' : 'Özet', xml: summarySheetXml(workbook, lang) });
  const used = new Set(sheets.map(sheet => sheet.name.toLowerCase()));
  for (const sheet of workbook.sheets) {
    let name = sheet.name;
    for (let n = 2; used.has(name.toLowerCase()); n++) { const suffix = ` (${n})`; name = `${sheet.name.slice(0, 31 - suffix.length)}${suffix}`; }
    used.add(name.toLowerCase());
    sheets.push({ name, xml: dataSheetXml(sheet), filter: sheet });
  }
  const definedNames = sheets.map((sheet, index) => sheet.filter
    ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${index}" hidden="1">${xmlText(quoteSheet(sheet.name))}!$A$1:$${colName(Math.max(0, sheet.filter.columns.length - 1))}$${sheet.filter.rows.length + 1}</definedName>`
    : '').join('');
  const created = (date instanceof Date ? date : new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const entries = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>` },
    { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlText(workbook.title)}</dc:title><dc:creator>Buyer Log · LCW AI</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified></cp:coreProperties>` },
    { name: 'docProps/app.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Buyer Log</Application></Properties>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets.map((sheet, index) => `<sheet name="${xmlText(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets>${definedNames ? `<definedNames>${definedNames}</definedNames>` : ''}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: stylesXml(workbook.currency) },
    ...sheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, data: sheet.xml })),
  ];
  return createZip(entries, { date });
}

module.exports = { renderWorkbook, colName, excelDate, XF };
