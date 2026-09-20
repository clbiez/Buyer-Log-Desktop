'use strict';

// v7.0.82 — canonical version source regression guard.
// package.json tek SemVer kaynağıdır; UI/cache/version history runtime placeholder
// üzerinden server/lib/app-version.js tarafından türetilir.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const appMain = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');

const [major, minor, patch] = pkg.version.split('.');
assert.equal(minor, '0', 'sürüm biçimi major.0.patch olmalı');
const shortVersion = `${major}.${String(patch).padStart(2, '0')}`;

test('v7.0.82 asset version token package.json canonical SemVer’dan runtime üretilir', () => {
  const tags = [...html.matchAll(/[?&]v=([^&"']+)/g)].map(m => m[1]);
  assert.ok(tags.length > 10, 'sürümlü varlık etiketleri bulunmalı');
  assert.deepEqual([...new Set(tags)], ['__BL_ASSET_VERSION__']);
  assert.match(html, /window\.BL_ASSET_VERSION="__BL_ASSET_VERSION__"/);
});

test('v7.0.82 görünür sürüm ve boot anahtarı hard-coded değildir', () => {
  assert.match(html, />Version __BL_DISPLAY_VERSION__</);
  assert.match(html, /bootRetry\.v__BL_DISPLAY_VERSION__/);
  assert.doesNotMatch(html, new RegExp(`>Version ${shortVersion.replace('.', '\\.')}<`));
});

test('v7.0.82 version-history current kaydı runtime display version kullanır', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'version-history.js'), 'utf8');
  assert.match(src, /window\.BL_VERSION_HISTORY\s*=\s*\[\s*\{\s*v:\s*'__CURRENT__'/);
  assert.match(appMain, /record&&record\.v==='__CURRENT__'/);
});


// --- Statik dil işaretleri -------------------------------------------------

test('v4.98 uygulama çekirdeği index.html dışına alındı ve aynı yerde yükleniyor', () => {
  // Aynı ürün sürümü içindeki güvenli hotfix'ler isteğe bağlı rev parametresiyle
  // tarayıcı cache'ini kırabilir; yürütme sırası ve ana ?v sürümü değişmez.
  assert.match(html, /<script src="app-main\.js\?v=__BL_ASSET_VERSION__(?:&rev=[A-Za-z0-9._-]+)?"><\/script>/);
  assert.ok(!/defer|async/.test(html.match(/<script src="app-main\.js[^>]*>/)[0]),
    'app-main.js defer/async ALMAMALI: yürütme sırası satır içi haliyle birebir aynı kalmalı');
  assert.ok(appMain.includes('const state = {'), 'çekirdek durum nesnesi app-main.js içinde olmalı');
  assert.ok(!html.includes('const state = {'), 'çekirdek kod index.html içinde kalmamalı');
});

test('v4.98 her data-i18n-title-tr için İngilizce karşılık var ve Türkçe karakter içermiyor', () => {
  const pairs = [...html.matchAll(/data-i18n-title-tr="([^"]*)"\s+data-i18n-title-en="([^"]*)"/g)];
  assert.ok(pairs.length >= 20, `en az 20 ipucu çifti beklenir, bulunan: ${pairs.length}`);
  for (const [, tr, en] of pairs) {
    assert.ok(en.trim(), `"${tr}" için İngilizce karşılık boş`);
    assert.ok(!/[çğıİöşüÇĞŞÜÖ]/.test(en), `İngilizce ipucunda Türkçe karakter var: "${en}"`);
  }
});

test('v4.98 title özniteliği data-i18n-title-tr ile birebir aynı (TR moda dönüş güvenli)', () => {
  for (const m of html.matchAll(/title="([^"]*)"[^>]*?data-i18n-title-tr="([^"]*)"/g)) {
    assert.equal(m[1], m[2], `title ile data-i18n-title-tr uyuşmuyor: "${m[1]}"`);
  }
});

test('v4.98 tema adı tek kaynaktan gelir; kaldırılan tema arayüzde görünmez', () => {
  const cycle = appMain.match(/const THEME_CYCLE = \[([^\]]+)\]/);
  assert.ok(cycle, 'THEME_CYCLE tanımı bulunmalı');
  const keys = cycle[1].split(',').map(s => s.trim().replace(/'/g, ''));
  assert.ok(!keys.includes('charcoal'), 'kaldırılan tema tema döngüsünde olmamalı');
  assert.ok(!/charcoal|THEME_ALIAS/.test(appMain + html),
    'Antrasit teması ve taşıma kodu tamamen silinmiş olmalı');
  for (const key of keys) {
    assert.match(appMain, new RegExp(`${key}:\\{label:'[^']+', labelEn:'[^']+'`),
      `${key} temasının hem Türkçe hem İngilizce etiketi olmalı`);
  }
  // Ray düğmesinin ipucu elle yazılmaz; THEME_CYCLE'dan üretilir.
  assert.match(appMain, /function syncThemeButtonTitle\(\)/);
  assert.ok(!html.includes('Antrasit'), 'kaldırılan tema adı statik metinde kalmamalı');
});
