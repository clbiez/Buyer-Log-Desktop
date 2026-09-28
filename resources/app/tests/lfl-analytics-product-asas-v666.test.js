'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const css=read('public/lfl.css');
const lfl=read('public/lfl.js');
const html=read('public/index.html');
const app=read('public/app-main.js');
const parse=read('server/lib/parse.js');
const lflServer=read('server/lib/lfl.js');
const modelFields=read('server/lib/model-fields.js');
const modelRefresh=read('server/lib/model-refresh.js');

test('v6.66 Product Description is projected to CP and Orders and available as an LFL filter',()=>{
  assert.match(modelFields,/header:\s*['"]Ürün Tanım['"]/);
  assert.match(parse,/productDescriptionHeader/);
  assert.match(parse,/'Ürün Tanım':\s*o\.productDescription/);
  assert.match(app,/\{k:['"]Ürün Tanım['"],\s*label:['"]Ürün Tanım['"]/);
  assert.match(app,/CP_SEARCH_KEYS=.*['"]Ürün Tanım['"]/);
  assert.match(app,/'Ürün Tanım':\s*o\.productDescription/);
  assert.match(html,/data-lfldim=['"]productDescription['"]/);
  assert.match(lfl,/productDescription:\{label:['"]Ürün Tanım['"],labelEn:['"]Product Description['"]/);
  assert.match(lflServer,/productDescription:\s*['"]Şort['"]|productDescription:/); // field is normalized in server LFL rows
  assert.match(modelRefresh,/\['Teknik Resim',\s*'Ürün Tanım'\]/);
});

test('v6.66 LFL parser preserves all returned ASAS headings for dynamic breakdowns',()=>{
  const {parseLFLRows}=require(path.join(root,'server','lib','lfl'));
  const result=parseLFLRows([{
    'Sipariş Kod':'1','Sezon':'S7','FOB Fiyatı':4.5,'Net Alım Sipariş Miktarı':100,
    'MAG':'CU4E','MMYG':'M1','Klasman':'K1','Üretici':'MFR','Siparişin Üretildiği Ülke':'TR',
    'Buyer Grup (TR)':'LİSANS','Buyer':'GÖKBERK','Ürün Tanım':'Şort','ASAS Özel Başlık':'Özel Değer','In-Store':'2027-06-01'
  }]);
  assert.equal(result.rows.length,1);
  assert.equal(result.rows[0].productDescription,'Şort');
  assert.equal(result.rows[0]._asas['ASAS Özel Başlık'],'Özel Değer');
  assert.deepEqual(result.meta.dimensions.productDescriptions,['Şort']);
});

test('v6.66 Analysis Breakdown offers Add From ASAS and can persist a selected database heading',()=>{
  assert.match(lfl,/ASAS_ADD_OPTION=['"]__add_from_asas__['"]/);
  assert.match(lfl,/function openAsasBreakdownPicker\(/);
  assert.match(lfl,/\/api\/model-connections\/schema/);
  assert.match(lfl,/\/api\/model-connections['"]/);
  assert.match(lfl,/copy\.mapping\[outputHeader\]/);
  assert.match(lfl,/await load\(true\)/);
  assert.match(lfl,/row\._asas/);
});
