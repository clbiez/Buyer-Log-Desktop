'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

function fn(name){
  const start=APP.indexOf(`function ${name}(`);
  assert.ok(start>=0, `${name} bulunamadı`);
  const next=APP.indexOf('\nfunction ', start+10);
  return APP.slice(start, next<0?APP.length:next);
}

test('v9.58 Shipping global Copy alt grid yerine üst comparison clipboard yoluna gider', () => {
  const start=APP.indexOf("getElementById('navCopy').addEventListener");
  assert.ok(start>=0, 'navCopy handler bulunamadı');
  const block=APP.slice(start, start+2400);
  assert.match(block, /if\(info\.tableKey==='ship'\)\{ void copyShipComparisonFlat\(event\.currentTarget\); return; \}/);
  const special=block.indexOf("info.tableKey==='ship'");
  const grid=block.indexOf('copyStyledTableLikeExcel');
  assert.ok(special>=0 && grid>special, 'Shipping özel yolu alt grid kopyasından önce çalışmalı');
});

test('v9.58 comparison clipboard her model için tek flat satır üretir ve görsel taşımaz', () => {
  const rows=fn('shipComparisonClipboardRows');
  assert.match(rows, /sources\.map\(source=>\{/);
  assert.match(rows, /const state=shipDecisionState\(row\)/);
  assert.match(rows, /cheapest, earliest/);
  assert.doesNotMatch(rows, /shipRowImageRef|CP_IMAGE_API|<br>|<img/);

  const matrix=fn('shipComparisonClipboardMatrix');
  assert.match(matrix, /\.\.\.rows\.map\(row=>columns\.map/);
  const plain=fn('shipComparisonFlatPlain');
  assert.match(plain, /row\.join\('\\t'\)/);
  assert.match(plain, /\.join\('\\n'\)/);
});

test('v9.58 clipboard üst comparison kimlik, tarih ve hesaplanmış landed alanlarını ayrı kolonlara ayırır', () => {
  const cols=fn('shipComparisonClipboardColumns');
  for(const label of [
    'Order Code','Style Name','Colour Code','Supplier','Quantity','OPD','Ex-Factory','Retail Date',
    'Overseas FOB','Domestic FOB','Domestic Landed','SEA Landed','SEA Saving %','SEA ETA',
    'SEA+AIR Landed','SEA+AIR Saving %','AIR Landed','AIR Saving %','Cheapest','Earliest'
  ]) assert.ok(cols.includes(label), `${label} clipboard kolonu eksik`);
  assert.doesNotMatch(cols, /label:'Image'|label:'Görsel'/);
});

test('v9.58 Copy mevcut Shipping state ve seçim kümesini kullanır', () => {
  assert.match(fn('shipCopyRows'), /shipSelected\.has\(row\._shipId\)/);
  const flat=fn('copyShipComparisonFlat');
  assert.match(flat, /const sources=shipCopyRows\(\)/);
  assert.match(flat, /shipComparisonClipboardMatrix\(sources\)/);
  assert.match(flat, /copyRichToClipboard\(shipComparisonFlatHtml\(matrix\),shipComparisonFlatPlain\(matrix\)\)/);
});

test('Both clipboard formats use one localized comparison snapshot, including custom methods and zero', async () => {
  const vm = require('node:vm');
  const methods = [{id:'m-demo',label:'Demo & Rail'}];
  const row = {
    _shipId:'a', orderCode:1001, styleName:'Demo <A>\tBlue', quantity:0,
    opd:'2027-03-29', exFactory:'2027-04-01', retailDate:'2027-06-14', trFiyatUsd:0,
  };
  const options = [
    {key:'fob',unit:4.336,decision:false},
    {key:'tr',unit:0},
    {key:'gemi',unit:4.8063,date:'2027-05-30',transit:59},
    {key:'m-demo',unit:0,date:'2027-04-01',transit:0,custom:true,name:'Demo & Rail'},
  ];
  for (const [appLang,decimal,unit] of [['tr',',','g'],['en','.','d']]) {
    let calculations=0, output;
    const context=vm.createContext({
      appLang, shipRows:[row,{_shipId:'b'}], shipSelected:new Set(['a']),
      shipCustomMethods:()=>methods, computeShipFormulas:source=>{calculations++;return source;},
      shipDecisionState:()=>({options,cheapest:0,earliest:'2027-04-01'}),
      toNum:Number, toISODate:String, coerceDateLoose:value=>value, norm:String,
      fmtDate:iso=>iso?iso.slice(8)+'.'+iso.slice(5,7)+'.'+iso.slice(2,4):'',
      escapeHtml:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
      copyRichToClipboard:(html,plain)=>{output={html,plain};return true;},
      showToast:()=>{},
    });
    const start=APP.indexOf('function shipCopyRows(');
    const end=APP.indexOf('function shipCopyTableHtml(',start);
    vm.runInContext(APP.slice(start,end),context);
    await context.copyShipComparisonFlat();
    assert.equal(calculations,1);
    const [headers,values]=output.plain.split('\n').map(row=>row.split('\t'));
    const pasted=Object.fromEntries(headers.map((key,i)=>[key,values[i]]));
    assert.equal(pasted['Style Name'],'Demo <A> Blue');
    assert.equal(pasted['Overseas FOB'],'$4'+decimal+'34');
    assert.equal(pasted['Domestic FOB'],'$0'+decimal+'00');
    assert.equal(pasted['Domestic Landed'],'$0'+decimal+'00');
    assert.equal(pasted['AIR Landed'],'');
    assert.equal(pasted.OPD,'29.03.27');
    assert.equal(pasted['Ex-Factory'],'01.04.27');
    assert.equal(pasted['Retail Date'],'14.06.27');
    assert.equal(pasted['SEA ETA'],'30.05.27');
    assert.equal(pasted[appLang==='tr'?'SEA Transit Gün':'SEA Transit Days'],'59 '+unit);
    assert.equal(pasted['Demo & Rail Landed'],'$0'+decimal+'00');
    assert.equal(pasted['Demo & Rail ETA'],'01.04.27');
    assert.equal(pasted[appLang==='tr'?'Demo & Rail Transit Gün':'Demo & Rail Transit Days'],'0 '+unit);
    const htmlCells=Array.from(output.html.matchAll(/<td[^>]*>([^<]*)<\/td>/g),match=>match[1]);
    assert.deepEqual(htmlCells,values.map(context.escapeHtml));
  }
});
