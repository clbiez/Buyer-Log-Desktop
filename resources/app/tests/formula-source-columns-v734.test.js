'use strict';

/*
 * v7.34 — HESAPLANAN SÜTUN KAYNAK LİSTESİ: VERİ TABANI SÜTUNLARI
 *
 * Kullanıcı talebi (birebir):
 *   "Sonradan \"Add Column\" ile eklediğim sütunlar \"Add calculated column\"
 *    alanında görünmüyor. \"Add calculated column\" alanında tablonun dışında
 *    ASAS'dan ve IAS - ANTREPO'dan da sütun ekleyebilmek istiyorum."
 *
 * KUSURUN SEBEBİ (kaynağında kanıtlanır):
 *   "Sütun Ekle" ile eklenen veri tabanı sütununun satır anahtarı sunucuda
 *   "__CPX_<id>" olarak üretilir (server/db.js · normalizeCpModelColumns).
 *   Kaynak listesi ise "__ ile başlayan her anahtarı atla" diyordu; kural iç
 *   yardımcı alanlar için vardı ama kullanıcının kendi eklediği sütunları da
 *   eliyordu. Bu yüzden hiç görünmüyorlardı.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const FC = read('public/formula-columns.js');
const APP = read('public/app-main.js');
const DB = read('server/db.js');
const CSS = read('public/app.css');

/* Tarayıcı modülünü düğüm ortamında yükler. window/document taklit edilir ve
   YERİNDE BIRAKILIR: modül kapanışları window'a çalışma anında başvurur, geri
   almak testin kendisini bozardı. */
global.document = { readyState: 'complete', addEventListener() {} };
global.window = global;
require('../public/formula-engine.js');
global.window.BLFormulaEngine = global.BLFormulaEngine;

function loadModule(win) {
  Object.assign(global.window, win || {});
  delete require.cache[require.resolve('../public/formula-columns.js')];
  require('../public/formula-columns.js');
  return global.window.BLFormulaColumns;
}

/* CP sütun listesi taklidi: gerçek uygulamadaki alan adlarıyla. */
const CP_COLS = [
  { k: 'Order Code', label: 'Sipariş Kodu' },
  { k: 'Ex-factory', label: 'Ex-factory' },
  { k: '__picture', label: 'Görsel' },                    // iç yardımcı alan
  { k: '__f_fc_a', label: 'Üretim Süresi', formulaCustom: true, formulaId: 'fc_a' },
  { k: '__CPX_cpx_m1', label: 'Üretici Kodu', modelCustom: true, role: 'asas', modelColumnId: 'cpx_m1' },
  { k: '__CPX_cpx_m2', label: 'Antrepo Adedi', modelCustom: true, role: 'antrepo', modelColumnId: 'cpx_m2' },
];

/* ------------------------------------------------------------------ */
/* 1) ASIL KUSUR                                                       */
/* ------------------------------------------------------------------ */

test('v7.34 · "Sütun Ekle" ile eklenen ASAS/IAS sütunları kaynak listesinde görünür', () => {
  const api = loadModule({ COLS_BY_TABLE: { cp: CP_COLS } });
  const names = api.sourceColumns('cp').map(col => col.label);
  assert.ok(names.includes('Üretici Kodu'), 'ASAS sütunu listede olmalı — kullanıcının bildirdiği kusur buydu');
  assert.ok(names.includes('Antrepo Adedi'), 'IAS/Antrepo sütunu listede olmalı');
});

test('v7.34 · sunucu anahtarı gerçekten "__CPX_" ile başlıyor (kusurun sebebi kaynağında)', () => {
  assert.match(DB, /header: `__CPX_\$\{id\}`/,
    'sebep varsayım değil: anahtar sunucuda bu biçimde üretiliyor');
});

test('v7.34 · iç yardımcı alanlar hâlâ listeye girmez', () => {
  const api = loadModule({ COLS_BY_TABLE: { cp: CP_COLS } });
  const keys = api.sourceColumns('cp').map(col => col.key);
  assert.ok(!keys.includes('__picture'), 'görsel alanı formül kaynağı değildir');
  assert.ok(!keys.includes('__f_fc_a'), 'hesaplanan sütunun iç anahtarı kullanıcıya gösterilmez');
});

test('v7.34 · veri tabanı sütunu formülde ADIYLA anılır, iç anahtarla değil', () => {
  const api = loadModule({ COLS_BY_TABLE: { cp: CP_COLS } });
  const col = api.sourceColumns('cp').find(item => item.label === 'Üretici Kodu');
  assert.equal(col.key, 'Üretici Kodu', '[__CPX_cpx_m1] okunmaz bir formül olurdu');
  assert.equal(col.model, true);
});

