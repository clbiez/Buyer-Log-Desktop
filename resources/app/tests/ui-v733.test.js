'use strict';

/*
 * v7.33 — AYARLAR ÇEKMECESİ KIRPILMASI · TEK BİÇİMLİ SAYAÇ
 *
 * Kullanıcı talepleri (birebir):
 *   · "Source'da ayarlar çekmecesindeki butonlar görünmüyor."
 *   · "Tüm sayaçların formatını 30,5 gibi saniye şeklinde göster. virgülden
 *      sonra sadece 1 basamak olsun."
 *
 * Bu dosya iki kusuru da DAVRANIŞ düzeyinde doğrular: konumlandırma işlevi
 * kaynaktan çıkarılıp sahte bir görüntü alanında çalıştırılır, biçimlendirici
 * de gerçek değerlerle ölçülür. Yalnız metin araması yapmak, ikisinde de
 * hatanın tekrar etmesine izin verirdi (kırpılma CSS ile metinde görünmez).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const APP = read('public/app-main.js');
const OAB = read('public/oab.js');
const CSS = read('public/app.css');
const INDEX = read('public/index.html');

/* Kaynaktan tek bir işlevi söker; süslü parantezleri sayarak keser, böylece
   gövdedeki iç bloklar erken kesilmez. */
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} kaynakta bulunamadı`);
  let depth = 0, started = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') { depth++; started = true; }
    else if (ch === '}') { depth--; if (started && depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(`${name} gövdesi kapanmıyor`);
}

/* ------------------------------------------------------------------ */
/* 1) AYARLAR ÇEKMECESİ ARTIK KIRPILMIYOR                              */
/* ------------------------------------------------------------------ */

/* Asıl kusur buydu: menü position:absolute idi ve #sourceBody'nin
   overflow:auto + max-height:570px sınırları içinde kalıyordu. v7.31-32'de
   üç düğme daha eklenince menü büyüdü, üst kısmı kapsayıcının dışında kaldı
   ve kırpıldı — kullanıcı ilk altı düğmeyi hiç göremedi. */

/* v7.81 — AYARLAR ÇEKMECESİ KALDIRILDI; KUSUR ARTIK YAPISAL OLARAK İMKÂNSIZ.

   Asıl kusur şuydu: menü position:absolute idi ve #sourceBody'nin
   overflow:auto + max-height sınırları içinde kırpılıyordu; v7.31-32'de üç
   düğme daha eklenince kullanıcı ilk altı düğmeyi hiç göremedi. v7.33 bunu
   menüyü görüntü alanına göre konumlandırarak çözmüştü.

   v7.81'de menü tamamen kalktı: on üç iş Veri Yönetimi ekranındaki Araçlar
   bölümüne, sayfanın normal akışına taşındı. Kırpılabileceği bir kapsayıcı
   yok, dolayısıyla konumlandırma iddialarının sınayacağı bir şey de yok.

   Aşağıdaki iki test kusurun KAYNAĞININ hâlâ orada olduğunu ve yeni çözümün
   ona bağlı olmadığını kilitler. */

test('v7.81 · kusurun kaynağı duruyor: .sourceBody hâlâ kaydırılabilir', () => {
  const body = CSS.match(/\.sourceBody\{[^}]*\}/);
  assert.ok(body, '.sourceBody kuralı bulunmalı');
  assert.match(body[0], /overflow:\s*auto/,
    'kapsayıcı hâlâ kaydırılabilir; içine açılır bir menü konursa aynı kırpılma geri gelir');
});

test('v7.81 · araçlar kaydırılabilir kapsayıcıya değil, sayfanın akışına konur', () => {
  /* Çözüm "menüyü doğru konumlandırmak" değil, MENÜ KULLANMAMAK. Araçlar
     Veri Yönetimi ekranının kendi bölümünde; ne position:fixed'e ne de
     görüntü alanı hesabına ihtiyaç var. */
  const dmUi = fs.readFileSync(path.join(ROOT, 'public', 'data-management.js'), 'utf8');
  const dmCss = fs.readFileSync(path.join(ROOT, 'public', 'data-management.css'), 'utf8');
  assert.match(dmUi, /function toolsPanel\(\)/);
  assert.match(dmCss, /\.dmToolList\s*\{/);
  assert.doesNotMatch(dmCss, /\.dmToolList\s*\{[^}]*position:\s*fixed/,
    'araç listesi bir açılır yüzey değil, sayfanın parçası');
  // Ve eski menünün hiçbir izi kalmamalı.
  assert.doesNotMatch(CSS, /\.sourceSettingsMenu/);
  assert.doesNotMatch(APP, /positionSourceSettingsMenu/);
});

/* ------------------------------------------------------------------ */
/* 2) TEK BİÇİMLİ SAYAÇ: "30,5 sn"                                     */
/* ------------------------------------------------------------------ */

function makeFmt(lang) {
  const fn = extractFunction(APP, 'fmtDurationSn');
  return new Function('appLang', `${fn}; return fmtDurationSn;`)(lang);
}

test('v7.33 · sayaç saniye ve tek ondalık basamak yazar', () => {
  const fmt = makeFmt('tr');
  assert.equal(fmt(30500), '30,5 sn');
  assert.equal(fmt(500), '0,5 sn');
  assert.equal(fmt(1234), '1,2 sn');
});

test('v7.33 · ondalık basamak SABİT bir tanedir (tam saniye de virgüllü yazar)', () => {
  const fmt = makeFmt('tr');
  assert.equal(fmt(30000), '30,0 sn', 'alt alta duran sayaçlar hizalı kalmalı');
  assert.equal(fmt(0), '0,0 sn');
});

test('v7.33 · binlik ayracı Türkçe kurala uyar, ondalık ayracı virgüldür', () => {
  const fmt = makeFmt('tr');
  assert.equal(fmt(3600000), '3.600,0 sn');
  assert.equal(fmt(269992), '270,0 sn', 'eskiden "269.992 ms" yazan yer artık saniye gösterir');
});

test('v7.33 · İngilizce arayüzde nokta ondalık ve "s" birimi kullanılır', () => {
  const fmt = makeFmt('en');
  assert.equal(fmt(30500), '30.5 s');
  assert.equal(fmt(3600000), '3,600.0 s');
});

test('v7.33 · geçersiz/negatif süre uydurma değer üretmez, sıfıra sabitlenir', () => {
  const fmt = makeFmt('tr');
  assert.equal(fmt(-1), '0,0 sn');
  assert.equal(fmt(null), '0,0 sn');
  assert.equal(fmt(undefined), '0,0 sn');
  assert.equal(fmt(NaN), '0,0 sn');
  assert.equal(fmt('abc'), '0,0 sn');
});

test('v7.33 · biçimlendirici tek noktadan paylaşılır (yeni sayaç eklendiğinde de doğru olur)', () => {
  assert.match(APP, /window\.fmtDurationSn=fmtDurationSn;/, 'diğer modüller aynı biçimi kullanabilmeli');
  const count = (APP.match(/function fmtDurationSn\(/g) || []).length;
  assert.equal(count, 1, 'biçim tek bir yerde tanımlanmalı, kopyalanmamalı');
});

/* Kullanıcı "TÜM sayaçlar" dedi. Aşağıdaki testler, uygulamada süre yazan her
   yerin ortak biçimlendiriciden geçtiğini kanıtlar — biri unutulursa kırılır. */

test('v7.33 · bilinen tüm süre sayaçları ortak biçimlendiriciden geçer', () => {
  const sites = [
    /* v7.81: 'ranOk' ve 'countResult' silinen bağlantı modalının metinleriydi
       (modelConnText). Kural değişmedi — kalan her sayaç hâlâ listede ve yeni
       bir sayaç eklendiğinde bu test onu da zorunlu kılar. */
    ['modelConnDurationLabel', /function modelConnDurationLabel\(ms\)\{\s*return fmtDurationSn\(ms\);/],
    ['refreshSeconds', /function refreshSeconds\(ms\)\{\s*return fmtDurationSn\(ms\);/],
    ['prepareEmailProgressFormatElapsed', /function prepareEmailProgressFormatElapsed\(ms\)\{\s*return fmtDurationSn\(ms\);/],
    ['yenileme zamanlaması', /const t=c\.timings,\s*sec=ms=>fmtDurationSn\(ms\)/],
    ['yenileme düğmesi sayacı', /const elapsed=fmtDurationSn\(jobState\.elapsedMs\)/],
    ['kaynak satır sayacı', /return fmtDurationSn\(elapsed\);/],
  ];
  for (const [name, re] of sites) assert.match(APP, re, `${name} ortak biçimi kullanmalı`);
});

test('v7.33 · milisaniye ve dakika:saniye yazan eski biçimler kaldırıldı', () => {
  assert.doesNotMatch(APP, /\$\{ms\} ms/, 'ham milisaniye yazan sayaç kalmamalı');
  assert.doesNotMatch(APP, /toFixed\(1\)\}s`/, '"5.2s" biçimi Türkçe arayüzle çelişiyordu');
  assert.doesNotMatch(APP, /padStart\(2,'0'\)\}:\$\{String\(sec\)/, 'dakika:saniye sayacı kalmamalı');
});

