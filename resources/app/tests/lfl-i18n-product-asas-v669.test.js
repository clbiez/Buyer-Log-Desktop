'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('v6.69 ASAS Ürün Tanım değeri gerçek parser hattından CP ve Orders satırlarına taşınır',()=>{
  const parse=require(path.join(root,'server','lib','parse'));
  const source={
    'Sipariş Kod':'1001','Net Alım Sipariş Miktarı':100,'Kalan Alım Sipariş Miktarı':100,
    'FOB Fiyatı':4.5,'Plm Kod':123,'Üretici':'MFR','Sezon':'S7','Ürün Klasman':'K1',
    'Merch Alt Grup Kod':'M1','Merch Marka Yaş Grup Kod':'CU4E','Buyer Grup (TR)':'LİSANS',
    'Siparişin Üretildiği Ülke':'Türkiye','Lisans':'DTR','Model Adı':'MOD-1',
    'Ürün Tanım':'Şort','Renk Kod':'3E8','Renk':'Mavi','Buyer':'Buyer 1','Line':'Line 1'
  };
  const parsed=parse.parseASASRows([source]);
  assert.equal(parsed.orders[0].productDescription,'Şort');
  assert.equal(parse.buildCPRowsFromASAS(parsed.orders,new Map(),{})[0]['Ürün Tanım'],'Şort');
  assert.equal(parse.buildOrdersRowsFromASAS(parsed.orders,new Map(),{})[0]['Ürün Tanım'],'Şort');
  const app=read('public/app-main.js');
  assert.match(app,/const CP_COLS\s*=\s*\[[\s\S]*?\{k:'Ürün Tanım',\s*label:'Ürün Tanım'/);
  assert.match(app,/ORDERS_COLS\s*=\s*ordersColumnsFromCp\(CP_COLS\)/);
});

test('v6.69 Ürün Tanım LFL ana filtresine ve filtre zincirine dahildir',()=>{
  const html=read('public/index.html');
  const lfl=read('public/lfl.js');
  assert.match(html,/data-lfldim="productDescription"[\s\S]{0,300}?data-i18n-tr="Ürün Tanım"[\s\S]{0,120}?data-i18n-en="Product Description"/);
  assert.match(lfl,/productDescription:\{label:'Ürün Tanım',labelEn:'Product Description',allLabel:'hepsi',rowKey:'productDescription'\}/);
  assert.match(lfl,/const FILTER_DIMS=Object\.keys\(FILTER_META\)/);
  assert.match(lfl,/for\(const dim of SHARED_DIMS\)[\s\S]*?if\(!set\.has\(meta\.identities\[dim\]\)\)return false/);
  const {parseLFLRows}=require(path.join(root,'server','lib','lfl'));
  const parsed=parseLFLRows([{
    'Sipariş Kod':'1','Sezon':'S7','FOB Fiyatı':4.5,'Net Alım Sipariş Miktarı':100,
    'MAG':'CU4E','MMYG':'M1','Klasman':'K1','Üretici':'MFR','Siparişin Üretildiği Ülke':'TR',
    'Buyer Grup (TR)':'LİSANS','Buyer':'Buyer 1','Ürün Tanım':'Şort','In-Store':'2027-06-01'
  }]);
  assert.equal(parsed.rows[0].productDescription,'Şort');
  assert.deepEqual(parsed.meta.dimensions.productDescriptions,['Şort']);
});

test('v6.69 Analysis Breakdown listesinin en sonunda Add From ASAS bulunur ve seçilen başlık kaydedilir',()=>{
  const source=read('public/lfl.js');
  const start=source.indexOf('function renderBreakdownPanel()');
  const end=source.indexOf('function closeOtherPanels',start);
  const block=source.slice(start,end>start?end:start+7000);
  const standard=block.indexOf('options.map(dim=>');
  const add=block.indexOf('ASAS_ADD_OPTION');
  assert.ok(standard>=0&&add>standard,'Add From ASAS must follow the standard breakdown choices');
  assert.match(block,/Add From ASAS…/);
  assert.match(block,/ASAS’tan Ekle…/);
  assert.match(source,/\/api\/model-connections\/schema/);
  assert.match(source,/copy\.mapping\[outputHeader\]/);
  assert.match(source,/await load\(true\)/);
});
