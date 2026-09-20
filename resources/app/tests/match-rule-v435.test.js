'use strict';
/*
 * v4.37 — ASAS ↔ IAS eşleştirmesi yalnız kayıpsız üçlü anahtarla yapılır.
 * Sipariş Kod + Model Adı/Ürün Adı + Renk Kod alanlarının tamamı karakter
 * karakter aynı değilse eşleşme yoktur. Eski gevşek kural adları yok sayılır.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const parse = require(path.join(__dirname, '..', 'server', 'lib', 'parse.js'));

const d = value => new Date(value + 'T00:00:00');
function entry(ocode, model, ccode, colour, statu) {
  return {
    ocode: String(ocode), _matchOcode: String(ocode), model, ccode, colour, statu,
    arr: d('2026-03-01'), handover: null, vasita: 'Gemi', _ord: 1, _cpExtra: {},
  };
}
function strictMap() {
  return {
    [parse.antrepoMatchKey('1234567', 'URUN-A', 'C01')]: entry('1234567', 'URUN-A', 'C01', 'SIYAH', 'Depoda'),
    [parse.antrepoMatchKey('1234567', 'URUN-B', 'C02')]: entry('1234567', 'URUN-B', 'C02', 'LACIVERT', 'Yol Operasyonları'),
  };
}
const asasLine = { ocode: 1234567, _matchOcode: '1234567', model: 'KAZAK A', ccode: 'C01', colour: 'SIYAH' };

test('tek geçerli kural üçlü birebir eşleşmedir', () => {
  assert.deepStrictEqual(parse.ANTREPO_MATCH_RULES, ['order+model+ccode']);
  assert.strictEqual(parse.DEFAULT_ANTREPO_MATCH_RULE, 'order+model+ccode');
  for (const old of ['AUTO', 'order', 'order+ccode', 'order+model', 'saçma bir değer', null]) {
    assert.strictEqual(parse.normalizeAntrepoMatchRule(old), 'order+model+ccode');
  }
});

test('eski gevşek kural adı verilse bile model farkı eşleşmez', () => {
  const map = strictMap();
  for (const oldRule of ['order+ccode', 'order+model', 'order', 'auto']) {
    const diag = {};
    assert.strictEqual(parse.findAntrepoHit(map, asasLine, { rule: oldRule, diag }), null, oldRule);
    assert.strictEqual(diag.unmatched, 1, oldRule);
  }
});

test('üç alanın tamamı birebir aynıysa doğru IAS satırı gelir', () => {
  const map = strictMap();
  const a = parse.findAntrepoHit(map, { ocode: 1234567, model: 'URUN-A', ccode: 'C01' }, { rule: 'auto' });
  const b = parse.findAntrepoHit(map, { ocode: 1234567, model: 'URUN-B', ccode: 'C02' }, { rule: 'order' });
  assert.strictEqual(a.statu, 'Depoda');
  assert.strictEqual(b.statu, 'Yol Operasyonları');
  assert.strictEqual(a._matchLevel, 'line');
  assert.strictEqual(a._matchRule, 'order+model+ccode');
});

test('eksik kimlik alanı eşleşme kurmaz', () => {
  const map = strictMap();
  for (const order of [
    { ocode: 1234567, model: '', ccode: 'C01' },
    { ocode: 1234567, model: 'URUN-A', ccode: '' },
    { ocode: '', model: 'URUN-A', ccode: 'C01' },
  ]) {
    const diag = {};
    assert.strictEqual(parse.findAntrepoHit(map, order, { diag }), null);
    assert.strictEqual(diag.targetIncomplete, 1);
  }
});

test('büyük/küçük harf ve Türkçe karakter farkı eşleşmez', () => {
  const map = {
    [parse.antrepoMatchKey('A', 'KAZAK ŞIK', 'B')]: entry('A', 'KAZAK ŞIK', 'B', 'SIYAH', 'Depoda'),
  };
  assert.ok(parse.findAntrepoHit(map, { ocode: 'A', model: 'KAZAK ŞIK', ccode: 'B' }));
  assert.strictEqual(parse.findAntrepoHit(map, { ocode: 'A', model: 'kazak şık', ccode: 'B' }), null);
  assert.strictEqual(parse.findAntrepoHit(map, { ocode: 'A', model: 'KAZAK SIK', ccode: 'B' }), null);
});

test('sipariş kodu temsil farkı normalize edilir; model ve renk kodu birebir kalır', () => {
  const map = {
    [parse.antrepoMatchKey('A-001', 'MODEL', '001')]: entry('A-001', 'MODEL', '001', 'SIYAH', 'Depoda'),
  };
  assert.ok(parse.findAntrepoHit(map, { ocode: 'A-001', model: 'MODEL', ccode: '001' }));
  // Alfasayısal sipariş kodları sayısal iş koduna çevrilemez; farklı yazım farklıdır.
  assert.strictEqual(parse.findAntrepoHit(map, { ocode: 'A001', model: 'MODEL', ccode: '001' }), null);
  // Renk kodunda hiçbir sayısal/tahmini normalizasyon yoktur.
  assert.strictEqual(parse.findAntrepoHit(map, { ocode: 'A-001', model: 'MODEL', ccode: '1' }), null);
  assert.strictEqual(parse.findAntrepoHit(map, { ocode: 'A-001', model: 'MODEL', ccode: '1.00' }), null);
});

test('eski override kuralları CP ve Backlog akışında gevşeme yaratmaz', () => {
  const base = {
    season: '26SS', countryRaw: 'MISIR', buyer: 'B', buyerGrup: 'BG', manufacturer: 'M', line: 'L',
    category: 'C', ozel: '', license: 'FCB', qty: 1000, kalan: 1000, antrepo: 0, merkezSevkeHazirKalan: 0,
    fob: 5, opd: d('2025-10-01'), ex: d('2026-01-10'), retail: d('2026-04-01'), mb: d('2026-04-15'),
  };
  const orders = [{ ...base, ...asasLine }];
  const ov = rule => ({ notesmap: {}, submap: {}, suppfobmap: {}, suppfobmetamap: {}, delmap: {}, licensormap: {}, pricingRules: [], transitRules: [], antrepoMatchRule: rule });
  const map = strictMap();
  for (const rule of ['order+ccode', 'order+model', 'order', 'auto', 'order+model+ccode']) {
    assert.strictEqual(parse.buildCPRowsFromASAS(orders, map, ov(rule))[0].STATUS, 'Üretimde', rule);
    assert.strictEqual(parse.buildBacklogGrouped(orders, map, ov(rule), { groupBy: ['status'] }).tree[0].label, 'Üretimde', rule);
  }
});

test('denetim hangi alanın tutmadığını söyler', () => {
  const map = strictMap();
  const audit = parse.auditAntrepoMatching([asasLine], map, 'auto');
  assert.strictEqual(audit.rule, 'order+model+ccode');
  assert.strictEqual(audit.totals.matched, 0);
  assert.strictEqual(audit.totals.unmatched, 1);
  assert.strictEqual(audit.fields.ocode.shared, 1);
  assert.strictEqual(audit.fields.ccode.shared, 1);
  assert.strictEqual(audit.fields.model.shared, 0);
  assert.deepStrictEqual(audit.samples[0].mismatch, ['model']);
});

test('denetim tam eşleşmede temiz sonuç verir', () => {
  const map = strictMap();
  const orders = [{ ocode: 1234567, _matchOcode: '1234567', model: 'URUN-A', ccode: 'C01', colour: 'SIYAH' }];
  const audit = parse.auditAntrepoMatching(orders, map, 'order');
  assert.strictEqual(audit.totals.matched, 1);
  assert.strictEqual(audit.totals.unmatched, 0);
  assert.strictEqual(audit.samples.length, 0);
});

test('v5.16 default canonical identity cannot be shadowed by stale hidden __MATCH values', () => {
  const config = parse.defaultAntrepoMatchConfig();
  const order = {
    ocode:'1242935', _matchOcode:'1242935', model:'PNT,GENT', ccode:'HNM', colour:'DARK BROWN',
    _matchValues:{ ocode:'WRONG-ORDER', model:'WRONG-MODEL', ccode:'WRONG-CODE' },
  };
  const iasRow = {
    ocode:'1242935', _matchOcode:'1242935', model:'PNT,GENT', ccode:'HNM', colour:'DARK BROWN', statu:'Depoda',
    _matchValues:{ ocode:'OTHER', model:'OTHER', ccode:'OTHER' },
  };
  const map = { row: iasRow };
  assert.equal(parse.dynamicAntrepoMatchKey(order,'asas',config), JSON.stringify(['1242935','PNT,GENT','HNM']));
  assert.equal(parse.dynamicAntrepoMatchKey(iasRow,'ias',config), JSON.stringify(['1242935','PNT,GENT','HNM']));
  assert.ok(parse.findAntrepoHit(map, order, {rule:config}));
});
