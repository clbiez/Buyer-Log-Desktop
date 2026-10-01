'use strict';

/* Ana renk ön+arka model görseli, alt renkler Options görseli.

   Canlı CoreNectum kanıtı (ANDY-YI, PLM 2129219, styleId 2526693):
   - GetStyleList.colors = J0G, Q6K, RQL; ana renk Q6K ikinci sırada, PLM ana
     rengi hiçbir alanla bildirmiyor.
   - GetStyleList.imageUrl = isDefault Style Image (b7c38f…) = ön+arka.
   - Options görselleri renk kodlu ama yalnız ön görünüş.
   Kural: elle seçim > PLM tek renk > Koleksiyon grup başı > eski auto. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mainColour = require('../server/lib/plm-main-colour');
const ingestLib = require('../server/lib/plm-image-ingest');
const api = require('../server/lib/corenectum-style-api');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server', 'server.js'), 'utf8');
const sync = fs.readFileSync(path.join(root, 'server', 'lib', 'plm-image-sync-service.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'app-main.js'), 'utf8');

const ATT = 'https://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/Attachment/GetAttachment/';
const ANDY_LIST = { data: { coreNectumResultData: { styleListResult: [{
  styleId: 2526693, styleName: 'ANDY-Yİ', plmCode: 2129219,
  colors: [
    { id: 4369942, name: 'LIGHT BLUE', hexCode: '#0077A8', colorCode: 'J0G' },
    { id: 4369943, name: 'BUXE WHITE', hexCode: '#ffffff', colorCode: 'Q6K' },
    { id: 4369944, name: 'BLACK', hexCode: '#191d1b', colorCode: 'RQL' },
  ],
  imageUrl: `${ATT}b7c38f53b2de57dc3a5675d9fb3abdd7`,
}] } } };
const ANDY_IMAGES = { data: { coreNectumResultData: {
  styleImages: { StyleImages: [
    { attachmentAssociationId: 9642421, imageType: 'Style Image', isDefault: true, imageUrl: `${ATT}b7c38f53b2de57dc3a5675d9fb3abdd7` },
    { attachmentAssociationId: 9642420, imageType: 'Style Image', isDefault: false, imageUrl: `${ATT}fdf8c6e87ddd07f5c14bc7477b3ff4f6` },
    { attachmentAssociationId: 9642419, imageType: 'Style Image', isDefault: false, imageUrl: `${ATT}a557779ef9d78b9dc9908ff4f2008ad0` },
  ] },
  styleOptionImages: { OptionImages: [
    { styleOptionId: 4369942, styleOptionImageId: 9641203, name: 'LIGHT BLUE', colorCode: 'J0G', imageUrl: `${ATT}c716cf9bb72a6aa92984fad5400184e8` },
    { styleOptionId: 4369943, styleOptionImageId: 9641204, name: 'BUXE WHITE', colorCode: 'Q6K', imageUrl: `${ATT}b75fabd2206c7112e4515d82734334bf` },
    { styleOptionId: 4369944, styleOptionImageId: 9641206, name: 'BLACK', colorCode: 'RQL', imageUrl: `${ATT}b75854c9945187b1251b1b243b404464` },
  ] },
} } };

function andyEntry(extra = {}) {
  const store = mainColour.emptyStore();
  mainColour.rememberStyleColours(store, api.styleListRowsByPlm(ANDY_LIST).rows);
  Object.assign(store.models['2129219'], extra);
  return mainColour.entryFor(store, '2129219');
}

function pick(colourCode, role) {
  const parsed = api.parseStyleImages(ANDY_IMAGES);
  const row = api.styleListRowsByPlm(ANDY_LIST).rows.get('2129219');
  return api.selectColourImage({ colourCode, imageRole: role.imageRole, optionImages: parsed.optionImages, styleImages: parsed.styleImages, styleListImageUrl: row.imageUrl });
}

test('GetStyleList renkleri kaydedilir; çok renkli modelde ana renk tahmin edilmez', () => {
  const entry = andyEntry();
  assert.deepEqual(entry.colourCodes, ['J0G', 'Q6K', 'RQL']);
  // CP satırı, Koleksiyon bilgisi ve elle seçim yok: eski davranış (Option önce).
  const role = mainColour.resolveImageRole({ plmId: '2129219', colourCode: 'Q6K' }, { entry });
  assert.equal(role.imageRole, 'auto');
  assert.equal(role.roleProbe, false);
  assert.equal(pick('Q6K', role).sourceType, api.SOURCE_OPTION);
});

test('elle seçilen ana renk ön+arka görseli alır, diğer renkler Options görselini', () => {
  const entry = andyEntry({ mainColourCode: 'Q6K' });
  const main = mainColour.resolveImageRole({ plmId: '2129219', colourCode: 'q6k' }, { entry });
  assert.equal(main.imageRole, 'main');
  const white = pick('Q6K', main);
  assert.equal(white.sourceType, api.SOURCE_STYLE_LIST);
  assert.equal(white.imageUrl, `${ATT}b7c38f53b2de57dc3a5675d9fb3abdd7`);

  const black = mainColour.resolveImageRole({ plmId: '2129219', colourCode: 'RQL', groupRole: 'parent' }, { entry });
  assert.equal(black.imageRole, 'option', 'elle seçim Koleksiyon grup başını ezer');
  assert.equal(black.roleDemote, true);
  assert.equal(pick('RQL', black).sourceIdentity, 'option:4369944:9641206');
});

test('tek renkli PLM modelinde o renk her modülde ana renktir', () => {
  const store = mainColour.emptyStore();
  mainColour.rememberStyleColours(store, [{ plmId: '2122558', colors: [{ colourCode: 'R34' }] }]);
  const entry = mainColour.entryFor(store, '2122558');
  for (const request of [
    { plmId: '2122558', colourCode: 'R34' },
    { plmId: '2122558', colourCode: 'R34', groupRole: 'variant' },
    { plmId: '2122558', colourCode: 'R34', imageRole: 'option' },
  ]) assert.equal(mainColour.resolveImageRole(request, { entry }).imageRole, 'main');
});

test('Koleksiyon grup başı CP/Siparişler için de ana rengi belirler', () => {
  const parents = mainColour.collectionMainColours([
    { plmId: '2129219', colourCode: 'Q6K', modelGroupRole: 'parent' },
    { plmId: '2129219', colourCode: 'RQL', modelGroupRole: 'variant' },
    { plmId: '7', colourCode: 'A', modelGroupRole: 'parent' },
    { plmId: '7', colourCode: 'B', modelGroupRole: 'parent' },
  ]);
  assert.equal(parents.get('2129219'), 'Q6K');
  assert.equal(parents.has('7'), false, 'çelişen grup başları belirsizdir');
  const entry = andyEntry();
  assert.equal(mainColour.resolveImageRole({ plmId: '2129219', colourCode: 'Q6K' }, { entry, collectionMainColour: 'Q6K' }).imageRole, 'main');
  assert.equal(mainColour.resolveImageRole({ plmId: '2129219', colourCode: 'RQL' }, { entry, collectionMainColour: 'Q6K' }).imageRole, 'option');
});

test('çok renkli modelde grupsuz tek satır ana görseli almaz; renkler bilinmiyorsa bir kez doğrulanır', () => {
  const known = mainColour.resolveImageRole({ plmId: '2129219', colourCode: 'RQL', groupRole: 'single', imageRole: 'main' }, { entry: andyEntry() });
  assert.equal(known.imageRole, 'auto');
  assert.equal(known.roleDemote, true);
  const unknown = mainColour.resolveImageRole({ plmId: '2129219', colourCode: 'RQL', groupRole: 'single', imageRole: 'main' }, { entry: {} });
  assert.equal(unknown.imageRole, 'main');
  assert.equal(unknown.roleProbe, true);
  const cp = mainColour.resolveImageRole({ plmId: '2129219', colourCode: 'RQL' }, { entry: {} });
  assert.deepEqual([cp.imageRole, cp.roleProbe], ['auto', true]);
});

test('elle seçim kaldırılabilir ve depo normalize edilir', () => {
  const store = mainColour.emptyStore();
  mainColour.setManualMainColour(store, '02129219', 'Q6K', 'tester');
  assert.equal(store.models['2129219'].mainColourCode, 'Q6K');
  mainColour.setManualMainColour(store, '2129219', '', 'tester');
  assert.equal(store.models['2129219'], undefined);
  assert.throws(() => mainColour.setManualMainColour(store, 'abc', 'Q6K'), /PLM ID/);
});

function fakeOwnership(record) {
  return {
    OWNERSHIP_AUTOMATIC: 'automatic',
    ownershipOf: () => (record ? { state: 'automatic', record } : { state: 'manual', record: null }),
  };
}

test('eski kayıtlar yeni role göre kendini onarır; manuel görsel korunur', () => {
  const optionRec = fakeOwnership({ sourceType: 'OPTION', sourceIdentity: 'option:4369943:9641204' });
  const mainRec = fakeOwnership({ sourceType: 'STYLE_LIST', sourceIdentity: 'stylelist:b7c38f53' });
  const base = { plmId: '2129219', colourCode: 'Q6K' };
  // Ana renk Option ile yazılmış → ön+arka görsele geçer.
  assert.equal(ingestLib.imageRoleNeedsRefresh({ ...base, imageRole: 'main' }, 'ci_1', { ownership: optionRec }), true);
  // Ana renk olmadığı kesinleşen renk geçmişte ön+arka ile yazıldıysa kendi görseline döner.
  assert.equal(ingestLib.imageRoleNeedsRefresh({ ...base, imageRole: 'option', roleDemote: true }, 'ci_1', { ownership: mainRec }), true);
  assert.equal(ingestLib.imageRoleNeedsRefresh({ ...base, imageRole: 'option' }, 'ci_1', { ownership: mainRec }), false);
  // Renkleri bilinmeyen model bir kez doğrulanır.
  assert.equal(ingestLib.imageRoleNeedsRefresh({ ...base, imageRole: 'auto', roleProbe: true }, 'ci_1', { ownership: optionRec }), true);
  assert.equal(ingestLib.imageRoleNeedsRefresh({ ...base, imageRole: 'auto' }, 'ci_1', { ownership: optionRec }), false);
  // Manuel görsel hiçbir rolde yenilenmez.
  const manual = fakeOwnership(null);
  for (const extra of [{ imageRole: 'main' }, { imageRole: 'auto', roleProbe: true }, { imageRole: 'option', roleDemote: true }]) {
    assert.equal(ingestLib.imageRoleNeedsRefresh({ ...base, ...extra }, 'ci_1', { ownership: manual }), false);
  }
});

test('sunucu, senkron ve istemci ana renk çözümüne bağlı', () => {
  assert.match(server, /plmMainColour\.resolveImageRole\(request, \{ entry, collectionMainColour/);
  assert.match(server, /onStyleRows: rows => \{ if \(plmMainColour\.rememberStyleColours\(store, rows\)\)/);
  assert.match(server, /const mainColourRoles=plmMainColourRoles\(req\.currentUser\.id,requests\);/);
  assert.match(server, /resolveImageRole: \(item, row\) => resolve\(item,/);
  assert.match(server, /\.\.\.mainColourRoles,\n\s+downloadImage:/);
  assert.match(server, /app\.post\('\/api\/plm-main-colours', userAccess\.requireAnyArea\('koleksiyon'\)/);
  assert.match(sync, /input\.onStyleRows\(resolution\.rows\)/);
  assert.match(sync, /imageRole = input\.resolveImageRole\(item, row\) \|\| imageRole/);
  assert.match(app, /onMainColour:normalizePlmLinkId\(row\.plmId\)&&norm\(row\.colourCode\)\?\(\)=>kolSetPlmMainColour\(row\)/);
  assert.match(app, /function openImageDeleteConfirm\(anchorEl,\{message,onConfirm,onFetch,onMainColour\}=\{\}\)/);
});
