#!/usr/bin/env node
'use strict';

/*
 * Merch kod / başlık eşleme aracı (salt okunur CLI).
 *
 * "Merch Alt Grup Kod", "Merch Alt Grup", "MAG", "MMYG", "Merch Marka Yaş Grup",
 * "Merch Marka Yaş Grup Kod" ... gibi başlıkların hangi kanonik alana (MAG/MMYG)
 * ait olduğunu ve bir Excel/CSV dosyasındaki her kodun hangi başlıkta geçtiğini
 * gösterir. Başlık eşlemesi için tek kaynak public/canonical-fields.js'tir; bu
 * araç yeni alias tanımlamaz, yalnız registry'yi okur.
 *
 * Kullanım:
 *   node scripts/merch-code-map.js                         → başlık sözlüğü
 *   node scripts/merch-code-map.js dosya.xlsx              → dosya analizi
 *   node scripts/merch-code-map.js dosya.xlsx --find CU4E  → kod hangi başlıkta?
 *   node scripts/merch-code-map.js dosya.xlsx --out esleme.xlsx (veya .csv)
 *   Seçenekler: --sheet "Sayfa Adı"  --all (merch dışı alanları da göster)  --en
 *
 * Dosyaya yazma yalnız --out verildiğinde yapılır; kaynak dosya değiştirilmez.
 */

const fs = require('fs');
const path = require('path');
const CF = require('../server/lib/canonical-fields.js');

const MERCH_FIELDS = ['mag', 'mmyg'];
// Hiyerarşide MMYG'nin bağlı olduğu üst kırılım; yalnız bağlam olarak eklenir.
const CONTEXT_FIELDS = ['brandDirectorate'];
// Kod sütununun yanındaki açıklama/ad sütununu tanımak için son ekler (ör. "Merch Alt Grup Tanım").
const NAME_SUFFIXES = ['TANIM', 'TANIMI', 'AD', 'ADI', 'ACIKLAMA', 'ACIKLAMASI', 'NAME', 'DESC', 'DESCRIPTION']; // i18n-ignore — başlık token'ları
const CODE_SUFFIXES = ['KOD', 'KODU', 'CODE']; // i18n-ignore — başlık token'ları

function parseArgs(argv) {
  const out = { file: '', find: '', out: '', sheet: '', all: false, en: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--find') out.find = argv[++i] || '';
    else if (a === '--out') out.out = argv[++i] || '';
    else if (a === '--sheet') out.sheet = argv[++i] || '';
    else if (a === '--all') out.all = true;
    else if (a === '--en') out.en = true;
    else if (a === '-h' || a === '--help') out.help = true;
    else if (!out.file) out.file = a;
  }
  return out;
}

let EN = false;
const L = (tr, en) => (EN ? en : tr);
const codeKey = v => CF.token(String(v == null ? '' : v).trim().replace(/^([-+]?\d+)\.0+$/, '$1')).replace(/\s+/g, '');
const fieldLabel = id => (id ? `${CF.label(id, EN ? 'en' : 'tr')} (${id})` : '—');

/** Registry'deki tüm modüllerde bir başlığın hangi kanonik alana çözüldüğünü döndürür. */
function resolveHeader(header) {
  const modules = new Set();
  for (const def of Object.values(CF.fields)) for (const m of Object.keys(def.modules || {})) modules.add(m);
  const ids = new Set();
  const generic = CF.canonicalId('', header);
  if (generic) ids.add(generic);
  for (const m of modules) { const id = CF.canonicalId(m, header); if (id) ids.add(id); }
  if (ids.size) {
    const one = ids.size === 1 ? [...ids][0] : null;
    const kind = one && CF.field(one).type !== 'code' ? 'text' : 'code';
    return { field: one, candidates: [...ids], kind, how: 'registry' };
  }

  // Registry'de yoksa: "<alias> Tanım/Adı" → aynı alanın ad sütunu; "<alias> Kod" → kod sütunu.
  const tok = CF.token(header);
  for (const [id, def] of Object.entries(CF.fields)) {
    const aliases = new Set([...(def.aliases || []), ...Object.values(def.modules || {}).flatMap(b => b.keys || [])]);
    for (const alias of aliases) {
      const base = CF.token(alias).replace(/\s+(KOD|KODU|CODE)$/, '');
      if (!base || (tok !== base && !tok.startsWith(base + ' '))) continue;
      if (tok === base) return { field: id, candidates: [id], kind: 'base', how: 'unregistered' };
      const rest = tok.slice(base.length + 1);
      if (NAME_SUFFIXES.includes(rest)) return { field: id, candidates: [id], kind: 'name', how: 'suffix' };
      if (CODE_SUFFIXES.includes(rest)) return { field: id, candidates: [id], kind: 'code', how: 'suffix' };
    }
  }
  return { field: null, candidates: [], kind: '', how: '' };
}

