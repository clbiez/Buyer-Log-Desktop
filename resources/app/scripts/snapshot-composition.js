#!/usr/bin/env node
'use strict';

/*
 * MODEL SNAPSHOT BİLEŞİM TEŞHİSİ (salt okunur)
 *
 * Kişisel model snapshot'ının (data\local\model-snapshots\<kullanıcı>.json.gz)
 * hangi bölümlerden oluştuğunu YALNIZ BOYUT olarak raporlar: üst seviye anahtar
 * başına bayt, hedef (cp/orders/backlog/priceanalysis) başına bayt, satır içi
 * kategori payları (_sourceFields, _cpExtra, ...), _sourceFields'teki farklı ham
 * sütun SAYISI ve hedefler arası birebir tekrar eden içerik.
 *
 * Gizlilik: hiçbir hücre değeri, sipariş kodu, model adı ya da anahtar
 * yazdırılmaz. Yalnız kodda tanımlı yapı adları (üst seviye anahtarlar, hedef
 * adları, satır kategori adları) ve sayılar çıkar. Ham sütun ADLARI yalnız
 * --column-names verilirse yazılır (değerler yine yazılmaz).
 *
 * Bağımsızdır: yalnız Node yerleşik modüllerini kullanır, uygulamanın başka bir
 * dosyasını yüklemez ve hiçbir dosyaya yazmaz (--out verilmedikçe). Bu yüzden tek
 * dosya olarak kopyalanıp kurulu Buyer Log'un kendi Electron'u ile çalışır:
 *
 *   $env:ELECTRON_RUN_AS_NODE = '1'
 *   & "<kurulum>\BuyerLog.exe" "<yol>\snapshot-composition.js" --out "$env:USERPROFILE\Desktop\snapshot-composition.txt" | Out-Host
 *   Remove-Item Env:ELECTRON_RUN_AS_NODE
 *
 * Yol verilmezse çalıştıran exe'nin yanındaki data\local\model-snapshots
 * klasöründeki tüm *.json.gz dosyaları (yedekler hariç) raporlanır. Bir dosya ya
 * da klasör yolu da verilebilir. 655 MiB açık JSON için gereken bellek ≈ açık
 * boyut + birkaç yüz MiB'tır; JSON bütünüyle ayrıştırılmaz, baytlar üzerinde
 * taranır.
 *
 *   node scripts/snapshot-composition.js [dosya|klasör ...] [--json] [--column-names] [--top 25] [--out rapor.txt]
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const TARGET_GROUPS = [['asasOrders', 'asasOrdersByTarget', 'asas'], ['antrepoMap', 'antrepoMapByTarget', 'ias']];
const ROW_BAGS = ['_sourceFields', '_cpExtra', '_sourceValues', '_matchValues'];

// ---------------------------------------------------------------------------
// Bayt düzeyinde JSON tarayıcı. Girdi JSON.stringify çıktısıdır; yine de boşluk
// toleranslıdır. Yalnız aralık (start/end) üretir, değer oluşturmaz.
// ---------------------------------------------------------------------------
const Q = 0x22, BS = 0x5c, LB = 0x7b, RB = 0x7d, LS = 0x5b, RS = 0x5d, COMMA = 0x2c, COLON = 0x3a;
function isWs(c) { return c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09; }
function skipWs(buf, i) { while (i < buf.length && isWs(buf[i])) i += 1; return i; }
function stringEnd(buf, i) { // i '"' üzerinde; kapanış tırnağından sonraki indeks
  for (let j = i + 1; j < buf.length; j += 1) {
    const c = buf[j];
    if (c === BS) { j += 1; continue; }
    if (c === Q) return j + 1;
  }
  throw new Error('JSON metni kapanmadı');
}
function valueEnd(buf, i) {
  const c = buf[i];
  if (c === Q) return stringEnd(buf, i);
  if (c === LB || c === LS) {
    let depth = 0;
    for (let j = i; j < buf.length; j += 1) {
      const d = buf[j];
      if (d === Q) { j = stringEnd(buf, j) - 1; continue; }
      if (d === LB || d === LS) depth += 1;
      else if (d === RB || d === RS) { depth -= 1; if (depth === 0) return j + 1; }
    }
    throw new Error('JSON yapısı kapanmadı');
  }
  let j = i;
  while (j < buf.length) { const d = buf[j]; if (d === COMMA || d === RB || d === RS || isWs(d)) break; j += 1; }
  return j;
}
// Nesne çocukları: {keyStart, keyEnd, start, end, entryEnd}. entryEnd virgülü de kapsar.
function* objectEntries(buf, start, end) {
  let i = skipWs(buf, start + 1);
  if (buf[start] !== LB) throw new Error('Nesne bekleniyordu');
  while (i < end - 1) {
    if (buf[i] === RB) return;
    const keyStart = i, keyEnd = stringEnd(buf, i);
    let v = skipWs(buf, keyEnd);
    if (buf[v] !== COLON) throw new Error('":" bekleniyordu');
    v = skipWs(buf, v + 1);
    const vEnd = valueEnd(buf, v);
    let next = skipWs(buf, vEnd);
    const hasComma = buf[next] === COMMA;
    if (hasComma) next = skipWs(buf, next + 1);
    yield { keyStart, keyEnd, start: v, end: vEnd, entryBytes: (hasComma ? next : vEnd) - keyStart };
    i = next;
  }
}
function* arrayItems(buf, start, end) {
  if (buf[start] !== LS) throw new Error('Dizi bekleniyordu');
  let i = skipWs(buf, start + 1);
  while (i < end - 1) {
    if (buf[i] === RS) return;
    const vEnd = valueEnd(buf, i);
    let next = skipWs(buf, vEnd);
    if (buf[next] === COMMA) next = skipWs(buf, next + 1);
    yield { start: i, end: vEnd };
    i = next;
  }
}
const keyOf = (buf, e) => JSON.parse(buf.toString('utf8', e.keyStart, e.keyEnd));
function childMap(buf, start, end) {
  const out = new Map();
  for (const e of objectEntries(buf, start, end)) out.set(keyOf(buf, e), e);
  return out;
}
const digest = (buf, start, end) => crypto.createHash('sha1').update(buf.subarray(start, end)).digest('base64');

// ---------------------------------------------------------------------------
// Satır istatistikleri
// ---------------------------------------------------------------------------
function newRowStats() {
  return { rows: 0, bytes: 0, categories: new Map(), columns: new Map(), sfRows: 0, sfEntries: 0,
    sfKeyBytes: 0, sfValueBytes: 0, sfNullOrEmptyBytes: 0, sfMaxColumns: 0, rowHashes: new Map() };
}
function addCategory(stats, name, bytes) {
  const current = stats.categories.get(name) || { bytes: 0, rows: 0 };
  current.bytes += bytes; current.rows += 1;
  stats.categories.set(name, current);
}
function scanRow(buf, item, stats, hashRows) {
  stats.rows += 1;
  stats.bytes += item.end - item.start;
  if (hashRows) { const h = digest(buf, item.start, item.end); stats.rowHashes.set(h, item.end - item.start); }
  if (buf[item.start] !== LB) { addCategory(stats, '(nesne olmayan satır)', item.end - item.start); return; }
  addCategory(stats, '(satır çerçevesi {})', 2);
  for (const e of objectEntries(buf, item.start, item.end)) {
    const key = keyOf(buf, e);
    const bag = ROW_BAGS.includes(key) ? key : (key.startsWith('_') ? '(diğer _ alanlar)' : '(işlenmiş alanlar)');
    addCategory(stats, bag, e.entryBytes);
    if (key !== '_sourceFields' || buf[e.start] !== LB) continue;
    stats.sfRows += 1;
    let count = 0;
    for (const f of objectEntries(buf, e.start, e.end)) {
      count += 1;
      const name = buf.toString('utf8', f.keyStart, f.keyEnd);
      const keyBytes = f.start - f.keyStart; // "ad":
      const valueBytes = f.entryBytes - keyBytes;
      stats.sfKeyBytes += keyBytes; stats.sfValueBytes += valueBytes;
      const raw = f.end - f.start;
      const blank = (raw === 4 && buf.toString('latin1', f.start, f.end) === 'null') || (raw === 2 && buf[f.start] === Q);
      if (blank) stats.sfNullOrEmptyBytes += f.entryBytes;
      const col = stats.columns.get(name) || { rows: 0, bytes: 0, keyBytes: 0, blankRows: 0 };
      col.rows += 1; col.bytes += f.entryBytes; col.keyBytes += keyBytes; if (blank) col.blankRows += 1;
      stats.columns.set(name, col);
    }
    stats.sfEntries += count;
    if (count > stats.sfMaxColumns) stats.sfMaxColumns = count;
  }
}
function scanRowArray(buf, range, stats, hashRows) {
  if (buf[range.start] !== LS) return;
  for (const item of arrayItems(buf, range.start, range.end)) scanRow(buf, item, stats, hashRows);
}
function scanIasMap(buf, range, stats, hashRows) {
  if (buf[range.start] !== LB) return { keys: 0, arrays: 0 };
  let keys = 0, arrays = 0;
  for (const e of objectEntries(buf, range.start, range.end)) {
    keys += 1;
    if (buf[e.start] === LS) { arrays += 1; for (const item of arrayItems(buf, e.start, e.end)) scanRow(buf, item, stats, hashRows); }
    else scanRow(buf, { start: e.start, end: e.end }, stats, hashRows);
  }
  return { keys, arrays };
}

// ---------------------------------------------------------------------------
// Rapor
// ---------------------------------------------------------------------------
const MiB = 1024 * 1024;
const mib = n => `${(n / MiB).toFixed(2)} MiB`;
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '-');

function analyzeFile(file, options) {
  const t0 = Date.now();
  const compressed = fs.readFileSync(file);
  const raw = file.endsWith('.gz') ? zlib.gunzipSync(compressed) : compressed;
  const inflateMs = Date.now() - t0;
  const report = { file: path.basename(file), compressedBytes: compressed.length, uncompressedBytes: raw.length, inflateMs };
  let i = skipWs(raw, 0);
  const rootEnd = valueEnd(raw, i);
  const root = childMap(raw, i, rootEnd);
  const schemaEntry = root.get('schemaVersion');
  report.schemaVersion = schemaEntry ? JSON.parse(raw.toString('utf8', schemaEntry.start, schemaEntry.end)) : null;
  const payloadEntry = root.get('payload');
  const payloadRange = payloadEntry ? { start: payloadEntry.start, end: payloadEntry.end } : { start: i, end: rootEnd };
  report.envelopeBytes = raw.length - (payloadRange.end - payloadRange.start);
  if (options.verify && payloadEntry) {
    const sum = root.get('checksum');
    const expected = sum ? JSON.parse(raw.toString('utf8', sum.start, sum.end)) : '';
    report.checksumOk = crypto.createHash('sha256').update(raw.subarray(payloadRange.start, payloadRange.end)).digest('hex') === expected;
  }
  const payload = childMap(raw, payloadRange.start, payloadRange.end);
  report.topLevel = [...payload.entries()].map(([key, e]) => ({ key, bytes: e.entryBytes }))
    .sort((a, b) => b.bytes - a.bytes);

  const aliasesEntry = payload.get('targetAliases');
  report.targetAliases = aliasesEntry ? JSON.parse(raw.toString('utf8', aliasesEntry.start, aliasesEntry.end)) : {};

  report.sources = {};
  for (const [baseKey, groupKey, label] of TARGET_GROUPS) {
    const stats = newRowStats();
    const parts = [];
    const ranges = [];
    const base = payload.get(baseKey);
    if (base) ranges.push({ name: baseKey, start: base.start, end: base.end });
    const group = payload.get(groupKey);
    if (group && raw[group.start] === LB) {
      for (const e of objectEntries(raw, group.start, group.end)) ranges.push({ name: `${groupKey}.${keyOf(raw, e)}`, start: e.start, end: e.end });
    }
    const byHash = new Map();
    const rowSets = [];
    for (const range of ranges) {
      const own = newRowStats();
      const shape = label === 'asas' ? (scanRowArray(raw, range, own, true), null) : scanIasMap(raw, range, own, true);
      const hash = digest(raw, range.start, range.end);
      const identicalTo = byHash.get(hash) || null;
      if (!identicalTo) byHash.set(hash, range.name);
      // Satır düzeyi: bu bölümdeki satırların kaçı önceki bir bölümde birebir var?
      let sharedRows = 0, sharedBytes = 0;
      for (const [h, bytes] of own.rowHashes) if (rowSets.some(set => set.has(h))) { sharedRows += 1; sharedBytes += bytes; }
      rowSets.push(new Set(own.rowHashes.keys())); // kopya: aşağıdaki clear() karşılaştırma kümesini silmesin
      parts.push({ name: range.name, bytes: range.end - range.start, rows: own.rows, identicalTo,
        rowsAlsoInEarlierPart: sharedRows, bytesOfRowsAlsoInEarlierPart: sharedBytes, ...(shape ? { mapKeys: shape.keys, mapArrayValues: shape.arrays } : {}) });
      if (!identicalTo) mergeStats(stats, own);
      own.rowHashes.clear();
    }
    report.sources[label] = { parts, ...summarizeStats(stats, options) };
  }
  const lfl = payload.get('lflRows');
  if (lfl) {
    const stats = newRowStats();
    scanRowArray(raw, lfl, stats, false);
    const keyCounts = new Map();
    for (const item of raw[lfl.start] === LS ? arrayItems(raw, lfl.start, lfl.end) : []) {
      if (raw[item.start] !== LB) continue;
      for (const e of objectEntries(raw, item.start, item.end)) {
        const k = raw.toString('utf8', e.keyStart, e.keyEnd);
        const c = keyCounts.get(k) || { bytes: 0, keyBytes: 0 };
        c.bytes += e.entryBytes; c.keyBytes += e.start - e.keyStart;
        keyCounts.set(k, c);
      }
    }
    const keyBytes = [...keyCounts.values()].reduce((s, c) => s + c.keyBytes, 0);
    report.lfl = { rows: stats.rows, bytes: lfl.end - lfl.start, distinctKeys: keyCounts.size, keyNameBytes: keyBytes,
      heaviestKeys: [...keyCounts.entries()].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, options.top)
        .map(([k, c], index) => ({ key: options.columnNames ? JSON.parse(k) : `#${index + 1}`, bytes: c.bytes })) };
  }
  report.scanMs = Date.now() - t0 - inflateMs;
  return report;
}
function mergeStats(into, from) {
  into.rows += from.rows; into.bytes += from.bytes;
  for (const [k, v] of from.categories) { const c = into.categories.get(k) || { bytes: 0, rows: 0 }; c.bytes += v.bytes; c.rows += v.rows; into.categories.set(k, c); }
  for (const [k, v] of from.columns) {
    const c = into.columns.get(k) || { rows: 0, bytes: 0, keyBytes: 0, blankRows: 0 };
    c.rows += v.rows; c.bytes += v.bytes; c.keyBytes += v.keyBytes; c.blankRows += v.blankRows; into.columns.set(k, c);
  }
  for (const k of ['sfRows', 'sfEntries', 'sfKeyBytes', 'sfValueBytes', 'sfNullOrEmptyBytes']) into[k] += from[k];
  into.sfMaxColumns = Math.max(into.sfMaxColumns, from.sfMaxColumns);
}
function summarizeStats(stats, options) {
  const columns = [...stats.columns.entries()].sort((a, b) => b[1].bytes - a[1].bytes);
  return {
    uniqueParts: { rows: stats.rows, bytes: stats.bytes },
    categories: [...stats.categories.entries()].map(([name, v]) => ({ name, bytes: v.bytes, rows: v.rows })).sort((a, b) => b.bytes - a.bytes),
    sourceFields: {
      rowsWithSourceFields: stats.sfRows, distinctColumns: stats.columns.size,
      avgColumnsPerRow: stats.sfRows ? +(stats.sfEntries / stats.sfRows).toFixed(1) : 0, maxColumnsPerRow: stats.sfMaxColumns,
      keyNameBytes: stats.sfKeyBytes, valueBytes: stats.sfValueBytes, nullOrEmptyEntryBytes: stats.sfNullOrEmptyBytes,
      heaviestColumns: columns.slice(0, options.top).map(([name, c], index) => ({
        column: options.columnNames ? JSON.parse(name) : `#${index + 1}`, rows: c.rows, bytes: c.bytes, keyNameBytes: c.keyBytes, blankRows: c.blankRows })),
    },
  };
}

function formatReport(r) {
  const out = [];
  const total = r.uncompressedBytes;
  out.push(`== ${r.file}`);
  out.push(`sıkıştırılmış ${mib(r.compressedBytes)} · açık ${mib(total)} (x${(total / Math.max(1, r.compressedBytes)).toFixed(1)}) · schema v${r.schemaVersion}` +
    `${r.checksumOk === undefined ? '' : ` · checksum ${r.checksumOk ? 'OK' : 'UYUŞMUYOR'}`} · gunzip ${r.inflateMs} ms · tarama ${r.scanMs} ms`);
  out.push('', '-- Üst seviye anahtarlar (payload) / top-level keys');
  for (const t of r.topLevel) out.push(`  ${t.key.padEnd(24)} ${mib(t.bytes).padStart(12)}  ${pct(t.bytes, total).padStart(6)}`);
  out.push(`  ${'(zarf / envelope)'.padEnd(24)} ${mib(r.envelopeBytes).padStart(12)}`);
  out.push(`  targetAliases: ${JSON.stringify(r.targetAliases)}`);
  for (const [label, s] of Object.entries(r.sources)) {
    out.push('', `-- ${label.toUpperCase()} bölümleri / parts (identicalTo = bayt bayt aynı önceki bölüm)`);
    for (const p of s.parts) {
      out.push(`  ${p.name.padEnd(34)} ${mib(p.bytes).padStart(12)}  rows=${p.rows}` +
        `${p.mapKeys !== undefined ? ` mapKeys=${p.mapKeys} arrayValues=${p.mapArrayValues}` : ''}` +
        `${p.identicalTo ? `  ⇐ AYNI: ${p.identicalTo}` : ''}` +
        `${!p.identicalTo && p.rowsAlsoInEarlierPart ? `  önceki bölümde birebir olan satır=${p.rowsAlsoInEarlierPart} (${mib(p.bytesOfRowsAlsoInEarlierPart)})` : ''}`);
    }
    const u = s.uniqueParts;
    out.push(`  Tekil bölümler toplamı: rows=${u.rows} ${mib(u.bytes)} · ortalama ${u.rows ? Math.round(u.bytes / u.rows) : 0} B/satır`);
    out.push('  Satır kategorileri (tekil bölümler):');
    for (const c of s.categories) out.push(`    ${c.name.padEnd(26)} ${mib(c.bytes).padStart(12)}  ${pct(c.bytes, u.bytes).padStart(6)}  ort ${Math.round(c.bytes / Math.max(1, c.rows))} B`);
    const f = s.sourceFields;
    out.push(`  _sourceFields: satır=${f.rowsWithSourceFields} farklı sütun=${f.distinctColumns} ort sütun/satır=${f.avgColumnsPerRow} max=${f.maxColumnsPerRow}`);
    out.push(`    sütun ADI baytı ${mib(f.keyNameBytes)} (${pct(f.keyNameBytes, f.keyNameBytes + f.valueBytes)}) · değer baytı ${mib(f.valueBytes)} · null/boş girdiler ${mib(f.nullOrEmptyEntryBytes)}`);
    if (f.heaviestColumns.length) {
      out.push('    En ağır sütunlar (ad --column-names ile):');
      for (const c of f.heaviestColumns) out.push(`      ${String(c.column).slice(0, 48).padEnd(48)} ${mib(c.bytes).padStart(10)}  ad=${mib(c.keyNameBytes)} boş=${c.blankRows}/${c.rows}`);
    }
  }
  if (r.lfl) {
    out.push('', `-- LFL: rows=${r.lfl.rows} ${mib(r.lfl.bytes)} · farklı anahtar=${r.lfl.distinctKeys} · anahtar ADI baytı ${mib(r.lfl.keyNameBytes)}`);
    for (const k of r.lfl.heaviestKeys.slice(0, 10)) out.push(`    ${String(k.key).slice(0, 48).padEnd(48)} ${mib(k.bytes).padStart(10)}`);
  }
  return out.join('\n');
}

function snapshotFilesIn(dir) {
  return fs.readdirSync(dir).filter(name => name.endsWith('.json.gz')).map(name => path.join(dir, name));
}
function defaultTargets() {
  const roots = [path.join(path.dirname(process.execPath), 'data', 'local', 'model-snapshots')];
  if (process.env.BUYER_LOG_LOCAL_DATA_ROOT) roots.push(path.join(process.env.BUYER_LOG_LOCAL_DATA_ROOT, 'model-snapshots'));
  if (process.env.LOCALAPPDATA) roots.push(path.join(process.env.LOCALAPPDATA, 'BuyerLog', 'model-snapshots'));
  for (const dir of roots) if (fs.existsSync(dir)) return snapshotFilesIn(dir);
  return [];
}
function parseArgs(argv) {
  const options = { json: false, columnNames: false, verify: true, top: 25, out: null, files: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') options.json = true;
    else if (a === '--column-names') options.columnNames = true;
    else if (a === '--no-verify') options.verify = false;
    else if (a === '--top') options.top = Math.max(1, Number(argv[++i]) || 25);
    else if (a === '--out') options.out = argv[++i];
    else if (a === '--help' || a === '-h') options.help = true;
    else options.files.push(a);
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { process.stdout.write(fs.readFileSync(__filename, 'utf8').split('*/')[0] + '*/\n'); return 0; }
  let files = options.files.length
    ? options.files.flatMap(p => (fs.existsSync(p) && fs.statSync(p).isDirectory() ? snapshotFilesIn(p) : [p]))
    : defaultTargets();
  files = files.filter(f => !/\.bak$/i.test(f));
  if (!files.length) { process.stderr.write('Snapshot dosyası bulunamadı. Yol verin: snapshot-composition.js <dosya.json.gz>\n'); return 2; }
  const reports = [];
  const texts = [];
  for (const file of files) {
    try { const r = analyzeFile(file, options); reports.push(r); texts.push(formatReport(r)); }
    catch (error) { const r = { file: path.basename(file), error: String(error && error.message || error) }; reports.push(r); texts.push(`== ${r.file}\nHATA: ${r.error}`); }
  }
  const text = options.json ? JSON.stringify(reports, null, 2) : texts.join('\n\n');
  process.stdout.write(`${text}\n`);
  if (options.out) fs.writeFileSync(options.out, `${text}\n`, 'utf8');
  return reports.some(r => r.error) ? 1 : 0;
}

if (require.main === module) process.exitCode = main();
module.exports = { analyzeFile, formatReport, parseArgs };
