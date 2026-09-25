'use strict';

/* v11.00 — KANONİK PLM GÖRSEL BORUSU (canlı senkron).
 *
 * Bu dosya, tarayıcı ve gerçek disk OLMADAN şunları korur:
 *   - aynı styleId birden çok renkte istense de TEK metadata çağrısı,
 *   - aynı kaynak kimliği kayıtlıysa görselin TEKRAR İNDİRİLMEMESİ,
 *   - kullanıcının ELLE koyduğu görselin otomatik senkronda KORUNMASI,
 *   - otomatik bir görselin daha yeni bir otomatik görselle değişebilmesi,
 *   - tek bir indirmenin başarısızlığının işi DÜŞÜRMEMESİ (partial),
 *   - 429/5xx/timeout için üstel geri çekilme + jitter,
 *   - 401/403'te CoreNectum'un yeniden denemelerle DÖVÜLMEMESİ,
 *   - iptal ve kontrol noktasından devam,
 *   - "yalnız başarısızları yeniden dene"nin başarılıları KAPSAMAMASI.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

// Depo köklerini geçici klasöre al: gerçek kullanıcı verisine dokunulmaz.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-plm-image-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(TMP, 'server');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(TMP, 'local');
fs.mkdirSync(process.env.BUYER_LOG_SERVER_DATA_ROOT, { recursive: true });
fs.mkdirSync(process.env.BUYER_LOG_LOCAL_DATA_ROOT, { recursive: true });

const api = require('../server/lib/corenectum-style-api');
const ingestLib = require('../server/lib/plm-image-ingest');
const ownership = require('../server/lib/plm-image-ownership');
const jobStore = require('../server/lib/plm-image-job-store');
const queue = require('../server/lib/plm-image-download-queue');
const service = require('../server/lib/plm-image-sync-service');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const png = tag => Buffer.concat([PNG, Buffer.from(String(tag))]);
const ATTACH = name => `https://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/Attachment/GetAttachment/${name}`;

/* Bellek içi kanonik depo taklidi. Gerçek depo sözleşmesiyle AYNI arayüz:
   saveImage -> {id,url,mimeType,size,updatedAt}, getImage -> {item,full}. */
function createFakeStore() {
  const files = new Map();
  const imagemap = {};
  let sequence = 0;
  let ownershipStore = ownership.emptyStore();
  const fakeOwnership = {
    ...ownership,
    loadOwnership: () => ownershipStore,
    saveOwnership: store => { ownershipStore = store; return store; },
  };
  const ingest = ingestLib.createPlmImageIngest({
    owner: ownership.OWNER_PLM,
    ownership: fakeOwnership,
    getImage: ref => (files.has(ref) ? { item: files.get(ref), full: ref } : null),
    readImageBytes: found => files.get(found.item.id).buffer,
    saveImage: ({ rowId, filename, mimeType, base64 }) => {
      sequence += 1;
      const id = `ci_${sequence}`;
      const item = { id, rowId, filename, mimeType, size: Buffer.from(base64, 'base64').length, url: `/api/collection-images/${id}`, updatedAt: `t${sequence}`, buffer: Buffer.from(base64, 'base64') };
      files.set(id, item);
      return item;
    },
    deleteImage: ref => files.delete(ref),
    patchLinks: links => {
      for (const link of links) {
        const key = ingestLib.canonicalKeyFor(link);
        if (key) imagemap[key] = String(link.imageRef || '');
      }
      return { overrides: { imagemap }, updated: links.length };
    },
  });
  return { files, imagemap, ingest, ownership: fakeOwnership, store: () => ownershipStore };
}

function styleImagesPayload({ optionImages = [], styleImages = [] } = {}) {
  return { data: { styleImages: { StyleImages: styleImages }, styleOptionImages: { OptionImages: optionImages } } };
}
function styleListPayload(rows) {
  return { data: { coreNectumResultData: { styleListResult: rows } } };
}

