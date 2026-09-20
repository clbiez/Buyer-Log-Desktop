'use strict';

/* v11.00 — HAZIR PLM GÖRSEL PAKETİ (BUYERLOG_IMPORT).
 *
 * Bu dosyanın koruduğu regression:
 *   - manifest bir SÖZLEŞMEDİR: tür/sürüm doğrulanmadan hiçbir şey yazılmaz,
 *   - selectedPath DIŞ KAYNAKTIR: mutlak yol, '..' ve selected/ dışına
 *     taşan yollar REDDEDİLİR,
 *   - uzantıya değil BAYTLARA bakılır (gerçek pakette .bmp/.jfif uzantılı
 *     dosyaların baytları PNG çıktı),
 *   - önizleme HİÇBİR ŞEY YAZMAZ ve gerçek sayıları gösterir,
 *   - içe aktarma CANLI SENKRONLA AYNI kanonik alım yolunu kullanır,
 *   - paket klasörü sonradan SİLİNSE de görseller çalışmaya devam eder.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-plm-package-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(TMP, 'server');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(TMP, 'local');
fs.mkdirSync(process.env.BUYER_LOG_SERVER_DATA_ROOT, { recursive: true });
fs.mkdirSync(process.env.BUYER_LOG_LOCAL_DATA_ROOT, { recursive: true });

const pkg = require('../server/lib/plm-image-package');
const ingestLib = require('../server/lib/plm-image-ingest');
const ownership = require('../server/lib/plm-image-ownership');
const service = require('../server/lib/plm-image-sync-service');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const png = tag => Buffer.concat([PNG, Buffer.from(String(tag))]);

/* Gerçek paketin biçimiyle BİREBİR aynı bir örnek üretir: BOM'lu manifest,
   ters bölülü Windows yolları, selected/<PLM>/<ColourCode>/selected.<ext>. */
function buildPackage(name, entries, manifestPatch = {}) {
  const root = path.join(TMP, name);
  fs.mkdirSync(path.join(root, 'selected'), { recursive: true });
  const manifestEntries = entries.map(entry => {
    if (entry.bytes) {
      const dir = path.join(root, 'selected', entry.plmCode, entry.colourCode);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `selected.${entry.ext || 'png'}`), entry.bytes);
    }
    return {
      plmCode: entry.plmCode,
      colourCode: entry.colourCode,
      styleId: entry.styleId || '2500000',
      styleName: entry.styleName || 'TEST',
      sourceType: entry.sourceType || 'OPTION',
      selectionReason: entry.selectionReason || 'Exact ColourCode Option Image.',
      selectedPath: entry.selectedPath !== undefined
        ? entry.selectedPath
        : (entry.bytes ? `selected\\${entry.plmCode}\\${entry.colourCode}\\selected.${entry.ext || 'png'}` : ''),
      originalSourcePath: 'C:\\somewhere\\original.png',
      placementMode: 'hardlink',
      status: entry.status || (entry.bytes ? 'READY' : 'MISSING'),
      testStatus: 'OK',
      testMessage: '',
    };
  });
  const manifest = {
    formatVersion: 1,
    packageType: 'buyerlog-plm-image-import',
    generatedAt: '2026-09-17T00:53:58+03:00',
    selectionPolicy: { priority: ['OPTION_EXACT_COLOUR_CODE', 'STYLE_IMAGE_IS_DEFAULT_TRUE', 'MISSING'] },
    entryCount: manifestEntries.length,
    entries: manifestEntries,
    ...manifestPatch,
  };
  // Gerçek paket BOM ile yazılıyor; BOM'lu JSON JSON.parse'ı kırar.
  fs.writeFileSync(path.join(root, 'manifest.json'), '\uFEFF' + JSON.stringify(manifest, null, 2), 'utf8');
  fs.writeFileSync(path.join(root, 'import_report.csv'), 'PLM_ID,ColourCode\n');
  return root;
}

