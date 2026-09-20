'use strict';

/*
 * v7.36 — HIZLI FİLTRE BAŞLIKLARINI KULLANICI EKLER/ÇIKARIR
 *
 * Kullanıcı talebi (birebir):
 *   "modüllerdeki hızlı filtre alanlarına yeni hızlı filtreleme başlıkları
 *    ekleyip çıkarabilsin kullanıcı."
 *
 * BU DOSYANIN KORUDUĞU DAVRANIŞLAR
 *   1) HAZIR BAŞLIKLAR YENİDEN YAZILMADI. Priority çok değerli eşleşme,
 *      Ex-Factory tarih kovaları, renk tonları ve görünen ad dönüşümleri
 *      yerinde durur; yalnız GÖRÜNÜRLÜKLERİ kullanıcıya bırakıldı.
 *   2) VARSAYILAN DAVRANIŞ DEĞİŞMEZ. Hiç ayar yapılmamış kullanıcı v7.35'teki
 *      şeridin aynısını görür.
 *   3) SAYIM KAPSAMI DÜRÜST. Bir başlıkta değer seçiliyken o başlığın çipleri
 *      KENDİ filtresi hariç sayılır; aksi hâlde diğer değerler 0 olup kaybolur
 *      ve kullanıcı seçimini temizlemeden başka değere geçemezdi.
 *   4) BAŞLIK ÇIKARMAK VERİ SİLMEZ (§142). Sütun, satır ve filtre yerinde
 *      kalır; yalnız şerit değişir.
 *   5) KESİLEN ÇİP SAYISI SÖYLENİR (§152). Sessizce kesmek "başka değer yok"
 *      demek olurdu.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const { assertLazy, sources } = require('./helpers/script-loading');
const APP = read('public/app-main.js');
const QFG = read('public/quick-filter-groups.js');
const INDEX = read('public/index.html');
const CSS = read('public/app.css');

/* Tarayıcı modülünü düğüm ortamında yükler; window/document taklit edilir ve
   yerinde bırakılır (modül kapanışları çalışma anında window'a başvurur). */
const store = {};
global.document = {
  readyState: 'complete',
  addEventListener() {},
  getElementById() { return null; },
  querySelectorAll() { return []; },
  createElement() { return { style: {}, dataset: {}, classList: { add() {}, remove() {} }, addEventListener() {}, setAttribute() {}, appendChild() {}, querySelector() { return null; }, querySelectorAll() { return []; } }; },
  body: { appendChild() {} },
};
global.window = global;
global.escapeHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
global.BLStorage = { getItem: key => store[key] || null, setItem: (key, value) => { store[key] = value; } };
global.appLang = 'tr';
global.state = { colFilters: { cp: {}, orders: {} } };
global.COLS_BY_TABLE = {
  cp: [
    { k: 'Order Code', label: 'Sipariş Kodu' },
    { k: 'Country', label: 'Ülke' },
    { k: 'Season', label: 'Sezon' },              // hazır başlık — listeye girmemeli
    { k: 'Priority', label: 'Priority' },
    { k: '__picture', label: 'Görsel', type: 'cpImage' },
    { k: '__f_fc_a', label: 'Üretim Süresi', formulaCustom: true },
    { k: '__CPX_cpx_1', label: 'Üretici Kodu', modelCustom: true, role: 'asas' },
  ],
  orders: [{ k: 'Country', label: 'Ülke' }],
};
require('../public/quick-filter-groups.js');
const QF = global.window.BLQuickFilterGroups;

function reset() { Object.keys(store).forEach(key => delete store[key]); global.state.colFilters = { cp: {}, orders: {} }; }

/* ------------------------------------------------------------------ */
/* 1) VARSAYILAN DAVRANIŞ DEĞİŞMEZ                                     */
/* ------------------------------------------------------------------ */

test('v7.36 · ayar yapılmamış kullanıcı için hiçbir başlık gizlenmez, hiçbir başlık eklenmez', () => {
  reset();
  for (const moduleKey of ['overview', 'cp', 'orders']) {
    const cfg = QF.config(moduleKey);
    assert.deepEqual(cfg.hidden, []);
    assert.deepEqual(cfg.extra, []);
    for (const [id] of QF.BUILT_INS[moduleKey]) assert.equal(QF.isVisible(moduleKey, id), true, `${moduleKey}/${id} görünür olmalı`);
  }
  assert.equal(QF.extraHtml('cp', [{ Country: 'Türkiye' }], null), '', 'eklenmemişken şeride hiçbir şey eklenmez');
});

