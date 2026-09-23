'use strict';

// v5.94 — Endeksmatik'te "Target adjustment %" kaldırıldı; yerine geçmiş sezon
// fiyatları için "Royalty ve Hologram dahil mi?" sorusu geldi (varsayılan Hayır).
//
// Gerekçe: endeksleme aradaki farkı YÜZDE olarak uygular. Royalty payı ve sabit
// hologram bedeli fiyatın üzerine sonradan binen masraflardır; endekslenirlerse
// masrafın kendisi de enflasyonla büyütülmüş olur. Bu yüzden:
//   · Hayır → fiyat zaten masrafsız: endeksle, sonra masrafları EKLE.
//   · Evet  → fiyattan önce masrafları ÇIKAR, endeksle, sonra tekrar EKLE.
// Sonuç her iki durumda da masraflar dahil verilir. Formüller License Royalty
// Rules ile birebir aynıdır.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const ENGINE = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'endeksmatik.js'), 'utf8');
const engine = require('../server/lib/endeksmatik');

// Motordaki iki yardımcıyı birebir kopyalamak yerine formülü burada kurup
// kaynakta aynı ifadelerin durduğunu ayrıca çiviliyoruz.
const strip = (price, hologram, royaltyPct) => (price - hologram) * (1 - royaltyPct / 100);
const add = (price, hologram, royaltyPct) => price / (1 - royaltyPct / 100) + hologram;

test('v5.94 Evet ve Hayır yolları aynı gerçek fiyatta buluşuyor', () => {
  // 1,26 masraf DAHİL fiyat, %20 royalty + 0,01 hologram ile 1,00 masrafsıza denk.
  const royalty = 20, hologram = 0.01, index = 0.10;
  const fromIncluded = add(strip(1.26, hologram, royalty) * (1 + index), hologram, royalty);
  const fromNet = add(1.00 * (1 + index), hologram, royalty);
  assert.ok(Math.abs(fromIncluded - fromNet) < 1e-9, 'iki yol aynı sonucu vermeli');
  assert.equal(Number(fromNet.toFixed(4)), 1.385);
});

test('v5.94 masraflar endekslenmiyor', () => {
  // Masraf endekslenseydi sonuç (1,26 × 1,10) = 1,386 olurdu. Doğru sonuç daha
  // düşüktür: yalnız mal bedeli endekslenir, masraf sonradan eklenir.
  const royalty = 20, hologram = 0.01, index = 0.10;
  const correct = add(strip(1.26, hologram, royalty) * (1 + index), hologram, royalty);
  const naive = 1.26 * (1 + index);
  assert.ok(correct < naive, 'masrafı da endekslemek daha yüksek sonuç verirdi');
});

test('v5.94 sıfır endekste çıkar-ekle zinciri fiyatı bozmuyor', () => {
  // Kimlik kontrolü: endeks 0 iken masraf dahil fiyat aynen geri gelmeli.
  const royalty = 12.5, hologram = 0.057;
  assert.ok(Math.abs(add(strip(1.26, hologram, royalty), hologram, royalty) - 1.26) < 1e-9);
});

test('v6.02 hedef düzeltme yüzdesi geri geldi ve AYARLANABİLİR', () => {
  // v5.94'te kaldırılmıştı; yeni ENDEKSMATİK Excel'inde hesabın parçası olduğu
  // için geri getirildi. Artık sabit değil: istekte değer varsa o, yoksa
  // yüklenen dosyadan okunan orijinal değer kullanılır.
  assert.match(ENGINE, /const adjustmentRaw=numberValue\(input\.adjustmentPct\);/);
  assert.match(ENGINE, /Number\.isFinite\(adjustmentRaw\)\?adjustmentRaw:defaultAdjustmentPct\(runtime\.snapshot\)/);
  assert.match(ENGINE, /const a=adjustmentPct\/100;/);
  // Varsayılan YALNIZ dosyadan gelir; alanı olmayan eski anlık görüntülerde 0
  // kalır, aksi halde doğrulanmış referans hesabı geriye dönük değişirdi.
  assert.match(ENGINE, /Number\.isFinite\(value\)&&value>=-100&&value<=100\?value:0;/);
  // Kaynak dosyadaki hücre okunuyor (ENDEKSMATİK!B22, ondalık kesir).
  assert.match(ENGINE, /const adjustmentRaw=Number\(screen\.B22&&screen\.B22\.v\);/);
  // Arayüzde alan var ve orijinal değeri yer tutucu olarak gösteriyor.
  assert.match(APP, /data-em-field="adjustmentPct"/);
  assert.match(APP, /Target adjustment %/);
  assert.match(APP, /function endeksmatikDefaultAdjustment\(\)/);
});

