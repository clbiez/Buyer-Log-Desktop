'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const dateDimension=require('../public/date-dimension');

const ROOT=path.join(__dirname,'..');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
const PARSE=fs.readFileSync(path.join(ROOT,'server','lib','parse.js'),'utf8');
const INDEX=fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8');

const CALENDAR={
  sourceName:'test-merch.xls',
  weeks:[
    {year:2026,week:17,month:4,monthWeek:4,start:'2026-04-20',end:'2026-04-26'},
    {year:2026,week:18,month:4,monthWeek:5,start:'2026-04-27',end:'2026-05-03'},
    {year:2026,week:19,month:5,monthWeek:1,start:'2026-05-04',end:'2026-05-10'},
    {year:2027,week:1,month:1,monthWeek:1,start:'2026-12-28',end:'2027-01-03'},
    {year:2027,week:2,month:1,monthWeek:2,start:'2027-01-04',end:'2027-01-10'},
  ],
  meta:{sourceName:'test-merch.xls',minDate:'2026-04-20',maxDate:'2027-01-10'}
};

test.beforeEach(()=>{dateDimension.clearMerchCalendar();dateDimension.setMerchCalendar(CALENDAR);});
test.after(()=>dateDimension.clearMerchCalendar());

test('yüklenen Merch Calendar iş haftası ve ayı için tek kaynaktır',()=>{
  const value=dateDimension.describe('2026-04-27');
  assert.equal(value.valid,true);
  assert.equal(value.businessValid,true);
  assert.equal(value.periodSource,'lcw');
  assert.equal(value.lcwYear,2026);
  assert.equal(value.lcwWeek,18);
  assert.equal(value.lcwMonth,4);
  assert.equal(value.lcwMonthWeek,5);
  assert.equal(value.monthKey,'2026-04');
  assert.equal(value.weekKey,'2026-W18');
  assert.equal(value.monthLabelTr,'Nisan 2026');
  assert.equal(value.weekLabelTr,'18. Hafta Nisan 2026');
  assert.equal(dateDimension.bucketKey('2026-04-27','month'),'2026-04');
});

test('LCW ve GLB hafta bilgileri birbirinden bağımsız taşınır',()=>{
  const value=dateDimension.describe('2027-01-04');
  assert.equal(value.lcwYear,2027);
  assert.equal(value.lcwWeek,2);
  assert.equal(value.globalWeekYear,2027);
  assert.equal(value.globalWeek,1);
  assert.deepEqual(dateDimension.weekPair('2027-01-04'),{lcw:2,lcwYear:2027,glb:1,glbYear:2027,mapped:true});
});

test('Merch Calendar kapsamı dışındaki tarihte LCW dönemi uydurulmaz',()=>{
  const value=dateDimension.describe('2026-06-01');
  assert.equal(value.valid,true);
  assert.equal(value.businessValid,false);
  assert.equal(value.weekKey,'');
  assert.equal(value.monthKey,'');
  assert.equal(dateDimension.bucketKey('2026-06-01','week'),'');
  assert.ok(value.globalWeek>0,'GLB hafta yine hesaplanabilir');
});

test('iş ayı sınırı yüklenen haftalardan türetilir',()=>{
  assert.deepEqual(dateDimension.businessMonthRange(2026,4),{start:'2026-04-20',end:'2026-05-03',year:2026,month:4,weeks:2});
  assert.deepEqual(dateDimension.businessWeekRange('2026-05-04'),{start:'2026-05-04',end:'2026-05-10',year:2026,week:19});
});

test('null ve geçersiz tarihler boş boyut üretir',()=>{
  for(const value of [null,'','31.02.2026','not-a-date']){
    const described=dateDimension.describe(value);
    assert.equal(described.valid,false);
    assert.equal(dateDimension.bucketKey(value,'month'),'');
    assert.equal(dateDimension.monthLabel(value,'tr'),'');
    assert.equal(dateDimension.weekLabel(value,'tr'),'');
  }
});

test('tarayıcı başlangıcında Merch Calendar runtime ve LCW/GLB picker yüklenir',()=>{
  assert.match(INDEX,/date-dimension\.js[\s\S]{0,240}merch-calendar-runtime\.js[\s\S]{0,240}dual-week-datepicker\.js/);
  assert.match(INDEX,/dual-week-datepicker\.css/);
});

test('Collection dönem seçicisi merkezi LCW tarih motoruna bağlıdır',()=>{
  assert.match(APP,/function kolWeekCodeForDate[\s\S]{0,260}businessValid[\s\S]{0,160}lcwYear[\s\S]{0,160}lcwWeek/);
  assert.match(APP,/function kolScheduleFromMonthCode[\s\S]{0,420}businessMonthRange/);
  assert.match(APP,/function kolScheduleFromWeekCode[\s\S]{0,300}mondayFromBusinessWeek|function kolMondayFromIsoWeek[\s\S]{0,220}mondayFromBusinessWeek/);
  assert.doesNotMatch(APP,/w>=1&&w<=53/);
});

test('Backlog detay ve filtre kovaları aynı merkezi motoru kullanır',()=>{
  assert.match(APP,/function backlogExpandDateDimensions\(headers,rows\)/);
  assert.match(APP,/\[labels\.month,'month'\]/);
  assert.match(APP,/\[labels\.week,'week'\]/);
  assert.match(PARSE,/require\('\.\.\/\.\.\/public\/date-dimension'\)/);
  assert.match(PARSE,/function backlogDateBucketKey\(order, gran\)[\s\S]{0,160}BLDateDimension\.bucketKey/);
  assert.match(PARSE,/function buildAntrepoDateTree[\s\S]{0,900}period\.monthKey[\s\S]{0,500}period\.weekKey/);
});