test('v7.34 · kaynağı görünür: ASAS ile IAS/Antrepo ayırt edilir', () => {
  /* İki bağlantı aynı adı taşıyabilir; kullanıcı hangisini seçtiğini
     görmeden doğru sütunu seçemez. */
  const api = loadModule({ COLS_BY_TABLE: { cp: CP_COLS } });
  const list = api.sourceColumns('cp');
  assert.equal(list.find(c => c.label === 'Üretici Kodu').source, 'ASAS');
  assert.equal(list.find(c => c.label === 'Antrepo Adedi').source, 'IAS · Antrepo');
  assert.match(FC, /col\.model \? `\$\{col\.label\} \(\$\{col\.source\}\)`/,
    'açılır listede kaynak yazılmalı');
});

test('v7.34 · hesaplanan sütunlar (v7.31) ve normal sütunlar bozulmadan kalır', () => {
  const api = loadModule({ COLS_BY_TABLE: { cp: CP_COLS } });
  const list = api.sourceColumns('cp');
  assert.ok(list.some(c => c.label === 'Üretim Süresi' && c.calculated), 'hesaplanan sütun listede kalmalı');
  assert.ok(list.some(c => c.key === 'Ex-factory'), 'normal sütun listede kalmalı');
  assert.equal(api.sourceColumns('cp', 'fc_a').some(c => c.calculated), false,
    'düzenlenen sütun kendi listesinde görünmez (kendine gönderme)');
});

/* ------------------------------------------------------------------ */
/* 2) DEĞER GERÇEKTEN OKUNUR                                           */
/* ------------------------------------------------------------------ */

test('v7.34 · formül, veri tabanı sütununun DEĞERİNİ okur (ad → __CPX_ çözümü)', () => {
  const store = {};
  const api = loadModule({
    COLS_BY_TABLE: { cp: CP_COLS },
    BLStorage: { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; } },
  });
  api.save('cp', [{ id: 'fc_x', label: 'Kalan', formula: '[Antrepo Adedi] - 10', format: 'auto', decimals: '' }]);
  const rows = [{ 'Order Code': 'A1', __CPX_cpx_m2: 250 }, { 'Order Code': 'A2', __CPX_cpx_m2: 40 }];
  const result = api.applyToRows('cp', rows);
  assert.deepEqual(result.errors, {}, 'hata olmamalı');
  assert.equal(rows[0].__f_fc_x, 240);
  assert.equal(rows[1].__f_fc_x, 30);
});

test('v7.34 · aynı adlı GERÇEK bir satır alanı varsa davranış değişmez (o kazanır)', () => {
  /* Ad çözümü satırın kendi alanının önüne geçseydi, mevcut formüller sessizce
     başka bir değeri okumaya başlardı (§152). */
  const store = {};
  const api = loadModule({
    COLS_BY_TABLE: { cp: CP_COLS },
    BLStorage: { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; } },
  });
  api.save('cp', [{ id: 'fc_y', label: 'Test', formula: '[Antrepo Adedi] + 0', format: 'auto', decimals: '' }]);
  const rows = [{ 'Antrepo Adedi': 7, __CPX_cpx_m2: 999 }];
  api.applyToRows('cp', rows);
  assert.equal(rows[0].__f_fc_y, 7, 'satırın kendi alanı önceliklidir');
});

test('v7.34 · değeri henüz gelmemiş sütun 0 değil HATA verir (§152)', () => {
  /* Yeni eklenen veri tabanı sütununun değerleri ilk CP yenilemesinde dolar.
     O ana kadar boş hücreyi "0" saymak, kullanıcıya yanlış bir sayıyı doğru
     gibi gösterirdi. */
  const store = {};
  const api = loadModule({
    COLS_BY_TABLE: { cp: CP_COLS },
    BLStorage: { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; } },
  });
  api.save('cp', [{ id: 'fc_z', label: 'Boş', formula: '[Üretici Kodu] + 1', format: 'auto', decimals: '' }]);
  const rows = [{ 'Order Code': 'A1' }];
  const result = api.applyToRows('cp', rows);
  assert.ok(result.errors.fc_z, 'eksik sütun sessizce sıfır olmamalı');
  assert.equal(rows[0].__f_fc_z, null);
});

/* ------------------------------------------------------------------ */
/* 3) TABLONUN DIŞINDAN SÜTUN GETİRME                                  */
/* ------------------------------------------------------------------ */

