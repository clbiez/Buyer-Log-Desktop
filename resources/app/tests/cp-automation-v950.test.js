'use strict';

/* v9.50 — CP OTOMASYON VERİ KATMANI
 *
 * Kullanıcı sorusu: "CP analiz ve Backlog analiz alanlarda otomasyonları nasıl
 * hazırlatacağım". Backlog için alanlar v9.47'de eklenmişti; CP kaynağı ham
 * satır döndürüyordu, yani ekranda görülen öncelik/risk otomasyonda YOKTU.
 *
 * Korunan asıl kusurlar:
 * 1) Otomasyonun riski KENDİ hesaplaması — ekranla mailin ayrışması.
 * 2) Sunucunun göremediği kontrol listesi cevaplarını görüyormuş gibi davranıp
 *    ekrandakinden farklı bir öncelik üretmesi. Fark GİZLENMEMELİ.
 * 3) Alan seçicinin çalıştırmadan farklı alanlar göstermesi.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const parse = require('../server/lib/parse.js');
const Engine = require('../public/cp-readiness-engine.js');
const CpAuto = require('../server/lib/cp-automation.js');

const ord = Engine.defaultOrdinal;
const TODAY = ord('2026-09-05');
const TRANSIT_RULES = [{ id: 'r-sea', exfStart: '', exfEnd: '', seasons: [], countries: [], delType: 'Gemi', days: 70 }];

function order(spec) {
  const o = spec || {};
  return {
    ocode: o.ocode || 6001, _matchOcode: String(o.ocode || 6001),
    model: 'MODEL-1', ccode: 'C1', colour: 'SIYAH',
    qty: 1000, kalan: 1000, antrepo: 0, merkezSevkeHazirKalan: 0,
    fob: 4.82, plm: 'PLM1', ozel: 'S7AB73Z4', manufacturer: 'MF-1', season: '26SS',
    category: 'CL', merch: 'MAG-1', ageGroup: 'MMYG-1', buyerGrup: 'BG-1',
    countryRaw: 'HINDISTAN', license: 'LIC', productDescription: 'T',
    opd: o.opd || null, ex: o.ex || null, retail: o.retail || null, mb: null,
    buyer: 'BUYER-1', line: 'LINE-1',
  };
}
const cpRows = orders => parse.buildCPRowsFromASAS(orders, new Map(), { transitRules: TRANSIT_RULES });

test('v9.50 CP satırları analiz alanlarıyla zenginleşiyor', () => {
  const rows = cpRows([order({ ocode: 6101, opd: '2026-05-01', ex: '2026-08-20', retail: '2026-11-01' })]);
  const [enriched] = CpAuto.enrichRows(rows, { today: TODAY, transitRules: TRANSIT_RULES });
  for (const key of Object.values(CpAuto.FIELDS)) {
    assert.ok(Object.prototype.hasOwnProperty.call(enriched, key), `${key} alanı eksik`);
  }
  assert.ok(enriched[CpAuto.FIELDS.priority], 'öncelik dolu olmalı');
  assert.equal(enriched['Order Code'], rows[0]['Order Code'], 'kaynak alanlar korunmalı');
});

test('v9.50 alanlar motorun ÇIKTISINI taşır, yeniden hesaplamaz', () => {
  const rows = cpRows([
    order({ ocode: 6201, opd: '2026-05-01', ex: '2026-08-20', retail: '2026-11-01' }),
    order({ ocode: 6202, opd: '2026-08-20', ex: '2026-12-01', retail: '2027-06-01' }),
  ]);
  const enriched = CpAuto.enrichRows(rows, { today: TODAY, transitRules: TRANSIT_RULES });
  rows.forEach((row, index) => {
    const analysis = Engine.analyzeOrder(row, { today: TODAY, dateOrdinal: ord, transitRules: TRANSIT_RULES, settings: {} });
    assert.equal(enriched[index][CpAuto.FIELDS.priorityCode], analysis.priority);
    assert.equal(enriched[index][CpAuto.FIELDS.outcomeCode], analysis.deliveryOutcome);
    assert.equal(enriched[index][CpAuto.FIELDS.daysToLoad], analysis.daysToLoad == null ? '' : analysis.daysToLoad);
    assert.equal(enriched[index][CpAuto.FIELDS.eta], CpAuto.ordinalToISO(analysis.eta));
  });
});

/* Sunucu kontrol listesi cevaplarını GÖREMEZ (kullanıcının tarayıcısında,
   kişiye özel). Ekranda kontrol listesi bir siparişi yukarı taşıyabilir;
   otomasyon bunu göremediği için farkı GİZLEMEK yerine alanla söylemeli. */
