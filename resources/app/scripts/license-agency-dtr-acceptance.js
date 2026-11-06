'use strict';
// Real HTTP + Buyer Log UI with synthetic ASAS data and isolated persistence.
// A license whose royalty contracts all name a non-DTR licensor is not classified DTR
// just because its manufacturer is missing from NON-DTR MANUFACTURERS: Orders compute
// Supp. FOB with royalty for Turkey and overseas orders. A DTR license stays FOB = Supp. FOB.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require('playwright'),XLSX=require('xlsx');
const app=path.resolve(__dirname,'..'),work=path.resolve(app,'../../work');fs.mkdirSync(work,{recursive:true});
const root=fs.mkdtempSync(path.join(work,'license-agency-dtr-')),port=6493,base=`http://127.0.0.1:${port}`;
const env={...process.env,BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')};
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_TEMP_ROOT']){env[key]=path.join(root,key.toLowerCase());fs.mkdirSync(env[key],{recursive:true});}
const source=path.join(root,'source');fs.mkdirSync(source);fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',sourceFolder:source,refreshWithExcel:false,updates:{enabled:false}}));
const demo=require('./generate-demo-data').build({rows:3,seed:11,today:new Date('2026-11-06T00:00:00Z')}),header=demo.asas[2];
const LICENSE='Demo Racing',AGENCY='DEMO RACING AGENCY',MFR='DEMO RACING AGENCY TURKIYE';
const orders=[
  {code:830001,model:'DEMO RACING POLO',plm:991101,colour:'RED',license:LICENSE,mfr:MFR,country:'TURKIYE',fob:384.98},
  {code:830002,model:'DEMO RACING TEE',plm:991102,colour:'BLK',license:LICENSE,mfr:MFR,country:'INGILTERE',fob:12.5},
  {code:830003,model:'DEMO DTR TEE',plm:991103,colour:'WHT',license:'Demo Direct',mfr:'DEMO DIRECT FACTORY',country:'TURKIYE',fob:6.4},
];
orders.forEach((order,index)=>{
  const values={'Sipariş Kod':order.code,'Model Adı':order.model,'Renk Kod':order.colour,'Renk':order.colour,'Plm Kod':order.plm,
    'Net Alım Sipariş Miktarı':1000+index*100,'Kalan Alım Sipariş Miktarı':1000+index*100,'Antrepoya Giren Miktar':0,'FOB Fiyatı':order.fob,'Üretici':order.mfr,'Lisans':order.license,
    'Sezon':'6S27','Siparişin Üretildiği Ülke':order.country,'Buyer':'Demo Buyer','Kumaş Tipi':'Jersey',
    'Orijinal Exfactory Merch Tarih':'2026-12-25','Sipariş Yerleştirme MerchTarih':'2026-10-05',
    'Retail Depo Tarih Yıl Ay Gün':'2027-01-20','Model Bütçe Tarih Yıl Ay Gün':'2027-02-01','Buying Son Onay Tarihi':null};
  for(const [key,value]of Object.entries(values))demo.asas[3+index][header.indexOf(key)]=value;
});
for(const [name,sheet,rows]of [['ASAS.xlsx','ASAS',demo.asas],['Antrepo.xlsx','Antrepo',[demo.antrepo[0]]]]){const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),sheet);XLSX.writeFile(wb,path.join(source,name));}
const log=fs.openSync(path.join(root,'server.log'),'a'),server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});let browser,cookie,page;
async function api(url,body,method=body?'POST':'GET',expected=200){const response=await fetch(base+url,{method,headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.equal(response.status,expected,await response.clone().text());return response.json();}
async function refresh(){await api('/api/refresh',{},'POST',202);for(let i=0;i<160;i++){if(!(await api('/api/refresh-status')).running)return;await new Promise(r=>setTimeout(r,200));}throw Error('Refresh timed out');}
(async()=>{
  for(let i=0;i<160;i++){try{if((await fetch(base+'/api/health')).status<500)break;}catch{}await new Promise(r=>setTimeout(r,200));}
  const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',newPassword:'demo-lic-123',password:'demo-lic-123'})});
  assert.equal(login.status,200,await login.clone().text());cookie=login.headers.get('set-cookie').split(';')[0];
  const current=await api('/api/pricing-rules');
  await api('/api/pricing-rules',{expectedRevision:current.revision,rules:[{id:'demo-racing',license:LICENSE,licensor:AGENCY,royalty:24.5,trCommission:0,ydCommission:0,hologramCost:0.16,seasons:[],categories:[],opdStart:'',opdEnd:''}]},'PUT');
  await refresh();
  const rows=(await api('/api/data/orders')).orders,byCode=code=>rows.find(row=>Number(row['Order Code'])===code);
  assert.equal(byCode(830001).Licensor,AGENCY);assert.equal(byCode(830001)['Supp. FOB'],290.54);
  assert.equal(byCode(830002).Licensor,AGENCY);assert.equal(byCode(830002)['Supp. FOB'],9.32);
  assert.equal(byCode(830003).Licensor,'DTR');assert.equal(byCode(830003)['Supp. FOB'],6.4);
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/opt/pw-browsers/chromium',args:['--no-sandbox']}).catch(()=>chromium.launch({headless:true}));
  const context=await browser.newContext({viewport:{width:1920,height:640},reducedMotion:'reduce'}),separator=cookie.indexOf('=');
  await context.addCookies([{name:cookie.slice(0,separator),value:cookie.slice(separator+1),url:base}]);
  await context.addInitScript(()=>localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0'));
  page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof switchTab==='function',null,{timeout:60000});
  await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).first().click({timeout:5000}).catch(()=>{});
  await page.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:60000});
  await page.evaluate(()=>applyLanguage('en'));
  await page.locator('nav.tabs button[data-tab="orders"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('#ordersTable tbody tr').length>=3,null,{timeout:60000});
  const ui=await page.evaluate(()=>state.orders.rows.map(row=>({code:Number(row['Order Code']),licensor:row.Licensor,supp:row['Supp. FOB']})));
  assert.deepEqual(ui.sort((a,b)=>a.code-b.code),[{code:830001,licensor:AGENCY,supp:290.54},{code:830002,licensor:AGENCY,supp:9.32},{code:830003,licensor:'DTR',supp:6.4}]);
  const hover=await page.evaluate(()=>suppFobHoverText(state.orders.rows.find(row=>Number(row['Order Code'])===830001)));
  assert.match(hover,/24,5/);
  // Göster: Licensor → Supp. FOB sütunları; ilgisiz bildirimi kapat.
  await page.evaluate(()=>{
    // Demo kaynağın ilgisiz "uyarı var" bildirimi görüntüyü kapatmasın.
    [...document.querySelectorAll('body *')].filter(el=>getComputedStyle(el).position==='fixed'&&/uyarı var|warnings?/i.test(el.textContent||'')&&el.textContent.length<300).forEach(el=>{el.style.display='none';});
    const heads=[...document.querySelectorAll('#ordersTable thead th')],at=re=>heads.find(th=>re.test(th.textContent.trim()));
    const start=at(/^(MANUFACTURER|ÜRETİCİ)/i)||at(/^LICENSOR/i);let scroller=start&&start.parentElement;
    while(scroller&&scroller.scrollWidth<=scroller.clientWidth+4)scroller=scroller.parentElement;
    if(start&&scroller)scroller.scrollLeft=Math.max(0,start.getBoundingClientRect().left-scroller.getBoundingClientRect().left+scroller.scrollLeft-8);
  }).catch(()=>{});
  if(process.env.DEBUG_HEADS)console.log(await page.evaluate(()=>[...document.querySelectorAll('#ordersTable thead tr:last-child th')].map(th=>th.textContent.trim()+'@'+Math.round(th.getBoundingClientRect().left)).join(' | ')));
  await page.waitForTimeout(600);
  const assets=path.join(app,'public/release-notes/next-assets');fs.mkdirSync(assets,{recursive:true});
  await page.screenshot({path:path.join(assets,'license-agency-royalty-orders.png')});
  assert.deepEqual(errors,[]);
  console.log('PASS real UI: agency-only license computes royalty Supp. FOB for Turkey and overseas orders; DTR license keeps FOB; screenshot captured.');
  console.log('Evidence: '+root);
})().catch(async error=>{console.error(error);if(page)await page.screenshot({path:path.join(root,'failure.png')}).catch(()=>{});console.error('Evidence: '+root);process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();
  if(server.exitCode==null&&server.signalCode==null){
    const exited=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');
    const timer=setTimeout(()=>server.kill('SIGKILL'),5000);await exited;clearTimeout(timer);
  }
  fs.closeSync(log);
});
