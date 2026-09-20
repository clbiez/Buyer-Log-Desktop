'use strict';

/* v9.25 — GERÇEK SENARYOLARIN AÇIĞA ÇIKARDIĞI KUSURLAR.
 *
 * Kullanıcının verdiği 7 senaryo canlı koşuldu (Ollama + qwen3:8b, 300 satır
 * sentetik CP). Ortaya çıkan kusurların hepsi tek bir desende toplanıyor:
 *
 *   ARAÇ SONUCU/HATASI, MODELİN BİR SONRAKİ ADIMDA NE YAPACAĞINI SÖYLEMELİ.
 *
 * Model "bulunamadı" duyunca tahmin etmeye devam ediyor; "işte gerçek değerler"
 * duyunca tek turda düzeltiyor. Ölçülen etki: senaryo 4'te 9 başarısız çağrı
 * → 1; süre 26 sn → 3,9 sn.
 *
 * İçlerinden biri kusur değil TEHLİKEYDİ: compare() bilinmeyen operatörü
 * sessizce EŞİTTİR sayıyordu. Model "!=" yazdı, sistem "=" uyguladı ve ajan
 * sorduğunun TAM TERSİ veriyle "40 satırın hepsi Confirmed" dedi. Hata yok,
 * uyarı yok, sadece kendinden emin yanlış cevap.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createToolRegistry, compare } = require('../server/lib/agent-tool-registry');
const copilot = require('../server/lib/copilot-agent');
const gateway = require('../server/lib/ai-provider-gateway');

const userAccess = { hasArea: () => true, appendAudit() {} };
const CP = [
  { 'Season': 'AW27', 'STATUS': 'Confirmed', 'Manufacturer': 'ABC', 'Model Name': 'M1' },
  { 'Season': 'AW27', 'STATUS': 'Pending', 'Manufacturer': 'XYZ', 'Model Name': 'M2' },
  { 'Season': 'SS27', 'STATUS': 'In Production', 'Manufacturer': 'ABC', 'Model Name': 'M3' },
];
function tools(data = { cp: CP, orders: [] }) {
  return createToolRegistry({
    userAccess,
    listDatasets: async () => Object.keys(data).map(id => ({ id, allowed: true })),
    getDataset: async (_o, _p, source) => data[source] || [],
    getDataContext: async (_o, _p, source) => ({ source, rowCount: (data[source] || []).length }),
  });
}

/* ------------------------------------ 1) SESSİZ TERS SONUÇ (en tehlikelisi) */

test('v9.25 bilinmeyen operatör sessizce EŞİTTİR olmuyor', () => {
  /* compare() default dalında l === r döndürüyordu. "!=" yazan bir çağrı,
     sorduğunun tersini alıp fark edilmeden geçiyordu. */
  assert.throws(() => compare('a', 'yaklaşıksa', 'b'), error => error && error.code === 'FILTER_OPERATOR_INVALID');
  // Hata geçerli listeyi taşımalı ki model tek turda düzeltsin.
  try { compare('a', 'bilinmeyen', 'b'); } catch (error) {
    assert.match(error.message, /Geçerli olanlar: .*neq/);
    assert.ok(Array.isArray(error.details.supported));
  }
});

test('v9.25 sembolik operatörler doğru yönde çalışıyor', () => {
  // Canlı koşuda model bunları yazdı; hepsi sessizce eşittire düşüyordu.
  assert.equal(compare('Pending', '!=', 'Confirmed'), true);
  assert.equal(compare('Confirmed', '!=', 'Confirmed'), false);
  assert.equal(compare('A', '=', 'A'), true);
  assert.equal(compare(5, '>', 3), true);
  assert.equal(compare(3, '<=', 3), true);
});

test('v9.25 not_in eklendi ve dizi değer kabul ediliyor', () => {
  /* 'in' vardı, olumsuzu yoktu — gerçek bir yetenek eksiğiydi.
     Model ayrıca değerleri dizi olarak gönderiyor. */
  assert.equal(compare('Confirmed', 'not in', ['Draft', 'Pending']), true);
  assert.equal(compare('Pending', 'not_in', ['Draft', 'Pending']), false);
  assert.equal(compare('Pending', 'in', ['Draft', 'Pending']), true);
  assert.equal(compare('X', 'not_in', 'A,B'), true);
});

/* --------------------------------- 2) BOŞ DATASET KENDİNİ SÖYLÜYOR */

