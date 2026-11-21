'use strict';
/* Sessiz çalışma alanı (önizleme): saf model + kaynak sözleşmeleri.
   Görünüm ana uygulamanın verisini değiştirmez; alanları yalnız kanonik kimlikle
   okur; modül ve stil yalnız seçildiğinde yüklenir; tercih kullanıcı başınadır. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { model } = require('../public/sessiz-workspace.js');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = name => fs.readFileSync(path.join(PUBLIC, name), 'utf8');

test('Sayı ve tarih okuma TR biçimini ve Excel seri gününü tanır', () => {
  assert.equal(model.toNum('1.200'), 1200);
  assert.equal(model.toNum('6,85'), 6.85);
  assert.equal(model.toNum(4600), 4600);
  assert.equal(model.toNum(''), null);
  assert.equal(model.toDate('13.11.2026').getDate(), 13);
  assert.equal(model.toDate('2026-12-09').getMonth(), 11);
  assert.equal(model.toDate(46339).getFullYear(), 2026);
  assert.equal(model.toDate('—'), null);
});

test('Ex-Factory haftası: geçmiş tek grupta, tarihsiz en sonda, gelecek haftalar sırayla', () => {
  const today = new Date(2026, 10, 16); // Pazartesi
  const it = (d) => ({ exf: d });
  const groups = model.groupByWeek([it(new Date(2026, 10, 20)), it(null), it(new Date(2026, 10, 2)), it(new Date(2026, 10, 24)), it(new Date(2026, 10, 10))], today);
  assert.deepEqual(groups.map(g => g.key), ['past', '0', '1', 'none']);
  assert.equal(groups[0].items.length, 2);
  assert.equal(model.weekIndex(new Date(2026, 10, 22), today), 0, 'Pazar aynı haftadır');
  assert.equal(model.isoWeek(today), 47);
});

test('Rapor projeksiyonu BL kuralını izler: ardışık aynı ana başlık tek sütun, görsel ayrı', () => {
  const cols = [
    { key: 'a', group: 'Sipariş', kind: 'code' }, { key: 'b', group: 'Sipariş', kind: 'mono' },
    { key: 'img', group: 'Model', kind: 'image' }, { key: 'c', group: 'Model', kind: 'name' }, { key: 'd', group: 'Model', kind: 'text' },
    { key: 'e', group: '', kind: 'text' }, { key: 'f', group: 'Sipariş', kind: 'text' }
  ];
  const out = model.projectReport(cols);
  assert.deepEqual(out.map(c => c.kind === 'image' ? 'img' : c.fields.map(f => f.key).join('+')), ['a+b', 'img', 'c+d', 'e', 'f']);
});

test('Hızlı filtre ve seçim özeti', () => {
  const item = { facets: { country: 'Türkiye', season: 'SS27' } };
  assert.equal(model.quickFilterPass(item, { country: 'Türkiye' }), true);
  assert.equal(model.quickFilterPass(item, { country: 'Mısır' }), false);
  assert.equal(model.quickFilterPass(item, { country: '' }), true);
  assert.deepEqual(model.summarize(['1.200', '800', 'metin']), { count: 2, sum: 2000, avg: 1000 });
});

test('Genel Bakış ızgarası: sınırlar, çakışmada aşağı itme, yukarı hizalama, ilk uygun yer', () => {
  const spec = { minW: 3, minH: 2, maxW: 12, maxH: 6 };
  assert.deepEqual(model.clampItem({ key: 'a', x: 11, y: -2, w: 1, h: 9 }, spec), { key: 'a', x: 9, y: 0, w: 3, h: 6 });
  const items = [{ key: 'a', x: 0, y: 0, w: 6, h: 2 }, { key: 'b', x: 0, y: 2, w: 6, h: 2 }];
  items[1].y = 1; model.resolveCollisions(items, 'b');
  assert.deepEqual(items.map(i => [i.key, i.y]), [['a', 3], ['b', 1]]);
  model.compact(items);
  assert.deepEqual(items.map(i => [i.key, i.y]), [['a', 2], ['b', 0]]);
  assert.deepEqual(model.firstFit(items, 6, 2), { x: 6, y: 0, w: 6, h: 2 });
  assert.equal(model.MAX_PAGES, 5);
});

test('Kaynak sözleşmesi: yalnız kanonik alan, salt okunur adaptör, tembel yükleme', () => {
  const src = read('sessiz-workspace.js');
  assert.match(src, /BLCanonicalFields;[^\n]*canonicalValue\(row,'cp',id\)/, 'alanlar kanonik kayıttan okunur');
  assert.doesNotMatch(src, /row\[['"](Order Code|Ex-factory|Model Name|Manufacturer)['"]\]/, 'ham başlık eşleştirmesi yok');
  assert.doesNotMatch(src, /fetch\(/, 'kendi veri isteği yok; ana uygulamanın yüklemesini kullanır');
  assert.doesNotMatch(src, /\.rows\.(push|splice)|state\.cp\s*=/, 'CP verisini değiştirmez');
  const main = read('app-main.js');
  assert.match(main, /window\.BLSessizSource=Object\.freeze\(\{/);
  assert.match(main, /loader\('sessiz-workspace\.js\?rev=/);
  assert.match(main, /link\.href='sessiz-workspace\.css\?rev=/);
  const html = read('index.html');
  assert.match(html, /id="railSessizBtn"[^>]*data-i18n-title-en=/);
  assert.doesNotMatch(html, /<script[^>]+sessiz-workspace\.js/, 'başlangıçta yüklenmez');
  assert.doesNotMatch(html, /<link[^>]+sessiz-workspace\.css/, 'stil yalnız seçildiğinde yüklenir');
  assert.match(read('user-storage.js'), /'buyerlog\.sessiz\.v1\.'/, 'tercih ve düzen kullanıcı başınadır');
});

test('Sessiz düzeni modül CSS\'inde, görünümü ortak sahipte; görünmezken zamanlayıcı çalışmaz', () => {
  const css = read('sessiz-workspace.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const APPEARANCE = /(?:^|[;{])\s*(?:color|background(?:-[a-z]+)?|border(?!-collapse|-spacing)(?:-[a-z]+)*|box-shadow|font(?:-[a-z]+)?|letter-spacing|line-height|text-transform|outline(?:-[a-z]+)?|animation(?:-[a-z]+)?|transition(?:-[a-z]+)?|z-index)\s*:/;
  assert.doesNotMatch(css, APPEARANCE, 'modül CSS yalnız düzen taşır');
  const shared = read('ui-components.css');
  const block = shared.slice(shared.indexOf('/* Sessiz çalışma alanı (önizleme) — görünüm.'));
  assert.ok(block.length > 200, 'görünüm ortak sahipte tanımlı');
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b|rgba?\(|box-shadow:(?!none)|border:(?!0)/, 'ham renk, gölge veya kenarlık yok');
  assert.match(block, /prefers-reduced-motion:reduce/);
  const src = read('sessiz-workspace.js');
  assert.match(src, /blMotionEnter/);
  assert.match(src, /S\.view!=='overview'\|\|doc\.visibilityState!=='visible'/, 'saat yalnız görünür Genel Bakış\'ta güncellenir');
  assert.match(src, /clearInterval\(clockTimer\)/, 'kapanınca zamanlayıcı durur');
  assert.match(src, /setAttribute\('data-no-i18n',''\)/, 'kendi TR/EN çiftlerini kullanır; sözlük ağı karışmaz');
});
