'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const parse=require('../server/lib/parse'),BR=require('../public/business-rules'),Revision=require('../public/revision-display');
const CP=require('../public/cp-readiness-engine');
const app=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
const server=fs.readFileSync(path.join(__dirname,'../server/server.js'),'utf8');
const day=value=>{const date=parse.parseDateOnly(value);return date?`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`:null;};
const order=(extra={})=>({ocode:1001,model:'DEMO',ccode:'BLUE',colour:'BLUE',qty:100,kalan:100,fob:1,season:'S6',countryRaw:'CIN',opd:'2026-10-01',ex:'2026-10-30',shipConf:'2026-11-05',retail:'2026-12-14',mb:'2026-12-28',...extra});
function fn(source,name){const match=source.match(new RegExp('function '+name+'\\([\\s\\S]*?\\n\\}'));assert.ok(match,name);return match[0];}
function context(names,extra={}){
 const ctx={BLBusinessRules:BR,BLRevision:Revision,dateOrdinal:parse.dateOrdinal,coerceDateLoose:parse.parseDateOnly,...extra};vm.createContext(ctx);
 for(const name of names)vm.runInContext(fn(app,name),ctx);
 return ctx;
}

test('late approval revises effective date without changing ASAS, manual maps or source rows',()=>{
 const source=order(),ov={datemap:{}};const snapshot=JSON.stringify({source,ov});
 const [effective]=parse.applyDateOverrides([source],ov);
 assert.equal(day(effective.ex),'2026-11-05');assert.equal(day(effective._asasEx),'2026-10-30');
 assert.equal(effective._exFactoryRevision.source,'loading-approval');assert.equal(day(effective._exFactoryRevision.previousDate),'2026-10-30');
 assert.equal(JSON.stringify({source,ov}),snapshot);
 assert.deepEqual(parse.applyDateOverrides([effective],ov),[effective],'repeated application is stable');
});
test('missing, invalid, equal or earlier approvals do not revise dates; no clock based postponement',()=>{
 for(const approval of [null,'','invalid','2026-10-29','2026-10-30']){
  const source=order({shipConf:approval});assert.equal(parse.applyDateOverrides([source],{})[0],source);
 }
 assert.equal(parse.applyDateOverrides([order({ex:null})],{})[0].ex,null);
});
test('manual planning remains distinct, later manual dates win; refreshed approvals are recomputed',()=>{
 const ov={datemap:{'1001|DEMO|BLUE':{ex:'2026-11-03',retail:'2026-12-20'}}};
 const [effective]=parse.applyDateOverrides([order()],ov);
 assert.equal(day(effective.ex),'2026-11-05');assert.equal(day(effective.retail),'2026-12-20');
 assert.equal(day(effective._exFactoryRevision.previousDate),'2026-11-03');
 const [later]=parse.applyDateOverrides([order()],{datemap:{1001:{ex:'2026-11-10'}}});
 assert.equal(day(later.ex),'2026-11-10');assert.ok(!later._exFactoryRevision);
 const [refreshed]=parse.applyDateOverrides([{...effective,shipConf:'2026-11-08'}],ov);
 assert.equal(day(refreshed.ex),'2026-11-08');assert.equal(day(refreshed._asasEx),'2026-10-30');
 const [removed]=parse.applyDateOverrides([{...effective,shipConf:null}],ov);
 assert.equal(day(removed.ex),'2026-11-03');assert.ok(!removed._exFactoryRevision);
});
test('CP, Orders, formulas, readiness rules, production ETA and Backlog consume the same date',()=>{
 const ov={transitRules:[{id:'november',delType:'Gemi',exfStart:'2026-11-01',exfEnd:'2026-11-30',days:20}]};
 const rows=parse.applyDateOverrides([order()],ov);
 for(const build of [parse.buildCPRowsFromASAS,parse.buildOrdersRowsFromASAS]){
  const [row]=build(rows,{},ov);assert.equal(day(row['Ex-factory']),'2026-11-05');
  assert.equal(row['Ex→Retail'],39);assert.equal(row.LT,35);assert.equal(row._exFactoryRevision.source,'loading-approval');
  const decision=CP.analyzeOrder(row,{today:parse.dateOrdinal('2026-11-01'),dateOrdinal:parse.dateOrdinal,transitRules:ov.transitRules});
  assert.equal(decision.plannedLoadDate,parse.dateOrdinal('2026-11-05'));assert.equal(decision.daysToLoad,4);
  assert.equal(day(row._logisticSegments[0].arrival),'2026-11-25');
 }
 const report=parse.buildBacklogTemplateRows(rows,{},ov,{});
 assert.equal(day(report[0]['REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)']),'2026-11-05');
 assert.equal(day(report[0]['Orijinal Exfactory Merch Tarih']),'2026-10-30');
 assert.equal(report[0]._backlogExcel.transitDays,20);
});
test('automatic revisions do not become manual date payloads and keep ASAS comparison',()=>{
 const [effective]=parse.applyDateOverrides([order()],{}),[row]=parse.buildCPRowsFromASAS([effective],{},{});
 assert.equal(Revision.isAutomaticExFactory(row),true);assert.deepEqual(Revision.revisedDateKeys(row),[]);
 assert.equal(day(Revision.baselineDate(row,'Ex-factory')),'2026-10-30');
});
test('client resolves the same date and renders a separate translated automatic marker',()=>{
 const ctx=context(['applyCpApprovalDate','revisionHtml'],{appLang:'tr',escapeHtml:String,revisionText:(key,value)=>String(value),L:String});
 const row={'Ex-factory':'2026-10-30','Buying Son Onay Tarihi':'2026-11-05'};
 ctx.applyCpApprovalDate(row);assert.equal(day(row['Ex-factory']),'2026-11-05');assert.equal(Revision.isAutomaticExFactory(row),true);
 const rev={from:'2026-10-30',to:'2026-11-05',source:'loading-approval'};
 const rendered=ctx.revisionHtml('Ex-factory',rev);
 assert.match(rendered,/ASAS Ex-Factory/);assert.match(rendered,/2026-10-30/);assert.match(rendered,/Yükleme onayı/);assert.match(rendered,/2026-11-05/);assert.doesNotMatch(rendered,/class="revPair"/);
 assert.doesNotMatch(rendered,/🔒|<small>/);
 assert.equal(rendered.replace(/<[^>]*>/g,''),'2026-10-30·2026-11-05','only the two dates and a dot are visible');
 assert.equal(ctx.revisionHtml('LT',{from:29,to:35,source:'loading-approval'}).replace(/<[^>]*>/g,''),'35','derived values have no automatic-mode labels');
 ctx.appLang='en';assert.match(ctx.revisionHtml('Ex-factory',rev),/Loading approval/);
 assert.match(ctx.revisionHtml('Ex-factory',{...rev,source:'manual'}),/class="revPair"/);
});
test('server rejects individual, order-wide and batch manual edits of automatic dates before any writes',()=>{
 const [effective]=parse.applyDateOverrides([order()],{});
 const ctx={cacheForUser:()=>({asasOrders:[effective]}),sourceUserId:()=> 'demo',effectiveOverridesForUser:()=>({}),applyDateOverrides:parse.applyDateOverrides,parseLib:parse};
 vm.createContext(ctx);vm.runInContext(fn(server,'assertAutomaticDatesReadOnly'),ctx);
 for(const patch of [{dates:{exFactory:'2026-12-01'}},{model:'DEMO',ccode:'BLUE',dates:{exFactory:null}},{model:'demo',ccode:'blue',dates:{exFactory:'2026-12-01'}},{model:'OTHER',dates:{exFactory:'2026-12-01'}},{modelName:'OTHER',ccode:'RED',dates:{exFactory:'2026-12-01'}}]){
  assert.throws(()=>ctx.assertAutomaticDatesReadOnly({},[{orderCode:1001,patch}]),error=>error.code==='AUTOMATIC_DATE_READ_ONLY');
 }
 assert.doesNotThrow(()=>ctx.assertAutomaticDatesReadOnly({},[{orderCode:1001,patch:{dates:{retailDate:'2027-01-01'}}}]));
 assert.doesNotThrow(()=>ctx.assertAutomaticDatesReadOnly({},[{orderCode:1001,patch:{model:'DEMO',ccode:'RED',dates:{exFactory:'2027-01-01'}}}]));
});
