'use strict';

/* Endeksmatik YAPI RAPORU (v7.0.257).
 *
 * Gösterim: "CUW4" → "A×3 9", "KEY ORME" → "A×3 _ A×4".
 * Gerçek ülke dosyaları büyük (40 MB+) ve şirket verisidir; ne buraya ne bir
 * yapay zekâ aracına yüklenebiliyor. Bu rapor dosyayı YEREL olarak okur ve
 * birkaç KB'lık, paylaşılabilir bir metin üretir:
 *   · sayfa adları, başlık satırları, sütun başlıkları, ENDEKSMATİK formülleri;
 *   · iş değerleri MASKELİ: harf → A, rakam → 9, boşluk → _ (ör. "CUW4" → "A3 9",
 *     "KEY ORME" → "A3 _ A4"); böylece kod/ad farkı ve fazladan boşluk görünür,
 *     değerin kendisi görünmez;
 *   · ÖZET ↔ pivot anahtar örtüşmesi her alan için ayrı sayılır — eşleşmeyi hangi
 *     alanın bozduğu doğrudan okunur.
 * Rapor hiçbir yere gönderilmez; kullanıcı inceleyip kendisi paylaşır. */

const model = require('./endeksmatik-model');

const MAX_SAMPLE_ROWS = 14;
const LETTER = /[A-Za-zÇĞİÖŞÜÂÎÛçğıöşüâîû]/;

