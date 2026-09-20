'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createModelImageCache } = require('../public/model-image-cache.js');
const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const LFL = fs.readFileSync(path.join(ROOT, 'public', 'lfl.js'), 'utf8');
const OAB = fs.readFileSync(path.join(ROOT, 'public', 'oab.js'), 'utf8');
const QUOTATIONS = fs.readFileSync(path.join(ROOT, 'public', 'quotations.js'), 'utf8');

function fakeCacheStorage() {
  const entries = new Map();
  const cache = {
    async match(request) { return entries.get(request.url)?.clone(); },
    async put(request, response) { entries.set(request.url, response.clone()); },
    async delete(request) { return entries.delete(request.url); },
    async keys() { return [...entries.keys()].map(url => new Request(url)); },
  };
  return { entries, async open() { return cache; } };
}

function fakeEnvironment(sharedCache, counters) {
  let objectId = 0;
  return {
    caches: sharedCache,
    location: { origin: 'http://localhost:4173' },
    Request,
    Response,
    Blob,
    fetch: async source => {
      counters.fetches++;
      return new Response(new Blob([String(source)], { type: 'image/jpeg' }), { status: 200 });
    },
    URL: {
      createObjectURL() { counters.created++; return `blob:test-${++objectId}`; },
      revokeObjectURL() { counters.revoked++; },
    },
    Image: class FakeImage {
      set src(value) { this._src = value; queueMicrotask(() => this.onload?.()); }
      get src() { return this._src; }
      async decode() {}
    },
  };
}

test('model görsel anahtarı ModelID + ColourCode ile kararlı üretilir', () => {
  const counters = { fetches: 0, created: 0, revoked: 0, conversions: 0 };
  const cache = createModelImageCache(fakeEnvironment(fakeCacheStorage(), counters));
  assert.equal(cache.identity(' 2108736 ', ' blue-01 '), '2108736|BLUE-01');
  assert.equal(cache.identity('Model 42', ''), 'MODEL 42|');
});

test('tablo alanı kaynak görsel URL\'sini doğrudan kullanır ve thumbnail üretmez', async () => {
  const counters = { fetches: 0, created: 0, revoked: 0, conversions: 0 };
  const disk = fakeCacheStorage();
  const thumbnailer = async blob => {
    counters.conversions++;
    assert.equal(blob.type, 'image/jpeg');
    return new Blob(['webp-thumb'], { type: 'image/webp' });
  };
  const first = createModelImageCache(fakeEnvironment(disk, counters), { thumbnailer });
  const request = { modelId: '2108736', colourCode: 'BLUE-01', source: '/api/cp-images/ci_1' };
  const [a, b] = await Promise.all([first.getThumbnail(request), first.getThumbnail(request)]);
  assert.equal(a, b);
  assert.equal(a, request.source);
  assert.equal(counters.fetches, 0);
  assert.equal(counters.conversions, 0);

  const reopened = createModelImageCache(fakeEnvironment(disk, counters), { thumbnailer });
  const fromDisk = await reopened.getThumbnail(request);
  assert.equal(fromDisk, request.source);
  assert.equal(disk.entries.size, 0);
});

test('tablo thumbnail yolu ham source kullanır; hover original cache LRU ile sınırlı kalır', async () => {
  const counters = { fetches: 0, created: 0, revoked: 0, conversions: 0 };
  const env = fakeEnvironment(fakeCacheStorage(), counters);
  const cache = createModelImageCache(env, {
    thumbnailMemoryLimit: 2,
    originalMemoryLimit: 2,
    thumbnailer: async () => new Blob(['thumb'], { type: 'image/webp' }),
  });
  const base = { modelId: 'M1', colourCode: 'C1' };
  assert.equal(await cache.getThumbnail({ ...base, source: '/img/old' }), '/img/old');
  assert.equal(await cache.getThumbnail({ ...base, source: '/img/new' }), '/img/new');
  await cache.getThumbnail({ modelId: 'M2', colourCode: 'C2', source: '/img/two' });
  assert.equal(cache.stats().thumbnailMemoryEntries, 0, 'table yolu artık object URL thumbnail cache üretmemeli');
  assert.equal(counters.created, 0);
  assert.equal(counters.revoked, 0);

  await cache.preloadOriginal({ ...base, source: '/img/new' });
  await cache.preloadOriginal({ modelId: 'M2', colourCode: 'C2', source: '/img/two' });
  await cache.preloadOriginal({ modelId: 'M3', colourCode: 'C3', source: '/img/three' });
  assert.equal(cache.stats().originalMemoryEntries, 2);
});

test('ortak cache runtime uygulamadan önce yüklenir ve tablo/hover yollarını besler', () => {
  assert.ok(INDEX.indexOf('model-image-cache.js') < INDEX.indexOf('app-main.js'));
  assert.match(APP, /BLModelImageCache\.bind\(img\)/);
  assert.match(APP, /BLModelImageCache\.preloadOriginal/);
  assert.match(APP, /data-image-key=/);
  assert.match(APP, /data-model-id=/);
  assert.match(APP, /data-colour-code=/);
  assert.match(APP, /image\.dataset\.source!==src/);
});

