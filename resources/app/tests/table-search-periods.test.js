'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

// Modül globalThis'e kendini kaydeder; BLDateDimension da aynı yoldan gelir.
require('../public/date-dimension.js');
const Periods = require('../public/table-search-periods.js');
const RowGroups = require('../public/table-search-row-groups.js');
const Feedback = require('../public/table-search-feedback.js');

function helper(name, args) {
  const match = APP.match(new RegExp(`function ${name}\\(${args}\\)\\{[^]*?\\n\\}`));
  assert.ok(match, `${name} bulunmalı`);
  return Function(`const norm=value=>String(value==null?'':value).trim(); ${match[0]}; return ${name};`)();
}
const parse = helper('parseTableSearchTerms', 'value');
const matches = helper('tableSearchMatches', 'haystack,terms,options');
const opts = { plainMode: 'contains' };

test('dönem ifadesi alan/birim takma adlarını ve aralığı çözer', () => {
  assert.deepEqual(Periods.parse('MB=W1').tokens, ['~mbw01~']);
  assert.deepEqual(Periods.parse('mb = m3-m5').tokens, ['~mbm03~', '~mbm04~', '~mbm05~']);
  assert.deepEqual(Periods.parse('MB=M10-12').tokens, ['~mbm10~', '~mbm11~', '~mbm12~']);
  assert.deepEqual(Periods.parse('EXF=H12').tokens, ['~exfw12~']);
  assert.deepEqual(Periods.parse('Ex-Factory=A2').tokens, ['~exfm02~']);
  assert.deepEqual(Periods.parse('RETAIL=W34').tokens, ['~rtw34~']);
  // Yıl sonunu aşan sezon aralığı ileri sarar.
  assert.deepEqual(Periods.parse('RT=M11-M2').tokens, ['~rtm11~', '~rtm12~', '~rtm01~', '~rtm02~']);
  assert.equal(Periods.parse('MB=W1-W24').tokens.length, 24);
});

test('alan adı olmayan ifade düz metin, tanınan alanın hatalı değeri geçersiz kısayoldur', () => {
  for (const text of ['XX=M3', 'MB', 'S7', 'a=b', '13,50', 'Uzun Kollu']) {
    assert.equal(Periods.parse(text), null, text);
  }
  for (const [text, reason] of [['MB=M13', 'month'], ['MB=W0', 'week'], ['MB=M3-W5', 'format'], ['MB=', 'format'],
    ['EXF=xyz', 'format'], ['MB=2027M5-2027M3', 'order'], ['MB=M3-2027M5', 'format'], ['SEZON=', 'season']]) {
    const parsed = Periods.parse(text);
    assert.equal(parsed?.invalid, true, text);
    assert.equal(parsed.reason, reason, text);
    assert.ok(Periods.invalidReason(parsed, false) && Periods.invalidReason(parsed, true), text);
  }
});

test('yıllı dönem ve sezon kısayolu', () => {
  assert.deepEqual(Periods.parse('MB=2027M3').tokens, ['~mbm202703~']);
  assert.deepEqual(Periods.parse('RT=2026M11-M2').tokens, ['~rtm202611~', '~rtm202612~', '~rtm202701~', '~rtm202702~']);
  assert.deepEqual(Periods.parse('MB=2026M12-2027M1').tokens, ['~mbm202612~', '~mbm202701~']);
  assert.deepEqual(Periods.parse('MB=2027W52-2028W1').tokens.slice(-2), ['~mbw202753~', '~mbw202801~']);
  assert.deepEqual(Periods.parse('SEZON=S7').tokens, ['~szs7~']);
  assert.deepEqual(Periods.parse('season = w 7').tokens, ['~szw7~']);
  assert.equal(Periods.label(Periods.parse('MB=M3-M5'), false), 'MB · Mart–Mayıs');
  assert.equal(Periods.label(Periods.parse('MB=2026M11-2027M2'), true), 'MB · November 2026–February 2027');
  assert.equal(Periods.label(Periods.parse('EXF=W12-W14'), false), 'Ex-Factory · 12–14. hafta');
  assert.equal(Periods.label(Periods.parse('SEZON=s7'), true), 'Season · S7');
});

