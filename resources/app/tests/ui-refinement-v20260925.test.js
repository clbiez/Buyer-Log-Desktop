'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const APP = read('public/app-main.js');
const INDEX = read('public/index.html');
const EXP = read('public/experience.css');
const TIP = read('public/ui-tooltip.js');
const BDA = read('public/backlog-delivery-analysis.js');
const UM = read('public/user-management.js');
const UI = require('../public/ui-primitives.js');
const demo = require('../scripts/generate-demo-data.js');

test('Kopyalama geri bildirimi düğme içeriğini değiştirmez (simge kaybolmaz, komşular itilmez)', () => {
  const body = APP.slice(APP.indexOf('function flashCopyBtn('), APP.indexOf('// ---- Panoya kopyalama'));
  assert.doesNotMatch(body, /\.textContent\s*=/);
  assert.match(body, /classList\.add\(ok\?'copied':'copyFailed'\)/);
  assert.match(body, /BLTableToolbarActionCleanup\?\.finish/);
  assert.match(body, /if\(!ok\)showToast/);
  assert.doesNotMatch(body, /Copied .*with formatting|biçimlendirmeyle kopyalandı/);
});

test('Açılış yükleme kartı sayfayı itmez; bildirimler sağ altta', () => {
  assert.match(EXP, /#ovEmpty:has\(>\.uiState--loading\)\{\s*position:absolute;/);
  assert.match(EXP, /\.uiFeedbackRegion--edge\{top:auto;bottom:18px;/);
});

test('İkon-only araç çubuğu kuralı ve ipucu açılır menülerin içine uygulanmaz', () => {
  assert.match(EXP, /\.tableActionToolbar :is\(\.tbtn,\.navActionBtn\):not\(\.primary\):not\(\.tableSearchHelpButton\):not\(\.toolbarMoreMenu \*\)/);
  assert.match(TIP, /:not\(\.toolbarMoreMenu \*\)/);
  assert.match(INDEX, /<script src="ui-tooltip\.js\?/);
});

test('Her modülün kendine ait simgesi var; üç analiz modülü aynı grafiği paylaşmaz', () => {
  const navIcons = [...INDEX.matchAll(/<button data-tab="([a-z]+)"[^>]*><svg class="ic"><use href="#(i-[a-z0-9-]+)"/g)]
    .map(match => match[2]);
  assert.equal(new Set(navIcons).size, navIcons.length, `yinelenen ray simgesi: ${navIcons.join(', ')}`);
  assert.match(INDEX, /id="kolRecycleBinBtn"[^>]*>\s*<svg[^>]*><use href="#i-bl-recycle"/);
  assert.match(INDEX, /<symbol id="i-bl-lfl"/);
  assert.match(INDEX, /fill:var\(--ic-tint,currentColor\)/);
});

test('Thinking Orb bileşeni durum değerini doğrular ve yükleme durumunda kullanılır', () => {
  assert.match(UI.orbHtml('thinking'), /class="blOrb" data-state="thinking"/);
  assert.match(UI.orbHtml('bogus', 'lg'), /class="blOrb blOrb--lg" data-state="idle"/);
  assert.match(UI.stateView({ kind: 'loading', title: 'x' }), /blOrb uiStateOrb/);
  assert.match(EXP, /@property --orb-angle/);
  assert.match(EXP, /@media\(prefers-reduced-motion:reduce\)\{\.blOrb,\.blOrb::after\{animation:none!important;\}\}/);
});

test('Teslimat riski analizi bölümleri açılır/kapanır ve tercih saklanır', () => {
  for (const key of ['cause', 'attention', 'stage', 'dimension', 'quality']) {
    assert.match(BDA, new RegExp(`foldHead\\('${key}'`), `${key} bölümü katlanabilir değil`);
  }
  assert.match(BDA, /folds: state\.folds/);
  assert.match(BDA, /data-fold-toggle/);
  assert.match(EXP, /\.bdaFold:not\(\.is-open\)>\.bdaFoldBody\{display:none;\}/);
});

test('Backlog detay kompakt görünümü türetilmiş tarih parçalarını gizler, anahtar sütunları korur', () => {
  const source = APP.slice(APP.indexOf('const BACKLOG_DETAIL_SECONDARY_RE='), APP.indexOf('function backlogDetailCompact('));
  const patterns = eval(source.replace('const BACKLOG_DETAIL_SECONDARY_RE=', '').replace(/;\s*$/, ''));
  const hidden = col => patterns.some(re => re.test(col));
  assert.equal(hidden('Orijinal Exfactory Merch Tarih (Hafta)'), true);
  assert.equal(hidden('Retail Depo Merch Yil Ay'), true);
  assert.equal(hidden('Kalan Alım Sipariş Miktarı_Merkez Sevke Hazır Depo'), true);
  for (const col of ['Sipariş Kodu', 'Model Adı', 'Orijinal Exfactory Merch Tarih', 'Adet', 'GÜNCEL DURUM', 'FOB Fiyatı']) {
    assert.equal(hidden(col), false, `${col} gizlenmemeli`);
  }
});

function luminance(hex) {
  const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(1 + i, 3 + i), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('Kurşun tema koyulaştı ve metin/zemin çiftleri WCAG AA (≥4.5) sağlar', () => {
  const block = EXP.match(/html\[data-theme="grey"\]\{([\s\S]*?)\n\}/)[1];
  const token = name => block.match(new RegExp(`--${name}:(#[0-9a-f]{6})`, 'i'))[1];
  assert.ok(luminance(token('paper')) < luminance('#e9ecf0'), 'kurşun kağıt açık temadan koyu olmalı');
  for (const [fg, bg] of [['ink', 'card'], ['ink2', 'card'], ['muted', 'card'], ['muted', 'card2'], ['muted', 'paper'],
    ['muted', 'rail-bg'], ['acc-ink', 'acc-bg'], ['on-acc', 'acc'], ['green', 'card2'], ['orange', 'card2'], ['red', 'card2']]) {
    const ratio = contrast(token(fg), token(bg));
    assert.ok(ratio >= 4.5, `${fg} / ${bg} kontrastı ${ratio.toFixed(2)}`);
  }
});

test('Kullanıcı yönetimi emoji değil ortak SVG simge ve rozet kullanır', () => {
  assert.doesNotMatch(UM, /icon: '[^a-z]/);
  assert.doesNotMatch(UM, /🟢|⚪/);
  assert.match(UM, /<svg class="ic"><use href="#i-\$\{esc\(section\.icon\)\}"\/><\/svg>/);
  assert.match(UM, /class="umRole is-/);
});

test('Demo veri üreticisi deterministik ve gerçek ayrıştırıcı başlıklarını kullanır', () => {
  const today = new Date(Date.UTC(2026, 8, 25));
  const a = demo.build({ rows: 40, seed: 3, today });
  const b = demo.build({ rows: 40, seed: 3, today });
  assert.deepEqual(a, b);
  const asasHeader = a.asas[2];
  for (const name of ['Sipariş Kod', 'Net Alım Sipariş Miktarı', 'Kalan Alım Sipariş Miktarı', 'Orijinal Exfactory Merch Tarih', 'Ana Kumaş Mı']) {
    assert.ok(asasHeader.includes(name), `ASAS başlığı eksik: ${name}`);
  }
  assert.ok(a.antrepo[0].includes('Yükleme Toplam Adet'), 'Antrepo bütünlük doğrulaması Yükleme Toplam Adet ister');
  assert.equal(a.asas.length - 3, 40);
});
