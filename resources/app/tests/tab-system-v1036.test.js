'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const INDEX = read('public/index.html');
const APP = read('public/app-main.js');
const DESIGN = read('public/design.css');
const TAB_PATH = path.join(ROOT, 'public', 'tab-system.js');
const TAB_SOURCE = fs.existsSync(TAB_PATH) ? fs.readFileSync(TAB_PATH, 'utf8') : '';
const TAB_MODULE = fs.existsSync(TAB_PATH) ? require(TAB_PATH) : {};
const TAB_FILES = [
  'public/data-management.js',
  'public/formula-columns.js',
  'public/cp-overview-assistant.js',
  'public/lfl.js',
  'public/lfl-order-analytics.js',
  'public/user-management.js',
].map(file => [file, read(file)]);

function tags(source, role) {
  return source.match(new RegExp(`<[^>]+role="${role}"[^>]*>`, 'g')) || [];
}

test('v10.36 ortak sekme denetleyicisi uygulama çekirdeğinden önce yüklenir', () => {
  const tabs = INDEX.indexOf('<script src="tab-system.js');
  const app = INDEX.indexOf('<script src="app-main.js');
  assert.ok(tabs >= 0, 'ortak sekme denetleyicisi sayfaya eklenmeli');
  assert.ok(tabs < app, 'sekme denetleyicisi uygulama ve tembel modüllerden önce hazır olmalı');
});

test('v10.36 ok, Home ve End tuşları yön ve sınır kurallarına göre sekme odağını taşır', () => {
  assert.equal(typeof TAB_MODULE.nextTabIndex, 'function');
  assert.equal(TAB_MODULE.nextTabIndex(1, 4, 'ArrowRight', 'horizontal'), 2);
  assert.equal(TAB_MODULE.nextTabIndex(0, 4, 'ArrowLeft', 'horizontal'), 3);
  assert.equal(TAB_MODULE.nextTabIndex(2, 4, 'Home', 'horizontal'), 0);
  assert.equal(TAB_MODULE.nextTabIndex(1, 4, 'End', 'horizontal'), 3);
  assert.equal(TAB_MODULE.nextTabIndex(1, 4, 'ArrowDown', 'vertical'), 2);
  assert.equal(TAB_MODULE.nextTabIndex(1, 4, 'ArrowRight', 'vertical'), null);
});

test('v10.36 klavye sistemi roving tabindex uygular, pasif sekmeleri atlar ve okla içerik değiştirmez', () => {
  assert.match(TAB_SOURCE, /function syncTablist\(tablist\)/);
  assert.match(TAB_SOURCE, /aria-selected/);
  assert.match(TAB_SOURCE, /setAttribute\('tabindex',\s*selected\s*\?\s*'0'\s*:\s*'-1'\)/);
  assert.match(TAB_SOURCE, /aria-disabled/);
  assert.match(TAB_SOURCE, /tab\.disabled/);
  assert.match(TAB_SOURCE, /next\.focus\(\)/);
  assert.doesNotMatch(TAB_SOURCE, /next\.click\(\)/, 'ok tuşu yalnız odağı taşımalı; Enter/Space seçimi korumalı');
  assert.doesNotMatch(TAB_SOURCE, /MutationObserver/, 'büyük tablo çizimlerini izleyen sürekli bir gözlemci eklenmemeli');
});

test('v10.36 gerçek tablistlerin tamamı adlandırılmış ve tek tab durağı sözleşmesine bağlıdır', () => {
  const source = TAB_FILES.map(([, value]) => value).join('\n');
  const lists = tags(source, 'tablist');
  const tabs = tags(source, 'tab');
  assert.equal(lists.length, 8, 'durum filtresi tablist sayılmadan sekiz gerçek tablist kalmalı');
  lists.forEach(tag => {
    assert.match(tag, /data-bl-tabs="(?:line|segment|metrics)"/);
    assert.match(tag, /aria-label=/);
  });
  assert.ok(tabs.length > 0);
  tabs.forEach(tag => assert.match(tag, /tabindex=/));
});

test('v10.36 kullanıcı durumu sekme gibi değil, seçili durumu açıklanan filtre gibi davranır', () => {
  const UM = read('public/user-management.js');
  const start = UM.indexOf('<div class="umStatusTabs"');
  const end = UM.indexOf('${store.filtersOpen', start);
  const block = UM.slice(start, end);
  assert.match(block, /role="group"/);
  assert.match(block, /data-bl-choicebar/);
  assert.doesNotMatch(block, /role="tablist"/);
  const fnStart = UM.indexOf('function statusTab');
  const fnEnd = UM.indexOf('function selectHtml', fnStart);
  const fn = UM.slice(fnStart, fnEnd);
  assert.match(fn, /aria-pressed=/);
  assert.doesNotMatch(fn, /role="tab"/);
});

test('v10.36 ana modül navigasyonu bulunduğu sayfayı aria-current ile duyurur', () => {
  assert.match(INDEX, /<nav class="tabs"[^>]*aria-label=/);
  const start = APP.indexOf('function switchTab(tab)');
  const end = APP.indexOf('const profileAllowed', start);
  const block = APP.slice(start, end);
  assert.match(block, /aria-current/);
  assert.match(block, /b\.dataset\.tab===tab\s*\?\s*'page'\s*:\s*null/);
});

test('v10.36 sekme panelleri klavyeyle ulaşılabilir ve seçili sekmeyle ilişkilidir', () => {
  const DM = read('public/data-management.js');
  const FC = read('public/formula-columns.js');
  const CPA = read('public/cp-overview-assistant.js');
  const LFL = read('public/lfl.js');
  const LA = read('public/lfl-order-analytics.js');
  const UM = read('public/user-management.js');
  assert.match(DM, /id="dmLabPanel"[^>]*role="tabpanel"[^>]*aria-labelledby=/);
  assert.match(FC, /data-fc-build[^>]*role="tabpanel"[^>]*tabindex="0"/);
  assert.match(CPA, /class="cpaRuleList"[^>]*role="tabpanel"[^>]*aria-labelledby=/);
  assert.match(LFL, /id="lflTrialDraftList"[^>]*role="tabpanel"[^>]*tabindex="0"/);
  assert.match(LA, /data-la-body[^>]*role="tabpanel"[^>]*aria-labelledby=/);
  assert.match(UM, /class="umMatrixWrap"[^>]*role="tabpanel"[^>]*aria-labelledby=/);
  assert.match(UM, /class="umTemplateGrid"[^>]*role="tabpanel"[^>]*aria-labelledby=/);
});

test('v10.36 ortak sekme yüzeyi token tabanlı, odak görünür ve dar alanda taşmadan kayar', () => {
  const start = DESIGN.indexOf('/* v10.36 — SEKME SİSTEMİ */');
  const block = DESIGN.slice(start);
  assert.ok(start >= 0);
  assert.match(block, /\[data-bl-tabs\]/);
  assert.match(block, /overflow-x:auto/);
  assert.match(block, /var\(--focus-ring\)/);
  assert.match(block, /\[aria-selected="true"\]/);
  assert.match(block, /\[data-bl-choicebar\]/);
  assert.match(block, /\[aria-pressed="true"\]/);
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b/i, 'yeni sekme sistemi tema dışı sabit renk üretmemeli');
});