function createFakeStore() {
  const files = new Map();
  const imagemap = {};
  let sequence = 0;
  let store = ownership.emptyStore();
  const fakeOwnership = { ...ownership, loadOwnership: () => store, saveOwnership: next => { store = next; return next; } };
  const ingest = ingestLib.createPlmImageIngest({
    owner: ownership.OWNER_PACKAGE,
    ownership: fakeOwnership,
    getImage: ref => (files.has(ref) ? { item: files.get(ref), full: ref } : null),
    readImageBytes: found => files.get(found.item.id).buffer,
    saveImage: ({ rowId, filename, mimeType, base64 }) => {
      sequence += 1;
      const id = `ci_${sequence}`;
      const buffer = Buffer.from(base64, 'base64');
      const item = { id, rowId, filename, mimeType, size: buffer.length, url: `/api/collection-images/${id}`, updatedAt: `t${sequence}`, buffer };
      files.set(id, item);
      return item;
    },
    deleteImage: ref => files.delete(ref),
    patchLinks: links => {
      for (const link of links) { const key = ingestLib.canonicalKeyFor(link); if (key) imagemap[key] = String(link.imageRef || ''); }
      return { overrides: { imagemap }, updated: links.length };
    },
  });
  return { files, imagemap, ingest, ownership: fakeOwnership, store: () => store };
}

function context(fake, extra = {}) {
  return {
    imagemap: fake.imagemap,
    store: fake.store(),
    ownership: fake.ownership,
    hasStoredFile: ref => fake.files.has(String(ref || '')),
    ...extra,
  };
}

test('geçerli paket önizlenir ve sayılar gerçeği gösterir', () => {
  const fake = createFakeStore();
  const root = buildPackage('valid', [
    { plmCode: '1202929', colourCode: 'FFS', bytes: png('a') },
    { plmCode: '2086503', colourCode: 'ZAK', bytes: png('b'), sourceType: 'STYLE_DEFAULT' },
    { plmCode: '1167092', colourCode: 'GRD', sourceType: 'MISSING', status: 'MISSING' },
  ]);
  const preview = pkg.previewPackage(root, context(fake));
  assert.equal(preview.packageType, 'buyerlog-plm-image-import');
  assert.equal(preview.formatVersion, 1);
  assert.equal(preview.counts.total, 3);
  assert.equal(preview.counts.ready, 2);
  assert.equal(preview.counts.missing, 1);
  assert.equal(preview.counts.invalid, 0);
  assert.equal(preview.counts.newImages, 2);
  assert.deepEqual(preview.counts.bySource, { OPTION: 1, STYLE_DEFAULT: 1 });
  // Önizleme HİÇBİR ŞEY yazmaz.
  assert.equal(fake.files.size, 0);
  assert.equal(Object.keys(fake.imagemap).length, 0);
});

test('paket türü / biçim sürümü doğrulanmadan hiçbir şey okunmaz', () => {
  const badType = buildPackage('bad-type', [{ plmCode: '1', colourCode: 'A', bytes: png('x') }], { packageType: 'something-else' });
  assert.throws(() => pkg.readPackageManifest(badType), error => error.code === 'PLM_PACKAGE_TYPE_UNSUPPORTED');

  const badVersion = buildPackage('bad-version', [{ plmCode: '1', colourCode: 'A', bytes: png('x') }], { formatVersion: 99 });
  assert.throws(() => pkg.readPackageManifest(badVersion), error => error.code === 'PLM_PACKAGE_VERSION_UNSUPPORTED');

  assert.throws(() => pkg.readPackageManifest(path.join(TMP, 'does-not-exist')), error => error.code === 'PLM_PACKAGE_MANIFEST_NOT_FOUND');
});

test('BOM’lu manifest okunabilir (gerçek paket BOM ile yazılıyor)', () => {
  const root = buildPackage('bom', [{ plmCode: '1202929', colourCode: 'FFS', bytes: png('a') }]);
  const raw = fs.readFileSync(path.join(root, 'manifest.json'), 'utf8');
  assert.equal(raw.charCodeAt(0), 0xFEFF, 'örnek gerçekten BOM taşımalı');
  assert.equal(pkg.readPackageManifest(root).entries.length, 1);
});

