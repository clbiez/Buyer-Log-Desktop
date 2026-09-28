'use strict';

/* v6.34 — Veri kaybı önlemleri ve tablo filtreleri.
 *
 * En kritik madde: gecikmeli sunucu yazmaları YALNIZ sipariş koduyla
 * anahtarlanıyordu (_dateSyncTimers[orderCode]). Oysa v4.19'dan beri kalıcı
 * yazma anahtarı ÜÇLÜ: Sipariş Kod + Model Adı + Renk Kod. Aynı sipariş kodunun
 * iki FARKLI satırında arka arkaya düzenleme yapıldığında ikinci çağrının
 * clearTimeout'u birincinin bekleyen yazmasını iptal ediyor ve o düzenleme
 * sunucuya HİÇ gitmiyordu — ekranda görünüp ilk yenilemede kayboluyordu.
 *
 * Buradaki testler davranışı iki yoldan çiviliyor: anahtar üretimi ve bekleyen
 * yazma kaydı GERÇEKTEN çalıştırılarak, geri kalanı kaynak üzerinden.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const SYNC = fs.readFileSync(path.join(ROOT, 'public', 'override-sync.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'design-butunluk.css'), 'utf8');
const QUOTES = fs.readFileSync(path.join(ROOT, 'public', 'quotations.js'), 'utf8');

/* DİKKAT: gövdenin açılış süslü parantezi, parametre listesi bittikten SONRA
   aranmalı. `function f(t, options={}){` gibi bir imzada ilk '{' varsayılan
   değerin kendisidir; ondan başlayan sayım anında kapanır ve gövde BOŞ döner. */
