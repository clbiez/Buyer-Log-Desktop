'use strict';

// v7.0.172 — Çoklu Endeksmatik setleri + yeni USD modeli.
//
// Korunan kararlar:
//  · Kitap HÜCRE ADRESİNE göre değil sayfa adı + başlık metnine göre okunur.
//  · ENDEKSMATİK formül imzası tutmazsa ("model değişti") yükleme reddedilir.
//  · Excel'in önbellekli sonuçları Buyer Log'un yeniden hesabıyla uzlaşmazsa red.
//  · Birden çok set saklanır, biri varsayılandır; hesap set id + sürüm taşır.
//  · Eski TL şablonu 'legacy' seti olarak çalışmaya devam eder.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-endeksmatik-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = DATA_ROOT;

const fixture = require('./helpers/endeksmatik-fixture');
const model = require('../server/lib/endeksmatik-model');
const engine = require('../server/lib/endeksmatik');

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const detail = { mmyg: 'CUW4', mag: 'CU4E', supplyGroup: 'ÖRME', buyingGroup: 'LİSANS', category: 'KEY ORME BODY' };

test('USD modeli başlıktan okunur, imza ve uzlaştırma geçer', () => {
  const snap = model.parseWorkbookBuffer(fixture.buildEndeksmatikWorkbook(), 'ENDEKSMATIK BANGLADES SS27.xlsx');
  assert.equal(snap.model, model.MODEL_ID);
  assert.equal(snap.region, 'Bangladeş');
  assert.equal(snap.currency, 'BDT');
  assert.equal(snap.season, 'SS27');
  assert.equal(snap.sourceUpdatedAt, '2026-06-08');
  close(snap.targetAdjustmentPct, 3);
  assert.deepEqual(snap.months, fixture.MONTHS);
  assert.ok(snap.validation.signature.ok);
  assert.ok(snap.validation.reconciliation.ok);
  assert.equal(snap.validation.reconciliation.checks.length, 9);
  // Klasman + her üst seviye (aşağı doldurma ve "Toplam X") + Genel Toplam
  const levels = new Set(snap.records.map(r => r[0]));
  assert.deepEqual([...levels].sort(), [0, 1, 2, 3, 4, 5]);
  assert.equal(snap.records.filter(r => r[0] === 5).length, fixture.CLASSES.length);
  assert.equal(snap.fx.TRY['202607'], 38);
});

test('hesap: dört bileşen de sipariş ayıyla, TOPLAM doğrudan USD, düzeltme tüm bileşenlere', () => {
  const snap = model.parseWorkbookBuffer(fixture.buildEndeksmatikWorkbook(), 'x.xlsx');
  const r = model.calculate(snap, { ...detail, previousOrderMonth: '202507', newOrderMonth: '202607', previousUsdPrice: 2.75 });
  const excel = fixture.excelResults({ selection: Object.values(detail), previousOrderMonth: '202507', orderMonth: '202607', adjustment: 0.03 });
  r.components.forEach((item, i) => {
    assert.deepEqual([item.oldMonth, item.newMonth], ['202507', '202607']);
    close(item.index, excel.deltas[i]);
    close(item.targetIndex, excel.targets[i]);
  });
  close(r.indexes.usd, excel.total);
  close(r.indexes.targetUsd, (1 + excel.total) * 0.97 - 1);
  close(r.prices.usd, 2.75 * (1 + r.indexes.targetUsd));
  assert.equal(r.prices.try, null);
  assert.equal(r.source.setId, snap.id);
  assert.equal(r.source.setVersion, snap.hash);
});

test('TR fiyatı korunur: USD hedefi DOLAR kurunun depo ayı değişimiyle TL\'ye taşınır', () => {
  const snap = model.parseWorkbookBuffer(fixture.buildEndeksmatikWorkbook(), 'x.xlsx');
  const r = model.calculate(snap, { ...detail, previousOrderMonth: '202507', newOrderMonth: '202607', previousInStoreMonth: '202602', newInStoreMonth: '202702', previousTryPrice: 187 });
  const fxOld = snap.fx.TRY['202602'], fxNew = snap.fx.TRY['202702'];
  close(r.indexes.targetTl, (1 + r.indexes.targetUsd) * fxNew / fxOld - 1);
  close(r.prices.try, 187 * (1 + r.indexes.targetTl));
  assert.throws(() => model.calculate(snap, { ...detail, previousOrderMonth: '202507', newOrderMonth: '202607', previousTryPrice: 187 }), e => e.code === 'FX_MISSING');
});

