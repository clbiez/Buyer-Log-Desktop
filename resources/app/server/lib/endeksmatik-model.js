'use strict';

/* Endeksmatik USD modeli (Bangladeş, Hindistan Kuzey/Güney, Myanmar, Çin).
 *
 * Bu modül çalışma kitabını HÜCRE ADRESİNE göre değil, sayfa adı + başlık
 * metnine göre okur. ENDEKSMATİK ekranı ise kontrol amaçlı kullanılır:
 *   1. İMZA  — ekrandaki formüllerin beklenen mantığa (sipariş ayı Δ, pay ağırlıklı
 *              toplam, düzeltme) dayandığı doğrulanır; tanınmayan mantık → red.
 *   2. UZLAŞTIRMA — Excel'in önbellekli sonuçları Buyer Log'un yeniden hesabıyla
 *              karşılaştırılır; tolerans dışı → red.
 * Böylece yeni bir Excel sürümünde hücre yerleri ya da mantık değişirse Buyer Log
 * sessizce yanlış hesap yapmaz; yükleme açık bir "model değişti" hatasıyla durur.
 *
 * Hesap (ENDEKSMATİK ekranı ile aynı):
 *   Δ_i      = P_i[bu yıl sipariş ayı] / P_i[geçen yıl sipariş ayı] − 1   (4 bileşen)
 *   TOPLAM   = Σ pay_i · Δ_i                                (doğrudan USD endeksi)
 *   hedef_i  = (1 + Δ_i)(1 − düzeltme) − 1                  (tüm bileşenlere)
 *   ideal    = emsal × (1 + Σ pay_i · hedef_i)
 * TR fiyatı (Buyer Log'a özgü, korunur): USD hedef endeksi DOLAR (TL/USD) kurunun
 * depo ayları arasındaki değişimiyle TL'ye taşınır.
 */

const crypto = require('crypto');
const path = require('path');

const MODEL_ID = 'endeksmatik-usd-v1';
const PARSER_VERSION = 2;
const SCHEMA_VERSION = 2;
const COMPONENTS = Object.freeze(['fabric', 'cmt', 'accessory', 'extra']);
const COMPONENT_LABELS = Object.freeze({ fabric: 'Kumaş', cmt: 'CMT', accessory: 'Aksesuar', extra: 'Ek İşlem' });
const LEVEL_LABELS = Object.freeze(['Genel Toplam', 'MMYG', 'MAG', 'Tedarik Grup', 'Buyer Grup', 'Klasman']);
const SHEETS = Object.freeze({
  screen: 'ENDEKSMATİK',
  summary: 'KLASMAN LİSTESİ ÖZET',
  fabric: 'KLASMAN KUMAŞ PİVOT',
  cmt: 'KLASMAN CMT PİVOT',
  accessory: 'KLASMAN AKSESUAR PİVOT',
  extra: 'KLASMAN EK İŞLEM PİVOT',
  fx: 'Değişimler',
});
const DIM_HEADERS = Object.freeze(['MERCH MARKA YAS GRUP', 'MERCH ALT GRUP', 'TEDARIK GRUP', 'BUYER GRUP', 'KLASMAN']);
/* ENDEKSMATİK ekranının kontrol hücreleri. Veri bu hücrelerden OKUNMAZ; yalnız
   imza (formül mantığı) ve uzlaştırma (önbellekli sonuç) için kullanılır. Yeni bir
   Excel sürümünde yerleri değişirse imza tutmaz ve yükleme reddedilir. */
const SCREEN_LAYOUT = Object.freeze({
  season: 'C2', updatedAt: 'C3',
  selection: ['C4', 'C5', 'C6', 'C7', 'C8'],
  previousOrderMonth: 'C9', previousDepotMonth: 'C10', orderMonth: 'C11', depotMonth: 'C12',
  adjustment: 'B21',
  componentIndex: ['C15', 'C16', 'C17', 'C18'],
  totalIndex: 'C19',
  componentTarget: ['E15', 'E16', 'E17', 'E18'],
});
const CURRENCY_HEADERS = Object.freeze([
  { label: 'DOLAR', currency: 'TRY' },
  { label: 'TAKA', currency: 'BDT', region: 'Bangladeş' },
  { label: 'RUPI', currency: 'INR', region: 'Hindistan' },
  { label: 'RUPEE', currency: 'INR', region: 'Hindistan' },
  { label: 'KYAT', currency: 'MMK', region: 'Myanmar' },
  { label: 'YUAN', currency: 'CNY', region: 'Çin' },
]);
const RECONCILE_TOLERANCE = 1e-6;
const DEFAULT_LANDED_FACTOR = 1.08;
const DEFAULT_TARGET_ADVANTAGE_PCT = 27;

let _xlsx = null;
function getXLSX() { if (!_xlsx) { _xlsx = require('xlsx'); try { require('../../public/excel-date-utils').installSheetJsHooks(_xlsx); } catch (_) {} } return _xlsx; }

function modelError(message, code, details = null, statusCode = 422) {
  return Object.assign(new Error(message), { code, statusCode, details });
}
function text(value) { return String(value == null ? '' : value).trim().replace(/\s+/g, ' '); }
function norm(value) {
  return text(value).toLocaleUpperCase('tr-TR').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/İ/g, 'I').replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function keyOf(values) { return (values || []).map(norm).join('\u001f'); }
