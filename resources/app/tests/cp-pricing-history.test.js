'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8'),Business=require('../public/business-rules');
const block=(start,end)=>app.slice(app.indexOf(start),app.indexOf(end,app.indexOf(start)));
function native(name){const start=app.indexOf('function '+name+'('),end=app.indexOf('\n}',start);assert.ok(start>=0&&end>start,name);return app.slice(start,end+2);}
const copy=value=>JSON.parse(JSON.stringify(value));
function harness(options={}){
 const rule={id:'live-rule',royalty:20,hologramCost:0,seasons:['W26']},row={_id:1,'Order Code':'100','Model Name':'DEMO','C.Code':'01',Licensor:'DEMO',License:'LICENSE',Country:'China',Season:'W26','FOB ($)':10,'Supp. FOB':8,'Sub-Manufacturer':'supplier',_suppFobMeta:{source:'rule',ruleId:'live-rule'},_suppFobManual:false,_suppFobOverride:false,_suppFobRule:'live-rule',_licensorManual:false,...options.row};
 const pending=new Map(),writes=[],overrides={notesmap:{},submap:{},licensormap:{},suppfobmap:{},suppfobmetamap:{},...copy(options.overrides||{})};
 const ctx={state:{currentUser:{id:'buyer'},cp:{rows:[row]},orders:{rows:[{...row}]},overrides,cpDirty:new Set()},window:{SERVER_BACKED:true,BLOrderLinePeerIndex:require('../public/order-line-peer-index')},document:{activeElement:null},CP_NOTE_COLUMN_DEFS:[],appLang:'en',norm:value=>String(value??'').trim(),editableValuesEqual:(a,b)=>JSON.stringify(a)===JSON.stringify(b),isAreaFrozen:()=>false,showToast(){},applyFormulas(){},invalidateUnifiedPriorityDecisions(){},updateUndoRedoButtons(){},refreshRowEverywhere(){},refreshRowsEverywhere(){},refreshSubmfrList(){},refreshLicensorList(){},renderOrders(){},syncCpProductionLogisticSegment(){},noteAuthorIdentity:()=>({id:'buyer',name:'Buyer'}),toISODate:value=>value,overrideSyncKey:r=>ctx.lineKeyOfRow(r),lineIdentity:r=>({model:r['Model Name'],ccode:r['C.Code']}),schedulePendingOverrideWrite:(key,ms,run)=>pending.set(key,run),enqueueOverrideMutation:(area,url,request)=>{writes.push(JSON.parse(request.body));return Promise.resolve();},normalizePricingRuleSeasons:value=>Array.isArray(value)?value:[],toNum:value=>Number(value),calculateSuppFobFromRule:()=>({value:Business.calculateSuppFobWithRule(row['FOB ($)'],rule),rule})};
 ctx.markDirty=id=>ctx.syncOverridesFromRow(ctx.state.cp.rows.find(item=>item._id===id));
 vm.createContext(ctx);vm.runInContext(block('function turknorm(','// ================= LICENSE ROYALTY'),ctx);vm.runInContext(block('let undoStack = [];','function discardAllChanges('),ctx);
 for(const name of ['normalizeSuppFobMeta','automaticSuppFobRuleMeta','suppFobMetaForRow','hasManualSuppFob','importedSuppFob','recalcSuppFobForRow','propagateOrderPricingFields','syncOverridesFromRow','syncOverrideToServer','commitCpEditor'])vm.runInContext(native(name),ctx);
 const editor=(kind,value)=>({dataset:{id:'1',key:({suppfob:'Supp. FOB',submfr:'Sub-Manufacturer',licensor:'Licensor'})[kind],kind,lineKey:ctx.lineKeyOfRow(row),editOwner:'buyer'},value});
 return {ctx,row,rule,writes,overrides,edit:(kind,value)=>ctx.commitCpEditor(editor(kind,value),{refresh:false}),flush(){for(const run of pending.values())run();pending.clear();return writes.at(-1);}};
}

