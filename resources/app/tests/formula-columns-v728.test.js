'use strict';

/*
 * v7.28 — HESAPLANAN SÜTUNLAR (formül sütunu)
 *
 * Kullanıcı talebi (birebir):
 *   "tablolara sütunları birleştiren, sütunlar arası hesaplama yapabilen bir
 *    yeni sütun ekle sistemi kurmak istiyorum. mesela X ve Y sütununu tarih
 *    içeriyor, Z sütununu oluşturup X ve Y arasinda kaç gün fark var görmek
 *    istiyorum. veya A ve B sütununu rakam içeriyor, aralarindaki
 *    farkı/çarpımı/bölme sonucunu ve benzeri matamatik işlemlerinden birinin
 *    veya komplike bir formülün sonucunu C sütununu oluşturup görebilileyim.
 *    mevcut durumda columns başlığı altında add column var, oradan
 *    yürüyebilirsin."
 *
 * BU DOSYANIN KORUDUĞU DAVRANIŞLAR
 *
 *  1) İKİ TARİHİN FARKI GÜNDÜR. "20260302" gibi 8 haneli bir tarih metnini
 *     sayı sanıp 20260302 − 20260216 = 86 üretmek sessiz ve çok pahalı bir
 *     hatadır; sonuç 14 GÜN olmalıdır.
 *  2) TÜRKÇE SAYI BİÇİMİ. "1.234" bin iki yüz otuz dört, "2,50" iki buçuktur.
 *     Yanlış ayrıştırma ürünün her fiyat hesabını bozar.
 *  3) HATA GİZLENMEZ (§152). Olmayan sütun, sıfıra bölme ve bozuk formül
 *     "0" değil HATA üretir; hücre "—" gösterir.
 *  4) BOŞ HÜCRE SIFIR DEĞİLDİR. Boş bir hücreyle yapılan aritmetik boş verir;
 *     aksi halde eksik veri "0 gün fark" gibi görünürdü.
 *  5) TANIM SİLİNCE VERİ KAYBI OLMAZ (§142). Yalnız hesaplanan sütun düşer,
 *     kaynak satır alanlarına dokunulmaz.
 *  6) BAĞLANTI (wiring). Sütun paneli düğmesi, hücre çizimi, çizim öncesi
 *     hesaplama çağrısı ve kullanıcı-hesabı eşitlemesi gerçekten bağlı olmalı;
 *     motor doğru çalışıp ekrana hiç ulaşmayabilirdi.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const engine = require('../public/formula-engine.js');
const { assertLazy, sources } = require('./helpers/script-loading');

const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const appMain = read('public/app-main.js');
const formulaColumns = read('public/formula-columns.js');
const indexHtml = read('public/index.html');

function value(source, row) {
  const program = engine.compile(source);
  assert.equal(program.ok, true, `formül derlenemedi: ${source} → ${program.error && program.error.message}`);
  return program.evaluate(row, { strictColumns: true });
}

/* ------------------------------------------------------------------ */
/* 1) Tarih farkı — kullanıcının birinci örneği                        */
/* ------------------------------------------------------------------ */

test('iki tarih sütununun farkı GÜN verir (8 haneli ASAS tarih metni dâhil)', () => {
  const row = { 'Ex-factory': '20260216', 'Retail Date': '20260302' };
  assert.equal(value('[Retail Date] - [Ex-factory]', row).value, 14);
  assert.equal(value('DAYS([Ex-factory], [Retail Date])', row).value, 14);
});

test('8 haneli olduğu hâlde tarih olmayan sayılar SAYI kalır', () => {
  // 99999999 geçerli bir takvim günü değildir; tarih sanılırsa çarpım bozulur.
  const row = { A: '99999999', B: '2' };
  assert.equal(value('[A] - [B]', row).value, 99999997);
});

test('gg.aa.yyyy ve ISO biçimleri de tarih sayılır', () => {
  assert.equal(value('DAYS([A], [B])', { A: '01.03.2026', B: '2026-03-11' }).value, 10);
});

test('tarih farkı negatif olabilir — ters sıra sessizce düzeltilmez', () => {
  assert.equal(value('[A] - [B]', { A: '20260216', B: '20260302' }).value, -14);
});

/* ------------------------------------------------------------------ */
/* 2) Sayısal işlemler — kullanıcının ikinci örneği                    */
/* ------------------------------------------------------------------ */