function harness(overrides = {}) {
  const fake = createFakeStore();
  const calls = { styleList: [], styleImages: [], downloads: [] };
  const base = {
    requests: [{ plmId: '2123595', colourCode: 'CVL', colour: 'NEW BLACK' }],
    mode: 'all',
    ingest: fake.ingest,
    imagemap: fake.imagemap,
    store: fake.store(),
    styleListLookup: async codes => { calls.styleList.push(codes.slice()); return styleListPayload(codes.map(code => ({ plmCode: code, styleId: `25${code}`, styleName: 'X', model: { imageUrl: ATTACH(`list-${code}`) } }))); },
    styleImagesLookup: async styleId => {
      calls.styleImages.push(styleId);
      return styleImagesPayload({ optionImages: [{ styleOptionId: '1', styleOptionImageId: `img-${styleId}`, colorCode: 'CVL', name: 'NEW BLACK', imageUrl: ATTACH(`opt-${styleId}`) }] });
    },
    downloadImage: async url => { calls.downloads.push(url); return { url, mimeType: 'image/png', buffer: png(url), size: png(url).length }; },
  };
  return { fake, calls, input: { ...base, ...overrides } };
}

test('aynı styleId birden çok renkte istense de GetStyleImages BİR kez çağrılır', async () => {
  const { calls, input } = harness({
    requests: [
      { plmId: '2123595', colourCode: 'CVL', colour: 'NEW BLACK' },
      { plmId: '2123595', colourCode: 'DWP', colour: 'NEW NAVY' },
      { plmId: '2123595', colourCode: 'HEC', colour: 'DARK BROWN' },
    ],
  });
  await service.runPlmImageSync(input);
  assert.deepEqual(calls.styleImages, ['252123595']);
});

test('renk başına Option Image seçilir; GetStyleList görseli yalnız yedektir', async () => {
  const { fake, calls, input } = harness({
    requests: [
      { plmId: '2123595', colourCode: 'CVL', colour: 'NEW BLACK' },
      { plmId: '2123595', colourCode: 'ZZZ', colour: 'UNKNOWN' },
    ],
  });
  const run = await service.runPlmImageSync(input);
  assert.equal(run.status, jobStore.STATUS_COMPLETED);
  assert.equal(run.counts.optionImagesFound, 1);
  assert.equal(run.counts.fallbacksUsed, 1, 'eşleşmeyen renk Style List görseline düşer');
  assert.ok(calls.downloads.some(url => /opt-252123595$/.test(url)));
  assert.ok(calls.downloads.some(url => /list-2123595$/.test(url)));
  assert.equal(Object.keys(fake.imagemap).length, 2);
});

test('aynı kaynak kimliği zaten kayıtlıysa görsel TEKRAR İNDİRİLMEZ', async () => {
  const first = harness();
  const run1 = await service.runPlmImageSync(first.input);
  assert.equal(run1.counts.downloadsCompleted, 1);

  // İkinci koşum: aynı styleOptionImageId, aynı dosya.
  const second = { ...first.input, store: first.fake.store(), imagemap: first.fake.imagemap };
  second.downloadImage = async url => { first.calls.downloads.push(url); return { url, mimeType: 'image/png', buffer: png(url), size: 1 }; };
  const run2 = await service.runPlmImageSync(second);
  assert.equal(run2.counts.downloadsCompleted, 0, 'önbellek isabetinde indirme olmamalı');
  assert.equal(run2.counts.cacheHits, 1);
});

test('Eksikleri Tamamla ana renkte eski otomatik OPTION kaydını cache saymaz ve ön+arka görsele geçirir', async () => {
  const fake = createFakeStore();
  const request = { plmId: '2121571', colourCode: 'CVL', colour: 'NEW BLACK', imageRole: 'main' };
  const key = ingestLib.canonicalKeyFor(request);
  fake.files.set('old_option', { id: 'old_option', url: '/x', mimeType: 'image/png', size: 10, updatedAt: 'old', buffer: png('old-option') });
  fake.imagemap[key] = 'old_option';
  const remembered = ownership.rememberAutomatic([{
    key, owner: ownership.OWNER_PLM, imageRef: 'old_option', sourceType: 'OPTION', sourceIdentity: 'option:1:1', hash: 'old'
  }], { store: fake.store(), persist: value => fake.ownership.saveOwnership(value) });
  const decision = fake.ingest.decideBeforeFetch(request, { store: remembered.store, imagemap: fake.imagemap, mode: 'missing' });
  assert.equal(decision.decision, ingestLib.DECISION_FETCH, 'eski Option Image ana renk için yeniden çekilmeli');

  const correctStore = ownership.rememberAutomatic([{
    key, owner: ownership.OWNER_PLM, imageRef: 'old_option', sourceType: 'STYLE_LIST', sourceIdentity: 'stylelist:front-back', hash: 'old'
  }], { store: remembered.store, persist: value => fake.ownership.saveOwnership(value) }).store;
  const cached = fake.ingest.decideBeforeFetch(request, { store: correctStore, imagemap: fake.imagemap, mode: 'missing' });
  assert.equal(cached.decision, ingestLib.DECISION_CACHED, 'doğru ana model görseli yeniden indirilmemeli');
});

