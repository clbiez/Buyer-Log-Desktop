'use strict';

const { parentPort } = require('worker_threads');
const { performance } = require('perf_hooks');

const BLBacklogExcel = require('../../public/backlog-excel-formulas');
const BLExcelWorkbookGuards = require('../../public/excel-workbook-guards');
const BLExcelDates = require('../../public/excel-date-utils');
const JSZip = require('../../public/vendor/jszip.min.js');

function backlogCellFromValue(value, kind, style) {
  const cell = {};
  if (kind === 'date') {
    const d = BLBacklogExcel.normalizedDate(value);
    if (d && !isNaN(d)) { cell.t = 'd'; cell.v = d; cell.z = 'dd.mm.yy'; }
    else { cell.t = 's'; cell.v = ''; }
  } else if (kind === 'number') {
    const n = Number(value);
    if (Number.isFinite(n)) { cell.t = 'n'; cell.v = n; }
    else { cell.t = 's'; cell.v = ''; }
  } else if (kind === 'boolean') {
    cell.t = 'b'; cell.v = Boolean(value);
  } else {
    cell.t = 's'; cell.v = value == null ? '' : String(value);
  }
  if (style && style.s != null) cell.s = style.s;
  if (style && style.z != null && !cell.z) cell.z = style.z;
  return cell;
}

function backlogFormulaCell(spec, style) {
  const cell = backlogCellFromValue(spec.cached, spec.kind, style);
  cell.f = spec.formula;
  return cell;
}

function forceWorkbookFormulaCalculation(wb) {
  wb.Workbook = wb.Workbook || {};
  wb.Workbook.CalcPr = { calcMode: 'auto', fullCalcOnLoad: '1', forceFullCalc: '1' };
}