test('üst seviye seçilebilir; Tedarik Grup belirsizse liste döner', () => {
  const snap = model.parseWorkbookBuffer(fixture.buildEndeksmatikWorkbook(), 'x.xlsx');
  const months = { previousOrderMonth: '202507', newOrderMonth: '202607' };
  const mag = model.calculate(snap, { ...detail, level: 2, ...months });
  const members = fixture.CLASSES.filter(c => c.dims[0] === 'CUW4' && c.dims[1] === 'CU4E');
  const s = fixture.groupSeries(members, 0);
  close(mag.components[0].index, s[4] / s[2] - 1);
  assert.equal(mag.levelLabel, 'MAG');
  // Tedarik Grup boş: KEY ORME BODY tekil → otomatik; SWEATSHIRT iki tedarik grubunda → belirsiz.
  assert.equal(model.calculate(snap, { ...detail, supplyGroup: '', ...months }).class.supplyGroup, 'ÖRME');
  assert.throws(() => model.calculate(snap, { ...detail, supplyGroup: '', category: 'SWEATSHIRT', ...months }), e => e.code === 'SUPPLY_GROUP_AMBIGUOUS' && e.details.supplyGroups.length === 2);
  assert.throws(() => model.calculate(snap, { ...detail, category: 'YOK', ...months }), e => e.code === 'CLASS_NOT_FOUND' && e.details.availableLevels.includes(4));
});

test('"X Toplam" biçimli ara toplamlar da okunur', () => {
  const snap = model.parseWorkbookBuffer(fixture.buildEndeksmatikWorkbook({ totalStyle: 'suffix' }), 'x.xlsx');
  assert.ok(snap.records.some(r => r[0] === 1 && r[1] === 'CUW4'));
});

test('model değişti: antrepo ayı / yanlış pivot / düzeltmesiz hedef reddedilir', () => {
  for (const breakFormula of ['depot', 'crossPivot', 'noAdjustment']) {
    assert.throws(() => model.parseWorkbookBuffer(fixture.buildEndeksmatikWorkbook({ breakFormula }), 'x.xlsx'), e => e.code === 'MODEL_SIGNATURE_MISMATCH', breakFormula);
  }
});

test('uzlaştırma: Excel önbelleği yeniden hesapla tutmazsa reddedilir', () => {
  assert.throws(() => model.parseWorkbookBuffer(fixture.buildEndeksmatikWorkbook({ cacheOffset: 0.001 }), 'x.xlsx'),
    e => e.code === 'MODEL_RECONCILE_MISMATCH' && e.details.checks.some(c => !c.ok && c.cell === 'C15'));
  // Üst seviye seçimi ("(Tümü)") ile kaydedilmiş ekran da uzlaşır.
  const snap = model.parseWorkbookBuffer(fixture.buildEndeksmatikWorkbook({ selection: ['CUW4', 'CU4E', '', '', ''] }), 'x.xlsx');
  assert.equal(snap.validation.reconciliation.level, 2);
});

test('kur tablosu yoksa ya da sayfa eksikse açık hata', () => {
  assert.throws(() => model.parseWorkbookBuffer(fixture.buildEndeksmatikWorkbook({ withoutFx: true }), 'x.xlsx'), e => e.code === 'SHEET_MISSING');
});

test('SING OFF karar mantığı', () => {
  const d = model.singOffDecision({ idealPrice: 3, ederCost: 2.8, ederIndex: 0.05, supplierOffer: 3.1, competitorOffer: 0, trPriceTry: 200, trFx: 40 });
  close(d.eder, 2.94);
  assert.deepEqual(d.lowest, { source: 'eder', price: 2.94 });
  close(d.trPriceUsd, 5);
  close(d.fobAdvantage, 1 - 2.94 / 5);
  close(d.landedAdvantage, 1 - 2.94 * 1.08 / 5);
  close(d.requiredPrice, 0.73 * 5 / 1.08);
  assert.equal(d.decision, 'OVERSEAS');
  assert.equal(model.singOffDecision({ overseasPrice: 4.8, trPriceUsd: 5 }).decision, 'DOMESTIC');
  assert.equal(model.singOffDecision({ overseasPrice: 4, trPriceUsd: 5 }).decision, 'BELOW_TARGET');
  assert.equal(model.singOffDecision({ overseasPrice: 4 }).decision, 'NO_TR_PRICE');
});

