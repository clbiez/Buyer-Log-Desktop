'use strict';

/* v6.49 — LFL alt detay pencereleri (Selected/Compared Portfolio Detail,
 * MAG · MMYG · Classification drill-down) neredeyse tam ekrana genişletildi.
 *
 * Kullanıcı isteği: "alt detay açılır pencereleri ekranda çok küçük kalıyor
 * ve detaylar okunmuyor. pencereleri maksimum seviyede genişlet ve
 * tabloların sütunlarını açılır pencereye sığdırmaya çalışma."
 *
 * İki farklı modal (ensureLflPortfolioModal, ensureLflDetailModal) AYNI
 * .lflPortfolioModalPanel sınıfını paylaşıyor; tek bir CSS düzeltmesi
 * ikisini de kapsar.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'lfl.css'), 'utf8');
const LFL_JS = fs.readFileSync(path.join(ROOT, 'public', 'lfl.js'), 'utf8');

function ruleBody(css, selector) {
  const idx = css.indexOf(selector);
  assert.ok(idx >= 0, `${selector} bulunmalı`);
  const open = css.indexOf('{', idx);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

/* -------------------------------------------------------------- 1) BOYUT */

test('v6.49 panel eski 1500x780 sınırını taşımıyor, viewport\'a yakın', () => {
  const body = ruleBody(CSS, '.lflPortfolioModalPanel{');
  assert.doesNotMatch(body, /min\(1500px/, 'eski sabit üst sınır kalkmış olmalı');
  assert.doesNotMatch(body, /min\(780px/);
  assert.match(body, /width:calc\(100vw - 20px\)/);
  assert.match(body, /height:calc\(100vh - 20px\)/);
});

test('v6.49 dış kapsayıcının kenar boşluğu küçültüldü (daha fazla alan panele ayrılıyor)', () => {
  const body = ruleBody(CSS, '.lflPortfolioModal{position:fixed');
  assert.match(body, /padding:10px;/);
  assert.doesNotMatch(body, /padding:22px;/);
});

test('v6.49 masaüstü ve mobil artık aynı ölçüyü kullanıyor (tutarlı davranış)', () => {
  // Mobil breakpoint zaten calc(100vw - 20px) kullanıyordu; masaüstü artık
  // onunla aynı formülü paylaşıyor — iki ayrı "maksimum genişlik" tanımı yok.
  const desktop = ruleBody(CSS, '.lflPortfolioModalPanel{');
  const mobileBlock = CSS.slice(CSS.indexOf('@media(max-width:760px){.lflPortfolioModal{padding:10px;}'));
  assert.match(desktop, /calc\(100vw - 20px\)/);
  assert.match(mobileBlock.slice(0, 300), /calc\(100vw - 20px\)/);
});

/* --------------------------------------------------- 2) SÜTUNLAR SIKIŞTIRILMIYOR */

test('v6.49 tablo düzeni hâlâ doğal genişlikte (sığdırmaya zorlanmıyor)', () => {
  // table-layout:auto + white-space:nowrap = sütun genişliği İÇERİĞE göre
  // belirlenir, panele SIĞDIRILMAZ; taşarsa .lflPortfolioModalTableWrap
  // içinde yatay kaydırma devreye girer. Bu davranış BİLEREK korunuyor.
  const tableRule = ruleBody(CSS, '.lflTable{width:100%;border-collapse:separate;border-spacing:0;table-layout:auto;');
  assert.match(CSS.slice(CSS.indexOf('.lflTable{width:100%'), CSS.indexOf('.lflTable{width:100%') + 200), /table-layout:auto/);
  const tdRule = ruleBody(CSS, '.lflTable td{');
  assert.match(tdRule, /white-space:nowrap/);
  assert.doesNotMatch(tdRule, /text-overflow:ellipsis/, 'hücreler kırpılmamalı, taşan tablo scroll ile erişilmeli');
});

test('v6.49 portföy tablosunun minimum genişliği korunuyor, panele göre sıkıştırılmadı', () => {
  assert.match(CSS, /\.lflPortfolioModalTableWrap \.lflTable\{min-width:1460px;\}/);
  assert.match(CSS, /\.lflDetailAccessPanel #lflDetailAccessTable\{min-width:1460px;\}/);
});

/* ------------------------------------------------------- 3) İKİ MODAL DA KAPSANIYOR */

test('v6.49 hem Selected/Compared Portfolio hem drill-down modalı aynı panel sınıfını paylaşıyor', () => {
  // Tek bir CSS kuralının hem ensureLflPortfolioModal hem ensureLflDetailModal
  // tarafından kullanıldığını doğrular — ikisi de büyümüş olur.
  const portfolioUsesPanel = LFL_JS.includes("modal.className='lflPortfolioModal';") &&
    LFL_JS.includes('lflPortfolioModalPanel');
  const detailUsesPanel = LFL_JS.includes("modal.className='lflPortfolioModal lflDetailAccessModal';") &&
    LFL_JS.includes('lflPortfolioModalPanel lflDetailAccessPanel');
  assert.ok(portfolioUsesPanel, 'ensureLflPortfolioModal .lflPortfolioModalPanel kullanmalı');
  assert.ok(detailUsesPanel, 'ensureLflDetailModal da .lflPortfolioModalPanel kullanmalı');
});
