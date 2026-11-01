'use strict';
/* 7.0.323 — ilk ekran sonrası yük: tembel betiklere içerik özeti, kullanıcı
   yönetiminin isteğe bağlı yüklenmesi, Excel motorunun boşta yüklenmesi ve
   i18n indeksinin yalnız etkin dil için kurulması. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const H = require('../server/lib/static-asset-hash');

const APP = path.join(__dirname, '..');
const PUBLIC = path.join(APP, 'public');
const read = rel => fs.readFileSync(path.join(APP, rel), 'utf8');

test('tembel betik listesi perf-runtime.js kaynağından türetilir ve hepsi mevcuttur', () => {
  const files = H.lazyScriptFiles(read('public/perf-runtime.js'));
  assert.ok(files.length >= 50, 'beklenen tembel betik sayısı: ' + files.length);
  for (const file of ['user-management.js', 'formula-engine.js', 'vendor/xlsx-style.js', 'fx.js']) assert.ok(files.includes(file), file);
  for (const file of files) {
    assert.ok(!file.includes('..'), file);
    assert.ok(fs.existsSync(path.join(PUBLIC, file)), 'eksik tembel betik: ' + file);
  }
  assert.deepEqual(H.lazyScriptFiles("'../evil.js','ok.js?rev=2'"), ['ok.js']);
});

test('özet haritası yalnız ısınmış ve güncel dosyaları içerir; değişen dosyanın özeti yayımlanmaz', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-lazy-hash-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'a.js'), '/* a */');
  fs.writeFileSync(path.join(dir, 'b.js'), '/* b */');
  assert.deepEqual(H.cachedHashMap(dir, ['a.js', 'b.js']), {}, 'ısınmadan önce harita boş (ilk istek bloklanmaz)');
  assert.equal(await H.warmFileHashes(dir, ['a.js', 'b.js', 'yok.js', '../x.js']), 2);
  const map = H.cachedHashMap(dir, ['a.js', 'b.js', 'yok.js']);
  assert.deepEqual(Object.keys(map).sort(), ['a.js', 'b.js']);
  assert.equal(map['a.js'], H.contentHash(path.join(dir, 'a.js')));
  fs.writeFileSync(path.join(dir, 'a.js'), '/* a değişti, aynı sürüm */ ' + 'x'.repeat(64));
  const future = new Date(Date.now() + 5000); fs.utimesSync(path.join(dir, 'a.js'), future, future);
  assert.deepEqual(Object.keys(H.cachedHashMap(dir, ['a.js', 'b.js'])), ['b.js'], 'bayat özet gömülmez');
  assert.equal(H.hashMapJson({ '</script>': 'x' }).includes('</'), false, 'satır içi JSON betik etiketini kapatamaz');
});

test('sunucu özet haritasını sayfaya gömer ve açılışta ısıtır', () => {
  const server = read('server/server.js');
  assert.match(server, /\.replace\('__BL_ASSET_HASH_MAP__', \(\) => hashMapJson\(cachedHashMap\(PUBLIC_ROOT_FOR_HASHES, lazyScriptFileList\(\)\)\)\)/);
  assert.match(server, /\.then\(\(\) => warmFileHashes\(PUBLIC_ROOT_FOR_HASHES, lazyScriptFileList\(\)\)\)/);
  const index = read('public/index.html');
  const holder = index.indexOf('<script type="application/json" id="blAssetHashes">__BL_ASSET_HASH_MAP__</script>');
  assert.ok(holder > 0 && holder < index.indexOf('<script src="perf-runtime.js'), 'harita yükleyiciden önce okunabilir');
});

function loadPerfRuntime(hashes) {
  const scriptSrc = 'http://127.0.0.1/perf-runtime.js?v=7.0.323&h=0123456789abcdef';
  const created = [];
  const document = {
    currentScript: { src: scriptSrc }, readyState: 'complete', baseURI: 'http://127.0.0.1/', scripts: [],
    getElementById: id => (id === 'blAssetHashes' && hashes != null ? { textContent: hashes } : null),
    createElement: tag => { const el = { tagName: tag, dataset: {}, set src(v) { this._src = v; }, get src() { return this._src; }, addEventListener(name, fn) { this['on' + name] = fn; }, removeEventListener() {}, setAttribute() {}, remove() {} }; created.push(el); return el; },
    head: { appendChild: el => { created.push(el); setTimeout(() => el.onload && el.onload(), 0); return el; } },
    body: { appendChild: el => el }, documentElement: { lang: 'tr' }, addEventListener() {},
  };
  const window = { document, performance: { now: () => 0, mark() {}, measure() {} }, addEventListener() {}, setTimeout, clearTimeout, location: { search: '' } };
  window.window = window;
  const context = vm.createContext({ window, document, setTimeout, clearTimeout, URL, performance: window.performance, console });
  vm.runInContext(read('public/perf-runtime.js'), context);
  return { window, created };
}

test('yükleyici özet varsa adrese &h= ekler, yoksa veya bozuksa eski davranışta kalır', async () => {
  const goodHash = 'abcdef0123456789';
  const withHash = loadPerfRuntime(JSON.stringify({ 'user-management.js': goodHash, 'kpi-groups.js': 'NOT-A-HASH' }));
  await withHash.window.BLPerf._loadScript('user-management.js').catch(() => {});
  await withHash.window.BLPerf._loadScript('kpi-groups.js').catch(() => {});
  const srcs = withHash.created.map(el => el.src).filter(Boolean);
  assert.ok(srcs.some(src => src.endsWith('user-management.js?v=7.0.323&h=' + goodHash)), srcs.join('\n'));
  assert.ok(srcs.some(src => /kpi-groups\.js\?v=7\.0\.323$/.test(src)), 'geçersiz özet kullanılmaz');
  const broken = loadPerfRuntime('{bozuk');
  await broken.window.BLPerf._loadScript('user-management.js').catch(() => {});
  assert.ok(broken.created.map(el => el.src).some(src => /user-management\.js\?v=7\.0\.323$/.test(src || '')));
});

