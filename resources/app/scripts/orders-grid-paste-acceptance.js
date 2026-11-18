'use strict';
// Gerçek HTTP + Buyer Log UI, sentetik demo verisi, izole kalıcılık.
// Orders: CP'de elle girilebilen her sütuna çoklu yapıştırma (asıl CP satırı
// üzerinden, önizlemeyle); CP/Orders: Delete aralığı temizler, Ctrl+D aşağı doldurur.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),XLSX=require('xlsx');
const {initializeBenchmarkState}=require('./lib/startup-benchmark');
const app=path.resolve(__dirname,'..'),work=process.env.BL_ACCEPTANCE_WORK||os.tmpdir();fs.mkdirSync(work,{recursive:true});
const root=fs.mkdtempSync(path.join(work,'orders-grid-paste-acceptance-')),port=6493,base=`http://127.0.0.1:${port}`;
const env={...process.env,BUYER_LOG_CENTRAL_IAM_ENABLED:'0',BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')};
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_TEMP_ROOT']){env[key]=path.join(root,key==='BUYER_LOG_LOCAL_DATA_ROOT'?'local':key.toLowerCase());fs.mkdirSync(env[key],{recursive:true});}
env.BUYER_LOG_AUTH_DATA_ROOT=env.BUYER_LOG_SERVER_DATA_ROOT;
env.BUYER_LOG_LOCAL_DB=path.join(env.BUYER_LOG_LOCAL_DATA_ROOT,'BuyerLogLocal.db');
initializeBenchmarkState(root);
const source=path.join(root,'source');fs.mkdirSync(source);
fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',sourceFolder:source,refreshWithExcel:false,updates:{enabled:false}}));
const demo=require('./generate-demo-data').build({rows:12,seed:11,today:new Date('2026-11-06T00:00:00Z')});
for(const [name,sheet,rows]of [['ASAS.xlsx','ASAS',demo.asas],['Antrepo.xlsx','Antrepo',demo.antrepo]]){const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),sheet);XLSX.writeFile(wb,path.join(source,name));}
const log=fs.openSync(path.join(root,'server.log'),'a'),server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});let browser,cookie,page;
async function api(url,body,method=body?'POST':'GET',expected=200){const response=await fetch(base+url,{method,headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.equal(response.status,expected,await response.clone().text());return response.json();}
async function refresh(){await api('/api/refresh',{},'POST',202);for(let i=0;i<160;i++){if(!(await api('/api/refresh-status')).running)return;await new Promise(r=>setTimeout(r,200));}throw Error('Refresh timeout');}
const PERSONAL='personal_note_demo';
const KEYS=['Order Code','Model Name','Sub-Manufacturer','Supp. FOB','Notes','Del. Type',PERSONAL];
const cell=(table,key,n)=>page.locator(`#${table} tbody tr[data-id] td[data-key="${key}"]`).nth(n);
const cpValue=(table,key,n)=>cell(table,key,n).evaluate((td,args)=>{
  const display=(args.table==='ordersTable'?state.orders:state.cp).rows.find(r=>String(r._id)===td.closest('tr').dataset.id);
  const row=args.table==='ordersTable'?orderLinePeerRows('cp',display)[0]:display;return String(row?.[args.key]??'');
},{table,key});
async function selectRange(table,fromKey,from,toKey,to){
  await cell(table,fromKey,from).click({position:{x:4,y:4}});
  await cell(table,toKey,to).click({position:{x:4,y:4},modifiers:['Shift']});
}
async function paste(table,text){
  await page.evaluate(({table,text})=>{
    const data=new DataTransfer();data.setData('text/plain',text);
    document.getElementById(table).dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
  },{table,text});
}
async function applyBulk(){
  await page.locator('[data-bulk-action="apply"]').click({timeout:5000});
  await page.locator('.blBulkOverlay button').filter({hasText:/Kapat|Close/}).click({timeout:10000});
  await page.waitForFunction(()=>!document.querySelector('.blBulkOverlay'),null,{timeout:5000});
}
(async()=>{
  for(let i=0;i<160;i++){try{if((await fetch(base+'/api/health')).status<500)break;}catch{}await new Promise(r=>setTimeout(r,200));}
  const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',newPassword:'demo-paste-123',password:'demo-paste-123'})});
  assert.equal(login.status,200,await login.clone().text());cookie=login.headers.get('set-cookie').split(';')[0];
  await refresh();
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1600,height:820},reducedMotion:'reduce',deviceScaleFactor:Number(process.env.BL_SHOT_SCALE)||1}),sep=cookie.indexOf('=');
  await context.addCookies([{name:cookie.slice(0,sep),value:cookie.slice(sep+1),url:base}]);
  await context.addInitScript(()=>localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0'));
  page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
  const cpRequests=[],writes=[];
  page.on('request',request=>{
    const url=new URL(request.url());
    if(['/api/page-projection/cp','/api/data/cp'].includes(url.pathname))cpRequests.push(url.pathname);
    if(['PUT','PATCH','POST'].includes(request.method()))writes.push({path:url.pathname,body:request.postData()||''});
  });
  await page.route('https://**',route=>route.abort());
  await page.goto(base+'/?module=orders',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('[data-boot-continue]',{timeout:60000});
  await page.click('[data-boot-continue]');
  await page.waitForFunction(()=>!document.getElementById('blBootGuard')&&document.querySelector('#ordersTable tbody tr[data-id]'),null,{timeout:60000});
  await page.evaluate(({keys,personal})=>{
    applyLanguage('tr');
    BLPersonalNoteColumns.setDefinitions([{id:personal,labelTr:'Demo kişisel not',labelEn:'Demo private note'}]);
    syncCpNoteColumns(CP_NOTE_COLUMN_DEFS);
    for(const t of ['cp','orders']){
      colmgr[t].hidden=new Set((t==='cp'?CP_COLS:ORDERS_COLS).map(col=>col.k).filter(key=>!keys.includes(key)));
      colmgr[t].order=keys;
    }
    renderOrders();
  },{keys:KEYS,personal:PERSONAL});

  // A cold Orders view selects without loading CP; the first edit intent loads it.
  assert.equal(await page.evaluate(()=>state.cp),null);
  assert.deepEqual(cpRequests,[]);
  const fob=cell('ordersTable','Supp. FOB',0);
  await fob.click();
  assert.deepEqual(cpRequests,[]);
  assert.equal(await fob.locator('input').count(),0);
  await fob.dblclick();
  const fobEditor=fob.locator('input[data-kind="suppfob"]');
  await fobEditor.waitFor();
  assert.equal(await fobEditor.evaluate(input=>document.activeElement===input),true);
  assert.equal(cpRequests.length,1);
  assert.equal(await fobEditor.evaluate(input=>{
    const row=resolveCpEditorRow(input);
    return !!row&&Number(input.dataset.id)===row._id&&input.dataset.lineKey===lineKeyOfRow(row)&&input.dataset.editOwner===orderLinePeerOwner();
  }),true);
  await fobEditor.fill('17.25');
  await fobEditor.press('Tab');
  assert.equal(Number(await cpValue('ordersTable','Supp. FOB',0)),17.25);
  assert.equal((await fob.innerText()).trim(),'17,25');
  await fob.click();
  assert.equal(await fobEditor.count(),0);
  await page.keyboard.press('F2');
  assert.equal(await fobEditor.evaluate(input=>document.activeElement===input),true);
  await page.keyboard.press('Escape');

  const notes=cell('ordersTable','Notes',0);
  await notes.locator('.noteCellTrigger').dblclick();
  const noteEditor=page.locator('#_notesEditorModal .noteEditorArea');
  await noteEditor.fill('ORDERS EDIT NOTE');
  await noteEditor.press('Control+Enter');
  await page.locator('#_notesEditorModal').waitFor({state:'hidden'});
  assert.equal(await cpValue('ordersTable','Notes',0),'ORDERS EDIT NOTE');
  await notes.getByText('ORDERS EDIT NOTE').waitFor();
  await notes.locator('.noteCellTrigger').click();
  assert.equal(await noteEditor.count(),0);
  await page.keyboard.press('X');
  assert.equal(await noteEditor.innerText(),'X');
  await noteEditor.press('Escape');
  await noteEditor.waitFor({state:'hidden'});
  assert.equal(await cpValue('ordersTable','Notes',0),'ORDERS EDIT NOTE');

  const del=cell('ordersTable','Del. Type',0);
  await del.locator('.delTypeTrigger').dblclick();
  const option=page.locator('.delTypeMenu [data-value="Uçak"]');
  await option.waitFor();
  if(process.env.BL_RELEASE_SHOT){
    const assets=path.join(app,'public/release-notes/next-assets');
    fs.mkdirSync(assets,{recursive:true});
    await page.getByText('Düzenleme yetkileri yükleniyor…',{exact:true}).waitFor({state:'hidden'});
    await page.screenshot({path:path.join(assets,process.env.BL_RELEASE_SHOT),clip:{x:0,y:0,width:1600,height:720}});
  }
  await option.click();
  assert.equal(await cpValue('ordersTable','Del. Type',0),'Uçak');
  await del.getByText('Uçak',{exact:true}).waitFor();
  await page.evaluate(()=>settleOverrideWrites());
  const code=await cpValue('ordersTable','Order Code',0);
  const savedEdit=(await api('/api/data/cp')).rows.find(row=>String(row['Order Code'])===code);
  assert.equal(Number(savedEdit['Supp. FOB']),17.25);
  assert.equal(savedEdit.Notes,'ORDERS EDIT NOTE');
  assert.equal(savedEdit['Del. Type'],'Uçak');
  console.log('PASS Orders: lazy canonical edit access, two views, and server readback for Supp. FOB, Notes and Del. Type.');

  // Simulate a narrower CP projection while keeping the Orders display row.
  await page.evaluate(()=>{
    const display=document.getElementById('ordersTable')._blRenderedRows[3];
    const canonical=orderLinePeerRows('cp',display)[0];
    window.demoFullCpRows=state.cp.rows;
    state.cp.rows=state.cp.rows.filter(row=>row!==canonical);
    renderOrders();
  });
  const locked=cell('ordersTable','Supp. FOB',3);
  assert.match(await locked.getAttribute('class'),/viewOnlyCell/);
  await locked.dblclick();
  await page.keyboard.press('F2');
  await page.keyboard.press('9');
  assert.equal(await locked.locator('input').count(),0);
  await page.evaluate(()=>{state.cp.rows=window.demoFullCpRows;delete window.demoFullCpRows;renderOrders();});
  console.log('PASS Orders: a row absent from the CP projection remains locked.');

  const personal=cell('ordersTable',PERSONAL,0);
  const personalEditor=personal.locator('input');
  await personal.click();
  await paste('ordersTable','PRIVATE DEMO ONLY');
  assert.equal(await personalEditor.inputValue(),'PRIVATE DEMO ONLY');
  await page.keyboard.press('Control+z');
  assert.equal(await personalEditor.inputValue(),'');
  await page.keyboard.press('Control+y');
  assert.equal(await personalEditor.inputValue(),'PRIVATE DEMO ONLY');
  await page.evaluate(()=>BLStorage.flushPending());
  assert.equal(writes.some(write=>write.body.includes('PRIVATE DEMO ONLY')),false);
  assert.equal(JSON.stringify(await api('/api/data/cp')).includes('PRIVATE DEMO ONLY'),false);
  console.log('PASS Orders: private paste undoes and redoes in one step and stays out of server writes.');

  await page.locator('nav.tabs button[data-tab="cp"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('#cpTable tbody tr[data-id]').length>=6);
  await page.evaluate(()=>{
    state.cp.rows.forEach(row=>{if(turknorm(row.Licensor)==='DTR')row.Licensor='DEMO LICENSOR';row._canEdit=true;row._canEditShared=true;});
    renderCP();
  });

  // 1) CP Delete: seçili Notes aralığı tek önizlemeyle temizlenir.
  await page.evaluate(()=>{const ids=[...document.querySelectorAll('#cpTable tbody tr[data-id]')].slice(0,3).map(tr=>tr.dataset.id);state.cp.rows.filter(r=>ids.includes(String(r._id))).forEach(r=>{r.Notes='SILINECEK';});renderCP();});
  await page.waitForTimeout(200);
  await selectRange('cpTable','Notes',0,'Notes',2);
  await page.keyboard.press('Delete');
  await page.waitForSelector('.blBulkOverlay');
  assert.match(await page.locator('.blBulkOverlay').innerText(),/CP temizleme önizlemesi|CP clear preview/);
  await applyBulk();
  for(const n of [0,1,2])assert.equal(await cpValue('cpTable','Notes',n),'');
  console.log('PASS CP: Delete clears the selected range through one previewed bulk save.');

  // 2) CP Ctrl+D: ilk satırın Sub-Mfr değeri alttaki satırlara doldurulur.
  await page.evaluate(()=>{const id=document.querySelector('#cpTable tbody tr[data-id]').dataset.id;state.cp.rows.find(r=>String(r._id)===id)['Sub-Manufacturer']='DOLDUR MFR';renderCP();});
  await page.waitForTimeout(200);
  await selectRange('cpTable','Sub-Manufacturer',0,'Sub-Manufacturer',2);
  await page.keyboard.press('Control+d');
  await page.waitForSelector('.blBulkOverlay');
  assert.match(await page.locator('.blBulkOverlay').innerText(),/aşağı doldurma|fill-down/);
  await applyBulk();
  for(const n of [1,2])assert.equal(await cpValue('cpTable','Sub-Manufacturer',n),'DOLDUR MFR');
  console.log('PASS CP: Ctrl+D fills the first row down through one previewed bulk save.');

  // 3) Orders: notlar dışındaki sütunlara da çoklu yapıştırma (asıl CP satırına yazılır).
  await page.evaluate(()=>{
    const keys=['Order Code','Model Name','Sub-Manufacturer','Supp. FOB','Notes'];
    colmgr.orders.hidden=new Set(ORDERS_COLS.map(col=>col.k).filter(key=>!keys.includes(key)));
    colmgr.orders.order=keys;
  });
  await page.locator('nav.tabs button[data-tab="orders"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('#ordersTable tbody tr[data-id]').length>=4,null,{timeout:60000});
  await page.evaluate(()=>renderOrders());await page.waitForTimeout(300);
  await selectRange('ordersTable','Supp. FOB',0,'Notes',1);
  await page.evaluate(()=>{const dt=new DataTransfer();dt.setData('text/plain','12,50\tORDERS NOT A\r\n13,75\tORDERS NOT B\r\n');document.getElementById('ordersTable').dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));});
  await page.waitForSelector('.blBulkOverlay');
  const preview=await page.locator('.blBulkOverlay').innerText();
  assert.match(preview,/Siparişler yapıştırma önizlemesi|Orders paste preview/);assert.match(preview,/^4 (değişiklik|change)/m);
  await applyBulk();
  assert.equal(Number(await cpValue('ordersTable','Supp. FOB',0)),12.5);
  assert.equal(Number(await cpValue('ordersTable','Supp. FOB',1)),13.75);
  assert.equal(await cpValue('ordersTable','Notes',0),'ORDERS NOT A');
  assert.equal(await cpValue('ordersTable','Notes',1),'ORDERS NOT B');
  // Orders görünümü de yeni değeri gösterir.
  await page.waitForFunction(()=>/ORDERS NOT A/.test(document.querySelector('#ordersTable tbody td[data-key="Notes"]')?.innerText||''),null,{timeout:5000});
  console.log('PASS Orders: multi-column paste (Supp. FOB + Notes) writes through canonical CP rows with preview.');

  // 3b) Kanonik CP satırının DTR kuralı, Orders gösterim değerinden önce gelir.
  await page.evaluate(()=>{
    const first=document.getElementById('ordersTable')._blRenderedRows[0];
    orderLinePeerRows('cp',first)[0].Licensor='DTR';
    renderOrders();
  });
  const subBefore=await cpValue('ordersTable','Sub-Manufacturer',0);
  await selectRange('ordersTable','Sub-Manufacturer',0,'Sub-Manufacturer',0);
  await page.evaluate(()=>{const dt=new DataTransfer();dt.setData('text/plain','YAZILMAMALI\tX\r\n');document.getElementById('ordersTable').dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));});
  await page.waitForTimeout(400);
  assert.equal(await cpValue('ordersTable','Sub-Manufacturer',0),subBefore);

  // 4) Orders Ctrl+D ve Delete.
  await page.locator('.blBulkOverlay [data-bulk-action]').first().click({timeout:1000}).catch(()=>{});
  await selectRange('ordersTable','Supp. FOB',0,'Supp. FOB',2);
  await page.keyboard.press('Control+d');await page.waitForSelector('.blBulkOverlay');await applyBulk();
  assert.equal(Number(await cpValue('ordersTable','Supp. FOB',2)),12.5);
  await selectRange('ordersTable','Notes',0,'Notes',1);
  await page.keyboard.press('Delete');await page.waitForSelector('.blBulkOverlay');await applyBulk();
  assert.equal(await cpValue('ordersTable','Notes',0),'');assert.equal(await cpValue('ordersTable','Notes',1),'');
  console.log('PASS Orders: Ctrl+D and Delete use the same canonical CP path.');

  await page.evaluate(personal=>{
    const keys=['Order Code','Notes',personal];
    colmgr.orders.hidden=new Set(ORDERS_COLS.map(col=>col.k).filter(key=>!keys.includes(key)));
    colmgr.orders.order=keys;
    renderOrders();
  },PERSONAL);
  const mixedColumns=await page.evaluate(()=>document.getElementById('ordersTable')._blRenderedColumns.map(col=>col.k));
  const mixed=mixedColumns.filter(key=>key==='Notes'||key===PERSONAL);
  assert.equal(Math.abs(mixedColumns.indexOf('Notes')-mixedColumns.indexOf(PERSONAL)),1);
  await selectRange('ordersTable',mixed[0],0,mixed[1],0);
  await paste('ordersTable',mixed.map(key=>key==='Notes'?'SHARED DEMO MIXED':'PERSONAL DEMO MIXED').join('	'));
  await page.waitForSelector('.blBulkOverlay');
  assert.match(await page.locator('.blBulkOverlay').innerText(),/^2 (değişiklik|change)/m);
  await applyBulk();
  assert.equal(await cpValue('ordersTable','Notes',0),'SHARED DEMO MIXED');
  assert.equal(await personalEditor.inputValue(),'PERSONAL DEMO MIXED');
  await page.keyboard.press('Control+z');
  await page.waitForFunction(key=>document.querySelector(`#ordersTable tbody td[data-key="${key}"] input`)?.value==='PRIVATE DEMO ONLY',PERSONAL);
  assert.equal(await cpValue('ordersTable','Notes',0),'');
  await page.keyboard.press('Control+y');
  await page.waitForFunction(key=>document.querySelector(`#ordersTable tbody td[data-key="${key}"] input`)?.value==='PERSONAL DEMO MIXED',PERSONAL);
  assert.equal(await cpValue('ordersTable','Notes',0),'SHARED DEMO MIXED');
  await page.evaluate(()=>BLStorage.flushPending());
  assert.equal(writes.some(write=>write.body.includes('PERSONAL DEMO MIXED')),false);
  console.log('PASS Orders: one Ctrl+Z and Ctrl+Y restore both sides of a mixed paste with shared server acknowledgement.');

  // 5) Kaydedildi mi: sunucudaki kalıcı override'larda görünür.
  const saved=await api('/api/data/cp');
  assert.ok((saved.cp?.rows||saved.rows||[]).some(row=>Number(row['Supp. FOB'])===12.5),'Supp. FOB sunucudan geri okunmalı');
  assert.equal(saved.rows.find(row=>String(row['Order Code'])===code)?.Notes,'SHARED DEMO MIXED');
  assert.deepEqual(errors,[]);
  console.log('PASS real UI: Orders multi-column paste, CP/Orders Delete clear and Ctrl+D fill-down persist through the shared bulk path.');
  console.log('Evidence: '+root);
})().catch(async error=>{console.error(error);if(page)await page.screenshot({path:path.join(root,'failure.png')}).catch(()=>{});console.error('Evidence: '+root);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.kill('SIGTERM');fs.closeSync(log);});
