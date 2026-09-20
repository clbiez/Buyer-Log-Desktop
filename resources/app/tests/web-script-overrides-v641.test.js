'use strict';

/* v6.41 — YERLEŞİK WEB BETİKLERİ DÜZENLENEBİLİR.
 *
 * Kullanıcı gerekçesi: "yeri geldiğinde mevcut çalışanları da düzenlemem
 * gerekecek, dış web bağlantılarında çalışma şekli değişebilir."
 *
 * TEMEL GÜVENLİK KURALI: fabrika kodu koddaki yerinde kalır ve override
 * yokken davranış BİREBİR eskisi gibidir. Kullanıcının yazdığı sürüm yalnız üst
 * katmandır; bu yüzden bozuk bir düzenleme kalıcı hasar veremez.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const store = require(path.join(ROOT, 'server', 'lib', 'web-script-store.js'));
const registry = require(path.join(ROOT, 'server', 'lib', 'web-script-registry.js'));
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const CONNECTOR = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'agent-browser-connector.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'public', 'automations.js'), 'utf8');

function bodyOf(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunmalı`);
  let paren = 0, i = source.indexOf('(', start);
  for (; i < source.length; i++) {
    if (source[i] === '(') paren++;
    else if (source[i] === ')' && --paren === 0) break;
  }
  const open = source.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) return source.slice(open + 1, j);
  }
  throw new Error(`${name} ayrıştırılamadı`);
}

/* ---------------------------------------------------------- 1) DOĞRULAMA */

test('v6.41 bozuk betik kaydedilemiyor', () => {
  // Sözdizimi hatalı bir betik kaydedilirse hata ancak dış siteye gidildiğinde
  // ortaya çıkar ve akış SESSİZCE bozulur.
  assert.equal(store.validateCode('return {ok:true};').ok, true);
  assert.equal(store.validateCode('const r = await fetch(params.url); return {ok:r.ok};').ok, true,
    'await kullanan geçerli betik reddedilmemeli');
  const broken = store.validateCode('return {ok:true');
  assert.equal(broken.ok, false);
  assert.equal(broken.code, 'WEB_SCRIPT_SYNTAX_ERROR');
  assert.equal(store.validateCode('   ').code, 'WEB_SCRIPT_EMPTY');
  assert.equal(store.validateCode('x'.repeat(store.MAX_CODE_BYTES + 1)).code, 'WEB_SCRIPT_TOO_LARGE');
});

/* -------------------------------------------- 2) FABRİKA DAVRANIŞI KORUNUYOR */

test('v6.41 override yokken fabrika ifadesi AYNEN dönüyor', () => {
  // Bu testin çivilediği şey en kritik güvence: özellik kapalıyken hiçbir
  // davranış değişmez.
  const out = registry.expressionFor('corenectum.image.fetch', { url: 'x' }, 'FABRIKA_IFADESI');
  assert.equal(out.expression, 'FABRIKA_IFADESI');
  assert.equal(out.source, 'factory');
  // Tanınmayan kimlik de fabrikaya düşmeli, hata fırlatmamalı.
  assert.equal(registry.expressionFor('yok.olan', {}, 'FABRIKA').expression, 'FABRIKA');
});

test('v6.41 bozuk override çalışma zamanında fabrikaya düşüyor', () => {
  // Dış akışın tamamen durması, bozuk bir düzenlemeden daha kötüdür.
  const out = store.resolveCode('__test_missing__', 'FABRIKA');
  assert.equal(out.code, 'FABRIKA');
  assert.equal(out.source, 'factory');
});

test('v6.41 fabrika kodu koddaki yerinde duruyor', () => {
  // Fabrika üreticileri silinmiş olsaydı "Varsayılana dön" çalışmazdı.
  // v11.00: coreNectumImageOptimizeExpression kaldırıldı — indirme+küçültme tek
  // ifadeye birleşti, ayrı optimize fabrikası kalmadı.
  for (const name of ['coreNectumImageFetchExpression', 'umbrellaQtxDownloadExpression']) {
    assert.ok(CONNECTOR.includes(`function ${name}(`), `${name} korunmalı`);
  }
});

/* ------------------------------------------------- 3) ÇALIŞMA ZAMANI BAĞLANTISI */

