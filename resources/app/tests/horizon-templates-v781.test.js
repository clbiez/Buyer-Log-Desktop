'use strict';

/* Horizon şablonları: kaydedilmiş hazır ufuklar + paylaşım.
 *
 * Kullanıcı kararı: "Kişisel horizon konusunu sevmedim. Horizonlar tek bir
 * yerden, data management'dan ayarlansın. Ancak ön ayarlı, kaydedilmiş hazır
 * horizonlar yapısını beğeniyorum. Başkalarıyla horizon paylaşma konusu da
 * iyi. Bunları Data Management sayfasında yapabilelim."
 *
 * Ön ayar bu oturumda bir kez KALDIRILMIŞTI (o zamanki kararla). Şimdi
 * sıfırdan, Data Management'ın kendi diline uygun kuruldu: bir şablon =
 * kaydedilmiş filtre tanımı (table + groups) + ad. Eski horizon-presets.json
 * dosyasına DOKUNULMADI; veri diskte duruyor.
 *
 * TASARIM KARARI (bu testlerin koruduğu): şablon ikinci bir yazma yolu
 * AÇMAZ. Uygulanınca yalnız editörün koşullarını doldurur; ortak filtreyi
 * yine /api/data-management/filter yazar. İki ayrı doğruluk kaynağı olsaydı
 * hangisinin geçerli olduğu belirsizleşirdi.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVER = require('./helpers/server-source')();
const EDITOR = fs.readFileSync(path.join(ROOT, 'public', 'data-management-filter.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'data-management.css'), 'utf8');
const DB_SRC = fs.readFileSync(path.join(ROOT, 'server', 'db.js'), 'utf8');

/* --- Depo: izole bir veri kökünde gerçekten çalıştır -------------------- */

function freshDb() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-horizon-'));
  process.env.BUYER_LOG_SERVER_DATA_ROOT = root;
  for (const name of ['../server/user-data', '../server/db']) {
    delete require.cache[require.resolve(name)];
  }
  return { db: require('../server/db'), root };
}

const DEFINITION = {
  table: 'Dim',
  groups: [{ id: 'g1', conditions: [{ field: 'Country', operator: 'in', values: ['TR'] }] }],
};

test('kişisel ve paylaşılan şablonlar AYRI depolarda durur', () => {
  const { db } = freshDb();
  db.addHorizonTemplate('ali', 'Ali Ufku', DEFINITION, null);
  db.addHorizonTemplate('Ortak Ufuk', DEFINITION, null);

  const personal = db.loadHorizonTemplates('ali');
  const shared = db.loadHorizonTemplates();
  assert.equal(personal.items.length, 1, 'kişisel şablon kişisel depoda olmalı');
  assert.equal(shared.items.length, 1, 'paylaşılan şablon ortak depoda olmalı');
  assert.equal(personal.items[0].name, 'Ali Ufku');
  assert.equal(shared.items[0].name, 'Ortak Ufuk');
});

test('başka kullanıcı, birinin KİŞİSEL şablonunu görmez', () => {
  const { db } = freshDb();
  db.addHorizonTemplate('ali', 'Ali Ufku', DEFINITION, null);
  assert.equal(db.loadHorizonTemplates('veli').items.length, 0);
});

test('şablon türü kendi kovasında: filtre profilleriyle karışmaz', () => {
  /* kind eskiden beş yerde "VIEWS_FILE ? 'view' : 'filter'" diye sabit
     kodluydu; üçüncü tür eklenince hepsi sessizce 'filter' derdi ve
     şablonlar filtre profilleriyle aynı kovaya düşerdi. */
  const { db } = freshDb();
  db.addHorizonTemplate('ali', 'Ali Ufku', DEFINITION, null);
  assert.equal(db.loadHorizonTemplates('ali').kind, 'horizonTemplate');
  assert.equal(db.loadFilterProfiles('ali').items.length, 0,
    'şablon, filtre profilleri deposuna sızmamalı');
  assert.equal(db.loadViews('ali').items.length, 0,
    'şablon, görünüm deposuna sızmamalı');
});

test('şablon tanımı (table + groups) kayıpsız geri okunur', () => {
  const { db } = freshDb();
  db.addHorizonTemplate('ali', 'Ali Ufku', DEFINITION, null);
  const stored = db.loadHorizonTemplates('ali').items[0].data;
  assert.equal(stored.table, 'Dim');
  assert.equal(stored.groups[0].conditions[0].field, 'Country');
  assert.deepEqual(stored.groups[0].conditions[0].values, ['TR']);
});

test('silme yalnız hedefi düşürür', () => {
  const { db } = freshDb();
  db.addHorizonTemplate('ali', 'Bir', DEFINITION, null);
  db.addHorizonTemplate('ali', 'İki', DEFINITION, null);
  const list = db.loadHorizonTemplates('ali').items;
  db.deleteHorizonTemplate('ali', list[0].id, null);
  const kalan = db.loadHorizonTemplates('ali').items;
  assert.equal(kalan.length, 1);
  assert.equal(kalan[0].name, 'İki');
});

/* --- Sunucu uçları ------------------------------------------------------ */