function levelKey(level, dims) { return `${level}|${keyOf((dims || []).slice(0, level))}`; }
function numberValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = text(value); if (!raw) return null;
  let v = raw.replace(/\s+/g, '').replace(/%$/, '');
  if (v.includes(',') && v.includes('.')) v = v.lastIndexOf(',') > v.lastIndexOf('.') ? v.replace(/\./g, '').replace(',', '.') : v.replace(/,/g, '');
  else if (v.includes(',')) v = v.replace(',', '.');
  const n = Number(v); return Number.isFinite(n) ? n : null;
}
function isMonthCode(v) { const m = /^(\d{4})(\d{2})$/.exec(v); return Boolean(m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[1]) >= 1990 && Number(m[1]) <= 2999); }
/* Ay değeri YYYYAA metni/sayısı, "YYYY-AA" ya da Excel tarih seri numarası olabilir. */
function monthCodeOf(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    const whole = String(Math.round(value));
    if (isMonthCode(whole)) return whole;
    if (value > 20000 && value < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`; }
    return '';
  }
  const v = text(value);
  if (isMonthCode(v)) return v;
  let m = /^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/.exec(v); if (m) { const c = `${m[1]}${m[2].padStart(2, '0')}`; return isMonthCode(c) ? c : ''; }
  m = /^(\d{1,2})[-/.](\d{4})$/.exec(v); if (m) { const c = `${m[2]}${m[1].padStart(2, '0')}`; return isMonthCode(c) ? c : ''; }
  return '';
}
function excelDateText(value) {
  if (typeof value === 'number' && value > 20000 && value < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000).toISOString().slice(0, 10);
  const v = text(value); const m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(v);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : v;
}
function findSheetName(names, target) {
  const wanted = norm(target);
  return (names || []).find(name => name === target) || (names || []).find(name => norm(name) === wanted) || '';
}
function sheetRows(ws) { return getXLSX().utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true }); }

/* ---------------------------------------------------------------- pivotlar */
function locateDimHeader(rows, sheetName) {
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const row = rows[r] || [], cols = DIM_HEADERS.map(() => -1);
    row.forEach((value, col) => { const n = norm(value); const i = DIM_HEADERS.findIndex(h => n === h || n.startsWith(`${h} `)); if (i >= 0 && cols[i] < 0) cols[i] = col; });
    if (cols.every(c => c >= 0)) return { row: r, cols };
  }
  throw modelError(`${sheetName}: MMYG / MAG / Tedarik Grup / Buyer Grup / Klasman başlık satırı bulunamadı. Excel modeli değişmiş olabilir.`, 'MODEL_HEADER_MISSING', { sheet: sheetName });
}
/* Pivot hiyerarşisini dolaşır. Tablo düzeninde üst seviye etiketler yalnız grubun
   ilk satırında yazılıdır (alt satırlarda boş) — bu yüzden aşağı doldurulur.
   "Toplam X" (ya da "X Toplam") satırı, alt seviyeleri boş bir ÜST SEVİYE
   kaydıdır; "Genel Toplam" en üst (seviye 0) kayıttır. */
function walkHierarchy(rows, header, visit) {
  const carry = ['', '', '', '', ''];
  for (let r = header.row + 1; r < rows.length; r++) {
    const row = rows[r] || [], cells = header.cols.map(c => text(row[c]));
    const first = cells.findIndex(Boolean); if (first < 0) continue;
    const lowerBlank = cells.slice(first + 1).every(v => !v), label = cells[first];
    if (/^genel toplam$/i.test(label)) { visit({ level: 0, dims: ['', '', '', '', ''], row, kind: 'grand' }); continue; }
    const total = lowerBlank ? (/^toplam\s+(.+)$/i.exec(label) || /^(.+?)\s+toplam$/i.exec(label)) : null;
    if (total) {
      const dims = [...carry.slice(0, first), total[1].trim(), '', '', '', ''].slice(0, 5);
      visit({ level: first + 1, dims, row, kind: 'subtotal' }); continue;
    }
    for (let j = first; j < 5; j++) carry[j] = cells[j];
    const level = carry.findIndex(v => !v);
    visit({ level: level < 0 ? 5 : level, dims: carry.slice(), row, kind: level < 0 ? 'detail' : 'group' });
  }
}
function findMonthColumns(rows, header, sheetName) {
  const scan = [header.row, header.row - 1, header.row - 2, header.row + 1].filter(r => r >= 0 && r < rows.length);
  for (const r of scan) {
    const cols = [];
    (rows[r] || []).forEach((value, col) => {
      if (header.cols.includes(col)) return;
      const m = /^(?:toplam\s+)?(\d{6})$/i.exec(text(value));
      if (m && isMonthCode(m[1])) cols.push({ col, month: m[1] });
    });
    if (cols.length >= 2) return cols;
  }
  throw modelError(`${sheetName}: "Toplam YYYYAA" ay sütunları bulunamadı. Excel modeli değişmiş olabilir.`, 'MODEL_MONTHS_MISSING', { sheet: sheetName });
}
function parsePivot(ws, sheetName) {
  const rows = sheetRows(ws), header = locateDimHeader(rows, sheetName), monthCols = findMonthColumns(rows, header, sheetName);
  const data = new Map(); let grand = null, detailCount = 0;
  walkHierarchy(rows, header, ({ level, dims, row, kind }) => {
    const values = monthCols.map(({ col }) => numberValue(row[col]));
    if (!values.some(v => Number.isFinite(v))) return;
    const key = levelKey(level, dims); if (data.has(key)) return;
    const series = {}; monthCols.forEach(({ month }, i) => { if (Number.isFinite(values[i])) series[month] = values[i]; });
    data.set(key, { level, dims, series });
    if (kind === 'grand') grand = series; if (kind === 'detail') detailCount++;
  });
  if (!detailCount) throw modelError(`${sheetName}: klasman satırı bulunamadı.`, 'MODEL_EMPTY_PIVOT', { sheet: sheetName });
  return { months: monthCols.map(x => x.month), data, grand };
}
const WEIGHT_PATTERNS = Object.freeze({ fabric: /\bKUMAS\b/, cmt: /\bCMT\b/, accessory: /\bAKSESUAR\b/, extra: /\bEK ISLEM\b/ });
function parseSummary(ws, sheetName) {
  const rows = sheetRows(ws), header = locateDimHeader(rows, sheetName), headRow = rows[header.row] || [];
  const weightCols = {};
  COMPONENTS.forEach(component => {
    const candidates = [];
    headRow.forEach((value, col) => { if (!header.cols.includes(col) && WEIGHT_PATTERNS[component].test(norm(value))) candidates.push(col); });
    // Aynı bileşen için birden çok sütun varsa (ör. tutar + pay) değerleri 0..1
    // aralığında kalan PAY sütunu seçilir.
    const score = col => { let ok = 0, seen = 0; for (let r = header.row + 1; r < Math.min(rows.length, header.row + 200); r++) { const n = numberValue((rows[r] || [])[col]); if (Number.isFinite(n)) { seen++; if (n >= 0 && n <= 1.0001) ok++; } } return seen ? ok / seen : 0; };
    const best = candidates.map(col => ({ col, s: score(col) })).sort((a, b) => b.s - a.s)[0];
    if (!best || best.s < 0.95) throw modelError(`${sheetName}: ${COMPONENT_LABELS[component]} maliyet payı sütunu bulunamadı.`, 'MODEL_WEIGHTS_MISSING', { sheet: sheetName, component });
    weightCols[component] = best.col;
  });
  const data = new Map();
  walkHierarchy(rows, header, ({ level, dims, row }) => {
    const weights = COMPONENTS.map(c => numberValue(row[weightCols[c]]));
    if (weights.some(v => !Number.isFinite(v))) return;
    const key = levelKey(level, dims); if (!data.has(key)) data.set(key, { level, dims, weights });
  });
  if (!data.size) throw modelError(`${sheetName}: maliyet payı kaydı bulunamadı.`, 'NO_RECORDS', { sheet: sheetName });
  return data;
}

/* -------------------------------------------------------------------- kurlar */
function parseRateTables(ws) {
  const rows = sheetRows(ws), out = {}, labels = {};
  const monthsBelow = (r, c) => { let n = 0; for (let i = r + 1; i < Math.min(rows.length, r + 40); i++) if (monthCodeOf((rows[i] || [])[c])) n++; return n; };
  const ratesBelow = (r, c) => { let n = 0; for (let i = r + 1; i < Math.min(rows.length, r + 40); i++) { const v = (rows[i] || [])[c]; const x = numberValue(v); if (Number.isFinite(x) && x > 0 && !monthCodeOf(v)) n++; } return n; };
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    (rows[r] || []).forEach((value, c) => {
      const n = norm(value); const def = CURRENCY_HEADERS.find(h => n === h.label || n.startsWith(`${h.label} `) || n.endsWith(` ${h.label}`));
      if (!def || out[def.currency]) return;
      const pairs = [[c - 1, c], [c, c + 1]].filter(([m]) => m >= 0);
      const pair = pairs.find(([m, v]) => monthsBelow(r, m) >= 3 && ratesBelow(r, v) >= 3);
      if (!pair) return;
      const table = {};
      for (let i = r + 1; i < rows.length; i++) {
        const row = rows[i] || [], month = monthCodeOf(row[pair[0]]), rate = numberValue(row[pair[1]]);
        if (month && Number.isFinite(rate) && rate > 0 && !table[month]) table[month] = rate;
      }
      if (Object.keys(table).length) { out[def.currency] = table; labels[def.currency] = def; }
    });
  }
  return { tables: out, labels };
}

/* ------------------------------------------------------------ formül imzası */
function decodeCell(ref) { const m = /^\$?([A-Z]{1,3})\$?(\d+)$/.exec(ref); if (!m) return null; let c = 0; for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64; return { c: c - 1, r: Number(m[2]) - 1 }; }
function encodeCell({ c, r }) { let s = '', n = c + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return `${s}${r + 1}`; }
function formulaRefs(formula, definedNames) {
  let f = String(formula || '').replace(/"(?:[^"]|"")*"/g, '""');
  const sheets = new Set(), local = new Set();
  f = f.replace(/(?:'((?:[^']|'')+)'|([A-Za-z0-9_.À-ɏ]+))!\$?[A-Z]{0,3}\$?\d*(?::\$?[A-Z]{0,3}\$?\d*)?/g, (_, quoted, bare) => { sheets.add((quoted || bare || '').replace(/''/g, "'")); return ' '; });
  // Tanımlı adlar (ör. KumasTablo) başka sayfaya işaret ediyorsa o sayfa da sayılır.
  if (definedNames && definedNames.size) {
    f = f.replace(/[A-Za-z_À-ɏ][A-Za-z0-9_.À-ɏ]*/g, token => {
      const ref = definedNames.get(token.toUpperCase()); if (!ref) return token;
      const m = /^(?:'((?:[^']|'')+)'|([^!]+))!/.exec(ref); if (m) sheets.add((m[1] || m[2]).replace(/''/g, "'"));
      return ' ';
    });
  }
  f.replace(/(^|[^A-Za-z0-9_.])(\$?[A-Z]{1,3}\$?\d+)(?::(\$?[A-Z]{1,3}\$?\d+))?(?![A-Za-z0-9_(])/g, (_, _pre, a, b) => {
    const s = decodeCell(a), e = b ? decodeCell(b) : null; if (!s) return '';
    if (!e) { local.add(encodeCell(s)); return ''; }
    for (let r = Math.min(s.r, e.r); r <= Math.max(s.r, e.r) && r - s.r < 500; r++) for (let c = Math.min(s.c, e.c); c <= Math.max(s.c, e.c); c++) local.add(encodeCell({ c, r }));
    return '';
  });
  return { sheets, local };
}
/* Hücrenin formülünü AYNI sayfadaki ara hücreler üzerinden (sınırlı derinlikte)
   izler; sonunda dokunulan yerel hücreleri ve başka sayfaları döndürür. */
function traceFormula(ws, address, definedNames, depth = 5) {
  const sheets = new Set(), cells = new Set(), seen = new Set();
  let hasFormula = false;
  const visit = (addr, d) => {
    if (seen.has(addr) || d < 0) return; seen.add(addr);
    const cell = ws[addr]; if (!cell || !cell.f) return;
    if (addr === address) hasFormula = true;
    const refs = formulaRefs(cell.f, definedNames);
    refs.sheets.forEach(s => sheets.add(norm(s)));
    refs.local.forEach(ref => { cells.add(ref); visit(ref, d - 1); });
  };
  visit(address, depth);
  return { hasFormula, sheets, cells, formula: ws[address] && ws[address].f || '' };
}
function checkSignature(ws, definedNames) {
  const L = SCREEN_LAYOUT, failures = [], notes = [];
  const pivotNames = COMPONENTS.map(c => norm(SHEETS[c]));
  COMPONENTS.forEach((component, i) => {
    const addr = L.componentIndex[i], t = traceFormula(ws, addr, definedNames), label = COMPONENT_LABELS[component];
    if (!t.hasFormula) { failures.push(`${addr} (${label} Δ) formül değil`); return; }
    if (!t.sheets.has(pivotNames[i])) failures.push(`${addr} (${label} Δ) ${SHEETS[component]} sayfasına bağlı değil`);
    pivotNames.forEach((p, j) => { if (j !== i && t.sheets.has(p)) failures.push(`${addr} (${label} Δ) başka bileşenin pivotunu kullanıyor (${SHEETS[COMPONENTS[j]]})`); });
    if (!t.cells.has(L.previousOrderMonth) || !t.cells.has(L.orderMonth)) failures.push(`${addr} (${label} Δ) geçen/bu yıl sipariş ayına (${L.previousOrderMonth}/${L.orderMonth}) bağlı değil`);
    if (t.cells.has(L.previousDepotMonth) || t.cells.has(L.depotMonth)) failures.push(`${addr} (${label} Δ) antrepo/depo ayını (${L.previousDepotMonth}/${L.depotMonth}) kullanıyor — bu Buyer Log'un tanıdığı model değil`);
    L.selection.forEach(sel => { if (!t.cells.has(sel)) failures.push(`${addr} (${label} Δ) seçim hücresi ${sel}'e bağlı değil`); });
    /* Hedef hücreleri (E15..E18) fiyatı belirleyen Δ zincirinin parçası değildir;
       gerçek dosyalarda farklı kurulabildikleri görüldü (v7.0.173). Bu yüzden
       yapıları RED sebebi değil, bilgi notudur; sayısal kontrol uzlaştırmada yapılır. */
    const tt = traceFormula(ws, L.componentTarget[i], definedNames);
    if (!tt.hasFormula) notes.push(`${L.componentTarget[i]} (${label} hedef) formül değil`);
    else {
      if (!tt.cells.has(L.adjustment)) notes.push(`${L.componentTarget[i]} (${label} hedef) ${L.adjustment}'e bağlı değil`);
      if (!tt.cells.has(addr)) notes.push(`${L.componentTarget[i]} (${label} hedef) ${addr}'e bağlı değil`);
    }
  });
  const total = traceFormula(ws, L.totalIndex, definedNames);
  if (!total.hasFormula) failures.push(`${L.totalIndex} (TOPLAM) formül değil`);
  else {
    L.componentIndex.forEach(addr => { if (!total.cells.has(addr)) failures.push(`${L.totalIndex} (TOPLAM) ${addr}'e bağlı değil`); });
    if (!total.sheets.has(norm(SHEETS.summary))) failures.push(`${L.totalIndex} (TOPLAM) ${SHEETS.summary} paylarına bağlı değil`);
  }
  return { ok: !failures.length, model: MODEL_ID, failures, notes };
}

