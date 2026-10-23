'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
const between=(start,end)=>app.slice(app.indexOf(start),app.indexOf(end,app.indexOf(start)));

function contentApi(item){
  const ctx={mailTopicFindItem:()=>item,mailTplSave(){}};
  vm.createContext(ctx);
  vm.runInContext(between('function mailTopicDefaultContentOptions(', 'function mailTopicDefaultSubjectColumnKeys('),ctx);
  return ctx;
}

test('legacy pricing retains its workbook and replaces its mandatory preview with a body table, preserving TPs',()=>{
  const item={contentOptions:{cp:{excel:false,table:false,tps:false}}};
  const ctx=contentApi(item);
  const read=source=>JSON.parse(JSON.stringify(ctx.mailTopicContentOptions('pricing','pricing-default',source)));
  assert.deepEqual(read('cp'),{excel:true,table:true,tps:false});
  assert.deepEqual(read('collection'),{excel:true,table:true,tps:true});
  assert.deepEqual(item.contentOptions.cp,{excel:false,table:false,tps:false},'reading must not overwrite saved legacy settings');
  ctx.mailTopicSetContentOptions('pricing','pricing-default','cp',{excel:false,table:false,tps:false});
  assert.deepEqual(read('cp'),{excel:false,table:false,tps:false},'newly saved opt-outs must survive reopening');
  assert.deepEqual(read('collection'),{excel:true,table:true,tps:true},'CP changes must not affect Collection');
});

test('general topics keep their explicit Excel, table and TP choices',()=>{
  const ctx=contentApi({contentOptions:{cp:{excel:false,table:true,tps:true}}});
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.mailTopicContentOptions('general','custom','cp'))),{excel:false,table:true,tps:true});
});

test('empty legacy optional columns fall back to pricing defaults, while new empty choices and saved orders survive',()=>{
  const item={tableColumns:{collection:[]},contentOptions:{collection:{excel:false,table:false}}};
  const ctx={mailTopicFindItem:()=>item,mailTopicSourceColumns:()=>[{k:'__picture'},{k:'fabric'},{k:'targetPrice'}],
    mailTopicDefaultColumnKeys:()=>['__picture','fabric','targetPrice'],kolAllOrderedCols:()=>[{k:'fabric'},{k:'targetPrice'}]};
  vm.createContext(ctx);
  vm.runInContext(between('function mailTopicColumnKeys(', 'function mailTopicSetColumnKeys('),ctx);
  const read=()=>Array.from(ctx.mailTopicColumnKeys('pricing','pricing-default','collection'));
  assert.deepEqual(read(),['fabric','targetPrice','__picture']);
  item.tableColumns.collection=['targetPrice','fabric'];
  assert.deepEqual(read(),['targetPrice','fabric']);
  item.tableColumns.collection=[];item.contentOptions.collection.pricingLayoutVersion=2;
  assert.deepEqual(read(),[]);
});

test('pricing cells preserve inherited Collection values, dates, overrides and textual PLM IDs',()=>{
  const groups=require('../public/collection-model-groups.js');
  const rows=groups.normalizeRows([
    {id:1,plmId:'2105001',modelKod:'DEMO',inStoreMonth:'JUNE 2027',colourCode:'WHITE',fabric:'Jersey',targetPrice:'3.85',exFactory:'2027-04-01'},
    {id:2,plmId:'2105001',modelKod:'DEMO',inStoreMonth:'JUNE 2027',colourCode:'BLUE',fabric:'Old',targetPrice:'1.00',exFactory:'2027-03-01'}
  ]).rows;
  const ctx={appLang:'en',prepareEmailColumnIsPicture:()=>false,kolEffectiveValue:(row,key)=>groups.effectiveValue(row,key,rows),
    kolFabricDisplay:v=>v,kolParseMoneyNum:Number,fmtDate:v=>v};
  vm.createContext(ctx);
  vm.runInContext(between('function prepareEmailTopicCell(', 'function prepareEmailSubjectSegment('),ctx);
  assert.equal(ctx.prepareEmailTopicCell(rows[1],{k:'fabric'}).value,'Jersey');
  assert.equal(ctx.prepareEmailTopicCell(rows[1],{k:'targetPrice',money:true}).value,3.85);
  assert.equal(ctx.prepareEmailTopicCell(rows[1],{k:'exFactory',date:true}).value,'2027-04-01');
  assert.equal(ctx.prepareEmailTopicCell(rows[1],{k:'plmId'}).value,'2105001');
  assert.equal(ctx.prepareEmailTopicCell(rows[1],{k:'plmId'}).numFmt,'@');
  const overridden=groups.setVariantOverride(rows,2,'fabric','Interlock');
  ctx.kolEffectiveValue=(row,key)=>groups.effectiveValue(row,key,overridden);
  assert.equal(ctx.prepareEmailTopicCell(overridden[1],{k:'fabric'}).value,'Interlock');
  assert.match(between('async function prepareEmailBuildTopicTableWorkbook(', 'function prepareEmailWorkbookFileEntry('),/coerceDateLoose\(column.sourceKind==='cp'\?row\[column.k\]:kolEffectiveValue\(row,column.k\)\)/);
});

