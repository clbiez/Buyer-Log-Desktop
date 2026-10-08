'use strict';
/* Kullanıcı: "CP'de görsellerin hepsi açıldıktan sonra Koleksiyon'a geçip
   CP'ye dönünce görseller yer tutucudan başlayıp tek tek yeniden açılıyor."
   Ölçülen kök neden: aynı görsel CP'de /api/cp-images/<ref>, kayıt
   yayımlandıktan sonra /api/collection-images/<ref>, Koleksiyon'da ise
   ?v=<sürüm> ekli adresle isteniyordu; URL değişince tarayıcı ve
   BLImageRuntime görseli "yeni" sayıp ağdan, yer tutucuyla yeniden yüklüyordu.
   Bu dosya tek URL, bilinen görselin doğrudan basılması, sıcak LRU, yeniden
   çizimde <img> öğesinin korunması ve ısıtma kuyruğunu CANLI doğrular. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createModelImageCache } = require('../public/model-image-cache.js');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} bulunamadı`);
  // Parametre listesi ({a='',b}={} gibi) atlanır; gövde ilk eşleşen ')' sonrasıdır.
  let paren = 0, i = source.indexOf('(', start);
  for (; i < source.length; i++) {
    if (source[i] === '(') paren++;
    else if (source[i] === ')' && --paren === 0) break;
  }
  let depth = 0;
  i = source.indexOf('{', i);
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) break;
  }
  return source.slice(start, i + 1);
}

const cache = createModelImageCache({});

// ---- BLImageRuntime: kaynak metinden çıkarılıp sahte Image ile çalıştırılır ----
function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { data, getItem: k => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k) };
}
function runtimeHarness({ autoLoad = true, size = null, localStorage = null } = {}) {
  const start = APP.indexOf('const BLImageRuntime=(()=>{');
  const end = APP.indexOf('window.BLImageRuntime=BLImageRuntime;', start);
  const created = [];
  class FakeImage {
    constructor() { this.isConnected = false; this.decoding = ''; created.push(this); if (size) { this.naturalWidth = size.w; this.naturalHeight = size.h; } }
    set src(value) { this._src = value; if (autoLoad && value) queueMicrotask(() => this.onload && this.onload()); }
    get src() { return this._src; }
  }
  const idle = cb => cb({ timeRemaining: () => 50, didTimeout: false });
  const window = { requestIdleCallback: idle, localStorage };
  const runtime = new Function('window', 'Image', 'IntersectionObserver', 'modelImageUrl', 'kolShowImgPopup',
    `${APP.slice(start, end)};return BLImageRuntime;`)(window, FakeImage, undefined, cache.imageUrl, () => {});
  return { runtime, created };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

test('sıcak LRU sabit sınırla tutulur; sınır aşılınca en eski referans bırakılır', async () => {
  assert.match(APP, /const WARM_IMAGE_LIMIT=500,WARM_IMAGE_BYTE_BUDGET=96\*1024\*1024/);
  const { runtime } = runtimeHarness();
  assert.equal(runtime.WARM_IMAGE_LIMIT, 500);
  const srcs = Array.from({ length: runtime.WARM_IMAGE_LIMIT + 3 }, (_, i) => `/api/collection-images/ci_${i}`);
  for (const src of srcs) await runtime.load(src);
  assert.equal(runtime.stats().warm, runtime.WARM_IMAGE_LIMIT);
  for (const src of srcs.slice(0, 3)) assert.equal(runtime.isWarm(src), false, `${src} düşmeliydi`);
  for (const src of srcs.slice(3)) assert.equal(runtime.isWarm(src), true);
  assert.equal(runtime.isLoaded(srcs.at(-1)), true);
});

test('invalidate eski ve tek URL biçimlerini birlikte düşürür; clearAll LRU dahil her şeyi boşaltır', async () => {
  const { runtime } = runtimeHarness();
  const a = '/api/collection-images/ci_a', b = '/api/collection-images/ci_b';
  await runtime.load(a); await runtime.load(b);
  assert.equal(runtime.isWarm(a), true);
  // Çağıranlar eski /api/cp-images ve ?v= adreslerini verebilir.
  runtime.invalidate(['/api/cp-images/ci_a?v=2026-01-01']);
  assert.equal(runtime.isLoaded(a), false);
  assert.equal(runtime.isWarm(a), false);
  assert.equal(runtime.isWarm(b), true);
  await runtime.clearAll();
  assert.deepEqual(runtime.stats(), { loaded: 0, warm: 0, warmBytes: 0, known: 0, queued: 0, active: 0 });
  assert.equal(runtime.isLoaded(b), false);
});

test('ısıtma yalnız uygulamanın kendi görsel uçlarına gider ve 4 eşzamanlılık sınırını kullanır', async () => {
  const { runtime, created } = runtimeHarness({ autoLoad: false });
  runtime.warmup([
    '/api/collection-images/ci_1', '/api/cp-images/ci_2', 'https://plm.example.com/style/1.jpg',
    '//plm.example.com/x.png', 'data:image/png;base64,AAAA', ...Array.from({ length: 10 }, (_, i) => `/api/collection-images/w_${i}`),
  ]);
  assert.equal(created.length, 0, 'ısıtma hemen başlamaz, görünür hücrelere yol verir');
  await new Promise(resolve => setTimeout(resolve, 700));
  const requested = created.map(img => img.src);
  assert.ok(requested.length > 0);
  assert.ok(requested.every(src => /^\/api\/(?:cp|collection)-images\//.test(src)), requested.join(','));
  assert.equal(runtime.stats().active, runtime.IMAGE_REQUEST_CONCURRENCY);
});

test('ısıtma iptali kuyruğu negatif önbelleğe yazmadan çözer; bekleyenler takılmaz', async () => {
  const { runtime } = runtimeHarness({ autoLoad: false });
  const srcs = Array.from({ length: 12 }, (_, i) => `/api/collection-images/c_${i}`);
  runtime.warmup(srcs);
  await new Promise(resolve => setTimeout(resolve, 700));
  const queued = runtime.stats().queued;
  assert.ok(queued > 0, 'kuyrukta bekleyen ısıtma olmalı');
  const waiting = srcs.filter(src => runtime.inFlight.has(src)).map(src => runtime.inFlight.get(src));
  runtime.cancelWarmup();
  assert.equal(runtime.stats().queued, 0);
  assert.equal(runtime.failed.size, 0, 'iptal hata değildir');
  // Kuyruktan düşen ısıtmalar çözülür (aktif 4 istek kendi sonucunu bekler).
  const settled = await Promise.race([Promise.allSettled(waiting.slice(-queued)), new Promise(r => setTimeout(() => r('timeout'), 200))]);
  assert.notEqual(settled, 'timeout');
});

// ---- Tablo hücresi: bilinen görsel doğrudan, bilinmeyen lazy ----
function cellHarness(knownSources, priorSources = new Set()) {
  const names = ['tableRowImageSource', 'cpImageCellHtml', 'ordersImageCellHtml'];
  const body = names.map(name => extractFunction(APP, name)).join('\n');
  const BLImageRuntime = { loadState: src => (knownSources.has(src) ? 'loaded' : priorSources.has(src) ? 'prior' : '') };
  return new Function('BLImageRuntime', 'modelImageUrl', 'canonicalModelImageSource', 'canonicalModelImageKnown',
    'cpImageDims', 'ordersImageDims', 'cpImagePlaceholder', 'escapeHtml', 'modelImageCacheKey', 'appLang',
    `${body};return {cpImageCellHtml,ordersImageCellHtml};`)(
    BLImageRuntime, cache.imageUrl, () => '', () => false, () => ({ w: 80, h: 100 }), () => ({ w: 60, h: 70 }),
    () => 'data:image/svg+xml;utf8,placeholder', value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'),
    (model, colour) => `${model}|${colour}`, 'tr');
}
const ROW = { _id: 7, 'PLM ID': '215013', 'C.Code': 'S01', _imageRef: 'ci_1', _imageUrl: '/api/cp-images/ci_1' };

test('bilinen kaynakla CP/Orders hücresi gerçek src + eager üretir; bilinmeyen yer tutucu + lazy kalır', () => {
  const known = cellHarness(new Set(['/api/collection-images/ci_1']));
  for (const html of [known.cpImageCellHtml(ROW), known.ordersImageCellHtml(ROW)]) {
    assert.match(html, /<img src="\/api\/collection-images\/ci_1"/);
    assert.match(html, /data-src="\/api\/collection-images\/ci_1"/);
    assert.match(html, /loading="eager"/);
    assert.match(html, /fetchpriority="auto"/);
    assert.match(html, /data-bl-image-loaded="1"/);
    assert.doesNotMatch(html, /loading="lazy"|fetchpriority="low"|placeholder/);
  }
  const prior = cellHarness(new Set(), new Set(['/api/collection-images/ci_1']));
  for (const html of [prior.cpImageCellHtml(ROW), prior.ordersImageCellHtml(ROW)]) {
    assert.match(html, /<img src="\/api\/collection-images\/ci_1"/);
    assert.match(html, /loading="eager" fetchpriority="auto" data-bl-image-prior="1"/);
    assert.doesNotMatch(html, /data-bl-image-loaded/);
  }
  const unknown = cellHarness(new Set());
  for (const html of [unknown.cpImageCellHtml(ROW), unknown.ordersImageCellHtml(ROW)]) {
    assert.match(html, /<img src="data:image\/svg\+xml;utf8,placeholder"/);
    assert.match(html, /data-src="\/api\/collection-images\/ci_1"/, 'eski /api/cp-images adresi tek URL biçimine iner');
    assert.match(html, /loading="lazy" decoding="async" fetchpriority="low"/);
    assert.doesNotMatch(html, /data-bl-image-loaded/);
  }
});

// ---- Tek görsel = tek URL ----
test('tek URL yardımcısı CP ve Koleksiyon için aynı adresi verir; görsel değişince adres değişir', () => {
  const registry = createModelImageCache({});
  registry.setRegistryMap({ 'plm:215013|colour:S01': 'ci_1' });
  const fromCpRow = registry.imageUrl('/api/cp-images/ci_1');
  const fromCollectionRow = registry.imageUrl('/api/collection-images/ci_1?v=2026-10-08T10:00:00.000Z');
  const fromRegistry = registry.resolveRegistrySource('215013', 'S01', '/api/collection-images');
  const fromRegistryCpBase = registry.resolveRegistrySource('215013', 'S01', '/api/cp-images');
  const fromRef = registry.imageUrlForRef('ci_1');
  assert.equal(new Set([fromCpRow, fromCollectionRow, fromRegistry, fromRegistryCpBase, fromRef]).size, 1);
  assert.match(fromRef, /^\/api\/collection-images\/ci_1$/);
  // Görsel değişimi yeni ref üretir → farklı adres.
  registry.setRegistryMap({ 'plm:215013|colour:S01': 'ci_2' });
  const changed = registry.resolveRegistrySource('215013', 'S01');
  assert.notEqual(changed, fromRegistry);
  assert.equal(changed, registry.imageUrlForRef('ci_2'));
  // Uygulama dışı adresler ve data: kaynakları dokunulmadan kalır.
  for (const value of ['data:image/png;base64,AAAA', 'https://shared.example/img/1.jpg', 'picture.png']) assert.equal(registry.imageUrl(value), value);
});

test('CP, Orders, Koleksiyon ve Quotations/detay görselleri aynı yardımcıdan geçer', () => {
  assert.match(extractFunction(APP, 'tableRowImageSource'), /modelImageUrl\(/);
  for (const name of ['cpImageCellHtml', 'ordersImageCellHtml']) assert.match(extractFunction(APP, name), /tableRowImageSource\(row\)/);
  assert.match(APP, /const collectionImageUrl=modelImageUrl\(collectionImageSource\),collectionImageKnown=hasCollectionImage\?BLImageRuntime\.loadState\(collectionImageUrl\):'';/);
  assert.match(APP, /data-src="\$\{escapeHtml\(collectionImageUrl\)\}"/);
  assert.match(extractFunction(APP, 'detailImageThumbHtml'), /const source=modelImageUrl\(norm\(url\)\);/);
  const sync = APP.slice(APP.indexOf('function applySyncedPlmImages'), APP.indexOf('function notifyPlmOperationStarted'));
  // Sürüm etiketi yok: ref değişimi adresi değiştirir; aynı ref'te önbellek düşürülmez.
  assert.doesNotMatch(sync, /versionedPlmImageUrl\(/);
  assert.match(sync, /modelImageRefUrl\(item\.imageRef\)/);
  assert.equal((sync.match(/if\(refChanged\)BLImageRuntime\.invalidate\(\[oldUrl\]\)/g) || []).length, 2);
  // Canlı yama da aynı ref'te yüklü görseli düşürmez.
  assert.match(extractFunction(APP, 'applyRemoteRowPatch'), /if\(oldRef!==ref\)BLImageRuntime\.invalidate\(\[oldUrl\]\);/);
});

// ---- Yeniden çizim: değişmeyen satırın <img> öğesi yerinde kalır ----
function fakeImg(attrs, { loaded = false } = {}) {
  const attributes = Object.entries(attrs).map(([name, value]) => ({ name, value: String(value) }));
  const dataset = {};
  for (const { name, value } of attributes) if (name.startsWith('data-')) dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  if (loaded) { dataset.blImageLoaded = '1'; attributes.push({ name: 'data-bl-image-loaded', value: '1' }, { name: 'data-cp-image-bound', value: '1' }); }
  const img = {
    attributes, dataset, complete: loaded, naturalWidth: loaded ? 240 : 0,
    src: loaded ? attrs['data-src'] : 'data:image/svg+xml;utf8,ph', currentSrc: loaded ? `http://127.0.0.1${attrs['data-src']}` : '',
    classList: String(attrs.class || '').split(/\s+/).filter(Boolean),
    replaceWith(other) { this.parent.splice(this.parent.indexOf(this), 1, other); other.parent = this.parent; },
  };
  return img;
}
function root(list) { list.forEach(img => { img.parent = list; }); return { list, querySelectorAll: () => [...list] }; }
const base = id => ({ class: 'cpThumb kolThumb', 'data-src': `/api/collection-images/ci_${id}`, 'data-id': id, 'data-has-image': '1', 'data-reuse-key': 'cp', 'data-img-box': '80x100', 'aria-label': 'x' });

test('yeniden çizimde yüklü ve imzası aynı görsel taşınır; değişen kaynak/ölçü/yüklenmemiş görsel taşınmaz', () => {
  const { runtime } = runtimeHarness();
  const oldSame = fakeImg(base(1), { loaded: true });
  const oldChangedSrc = fakeImg(base(2), { loaded: true });
  const oldResized = fakeImg(base(3), { loaded: true });
  const oldPending = fakeImg(base(4));
  const oldRoot = root([oldSame, oldChangedSrc, oldResized, oldPending]);
  const fresh = [fakeImg(base(1)), fakeImg({ ...base(2), 'data-src': '/api/collection-images/ci_new' }), fakeImg({ ...base(3), 'data-img-box': '120x150' }), fakeImg(base(4))];
  const newRoot = root(fresh.slice());
  assert.equal(runtime.adoptLoaded(oldRoot, newRoot), 1);
  assert.equal(newRoot.list[0], oldSame, 'değişmeyen satırın <img> öğesi korunur');
  assert.notEqual(newRoot.list[1], oldChangedSrc, 'görsel değişince eski öğe ASLA taşınmaz');
  assert.notEqual(newRoot.list[2], oldResized);
  assert.notEqual(newRoot.list[3], oldPending);
});

test('tablo yeniden çizim yolları yüklü görselleri taşır ve CP ısıtması sayfa değişiminde iptal edilir', () => {
  const virtual = extractFunction(APP, 'setupVirtualizedBody');
  assert.equal((virtual.match(/BLImageRuntime\.adoptLoaded\(tbody,frag\);\s*BLImageRuntime\.release\(tbody\);\s*tbody\.replaceChildren\(frag\);/g) || []).length, 2);
  assert.match(extractFunction(APP, 'renderFullTable'), /BLImageRuntime\.adoptLoaded\(tbody,first\);\s*BLImageRuntime\.release\(tbody\);\s*tbody\.replaceChildren\(first\);/);
  assert.match(extractFunction(APP, 'renderCPNow'), /scheduleCpImageWarmup\(rows\);/);
  assert.match(APP, /const CP_IMAGE_WARMUP_ROWS=300;/);
  assert.match(extractFunction(APP, 'switchTab'), /if\(previousTab==='cp'&&tab!=='cp'\)\{ _cpImageWarmupJob\+\+; BLImageRuntime\.cancelWarmup\(\); \}/);
  assert.match(extractFunction(APP, 'scheduleCpImageWarmup'), /if\(job!==_cpImageWarmupJob\|\|currentActiveTab\(\)!=='cp'\)return;/);
  // PLM'e otomatik istek yok: ısıtma yalnız uygulamanın kendi uçlarını kabul eder.
  assert.match(APP, /const isOwnImageEndpoint=src=>\/\^\\\/api\\\/\(\?:cp\|collection\)-images\\\//);
});

test('gizli sayfada yapılan sanal tablo çizimi son görünür kaydırma konumunu kullanır', () => {
  /* Gizli kaplayıcı scrollTop/clientHeight'i 0 okur. Ertelenmiş CP/Orders
     çizimi gizli sayfada (ucuz) yapılır; pencere son görünür konumdan
     hesaplanmazsa kaydırılmış "Tümü" görünümünde dönüşte görünür alan boş
     kalıyordu. Çizimi görünür sayfaya taşımak dönüşü ~250 ms yavaşlattığı
     için sıra korunur. */
  const paint = extractFunction(APP, 'setupVirtualizedBody');
  assert.match(paint, /const hidden = !scrollHost\.clientHeight;/);
  assert.match(paint, /const scrollTop = \(hidden \? scrollHost\._blScrollTop : scrollHost\.scrollTop\) \|\| 0;/);
  assert.match(paint, /if\(!hidden\) scrollHost\._blScrollTop = scrollTop;/);
  assert.match(paint, /if\(coverOnly && state\.renderedStart>=0\)\{/);
  assert.match(paint, /if\(state\.renderedStart<=firstVisible && state\.renderedEnd>=lastVisible\) return;/);
  assert.match(paint, /paint\(true\)/);
  assert.match(paint, /start = Math\.min\(start, Math\.max\(0, total-visibleCount\)\);/);
  const sw = extractFunction(APP, 'switchTab');
  assert.ok(sw.indexOf('flushDeferredRenderForTab(tab);') < sw.indexOf("document.getElementById('view-'+tab).classList.add('active');"), 'ertelenmiş çizim gizliyken (ucuz) çalışmaya devam eder');
});