function colName(c) { let s = '', n = c + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
/* Değerin biçimini değeri göstermeden yazar. Baştaki/sondaki boşluklar ayrıca
   işaretlenir: anahtar uyuşmazlığının en sık sebeplerinden biri. */
function shape(value) {
  if (value == null || value === '') return '∅';
  if (typeof value === 'number') return Number.isInteger(value) ? 'sayı(tam)' : 'sayı';
  const raw = String(value);
  const t = raw.trim();
  if (!t) return '␠(yalnız boşluk)';
  if (/^genel toplam$/i.test(t)) return '«Genel Toplam»';
  let total = '';
  let body = t;
  let m = /^toplam\s+(.+)$/i.exec(t); if (m) { total = 'Toplam '; body = m[1]; }
  else if ((m = /^(.+?)\s+toplam$/i.exec(t))) { total = ' Toplam'; body = m[1]; }
  const runs = [];
  for (const ch of body) {
    const k = LETTER.test(ch) ? 'A' : /[0-9]/.test(ch) ? '9' : /\s/.test(ch) ? '_' : ch;
    const last = runs[runs.length - 1];
    if (last && last.k === k) last.n++; else runs.push({ k, n: 1 });
  }
  const enc = runs.map(r => (r.k === 'A' || r.k === '9' ? (r.n > 1 ? `${r.k}×${r.n}` : r.k) : r.k === '_' && r.n === 1 ? '_' : r.k.repeat(r.n))).join(' ');
  const pad = (raw !== t ? ' [kenarda boşluk]' : '') + (/\s{2,}/.test(t) ? ' [çift boşluk]' : '');
  return total === 'Toplam ' ? `«Toplam» ${enc}${pad}` : total ? `${enc} «Toplam»${pad}` : `${enc}${pad}`;
}
/* Başlık sözlüğündeki metinler (alan adları, "Toplam 202501", pay/adet) açık
   yazılır; geri kalan her hücre maskelenir — başlık bulunamadığında ilk
   satırlar veri satırı olabilir. */
const HEADER_WORDS = /\b(MERCH|MARKA|YAS|GRUP|ALT|TEDARIK|BUYER|KLASMAN|KOD|KODU|ADI|KUMAS|CMT|AKSESUAR|EK|ISLEM|PAY|ORAN|ADET|TOPLAM|GENEL|SATIR|SUTUN|ETIKETLERI|DEGER|DEGERLER|TOPLAMI|ORTALAMA|SEZON|ULKE|ENDEKS)\b/;
function headerish(v) { const n = model.norm(v); return Boolean(n) && n.split(' ').every(w => HEADER_WORDS.test(w) || /^\d{6}$/.test(w)); }
function headerCells(row, limit = 40) {
  return (row || []).map((v, c) => (v == null || v === '' ? null : `${colName(c)}=${typeof v === 'number' ? (model.monthCodeOf(v) || 'sayı') : headerish(v) ? JSON.stringify(String(v)) : shape(v)}`)).filter(Boolean).slice(0, limit).join('  ');
}

function sheetSection(lines, rows, sheetName, kind, maxSample = MAX_SAMPLE_ROWS) {
  lines.push(`\n## ${sheetName}  (${rows.length} satır)`);
  let header;
  try { header = model.locateDimHeader(rows, sheetName); }
  catch (err) {
    lines.push(`  ✘ başlık satırı bulunamadı (${err.code}). İlk 12 satırın başlık hücreleri:`);
    rows.slice(0, 12).forEach((row, r) => { const h = headerCells(row, 20); if (h) lines.push(`    satır ${r + 1}: ${h}`); });
    return null;
  }
  lines.push(`  başlık satırı: ${header.row + 1}`);
  lines.push(`  boyut sütunları: ${header.cols.map((c, i) => `${model.DIM_HEADERS[i]} → ${colName(c)} ${JSON.stringify(header.labels[i])}`).join(' | ')}`);
  for (let r = Math.max(0, header.row - 2); r <= header.row; r++) lines.push(`  satır ${r + 1}: ${headerCells(rows[r])}`);
  if (kind === 'pivot') {
    try { const months = model.findMonthColumns(rows, header, sheetName); lines.push(`  ay sütunları: ${months.length} (${months[0].month} → ${months[months.length - 1].month}), ilk: ${colName(months[0].col)}`); }
    catch (err) { lines.push(`  ✘ ay sütunları bulunamadı (${err.code})`); }
  } else {
    const head = rows[header.row] || [];
    Object.entries(model.WEIGHT_PATTERNS).forEach(([component, re]) => {
      const cols = head.map((v, c) => (!header.cols.includes(c) && re.test(model.norm(v)) ? `${colName(c)} ${JSON.stringify(String(v))}` : null)).filter(Boolean);
      lines.push(`  ${component} pay sütun adayları: ${cols.join(', ') || '— YOK'}`);
    });
  }
  const counts = { detail: 0, subtotal: 0, group: 0, grand: 0 };
  const firstValueCol = (rows[header.row] || []).findIndex((v, c) => c > Math.max(...header.cols) && v != null && v !== '');
  const sample = [];
  model.walkHierarchy(rows, header, item => {
    counts[item.kind] = (counts[item.kind] || 0) + 1;
    if (sample.length < maxSample) {
      const raw = header.cols.map(c => shape(item.row[c])).join(' | ');
      const val = firstValueCol >= 0 ? shape(item.row[firstValueCol]) : '—';
      sample.push(`    [${item.kind}${item.kind === 'detail' ? '' : ` L${item.level}`}] ${raw}  ‖ ilk değer: ${val}`);
    }
  });
  lines.push(`  satır türleri: klasman=${counts.detail} ara toplam=${counts.subtotal} grup=${counts.group} genel toplam=${counts.grand}`);
  lines.push('  ilk satırlar (maskeli; ham hücreler, aşağı doldurma öncesi):');
  sample.forEach(s => lines.push(s));
  return header;
}
/* Her boyut alanı ve her önek seviyesi için ÖZET ↔ pivot örtüşmesi. */
function overlapSection(lines, summaryRows, summaryHeader, pivotRows, pivotHeader, pivotName) {
  const collect = (rows, header) => {
    const dims = [[], [], [], [], []].map(() => new Set()), prefixes = [1, 2, 3, 4, 5].map(() => new Set());
    model.walkHierarchy(rows, header, item => {
      if (item.kind !== 'detail') return;
      item.dims.forEach((v, i) => dims[i].add(model.norm(v)));
      for (let l = 1; l <= 5; l++) prefixes[l - 1].add(model.keyOf(item.dims.slice(0, l)));
    });
    return { dims, prefixes };
  };
  const a = collect(summaryRows, summaryHeader), b = collect(pivotRows, pivotHeader);
  const inter = (x, y) => [...x].filter(v => y.has(v)).length;
  lines.push(`\n## Anahtar örtüşmesi: KLASMAN LİSTESİ ÖZET ↔ ${pivotName}`);
  model.DIM_HEADERS.forEach((h, i) => lines.push(`  ${h.padEnd(22)} özet=${a.dims[i].size}  pivot=${b.dims[i].size}  ortak=${inter(a.dims[i], b.dims[i])}`));
  [1, 2, 3, 4, 5].forEach(l => lines.push(`  ilk ${l} alan birlikte${' '.repeat(10)} özet=${a.prefixes[l - 1].size}  pivot=${b.prefixes[l - 1].size}  ortak=${inter(a.prefixes[l - 1], b.prefixes[l - 1])}`));
}

function structureReport(buffer, sourceFile = 'ENDEKSMATİK.xlsx') {
  const XLSX = require('xlsx');
  const lines = [];
  lines.push('# Buyer Log · Endeksmatik yapı raporu');
  lines.push(`dosya: ${String(sourceFile).replace(/[^\w.\- ()ÇĞİÖŞÜçğıöşü]/g, '_')}  boyut: ${(buffer.length / 1048576).toFixed(1)} MB  üretildi: ${new Date().toISOString()}`);
  lines.push('Not: iş değerleri maskelidir (harf→A, rakam→9, boşluk→_). Başlıklar ve ENDEKSMATİK formülleri olduğu gibi yazılır.');
  const names = XLSX.read(buffer, { type: 'buffer', bookSheets: true }).SheetNames || [];
  lines.push(`\nsayfalar (${names.length}): ${names.map(n => JSON.stringify(n)).join(', ')}`);
  const resolved = {};
  Object.entries(model.SHEETS).forEach(([key, name]) => { resolved[key] = model.findSheetName(names, name); });
  lines.push(`gerekli sayfalar: ${Object.entries(model.SHEETS).map(([k, n]) => `${n}${resolved[k] ? '' : ' ✘YOK'}`).join(' · ')}`);
  const wanted = Object.values(resolved).filter(Boolean);
  const wb = XLSX.read(buffer, { type: 'buffer', sheets: wanted, cellFormula: true, cellDates: false, cellHTML: false, cellText: false });
  const rowsOf = key => (resolved[key] ? model.sheetRows(wb.Sheets[resolved[key]]) : null);

  const summaryRows = rowsOf('summary');
  const summaryHeader = summaryRows ? sheetSection(lines, summaryRows, resolved.summary, 'summary') : null;
  const pivotRows = {}, pivotHeaders = {};
  // Kumaş pivotu tam örneklenir; diğer üçü aynı şablondan olduğu için kısa tutulur.
  model.COMPONENTS.forEach(c => { pivotRows[c] = rowsOf(c); if (pivotRows[c]) pivotHeaders[c] = sheetSection(lines, pivotRows[c], resolved[c], 'pivot', c === 'fabric' ? MAX_SAMPLE_ROWS : 4); });
  if (summaryHeader && pivotHeaders.fabric) overlapSection(lines, summaryRows, summaryHeader, pivotRows.fabric, pivotHeaders.fabric, resolved.fabric);

  if (resolved.screen) {
    lines.push(`\n## ${resolved.screen} (A1:G25)`);
    const ws = wb.Sheets[resolved.screen];
    for (let r = 0; r < 25; r++) for (let c = 0; c < 7; c++) {
      const addr = `${colName(c)}${r + 1}`, cell = ws[addr]; if (!cell || (cell.f == null && (cell.v == null || cell.v === ''))) continue;
      const v = cell.v; const month = model.monthCodeOf(v);
      const shown = typeof v === 'number' ? (month && /^C(9|1[0-2])$/.test(addr) ? month : 'sayı') : (typeof v === 'string' && c <= 1 ? JSON.stringify(v) : shape(v));
      lines.push(`  ${addr.padEnd(4)} ${shown}${cell.f ? `   =${cell.f}` : ''}`);
    }
  }
  if (resolved.fx) {
    const { tables } = model.parseRateTables(wb.Sheets[resolved.fx]);
    lines.push(`\n## ${resolved.fx}: kur tabloları ${Object.entries(tables).map(([cur, t]) => `${cur}(${Object.keys(t).length} ay)`).join(', ') || '— bulunamadı'}`);
  }
  lines.push('\n## Yükleme denemesi');
  try {
    const snap = model.parseWorkbookBuffer(buffer, sourceFile);
    lines.push(`  ✔ kabul edilir: ${snap.records.filter(r => r[0] === 5).length} klasman; uyarılar: ${(snap.validation.warnings || []).length}`);
  } catch (err) {
    lines.push(`  ✘ ${err.code || 'ERROR'}`);
    // Mesajın kendisi örnek anahtar (iş verisi) içerebilir; yalnız güvenli ayrıntılar yazılır.
    ((err.details && err.details.failures) || []).forEach(f => lines.push(`    - ${f}`));
    ((err.details && err.details.checks) || []).filter(c => !c.ok).forEach(c => lines.push(`    ≠ ${c.label} ${c.cell}`));
  }
  return `${lines.join('\n')}\n`;
}

module.exports = { structureReport, shape };
