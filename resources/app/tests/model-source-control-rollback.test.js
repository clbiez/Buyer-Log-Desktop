'use strict';
// Preserve normal ASAS/IAS query contracts after removing the 7.0.360 utility.
const test=require('node:test'),assert=require('node:assert/strict');
const modelHorizon=require('../server/lib/modelHorizon');
const modelRefresh=require('../server/lib/model-refresh');
const modelFields=require('../server/lib/model-fields');
const T = 'Siparis Bilgileri';

function iasMapping() {
  return {
    'İthalat Dosya No': { table: 'Ithalat', name: 'İthalat Dosya No', kind: 'column' },
    'Konteyner No': { table: 'Ithalat', name: 'Konteyner No', kind: 'column' },
    'Sipariş Kod': { table: T, name: 'Sipariş Kod', kind: 'column' },
    'Model Adı': { table: T, name: 'Ürün Ad', kind: 'column' },
    'Renk Kod': { table: T, name: 'Renk Kod', kind: 'column' },
    'Supplier Portal Statü': { table: 'Ithalat', name: 'Supplier Portal Statü', kind: 'column' },
    'Tahmini Antrepo Giriş Tarihi': { table: 'Ithalat', name: 'Tahmini Antrepo Giriş Tarihi', kind: 'column' },
    'HANDOVER Tarihi': { table: 'Ithalat', name: 'Handover Tarihi - CutOff Tarihi', kind: 'measure' },
    'Yükleme Toplam Adet': { table: 'Ithalat', name: 'Yükleme Toplam Adet', kind: 'measure' },
    'Sezon': { table: T, name: 'Sezon', kind: 'column' },
  };
}
function iasItem() {
  return {
    id: 'ias', name: 'IAS', role: 'antrepo', mode: 'auto', server: 's', catalog: 'c',
    horizon: { table: T, seasonTable: T, seasonField: 'Sezon', seasons: ['W6'], groups: [] },
    mapping: iasMapping(),
  };
}

const ASAS_TABLE = 'ASAS';
function asasMapping() {
  const mapping = {};
  for (const field of modelFields.fieldsForRole('asas')) {
    mapping[field.header] = { table: ASAS_TABLE, name: field.header, kind: 'column' };
  }
  mapping['Net Alım Sipariş Miktarı'] = { table: ASAS_TABLE, name: 'Net Alım Sipariş Miktarı', kind: 'measure' };
  return mapping;
}
function asasItem() {
  return {
    id: 'asas', name: 'ASAS', role: 'asas', mode: 'auto', server: 's', catalog: 'c',
    horizon: { table: ASAS_TABLE, seasonTable: ASAS_TABLE, seasonField: 'Sezon', seasons: ['W6'], groups: [] },
    mapping: asasMapping(),
  };
}


test('rollback preserves ASAS fabric fields in the production query',()=>{
 const normal=modelRefresh.buildConnectionQuery(asasItem(),{columnType:null});
 for(const header of ['Ana Kumaş Mı','Kumaş Kategorisi','Kumaşçı Ülkesi','Kumaşçı','Kumaş Tipi','İplik No','Gramaj','Karışım'])assert.ok(normal.query.includes(`[${header}]`),header);
});
test('rollback preserves IAS fact context and SELECTEDVALUE lookups',()=>{
 const normal=modelHorizon.buildFactRowQuery(iasItem().horizon,iasMapping(),{grainTable:'Ithalat'});
 assert.match(normal.query,/CALCULATE\(SELECTEDVALUE\('Siparis Bilgileri'\[Sipariş Kod\]\), CALCULATETABLE\('Ithalat'\)\)/);
 assert.doesNotMatch(normal.query,/RELATED\(/);
});
test('removed measurement flags cannot select an experimental production query',()=>{
 for(const item of [asasItem(),iasItem()])assert.deepEqual(modelRefresh.buildConnectionQuery(item,{columnType:null,excludeFabric:true,iasLookup:'related'}),modelRefresh.buildConnectionQuery(item,{columnType:null}));
 assert.deepEqual(modelHorizon.buildFactRowQuery(iasItem().horizon,iasMapping(),{grainTable:'Ithalat',relatedLookup:true}),modelHorizon.buildFactRowQuery(iasItem().horizon,iasMapping(),{grainTable:'Ithalat'}));
});
