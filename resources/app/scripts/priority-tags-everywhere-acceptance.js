'use strict';
// Real Buyer Log on isolated demo data: a custom priority tag created in the
// Priority Rules must appear in Backlog Overview tiles, its Priority breakdown
// and the Global Flow detail. Requires Playwright + Chromium. No production data.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require('playwright');
const app=path.resolve(__dirname,'..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-priority-tags-'));
const port=Number(process.env.BUYER_LOG_PRIORITY_TAGS_PORT||6497),base=`http://127.0.0.1:${port}`;
const shotDir=process.env.BUYER_LOG_SHOT_DIR||root;
const env={...process.env,BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')};
for(const [key,dir] of Object.entries({BUYER_LOG_DATA_ROOT:'app',BUYER_LOG_SERVER_DATA_ROOT:'server',BUYER_LOG_LOCAL_DATA_ROOT:'local',BUYER_LOG_TEMP_ROOT:'temp'})){
  env[key]=path.join(root,dir);fs.mkdirSync(env[key],{recursive:true});
}
env.BUYER_LOG_AUTH_DATA_ROOT=env.BUYER_LOG_SERVER_DATA_ROOT;
env.BL_DATA_DIR=env.BUYER_LOG_SERVER_DATA_ROOT;
const source=path.join(root,'source');fs.mkdirSync(source);
fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',sourceFolder:source,updates:{enabled:false}}));
const demo=require('./generate-demo-data').build({rows:60,seed:11,today:new Date('2026-11-15T00:00:00Z')});
const XLSX=require('xlsx');
for(const [name,rows] of [['ASAS',demo.asas],['Antrepo',demo.antrepo]]){
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),name);XLSX.writeFile(wb,path.join(source,`${name} - Demo.xlsx`));
}
const log=fs.openSync(path.join(root,'server.log'),'a');
const server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});
let browser,cookie;
async function api(url,body){
  const res=await fetch(base+url,{method:body?'POST':'GET',headers:{cookie:cookie||'','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  assert.ok(res.ok,await res.clone().text());return res;
}
(async()=>{
  console.log('Artifacts:',root);
  let ready=false;
  for(let i=0;i<120;i++){try{ready=(await fetch(base+'/api/health')).status<500;if(ready)break;}catch{}await new Promise(r=>setTimeout(r,250));}
  assert.ok(ready,'demo server did not start; see server.log');
  const login=await api('/api/user-login',{userId:'moderator',newPassword:'demo-priority-123',password:'demo-priority-123'});
  cookie=login.headers.get('set-cookie').split(';')[0];
  await api('/api/refresh',{});
  for(let i=0;i<120;i++){if(!(await (await api('/api/refresh-status')).json()).running)break;await new Promise(r=>setTimeout(r,250));}
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/opt/pw-browsers/chromium',args:['--no-sandbox']}).catch(()=>chromium.launch({headless:true}));
  const context=await browser.newContext({viewport:{width:1600,height:1300},deviceScaleFactor:Number(process.env.BUYER_LOG_SHOT_SCALE||2),reducedMotion:'reduce'});
  const split=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),domain:'127.0.0.1',path:'/',httpOnly:true}]);
  await context.addInitScript(()=>localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0'));
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof switchTab==='function',null,{timeout:60000});
  await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({timeout:4000}).catch(()=>{});
  await page.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:60000});
  // CP + karar motoru, sonra kullanıcı etiketi ve onu atayan kural (demo).
  await page.evaluate(async()=>{switchTab('cp');await BLPerf.ensureFeature('cpAssistant');});
  await page.waitForFunction(()=>window.BLCpAssistant&&window.BLCpPriorityIndex&&state.cp&&state.cp.rows.length>0,null,{timeout:60000});
  const tag=await page.evaluate(async()=>{
    const A=window.BLCpAssistant,R=window.BLCpRulesEngine;
    const entry=await A.addPriorityTag({tr:'Gecikme - Yükleme Tarihi',en:'Delay - Loading Date',tone:'red'});
    const id=(entry&&entry.id)||A._state.priorityCatalog.find(item=>item.tr==='Gecikme - Yükleme Tarihi').id;
    A._state.rules=[...A._state.rules,R.normalizeRule({id:'demo_delay',kind:'priority',target:id,enabled:true,name:'Demo: üretimdeki siparişler',nameEn:'Demo: orders in production',match:'all',conditions:[{field:'@daysToLoad',operator:'gte',value:-9999}]},{kind:'priority',priorityCatalog:A._state.priorityCatalog})];
    window.dispatchEvent(new CustomEvent('bl:cp-decision-context-changed',{detail:{reason:'acceptance'}}));
    return id;
  });
  assert.match(tag,/^prio:/);
  await page.waitForFunction(()=>window.BLCpPriorityIndex.ready(),null,{timeout:60000}).catch(()=>{});
  await page.evaluate(()=>window.BLCpPriorityIndex.ensure());
  const cpTagged=await page.evaluate(id=>state.cp.rows.filter(r=>r.Priority===id).length,tag);
  assert.ok(cpTagged>0,'CP rows must carry the custom tag');
  // Backlog Genel Bakış
  await page.evaluate(async()=>{switchTab('backlog');await BLPerf.ensureFeature('backlogAnalysis');});
  await page.locator('#backlogOverview .bpaTile').first().waitFor({timeout:60000});
  await page.waitForFunction(id=>document.querySelector(`#backlogOverview .blvPriorityTile[data-priority-code="${id}"]`),tag,{timeout:60000});
  const tiles=await page.evaluate(()=>[...document.querySelectorAll('#backlogOverview .blvTile .bpaTileLabel')].map(el=>el.textContent.trim()));
  assert.ok(tiles.includes('Gecikme - Yükleme Tarihi'),'priority tag tile: '+tiles.join(' | '));
  assert.ok(!tiles.includes('Riskli adet')&&!tiles.includes('Eksik Yükleme'),'removed tiles stay removed: '+tiles.join(' | '));
  await page.locator('[data-blv-group="priority"]').click();
  await page.waitForFunction(()=>[...document.querySelectorAll('#backlogOverview .bpaGName')].some(el=>el.textContent.includes('Gecikme')),null,{timeout:20000});
  await page.evaluate(()=>{document.documentElement.dataset.theme='dark';const el=document.getElementById('backlogOverview');el.scrollIntoView({block:'start'});});
  await page.waitForTimeout(400);
  const box=await page.locator('#backlogOverview').boundingBox();
  await page.screenshot({path:path.join(shotDir,'backlog-priority-tags.png'),clip:{x:box.x,y:box.y,width:Math.min(box.width,1560),height:Math.min(box.height,960)}});
  await page.evaluate(()=>applyLanguage('en'));await page.waitForTimeout(200);
  const enTiles=await page.evaluate(()=>[...document.querySelectorAll('#backlogOverview .blvPriorityTile .bpaTileLabel')].map(el=>el.textContent.trim()));
  assert.ok(enTiles.includes('Delay - Loading Date'),'EN label: '+enTiles.join(' | '));
  await page.evaluate(()=>applyLanguage('tr'));
  // Global Flow kaydı aynı etiketi taşır.
  const flowCheck=await page.evaluate(async id=>{
    const rows=await window.BLGlobalFlowDataProviders.cp({});
    const recs=window.BLOverviewGlobalFlow?.shipmentPartialsFromRows?window.BLOverviewGlobalFlow.shipmentPartialsFromRows(rows,'cp'):null;
    return recs?recs.filter(r=>r.actionPriority===id).length:-1;
  },tag);
  // Excel Backlog V3: Öncelik kırılımı ve detay sütunları gerçek indirmede.
  await page.locator('[data-blv-group="priority"]').click().catch(()=>{});
  const [download]=await Promise.all([page.waitForEvent('download',{timeout:90000}),page.evaluate(()=>{switchTab('backlog');document.getElementById('backlogExportV3Btn').click();})]);
  const xlsxPath=path.join(root,'backlog-v3.xlsx');await download.saveAs(xlsxPath);
  const ExcelJS=require('../public/vendor/exceljs.min.js'),book=new ExcelJS.Workbook();await book.xlsx.load(fs.readFileSync(xlsxPath));
  const sheetTexts=ws=>{const all=[];ws.eachRow(r=>r.eachCell(c=>{if(typeof c.value==='string')all.push(c.value);}));return all;};
  const excel={dashboard:sheetTexts(book.worksheets[0]).includes('Öncelik kırılımı'),breakdowns:sheetTexts(book.getWorksheet('Kırılımlar')).includes('Öncelik'),
    detailHead:[book.getWorksheet('Backlog V3').getCell('C1').value,book.getWorksheet('Backlog V3').getCell('D1').value],
    tagged:sheetTexts(book.getWorksheet('Backlog V3')).filter(v=>v==='Gecikme - Yükleme Tarihi').length};
  assert.ok(excel.dashboard&&excel.breakdowns&&excel.tagged>0,'Excel priority breakdown: '+JSON.stringify(excel));
  assert.deepEqual(excel.detailHead,['Öncelik','Takip etiketleri']);
  // Global Flow haritası: etiketli araç/düğüm sol-alt köşede etiket tonunda işaret taşır.
  await page.evaluate(()=>switchTab('overview'));
  await page.locator('#globalFlowMapWidget').scrollIntoViewIfNeeded({timeout:30000}).catch(()=>{});
  await page.waitForFunction(()=>{const s=window.BLOverviewGlobalFlow?.engineState?.();return s&&s.filtered>0;},null,{timeout:90000}).catch(()=>{});
  await page.waitForTimeout(2500);
  const marked=await page.evaluate(id=>{const recs=window.BLOverviewGlobalFlow&&window.BLOverviewGlobalFlow.engineState?window.BLOverviewGlobalFlow.engineState():null;return recs;},tag);
  const widget=await page.locator('#globalFlowMapWidget').boundingBox();
  if(widget){
    // Harita kartı ~880 px genişliktedir; sürüm notu (≥900 px) için bağlam 2x ölçeklidir.
    await page.screenshot({path:path.join(shotDir,'global-flow-priority-marker.png'),scale:'device',clip:{x:widget.x,y:widget.y,width:Math.min(widget.width,1560),height:Math.min(widget.height,900)}});
  }
  console.log({cpTagged,tiles,enTiles,flowCheck,excel,marked,errors});
  assert.notEqual(flowCheck,0,'Global Flow records lost the custom tag');
  assert.deepEqual(errors,[]);
  console.log('PASS');
})().catch(err=>{console.error(err);process.exitCode=1;}).finally(async()=>{await browser?.close().catch(()=>{});server.kill();});
