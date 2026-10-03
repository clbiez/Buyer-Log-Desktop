'use strict';

/* v9.51 — ANALİZ EKRANLARINDAN DOĞRUDAN OTOMASYON
 *
 * Kullanıcı isteği (birebir): "direkt otomasyon oluşturabilmek isterim".
 *
 * Korunan asıl kusurlar:
 * 1) EKRANDAKİ KIRILIM İLE OTOMASYON KOŞULUNUN AYRIŞMASI. Düğme, sunucunun
 *    yazmadığı bir alan adına koşul kurarsa otomasyon HİÇBİR ŞEY eşleştirmez
 *    ve kullanıcı bunu ancak planlı çalıştırmada, e-posta gelmeyince fark
 *    eder. Bu yüzden alan adları sunucu katmanlarıyla birebir karşılaştırılır.
 * 2) Bir düğmeye basmanın, gözden geçirilmemiş bir otomasyonu ETKİNLEŞTİRMESİ
 *    ya da otomatik e-posta göndermesi.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const AUTOMATIONS = read('public/automations.js');
const CP_VIEW = read('public/cp-overview-assistant.js');
const BACKLOG_VIEW = read('public/backlog-delivery-analysis.js');

const cpAutomation = require('../server/lib/cp-automation.js');
const backlogAutomation = require('../server/lib/backlog-automation.js');

test('v9.51 ortak giriş noktası var ve iki analiz ekranı da onu kullanıyor', () => {
  assert.match(AUTOMATIONS, /window\.BLAutomations=\{createFromAnalysis\}/);
  assert.match(AUTOMATIONS, /async function createFromAnalysis\(spec\)/);
  for (const [name, view] of [['CP', CP_VIEW], ['Backlog', BACKLOG_VIEW]]) {
    assert.match(view, /BLAutomations\.createFromAnalysis/, `${name} ekranı ortak yolu kullanmalı`);
    assert.match(view, /ensureFeature\('automations'\)/, `${name} ekranı modülü lazy yüklemeli`);
  }
});

test('v9.51 oluşturulan tarif KAPALI, zamanlamasız ve yalnız TASLAK üretir', () => {
  const block = AUTOMATIONS.slice(AUTOMATIONS.indexOf('async function createFromAnalysis'), AUTOMATIONS.indexOf('window.addEventListener(\'pagehide\''));
  assert.match(block, /recipe\.enabled=false;/, 'yeni tarif kendiliğinden etkinleşmemeli');
  assert.match(block, /schedule=\{\.\.\.recipe\.schedule,enabled:false,mode:'manual'\}/, 'zamanlama kapalı olmalı');
  assert.match(block, /deliveryMode:'draft'/, 'buradan otomatik gönderim kurulamamalı');
});

/* En kritik sözleşme: düğmenin kurduğu koşul alanı, sunucunun satıra GERÇEKTEN
   yazdığı alan olmalı. Alan adı bir tarafta değişirse bu test kırılır. */
test('v9.51 CP düğmesinin koşul alanları sunucunun yazdığı alanlarla birebir aynı', () => {
  const used = [...CP_VIEW.matchAll(/AUTOMATION_FIELDS = Object\.freeze\(\{([\s\S]*?)\}\)/g)][0][1];
  const values = [...used.matchAll(/'([^']+)'/g)].map(match => match[1]);
  const serverFields = Object.values(cpAutomation.FIELDS);
  for (const field of values) {
    assert.ok(serverFields.includes(field), `CP ekranı '${field}' alanına koşul kuruyor ama sunucu bu alanı yazmıyor`);
  }
  assert.ok(values.includes(cpAutomation.FIELDS.priorityCode), 'öncelik kodu koşulda kullanılmalı');
  assert.match(CP_VIEW, /source: 'cp'/);
});

test('v9.51 Backlog düğmesinin koşul alanları sunucunun yazdığı alanlarla birebir aynı', () => {
  const serverFields = Object.values(backlogAutomation.FIELDS);
  for (const field of ['Teslimat Sonucu Kodu', 'Risk Sebebi Kodu']) {
    assert.ok(serverFields.includes(field), `sunucu '${field}' alanını yazmıyor`);
    assert.ok(BACKLOG_VIEW.includes(`field: '${field}'`), `Backlog ekranı '${field}' koşulunu kurmalı`);
  }
  assert.match(BACKLOG_VIEW, /source: 'backlog'/);
});

test('v9.51 alıcı alanı her iki kaynakta da gerçek bir üretici sütunu', () => {
  // Alıcı, adres defterinde AYNI ADLA aranıyor; yanlış sütun sessizce
  // "alıcı bulunamadı" demek olurdu.
  assert.match(CP_VIEW, /recipientField: 'Manufacturer'/);
  assert.match(BACKLOG_VIEW, /recipientField: 'Üretici'/);
  assert.match(AUTOMATIONS, /source==='backlog'\?'Üretici':'Manufacturer'/, 'varsayılan da kaynağa göre olmalı');
});

test('v9.51 düğmeler çiziliyor ve bağlanıyor', () => {
  for (const hook of ['data-cpa-automate-priority', 'data-cpa-automate-reason']) {
    assert.ok((CP_VIEW.match(new RegExp(hook, 'g')) || []).length >= 2, `${hook} hem çizilmeli hem bağlanmalı`);
  }
  for (const hook of ['data-automate-outcome', 'data-automate-cause']) {
    assert.ok((BACKLOG_VIEW.match(new RegExp(hook, 'g')) || []).length >= 2, `${hook} hem çizilmeli hem bağlanmalı`);
  }
});

test('v9.51 hedef tarih tercihi tarife taşınır (ekran ile otomasyon aynı hedefe bakar)', () => {
  assert.match(CP_VIEW, /backlog: \{ targetType: state\.settings\.targetType \}/);
  assert.match(BACKLOG_VIEW, /targetType: state\.settings\.targetType/);
  assert.match(AUTOMATIONS, /if\(input\.backlog&&typeof input\.backlog==='object'\)recipe\.backlog=/);
});

test('v9.51 hata sessiz yutulmuyor: modül yüklenemezse kullanıcıya söyleniyor', () => {
  for (const [name, view] of [['CP', CP_VIEW], ['Backlog', BACKLOG_VIEW]]) {
    assert.match(view, /Otomasyon modülü yüklenemedi/, `${name} ekranı yükleme hatasını bildirmeli`);
    assert.match(view, /showToast|alert\(/, `${name} ekranı hatayı göstermeli`);
  }
});
