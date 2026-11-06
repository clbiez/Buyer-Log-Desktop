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
    window:{BLCanonicalFields:require('../public/canonical-fields')},
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
  vm.runInNewContext(segment('function cpRowToKolRow(r,allocateId=true){','// ================= "Maliyet Oluştur"')+
    '\nthis.mapOrder=cpRowToKolRow;this.sourceIdentity=cpKolSourceIdentity;',scope);
  return scope;
}
test('CP/Orders Tools contains the shared localized, selection-gated backfill action',()=>{
  assert.match(APP,/const _selectionActionIds=\['cpCopyToKolBtn'/);
  assert.match(APP,/appendSharedTableActions\('ordersToolsMenu',_selectionActionIds/);
  assert.match(APP,/ctk\.disabled = !hasActionSelection \|\| !kolWorkspaceCanEdit \|\| !kolIsOwnWorkspace\(\)/);
  assert.doesNotMatch(UI,/placeCopyToCollection/);
  assert.doesNotMatch(INDEX,/id="cpCopyToKolBtn"[^>]*\bhidden\b/);
  assert.match(INDEX,/data-i18n-en="Build Collection from Orders"/);
  assert.match(APP,/BLMotionPlus\?\.play\('overlay',overlay\.querySelector\('\.modalCard'\)\)/);
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
  // Onaylı üretici Sub MFR, onaylı fiyat Supp. FOB: Koleksiyon royalty/hologram'ı
  // bu fiyata ekler; nihai FOB'u fiyat yazmak masrafları ikinci kez eklerdi.
  assert.equal(row.confirmedManufacturer,'SUB FACTORY');
  assert.equal(row.buyingSampleManufacturer,'SUB FACTORY');
  assert.equal(JSON.stringify(row.pricing),JSON.stringify({'SUB FACTORY':'4.10'}));
  assert.equal(row.fob,'4.75');
  assert.equal(row._sourceOrderDetails.sourceFob,'4.75');
  assert.equal(row._sourceOrderDetails.manufacturer,source.Manufacturer);
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
test('without Sub MFR the Manufacturer is used, and a missing Supp. FOB never falls back to the final FOB',()=>{
  const scope=transferMapper();
  const main=scope.mapOrder({'Order Code':'M1','PLM ID':'1','Model Name':'M','Manufacturer':'MAIN FACTORY','FOB ($)':'5.00','Supp. FOB':'4.20'});
  assert.equal(main.confirmedManufacturer,'MAIN FACTORY');
  assert.equal(JSON.stringify(main.pricing),JSON.stringify({'MAIN FACTORY':'4.20'}));
  const noSupp=scope.mapOrder({'Order Code':'M2','PLM ID':'1','Model Name':'M','Manufacturer':'MAIN FACTORY','Sub-Manufacturer':'SUB','FOB ($)':'5.00'});
  assert.equal(JSON.stringify(noSupp.pricing),'{}');
  assert.equal(noSupp.confirmedManufacturer,'SUB');
  assert.equal(noSupp._sourceOrderDetails.deliveryType,'');
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
async function transferAction(selected,existing=[],options={}){
  const events={},toasts=[];
  const scope={
    appLang:'en',document:{body:{dataset:{activeTab:'orders'}},
      getElementById:()=>({addEventListener:(type,listener)=>{events[type]=listener;}})},
    window:{BLTableToolbarActionCleanup:{begin:()=>{},finish:()=>{}},BLCollectionModelGroups:options.groups?require('../public/collection-model-groups'):undefined},
    kolNormalizeModelGroups:rows=>require('../public/collection-model-groups').normalizeRows(rows).rows,
    kolWorkspaceCanEdit:true,kolWorkspaceOwnerId:'mine',kolWorkspaceRevision:1,
    kolIsOwnWorkspace:()=>options.own!==false,
    kolRequireWorkspaceEdit:()=>options.editable!==false,
    cpKolSelectedSourceRows:()=>selected,
    cpKolBackfillPreview:async()=>{if(options.stale)scope.kolWorkspaceRevision++;return options.accept===false?null:(options.approved?{approved:options.approved}:true);},
    kolRows:existing.slice(),kolNextId:99,kolSelected:new Set(),
    kolUndoStack:[1],kolUndoSummaryStack:[1],kolRedoStack:[3],kolRedoSummaryStack:[3],
    updateKolUndoRedoButtons:()=>{},
    kolPushUndo(){scope.kolUndoStack.push(2);scope.kolUndoSummaryStack.push(2);},
    cpKolSourceIdentity(row,source=false){
      const code=source?row['Order Code']:row._sourceOrderCode;
      if(!code)return '';
      return JSON.stringify([code,source?row['PLM ID']:row.plmId,source?row['C.Code']:row.colourCode]);
    },
    cpRowToKolRow(row){return {id:scope.kolNextId++,_sourceOrderCode:row['Order Code'],plmId:row['PLM ID'],colourCode:row['C.Code']};},
    saveKolRows:()=>options.save!==false,renderKol:()=>{},
    kolApplyRulePricing:()=>false,kolFormatMoneyDisplay:value=>String(value),
    kolEffectivePricing:row=>row.pricing||{},
    kolWriteGroupedStorageValue(row,key,value){row[key]=value;return row;},
    showToast:message=>toasts.push(message),
  };
  const engine=require('../public/collection-order-backfill');
  scope.cpKolBackfillPlan=rows=>engine.plan(rows.map(row=>({key:scope.cpKolSourceIdentity(row,true),row:{...row,id:null,_sourceOrderCode:row['Order Code'],plmId:row['PLM ID'],colourCode:row['C.Code']}})),scope.kolRows,scope.kolRows.map(row=>scope.cpKolSourceIdentity(row)));
  vm.runInNewContext(segment('function cpKolBackfillWriteField(','// ================= DİL SEÇİMİ'),scope);
  await events.click({currentTarget:{}});
  return {scope,toasts};
}
test('copy inserts all models of one order but skips only exact imported duplicates',async()=>{
  const a={'Order Code':'A','PLM ID':'100','C.Code':'RED'};
  const b={'Order Code':'A','PLM ID':'100','C.Code':'BLUE'};
  const c={'Order Code':'A','PLM ID':'200','C.Code':'RED'};
  const {scope,toasts}=await transferAction([a,b,c,a]);
  assert.equal(scope.kolRows.length,3);
  assert.equal(scope.kolSelected.size,3);
  assert.equal(scope.kolNextId,102);
  assert.match(toasts.join(' '),/1 duplicates skipped/);
});
test('copy does not overwrite existing model or create changes in view-only workspaces',async()=>{
  const a={'Order Code':'A','PLM ID':'100','C.Code':'RED'};
  const first=await transferAction([a],[{id:5,_sourceOrderCode:'A',plmId:'100',colourCode:'RED'}]);
  assert.equal(first.scope.kolRows.length,1);
  assert.equal(first.scope.kolRows[0].id,5);
  const denied=await transferAction([a],[],{editable:false});
  assert.equal(denied.scope.kolRows.length,0);
  const remote=await transferAction([a],[],{own:false});
  assert.equal(remote.scope.kolRows.length,0);
});
test('failed local save rolls back new rows, IDs and the complete undo/redo history',async()=>{
  const source={'Order Code':'B','PLM ID':'123','C.Code':'BLACK'};
  const {scope}=await transferAction([source],[],{save:false});
  assert.equal(scope.kolRows.length,0);
  assert.equal(scope.kolNextId,99);
  assert.equal(scope.kolUndoStack.length,1);
  assert.equal(scope.kolRedoStack[0],3);
});
test('cancelled or stale preview does not allocate IDs or write Collection',async()=>{
  for(const options of [{accept:false},{stale:true}]){
    const {scope}=await transferAction([{'Order Code':'A','PLM ID':'100'}],[],options);
    assert.equal(scope.kolRows.length,0);
    assert.equal(scope.kolNextId,99);
    assert.equal(scope.kolUndoStack.length,1);
  }
});
test('source lines at different prices remain distinct even with the same order, model and colour',()=>{
  const scope=transferMapper(),a={'Order Code':'A','PLM ID':'100','C.Code':'RED','FOB ($)':'5.00'};
  assert.notEqual(scope.sourceIdentity(a,true),scope.sourceIdentity({...a,'FOB ($)':'6.00'},true));
  assert.notEqual(scope.sourceIdentity(a,true),scope.sourceIdentity({...a,Country:'China'},true));
  assert.notEqual(scope.sourceIdentity(a,true),scope.sourceIdentity({...a,Manufacturer:'OTHER FACTORY'},true));
});
test('source selection is scoped to visible rows in the active screen and permits read-only source orders',()=>{
  const visible={_id:1,_canEdit:false},hidden={_id:2},order={_id:3};
  const scope={document:{body:{dataset:{activeTab:'cp'}}},state:{cp:{},orders:{},cpSelected:new Set([1,2]),ordersSelected:new Set([3])},filteredCP:()=>[visible],filteredOrders:()=>[order]};
  vm.runInNewContext(segment('function cpKolSelectedSourceRows(){','function cpKolBackfillPlan(')+'\nthis.selected=cpKolSelectedSourceRows;',scope);
  assert.equal(scope.selected().length,1);
  assert.equal(scope.selected()[0],visible);
  scope.document.body.dataset.activeTab='orders';
  assert.equal(scope.selected()[0],order);
  assert.equal(hidden._id,2);
});
test('incremental import updates the matching row in one undo step without allocating a new ID',async()=>{
  const common={'PLM ID':'100','C.Code':'RED',modelKod:'DEMO',inStoreMonth:'202702',quantity:'100',fob:'5',country:'TR',confirmedManufacturer:'DEMO FACTORY',pricing:{'DEMO FACTORY':'5'}};
  const first=await transferAction([{'Order Code':'A',...common}]);
  const second=await transferAction([{'Order Code':'A',...common},{'Order Code':'B',...common,quantity:'250'}],first.scope.kolRows);
  assert.equal(second.scope.kolRows.length,1);
  assert.equal(second.scope.kolRows[0].quantity,'350');
  assert.equal(second.scope.kolRows[0].id,99);
  assert.equal(second.scope.kolNextId,99);
  assert.equal(second.scope.kolUndoStack.length,2);
});
test('existing PLM + colour + MB month record is updated in place; price changes only with approval',async()=>{
  const existing=()=>({id:5,plmId:'100',colourCode:'RED',inStoreMonth:'202702',quantity:'900',mag:'OLD',
    confirmedManufacturer:'OLD FACTORY',pricing:{'OLD FACTORY':'3.90','OTHER QUOTE':'4.20'},trPrice:'180',endeksmatikData:{a:1}});
  const order={'Order Code':'A','PLM ID':'100','C.Code':'RED',inStoreMonth:'202702',quantity:'100',mag:'NEW',
    confirmedManufacturer:'SUB FACTORY',pricing:{'SUB FACTORY':'4.00'}};
  const kept=await transferAction([order],[existing()]);
  assert.equal(kept.scope.kolRows.length,1);
  const row=kept.scope.kolRows[0];
  assert.equal(row.id,5);
  assert.equal(row.quantity,'100');
  assert.equal(row.mag,'NEW');
  assert.equal(row.confirmedManufacturer,'OLD FACTORY');
  assert.equal(JSON.stringify(row.pricing),JSON.stringify({'OLD FACTORY':'3.90','OTHER QUOTE':'4.20'}));
  assert.equal(row.trPrice,'180');
  assert.match(kept.toasts.join(' '),/1 price differences left unchanged/);
  const approved=await transferAction([order],[existing()],{approved:new Set([0])});
  const priced=approved.scope.kolRows[0];
  assert.equal(approved.scope.kolRows.length,1);
  assert.equal(priced.id,5);
  assert.equal(priced.confirmedManufacturer,'SUB FACTORY');
  assert.equal(JSON.stringify(priced.pricing),JSON.stringify({'OLD FACTORY':'3.90','OTHER QUOTE':'4.20','SUB FACTORY':'4.00'}));
  assert.equal(priced._orderPriceChanges.length,1);
  assert.equal(priced._orderPriceChanges[0].from.name,'OLD FACTORY');
  assert.equal(JSON.stringify(priced.endeksmatikData),JSON.stringify({a:1}));
});
test('grouped colour records: colour-specific fields never leak to siblings and variant updates stay visible',async()=>{
  const groups=require('../public/collection-model-groups');
  const base={plmId:'100',modelKod:'DEMO',inStoreMonth:'202702',modelGroupId:'mg_demo',mag:'OLD MAG',pricing:{},variantOverrides:{},modelSharedValues:{}};
  const rows=()=>[{...base,id:1,modelGroupRole:'parent',colourCode:'RED',colour:'Red',quantity:'100'},
    {...base,id:2,modelGroupRole:'variant',colourCode:'BLUE',colour:'Blue',quantity:'200'}];
  const red={'Order Code':'R1','PLM ID':'100','C.Code':'RED',inStoreMonth:'202702',modelKod:'DEMO',colour:'Red',quantity:'150'};
  const first=await transferAction([red],rows(),{groups:true});
  const blue=first.scope.kolRows.find(row=>row.id===2),parent=first.scope.kolRows.find(row=>row.id===1);
  assert.equal(parent.quantity,'150');
  assert.equal(blue.quantity,'200');
  assert.equal(blue.colour,'Blue');
  const blueOrder={'Order Code':'B1','PLM ID':'100','C.Code':'BLUE',inStoreMonth:'202702',modelKod:'DEMO',mag:'NEW MAG',quantity:'300'};
  const second=await transferAction([blueOrder],rows(),{groups:true});
  const variant=second.scope.kolRows.find(row=>row.id===2);
  assert.equal(groups.effectiveValue(variant,'mag',second.scope.kolRows),'NEW MAG');
  assert.equal(groups.effectiveValue(second.scope.kolRows.find(row=>row.id===1),'mag',second.scope.kolRows),'OLD MAG');
  assert.equal(variant.quantity,'300');
});
