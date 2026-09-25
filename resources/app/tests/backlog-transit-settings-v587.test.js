'use strict';

// v5.87 — Backlog Excel'inin Ayarlar sayfasına NAKLİYE YOL SÜRELERİ tablosu.
//
// Eskiden yol süresi BACKLOG sayfasındaki formüle SAYI olarak gömülüydü
// (`IF(...,70,...)`): süreyi değiştirmek için raporu yeniden üretmek gerekiyordu.
// Artık her ayrı süre Ayarlar sayfasında bir satır ve BACKLOG'daki yardımcı
// sütun o hücreye BAĞLANIYOR — Gün hücresini elle değiştirmek Antrepo Giriş
// Tarihi'ni, gecikme bayraklarını ve Risk'i yeniden hesaplatıyor.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const formulas = require('../public/backlog-excel-formulas');

const HEADERS = [
  'GÜNCEL DURUM\n(STATUS)', 'REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)', 'ANTREPO GİRİŞ TARİHİ',
  'YÜKLEME TİPİ', 'Retail Depo Tarih Yıl Ay Gün', 'Model Bütçe Tarih Yıl Ay Gün',
  'ANTREPO-RETAIL', 'RİSK\n(PRIORITY)',
];

const RULE = { delType: 'Gemi', seasons: ['26SS'], countries: ['MISIR'], exfStart: '2026-01-01', exfEnd: '2026-06-30', days: 62 };
const rowWithRule = { _backlogExcel: { transitDays: 62, originalDelType: 'Gemi', transitRule: RULE } };
const rowWithoutRule = { _backlogExcel: { transitDays: 35, originalDelType: 'Gemi+Uçak', transitRule: null } };

test('v5.87 tablo varsayılanlarla başlar; kullanılan kurallar altına eklenir', () => {
  const plan = formulas.transitSettingsPlan([rowWithRule, rowWithoutRule], 'Ayarlar', 14, 6);
  const kinds = plan.entries.map(entry => `${entry.kind}:${entry.delType}=${entry.days}`);
  // Varsayılanlar HER ZAMAN yazılır: kullanıcı sayfada yükleme tipini
  // değiştirdiğinde formülün düşeceği satırlar bunlardır.
  assert.deepEqual(kinds, [
    'default:Gemi=70', 'default:Gemi+Uçak=35', 'default:Uçak=15', 'default:Gemi+Tır=25',
    'rule:Gemi=62',
  ]);
});

test('v5.87 aynı kural iki kez yazılmaz', () => {
  const plan = formulas.transitSettingsPlan(
    [rowWithRule, { _backlogExcel: { transitRule: { ...RULE } } }, rowWithRule], 'Ayarlar', 14, 6);
  assert.equal(plan.entries.filter(entry => entry.kind === 'rule').length, 1);
});