function requireExcelModules() {
  const XLSX = require('xlsx');
  // Tarihler saat diliminden etkilenmesin: okuma/yazma kancaları kurulu olsun.
  try { BLExcelDates.installSheetJsHooks(XLSX); } catch (_) {}
  const { parseASASWorkbook, parseAntrepoWorkbook, parseCPUpdateWorkbook } = require('../lib/parse');
  const { parseLFLWorkbook } = require('../lib/lfl');
  return { XLSX, parseASASWorkbook, parseAntrepoWorkbook, parseCPUpdateWorkbook, parseLFLWorkbook };
}
function readWorkbook(XLSX, fullPath) {
  return XLSX.readFile(fullPath, { cellDates: false, raw: true });
}
async function execute(task, payload = {}) {
  if (task === 'health') return { ok: true, thread: 'excel-worker' };
  if (task === 'diagnosticSpin') { const ms = Math.max(0, Math.min(2000, Number(payload.ms) || 0)); const end = Date.now() + ms; let checksum = 0; while (Date.now() < end) checksum = (checksum + 1) % 1000003; return { ok: true, ms, checksum }; }
  if (task === 'loadFxWorkbookFromDirectories') {
    const { findKurWorkbook, readFxWorkbook } = require('../lib/fxWorkbook');
    const found = findKurWorkbook(Array.isArray(payload.directories) ? payload.directories : []);
    if (!found) return { found: false, updated: false, reason: 'KUR Excel bulunamadı' };
    const modifiedAt = new Date(found.modifiedMs).toISOString(), current = payload.current || {};
    if (!payload.force && current.sourceType === 'KUR' && current.sourceFile === found.name && current.sourceModifiedAt === modifiedAt) {
      return { found: true, updated: false, file: found.name, modifiedAt };
    }
    const parsed = readFxWorkbook(found.full);
    return { found: true, updated: true, file: found.name, modifiedAt, data: parsed.data, stats: parsed.stats };
  }
  const { XLSX, parseASASWorkbook, parseAntrepoWorkbook, parseCPUpdateWorkbook, parseLFLWorkbook } = requireExcelModules();
  if (task === 'loadSources') {
    const asasWorkbook = readWorkbook(XLSX, payload.asasPath);
    const parsedAsas = parseASASWorkbook(asasWorkbook, payload.matchRule);
    let parsedLfl = null, lflError = '';
    try { parsedLfl = parseLFLWorkbook(asasWorkbook); }
    catch (err) { lflError = String(err && err.message || err); }
    const antrepoMap = payload.antrepoPath ? parseAntrepoWorkbook(readWorkbook(XLSX, payload.antrepoPath), payload.matchRule) : {};
    const cpupdate = payload.cpupdatePath ? parseCPUpdateWorkbook(readWorkbook(XLSX, payload.cpupdatePath)) : null;
    return { parsedAsas, parsedLfl, lflError, antrepoMap, cpupdate };
  }
  if (task === 'parseAntrepoFile') {
    const map = parseAntrepoWorkbook(readWorkbook(XLSX, payload.fullPath), payload.matchRule);
    return { map, meta: map && map.__antrepoMeta ? map.__antrepoMeta : null };
  }
  if (task === 'parseAsasFile') {
    const asasWorkbook = readWorkbook(XLSX, payload.fullPath);
    const parsedAsas = parseASASWorkbook(asasWorkbook, payload.matchRule);
    let parsedLfl = null, lflError = '';
    try { parsedLfl = parseLFLWorkbook(asasWorkbook); }
    catch (err) { lflError = String(err && err.message || err); }
    return { parsedAsas, parsedLfl, lflError };
  }
  if (task === 'parseLflFile') return parseLFLWorkbook(readWorkbook(XLSX, payload.fullPath));
  if (task === 'parseLflBuffer') {
    const buffer = Buffer.from(payload.data);
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    return parseLFLWorkbook(workbook);
  }
  if (task === 'writeBacklogWorkbook') {
    const headers = Array.isArray(payload.headers) ? payload.headers : [];
    const detailRows = Array.isArray(payload.detailRows) ? payload.detailRows : [];
    const helperHeaders = [...BLBacklogExcel.HELPER_HEADERS];
    const allHeaders = [...headers, ...helperHeaders];
    const wb = XLSX.read(require('fs').readFileSync(payload.templatePath), { type: 'buffer', cellDates: true, cellStyles: true, bookFiles: true });
    const ws = wb.Sheets.BACKLOG;
    if (!ws) throw new Error('BACKLOG şablon sayfası bulunamadı.');
    const columnCount = allHeaders.length;
    const oldRange = XLSX.utils.decode_range(ws['!ref'] || `A1:${XLSX.utils.encode_col(Math.max(0, headers.length - 1))}2`);
    const oldHeaderIndex = new Map();
    for (let c = 0; c <= oldRange.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
      if (cell && cell.v != null) oldHeaderIndex.set(String(cell.v), c);
    }
    const sourceIndexes = headers.map((header, c) => oldHeaderIndex.has(header)
      ? oldHeaderIndex.get(header)
      : (header === 'Alt Üretici' && oldHeaderIndex.has('Üretici') ? oldHeaderIndex.get('Üretici') : c));
    const templateStyles = sourceIndexes.map(c => { const cell = ws[XLSX.utils.encode_cell({ r: 1, c })]; return cell ? { s: cell.s, z: cell.z } : null; });
    const headerStyles = sourceIndexes.map(c => { const cell = ws[XLSX.utils.encode_cell({ r: 0, c })]; return cell ? { s: cell.s, z: cell.z } : null; });
    const oldCols = Array.isArray(ws['!cols']) ? ws['!cols'] : [];
    const mappedCols = sourceIndexes.map(c => oldCols[c] ? { ...oldCols[c] } : undefined);
    for (let r = 0; r <= oldRange.e.r; r++) for (let c = 0; c <= oldRange.e.c; c++) delete ws[XLSX.utils.encode_cell({ r, c })];
    allHeaders.forEach((header, c) => {
      const ref = XLSX.utils.encode_cell({ r: 0, c });
      ws[ref] = { t: 's', v: header };
      if (c < headers.length) {
        const st = headerStyles[c]; if (st && st.s != null) ws[ref].s = st.s; if (st && st.z != null) ws[ref].z = st.z;
      }
    });
    ws['!cols'] = [
      ...headers.map((header, index) => ({ ...(mappedCols[index] || {}), ...BLBacklogExcel.columnSpec(header) })),
      ...helperHeaders.map(header => BLBacklogExcel.columnSpec(header, { helper: true })),
    ];
    // Excel outline level buttons (1/2 and +/-) expose or collapse the optional
    // business columns without making formula-helper columns part of the group.
    ws['!outline'] = { left: false, above: false };
    detailRows.forEach((row, ri) => {
      const sheetRow = ri + 1;
      const excelRow = ri + 2;
      const plan = BLBacklogExcel.formulaPlan(headers, row, excelRow);
      headers.forEach((h, c) => {
        const ref = XLSX.utils.encode_cell({ r: sheetRow, c });
        const style = templateStyles[c];
        const formulaSpec = plan.formulas[h];
        if (formulaSpec) ws[ref] = backlogFormulaCell(formulaSpec, style);
        else if (h === 'Sipariş Kod' || h === 'Renk Kod' || h === 'Colour Code' || h === 'Color Code') ws[ref] = backlogCellFromValue(row[h], 'text', style), ws[ref].z = '@';
        else if (row[h] instanceof Date && !isNaN(row[h])) ws[ref] = backlogCellFromValue(row[h], 'date', style);
        else if (typeof row[h] === 'number' && isFinite(row[h])) ws[ref] = backlogCellFromValue(row[h], 'number', style);
        else ws[ref] = backlogCellFromValue(row[h], 'text', style);
      });
      helperHeaders.forEach((h, hi) => {
        const ref = XLSX.utils.encode_cell({ r: sheetRow, c: headers.length + hi });
        const spec = plan.helperCells[h];
        ws[ref] = spec && spec.formula
          ? backlogFormulaCell(spec, null)
          : backlogCellFromValue(spec ? spec.value : '', spec ? spec.kind : 'text', null);
      });
    });
    const last = Math.max(2, detailRows.length + 1);
    const lastCol = XLSX.utils.encode_col(Math.max(0, columnCount - 1));
    ws['!ref'] = `A1:${lastCol}${last}`;
    ws['!autofilter'] = { ref: ws['!ref'] };
    const dateHeaders = new Set(['Sipariş Yerleştirme MerchTarih','Orijinal Exfactory Merch Tarih','Retail Depo Tarih Yıl Ay Gün','Model Bütçe Tarih Yıl Ay Gün','REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)','ANTREPO GİRİŞ TARİHİ']);
    const intHeaders = new Set(['Net Alım Sipariş Miktarı','Adet','Gelen Alım Sipariş Miktarı Merkez Sevke Hazır Depo','Kalan Alım Sipariş Miktarı','Net Gelen Alım Sipariş Miktarı','Kalan Alım Sipariş Miktarı_Merkez Sevke Hazır Depo','ANTREPO-RETAIL']);
    const directTextHeaders = new Set(['Renk Kod','Colour Code','Color Code','Orijinal Exfactory Merch Ay','Retail Depo Merch Yil Ay','Model Bütçe Merch Yil Ay','Model Bütçe Yil Hafta','Retail Depo Merch Yil Hafta','RİSK\n(PRIORITY)','YÜKLEME TİPİ','ÖNEM ETİKETİ\n(IMPORTANCE)']);
    const headerIndex = new Map(allHeaders.map((h, i) => [h, i]));
    for (let r = 1; r < last; r++) {
      dateHeaders.forEach(h => { const c = headerIndex.get(h); const ref = XLSX.utils.encode_cell({ r, c }); if (ws[ref]) ws[ref].z = 'dd.mm.yy'; });
      intHeaders.forEach(h => { const c = headerIndex.get(h); const ref = XLSX.utils.encode_cell({ r, c }); if (ws[ref]) ws[ref].z = '#,##0'; });
      directTextHeaders.forEach(h => { const c = headerIndex.get(h); const ref = XLSX.utils.encode_cell({ r, c }); if (ws[ref]) { ws[ref].t = 's'; ws[ref].v = String(ws[ref].v ?? ''); ws[ref].z = '@'; } });
      const orderCode = XLSX.utils.encode_cell({ r, c: headerIndex.get('Sipariş Kod') }); if (ws[orderCode]) { ws[orderCode].t = 's'; ws[orderCode].v = String(ws[orderCode].v ?? ''); ws[orderCode].z = '@'; }
      const fob = XLSX.utils.encode_cell({ r, c: headerIndex.get('FOB Fiyatı') }); if (ws[fob]) ws[fob].z = '#,##0.00';
    }
    if (wb.Sheets.Pivot) delete wb.Sheets.Pivot;
    if (wb.Sheets.PivotVeri) delete wb.Sheets.PivotVeri;
    wb.SheetNames = wb.SheetNames.filter(n => n !== 'Pivot' && n !== 'PivotVeri');
    forceWorkbookFormulaCalculation(wb);
    BLExcelDates.normalizeWorkbookDateColumns(wb, XLSX);
    const rawWorkbook = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true });
    const lastDataRow = Math.max(2, detailRows.length + 1);
    const validations = [];
    const deliveryIndex = headers.indexOf('YÜKLEME TİPİ');
    if (deliveryIndex >= 0) validations.push({
      sheetPath: 'xl/worksheets/sheet1.xml',
      sqref: `${BLBacklogExcel.columnName(deliveryIndex)}2:${BLBacklogExcel.columnName(deliveryIndex)}${lastDataRow}`,
      values: ['Gemi', 'Uçak', 'Gemi+Uçak', 'Gemi+Tır'],
      allowBlank: false,
      promptTitle: 'Yükleme Tipi',
      prompt: 'Listeden bir yükleme tipi seçin.',
      errorTitle: 'Geçersiz Yükleme Tipi',
      error: 'Serbest metin girişi yapılamaz. Listeden seçim yapın.',
    });
    const riskIndex = headers.indexOf('RİSK\n(PRIORITY)');
    if (riskIndex >= 0) validations.push({
      sheetPath: 'xl/worksheets/sheet1.xml',
      sqref: `${BLBacklogExcel.columnName(riskIndex)}2:${BLBacklogExcel.columnName(riskIndex)}${lastDataRow}`,
      values: ['VAR', 'YOK'],
      allowBlank: false,
      promptTitle: 'Risk',
      prompt: 'Listeden VAR veya YOK seçin.',
      errorTitle: 'Geçersiz Risk Değeri',
      error: 'Yalnız VAR veya YOK seçilebilir.',
    });
    // Önem etiketi elle yazılamaz: yalnız Ayarlar'daki katalog (Regular dahil) seçilir.
    const importanceIndex = headers.indexOf('ÖNEM ETİKETİ\n(IMPORTANCE)');
    if (importanceIndex >= 0) validations.push({
      sheetPath: 'xl/worksheets/sheet1.xml',
      sqref: `${BLBacklogExcel.columnName(importanceIndex)}2:${BLBacklogExcel.columnName(importanceIndex)}${lastDataRow}`,
      values: Array.isArray(payload.importanceValues) && payload.importanceValues.length ? payload.importanceValues : ['Regular'],
      allowBlank: false,
      promptTitle: 'Önem Etiketi',
      prompt: 'Listeden bir önem etiketi seçin. Etiket yoksa Regular.',
      errorTitle: 'Geçersiz Önem Etiketi',
      error: 'Serbest metin girişi yapılamaz. Etiketler Buyer Log Ayarlar sayfasından düzenlenir.',
    });
    const statusIndex = headers.indexOf('GÜNCEL DURUM\n(STATUS)');
    if (statusIndex >= 0) validations.push({
      sheetPath: 'xl/worksheets/sheet1.xml',
      sqref: `${BLBacklogExcel.columnName(statusIndex)}2:${BLBacklogExcel.columnName(statusIndex)}${lastDataRow}`,
      values: BLBacklogExcel.statusOptions(detailRows),
      allowBlank: false,
      promptTitle: 'Güncel Durum',
      prompt: 'Listeden bir güncel durum seçin.',
      errorTitle: 'Geçersiz Güncel Durum',
      error: 'Serbest metin girişi yapılamaz. Listeden seçim yapın.',
    });
    // A protected range that contains locked formulas cannot be sorted in
    // Microsoft Excel. Strip the template protection so row sorting remains
    // available; validations and hidden helper columns are preserved.
    const data = await BLExcelWorkbookGuards.applyWorkbookGuards(rawWorkbook, {
      validations,
      // Highlights live in the workbook as conditional-formatting rules so a
      // manual date revision or a Sea -> Sea+Air switch clears them by itself.
      conditionalFormats: BLBacklogExcel.conditionalFormats(headers, lastDataRow, { reportDate: new Date() }),
      protections: [{ sheetPath: 'xl/worksheets/sheet1.xml', removeProtection: true }],
      freezePanes: [{ sheetPath: 'xl/worksheets/sheet1.xml', rows: 1, topLeftCell: 'A2' }],
      pivotStyle: { name: 'BuyerLogPivot', fillColor: 'F2F4F7', fontColor: '475467', bodyFillColor: 'FFFFFF', bodyFontColor: '101828', bold: true },
    }, JSZip, 'nodebuffer');
    return { data };
  }
  throw new Error(`Desteklenmeyen Excel worker görevi: ${task}`);
}

parentPort.on('message', async message => {
  const id = message && message.id;
  const startedAt = performance.now();
  const metrics = () => ({ executionMs: performance.now() - startedAt, heapUsedBytes: process.memoryUsage().heapUsed });
  try {
    const result = await execute(message.task, message.payload);
    parentPort.postMessage({ id, ok: true, result, metrics: metrics() });
  } catch (error) {
    parentPort.postMessage({ id, ok: false, error: { message: error && error.message || String(error), stack: error && error.stack || '' }, metrics: metrics() });
  }
});
