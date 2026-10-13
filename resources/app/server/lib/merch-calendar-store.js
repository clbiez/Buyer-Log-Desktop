'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');
const { SERVER_DATA_ROOT, atomicWriteJson } = require('../user-data');
const BLDateDimension = require('../../public/date-dimension');

const FILE = path.join(SERVER_DATA_ROOT, 'merch-calendar.json');
const MAX_BYTES = 12 * 1024 * 1024;
const MONTHS = Object.freeze([
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]);
const MONTH_INDEX = Object.freeze(Object.fromEntries(MONTHS.map((name, index) => [name.toUpperCase(), index + 1])));
const MONTH_ALIASES = Object.freeze({
  OCAK:1, SUBAT:2, ŞUBAT:2, MART:3, NISAN:4, NİSAN:4, MAYIS:5, HAZIRAN:6,
  TEMMUZ:7, AGUSTOS:8, AĞUSTOS:8, EYLUL:9, EYLÜL:9, EKIM:10, EKİM:10, KASIM:11, ARALIK:12,
});
const DAY_MS = 86400000;

function cleanText(value) {
  return String(value == null ? '' : value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
function fold(value) {
  return cleanText(value).toLocaleUpperCase('tr-TR')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/İ/g, 'I').replace(/Ş/g, 'S').replace(/Ğ/g, 'G').replace(/Ü/g, 'U').replace(/Ö/g, 'O').replace(/Ç/g, 'C');
}
function monthNumber(value) {
  const raw = cleanText(value);
  const english = MONTH_INDEX[raw.toUpperCase()];
  if (english) return english;
  const key = fold(raw);
  const aliases = { OCAK:1, SUBAT:2, MART:3, NISAN:4, MAYIS:5, HAZIRAN:6, TEMMUZ:7, AGUSTOS:8, EYLUL:9, EKIM:10, KASIM:11, ARALIK:12 };
  return aliases[key] || null;
}
function isoDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}
function utcDate(year, month, day) {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return Number.isNaN(date.getTime()) ? null : date;
}
function addDays(date, count) {
  return new Date(date.getTime() + Number(count || 0) * DAY_MS);
}
function merchError(message, code, status = 400, details = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details) error.details = details;
  return error;
}
function assertWeekNumber(week, year) {
  if (!Number.isInteger(week) || week < 1 || week > 53) {
    throw merchError(
      `Merch Calendar ${year} yılında geçersiz LCW hafta numarası içeriyor: ${week}. Buyer Log LCW için 1–53 aralığını kabul eder.`,
      'MERCH_WEEK_OUT_OF_RANGE',
      400,
      { year, week },
    );
  }
}
function firstMondayForYear(year) {
  const jan1 = utcDate(year, 1, 1);
  const mondayIndex = (jan1.getUTCDay() + 6) % 7;
  return addDays(jan1, -mondayIndex);
}
function expectedDays(start) {
  return Array.from({ length: 7 }, (_, index) => addDays(start, index).getUTCDate());
}
function normalizeYearRows(year, rows) {
  if (!Number.isInteger(year) || year < 2000 || year > 2200) throw merchError('Merch Calendar yıl bilgisi okunamadı.', 'MERCH_YEAR_INVALID');
  if (!Array.isArray(rows) || !rows.length) throw merchError(`${year} için hafta satırı bulunamadı.`, 'MERCH_YEAR_EMPTY');
  const firstMonday = firstMondayForYear(year);
  const output = [];
  let previousWeek = 0;
  const monthCounters = new Map();
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index] || {};
    const week = Number(row.week);
    assertWeekNumber(week, year);
    if (week <= previousWeek) throw merchError(`${year} hafta sırası artmıyor: ${previousWeek} → ${week}.`, 'MERCH_WEEK_SEQUENCE');
    if (previousWeek && week !== previousWeek + 1) throw merchError(`${year} Merch Calendar'da ${previousWeek} ile ${week} arasında hafta eksik.`, 'MERCH_WEEK_GAP');
    previousWeek = week;
    const month = Number(row.month);
    if (!Number.isInteger(month) || month < 1 || month > 12) throw merchError(`${year} / ${week}. hafta için ay okunamadı.`, 'MERCH_MONTH_INVALID');
    const start = addDays(firstMonday, (week - 1) * 7);
    const days = Array.isArray(row.days) ? row.days.map(Number).filter(Number.isFinite) : [];
    if (days.length === 7) {
      const expected = expectedDays(start);
      if (days.some((value, dayIndex) => value !== expected[dayIndex])) {
        throw merchError(
          `${year} / ${week}. hafta günleri Merch Calendar ile takvim arasında uyuşmuyor.`,
          'MERCH_DAY_SEQUENCE',
          400,
          { year, week, sourceDays: days, expectedDays: expected },
        );
      }
    }
    const monthWeek = (monthCounters.get(month) || 0) + 1;
    monthCounters.set(month, monthWeek);
    output.push({
      year, week, month, monthWeek,
      start: isoDate(start), end: isoDate(addDays(start, 6)),
    });
  }
  return output;
}

