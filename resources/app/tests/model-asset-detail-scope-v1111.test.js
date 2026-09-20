'use strict';

/* ALT DETAY MODEL GÖRSELİ KAPSAMI VE BAYAT MANUEL KORUMA — v11.11
 *
 * Korunan regresyonlar:
 *
 *  A) Satır VAR, görsel YOK  → "bu görünümde model görseli yok" DEĞİL.
 *     Eylemin amacı tam da eksik görselleri tamamlamaktır; kapsamı mevcut
 *     görsele bağlamak eylemi hiç açılmaz hâle getiriyordu.
 *
 *  B) Satır VAR, bazılarında görsel var → kapsam yine tam satır kümesidir.
 *
 *  C) Sahiplik kaydı "manuel" diyor ama referans edilen DOSYA YOK → model
 *     eksik sayılır ve ASAS/PLM görseli ekleyebilir. Bayat kayıt bir modeli
 *     sonsuza dek bloklayamaz.
 *
 *  D) Gerçek ve okunabilir manuel görsel → koruma AYNEN sürer.
 *
 *  E) PLM ID taşımayan alt detay kimliği (OAB "Option Adı", LFL "MODEL ADI")
 *     düşürülmez; model adıyla taşınır ve tekilleştirilir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const createModelAssetScope = require(path.join(ROOT, 'public/model-asset-scope.js'));
const distributionLib = require(path.join(ROOT, 'server/lib/model-image-distribution.js'));
const ownershipLib = require(path.join(ROOT, 'server/lib/plm-image-ownership.js'));
const sharedImageStore = require(path.join(ROOT, 'server/lib/shared-image-store.js'));

const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const OAB = fs.readFileSync(path.join(ROOT, 'public', 'oab.js'), 'utf8');
const LFL = fs.readFileSync(path.join(ROOT, 'public', 'lfl.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');

const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(128, 3)]);

/* ---- A / B / E: kapsam sözleşmesi ------------------------------------- */

function scopeWith(identities) {
  // Modül tek bir kayıt defteri döndürür (factory değil); aynı ad her testte
  // yeniden kaydedilir.
  const api = createModelAssetScope;
  api.registerProvider('detail-view', {
    priority: 10,
    isActive: () => true,
    resolve: () => ({ contextType: 'detail-view', viewToken: 'v1', label: 'Alt detay', identities, selectedIdentities: [] }),
  });
  return api.currentScope();
}

test('A · satırlar var ama hiçbirinde görsel yok → kapsam BOŞ DEĞİL', () => {
  const scope = scopeWith([
    { styleName: 'PNT,GALATA-6', colourCode: 'HFB', hasImage: false },
    { styleName: 'PNT,MINE-111', colourCode: 'Q6K', hasImage: false },
  ]);
  assert.ok(scope, 'sağlayıcı etkinken kapsam çözülmeli');
  assert.equal(scope.identities.length, 2, 'görseli olmayan satırlar da kapsamdadır');
});

test('B · bazı satırlarda görsel varken kapsam yine TÜM satırlardır', () => {
  const scope = scopeWith([
    { styleName: 'PNT,GALATA-6', colourCode: 'HFB', hasImage: true },
    { styleName: 'PNT,MINE-111', colourCode: 'Q6K', hasImage: false },
    { plmId: '1202929', colourCode: 'FFS', hasImage: true },
  ]);
  assert.equal(scope.identities.length, 3);
  assert.equal(scope.identities.filter(item => item.hasImage === false).length, 1);
});

test('E · PLM ID olmayan kimlik model adıyla taşınır ve tekilleşir', () => {
  const scope = scopeWith([
    { styleName: 'PNT,GALATA-6', colourCode: 'HFB' },
    { styleName: 'pnt,galata-6', colourCode: 'hfb' },
    { styleName: 'PNT,GALATA-6', colourCode: 'Q6K' },
    { styleName: '', colourCode: 'Q6K' },
  ]);
  assert.equal(scope.identities.length, 2, 'aynı ad+renk tek kimliktir, adsız satır kimlik üretmez');
  assert.equal(scope.identities[0].plmId, '', 'uydurma PLM ID üretilmez');
  assert.equal(scope.identities[0].styleName, 'PNT,GALATA-6');
});

test('kimlik hiç yoksa kapsam GERÇEKTEN boştur', () => {
  const scope = scopeWith([{ colourCode: 'HFB' }, { colourCode: 'Q6K' }]);
  assert.equal(scope.identities.length, 0, 'ne PLM ID ne model adı varsa kimlik yoktur');
});

/* ---- C / D: manuel koruma gerçeğe bakar -------------------------------- */

