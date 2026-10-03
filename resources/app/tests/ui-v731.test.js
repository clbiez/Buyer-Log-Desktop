'use strict';

/*
 * v7.31 — SOURCE DATA SADELEŞTİRME · OAB FİLTRE HAFIZASI ·
 *         MODEL SAĞ TIK MENÜSÜ · ZİNCİRLEME HESAPLANAN SÜTUN
 *
 * Kullanıcı talepleri (birebir):
 *   · "OAB alanı kullanıcı bazlı pivot alanı filtre seçimlerini bir sonraki
 *      açılışta hatırlasın. Klasman Tanımı, Tedarik Sepeti, Alım Bütçe Tipi gibi."
 *   · "e-mail tarama butonlarını tablolardan kaldır. E-mail taramasını model
 *      adına sağ tıklayarak açılacak olan pencerede seçmek istiyorum. Ayrıca
 *      tools kısmındaki araçlar da modellere sağ tıkladığımda açılır pencere
 *      ile görebileyim."
 *   · "Source Data ekranında ... yenileme detay alanını kaldır. Upload from
 *      Excel, Upload Antrepo Excel butonlarını kaldır. FX Excel butonunu
 *      Settings sekmesine ekle. Settings sekmesinde Image size limit ve
 *   · "Add calculated column alanında tablolara sonradan eklenen sütunlar
 *      görünmüyor. Kullanıcıların ekledikleri sütunlar da bu alanda gör[ünsün]"
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const INDEX = read('public/index.html');
const APP = read('public/app-main.js');
const OAB = read('public/oab.js');
const CTX = read('public/row-context-menu.js');
const { assertLazy } = require('./helpers/script-loading');
const CSS = read('public/app.css');

/* ------------------------------------------------------------------ */
/* 1) SVG sprite — asıl kusur buydu                                    */
/* ------------------------------------------------------------------ */

/* Kullanıcı "simge ekle" dedi. Sebep düğmelerde simge YAZILMAMIŞ olması değil,
   başvurdukları sembolün sprite'ta hiç bulunmamasıydı: #i-settings tanımsızdı,
   bu yüzden üç düğme de boş çiziliyordu. Denetim iki eksik sembol daha ortaya
   çıkardı (#i-picture, #i-calendar). Bu test sınıfın tamamını kapatır. */
