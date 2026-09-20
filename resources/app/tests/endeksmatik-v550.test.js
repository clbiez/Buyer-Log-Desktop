'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const engine=require('../server/lib/endeksmatik');

const APP=fs.readFileSync(path.join(__dirname,'..','public','app-main.js'),'utf8');
const CSS=fs.readFileSync(path.join(__dirname,'..','public','app.css'),'utf8');

const base={
  mmyg:'CUW4',mag:'CU4E',buyingGroup:'LİSANS',category:'KEY ORME BODY K.KOL-LİSANS',
  previousOrderMonth:'202507',previousInStoreMonth:'202602',newOrderMonth:'202607',newInStoreMonth:'202702',
  previousTryPrice:187,previousUsdPrice:2.75,
};

test('v5.50 Domestic TRY can use separate previous periods without changing Overseas USD benchmark',()=>{
  const common=engine.calculate(base);
  const split=engine.calculate({...base,separateTryPeriods:true,previousTryOrderMonth:'202506',previousTryInStoreMonth:'202601'});
  assert.equal(split.months.separateTryPeriods,true);
  assert.equal(split.months.previousTryOrderMonth,'202506');
  assert.equal(split.months.previousTryInStoreMonth,'202601');
  assert.equal(split.prices.usd,common.prices.usd,'USD result must keep the shared/Overseas reference periods');
  assert.notEqual(split.prices.try,common.prices.try,'TRY result must respond to its separate previous periods');
  assert.deepEqual(split.componentsUsd.map(x=>x.oldMonth),['202507','202602','202507','202602']);
  assert.deepEqual(split.componentsTry.map(x=>x.oldMonth),['202506','202601','202506','202601']);
});

test('v5.50 server rejects In Store periods older than their order/reference periods',()=>{
  assert.throws(()=>engine.calculate({...base,previousInStoreMonth:'202506'}),err=>err&&err.code==='MONTH_ORDER_INVALID');
  assert.throws(()=>engine.calculate({...base,newOrderMonth:'202506',newInStoreMonth:'202601'}),err=>err&&err.code==='MONTH_ORDER_INVALID');
  assert.throws(()=>engine.calculate({...base,separateTryPeriods:true,previousTryOrderMonth:'202602',previousTryInStoreMonth:'202601'}),err=>err&&err.code==='MONTH_ORDER_INVALID');
});

test('v5.50 Endeksmatik month fields support manual text and native month/year picker',()=>{
  assert.match(APP,/type=\"month\" class=\"endeksmatikNativeMonthPicker\"/);
  assert.match(APP,/typeof picker\.showPicker==='function'/);
  assert.match(CSS,/\.endeksmatikMonthPickerBtn/);
});

test('v6.01 sipariş ayı girmek In Store ayını DEĞİŞTİRMEZ',()=>{
  // v5.50'de sipariş ayının YILI In Store ayına taşınıyordu. Sipariş ve In Store
  // dönemleri aynı yılda olmak zorunda değil (2025-09 sipariş → 2026-02 depo),
  // ve kullanıcı elle girdiği tarihin altından kaydığını görüyordu.
  assert.doesNotMatch(APP,/syncInStoreYear/);
  // Toplu doldurma isteyenler için AÇIK eylem duruyor: ±1 yıl düğmeleri.
  assert.match(APP,/data-em-year-shift="forward"/);
  assert.match(APP,/data-em-year-shift="backward"/);
  // Kronoloji doğrulaması kalmalı: tutarsız tarih sessizce kabul edilmemeli.
  assert.match(APP,/validateChronology\(\{toast:true\}\)/);
});

test('v5.50 UI blocks invalid chronology and offers separate Domestic TRY old periods',()=>{
  assert.match(APP,/Domestic TL fiyatı için farklı eski dönem kullan/);
  assert.match(APP,/monthField\('previousTryOrderMonth'/);
  assert.match(APP,/monthField\('previousTryInStoreMonth'/);
  assert.match(APP,/Yeni In Store ayı, geçen In Store ayından eski olamaz/);
  assert.match(APP,/calcBtn\.disabled=Boolean\(message\)/);
  assert.match(APP,/separateTryPeriods:separate/);
});

test('v5.50 Collection persists separate TRY periods while leaving model class specific to the destination',()=>{
  const saveAt=APP.indexOf('const nextEndeksmatik={');
  const save=APP.slice(saveAt,APP.indexOf('saveKolRows();renderKol();showToast',saveAt));
  assert.match(save,/separateTryPeriods:payload\.separateTryPeriods/);
  assert.match(save,/previousTryOrderMonth:payload\.previousTryOrderMonth/);
  assert.match(save,/previousTryInStoreMonth:payload\.previousTryInStoreMonth/);
  assert.match(save,/kolWriteGroupedStorageValue\(row,'endeksmatikData',nextEndeksmatik\)/);
});

test('v5.50 Endeksmatik setup can be copied between models and target must recalculate',()=>{
  assert.match(APP,/ENDEKSMATIK_CLIPBOARD_KEY='buyerlog\.endeksmatikClipboard\.v1'/);
  assert.match(APP,/sessionStorage\.setItem\(ENDEKSMATIK_CLIPBOARD_KEY/);
  assert.match(APP,/data-em-copy/);
  assert.match(APP,/data-em-paste/);
  const copiedAt=APP.indexOf('const copied={schemaVersion:1');
  const copied=APP.slice(copiedAt,APP.indexOf('if(endeksmatikClipboardWrite',copiedAt));
  assert.doesNotMatch(copied,/result:/,'computed result must not be copied to a different model class');
  assert.match(APP,/Bu model için yeniden hesaplayın/);
});