test('prepared e-mail Fabric Card summaries match Collection exports in preview, body, TSV and Excel',async()=>{
  const fabricCards=require('../public/fabric-cards-engine.js');
  const jersey='3859-Örme,Süprem,30/1 Ne,Pamuk,150 gsm,100% Pamuk,Enzim';
  const terry='361819-Örme,İki İplik,30/20,Pamuk,220 gsm,%80 Pamuk, %20 Poliester,Dispers';
  const raw='A - '+jersey+'\nB - '+terry;
  const cards=new Map([
    ['3859',{code:'3859',summary:'Süprem · 30/1 Ne · 150 gsm · 100% Pamuk',summaryEn:'Single Jersey · 30/1 Ne · 150 gsm · 100% Cotton'}],
    ['361819',{code:'361819',summary:'İki İplik · 220 gsm · 80% Pamuk 20% Polyester',summaryEn:'Two Thread Terry · 220 gsm · 80% Cotton 20% Poliester'}],
  ]);
  const ctx={
    appLang:'en',CP_FABRIC_PLM_KEY:'Fabric (PLM)',
    prepareEmailColumnIsPicture:()=>false,kolEffectiveValue:(row,key)=>row[key],
    kolFabricDisplay:value=>fabricCards.displayText(value,cards,ctx.appLang),
    escapeHtml:value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
    L:value=>value,tableColumnLabel:(kind,column)=>column.label,
  };
  vm.createContext(ctx);
  vm.runInContext(between('function prepareEmailTopicCell(', 'function prepareEmailSubjectSegment('),ctx);
  vm.runInContext(between('function prepareEmailTopicTablePlain(', 'async function prepareEmailBuildTopicTableWorkbook('),ctx);
  vm.runInContext(between('function mailTopicTablePreviewHtml(', 'function openMailTopicEditor('),ctx);
  vm.runInContext(between('async function prepareEmailTopicTableContent(', 'function prepareEmailTopicCell('),ctx);

  const collectionColumn={k:'fabric',label:'Fabric',sourceKind:'collection'};
  const cpColumn={k:'Fabric (PLM)',label:'Fabric',sourceKind:'cp'};
  const row={fabric:raw,'Fabric (PLM)':raw,modelKod:'DEMO'};
  const enSummary=fabricCards.displayText(raw,cards,'en');
  assert.match(enSummary,/A · 3859 · Single Jersey/);
  assert.match(enSummary,/B · 361819 · Two Thread Terry/);
  for(const column of [collectionColumn,cpColumn]){
    const out=ctx.prepareEmailTopicCell(row,column);
    assert.equal(out.value,enSummary,'Excel cell must contain summary, not raw PLM description');
    assert.equal(out.display,enSummary,'mail body and preview must contain the same summary');
    assert.equal(out.numeric,false);
    const plain=ctx.prepareEmailTopicTablePlain([row],[column]);
    assert.ok(plain.includes(enSummary));
    const preview=ctx.mailTopicTablePreviewHtml([row],[column]);
    assert.ok(preview.includes(enSummary));
    const body=await ctx.prepareEmailTopicTableContent([row],[column]);
    assert.ok(body.html.includes(enSummary));
    assert.ok(body.plain.includes(enSummary));
    assert.doesNotMatch(body.html,/Enzim|Dispers/);
  }
  assert.equal(row.fabric,raw,'raw PLM fabric must remain unchanged');
  assert.equal(row['Fabric (PLM)'],raw,'CP raw PLM fabric must remain unchanged');
  ctx.appLang='tr';
  assert.equal(ctx.prepareEmailTopicCell(row,collectionColumn).value,fabricCards.displayText(raw,cards,'tr'));
  assert.equal(ctx.prepareEmailTopicCell({fabric:'Unmapped fabric'},collectionColumn).value,'Unmapped fabric');
  assert.equal(ctx.prepareEmailTopicCell(row,{k:'modelKod',sourceKind:'collection'}).display,'DEMO');

  const workbook=between('async function prepareEmailBuildTopicTableWorkbook(', 'function prepareEmailWorkbookFileEntry(');
  assert.match(workbook,/const out=prepareEmailTopicCell\(row,column\)/);
  assert.match(workbook,/cell.value=out.value/);
});

