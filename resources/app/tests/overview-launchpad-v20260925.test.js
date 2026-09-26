'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const launchpad = require('../public/overview-launchpad.js');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const SOURCE = fs.readFileSync(path.join(ROOT, 'public', 'overview-launchpad.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'overview-radar.css'), 'utf8');

test('Dünya saatleri modülü saate göre doğru selamlamayı seçer', () => {
  assert.equal(launchpad.greeting(8, 'tr'), 'Günaydın');
  assert.equal(launchpad.greeting(14, 'tr'), 'İyi günler');
  assert.equal(launchpad.greeting(20, 'en'), 'Good evening');
  assert.equal(launchpad.greeting(2, 'tr'), 'İyi geceler');
});

test('Varsayılan dünya saatleri Türkiye, Bangladeş, Hindistan, Çin ve Mısırdır', () => {
  assert.deepEqual(launchpad.DEFAULT_CLOCKS, ['TR', 'BD', 'IN', 'CN', 'EG']);
  const zones = Object.fromEntries(launchpad.CLOCKS.map(item => [item.id, item.timeZone]));
  assert.equal(zones.TR, 'Europe/Istanbul');
  assert.equal(zones.BD, 'Asia/Dhaka');
  assert.equal(zones.IN, 'Asia/Kolkata');
  assert.equal(zones.CN, 'Asia/Shanghai');
  assert.equal(zones.EG, 'Africa/Cairo');
});

test('Saat seçimi bilinmeyen ve tekrar eden ülkeleri temizler; tüm IANA saat dilimlerini kabul eder', () => {
  assert.deepEqual(launchpad.normalizeSelection(['TR', 'TR', 'XX', 'IN']), ['TR', 'IN']);
  assert.deepEqual(launchpad.normalizeSelection(['TZ:Europe/Paris','TZ:Europe/Paris']), ['TZ:Europe/Paris']);
  assert.ok(launchpad.supportedTimeZones().includes('Europe/Paris'));
  assert.deepEqual(launchpad.normalizeSelection(null), launchpad.DEFAULT_CLOCKS);
  assert.deepEqual(launchpad.normalizeSelection([]), []);
});

test('IANA saat dilimi canlı saat ve analog ibre açılarını deterministik yapar', () => {
  const at = new Date('2026-09-26T12:00:00Z');
  const ist=launchpad.clockParts(at, 'Europe/Istanbul', 'tr');
  assert.equal(ist.time, '15:00:00');
  assert.equal(launchpad.clockParts(at, 'Asia/Dhaka', 'en').time, '18:00:00');
  assert.deepEqual(launchpad.clockAngles(ist), {hour:90,minute:0,second:0});
});

test('Bugün alanında sayfa kısayolları yoktur; kullanıcı dünya saati ekleyip çıkarabilir', () => {
  assert.match(INDEX, /id="ovLaunchpad" data-overview-widget="launchpad"/);
  assert.match(INDEX, /data-i18n-aria-label-en="World Clocks"/);
  assert.match(SOURCE, /buyerlog\.overview\.worldClocks\.v1/);
  assert.match(SOURCE, /data-clock-add/);
  assert.match(SOURCE, /data-clock-remove/);
  assert.match(SOURCE, /data-clock-display-select/);
  assert.match(SOURCE, /Analog \+ dijital/);
  assert.match(SOURCE, /Intl\.supportedValuesOf\('timeZone'\)/);
  assert.match(SOURCE, /'TZ:'\+zone/);
  assert.match(SOURCE, /window\.BLStorage/);
  assert.match(CSS, /\.ovAnalogClock/);
  assert.doesNotMatch(SOURCE, /Workspace ready|Çalışma alanı hazır/);
  assert.doesNotMatch(SOURCE, /data-launch-tab/);
  assert.doesNotMatch(SOURCE, /rankTabs/);
  assert.match(CSS, /\.ovClockGrid/);
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