function aliasTable(ids) {
  const rows = [];
  for (const id of ids) {
    const def = CF.field(id);
    if (!def) continue;
    const headers = new Map();
    for (const a of def.aliases || []) headers.set(CF.token(a), { header: a, modules: new Set(['alias']) });
    for (const [m, b] of Object.entries(def.modules || {})) {
      for (const k of b.keys || []) {
        const t = CF.token(k);
        if (!headers.has(t)) headers.set(t, { header: k, modules: new Set() });
        headers.get(t).modules.add(m);
      }
    }
    for (const { header, modules } of headers.values()) {
      rows.push({ field: id, label: CF.label(id, EN ? 'en' : 'tr'), header, modules: [...modules].filter(x => x !== 'alias').join(', ') || 'alias' });
    }
  }
  return rows;
}

function readTable(file, sheetName) {
  const XLSX = require('xlsx');
  const ext = path.extname(file).toLowerCase();
  const wb = ext === '.csv' || ext === '.txt'
    ? XLSX.read(fs.readFileSync(file, 'utf8'), { type: 'string', raw: true })
    : XLSX.readFile(file, { cellDates: false, dense: true });
  const name = sheetName || wb.SheetNames[0];
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(L(`Sayfa bulunamadı: ${name}. Mevcut: ${wb.SheetNames.join(', ')}`, `Sheet not found: ${name}. Available: ${wb.SheetNames.join(', ')}`));
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: false });
  // Başlık satırı: en çok tanınan başlık içeren ilk 15 satırdan biri.
  let headerRow = 0, best = -1;
  for (let r = 0; r < Math.min(15, aoa.length); r++) {
    const score = (aoa[r] || []).filter(h => String(h).trim() && resolveHeader(h).field).length;
    if (score > best) { best = score; headerRow = r; }
  }
  return { sheet: name, sheets: wb.SheetNames, headers: (aoa[headerRow] || []).map(h => String(h).trim()), rows: aoa.slice(headerRow + 1), headerRow };
}

