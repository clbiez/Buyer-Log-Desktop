'use strict';
// Regression: Merch Calendar kurulduktan sonra uygulamanın tarih seçicileri
// LCW Merch hafta ile GLB/ISO haftayı birlikte göstermeli. Ortak tarih takvimi
// (ex-factory revizesi vb.) yalnız GLB, Koleksiyon MB Week paneli yalnız LCW
// gösteriyordu.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const app=read('public/app-main.js');
const css=read('public/app.css');

function fnBody(name){
  const start=app.indexOf(`function ${name}(`);
  assert.ok(start>=0,`${name} bulunamadı`);
  const next=app.indexOf('\nfunction ',start+1);
  return app.slice(start,next<0?undefined:next);
}

test('ortak tarih takvimi her hafta satırında LCW / GLB çiftini gösterir',()=>{
  const body=fnBody('renderDateCalendarPopup');
  assert.match(body,/dateCalendarWeekPair\(monday\)/);
  assert.match(body,/LCW \/ GLB/);
  assert.match(body,/LCW Merch/);
  assert.match(body,/data-cal-clear>\$\{calEn\?'Clear':'Temizle'\}/);
  assert.match(body,/data-cal-today>\$\{calEn\?'Today':'Bugün'\}/);
  const pair=fnBody('dateCalendarWeekPair');
  assert.match(pair,/BLDateDimension/);
  assert.match(pair,/weekPair/);
  assert.match(app,/bl:merch-calendar-change[^\n]*renderDateCalendarPopup/);
  assert.match(css,/\.dateCalendarGrid\{[^}]*grid-template-columns:4\dpx repeat\(7/);
});

test('Koleksiyon MB hafta/ay paneli merch haftanın yanında GLB haftayı gösterir',()=>{
  const body=fnBody('openKolPeriodDrawer');
  assert.match(body,/kolGlobalWeekDisplay\(schedule\.inStore\)/);
  assert.match(body,/GLB/);
  assert.match(body,/kolGlobalWeekDisplay\(current\.inStore\)/);
  const glb=fnBody('kolGlobalWeekDisplay');
  assert.match(glb,/weekPair|isoWeekNumber/);
});

test('dateCalendarWeekPair merch takvimi yokken LCW için tire, GLB için ISO hafta döner',()=>{
  const dimension=require('../public/date-dimension');
  dimension.clearMerchCalendar();
  const src=fnBody('dateCalendarWeekPair');
  const fn=new Function('window','isoWeekNumber',`${src};return dateCalendarWeekPair;`)({BLDateDimension:dimension},d=>dimension.isoWeekNumber(d));
  const pair=fn(new Date(2026,9,12));
  assert.equal(pair.lcw,'—');
  assert.equal(pair.glb,'42');
  const merchFake={...dimension,hasMerchCalendar:()=>true,weekPair:()=>({lcw:41,glb:42,mapped:true})};
  const fn2=new Function('window','isoWeekNumber',`${src};return dateCalendarWeekPair;`)({BLDateDimension:merchFake},()=>0);
  assert.deepEqual(fn2(new Date(2026,9,12)),{lcw:'41',glb:'42'});
});
