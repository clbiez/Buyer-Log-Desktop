'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const launchpad = require('../public/overview-launchpad.js');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const SOURCE = fs.readFileSync(path.join(ROOT, 'public', 'overview-launchpad.js'), 'utf8');

test('Bugün modülü saate göre doğru selamlamayı seçer', () => {
  assert.equal(launchpad.greeting(8, 'tr'), 'Günaydın');
  assert.equal(launchpad.greeting(14, 'tr'), 'İyi günler');
  assert.equal(launchpad.greeting(20, 'en'), 'Good evening');
  assert.equal(launchpad.greeting(2, 'tr'), 'İyi geceler');
});

test('Sık kullanılan sekmeler önce, kalan yer rail sırasıyla dolar', () => {
  const rail = ['cp', 'orders', 'backlog', 'koleksiyon', 'quotations', 'lfl', 'source'];
  const visits = { koleksiyon: { count: 9, last: 10 }, lfl: { count: 3, last: 50 }, orders: { count: 3, last: 90 } };
  assert.deepEqual(launchpad.rankTabs(rail, visits), ['koleksiyon', 'orders', 'lfl', 'cp', 'backlog', 'quotations']);
});

test('Yetkisi kalkan veya Genel Bakış sekmesi hızlı erişimde görünmez', () => {
  const visits = { secret: { count: 50, last: 1 }, overview: { count: 99, last: 1 }, cp: { count: 1, last: 1 } };
  assert.deepEqual(launchpad.rankTabs(['overview', 'cp', 'orders'], visits), ['cp', 'orders']);
});

test('Ziyaret kaydı Genel Bakışı saymaz ve bozuk depolamayı temizler', () => {
  let visits = launchpad.recordVisit(null, 'overview', 5);
  assert.deepEqual(visits, {});
  visits = launchpad.recordVisit({ cp: { count: 'x' }, '': { count: 3 } }, 'cp', 7);
  assert.deepEqual(visits, { cp: { count: 1, last: 7 } });
  visits = launchpad.recordVisit(visits, 'cp', 9);
  assert.deepEqual(visits, { cp: { count: 2, last: 9 } });
});

test('Modül rail düğmesine devreder, görünüm başlatmaz ve kullanıcı depolamasını kullanır', () => {
  assert.match(INDEX, /id="ovLaunchpad" data-overview-widget="launchpad"/);
  assert.match(INDEX, /overview-launchpad\.js\?/);
  assert.match(SOURCE, /nav\.tabs button\[data-tab=/);
  assert.match(SOURCE, /window\.BLStorage/);
  assert.doesNotMatch(SOURCE, /localStorage/);
  assert.doesNotMatch(SOURCE, /\brender(?:CP|Kol|Overview)\(/);
});

test('Premium ritim katmanı araç çubuğu dışı .tbtn için sıfır özgüllüklü ortak taban tanımlar', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public', 'experience.css'), 'utf8');
  assert.match(css, /:where\(button,input,select,textarea,optgroup\)\{font-family:inherit;\}/);
  assert.match(css, /:where\(button\.tbtn,label\.tbtn,a\.tbtn\)\{[\s\S]*?min-height:var\(--ctl-h\);/);
  assert.doesNotMatch(css, /Barlow Condensed/);
  assert.match(css, /\.ovLaunchBody\{display:grid;/);
  assert.match(css, /\.ovLaunchpad\{\s*display:block;/, 'global section{display:none} kuralı modülü gizlememeli');
});

test('Duyarlı araç çubuğu arama kutusunu flex-wrap altında ölçülen gerçek genişlikle planlar', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'toolbar-responsive.js'), 'utf8');
  assert.doesNotMatch(src, /minWidth:meta\.flexible\?/);
  assert.doesNotMatch(src, /entry\.compactMinWidth=Math\.ceil/);
});

test('Hiçbir stil dosyası 10px altı yazı boyutu kullanmaz (Koleksiyon ızgara hücreleri hariç)', () => {
  const skip = /#kolTable|kolLanded|kolSpreadsheet|endeksmatik|kolThumb|@font-face|print/i;
  const dir = path.join(ROOT, 'public');
  for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.css'))) {
    const css = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const [, selector, body] of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
      if (skip.test(selector)) continue;
      for (const [, size] of body.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/g)) {
        assert.ok(Number(size) >= 10, `${file}: "${selector.trim().slice(0, 80)}" ${size}px`);
      }
    }
  }
});
