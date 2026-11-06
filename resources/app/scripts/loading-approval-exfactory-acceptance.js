'use strict';
// Real HTTP and Buyer Log UI with synthetic ASAS/IAS and isolated persistence.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require('playwright'),XLSX=require('xlsx');
const app=path.resolve(__dirname,'..'),work=path.resolve(app,'../../work');fs.mkdirSync(work,{recursive:true});
const root=fs.mkdtempSync(path.join(work,'approval-acceptance-')),port=6488,base=`http://127.0.0.1:${port}`;
const env={...process.env,BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')};
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_TEMP_ROOT']){env[key]=path.join(root,key.toLowerCase());fs.mkdirSync(env[key],{recursive:true});}
const source=path.join(root,'source');fs.mkdirSync(source);fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',sourceFolder:source,refreshWithExcel:false,updates:{enabled:false}}));
const demo=require('./generate-demo-data').build({rows:3,seed:7,today:new Date('2026-11-06T00:00:00Z')}),header=demo.asas[2];
for(let i=3;i<demo.asas.length;i++){
 const values={'Sipariş Kod':810001+i-3,'Model Adı':['DEMO AUTO APPROVAL','DEMO MANUAL REVISION','DEMO ASAS DATE'][i-3],'Renk Kod':'BLK','Renk':'BLACK','Plm Kod':990001+i-3,'Net Alım Sipariş Miktarı':100,'Kalan Alım Sipariş Miktarı':100,'Antrepoya Giren Miktar':0,'Siparişin Üretildiği Ülke':'CIN','Üretici':'DEMO FACTORY','Lisans':'','Sezon':'S6','Orijinal Exfactory Merch Tarih':'2026-10-30','Initial Inspection Geçme Tarih Gün Ay Yıl':'2026-10-30','Buying Son Onay Tarihi':i===3?'2026-11-05':i===4?'2026-10-25':null,'Sipariş Yerleştirme MerchTarih':'2026-10-01','Retail Depo Tarih Yıl Ay Gün':'2026-12-14','Model Bütçe Tarih Yıl Ay Gün':'2026-12-28'};
 for(const [key,value]of Object.entries(values))demo.asas[i][header.indexOf(key)]=value;
}
const ias=[demo.antrepo[0],[810001,'DEMO AUTO APPROVAL','BLK','BLACK','Yükleme Operasyonları','2026-12-24','Gemi','2026-11-06',100,100]];
function writeSource(){for(const [name,sheet,rows]of [['ASAS.xlsx','ASAS',demo.asas],['Antrepo.xlsx','Antrepo',ias]]){const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),sheet);XLSX.writeFile(wb,path.join(source,name));}}
writeSource();
const log=fs.openSync(path.join(root,'server.log'),'a'),server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});let browser,cookie,page;
async function api(url,body,method=body?'POST':'GET',expected=200){const response=await fetch(base+url,{method,headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.equal(response.status,expected,await response.clone().text());return response.json();}
async function refresh(){await api('/api/refresh',{},'POST',202);for(let i=0;i<160;i++){if(!(await api('/api/refresh-status')).running)return;await new Promise(r=>setTimeout(r,200));}throw Error('Refresh timed out');}
(async()=>{
 for(let i=0;i<160;i++){try{if((await fetch(base+'/api/health')).status<500)break;}catch{}await new Promise(r=>setTimeout(r,200));}
 const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',newPassword:'demo-approval-123',password:'demo-approval-123'})});assert.equal(login.status,200,await login.clone().text());cookie=login.headers.get('set-cookie').split(';')[0];
 await refresh();let cp=await api('/api/data/cp');assert.equal(cp.rows.length,3);
 const auto=cp.rows.find(row=>row['Order Code']===810001);assert.ok(auto);assert.equal(auto['Ex-factory'].slice(0,10),'2026-11-05');assert.equal(auto['Ex→Retail'],39);assert.equal(auto.LT,35);
 await api('/api/overrides/810002',{modelName:'DEMO MANUAL REVISION',ccode:'BLK',dates:{exFactory:'2026-11-02'}},'PATCH');
 for(const body of [{dates:{exFactory:'2026-12-01'}},{dates:{exFactory:null}},{dates:{shipConfirmationDate:'2027-01-01'}},{'Buying Son Onay Tarihi':'2027-01-01'}]){
  const error=await api('/api/overrides/810001',body,'PATCH',409);assert.equal(error.code,'AUTOMATIC_DATE_READ_ONLY');
 }
 await api('/api/overrides/batch',{items:[{orderCode:810002,patch:{notes:{Notes:'MUST NOT SAVE'}}},{orderCode:810001,patch:{dates:{exFactory:'2026-12-01'}}}]},'POST',409);
 cp=await api('/api/data/cp');assert.notEqual(cp.rows.find(row=>row['Order Code']===810002).Notes,'MUST NOT SAVE');
 const orders=await api('/api/data/orders');assert.equal(orders.orders.find(row=>row['Order Code']===810001).LT,35);
 const backlog=await api('/api/backlog-export?format=json');assert.ok(backlog.rows.some(row=>Number(row['Sipariş Kod'])===810001&&String(row['REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)']).startsWith('2026-11-05')));
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1800,height:820},reducedMotion:'reduce'}),separator=cookie.indexOf('=');
 await context.addCookies([{name:cookie.slice(0,separator),value:cookie.slice(separator+1),url:base}]);
 await context.addInitScript(()=>localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0'));
 page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
 await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof switchTab==='function',null,{timeout:60000});
 await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).first().click({timeout:5000}).catch(()=>{});
 await page.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:60000});
 await page.locator('nav.tabs button[data-tab="cp"]').click();await page.waitForFunction(()=>document.querySelectorAll('#cpTable tbody tr').length>=3);
 await page.evaluate(()=>{
  applyLanguage('tr');const keys=['Model Name','Order Code','OPD','Ex-factory','Buying Son Onay Tarihi','Retail Date','Ex→Retail','LT','STATUS'];
  colmgr.cp.hidden=new Set(CP_COLS.map(col=>col.k).filter(key=>!keys.includes(key)));colmgr.cp.order=keys;
  colmgr.cp.widthPx['Model Name']=230;colmgr.cp.widthPx['Ex-factory']=200;colmgr.cp.widthPx['Buying Son Onay Tarihi']=140;colmgr.cp.widthPx.STATUS=180;
  state.cpLogisticExpanded=new Set([state.cp.rows.find(row=>row['Order Code']===810001)._id]);renderCP();
 });
 const sourceDates=page.locator('#cpTable .revAutomaticDates').first();
 assert.match(await sourceDates.innerText(),/30.10.26/);assert.match(await sourceDates.innerText(),/05.11.26/);
 assert.doesNotMatch(await page.locator('#cpTable .revAutomatic').allInnerTexts().then(texts=>texts.join(' ')),/🔒|Otomatik|Yükleme onayı|ASAS|Auto|Loading approval/);
 assert.match(await sourceDates.getAttribute('title'),/ASAS Ex-Factory/);assert.match(await sourceDates.getAttribute('title'),/Yükleme onayı/);
 const original=await sourceDates.locator('.revAutoOriginal').boundingBox(),approved=await sourceDates.locator('.revAutoApproved').boundingBox();
 assert.ok(approved.x>original.x,'ASAS and approval dates are displayed side by side');
 const checks=await page.evaluate(()=>{
  const row=state.cp.rows.find(row=>row['Order Code']===810001),before=toISODate(row['Ex-factory']);
  const edited=commitCpEditor({dataset:{id:String(row._id),key:'Ex-factory',kind:'exfactory',lineKey:lineKeyOfRow(row),editOwner:orderLinePeerOwner()},value:'2027-01-01'});
  return {before,after:toISODate(row['Ex-factory']),edited,paste:cpPasteTarget(row,{k:'Ex-factory',type:'exfactory'}),manual:BLRevision.revisedDateKeys(row)};
 });
 assert.equal(checks.before,checks.after);assert.equal(checks.edited,false);assert.equal(checks.paste,null);assert.ok(!checks.manual.includes('Ex-factory'));
 assert.equal(await page.locator('#cpTable .revAutomatic .exfDisplay').count(),0);assert.ok(await page.locator('#cpTable .revPair').count());
 const assets=path.join(app,'public/release-notes/next-assets');fs.mkdirSync(assets,{recursive:true});
 await page.screenshot({path:path.join(assets,'loading-approval-exfactory.png')});
 await page.evaluate(()=>applyLanguage('en'));assert.match(await page.locator('#cpTable .revAutomaticDates').first().getAttribute('title'),/Loading approval/);assert.doesNotMatch(await page.locator('#cpTable .revAutomaticDates').first().getAttribute('title'),/Yükleme onayı/);
 const existing=await page.evaluate(async()=>{await ensureOrdersLoaded();return state.orders.rows.find(row=>row['Order Code']===810001)._exFactoryRevision.source;});assert.equal(existing,'loading-approval');
 // A new source publication changes approval; the original ASAS plan stays intact.
 demo.asas[3][header.indexOf('Buying Son Onay Tarihi')]='2026-11-08';writeSource();await refresh();
 cp=await api('/api/data/cp');const changed=cp.rows.find(row=>row['Order Code']===810001);assert.equal(changed['Ex-factory'].slice(0,10),'2026-11-08');assert.equal(changed._asasExFactory.slice(0,10),'2026-10-30');assert.equal(changed.LT,38);
 assert.deepEqual(errors,[]);console.log('PASS HTTP: effective dates, LT, Ex→Retail, Orders, Backlog, source refresh, read-only approval, single/batch atomic rejection.');
 console.log('PASS real UI: distinct manual/automatic rendering, editing/paste lock, TR/EN; screenshot captured.');console.log('Evidence: '+root);
})().catch(async error=>{console.error(error);if(page)await page.screenshot({path:path.join(root,'failure.png')}).catch(()=>{});console.error('Evidence: '+root);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.kill('SIGTERM');fs.closeSync(log);});
