'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const launchpad = require('../public/overview-launchpad.js');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const SOURCE = fs.readFileSync(path.join(ROOT, 'public', 'overview-launchpad.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'overview-home.css'), 'utf8');

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
  const countries = Object.fromEntries(launchpad.CLOCKS.map(item => [item.id, item.countryCode]));
  assert.equal(countries.TR, 'TR');
  assert.equal(countries.BD, 'BD');
  assert.equal(countries['US-NY'], 'US');
});

test('Saat seçimi bilinmeyen ve tekrar eden ülkeleri temizler; tüm IANA saat dilimlerini kabul eder', () => {
  assert.deepEqual(launchpad.normalizeSelection(['TR', 'TR', 'XX', 'IN']), ['TR', 'IN']);
  assert.deepEqual(launchpad.normalizeSelection(['TZ:Europe/Paris','TZ:Europe/Paris']), ['TZ:Europe/Paris']);
  assert.ok(launchpad.supportedTimeZones().includes('Europe/Paris'));
  assert.deepEqual(launchpad.normalizeSelection(null), launchpad.DEFAULT_CLOCKS);
  assert.deepEqual(launchpad.normalizeSelection([]), []);
});

test('Resmi tatil tercihi ve kullanıcı seçilebilir aylık periyot doğru normalize edilir', () => {
  assert.equal(launchpad.normalizeHolidayPref(null), true);
  assert.equal(launchpad.normalizeHolidayPref('0'), false);
  assert.equal(launchpad.normalizeHolidayPref('false'), false);
  assert.equal(launchpad.normalizeHolidayPref('1'), true);
  assert.equal(launchpad.DEFAULT_HOLIDAY_MONTHS, 3);
  assert.deepEqual(launchpad.HOLIDAY_MONTH_OPTIONS, [1, 3, 6, 12]);
  assert.equal(launchpad.normalizeHolidayMonths('12'), 12);
  assert.equal(launchpad.normalizeHolidayMonths('5'), 3);
  assert.equal(launchpad.addMonthsISO('2026-10-01', 3), '2027-01-01');
  assert.equal(launchpad.addMonthsISO('2026-01-31', 1), '2026-02-28');
  const rows = [
    { date: '2026-10-01', name: 'National Day', nationalHoliday: true, holidayTypes: ['Public'] },
    { date: '2026-10-29', name: 'Republic Day', nationalHoliday: true, holidayTypes: ['Public'] },
    { date: '2027-01-01', name: 'New Year', nationalHoliday: true, holidayTypes: ['Public'] },
    { date: '2027-02-01', name: 'Outside three months', nationalHoliday: true, holidayTypes: ['Public'] },
    { date: '2026-10-05', name: 'Regional', nationalHoliday: false, subdivisionCodes: ['US-NY'], holidayTypes: ['Public'] },
    { date: '2026-10-06', name: 'Observance', nationalHoliday: true, holidayTypes: ['Observance'] },
  ];
  assert.deepEqual(launchpad.upcomingHolidays(rows, '2026-10-01', 3).map(item => item.name), ['National Day', 'Republic Day', 'New Year']);
  assert.deepEqual(launchpad.upcomingHolidays(rows, '2026-10-01', 1).map(item => item.name), ['National Day', 'Republic Day']);
  assert.deepEqual(launchpad.upcomingHolidays(rows, '2026-10-01', 1, 50, 'US-NY').map(item => item.name), ['National Day', 'Regional', 'Republic Day']);
  assert.equal(launchpad.isoDayDiff('2026-10-01', '2026-10-29'), 28);
});

test('Saat ekleme araması ülke adı ve saat dilimine göre eşleşir', () => {
  assert.equal(launchpad.clockMatchesSearch(launchpad.CLOCKS.find(item=>item.id==='BD'), 'bangla', 'en'), true);
  assert.equal(launchpad.clockMatchesSearch(launchpad.CLOCKS.find(item=>item.id==='TR'), 'Istanbul', 'en'), true);
  assert.equal(launchpad.clockMatchesSearch(launchpad.CLOCKS.find(item=>item.id==='IN'), 'tokyo', 'en'), false);
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
  assert.match(SOURCE, /data-clock-search/);
  assert.match(SOURCE, /data-clock-holiday-toggle/);
  assert.match(SOURCE, /data-clock-holiday-period/);
  assert.match(SOURCE, /buyerlog\.overview\.worldClocks\.holidayMonths\.v1/);
  assert.match(SOURCE, /data-clock-holidays/);
  assert.match(SOURCE, /nagerholidays\.com\/api\/v4\/Holidays/);
  assert.match(SOURCE, /nagerholidays\.com\/api\/v3\/PublicHolidays/);
  assert.match(SOURCE, /\/api\/world-clock-holidays/);
  assert.equal(launchpad.HOLIDAY_API, 'https://nagerholidays.com/api/v4/Holidays');
  assert.equal(launchpad.HOLIDAY_LOCAL_API, '/api/world-clock-holidays');
  const india2026=launchpad.officialHolidayOverride(2026,'IN');
  const india2027=launchpad.officialHolidayOverride(2027,'IN');
  assert.equal(india2026.length,17,'India 2026 DoPT gazetted list must not collapse to zero');
  assert.equal(india2027.length,17,'India 2027 DoPT gazetted list must be available for 12-month look-ahead');
  assert.ok(india2026.some(item=>item.date==='2026-11-08'&&/Diwali/.test(item.name)));
  assert.ok(india2027.some(item=>item.date==='2027-10-29'&&/Diwali/.test(item.name)));
  assert.equal(launchpad.normalizeHolidayRows([{date:'2026-01-26',name:'Republic Day',nationalHoliday:true,holidayTypes:['Public']}])[0].name, 'Republic Day');
  const eid=launchpad.normalizeHolidayRows([{date:'2027-03-10',name:'Eid al-Fitr',nationalHoliday:true,holidayTypes:['Public'],estimated:true,holidayKey:'eid_al_fitr'}])[0];
  assert.equal(launchpad.holidayDisplayName(eid,'tr'), 'Ramazan Bayramı (tahmini)');
  assert.equal(launchpad.holidayDisplayName(eid,'en'), 'Eid al-Fitr (expected)');
  assert.match(SOURCE, /filterClockOptions/);
  assert.match(SOURCE, /Analog \+ dijital/);
  assert.match(SOURCE, /Intl\.supportedValuesOf\('timeZone'\)/);
  assert.match(SOURCE, /'TZ:'\+zone/);
  assert.match(SOURCE, /window\.BLStorage/);
  assert.match(CSS, /\.ovAnalogClock/);
  assert.match(CSS, /\.ovClockHolidayToggle/);
  assert.match(CSS, /\.ovClockHolidayPeriod/);
  assert.match(CSS, /\.ovClockHolidays/);
  assert.match(CSS, /max-height:154px/);
  assert.doesNotMatch(SOURCE, /Workspace ready|Çalışma alanı hazır/);
  assert.doesNotMatch(SOURCE, /data-launch-tab/);
  assert.doesNotMatch(SOURCE, /rankTabs/);
  assert.match(CSS, /\.ovClockGrid/);
  assert.match(CSS, /repeat\(auto-fit,minmax\(128px,1fr\)\)/);
  assert.match(CSS, /\.ovLaunchBody\{grid-template-columns:minmax\(120px,150px\) minmax\(0,1fr\);gap:18px 18px;\}/);
  assert.match(SOURCE, /ovClockHolidayName\" title=/);
  assert.match(CSS, /\.ovClockTime\{[^}]*white-space:nowrap/);
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