test('fark / çarpım / bölme ve karmaşık formül', () => {
  const row = { A: 120, B: 30, Adet: 1000, Fiyat: 2.5 };
  assert.equal(value('[A] - [B]', row).value, 90);
  assert.equal(value('[A] * [B]', row).value, 3600);
  assert.equal(value('[A] / [B]', row).value, 4);
  assert.equal(value('ROUND([B] / [A] * 100, 1)', row).value, 25);
  assert.equal(value('[Adet] * [Fiyat]', row).value, 2500);
  assert.equal(value('ROUND(([A] - [B]) / [A] * 100, 2)', row).value, 75);
});

/* Sayı biçimi — bilinçli bir karar, kaza değil.
 *
 * "1.234" tek başına iki anlama gelir: Türkçe binlik (1234) veya ondalık
 * (1,234). Programın geri kalanı (app-main.js `toNum`) ham `Number()`
 * kullanır, yani NOKTA ONDALIK ayırıcıdır. Formül motoru bunu değiştirseydi
 * aynı hücre CP sütununda başka, formül sütununda başka değer verirdi —
 * kullanıcının fark etmesi çok zor bir tutarsızlık. Bu yüzden motor programla
 * aynı kuralı uygular. Belirsizlik olmayan biçimler ("1.234,56", "1,234.56")
 * ise doğru çözümlenir. */
test('nokta ondalık ayırıcıdır — programın geri kalanıyla aynı kural', () => {
  const row = { 'Order Quantity': '1.234', 'Supp. FOB': '2,50' };
  assert.equal(value('[Order Quantity] * [Supp. FOB]', row).value, 3.085);
  assert.equal(Number('1.234'), 3.085 / 2.5, 'app-main toNum ile aynı yorum');
});

test('belirsizlik olmayan binlik biçimleri doğru çözümlenir', () => {
  assert.equal(value('[A] + 0', { A: '1.234,56' }).value, 1234.56); // TR
  assert.equal(value('[A] + 0', { A: '1,234.56' }).value, 1234.56); // EN
  assert.equal(value('[A] + 0', { A: '1.234.567' }).value, 1234567); // birden çok nokta binliktir
});

test('işlem önceliği ve parantez matematiğe uyar', () => {
  assert.equal(value('2 + 3 * 4', {}).value, 14);
  assert.equal(value('(2 + 3) * 4', {}).value, 20);
  assert.equal(value('2 ^ 3 ^ 2', {}).value, 512); // sağdan birleşir
});

/* ------------------------------------------------------------------ */
/* 3) Hata gizlenmez                                                   */
/* ------------------------------------------------------------------ */

test('olmayan sütun 0 değil HATA üretir', () => {
  const result = value('[Yok Böyle Bir Sütun] + 1', { A: 1 });
  assert.equal(result.ok, false);
  assert.match(result.error, /Sütun bulunamadı/);
});

test('sıfıra bölme hata verir, sonsuz veya 0 vermez', () => {
  const result = value('[A] / [B]', { A: 5, B: 0 });
  assert.equal(result.ok, false);
  assert.equal(result.value, null);
});

test('bozuk formül derlenmez ve sebebi bildirilir', () => {
  const program = engine.compile('[A] + ');
  assert.equal(program.ok, false);
  assert.ok(program.error && program.error.message);
});

test('IFERROR ile kullanıcı hatayı bilerek yutabilir', () => {
  assert.equal(value('IFERROR([A] / [B], 0)', { A: 5, B: 0 }).value, 0);
});

/* ------------------------------------------------------------------ */
/* 4) Boş hücre sıfır değildir                                         */
/* ------------------------------------------------------------------ */

test('boş hücreyle aritmetik boş verir — 0 değil', () => {
  assert.equal(value('[A] - [B]', { A: '', B: 5 }).value, null);
  assert.equal(value('DAYS([A], [B])', { A: '', B: '20260302' }).value, null);
});

test('ISBLANK / COALESCE ile boş hücre bilinçli yönetilir', () => {
  assert.equal(value('IF(ISBLANK([A]), "YOK", "VAR")', { A: '', B: 1 }).value, 'YOK');
  assert.equal(value('COALESCE([A], [B])', { A: '', B: 7 }).value, 7);
});

/* ------------------------------------------------------------------ */
/* 5) Metin ve koşul                                                   */
/* ------------------------------------------------------------------ */

