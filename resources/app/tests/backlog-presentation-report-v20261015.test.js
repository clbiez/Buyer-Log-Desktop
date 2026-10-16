'use strict';

/* Backlog sunum raporu (2026-10-15): animasyonlu HTML / PDF raporu.
   Sayılar Backlog V3 modelinden gelir; rapor JS kapalıyken de tamdır (PDF penceresi),
   dış kaynak yüklemez ve ana DOM'a değil izole iframe'e yazılır. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const Report = require('../public/backlog-presentation-report.js');
const V3 = require('../public/backlog-v3-report.js');
const read = file => fs.readFileSync(path.join(PUBLIC, file), 'utf8');

const STAGES = ['PRODUCTION', 'LOADING', 'IN_TRANSIT', 'CUSTOMS', 'IN_WAREHOUSE', 'AWAITING_RETAIL_TRANSFER', 'SHORTAGE'];
const COUNTRIES = ['TURKIYE', 'BANGLADEŞ', 'Mısır', 'Georgia', 'FAS', 'CHINA', ''];
function items(n = 70) {
  return Array.from({ length:n }, (_, i) => ({
    stage:STAGES[i % 7], qty:1000 + i * 10, lineId:'L' + i, orderCode:'PO' + (4100000 + i), modelName:'M' + i,
    buyer:['Ece', 'Can'][i % 2], manufacturer:'Üretici ' + (i % 4), season:'6W26', category:'KAZAK', country:COUNTRIES[i % 7],
    deliveryType:i % 10 === 0 ? 'UÇAK' : 'GEMİ', exFactory:'2026-10-' + String(10 + (i % 15)).padStart(2, '0'),
    antrepo:'2026-10-' + String(16 + (i % 10)).padStart(2, '0'), retail:'2026-11-0' + (1 + (i % 9)), inStore:'2026-11-1' + (i % 9),
    risk:i % 9 === 0, transitOverdue:i % 11 === 0, overdueNotLoaded:i % 7 === 0, overdueDays:i % 5, rawTimestampFields:[], exInheritedFrom:'',
  }));
}

test('Rapor sayıları Backlog V3 özetiyle birebir aynıdır', () => {
  const list = items();
  const sum = V3.summarize(list);
  const html = Report.build(list, { lang:'tr', today:'2026-10-15' });
  assert.match(html, new RegExp(`data-count="${sum.qty}">${sum.qty.toLocaleString('tr-TR').replace('.', '\\.')}<`));
  for (const key of STAGES) assert.ok(html.includes(`data-count="${sum.stages[key]}"`), key);
  const en = Report.build(list, { lang:'en', today:'2026-10-15' });
  assert.match(en, /<html lang="en"/);
  assert.match(en, /Backlog pulse/);
});

test('Rapor tek dosyadır: dış kaynak yok, katı CSP var, kullanıcı metni kaçışlanır', () => {
  const list = items(14);
  list[0].modelName = '<img src=x onerror=alert(1)>';
  list[1].manufacturer = '"><script>alert(2)</script>';
  const html = Report.build(list, { lang:'tr', today:'2026-10-15' });
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:">/);
  assert.doesNotMatch(html, /<script src=|<link |https?:\/\//);
  assert.doesNotMatch(html, /<img src=x/);
  assert.equal((html.match(/<script>/g) || []).length, 1, 'yalnız raporun kendi etkileşim betiği');
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('JS kapalıyken ve baskıda dinlenme hali son haldir', () => {
  const html = Report.build(items(), { lang:'tr', today:'2026-10-15' });
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  for (const name of ['growX', 'growY', 'draw', 'arc', 'pop', 'rise']) assert.match(css, new RegExp(`@keyframes ${name}\\{from\\{`), `${name} yalnız başlangıç karesini tanımlar`);
  assert.match(css, /@media print\{[^]*?\*,\*::before\{animation:none!important\}/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\*,\*::before\{animation:none!important\}/);
  assert.match(css, /@page\{size:A4 landscape;margin:10mm\}/);
  assert.doesNotMatch(css, /\{opacity:0\}/);
});

test('30 günlük projeksiyon tarih penceresini ve kümülatif toplamı doğru hesaplar', () => {
  const list = [
    { stage:'PRODUCTION', qty:100, exFactory:'2026-10-15', antrepo:'2026-10-20' },
    { stage:'PRODUCTION', qty:50, exFactory:'2026-10-14', antrepo:'2026-11-13' },
    { stage:'IN_WAREHOUSE', qty:70, exFactory:'2026-10-16', antrepo:'2026-10-16' },
    { stage:'LOADING', qty:30, exFactory:'2026-11-14' },
  ];
  const p = Report.projection(list, '2026-10-15', 30);
  const ex = p.series.find(s => s.key === 'exFactory'), an = p.series.find(s => s.key === 'antrepo');
  assert.equal(p.dates[0], '2026-10-15'); assert.equal(p.dates[29], '2026-11-13');
  assert.equal(ex.daily[0], 100); assert.equal(ex.total, 100, 'geçmiş, pencere dışı ve depodaki satırlar Ex-F planına girmez');
  assert.equal(an.daily[5], 100); assert.equal(an.daily[29], 50); assert.equal(an.total, 150, 'depoya girmiş satır antrepo projeksiyonuna girmez');
  assert.deepEqual(an.cumulative.slice(4, 7), [0, 100, 100]);
});

test('Ülke adları TR/EN ve büyük harf yazımlarında eşleşir; bilinmeyen ülke haritada uydurulmaz', () => {
  assert.equal(Report.countryOf('TÜRKİYE').k, 'TR');
  assert.equal(Report.countryOf('Bangladeş').k, 'BD');
  assert.equal(Report.countryOf('BANGLADES').k, 'BD');
  assert.equal(Report.countryOf('egypt').k, 'EG');
  assert.equal(Report.countryOf('Atlantis'), null);
  const geo = Report.countries(items());
  assert.ok(geo.unknown.qty > 0, 'boş ülke ayrı satırda raporlanır');
  assert.ok(geo.list.every(c => Number.isFinite(c.lon) && Number.isFinite(c.lat)));
});

test('Uygulama içi önizleme izole iframe kullanır, PDF masaüstü JS kapalı penceresinde basılır', () => {
  const ui = read('backlog-presentation.js'), index = read('index.html');
  assert.match(ui, /<iframe class="blpFrame" sandbox="allow-scripts" referrerpolicy="no-referrer"><\/iframe>/);
  assert.doesNotMatch(ui, /sandbox="[^"]*allow-same-origin/);
  assert.match(ui, /desktop\.renderPdf\(buildHtml\(current\.items,'light',current\.fontList\),\{landscape:true\}\)/);
  assert.match(ui, /root\.BLBacklogRows\.load\(params\)/);
  assert.match(ui, /root\.BLBacklogV3Report\.normalizeRows\(rows\)/);
  assert.match(index, /id="backlogPresentBtn"[^>]*data-i18n-title-en="Animated Backlog presentation report/);
  assert.match(index, /<span data-i18n-tr="Sunum raporu" data-i18n-en="Presentation report">Sunum raporu<\/span>/);
  assert.match(read('app-main.js'), /'\.blCmdOverlay', '\.blpOverlay',/);
});