test('v7.0.97 Adjustment Rate snapshot değerini kullanır ve arayüzde boş kalmaz', () => {
  const months=['202501','202601'];
  const record=['MMYG','MAG','SUPPLY','BUYING','CATEGORY',1,0,0,0,[100,110],[100,110],[100,110],[100,110]];
  const runtime={
    snapshot:{targetAdjustmentPct:3.55,fx:{'202501':30,'202601':30}},
    monthIndex:new Map(months.map((m,i)=>[m,i])),
    byKey:new Map([[engine.keyOf(record.slice(0,5)),record]]),
    byNoSupply:new Map(),
  };
  const result=engine.calculate({
    mmyg:'MMYG',mag:'MAG',supplyGroup:'SUPPLY',buyingGroup:'BUYING',category:'CATEGORY',
    previousOrderMonth:'202501',previousInStoreMonth:'202501',
    newOrderMonth:'202601',newInStoreMonth:'202601',
    previousUsdPrice:1,previousTryPrice:30,
  },runtime);
  assert.equal(result.indexes.adjustmentPct,3.55);
  assert.ok(Math.abs(result.indexes.targetTl-0.06095)<1e-9);

  assert.match(APP,/adjustmentPct:endeksmatikDefaultAdjustment\(\),defaultAdjustmentPct:endeksmatikDefaultAdjustment\(\)/);
  assert.match(APP,/adjustmentPct:saved\.adjustmentPct!==undefined&&String\(saved\.adjustmentPct\)\.trim\(\)!==''\?saved\.adjustmentPct:endeksmatikDefaultAdjustment\(\)/);
  assert.match(APP,/data-em-field="adjustmentPct" value="\$\{endeksmatikInputValue\(ctx\.adjustmentPct\)\}"/);
  assert.match(APP,/data\.indexes&&Number\.isFinite\(Number\(data\.indexes\.adjustmentPct\)\).*adjustmentInput\.value=String\(data\.indexes\.adjustmentPct\)/);
  assert.match(APP,/Adjustment rate \$\{adjustmentLabel\}/);
});

test('v5.94 motor masrafları çıkarıp sonra ekliyor', () => {
  assert.match(ENGINE, /const stripCosts=\(price,hologram\)=>/);
  assert.match(ENGINE, /return \(price-hologram\)\*\(1-royaltyPct\/100\);/);
  assert.match(ENGINE, /return price\/\(1-royaltyPct\/100\)\+hologram;/);
  // Taban: dahil ise çıkarılır, değilse olduğu gibi endekslenir.
  assert.match(ENGINE, /royaltyIncluded\?stripCosts\(previousUsdPrice,hologramUsd\):previousUsdPrice/);
  // Sonuç HER İKİ durumda da masraflar dahil verilir.
  assert.match(ENGINE, /const newUsdPrice=indexedUsdPrice!=null\?addCosts\(indexedUsdPrice,hologramUsd\):null;/);
});

test('v5.94 hologram TL tarafında dönemin kuruyla çevriliyor', () => {
  // Hologram USD cinsinden sabit bir birim maliyet. Eski fiyattan çıkarırken
  // ESKİ dönem kuru, yeni fiyata eklerken YENİ dönem kuru kullanılmalı; aksi
  // halde iki farklı dönemin TL'si aynı kurla karıştırılırdı.
  assert.match(ENGINE, /const hologramTryOld=hologramUsd\*oldFx, hologramTryNew=hologramUsd\*newFx;/);
  assert.match(ENGINE, /stripCosts\(previousTryPrice,hologramTryOld\)/);
  assert.match(ENGINE, /addCosts\(indexedTryPrice,hologramTryNew\)/);
});

test('v5.94 geçersiz royalty/hologram hesabı bozmuyor', () => {
  // %100 royalty bölmeyi geçersiz kılar; 0 kabul edilip masraf uygulanmaz.
  assert.match(ENGINE, /royaltyRaw>=0&&royaltyRaw<100\?royaltyRaw:0/);
  assert.match(ENGINE, /hologramRaw>=0\?hologramRaw:0/);
  // Kural yoksa masraf uygulanmamalı: royaltyActive her ikisi de sıfırsa false.
  assert.match(ENGINE, /const royaltyActive=royaltyPct>0\|\|hologramUsd>0;/);
  assert.match(ENGINE, /if\(!Number\.isFinite\(price\)\|\|!royaltyActive\)return price;/);
});

test('v5.94 kural ekrandan seçilmiyor, modelin eşleşmesinden geliyor', () => {
  const block = APP.slice(APP.indexOf('function endeksmatikRoyaltyRule'), APP.indexOf('function endeksmatikModelContext'));
  // Koleksiyon ve Siparişler kendi mevcut eşleştiricilerini kullanmalı ki
  // Endeksmatik ile Koleksiyon/CP aynı kuralı görsün.
  assert.match(block, /mode==='orders'\s*\?findSuppFobRule\(/);
  assert.match(block, /:kolFindPricingRule\(row\)/);
  // Geçersiz kural sessizce kabul edilmemeli.
  assert.match(block, /royalty<0\|\|royalty>=100\)return null/);
  assert.match(block, /hologramCost<0\)return null/);
  // Payload kuralı taşımalı.
  assert.match(APP, /royaltyPct:ctx\.royaltyRule\?ctx\.royaltyRule\.royalty:0/);
  assert.match(APP, /hologramCost:ctx\.royaltyRule\?ctx\.royaltyRule\.hologramCost:0/);
});

test('v5.94 soru varsayılan olarak Hayır geliyor ve kural ekranda yazıyor', () => {
  assert.match(APP, /data-em-field="royaltyIncluded"/);
  // Varsayılan Hayır: kayıtlı bir seçim yoksa "0" seçili olmalı.
  assert.match(APP, /<option value="0"\$\{ctx\.royaltyIncluded\?'':' selected'\}>/);
  assert.match(APP, /royaltyIncluded:Boolean\(saved\.royaltyIncluded\)/);
  // Eşleşen kural yoksa kullanıcı bunu görmeli; sessizce masrafsız hesaplamak
  // yanıltıcı olurdu.
  assert.match(APP, /Bu modele eşleşen License Royalty hesabı yok; masraf uygulanmaz/);
});