/* ------------------------------------------------------------------ çalışma alanı */
function buildIndex(snapshot) {
  if (!snapshot || Number(snapshot.schemaVersion) !== SCHEMA_VERSION || snapshot.model !== MODEL_ID || !Array.isArray(snapshot.months) || !Array.isArray(snapshot.records))
    throw modelError('Endeksmatik set formatı geçersiz.', 'SET_INVALID', null, 500);
  const monthIndex = new Map(snapshot.months.map((m, i) => [String(m), i]));
  const byKey = new Map(), bySupplyless = new Map();
  snapshot.records.forEach(record => {
    const [level, ...rest] = record; const dims = rest.slice(0, 5);
    const key = levelKey(level, dims); if (byKey.has(key)) return; byKey.set(key, record);
    if (level >= 3) { const short = `${level}|${keyOf([dims[0], dims[1], ...dims.slice(3, level)])}`; if (!bySupplyless.has(short)) bySupplyless.set(short, []); bySupplyless.get(short).push(record); }
  });
  return { snapshot, monthIndex, byKey, bySupplyless };
}
function recordParts(record) {
  return { level: record[0], dims: record.slice(1, 6), weights: record.slice(6, 10), series: record.slice(10, 14) };
}
function resolveRecord(runtime, input) {
  const all = [input.mmyg, input.mag, input.supplyGroup, input.buyingGroup, input.category].map(text);
  const requested = Number(input.level);
  const level = Number.isInteger(requested) && requested >= 1 && requested <= 5 ? requested : 5;
  const dims = all.slice(0, level);
  const missing = dims.map((v, i) => (!v && i !== 2 ? LEVEL_LABELS[i + 1] : '')).filter(Boolean);
  if (missing.length) throw modelError(`${LEVEL_LABELS[level]} seviyesi için eksik alan: ${missing.join(', ')}.`, 'CLASS_FIELDS_MISSING', { missing, level });
  const available = () => [4, 3, 2, 1].filter(l => l < level).filter(l => {
    const d = all.slice(0, l); if (l >= 3 && !d[2]) return (runtime.bySupplyless.get(`${l}|${keyOf([d[0], d[1], ...d.slice(3, l)])}`) || []).length === 1;
    return runtime.byKey.has(levelKey(l, d));
  });
  if (level < 3 || dims[2]) {
    const record = runtime.byKey.get(levelKey(level, dims));
    if (!record) throw modelError(`Bu ${LEVEL_LABELS.slice(1, level + 1).join(' + ')} kombinasyonu seçili Endeksmatik setinde bulunamadı.`, 'CLASS_NOT_FOUND', { level, availableLevels: available() });
    return { record, level };
  }
  const candidates = runtime.bySupplyless.get(`${level}|${keyOf([dims[0], dims[1], ...dims.slice(3, level)])}`) || [];
  if (candidates.length === 1) return { record: candidates[0], level };
  if (!candidates.length) throw modelError(`Bu ${LEVEL_LABELS.slice(1, level + 1).filter((_, i) => i !== 2).join(' + ')} kombinasyonu seçili Endeksmatik setinde bulunamadı.`, 'CLASS_NOT_FOUND', { level, availableLevels: available() });
  throw modelError('Tedarik Grup otomatik belirlenemedi. Lütfen Tedarik Grup seçin.', 'SUPPLY_GROUP_AMBIGUOUS', { supplyGroups: [...new Set(candidates.map(r => r[3]).filter(Boolean))] });
}
function seriesAt(runtime, record, componentIndex, month, label) {
  const arr = record[10 + componentIndex], idx = runtime.monthIndex.get(month);
  const value = Array.isArray(arr) && idx != null ? numberValue(arr[idx]) : null;
  if (!Number.isFinite(value) || value <= 0) throw modelError(`${label} için ${month} Endeksmatik değeri bulunamadı.`, 'COMPONENT_VALUE_MISSING', { component: label, month });
  return value;
}
function requireMonth(value, label, runtime, { optional = false } = {}) {
  const code = monthCodeOf(value);
  if (!code) { if (optional && (value == null || value === '')) return ''; throw modelError(`${label} YYYYAA formatında geçerli bir ay olmalıdır.`, 'MONTH_INVALID', null, 400); }
  if (runtime && !runtime.monthIndex.has(code)) throw modelError(`${label} (${code}) Endeksmatik veri aralığında yok.`, 'MONTH_OUT_OF_RANGE');
  return code;
}
function componentIndexes(runtime, record, oldMonth, newMonth, adjustment) {
  const { weights } = recordParts(record);
  return COMPONENTS.map((component, i) => {
    const label = COMPONENT_LABELS[component];
    const oldValue = seriesAt(runtime, record, i, oldMonth, label), newValue = seriesAt(runtime, record, i, newMonth, label);
    const index = newValue / oldValue - 1;
    return { component, label, weight: numberValue(weights[i]), oldMonth, newMonth, oldValue, newValue, index, targetIndex: (1 + index) * (1 - adjustment) - 1 };
  });
}
function weightedIndexes(items) {
  return { index: items.reduce((s, x) => s + x.weight * x.index, 0), target: items.reduce((s, x) => s + x.weight * x.targetIndex, 0) };
}

