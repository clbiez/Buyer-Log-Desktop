'use strict';

/* v11.01 — KULLANICI YOLU YAPIŞTIRIR.
 *
 * Gerçek kullanımda yol Gezgin'den kopyalanır ve üç biçimde gelir:
 *   C:\...\BUYERLOG_IMPORT        (Adres çubuğu)
 *   C:\...\BUYERLOG_IMPORT\       (sondaki ters bölü)
 *   "C:\...\BUYERLOG_IMPORT"      ("Yol olarak kopyala" — TIRNAKLI)
 *
 * Üçü de aynı klasörü gösterir. Yalnız yazım farkı yüzünden "klasör
 * bulunamadı" demek kullanıcıyı gerçek bir sorun yokken durdurur.
 *
 * Ayrıca en sık hata paket klasörünün BİR ÜSTÜNÜ seçmektir; bu durumda
 * doğru klasörün nerede olduğu söylenmelidir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-path-input-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(TMP, 'server');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(TMP, 'local');
fs.mkdirSync(process.env.BUYER_LOG_SERVER_DATA_ROOT, { recursive: true });
fs.mkdirSync(process.env.BUYER_LOG_LOCAL_DATA_ROOT, { recursive: true });

const pkg = require('../server/lib/plm-image-package');

/* Gerçek paketin küçük bir kopyası. */
const PARENT = path.join(TMP, 'output_20260917_002642');
const PACKAGE = path.join(PARENT, 'BUYERLOG_IMPORT');
fs.mkdirSync(path.join(PACKAGE, 'selected', '1202929', 'FFS'), { recursive: true });
fs.writeFileSync(path.join(PACKAGE, 'selected', '1202929', 'FFS', 'selected.png'),
  Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'));
fs.writeFileSync(path.join(PACKAGE, 'manifest.json'), '\uFEFF' + JSON.stringify({
  formatVersion: 1, packageType: 'buyerlog-plm-image-import', entryCount: 1,
  entries: [{ plmCode: '1202929', colourCode: 'FFS', styleId: '2191881', styleName: 'OXFORD-YD',
    sourceType: 'OPTION', selectedPath: 'selected\\1202929\\FFS\\selected.png', status: 'READY' }],
}), 'utf8');

/* server.js'teki plmPackageRootFrom ile AYNI normalizasyon. Rota gövdesi
   tek satırlık olduğu için burada davranışı birebir yeniden kuruyoruz;
   aşağıdaki kaynak-sözleşme testi ikisinin ayrışmasını engeller. */
function normalizeFolderInput(value) {
  let raw = String(value == null ? '' : value)
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) raw = raw.slice(1, -1).trim();
  return path.resolve(raw);
}

test('adres çubuğu, sondaki ters bölü ve tırnaklı yol aynı paketi açar', () => {
  const variants = [
    PACKAGE,
    PACKAGE + path.sep,
    `"${PACKAGE}"`,
    `  ${PACKAGE}  `,
    `\u202a${PACKAGE}\u202c`, // kopyalamada araya giren görünmez yön işaretleri
  ];
  for (const value of variants) {
    const info = pkg.readPackageManifest(normalizeFolderInput(value));
    assert.equal(info.entries.length, 1, `başarısız giriş biçimi: ${JSON.stringify(value)}`);
  }
});

test('paket klasörünün ÜSTÜ seçilirse doğru klasör söylenir', () => {
  assert.throws(
    () => pkg.readPackageManifest(normalizeFolderInput(PARENT)),
    error => error.code === 'PLM_PACKAGE_MANIFEST_NOT_FOUND'
      && error.message.includes('BUYERLOG_IMPORT'),
  );
});

test('gerçekten var olmayan klasörde ipucu uydurulmaz', () => {
  assert.throws(
    () => pkg.readPackageManifest(normalizeFolderInput(path.join(TMP, 'yok-boyle-bir-klasor'))),
    error => error.code === 'PLM_PACKAGE_MANIFEST_NOT_FOUND'
      && !error.message.includes('alt klasörde'),
  );
});

test('sunucu rotası da aynı normalizasyonu uygular', () => {
  const server = require('./helpers/server-source')();
  const block = server.slice(server.indexOf('function plmPackageRootFrom('), server.indexOf('function plmPackageContext('));
  assert.match(block, /u200e/, 'görünmez yön işaretleri temizlenmeli');
  assert.match(block, /raw\.startsWith\('"'\) && raw\.endsWith\('"'\)/, 'tırnaklı yol kabul edilmeli');
  assert.match(block, /raw\.slice\(1, -1\)/);
  assert.match(block, /path\.resolve\(raw\)/);
});

test.after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} });