function bodyOf(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunmalı`);
  let paren = 0, i = source.indexOf('(', start);
  for (; i < source.length; i++) {
    if (source[i] === '(') paren++;
    else if (source[i] === ')' && --paren === 0) break;
  }
  const open = source.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) return source.slice(open + 1, j);
  }
  throw new Error(`${name} ayrıştırılamadı`);
}

/* --------------------------------------------- 1) SATIR BAZLI YAZMA ANAHTARI */

test('v6.34 yazma anahtarı sipariş koduna değil SATIRA bağlı', () => {
  // lineKeyOfRow ve overrideSyncKey birlikte çalıştırılır: aynı sipariş kodunun
  // farklı model/renk satırları FARKLI anahtar üretmeli.
  const helpers = new Function(`
    ${bodyOf(APP, 'norm') ? '' : ''}
    function norm(s){ return String(s==null?'':s).trim(); }
    function turknorm(s){ return norm(s).toLocaleUpperCase('tr-TR'); }
    function lineKeyOfRow(row){${bodyOf(APP, 'lineKeyOfRow')}}
    function overrideSyncKey(row, orderCode){${bodyOf(APP, 'overrideSyncKey')}}
    return {lineKeyOfRow, overrideSyncKey};
  `)();

  const a = { 'Order Code': '1.234.569', 'Model Name': 'ALFA', 'C.Code': 'RED' };
  const b = { 'Order Code': '1.234.569', 'Model Name': 'BETA', 'C.Code': 'RED' };
  const c = { 'Order Code': '1.234.569', 'Model Name': 'ALFA', 'C.Code': 'BLUE' };

  const ka = helpers.overrideSyncKey(a, a['Order Code']);
  const kb = helpers.overrideSyncKey(b, b['Order Code']);
  const kc = helpers.overrideSyncKey(c, c['Order Code']);

  assert.notEqual(ka, kb, 'aynı siparişin farklı modeli ayrı anahtar almalı');
  assert.notEqual(ka, kc, 'aynı siparişin farklı rengi ayrı anahtar almalı');
  // Model/renk boş olsa da anahtar sipariş kodundan TÜRETİLİR ve kararlıdır;
  // sipariş kodu hiç yoksa ham koda düşülür (eski davranışın yedeği).
  const bare = { 'Order Code': '1.234.569' };
  assert.equal(helpers.overrideSyncKey(bare, bare['Order Code']), '1234569||');
  const noCode = { 'Order Code': '' };
  assert.equal(helpers.overrideSyncKey(noCode, 'X-1'), 'X-1');
});

test('v6.34 farklı satırların bekleyen yazmaları birbirini iptal etmiyor', () => {
  // Asıl regresyon testi: iki ayrı satır için planlanan yazmaların İKİSİ de
  // çalışmalı. Eski kodda ikincisi birinciyi iptal ediyordu.
  const timers = new Map();
  let seq = 0;
  const sandbox = {
    setTimeout: (fn) => { const id = ++seq; timers.set(id, fn); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    console: { warn() {} },
  };
  const make = new Function('setTimeout', 'clearTimeout', 'console', `
    const _pendingOverrideWrites = new Map();
    function schedulePendingOverrideWrite(key, delay, run){${bodyOf(APP, 'schedulePendingOverrideWrite')}}
    function flushPendingOverrideWrites(){${bodyOf(APP, 'flushPendingOverrideWrites')}}
    function pendingOverrideWriteCount(){${bodyOf(APP, 'pendingOverrideWriteCount')}}
    return {schedulePendingOverrideWrite, flushPendingOverrideWrites, pendingOverrideWriteCount};
  `)(sandbox.setTimeout, sandbox.clearTimeout, sandbox.console);

  const ran = [];
  make.schedulePendingOverrideWrite('date:1|ALFA|RED', 400, () => ran.push('alfa'));
  make.schedulePendingOverrideWrite('date:1|BETA|RED', 400, () => ran.push('beta'));
  assert.equal(make.pendingOverrideWriteCount(), 2, 'iki ayrı satır iki ayrı kayıt tutmalı');

  make.flushPendingOverrideWrites();
  assert.deepEqual(ran.sort(), ['alfa', 'beta'], 'her iki satırın yazması da çalışmalı');
  assert.equal(make.pendingOverrideWriteCount(), 0, 'boşaltma sonrası kayıt kalmamalı');
});

test('v6.34 aynı satırın ardışık düzenlemesi tek yazmaya indirgenir', () => {
  const timers = new Map();
  let seq = 0;
  const make = new Function('setTimeout', 'clearTimeout', 'console', `
    const _pendingOverrideWrites = new Map();
    function schedulePendingOverrideWrite(key, delay, run){${bodyOf(APP, 'schedulePendingOverrideWrite')}}
    function flushPendingOverrideWrites(){${bodyOf(APP, 'flushPendingOverrideWrites')}}
    return {schedulePendingOverrideWrite, flushPendingOverrideWrites};
  `)((fn) => { const id = ++seq; timers.set(id, fn); return id; }, (id) => timers.delete(id), { warn() {} });

  const ran = [];
  make.schedulePendingOverrideWrite('date:1|ALFA|RED', 400, () => ran.push('eski'));
  make.schedulePendingOverrideWrite('date:1|ALFA|RED', 400, () => ran.push('yeni'));
  make.flushPendingOverrideWrites();
  // Debounce niyeti korunmalı: aynı satır için yalnız SON değer gider.
  assert.deepEqual(ran, ['yeni']);
});

test('v6.34 tarih ve not yazmaları ayrı ad alanında', () => {
  // Aynı satırın tarih revizyonu ile not yazması birbirini ezmemeli.
  const dates = bodyOf(APP, 'saveDateOverrides');
  const notes = bodyOf(APP, 'syncOverrideToServer');
  assert.match(dates, /schedulePendingOverrideWrite\(`date:\$\{overrideSyncKey\(row, orderCode\)\}`/);
  assert.match(notes, /schedulePendingOverrideWrite\(`notes:\$\{overrideSyncKey\(row, orderCode\)\}`/);
  // Eski sipariş kodu anahtarlı zamanlayıcı haritaları KODDAN kalkmış olmalı.
  // (Kök nedeni anlatan yorumda adları geçebilir; aranan şey canlı kullanım.)
  const live = APP.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(live, /_dateSyncTimers/);
  assert.doesNotMatch(live, /_syncTimers/);
});

/* ------------------------------------------------ 2) KAPANIŞ VE YENİLEME KİLİDİ */

test('v6.34 sayfa kapanışında bekleyen yazmalar boşaltılıyor', () => {
  assert.match(APP, /pagehide',\(\)=>\{ commitActiveTableEditor\(\{refresh:false\}\); flushPendingOverrideWrites\(\); \}/);
  assert.match(APP, /visibilitychange[\s\S]{0,120}flushPendingOverrideWrites\(\)/);
  // Sunucuya ulaşmamış yazma varken kapatma uyarısı çıkmalı.
  const guard = APP.slice(APP.indexOf("beforeunload', e=>{"), APP.indexOf("beforeunload', e=>{") + 400);
  assert.match(guard, /pendingOverrideWriteCount\(\)/);
  assert.match(guard, /state\.cpDirty\.size>0 \|\| pending>0/);
});

test('v6.34 yenileme, bekleyen yazmalar tamamlanmadan başlamıyor', () => {
  const block = APP.slice(APP.indexOf('async function loadFromServer'), APP.indexOf('async function loadFromServer') + 1400);
  // SIRA ÖNEMLİ: düzenleyici kapat → boşalt+bekle → ancak sonra yenilemeyi başlat.
  // v7.41 — GÜNCELLENDİ (§156): sıra iddiası aynı; çağrılar artık HEDEFİ de
  // alıyor (kilit yalnız yeniden çizilecek ekranlara konsun diye).
  const commitAt = block.indexOf('commitOpenCellEditors(targets)');
  const settleAt = block.indexOf('await settleOverrideWrites()');
  const busyAt = block.indexOf('window.BL_REFRESH_BUSY=');
  assert.ok(commitAt >= 0 && settleAt > commitAt, 'önce düzenleyici kapatılıp sonra beklenmeli');
  assert.ok(busyAt > settleAt, 'yenileme bayrağı bekleme SONRASINDA kurulmalı');
  assert.match(block, /setReadOnlyMode\(true,targets\)/);
  // Kuyruğun bitmesini bekleyen nokta override-sync tarafında bulunmalı.
  assert.match(SYNC, /function overrideMutationsSettled\(\)/);
  assert.match(SYNC, /window\.overrideMutationsSettled=overrideMutationsSettled/);
});

/* v7.41 — GÜNCELLENDİ (§156). Korunan davranış aynı: yeniden ÇİZİLEN bir
   tabloya yenileme sırasında yazılamaz ve kip bırakılırken kapanır. Değişen,
   kipin KAPSAMI: artık tüm uygulamaya değil, yalnız çizilecek ekranlara
   konur (kullanıcı: "CP yenilerken koleksiyon editlemesi kilitleniyor, gerek
   yok gibi"). CP her yenilemede çizildiği için CP yolu her zaman kapalı;
   Koleksiyon hiçbir yenileme yolunda çizilmediği için açık kalır. */
test('v6.34/v7.41 salt görüntüleme kipi ÇİZİLEN alanlarda düzenlemeyi kapatıyor', () => {
  // Kip bırakılırken de kapanmalı, yoksa yenileme sonrası ekran kilitli kalırdı.
  assert.match(APP, /window\.BL_REFRESH_BUSY='';\s*setReadOnlyMode\(false\)/);
  // İki düzenleme yolu da ALANINA göre erkenden dönmeli.
  assert.match(bodyOf(APP, 'commitCpEditor'), /if\(isAreaFrozen\('cp'\)\) return false;/);
  assert.match(bodyOf(APP, 'commitKolEditor'), /if\(isAreaFrozen\('koleksiyon'\)\)return false;/);
  // CP her yenilemede çizilir; bu yüzden hangi hedef seçilirse seçilsin donar.
  const map = APP.slice(APP.indexOf('const REFRESH_ALWAYS_REDRAWN'), APP.indexOf('function refreshFrozenAreas'));
  assert.match(map, /const REFRESH_ALWAYS_REDRAWN = \['cp', 'orders', 'overview'\];/);
  for (const target of ['cp', 'orders', 'backlog', 'lfl', 'all']) {
    assert.match(map, new RegExp(`${target}: \\[\\.\\.\\.REFRESH_ALWAYS_REDRAWN`), `${target} hedefi CP'yi de dondurmalı`);
  }
  // Koleksiyon hiçbir hedefte donmaz.
  assert.doesNotMatch(map, /koleksiyon/);
  // CSS koruması EN SON yüklenen katmanda olmalı ki başka kural onu ezmesin.
  assert.match(CSS, /body\.bl-readonly \[data-bl-frozen\] \.editCell/);
  assert.match(CSS, /pointer-events:none/);
});