/* ---------------------------------------------------------------- SING OFF */
/* SING OFF sayfasının model bazlı karar mantığı (Excel'deki gizli sayfa #REF!
   ile kırık olduğundan burada açıkça yazılı):
     ideal         = emsal × (1 + hedef endeks)
     EDER          = EDER maliyeti × (1 + EDER endeksi)
     en düşük      = MIN(sıfır olmayan ideal / EDER / tedarikçi / rakip)
     TR USD        = TR TL fiyatı ÷ kur(TR depo ayı)
     FOB avantaj   = 1 − YD ÷ TR USD
     landed avantaj= 1 − YD × landed ÷ TR USD             (landed varsayılan 1,08)
     gerekli fiyat = (1 − hedef avantaj) × TR USD ÷ landed (hedef avantaj %27) */
function singOffDecision(input = {}) {
  const pos = v => { const n = numberValue(v); return Number.isFinite(n) && n > 0 ? n : null; };
  const landedRaw = numberValue(input.landedFactor), landedFactor = Number.isFinite(landedRaw) && landedRaw >= 1 && landedRaw <= 3 ? landedRaw : DEFAULT_LANDED_FACTOR;
  const targetRaw = numberValue(input.targetAdvantagePct), targetAdvantagePct = Number.isFinite(targetRaw) && targetRaw > -100 && targetRaw < 100 ? targetRaw : DEFAULT_TARGET_ADVANTAGE_PCT;
  const target = targetAdvantagePct / 100;
  const ideal = pos(input.idealPrice), ederCost = pos(input.ederCost);
  const ederIndexRaw = numberValue(input.ederIndex), ederIndex = Number.isFinite(ederIndexRaw) ? ederIndexRaw : 0;
  const eder = ederCost != null ? ederCost * (1 + ederIndex) : null;
  const supplier = pos(input.supplierOffer), competitor = pos(input.competitorOffer);
  const offers = [['ideal', ideal], ['eder', eder], ['supplier', supplier], ['competitor', competitor]].filter(([, v]) => v != null && v > 0);
  const lowest = offers.length ? offers.reduce((a, b) => (b[1] < a[1] ? b : a)) : null;
  const overseasPrice = pos(input.overseasPrice) ?? (lowest ? lowest[1] : null);
  const trTry = pos(input.trPriceTry), trFx = pos(input.trFx);
  const trUsd = trTry != null && trFx != null ? trTry / trFx : pos(input.trPriceUsd);
  const fobAdvantage = trUsd != null && overseasPrice != null ? 1 - overseasPrice / trUsd : null;
  const landedAdvantage = trUsd != null && overseasPrice != null ? 1 - overseasPrice * landedFactor / trUsd : null;
  const requiredPrice = trUsd != null ? (1 - target) * trUsd / landedFactor : null;
  let decision = 'NO_TR_PRICE';
  if (trUsd != null && overseasPrice != null) decision = landedAdvantage >= target - 1e-12 ? 'OVERSEAS' : landedAdvantage > 0 ? 'BELOW_TARGET' : 'DOMESTIC';
  else if (trUsd != null) decision = 'NO_OVERSEAS_PRICE';
  return {
    ideal, eder, ederCost, ederIndex, supplier, competitor,
    lowest: lowest ? { source: lowest[0], price: lowest[1] } : null,
    overseasPrice, trPriceTry: trTry, trFx, trPriceUsd: trUsd, trMonth: text(input.trMonth),
    fobAdvantage, landedAdvantage, requiredPrice, gapToRequired: requiredPrice != null && overseasPrice != null ? overseasPrice - requiredPrice : null,
    landedFactor, targetAdvantagePct, decision,
  };
}

