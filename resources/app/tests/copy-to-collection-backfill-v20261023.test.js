'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ROOT=path.join(__dirname,'..');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
const INDEX=fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8');
const UI=fs.readFileSync(path.join(ROOT,'public','table-toolbar-action-cleanup.js'),'utf8');
function segment(start,end){
  const a=APP.indexOf(start),b=APP.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,'Missing production segment '+start);
  return APP.slice(a,b);
}
function transferMapper(){
  const scope={
    kolNextId:1,
    norm:value=>String(value??'').trim(),
    toISODate:value=>typeof value==='string'&&/^\d{4}-\d\d-\d\d$/.test(value)?value:'',
    kolParseMoneyNum:value=>Number(String(value).replace(',','.'))||NaN,
    normalizeTransitDelType:value=>value,
    kolStatusDefaultName:()=> 'Pending',
    kolScheduleFromWeekMonday:value=>value==='2027-07-08'
      ?{inStoreWeek:'2027-28',inStoreMonth:'202707',inStore:'2027-07-05'}:null,
    migrateKolRow:row=>row,
  };
  vm.runInNewContext(segment('function cpRowToKolRow(r){','// ================= "Maliyet Oluştur"')+
    '\nthis.mapOrder=cpRowToKolRow;this.sourceIdentity=cpKolSourceIdentity;',scope);
  return scope;
}
test('CP/Orders Copy opens below the copy-chevron with localized, selection-gated action',()=>{
  assert.match(APP,/items\.push\(\{label:appLang==='en'\?'Copy to Collection':'Koleksiyona Kopyala'/);
  assert.match(APP,/if\(\['cp','orders'\]\.includes\(document\.body\.dataset\.activeTab\)\)/);
  assert.match(APP,/disabled:!transfer\|\|transfer\.disabled,run:\(\)=>transfer\?\.click\(\)/);
  assert.match(APP,/ctk\.disabled = !hasActionSelection \|\| !kolWorkspaceCanEdit \|\| !kolIsOwnWorkspace\(\)/);
  assert.doesNotMatch(UI,/placeCopyToCollection/);
  assert.match(INDEX,/id="cpCopyToKolBtn"[^>]*hidden/);
});
test('complete supplier, prices, dates and historic LCW MB week/month mapping',()=>{
  const scope=transferMapper();
  const source={
    'Order Code':'SAMPLE-150','PLM ID':'1234567','Model Name':'TEST POLO',
    'C.Code':'BLK','Colour':'Black','Ürün Tanım':'T-shirt','Season':'SUMMER',
    'Manufacturer':'SAHİNLER TEKSTİL TİCARET A.Ş.','Sub-Manufacturer':'SUB FACTORY',
    'FOB ($)':'4.75','Supp. FOB':'4.10','Order Quantity':1200,
    'Ex-factory':'2027-05-12','Retail Date':'2027-06-10',
    'In-Store (Model Budget)':'2027-07-08',
    'Notes':'Original comment','Ek Not':'Follow up','Kumaş Tipi':'Jersey',
    'Shipment Quantity':250,'Remaining Units':950,
  };
  const row=scope.mapOrder(source);
  assert.equal(row.confirmedManufacturer,source.Manufacturer);
  assert.equal(row.pricing[source.Manufacturer],'4.75');
  assert.equal(row.fob,'4.75');
  assert.equal(row.targetPrice,'4.10');
  assert.equal(row.exFactory,'2027-05-12');
  assert.equal(row.retail,'2027-06-10');
  assert.equal(row.inStore,'2027-07-08');
  assert.equal(row.inStoreWeek,'2027-28');
  assert.equal(row.inStoreMonth,'202707'); // language-neutral, not "Temmuz"/"July"
  assert.equal(row.productMainDefinition,'T-shirt');
  assert.equal(row.fabric,'Jersey');
  assert.equal(row.quantity,'1200');
  assert.equal(row._sourceOrderDetails.shipmentQuantity,250);
  assert.equal(row._sourceOrderDetails.remainingUnits,950);
  assert.match(row.not,/Original comment/);
  assert.equal(source['In-Store (Model Budget)'],'2027-07-08'); // source remains untouched
  assert.equal(scope.sourceIdentity(source,true),scope.sourceIdentity(row));
});
test('historical entries with unknown LCW calendar do not invent MB period',()=>{
  const scope=transferMapper();
  const row=scope.mapOrder({'Order Code':'OLD','Model Name':'SAMPLE','In-Store (Model Budget)':'2020-02-10'});
  assert.equal(row.inStore,'2020-02-10');
  assert.equal(row.inStoreWeek,'');
  assert.equal(row.inStoreMonth,'');
  assert.equal(row.confirmedManufacturer,'');
});
test('source identity distinguishes colors and models sharing one order code',()=>{
  const scope=transferMapper();
  const first={'Order Code':'ORDER-1','PLM ID':'111','C.Code':'RED'};
  const color={'Order Code':'ORDER-1','PLM ID':'111','C.Code':'BLUE'};
  const model={'Order Code':'ORDER-1','PLM ID':'222','C.Code':'RED'};
  assert.notEqual(scope.sourceIdentity(first,true),scope.sourceIdentity(color,true));
  assert.notEqual(scope.sourceIdentity(first,true),scope.sourceIdentity(model,true));
  assert.equal(scope.sourceIdentity(first,true),scope.sourceIdentity({...first},true));
  assert.equal(scope.sourceIdentity({'PLM ID':'111'},true),'');
});
function transferAction(selected,existing=[],options={}){
  const events={},toasts=[];
  const scope={
    appLang:'en',document:{body:{dataset:{activeTab:'orders'}},
      getElementById:()=>({addEventListener:(type,listener)=>{events[type]=listener;}})},
    window:{BLTableToolbarActionCleanup:{begin:()=>{},finish:()=>{}}},
    kolWorkspaceCanEdit:true,
    kolIsOwnWorkspace:()=>options.own!==false,
    kolRequireWorkspaceEdit:()=>options.editable!==false,
    selectedCpRowsForAction:()=>selected,
    kolRows:existing.slice(),kolNextId:99,kolSelected:new Set(),
    kolUndoStack:[1],kolUndoSummaryStack:[1],
    kolPushUndo(){scope.kolUndoStack.push(2);scope.kolUndoSummaryStack.push(2);},
    cpKolSourceIdentity(row,source=false){
      const code=source?row['Order Code']:row._sourceOrderCode;
      if(!code)return '';
      return JSON.stringify([code,source?row['PLM ID']:row.plmId,source?row['C.Code']:row.colourCode]);
    },
    cpRowToKolRow(row){return {id:scope.kolNextId++,_sourceOrderCode:row['Order Code'],plmId:row['PLM ID'],colourCode:row['C.Code']};},
    saveKolRows:()=>options.save!==false,renderKol:()=>{},
    showToast:message=>toasts.push(message),
  };
  vm.runInNewContext(segment('// CP / Orders: copy selected visible source orders','// ================= DİL SEÇİMİ'),scope);
  events.click({currentTarget:{}});
  return {scope,toasts};
}
test('copy inserts all models of one order but skips only exact imported duplicates',()=>{
  const a={'Order Code':'A','PLM ID':'100','C.Code':'RED'};
  const b={'Order Code':'A','PLM ID':'100','C.Code':'BLUE'};
  const c={'Order Code':'A','PLM ID':'200','C.Code':'RED'};
  const {scope,toasts}=transferAction([a,b,c,a]);
  assert.equal(scope.kolRows.length,3);
  assert.equal(scope.kolSelected.size,3);
  assert.equal(scope.kolNextId,102);
  assert.match(toasts.join(' '),/1 existing skipped/);
});
test('copy does not overwrite existing model or create changes in view-only workspaces',()=>{
  const a={'Order Code':'A','PLM ID':'100','C.Code':'RED'};
  const first=transferAction([a],[{id:5,_sourceOrderCode:'A',plmId:'100',colourCode:'RED'}]);
  assert.equal(first.scope.kolRows.length,1);
  assert.equal(first.scope.kolRows[0].id,5);
  const denied=transferAction([a],[],{editable:false});
  assert.equal(denied.scope.kolRows.length,0);
  const remote=transferAction([a],[],{own:false});
  assert.equal(remote.scope.kolRows.length,0);
});
test('failed local save rolls back new rows and next ID',()=>{
  const source={'Order Code':'B','PLM ID':'123','C.Code':'BLACK'};
  const {scope}=transferAction([source],[],{save:false});
  assert.equal(scope.kolRows.length,0);
  assert.equal(scope.kolNextId,99);
  assert.equal(scope.kolUndoStack.length,1);
});
