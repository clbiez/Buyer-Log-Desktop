'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const CONNECTOR = fs.readFileSync(path.join(root, 'server/lib/agent-browser-connector.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(root, 'server/server.js'), 'utf8');
const APP = fs.readFileSync(path.join(root, 'public/app-main.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const connector = require('../server/lib/agent-browser-connector');

test('CoreNectum sync reads the Style List Image cell with an authenticated-page fallback', () => {
  assert.match(CONNECTOR, /async function coreNectumStyleListRowImage/);
  assert.match(CONNECTOR, /fetch\(src,\{credentials:'include'/);
  assert.match(CONNECTOR, /Page\.captureScreenshot/);
  assert.match(CONNECTOR, /cdk-overlay-container img/);
  assert.match(CONNECTOR, /imageFailed\.push/);
});

test('Style List Image capture falls back to a clipped PNG instead of a full-page screenshot', async () => {
  const calls = [];
  const page = {
    _evaluateValue: async () => ({ clip:{ x: 20, y: 40, width: 300, height: 360 } }),
    client: { send: async (method, params) => { calls.push({ method, params }); return { data: 'cG5n' }; } },
  };
  const image = await connector.coreNectumStyleListRowImage(page, '2108736', 1000);
  assert.equal(image.mimeType, 'image/png');
  assert.equal(image.base64, 'cG5n');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'Page.captureScreenshot');
  assert.deepEqual(calls[0].params.clip, { x: 20, y: 40, width: 300, height: 360, scale: 3 });
});

test('v6.07 downloaded images are stored as files and linked by PLM without replacing colour-specific images', () => {
  const syncRoute = SERVER.slice(SERVER.indexOf("app.post('/api/plm-style-links/sync'"), SERVER.indexOf('\n\nfunction currentUserIsModerator'));
  assert.match(syncRoute, /saveCollectionImage/);
  assert.match(syncRoute, /parseLib\.plmImageKey/);
  assert.match(syncRoute, /patchPlmImageLinks/);
  assert.match(syncRoute, /deleteCollectionImage/);
  assert.match(syncRoute, /imagesSaved/);
  assert.doesNotMatch(syncRoute, /colourCode:\s*[^'\"]+imageRef/);
});

/* Kullanıcı kararı: ayrı "Model Linklerini PLM'den Al" ve "Model Görsellerini
   Güncelle" Araçlar komutları KALDIRILDI. Üç ekranda da tek bir PLM Sync
   düğmesi var; link ve görsel aynı fetch/refresh komutunun içinde alınır. */
/* v11.10 — v6.07'nin "tek düğme" kararı kullanıcı tarafından geri alındı:
   link ve görsel komutları BAĞIMSIZ çalışır. Korunan regresyon, o sürümde
   kaldırılan ESKİ AYRI UYGULAMALARIN (kendi tarama/indirme yollarıyla)
   geri gelmemesi ve ortak alt seviyenin tek kalmasıdır. */
test('link ve görsel komutları bağımsızdır ama ORTAK alt seviyeyi paylaşır', () => {
  for (const prefix of ['cp','orders','kol']) {
    assert.match(INDEX, new RegExp(`id="${prefix}PlmSyncBtn"`));
    assert.doesNotMatch(INDEX, new RegExp(`id="${prefix}PlmLinksBtn"`));
  }
  // Zincirleyen tek komut kaldırıldı.
  assert.doesNotMatch(APP, /async function plmAssetsSync\(source,mode,button/);
  assert.match(APP, /async function updateModelLinks\(mode,button/);
  assert.match(APP, /async function updateModelImages\(\{source=MODEL_ASSET_SOURCE_PLM/);
  // Koleksiyon: link fetch yanıtıyla gelir (ikinci tarama yok), görsel ayrı adımda.
  assert.match(APP, /if\(fetchResult\.styleLinks\)applyPlmStyleLinksPayload\(fetchResult\.styleLinks\)/);
  assert.match(APP, /async function kolPlmSyncImageStep\(mode,button\)/);
  assert.match(APP, /data-image-mode="all"/);
  assert.match(APP, /data-image-mode="missing"/);
  assert.match(APP, /function applySyncedPlmImages/);
});