/* ------------------------------------------------------------------ hesap */
function calculate(snapshot, input = {}, runtime = buildIndex(snapshot)) {
  const { record, level } = resolveRecord(runtime, input);
  const previousOrderMonth = requireMonth(input.previousOrderMonth, 'Geçen sipariş ayı', runtime);
  const newOrderMonth = requireMonth(input.newOrderMonth, 'Yeni sipariş ayı', runtime);
  if (newOrderMonth < previousOrderMonth) throw modelError('Yeni sipariş ayı, geçen sipariş ayından eski olamaz.', 'MONTH_ORDER_INVALID', { later: newOrderMonth, earlier: previousOrderMonth });
  const adjustmentRaw = numberValue(input.adjustmentPct);
  const adjustmentPct = Number.isFinite(adjustmentRaw) ? adjustmentRaw : Number(snapshot.targetAdjustmentPct) || 0;
  const a = adjustmentPct / 100;
  const { weights } = recordParts(record);
  if (weights.some(v => !Number.isFinite(numberValue(v)))) throw modelError('Klasman maliyet payları eksik.', 'WEIGHTS_MISSING');
  const weightTotal = weights.reduce((s, v) => s + numberValue(v), 0);
  if (Math.abs(weightTotal - 1) > 0.03) throw modelError(`Klasman maliyet payları %100'e yakın değil (${(weightTotal * 100).toFixed(2)}%).`, 'WEIGHTS_INVALID');

  const components = componentIndexes(runtime, record, previousOrderMonth, newOrderMonth, a);
  const usd = weightedIndexes(components);

  // TR (TL) fiyatı: USD hedef endeksi DOLAR (TL/USD) kurunun depo ayları
  // arasındaki değişimiyle TL'ye taşınır. İstenmedikçe depo ayı zorunlu değil.
  const fxTable = snapshot.fx && snapshot.fx.TRY || {};
  const previousInStoreMonth = requireMonth(input.previousInStoreMonth, 'Geçen depo ayı', null, { optional: true });
  const newInStoreMonth = requireMonth(input.newInStoreMonth, 'Yeni depo ayı', null, { optional: true });
  if (previousInStoreMonth && previousOrderMonth && previousInStoreMonth < previousOrderMonth) throw modelError('Geçen In Store ayı, Geçen sipariş ayı tarihinden eski olamaz.', 'MONTH_ORDER_INVALID', { later: previousInStoreMonth, earlier: previousOrderMonth });
  if (newInStoreMonth && newInStoreMonth < newOrderMonth) throw modelError('Yeni In Store ayı, Yeni sipariş ayı tarihinden eski olamaz.', 'MONTH_ORDER_INVALID', { later: newInStoreMonth, earlier: newOrderMonth });
  const separateTryPeriods = Boolean(input.separateTryPeriods);
  const previousTryOrderMonth = separateTryPeriods ? requireMonth(input.previousTryOrderMonth, 'TR geçen sipariş ayı', runtime) : previousOrderMonth;
  const previousTryInStoreMonth = separateTryPeriods ? requireMonth(input.previousTryInStoreMonth, 'TR geçen depo ayı', null, { optional: true }) : previousInStoreMonth;
  const domesticComponents = separateTryPeriods ? componentIndexes(runtime, record, previousTryOrderMonth, newOrderMonth, a) : components;
  const domesticUsd = separateTryPeriods ? weightedIndexes(domesticComponents) : usd;
  const fxAt = month => { const v = month ? numberValue(fxTable[month]) : null; return Number.isFinite(v) && v > 0 ? v : null; };
  const oldFx = fxAt(previousTryInStoreMonth), newFx = fxAt(newInStoreMonth);
  const fxReady = oldFx != null && newFx != null;
  const tlIndex = fxReady ? (1 + domesticUsd.index) * (newFx / oldFx) - 1 : null;
  const targetTlIndex = fxReady ? (1 + domesticUsd.target) * (newFx / oldFx) - 1 : null;

  // Royalty + Hologram: masraflar endekslenmez (bkz. endeksmatik.js v5.94 notu).
  const royaltyRaw = numberValue(input.royaltyPct), royaltyPct = Number.isFinite(royaltyRaw) && royaltyRaw >= 0 && royaltyRaw < 100 ? royaltyRaw : 0;
  const hologramRaw = numberValue(input.hologramCost), hologramUsd = Number.isFinite(hologramRaw) && hologramRaw >= 0 ? hologramRaw : 0;
  const royaltyIncluded = Boolean(input.royaltyIncluded), royaltyActive = royaltyPct > 0 || hologramUsd > 0;
  const stripCosts = (price, hologram) => (!Number.isFinite(price) || !royaltyActive ? price : (price - hologram) * (1 - royaltyPct / 100));
  const addCosts = (price, hologram) => (!Number.isFinite(price) || !royaltyActive ? price : price / (1 - royaltyPct / 100) + hologram);
  const previousUsdPrice = numberValue(input.previousUsdPrice), previousTryPrice = numberValue(input.previousTryPrice);
  const baseUsd = Number.isFinite(previousUsdPrice) && previousUsdPrice > 0 ? (royaltyIncluded ? stripCosts(previousUsdPrice, hologramUsd) : previousUsdPrice) : null;
  const indexedUsdPrice = baseUsd != null ? baseUsd * (1 + usd.target) : null;
  const newUsdPrice = indexedUsdPrice != null ? addCosts(indexedUsdPrice, hologramUsd) : null;
  let baseTry = null, indexedTryPrice = null, newTryPrice = null;
  if (Number.isFinite(previousTryPrice) && previousTryPrice > 0) {
    if (!fxReady) throw modelError('TR fiyatı için seçilen depo aylarından birinin USD/TL (DOLAR) kuru bu sette yok.', 'FX_MISSING', { previousInStoreMonth: previousTryInStoreMonth, newInStoreMonth });
    baseTry = royaltyIncluded ? stripCosts(previousTryPrice, hologramUsd * oldFx) : previousTryPrice;
    indexedTryPrice = baseTry * (1 + targetTlIndex);
    newTryPrice = addCosts(indexedTryPrice, hologramUsd * newFx);
  }

  let singOff = null;
  const so = input.singOff && typeof input.singOff === 'object' ? input.singOff : null;
  if (so) {
    const trMonth = monthCodeOf(so.trMonth) || newInStoreMonth;
    const soFx = numberValue(so.trFx) > 0 ? numberValue(so.trFx) : fxAt(trMonth);
    const ederIdx = numberValue(so.ederIndexPct);
    singOff = singOffDecision({ ...so, idealPrice: newUsdPrice, trMonth, trFx: soFx, ederIndex: Number.isFinite(ederIdx) ? ederIdx / 100 : usd.target });
  }

  const [, mmyg, mag, supplyGroup, buyingGroup, category] = record;
  return {
    ok: true, model: MODEL_ID, level, levelLabel: LEVEL_LABELS[level],
    class: { mmyg, mag, supplyGroup, buyingGroup, category },
    months: { previousOrderMonth, newOrderMonth, previousInStoreMonth, newInStoreMonth, previousTryOrderMonth, previousTryInStoreMonth, separateTryPeriods },
    previousPrices: { try: Number.isFinite(previousTryPrice) ? previousTryPrice : null, usd: Number.isFinite(previousUsdPrice) ? previousUsdPrice : null },
    indexes: { usd: usd.index, targetUsd: usd.target, tl: tlIndex, targetTl: targetTlIndex, adjustmentPct },
    costs: { royaltyPct, hologramUsd, royaltyIncluded, active: royaltyActive, indexedBase: { usd: baseUsd, try: baseTry }, indexedBeforeCosts: { usd: indexedUsdPrice, try: indexedTryPrice } },
    fx: { previous: oldFx, new: newFx, change: fxReady ? newFx / oldFx - 1 : null },
    components, componentsUsd: components, componentsTry: domesticComponents,
    prices: { usd: newUsdPrice, try: newTryPrice },
    singOff,
    source: { setId: snapshot.id, setVersion: snapshot.hash, model: MODEL_ID, label: snapshot.label || '', region: snapshot.region || '', sourceFile: snapshot.sourceFile || '', season: snapshot.season || '', sourceUpdatedAt: snapshot.sourceUpdatedAt || '', uploadedAt: snapshot.uploadedAt || '', targetAdjustmentPct: Number(snapshot.targetAdjustmentPct) || 0 },
  };
}