test('yol kaçışı (path traversal) her biçimde reddedilir', () => {
  const root = path.join(TMP, 'traversal-root');
  const unsafe = [
    'selected\\..\\..\\windows\\system32\\evil.png',
    '..\\outside.png',
    'C:\\Windows\\System32\\evil.png',
    '/etc/passwd',
    '\\\\server\\share\\evil.png',
    'selected/../../escape.png',
  ];
  for (const value of unsafe) {
    const resolved = pkg.resolveSelectedPath(root, value);
    assert.equal(resolved.ok, false, `kabul edilmemeliydi: ${value}`);
    assert.match(resolved.code, /PLM_PACKAGE_PATH_(TRAVERSAL|ABSOLUTE|UNSAFE|EMPTY)/);
  }
  // selected/ kökünün İÇİNDEKİ yol kabul edilir.
  const ok = pkg.resolveSelectedPath(root, 'selected\\1202929\\FFS\\selected.png');
  assert.equal(ok.ok, true);
  assert.ok(ok.full.startsWith(path.join(path.resolve(root), 'selected')));
});

test('manifestte geçen ama diskte olmayan dosya reddedilir', () => {
  const fake = createFakeStore();
  const root = buildPackage('missing-file', [{ plmCode: '1', colourCode: 'A', bytes: png('x') }]);
  fs.unlinkSync(path.join(root, 'selected', '1', 'A', 'selected.png'));
  const preview = pkg.previewPackage(root, context(fake));
  assert.equal(preview.counts.invalid, 1);
  assert.equal(preview.counts.ready, 0);
  assert.equal(preview.samples.invalid[0].code, 'PLM_PACKAGE_FILE_MISSING');
});

test('görsel olmayan dosya reddedilir; uzantıya değil BAYTLARA bakılır', () => {
  const fake = createFakeStore();
  const root = buildPackage('bad-image', [
    // .bmp uzantılı ama baytları PNG — GERÇEK pakette bu vardı, kabul edilmeli.
    { plmCode: '1095627', colourCode: 'HRC', bytes: png('real-png'), ext: 'bmp' },
    // .png uzantılı ama gövdesi HTML — reddedilmeli.
    { plmCode: '2', colourCode: 'B', bytes: Buffer.from('<html>error page body</html>') },
  ]);
  const preview = pkg.previewPackage(root, context(fake));
  assert.equal(preview.counts.ready, 1, 'PNG baytlı .bmp kabul edilmeli');
  assert.equal(preview.counts.invalid, 1);
  assert.equal(preview.samples.invalid[0].code, 'PLM_PACKAGE_FILE_NOT_IMAGE');
});

