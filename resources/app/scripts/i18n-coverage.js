'use strict';
/* ===================================================================
   Buyer Log — TR/EN dil kapsamı raporu
     npm run i18n:check      → İngilizce karşılığı olmayan Türkçe metinleri
                               dosya:satır olarak listeler (baseline dışı
                               yeni eksikler "YENİ" olarak işaretlenir).
     npm run i18n:baseline   → Düzeltilmiş eksikleri baseline'dan siler.
                               Baseline'a ASLA yeni kayıt eklemez; yeni
                               metnin TR/EN çifti yazılmalıdır.
   =================================================================== */
const fs = require('node:fs');
const coverage = require('../tests/helpers/i18n-coverage');

const shrink = process.argv.includes('--shrink-baseline');
const byFile = coverage.scanAll();
const baseline = coverage.readBaseline();

let fresh = 0;
let known = 0;
for (const [file, list] of Object.entries(byFile)) {
  const allowed = new Set(baseline[file] || []);
  for (const item of list) {
    const isNew = !allowed.has(item.text);
    if (isNew) fresh++;
    else known++;
    if (isNew || process.argv.includes('--all')) {
      console.log(`${isNew ? 'YENİ  ' : 'eski  '}${item.file}:${item.line}  ${item.text}`);
    }
  }
}

if (shrink) {
  const current = coverage.toBaseline(byFile);
  const next = {};
  let removed = 0;
  for (const [file, texts] of Object.entries(baseline)) {
    const still = new Set(current[file] || []);
    const kept = texts.filter(text => still.has(text));
    removed += texts.length - kept.length;
    if (kept.length) next[file] = kept;
  }
  const payload = {
    note: 'Dondurulmuş TR/EN eksikleri. Yalnız küçülebilir: yeni kayıt eklenmez, yeni metin TR/EN çiftiyle yazılır. Bkz. CLAUDE.md "TR/EN dil desteği".',
    files: next,
  };
  fs.writeFileSync(coverage.BASELINE_FILE, JSON.stringify(payload, null, 2) + '\n');
  console.log(`[i18n] Baseline küçültüldü: ${removed} kayıt silindi.`);
}

console.log(`[i18n] Yeni eksik: ${fresh} · Baseline'daki eski eksik: ${known}`);
if (fresh) {
  console.log('[i18n] Yeni Türkçe metinlerin İngilizce karşılığını yazın (L(tr,en) / isEn()?en:tr / {tr,en} veya i18n-dictionary.js).');
  process.exitCode = 1;
}
