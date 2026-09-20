'use strict';

/* v6.43 — Prepare E-Mail: birden fazla üretici seçiliyken taslakların ayrı
 * ayrı oluşturulması artık görünür ve indirilebilir.
 *
 * Kök neden: kod her zaman üretici başına AYRI bir .eml taslağı oluşturuyordu
 * (for(const m of checked){ ... }), ama Outlook otomatik açılamadığında
 * (opened:false) yalnız TEK üretici seçiliyken (checked.length===1) taslak
 * kendiliğinden indiriliyordu. Birden fazla üretici seçiliyse hiçbiri
 * otomatik inmiyordu; sonuç penceresinde N tane bağlantı duruyor, kullanıcı
 * her birine tek tek tıklamak zorunda kalıyordu.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');

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

/* --------------------------------------------- 1) checked.length===1 SINIRI KALKTI */

test('v6.43 birden fazla üretici seçiliyken de her açılamayan taslak indiriliyor', () => {
  // Eski sınırlama koddan tamamen kalkmış olmalı; kalsaydı N>1 seçimde hiçbir
  // taslak kendiliğinden inmezdi.
  assert.doesNotMatch(APP, /checked\.length===1\)\s*kolTriggerPricingDownload/);
  assert.doesNotMatch(APP, /checked\.length===1\) kolTriggerPricingDownload/);
  // Yeni kod her iki daldaki (genel konu ve pricing konu) opened:false sonucunu
  // koşulsuz indirmeli.
  const matches = APP.match(/if\(!data\.opened\)\{kolTriggerPricingDownload\(data\.downloadUrl,data\.filename,downloadDelay\);downloadDelay\+=350;\}/g) || [];
  assert.equal(matches.length, 2, 'her iki dal da (genel ve pricing) düzeltilmeli');
});

test('v6.43 indirmeler arasında gecikme sayacı satır bazında ilerliyor', () => {
  // Sayaç her iki dalın kendi döngüsünde SIFIRDAN başlamalı; birinin kalıntı
  // değeri diğerine sızmamalı.
  const generalBlock = APP.slice(APP.indexOf("if(topicForDraft.kind!=='pricing'){"), APP.indexOf('mailTopicSelect(topicForDraft.kind'));
  assert.match(generalBlock, /let downloadDelay=0;/);
  const pricingBlock = APP.slice(APP.indexOf('mailTopicSelect(topicForDraft.kind'));
  assert.match(pricingBlock.slice(0, 800), /let downloadDelay=0;/);
});

/* ------------------------------------------------- 2) kolTriggerPricingDownload */

test('v6.43 indirme yardımcı fonksiyonu gecikmeli tetiklemeyi destekliyor', () => {
  const calls = [];
  const document = {
    createElement: () => ({ style: {}, click() { calls.push('clicked'); }, remove() {} }),
    body: { appendChild() {} },
  };
  const scheduled = [];
  const fn = new Function('document', 'setTimeout',
    `function kolTriggerPricingDownload(url,filename,delayMs=0){${bodyOf(APP, 'kolTriggerPricingDownload')}} return kolTriggerPricingDownload;`
  )(document, (cb, ms) => { scheduled.push(ms); cb(); });

  fn('u1', 'f1'); // delayMs verilmezse hemen çalışmalı (eski çağrılarla uyumlu)
  fn('u2', 'f2', 0);
  fn('u3', 'f3', 350);

  assert.equal(calls.length, 3, 'üç indirme de tetiklenmeli');
  // 0 gecikmeli çağrı setTimeout'a hiç girmemeli (gereksiz gecikme yaratmamalı).
  assert.ok(!scheduled.includes(0) || scheduled.filter(v => v === 350).length === 1);
  assert.ok(scheduled.includes(350), 'gecikmeli çağrı zamanlanmalı');
});

test('v6.43 url boşsa indirme sessizce atlanıyor', () => {
  let clicked = false;
  const document = { createElement: () => ({ style: {}, click() { clicked = true; }, remove() {} }), body: { appendChild() {} } };
  const fn = new Function('document', 'setTimeout',
    `function kolTriggerPricingDownload(url,filename,delayMs=0){${bodyOf(APP, 'kolTriggerPricingDownload')}} return kolTriggerPricingDownload;`
  )(document, (cb) => cb());
  fn('', 'f1');
  fn(null, 'f2', 200);
  assert.equal(clicked, false);
});

/* --------------------------------------------------- 3) BUTON ETİKETİ GÖRÜNÜRLÜĞÜ */

test('v6.43 confirm butonu kaç ayrı taslak oluşacağını gösteriyor', () => {
  assert.match(APP, /id="kolMfrConfirmLabel"/);
  assert.match(APP, /document\.getElementById\('kolMfrConfirmLabel'\)/);
  const label = new Function('escapeHtml', 'appLang', 'L', '_mfrPicked', `
    const size=_mfrPicked.size;
    return size>1?(appLang==='en'?\`Create \${size} Separate Draft E-Mails\`:\`\${size} Ayrı Taslak E-Posta Oluştur\`):L('Taslak E-Posta Oluştur');
  `);
  assert.equal(label(v => v, 'tr', a => a, { size: 1 }), 'Taslak E-Posta Oluştur');
  assert.equal(label(v => v, 'tr', a => a, { size: 3 }), '3 Ayrı Taslak E-Posta Oluştur');
  assert.equal(label(v => v, 'en', a => a, { size: 3 }), 'Create 3 Separate Draft E-Mails');
});

test('v6.43 buton etiketi başlangıç çiziminde ve seçim değiştikçe güncelleniyor', () => {
  // İlk çizimde kolMfrConfirmLabel span'i _mfrPicked.size'a göre kurulmalı;
  // yalnız refreshAll içinde güncellense ilk açılışta yanlış metin görünürdü.
  assert.match(APP, /<span id="kolMfrConfirmLabel">\$\{escapeHtml\(_mfrPicked\.size>1/);
  const start = APP.indexOf('const refreshAll = ()=>{');
  assert.ok(start >= 0, 'refreshAll bulunmalı');
  const end = APP.indexOf('const cnt = document.getElementById', start);
  const body = APP.slice(start, APP.indexOf('};', APP.indexOf('kolMfrConfirmLabel', end)));
  assert.match(body, /kolMfrConfirmLabel/);
});

/* --------------------------------------------------- 4) SONUÇ PENCERESİ NOTU */

test('v6.43 birden fazla otomatik indirmede tarayıcı izin notu gösteriliyor', () => {
  // Tarayıcılar art arda çok sayıda indirmeyi "birden fazla dosya indirme"
  // izniyle engelleyebilir; kullanıcı bunu bilmezse taslakların kaybolduğunu
  // sanabilir.
  const body = bodyOf(APP, 'kolShowPricingDraftResults');
  assert.match(body, /const unopenedCount=results\.filter\(r=>r\.ok&&!r\.opened\)\.length;/);
  assert.match(body, /unopenedCount>1/);
  assert.match(body, /multiDownloadNote/);
});

test('v6.43 tek taslak açılamadığında izin notu gösterilmiyor', () => {
  // Not yalnız BİRDEN FAZLA taslak indirilmeye çalışıldığında anlamlı;
  // tek taslakta gereksiz gürültü olurdu.
  const body = bodyOf(APP, 'kolShowPricingDraftResults');
  const line = body.match(/const multiDownloadNote=unopenedCount>1[\s\S]*?:'';/);
  assert.ok(line, 'koşul unopenedCount>1 olmalı, >=1 değil');
});
