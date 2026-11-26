'use strict';
// Fiyat Masası v2026-11-26: onaylı fiyat her zaman okunur; Hedef / En iyi-Onaylı / Δ
// sütunlarının yerini Koleksiyon'un Target · Teklif & Onay · Previous Season/LFL/Sezon
// Etkisi sütunları alır; sütunlar sıralanır ve genişlikleri ayarlanır; MB Ay "JULY 27",
// adet "15.165" yazılır.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const E=require('../public/pricing-desk-engine');
const read=name=>fs.readFileSync(path.join(__dirname,'../public',name),'utf8');
const deskSource=read('pricing-desk.js'),quotesSource=read('quotations.js');

function desk(lang='en'){
  const store=new Map();
  const window={BLPricingDeskEngine:E,BL_QUOTATIONS:{desk:{canEdit:()=>true,findRow:()=>null,itemCategory:()=>'Demo Knit',itemTarget:()=>'1,50',itemFabric:()=>'',ownerLabel:()=>'',imageSrc:()=>'',thumb:()=>'',selectedColumns:()=>[],columnLabel:key=>key,fieldValue:()=>''}}};
  const ctx={window,document:{addEventListener(){},getElementById:()=>null},BLStorage:{getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value)},appLang:lang};
  vm.createContext(ctx);vm.runInContext(deskSource,ctx);
  return {api:window.BLPricingDesk._test,store};
}
function request(){
  return {id:'demo',source:'collection',manufacturers:[{name:'Demo Mill A'},{name:'Demo Mill B'},{name:'Demo Mill C'}],items:[
    {id:'a1',modelKey:'m1',modelCode:'MODEL-B',manufacturer:'Demo Mill A',price:'1,62',approved:true},
    {id:'b1',modelKey:'m1',modelCode:'MODEL-B',manufacturer:'Demo Mill B',price:'1,40'},
    {id:'c1',modelKey:'m1',modelCode:'MODEL-B',manufacturer:'Demo Mill C',price:''},
    {id:'a2',modelKey:'m2',modelCode:'MODEL-A',manufacturer:'Demo Mill A',price:'2,10'},
    {id:'b2',modelKey:'m2',modelCode:'MODEL-A',manufacturer:'Demo Mill B',price:''},
    {id:'a3',modelKey:'m3',modelCode:'MODEL-C',manufacturer:'Demo Mill A',price:''},
  ]};
}

test('Quotes & Approval separates an approved price from an unapproved best offer',()=>{
  const {api}=desk(),matrix=E.requestMatrix(request()),info={row:null,target:1.5,model:'MODEL-B'};
  const approvedModel=matrix.models.find(m=>m.modelKey==='m1'),approved=api.quotesModel(approvedModel,info,E.rowStats(approvedModel.lines));
  assert.equal(approved.main.manufacturer,'Demo Mill A','approval wins over the cheaper best offer');
  assert.equal(approved.offers.length,2);assert.equal(approved.waiting,1);
  assert.ok(Math.abs(approved.delta-8)<1e-9);
  const html=api.quotesCellHtml(approvedModel,info,E.rowStats(approvedModel.lines));
  assert.match(html,/class="pdQuotesCol kolPriceStripTd isConfirmed"/);
  assert.match(html,/<span class="blCellMfr isConfirmed"><em>✓ Approved<\/em><b>Demo Mill A<\/b><\/span>/);
  assert.match(html,/<b class="blCellValue isStrong">\$1,62<\/b><span class="blCellTag" data-tone="bad">\+8%<\/span>/,'Collection money format and target delta tone');
  assert.match(html,/data-tone="4">1 waiting</);assert.match(html,/<span class="blCellTotal"[^>]*>2<\/span>/);
  assert.doesNotMatch(html,/data-pd-drawer/,'without a loaded Collection row the price drawer is not offered');
  const bestModel=matrix.models.find(m=>m.modelKey==='m2'),best=api.quotesCellHtml(bestModel,{...info,target:null},E.rowStats(bestModel.lines));
  assert.match(best,/<span class="blCellMfr"><em>Best<\/em><b>Demo Mill A<\/b>/);assert.doesNotMatch(best,/isConfirmed/);
  assert.match(best,/<b class="blCellValue isSoft">\$2,10<\/b><span><\/span>/,'no target means no delta tag');
  const empty=matrix.models.find(m=>m.modelKey==='m3');
  assert.match(api.quotesCellHtml(empty,info,E.rowStats(empty.lines)),/No quotation/);
  assert.match(desk('tr').api.quotesCellHtml(approvedModel,info,E.rowStats(approvedModel.lines)),/✓ Onaylı.*1 bekliyor/s);
});

