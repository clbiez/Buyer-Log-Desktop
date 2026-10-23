'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-user-sources-v292-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server-data');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app-data');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local-data');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');

const db = require('../server/db');
const access = require('../server/lib/user-access');
const server = require('./helpers/server-source')();
const accessUi = fs.readFileSync(path.join(__dirname, '../public/user-access-ui.js'), 'utf8');
const userStorage = fs.readFileSync(path.join(__dirname, '../public/user-storage.js'), 'utf8');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function sourceOrder(buyer, extras = {}) {
  return {
    buyer,
    merch: extras.merch || 'MAG-A',
    ageGroup: extras.ageGroup || 'MMYG-A',
    buyerGrup: extras.buyerGrup || 'GROUP-A',
  };
}

function routeOpening(method, route) {
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`app\\.${method}\\('${escaped}'[^\\n]*`);
  const match = server.match(re);
  assert.ok(match, `${method.toUpperCase()} ${route} route should exist`);
  return match[0];
}

test('source folders are persisted independently for Moderator and each Buyer', () => {
  db.setUserSourceFolder('moderator', 'M:/Moderator Sources');
  db.setUserSourceFolder('buyer-a', 'B:/Buyer A Sources');
  db.setUserSourceFolder('buyer-b', 'C:/Buyer B Sources');

  assert.equal(db.getUserSourceFolder('moderator'), 'M:/Moderator Sources');
  assert.equal(db.getUserSourceFolder('buyer-a'), 'B:/Buyer A Sources');
  assert.equal(db.getUserSourceFolder('buyer-b'), 'C:/Buyer B Sources');
  assert.equal(db.getUserSourceFolder('unknown-user'), null);
});

test('Refresh history stays user-scoped while FX is one shared business master', () => {
  // v6.53 — Fabric izolasyonu buradan çıkarıldı: db.saveFabricInfo/loadFabricInfo
  // artık kod tabanında yok (ayrı Fabric kaynağı v4.72'de tamamen kaldırıldı,
  // bkz. fabric-source-v286.test.js'teki not). refreshHistory ve Fx izolasyonu
  // hâlâ geçerli ve doğrulanmaya devam ediyor. FX ise v7.74'ten itibaren
  // kullanıcı tercihi değildir; herkes aynı kanonik kuru görür.
  const moderatorHistory = db.addRefreshHistory({ details: [{ source: 'ASAS', ocode: '100' }] }, 'moderator');
  const buyerHistory = db.addRefreshHistory({ details: [{ source: 'ANTREPO', ocode: '200' }] }, 'buyer-a');
  assert.deepEqual(db.loadRefreshHistory('moderator').items.map(item => item.id), [moderatorHistory.id]);
  assert.deepEqual(db.loadRefreshHistory('buyer-a').items.map(item => item.id), [buyerHistory.id]);
  assert.equal(db.loadRefreshHistory('buyer-b').items.length, 0);

  const first = db.saveFx({ base: 'USD', currencies: ['EUR'], months: { '2026-07': { EUR: 0.9 } } }, 0, 'moderator');
  assert.deepEqual(db.loadFx('buyer-a').currencies, ['EUR']);
  const second = db.saveFx({ base: 'USD', currencies: ['GBP'], months: { '2026-07': { GBP: 0.8 } } }, first._revision, 'buyer-a');
  assert.deepEqual(db.loadFx('moderator').currencies, ['GBP']);
  assert.deepEqual(db.loadFx('buyer-b').currencies, ['GBP']);
  assert.equal(db.loadFx('buyer-b')._revision, second._revision);
});

test('Buyer-controlled source data cannot create users, scopes or order-edit authority', () => {
  const first = access.syncProfiles([{ ocode: 900, ...sourceOrder('Buyer A') }], { authoritative: true });
  // v6.53 — testin ADI zaten "cannot create users" diyordu; GÖVDESİ ise
  // (users.length===1 bekleyerek) tam TERSİNİ sınıyordu — yarım kalmış bir
  // yeniden adlandırmanın izi. Güncel syncProfiles yalnız orderAccess'i
  // senkronlar, kaynak veriden OTOMATİK KULLANICI OLUŞTURMAZ (bilinçli
  // güvenlik kararı); assertion artık testin kendi adıyla tutarlı.
  assert.equal(first.users.length, 0);
  assert.equal(first.orderAccess['900'][0].buyer, 'Buyer A');

  const afterBuyerSource = access.syncProfiles([{ ocode: 900, ...sourceOrder('Buyer B', { merch: 'MAG-B' }) }], { authoritative: false });
  assert.equal(afterBuyerSource.users.length, 0);
  assert.equal(afterBuyerSource.orderAccess['900'][0].buyer, 'Buyer A');

  const runtimeAccess = access.buildUserAccess({ ensureDataLoaded: async () => {}, getOrders: () => [] });
  assert.equal(runtimeAccess.authoritativeOrderRows(900)[0].buyer, 'Buyer A');
});

test('requested source operations are available to Buyer sessions and use per-user runtime state', () => {
  // v6.53 — '/api/fabric/refresh' listeden çıkarıldı: uç kod tabanında artık
  // yok (ayrı Fabric kaynağı v4.72'de kaldırıldı). Diğer beş rota hâlâ geçerli.
  for (const [method, route] of [
    ['post', '/api/refresh'],
    ['post', '/api/lfl/refresh'],
    ['post', '/api/choose-folder'],
    ['put', '/api/fx'],
    ['delete', '/api/refresh-history/:id'],
  ]) {
    assert.doesNotMatch(routeOpening(method, route), /requireModerator/);
  }

  assert.match(server, /const sourceCaches = new Map\(\)/);
  assert.match(server, /const initialDataLoadPromises = new Map\(\)/);
  assert.match(server, /getUserSourceFolder\(id,/);
  assert.match(server, /cpupdateOverrides: \{ submap: \{\}, suppfobmap: \{\}, suppfobmetamap: \{\} \}/);
  assert.match(server, /effectiveOverridesForUser\(id\)/);
  assert.doesNotMatch(server, /mergeCpUpdateOverrides\(result\)/);
  assert.match(server, /loadRefreshHistory\(id\)/);
  // FX remains shared; only the last folder-sync status is added to the response.
  assert.match(server, /res\.json\(\{\.\.\.loadFx\(\),folderSync:deps\.getFolderFxSyncStatus\?\.\(\)\|\|null\}\)/);
  assert.match(server, /saveFx\(req\.body \|\| \{\}, requestRevision\(req\)\)/);
  assert.match(server, /deleteRefreshHistory\(req\.params\.id, requestRevision\(req\), sourceUserId\(req\)\)/);
  assert.match(server, /userAccess\.authoritativeOrderRows\(code\)/);
});

test('source controls are not hidden from Buyers and browser FX storage is only an offline cache', () => {
  const blockStart = accessUi.indexOf('const moderatorOnlyIds');
  const blockEnd = accessUi.indexOf('];', blockStart);
  const moderatorOnlyBlock = accessUi.slice(blockStart, blockEnd + 2);
  for (const id of ['serverRefreshBtn', 'fabricRefreshBtn', 'lflRefreshBtn', 'chooseFolderBtn', 'sourceRefreshHistoryBtn', 'btnSourceFx', 'ocFxBtn']) {
    assert.doesNotMatch(moderatorOnlyBlock, new RegExp(id));
  }
  assert.match(userStorage, /buyerlog\.fx\.persist\.v1/);
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.doesNotMatch(html, /Only the Moderator can refresh source files|Kaynak dosyalarını yalnız Moderatör yenileyebilir/);
});