test('Paylaşılandan gelen PLM/option kimliği ana renkte cache sayılmaz', () => {
  const fake = createFakeStore();
  const request = { plmId: '2131790', colourCode: 'HMW', colour: 'BRIGHT RED', imageRole: 'main' };
  const key = ingestLib.canonicalKeyFor(request);
  fake.files.set('shared_option', { id: 'shared_option', url: '/x', mimeType: 'image/png', size: 10, updatedAt: 'old', buffer: png('shared-option') });
  fake.imagemap[key] = 'shared_option';

  // Eski shared kurulumlarında kaynak ailesi PLM olarak kalabiliyordu;
  // gerçek Option kökeni sourceIdentity içinde korunur.
  const store = ownership.rememberAutomatic([{
    key, owner: ownership.OWNER_PLM, imageRef: 'shared_option',
    sourceType: 'PLM', sourceIdentity: 'option:4381079:9000001', hash: 'old'
  }], { store: fake.store(), persist: value => fake.ownership.saveOwnership(value) }).store;

  const decision = fake.ingest.decideBeforeFetch(request, { store, imagemap: fake.imagemap, mode: 'missing' });
  assert.equal(decision.decision, ingestLib.DECISION_FETCH,
    'ana renk paylaşılan eski Option görseli yerine GetStyleList görselini yeniden çekmeli');
});


test('kullanıcının ELLE koyduğu görsel otomatik senkronda korunur', async () => {
  const { fake, calls, input } = harness();
  // Manuel görsel: imagemap'te var, sahiplik kaydında YOK.
  const key = ingestLib.canonicalKeyFor(input.requests[0]);
  const manual = fake.ingest.commit ? null : null;
  fake.files.set('manual_1', { id: 'manual_1', url: '/api/collection-images/manual_1', mimeType: 'image/png', size: 10, updatedAt: 'm1', buffer: png('manual') });
  fake.imagemap[key] = 'manual_1';
  assert.equal(manual, null);

  const run = await service.runPlmImageSync({ ...input, store: fake.store(), imagemap: fake.imagemap });
  assert.equal(run.counts.manualPreserved, 1);
  assert.equal(calls.downloads.length, 0, 'manuel görsel için indirme bile yapılmamalı');
  assert.equal(fake.imagemap[key], 'manual_1', 'manuel referans olduğu gibi kalmalı');
});

test('kullanıcı AÇIKÇA isterse manuel görselin üzerine yazılabilir', async () => {
  const { fake, input } = harness();
  const key = ingestLib.canonicalKeyFor(input.requests[0]);
  fake.files.set('manual_1', { id: 'manual_1', url: '/x', mimeType: 'image/png', size: 10, updatedAt: 'm1', buffer: png('manual') });
  fake.imagemap[key] = 'manual_1';

  const run = await service.runPlmImageSync({ ...input, store: fake.store(), imagemap: fake.imagemap, overwriteManual: true });
  assert.equal(run.counts.manualPreserved, 0);
  assert.notEqual(fake.imagemap[key], 'manual_1');
});

test('otomatik görsel daha yeni bir otomatik görselle güvenle değişir', async () => {
  const first = harness();
  await service.runPlmImageSync(first.input);
  const key = ingestLib.canonicalKeyFor(first.input.requests[0]);
  const oldRef = first.fake.imagemap[key];
  assert.ok(oldRef);

  // CoreNectum yeni bir Option Image kimliği döndürüyor.
  const second = {
    ...first.input,
    store: first.fake.store(),
    imagemap: first.fake.imagemap,
    styleImagesLookup: async styleId => styleImagesPayload({ optionImages: [{ styleOptionId: '1', styleOptionImageId: 'img-NEW', colorCode: 'CVL', name: 'NEW BLACK', imageUrl: ATTACH('opt-new') }] }),
    downloadImage: async url => ({ url, mimeType: 'image/png', buffer: png('brand-new'), size: 20 }),
  };
  const run = await service.runPlmImageSync(second);
  assert.equal(run.counts.downloadsCompleted, 1);
  assert.notEqual(first.fake.imagemap[key], oldRef, 'yeni otomatik görsel yazılmalı');
  assert.equal(run.counts.manualPreserved, 0);
});