test('sütunları birleştirme (kullanıcı: "sütunları birleştiren")', () => {
  const row = { Model: 'ABC', Renk: 'Mavi' };
  assert.equal(value('[Model] & " · " & [Renk]', row).value, 'ABC · Mavi');
  assert.equal(value('CONCAT([Model], "-", [Renk])', row).value, 'ABC-Mavi');
});

test('koşullu sütun', () => {
  assert.equal(value('IF([A] > [B], "EVET", "HAYIR")', { A: 5, B: 3 }).value, 'EVET');
  assert.equal(value('IF([A] > [B], "EVET", "HAYIR")', { A: 1, B: 3 }).value, 'HAYIR');
});

test('IF tembeldir: seçilmeyen dal hata verse bile sonuç üretilir', () => {
  // Aksi hâlde "IF(B=0; 0; A/B)" gibi güvenli bir formül sıfıra bölme hatası verirdi.
  assert.equal(value('IF([B] = 0, 0, [A] / [B])', { A: 5, B: 0 }).value, 0);
});

/* ------------------------------------------------------------------ */
/* 6) Bağlantı — modül gerçekten uygulamaya takılı mı                  */
/* ------------------------------------------------------------------ */

test('formül betikleri app-main.js sonrasında, lazy deferredUi grubunda yüklenir', () => {
  // v7.69: formül motoru artık açılışta eager değil. app-main.js'ten SONRA
  // gelme koşulu hâlâ geçerli — deferredUi grubu UI_READY sonrasında yükleniyor
  // ve grup içindeki sıra da korunmalı (engine, columns'tan önce).
  assert.match(indexHtml, /app-main\.js\?/, 'app-main.js eager kalmalı');
  assertLazy('formula-engine.js');
  assertLazy('formula-columns.js');
  const { perf } = sources();
  const group = perf.slice(perf.indexOf('deferredUi:'), perf.indexOf('],', perf.indexOf('deferredUi:')));
  assert.ok(group.indexOf("'formula-engine.js'") >= 0 && group.indexOf("'formula-columns.js'") >= 0,
    'her iki betik de deferredUi grubunda olmalı');
  assert.ok(group.indexOf("'formula-engine.js'") < group.indexOf("'formula-columns.js'"),
    'formula-engine.js, formula-columns.js öncesinde yüklenmeli');
});

test('sütun paneline "Hesaplanan Sütun" düğmesi eklenir ve üç tabloda açıktır', () => {
  assert.match(appMain, /data-formula-add=/);
  assert.match(appMain, /Hesaplanan Sütun/);
  assert.match(appMain, /FORMULA_COLUMN_TABLES\s*=\s*new Set\(\['cp','orders','ship'\]\)/);
  assert.match(appMain, /data-formula-edit=/);
  assert.match(appMain, /data-formula-drop=/);
});

test("cellHtml 'formula' türünü çizer ve hata durumunda tire gösterir", () => {
  const start = appMain.indexOf('function cellHtml(');
  assert.ok(start > 0);
  const body = appMain.slice(start, start + 4000);
  assert.match(body, /case 'formula':/);
  assert.match(body, /formatValue\(v, ?c\.formulaDef\)/);
  assert.match(body, /—/);
});

test('hesaplama üç çizimden de ÖNCE yapılır (sıralama ve sayfa filtreleri görsün)', () => {
  for (const [fn, key] of [['renderCPNow', 'cp'], ['renderOrdersNow', 'orders'], ['renderShipTable', 'ship']]) {
    const start = appMain.indexOf(`function ${fn}(`);
    assert.ok(start > 0, `${fn} bulunamadı`);
    const head = appMain.slice(start, start + 400);
    assert.ok(head.includes(`applyFormulaColumns('${key}')`), `${fn} formül hesaplamasını çağırmıyor`);
  }
});

test('satır sağlayıcısı üç tablo için de yayımlanır', () => {
  assert.match(appMain, /window\.BLFormulaRows\s*=/);
  assert.match(appMain, /window\.COLS_BY_TABLE\s*=\s*COLS_BY_TABLE/);
  for (const key of ['cp:', 'orders:', 'ship:']) assert.ok(appMain.includes(`  ${key} ()`), `${key} sağlayıcısı yok`);
});

test('Excel/pano çıktısı hesaplanan sütunu ekrandakiyle aynı yazar', () => {
  const start = appMain.indexOf('function cellPlainText(');
  const body = appMain.slice(start, start + 600);
  assert.match(body, /c\.type==='formula'/);
});