test('task-specific pricing opens the shared editor and uses its selections for exactly one optional workbook and table',()=>{
  const taskPreview=between('if(pricingTaskV2){','const head=`<div class="mailTopicListHead">');
  assert.match(taskPreview,/data-mail-topic-edit=/);
  const flow=between('mailTopicSelect(topicForDraft.kind,topicForDraft.id);','/* Pricing Workspace V2 — quotation reminder.');
  assert.match(flow,/workbook=topicContent.excel\?await prepareEmailBuildTopicTableWorkbook\(selRows,topicColumns,topicForDraft.name,m.name,\{pricing:true\}\):null/);
  assert.match(flow,/topicContent.table\?await prepareEmailTopicTableContent\(selRows,topicColumns\)/);
  assert.doesNotMatch(flow,/kolBuildPricingPreviewImages|previews:|topicTableEntries|kolBuildPricingRequestWorkbook/);
  assert.match(flow,/recordRequest\(SRC.persist\?'collection':'cp',selRows,checked\)/,'quotation history is preserved');
});

test('pricing draft sends the actual table below edited text and only embeds selected model images',async()=>{
  let payload;
  const ctx={
    mailTplBody:()=>'Default',mailTplToHtml:s=>'<p>'+s+'</p>',mailTplToPlain:s=>s,
    fetch:async(url,options)=>{payload=JSON.parse(options.body);return {ok:true,json:async()=>({opened:false})};}
  };
  vm.createContext(ctx);
  vm.runInContext(between('function kolPricingMailHtml(', 'const KOL_IMAGE_EXCEL_PADDING_PX'),ctx);
  vm.runInContext(between('function prepareEmailGenericHtml(', 'async function kolCreatePreparedEmailDraft('),ctx);
  vm.runInContext(between('async function kolCreatePricingEmailDraft(', 'function prepareEmailRowManufacturer('),ctx);
  const asset={filename:'model.png',mimeType:'image/png',cid:'selected-model',base64:'aW1hZ2U='};
  await ctx.kolCreatePricingEmailDraft({email:'demo@example.test',subject:'Edited subject',body:'Edited message',
    tableHtml:'<table><tr><td>STYLE-A</td></tr></table>',tablePlain:'STYLE-A',inlineImages:[asset],
    previews:[{...asset,cid:'obsolete-preview'}],attachmentPlan:{attachments:[{filename:'Quotation.xlsx',base64:'ZXhjZWw='}]}});
  assert.equal(payload.subject,'Edited subject');
  assert.match(payload.html,/<p>Edited message<\/p><table>/);
  assert.match(payload.text,/Edited message\r\n\r\nSTYLE-A/);
  assert.doesNotMatch(payload.html,/Quotation request table|obsolete-preview|Excel file is also attached/);
  assert.deepEqual(payload.inlineImages,[asset]);
  assert.equal(payload.attachments.length,1);
  await ctx.kolCreatePricingEmailDraft({email:'demo@example.test',body:'Only text',attachmentPlan:{attachments:[]}});
  assert.deepEqual(payload.attachments,[]);
  assert.deepEqual(payload.inlineImages,[]);
  assert.doesNotMatch(payload.html,/<table|<img|attached/);
});