test('v7.36 · hazır başlıklar YENİDEN YAZILMADI, yalnız görünürlük kapısından geçiyor', () => {
  /* Kusur riski buradaydı: genel bir motora çevirmek Priority\'nin çok değerli
     eşleşmesini ve Ex-Factory tarih kovalarını sessizce değiştirebilirdi. */
  assert.match(APP, /qfgSeg\('cp','pri','Priority',/);
  assert.match(APP, /qfgSeg\('cp','exf','Ex-Factory',/);
  assert.match(APP, /matchesQuickExFactory/, 'Ex-Factory kovaları yerinde kalmalı');
  assert.match(APP, /function priorityHas\(/, 'Priority çok değerli eşleşmesi yerinde kalmalı');
  assert.match(APP, /function qfgSeg\(moduleKey,id,label,chips\)\{\s*if\(!qfgVisible\(moduleKey,id\)\) return '';/);
});

test('v7.36 · boş bir hazır başlık zaten çizilmez (eski davranış)', () => {
  assert.match(APP, /if\(!body\.trim\(\)\) return '';/,
    'çipi olmayan başlık şeritte yalnız etiket olarak asılı kalmamalı');
});

/* ------------------------------------------------------------------ */
/* 2) EKLE / ÇIKAR                                                     */
/* ------------------------------------------------------------------ */

test('v7.36 · kullanıcı hazır bir başlığı çıkarabilir', () => {
  reset();
  QF.saveConfig('cp', { hidden: ['exf'], extra: [] });
  assert.equal(QF.isVisible('cp', 'exf'), false);
  assert.equal(QF.isVisible('cp', 'pri'), true, 'diğer başlıklar etkilenmemeli');
});

test('v7.36 · kullanıcı yeni başlık ekleyebilir ve çipler gerçek değerlerdir', () => {
  reset();
  QF.saveConfig('cp', { hidden: [], extra: ['Country'] });
  const rows = [{ Country: 'Türkiye' }, { Country: 'Türkiye' }, { Country: 'Mısır' }, { Country: '' }];
  const html = QF.extraHtml('cp', rows, null);
  assert.match(html, /kpiGroupLabel">Ülke/, 'başlık sütunun adıyla çizilmeli');
  assert.match(html, /data-qfg-col="Country" data-qfg-value="Türkiye"><span class="n">2<\/span>/, 'sayı gerçek satır sayımı olmalı');
  assert.match(html, /data-qfg-value="Mısır"><span class="n">1<\/span>/);
  assert.match(html, /data-qfg-value="—"><span class="n">1<\/span>/, 'boş hücreler görünmeli, yoksa toplam tutmaz');
});

test('v7.36 · hazır başlıkların sütunları ekleme listesinde ikinci kez çıkmaz', () => {
  const keys = QF.availableColumns('cp').map(col => col.key);
  assert.ok(!keys.includes('Season'), 'Sezon zaten hazır başlık');
  assert.ok(!keys.includes('Priority'), 'Priority zaten hazır başlık');
  assert.ok(keys.includes('Country'), 'normal sütun eklenebilmeli');
});

test('v7.36 · görsel sütunu başlık olarak sunulmaz', () => {
  const keys = QF.availableColumns('cp').map(col => col.key);
  assert.ok(!keys.includes('__picture'), 'görselin çipi olmaz');
});

test('v7.36 · hesaplanan ve ASAS/IAS sütunları da başlık yapılabilir (v7.31/v7.34)', () => {
  const list = QF.availableColumns('cp');
  const calc = list.find(col => col.key === '__f_fc_a');
  const model = list.find(col => col.key === '__CPX_cpx_1');
  assert.ok(calc && calc.calculated, 'hesaplanan sütun seçilebilmeli');
  assert.ok(model && model.model, 'ASAS/IAS sütunu seçilebilmeli');
});

test('v7.36 · şerit okunabilir kalsın diye başlık sayısı sınırlı ve sınır SÖYLENİR', () => {
  reset();
  QF.saveConfig('cp', { hidden: [], extra: Array.from({ length: 20 }, (_, i) => `K${i}`) });
  assert.equal(QF.config('cp').extra.length, QF.MAX_EXTRA);
  assert.match(QFG, /En çok \$\{MAX_EXTRA\} başlık eklenebilir/, 'sınıra gelindiğinde sebebi yazılmalı');
});

test('v7.36 · bilinmeyen hazır başlık kimliği kayıttan sessizce düşer', () => {
  reset();
  QF.saveConfig('cp', { hidden: ['exf', 'olmayan-baslik'], extra: [] });
  assert.deepEqual(QF.config('cp').hidden, ['exf']);
});

test('v7.36 · bozuk ayar kaydı şeridi bozmaz, varsayılana düşülür', () => {
  reset();
  store['bl.quickFilterGroups.cp.v1'] = '{bozuk';
  assert.deepEqual(QF.config('cp'), { hidden: [], extra: [] });
});

/* ------------------------------------------------------------------ */
/* 3) SAYIM KAPSAMI                                                    */
/* ------------------------------------------------------------------ */

test('v7.36 · seçim yapılınca o başlığın DİĞER değerleri kaybolmaz', () => {
  /* Asıl tasarım kusuru burada olurdu: kendi filtresi de uygulanarak sayılsaydı
     seçimden sonra tek çip kalır, kullanıcı seçimini temizlemeden başka bir
     değere geçemezdi. */
  reset();
  QF.saveConfig('cp', { hidden: [], extra: ['Country'] });
  const all = [{ Country: 'Türkiye' }, { Country: 'Mısır' }, { Country: 'Mısır' }];
  state.colFilters.cp.Country = { values: new Set(['Türkiye']) };
  const filtered = all.filter(row => row.Country === 'Türkiye');
  const html = QF.extraHtml('cp', filtered, () => all);
  assert.match(html, /data-qfg-value="Mısır"><span class="n">2<\/span>/, 'seçilmeyen değerler de sayılmalı');
  assert.match(html, /data-qfg-value="Türkiye"[^>]*/);
  assert.match(html, /class="kpi tone-gray active" data-qfg-col="Country" data-qfg-value="Türkiye"/, 'seçili çip işaretli olmalı');
});

test('v7.36 · kendi filtresi yokken fazladan tarama yapılmaz', () => {
  reset();
  QF.saveConfig('cp', { hidden: [], extra: ['Country'] });
  let scans = 0;
  QF.extraHtml('cp', [{ Country: 'Türkiye' }], () => { scans++; return []; });
  assert.equal(scans, 0, 'gereksiz tam tarama 10 binlerce satırda pahalıdır');
});

test('v7.36 · kapsam hesabı filtreyi GERİ KOYAR (§142)', () => {
  reset();
  QF.saveConfig('cp', { hidden: [], extra: ['Country'] });
  const filter = { values: new Set(['Türkiye']) };
  state.colFilters.cp.Country = filter;
  QF.extraHtml('cp', [], () => { throw new Error('tarama patladı'); });
  assert.equal(state.colFilters.cp.Country, filter, 'tarama hata verse bile kullanıcının filtresi kaybolmamalı');
});

test('v7.36 · çok değerli sütunda çip sayısı sınırlanır ve kesilen miktar yazılır (§152)', () => {
  reset();
  QF.saveConfig('cp', { hidden: [], extra: ['Country'] });
  const rows = Array.from({ length: 40 }, (_, i) => ({ Country: `Ülke ${i}` }));
  const html = QF.extraHtml('cp', rows, null);
  const chips = (html.match(/data-qfg-col="Country"/g) || []).length;
  assert.equal(chips, QF.MAX_CHIPS);
  assert.match(html, /kpiGroupMore[^>]*>\+28</, 'gösterilmeyen değer sayısı söylenmeli');
});

test('v7.36 · "+N" işareti BAŞLIĞIN içinde yazılır', () => {
  /* Şerit, çipleri başlığın altına toplayan bir katmandan geçiyor; başlıkla
     çipler arasındaki yabancı bir düğüm o grubun çip toplamasını keserdi. */
  assert.match(QFG, /<span class="kpiGroupLabel">\$\{esc\(columnLabel\(moduleKey, key\)\)\}\$\{more\}<\/span>\$\{chips\}/);
});

/* ------------------------------------------------------------------ */
/* 4) TIKLAMA VE BAĞLANTI                                              */
/* ------------------------------------------------------------------ */

test('v7.36 · eklenen çip, sütun başlığı filtresiyle AYNI kaynağı kullanır', () => {
  /* Ayrı bir filtre kabı kurmak, "Aktif Filtreler" alanında görünmeyen gizli
     bir filtre demekti. */
  assert.match(QFG, /window\.toggleMirroredQuickFilter\(module\.tableKey, key, null, value === '—' \? '' : value\)/);
});

test('v7.36 · hazır çip bağlayıcıları eklenen çiplere dokunmaz (çifte tıklama olmaz)', () => {
  assert.match(APP, /#cpKpi \.kpi:not\(\[data-qfg-col\]\)/);
  assert.doesNotMatch(APP, /#kpiCP \.kpi:not\(\[data-qfg-col\]\)/);
  assert.match(APP, /kpi\.querySelectorAll\('\.kpi:not\(\[data-qfg-col\]\)'\)/);
});

test('v7.36 · CP ve Orders şeritleri korunur; Overview hızlı CP şeridi içermez', () => {
  assert.match(QFG, /cp: \{ tableKey: 'cp', host: 'cpKpi'/);
  assert.match(QFG, /if \(module\.navigates && typeof window\.switchTab === 'function'\)/);
  assert.doesNotMatch(APP, /qfgFinish\('overview','kpiCP',renderOverview\)/);
});

test('v7.36 · CP ve Orders şeritleri bağlanmış ve düzenleme düğmesi eklenmiş', () => {
  assert.match(APP, /qfgFinish\('cp','cpKpi',renderCP\)/);
  assert.match(APP, /qfgFinish\('orders','ordersKpi',renderOrders\)/);
  assert.match(QFG, /button\.dataset\.qfgOpen = moduleKey;/);
  assert.match(QFG, /host\.querySelector\('\[data-qfg-open\]'\)/, 'düğme iki kez eklenmemeli');
});

test('v7.36 · betik, şeridi gruplara ayıran katmandan ÖNCE yüklenir', () => {
  // v7.69: her ikisi de açılıştan çıkarılıp deferredUi grubuna alındı. Yükleme
  // sırası hâlâ önemli — grup içindeki dizi sırası sırayla await ediliyor.
  assertLazy('quick-filter-groups.js');
  assertLazy('kpi-groups.js');
  const { perf } = sources();
  const group = perf.slice(perf.indexOf('deferredUi:'), perf.indexOf('],', perf.indexOf('deferredUi:')));
  const qfgAt = group.indexOf("'quick-filter-groups.js'");
  const kpiAt = group.indexOf("'kpi-groups.js'");
  assert.ok(qfgAt > -1 && kpiAt > -1, 'ikisi de deferredUi grubunda olmalı');
  assert.ok(qfgAt < kpiAt, 'içerik üreten katman, DOM\'u gruplayan katmandan önce gelmeli');
});

test('v7.36 · düzenleme düğmesinin ve penceresinin biçimi tanımlı', () => {
  assert.match(CSS, /\.kpiGroupEdit\{/);
  assert.match(CSS, /\.qfgCard\{/);
  assert.match(CSS, /\.qfgRow\{/);
  assert.match(QFG, /use href="#i-settings"/);
  assert.match(INDEX, /symbol id="i-settings"/, 'simge sprite\'ta tanımlı olmalı (v7.31 dersi)');
});

test('v7.36 · ayar KİŞİSELDİR ve kullanıcı çalışma alanına yazılır', () => {
  reset();
  QF.saveConfig('orders', { hidden: ['del'], extra: ['Country'] });
  assert.ok(store['bl.quickFilterGroups.orders.v1'], 'kullanıcı deposuna yazılmalı');
  assert.deepEqual(QF.config('cp'), { hidden: [], extra: [] }, 'modüller birbirini etkilememeli');
});

test('v7.36 · "Varsayılana dön" hem gizlenenleri hem eklenenleri temizler', () => {
  assert.match(QFG, /hidden\.clear\(\); extra\.length = 0; apply\(\); render\(\);/);
});

test('v7.36 · başlık çıkarmanın veri silmediği kullanıcıya yazılır (§142)', () => {
  assert.match(QFG, /başlık çıkarmak hiçbir veriyi ya da filtreyi silmez/);
});

test('v7.36 · pencere etiketleri ŞERİTTE yazanla aynıdır', () => {
  /* Şeritte "SİPARİŞ DURUMU" yazarken pencerede "Order Status" yazsaydı,
     kullanıcı hangi başlığı kapattığını eşleştiremezdi. */
  assert.match(QFG, /\['orderStatus', \{ tr: 'Sipariş Durumu', en: 'Order Status' \}\]/);
  assert.match(QFG, /\['season', \{ tr: 'Sezon', en: 'SEASON' \}\]/, 'Genel Bakış şeridinde başlık "Sezon" yazar');
  assert.match(QFG, /const builtInLabel = label =>/);
  assert.match(APP, /qfgSeg\('orders','orderStatus',appLang==='en'\?'Order Status':'Sipariş Durumu'/);
  assert.doesNotMatch(APP, /qfgSeg\('overview','season',appLang==='en'\?'SEASON':'Sezon'/);
});

/* v7.37 — GÜNCELLENDİ (§156). Amaç aynı: sürüm etiketi TÜM dosyalarda birlikte
   ilerlesin, tek bir eski etiket kalmasın. Sabit sürüm beklemek bu testi her
   yükseltmede engele çevirirdi; v7.36 kaydının geçmişte durduğu ayrıca
   doğrulanır. */
test('v7.36/v7.37 sürüm tüm dosyalarda birlikte ilerliyor — canonical runtime source', () => {
  const version = JSON.parse(read('package.json')).version;
  assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  const index = INDEX;
  assert.ok(index.includes('Version __BL_DISPLAY_VERSION__'));
  assert.ok(index.includes('buyerlog.bootRetry.v__BL_DISPLAY_VERSION__'));
  assert.ok(index.includes('?v=__BL_ASSET_VERSION__'));
  assert.equal(/\?v=7\.\d+/.test(index), false, 'statik sürüm cache etiketi kalmamalı');
  assert.match(read('public/version-history.js'), /v: '7\.36'/, 'geçmiş sürüm kaydı korunmalı');
});