test('v9.25 boş dataset keşif araçlarında kendini bildiriyor', async () => {
  /* Alan listesi örnek satırlardan çıkarılıyor; boş datasette boş dönüyordu ve
     model bunu "bu alanlar yok" diye okuyup ad tahminine devam ediyordu.
     Canlı koşuda 12 turun tamamı burada yandı. */
  const registry = tools();
  const described = await registry.execute('dataset.describe', { source: 'orders' }, { profile: {} });
  assert.equal(described.empty, true);
  assert.match(described.note, /hiç satır yok/);
  assert.match(described.note, /TAHMİN ETME/);
  // resolve_field de AYNI sinyali vermeli — keşif araçları tutarlı konuşmalı.
  const resolved = await registry.execute('dataset.resolve_field', { source: 'orders', field: 'supplier' }, { profile: {} });
  assert.equal(resolved.empty, true);
  assert.equal(resolved.found, false);
  assert.match(resolved.note, /BAŞKA alan adı DENEME/);
});

test('v9.25 katalog satır sayısı veriyor', async () => {
  // Ajan hangi kaynağın dolu olduğunu görmeden seçim yapıp boşa takılıyordu.
  const catalog = await tools().execute('dataset.catalog', {}, { profile: {} });
  const cp = catalog.datasets.find(item => item.id === 'cp');
  const orders = catalog.datasets.find(item => item.id === 'orders');
  assert.equal(cp.rows, 3);
  assert.equal(cp.empty, false);
  assert.equal(orders.rows, 0);
  assert.equal(orders.empty, true);
  assert.match(catalog.note, /0 olan dataset boştur/);
});

/* ------------------------------ 3) CEVABI SONUCUN/HATANIN İÇİNE KOY */

test('v9.25 alan bulunamadı hatası GERÇEK alanları taşıyor', async () => {
  /* "describe çağır" demek üç tur yiyordu: hata → describe → düzeltilmiş
     çağrı. Alanları mesaja koymak bunu tek tura indirir. */
  await assert.rejects(() => tools().execute('dataset.query',
    { source: 'cp', filters: [{ field: 'onaylandi', operator: 'eq', value: 'x' }] }, { profile: {} }),
    error => error && error.code === 'DATASET_FIELD_NOT_FOUND'
      && /gerçek alanlar: .*STATUS/.test(error.message)
      && Array.isArray(error.details.available));
});

test('v9.25 resolve_field çıkmaza sokmuyor, seçenek sunuyor', async () => {
  /* Keşif aracının işi yardım etmek; bulamayınca hata fırlatmak modeli aynı
     soruyu tekrarlamaya itiyordu. */
  const result = await tools().execute('dataset.resolve_field', { source: 'cp', field: 'onaylandi' }, { profile: {} });
  assert.equal(result.found, false);
  const keys = result.available.map(item => item.sourceKey);
  assert.ok(keys.includes('STATUS'));
  // Türkçe etiket de verilmeli ki model anlamca eşleştirebilsin.
  assert.equal(result.available.find(item => item.sourceKey === 'STATUS').label, 'Durum');
  // Ama çözülebilen alan normal davranmalı.
  const ok = await tools().execute('dataset.resolve_field', { source: 'cp', field: 'durum' }, { profile: {} });
  assert.equal(ok.found, true);
  assert.equal(ok.field.sourceKey, 'STATUS');
});

test('v9.25 sıfır eşleşmede GERÇEK değerler dönüyor', async () => {
  /* Model durum değerlerini tahmin etti (closed/open/active/draft/cancelled),
     beşi de yoktu, her seferinde sessiz "0 satır" aldı. */
  const registry = tools();
  for (const [id, args] of [
    ['dataset.query', { source: 'cp', filters: [{ field: 'STATUS', operator: 'eq', value: 'closed' }] }],
    ['dataset.aggregate', { source: 'cp', filters: [{ field: 'STATUS', operator: 'eq', value: 'closed' }], groupBy: 'Manufacturer', metric: 'count' }],
    ['dataset.analyze', { source: 'cp', filters: [{ field: 'STATUS', operator: 'eq', value: 'closed' }], dimensions: ['Manufacturer'], measures: [{ op: 'count', as: 'n' }] }],
  ]) {
    const result = await registry.execute(id, args, { profile: {} });
    assert.ok(result.noMatchHint, `${id} sıfır eşleşmede ipucu vermeli`);
    assert.deepEqual(result.noMatchHint.fields[0].actualValues, ['Confirmed', 'Pending', 'In Production']);
    assert.match(result.noMatchHint.note, /TAHMİN ETME/);
  }
  // Dolu sonuçta ek yük olmamalı.
  const matched = await registry.execute('dataset.query',
    { source: 'cp', filters: [{ field: 'STATUS', operator: 'eq', value: 'Confirmed' }] }, { profile: {} });
  assert.equal(matched.noMatchHint, undefined);
});

