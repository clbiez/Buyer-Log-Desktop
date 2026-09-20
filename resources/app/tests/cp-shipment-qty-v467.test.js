'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const parse = require(path.join(ROOT, 'server', 'lib', 'parse.js'));
const INDEX = (fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8'));

function asas(overrides={}){
  return {
    'Sipariş Kod':'A-1',
    'Model Adı':'MODEL-1',
    'Renk Kod':'C01',
    'Renk':'BLACK',
    'Net Alım Sipariş Miktarı':10000,
    'Kalan Alım Sipariş Miktarı':3000,
    'FOB Fiyatı':5,
    'Üretici':'SUPPLIER',
    'Sezon':'W6',
    'Buyer Grup (TR)':'BG',
    'Siparişin Üretildiği Ülke':'CIN',
    'Orijinal Exfactory Merch Tarih':'2026-01-01',
    'Retail Depo Tarih Yıl Ay Gün':'2026-06-01',
    'Model Bütçe Tarih Yıl Ay Gün':'2026-06-15',
    ...overrides,
  };
}

function ias(qty,overrides={}){
  return {
    'Sipariş Kod':'A-1',
    'Ürün Ad':'MODEL-1',
    'Renk Kod':'C01',
    'Renk Tanım':'BLACK',
    'Supplier Portal Statü':'Yol Operasyonları',
    'Tahmini Antrepo Giriş Tarihi':'2026-03-01',
    'Vasita Tanim':'Gemi',
    'Yükleme Toplam Adet':qty,
    ...overrides,
  };
}

function overrides(){
  return {
    antrepoMatchConfig:parse.defaultAntrepoMatchConfig(),
    submap:{},delmap:{},suppfobmap:{},suppfobmetamap:{},notesmap:{},licensormap:{},imagemap:{},
    pricingRules:[],transitRules:[],
  };
}

test('CP Shipment Quantity Antrepo parsiyellerinin Yükleme Toplam Adet toplamıdır',()=>{
  const ov=overrides();
  const orders=parse.parseASASRows([asas()],ov.antrepoMatchConfig).orders;
  const antrepo=parse.parseAntrepoRows([ias(3000),ias(4000,{ 'Tahmini Antrepo Giriş Tarihi':'2026-03-10' })],ov.antrepoMatchConfig);
  const rows=parse.buildCPRowsFromASAS(orders,antrepo,ov);
  assert.equal(rows.length,1);
  assert.equal(rows[0]['Order Quantity'],10000);
  assert.equal(rows[0]['Shipment Quantity'],7000);
  assert.equal(rows[0]['Remaining Units'],3000);
});

test('CP Shipment Quantity IAS kaydı yoksa sıfırdır',()=>{
  const ov=overrides();
  const orders=parse.parseASASRows([asas()],ov.antrepoMatchConfig).orders;
  const rows=parse.buildCPRowsFromASAS(orders,{},ov);
  assert.equal(rows.length,1);
  assert.equal(rows[0]['Shipment Quantity'],0);
});

test('Shipment Qty sütunu Order Quantity sütununun hemen sağındadır ve iki dilde doğru etiketlenir',()=>{
  const orderAt=INDEX.indexOf("{k:'Order Quantity'");
  const shipmentAt=INDEX.indexOf("{k:'Shipment Quantity'");
  const remainingAt=INDEX.indexOf("{k:'Remaining Units'");
  assert.ok(orderAt>=0 && orderAt<shipmentAt && shipmentAt<remainingAt);
  assert.match(INDEX,/'Shipment Quantity':'Shipment Qty'/);
  assert.match(INDEX,/'Shipment Quantity':'Yükleme Adet'/);
  assert.ok(orderAt>=0 && orderAt<shipmentAt && shipmentAt<remainingAt);
  assert.match(INDEX,/row\['Shipment Quantity'\]=row\._logisticLoadedQty/);
});