/* -------------------------------------------------------- 3) REVİZYON FİLTRESİ */

test('v6.34 revizyon filtresi revize edilen/edilmeyen satırları ayırıyor', () => {
  const fn = new Function('BLRevision', `
    function revisionFilterMode(entry){${bodyOf(APP, 'revisionFilterMode')}}
    function rowHasDateRevision(row,key){${bodyOf(APP, 'rowHasDateRevision')}}
    function revisionFilterPasses(mode,key,row){${bodyOf(APP, 'revisionFilterPasses')}}
    const REVISION_FILTER_MODES = Object.freeze(['revised','original']);
    return {revisionFilterMode, revisionFilterPasses};
  `)({ revisedDateKeys: (row) => row._revised || [] });

  const revised = { _revised: ['Ex-factory'] };
  const clean = { _revised: [] };

  assert.equal(fn.revisionFilterPasses('revised', 'Ex-factory', revised), true);
  assert.equal(fn.revisionFilterPasses('revised', 'Ex-factory', clean), false);
  assert.equal(fn.revisionFilterPasses('original', 'Ex-factory', clean), true);
  assert.equal(fn.revisionFilterPasses('original', 'Ex-factory', revised), false);
  // Kip yoksa hiçbir satır elenmez.
  assert.equal(fn.revisionFilterPasses('', 'Ex-factory', revised), true);
  // Geçersiz kip sessizce "filtre yok" sayılır.
  assert.equal(fn.revisionFilterMode({ revision: 'sacma' }), '');
  assert.equal(fn.revisionFilterMode({ revision: 'revised' }), 'revised');
});