test('v7.34 · pencerede ASAS / IAS-Antrepo\'dan sütun getirme düğmesi var', () => {
  assert.match(FC, /data-fc-source-add/, 'kaynak ekleme satırı pencerede olmalı');
  assert.match(FC, /data-fc-add-model/, 'düğme olmalı');
  assert.match(FC, /ASAS \/ IAS-Antrepo\\?'dan sütun getir/);
});

test('v7.34 · düğme MEVCUT akışı açar, ikinci bir kopyasını yazmaz', () => {
  assert.match(FC, /window\.openCpModelColumnModal\(null, \(\) => \{/,
    'aynı pencere kullanılmalı — iki ayrı tanım iki ayrı bakım demekti');
  assert.match(APP, /window\.openCpModelColumnModal = openCpModelColumnModal;/,
    'akış formül modülünden erişilebilir olmalı');
});

test('v7.34 · sütun eklendikten sonra kaynak listesi PENCERE AÇIKKEN tazelenir', () => {
  const block = FC.slice(FC.indexOf('function renderSourceAdd()'), FC.indexOf('const optionLabel'));
  assert.match(block, /columns = sourceColumns\(tableKey/, 'liste yeniden kurulmalı');
  assert.match(block, /renderBuild\(\);/, 'açılır kutular yeniden çizilmeli');
  assert.match(block, /renderSourceAdd\(\);/, 'özet satırı da tazelenmeli');
});

test('v7.34 · yetkisiz kullanıcıya düğme değil SEBEP gösterilir (§32)', () => {
  /* Veri tabanı sütunu ORTAK Data Model bağlantısına yazılır; sunucu
     manageModelConnections yetkisi ister. Düğmeyi gösterip 403 aldırmak,
     kullanıcıya ne yapması gerektiğini söylemez. */
  assert.match(FC, /window\.BLHasPermission\('manageModelConnections'\)/);
  assert.match(FC, /Moderatörünüzden isteyebilirsiniz/);
});

test('v7.34 · yetki kararı SUNUCUDA verilir', () => {
  const SERVER = read('server/server.js');
  assert.match(SERVER, /app\.put\('\/api\/model-connections', userAccess\.requireArea\('source'\), userAccess\.requirePermission\('manageModelConnections'\)/,
    'istemcideki gizleme yalnız kolaylıktır; asıl engel sunucuda');
});

test('v7.34 · Nakliye Kıyaslama tablosunda bu yol hiç çizilmez (veri tabanı sütunu yok)', () => {
  assert.match(FC, /if \(tableKey === 'ship'\) \{ sourceAdd\.innerHTML = ''; return; \}/,
    'olmayan bir yeteneği düğme olarak sunmak yanıltıcı olurdu');
});

test('v7.34 · değerlerin ne zaman geleceği açıkça yazılır', () => {
  assert.match(FC, /Yeni getirilen sütunun DEĞERLERİ ilk CP yenilemesinde dolar/,
    'kullanıcı boş sütunu hata sanmamalı');
});

test('v7.34 · kaynak ekleme satırının biçimi tanımlı ve boşken yer kaplamaz', () => {
  assert.match(CSS, /\.fcSourceAdd\{[^}]*display:flex/);
  assert.match(CSS, /\.fcSourceAdd:empty\{display:none;\}/);
});

/* ------------------------------------------------------------------ */
/* 4) SÜRÜM                                                            */
/* ------------------------------------------------------------------ */

/* v7.35 — GÜNCELLENDİ (§156). Amaç aynı: sürüm etiketi TÜM dosyalarda birlikte
   ilerlesin ve tek bir eski etiket kalmasın. Sabit "7.34" yerine paket sürümü
   okunur; sabit kalsaydı bu test her yeni sürümde ilerlemeyi engellerdi.
   v7.34 kaydının geçmişte durduğu ayrıca doğrulanır. */
test('v7.34/v7.35 sürüm canonical runtime kaynaktan birlikte ilerliyor', () => {
  const version = JSON.parse(read('package.json')).version;
  assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  const index = read('public/index.html');
  assert.ok(index.includes('Version __BL_DISPLAY_VERSION__'));
  assert.ok(index.includes('buyerlog.bootRetry.v__BL_DISPLAY_VERSION__'));
  assert.ok(index.includes('?v=__BL_ASSET_VERSION__'));
  assert.equal(/\?v=7\.\d+/.test(index), false, 'statik cache sürümü kalmamalı');
  assert.match(read('public/version-history.js'), /v: '7\.34'/, 'v7.34 kaydı geçmişte durmalı');
});