function createPlanner() {
  const files = new Map();
  let store = ownershipLib.emptyStore();
  const sharedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-stale-'));
  const distribution = distributionLib.createModelImageDistribution({
    sharedStore: sharedImageStore.createSharedImageStore({ getSharedSyncRoot: async () => null, getDeviceId: () => 'devTest' }),
    ownership: { ...ownershipLib, loadOwnership: () => store, saveOwnership: value => { store = value; return value; } },
    readState: () => distributionLib.emptyState(),
    writeState: value => value,
    getImage: ref => (files.has(ref) ? { item: { id: ref, url: `/api/collection-images/${ref}`, mimeType: 'image/jpeg' }, full: ref } : null),
    readImageBytes: found => files.get(found.item.id),
    saveImage: payload => {
      const id = `ci_${crypto.randomBytes(4).toString('hex')}`;
      files.set(id, Buffer.from(payload.base64, 'base64'));
      return { id, url: `/api/collection-images/${id}`, mimeType: payload.mimeType, size: files.get(id).length };
    },
  });
  return { distribution, files, sharedRoot, get store() { return store; }, set store(value) { store = value; } };
}

test('C · kayıt "manuel" ama DOSYA YOK → model eksiktir, ASAS görsel ekleyebilir', async () => {
  const harness = createPlanner();
  // Kayıt bir referansa işaret ediyor; sahiplik deposu onu tanımıyor (eski
  // sürümlerden kalan kayıt) → eski kural bunu "manuel" sayıp blokluyordu.
  const imagemap = { 'plm:1202929': 'ci_silinmis' };
  const plan = await harness.distribution.plan(
    [{ plmId: '1202929', colourCode: '', colour: '' }],
    { source: 'ASAS', mode: 'missing', imagemap, store: harness.store },
  );
  assert.equal(plan.counts.manualProtected, 0, 'ölü referans koruma üretmemeli');
  assert.equal(plan.counts.staleProtectionCleared, 1, 'bayat koruma ayrıca raporlanmalı');
  assert.equal(plan.counts.remoteRequired, 1, 'model üst kaynağa çıkabilmeli');
});

test('D · gerçek ve okunabilir manuel görsel KORUNUR', async () => {
  const harness = createPlanner();
  harness.files.set('ci_gercek', JPEG);
  const imagemap = { 'plm:1202929': 'ci_gercek' };
  const plan = await harness.distribution.plan(
    [{ plmId: '1202929', colourCode: '', colour: '' }],
    { source: 'ASAS', mode: 'all', imagemap, store: harness.store },
  );
  assert.equal(plan.counts.manualProtected, 1, 'dosyası duran manuel görsel korunmalı');
  assert.equal(plan.counts.staleProtectionCleared, 0);
  assert.equal(plan.counts.remoteRequired, 0, 'manuel görselin üzerine yazılmamalı');
});

test('D2 · kullanıcı AÇIKÇA üzerine yazmayı seçerse manuel koruma aşılır', async () => {
  const harness = createPlanner();
  harness.files.set('ci_gercek', JPEG);
  const imagemap = { 'plm:1202929': 'ci_gercek' };
  const plan = await harness.distribution.plan(
    [{ plmId: '1202929', colourCode: '', colour: '' }],
    { source: 'ASAS', mode: 'all', imagemap, store: harness.store, overwriteManual: true },
  );
  assert.equal(plan.counts.manualProtected, 0);
  assert.equal(plan.counts.remoteRequired, 1);
});

/* ---- Kaynak sözleşmesi: ortak katman, modül başına kopya yok ---------- */

test('alt detay ekranları ORTAK kapsam kaydını kullanır', () => {
  assert.match(APP, /function registerModelAssetScopeHost\(host,\{identities,repaint,label,contextType\}=\{\}\)/);
  assert.match(APP, /function modelAssetIdentityMissing\(item\)/);
  // "Eksik" kararı tek yerdedir; kopya filtre bırakılmaz.
  assert.match(APP, /\? operation\.identities\.filter\(modelAssetIdentityMissing\)/);
  assert.match(APP, /const missing=scope\.identities\.filter\(modelAssetIdentityMissing\)\.length;/);
  assert.match(OAB, /BLDetailImages\.registerScope\(modal\.querySelector\('\.autoModal'\)/);
  assert.match(LFL, /function lflRegisterModelAssetScope\(panel,rows,label,repaint,imageIndex\)/);
});

test('seçici kapısı GÖRSEL sayısına değil KİMLİK sayısına bakar', () => {
  const at = APP.indexOf('function openModelImageSourceChooser(button)');
  assert.ok(at > -1);
  const head = APP.slice(at, at + 900);
  assert.match(head, /if\(!scope\|\|!scope\.identities\.length\)\{/);
  assert.match(head, /No model could be identified in this view\./);
  assert.ok(!/canonicalModelImageKnown[^]{0,200}return;/.test(head), 'kapı mevcut görsele bakmamalı');
});

test('PLM ID taşımayan kalem sunucuda model adından çözülür, sessizce düşmez', () => {
  assert.match(SERVER, /function resolveModelImageItemIdentities\(rawItems/);
  assert.match(SERVER, /MODEL_PLM_ID_UNRESOLVED/);
  // PLM, ASAS ve on-demand Shared hydrate aynı kanonik identity çözümünü kullanır.
  const calls = SERVER.match(/resolveModelImageItemIdentities\(raw,/g) || [];
  assert.equal(calls.length, 3);
  const shared = SERVER.slice(SERVER.indexOf("app.post('/api/model-images/shared/hydrate'"), SERVER.indexOf("app.put('/api/model-images/settings'"));
  assert.match(shared, /resolveModelImageItemIdentities\(raw,/);
});
