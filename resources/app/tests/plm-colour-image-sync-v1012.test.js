'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public', 'app-main.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server', 'server.js'), 'utf8');
const connector = require('../server/lib/agent-browser-connector');

test('PLM renk görseli kimliği model ve renk kodunu birlikte taşır', () => {
  assert.equal(connector.coreNectumColourImageKey({ plmId: '2120557', colourCode: 'DWP' }), '2120557\u0000DWP');
  assert.notEqual(
    connector.coreNectumColourImageKey({ plmId: '2120557', colourCode: 'DWP' }),
    connector.coreNectumColourImageKey({ plmId: '2120557', colourCode: 'R34' }),
  );
});

/* v11.00 — "PLM renk görselleri Style Overview Options tablosundan okunur"
   testi emekli edildi. Renk seviyesinde ayrı bir PLM görsel kaynağı artık
   YOKTUR: model görseli yalnız Style List satırından gelir ve görsel alımı
   canlı CoreNectum GetStyleList/GetStyleImages API'sine taşındı. Testin
   sürdüğü Style Overview DOM kazıma yolu (coreNectumStyleOverviewImageRows)
   kaynaktan kaldırıldı. Renk anahtarı davranışı yukarıdaki testte korunuyor. */

test('PLM image requestleri aynı modelin renk satırlarını tekilleştirmez', () => {
  const start = app.indexOf("function modelImageItems(source,imageSource,scope='filtered')");
  const end = app.indexOf('function versionedPlmImageUrl', start);
  const block = app.slice(start, end);
  assert.match(block, /imageSource==='plm'/);
  assert.match(block, /turknorm\(colourCode\)/);
  assert.match(block, /plmId\}\\u0000/);
});

/* v11.00 — aynı sözleşme, kanonik modülde. Renkli istek renk kodu + renk
   adıyla gider; kayıt anahtarı ikisini de taşır; bağlantı yazımı renk
   kimliğini kaybetmez. */
test('sunucu renkli PLM image isteğini ve renk anahtarını korur', () => {
  assert.match(server, /item&&item\.colourCode/);
  assert.match(server, /requests\.push\(\{plmId,colourCode,colour,/);
  const ingest = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'plm-image-ingest.js'), 'utf8');
  assert.match(ingest, /plmColourImageNameKey\(plmId, code, clean\(colour, 160\)\)/);
  assert.match(ingest, /links\.push\(\{ plmId: item\.plmId, colourCode: item\.colourCode, colour: item\.colour, imageRef: [a-zA-Z.]+ \}\)/);
  // Okuma da aynı sırayı izler: isim anahtarı, sonra kod anahtarı.
  assert.match(ingest, /const named = parseLib\.plmColourImageNameKey/);
  assert.match(ingest, /const coded = parseLib\.plmColourImageKey/);
});

test('tek satır görsel çağrısı renk kodu ile gerçek renk adını birlikte gönderir', () => {
  assert.match(app, /async function fetchPlmImageForModel\(\{plmId,colourCode,colour,styleName\}/);
  assert.match(app, /colourCode:requestedColour/);
  assert.match(app, /colour:requestedColourName/);
  assert.match(app, /turknorm\(item&&item\.colour\)===turknorm\(requestedColourName\)/);
});