test('PLM görseli bulunamazsa MEVCUT geçerli görsel SİLİNMEZ', async () => {
  const { fake, input } = harness({
    styleImagesLookup: async () => styleImagesPayload({}),
    styleListLookup: async codes => styleListPayload(codes.map(code => ({ plmCode: code, styleId: `25${code}` }))),
  });
  const key = ingestLib.canonicalKeyFor(input.requests[0]);
  fake.files.set('manual_1', { id: 'manual_1', url: '/x', mimeType: 'image/png', size: 10, updatedAt: 'm1', buffer: png('manual') });
  fake.imagemap[key] = 'manual_1';

  const run = await service.runPlmImageSync({ ...input, store: fake.store(), imagemap: fake.imagemap, overwriteManual: true });
  assert.equal(run.counts.missing, 1);
  assert.equal(fake.imagemap[key], 'manual_1', 'eksik PLM görseli mevcut görseli silmemeli');
});

test('TEK bir indirmenin başarısızlığı işi düşürmez — iş partial biter', async () => {
  const { fake, input } = harness({
    requests: [
      { plmId: '2123595', colourCode: 'CVL', colour: 'NEW BLACK' },
      { plmId: '2121459', colourCode: 'CVL', colour: 'NEW BLACK' },
    ],
    downloadImage: async url => {
      if (/2121459/.test(url)) throw Object.assign(new Error('boom'), { code: 'PLM_IMAGE_HTTP_ERROR', status: 500 });
      return { url, mimeType: 'image/png', buffer: png(url), size: 12 };
    },
  });
  const run = await service.runPlmImageSync(input);
  assert.equal(run.status, jobStore.STATUS_PARTIAL);
  assert.equal(run.counts.downloadsCompleted, 1);
  assert.equal(run.failures.length, 1);
  assert.equal(run.failures[0].plmId, '2121459');
  assert.equal(Object.keys(fake.imagemap).length, 1, 'başarılı görsel yine de yazılmalı');
});

test('başarısız GetStyleList partisi 100 -> 50 -> 20 bölünür, başarılı PLM tekrar sorulmaz', async () => {
  const ids = Array.from({ length: 100 }, (_, index) => String(3000000 + index));
  const sizes = [];
  const resolution = await service.resolveStyleRows(ids, {
    styleListLookup: async codes => {
      sizes.push(codes.length);
      if (codes.length > 20) throw new Error('batch too large');
      return styleListPayload(codes.map(code => ({ plmCode: code, styleId: `25${code}` })));
    },
  });
  assert.deepEqual(sizes.slice(0, 3), [100, 50, 20], '100 -> 50 -> 20 basamakları');
  assert.equal(resolution.rows.size, 100);
  // Aynı PLM iki kez BAŞARIYLA sorulmamalı: başarılı 20'lik partiler tekil.
  const successful = sizes.filter(size => size <= 20);
  assert.equal(successful.reduce((sum, size) => sum + size, 0), 100);
});

test('401/403 CoreNectum’u yeniden denemelerle dövmez, iş temiz durur', async () => {
  let calls = 0;
  await assert.rejects(
    () => service.resolveStyleRows(['1', '2', '3'], {
      styleListLookup: async () => { calls += 1; throw Object.assign(new Error('auth'), { code: 'CORENECTUM_LOGIN_REQUIRED', statusCode: 409 }); },
    }),
    error => error.code === 'CORENECTUM_LOGIN_REQUIRED',
  );
  assert.equal(calls, 1, 'yetki hatasında parti bölünmemeli / yeniden denenmemeli');
});

test('yetki bilgisi yalnız direct API RAM/env state içinde tutulur; dosyaya veya renderer storageına yazılmaz', () => {
  const settingsSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'corenectum-api-settings.js'), 'utf8');
  const clientSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'corenectum-api-client.js'), 'utf8');
  assert.match(settingsSource, /const tokens = new Map\(\)/);
  assert.match(settingsSource, /let desktopToken = ''/);
  assert.match(settingsSource, /process\.env\.BUYER_LOG_CORENECTUM_BEARER_TOKEN/);
  assert.doesNotMatch(settingsSource, /writeFile|localStorage|sessionStorage/);
  assert.match(clientSource, /Authorization:`Bearer \${token}`/);
  assert.doesNotMatch(clientSource, /writeFile|localStorage|sessionStorage/);
});

