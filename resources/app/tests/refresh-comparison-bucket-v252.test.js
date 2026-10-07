'use strict';

/*
 * v7.0.252 — Yenileme "Denetleme ve Kaydetme" adımında donma.
 *
 * Kalan Antrepo parsiyellerini eşleyen açgözlü döngü her seçim turunda tüm puan
 * matrisini yeniden tarıyordu (kova başına O(k³), tamamen senkron). Tek kovada
 * 1.500 parsiyel ~10 sn, birkaç bin parsiyel dakikalar sürüyor; sunucu bu sürede
 * /api/refresh-status dahil hiçbir isteğe cevap vermediğinden ilerleme penceresi
 * donuk kalıyordu. Seçim artık sayma sıralamasıyla tek geçişte yapılır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const diff = require('../server/lib/refresh-history-diff');

// v7.15 açgözlü eşleştirmenin referans kopyası: sonuç birebir aynı kalmalı.
function referenceChanged(oldMap, newMap) {
  const rows = map => Object.values(map);
  const groups = map => { const out = new Map(); for (const row of rows(map)) { const key = diff.identity(row); if (!out.has(key)) out.set(key, []); out.get(key).push(row); } return out; };
  const similarity = (left, right) => {
    const a = diff.comparable(left), b = diff.comparable(right);
    let score = 0;
    for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) if ((a[name] || '') === (b[name] || '')) score += 1;
    return score;
  };
  const oldGroups = groups(oldMap), newGroups = groups(newMap), out = [];
  for (const key of new Set([...oldGroups.keys(), ...newGroups.keys()])) {
    let oldLeft = (oldGroups.get(key) || []).slice(), newLeft = (newGroups.get(key) || []).slice();
    const queue = new Map();
    newLeft.forEach((row, index) => { const sig = diff.signature(row); if (!queue.has(sig)) queue.set(sig, []); queue.get(sig).push(index); });
    const takenOld = new Set(), takenNew = new Set();
    for (let oi = oldLeft.length - 1; oi >= 0; oi -= 1) {
      const list = queue.get(diff.signature(oldLeft[oi]));
      if (list && list.length) { takenOld.add(oi); takenNew.add(list.shift()); }
    }
    oldLeft = oldLeft.filter((_, index) => !takenOld.has(index));
    newLeft = newLeft.filter((_, index) => !takenNew.has(index));
    const scores = oldLeft.map(a => newLeft.map(b => similarity(a, b)));
    const oldAlive = oldLeft.map(() => true), newAlive = newLeft.map(() => true);
    for (let remaining = Math.min(oldLeft.length, newLeft.length); remaining > 0; remaining -= 1) {
      let bo = -1, bn = -1, best = -1;
      for (let oi = 0; oi < oldLeft.length; oi += 1) if (oldAlive[oi]) for (let ni = 0; ni < newLeft.length; ni += 1) if (newAlive[ni] && scores[oi][ni] > best) { best = scores[oi][ni]; bo = oi; bn = ni; }
      oldAlive[bo] = false; newAlive[bn] = false;
      out.push([oldLeft[bo], newLeft[bn]]);
    }
  }
  return out;
}

function randomBucket(count, seed, extraField) {
  let state = seed;
  const next = () => { state = (state * 1103515245 + 12345) % 2147483648; return state; };
  const map = {};
  for (let i = 0; i < count; i += 1) {
    const fields = { 'Sipariş Kod': '1000000', 'Renk Kod': 'RNK' };
    for (let j = 0; j < 8; j += 1) fields[`Alan ${j}`] = `v${next() % 3}`;
    if (extraField && next() % 2) fields['Ek Alan'] = `e${next() % 2}`;
    map[`__ias_row_${i}`] = { ocode: '1000000', model: 'M', ccode: 'RNK', _sourceFields: fields };
  }
  return map;
}

test('v7.0.252 benzerlik eşleştirmesi eski açgözlü sonuçla birebir aynıdır', () => {
  for (let seed = 1; seed <= 25; seed += 1) {
    const before = randomBucket(5 + (seed % 9), seed, seed % 2 === 0);
    const after = randomBucket(4 + (seed % 11), seed * 31 + 7, seed % 3 === 0);
    const expected = referenceChanged(before, after);
    const actual = diff.pairAntrepoRows(before, after).filter(pair => pair.kind === 'changed').map(pair => [pair.oldRow, pair.newRow]);
    assert.equal(actual.length, expected.length, `seed ${seed}`);
    actual.forEach(([oldRow, newRow], index) => {
      assert.equal(oldRow, expected[index][0], `seed ${seed} çift ${index} eski satır`);
      assert.equal(newRow, expected[index][1], `seed ${seed} çift ${index} yeni satır`);
    });
  }
});

test('v7.0.252 binlerce parsiyelli tek kova sunucuyu kilitlemez', () => {
  const bucket = (count, tag) => {
    const map = {};
    for (let i = 0; i < count; i += 1) {
      const fields = { Tarih: `${tag}-${i}` };
      for (let j = 0; j < 30; j += 1) fields[`F${j}`] = `x${(i * 7 + j) % 50}`;
      map[`__ias_row_${i}`] = { ocode: '1', model: 'M', ccode: 'C', _sourceFields: fields };
    }
    return map;
  };
  for (const count of [1200, 4000]) {
    const started = Date.now();
    const pairs = diff.pairAntrepoRows(bucket(count, 'a'), bucket(count, 'b'));
    const ms = Date.now() - started;
    assert.equal(pairs.length, count);
    assert.ok(pairs.every(pair => pair.kind === 'changed'));
    assert.ok(ms < 5000, `${count} parsiyelli kova ${ms} ms sürdü; kübik eşleştirme geri dönmüş olabilir`);
  }
});