test('hesap içinde SING OFF: ideal fiyat + TR depo ayı kuru', () => {
  const snap = model.parseWorkbookBuffer(fixture.buildEndeksmatikWorkbook(), 'x.xlsx');
  const r = model.calculate(snap, { ...detail, previousOrderMonth: '202507', newOrderMonth: '202607', newInStoreMonth: '202702', previousUsdPrice: 2.75, singOff: { trPriceTry: 250, supplierOffer: 3.5 } });
  close(r.singOff.ideal, r.prices.usd);
  assert.equal(r.singOff.trMonth, '202702');
  close(r.singOff.trPriceUsd, 250 / snap.fx.TRY['202702']);
  close(r.singOff.eder ?? 0, 0);
});

test('set deposu: yükle, listele, seç, yeniden adlandır, sil; eski şablon yaşar', async () => {
  const before = engine.publicStatus();
  assert.equal(before.activeSetId, 'legacy');
  const legacyResult = engine.calculate({ mmyg: 'CUW4', mag: 'CU4E', buyingGroup: 'LİSANS', category: 'KEY ORME BODY K.KOL-LİSANS', previousOrderMonth: '202507', previousInStoreMonth: '202602', newOrderMonth: '202607', newInStoreMonth: '202702', previousUsdPrice: 2.75 });
  assert.equal(legacyResult.source.setId, 'legacy');

  const bd = await engine.importWorkbookBuffer(fixture.buildEndeksmatikWorkbook(), 'ENDEKSMATIK BANGLADES.xlsx', { actor: 'tester' });
  assert.equal(bd.model, model.MODEL_ID);
  assert.equal(bd.activeSetId, bd.uploaded.id);
  assert.equal(bd.uploadedBy, 'tester');
  const cn = await engine.importWorkbookBuffer(fixture.buildEndeksmatikWorkbook({ adjustment: 0.05 }), 'ENDEKSMATIK CHINA.xlsx');
  assert.notEqual(cn.uploaded.id, bd.uploaded.id);
  const sets = engine.listSets();
  assert.equal(sets.length, 3);
  assert.equal(sets[sets.length - 1].id, 'legacy');

  // Varsayılan: son yüklenen; setId ile başka set seçilebilir.
  const months = { previousOrderMonth: '202507', newOrderMonth: '202607' };
  close(engine.calculate({ ...detail, ...months }).indexes.adjustmentPct, 5);
  close(engine.calculate({ ...detail, ...months, setId: bd.uploaded.id }).indexes.adjustmentPct, 3);
  await engine.setActiveSet(bd.uploaded.id);
  assert.equal(engine.publicStatus().activeSetId, bd.uploaded.id);
  assert.equal(engine.lookup({ ...detail, supplyGroup: '', category: 'SWEATSHIRT' }).supplyGroups.length, 2);

  const renamed = await engine.renameSet(bd.uploaded.id, 'BD SS27 v2');
  assert.equal(renamed.label, 'BD SS27 v2');
  assert.equal(engine.listSets().find(s => s.id === bd.uploaded.id).label, 'BD SS27 v2');

  const afterDelete = await engine.deleteSet(bd.uploaded.id);
  assert.equal(afterDelete.activeSetId, cn.uploaded.id, 'silinen varsayılanın yerine en yeni set geçer');
  assert.throws(() => engine.calculate({ ...detail, ...months, setId: bd.uploaded.id }), e => e.code === 'SET_NOT_FOUND');
  await engine.setActiveSet('legacy');
  assert.equal(engine.calculate(legacyResult.months && { mmyg: 'CUW4', mag: 'CU4E', buyingGroup: 'LİSANS', category: 'KEY ORME BODY K.KOL-LİSANS', previousOrderMonth: '202507', previousInStoreMonth: '202602', newOrderMonth: '202607', newInStoreMonth: '202702' }).source.setId, 'legacy');
});

test('imzası tutmayan USD kitabı eski şablon ayrıştırıcısıyla "bir şekilde" okunmaz', async () => {
  await assert.rejects(() => engine.importWorkbookBuffer(fixture.buildEndeksmatikWorkbook({ breakFormula: 'depot' }), 'bozuk.xlsx'), e => e.code === 'MODEL_SIGNATURE_MISMATCH');
});

test.after(() => { try { fs.rmSync(DATA_ROOT, { recursive: true, force: true }); } catch (_) {} });