test('thumbnail henüz görünür alanda yüklenmemiş olsa da panoya kaynak model görseli gömülür', () => {
  /* v10.85 (Packet 10): dönüştürücü mantığı _copyImageDataUrlFor'a taşındı —
     hem ekrandaki <img>'den (_copyImageDataUrl) hem KAYITTAN (Koleksiyon'un
     kolRecordImageCopyCell'i) çağrılabilsin diye. DOM'a özel kısım
     (thumb.dataset.src okuması) _copyImageDataUrl'de kalmaya devam ediyor. */
  const copyImage = APP.slice(APP.indexOf('async function _copyImageDataUrlFor('), APP.indexOf('// Panoya kopyalama sırasında'));
  const copyCell = APP.slice(APP.indexOf('async function _copyCellFromTd('), APP.indexOf('// Çizim sırasında iliştirilmiş kopyalama verisi'));
  assert.match(copyImage, /dataset\?\.src/);
  assert.match(copyImage, /BLModelImageCache\?\.getClipboardDataUrl/);
  assert.match(copyCell, /thumb\.dataset\.src/);
  assert.doesNotMatch(copyCell, /!\/\^data:image\\\/svg\\\+xml\/i\.test\(thumb\.src/);
});

test('WEBP model görseli Excel ve Outlook panosu için PNG data URL olarak hazırlanır', async () => {
  const counters = { fetches: 0, created: 0, revoked: 0, conversions: 0 };
  const env = fakeEnvironment(fakeCacheStorage(), counters);
  env.fetch = async () => new Response(new Blob(['webp-source'], { type: 'image/webp' }), { status: 200 });
  env.createImageBitmap = async () => ({ width: 96, height: 48, close() {} });
  env.OffscreenCanvas = class FakeClipboardCanvas {
    constructor(width, height) { this.width = width; this.height = height; }
    getContext() { return { fillStyle: '', fillRect() {}, drawImage() {} }; }
    async convertToBlob(options) {
      counters.conversions++;
      assert.equal(options.type, 'image/png');
      return new Blob(['office-png'], { type: 'image/png' });
    }
  };
  env.FileReader = class FakeFileReader {
    readAsDataURL(blob) {
      blob.arrayBuffer().then(buffer => {
        this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`;
        this.onload?.();
      }, error => { this.error = error; this.onerror?.(); });
    }
  };

  const cache = createModelImageCache(env);
  const dataUrl = await cache.getClipboardDataUrl({
    modelId: '2104532',
    colourCode: 'S7IE74Z4',
    source: '/api/collection-images/ci_1',
  });

  assert.match(dataUrl, /^data:image\/png;base64,/);
  assert.equal(counters.conversions, 1);
});

test('Collection, CP, Orders, Backlog, LFL, OAB ve quotation ortak thumbnail üreticisini kullanır', () => {
  for (const functionName of ['cpImageCellHtml', 'ordersImageCellHtml', 'detailImageThumbHtml']) {
    assert.match(APP, new RegExp(`function ${functionName}`));
  }
  assert.match(APP, /collectionModelId=r\.plmId\|\|r\.modelKod\|\|r\.id/);
  assert.match(APP, /thumbHtml:detailImageThumbHtml/);
  assert.match(LFL, /BLDetailImages\.thumbHtml/);
  assert.match(OAB, /BLDetailImages\.thumbHtml/);
  assert.match(QUOTATIONS, /qCachedModelThumb/);
  assert.match(QUOTATIONS, /BLImageRuntime\?\.observe\?\.\(img\)/);
});

test('bind ham görseli anında tablo hücresine bağlar ve invalidate çalışır', async () => {
  const counters = { fetches: 0, created: 0, revoked: 0, conversions: 0, closed: 0 };
  const disk = fakeCacheStorage(), env = fakeEnvironment(disk, counters);
  env.createImageBitmap = async () => ({ width: 240, height: 120, close() { counters.closed++; } });
  env.OffscreenCanvas = class FakeCanvas {
    constructor(width, height) { this.width = width; this.height = height; }
    getContext() { return { fillStyle: '', fillRect() {}, drawImage() {} }; }
    async convertToBlob(options) {
      counters.conversions++;
      assert.equal(this.width, 96);
      assert.equal(this.height, 48);
      assert.equal(options.type, 'image/webp');
      return new Blob(['webp'], { type: 'image/webp' });
    }
  };
  const cache = createModelImageCache(env);
  const img = {
    dataset: { src: '/api/collection-images/ci_9', modelId: 'M9', colourCode: 'C9' },
    isConnected: true,
    src: '',
  };
  const url = await cache.bind(img);
  assert.equal(img.src, url);
  assert.equal(img.dataset.blImageLoaded, '1');
  assert.equal(url, '/api/collection-images/ci_9');
  assert.equal(counters.conversions, 0);
  assert.equal(counters.closed, 0);
  assert.equal(disk.entries.size, 0);

  await cache.invalidate('/api/collection-images/ci_9');
  assert.equal(disk.entries.size, 0);
  assert.equal(cache.stats().thumbnailMemoryEntries, 0);
  assert.equal(await cache.getThumbnail({ modelId: 'M0', colourCode: '', source: '' }), '');
});