test('v6.34 yalnız revizyon seçiliyken değer kontrolü satırı elemiyor', () => {
  // TUZAK: prepareColFilter, values'suz girdiyi {kind:'none'} sayıp satırı ELER.
  // Yalnız revizyon kurulduğunda değer kontrolü tamamen atlanmalı.
  const block = bodyOf(APP, 'passesColFilters');
  assert.match(block, /if\(mode&&!revisionFilterPasses\(mode,k,row\)\)return false;/);
  assert.match(block, /if\(mode&&!colFilterHasValueTest\(entry\)\)continue;/);
  const has = new Function(`function colFilterHasValueTest(entry){${bodyOf(APP, 'colFilterHasValueTest')}} return colFilterHasValueTest;`)();
  assert.equal(has({ revision: 'revised' }), false);
  assert.equal(has({ revision: 'revised', values: new Set(['a']) }), true);
  assert.equal(has({ range: { min: 1, max: 2 } }), true);
});

test('v6.34 revizyon filtresi index.html geçersiz kılmasında da tanınıyor', () => {
  // v5.95/v5.99 dersi: upgradeExcelFilters passesColFilters'ı TAMAMEN değiştirir.
  // Yalnız app-main güncellenirse filtre panelde görünür ama hiçbir satırı etkilemez.
  const block = HTML.slice(HTML.indexOf('passesColFilters=function'), HTML.indexOf('const originalOpen=openHeaderFilter'));
  assert.match(block, /revisionFilterMode\(entry\)/);
  assert.match(block, /revisionFilterPasses\(revMode,k,row\)/);
  assert.match(block, /colFilterHasValueTest\(entry\)/);
});

test('v6.34 revizyon bölümü yalnız revize edilebilir tarih sütunlarında', () => {
  const fn = new Function('BLRevision', `
    function isRevisableDateColumn(tableKey,key){${bodyOf(APP, 'isRevisableDateColumn')}}
    return isRevisableDateColumn;
  `)({ DATE_KEYS: ['Ex-factory', 'Retail Date', 'In-Store (Model Budget)'] });
  assert.equal(fn('cp', 'Ex-factory'), true);
  assert.equal(fn('orders', 'Retail Date'), true);
  assert.equal(fn('cp', 'Manufacturer'), false);
  assert.equal(fn('koleksiyon', 'Ex-factory'), false);
});

test('v6.34 değer seçimi uygulanınca revizyon kipi düşmüyor', () => {
  const block = bodyOf(APP, 'openHeaderFilter');
  assert.match(block, /const keepRevision = revisionFilterMode\(ex\);/);
  assert.match(block, /if\(keepRevision\) state\.colFilters\[tableKey\]\[key\] = \{revision:keepRevision\};/);
});

/* ------------------------------------------------- 4) ÜÇ DURUMLU İŞARET FİLTRESİ */

