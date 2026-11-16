'use strict';
// Real Buyer Log on isolated demo data: Orders gets the Priority column from the
// checklist-free worker path, and Backlog uses Orders priorities for orders that
// are not in CP. CP is cut to 200 lines to mirror real use (CP ~200, Orders 30–50k).
// Requires Playwright + Chromium. No production data is read.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require('playwright');
const app=path.resolve(__dirname,'..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-orders-priority-'));
const port=Number(process.env.BUYER_LOG_ORDERS_PRIORITY_PORT||6498),base=`http://127.0.0.1:${port}`;
const shotDir=process.env.BUYER_LOG_SHOT_DIR||root;
const env={...process.env,BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')};
for(const [key,dir] of Object.entries({BUYER_LOG_DATA_ROOT:'app',BUYER_LOG_SERVER_DATA_ROOT:'server',BUYER_LOG_LOCAL_DATA_ROOT:'local',BUYER_LOG_TEMP_ROOT:'temp'})){
  env[key]=path.join(root,dir);fs.mkdirSync(env[key],{recursive:true});
}
env.BUYER_LOG_AUTH_DATA_ROOT=env.BUYER_LOG_SERVER_DATA_ROOT;
env.BL_DATA_DIR=env.BUYER_LOG_SERVER_DATA_ROOT;
const source=path.join(root,'source');fs.mkdirSync(source);
fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',sourceFolder:source,updates:{enabled:false}}));
const demo=require('./generate-demo-data').build({rows:Number(process.env.BUYER_LOG_ORDERS_PRIORITY_ROWS||3000),seed:11,today:new Date('2026-11-16T00:00:00Z')});
const XLSX=require('xlsx');
for(const [name,rows] of [['ASAS',demo.asas],['Antrepo',demo.antrepo]]){
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),name);XLSX.writeFile(wb,path.join(source,`${name} - Demo.xlsx`),{compression:true});
}
const log=fs.openSync(path.join(root,'server.log'),'a');
const server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});
let browser,cookie;
async function api(url,body){
  for(let attempt=0;;attempt++){
    try{const res=await fetch(base+url,{method:body?'POST':'GET',headers:{cookie:cookie||'','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.ok(res.ok,await res.clone().text());return res;}
    catch(error){if(attempt>=30||error instanceof assert.AssertionError)throw error;await new Promise(r=>setTimeout(r,2000));}
  }
}
(async()=>{
  console.log('Artifacts:',root);
  for(let i=0;i<240;i++){try{if((await fetch(base+'/api/health')).status<500)break;}catch{}await new Promise(r=>setTimeout(r,250));}
  const login=await api('/api/user-login',{userId:'moderator',newPassword:'demo-orders-123',password:'demo-orders-123'});
  cookie=login.headers.get('set-cookie').split(';')[0];
  await api('/api/refresh',{});
  for(let i=0;i<480;i++){if(!(await (await api('/api/refresh-status')).json()).running)break;await new Promise(r=>setTimeout(r,250));}
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1600,height:1000},deviceScaleFactor:Number(process.env.BUYER_LOG_SHOT_SCALE||1),reducedMotion:'reduce'});
  const split=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),domain:'127.0.0.1',path:'/',httpOnly:true}]);
  await context.addInitScript(()=>localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0'));
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof switchTab==='function',null,{timeout:90000});
  await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({timeout:4000}).catch(()=>{});
  await page.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:90000});
  // CP ~200 satır; bir özel etiket + checklist'ten bağımsız kural; checklist'e bağlı yerleşikler de açık.
  const tag=await page.evaluate(async()=>{
    await window.BLPerf.ensureFeature('cpAssistant');
    if(state.cp&&state.cp.rows.length>200){state.cp.rows=state.cp.rows.slice(0,200);invalidateUnifiedPriorityDecisions('acceptance-cp-200',['cp']);}
    const A=window.BLCpAssistant,R=window.BLCpRulesEngine;
    const entry=await A.addPriorityTag({tr:'Gecikme - Yükleme Tarihi',en:'Delay - Loading Date',tone:'red'});
    A._state.rules=[...A._state.rules,R.normalizeRule({id:'demo_delay',kind:'priority',target:entry.id,enabled:true,name:'Demo: yüklemeye 30 günden az',nameEn:'Demo: under 30 days to load',match:'all',conditions:[{field:'@daysToLoad',operator:'lte',value:30}]},{kind:'priority',priorityCatalog:A._state.priorityCatalog})];
    window.dispatchEvent(new CustomEvent('bl:cp-decision-context-changed',{detail:{reason:'acceptance'}}));
    return entry.id;
  });
  // Siparişler: Priority sütunu worker'da dolar.
  await page.evaluate(()=>switchTab('orders'));
  await page.waitForFunction(id=>window.BLOrdersPriority&&window.BLOrdersPriority.stats().runs>0&&state.orders.rows.some(r=>r.Priority===id),tag,{timeout:120000});
  await page.waitForTimeout(800);
  const orders=await page.evaluate(id=>({
    header:Boolean(document.querySelector('#ordersTable th[data-k="Priority"]')),
    stats:window.BLOrdersPriority.stats(),rows:state.orders.rows.length,
    tagged:state.orders.rows.filter(r=>r.Priority===id).length,
    checklistAction:state.orders.rows.filter(r=>r.Priority==='ACTION_THIS_WEEK').length,
    cells:[...document.querySelectorAll('#ordersTable tbody tr')].slice(0,30).map(tr=>tr.querySelector('td[data-k="Priority"]')?.textContent.trim()||'').filter(Boolean).length,
  }),tag);
  // Worker'a giden izdüşümlü satırlar, tam satırla aynı sonucu vermeli (tüm demo satırları).
  const parity=await page.evaluate(async()=>{
    const ctx=window.BLCpAssistant.ordersPriorityContext(),rows=state.orders.rows.filter(r=>String(r['Active/Inactive']||'')!=='Inactive');
    const projected=await window.BLOrdersPriority.run(rows,ctx.spec),full=await window.BLOrdersPriority.run(rows,ctx.spec,{project:false});
    let diff=0;for(let i=0;i<rows.length;i++)if(projected.codes[i]!==full.codes[i]||JSON.stringify(projected.tags[i])!==JSON.stringify(full.tags[i]))diff++;
    return {rows:rows.length,diff,fields:window.BLOrdersPriorityEngine.requiredFields(ctx.spec).length,rowKeys:Object.keys(rows[0]||{}).length};
  });
  assert.equal(parity.diff,0,'projected and full rows must give identical priorities');
  console.log({parity});
  assert.ok(orders.header,'Orders Priority header');
  assert.equal(orders.stats.lastMode,'worker','priority runs in the worker');
  assert.ok(orders.tagged>0,'Orders rows carry the custom tag');
  const table=await page.locator('#ordersTable').boundingBox();
  if(table)await page.screenshot({path:path.join(shotDir,'orders-priority-column.png'),clip:{x:table.x,y:Math.max(0,table.y-120),width:Math.min(table.width,1560),height:620}});
  // Backlog: CP'de olmayan siparişler Siparişler kaynağından etiketlenir.
  // CP yüklemesi bittikten SONRA 200 satıra indirilir (gerçek kullanım: CP ~200).
  const cpRows=await page.evaluate(async()=>{
    if(typeof window.BLEnsureCpLoaded==='function')await window.BLEnsureCpLoaded({deferRender:true}).catch(()=>null);
    if(state.cp&&state.cp.rows.length>200){state.cp.rows=state.cp.rows.slice(0,200);invalidateUnifiedPriorityDecisions('acceptance-cp-200',['cp']);}
    await window.BLCpPriorityIndex.ensure();
    return state.cp.rows.length;
  });
  assert.equal(cpRows,200);
  await page.evaluate(async()=>{switchTab('backlog');await BLPerf.ensureFeature('backlogAnalysis');});
  await page.waitForFunction(id=>document.querySelector(`#backlogOverview .blvPriorityTile[data-priority-code="${id}"]`),tag,{timeout:120000});
  const backlog=await page.evaluate(id=>{const tile=document.querySelector(`#backlogOverview .blvPriorityTile[data-priority-code="${id}"]`);return {title:tile.getAttribute('title')||'',value:tile.querySelector('.bpaTileValue').textContent.trim()};},tag);
  assert.match(backlog.title,/Siparişler \(checklist hariç\)/,'tile names the Orders source: '+backlog.title);
  console.log({orders,backlog,errors});
  assert.deepEqual(errors,[]);
  console.log('PASS');
})().catch(err=>{console.error(err);process.exitCode=1;}).finally(async()=>{await browser?.close().catch(()=>{});server.kill();});
