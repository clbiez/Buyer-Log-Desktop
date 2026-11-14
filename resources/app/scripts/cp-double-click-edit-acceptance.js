'use strict';
// Gerçek HTTP + Buyer Log UI, sentetik demo verisi, izole kalıcılık.
// CP: tek tık seçer, çift tık düzenler, klavye doğrudan düzenler; çoklu hücre
// kopyala/yapıştır çalışır; açılır pencereler dışarı tıklamayla kapanır.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require('playwright'),XLSX=require('xlsx');
const app=path.resolve(__dirname,'..'),work=path.resolve(app,'../../work');fs.mkdirSync(work,{recursive:true});
const root=fs.mkdtempSync(path.join(work,'cp-dblclick-acceptance-')),port=6491,base=`http://127.0.0.1:${port}`;
const env={...process.env,BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')};
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_TEMP_ROOT']){env[key]=path.join(root,key.toLowerCase());fs.mkdirSync(env[key],{recursive:true});}
const source=path.join(root,'source');fs.mkdirSync(source);
fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',sourceFolder:source,refreshWithExcel:false,updates:{enabled:false}}));
const demo=require('./generate-demo-data').build({rows:12,seed:11,today:new Date('2026-11-06T00:00:00Z')});
for(const [name,sheet,rows]of [['ASAS.xlsx','ASAS',demo.asas],['Antrepo.xlsx','Antrepo',demo.antrepo]]){const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),sheet);XLSX.writeFile(wb,path.join(source,name));}
const log=fs.openSync(path.join(root,'server.log'),'a'),server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});let browser,cookie,page;
async function api(url,body,method=body?'POST':'GET',expected=200){const response=await fetch(base+url,{method,headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.equal(response.status,expected,await response.clone().text());return response.json();}
async function refresh(){await api('/api/refresh',{},'POST',202);for(let i=0;i<160;i++){if(!(await api('/api/refresh-status')).running)return;await new Promise(r=>setTimeout(r,200));}throw Error('Refresh timeout');}
const active=()=>page.evaluate(()=>{const el=document.activeElement;return {tag:el?.tagName,key:el?.dataset?.key||'',id:el?.closest?.('tr[data-id]')?.dataset?.id||'',table:el?.id||''};});
const gridState=()=>page.evaluate(()=>{const s=BLGridClipboard.state('cpTable');return {active:s.activeCell,range:s.selectionRange};});
(async()=>{
  for(let i=0;i<160;i++){try{if((await fetch(base+'/api/health')).status<500)break;}catch{}await new Promise(r=>setTimeout(r,200));}
  const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',newPassword:'demo-dblclick-123',password:'demo-dblclick-123'})});
  assert.equal(login.status,200,await login.clone().text());cookie=login.headers.get('set-cookie').split(';')[0];
  await refresh();
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1600,height:820},reducedMotion:'reduce'}),sep=cookie.indexOf('=');
  await context.addCookies([{name:cookie.slice(0,sep),value:cookie.slice(sep+1),url:base}]);
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:base});
  await context.addInitScript(()=>localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0'));
  page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof switchTab==='function',null,{timeout:60000});
  await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).first().click({timeout:5000}).catch(()=>{});
  await page.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:60000});
  await page.locator('nav.tabs button[data-tab="cp"]').click();await page.waitForFunction(()=>document.querySelectorAll('#cpTable tbody tr[data-id]').length>=6);
  await page.evaluate(()=>{
    applyLanguage('tr');const keys=['Order Code','Model Name','Sub-Manufacturer','Supp. FOB','Ex-factory','Del. Type'];
    state.cp.rows.forEach(row=>{if(turknorm(row.Licensor)==='DTR')row.Licensor='DEMO LICENSOR';row._canEdit=true;row._canEditShared=true;});
    colmgr.cp.hidden=new Set(CP_COLS.map(col=>col.k).filter(key=>!keys.includes(key)));colmgr.cp.order=keys;renderCP();
  });
  await page.waitForFunction(()=>document.querySelectorAll('#cpTable tbody td[data-key="Sub-Manufacturer"] input.editCell').length>=4);
  const sub=n=>page.locator('#cpTable tbody tr[data-id] td[data-key="Sub-Manufacturer"]').nth(n);
  const fob=n=>page.locator('#cpTable tbody tr[data-id] td[data-key="Supp. FOB"]').nth(n);

  // 1) Tek tık: hücre seçilir, editör odak almaz.
  await sub(0).locator('input').click();
  let a=await active();assert.notEqual(a.tag,'INPUT','tek tık editörü açmamalı');
  let g=await gridState();assert.equal(g.active.columnId,'Sub-Manufacturer');
  assert.ok(await sub(0).evaluate(td=>td.classList.contains('blGridActiveCell')));

  // 2) Çift tık: editör açılır; yazılan değer başka hücreye tıklayınca kaydedilir.
  await sub(0).locator('input').dblclick();
  a=await active();assert.equal(a.tag,'INPUT');assert.equal(a.key,'Sub-Manufacturer');
  await page.keyboard.press('Control+A');await page.keyboard.type('DEMO MFR A');
  const row0=a.id;
  // 3) Klavye geçişi doğrudan düzenleme modunda açar (tümü seçili).
  await page.keyboard.press('ArrowDown');
  a=await active();assert.equal(a.tag,'INPUT','ok tuşu hedef hücreyi düzenleme modunda açmalı');assert.notEqual(a.id,row0);
  const sel=await page.evaluate(()=>[document.activeElement.selectionStart,document.activeElement.selectionEnd,document.activeElement.value.length]);
  assert.equal(sel[0],0);assert.equal(sel[1],sel[2]);
  await page.waitForFunction(id=>String(state.cp.rows.find(r=>String(r._id)===id)['Sub-Manufacturer'])==='DEMO MFR A',row0);
  g=await gridState();assert.equal(String(g.active.rowId),a.id,'grid seçimi odaklanan editörü izler');

  // 4) Esc: değeri geri alır, seçim moduna döner.
  const before=await page.evaluate(()=>document.activeElement.value);
  await page.keyboard.type('IPTAL EDILECEK');await page.keyboard.press('Escape');
  a=await active();assert.equal(a.table,'cpTable');
  assert.equal(await page.evaluate(id=>String(state.cp.rows.find(r=>String(r._id)===id)['Sub-Manufacturer']??''),String(g.active.rowId)),before);

  // 5) Seçim modunda ok: hedef düzenlenebilir hücre doğrudan düzenleme modunda.
  await sub(2).locator('input').click();await page.keyboard.press('ArrowDown');
  a=await active();assert.equal(a.tag,'INPUT');assert.equal(a.key,'Sub-Manufacturer');
  // Shift+Aşağı düzenlemeden çıkıp kopyalama aralığını genişletir.
  await page.keyboard.press('Escape');await page.keyboard.press('Shift+ArrowDown');
  g=await gridState();assert.equal(g.range.endRow-g.range.startRow,1);

  // 6) Seçili hücrede yazmaya başlamak düzenlemeyi açar.
  await sub(4).locator('input').click();await page.keyboard.type('Q');
  a=await active();assert.equal(a.tag,'INPUT');assert.equal(await page.evaluate(()=>document.activeElement.value),'Q');
  await page.keyboard.press('Escape');

  // 7) Editörler üzerinde sürükleyerek çoklu hücre seçimi + Ctrl+C / Ctrl+V.
  await page.evaluate(()=>{state.cp.rows.forEach((r,i)=>{if(i<2)r['Sub-Manufacturer']='COPY '+i;});renderCP();});
  await page.waitForTimeout(200);
  const s0=await sub(0).boundingBox(),f1=await fob(1).boundingBox();
  await page.mouse.move(s0.x+s0.width/2,s0.y+s0.height/2);await page.mouse.down();
  await page.mouse.move(f1.x+f1.width/2,f1.y+f1.height/2,{steps:6});await page.mouse.up();
  g=await gridState();
  const colSpan=await page.evaluate(()=>{const cols=document.getElementById('cpTable')._blRenderedColumns.map(c=>c.k);return Math.abs(cols.indexOf('Supp. FOB')-cols.indexOf('Sub-Manufacturer'));});
  assert.deepEqual([g.range.endRow-g.range.startRow,g.range.endColumn-g.range.startColumn],[1,colSpan],'2 satırlık aralık');
  a=await active();assert.notEqual(a.tag,'INPUT');
  if(process.env.BL_RELEASE_SHOT){const assets=path.join(app,'public/release-notes/next-assets');fs.mkdirSync(assets,{recursive:true});await page.mouse.move(5,400);await page.screenshot({path:path.join(assets,'cp-double-click-edit.png'),clip:{x:0,y:0,width:1600,height:640}});}
  await page.evaluate(()=>{window.__blCopied=null;const original=window.copyRichToClipboard;window.copyRichToClipboard=async(html,plain)=>{window.__blCopied=plain;return true;};window.__blRestoreCopy=()=>{window.copyRichToClipboard=original;};});
  await page.keyboard.press('Control+C');
  await page.waitForFunction(()=>window.__blCopied!=null,null,{timeout:3000});
  const copied=await page.evaluate(()=>{window.__blRestoreCopy();return window.__blCopied;});
  assert.equal(copied.split(/\r?\n/).filter(Boolean).length,2);assert.match(copied,/^COPY 0\t/);
  await sub(3).click();await page.keyboard.press('Escape').catch(()=>{});
  await sub(3).locator('input').click();
  // Sistem panosu headless'ta güvenilir değil: gerçek paste olayı aynı metinle gönderilir.
  await page.evaluate(text=>{const dt=new DataTransfer();dt.setData('text/plain',text);document.activeElement.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));},copied);
  // Çoklu hücre yapıştırma toplu işlem önizlemesiyle onaylanır.
  await page.locator('[data-bulk-action="apply"]').click({timeout:5000});
  await page.waitForFunction(()=>{const rows=[...document.querySelectorAll('#cpTable tbody tr[data-id]')].slice(3,5).map(tr=>String(state.cp.rows.find(r=>String(r._id)===tr.dataset.id)['Sub-Manufacturer']));return rows[0]==='COPY 0'&&rows[1]==='COPY 1';},null,{timeout:5000});

  // Sunucu kaydı onay penceresini kapat.
  await page.locator('.blBulkOverlay button').filter({hasText:/Kapat|Close/}).click({timeout:10000});
  await page.waitForFunction(()=>!document.querySelector('.blBulkOverlay'),null,{timeout:5000});

  // Tek hücreye tek değer: önizleme açmadan doğrudan kaydedilir.
  await sub(5).locator('input').click();
  const row5=await sub(5).evaluate(td=>td.closest('tr').dataset.id);
  await page.evaluate(()=>{const dt=new DataTransfer();dt.setData('text/plain','TEK DEGER\r\n');document.activeElement.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));});
  await page.waitForFunction(id=>String(state.cp.rows.find(r=>String(r._id)===id)['Sub-Manufacturer'])==='TEK DEGER',row5,{timeout:3000});
  assert.equal(await page.locator('.blBulkOverlay').count(),0,'tek hücre yapıştırma önizleme açmamalı');

  // 8) Tarih: tek tık açmaz; çift tık açar; takvim başka hücreye tıklayınca kapanır.
  const exf=page.locator('#cpTable tbody tr[data-id] td[data-key="Ex-factory"] .exfDisplay').first();
  await exf.click();await page.waitForTimeout(150);
  assert.equal(await page.locator('#cpTable tbody td[data-key="Ex-factory"] input.dateKeyboardInput').count(),0,'tek tık tarih editörünü açmamalı');
  await exf.dblclick();
  await page.waitForSelector('#cpTable tbody td[data-key="Ex-factory"] .datePickerBtn');
  await page.locator('#cpTable tbody td[data-key="Ex-factory"] .datePickerBtn').first().click();
  await page.waitForSelector('.dateCalendarPopup');
  await page.screenshot({path:path.join(root,'calendar-open.png')});
  await sub(5).click();
  await page.waitForFunction(()=>!document.querySelector('.dateCalendarPopup'),null,{timeout:3000});

  // 9) Del. Type menüsü: tek tık açmaz, çift tık açar, dışarı tık kapatır.
  const del=page.locator('#cpTable tbody td[data-key="Del. Type"] .delTypeTrigger').first();
  await del.click();await page.waitForTimeout(150);
  assert.equal(await page.locator('.delTypeMenu').count(),0,'tek tık menüyü açmamalı');
  await del.dblclick();await page.waitForSelector('.delTypeMenu');
  await sub(5).click();await page.waitForFunction(()=>!document.querySelector('.delTypeMenu'),null,{timeout:3000});

  // 10) Sub-Mfr öneri listesi dışarı tıklamayla kapanır.
  await sub(1).locator('input').dblclick();await page.keyboard.press('Control+A');await page.keyboard.press('Backspace');
  await page.waitForSelector('.submfrDrop');
  await fob(5).click();await page.waitForFunction(()=>!document.querySelector('.submfrDrop'),null,{timeout:3000});

  // 11) Orders aynı motoru kullanır: tek tık seçer, çift tık düzenler.
  await page.locator('nav.tabs button[data-tab="orders"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('#ordersTable tbody tr[data-id]').length>=3,null,{timeout:60000});
  const ordersEditor=page.locator('#ordersTable tbody td[data-key] input.editCell:not([disabled])').first();
  if(await ordersEditor.count()){
    await ordersEditor.click();a=await active();assert.notEqual(a.tag,'INPUT','Orders: tek tık editörü açmamalı');
    assert.ok(await page.evaluate(()=>Boolean(BLGridClipboard.state('ordersTable').activeCell)));
    await ordersEditor.dblclick();a=await active();assert.equal(a.tag,'INPUT','Orders: çift tık düzenlemeyi açmalı');
    console.log('PASS Orders: single click selects, double click edits.');
  }else{
    const del2=page.locator('#ordersTable tbody td[data-key="Del. Type"] .delTypeTrigger').first();
    assert.ok(await del2.count(),'Orders: düzenlenebilir hücre bulunamadı');
    await del2.click();await page.waitForTimeout(150);assert.equal(await page.locator('.delTypeMenu').count(),0,'Orders: tek tık menüyü açmamalı');
    await del2.dblclick();await page.waitForSelector('.delTypeMenu');
    await page.locator('#ordersTable tbody td[data-key]').nth(1).click();await page.waitForFunction(()=>!document.querySelector('.delTypeMenu'),null,{timeout:3000});
    console.log('PASS Orders: Del. Type opens on double click only and closes on outside click.');
  }

  assert.deepEqual(errors,[]);
  console.log('PASS real UI: single click selects, double click edits, keyboard enters edit, Esc reverts, Shift+Arrow range, type-to-edit, multi-cell copy/paste with preview, direct single-cell paste, date/Del. Type/Sub-Mfr popups close on outside click.');
  console.log('Evidence: '+root);
})().catch(async error=>{console.error(error);if(page)await page.screenshot({path:path.join(root,'failure.png')}).catch(()=>{});console.error('Evidence: '+root);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.kill('SIGTERM');fs.closeSync(log);});