function spriteSymbols() {
  return new Set([...INDEX.matchAll(/<symbol id="(i-[a-z0-9-]+)"/g)].map(m => m[1]));
}
function spriteReferences() {
  const files = ['public/index.html', 'public/app-main.js', 'public/oab.js', 'public/row-context-menu.js',
    'public/kpi-groups.js', 'public/automations.js',
    'public/user-management.js', 'public/formula-columns.js'];
  const out = new Map();
  for (const file of files) {
    let text = '';
    try { text = read(file); } catch (_) { continue; }
    for (const match of text.matchAll(/href=\\?["']#(i-[a-z0-9-]+)(?=["'])/g)) {
      if (!out.has(match[1])) out.set(match[1], new Set());
      out.get(match[1]).add(file);
    }
  }
  return out;
}

test('sprite’ta başvurulan HER simge tanımlı — tanımsız simge boş düğme demektir', () => {
  const defined = spriteSymbols();
  const missing = [...spriteReferences().keys()].filter(id => !defined.has(id));
  assert.deepEqual(missing, [], `sprite'ta olmayan simgeler: ${missing.join(', ')}`);
});

test('eksik olduğu ölçülen üç simge artık tanımlı', () => {
  const defined = spriteSymbols();
  for (const id of ['i-settings', 'i-picture', 'i-calendar']) {
    assert.ok(defined.has(id), `${id} sprite'ta olmalı`);
  }
});


/* ------------------------------------------------------------------ */
/* 2) Source Data sadeleştirme                                         */
/* ------------------------------------------------------------------ */

test('yenileme detay listesi kaldırıldı', () => {
  assert.equal(/id="sourceTargets"/.test(INDEX), false);
  // Çizici duruyor ama host'u bulamayınca sessizce çıkar; son güncelleme
  // saatlerini Yenile menüsüne besleyen sourceStatus kaydı çalışmaya devam eder.
  assert.match(APP, /function renderSourceTargets\(\)/);
  assert.match(APP, /const host=document\.getElementById\('sourceTargets'\);\s*\n\s*if\(!host\) return;/);
  assert.match(APP, /sourceStatus\[key\]=\{\.\.\.\(sourceStatus\[key\]\|\|\{\}\),at\}/);
});

test('Upload from Excel ve Upload Antrepo Excel düğmeleri kaldırıldı', () => {
  assert.equal(/id="sourceLegacyToggle"/.test(INDEX), false);
  assert.equal(/id="antrepoQuickUpload"/.test(INDEX), false);
  // Ölü olay dinleyicileri de kaldırıldı.
  assert.equal(/sourceLegacyToggle/.test(APP), false);
  assert.equal(/antrepoQuickUpload/.test(APP), false);
});

test('KAYNAK KLASÖR erişilebilir kaldı — yetenek kaybolmadı', () => {
  // Kaynak Klasör, bağımsız navigasyon ayarları yerine Source Data çekmecesinde
  // görünür kalır; düğmenin işlevi aynı ortak handler'a bağlıdır.
  const start = INDEX.indexOf('id="sourceDataSettings"');
  const menu = INDEX.slice(start, INDEX.indexOf('<div class="sourceSecondary"', start));
  /* v7.81: Veri Yönetimi → Araçlar → Referans veri ve yüklemeler.
     Korunan güvence aynı — yetenek kaybolmadı, yeri değişti. */
  const DM_UI = fs.readFileSync(path.join(ROOT, 'public', 'data-management.js'), 'utf8');
  assert.match(DM_UI, /id: 'folder'/);
  assert.match(DM_UI, /chooseSourceFolder\(\)/);
  void menu;
  /* KORUNAN KUSUR — YÖN DEĞİŞTİRDİ AMA AYNI KUSUR.

     Eskiden iddia "bu düğme silinmesin" idi, çünkü app-main.js ona KOŞULSUZ
     bağlanıyordu ve silinirse açılışta TypeError veriyordu. v7.81'de düğme
     taşındı; o yüzden artık BAĞLAMANIN kalmadığı doğrulanıyor. Kalsaydı
     uygulama hiç açılmazdı — bu tam olarak yaşandı ve test yakaladı. */
  assert.doesNotMatch(APP, /getElementById\('chooseFolderBtn'\)\.addEventListener/);
  assert.doesNotMatch(INDEX, /id="chooseFolderBtn"/);
  /* Genel kural: index.html'den kaldırılan her kimliğe KORUMASIZ bağlanan kod
     kalmamalı. Bir tanesi bile app-main.js'i tamamen durdurur. */
  for (const id of ['chooseFolderBtn', 'backupSettingsBtn', 'syncLocalDataBtn',
    'transitRulesBtn', 'sourceSettingsBtn', 'dataMaintenanceBtn']) {
    assert.doesNotMatch(APP, new RegExp(`getElementById\\('${id}'\\)\\.`),
      `${id}: kaldırılan elemana korumasız bağlanma kalmamalı`);
  }
});

test('FX Excel Settings sekmesine taşındı, gizli dosya girdisiyle birlikte', () => {
  const start = INDEX.indexOf('id="sourceSettingsMenu"');
  const menu = INDEX.slice(start, INDEX.indexOf('</div>', start));
  const DM_FX = fs.readFileSync(path.join(ROOT, 'public', 'data-management.js'), 'utf8');
  assert.match(DM_FX, /id: 'fx'/);
  // Gizli dosya girdisi HÂLÂ index.html'de: araç satırı onu tetikliyor.
  assert.match(DM_FX, /getElementById\('sourceFxFile'\)/);
  void menu;
  /* Gizli dosya girdisi index.html'de KALIR — araç satırı onu tetikliyor.
     Menüyle birlikte silinseydi Kur Excel'i yüklemesi sessizce ölürdü. */
  assert.match(INDEX, /id="sourceFxFile"/, 'dosya girdisi durmalı, yoksa araç çalışmaz');
  // Düğme Veri Yönetimi'ne taşındı; index.html'de ikinci bir kopya kalmamalı.
  assert.equal((INDEX.match(/id="btnSourceFx"/g) || []).length, 0, 'eski FX düğmesi kalmamalı');
  assert.equal((DM_FX.match(/id: 'fx'/g) || []).length, 1, 'tek bir FX aracı olmalı');
});

/* ------------------------------------------------------------------ */
/* 3) OAB filtre hafızası                                              */
/* ------------------------------------------------------------------ */

test('yerel pivot filtreleri kullanıcı hesabıyla saklanır', () => {
  assert.match(OAB, /OAB_LOCAL_FILTER_PREF_KEY = 'lcw\.oab\.localFilters\.v1'/);
  // 'lcw.oab.' öneki hem tarayıcı eşitlemesinde hem sunucu "filters"
  // kategorisinde zaten kayıtlı; seçim başka bilgisayardan da gelir.
  assert.match(read('public/user-storage.js'), /'lcw\.oab\.'/);
  const prefs = read('server/lib/user-preferences.js');
  const filters = prefs.slice(prefs.indexOf('filters: Object.freeze(['), prefs.indexOf('columns: Object.freeze(['));
  assert.match(filters, /'lcw\.oab\.'/);
});

test('seçim değiştikçe kaydedilir', () => {
  const start = OAB.indexOf('function oabLocalFilterSpec(');
  const body = OAB.slice(start, start + 900);
  assert.match(body, /oabSaveLocalFilters\(\)/);
});

test('rapor yüklenince seçim SIFIRLANMAZ, geri yüklenir', () => {
  const start = OAB.indexOf('async function oabApplyReportData(');
  const body = OAB.slice(start, start + 1800);
  assert.match(body, /oabRestoreLocalFilters\(\)/);
});

test('KAYITLI DEĞER KÖRÜ KÖRÜNE UYGULANMAZ — veride yoksa düşer ve bildirilir', () => {
  /* Bu olmasaydı: geçen sezondan kalma bir "Klasman Tanımı" seçimi yeni raporda
     hiçbir satırla eşleşmez, pivot bomboş görünür ve kullanıcı sebebini
     göremezdi. */
  const start = OAB.indexOf('function oabRestoreLocalFilters(');
  const body = OAB.slice(start, start + 1200);
  assert.match(body, /distinctValues\(field\)/);
  assert.match(body, /available\.has\(value\)/);
  assert.match(body, /dropped\.push\(field\)/);
  const apply = OAB.slice(OAB.indexOf('async function oabApplyReportData('), OAB.indexOf('async function oabApplyReportData(') + 1800);
  assert.match(apply, /restoredFilters\.dropped\.length/);
  assert.match(apply, /oabToast\(/, 'uygulanamayan filtreler kullanıcıya bildirilmeli');
});

/* ------------------------------------------------------------------ */
/* 4) Model adına sağ tık menüsü                                       */
/* ------------------------------------------------------------------ */

test('sağ tık menüsü betiği yükleniyor', () => {
  // v7.69: açılış kritik yolundan çıkarıldı; deferredUi grubuyla UI_READY
  // sonrasında yükleniyor, yani app-main.js sonrası koşulu hâlâ geçerli.
  assertLazy('row-context-menu.js');
});

test('ARAÇLAR KOPYALANMAZ, gerçek düğmeye tıklanır', () => {
  /* Menü yeniden yazılsaydı iki ayrı işlem yolu doğar ve zamanla birbirinden
     ayrılırdı; yeni bir araç eklendiğinde burada da eklemek gerekirdi. */
  const start = CTX.indexOf('function toolEntries(');
  const body = CTX.slice(start, start + 900);
  assert.match(body, /getElementById\(toolsMenuId\)/);
  assert.match(body, /button\.click\(\)/);
  assert.match(CTX, /cpToolsMenu/);
  assert.match(CTX, /ordersToolsMenu/);
  assert.match(CTX, /kolToolsMenu/);
});

test('satır araç menüsü model/order-code hücrelerinde, copy menüsü CP/Orders hücrelerinde açılır', () => {
  // CP/Orders gridlerinde kopyalama artık her hücrede ortak context menüsüdür;
  // Collection kendi spreadsheet menüsünü korur.
  assert.match(CTX, /MODEL_COLUMN_KEYS/);
  assert.match(CTX, /plmModelLinkCell/);
  const start = CTX.indexOf("document.addEventListener('contextmenu'");
  const body = CTX.slice(start, start + 800);
  assert.match(body, /if \(isModelCell\) \{ openForCell\(config, table, cell, event\); return; \}/);
  assert.match(body, /if \(cell\.dataset\.ordercodeCell === '1'\) \{ openOrderCodeMenu\(config, cell, event\); return; \}/);
  assert.match(body, /if \(config\.module === 'cp' \|\| config\.module === 'orders'\) \{ openManagedGridCopyMenu\(config, table, cell, event\); return; \}/);
});

test('araç görünmeyen bir kümeye uygulanmaz: seçili olmayan satır önce seçilir', () => {
  const start = CTX.indexOf('function openForCell(');
  const body = CTX.slice(start, CTX.indexOf("document.addEventListener('contextmenu'"));
  assert.match(body, /selection\.clear\(\)/);
  assert.match(body, /selection\.add\(/);
  assert.match(body, /scopeText/, 'menü başlığı neye uygulanacağını yazmalı');
});

test('Escape ve dışarı tıklama menüyü kapatır', () => {
  assert.match(CTX, /event\.key !== 'Escape'/);
  assert.match(CTX, /pointerdown/);
  assert.match(CSS, /\.rowCtxMenu\{/);
});

/* ------------------------------------------------------------------ */
/* 5) Zincirleme hesaplanan sütun                                      */
/* ------------------------------------------------------------------ */

function loadColumnsModule() {
  const previousWindow = global.window;
  const previousDocument = global.document;
  global.document = { readyState: 'complete', addEventListener() {} };
  global.window = global;
  require(path.join(ROOT, 'public', 'formula-engine.js'));
  delete require.cache[require.resolve(path.join(ROOT, 'public', 'formula-columns.js'))];
  require(path.join(ROOT, 'public', 'formula-columns.js'));
  const api = global.window.BLFormulaColumns;
  global.window = previousWindow;
  global.document = previousDocument;
  return api;
}
const FC = loadColumnsModule();

test('hesaplanan sütunlar da kaynak listesinde görünür', () => {
  const source = read('public/formula-columns.js');
  const start = source.indexOf('function sourceColumns(');
  const body = source.slice(start, source.indexOf('const nameKey ='));
  assert.match(body, /col\.formulaCustom/);
  assert.match(body, /calculated: true/);
  assert.match(body, /col\.formulaId === excludeId/, 'düzenlenen sütun kendini göstermemeli');
});

test('bağımlılık sırası: dayanılan sütun ÖNCE hesaplanır', () => {
  const defs = [
    { id: 'b', label: 'Gecikme', formula: '[Üretim Süresi] - 30' },
    { id: 'a', label: 'Üretim Süresi', formula: 'DAYS([Ex-factory], [Retail Date])' },
  ];
  const result = FC.orderedDefinitions(defs);
  assert.deepEqual(result.ordered.map(item => item.label), ['Üretim Süresi', 'Gecikme']);
  assert.equal(result.cyclic.size, 0);
});

test('ÇEVRİM tarayıcıyı kilitlemez — tespit edilip bildirilir', () => {
  const cyclic = [
    { id: 'x', label: 'X', formula: '[Y] + 1' },
    { id: 'y', label: 'Y', formula: '[X] + 1' },
  ];
  const result = FC.orderedDefinitions(cyclic);
  assert.deepEqual(result.ordered, [], 'çevrimdeki sütunlar hesaplanmamalı');
  assert.deepEqual([...result.cyclic].sort(), ['x', 'y']);
});

test('kendine gönderme de çevrimdir', () => {
  const result = FC.orderedDefinitions([{ id: 'z', label: 'Z', formula: '[Z] + 1' }]);
  assert.deepEqual(result.ordered, []);
  assert.ok(result.cyclic.has('z'));
});

test('hesaplanan sütuna ADIYLA başvurulur (iç anahtar kullanıcıya gösterilmez)', () => {
  const alias = FC.aliasMap([{ id: 'a', label: 'Üretim Süresi', formula: '1' }]);
  assert.equal(alias.get('üretim süresi'), '__f_a');
});

test('aynı adı taşıyan GERÇEK veri sütunu önceliğini korur', () => {
  // Satırın kendi alanı önce okunur; aksi hâlde bir formül sütunu aynı adı
  // alarak gerçek veriyi gölgeleyebilirdi.
  const source = read('public/formula-columns.js');
  const start = source.indexOf('const lookup = (name, row) =>');
  const body = source.slice(start, start + 400);
  assert.ok(body.indexOf('hasOwnProperty.call(row, name)') < body.indexOf('alias.get('));
});