/* -------------------------------------------------------------- uzlaştırma */
function reconcile(snapshot, screenValues) {
  const runtime = buildIndex(snapshot), L = SCREEN_LAYOUT, checks = [];
  const sel = screenValues.selection, level = (() => { const i = sel.findIndex(v => !v); return i < 0 ? 5 : i; })();
  if (!level) throw modelError(`ENDEKSMATİK seçim hücreleri (${L.selection.join(', ')}) boş; uzlaştırma yapılamıyor.`, 'MODEL_RECONCILE_SELECTION');
  if (!screenValues.previousOrderMonth || !screenValues.orderMonth) throw modelError(`ENDEKSMATİK sipariş ayları (${L.previousOrderMonth}/${L.orderMonth}) okunamadı.`, 'MODEL_RECONCILE_MONTHS');
  let result;
  try {
    result = calculate(snapshot, { mmyg: sel[0], mag: sel[1], supplyGroup: sel[2], buyingGroup: sel[3], category: sel[4], level, previousOrderMonth: screenValues.previousOrderMonth, newOrderMonth: screenValues.orderMonth, adjustmentPct: snapshot.targetAdjustmentPct }, runtime);
  } catch (err) {
    throw modelError(`ENDEKSMATİK ekranındaki seçim Buyer Log tarafından yeniden hesaplanamadı: ${err.message}`, 'MODEL_RECONCILE_FAILED', { cause: err.code || '' });
  }
  const compare = (label, cell, expected, actual) => {
    const ok = Number.isFinite(expected) && Number.isFinite(actual) && Math.abs(expected - actual) <= RECONCILE_TOLERANCE * Math.max(1, Math.abs(expected));
    checks.push({ label, cell, excel: Number.isFinite(expected) ? expected : null, buyerLog: actual, ok });
  };
  result.components.forEach((item, i) => compare(`${item.label} Δ`, L.componentIndex[i], screenValues.componentIndex[i], item.index));
  compare('TOPLAM', L.totalIndex, screenValues.totalIndex, result.indexes.usd);
  /* Hedefler: E15..E18, B21 düzeltmesiyle (1+Δ)(1−düzeltme)−1 ise ayrıca
     doğrulanır. Değilse yükleme REDDEDİLMEZ (fiyat Δ + düzeltmeden hesaplanır ve
     düzeltme hesapta değiştirilebilir); durum uyarı olarak kaydedilir. */
  const tolerant = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= RECONCILE_TOLERANCE * Math.max(1, Math.abs(a));
  const excelTargets = screenValues.componentTarget || [];
  const targetsMatch = result.components.every((item, i) => tolerant(excelTargets[i], item.targetIndex));
  let targets = { verified: targetsMatch, derivedAdjustmentPct: null };
  if (targetsMatch) result.components.forEach((item, i) => compare(`${item.label} hedef`, L.componentTarget[i], excelTargets[i], item.targetIndex));
  else if (result.components.every((item, i) => Number.isFinite(excelTargets[i]) && 1 + item.index !== 0)) {
    const derived = result.components.map((item, i) => 1 - (1 + excelTargets[i]) / (1 + item.index));
    if (Math.max(...derived) - Math.min(...derived) <= 1e-7) targets.derivedAdjustmentPct = Math.round(derived[0] * 1e11) / 1e9;
  }
  const failed = checks.filter(c => !c.ok);
  return { ok: !failed.length, level, selection: sel.slice(0, level), previousOrderMonth: screenValues.previousOrderMonth, orderMonth: screenValues.orderMonth, tolerance: RECONCILE_TOLERANCE, checks, targets };
}