/* ------------------------------------------------------------------ */
/* 7) Sütun listesi bütünlüğü — sessiz kayıp olmasın                   */
/* ------------------------------------------------------------------ */

test('Database sütunu eklenince formül sütunları yeniden kurulur', () => {
  const start = appMain.indexOf('function syncCpModelColumns(');
  const body = appMain.slice(start, appMain.indexOf('function syncOrdersColumnsFromCp('));
  assert.match(body, /BLFormulaColumns\?\.syncColumns\('cp'\)/);
});

test('Siparişler tablosu CP kopyasını alırken CP formül sütunlarını taşımaz', () => {
  const start = appMain.indexOf('function syncOrdersColumnsFromCp(');
  const body = appMain.slice(start, start + 1200);
  assert.match(body, /CP_COLS\.filter\(c=>!c\.formulaCustom\)/);
  assert.match(body, /BLFormulaColumns\?\.syncColumns\('orders'\)/);
});

test('formül sütunu formülünde başka formül sütunu kullanılamaz (sonsuz döngü)', () => {
  const start = formulaColumns.indexOf('function sourceColumns(');
  const body = formulaColumns.slice(start, start + 900);
  assert.match(body, /col\.formulaCustom/);
});

/* ------------------------------------------------------------------ */
/* 8) Kalıcılık ve kullanıcı hesabı                                    */
/* ------------------------------------------------------------------ */

test('tanımlar kullanıcı hesabıyla eşitlenir ve "columns" kategorisindedir', () => {
  assert.match(read('public/user-storage.js'), /'bl\.formulaColumns\.'/);
  const prefs = read('server/lib/user-preferences.js');
  const columnsBlock = prefs.slice(prefs.indexOf('columns: Object.freeze(['), prefs.indexOf('views: Object.freeze('));
  assert.match(columnsBlock, /'bl\.formulaColumns\.'/, 'kopyalanabilmesi için columns kategorisinde olmalı');
});

test('kategori çözümleyicisi anahtarı columns olarak tanır', () => {
  const prefs = require('../server/lib/user-preferences.js');
  assert.equal(prefs.isSyncedKey('bl.formulaColumns.cp.v1'), true);
});

test('sütun silmek yalnız hesaplanan alanı düşürür, kaynak veriye dokunmaz (§142)', () => {
  const start = formulaColumns.indexOf('function remove(');
  const body = formulaColumns.slice(start, start + 700);
  assert.match(body, /delete row\[key\]/);
  assert.ok(!/rows\.length\s*=\s*0|splice\(0, ?rows\.length\)/.test(body), 'satır dizisine dokunulmamalı');
});

test('tablo başına sütun sayısı sınırlıdır (depo kotası taşmasın)', () => {
  assert.match(formulaColumns, /MAX_PER_TABLE\s*=\s*\d+/);
});

/* ------------------------------------------------------------------ */
/* 9) Biçimlendirme kuralları                                          */
/* ------------------------------------------------------------------ */

test('yüzde ve ondalık biçimleri tanımlıdır', () => {
  for (const key of ['auto', 'number', 'integer', 'percent', 'date', 'text']) {
    assert.ok(formulaColumns.includes(`${key}: {`), `${key} biçimi yok`);
  }
});

test('tarih sonucu satıra ISO olarak yazılır (metin sıralaması doğru kalsın)', () => {
  assert.match(formulaColumns, /result\.value instanceof Date \? engine\(\)\.dateText\(result\.value\)/);
  // ISO metin sıralaması takvim sırasıyla aynıdır; gg.aa.yyyy olsaydı olmazdı.
  const dates = ['2026-03-02', '2025-12-31', '2026-01-05'].sort();
  assert.deepEqual(dates, ['2025-12-31', '2026-01-05', '2026-03-02']);
});

/* Bu iki testin yakaladığı hata gerçekti: ekranda GÖRÜNEN tarih bir gün geriydi.
   Uygulamanın satırlarındaki tarihler YEREL gece yarısı Date nesneleridir;
   motor UTC okuduğu için Türkiye'de (UTC+3) 2 Mart "2026-03-01" çıkıyordu. */
