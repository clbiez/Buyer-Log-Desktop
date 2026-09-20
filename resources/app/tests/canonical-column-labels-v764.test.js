'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const labels=require('../public/canonical-column-labels.js');

test('ASAS product description headers use one canonical label',()=>{
  assert.equal(labels.canonicalize('Product Definition','en'),'Product Description');
  assert.equal(labels.canonicalize('Ürün Tanım','tr'),'Ürün Tanımı');
  assert.equal(labels.canonicalize('Product Description','en'),'Product Description');
});

test('category/classification headers use one canonical label',()=>{
  assert.equal(labels.canonicalize('Klasman','en'),'Category');
  assert.equal(labels.canonicalize('Classification','en'),'Category');
  assert.equal(labels.canonicalize('Ürün Klasman','tr'),'Kategori');
});

test('data-verified shared dimensions use canonical labels',()=>{
  assert.equal(labels.canonicalize('Merch Alt Grup','en'),'MAG');
  assert.equal(labels.canonicalize('Yaş Grup','en'),'MMYG');
  assert.equal(labels.canonicalize('Sp. Code','en'),'Special Code');
  assert.equal(labels.canonicalize('C.Code','en'),'Colour Code');
  assert.equal(labels.canonicalize('Color Code','en'),'Colour Code');
  assert.equal(labels.canonicalize('Renk Kod','tr'),'Renk Kodu');
  assert.equal(labels.canonicalize('Buyer Group','en'),'Buying Group');
  assert.equal(labels.canonicalize('Sipariş Kod','tr'),'Sipariş Kodu');
});

test('Collection shared fields use CP/Orders/LFL display names only',()=>{
  assert.equal(labels.collectionLabelForKey('plmId','en'),'PLM ID');
  assert.equal(labels.collectionLabelForKey('modelKod','en'),'Model Name');
  assert.equal(labels.collectionLabelForKey('modelKod','tr'),'Model Adı');
  assert.equal(labels.collectionLabelForKey('lisans','tr'),'Lisans');
  assert.equal(labels.collectionLabelForKey('urunTipi','en'),'Category');
  assert.equal(labels.collectionLabelForKey('specialCode','tr'),'Özel Kod');
  assert.equal(labels.collectionLabelForKey('colourCode','en'),'Colour Code');
  assert.equal(labels.collectionLabelForKey('colourCode','tr'),'Renk Kodu');
  assert.equal(labels.collectionLabelForKey('licensor','tr'),'Lisansör');
  assert.equal(labels.collectionLabelForKey('mag','en'),'MAG');
  assert.equal(labels.collectionLabelForKey('mmyg','en'),'MMYG');
  assert.equal(labels.collectionLabelForKey('buyingGroup','en'),'Buying Group');
  assert.equal(labels.collectionLabelForKey('season','tr'),'Sezon');
  assert.equal(labels.collectionLabelForKey('country','tr'),'Ülke');
});

test('Collection PLM fields verified as different stay visibly distinct',()=>{
  assert.equal(labels.collectionLabelForKey('productMainDefinition','en'),'Product Main Definition');
  assert.equal(labels.collectionLabelForKey('productMainDefinition','tr'),'Ürün Ana Tanım');
  assert.equal(labels.collectionLabelForKey('line','en'),'Line');
  assert.equal(labels.collectionLabelForKey('buyingSampleManufacturer','en'),'Buying Sample');
  assert.equal(labels.collectionLabelForKey('unknown','en','Raw Label'),'Raw Label');
});

test('related but different PLM/ASAS fields are not merged',()=>{
  assert.equal(labels.canonicalize('Product Main Definition','en'),'Product Main Definition');
  assert.equal(labels.canonicalize('Style Name','en'),'Style Name');
  assert.equal(labels.canonicalize('Product Name','en'),'Product Name');
  assert.equal(labels.canonicalize('Line','en'),'Line');
  assert.equal(labels.canonicalize('Product Category','en'),'Product Category');
  assert.equal(labels.canonicalize('Supplier','en'),'Supplier');
  assert.equal(labels.canonicalize('Manufacturer','en'),'Manufacturer');
  assert.equal(labels.canonicalize('Retail Date','en'),'Retail Date');
  assert.equal(labels.canonicalize('In-Store','en'),'In-Store');
});

test('canonicalization never mutates row keys or values',()=>{
  const row={classification:'Outerwear',productDescription:'Jacket',quantity:12};
  const before=JSON.stringify(row);
  labels.canonicalize('Klasman','en');
  labels.canonicalize('Product Description','en');
  labels.collectionLabelForKey('urunTipi','en');
  assert.equal(JSON.stringify(row),before);
});
