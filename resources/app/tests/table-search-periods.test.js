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

test('geçersiz dönem ifadesi normal arama metni olarak kalır', () => {
  for (const text of ['MB=M13', 'MB=W0', 'MB=M3-W5', 'XX=M3', 'MB', 'MB=', 'S7', 'a=b', '13,50']) {
    assert.equal(Periods.parse(text), null, text);
  }
});

test('satır jetonları MB kodlarından ve tarihlerden üretilir', () => {
  const tokens = Periods.rowTokens({
    mbWeekCode: '2027-07', mbMonthCode: '202703', exFactory: '2026-12-15', retail: '15.04.2027',
  }).split(' ');
  assert.ok(tokens.includes('~mbw07~'));
  assert.ok(tokens.includes('~mbm03~'));
  assert.ok(tokens.some(t => /^~exfm\d\d~$/.test(t)) && tokens.some(t => /^~exfw\d\d~$/.test(t)));
  assert.ok(tokens.some(t => /^~rtm\d\d~$/.test(t)) && tokens.some(t => /^~rtw\d\d~$/.test(t)));
  // MB kodu yoksa MB tarihinden türetilir; hiç veri yoksa jeton yok.
  assert.match(Periods.rowTokens({ mbDate: '2027-03-08' }), /~mbw\d\d~ ~mbm\d\d~/);
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