function analyze(table, opts) {
  const columns = table.headers.map((header, index) => ({ index, header, ...resolveHeader(header) }))
    .filter(c => c.header);
  const wanted = c => c.field && (opts.all || MERCH_FIELDS.includes(c.field));
  const contextCols = columns.filter(c => CONTEXT_FIELDS.includes(c.field));
  // Registry'de olmayan "Kod"suz başlık (ör. "Merch Marka Yaş Grup"): değerleri aynı alanın
  // kod sütunlarıyla çoğunlukla örtüşüyorsa kod, değilse ad/tanım sütunu sayılır.
  for (const c of columns.filter(x => x.kind === 'base')) {
    const own = new Set(table.rows.map(r => codeKey(r[c.index])).filter(Boolean));
    const ref = new Set();
    for (const o of columns) if (o.field === c.field && o.kind === 'code') for (const r of table.rows) { const k = codeKey(r[o.index]); if (k) ref.add(k); }
    const hit = [...own].filter(k => ref.has(k)).length;
    c.kind = !ref.size || hit >= own.size / 2 ? 'code' : 'name';
    c.how = 'unregistered-' + c.kind;
  }
  const codeCols = columns.filter(c => wanted(c) && c.kind === 'code');
  const nameCols = columns.filter(c => wanted(c) && c.kind === 'name');
  // Ad sütunu, aynı alandaki en yakın soldaki kod sütunuyla (yoksa ilk kod sütunuyla) eşleşir;
  // böylece "MAG" ve "Merch Alt Grup Kod" farklıysa ad yanlış koda yazılmaz.
  for (const n of nameCols) {
    const same = codeCols.filter(c => c.field === n.field);
    const left = same.filter(c => c.index < n.index).pop();
    n.pair = (left || same[0] || {}).index;
  }

  const codes = new Map(); // key = field|code
  const byCode = new Map(); // code → Set(field)
  const colStats = new Map(columns.map(c => [c.index, { distinct: new Set(), filled: 0 }]));
  for (const row of table.rows) {
    const rowCodes = {};
    for (const c of columns) {
      const raw = String(row[c.index] ?? '').trim();
      if (!raw) continue;
      const st = colStats.get(c.index); st.filled++; if (st.distinct.size < 5000) st.distinct.add(raw);
    }
    for (const c of codeCols) {
      const raw = String(row[c.index] ?? '').trim();
      const key = codeKey(raw);
      if (!key) continue;
      (rowCodes[c.field] = rowCodes[c.field] || {})[c.index] = key;
      const id = `${c.field}|${key}`;
      if (!codes.has(id)) codes.set(id, { field: c.field, code: key, raw: new Set(), headers: new Set(), names: new Set(), parents: new Set(), context: new Set(), rows: 0 });
      const e = codes.get(id);
      e.raw.add(raw); e.headers.add(c.header); e.rows++;
      if (!byCode.has(key)) byCode.set(key, new Set());
      byCode.get(key).add(c.field);
    }
    for (const n of nameCols) {
      const key = n.pair != null && rowCodes[n.field] ? rowCodes[n.field][n.pair] : '';
      const name = String(row[n.index] ?? '').trim();
      if (key && name) codes.get(`${n.field}|${key}`).names.add(name);
    }
    for (const x of contextCols) {
      const v = String(row[x.index] ?? '').trim();
      if (!v) continue;
      for (const f of Object.keys(rowCodes)) for (const k of new Set(Object.values(rowCodes[f]))) codes.get(`${f}|${k}`).context.add(v);
    }
    if (rowCodes.mag && rowCodes.mmyg) {
      const parents = new Set(Object.values(rowCodes.mmyg));
      for (const k of new Set(Object.values(rowCodes.mag))) for (const p of parents) codes.get(`mag|${k}`).parents.add(p);
    }
  }

  const conflicts = [];
  // Aynı alana çözülen iki sütun aynı satırda farklı kod taşıyorsa uyar.
  const sameField = {};
  for (const c of codeCols) (sameField[c.field] = sameField[c.field] || []).push(c);
  for (const [field, cols] of Object.entries(sameField)) {
    if (cols.length < 2) continue;
    let diff = 0, sample = '';
    for (const row of table.rows) {
      const vals = new Set(cols.map(c => codeKey(row[c.index])).filter(Boolean));
      if (vals.size > 1) { diff++; if (!sample) sample = [...vals].join(' ≠ '); }
    }
    if (diff) conflicts.push({ type: L('Aynı alan, farklı değer', 'Same field, different value'), detail: `${fieldLabel(field)}: ${cols.map(c => `"${c.header}"`).join(' / ')} — ${diff} ${L('satır', 'rows')} (${L('örnek', 'e.g.')} ${sample})` });
  }
  for (const [code, fields] of byCode) if (fields.size > 1) conflicts.push({ type: L('Kod birden çok alanda', 'Code in multiple fields'), detail: `${code}: ${[...fields].map(fieldLabel).join(' + ')}` });
  for (const e of codes.values()) {
    if (e.names.size > 1) conflicts.push({ type: L('Kodun birden çok adı var', 'Code has multiple names'), detail: `${fieldLabel(e.field)} ${e.code}: ${[...e.names].join(' | ')}` });
    if (e.context.size > 1) conflicts.push({ type: L('Kod birden çok müdürlükte', 'Code in multiple directorates'), detail: `${fieldLabel(e.field)} ${e.code}: ${[...e.context].join(' | ')}` });
    if (e.parents.size > 1) conflicts.push({ type: L('MAG birden çok MMYG altında', 'MAG under multiple MMYGs'), detail: `MAG ${e.code}: ${[...e.parents].join(', ')}` });
  }
  // Aynı ad birden çok koda verilmişse (ör. iki farklı MMYG aynı "KIZ BEBEK AKSESUAR" adını taşıyor) uyar.
  const byName = new Map();
  for (const e of codes.values()) for (const n of e.names) {
    const k = `${e.field}|${CF.token(n)}`;
    if (!byName.has(k)) byName.set(k, { field: e.field, name: n, codes: [] });
    byName.get(k).codes.push(e.code + (e.context.size ? ` (${[...e.context].join(' | ')})` : ''));
  }
  for (const v of byName.values()) if (v.codes.length > 1) conflicts.push({ type: L('Aynı ad, birden çok kod', 'Same name, multiple codes'), detail: `${fieldLabel(v.field)} "${v.name}": ${v.codes.join(', ')}` });
  return { columns, colStats, codes: [...codes.values()].sort((a, b) => a.field.localeCompare(b.field) || a.code.localeCompare(b.code)), conflicts };
}