test('sıcak tutma sıkıştırılmış bayt bütçesini aşmaz (büyük PLM görselleri)', async () => {
  // 4000x5000 piksel ≈ 10 MB JPEG tahmini: 96 MB bütçede en fazla 9 görsel tutulur.
  const { runtime } = runtimeHarness({ size: { w: 4000, h: 5000 } });
  const srcs = Array.from({ length: 20 }, (_, i) => `/api/collection-images/big_${i}`);
  for (const src of srcs) await runtime.load(src);
  const stats = runtime.stats();
  assert.ok(stats.warmBytes <= runtime.WARM_IMAGE_BYTE_BUDGET, `${stats.warmBytes} > bütçe`);
  assert.equal(stats.warm, Math.floor(runtime.WARM_IMAGE_BYTE_BUDGET / (4000 * 5000 * 0.5)));
  assert.equal(runtime.isWarm(srcs[0]), false, 'en eski düşer');
  assert.equal(runtime.isWarm(srcs.at(-1)), true);
  assert.equal(runtime.stats().loaded, 20, 'yüklendi bilgisi bütçeden bağımsız korunur');
});

test('önceki oturumda yüklenen görseller yeniden açılışta "prior" olarak bilinir; silme/geçersiz kılma unutturur', async () => {
  const storage = memoryStorage();
  const first = runtimeHarness({ localStorage: storage }).runtime;
  await first.load('/api/collection-images/ci_a');
  await first.load('/api/collection-images/ci_b');
  await new Promise(resolve => setTimeout(resolve, 1100)); // kayıt toplu ve gecikmeli yazılır
  assert.deepEqual(JSON.parse(storage.getItem('bl.modelImages.known.v1')), ['/api/collection-images/ci_a', '/api/collection-images/ci_b']);

  // Uygulama yeniden açıldı: bellek boş, cihazdaki liste duruyor.
  const second = runtimeHarness({ localStorage: storage }).runtime;
  assert.equal(second.loadState('/api/collection-images/ci_a'), 'prior');
  assert.equal(second.loadState('/api/collection-images/ci_zzz'), '');
  await second.load('/api/collection-images/ci_a');
  assert.equal(second.loadState('/api/collection-images/ci_a'), 'loaded');
  second.invalidate(['/api/cp-images/ci_b']);
  assert.equal(second.loadState('/api/collection-images/ci_b'), '', 'değişen/silinen görsel doğrudan basılmaz');
  await second.clearAll();
  assert.equal(storage.getItem('bl.modelImages.known.v1'), null, 'Tüm Görselleri Sil listeyi de siler');
  assert.equal(second.loadState('/api/collection-images/ci_a'), '');
  // Bozuk/yabancı kayıtlar okunmaz: yalnız uygulamanın kendi görsel uçları.
  const third = runtimeHarness({ localStorage: memoryStorage({ 'bl.modelImages.known.v1': JSON.stringify(['https://plm.example/x.jpg', '/api/collection-images/ci_ok']) }) }).runtime;
  assert.equal(third.loadState('https://plm.example/x.jpg'), '');
  assert.equal(third.loadState('/api/collection-images/ci_ok'), 'prior');
});

