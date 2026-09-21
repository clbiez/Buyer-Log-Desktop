'use strict';

/* Ufuk artık TEK KAYNAKTAN gelir: Veri Yönetimi'ndeki kaynak filtresi.
 *
 * Kullanıcı kararı: "Kişisel horizon konusunu sevmedim. Modüllerin
 * başlarındaki horizon alanını kaldıralım. Horizonlar tek bir yerden,
 * data management'dan ayarlansın. … Sayfa başlarında minimal bir şekilde
 * sadece seçili horizonun filtre özeti görünsün."
 *
 * KALDIRILANLAR (hepsi ölçülerek doğrulandı):
 *   · modül başlığındaki horizon seçici + Kaydet/Farklı kaydet/Yönet/Yenile
 *   · tıklanabilir filtre çipleri (düzenleme yolunun tamamı)
 *   · horizon-editor.js (kişisel ufuk düzenleyicisi — dosya silindi)
 *   · data-horizon-action tıklama işleyicisi (artık bu attribute'u üreten
 *     element kalmadığı için ölüydü)
 *   · kişisel ufka GERİ DÜŞÜŞ, veri yolunun iki yerinde
 *
 * Sonuncusu en önemlisi: geri düşüş kalsaydı kullanıcı "Veri Yönetimi'nde
 * filtre koymadım ama veri yine sınırlı" derdi — kişisel katmanı kaldırmanın
 * amacı tam olarak bu belirsizliği bitirmekti.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const PERF = fs.readFileSync(path.join(ROOT, 'public', 'perf-runtime.js'), 'utf8');

/* Açıklama yorumları kaldırılan adları anıyor; kontroller yorumsuz metinde
   yapılır (kayıtlı tuzak: doesNotMatch yorumları da eşleştirir). */
const CODE = APP.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\r\n]*/g, '$1');
const SERVER_CODE = SERVER.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\r\n]*/g, '$1');
function functionBlock(source, name) {
  const at = source.indexOf('function ' + name);
  assert.ok(at > -1, name + ' yok');
  const next = source.indexOf('\nfunction ', at + 10);
  return source.slice(at, next > at ? next : source.length);
}

test('kişisel ufuk düzenleyicisi dosyası silindi', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'public', 'horizon-editor.js')), false,
    'horizon-editor.js hâlâ duruyor');
  assert.doesNotMatch(PERF.replace(/\/\*[\s\S]*?\*\//g, ''), /horizon-editor\.js/,
    'tembel yükleme listesinde hâlâ kayıtlı — açılışta 404 üretir');
});

test('rozette düzenleme yolu kalmadı', () => {
  for (const gone of ['openCompactHorizonManager(', 'horizonCompactSelect', 'horizonCompactDropdown']) {
    assert.ok(!CODE.includes(gone), `${gone} hâlâ var — rozet düzenleme yolu taşıyor`);
  }
  assert.ok(!CODE.includes("closest('[data-horizon-action]')"),
    'ölü data-horizon-action işleyicisi duruyor');
});

test('rozet kaynak filtresini state\'ten okuyor, kişisel workspace\'i değil', () => {
  /* Veri /api/data yanıtında zaten geliyor (modelScopes + appliedHorizons);
     rozet için ayrı bir uç açmak her açılışta fazladan istek demekti. */
  assert.ok(!CODE.includes('ensureHorizonHeaderWorkspace('),
    'kişisel workspace okuması duruyor');
  const block = functionBlock(APP, 'renderHorizonBadges()');
  assert.ok(!block.includes('/api/user-workspace/'), 'rozet hâlâ kişisel ufku okuyor');
  assert.ok(!block.includes('fetch('), 'rozet çizimi ağ isteği atmamalı');
  assert.match(block, /state\.modelScopes/);
  assert.match(block, /appliedHorizons\[target\]/);
});

test('rozet salt okunur: buton üretmiyor', () => {
  const block = functionBlock(APP, 'renderHorizonBadges()');
  assert.ok(!/createElement\('button'\)/.test(block),
    'rozet hâlâ tıklanabilir öğe üretiyor — "sadece filtre özeti" kararına aykırı');
  assert.match(block, /horizonSummaryChip/, 'özet çipleri yok');
});

test('rozet için ayrı bir uç açılmadı', () => {
  /* İlk yazımda /api/horizon-summary eklemiştim; gereksizdi (veri zaten
     state'te) ve her sayfa açılışına bir istek ekliyordu. */
  assert.ok(!SERVER.includes("'/api/horizon-summary'"),
    'gereksiz uç geri gelmiş — veri zaten /api/data yanıtında');
});

test('rozet YAZMA yolu açmıyor', () => {
  const block = functionBlock(APP, 'renderHorizonBadges()');
  for (const write of ['fetch(', 'BLDataFilterEditor', 'planFilterChange']) {
    assert.ok(!block.includes(write), `rozet ${write} kullanıyor — salt okunur olmalı`);
  }
});

test('VERİ YOLUNDA kişisel ufka geri düşüş kalmadı', () => {
  /* En kritik madde: bu geri düşüşler kalsaydı kaynakta filtre yokken eski
     kişisel ufuk veriyi sessizce sınırlamaya devam ederdi. */
  const at = SERVER.indexOf('async function loadFromModels(');
  const block = SERVER_CODE.slice(SERVER_CODE.indexOf('async function loadFromModels('), SERVER_CODE.indexOf('async function loadFromModels(') + 4000);
  assert.ok(at > -1, 'loadFromModels yok');
  assert.ok(!block.includes('userPreferences.getHorizon('),
    'loadFromModels hâlâ kişisel ufka düşüyor');

  const filterAt = SERVER_CODE.indexOf('function filterRowsByEffectiveHorizon(');
  assert.ok(filterAt > -1, 'filterRowsByEffectiveHorizon yok');
  const filterBlock = SERVER_CODE.slice(filterAt, filterAt + 2500);
  assert.ok(!filterBlock.includes('userPreferences.resolveHorizon('),
    'satır süzgeci hâlâ kişisel ufka düşüyor');
});

test('LFL kendi kapsamı yoksa CP kapsamından beslenir', () => {
  /* horizonBadgeScope, sunucudaki loadFromModelConnections ile aynı sırayı
     izler; rozet o kuralı bozmamalı. */
  const block = functionBlock(APP, 'horizonBadgeScope(');
  assert.match(block, /target==='lfl'/);
  assert.match(block, /byTarget\.cp\|\|byTarget\.backlog/);
});

test('ufuk değişince özet kendiliğinden tazelenir', () => {
  /* Özet state'ten türediği için /api/data yenilendiğinde otomatik
     güncellenir; ayrı bir geçersiz kılma kancası gerekmiyor. */
  assert.match(APP, /renderHorizonBadges\(\)/, 'rozet çizimi çağrılmıyor');
  const block = functionBlock(APP, 'renderHorizonBadges()');
  assert.match(block, /state\.modelHorizons/);
});
