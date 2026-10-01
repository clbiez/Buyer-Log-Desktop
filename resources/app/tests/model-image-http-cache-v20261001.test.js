'use strict';

/*
 * Model görselleri geç geliyor, sayfalar arası gidip gelince kaybolup bir süre
 * sonra geri geliyordu.
 *
 * Kök neden: /api ara katmanı her yanıta "Pragma: no-cache" ve "Expires: 0"
 * ekliyor. Görsel rotaları "Cache-Control: private, max-age=31536000,
 * immutable" yazsa da Chromium yanıttaki Pragma: no-cache'i Cache-Control:
 * no-cache gibi yorumlar; her görsel her yeniden çizimde sunucuya
 * doğrulatılıyor ve localhost'un 6 bağlantı sınırında diğer API çağrılarıyla
 * sıraya giriyordu (Playwright Chromium ile ölçüldü: 4 sayfa yüklemesi →
 * eski başlıklarla 4 sunucu isteği, düzeltmeyle 1).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVER = require('./helpers/server-source')();
const CP_ROUTES = fs.readFileSync(path.join(ROOT, 'server', 'routes', 'cp-image-routes.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');

function routeBody(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, signature);
  return source.slice(start, source.indexOf('\n});', start));
}

for (const [name, source, signature] of [
  ['collection-images', SERVER, "app.get('/api/collection-images/:id'"],
  ['cp-images', CP_ROUTES, "app.get('/api/cp-images/:id'"],
]) {
  test(`${name} görsel yanıtı tarayıcı önbelleğinde gerçekten kalır (Pragma/Expires kaldırılır)`, () => {
    const body = routeBody(source, signature);
    assert.match(body, /Cache-Control', 'private, max-age=31536000, immutable'/);
    assert.match(body, /res\.removeHeader\('Pragma'\)/);
    assert.match(body, /res\.removeHeader\('Expires'\)/);
    assert.ok(body.indexOf("removeHeader('Pragma')") < body.indexOf('res.sendFile('), 'başlıklar gönderimden önce temizlenmeli');
  });
}

test('/api ara katmanı Pragma eklemeye devam eder; görsel rotaları ondan SONRA kayıtlıdır', () => {
  const middleware = SERVER.indexOf("app.use('/api', (_req, res, next) => {");
  assert.notEqual(middleware, -1);
  assert.ok(SERVER.indexOf("app.get('/api/collection-images/:id'") > middleware);
});

test('daha önce yüklenmiş tablo görseli yeniden çizimde yer tutucuyla beklemez', () => {
  const start = APP.indexOf('const loadTableImage=img=>{');
  const loadTableImage = APP.slice(start, APP.indexOf('const autoIdentityFromImage=', start));
  assert.match(loadTableImage, /if\(loaded\.has\(src\)\)\{img\.src=src;img\.dataset\.blImageLoaded='1'/);
  assert.match(loadTableImage, /rememberLoaded\(src\)/, 'bağlanan görsel yüklendiğinde hatırlanmalı');
  assert.match(loadTableImage, /img\.currentSrc===absolute\|\|img\.src===absolute/, 'yer tutucunun load olayı sayılmamalı');

  const observeStart = APP.indexOf('const observe=img=>{');
  const observe = APP.slice(observeStart, APP.indexOf('const cancelHover=', observeStart));
  assert.match(observe, /if\(hasSource&&loaded\.has\(key\(img\.dataset\.src\)\)\)\{loadTableImage\(img\);return;\}/);
  assert.ok(observe.indexOf('loaded.has(') < observe.indexOf('observer.observe(img)'));
  assert.match(APP, /MAX_LOADED_KEYS=2048/);
});