function parseHtmlCalendar(text) {
  const source = String(text || '');
  const sections = [];
  const re = /<app-lcw-calendar\b[^>]*\bid=["']app-lcw-calendar-(\d{4})["'][^>]*>([\s\S]*?)<\/app-lcw-calendar>/gi;
  let match;
  while ((match = re.exec(source))) sections.push({ year: Number(match[1]), html: match[2] });
  if (!sections.length) throw merchError('Dosyada app-lcw-calendar yıl blokları bulunamadı.', 'MERCH_HTML_STRUCTURE');

  const all = [];
  for (const section of sections) {
    const rows = [];
    let currentMonth = null;
    const rowRe = /<tr\b[^>]*\bclass=["'][^"']*nopadding[^"']*noselect[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRe.exec(section.html))) {
      const html = rowMatch[1];
      // HTML/.xls exports may contain fractional rowspan values (e.g. 5.571428571428571).
      // The month is encoded in the header id; its visual row span is not part of the data.
      const monthMatch = /<th\b[^>]*\bid=["']([^"']+)["'][^>]*>/i.exec(html);
      if (monthMatch) currentMonth = monthNumber(monthMatch[1]);
      const weekMatch = /<td\b[^>]*\bclass=["'][^"']*week-cell[^"']*["'][^>]*>([\s\S]*?)<\/td>/i.exec(html);
      if (!weekMatch) continue;
      const week = Number(cleanText(weekMatch[1]));
      const days = [];
      const dayRe = /<span\b[^>]*\bclass=["'][^"']*noselect[^"']*["'][^>]*>\s*(\d{1,2})\s*<\/span>/gi;
      let dayMatch;
      while ((dayMatch = dayRe.exec(html))) days.push(Number(dayMatch[1]));
      rows.push({ week, month: currentMonth, days: days.slice(0, 7) });
    }
    all.push(...normalizeYearRows(section.year, rows));
  }
  return all;
}

function rowArray(sheet) {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
}
function detectYear(name, rows) {
  const fromName = String(name || '').match(/20\d{2}/);
  if (fromName) return Number(fromName[0]);
  for (const row of rows.slice(0, 10)) {
    for (const cell of row || []) {
      const m = String(cell || '').match(/\b(20\d{2})\b/);
      if (m) return Number(m[1]);
    }
  }
  return null;
}
function parseWorkbookCalendar(buffer) {
  let book;
  try { book = XLSX.read(buffer, { type: 'buffer', cellDates: true }); }
  catch (error) { throw merchError('Merch Calendar Excel dosyası açılamadı: ' + error.message, 'MERCH_XLS_READ'); }
  const all = [];
  for (const sheetName of book.SheetNames || []) {
    const rows = rowArray(book.Sheets[sheetName]);
    const year = detectYear(sheetName, rows);
    if (!year) continue;
    let headerIndex = -1, weekCol = -1, monthCol = -1;
    for (let r = 0; r < Math.min(rows.length, 30); r++) {
      const folded = (rows[r] || []).map(fold);
      const w = folded.findIndex(value => value === 'WEEK' || value === 'HAFTA');
      if (w >= 0) {
        headerIndex = r; weekCol = w;
        monthCol = folded.findIndex(value => value === 'MONTH' || value === 'AY');
        break;
      }
    }
    if (headerIndex < 0 || weekCol < 0) continue;
    let currentMonth = null;
    const parsed = [];
    for (const row of rows.slice(headerIndex + 1)) {
      const week = Number(String(row[weekCol] || '').match(/\d+/)?.[0]);
      if (!Number.isFinite(week)) continue;
      if (monthCol >= 0 && cleanText(row[monthCol])) currentMonth = monthNumber(row[monthCol]);
      const dayCells = row.slice(weekCol + 1, weekCol + 8);
      const days = dayCells.map(cell => {
        if (cell instanceof Date) return cell.getUTCDate();
        const n = Number(String(cell || '').match(/\d{1,2}/)?.[0]);
        return Number.isFinite(n) ? n : null;
      }).filter(value => value != null);
      parsed.push({ week, month: currentMonth, days });
    }
    if (parsed.length) all.push(...normalizeYearRows(year, parsed));
  }
  if (!all.length) throw merchError('Excel içinde Year/Month/Week veya Yıl/Ay/Hafta yapısı bulunamadı.', 'MERCH_XLS_STRUCTURE');
  return all;
}

function validateCoverage(weeks) {
  const sorted = weeks.slice().sort((a, b) => a.start.localeCompare(b.start));
  const byKey = new Set();
  const warnings = [];
  for (const item of sorted) {
    const key = `${item.year}-W${String(item.week).padStart(2, '0')}`;
    if (byKey.has(key)) throw merchError(`Aynı LCW hafta iki kez tanımlı: ${key}.`, 'MERCH_DUPLICATE_WEEK');
    byKey.add(key);
  }
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = utcDate(...sorted[i - 1].end.split('-').map(Number));
    const currentStart = utcDate(...sorted[i].start.split('-').map(Number));
    const gap = Math.round((currentStart - prevEnd) / DAY_MS) - 1;
    if (gap > 0) warnings.push({ code:'DATE_GAP', from:sorted[i - 1].end, to:sorted[i].start, days:gap });
    if (gap < 0) throw merchError('Merch Calendar tarih aralıkları birbiriyle çakışıyor.', 'MERCH_DATE_OVERLAP');
  }
  return { sorted, warnings };
}

function parseBuffer(buffer, sourceName) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer || '');
  if (!buffer.length) throw merchError('Merch Calendar dosyası boş.', 'MERCH_EMPTY');
  if (buffer.length > MAX_BYTES) throw merchError('Merch Calendar dosyası 12 MB sınırını aşıyor.', 'MERCH_TOO_LARGE', 413);
  const utf8 = buffer.toString('utf8');
  const isHtml = /<app-lcw-calendar\b/i.test(utf8) || /<html\b/i.test(utf8.slice(0, 4096));
  const weeks = isHtml ? parseHtmlCalendar(utf8) : parseWorkbookCalendar(buffer);
  const checked = validateCoverage(weeks);
  const years = [...new Set(checked.sorted.map(item => item.year))].sort((a, b) => a - b);
  const yearSummary = years.map(year => {
    const list = checked.sorted.filter(item => item.year === year);
    return { year, weeks:list.length, first:list[0]?.start || '', last:list[list.length - 1]?.end || '' };
  });
  return {
    schemaVersion: 1,
    sourceName: String(sourceName || 'Merch Calendar').slice(0, 180),
    uploadedAt: new Date().toISOString(),
    sourceHash: crypto.createHash('sha256').update(buffer).digest('hex'),
    weeks: checked.sorted,
    meta: {
      sourceName: String(sourceName || 'Merch Calendar').slice(0, 180),
      minDate: checked.sorted[0]?.start || '',
      maxDate: checked.sorted[checked.sorted.length - 1]?.end || '',
      yearFrom: years[0] || null,
      yearTo: years[years.length - 1] || null,
      years: yearSummary,
      weekCount: checked.sorted.length,
      warnings: checked.warnings,
    },
  };
}