test('v5.87 satır formülü kendi kuralının Gün hücresine bağlanıyor', () => {
  const plan = formulas.transitSettingsPlan([rowWithRule], 'Ayarlar', 14, 6);
  const built = formulas.formulaPlan(HEADERS, rowWithRule, 2, { transit: plan });
  const formula = built.helperCells._BL_TRANSIT_DAYS.formula;
  // Kural satırı varsayılanlardan sonra geldiği için 14+4 = 18.
  assert.match(formula, /IF\(D2=M2,Ayarlar!\$G\$18,/);
  // Sabit sayı KALMAMALI; kalırsa Ayarlar'daki değişiklik rapora yansımaz.
  assert.doesNotMatch(formula, /,62,/);
});

test('v5.87 kuralı olmayan satır yükleme tipinin varsayılan hücresine bağlanır', () => {
  const plan = formulas.transitSettingsPlan([rowWithoutRule], 'Ayarlar', 14, 6);
  const built = formulas.formulaPlan(HEADERS, rowWithoutRule, 3, { transit: plan });
  // Gemi+Uçak varsayılanı ikinci satır → 15.
  assert.match(built.helperCells._BL_TRANSIT_DAYS.formula, /IF\(D3=M3,Ayarlar!\$G\$15,/);
});

test('v5.87 yükleme tipi değiştirilince varsayılan hücrelere düşülür', () => {
  const plan = formulas.transitSettingsPlan([rowWithRule], 'Ayarlar', 14, 6);
  const formula = formulas.formulaPlan(HEADERS, rowWithRule, 2, { transit: plan }).helperCells._BL_TRANSIT_DAYS.formula;
  // Sayfada YÜKLEME TİPİ değişirse kural artık geçerli değil; üç varsayılan
  // hücresi de formülde bulunmalı (Gemi+Uçak, Uçak, Gemi).
  assert.match(formula, /Ayarlar!\$G\$15/);
  assert.match(formula, /Ayarlar!\$G\$16/);
  assert.match(formula, /Ayarlar!\$G\$14/);
  assert.doesNotMatch(formula, /,35,|,15,|,70\)/);
});

test('v5.87 Ayarlar tablosu yoksa eski sabitlere düşülür', () => {
  // Backlog detay penceresinden yapılan dışa aktarımda Ayarlar sayfası yok.
  const formula = formulas.formulaPlan(HEADERS, rowWithRule, 2).helperCells._BL_TRANSIT_DAYS.formula;
  assert.match(formula, /IF\(D2=M2,62,/);
  assert.doesNotMatch(formula, /Ayarlar!/);
});

test('v5.87 serbest metin yükleme tipi doğru varsayılana indirgenir', () => {
  assert.equal(formulas.normalizeDelTypeKey('Gemi+Uçak'), 'Gemi+Uçak');
  assert.equal(formulas.normalizeDelTypeKey('SEA + AIR'), 'Gemi+Uçak');
  assert.equal(formulas.normalizeDelTypeKey('uçak'), 'Uçak');
  assert.equal(formulas.normalizeDelTypeKey('GEMİ'), 'Gemi');
  assert.equal(formulas.normalizeDelTypeKey('Gemi+Tır'), 'Gemi+Tır');
  assert.equal(formulas.normalizeDelTypeKey(''), '');
});

test('v5.87 Ayarlar sayfası tabloyu sayı olarak ve doğru satıra yazıyor', () => {
  const block = APP.slice(APP.indexOf('function buildBacklogSettingsSheet'), APP.indexOf('function buildBacklogDetailSheet'));
  assert.match(block, /NAKLİYE YOL SÜRELERİ \(gün\)/);
  assert.match(block, /'Kaynak','Yükleme Tipi','Sezon','Ülke','Ex-Factory Başlangıç','Ex-Factory Bitiş','Gün'/);
  // Gün hücresi METİN olursa formüller #DEĞER! verir.
  assert.match(block, /put\(r,6,\{v:Number\(entry\.days\)\|\|0,t:'n'/);
  // Yerleşim iki yerde hesaplanmamalı: ortak yardımcıdan gelmeli.
  assert.match(APP, /function backlogSettingsTransitFirstRow\(\)\{\s*return backlogSettingsKeyValues\(\)\.length \+ 5;/);
});

test('v5.87 tablo BACKLOG sayfasından ÖNCE kurulur', () => {
  // Formüller tablonun hücre adreslerine bağlandığı için sıra önemli.
  const exportStart = APP.indexOf('async function exportBacklogToExcel');
  const exportEnd = APP.indexOf('let backlogLoadedOnce', exportStart);
  assert.ok(exportStart > 0 && exportEnd > exportStart, 'exportBacklogToExcel bloğu bulunmalı');
  const block = APP.slice(exportStart, exportEnd);
  const planIndex = block.indexOf('BLBacklogExcel.transitSettingsPlan(');
  // Tarih boyutları export'tan hemen önce genişletilir; transit planı yine önce kurulmalıdır.
  const expandIndex = block.indexOf('backlogExpandDateDimensions(exportHeaders,');
  const sheetIndex = block.indexOf('buildBacklogDetailSheet(expanded.headers,');
  assert.ok(planIndex > 0 && expandIndex > planIndex && sheetIndex > expandIndex, 'plan önce üretilmeli, sonra tarih boyutları genişletilmeli');
  assert.match(block, /backlogExpandDateDimensions\(exportHeaders,data\.rows\|\|\[\]\)/);
  assert.match(block, /buildBacklogDetailSheet\(expanded\.headers,expanded\.rows,transitPlan,\{includeImages,dateDimensionSources:expanded\.derivedHeaderSources\}\)/);
  assert.match(block, /buildBacklogSettingsSheet\(transitPlan\)/);
});

test('v5.87 hücreye gömülü eski sarı dolgu kodu kaldırıldı', () => {
  // v5.75'te koşullu biçimlendirmeye geçilmişti; ölü kod yanıltıcıydı.
  assert.doesNotMatch(APP, /plan\.conditionalFormatting/);
});
