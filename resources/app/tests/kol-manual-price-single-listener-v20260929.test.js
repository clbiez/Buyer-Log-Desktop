'use strict';

// Koleksiyonda ✎ (Enter price manually) tek tıklamada pencereyi defalarca
// açıyordu. Neden: renderKol() kalıcı <tbody> üzerine her çizimde YENİ bir
// click dinleyicisi ekliyordu (yalnız innerHTML yenileniyor, element aynı
// kalıyor). N render sonrası tek tık N kez openKolManualPriceModal çağırıyordu.
// Dinleyici artık tbody başına bir kez bağlanır.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

test('elle fiyat düğmesi dinleyicisi tbody başına yalnız bir kez bağlanır', () => {
  const at = APP.indexOf("event.target.closest('[data-kol-manual]')");
  assert.ok(at > 0, 'data-kol-manual delegasyonu bulunamadı');
  const before = APP.slice(Math.max(0, at - 700), at);
  assert.match(before, /if\s*\(\s*!tbody\.__kolManualDelegated\s*\)/,
    'dinleyici tekrar bağlanmaya karşı korunmalı');
  assert.match(before, /tbody\.__kolManualDelegated\s*=\s*true/);
});

test('korumasız tbody click delegasyonu kalmadı', () => {
  // renderKol içinde tbody.addEventListener('click', ...) doğrudan çağrılırsa
  // her render dinleyici biriktirir.
  const at = APP.indexOf("event.target.closest('[data-kol-manual]')");
  const listenerStart = APP.lastIndexOf("tbody.addEventListener('click'", at);
  const guard = APP.lastIndexOf('__kolManualDelegated', at);
  assert.ok(guard > 0 && guard < listenerStart, 'koruma dinleyiciden önce gelmeli');
});

test('modal açıcı yeniden girişe karşı tek pencere tutar', () => {
  const fn = APP.slice(APP.indexOf('async function openKolManualPriceModal'), APP.indexOf("modal.id='_kolManualPrice'"));
  assert.match(fn, /_kolManualPriceOpening/, 'katalog beklenirken ikinci çağrı yeni pencere açmamalı');
});
