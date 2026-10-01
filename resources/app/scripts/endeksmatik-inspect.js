'use strict';

/* Endeksmatik çalışma kitabını YEREL olarak inceler; hiçbir yere yüklemez.
 *   node scripts/endeksmatik-inspect.js "ENDEKSMATİK BANGLADEŞ.xlsx" [...]
 * Her dosya için imza (formül mantığı) ve uzlaştırma (Excel önbelleği ↔ Buyer Log
 * yeniden hesabı) sonucunu yazar. Red durumunda hangi hücrenin tutmadığı görünür. */

const fs = require('fs');
const path = require('path');
const model = require('../server/lib/endeksmatik-model');

const files = process.argv.slice(2).filter(a => a !== '--screen');
if (!files.length) { console.error('Kullanım: node scripts/endeksmatik-inspect.js <dosya.xlsx> [...]'); process.exit(2); }
let failed = 0;
for (const file of files) {
  const name = path.basename(file);
  try {
    const started = Date.now();
    const snap = model.parseWorkbookBuffer(fs.readFileSync(file), name);
    const meta = model.publicMeta(snap);
    console.log(`\n✔ ${name}  (${((Date.now() - started) / 1000).toFixed(1)} sn)`);
    console.log(`  bölge=${meta.region || '—'} para=${meta.currency || '—'} sezon=${meta.season || '—'} tarih=${meta.sourceUpdatedAt || '—'} pivot=${meta.pivotRefreshedAt || '—'}`);
    console.log(`  klasman=${meta.recordCount} seviyeler=${JSON.stringify(meta.levelCounts)} aylar=${meta.firstMonth}→${meta.lastMonth} düzeltme=%${meta.targetAdjustmentPct}`);
    snap.validation.reconciliation.checks.forEach(c => console.log(`  ${c.ok ? '=' : '≠'} ${c.label.padEnd(16)} ${c.cell.padEnd(4)} Excel ${c.excel}  Buyer Log ${c.buyerLog}`));
    (snap.validation.warnings || []).forEach(w => console.log(`  ! ${w}`));
    if (process.argv.includes('--screen')) model.describeScreen(fs.readFileSync(file)).forEach(c => console.log(`    ${c.cell.padEnd(4)} = ${String(c.value).slice(0, 40)}${c.formula ? `  | =${c.formula}` : ''}`));
  } catch (err) {
    failed++;
    console.log(`\n✘ ${name}\n  ${err.code || 'ERROR'}: ${err.message}`);
    const d = err.details || {};
    (d.failures || []).forEach(f => console.log(`  - ${f}`));
    (d.checks || []).filter(c => !c.ok).forEach(c => console.log(`  ≠ ${c.label} ${c.cell}: Excel ${c.excel}  Buyer Log ${c.buyerLog}`));
    if (d.diagnostics) [d.diagnostics.summary, ...d.diagnostics.pivots].forEach(x => console.log(`  · ${x.sheet} satır ${x.row}: [${x.labels.join(' | ')}] klasman=${x.detailKeys}${x.matched != null ? ` eşleşen=${x.matched}` : ''}\n      örnek: ${x.samples.join('  ||  ')}`));
    // Red durumunda ekranın kontrol bölgesi dökülür: modelin nerede değiştiği görülsün.
    try {
      console.log('  ENDEKSMATİK A1:G25 (hücre = değer | formül):');
      model.describeScreen(fs.readFileSync(file)).forEach(c => console.log(`    ${c.cell.padEnd(4)} = ${String(c.value).slice(0, 40)}${c.formula ? `  | =${c.formula}` : ''}`));
    } catch (_) {}
  }
}
process.exit(failed ? 1 : 0);