test('sorting reorders models by any column, keeps empty values last and toggles off',()=>{
  const {api,store}=desk(),req=request(),models=E.requestMatrix(req).models,valid=new Set(['model','mfr:Demo Mill B','quotes']);
  const order=list=>Array.from(list,m=>m.modelKey).join(',');
  api.cycleSort('model');assert.equal(order(api.sortModels(req,models,valid)),'m2,m1,m3');
  api.cycleSort('model');assert.equal(order(api.sortModels(req,models,valid)),'m3,m1,m2');
  api.cycleSort('model');assert.equal(api.matrixLayout.sort,null);assert.equal(order(api.sortModels(req,models,valid)),'m1,m2,m3');
  api.cycleSort('mfr:Demo Mill B');assert.equal(order(api.sortModels(req,models,valid)),'m1,m2,m3','only m1 has a Mill B price; empty prices stay last');
  api.cycleSort('quotes');assert.equal(order(api.sortModels(req,models,valid)),'m1,m2,m3');
  api.cycleSort('quotes');assert.equal(order(api.sortModels(req,models,valid)),'m2,m1,m3','descending still keeps the unquoted model last');
  assert.equal(order(api.sortModels(req,models,new Set(['model']))),'m1,m2,m3','a sort on a hidden column is ignored');
  assert.match(String(store.get('lcw.pricingDesk.matrixLayout.v1')),/"key":"quotes","dir":-1/);
});

test('column widths clamp, persist per user and only Models is frozen',()=>{
  const {api}=desk(),context={summary:['quantity','inStoreMonth'],extra:['season']},layout={visible:[{name:'Demo Mill A'}],other:[]};
  const keys=Array.from(api.matrixColumnKeys(context,layout,true));
  assert.deepEqual(keys,['model','summary','target','quotes','refs','ctx:season','mfr:Demo Mill A','add']);
  api.matrixLayout.widths.model=20;api.matrixLayout.widths.quotes=260;
  assert.equal(api.colWidth('model'),120,'minimum width protects the column');
  const g=api.matrixGeometry(keys);
  assert.deepEqual(JSON.parse(JSON.stringify(g.lefts)),{model:0},'only the Models column is frozen');
  assert.equal(g.total,120+104+88+260+124+150+104+124);
});

test('clipboard header follows the new column set',()=>{
  const {api}=desk(),req=request(),layout=E.supplierLayout(E.supplierScorecards(req),true),matrix={...E.requestMatrix(req),manufacturers:layout.visible.map(s=>s.name)};
  const text=api.matrixClipboardText(req,{matrix,layout,canEdit:false});
  assert.match(text,/^Model\tTarget Price\tQuotes & Approval\tPrevious Season \/ LFL \/ Season Impact\t/);
  assert.doesNotMatch(text,/Best \/ Approved|Δ Target/);
  assert.match(text,/\$1,62 · \+8% · ✓ Approved Demo Mill A · 1 waiting\t/);
});

