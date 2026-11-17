'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createTableSearch}=require('./helpers/bl-table-search');
const rowGroups=require('../public/table-search-row-groups');
function search(){const host={BLTableSearch:createTableSearch()};rowGroups.install(host);return host.BLTableSearch;}
test('LCW periods parse and match independently of text',()=>{
 const s=search(),p={ex:{w:22,m:4},re:{w:30,m:6},mb:{w:20,m:5}};
 for(const q of ['EX=W22','ex=w22','RE=W22-W30','EX=M4-M6','MB=M5; MINEC','EX=W21, EX=W22'])assert.equal(s.matches('MINEC',s.parseTerms(q),{periods:p}),true,q);
 assert.equal(s.matches('w22',s.parseTerms('EX=W22'),{periods:{}}),false);
 assert.equal(s.matches('MINEC',s.parseTerms('MB=M4'),{periods:p}),false);
 for(const [q,periods] of [['EX=W50-W3',{ex:{w:1}}],['MB=M11-M2',{mb:{m:12}}]])assert.equal(s.matches('',s.parseTerms(q),{periods}),true,q);
 for(const q of ['EX=W60','EX=M13','XX=W5','EX=W','EX = W22','!EX=W22']){
  assert.equal(s.parseTerms(q)[0].mode,'invalid',q);assert.equal(s.matches(q,s.parseTerms(q),{periods:p}),false,q);
 }
 assert.equal(s.matches('MINEC',s.parseTerms('(MB=M5; MINEC), (EX=W2; X)'),{periods:p}),true);
});
test('row groups keep unspaced semicolons and escaped punctuation literal',()=>{
 const s=search();
 assert.equal(s.matches('A 1',s.parseTerms('(A;1)')),false);
 assert.equal(s.matches('A;1',s.parseTerms('(A;1)')),true);
 assert.equal(s.matches('A;X 1',s.parseTerms('(A\\;X; 1)')),true);
 assert.equal(s.matches('BUDDY(YD) X',s.parseTerms('(BUDDY(YD) ; X)')),true);
});

test('canonical row bindings, bilingual dimensions and signature caches follow live values',()=>{
 const {createRows}=require('./helpers/bl-table-search-rows');
 const r=createRows();
 const order={Season:'W7',Country:'Turkey',STATUS:'Üretimde','Del. Type':'Sea','Active/Inactive':'Active',Buyer:'FATİH AVCI','Model Name':'TRİKO'};
 const hay=r.cpSearchHaystack(order);
 for(const q of ['W7','Turkey','Üretimde','In Production','Sea','Active','Aktif','FATIH','TRIKO'])assert.equal(r.search.matches(hay,r.search.parseTerms(q)),true,q);
 const kol={inStoreMonth:'TEMMUZ 2027',durum:'Fiyatlamada'};
 for(const q of ['JULY 2027','TEMMUZ 2027','In Pricing','Fiyatlamada'])assert.equal(r.search.matches(r.kolSearchHaystack(kol),r.search.parseTerms(q)),true,q);
 assert.equal(r.tableSearchPeriods(kol,'collection').mb.m,7);
 for(const value of ['2027-07','202707','07/2027'])assert.equal(r.search.matches(r.kolSearchHaystack({inStoreMonth:value}),r.search.parseTerms('JULY 2027')),true,value);
 assert.equal(r.cpSearchHaystack({'PLM ID':'202707'}).includes('july'),false,'month display aliases belong only to month fields');
 kol.inStoreWeek='2027-53';assert.equal(r.tableSearchPeriods(kol,'collection').mb.w,53);
 assert.equal(r.search.matches(r.cpSearchHaystack({'In-Store':'2027-04-26'}),r.search.parseTerms('26.04.27')),true);
 kol.inStoreMonth='MAYIS 2027';assert.equal(r.tableSearchPeriods(kol,'collection').mb.m,5);
 order.Season='S8';assert.equal(r.cpSearchHaystack(order).includes('w7'),false);
});
test('date criteria use LCW assignments, reject invalid dates and invalidate on calendar replacement',()=>{
 const r=require('./helpers/bl-table-search-rows').createRows();
 const calendar=month=>({weeks:[{year:2027,week:22,month,monthWeek:1,start:'2027-04-26',end:'2027-05-02'}]});
 r.dates.setMerchCalendar(calendar(5));
 const row={'Ex-factory':'2027-04-26','Retail Date':'2027-05-02','In-Store':'2027-04-26'};
 let calls=0;const original=r.dates.describe;r.dates.describe=(...args)=>{calls++;return original(...args);};
 try{
  r.search.matches(r.cpSearchHaystack(row),r.search.parseTerms('DEMO'),r.tableSearchOptions(row,'orders'));
  assert.equal(calls,0,'plain text never requests date periods');
  for(let i=0;i<3;i++)assert.equal(r.search.matches(r.cpSearchHaystack(row),r.search.parseTerms('EX=W22; MB=M5'),r.tableSearchOptions(row,'orders')),true);
  assert.equal(calls,2,'describe runs once per distinct date and calendar, not per query');
  assert.equal(original('2027-04-26').globalWeek,17,'fixture differs from ISO week');
  assert.equal(r.tableSearchPeriods({'Ex-factory':'2027-04-26'},'cp').ex.m,5,'April date belongs to LCW May');
  for(const value of ['',null,'invalid','2027-04-40','2027-07-01'])assert.equal(r.search.matches('',r.search.parseTerms('EX=W22'),r.tableSearchOptions({'Ex-factory':value},'cp')),false,String(value));
  row['Ex-factory']='2027-07-01';assert.equal(r.tableSearchPeriods(row,'orders').ex.w,undefined);
  r.dates.setMerchCalendar(calendar(6));assert.equal(r.tableSearchPeriods(row,'orders').mb.m,6);
  r.dates.clearMerchCalendar();assert.equal(r.tableSearchPeriods(row,'orders').mb.m,undefined);
 }finally{r.dates.describe=original;r.dates.clearMerchCalendar();}
});
test('period OR sorting and feedback evaluate row periods and invalid entries separately',()=>{
 const s=search(),feedback=require('../public/table-search-feedback');
 const rows=[{text:'A',p:{ex:{w:23}}},{text:'B',p:{ex:{w:22}}}];
 const options={periodsOf:r=>r.p};
 assert.deepEqual(s.orderRows(rows,s.parseTerms('EX=W22, EX=W23'),r=>r.text,options),[rows[1],rows[0]]);
 assert.deepEqual(feedback.inspect('EX=W22; Missing; !EX=W22; EX=W60',rows,r=>r.text,s,options),{missing:['Missing'],invalid:['!EX=W22','EX=W60']});
 assert.deepEqual(feedback.findMissing('A; B; C',rows,r=>r.text,s),['C'],'individually existing terms are not missing when the conjunction has no results');
});