test('"prior" hücre gerçek kaynakla eager basılır, yüklenemezse yer tutucuya döner', () => {
  for (const name of ['cpImageCellHtml', 'ordersImageCellHtml']) {
    const body = extractFunction(APP, name);
    assert.match(body, /known==='prior'\?'loading="eager" fetchpriority="auto" data-bl-image-prior="1"'/);
  }
  assert.match(APP, /collectionImageKnown==='prior'\?'loading="eager" fetchpriority="auto" data-bl-image-prior="1"'/);
  assert.match(APP, /if\(img\.dataset\.blImagePrior==='1'&&img\.dataset\.blImageLoaded!=='1'\)\{watchPriorImage\(img\);return;\}/);
  const runtime = APP.slice(APP.indexOf('const watchPriorImage='), APP.indexOf('const tableImageSource='));
  assert.match(runtime, /forgetKnown\(src\);failed\.set\(src,Date\.now\(\)\+NEGATIVE_CACHE_TTL\)/);
  assert.match(runtime, /img\.src=kolImagePlaceholderSvg\(\)/);
});

test('optimize ucu görseli aynı ref altında yerinde değiştirmez (immutable önbellek eski kopyayı tutardı)', () => {
  const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  const start = SERVER.indexOf("app.put('/api/model-images/:id/optimize'");
  const route = SERVER.slice(start, SERVER.indexOf('});', start) + 3);
  assert.match(route, /res\.status\(410\)/);
  assert.match(route, /MODEL_IMAGE_IN_PLACE_REPLACE_RETIRED/);
  assert.doesNotMatch(SERVER, /replaceCollectionImage\(/, 'sunucu hiçbir yolda yerinde değiştirme çağırmaz');
});