test('v6.41 üç akış da override katmanından geçiyor', () => {
  for (const id of ['corenectum.image.fetch', 'umbrella.qtx.download']) {
    assert.ok(CONNECTOR.includes(`expressionFor('${id}'`), `${id} bağlı olmalı`);
  }
  // Fabrika ifadesi üçüncü argüman olarak GEÇİLMELİ; geçilmezse override
  // yokken ifade boş kalır ve akış sessizce çalışmaz.
  assert.match(CONNECTOR, /const fallback=coreNectumImageFetchExpression\(url,\{forceRefresh,refreshToken:/);
  assert.match(CONNECTOR, /expressionFor\('corenectum\.image\.fetch',\{url\},fallback\)/);
});

test('v6.41/v6.55 kayıt defterindeki parametreler gerçekle uyuşuyor', () => {
  // Yanlış parametre adı, düzenleme ekranında var olmayan alanları gösterirdi.
  const qtx = registry.byId('umbrella.qtx.download');
  // v6.55 — 'mode' eklendi: trigger (yalnız indirmeyi başlat) / fetch
  // (baytları yakalayıp kalıcı kayda ver) ayrımı için.
  assert.deepEqual([...qtx.params], ['colourCode', 'mode']);
  assert.match(CONNECTOR, /expressionFor\('umbrella\.qtx\.download',\{colourCode:item\.colourCode,mode\}/);
  assert.deepEqual([...registry.byId('corenectum.image.fetch').params], ['url']);
});

test('v6.41 kullanıcı kodu enjeksiyona karşı sarmalanıyor', () => {
  const wrapped = registry.wrapUserScript('return {ok:true};', { url: 'https://a/b</script>' });
  // '<' kaçırılmalı: sayfaya enjekte edilen metinde </script> ayrıştırmayı bozardı.
  assert.doesNotMatch(wrapped, /<\/script>/);
  assert.match(wrapped, /\\u003c/);
  // Sözleşme: async fonksiyon gövdesi, params ile çağrılır.
  assert.match(wrapped, /async function\(params\)/);
});

/* ------------------------------------------------------------- 4) UÇLAR */

test('v6.41 uçlar moderatör korumasında', () => {
  // Bu kod dış sitelerde oturum açmış tarayıcıda çalışır; Terminal ile aynı sınır.
  for (const route of ["app.get('/api/web-scripts'", "app.post('/api/web-scripts/:id'", "app.post('/api/web-scripts/:id/reset'", "app.post('/api/web-scripts/:id/validate'"]) {
    assert.ok(SERVER.includes(route), route);
  }
  const block = SERVER.slice(SERVER.indexOf("app.get('/api/web-scripts'"), SERVER.indexOf("app.get('/api/automations/pending-triggers'"));
  const guards = block.match(/userAccess\.requireModerator/g) || [];
  assert.equal(guards.length, 4, 'dört ucun dördü de moderatör korumalı olmalı');
});

/* ------------------------------------------------------------- 5) ARAYÜZ */

test('v6.41 düzenleyici Terminal bölümünden açılıyor ve moderatöre kilitli', () => {
  assert.match(UI, /data-auto-web-scripts/);
  assert.match(UI, /state&&state\.canConfigure\?`<button type="button" class="tbtn autoWebScriptsBtn"/);
  assert.match(UI, /on\('\[data-auto-web-scripts\]','click',openWebScripts\)/);
});

test('v6.41 düzenleyici çalışma zamanında gerçekten çiziliyor', () => {
  // TUZAK (v6.37 dersi): node --check yalnız sözdizimine bakar; şablondaki
  // tanımsız bir değişken sessiz ReferenceError üretip paneli boş bırakır.
  let html = '';
  const host = {
    set innerHTML(v) { html = v; }, get innerHTML() { return html; },
    querySelector: () => ({ set onclick(_f) {}, textContent: '', className: '', value: '' }),
  };
  const modal = { querySelectorAll: () => [], querySelector: () => host };
  const cache = [{
    id: 'corenectum.image.fetch', label: 'CoreNectum · Görsel', description: 'Görseli indirir.',
    params: ['url'], returns: '{ok:true}', source: 'factory', code: '', updatedAt: '',
  }];
  const fn = new Function('modal', 'id', 'webScriptsCache', 'esc', 'tr', 'fmtDate', 'api', 'toast', 'confirm', 'refreshWebScriptList',
    `function selectWebScript(modal,id){${bodyOf(UI, 'selectWebScript')}} return selectWebScript;`);
  fn(modal, 'corenectum.image.fetch', cache, v => String(v == null ? '' : v), a => a, v => String(v), null, () => {}, () => true, () => {})(modal, 'corenectum.image.fetch');

  assert.match(html, /params\.url/, 'kullanılabilir parametreler gösterilmeli');
  assert.match(html, /data-web-script-code/);
  assert.match(html, /data-web-script-validate/);
  assert.match(html, /data-web-script-save/);
  // Varsayılan sürümdeyken "Varsayılana dön" anlamsızdır, kapalı olmalı.
  assert.match(html, /data-web-script-reset disabled/);
});

test('v6.41 sıfırlama onay istiyor', () => {
  // Kullanıcının yazdığı kod tek tıkla silinmemeli.
  const body = bodyOf(UI, 'selectWebScript');
  const block = body.slice(body.indexOf("data-web-script-reset]"));
  assert.match(block, /confirm\(/);
  assert.match(block, /\/reset/);
});
