'use strict';
const test=require('node:test');
const assert=require('node:assert');
const fs=require('fs');
const path=require('path');
const dateDimension=require('../public/date-dimension');

const ROOT=path.join(__dirname,'..');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
const PARSE=fs.readFileSync(path.join(ROOT,'server','lib','parse.js'),'utf8');
const INDEX=fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8');

test('31.08.2026 Collection kuralıyla Eylül 2026 / 36. Hafta Eylül 2026 olur',()=>{
  const value=dateDimension.describe('31.08.2026');
  assert.equal(value.valid,true);
  assert.equal(value.dateKey,'2026-08-31');
  assert.equal(value.monthKey,'2026-09');
  assert.equal(value.monthLabelTr,'Eylül 2026');
  assert.equal(value.weekKey,'2026-W36');
  assert.equal(value.weekLabelTr,'36. Hafta Eylül 2026');
  assert.equal(dateDimension.bucketKey('31.08.2026','month'),'2026-09');
  assert.equal(dateDimension.bucketLabel('2026-09','month','tr'),'Eylül 2026');
  assert.equal(dateDimension.bucketLabel('2026-W36','week','tr'),'36. Hafta Eylül 2026');
});

test('28.09.2026 ile başlayan hafta Ekim dönemine atanır',()=>{
  const value=dateDimension.describe('28.09.2026');
  assert.equal(value.monthKey,'2026-10');
  assert.equal(value.monthLabelTr,'Ekim 2026');
  assert.equal(value.weekKey,'2026-W40');
  assert.equal(value.weekLabelTr,'40. Hafta Ekim 2026');
});

test('yıl geçişinde hafta ISO anahtarını, ay etiketi pazar gününün yılını korur',()=>{
  const value=dateDimension.describe('28.12.2026');
  assert.equal(value.weekKey,'2026-W53');
  assert.equal(value.monthKey,'2027-01');
  assert.equal(value.monthLabelTr,'Ocak 2027');
  assert.equal(value.weekLabelTr,'53. Hafta Ocak 2027');
  const first=dateDimension.describe('04.01.2027');
  assert.equal(first.weekKey,'2027-W01');
  assert.equal(first.weekLabelTr,'1. Hafta Ocak 2027');
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

test('ay ve hafta anahtarları metinsel etiketten bağımsız kronolojik sıralanabilir',()=>{
  assert.deepEqual(['2026-11','2026-09','2026-10'].sort(),['2026-09','2026-10','2026-11']);
  assert.deepEqual(['2027-W01','2026-W53','2026-W36'].sort(),['2026-W36','2026-W53','2027-W01']);
});

test('tarayıcı filtreleri ve Collection picker ortak date dimension motoruna bağlıdır',()=>{
  assert.match(INDEX,/date-dimension\.js[^\n]+column-schema\.js|date-dimension\.js/);
  assert.match(APP,/function dateBucketKey\(v, gran\)[\s\S]{0,220}BLDateDimension[\s\S]{0,140}bucketKey/);
  assert.match(APP,/isDateColumnDefinition\(col, rowsForFilterUniverse\(tableKey,key\)\)/);
  assert.match(APP,/function kolScheduleFromWeekMonday[\s\S]{0,420}BLDateDimension[\s\S]{0,220}monthCode/);
});

test('Backlog detay ve Excel her gerçek tarih alanının sağına Ay ve Hafta ekler',()=>{
  assert.match(APP,/function backlogExpandDateDimensions\(headers,rows\)/);
  assert.match(APP,/expandedHeaders\.push\(header\)/);
  assert.match(APP,/labels\.month,labels\.week/);
  assert.match(APP,/backlogExpandDateDimensions\(exportHeaders,data\.rows\|\|\[\]\)/);
  assert.match(APP,/backlogExpandDateDimensions\(headers,currentBacklogDetailRows\)/);
  assert.match(APP,/BACKLOG_EXCEL_COLUMNS_KEY='bl\.backlog\.excelColumns\.v4'/);
});

test('Backlog sunucu filtre kovaları aynı merkezi motoru kullanır',()=>{
  assert.match(PARSE,/require\('\.\.\/\.\.\/public\/date-dimension'\)/);
  assert.match(PARSE,/function backlogDateBucketKey\(order, gran\)[\s\S]{0,160}BLDateDimension\.bucketKey/);
  assert.match(PARSE,/function buildAntrepoDateTree[\s\S]{0,900}period\.monthKey[\s\S]{0,500}period\.weekKey/);
});