test('v6.34 işaret filtresi üç kipli ve eski boolean değeri taşıyor', () => {
  const fn = new Function(`function normalizeCheckFilterMode(value){${bodyOf(APP, 'normalizeCheckFilterMode')}} return normalizeCheckFilterMode;`)();
  // Eski kayıtlarda boolean duruyor olabilir; 'checked' sayılmalı.
  assert.equal(fn(true), 'checked');
  assert.equal(fn(false), '');
  assert.equal(fn('checked'), 'checked');
  assert.equal(fn('unchecked'), 'unchecked');
  assert.equal(fn('sacma'), '');
  assert.equal(fn(undefined), '');
  // Boş metin FALSY olmalı: "filtre etkin mi" kontrolleri değişmeden çalışsın.
  assert.ok(!fn(false));
  assert.ok(fn('unchecked'));
});

test('v6.34 sağ tık kipleri sırayla döndürüyor', () => {
  const decl = APP.slice(APP.indexOf('const CHECK_FILTER_CYCLE'));
  const cycle = new Function(`${decl.slice(0, decl.indexOf(';') + 1)} return CHECK_FILTER_CYCLE;`)();
  assert.deepEqual([...cycle], ['', 'checked', 'unchecked']);
  const block = bodyOf(APP, 'cycleCheckFilter');
  assert.match(block, /CHECK_FILTER_CYCLE\[\(CHECK_FILTER_CYCLE\.indexOf\(current\)\+1\) % CHECK_FILTER_CYCLE\.length\]/);
  // ▾ düğmesi kendi panelini açmaya devam etmeli; sağ tık onu yutmamalı.
  assert.match(APP, /if\(e\.target && e\.target\.closest && e\.target\.closest\('\.chkFilterBtn'\)\) return;/);
});

test('v6.34 işaretsiz kipi satırları ters yönde eliyor', () => {
  // CP ve Siparişler'in ikisinde de iki yönlü kontrol bulunmalı.
  assert.match(APP, /if\(ctx\.checkFilter==='checked' && !state\.cpSelected\.has\(r\._id\)\) return false;/);
  assert.match(APP, /if\(ctx\.checkFilter==='unchecked' && state\.cpSelected\.has\(r\._id\)\) return false;/);
  assert.match(APP, /if\(ctx\.checkFilter==='checked'&&!state\.ordersSelected\.has\(row\._id\)\)return false;/);
  assert.match(APP, /if\(ctx\.checkFilter==='unchecked'&&state\.ordersSelected\.has\(row\._id\)\)return false;/);
  // Koleksiyon da aynı kipi kullanmalı.
  const kol = bodyOf(APP, 'filteredKol');
  assert.match(kol, /checkMode==='checked' && !selectionHasId\(kolSelected,r\.id\)/);
  assert.match(kol, /checkMode==='unchecked' && selectionHasId\(kolSelected,r\.id\)/);
});

/* --------------------------------------------------- 5) SÜTUN BAĞIMSIZLAŞTIRMA */

