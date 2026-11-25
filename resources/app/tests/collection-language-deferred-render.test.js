'use strict';
// Dil başka bir sekmede (ör. Fiyat Masası) değiştirildiğinde Koleksiyon tablosu
// sekmeye dönüşte aktif dilde yeniden çizilir. Eskiden applyLanguage yalnız
// cp/orders/overview için ertelenmiş çizim işaretliyordu; Koleksiyon başlıkları
// ("Marka Detayları", "Fiyatlandırma", "Teklif & Onay", "MB Tarihi", "Landed Özeti")
// İngilizce arayüzde Türkçe kalıyordu (gerçek tarayıcı kanıtı:
// scripts/multiuser-collection-pricing-e2e.js, dil denetimi).
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../public/app-main.js'), 'utf8');
const body = source.slice(source.indexOf('function applyLanguage(lang){'), source.indexOf("document.getElementById('railLangBtn')?.addEventListener"));

test('applyLanguage gizli Koleksiyon için ertelenmiş çizim işaretler', () => {
  assert.ok(body.length > 100);
  assert.match(body, /if\(tab!=='koleksiyon'&&document\.getElementById\('kolTable'\)\)kolRenderDeferred=true;/);
});

test('switchTab ertelenmiş Koleksiyon çizimini sekmeye girişte uygular', () => {
  assert.match(source, /else if\(tab==='koleksiyon'&&kolRenderDeferred&&!profileFirstVisit&&typeof renderKol==='function'\)renderKol\(\);/);
});