test('kullanıcı yönetimi ekranı açılış zincirinde değil, ilk açılışta yüklenir', () => {
  const perf = read('public/perf-runtime.js');
  const deferred = perf.slice(perf.indexOf('deferredUi:['), perf.indexOf('],', perf.indexOf('deferredUi:[')));
  assert.ok(!deferred.includes('user-management.js'));
  assert.match(perf, /userManagement:\['user-management\.js'\]/);
  const ui = read('public/user-access-ui.js');
  const opener = ui.slice(ui.indexOf('async function openUserManagement()'), ui.indexOf('async function openOabUserLogin()'));
  assert.ok(opener.indexOf("ensureFeature('userManagement')") < opener.indexOf('window.BLUserManagement.open()'));
  assert.match(opener, /The user management screen could not be loaded\./, 'yükleme başarısızsa TR/EN uyarı korunur');
});

test('Excel motoru açılıştan kaldırılmaz; ilk kareyle yarışmadan, kısa üst sınırla boşta yüklenir', () => {
  const app = read('public/app-main.js');
  const tasks = app.slice(app.indexOf('function schedulePostUiStartupTasks(){'), app.indexOf('async function refreshSyncStatusBadge()'));
  assert.match(app, /const EXCEL_ENGINE_LOAD_DEADLINE_MS=\d+;/);
  assert.ok(Number(/EXCEL_ENGINE_LOAD_DEADLINE_MS=(\d+)/.exec(app)[1]) <= 2000, 'içe/dışa aktarma kısa sürede hazır olmalı');
  assert.match(tasks, /requestIdleCallback\(loadExcel,\{timeout:EXCEL_ENGINE_LOAD_DEADLINE_MS\}\)/);
  assert.match(tasks, /ensureExcel\('xlsx'\)/);
});

function loadI18n(lang) {
  const window = { BLStorage: { getItem: () => lang } };
  const context = vm.createContext({ window });
  vm.runInContext(read('public/i18n-dictionary.js'), context);
  vm.runInContext(read('public/i18n-runtime.js'), context);
  return window.BLI18n;
}

test('i18n indeksi açılışta kurulmaz; her yön ilk ihtiyaçta bir kez kurulur ve sonuç değişmez', () => {
  const runtime = read('public/i18n-runtime.js');
  assert.match(runtime, /function ensureIndex\(target\)\{\s*if\(built\[target\]\)return;/);
  assert.match(runtime, /ensureIndex\(target\);/);
  const tr = loadI18n('tr');
  assert.equal(tr.translate('Apply', 'tr'), 'Uygula');
  assert.equal(tr.translate('Tüm filtreleri temizle', 'en'), 'Clear all filters', 'diğer yön de istendiğinde kurulur');
  assert.equal(tr.translate('3 satır', 'en'), '3 rows');
  // Eski statik sözlükler, yön kurulduktan sonra katılsa da çevrilir.
  const vmWindow = { BLStorage: { getItem: () => 'en' } };
  const context = vm.createContext({ window: vmWindow });
  vm.runInContext(read('public/i18n-dictionary.js'), context);
  vm.runInContext(read('public/i18n-runtime.js'), context);
  assert.equal(vmWindow.BLI18n.translate('Tüm filtreleri temizle'), 'Clear all filters');
  context.TR_EN_DICT = { 'Deneme etiketi 7323': 'Test label 7323' };
  vm.runInContext('window.BLI18n.absorbLegacy()', context);
  assert.equal(vmWindow.BLI18n.translate('Deneme etiketi 7323', 'en'), 'Test label 7323');
  assert.equal(vmWindow.BLI18n.translate('Test label 7323', 'tr'), 'Deneme etiketi 7323');
});

test('model görsel anahtarı tek geçişte üretilir; sonuç Türkçe harflerde eski kuralla aynıdır', () => {
  const { createModelImageCache } = require('../public/model-image-cache.js');
  const cache = createModelImageCache({});
  assert.equal(cache.normalizeColourCode('  şİıiçÇöÖüÜğĞ  x\ty '), 'SIIICCOOUUGG X Y');
  assert.equal(cache.normalizeModelId('0012.000'), '12');
  assert.equal(cache.canonicalImageKey('ab-1', 'Lacivert ş', 'İnci  Mavi'), 'plm:AB-1|colour:LACIVERT S|name:INCI MAVI');
  assert.equal(cache.normalizeColourCode(null), '');
  // Tekrar eden çağrı aynı sonucu verir (bellek), ölçüsüz büyümez.
  assert.equal(cache.normalizeColourCode('  şİıiçÇöÖüÜğĞ  x\ty '), 'SIIICCOOUUGG X Y');
  const src = read('public/model-image-cache.js');
  assert.match(src, /if\(UPPER_MEMO\.size>=UPPER_MEMO_MAX\)UPPER_MEMO\.clear\(\);/);
  assert.doesNotMatch(src, /\['I','I'\]/);
});