test('v6.34 sentetik sütunlar Target Price ile birlikte kapanmıyor', () => {
  const block = bodyOf(APP, 'kolDescriptorCatalog');
  // Eski kod üçünü tek koşulun içine almıştı.
  assert.doesNotMatch(block, /if\(!kolHiddenCols\.has\('targetPrice'\)\)\{/);
  assert.match(block, /KOL_SYNTHETIC_COL_KEYS\.forEach\(key=>\{/);
  assert.match(block, /if\(kolHiddenCols\.has\(key\)\) return;/);

  const meta = new Function(`${APP.slice(APP.indexOf('const KOL_SYNTHETIC_COL_KEYS'), APP.indexOf('function kolIsSyntheticColKey'))}; return {KOL_SYNTHETIC_COL_KEYS, KOL_SYNTHETIC_COL_META};`)();
  assert.deepEqual([...meta.KOL_SYNTHETIC_COL_KEYS], ['__bestPrice__', '__confirmedName__', '__confirmedPrice__']);
  // Etiketler tek kaynaktan gelmeli; çizim ve sütun seçici ayrışamaz.
  assert.equal(meta.KOL_SYNTHETIC_COL_META.__bestPrice__.label, 'Best Price');
  assert.equal(meta.KOL_SYNTHETIC_COL_META.__confirmedName__.kind, 'confirmedName');
});

test('v6.34 sentetik sütunlar sütun seçicide listeleniyor ve kayıt ediliyor', () => {
  // Panelde görünmezlerse kapatılan sütun bir daha açılamazdı.
  assert.match(APP, /cols\.concat\(KOL_SYNTHETIC_COL_KEYS\.map\(key=>\(\{k:key,label:KOL_SYNTHETIC_COL_META\[key\]\.label\}\)\)\)/);
  // Gizli sütun kümesi yüklenirken sentetik anahtarlar ELENMEMELİ (kolColDefs'te yoklar).
  const matches = APP.match(/kolIsSyntheticColKey\(k\)\|\|kolColDefs\(\)\.some/g) || [];
  assert.equal(matches.length, 2, 'her iki yükleme yolu da sentetik anahtarları korumalı');
});

/* ------------------------------------------------------------- 6) ÖZET SATIRI */

test('v6.34 tam çizim gerekmeyen düzenlemede özet satırı tazeleniyor', () => {
  const block = bodyOf(APP, 'commitKolEditor');
  assert.match(block, /if\(rerender && needsRerender\) renderKol\(\);\s*\n\s*else if\(rerender\) refreshKolSummaryFooter\(\);/);
  const refresh = bodyOf(APP, 'refreshKolSummaryFooter');
  assert.match(refresh, /renderKolSummaryFooter\(table, filteredKol\(\), kolDisplayDescriptors\(\)/);
});

/* ------------------------------------- 7) MEVCUT QUOTATIONS KAYDINI GÜNCELLEME */

test('v6.34 elle fiyat girişi mevcut Quotations satırını yerinde güncelliyor', () => {
  const block = APP.slice(APP.indexOf('function openKolManualPriceModal'), APP.indexOf('function kolBestPricing'));
  // Önce yerinde güncelleme denenir; yalnız eşleşme yoksa yeni kayıt açılır.
  const updateAt = block.indexOf('api.updateCollectionLine');
  const recordAt = block.indexOf('api.recordRequest');
  assert.ok(updateAt >= 0 && recordAt > updateAt, 'yerinde güncelleme yeni kayıttan ÖNCE denenmeli');
  assert.match(block, /const created=updated\?null:await/);
});

test('v6.34 onay kutusu iki yönlü: boş bırakılınca onay kaldırılıyor', () => {
  const block = APP.slice(APP.indexOf('function openKolManualPriceModal'), APP.indexOf('function kolBestPricing'));
  assert.match(block, /const wantConfirmed=modal\.querySelector\('#_kolManualConfirm'\)\.checked;/);
  assert.match(block, /else if\(norm\(row\.confirmedManufacturer\)===norm\(mfr\)\)row\.confirmedManufacturer='';/);
});

test('v6.34/v6.51 Quotations satır arama en güncel ve düzenlenebilir kaydı seçiyor', () => {
  const block = bodyOf(QUOTES, 'findCollectionLine');
  // v6.51: kapalı kayıtlar artık düzenlenebilir olduğu için arama kapsamından
  // ATLANMIYOR — atlansaydı Koleksiyon'dan "düzenle" dendiğinde kapalı bir
  // kaydı bulamayıp v6.34'ün çözdüğü "çift kayıt" sorunu geri gelirdi.
  assert.doesNotMatch(block, /if\(req\.status==='closed'\) return;/);
  // Düşürülmüş satır ve salt görüntülenen kayıt hâlâ aday olmamalı.
  assert.match(block, /if\(line\.dropped\) return;/);
  assert.match(block, /if\(!qCanEditLine\(req,line\)\) return;/);
  // Birden çok aday varsa EN GÜNCEL kayıt kazanmalı.
  assert.match(block, /stamp>hit\.stamp/);
  // API dışarı açılmalı, yoksa app-main çağıramaz.
  assert.match(QUOTES, /findCollectionLine,updateCollectionLine,/);
});

test('v6.34 yerinde güncelleme yalnız gerçekten değişen onayı çeviriyor', () => {
  const block = bodyOf(QUOTES, 'updateCollectionLine');
  // toggleApproval iki yönlü olduğu için koşulsuz çağrılırsa onayı TERSİNE çevirirdi.
  assert.match(block, /if\(approved!==undefined && \(line\.approved===true\)!==Boolean\(approved\)\) qToggleApproval\(req,line\);/);
  assert.match(block, /if\(!found\) return false;/);
});