test('v9.50 sunucunun göremediği kontrol listesi farkı açıkça işaretleniyor', () => {
  const rows = cpRows([order({ ocode: 6301, opd: '2026-06-01', ex: '2026-09-12', retail: '2027-03-01' })]);
  const [enriched] = CpAuto.enrichRows(rows, { today: TODAY, transitRules: TRANSIT_RULES });
  assert.match(String(enriched[CpAuto.FIELDS.prioritySource]), /kontrol listesi hariç/i);
  // Katman kontrol listesi motorunu HİÇ çağırmamalı: cevaplar sunucuda yok.
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'cp-automation.js'), 'utf8');
  assert.doesNotMatch(source, /cp-checklist-engine|cp-rules-engine/,
    'sunucu tarafı, cevaplarına erişemediği kontrol listesini uygulamamalı');
});

test('v9.50 kaynak satır DEĞİŞMEZ ve mevcut anahtarın üstüne yazılmaz', () => {
  const rows = cpRows([order({ ocode: 6401, opd: '2026-05-01', ex: '2026-08-20', retail: '2026-11-01' })]);
  rows[0][CpAuto.FIELDS.priority] = 'ELLE GİRİLMİŞ';
  const before = JSON.stringify(rows[0]);
  const [enriched] = CpAuto.enrichRows(rows, { today: TODAY, transitRules: TRANSIT_RULES });
  assert.equal(JSON.stringify(rows[0]), before, 'kaynak satır mutasyona uğramamalı');
  assert.equal(enriched[CpAuto.FIELDS.priority], 'ELLE GİRİLMİŞ', 'var olan sütunun üstüne yazılmamalı');
  assert.ok(enriched[CpAuto.FIELDS.priorityCode], 'diğer alanlar yine eklenmeli');
});

test('v9.50 yol süresi kuralı yoksa zorla sonuç üretilmez', () => {
  const rows = cpRows([order({ ocode: 6501, opd: '2026-06-01', ex: '2026-10-01', retail: '2026-11-01' })]);
  const [enriched] = CpAuto.enrichRows(rows, { today: TODAY, transitRules: [] });
  assert.equal(enriched[CpAuto.FIELDS.transitRuleMissing], 'Evet');
  assert.equal(enriched[CpAuto.FIELDS.outcomeCode], 'UNKNOWN');
  assert.equal(enriched[CpAuto.FIELDS.priorityCode], 'WATCH');
  assert.equal(enriched[CpAuto.FIELDS.calculationStatus], 'UNKNOWN');
});

test('v9.50 sunucu bağlantısı: CP ve Backlog aynı satır üreticisinden geçiyor', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  const block = server.slice(server.indexOf('async function automationSourceRows'), server.indexOf('async function automationDataset'));
  assert.match(block, /if \(source === 'cp'\)/);
  assert.match(block, /cpAutomation\.enrichRows\(list/);
  assert.match(block, /backlogAutomation\.enrichRows\(list/);
  // Yol süresi kuralları kullanıcının kendi ayarlarından gelmeli.
  assert.match(block, /effectiveOverridesForUser\(ownerId\)/);
  assert.match(server, /const cpAutomation = require\('\.\/lib\/cp-automation'\)/);
});

test('v9.50 katmanda AI yok ve kendi risk sınıflandırması tanımlı değil', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'cp-automation.js'), 'utf8');
  assert.doesNotMatch(source, /copilot|octopus|BLCopilot/i);
  assert.doesNotMatch(source, /priority\s*=\s*['"](CRITICAL|ACTION_)/, 'öncelik burada atanmamalı');
  assert.match(source, /Engine\.analyzeOrder\(/);
});
