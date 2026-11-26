'use strict';
// Real HTTP + Buyer Log UI with synthetic ASAS data and isolated persistence.
// CP → Collection when Supp. FOB / Sub-MFR are blank: FOB + Manufacturer become the confirmed price/manufacturer.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require('playwright'),XLSX=require('xlsx');
const app=path.resolve(__dirname,'..'),work=path.resolve(app,'../../work');fs.mkdirSync(work,{recursive:true});
const root=fs.mkdtempSync(path.join(work,'collection-order-fob-fallback-')),port=6493,base=`http://127.0.0.1:${port}`;
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
  // Çoğu kullanıcı Supp. FOB / Sub-MFR kullanmaz: iki sütun boş, yalnız FOB + Manufacturer dolu.
  // Bir satırda Supp. FOB dolu kalır: o satır Supp. FOB'u almaya devam etmeli.
  await page.evaluate(()=>{
    applyLanguage('tr');
    state.cp.rows.forEach(row=>{row['Sub-Manufacturer']='';row['Supp. FOB']=Number(row['FOB ($)'])===7.4?6.3:'';row._suppFobManual=true;});
    state.cpSelected=new Set(state.cp.rows.map(row=>row._id));renderCP();updateShippingBtnVisibility();
  });
  await page.waitForFunction(()=>{const key=JSON.stringify([kolWorkspaceRevision,kolRows]);const same=window.__kolSettle===key;window.__kolSettle=key;return same;},null,{polling:1000,timeout:30000});
  await page.evaluate(()=>document.getElementById('cpCopyToKolBtn').click());
  const preview=page.locator('#cpKolBackfillPreview');await preview.waitFor({state:'visible'});
  const text=await preview.innerText();
  if(process.env.DEBUG_SYNC)console.log(text);
  assert.match(text,/2 yeni satır/);
  assert.match(text,/DEMO MAIN FACTORY · 5,20/);
  assert.match(text,/DEMO MAIN FACTORY · 6,30/);
  assert.match(text,/Supp\. FOB doluysa ondan, boşsa FOB’dan/);
  assert.doesNotMatch(text,/Supp\. FOB yok/);
  const assets=path.join(app,'public/release-notes/next-assets');fs.mkdirSync(assets,{recursive:true});
  await page.screenshot({path:path.join(assets,'collection-order-fob-fallback.png')});
  await preview.locator('[data-backfill-apply]').click();await preview.waitFor({state:'detached'});
  const rows=await page.evaluate(()=>kolRows.map(row=>({plmId:row.plmId,quantity:row.quantity,confirmed:row.confirmedManufacturer,pricing:row.pricing,fob:row.fob,targetPrice:row.targetPrice,basis:row._sourceOrderDetails?.priceBasis||row._sourceOrders?.[0]?.details?.priceBasis})));
  if(process.env.DEBUG_SYNC)console.log(JSON.stringify(rows,null,1));
  const polo=rows.find(row=>row.plmId==='990101'),cardigan=rows.find(row=>row.plmId==='990202');
  assert.equal(polo.quantity,'2000');
  assert.equal(polo.confirmed,'DEMO MAIN FACTORY');
  assert.deepEqual(Object.keys(polo.pricing),['DEMO MAIN FACTORY']);
  assert.match(String(polo.pricing['DEMO MAIN FACTORY']),/^5[.,]2/);
  assert.equal(cardigan.confirmed,'DEMO MAIN FACTORY');
  assert.match(String(cardigan.pricing['DEMO MAIN FACTORY']),/^6[.,]3/);
  assert.deepEqual(errors,[]);
  console.log('PASS real UI: blank Supp. FOB/Sub-MFR → FOB + Manufacturer; filled Supp. FOB still wins; screenshot captured. Collection FOB: '+JSON.stringify(rows.map(r=>[r.plmId,r.fob])));
  console.log('Evidence: '+root);
})().catch(async error=>{console.error(error);if(page)await page.screenshot({path:path.join(root,'failure.png')}).catch(()=>{});console.error('Evidence: '+root);process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();
  // Sunucu SIGTERM ile kapanmazsa yalıtılmış veri klasörüne yazmaya devam etmesin.
  if(server.exitCode==null&&server.signalCode==null){
    const exited=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');
    const timer=setTimeout(()=>server.kill('SIGKILL'),5000);await exited;clearTimeout(timer);
  }
  fs.closeSync(log);
});