test('Undo returns a manual Supp FOB to the current automatic rule and restores peer provenance',()=>{
 const h=harness();assert.equal(h.edit('suppfob','12.00'),true);assert.equal(h.row._suppFobManual,true);h.flush();h.rule.royalty=30;h.ctx.undo();
 assert.equal(h.row._suppFobManual,false);assert.equal(h.row._suppFobOverride,false);assert.equal(h.row._suppFobMeta.source,'rule');assert.equal(h.row['Supp. FOB'],7,'automatic intent recalculates against the current rule');
 assert.equal(Object.hasOwn(h.overrides.suppfobmap,h.ctx.lineKeyOfRow(h.row)),false);assert.equal(h.ctx.state.orders.rows[0]._suppFobManual,false);assert.equal(h.ctx.state.orders.rows[0]['Supp. FOB'],7);
 const saved=h.flush();assert.equal(saved.pricingRestore.suppFob.present,false);assert.equal(Object.hasOwn(saved,'suppFob'),true,'ordinary field retains ownership and revision fencing');
 h.ctx.redo();assert.equal(h.row['Supp. FOB'],12);assert.equal(h.row._suppFobMeta.source,'manual');assert.equal(h.flush().pricingRestore.suppFob.present,true);
});

test('Undo restores an explicitly applied rule record instead of relabelling it as manual',()=>{
 const key='100|DEMO|01',meta={source:'rule',ruleId:'applied-rule',applied:true};const h=harness({row:{_suppFobMeta:meta,_suppFobRule:'applied-rule',_suppFobOverride:true},overrides:{suppfobmap:{[key]:8},suppfobmetamap:{[key]:meta}}});
 h.edit('suppfob','12');h.ctx.undo();assert.equal(h.row._suppFobManual,false);assert.equal(h.row._suppFobOverride,true);assert.equal(h.row._suppFobMeta.applied,true);assert.equal(h.overrides.suppfobmetamap[key].source,'rule');assert.equal(h.overrides.suppfobmetamap[key].applied,true);assert.equal(h.flush().suppFobMeta.applied,true);
});

test('Undo restores imported CP-update metadata and its fallback price without making it manual',()=>{
 const key='100|DEMO|01',meta={source:'manual',origin:'cpupdate'},h=harness({row:{'Supp. FOB':6,_suppFobMeta:meta,_suppFobManual:true,_suppFobRule:null,_suppFobOverride:true,_suppFobImported:{value:6,meta}},overrides:{suppfobmap:{[key]:6},suppfobmetamap:{[key]:meta}}});h.ctx.calculateSuppFobFromRule=()=>({value:null,rule:null});
 h.edit('suppfob','12');h.ctx.undo();assert.equal(h.row['Supp. FOB'],6);assert.equal(h.row._suppFobMeta.origin,'cpupdate');assert.equal(h.ctx.importedSuppFob(h.row).value,6);assert.equal(h.flush().suppFobMeta.origin,'cpupdate');
});

test('licensor Undo restores automatic selection and the original price override presence',()=>{
 const h=harness();h.edit('licensor','OTHER');assert.equal(h.row._licensorManual,true);h.ctx.undo();assert.equal(h.row.Licensor,'DEMO');assert.equal(h.row._licensorManual,false);assert.equal(Object.hasOwn(h.overrides.licensormap,h.ctx.lineKeyOfRow(h.row)),false);assert.equal(h.ctx.state.orders.rows[0]._licensorManual,false);const saved=h.flush();assert.equal(saved.pricingRestore.licensor.present,false);assert.equal(saved.pricingRestore.suppFob,undefined,'derived price change must not introduce a shared-price mutation');
});

test('a new price edit replaces a pending price restore without dropping a pending licensor restore',()=>{
 const h=harness();h.edit('licensor','OTHER');h.ctx.undo();h.edit('suppfob','15');const saved=h.flush();assert.equal(saved.suppFob,15);assert.equal(saved.suppFobMeta.source,'manual');assert.equal(saved.pricingRestore.licensor.present,false);assert.equal(saved.pricingRestore.suppFob,undefined);
});

test('an explicit sub-manufacturer edit remains saved beside a pending licensor restore',()=>{
 const h=harness();h.edit('licensor','OTHER');h.ctx.undo();h.edit('submfr','new supplier');const saved=h.flush();assert.equal(saved.pricingRestore.licensor.present,false);assert.equal(saved.subManufacturer,'new supplier');
});