test('iptal edilen iş cancelled biter ve yarım yazma bırakmaz', async () => {
  const { fake, input } = harness({
    requests: [
      { plmId: '2123595', colourCode: 'CVL', colour: 'A' },
      { plmId: '2121459', colourCode: 'CVL', colour: 'A' },
    ],
  });
  let cancelled = false;
  const run = await service.runPlmImageSync({
    ...input,
    isCancelled: () => cancelled,
    downloadImage: async url => { cancelled = true; return { url, mimeType: 'image/png', buffer: png(url), size: 5 }; },
  });
  assert.equal(run.status, jobStore.STATUS_CANCELLED);
  assert.ok(Object.keys(fake.imagemap).length <= 2);
});

/* ---------- indirme motoru ---------- */

test('429/5xx/timeout üstel geri çekilme + jitter ile yeniden denenir', async () => {
  const delays = [];
  let attempts = 0;
  const image = await queue.downloadImage(ATTACH('retry'), {
    maxAttempts: 4,
    baseDelayMs: 100,
    random: () => 0.5,
    sleep: async ms => { delays.push(ms); },
    request: async () => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error('rate'), { code: 'PLM_IMAGE_HTTP_ERROR', status: 429, headers: {} });
      if (attempts === 2) throw Object.assign(new Error('boom'), { code: 'PLM_IMAGE_HTTP_ERROR', status: 503, headers: {} });
      if (attempts === 3) throw Object.assign(new Error('slow'), { code: 'PLM_IMAGE_TIMEOUT' });
      return { status: 200, contentType: 'image/png', buffer: png('ok') };
    },
  });
  assert.equal(attempts, 4);
  assert.equal(image.mimeType, 'image/png');
  assert.equal(delays.length, 3);
  assert.ok(delays[1] > delays[0], 'gecikme üstel artmalı');
  // Jitter: yarısı sabit, yarısı rastgele -> random()=0.5 ile tam beklenen.
  assert.equal(delays[0], 75, 'jitter: yarısı sabit + yarısı rastgele (100/2 + 0.5*100/2)');
});

test('401/403 indirmede yeniden DENENMEZ', async () => {
  let attempts = 0;
  await assert.rejects(() => queue.downloadImage(ATTACH('auth'), {
    maxAttempts: 4,
    sleep: async () => {},
    request: async () => { attempts += 1; throw Object.assign(new Error('nope'), { code: 'PLM_IMAGE_AUTH', status: 401 }); },
  }), error => error.code === 'PLM_IMAGE_AUTH');
  assert.equal(attempts, 1);
});

test('görsel olmayan yanıt reddedilir; uzantıya değil BAYTLARA bakılır', async () => {
  await assert.rejects(() => queue.downloadImage(ATTACH('html'), {
    maxAttempts: 1,
    request: async () => ({ status: 200, contentType: 'image/png', buffer: Buffer.from('<html>not an image</html>') }),
  }), error => error.code === 'PLM_IMAGE_INVALID_TYPE');
  // .bmp/.jfif uzantılı PNG baytları GERÇEK pakette vardı ve kabul edilmeli.
  assert.equal(queue.sniffImageMime(png('x'), 'application/octet-stream'), 'image/png');
  // Bildirilen tip, baytlar okunabildiğinde tek başına YETMEZ.
  assert.equal(queue.sniffImageMime(Buffer.from('<html>not an image at all</html>'), 'image/png'), '');
});

test('CoreNectum dışındaki bir adres indirilmez', async () => {
  await assert.rejects(() => queue.downloadImage('https://evil.example.com/Attachment/GetAttachment/x', { maxAttempts: 1 }),
    error => error.code === 'PLM_IMAGE_URL_INVALID');
});

test('sınırlı kuyruk eşzamanlılık tavanını aşmaz', async () => {
  let active = 0;
  let peak = 0;
  await queue.runBounded(Array.from({ length: 40 }, (_, index) => index), async () => {
    active += 1; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active -= 1;
  }, { concurrency: 8 });
  assert.ok(peak <= 8, `eşzamanlılık tavanı aşıldı: ${peak}`);
  assert.ok(peak > 1, 'kuyruk gerçekten paralel çalışmalı');
});

/* ---------- kontrol noktası / yeniden deneme ---------- */