/* ---------------------------------------------------------------- ayrıştırma */
function readScreen(ws) {
  const L = SCREEN_LAYOUT, v = addr => (ws[addr] ? ws[addr].v : null);
  const adjustmentRaw = numberValue(v(L.adjustment));
  return {
    season: text(v(L.season)), updatedAt: excelDateText(v(L.updatedAt)),
    // "(Tümü)" gibi pivot filtre değerleri üst seviye seçimi demektir.
    selection: L.selection.map(a => { const t = text(v(a)); return /^\(?\s*(TUMU|HEPSI|ALL)\s*\)?$/.test(norm(t)) ? '' : t; }),
    previousOrderMonth: monthCodeOf(v(L.previousOrderMonth)), orderMonth: monthCodeOf(v(L.orderMonth)),
    adjustmentRaw,
    componentIndex: L.componentIndex.map(a => numberValue(v(a))),
    totalIndex: numberValue(v(L.totalIndex)),
    componentTarget: L.componentTarget.map(a => numberValue(v(a))),
  };
}
function pivotRefreshedAt(workbook) {
  try {
    const files = workbook.files || {}, stamps = [];
    Object.keys(files).filter(k => /pivotCacheDefinition\d*\.xml$/i.test(k)).forEach(k => {
      const entry = files[k], raw = entry && (entry.content || entry._data || entry.asNodeBuffer && entry.asNodeBuffer());
      const xml = raw ? Buffer.from(raw).toString('utf8', 0, Math.min(raw.length || 0, 4096)) : '';
      const m = /refreshedDate="([\d.]+)"/.exec(xml); if (m) stamps.push(Number(m[1]));
    });
    if (!stamps.length) return '';
    const d = new Date(Date.UTC(1899, 11, 30) + Math.max(...stamps) * 86400000); return d.toISOString();
  } catch (_) { return ''; }
}
function regionFrom(sourceFile, currencyLabels) {
  const local = Object.values(currencyLabels || {}).find(def => def.currency !== 'TRY');
  let region = local && local.region || '';
  const f = norm(sourceFile);
  if (!region) { if (/\bBANGLADES|\bBD\b/.test(f)) region = 'Bangladeş'; else if (/MYANMAR/.test(f)) region = 'Myanmar'; else if (/\bCIN\b|CHINA/.test(f)) region = 'Çin'; else if (/HINDISTAN|INDIA/.test(f)) region = 'Hindistan'; }
  if (region === 'Hindistan') { if (/NORTH|KUZEY/.test(f)) region = 'Hindistan Kuzey'; else if (/SOUTH|GUNEY/.test(f)) region = 'Hindistan Güney'; }
  return { region, currency: local ? local.currency : '' };
}
/* Çalışma kitabının bu modele ait olup olmadığını ucuzca söyler (eski TL
   şablonuna geri düşmek için). Yalnız sayfa adlarına bakar. */
function looksLikeModel(sheetNames) {
  return Boolean(findSheetName(sheetNames, SHEETS.screen) && findSheetName(sheetNames, SHEETS.fx) && COMPONENTS.every(c => findSheetName(sheetNames, SHEETS[c])));
}
function readWorkbook(buffer) {
  const XLSX = getXLSX();
  const names = XLSX.read(buffer, { type: 'buffer', bookSheets: true }).SheetNames || [];
  const resolved = {};
  Object.entries(SHEETS).forEach(([key, name]) => { resolved[key] = findSheetName(names, name); });
  const missing = Object.entries(resolved).filter(([, v]) => !v).map(([k]) => SHEETS[k]);
  if (missing.length) throw modelError(`Endeksmatik Excel'de gerekli sayfa yok: ${missing.join(', ')}`, 'SHEET_MISSING', { missing });
  // 40 MB'lık kitaplarda yalnız gereken sayfalar ayrıştırılır.
  const workbook = XLSX.read(buffer, { type: 'buffer', sheets: Object.values(resolved), cellFormula: true, cellDates: false, cellHTML: false, cellText: false, bookFiles: true });
  return { workbook, resolved, names };
}
function definedNameMap(workbook) {
  const map = new Map();
  ((workbook.Workbook && workbook.Workbook.Names) || []).forEach(n => { if (n && n.Name && n.Ref) map.set(String(n.Name).toUpperCase(), String(n.Ref)); });
  return map;
}
function parseWorkbookBuffer(buffer, sourceFile = 'ENDEKSMATİK.xlsx', { now = new Date() } = {}) {
  const { workbook, resolved } = readWorkbook(buffer);
  const sheet = key => workbook.Sheets[resolved[key]];
  const screenWs = sheet('screen');
  const signature = checkSignature(screenWs, definedNameMap(workbook));
  if (!signature.ok) throw modelError(`Endeksmatik modeli değişmiş: ENDEKSMATİK ekranının formül mantığı Buyer Log'un tanıdığı modelle (${MODEL_ID}) eşleşmiyor. ${signature.failures.slice(0, 4).join('; ')}${signature.failures.length > 4 ? ` (+${signature.failures.length - 4})` : ''}`, 'MODEL_SIGNATURE_MISMATCH', { failures: signature.failures });

  const summary = parseSummary(sheet('summary'), resolved.summary);
  const pivots = {}; COMPONENTS.forEach(c => { pivots[c] = parsePivot(sheet(c), resolved[c]); });
  const months = [...new Set(COMPONENTS.flatMap(c => pivots[c].months))].sort();
  const warnings = [];
  COMPONENTS.forEach(c => { if (pivots[c].months.length !== months.length) warnings.push(`${resolved[c]} ${pivots[c].months.length}/${months.length} ay içeriyor.`); });
  const records = []; let missingSeries = 0, weightAnomalies = 0;
  for (const [key, item] of summary.entries()) {
    const series = COMPONENTS.map(c => { const s = pivots[c].data.get(key); return s ? months.map(m => (s.series[m] != null ? s.series[m] : null)) : null; });
    if (series.some(s => !s)) { missingSeries++; continue; }
    const sum = item.weights.reduce((a, b) => a + b, 0); if (Math.abs(sum - 1) > 0.03) weightAnomalies++;
    records.push([item.level, ...item.dims, ...item.weights, ...series]);
  }
  if (!records.some(r => r[0] === 5)) throw modelError('Endeksmatik klasman kaydı bulunamadı (pay ve pivot anahtarları eşleşmiyor).', 'NO_RECORDS');
  if (missingSeries) warnings.push(`${missingSeries} pay kaydının pivot serisi yok; bu kayıtlar alınmadı.`);
  if (weightAnomalies) warnings.push(`${weightAnomalies} kaydın maliyet payı toplamı %100'den sapıyor.`);

  const { tables, labels } = parseRateTables(sheet('fx'));
  if (!tables.TRY) throw modelError('Değişimler sayfasında DOLAR (TL/USD) kur tablosu bulunamadı.', 'FX_TABLE_MISSING');
  const localCurrency = Object.keys(tables).find(c => c !== 'TRY') || '';
  const screen = readScreen(screenWs);
  const adj = screen.adjustmentRaw;
  const targetAdjustmentPct = Number.isFinite(adj) && adj > -1 && adj < 1 ? Math.round(adj * 1e11) / 1e9 : (Number.isFinite(adj) && adj >= 1 && adj <= 100 ? adj : 0);
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const { region, currency } = regionFrom(sourceFile, labels);
  const snapshot = {
    schemaVersion: SCHEMA_VERSION, model: MODEL_ID, parserVersion: PARSER_VERSION,
    id: `em-${hash.slice(0, 16)}`, hash,
    sourceFile: path.basename(sourceFile || 'ENDEKSMATİK.xlsx'), label: '', region, currency: currency || localCurrency,
    season: screen.season, sourceUpdatedAt: screen.updatedAt, pivotRefreshedAt: pivotRefreshedAt(workbook),
    uploadedAt: now.toISOString(), generatedAt: now.toISOString(),
    targetAdjustmentPct, months,
    fx: { TRY: tables.TRY, ...(localCurrency ? { local: tables[localCurrency], localCurrency } : {}) },
    records,
    validation: { signature, reconciliation: null, warnings },
  };
  const reconciliation = reconcile(snapshot, screen);
  snapshot.validation.reconciliation = reconciliation;
  if (!reconciliation.targets.verified) {
    const derived = reconciliation.targets.derivedAdjustmentPct;
    warnings.push(`ENDEKSMATİK hedef hücreleri (${SCREEN_LAYOUT.componentTarget.join(', ')}) ${SCREEN_LAYOUT.adjustment} düzeltmesiyle (%${targetAdjustmentPct}) doğrulanamadı${derived != null ? `; Excel hedefleri %${derived} düzeltmeye karşılık geliyor` : ''}. Varsayılan düzeltme ${SCREEN_LAYOUT.adjustment}'den alındı; hesapta değiştirilebilir.`);
  }
  (signature.notes || []).forEach(note => warnings.push(`İmza notu: ${note}`));
  if (!reconciliation.ok) {
    const bad = reconciliation.checks.filter(c => !c.ok).map(c => `${c.label} (${c.cell}) Excel ${c.excel == null ? '—' : c.excel} ≠ Buyer Log ${c.buyerLog}`);
    throw modelError(`Endeksmatik uzlaştırması başarısız: Excel'in önbellekli sonuçları Buyer Log'un yeniden hesabıyla tutmuyor. ${bad.slice(0, 3).join('; ')}`, 'MODEL_RECONCILE_MISMATCH', { checks: reconciliation.checks });
  }
  return snapshot;
}
/* Yerel inceleme için ENDEKSMATİK ekranının kontrol bölgesini (değer + formül)
   döndürür. Yükleme yolunda kullanılmaz. */