test('v7.33 · OAB sayacı da aynı biçimi kullanır (iki ayrı sayaç gibi görünmez)', () => {
  assert.match(OAB, /if \(typeof global\.fmtDurationSn === 'function'\) return global\.fmtDurationSn\(ms\);/,
    'OAB app-main.js biçimlendiricisine devretmeli');
  assert.match(OAB, /oabSetStatus\(`\$\{S\.busyStatusMessage\} · \$\{oabBusyElapsedText\(\)\}`/,
    'OAB durum satırı sayacı bu işlevden almalı');
  assert.doesNotMatch(OAB, /oabIsEn\(\)/, 'v7.33 öncesi yanlış dil işlevi çağrısı kalmamalı');
});

test('v7.33 · OAB yedek biçimi de tek ondalık üretir (app-main.js yüklenmediyse)', () => {
  const fn = extractFunction(OAB, 'oabBusyElapsedText');
  const build = new Function('global', 'oabBusyElapsedMs', 'oabLang', `${fn}; return oabBusyElapsedText;`);
  const trFallback = build({}, () => 30500, () => false);
  assert.equal(trFallback(), '30,5 sn', 'yedek yol da aynı biçimi vermeli');
  const shared = build({ fmtDurationSn: () => '30,5 sn' }, () => 30500, () => false);
  assert.equal(shared(), '30,5 sn');
});

test('v7.33 · SÜRE TAHMİNİ sayaç değildir: yaklaşık değer sahte hassasiyet kazanmaz', () => {
  /* "~30 sn" bir ölçüm değil kestirimdir; ona ondalık eklemek olmayan bir
     kesinlik iddia ederdi. Bilerek biçim dışında bırakıldı. */
  assert.match(OAB, /if \(total < 90\) return oabT\(`~\$\{total\} sn`/);
});

test('v7.33 · yenileme uyarısındaki başlangıç metni yeni biçimle uyumlu', () => {
  // Hiç yenileme yapılmamışken artık "0,0 sn" değil "—" yazıyor. Bu, bu dosyanın
  // hemen üstündeki kuralla aynı gerekçe: yapılmamış bir ölçümü sıfır olarak
  // göstermek, olmayan bir kesinlik iddia eder. Biçim, gerçek bir ölçüm
  // olduğunda devreye giriyor.
  assert.match(APP, /function sourceRefreshTimerText\(key\)\{[\s\S]*?if\(elapsed==null\)return '—';[\s\S]*?return fmtDurationSn\(elapsed\);/,
    'ölçüm yokken yer tutucu, varken sabit biçim gösterilmeli');
  assert.match(APP, /data-source-timer="\$\{target\.key\}"[^>]*>\$\{escapeHtml\(sourceRefreshTimerText\(target\.key\)\)\}/,
    'ilk çizim de aynı biçimlendiriciyi kullanmalı');
});

test('v7.81 · "Kaynak Klasör" seçili yolu gösterir, satırı bozmadan', () => {
  /* Korunan kusur: eski düğmenin TAMAMI textContent ile değiştiriliyordu ve
     ilk durum okumasında simgesi de dil etiketi de siliniyordu. Düğme Veri
     Yönetimi araç satırına taşındı; aynı hataya düşmemek için seçili yol AYRI
     bir parçada tutulur — ad ve açıklama yeniden çizimde yerinde kalır. */
  const dmUi = fs.readFileSync(path.join(ROOT, 'public', 'data-management.js'), 'utf8');
  assert.ok(dmUi.includes("value: () => (model.environment || {}).sourceFolder"),
    'seçili klasör araç satırında görünmeli');
  assert.match(dmUi, /class="dmToolValue"/);

  /* Ve eski yol artık DÜĞMESİZ çalışmalı: btn null iken textContent yazmak
     TypeError veriyordu, yani araca tıklandığında hiçbir şey olmuyordu. */
  const pick = APP.slice(APP.indexOf('async function chooseSourceFolder'), APP.indexOf('async function refreshFolderLabel') > APP.indexOf('async function chooseSourceFolder') ? APP.indexOf('async function refreshFolderLabel') : undefined);
  assert.ok(pick.length, 'chooseSourceFolder bulunmalı');
  assert.doesNotMatch(pick, /^s*btn.(disabled|textContent)/m, 'düğme korumasız kullanılmamalı');
});