test('approved prices stay visible without hover and the legend has a real swatch',()=>{
  const css=read('pricing-desk.css'),ui=read('ui-components.css');
  assert.match(css,/\.pdCell \.pdApprove\.isOn,\.pdCell \.pdApprove\.isOn:disabled\{opacity:1;pointer-events:auto\}/);
  assert.match(ui,/\.pdMatrix tbody td\.pdCell\.isApproved \{background:color-mix\(in srgb,var\(--ui-success\) 18%,var\(--ui-surface\)\) !important/);
  assert.match(ui,/\.pdLegendAppr \{background:var\(--ui-success\) !important/);
  assert.match(deskSource,/isAppr\?`<span class="pdApprovedMark" aria-hidden="true">\$\{esc\(L\('ONAYLI','APPROVED'\)\)\}<\/span>`/);
  assert.match(css,/\.pdMatrix thead th\{[^}]*white-space:normal;overflow-wrap:anywhere/,'header labels wrap instead of being cut');
});

test('hidden columns leave the matrix, clipboard and sort keys aligned; manufacturers hide per request',()=>{
  const {api,store}=desk(),req=request(),context={summary:[],extra:[]};
  api.setColumnHidden(req,'refs',true);api.setColumnHidden(req,'target',true);api.setColumnHidden(req,'mfr:Demo Mill B',true);api.setColumnHidden(req,'model',true);
  assert.equal(api.hiddenColumnCount(req),3,'model column cannot be hidden');
  assert.equal(api.hiddenColumnCount({id:'other-request'}),2,'manufacturer choice belongs to its request');
  const layout={visible:[{name:'Demo Mill A'}],other:[]};
  assert.deepEqual(Array.from(api.matrixColumnKeys(context,layout,false)),['model','quotes','mfr:Demo Mill A']);
  assert.deepEqual(Array.from(api.sortKeysFor(context,layout)),['model','quotes','mfr:Demo Mill A']);
  const matrix={...E.requestMatrix(req),manufacturers:['Demo Mill A','Demo Mill C']};
  const text=api.matrixClipboardText(req,{matrix,layout:{other:[]},canEdit:false});
  assert.match(text,/^Model\tQuotes & Approval\tDemo Mill A/);assert.doesNotMatch(text,/Target Price|Previous Season/);
  assert.equal((text.split('\n').find(line=>/Approved Demo Mill A/.test(line))||'').split('\t').length,2,'row keeps one quotes part');
  api.cycleSort('quotes');api.setColumnHidden(req,'quotes',true);assert.equal(api.matrixLayout.sort,null,'hiding the sorted column clears the sort');
  assert.match(String(store.get('lcw.pricingDesk.matrixLayout.v1')),/"hiddenSuppliers":\{"demo":\["Demo Mill B"\]\}/);
  api.showAllColumns(req);assert.equal(api.hiddenColumnCount(req),0);
});

test('Unapproved only keeps open models, survives a server acknowledgement and is saved for the user',()=>{
  const {api,store}=desk(),req=request(),models=E.requestMatrix(req).models;
  assert.equal(api.filterUnapproved(models).length,3,'off by default');
  api.matrixLayout.unapprovedOnly=true;
  const open=api.filterUnapproved(models);assert.deepEqual(Array.from(open,m=>m.modelKey),['m2','m3']);
  const view={req,items:req.items,matrix:{...E.requestMatrix(req),models:open,manufacturers:['Demo Mill A','Demo Mill B']}};
  req.items=req.items.map(line=>({...line}));
  assert.deepEqual(Array.from(api.matrixCurrent(view).models,m=>m.modelKey),['m2','m3'],'acknowledged items do not bring the approved model back');
  api.setColumnHidden(req,'refs',false);assert.match(String(store.get('lcw.pricingDesk.matrixLayout.v1')),/"unapprovedOnly":true/);
  assert.doesNotMatch(deskSource,/bulkApproveCandidates|data-pd-bulk/,'bulk approval is removed from the desk');
  assert.equal(E.bulkApproveCandidates,undefined);
});

test('compact references and value-only Quantity / MB Month cells',()=>{
  assert.match(deskSource,/<span class="pdRefRow" title="\$\{esc\(tip\)\}"><span class="blCellStackLabel">\$\{esc\(refShort\(key\)\)\}<\/span>/);
  assert.match(deskSource,/context\.summary\.map\(key=>`<b>\$\{esc\(api\.fieldValue\(req,model\.first,key\)\|\|'—'\)\}<\/b>`\)/,'labels live only in the header');
  assert.doesNotMatch(deskSource,/pdQuotesScroll|--pd-l-quotes/);
  assert.doesNotMatch(read('pricing-desk.css'),/\.pdMatrix \.(?:pdTarget|pdQuotesCol|pdSummary)\{position:sticky/);
});

function quotes(lang){
  const ctx={window:{BLCollectionColumns:{catalog:()=>[],label:key=>key}},BLStorage:{getItem:()=>null,setItem(){}},qCurrentUserId:()=>'demo',qNorm:v=>String(v??'').trim(),qLang:(tr,en)=>lang==='en'?en:tr,qCollectionRead:null,appLang:lang,qFindCollectionRow:item=>item.row,qFindCpRow:()=>null,qCollectionEffectiveValue:(row,key)=>row?.[key],qItemFabric:()=>'',kolFabricDisplay:raw=>raw};
  vm.createContext(ctx);
  const start=quotesSource.indexOf('  const DESK_DEFAULT_COLUMNS='),end=quotesSource.indexOf('  function qItemCategory',start);
  vm.runInContext(quotesSource.slice(start,end),ctx);return ctx;
}
test('MB month reads JULY 27 / TEMMUZ 27 and quantity uses the dot separator in both languages',()=>{
  for(const [lang,july,june] of [['en','JULY 27','JUNE 26'],['tr','TEMMUZ 27','HAZİRAN 26']]){
    const q=quotes(lang),req={source:'collection'};
    assert.equal(q.qDeskFieldValue(req,{row:{inStoreMonth:'202707'}},'inStoreMonth'),july);
    assert.equal(q.qDeskFieldValue(req,{row:{inStoreMonth:'JUNE 2026'}},'inStoreMonth'),june);
    assert.equal(q.qDeskFieldValue(req,{row:{inStoreMonth:'HAZİRAN 2026'}},'inStoreMonth'),june);
    assert.equal(q.qDeskFieldValue(req,{row:{inStoreMonth:'later'}},'inStoreMonth'),'later','unknown text stays as entered');
    assert.equal(q.qDeskFieldValue(req,{row:{quantity:'15165'}},'quantity'),'15.165');
    assert.equal(q.qDeskFieldValue(req,{row:{quantity:202707}},'quantity'),'202.707');
    assert.equal(q.qDeskMonthCode('202707'),'202707');
  }
});