function printTable(rows, cols) {
  if (!rows.length) { console.log('  ' + L('(kayıt yok)', '(none)')); return; }
  const w = cols.map((c, i) => Math.min(i === cols.length - 1 ? 200 : 48, Math.max(c.title.length, ...rows.map(r => String(r[c.key] ?? '').length))));
  const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n));
  console.log('  ' + cols.map((c, i) => cut(c.title, w[i])).join('  '));
  console.log('  ' + w.map(n => '─'.repeat(n)).join('  '));
  for (const r of rows) console.log('  ' + cols.map((c, i) => cut(String(r[c.key] ?? ''), w[i])).join('  '));
}

function writeOut(file, sheets) {
  const XLSX = require('xlsx');
  const ext = path.extname(file).toLowerCase();
  if (ext === '.csv') {
    const first = sheets[0];
    fs.writeFileSync(file, '﻿' + XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(first.rows), { FS: ';' }), 'utf8');
    for (const s of sheets.slice(1)) {
      const p = file.replace(/\.csv$/i, `-${s.name}.csv`);
      fs.writeFileSync(p, '﻿' + XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(s.rows), { FS: ';' }), 'utf8');
    }
    return;
  }
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.rows.length ? s.rows : [{ '-': '' }]), s.name.slice(0, 31));
  XLSX.writeFile(wb, file);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  EN = opts.en;
  if (opts.help) { console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^[\s\S]*?\/\*/, '')); return 0; }

  const dict = aliasTable(opts.all ? Object.keys(CF.fields) : MERCH_FIELDS);
  console.log(`\n${L('Başlık sözlüğü', 'Header dictionary')} — canonical-fields v${CF.version}`);
  printTable(dict, [
    { key: 'field', title: L('Alan', 'Field') }, { key: 'label', title: L('Etiket', 'Label') },
    { key: 'header', title: L('Kaynak başlık', 'Source header') }, { key: 'modules', title: L('Modüller', 'Modules') },
  ]);
  if (!opts.file) {
    console.log('\n' + L('Dosya analizi için: node scripts/merch-code-map.js <dosya.xlsx|csv> [--find KOD] [--out esleme.xlsx]',
      'To analyze a file: node scripts/merch-code-map.js <file.xlsx|csv> [--find CODE] [--out map.xlsx]'));
    if (opts.out) writeOut(opts.out, [{ name: L('Başlık Sözlüğü', 'Header Dictionary'), rows: dict }]);
    return 0;
  }

  if (!fs.existsSync(opts.file)) { console.error(L(`Dosya bulunamadı: ${opts.file}`, `File not found: ${opts.file}`)); return 2; }
  const table = readTable(opts.file, opts.sheet);
  const res = analyze(table, opts);
  console.log(`\n${L('Dosya', 'File')}: ${path.basename(opts.file)} · ${L('sayfa', 'sheet')}: ${table.sheet} · ${L('başlık satırı', 'header row')}: ${table.headerRow + 1} · ${table.rows.length} ${L('satır', 'rows')}`);

  const colRows = res.columns.filter(c => c.field && (opts.all || MERCH_FIELDS.includes(c.field) || CONTEXT_FIELDS.includes(c.field)) || /MERCH|MAG|MMYG|YAS GRUP/.test(CF.token(c.header))).map(c => {
    const st = res.colStats.get(c.index);
    return {
      column: XLSXcol(c.index), header: c.header,
      field: c.field ? fieldLabel(c.field) : (c.candidates.length > 1 ? L('BELİRSİZ: ', 'AMBIGUOUS: ') + c.candidates.join('/') : L('TANINMADI', 'UNRECOGNIZED')),
      kind: ({ name: L('ad/tanım', 'name'), text: L('metin', 'text'), code: L('kod', 'code') }[c.kind] || '') + (String(c.how).startsWith('unregistered') ? L(' (registry dışı, veriden)', ' (not in registry, inferred)') : ''),
      distinct: st.distinct.size, sample: [...st.distinct].slice(0, 4).join(', '),
    };
  });
  console.log(`\n${L('Sütunlar → alan', 'Columns → field')}`);
  printTable(colRows, [
    { key: 'column', title: L('Sütun', 'Col') }, { key: 'header', title: L('Başlık', 'Header') }, { key: 'field', title: L('Alan', 'Field') },
    { key: 'kind', title: L('Tür', 'Kind') }, { key: 'distinct', title: L('Farklı', 'Distinct') }, { key: 'sample', title: L('Örnek', 'Sample') },
  ]);

  const mmygName = k => { const m = res.codes.find(x => x.field === 'mmyg' && x.code === k); return m && m.names.size ? `${k} ${[...m.names].join(' | ')}` : k; };
  const codeRows = res.codes.map(e => ({
    field: e.field.toUpperCase(), code: e.code, name: [...e.names].join(' | '), mmyg: [...e.parents].map(mmygName).join(', '),
    directorate: [...e.context].join(' | '),
    headers: [...e.headers].join(' / '), raw: [...e.raw].slice(0, 3).join(', '), rows: e.rows,
  }));
  const find = opts.find ? codeKey(opts.find) : '';
  // --find kodla (MAG/MMYG) ya da adla (ör. "ERKEK ÇOCUK") arar.
  const findTok = opts.find ? CF.token(opts.find) : '';
  const shown = find ? codeRows.filter(r => r.code === find || [...(res.codes.find(x => x.code === r.code && x.field.toUpperCase() === r.field) || { parents: [] }).parents].includes(find)
    || CF.token(r.name) === findTok || r.mmyg.split(', ').some(m => CF.token(m.replace(/^\S+\s*/, '')) === findTok)) : codeRows;
  console.log(`\n${find ? L(`"${opts.find}" kodunun geçtiği yerler`, `Where "${opts.find}" appears`) : L('Kod sözlüğü', 'Code dictionary')} (${shown.length})`);
  printTable(find ? shown : shown.slice(0, 200), [
    { key: 'field', title: L('Alan', 'Field') }, { key: 'code', title: L('Kod', 'Code') }, { key: 'name', title: L('Ad/Tanım', 'Name') },
    { key: 'mmyg', title: L('Üst MMYG', 'Parent MMYG') }, { key: 'directorate', title: L('Marka Müdürlüğü', 'Brand Directorate') }, { key: 'headers', title: L('Geçtiği başlık', 'Found in header') }, { key: 'rows', title: L('Satır', 'Rows') },
  ]);
  if (!find && shown.length > 200) console.log('  … ' + L(`${shown.length - 200} kod daha; tamamı için --out kullanın.`, `${shown.length - 200} more; use --out for the full list.`));

  console.log(`\n${L('Uyarılar', 'Warnings')} (${res.conflicts.length})`);
  printTable(res.conflicts.slice(0, 100), [{ key: 'type', title: L('Tür', 'Type') }, { key: 'detail', title: L('Ayrıntı', 'Detail') }]);

  if (opts.out) {
    writeOut(opts.out, [
      { name: L('Kodlar', 'Codes'), rows: codeRows },
      { name: L('Sütunlar', 'Columns'), rows: colRows },
      { name: L('Uyarılar', 'Warnings'), rows: res.conflicts },
      { name: L('Başlık Sözlüğü', 'Header Dictionary'), rows: dict },
    ]);
    console.log('\n' + L(`Yazıldı: ${opts.out}`, `Written: ${opts.out}`));
  }
  return find && !shown.length ? 1 : 0;
}

function XLSXcol(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

if (require.main === module) {
  try { process.exitCode = main(); } catch (err) { console.error(err && err.message || err); process.exitCode = 2; }
}

module.exports = { resolveHeader, analyze, aliasTable, codeKey };