test('satır jetonları MB kodlarından, tarihlerden ve sezondan üretilir', () => {
  const tokens = Periods.rowTokens({
    mbWeekCode: '2027-07', mbMonthCode: '202703', exFactory: '2026-12-15', retail: '15.04.2027', season: 'S7',
  }).split(' ');
  for (const t of ['~mbw07~', '~mbw202707~', '~mbm03~', '~mbm202703~', '~szs7~']) assert.ok(tokens.includes(t), t);
  assert.ok(tokens.some(t => /^~exfm\d\d~$/.test(t)) && tokens.some(t => /^~exfm\d{6}~$/.test(t)));
  assert.ok(tokens.some(t => /^~rtw\d\d~$/.test(t)) && tokens.some(t => /^~rtw\d{6}~$/.test(t)));
  // MB kodu yoksa MB tarihinden türetilir (Date nesnesi de kabul edilir); hiç veri yoksa jeton yok.
  assert.match(Periods.rowTokens({ mbDate: new Date(2027, 2, 8) }), /~mbw\d\d~ ~mbw\d{6}~ ~mbm\d\d~ ~mbm\d{6}~/);
  assert.equal(Periods.rowTokens({}), '');
});

test('ortak arama: "S7; MB=M3-M5" sezon VE ay aralığı olarak eşleşir', () => {
  const terms = parse('S7; MB=M3-M5');
  const row = (season, mbm) => `uzun kollu ${season} ${Periods.token('mb', 'm', mbm)}`;
  assert.equal(matches(row('s7', 4), terms, opts), true);
  assert.equal(matches(row('s7', 6), terms, opts), false);
  assert.equal(matches(row('w7', 4), terms, opts), false);
  // Düz metin "mb=m3" artık literal aranmaz; jetonsuz satır eşleşmez.
  assert.equal(matches('mb=m3 s7', parse('MB=M3'), opts), false);
  // Geçersiz kısayol işaretli düz kriter olarak kalır.
  assert.equal(parse('MB=M13')[0].invalid, true);
  assert.equal(matches('~szs7~ ~mbm03~', parse('SEZON=S7; MB=2027M3'), opts), false);
  assert.equal(matches('~szs7~ ~mbm03~ ~mbm202703~', parse('SEZON=S7; MB=2027M3'), opts), true);
});

test('ortak arama: dönem hariç tutma tüm aralığı dışlar', () => {
  const terms = parse('MB=M3-M4!');
  assert.equal(matches('x ~mbm03~', terms, opts), false);
  assert.equal(matches('x ~mbm04~', terms, opts), false);
  assert.equal(matches('x ~mbm05~', terms, opts), true);
});

test('satır grubu ve eksik değer geri bildirimi dönem kriterini anlar', () => {
  const Search = { parseTerms: parse, matches };
  const host = { BLTableSearch: Search };
  RowGroups.install(host);
  const grouped = host.BLTableSearch.parseTerms('(S7; MB=M3), (W7; MB=M9)');
  assert.equal(host.BLTableSearch.matches('s7 ~mbm03~', grouped, opts), true);
  assert.equal(host.BLTableSearch.matches('s7 ~mbm09~', grouped, opts), false);
  const missing = Feedback.findMissing('MB=M3, MB=M9', ['a ~mbm03~'], r => r, host.BLTableSearch);
  assert.deepEqual(missing, ['MB=M9']);
});

test('Koleksiyon araması MB ayını kayıt dilinden bağımsız iki dilde bulur', () => {
  const body = APP.match(/function kolMonthSearchText\(value\)\{[^]*?\n\}/);
  assert.ok(body, 'kolMonthSearchText bulunmalı');
  const fn = Function(`const norm=v=>String(v==null?'':v).trim();
    const KOL_MONTHS_TR=['OCAK','ŞUBAT','MART','NİSAN','MAYIS','HAZİRAN','TEMMUZ','AĞUSTOS','EYLÜL','EKİM','KASIM','ARALIK'];
    const KOL_MONTHS_EN=['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
    const kolMonthCode=v=>({'TEMMUZ 2027':'202707','JULY 2027':'202707'})[v]||'';
    ${body[0]}; return kolMonthSearchText;`)();
  for (const stored of ['TEMMUZ 2027', 'JULY 2027']) {
    const hay = fn(stored);
    assert.equal(matches(hay, parse('July'), opts), true, stored);
    assert.equal(matches(hay, parse('Temmuz'), opts), true, stored);
  }
  // Haystack bu yardımcıyı ve dönem jetonlarını kullanır; tarih alanları önbellek imzasına girer.
  const hay = APP.match(/function kolSearchHaystack\(row\)\{[^]*?\n\}/)[0];
  assert.match(hay, /key==='inStoreMonth'\?kolMonthSearchText/);
  assert.match(hay, /BLTableSearchPeriods\?\.rowTokens/);
  assert.match(hay, /KOL_SEARCH_PERIOD_KEYS/);
  assert.ok(INDEX.indexOf('table-search-periods.js') > 0 && INDEX.indexOf('table-search-periods.js') < INDEX.indexOf('app-main.js'));
});
