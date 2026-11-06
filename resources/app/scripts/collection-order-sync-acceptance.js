'use strict';
// Real HTTP + Buyer Log UI with synthetic ASAS data and isolated persistence.
// CP → Collection: Sub MFR + Supp. FOB, in-place update by MB month + PLM ID + Colour Code.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require('playwright'),XLSX=require('xlsx');
const app=path.resolve(__dirname,'..'),work=path.resolve(app,'../../work');fs.mkdirSync(work,{recursive:true});
const root=fs.mkdtempSync(path.join(work,'collection-order-sync-')),port=6491,base=`http://127.0.0.1:${port}`;
const env={...process.env,BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')};
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_TEMP_ROOT']){env[key]=path.join(root,key.toLowerCase());fs.mkdirSync(env[key],{recursive:true});}
const source=path.join(root,'source');fs.mkdirSync(source);fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',sourceFolder:source,refreshWithExcel:false,updates:{enabled:false}}));
const demo=require('./generate-demo-data').build({rows:3,seed:7,today:new Date('2026-11-06T00:00:00Z')}),header=demo.asas[2];
const orders=[
  {code:820001,model:'DEMO KNIT POLO',plm:990101,colour:'BLK',qty:1200,fob:5.2},
  {code:820002,model:'DEMO KNIT POLO',plm:990101,colour:'BLK',qty:800,fob:5.2},
  {code:820003,model:'DEMO KNIT CARDIGAN',plm:990202,colour:'NVY',qty:600,fob:7.4},
];
orders.forEach((order,index)=>{
  const values={'Sipariş Kod':order.code,'Model Adı':order.model,'Renk Kod':order.colour,'Renk':order.colour==='BLK'?'BLACK':'NAVY','Plm Kod':order.plm,
    'Net Alım Sipariş Miktarı':order.qty,'Kalan Alım Sipariş Miktarı':order.qty,'Antrepoya Giren Miktar':0,'FOB Fiyatı':order.fob,'Üretici':'DEMO MAIN FACTORY','Lisans':'',
    'Sezon':'6W26','Siparişin Üretildiği Ülke':'TURKIYE','Buyer':'Demo Buyer','Kumaş Tipi':'Jersey',
    'Orijinal Exfactory Merch Tarih':index===1?'2026-11-20':'2026-11-10','Sipariş Yerleştirme MerchTarih':index===1?'2026-07-01':'2026-07-15',
    'Retail Depo Tarih Yıl Ay Gün':'2026-12-14','Model Bütçe Tarih Yıl Ay Gün':'2026-12-28','Buying Son Onay Tarihi':null};
  for(const [key,value]of Object.entries(values))demo.asas[3+index][header.indexOf(key)]=value;
});
for(const [name,sheet,rows]of [['ASAS.xlsx','ASAS',demo.asas],['Antrepo.xlsx','Antrepo',[demo.antrepo[0]]]]){const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),sheet);XLSX.writeFile(wb,path.join(source,name));}
const log=fs.openSync(path.join(root,'server.log'),'a'),server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});let browser,cookie,page;
async function api(url,body,method=body?'POST':'GET',expected=200){const response=await fetch(base+url,{method,headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.equal(response.status,expected,await response.clone().text());return response.json();}
async function refresh(){await api('/api/refresh',{},'POST',202);for(let i=0;i<160;i++){if(!(await api('/api/refresh-status')).running)return;await new Promise(r=>setTimeout(r,200));}throw Error('Refresh timed out');}
(async()=>{
  for(let i=0;i<160;i++){try{if((await fetch(base+'/api/health')).status<500)break;}catch{}await new Promise(r=>setTimeout(r,200));}
  const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',newPassword:'demo-sync-123',password:'demo-sync-123'})});
  assert.equal(login.status,200,await login.clone().text());cookie=login.headers.get('set-cookie').split(';')[0];
  await refresh();assert.equal((await api('/api/data/cp')).rows.length,3);
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/opt/pw-browsers/chromium',args:['--no-sandbox']}).catch(()=>chromium.launch({headless:true}));
  const context=await browser.newContext({viewport:{width:1600,height:900},reducedMotion:'reduce'}),separator=cookie.indexOf('=');
  await context.addCookies([{name:cookie.slice(0,separator),value:cookie.slice(separator+1),url:base}]);
  await context.addInitScript(()=>localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0'));
  page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof switchTab==='function',null,{timeout:60000});
  await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).first().click({timeout:5000}).catch(()=>{});
  await page.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:60000});
  await page.locator('nav.tabs button[data-tab="koleksiyon"]').click();
  await page.waitForFunction(()=>typeof kolWorkspaceCanEdit!=='undefined'&&kolWorkspaceCanEdit&&kolIsOwnWorkspace(),null,{timeout:60000});
  await page.locator('nav.tabs button[data-tab="cp"]').click();await page.waitForFunction(()=>document.querySelectorAll('#cpTable tbody tr').length>=3);
  // Demo CP satırlarında üretimi alt üretici yapar ve Supp. FOB nihai FOB'dan düşüktür.
  const seeded=await page.evaluate(()=>{
    applyLanguage('tr');
    state.cp.rows.forEach(row=>{row['Sub-Manufacturer']='DEMO SUB ÖRME';row['Supp. FOB']=Number(row['FOB ($)'])===5.2?4.4:6.3;});
    const polo=state.cp.rows.find(row=>row['Order Code']===820001),mapped=cpRowToKolRow(polo,false);
    // Koleksiyonda aynı MB ayı + PLM ID + Renk Kodu ile önceden fiyatlanmış kayıt.
    const existing=migrateKolRow({id:kolNextId++,plmId:'990101',modelKod:'DEMO KNIT POLO',colourCode:'BLK',colour:'BLACK',inStoreMonth:mapped.inStoreMonth,
      quantity:'1500',mag:'',buyer:'',country:'',confirmedManufacturer:'DEMO OLD FACTORY',pricing:{'DEMO OLD FACTORY':'4,10','DEMO QUOTE':'4,35'},
      targetPrice:'4,00',trPrice:'250',trFx:'41',durum:'Fiyatlama',not:'Manuel fiyat çalışması'});
    kolRows=[existing,...kolRows];saveKolRows();
    state.cpSelected=new Set(state.cp.rows.map(row=>row._id));renderCP();updateShippingBtnVisibility();
    return {existingId:existing.id,month:mapped.inStoreMonth};
  });
  assert.match(seeded.month,/^\d{6}$/);
  // Tohum kaydının yerel/sunucu kaydı ve revizyonu otursun; önizleme bayat-veri korumasını tetiklemesin.
  await page.waitForFunction(()=>{const key=JSON.stringify([kolWorkspaceRevision,kolRows]);const same=window.__kolSettle===key;window.__kolSettle=key;return same;},null,{polling:1000,timeout:30000});
  await page.evaluate(()=>document.getElementById('cpCopyToKolBtn').click());
  const preview=page.locator('#cpKolBackfillPreview');await preview.waitFor({state:'visible'});
  const text=await preview.innerText();
  assert.match(text,/1 yeni satır · 1 mevcut kayıt güncellenecek/);
  assert.match(text,/DEMO OLD FACTORY · 4,10/);
  assert.match(text,/DEMO SUB ÖRME · 4,40/);
  assert.doesNotMatch(text,/DEMO MAIN FACTORY/);
  await preview.locator('[data-price-approve]').first().check();
  const assets=path.join(app,'public/release-notes/next-assets');fs.mkdirSync(assets,{recursive:true});
  await page.screenshot({path:path.join(assets,'collection-order-sync.png')});
  await page.evaluate(()=>{window.__toasts=[];const original=showToast;window.showToast=showToast=(msg,opts)=>{window.__toasts.push(String(msg));return original(msg,opts);};});
  await preview.locator('[data-backfill-apply]').click();await preview.waitFor({state:'detached'});
  if(process.env.DEBUG_SYNC)console.log(await page.evaluate(()=>window.__toasts));
  const result=await page.evaluate(id=>({rows:kolRows.map(row=>({id:row.id,plmId:row.plmId,colourCode:row.colourCode,quantity:row.quantity,confirmed:row.confirmedManufacturer,
    pricing:row.pricing,fob:row.fob,trPrice:row.trPrice,durum:row.durum,country:row.country,buyer:row.buyer,opd:row.opd,exFactory:row.exFactory,not:row.not,trail:row._orderPriceChanges})),id}),seeded.existingId);
  if(process.env.DEBUG_SYNC)console.log(JSON.stringify(result,null,1));
  const updated=result.rows.filter(row=>row.plmId==='990101');
  assert.equal(updated.length,1,'existing record is not duplicated');
  const row=updated[0];
  assert.equal(row.id,seeded.existingId);
  assert.equal(row.quantity,'2000');
  assert.equal(row.confirmed,'DEMO SUB ÖRME');
  assert.deepEqual(row.pricing,{'DEMO OLD FACTORY':'4,10','DEMO QUOTE':'4,35','DEMO SUB ÖRME':'4,40'});
  assert.equal(row.fob,'4,40','no license rule: FOB equals Supp. FOB, royalty is not added twice');
  assert.equal(row.trPrice,'250');assert.equal(row.durum,'Fiyatlama');assert.equal(row.not,'Manuel fiyat çalışması');
  assert.equal(row.buyer,'Demo Buyer');assert.ok(row.country);assert.equal(row.opd,'2026-07-01');assert.equal(row.exFactory,'2026-11-20');
  assert.equal(row.trail.length,1);assert.equal(row.trail[0].from.name,'DEMO OLD FACTORY');
  const cardigan=result.rows.find(item=>item.plmId==='990202');
  assert.equal(cardigan.confirmed,'DEMO SUB ÖRME');assert.deepEqual(cardigan.pricing,{'DEMO SUB ÖRME':'6.3'});assert.equal(cardigan.fob,'6,30');
  // Aynı siparişleri tekrar aktarmak yeni satır veya çift adet üretmez.
  await page.evaluate(()=>{state.cpSelected=new Set(state.cp.rows.map(row=>row._id));document.getElementById('cpCopyToKolBtn').click();});
  await page.waitForTimeout(400);
  assert.equal(await page.locator('#cpKolBackfillPreview').count(),0);
  assert.equal(await page.evaluate(()=>kolRows.filter(row=>row.plmId==='990101').length),1);
  assert.deepEqual(errors,[]);
  console.log('PASS real UI: Sub MFR + Supp. FOB, in-place update by MB month + PLM ID + Colour Code, approval-gated price change, history inputs kept, idempotent re-import; screenshot captured.');
  console.log('Evidence: '+root);
})().catch(async error=>{console.error(error);if(page)await page.screenshot({path:path.join(root,'failure.png')}).catch(()=>{});console.error('Evidence: '+root);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.kill('SIGTERM');fs.closeSync(log);});
