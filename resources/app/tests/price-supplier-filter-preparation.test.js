'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('../public/price-supplier-insights-engine');

function observations(){
  return Array.from({length:120},(_,i)=>({season:i%2?'26Y':'25Y',manufacturer:`Supplier ${i%4}`,classification:'Kazak',country:i%3?'Türkiye':'Mısır',buyingGroup:'Kız Çocuk',price:8+i%5,quantity:20+i,modelKey:`model-${i}`,currency:i%7?'USD':'EUR',row:{'Demo field':i%2?' Aktif ':'Pasif'}}));
}
function legacyMatches(rec,filters){
  return Object.keys(filters).every(dim=>{
    if(!E.isFilterDim(dim))return true;
    const raw=filters[dim],wanted=(Array.isArray(raw)?raw:[raw]).map(E.keyOf).filter(Boolean);
    const actual=E.isColumnDim(dim)?E.keyOf(rec.obs.row[E.columnName(dim)]):rec.k[dim];
    return !wanted.length||wanted.includes(actual);
  });
}

test('filter preparation preserves aliases, multiple selections, empty and raw-column filters',()=>{
  const data=E.prepare(observations());
  for(const filters of [{},{country:[]},{country:['türkiye','MISIR'],buyingGroup:'KIZ ÇOCUK'},{country:['Türkiye'],'col:Demo field':['AKTIF']},{country:['—','',null],ignored:'anything'},{country:['not present']}]){
    const options={currentSeason:'26Y',previousSeason:'25Y',filters,currentPeriod:{dateField:'inStore',month:''}};
    const expected=E.analyze({...data,records:data.records.filter(rec=>legacyMatches(rec,filters))},{...options,filters:{}});
    assert.deepEqual(E.analyze(data,options),expected);
  }
});

test('selected filter values are normalized once per analysis, and changed selections are used immediately',()=>{
  const data=E.prepare(observations());let conversions=0;
  const selected={toString(){conversions++;return 'TÜRKİYE';}};
  const filters={country:[selected]};
  const first=E.analyze(data,{filters});
  assert.equal(first.totals.records,80);
  assert.equal(conversions,1,'the selected value must not be normalized again for every record');
  filters.country[0]='Mısır';
  assert.equal(E.analyze(data,{filters}).totals.records,40,'no cached filter survives a changed selection');
  filters.country=[];
  assert.equal(E.analyze(data,{filters}).totals.records,120);
  assert.equal(data.records.length,120,'filtering must not mutate the prepared dataset');
});

test('prepared labels preserve first spelling, empty values and fresh data beyond the normalization cache bound',()=>{
  const input=Array.from({length:1300},(_,i)=>({manufacturer:`Supplier ${i}`,country:i%2?'TÜRKİYE':'Türkiye',buyingGroup:i%3?'Kız Çocuk':'—',price:10,quantity:1,modelKey:`model-${i}`}));
  const first=E.prepare(input);
  assert.equal(first.labels.manufacturer.size,1300);
  assert.equal(first.labels.country.size,1);
  assert.equal(first.labels.country.get('TURKIYE'),'Türkiye');
  for(let i=0;i<input.length;i++){
    assert.equal(first.records[i].k.manufacturer,E.keyOf(input[i].manufacturer));
    assert.equal(first.records[i].k.country,E.keyOf(input[i].country));
    assert.equal(first.records[i].k.buyingGroup,E.keyOf(input[i].buyingGroup));
  }
  input[0].country='Çin';
  const second=E.prepare(input);
  assert.equal(second.records[0].k.country,'CIN');
  assert.equal(second.records[0].l.country,'Çin');
  assert.equal(first.records[0].l.country,'Türkiye');
});