test('paket içe aktarması CANLI SENKRONLA AYNI kanonik yolu kullanır ve paket silinse de çalışır', async () => {
  const fake = createFakeStore();
  const root = buildPackage('commit', [
    { plmCode: '1202929', colourCode: 'FFS', bytes: png('alpha') },
    { plmCode: '2086503', colourCode: 'ZAK', bytes: png('beta'), sourceType: 'STYLE_DEFAULT' },
  ]);
  const info = pkg.readPackageManifest(root);
  const classified = pkg.classifyPackageEntries(info, context(fake));
  const ready = classified.entries.filter(entry => entry.status === pkg.ENTRY_READY);
  assert.equal(ready.length, 2);

  const run = await service.runPackageImport({
    entries: ready,
    ingest: fake.ingest,
    readImage: file => fs.readFileSync(file),
    imagemap: fake.imagemap,
    store: fake.store(),
  });
  assert.equal(run.status, 'completed');
  assert.equal(run.counts.downloadsCompleted, 2);
  assert.equal(Object.keys(fake.imagemap).length, 2);

  // Kanonik depoda baytlar var; kayıt oraya işaret ediyor.
  const refs = Object.values(fake.imagemap);
  for (const ref of refs) assert.ok(fake.files.get(ref).buffer.length > 0);

  // PAKET SİLİNİR — görseller yine kanonik depodan çözülür.
  fs.rmSync(root, { recursive: true, force: true });
  assert.equal(fs.existsSync(root), false);
  for (const ref of refs) {
    const stored = fake.files.get(ref);
    assert.ok(stored && stored.buffer.length > 0, 'paket silindikten sonra da bayt olmalı');
    assert.match(stored.mimeType, /^image\//);
  }
});

test('paket içe aktarması kullanıcının ELLE koyduğu görseli varsayılan olarak korur', () => {
  const fake = createFakeStore();
  const root = buildPackage('manual', [{ plmCode: '1202929', colourCode: 'FFS', bytes: png('alpha') }]);
  const key = ingestLib.canonicalKeyFor({ plmId: '1202929', colourCode: 'FFS' });
  fake.files.set('manual_1', { id: 'manual_1', url: '/x', mimeType: 'image/png', size: 4, updatedAt: 'm', buffer: png('manual') });
  fake.imagemap[key] = 'manual_1';

  const info = pkg.readPackageManifest(root);
  const preserved = pkg.classifyPackageEntries(info, context(fake));
  assert.equal(preserved.counts.manualPreserved, 1);
  assert.equal(preserved.counts.ready, 0);

  // Kullanıcı AÇIKÇA isterse üzerine yazılabilir.
  const overwrite = pkg.classifyPackageEntries(info, context(fake, { overwriteManual: true }));
  assert.equal(overwrite.counts.ready, 1);
  assert.equal(overwrite.counts.manualConflicts, 1, 'kaç manuel görselin ezileceği önizlemede görünmeli');
});

test('aynı paket ikinci kez aktarıldığında önbellek isabeti olur', async () => {
  const fake = createFakeStore();
  const root = buildPackage('cache', [{ plmCode: '1202929', colourCode: 'FFS', bytes: png('alpha') }]);
  const info = pkg.readPackageManifest(root);

  const first = pkg.classifyPackageEntries(info, context(fake));
  await service.runPackageImport({
    entries: first.entries.filter(entry => entry.status === pkg.ENTRY_READY),
    ingest: fake.ingest, readImage: file => fs.readFileSync(file),
    imagemap: fake.imagemap, store: fake.store(),
  });

  const second = pkg.classifyPackageEntries(info, context(fake));
  assert.equal(second.counts.cached, 1, 'aynı içerik ikinci kez yazılmamalı');
  assert.equal(second.counts.ready, 0);
});

test('pakette görseli olmayan girdi MEVCUT geçerli görseli silmez', () => {
  const fake = createFakeStore();
  const root = buildPackage('missing-entry', [{ plmCode: '1167092', colourCode: 'GRD', sourceType: 'MISSING', status: 'MISSING' }]);
  const key = ingestLib.canonicalKeyFor({ plmId: '1167092', colourCode: 'GRD' });
  fake.files.set('existing_1', { id: 'existing_1', url: '/x', mimeType: 'image/png', size: 4, updatedAt: 'e', buffer: png('existing') });
  fake.imagemap[key] = 'existing_1';

  const info = pkg.readPackageManifest(root);
  const classified = pkg.classifyPackageEntries(info, context(fake));
  assert.equal(classified.counts.missing, 1);
  assert.equal(fake.imagemap[key], 'existing_1');
});

test('PLM ID ve Renk Kodu kanonik yardımcılarla normalize edilir', () => {
  const entry = pkg.normalizeEntry({ plmCode: '0001202929', colourCode: ' ffs ', styleId: '2191881.0', sourceType: 'option' });
  assert.equal(entry.plmId, '1202929');
  assert.equal(entry.colourCode, 'FFS');
  assert.equal(entry.styleId, '2191881');
  assert.equal(entry.sourceType, 'OPTION');
});

test.after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} });
