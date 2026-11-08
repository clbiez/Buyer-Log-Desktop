'use strict';
// Post-timing diagnosis only. No business data, columns or renderer functions
// are assigned. The optional second capture uses ordinary navigation buttons.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const actual=require('/opt/codex/cua_node/lib/node_modules/playwright');
const sha=text=>crypto.createHash('sha256').update(text).digest('hex');
async function capture(page,stage,directory){
 const value=await page.evaluate(()=>{
  const module=document.body.dataset.activeTab,rows=module==='cp'?state.cp.rows:state.orders.rows;
  const table=document.getElementById(module==='cp'?'cpTable':'ordersTable'),row=table.querySelector('tbody tr[data-id]'),rect=row?.getBoundingClientRect();
  const hit=rect?document.elementFromPoint((Math.max(0,rect.left)+Math.min(innerWidth,rect.right))/2,(Math.max(0,rect.top)+Math.min(innerHeight,rect.bottom))/2):null;
  const schemas={};
  for(const key of ['cp','orders']){
   const t=document.getElementById(key==='cp'?'cpTable':'ordersTable'),manager=colmgr[key];
   schemas[key]={definitions:COLS_BY_TABLE[key].map(c=>({key:c.k,type:c.type,label:c.label,group:c.group,modelCustom:!!c.modelCustom,checklistSupplierColumn:!!c.checklistSupplierColumn,noteCustom:!!c.noteCustom,personalNote:!!c.personalNote,formulaCustom:!!c.formulaCustom,modelColumnId:c.modelColumnId||null,checklistItemId:c.checklistItemId||null})),order:manager.order.slice(),hidden:Array.from(manager.hidden),header:Array.from(t.querySelectorAll('thead th[data-k]')).map(th=>({key:th.dataset.k,text:th.textContent.trim()}))};
  }
  return{module,rows:rows.length,snapshot:JSON.stringify(rows),schemas,cells:Array.from(table.querySelectorAll('tbody tr[data-id]')).map(r=>({id:r.dataset.id,cells:Array.from(r.querySelectorAll('td')).map(c=>({key:c.dataset.k||null,text:c.textContent}))})),unobscured:!!(hit&&(hit===row||row.contains(hit))),cover:hit?.className||null,probe:window.__benchmarkFirstTransition,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone};
 });
 const rows=JSON.parse(value.snapshot),stem=stage+'-'+value.module;
 fs.writeFileSync(path.join(directory,stem+'-normalized-rows.json.gz'),zlib.gzipSync(Buffer.from(value.snapshot),{level:1}));
 fs.writeFileSync(path.join(directory,stem+'-schema-cells.json'),JSON.stringify({schemas:value.schemas,cells:value.cells},null,2)+'\n');
 return{stage,module:value.module,rows:value.rows,normalizedRowsSha256:sha(value.snapshot),ownKeyOrderSha256:sha(JSON.stringify(rows.map(r=>Object.keys(r)))),visibleCellsSha256:sha(JSON.stringify(value.cells.map(r=>({id:r.id,cells:r.cells.map(c=>c.text)})))),schemaSha256:sha(JSON.stringify(value.schemas[value.module])),cellsPerRow:value.cells.map(r=>r.cells.length),unobscured:value.unobscured,cover:value.cover,probe:value.probe,timezone:value.timezone};
}
async function navigateAndObserve(page,module){
 await page.locator('nav.tabs button[data-tab="'+module+'"]').click({timeout:900000});
 const handle=await page.waitForFunction(module=>{
  const key='__postTimingSchemaObservation',now=performance.now(),old=window[key];
  const observed=old&&old.module===module?old:(window[key]={module,last:now,stableSince:null,schema:null});
  const gap=now-observed.last;observed.last=now;
  const selector=module==='cp'?'#cpTable tbody tr[data-id]':'#ordersTable tbody tr[data-id]',row=document.querySelector(selector);
  const ready=document.body.dataset.activeTab===module&&state[module]?.rows?.length>0&&row;
  const holds=Array.from(document.querySelectorAll('.blTriviaHold')).filter(h=>!h.hidden&&h.getClientRects().length);
  for(const hold of holds){const button=hold.querySelector('[data-hold-continue]');if(ready&&button&&!hold.dataset.leaving)button.click();}
  const rect=row?.getBoundingClientRect(),hit=rect?document.elementFromPoint((Math.max(0,rect.left)+Math.min(innerWidth,rect.right))/2,(Math.max(0,rect.top)+Math.min(innerHeight,rect.bottom))/2):null;
  const visible=!!(hit&&(hit===row||row.contains(hit)));
  const schema=JSON.stringify({keys:COLS_BY_TABLE[module].map(c=>c.k),order:colmgr[module].order,headers:Array.from(document.querySelectorAll((module==='cp'?'#cpTable':'#ordersTable')+' thead th[data-k]')).map(th=>th.dataset.k)});
  if(!ready||holds.length||!visible||observed.schema!==schema||gap>250){observed.stableSince=ready&&!holds.length&&visible?now:null;observed.schema=schema;return false;}
  if(observed.stableSince===null)observed.stableSince=now;
  return now-observed.stableSince>=2000;
 },module,{polling:20,timeout:900000});
 await handle.dispose();
}
exports.chromium={launch:async options=>{
 const browser=await actual.chromium.launch(options),create=browser.newContext.bind(browser);
 browser.newContext=async options=>{
  const context=await create({...options,timezoneId:'Europe/Istanbul'}),close=context.close.bind(context);
  context.close=async()=>{
   try{
    const directory=path.dirname(process.env.FIRST_TRANSITION_EXTRA),captures=[];
    for(const page of context.pages()){
     const initial=await capture(page,'initial',directory);captures.push(initial);
     if(!initial.unobscured)throw Error('Initial row covered; evidence retained');
     if(initial.module==='orders'&&process.env.FIRST_TRANSITION_EXTRA_NAV==='1'){
      await navigateAndObserve(page,'cp');
      captures.push(await capture(page,'visited-cp',directory));
      await navigateAndObserve(page,'orders');
      captures.push(await capture(page,'after-cp-visit',directory));
     }
    }
    const file=process.env.FIRST_TRANSITION_EXTRA,prior=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):[];
    fs.writeFileSync(file,JSON.stringify([...prior,...captures],null,2)+'\n');
    if(captures.some(c=>!c.unobscured))throw Error('Post-timing row covered; evidence retained');
   }finally{await close();}
  };
  return context;
 };
 return browser;
}};
