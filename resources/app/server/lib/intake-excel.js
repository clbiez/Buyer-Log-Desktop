'use strict';

// Native OOXML pivot cache backed by a credential-free OLE DB DAX connection.
// Excel refreshes the cache directly; it does not depend on Buyer Log running.
const XLSX = require('xlsx');
const report = require('./intake-report');
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const xml = value => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch]);
const document = body => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + body;
const rels = entries => document('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + entries.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join('') + '</Relationships>');
const number = value => value === null || value === undefined || value === '' ? null : Number(String(value).replace(/\s/g, '').replace(',', '.'));
const daxString = value => '"' + String(value).replace(/"/g, '""') + '"';
const fieldRef = field => field.fieldType === 'measure' ? `[${field.id.replace(/]/g, ']]')}]` : report.daxRef(field);
const oleValue = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';

function prepare({ fields, viewConfig, horizon }) {
  const built = report.buildIntakeQuery({ fields, viewConfig, horizon });
  const config = built.viewConfig;
  if (config.query.measures.some(field => field.agg === 'FIRST')) {
    throw Object.assign(new Error('FIRST ölçüsü canlı Excel pivotunda desteklenmiyor; başka bir özet seçin. / FIRST is not supported by a live Excel pivot; choose another summary.'), { statusCode: 400, code: 'INTAKE_EXCEL_FIRST_UNSUPPORTED' });
  }
  const weights = report.intakeWeightFields(config, fields);
  const source = [...config.query.rows, ...config.query.columns, ...config.query.measures, ...weights];
  const used = new Set();
  const columns = source.filter(field => !used.has(field.id) && used.add(field.id)).map(field => ({
    ...field, name: field.id, label: config.display.labels[field.id] || field.defaultLabel || field.name,
    expression: fieldRef(field), value: row => row[field.id],
  }));
  const calculated = [];
  config.query.measures.filter(field => field.agg === 'WAVG').forEach(field => {
    const weight = source.find(item => report.sourceKey(item.sourceUniqueName) === report.sourceKey(field.weightSource));
    if (!weight) throw new Error('INTAKE weight field is missing');
    const add = (suffix, expression, value) => {
      const name = field.id + suffix; columns.push({ name, expression, value, fieldType: 'measure', label: name }); return name;
    };
    const v = fieldRef(field), w = fieldRef(weight);
    const valid = `NOT ISBLANK(${v}) && NOT ISBLANK(${w})`;
    const product = add('_product', `IF(${valid}, ${v} * ${w}, 0)`, row => { const v = number(row[field.id]), w = number(row[weight.id]); return Number.isFinite(v) && Number.isFinite(w) ? v * w : 0; });
    const weightSum = add('_weight', `IF(${valid}, ${w}, 0)`, row => { const v = number(row[field.id]), w = number(row[weight.id]); return Number.isFinite(v) && Number.isFinite(w) ? w : 0; });
    const count = add('_count', `IF(ISBLANK(${v}), 0, 1)`, row => Number.isFinite(number(row[field.id])) ? 1 : 0);
    const name = field.id + '_weighted';
    const formula = `IF('${weightSum}'=0,IF('${count}'=0,0,'${field.id}'/'${count}'),'${product}'/'${weightSum}')`;
    calculated.push({ name, field, formula });
  });
  // Stable source IDs are aliases, display labels never become query identities.
  const expression = built.query.replace(/^EVALUATE\s*/i, '');
  const query = `EVALUATE\nSELECTCOLUMNS(\n${expression},\n${columns.map(field => `  ${daxString(field.name)}, ${field.expression}`).join(',\n')}\n)`;
  return { built, config, columns, calculated, query };
}

/* Hesaplanan değerler (public/pivot-calculated-values.js) istemcide, ekrandaki
   pivotla aynı motorla hesaplanır ve DEĞER olarak gelir. Canlı OLAP pivotu
   Buyer Log formül dilini bilemez; bu yüzden ayrı bir değer sayfası yazılır.
   Girdi kullanıcının kendi isteğidir ama yine de sınırlanır: en fazla 5000
   satır × 80 sütun, metin hücresi 200 karakter, sayı hücresi sonlu sayı. */
const CALCULATED_SHEET_LIMITS = Object.freeze({ rows: 5000, columns: 80, text: 200 });
function normalizeCalculatedSheet(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const headers = (Array.isArray(raw.headers) ? raw.headers : []).slice(0, CALCULATED_SHEET_LIMITS.columns)
    .map(value => String(value == null ? '' : value).slice(0, CALCULATED_SHEET_LIMITS.text));
  if (!headers.length) return null;
  const numeric = new Set((Array.isArray(raw.numeric) ? raw.numeric : []).map(Number).filter(Number.isInteger));
  const rows = (Array.isArray(raw.rows) ? raw.rows : []).slice(0, CALCULATED_SHEET_LIMITS.rows).map(row => headers.map((_, index) => {
    const value = Array.isArray(row) ? row[index] : null;
    if (value == null || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    // Sayı sütununa metin yazılmaz (yanlış/karışık hücre); boyut sütunu metindir.
    if (numeric.has(index)) return null;
    return typeof value === 'string' ? value.slice(0, CALCULATED_SHEET_LIMITS.text) : null;
  }));
  // İstemci 7 MB yük sınırında kırptıysa sayfa bunu açıkça yazar.
  const total = Number.isInteger(raw.total) && raw.total > rows.length ? raw.total : rows.length;
  return { headers, rows, numeric: [...numeric], truncated: raw.truncated === true && total > rows.length, total };
}

function createWorkbook({ connection, plan, rows, language = 'tr', calculatedSheet = null }) {
  const { config, columns, calculated } = plan;
  const en = language === 'en';
  const sourceData = rows.map(row => columns.map(field => {
    const value = field.value(row);
    if (value == null || value === '') return null;
    return field.fieldType === 'measure' && Number.isFinite(number(value)) ? number(value) : String(value);
  }));
  const cacheColumns = [...columns, ...calculated.map(field => ({ ...field, fieldType: 'measure', label: field.name }))];
  const indices = new Map(cacheColumns.map((field, index) => [field.name, index]));
  const dimensions = [...config.query.rows, ...config.query.columns];
  const measures = config.query.measures;
  const label = field => config.display.labels[field.id] || field.defaultLabel || field.name;
  const headers = [...dimensions, ...measures].map(label);
  // Initial cached cells are a readable snapshot. Excel owns all subsequent
  // pivot recalculation, layout, group expansion and database refreshes.
  const initial = rows.map(row => [...dimensions.map(field => row[field.id] ?? ''), ...measures.map(field => row[field.id] ?? '')]);
  const wb = XLSX.utils.book_new();
  const pivotSheet = XLSX.utils.aoa_to_sheet([headers, ...initial]);
  pivotSheet['!cols'] = headers.map(() => ({ wch: 23 }));
  XLSX.utils.book_append_sheet(wb, pivotSheet, 'INTAKE Pivot');
  const info = [
    [en ? 'Live INTAKE pivot' : 'Canlı INTAKE pivot'],
    [en ? 'In Excel, use Data → Refresh All or right-click the pivot → Refresh.' : 'Excel’de Veri → Tümünü Yenile veya pivotta sağ tık → Yenile kullanın.'],
    [en ? 'Requires desktop Excel for Windows, MSOLAP and access to your corporate network with your own Windows account.' : 'Windows masaüstü Excel, MSOLAP ve kendi Windows hesabınızla şirket ağına erişim gerekir.'],
    [en ? 'No password or Buyer Log session is stored in this workbook.' : 'Bu dosyada parola veya Buyer Log oturumu saklanmaz.'],
    [en ? 'The exported filters and data horizon stay fixed; refresh retrieves current values within that scope.' : 'Aktarılan filtreler ve veri ufku sabittir; yenileme bu kapsamın güncel değerlerini getirir.'],
    [en ? 'At most 10,000 source groups. A full result may reach this limit.' : 'En fazla 10.000 kaynak grubu. Sonuç bu sınıra ulaşabilir.'],
  ];
  const infoSheet = XLSX.utils.aoa_to_sheet(info);infoSheet['!cols'] = [{ wch: 125 }];
  XLSX.utils.book_append_sheet(wb, infoSheet, en ? 'Refresh Help' : 'Yenileme Bilgisi');
  /* Pivot sheet1 olarak kalır (pivot tablo ilişkisi sheet1'e bağlıdır);
     hesaplanan değerler en sona, düz değer sayfası olarak eklenir. */
  const calc = calculatedSheet && Array.isArray(calculatedSheet.headers) && calculatedSheet.headers.length ? calculatedSheet : null;
  if (calc) {
    const note = calc.truncated
      ? [[en ? `Showing ${calc.rows.length.toLocaleString('en-GB')} of ${calc.total.toLocaleString('en-GB')} rows; narrow the filters for the rest.` : `${calc.total.toLocaleString('tr-TR')} satırın ${calc.rows.length.toLocaleString('tr-TR')} tanesi gösteriliyor; kalanı için filtreleri daraltın.`]]
      : [];
    const sheet = XLSX.utils.aoa_to_sheet([calc.headers, ...calc.rows, ...note]);
    sheet['!cols'] = calc.headers.map(() => ({ wch: 23 }));
    XLSX.utils.book_append_sheet(wb, sheet, en ? 'Calculated values' : 'Hesaplanan değerler');
  }
  const archive = XLSX.CFB.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
  const get = name => Buffer.from(XLSX.CFB.find(archive, '/' + name).content).toString('utf8');
  const put = (name, value) => XLSX.CFB.utils.cfb_add(archive, '/' + name, Buffer.from(value));
  const shared = columns.map((field, index) => field.fieldType === 'measure' ? null : [...new Set(sourceData.map(row => row[index] == null ? '' : String(row[index])))]);
  const maps = shared.map(values => values && new Map(values.map((value, index) => [value, index])));
  const cacheFields = cacheColumns.map((field, index) => {
    const calc = calculated.find(item => item.name === field.name);
    const items = shared[index];
    const sharedXml = items ? `<sharedItems count="${items.length}">${items.map(value => `<s v="${xml(value)}"/>`).join('')}</sharedItems>` : '<sharedItems containsString="0" containsNumber="1" containsInteger="0" count="0"/>';
    return `<cacheField name="${xml(field.name)}" caption="${xml(field.label)}"${calc ? ` databaseField="0" formula="${xml(calc.formula)}"` : ''}>${sharedXml}</cacheField>`;
  }).join('');
  const records = sourceData.map(row => '<r>' + cacheColumns.map((field, index) => {
    if (index >= columns.length) return '<m/>';
    const value = row[index];
    if (maps[index]) return `<x v="${maps[index].get(value == null ? '' : String(value))}"/>`;
    return value == null ? '<m/>' : typeof value === 'number' ? `<n v="${value}"/>` : `<s v="${xml(value)}"/>`;
  }).join('') + '</r>').join('');
  const cacheAttrs = `xmlns="${NS}" xmlns:r="${REL}" r:id="rIdRecords" saveData="1" refreshOnLoad="1" enableRefresh="1" backgroundQuery="0" createdVersion="6" refreshedVersion="6" minRefreshableVersion="3" recordCount="${rows.length}"`;
  put('xl/pivotCache/pivotCacheDefinition1.xml', document(`<pivotCacheDefinition ${cacheAttrs}><cacheSource type="external" connectionId="1"/><cacheFields count="${cacheColumns.length}">${cacheFields}</cacheFields></pivotCacheDefinition>`));
  put('xl/pivotCache/pivotCacheRecords1.xml', document(`<pivotCacheRecords xmlns="${NS}" count="${rows.length}">${records}</pivotCacheRecords>`));
  put('xl/pivotCache/_rels/pivotCacheDefinition1.xml.rels', rels([['rIdRecords', 'pivotCacheRecords', 'pivotCacheRecords1.xml']]));
  const rowIds = config.query.rows.map(field => indices.get(field.id));
  const colIds = config.query.columns.map(field => indices.get(field.id));
  const valueIds = measures.map(field => indices.get(field.id + (field.agg === 'WAVG' ? '_weighted' : '')));
  const pivotFields = cacheColumns.map((field, index) => {
    const axis = rowIds.includes(index) ? 'axisRow' : colIds.includes(index) ? 'axisCol' : '';
    if (!axis) return `<pivotField${valueIds.includes(index) ? ' dataField="1"' : ''} showAll="0"/>`;
    const items = shared[index] || [];
    return `<pivotField axis="${axis}" name="${xml(field.label)}" showAll="0" compact="0" outline="1" defaultSubtotal="${config.display.showSubtotals === false ? 0 : 1}"><items count="${items.length + 1}">${items.map((_, i) => `<item x="${i}"/>`).join('')}<item t="default"/></items></pivotField>`;
  }).join('');
  const aggregation = { SUM: 'sum', AVG: 'average', COUNT: 'count', MIN: 'min', MAX: 'max', WAVG: 'sum' };
  const dataFields = measures.map((field, i) => `<dataField name="${xml(label(field))}" fld="${valueIds[i]}" subtotal="${aggregation[field.agg] || 'sum'}" numFmtId="4"/>`).join('');
  const axisFields = (name, ids) => ids.length ? `<${name} count="${ids.length}">${ids.map(id => `<field x="${id}"/>`).join('')}</${name}>` : '';
  if (measures.length > 1) colIds.push(-2);
  const ref = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(1, initial.length), c: Math.max(1, headers.length) - 1 } });
  put('xl/pivotTables/pivotTable1.xml', document(`<pivotTableDefinition xmlns="${NS}" name="INTAKEPivot" cacheId="1" dataCaption="${en ? 'Values' : 'Değerler'}" grandTotalCaption="${en ? 'Grand Total' : 'Genel Toplam'}" rowGrandTotals="1" colGrandTotals="1" compact="0" compactData="0" outline="1" outlineData="1" gridDropZones="0" multipleFieldFilters="1" useAutoFormatting="1" updatedVersion="6" minRefreshableVersion="3" createdVersion="6"><location ref="${ref}" firstHeaderRow="1" firstDataRow="1" firstDataCol="${rowIds.length}"/><pivotFields count="${cacheColumns.length}">${pivotFields}</pivotFields>${axisFields('rowFields', rowIds)}${axisFields('colFields', colIds)}<dataFields count="${measures.length}">${dataFields}</dataFields><pivotTableStyleInfo name="PivotStyleMedium9" showRowHeaders="1" showColHeaders="1" showRowStripes="0" showColStripes="0" showLastColumn="1"/></pivotTableDefinition>`));
  put('xl/pivotTables/_rels/pivotTable1.xml.rels', rels([['rIdCache', 'pivotCacheDefinition', '../pivotCache/pivotCacheDefinition1.xml']]));
  const connectionString = `Provider=MSOLAP;Integrated Security=SSPI;Persist Security Info=False;Data Source=${oleValue(connection.server)};Initial Catalog=${oleValue(connection.catalog)};`;
  put('xl/connections.xml', document(`<connections xmlns="${NS}"><connection id="1" name="INTAKE Database" type="5" refreshedVersion="6" minRefreshableVersion="3" background="0" refreshOnLoad="1" saveData="1" savePassword="0" credentials="integrated"><dbPr connection="${xml(connectionString)}" command="${xml(plan.query)}" commandType="8"/></connection></connections>`));
  put('xl/workbook.xml', get('xl/workbook.xml').replace('</workbook>', '<pivotCaches><pivotCache cacheId="1" r:id="rIdIntakeCache"/></pivotCaches></workbook>'));
  put('xl/_rels/workbook.xml.rels', get('xl/_rels/workbook.xml.rels').replace('</Relationships>', `<Relationship Id="rIdIntakeCache" Type="${REL}/pivotCacheDefinition" Target="pivotCache/pivotCacheDefinition1.xml"/><Relationship Id="rIdIntakeConnection" Type="${REL}/connections" Target="connections.xml"/></Relationships>`));
  put('xl/worksheets/_rels/sheet1.xml.rels', rels([['rIdIntakePivot', 'pivotTable', '../pivotTables/pivotTable1.xml']]));
  const types = [['/xl/connections.xml', 'connections'], ['/xl/pivotCache/pivotCacheDefinition1.xml', 'pivotCacheDefinition'], ['/xl/pivotCache/pivotCacheRecords1.xml', 'pivotCacheRecords'], ['/xl/pivotTables/pivotTable1.xml', 'pivotTable']];
  put('[Content_Types].xml', get('[Content_Types].xml').replace('</Types>', types.map(([part, type]) => `<Override PartName="${part}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.${type}+xml"/>`).join('') + '</Types>'));
  return XLSX.CFB.write(archive, { type: 'buffer', fileType: 'zip', compression: true });
}

module.exports = { prepare, createWorkbook, normalizeCalculatedSheet, CALCULATED_SHEET_LIMITS };
