'use strict';

// Endeksmatik Setleri: hedef düzeltme % set başına ORTAK ayardır ve kayıtlı
// Koleksiyon hesabı modalda silinebilir.
//
// Korunan kararlar:
//  · Ortak ayar set kimliğine bağlıdır; dosyanın orijinal değeri ayrıca korunur.
//  · İstek düzeltme göndermezse sunucu ortak ayara düşer; açık değer daima kazanır.
//  · Boş/null ayar dosya değerine döner; aralık dışı değer reddedilir.
//  · Eski TL şablonu ('legacy') için de aynı ayar çalışır.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-endeksmatik-adj-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = DATA_ROOT;

const fixture = require('./helpers/endeksmatik-fixture');
const engine = require('../server/lib/endeksmatik');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const detail = { mmyg: 'CUW4', mag: 'CU4E', supplyGroup: 'ÖRME', buyingGroup: 'LİSANS', category: 'KEY ORME BODY' };
const months = { previousOrderMonth: '202507', newOrderMonth: '202607' };

test('ortak hedef düzeltme: set başına kaydedilir, hesap ve durum onu kullanır, sıfırlanabilir', async () => {
  const bd = await engine.importWorkbookBuffer(fixture.buildEndeksmatikWorkbook(), 'ENDEKSMATIK BANGLADES.xlsx', { actor: 'tester' });
  const id = bd.uploaded.id;
  let meta = engine.listSets().find(s => s.id === id);
  close(meta.targetAdjustmentPct, 3);
  assert.equal(meta.targetAdjustmentSource, 'workbook');

  const status = await engine.setTargetAdjustment(id, 2, 'Moderatör');
  meta = status.sets.find(s => s.id === id);
  close(meta.targetAdjustmentPct, 2);
  close(meta.workbookTargetAdjustmentPct, 3);
  assert.equal(meta.targetAdjustmentSource, 'shared');
  assert.equal(meta.targetAdjustmentUpdatedBy, 'Moderatör');
  close(status.targetAdjustmentPct, 2); // aktif set durumu ortak değeri taşır

  close(engine.calculate({ ...detail, ...months, setId: id }).indexes.adjustmentPct, 2);
  close(engine.calculate({ ...detail, ...months, setId: id, adjustmentPct: 7 }).indexes.adjustmentPct, 7); // açık değer ortak ayarı ezer
  close(engine.calculate({ ...detail, ...months, setId: id, adjustmentPct: '' }).indexes.adjustmentPct, 2);

  // Ayar diske (ortak klasör/legacy yazım) yazılır; önbellekten bağımsız okunur.
  const stored = JSON.parse(fs.readFileSync(path.join(engine.SETS_DIR, 'adjustments.json'), 'utf8'));
  close(stored[id].pct, 2);

  await assert.rejects(() => engine.setTargetAdjustment(id, 150), e => e.code === 'VALIDATION_ERROR');
  await assert.rejects(() => engine.setTargetAdjustment(id, 'abc'), e => e.code === 'VALIDATION_ERROR');
  await assert.rejects(() => engine.setTargetAdjustment('em-0000000000000000', 1), e => e.code === 'SET_NOT_FOUND');

  const reset = await engine.setTargetAdjustment(id, null);
  meta = reset.sets.find(s => s.id === id);
  close(meta.targetAdjustmentPct, 3);
  assert.equal(meta.targetAdjustmentSource, 'workbook');
  close(engine.calculate({ ...detail, ...months, setId: id }).indexes.adjustmentPct, 3);
});

test('eski TL şablonu için de ortak düzeltme çalışır', async () => {
  await engine.setActiveSet('legacy');
  const status = await engine.setTargetAdjustment('legacy', '1,5');
  close(status.targetAdjustmentPct, 1.5);
  assert.equal(status.sets.find(s => s.id === 'legacy').targetAdjustmentSource, 'shared');
  const result = engine.calculate({ mmyg: 'CUW4', mag: 'CU4E', buyingGroup: 'LİSANS', category: 'KEY ORME BODY K.KOL-LİSANS', previousOrderMonth: '202507', previousInStoreMonth: '202602', newOrderMonth: '202607', newInStoreMonth: '202702', previousUsdPrice: 2.75, setId: 'legacy' });
  close(result.indexes.adjustmentPct, 1.5);
  await engine.setTargetAdjustment('legacy', null);
});

test('UI: set yöneticisi ayarı yetkili rotaya yazar; sunucu izni zorlar', () => {
  const at = APP.indexOf('async function openEndeksmatikSetManager()');
  const fn = APP.slice(at, APP.indexOf("document.getElementById('kolEndeksmatikSetsBtn')", at));
  assert.match(fn, /data-em-set-adjustment\$\{canManage\?'':' disabled'\}/);
  assert.match(fn, /\/api\/endeksmatik\/sets\/\$\{encodeURIComponent\(id\)\}\/adjustment`,\{method:'PUT'/);
  assert.match(SERVER, /app\.put\('\/api\/endeksmatik\/sets\/:id\/adjustment', userAccess\.requirePermission\('manageModelConnections'\)/);
  assert.match(SERVER, /publishSharedMasterChange\('endeksmatik', req\);\n    const set = /);
});

test('UI: kayıtlı Koleksiyon hesabı modalda silinir; geri alınabilir ve salt-okurda kapalı', () => {
  assert.match(APP, /hasSavedEndeksmatik\?`<button type="button" class="tbtn danger" data-em-delete-saved\$\{kolWorkspaceCanEdit\?'':' disabled'\}/);
  const at = APP.indexOf("overlay.querySelector('[data-em-delete-saved]')");
  assert.notEqual(at, -1);
  const handler = APP.slice(at, APP.indexOf("overlay.querySelector('[data-em-copy]')", at));
  assert.match(handler, /kolRequireWorkspaceEdit\(\)/);
  assert.match(handler, /window\.confirm\(/);
  assert.match(handler, /kolPushUndo\(\);kolWriteGroupedStorageValue\(current,'endeksmatikData',\{\}\);/);
  assert.match(handler, /saveKolRows\(\);renderKol\(\);close\(\);/);
});

test.after(() => { try { fs.rmSync(DATA_ROOT, { recursive: true, force: true }); } catch (_) {} });