test('yerel gece yarısı Date nesnesi bir gün kaymaz (UTC+3)', () => {
  const localMidnight = new Date(2026, 2, 2); // Excel çözümlemesinin ürettiği biçim
  assert.equal(engine.dateText(engine.toDate(localMidnight)), '2026-03-02');
  assert.equal(engine.compile('YEAR([A]) * 10000 + MONTH([A]) * 100 + DAY([A])')
    .evaluate({ A: localMidnight }).value, 20260302);
});

/* ------------------------------------------------------------------ */
/* 10) Kısmî hata "sütun bozuk" gibi gösterilmez                       */
/* ------------------------------------------------------------------ */

test('kaç satırda hesaplanamadığı sayılır — birkaç boş hücre sütunu bozuk göstermez', () => {
  const start = formulaColumns.indexOf('function applyToRows(');
  const body = formulaColumns.slice(start, formulaColumns.indexOf('let lastErrors'));
  assert.match(body, /failed\+\+/);
  assert.match(body, /failed === list\.length/, 'hepsi başarısızsa ham sebep, kısmîyse sayı yazılmalı');
  assert.match(body, /satırın .* tanesinde hesaplanamadı/);
});

test('düzeltilen bir formülün eski uyarısı ekranda asılı kalmaz', () => {
  const start = formulaColumns.indexOf('function refresh(');
  const body = formulaColumns.slice(start, start + 500);
  assert.match(body, /delete lastErrors\[definition\.id\]/);
});

/* ------------------------------------------------------------------ */
/* 11) Yeni sütun görünür olur                                         */
/* ------------------------------------------------------------------ */