test('kontrol noktası diske yazılır; yeniden başlatmadan sonra kalan iş sürer', () => {
  const items = Array.from({ length: 60 }, (_, index) => ({ plmId: String(9000000 + index), colourCode: 'CVL', colour: 'A' }));
  const checkpoint = jobStore.createCheckpoint({ jobId: 'job_resume_1', userId: 'u1', items, mode: 'all' });
  for (const item of items.slice(0, 40)) checkpoint.complete(item);
  checkpoint.flush();

  // "Yeniden başlatma": kayıt yalnız diskten okunur.
  const resumed = jobStore.resumeCheckpoint('job_resume_1');
  assert.ok(resumed, 'kayıt diskte kalmalı');
  assert.equal(resumed.pending().length, 20);
  assert.equal(resumed.record().counts.requested, 60);
});

test('Retry Failed YALNIZ başarısız kalemleri döndürür', () => {
  const items = [
    { plmId: '1', colourCode: 'A', colour: '' },
    { plmId: '2', colourCode: 'B', colour: '' },
    { plmId: '3', colourCode: 'C', colour: '' },
  ];
  const checkpoint = jobStore.createCheckpoint({ jobId: 'job_retry_1', userId: 'u1', items, mode: 'all' });
  checkpoint.complete(items[0]);
  checkpoint.fail({ plmId: '2', colourCode: 'B', code: 'PLM_IMAGE_DOWNLOAD_FAILED', error: 'x' });
  checkpoint.finish(jobStore.STATUS_PARTIAL);

  const retry = jobStore.retryItems('job_retry_1');
  assert.deepEqual(retry.map(item => item.plmId), ['2']);
});

test('iş kaydı erişim anahtarı TAŞIMAZ', () => {
  const checkpoint = jobStore.createCheckpoint({
    jobId: 'job_token_1', userId: 'u1', mode: 'all',
    items: [{ plmId: '1', colourCode: 'A' }],
    // Kasıtlı olarak sızdırma denemesi: normalize edilerek düşmeli.
    accessToken: 'Bearer secret-value', authorization: 'Bearer secret-value',
  });
  const serialized = JSON.stringify(checkpoint.record());
  assert.doesNotMatch(serialized, /secret-value/);
  assert.doesNotMatch(serialized, /Bearer/i);
  assert.doesNotMatch(serialized, /accessToken/i);
});

test('sahiplik kaydı kaybolursa davranış GÜVENLİ tarafa düşer (her şey manuel)', () => {
  const empty = ownership.emptyStore();
  const state = ownership.ownershipOf(empty, 'plm:1|colour:CVL', 'ci_1');
  assert.equal(state.state, ownership.OWNERSHIP_MANUAL);
  assert.equal(ownership.canWriteAutomatic(empty, 'plm:1|colour:CVL', 'ci_1').allowed, false);
  // Mezar taşı / boş referans sahipsizdir: eksik görsel yeniden yüklenir.
  assert.equal(ownership.ownershipOf(empty, 'plm:1|colour:CVL', '').state, ownership.OWNERSHIP_UNOWNED);
});

test('progress sayıları uydurulmaz — her biri gerçekten sayılan iştir', async () => {
  const { input } = harness({
    requests: [
      { plmId: '2123595', colourCode: 'CVL', colour: 'A' },
      { plmId: '2121459', colourCode: 'ZZZ', colour: 'B' },
    ],
  });
  const run = await service.runPlmImageSync(input);
  assert.equal(run.counts.requested, 2);
  assert.equal(run.counts.resolved, 2);
  assert.equal(run.counts.stylesProcessed, 2);
  assert.equal(run.counts.optionImagesFound, 1);
  assert.equal(run.counts.fallbacksUsed, 1);
  assert.equal(run.counts.downloadsCompleted, 2);
  assert.ok(run.counts.bytesDownloaded > 0);
});

test('aynı Attachment birden çok renkte seçilse de bayt TEK kez indirilir', async () => {
  const { calls, input } = harness({
    requests: [
      { plmId: '2123595', colourCode: 'AAA', colour: 'A' },
      { plmId: '2123595', colourCode: 'BBB', colour: 'B' },
    ],
    // İki renk de eşleşmiyor -> ikisi de aynı Style List görseline düşer.
    styleImagesLookup: async () => styleImagesPayload({}),
  });
  const run = await service.runPlmImageSync(input);
  assert.equal(calls.downloads.length, 1, 'aynı adres iki kez indirilmemeli');
  assert.equal(run.uniqueDownloads, 1);
  assert.equal(run.counts.fallbacksUsed, 2);
});

test.after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} });