test('uçlar filtre yazma ile AYNI yetki kapısından geçer', () => {
  /* Şablon uygulanınca ortak filtreye dönüşüyor; daha gevşek bir kapı,
     filtre yazma yetkisini dolaylı yoldan dağıtmak olurdu. */
  for (const route of [
    "app.get('/api/horizon-templates'",
    "app.post('/api/horizon-templates'",
    "app.delete('/api/horizon-templates/:id'",
    "app.post('/api/horizon-templates/:id/share'",
  ]) {
    const at = SERVER.indexOf(route);
    assert.ok(at > -1, `${route} yok`);
    const line = SERVER.slice(at, SERVER.indexOf('\n', at));
    assert.match(line, /userAccess\.requireArea\('source'\)/, `${route} alan kontrolü yok`);
    assert.match(line, /userAccess\.requirePermission\('manageModelConnections'\)/, `${route} yetki kontrolü yok`);
  }
});

test('paylaşılan şablonu herkes silemez — sahibi veya moderatör', () => {
  const at = SERVER.indexOf("app.delete('/api/horizon-templates/:id'");
  const block = SERVER.slice(at, at + 1800);
  assert.match(block, /NOT_OWNER/, 'sahiplik kontrolü yok');
  assert.match(block, /horizonTemplateService\.execute\('delete'/);
  const native=fs.readFileSync(path.join(ROOT,'server/lib/horizon-template-service.js'),'utf8');
  assert.match(native, /selected\?\.userId===ctx\.ownerId/);
  assert.match(native, /hasPermission\(current,'manageAllOrders'\)/);
});

test('paylaşım KOPYALAR, taşımaz', () => {
  /* Kişisel kayıt sahibinde kalmalı: paylaşılanı biri silince kimsenin
     kendi şablonu kaybolmasın. */
  const at = SERVER.indexOf("app.post('/api/horizon-templates/:id/share'");
  const block = SERVER.slice(at, at + 1200);
  assert.match(block, /horizonTemplateService\.execute\('share'/);
  const native=fs.readFileSync(path.join(ROOT,'server/lib/horizon-template-service.js'),'utf8');
  assert.match(native, /mutateHorizonTemplates\(ctx\.ownerId/);
  assert.match(native, /api\.add/);
  assert.doesNotMatch(block, /deleteHorizonTemplate/, 'paylaşım kişisel kaydı silmemeli');
});

test('db fonksiyonları server.js import listesinde — db.X ile çağrılmıyor', () => {
  /* server.js'te global bir `db` nesnesi yok; db.js destructuring ile
     içeri alınıyor. db.loadHorizonTemplates(...) çalışma zamanında
     "db is not defined" verirdi (ölçüldü ve düzeltildi). */
  assert.match(SERVER, /loadHorizonTemplates, addHorizonTemplate, deleteHorizonTemplate,/);
  assert.doesNotMatch(SERVER, /db\.loadHorizonTemplates|db\.addHorizonTemplate|db\.deleteHorizonTemplate/);
});

/* --- Editör: şablon şeridi --------------------------------------------- */

test('şablon uygulamak KAYDETMEZ — yalnız koşulları doldurur', () => {
  /* Kullanıcı görüp onaylamadan ortak filtre değişmemeli. */
  const at = EDITOR.indexOf('function applyTemplate(');
  assert.ok(at > -1, 'applyTemplate yok');
  const block = EDITOR.slice(at, EDITOR.indexOf('\n  }', at));
  assert.match(block, /groups = /, 'koşulları doldurmuyor');
  assert.doesNotMatch(block, /fetch\(/, 'şablon uygulamak sunucuya yazmamalı');
  assert.doesNotMatch(block, /save\(/, 'şablon uygulamak kaydetmemeli');
});

test('şablonlar yüklenemezse editör çalışmaya devam eder', () => {
  /* Şablon bir kolaylık, filtre kurmanın önkoşulu değil. */
  const at = EDITOR.indexOf('async function loadTemplates(');
  const block = EDITOR.slice(at, EDITOR.indexOf('\n  }', at));
  assert.match(block, /catch/, 'hata yakalanmıyor');
  assert.match(block, /templates = \{ personal: \[\], shared: \[\] \}/);
});

test('şerit filtre editörünün içinde çiziliyor', () => {
  // v7.0.183: şablon uçları yönetim yetkisi istediği için şerit yalnız yetkiliye çizilir.
  assert.match(EDITOR, /\$\{canShare \? templateBar\(\) : ''\}/, 'şerit render edilmiyor');
  for (const hook of ['data-apply-template', 'data-share-template', 'data-delete-template', 'data-save-template']) {
    assert.ok(EDITOR.includes(hook), `${hook} kancası yok`);
  }
});

test('şerit stili yalnız token renk kullanıyor', () => {
  const at = CSS.indexOf('.dmfTemplates');
  assert.ok(at > -1, 'şerit CSS yok');
  const block = CSS.slice(at);
  const hardcoded = block.match(/#[0-9a-fA-F]{3,6}\b|rgb\(/g) || [];
  assert.deepEqual(hardcoded, [], `token dışı renk: ${hardcoded.join(', ')}`);
});

test('eski horizon-presets.json dosyasına dokunulmadı', () => {
  /* Kullanıcı "sıfırdan yeniden tasarla" dedi; eski veri kurtarılmadı ama
     SİLİNMEDİ de. Bir kararı geri almak isterse dosya yerinde. */
  assert.match(DB_SRC, /horizon-templates\.json/);
  assert.doesNotMatch(DB_SRC, /horizon-presets\.json/,
    'db.js eski ön ayar dosyasına yazmamalı');
});
