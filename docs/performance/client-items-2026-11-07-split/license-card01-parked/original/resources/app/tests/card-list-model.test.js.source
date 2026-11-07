'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const Engine = require('../public/license-cards-engine');
function load() {
  let calls = 0, day = '2026-11-07';
  const window = { BLLicenseCardsEngine: { ...Engine, today: () => day, rows(...args) { calls++; return Engine.rows(...args); } }, addEventListener() {} };
  const source = fs.readFileSync(require.resolve('../public/license-cards'), 'utf8').replace('window.initLicenseCardsPage=', 'window.fixture={S,currentRows,counts,allRows,ensureDraft};window.initLicenseCardsPage=');
  vm.runInNewContext(source, { window, document: { getElementById() { return null; } }, appLang: 'en' });
  return { ...window.fixture, window, get calls() { return calls; }, set day(value) { day = value; } };
}
const cards = () => [
  { id: 'one', license: 'Alpha', licensor: 'Agency', rules: [{ id: 'r1', opdStart: '2026-01-01', opdEnd: '2026-11-07', royalty: 5 }] },
  { id: 'two', license: 'Beta', licensor: '', rules: [] },
  { id: 'three', license: 'Gamma', licensor: 'Agency', rules: [] },
];
const plain = value => JSON.parse(JSON.stringify(value));

test('license rows/counters share filter results and selection does not rebuild the list model', () => {
  const p = load(); p.S.data = { revision: 1, cards: cards() };
  p.currentRows(); p.counts(); p.allRows(); const before = p.calls;
  p.S.expanded = 'one'; p.S.selected.add('one'); p.currentRows(); p.counts(); p.allRows();
  assert.equal(p.calls, before, 'selecting or opening a card must not repeat E.rows');
  for (const query of ['', 'Alpha', 'Agency', 'missing']) for (const status of ['all', 'active', 'missing', 'noLicensor', 'noMap']) {
    p.S.query = query; p.S.status = status;
    const expected = Engine.rows(p.S.data.cards, { query, status, sort: p.S.sort, day: '2026-11-07' });
    assert.deepEqual(plain(p.currentRows()), plain(expected));
    const all = Engine.rows(p.S.data.cards, { query, day: '2026-11-07' });
    assert.deepEqual(plain(p.counts()), { all: all.length, active: all.filter(r => r.primary.status === 'active').length, missing: all.filter(r => r.primary.status !== 'active').length, noLicensor: all.filter(r => !r.licensor).length, noMap: all.filter(r => !r.map.length).length });
  }
});

test('revision, day, sort, favorite and draft changes preserve engine output and invalidate relevant views', () => {
  const p = load(); p.S.data = { revision: 1, cards: cards() }; p.S.favoritesOnly = true; p.S.favorites.add('one');
  assert.deepEqual(plain(p.currentRows().map(r => r.id)), ['one']);
  p.S.favorites.clear(); assert.equal(p.currentRows().length, 0);
  p.S.favoritesOnly = false; p.currentRows();
  p.S.data.cards[0].license = 'Changed'; p.S.data.revision++; assert.equal(p.currentRows()[1].license, 'Changed');
  p.day = '2026-11-08'; assert.equal(p.currentRows().find(r => r.id === 'one').primary.status, 'expired');
  p.S.sort = { key: 'license', dir: 'desc' };
  assert.deepEqual(plain(p.currentRows().map(r => r.id)), ['three', 'one', 'two']);
  p.ensureDraft('one'); p.S.query = 'Beta'; assert.ok(p.currentRows().some(r => r.id === 'one'), 'filtered draft remains reachable');
  p.S.data = { revision: 3, cards: [] };
  assert.equal(p.currentRows()[0].id, 'one', 'deleted card draft remains reachable and unsaved');
});