/* ------------------------------------------- 4) DÖNGÜ VE BÜTÇE */

test('v9.25 aynı başarısız çağrı tekrarlanınca ipucu yükseliyor', () => {
  /* Model dataset.analyze'i dört kez aynı argümanlarla çağırdı; her hata
     bağımsız raporlandığı için bunu "yeni deneme" sanıyordu. */
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'copilot-agent.js'), 'utf8');
  assert.match(source, /const failedSignatures = new Map\(\);/);
  assert.match(source, /AYNI ARGÜMANLARLA \$\{repeats\} kez denedin/);
  assert.match(source, /repeatedAttempt: repeats > 1/);
});

test('v9.25 düşünme kapatılıp çıktı bütçesi serbest bırakılıyor', () => {
  /* Kurulu modellerin ikisi de "thinking" modeli ve num_predict bütçesini
     ortak kullanıyorlar; ikinci turda JSON zarfı tamamlanamadan bütçe bitip
     COPILOT_PROTOCOL_INVALID veriyordu. think:false ölçüldü: 26 sn → 3,9 sn. */
  const agent = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'copilot-agent.js'), 'utf8');
  assert.match(agent, /think: thinkingModel \? false : undefined,/);
  // Yalnız yeteneği BİLDİREN modele gönderilmeli.
  assert.match(agent, /capabilities\.includes\('thinking'\)/);
  const gatewaySource = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'ai-provider-gateway.js'), 'utf8');
  assert.match(gatewaySource, /\.\.\.\(options\.think === false \? \{ think: false \} : \{\}\)/);
});

/* --------------------------- 5) DANIŞMANLIK SORUSU İŞ SORUSUDUR */

test('v9.25 "benim yerimde ne yapardın" araştırma tetikliyor', () => {
  /* Bu soru SIFIR araç çağrısıyla, genel bir danışmanlık cevabıyla
     karşılanmıştı — kullanıcının asıl istediğinin tam tersi. Sebep:
     likelyBusinessFact iş ismi + olgusal kalıp İKİSİNİ birden arıyordu. */
  const asks = [
    'Bugün benim yerimde buyer olsaydın neye odaklanırdın?',
    'Ne yapmam gerektiğini söyle',
    'AW27 durumu nasıl?',
    'Sorun var mı?',
    'Nereden başlamalıyım?',
  ];
  asks.forEach(ask => assert.equal(copilot.likelyBusinessFact(ask), true, ask));
  // Genel sohbet yeteneği KORUNMALI: her soru veri sorusu değil.
  ['Merhaba nasılsın?', 'Bana bir şiir yaz', 'JavaScript closure nedir?']
    .forEach(ask => assert.equal(copilot.likelyBusinessFact(ask), false, ask));
});

/* ------------------------------------------ 6) ARAÇ AÇIKLAMALARI YÖNLENDİRİR */

test('v9.25 catalog ile describe arasındaki tekrar açıklamada söyleniyor', () => {
  /* Model module.catalog'dan sonra yedi modülü tek tek describe edip bütçeyi
     bitirdi; oysa catalog zaten tam kaydı döndürüyordu. */
  const registry = tools();
  const catalogTool = registry.get('module.catalog');
  const describeTool = registry.get('module.describe');
  assert.match(catalogTool.description, /modülleri tek tek describe ETME/);
  assert.match(describeTool.description, /İHTİYACIN YOK/);
  assert.match(registry.get('dataset.catalog').description, /SATIR SAYILARIYLA/);
});

/* -------------------------------------------------- 7) MODEL ÇÖZÜMLEMESİ */

test('v9.25 thinking yeteneği çözümlemede taşınıyor', () => {
  // think:false kararı buna dayanıyor; taşınmazsa hiç uygulanamaz.
  const installed = [{ name: 'qwen3:8b', capabilities: ['completion', 'tools', 'thinking'] }];
  const chosen = gateway.chooseInstalledModel('qwen3:8b', installed);
  assert.ok(chosen.model.capabilities.includes('thinking'));
});