test('price history cannot mutate a shared price after edit permission is revoked',()=>{
 const h=harness();h.edit('suppfob','12');h.flush();h.row._canEditShared=false;h.ctx.undo();assert.equal(h.row['Supp. FOB'],12);assert.equal(h.row._suppFobManual,true);assert.equal(h.row._pricingHistoryRestore,undefined);
});

test('licensor history keeps its permitted scope when shared pricing is view only',()=>{
 const h=harness({row:{_canEditShared:false}});h.edit('licensor','OTHER');h.flush();h.ctx.undo();assert.equal(h.row.Licensor,'DEMO');const saved=h.flush();assert.equal(saved.pricingRestore.licensor.present,false);assert.equal(Object.hasOwn(saved,'suppFob'),false);
});

test('manual-price licensor Undo sends no shared price when shared capability is revoked',()=>{
 const key='100|DEMO|01',h=harness({row:{'Supp. FOB':6,_suppFobManual:true,_suppFobMeta:{source:'manual'},_suppFobOverride:true},overrides:{suppfobmap:{[key]:6},suppfobmetamap:{[key]:{source:'manual'}}}});h.edit('licensor','OTHER');h.flush();h.row._canEditShared=false;h.ctx.undo();const saved=h.flush();assert.equal(saved.pricingRestore.licensor.present,false);for(const field of ['suppFob','suppFobMeta','subManufacturer'])assert.equal(Object.hasOwn(saved,field),false,field);
});

test('legacy manual fallback stays absent at line scope after Undo and subsequent note saves',async()=>{
 const key='100|DEMO|01',h=harness({row:{'Supp. FOB':6,_suppFobManual:true,_suppFobMeta:{source:'manual'},_suppFobOverride:true,_licensorManual:true},overrides:{suppfobmap:{100:6},suppfobmetamap:{100:{source:'manual'}},licensormap:{100:'DEMO'}}});
 h.edit('suppfob','12');h.flush();h.ctx.undo();assert.equal(Object.hasOwn(h.overrides.suppfobmap,key),false);assert.equal(h.flush().pricingRestore.suppFob.present,false);await Promise.resolve();h.ctx.syncOverridesFromRow(h.row);assert.equal(Object.hasOwn(h.overrides.suppfobmap,key),false);assert.equal(Object.hasOwn(h.flush(),'suppFob'),false);
 h.edit('licensor','OTHER');h.flush();h.ctx.undo();assert.equal(Object.hasOwn(h.overrides.licensormap,key),false);assert.equal(h.flush().pricingRestore.licensor.present,false);await Promise.resolve();h.ctx.syncOverridesFromRow(h.row);assert.equal(Object.hasOwn(h.flush(),'licensor'),false);
});

test('the real mutation queue retains a failed restore for retry and only consumes its own successful ACK',async()=>{
 const h=harness(),attempts=[];h.ctx.state.storeRevisions={orders:0,suppFob:0};h.ctx.fetchJSON=async(url,opts)=>{const body=JSON.parse(opts.body);attempts.push(body);if(attempts.length===1)throw Object.assign(new Error('transient outage'),{code:'TEMPORARY_FAILURE'});return {revision:attempts.length,revisions:{suppFob:attempts.length}};};vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/override-sync.js'),'utf8'),h.ctx);
 h.edit('suppfob','12');h.ctx.undo();h.flush();await h.ctx.overrideMutationsSettled();await Promise.resolve();assert.ok(h.row._pricingHistoryRestore,'failed restore must remain retryable');h.ctx.syncOverridesFromRow(h.row);h.flush();await h.ctx.overrideMutationsSettled();await Promise.resolve();assert.equal(attempts[1].pricingRestore.suppFob.present,false);assert.equal(h.row._pricingHistoryRestore,undefined);
 let release;h.ctx.fetchJSON=async()=>{await new Promise(resolve=>{release=resolve;});return {revision:3};};h.edit('suppfob','14');h.ctx.undo();h.flush();await Promise.resolve();const first=h.row._pricingHistoryRestore;h.ctx.redo();const second=h.row._pricingHistoryRestore;assert.notEqual(first,second);release();await h.ctx.overrideMutationsSettled();await Promise.resolve();assert.equal(h.row._pricingHistoryRestore,second,'late old ACK must retain the new intent');
});