test('kaydedince tablo yeni sütuna kaydırılır (46+ sütunlu tabloda sağda kalırdı)', () => {
  assert.match(formulaColumns, /function revealColumn\(/);
  assert.match(formulaColumns, /revealColumn\(tableKey, item\)/);
  const start = formulaColumns.indexOf('function revealColumn(');
  const body = formulaColumns.slice(start, start + 900);
  assert.match(body, /scrollTo|scrollLeft/);
  assert.match(body, /fcJustAdded/);
  assert.match(read('public/app.css'), /th\.fcJustAdded/);
});

/* ------------------------------------------------------------------ */
/* 12) Sürüm yayılımı                                                  */
/* ------------------------------------------------------------------ */

/* v7.29'da GÜNCELLENDİ (silinmedi). Bu iki test sürüm numarasını "7.28" olarak
   SABİT yazıyordu, bu yüzden her sürüm yükseltmesinde kırılıyordu ve gerçek bir
   kusuru değil yalnız tarihi bildiriyordu. Amaç aynı kalıyor — sürüm her yere
   yayılmalı ve formül betikleri güncel önbellek etiketiyle yüklenmeli — ama
   beklenen değer package.json'dan OKUNUYOR. */
const CURRENT_VERSION = JSON.parse(read('package.json')).version;
const CURRENT_DISPLAY_VERSION = CURRENT_VERSION.replace(/^7\.0\./, '7.');

test('sürüm numarası tek canonical runtime kaynaktan yayılır', () => {
  assert.match(CURRENT_VERSION, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  assert.match(CURRENT_DISPLAY_VERSION, /^7\.\d+$/);
  assert.ok(indexHtml.includes('Version __BL_DISPLAY_VERSION__'), 'statik HTML display placeholder taşımalı');
  assert.ok(indexHtml.includes('buyerlog.bootRetry.v__BL_DISPLAY_VERSION__'), 'boot anahtarı runtime display sürümünden türemeli');
  assert.ok(indexHtml.includes('?v=__BL_ASSET_VERSION__'), 'asset cache canonical runtime sürümünden türemeli');
  assert.equal(indexHtml.includes(`Version ${CURRENT_DISPLAY_VERSION}`), false, 'görünür sürüm statik HTML içinde hard-code edilmemeli');
  assert.equal(indexHtml.includes(`?v=${CURRENT_DISPLAY_VERSION}`), false, 'cache sürümü statik HTML içinde hard-code edilmemeli');
  const history = read('public/version-history.js');
  const escapedDisplay = CURRENT_DISPLAY_VERSION.replace(/\\./g, '\\\\.');
  assert.match(history, new RegExp(`window\\.BL_VERSION_HISTORY = \\[\\s*\\{ v: ['"]${escapedDisplay}['"]`), 'sürüm geçmişinin ilk kaydı gerçek current display version olmalı');
  assert.doesNotMatch(history, /\bv:\s*['"]__CURRENT__['"]/, 'hareketli current placeholder geçmiş kaydı olarak kullanılamaz');
});

test('formül betikleri canonical asset etiketiyle yüklenir (önbellek yenilensin)', () => {
  assert.ok(indexHtml.includes('perf-runtime.js?v=__BL_ASSET_VERSION__'), 'perf-runtime canonical asset placeholder taşımalı');
  const { perf } = sources();
  assert.match(perf, /const VER=\(function\(\)\{[\s\S]*?document\.currentScript[\s\S]*?\[?\&\]?v=/, 'sürüm kendi script etiketinden okunmalı');
  assert.match(perf, /function withVersion\(src\)\{if\(!VER\|\|\/\[\?&\]v=\/\.test\(src\)\)return src;return src\+\(src\.includes\('\?'\)\?'&':'\?'\)\+'v='\+encodeURIComponent\(VER\);\}/, 'her lazy betiğe sürüm eklenmeli');
  assert.match(perf, /function loadScript\(rawSrc\)\{\s*const src=withVersion\(rawSrc\);/, 'yükleyici withVersion kullanmalı');
});

/* ------------------------------------------------------------------ */
/* 13) KURUCU — formül yazmadan sütun kurma                            */
/*                                                                     */
/* Kullanıcı geri bildirimi (birebir): "formülleri bu şekilde kod gibi  */
/* yazmak kullanıcı dostu değil, exceldeki gibi matematik işlemleri ile */
/* belirtmek daha basit olacak." + "A&B&C sutunlarini birlestirmek      */
/* istediğime ... aralarında ayraç olmalı."                            */
/* ------------------------------------------------------------------ */

// Kurucu tarayıcı modülünde; testte window/document taklidi ile yüklenir.
function loadColumnsModule() {
  const previousWindow = global.window;
  const previousDocument = global.document;
  global.document = { readyState: 'complete', addEventListener() {} };
  global.window = global;
  delete require.cache[require.resolve('../public/formula-columns.js')];
  require('../public/formula-columns.js');
  const api = global.window.BLFormulaColumns;
  global.window = previousWindow;
  global.document = previousDocument;
  return api;
}
const FC = loadColumnsModule();

test('varsayılan kip formül yazmayı gerektirmez — üç kip vardır', () => {
  const modeBlock = formulaColumns.slice(formulaColumns.indexOf('class="fcModes"'), formulaColumns.indexOf('data-fc-build'));
  for (const mode of ['calc', 'join', 'advanced']) {
    assert.ok(modeBlock.includes(`'${mode}'`), `${mode} kipi yok`);
  }
  assert.match(formulaColumns, /data-fc-mode="\$\{id\}"/);
  // Formül kutusu yalnız Gelişmiş kipte çizilir.
  const build = formulaColumns.slice(formulaColumns.indexOf('function renderBuild('), formulaColumns.indexOf('function renderFormulaEcho('));
  const calcBlock = build.slice(build.indexOf("builder.mode === 'calc'"), build.indexOf("builder.mode === 'join'"));
  assert.equal(calcBlock.includes('data-fc-formula'), false, 'Hesaplama kipinde formül kutusu olmamalı');
});

test('işlem listesi Excel işaretleriyle gösterilir (+ − × ÷)', () => {
  assert.deepEqual(FC.OPERATORS.map(o => o.sign), ['+', '−', '×', '÷']);
  assert.deepEqual(FC.OPERATORS.map(o => o.op), ['+', '-', '*', '/']);
});

test('kutulardan matematik formülü üretilir', () => {
  const calc = { mode: 'calc', operands: [{ kind: 'column', column: 'Retail Date' }, { kind: 'column', column: 'Ex-factory' }], operators: ['-'] };
  assert.equal(FC.calcFormula(calc), '([Retail Date] - [Ex-factory])');
});

test('KUTU SIRASI = HESAP SIRASI. "A ÷ B × 100" parantezle sabitlenir', () => {
  /* Parantezsiz "[A] / [B] * 100" da aynı sonucu verirdi, ama "[A] - [B] * 2"
     vermezdi: × önce işlenir ve kutuları soldan sağa okuyan kullanıcı bunu
     göremez. Her adımın parantezlenmesi bu sessiz farkı kapatır. */
  const percent = { mode: 'calc', operands: [{ kind: 'column', column: 'A' }, { kind: 'column', column: 'B' }, { kind: 'number', number: '100' }], operators: ['/', '*'] };
  assert.equal(FC.calcFormula(percent), '(([A] / [B]) * 100)');

  const risky = { mode: 'calc', operands: [{ kind: 'column', column: 'A' }, { kind: 'column', column: 'B' }, { kind: 'number', number: '2' }], operators: ['-', '*'] };
  const built = FC.calcFormula(risky);
  assert.equal(built, '(([A] - [B]) * 2)');
  const row = { A: 10, B: 4 };
  assert.equal(value(built, row).value, 12, 'kutu sırası: (10−4)×2 = 12');
  assert.equal(value('[A] - [B] * 2', row).value, 2, 'parantezsiz hâli 10−(4×2) = 2 verirdi — fark gerçek');
});

test('eksik kutu formül üretmez (yarım formül kaydedilemez)', () => {
  assert.equal(FC.calcFormula({ mode: 'calc', operands: [{ kind: 'column', column: 'A' }, { kind: 'column', column: '' }], operators: ['-'] }), '');
  assert.equal(FC.calcFormula({ mode: 'calc', operands: [{ kind: 'number', number: '' }], operators: [] }), '');
});

test('sabit sayı operandı Türkçe virgülle de yazılabilir', () => {
  assert.equal(FC.calcFormula({ mode: 'calc', operands: [{ kind: 'column', column: 'A' }, { kind: 'number', number: '1,5' }], operators: ['*'] }), '([A] * 1.5)');
});

test('BİRLEŞTİRME: seçilen sütunlar ayraçla birleşir', () => {
  const join = { mode: 'join', columns: ['MAG', 'MMYG', 'Buying Grup'], separator: ' - ', skipEmpty: true };
  assert.equal(FC.joinFormula(join), 'TEXTJOIN(" - ", true, [MAG], [MMYG], [Buying Grup])');
  assert.equal(value(FC.joinFormula(join), { MAG: 'CK1E', MMYG: 'CKW1', 'Buying Grup': 'ÖRME' }).value, 'CK1E - CKW1 - ÖRME');
});

test('BOŞ HÜCRE ayracı çift bırakmaz — "&" ile birleştirmenin asıl sorunu buydu', () => {
  const row = { A: 'ELBİSE', B: '', C: 'MAVİ' };
  assert.equal(value('TEXTJOIN(" - ", true, [A], [B], [C])', row).value, 'ELBİSE - MAVİ');
  assert.equal(value('TEXTJOIN(" - ", false, [A], [B], [C])', row).value, 'ELBİSE -  - MAVİ');
  assert.equal(value('[A] & " - " & [B] & " - " & [C]', row).value, 'ELBİSE -  - MAVİ', 'eski yol boşluğu koruyor — kurucu bu yüzden TEXTJOIN üretiyor');
});

test('hepsi boşsa sonuç boştur, yalnız ayraç yazılmaz', () => {
  assert.equal(value('TEXTJOIN(" - ", true, [A], [B])', { A: '', B: '' }).value, null);
});

test('ayraç seçenekleri arasında boşluk ve özel ayraç da vardır', () => {
  assert.ok(FC.SEPARATORS.some(item => item.value === ' '), 'boşluk ayracı olmalı');
  assert.ok(FC.SEPARATORS.length >= 5);
  assert.match(formulaColumns, /data-fc-separator-custom/, 'özel ayraç kutusu olmalı');
  // Tırnak içeren özel ayraç formülü bozmamalı.
  const tricky = FC.joinFormula({ columns: ['A', 'B'], separator: ' "x" ', skipEmpty: true });
  assert.equal(value(tricky, { A: '1', B: '2' }).value, '1 "x" 2');
});

/* Bu testin yakaladığı hata gerçekti: kurucu ayracı tırnak içine alırken
   tırnağı \" ile kaçırıyordu, ama dizeleyici ters bölüyü tanımıyordu. Ayracına
   tırnak yazan kullanıcının sütunu hiç derlenmiyordu. */
test('metin içindeki tırnak ve ters bölü kaçışları çözülür', () => {
  assert.equal(value('"a \\" b"', {}).value, 'a " b');
  assert.equal(value("'a \\' b'", {}).value, "a ' b");
  assert.equal(value('"c:\\\\yol"', {}).value, 'c:\\yol');
  assert.equal(value('"satır\\nsonu"', {}).value, 'satır\nsonu');
  const program = engine.compile('"kapanmamış');
  assert.equal(program.ok, false, 'kapanmamış tırnak hâlâ hata vermeli');
});

test('DÜZENLEMEDE kutular geri gelir — formül motorun ayrıştırıcısıyla çözülür', () => {
  assert.deepEqual(FC.builderFromFormula('TEXTJOIN(" / ", false, [A], [B])'),
    { mode: 'join', columns: ['A', 'B'], separator: ' / ', skipEmpty: false });
  const calc = FC.builderFromFormula('(([A] / [B]) * 100)');
  assert.equal(calc.mode, 'calc');
  assert.deepEqual(calc.operators, ['/', '*']);
  assert.deepEqual(calc.operands.map(o => o.column || o.number), ['A', 'B', '100']);
  assert.equal(FC.builderFromFormula('[A] - [B]').mode, 'calc');
});

test('kutuya SIĞMAYAN formül kutu gibi gösterilmez — Gelişmiş kipte açılır', () => {
  // Yanlış kutu göstermek, kullanıcının formülünü sessizce değiştirmek olurdu.
  /* v7.175 — DAYS ve basit IF artık kendi kartlarına (Gün farkı / Koşula göre
     yaz) BİREBİR sığıyor; kart aynı metni geri üretmelidir. Sığmayanlar hâlâ
     Gelişmiş kipte açılır. */
  const days = FC.builderFromFormula('DAYS([A], [B])');
  assert.equal(days.mode, 'days');
  assert.equal(FC.builderFormula(days), 'DAYS([A], [B])');
  const condition = FC.builderFromFormula('IF([A] > 1000, "BÜYÜK", "KÜÇÜK")');
  assert.equal(condition.mode, 'ifelse');
  assert.equal(FC.builderFormula(condition), 'IF([A] > 1000, "BÜYÜK", "KÜÇÜK")');
  assert.equal(FC.builderFromFormula('IF([A] > 1000, [B] * 2, "KÜÇÜK")'), null, 'hesaplı dal karta sığmaz');
  assert.equal(FC.builderFromFormula('DAYS([A], TODAY())'), null, 'sütun olmayan tarih karta sığmaz');
  assert.equal(FC.builderFromFormula('[A] - [B] * 2'), null, 'sağa yaslı öncelik kutulara sığmaz');
  assert.equal(FC.builderFromFormula(''), null);
});

test('kurucu ile Gelişmiş kip arasında geçişte kurulan formül taşınır', () => {
  const start = formulaColumns.indexOf("if (next === 'advanced')");
  assert.ok(start > 0);
  // v7.175 — formül ekranda güncel sütun ADLARIYLA gösterilir (shown).
  assert.match(formulaColumns.slice(start, start + 140), /builder\.advanced = shown\(builderFormula\(builder\)\)/);
});

test('üretilen formül kullanıcıya AÇIKÇA gösterilir', () => {
  assert.match(formulaColumns, /function renderFormulaEcho\(/);
  assert.match(formulaColumns, /data-fc-echo/);
  assert.match(read('public/app.css'), /\.fcEcho/);
});

test('kurucu ile formül tek yürütücüden geçer — ikinci bir hesaplama yolu yok', () => {
  // Depoda saklanan alan yine formül metnidir; kurucu yalnız onu üretir.
  // v7.175 — kaydedilen metin kurucunun ürettiğidir; yalnız adlar kalıcı anahtara çevrilir.
  assert.match(formulaColumns, /const storedFormula = \(\) => toStorage\(tableKey, builderFormula\(builder\), draft\.refs\);/);
  assert.match(formulaColumns, /formula: stored\.formula,/);
  assert.equal(/row\[key\]\s*=\s*builder/.test(formulaColumns), false, 'kurucu satırlara doğrudan yazmamalı');
});

test('tarih GÖSTERİMİ programın diğer sütunlarıyla aynı biçimdedir (gg.aa.yy)', () => {
  assert.match(formulaColumns, /function dateDisplay\(/);
  assert.match(formulaColumns, /window\.fmtDate/, 'varsa uygulamanın kendi biçimlendiricisi kullanılmalı');
  // fmtDate yokken (test ortamı) yedek yol da gg.aa.yy üretir.
  const source = formulaColumns.slice(formulaColumns.indexOf('function dateDisplay('), formulaColumns.indexOf('function formatValue('));
  assert.match(source, /getUTCDate\(\)\)\}\.\$\{pad\(date\.getUTCMonth\(\) \+ 1\)\}\./);
});