function load() {
  if (!fs.existsSync(FILE)) return null;
  try {
    const value = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (!value || !Array.isArray(value.weeks) || !value.weeks.length) return null;
    return value;
  } catch (_) { return null; }
}
function save(buffer, sourceName) {
  const value = parseBuffer(buffer, sourceName);
  atomicWriteJson(FILE, value);
  BLDateDimension.setMerchCalendar(value);
  return value;
}
function remove() {
  try { fs.unlinkSync(FILE); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  BLDateDimension.clearMerchCalendar();
  return true;
}
function publicProjection(value = load()) {
  if (!value) return { configured:false, calendar:null, summary:null };
  return {
    configured:true,
    calendar:{
      schemaVersion:value.schemaVersion || 1,
      sourceName:value.sourceName || '',
      uploadedAt:value.uploadedAt || '',
      weeks:value.weeks,
      meta:{ ...(value.meta || {}), uploadedAt:value.uploadedAt || '', sourceName:value.sourceName || '' },
    },
    summary:{
      sourceName:value.sourceName || '',
      uploadedAt:value.uploadedAt || '',
      minDate:value.meta?.minDate || '',
      maxDate:value.meta?.maxDate || '',
      yearFrom:value.meta?.yearFrom || null,
      yearTo:value.meta?.yearTo || null,
      weekCount:Number(value.meta?.weekCount || value.weeks.length || 0),
      years:Array.isArray(value.meta?.years) ? value.meta.years : [],
      warnings:Array.isArray(value.meta?.warnings) ? value.meta.warnings : [],
    },
  };
}
function activateLoaded() {
  const value = load();
  if (value) BLDateDimension.setMerchCalendar(value);
  return value;
}
activateLoaded();

module.exports = {
  FILE, MAX_BYTES, parseBuffer, parseHtmlCalendar, parseWorkbookCalendar,
  load, save, remove, publicProjection, activateLoaded,
};
