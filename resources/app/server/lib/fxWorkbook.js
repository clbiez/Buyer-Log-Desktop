'use strict';

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
let _xlsx = null;
// Saat dilimi kaymasına karşı okuma/yazma kancaları ilk kullanımda kurulur.
// Kanca idempotenttir; hangi modül önce çağırırsa orada bir kez takılır.
function getXLSX() { if (!_xlsx) { _xlsx = require('xlsx'); try { require('../../public/excel-date-utils').installSheetJsHooks(_xlsx); } catch (_) {} } return _xlsx; }

const BLFxImportEngine = require('../../public/fx-import-engine');
const numberValue = BLFxImportEngine.numberValue;
const monthKey = date => date instanceof Date && !isNaN(date) ? `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}` : null;
function sheetToGrid(ws, sheetName = 'Sheet1') {
  if (!ws || !ws['!ref']) return { sheetName, rows: [] };
  const XLSX = getXLSX(), range = XLSX.utils.decode_range(ws['!ref']);
  if ((range.e.r+1)*(range.e.c+1) > BLFxImportEngine.MAX_GRID_CELLS) throw new Error('FX_GRID_TOO_LARGE');
  const rows = Array.from({length:range.e.r+1},(_,r)=>Array.from({length:range.e.c+1},(_,c)=>{
    const cell=ws[XLSX.utils.encode_cell({r,c})]; const value=cell && (cell.v != null ? cell.v : cell.w);
    if(value instanceof Date)return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
    return typeof value==='number'||typeof value==='string'?value:null;
  }));
  return { sheetName, rows, startRow:range.s.r, startColumn:range.s.c };
}
function workbookGrids(workbook) { return workbook.SheetNames.map(name=>sheetToGrid(workbook.Sheets[name],name)); }
function parseFxSheet(ws) {
  const grid=sheetToGrid(ws),layout=BLFxImportEngine.detectLayout(grid);if(!layout)return null;
  const parsed=BLFxImportEngine.extractWithLayout(grid,layout);
  return {...parsed,columns:layout.monthColumns.map(c=>({col:BLFxImportEngine.columnIndex(c.col),month:c.month})),rows:parsed.currencies.map(code=>({code,values:Object.fromEntries(Object.entries(parsed.months).filter(([,rates])=>rates[code]!=null).map(([m,rates])=>[m,rates[code]]))}))};
}
function parseFxWorkbook(workbook, sourceFile) {
  const parts=workbookGrids(workbook).flatMap(grid=>{const layout=BLFxImportEngine.detectLayout(grid);return layout?[BLFxImportEngine.extractWithLayout(grid,layout)]:[];});
  const parsed=BLFxImportEngine.combineParsed(parts),validation=BLFxImportEngine.validateFxImport(parsed,{});
  if(validation.errors.length)throw Object.assign(new Error('FX_PARSE_FAILED'),{validation});
  return {data:{base:'USD',currencies:parsed.currencies,months:parsed.months,updatedAt:new Date().toISOString(),sourceFile:sourceFile||'KUR.xlsx',sourceType:'KUR',reportMonth:parsed.reportMonth,parser:'deterministic'},stats:parsed.stats};
}
function readFxWorkbook(fullPath) {
  const buffer=fs.readFileSync(fullPath),workbook=getXLSX().read(buffer,{type:'buffer',cellDates:true});
  const parsed=parseFxWorkbook(workbook,path.basename(fullPath));parsed.data.sourceFingerprint=createHash('sha256').update(buffer).digest('hex');return parsed;
}
function previewFxWorkbook(fullPath) {
  const buffer=fs.readFileSync(fullPath),workbook=getXLSX().read(buffer,{type:'buffer',cellDates:true});
  return {grids:workbookGrids(workbook),sourceFingerprint:createHash('sha256').update(buffer).digest('hex')};
}

function findKurWorkbook(directories) {
  const allowed = new Set(['.xlsx', '.xlsm', '.xls', '.xlsb']);
  const candidates = [];
  const unique = [...new Set((directories || []).filter(Boolean).map(dir => path.resolve(dir)))];
  unique.forEach((dir, directoryIndex) => {
    if (!fs.existsSync(dir)) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.forEach(entry => {
      if (!entry.isFile() || entry.name.startsWith('~$')) return;
      const ext = path.extname(entry.name).toLowerCase();
      const stem = path.basename(entry.name, ext).trim().toLocaleUpperCase('tr-TR');
      if (stem !== 'KUR' || !allowed.has(ext)) return;
      const full = path.join(dir, entry.name);
      let stat = null;
      try { stat = fs.statSync(full); } catch { return; }
      candidates.push({ full, name: entry.name, directoryIndex, modifiedMs: stat.mtimeMs, size: stat.size });
    });
  });
  candidates.sort((a, b) => a.directoryIndex - b.directoryIndex || b.modifiedMs - a.modifiedMs);
  return candidates[0] || null;
}

// force controls disk reads only. Every automatic trigger uses this policy.
function decideFolderKurApply(current = {}, candidate) {
  if (!candidate || !candidate.data || candidate.reason === 'parse-failed') return { apply: false, reason: 'parse-failed' };
  if (candidate.fingerprint && candidate.fingerprint === current.sourceFingerprint) return { apply: false, reason: 'unchanged' };
  if (current.reportMonth && candidate.reportMonth < current.reportMonth) return { apply: false, reason: 'older-report' };
  if ((!current.reportMonth || candidate.reportMonth === current.reportMonth) &&
      ['UPLOAD', 'LCWAI'].includes(current.sourceType) && Date.parse(current.updatedAt) > Date.parse(candidate.modifiedAt)) {
    return { apply: false, reason: 'current-newer' };
  }
  return { apply: true };
}
function mergeFolderKur(current, candidate) {
  const months = Object.fromEntries(Object.entries(current.months || {}).map(([month, rates]) => [month, { ...rates }]));
  for (const [month, rates] of Object.entries(candidate.data.months || {})) months[month] = { ...months[month], ...rates };
  return { ...candidate.data, months, currencies: [...new Set(Object.values(months).flatMap(rates => Object.keys(rates)))].sort(),
    reportMonth: candidate.reportMonth, sourceFingerprint: candidate.fingerprint, parser: candidate.data.parser || 'deterministic',
    sourceFile: candidate.file, sourceType: 'KUR', sourceModifiedAt: candidate.modifiedAt, updatedAt: new Date().toISOString() };
}
module.exports = { sheetToGrid, workbookGrids, previewFxWorkbook, decideFolderKurApply, mergeFolderKur, numberValue, monthKey, parseFxSheet, parseFxWorkbook, readFxWorkbook, findKurWorkbook };
