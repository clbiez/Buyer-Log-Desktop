'use strict';

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
let _xlsx = null;
// Saat dilimi kaymasına karşı okuma/yazma kancaları ilk kullanımda kurulur.
// Kanca idempotenttir; hangi modül önce çağırırsa orada bir kez takılır.
function getXLSX() { if (!_xlsx) { _xlsx = require('xlsx'); try { require('../../public/excel-date-utils').installSheetJsHooks(_xlsx); } catch (_) {} } return _xlsx; }

function numberValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value == null ? '' : value).trim().replace(/\s+/g, '');
  if (!text) return null;
  let normalized = text;
  if (text.includes(',') && text.includes('.')) {
    normalized = text.lastIndexOf(',') > text.lastIndexOf('.')
      ? text.replace(/\./g, '').replace(',', '.')
      : text.replace(/,/g, '');
  } else if (text.includes(',')) {
    normalized = text.replace(',', '.');
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function monthKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function parseTextDate(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return null;
  let m = text.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3] || 1));
  m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m) {
    let year = Number(m[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    return new Date(year, Number(m[2]) - 1, Number(m[1]));
  }
  m = text.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (m) return new Date(Number(m[2]), Number(m[1]) - 1, 1);
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateFromCell(cell) {
  if (!cell) return null;
  if (cell.t === 'd' && cell.v instanceof Date) return cell.v;
  if (cell.t === 'n' && Number(cell.v) > 25000 && Number(cell.v) < 80000) {
    const p = getXLSX().SSF && getXLSX().SSF.parse_date_code ? getXLSX().SSF.parse_date_code(Number(cell.v)) : null;
    if (p) return new Date(p.y, p.m - 1, p.d || 1);
  }
  return parseTextDate(cell.v != null ? cell.v : cell.w);
}

function parseFxSheet(ws) {
  if (!ws || !ws['!ref']) return null;
  const range = getXLSX().utils.decode_range(ws['!ref']);
  const cell = (r, c) => ws[getXLSX().utils.encode_cell({ r, c })];
  let headerRow = -1;
  const monthColumns = [];
  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 20); r += 1) {
    const found = [];
    for (let c = Math.max(range.s.c + 2, 2); c <= range.e.c; c += 1) {
      const key = monthKey(dateFromCell(cell(r, c)));
      if (key) found.push({ col: c, month: key });
    }
    if (found.length) {
      headerRow = r;
      monthColumns.push(...found);
      break;
    }
  }
  if (headerRow < 0) return null;

  const seenMonths = new Set();
  const columns = monthColumns.filter(entry => {
    if (seenMonths.has(entry.month)) return false;
    seenMonths.add(entry.month);
    return true;
  });
  const rows = [];
  for (let r = headerRow + 1; r <= range.e.r; r += 1) {
    // Mevcut KUR şablonunda döviz kodu B sütunundadır. B boşsa ilk üç sütunda ara.
    let code = '';
    for (const c of [1, 0, 2]) {
      const current = cell(r, c);
      const candidate = String(current && current.v != null ? current.v : '').trim().toUpperCase();
      if (/^[A-Z]{3,4}$/.test(candidate)) { code = candidate; break; }
    }
    if (!code) continue;
    const values = {};
    columns.forEach(({ col, month }) => {
      const current = cell(r, col);
      const n = numberValue(current && current.v != null ? current.v : current && current.w);
      if (n != null && n > 0) values[month] = n;
    });
    if (Object.keys(values).length) rows.push({ code, values });
  }
  return rows.length ? { columns, rows } : null;
}

function parseFxWorkbook(workbook, sourceFile) {
  const months = {};
  const currencies = new Set();
  let sheetCount = 0;
  let valueCount = 0;
  workbook.SheetNames.forEach(name => {
    const parsed = parseFxSheet(workbook.Sheets[name]);
    if (!parsed) return;
    sheetCount += 1;
    parsed.rows.forEach(row => {
      Object.entries(row.values).forEach(([month, value]) => {
        if (!months[month]) months[month] = {};
        months[month][row.code] = value;
        currencies.add(row.code);
        valueCount += 1;
      });
    });
  });
  const monthKeys = Object.keys(months).sort();
  if (!sheetCount || !monthKeys.length) {
    throw new Error('KUR Excel dosyasında döviz kodu ve tarih sütunları bulunan geçerli bir kur tablosu bulunamadı.');
  }
  return {
    data: {
      base: 'USD',
      currencies: [...currencies].sort(),
      months,
      updatedAt: new Date().toISOString(),
      sourceFile: sourceFile || 'KUR.xlsx',
      sourceType: 'KUR',
      reportMonth: monthKeys[0],
      parser: 'deterministic',
    },
    stats: {
      sheetCount,
      currencyCount: currencies.size,
      monthCount: monthKeys.length,
      valueCount,
      firstMonth: monthKeys[0],
      lastMonth: monthKeys[monthKeys.length - 1],
    },
  };
}

function readFxWorkbook(fullPath) {
  const buffer = fs.readFileSync(fullPath);
  const workbook = getXLSX().read(buffer, { type: 'buffer', cellDates: true });
  const parsed = parseFxWorkbook(workbook, path.basename(fullPath));
  parsed.data.sourceFingerprint = createHash('sha256').update(buffer).digest('hex');
  return parsed;
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
module.exports = { decideFolderKurApply, mergeFolderKur, numberValue, monthKey, parseFxSheet, parseFxWorkbook, readFxWorkbook, findKurWorkbook };
