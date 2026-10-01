'use strict';

/* CP görseli silme/güncelleme ekranda eski görseli bırakıyordu.
   PLM ingest görseli renk adlı anahtara (plm:X|colour:Y|name:Z) yazar ve
   gösterim bu anahtarı renk kodu anahtarından ÖNCE okur. CP silme/güncelleme
   yalnız plm:X|colour:Y anahtarını değiştirdiği için eski adlı kayıt yeni
   seçimi gölgeliyordu: "kaldırıldı/kaydedildi" denip eski görsel kalıyordu. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-cp-named-image-'));
Object.assign(process.env, {
  BUYER_LOG_SERVER_DATA_ROOT: path.join(root, 'data'),
  BUYER_LOG_DATA_ROOT: path.join(root, 'app'),
  BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local'),
  BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json'),
});

const db = require('../server/db');
const ROOT = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');

const CODE_KEY = 'plm:9001|colour:C01';
const NAMED_KEY = 'plm:9001|colour:C01|name:BLACK';
const OTHER_KEY = 'plm:9001|colour:C09|name:WHITE';

function seed() {
  const ov = db.loadOverrides();
  ov.imagemap = { [NAMED_KEY]: 'plm-old.png', [OTHER_KEY]: 'plm-white.png' };
  db.saveOverrides(ov, ov._revision);
}

test('CP görseli güncellemesi aynı PLM+renk kodunun adlı anahtarlarını da yeni ref ile revize eder', () => {
  seed();
  const { overrides } = db.patchOrderOverride(1234567, { plmId: 9001, colourCode: 'C01', imagePlmId: 9001, imageColourCode: 'C01', imageRef: 'cp-new.png' });
  assert.equal(overrides.imagemap[CODE_KEY], 'cp-new.png');
  assert.equal(overrides.imagemap[NAMED_KEY], 'cp-new.png');
  assert.equal(overrides.imagemap[OTHER_KEY], 'plm-white.png', 'başka renk kodu etkilenmez');
});

test('CP görseli silme adlı anahtara da mezar taşı yazar; eski PLM görseli geri gelmez', () => {
  seed();
  const { overrides } = db.patchOrderOverride(1234567, { plmId: 9001, colourCode: 'C01', imagePlmId: 9001, imageColourCode: 'C01', imageRef: '' });
  assert.equal(overrides.imagemap[CODE_KEY], '');
  assert.equal(overrides.imagemap[NAMED_KEY], '');
  assert.equal(overrides.imagemap[OTHER_KEY], 'plm-white.png');
});

test('istemci yerel imagemap kaydını da adlı anahtarlarla birlikte günceller', () => {
  assert.match(app, /function cpWriteImageIdentityRef\(map,imageKey,ref\)/);
  const save = app.slice(app.indexOf('async function cpSaveRowImage('), app.indexOf('async function cpRemoveRowImage('));
  const remove = app.slice(app.indexOf('async function cpRemoveRowImage('), app.indexOf('function cpApplyImageRowHeight('));
  assert.match(save, /const namedRefs=cpWriteImageIdentityRef\(state\.overrides\.imagemap,imageKey,newRef\)/);
  assert.match(remove, /const namedRefs=cpWriteImageIdentityRef\(state\.overrides\.imagemap,imageKey,''\)/);
});

test('adlı kayıttan gelen PLM/Koleksiyon dosyası CP silmesinde depodan silinmez', () => {
  const save = app.slice(app.indexOf('async function cpSaveRowImage('), app.indexOf('async function cpRemoveRowImage('));
  const remove = app.slice(app.indexOf('async function cpRemoveRowImage('), app.indexOf('function cpApplyImageRowHeight('));
  assert.match(save, /!namedRefs\.has\(oldRef\)[^\n]*cpDeleteImageRef\(oldRef\)/);
  assert.match(remove, /!namedRefs\.has\(oldRef\)[^\n]*cpDeleteImageRef\(oldRef\)/);
});