function describeScreen(buffer, range = 'A1:G25') {
  const XLSX = getXLSX();
  const names = XLSX.read(buffer, { type: 'buffer', bookSheets: true }).SheetNames || [];
  const name = findSheetName(names, SHEETS.screen); if (!name) return [];
  const ws = XLSX.read(buffer, { type: 'buffer', sheets: [name], cellFormula: true }).Sheets[name];
  const r = XLSX.utils.decode_range(range), out = [];
  for (let row = r.s.r; row <= r.e.r; row++) for (let col = r.s.c; col <= r.e.c; col++) {
    const addr = XLSX.utils.encode_cell({ r: row, c: col }), cell = ws[addr];
    if (cell && (cell.f || (cell.v != null && cell.v !== ''))) out.push({ cell: addr, value: cell.v, formula: cell.f || '' });
  }
  return out;
}
function publicMeta(snapshot) {
  const levels = [0, 0, 0, 0, 0, 0]; (snapshot.records || []).forEach(r => { levels[r[0]] = (levels[r[0]] || 0) + 1; });
  return {
    id: snapshot.id, model: snapshot.model, schemaVersion: snapshot.schemaVersion, parserVersion: snapshot.parserVersion, version: snapshot.hash,
    label: snapshot.label || '', region: snapshot.region || '', currency: snapshot.currency || '', season: snapshot.season || '',
    sourceFile: snapshot.sourceFile || '', sourceUpdatedAt: snapshot.sourceUpdatedAt || '', pivotRefreshedAt: snapshot.pivotRefreshedAt || '',
    uploadedAt: snapshot.uploadedAt || '', uploadedBy: snapshot.uploadedBy || '', generatedAt: snapshot.generatedAt || '',
    targetAdjustmentPct: Number(snapshot.targetAdjustmentPct) || 0,
    recordCount: levels[5], levelCounts: levels,
    firstMonth: snapshot.months[0] || '', lastMonth: snapshot.months[snapshot.months.length - 1] || '',
    fxFirst: Object.keys(snapshot.fx && snapshot.fx.TRY || {}).sort()[0] || '', fxLast: Object.keys(snapshot.fx && snapshot.fx.TRY || {}).sort().slice(-1)[0] || '',
    validation: snapshot.validation ? { signatureOk: Boolean(snapshot.validation.signature && snapshot.validation.signature.ok), reconciliationOk: Boolean(snapshot.validation.reconciliation && snapshot.validation.reconciliation.ok), checks: snapshot.validation.reconciliation ? snapshot.validation.reconciliation.checks.length : 0, warnings: snapshot.validation.warnings || [] } : null,
  };
}
/* Seçili set için model boyutlarına göre seçenekleri döndürür (ör. Tedarik Grup
   listesi ve hangi üst seviyelerin veride bulunduğu). */
function lookup(snapshot, input = {}, runtime = buildIndex(snapshot)) {
  const all = [input.mmyg, input.mag, input.supplyGroup, input.buyingGroup, input.category].map(text);
  const levels = [5, 4, 3, 2, 1].map(level => {
    const d = all.slice(0, level);
    if (d.some((v, i) => !v && i !== 2)) return { level, label: LEVEL_LABELS[level], available: false };
    if (level >= 3 && !d[2]) { const c = runtime.bySupplyless.get(`${level}|${keyOf([d[0], d[1], ...d.slice(3, level)])}`) || []; return { level, label: LEVEL_LABELS[level], available: c.length === 1, ambiguous: c.length > 1 }; }
    return { level, label: LEVEL_LABELS[level], available: runtime.byKey.has(levelKey(level, d)) };
  });
  const supplyGroups = [...new Set((runtime.bySupplyless.get(`5|${keyOf([all[0], all[1], all[3], all[4]])}`) || []).map(r => r[3]).filter(Boolean))];
  return { ok: true, setId: snapshot.id, levels, supplyGroups };
}

module.exports = {
  MODEL_ID, PARSER_VERSION, SCHEMA_VERSION, COMPONENTS, COMPONENT_LABELS, LEVEL_LABELS, SHEETS, SCREEN_LAYOUT,
  RECONCILE_TOLERANCE, DEFAULT_LANDED_FACTOR, DEFAULT_TARGET_ADVANTAGE_PCT,
  text, norm, keyOf, levelKey, numberValue, monthCodeOf, formulaRefs, traceFormula, checkSignature,
  looksLikeModel, parseWorkbookBuffer, describeScreen, buildIndex, resolveRecord, calculate, singOffDecision, reconcile, publicMeta, lookup,
};
