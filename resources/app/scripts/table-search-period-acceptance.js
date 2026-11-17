'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawn,execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
// Run from any directory; all accounts, configuration and data stay in work/.
const app=path.resolve(__dirname,'..'),repo=path.resolve(app,'../..');
fs.mkdirSync(path.join(repo,'work'),{recursive:true});
const root=fs.mkdtempSync(path.join(repo,'work/search-period-runtime-')),port=6494,base='http://127.0.0.1:'+port;
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(path.join(root,'source'),{recursive:true});
const env={...process.env,BUYER_LOG_CONFIG_PATH:path.join(root,'config.json'),BL_KEEP_ALIVE:'1'};
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_AUTH_DATA_ROOT','BUYER_LOG_TEMP_ROOT']){env[key]=path.join(root,key.toLowerCase());fs.mkdirSync(env[key],{recursive:true});}
env.BUYER_LOG_AUTH_DATA_ROOT=env.BUYER_LOG_SERVER_DATA_ROOT;env.BL_DATA_DIR=env.BUYER_LOG_SERVER_DATA_ROOT;
fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',sourceFolder:path.join(root,'source'),refreshWithExcel:false,updates:{enabled:false}}));
const log=fs.openSync(path.join(root,'server.log'),'a');let server,browser;
(async()=>{
 server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});
 let ready=false;for(let i=0;i<120;i++){try{if((await fetch(base+'/api/user-profiles')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}assert.ok(ready,'server ready');
 const password=crypto.randomBytes(20).toString('hex'),login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',newPassword:password,password})});assert.equal(login.status,200,await login.clone().text());
 const cookie=login.headers.get('set-cookie').split(';')[0], [name,...rest]=cookie.split('=');
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const main=execFileSync('git',['show','844dcb27:resources/app/public/app-main.js'],{cwd:repo,maxBuffer:12e6}).toString();
 async function open(baseline=false){
  const context=await browser.newContext({viewport:{width:1500,height:900},reducedMotion:'reduce'});await context.addCookies([{name,value:rest.join('='),url:base}]);
  await context.addInitScript(()=>localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0'));
  if(baseline)for(const asset of ['app-main.js','table-search-row-groups.js','table-search-feedback.js']){
   const body=asset==='app-main.js'?main:execFileSync('git',['show','844dcb27:resources/app/public/'+asset],{cwd:repo,maxBuffer:12e6}).toString();
   await context.route('**/'+asset+'?*',r=>r.fulfill({body,contentType:'application/javascript'}));
  }
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.BLPerf&&typeof switchTab==='function',{timeout:60000});
  await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({timeout:4000}).catch(()=>{});await page.waitForFunction(()=>!document.getElementById('blBootGuard'),{timeout:60000});
  await page.evaluate(async()=>{switchTab('koleksiyon');await BLPerf.ensureFeature('collectionTools');});return {context,page,errors};
 }
 const ui=await open();const page=ui.page;
 await page.evaluate(()=>{
  window.BLDateDimension.setMerchCalendar({weeks:[{year:2027,week:22,month:5,monthWeek:1,start:'2027-04-26',end:'2027-05-02'}]});
  applyLanguage('tr');kolWorkspaceCanEdit=false;
  kolRows=[{id:1,plmId:'DEMO-1',modelKod:'MINEC TRİKO',buyer:'FATİH AVCI',season:'W7',inStoreMonth:'MAYIS 2027',inStore:'2027-04-26',retail:'2027-04-27',exFactory:'2027-04-26',durum:'Fiyatlamada',quantity:100},{id:2,plmId:'DEMO-2',modelKod:'DEMO SUMMER',buyer:'DEMO BUYER',season:'S8',inStoreMonth:'TEMMUZ 2027',quantity:200}];
  kolColOrder=kolDefaultDisplayOrder();kolHiddenCols=new Set(kolColDefs().map(c=>c.k).filter(k=>!['plmId','modelKod','buyer','season','inStoreMonth','exFactory','retail','durum'].includes(k)));kolPictureHidden=true;kolColFilters={};kolHealthState.filter='';
  document.getElementById('kolSearch').value='MB=M5; MINEC';renderKol();
 });
 assert.equal(await page.evaluate(()=>filteredKol().length),1);
 await page.screenshot({path:path.join(app,'public/release-notes/next-assets/table-search-period.png')});
 for(const lang of ['tr','en']){
  await page.evaluate(lang=>applyLanguage(lang),lang);
  for(const query of ['CU4; W7; FATİH','W7','JULY','MB=M5; MINEC','RE=W22-W30','FATIH','TRIKO']){
   const result=await page.evaluate(query=>{document.getElementById('kolSearch').value=query;renderKol();return {n:filteredKol().length,missing:[...document.querySelectorAll('#kolSearchFeedback .tableSearchMissingTerm')].map(n=>n.textContent)};},query);
   assert.equal(result.n,query.startsWith('CU4')?0:1,lang+': '+query);
   assert.deepEqual(result.missing,query.startsWith('CU4')?['CU4']:[],lang+': missing '+query);
  }
  await page.evaluate(()=>{document.getElementById('kolSearch').value='EX=W60, !EX=W22';renderKol();});
  assert.equal(await page.locator('#kolSearchFeedback .tableSearchInvalidTerm').count(),2);
 }
 await page.evaluate(()=>{applyLanguage('en');document.getElementById('kolSearch').value='JULY';renderKol();});
 assert.match(await page.locator('#kolTable').innerText(),/JULY 2027/);
 await page.screenshot({path:path.join(app,'public/release-notes/next-assets/table-search-fold.png')});
 for(const tab of ['cp','orders']){
  await page.evaluate(tab=>{
   state[tab]={...(state[tab]||{}),rows:[{_id:'demo-1','PLM ID':'DEMO-1','Model Name':'MINEC TRİKO',Buyer:'FATİH AVCI',Season:'W7',Country:'Turkey',STATUS:'Üretimde','Del. Type':'Sea','Active/Inactive':'Active','In-Store':'2027-04-26','Retail Date':'2027-04-27','Ex-factory':'2027-04-26','Order Quantity':100}]};
   switchTab(tab);document.getElementById(tab+'Search').value='';
  },tab);
  for(const lang of ['tr','en'])for(const query of ['CU4; W7; FATİH','W7','MB=M5; MINEC','RE=W22-W30','FATIH','TRIKO','Aktif','In Production']){
   const result=await page.evaluate(({tab,query,lang})=>{applyLanguage(lang);document.getElementById(tab+'Search').value=query;if(tab==='cp')renderCPNow();else renderOrdersNow();return {n:(tab==='cp'?filteredCP():filteredOrders()).length,missing:[...document.querySelectorAll('#'+tab+'SearchFeedback .tableSearchMissingTerm')].map(n=>n.textContent)};},{tab,query,lang});
   assert.equal(result.n,query.startsWith('CU4')?0:1,tab+': '+query);assert.deepEqual(result.missing,query.startsWith('CU4')?['CU4']:[],tab+': feedback '+query);
  }
 }
 await page.evaluate(()=>{switchTab('koleksiyon');kolColFilters={season:new Set(['S8'])};document.getElementById('kolSearch').value='W7';renderKol();});
 assert.deepEqual(await page.locator('#kolSearchFeedback .tableSearchMissingTerm').allTextContents(),['W7'],'feedback respects non-search column filters');
 await page.evaluate(()=>{kolColFilters={};});
 for(const tab of ['cp','orders']){
  await page.evaluate(tab=>{switchTab(tab);document.getElementById(tab+'Search').value='EX=W23, EX=W22';},tab);
  assert.equal(await page.evaluate(tab=>(tab==='cp'?filteredCP():filteredOrders()).length,tab),1,'period OR in '+tab);
 }
 assert.deepEqual(ui.errors,[]);console.log('PASS runtime: demo MB JULY reproduction; CP/Orders/Collection TR/EN folding, scope, periods, missing and invalid feedback; no page errors');await ui.context.close();
 if(process.argv.includes('--ui-only'))return;
 const result={base:'844dcb27',rows:30000,runtime:process.version,browser:browser.version(),pairs:[]};
 for(let pair=0;pair<3;pair++){
  const samples={};
  for(const baseline of (pair%2?[false,true]:[true,false])){
   const run=await open(baseline);
   samples[baseline?'main':'candidate']=await run.page.evaluate(()=>{
    window.BLDateDimension.setMerchCalendar({weeks:[{year:2027,week:22,month:5,monthWeek:1,start:'2027-04-26',end:'2027-05-02'}]});
    const orders=Array.from({length:30000},(_,i)=>({_id:'demo-'+i,'PLM ID':'DEMO-'+String(i).padStart(5,'0'),'Model Name':i%1000===0?'MINEC':'DEMO MODEL',Buyer:'FATİH AVCI',Season:'W7',Country:'Turkey',STATUS:'Üretimde','Active/Inactive':'Active','In-Store':'2027-04-26','Retail Date':'2027-04-27','Ex-factory':'2027-04-26'}));
    state.orders={...(state.orders||{}),rows:orders};
    kolRows=orders.map((r,i)=>({id:i+1,plmId:r['PLM ID'],modelKod:r['Model Name'],buyer:r.Buyer,season:'W7',inStoreMonth:'MAYIS 2027',inStore:'2027-04-26',retail:'2027-04-27',exFactory:'2027-04-26'}));
    kolWorkspaceCanEdit=false;kolColFilters={};kolHealthState.filter='';kolCheckFilter='';
    const results={};
    for(const module of ['orders','collection']){
     const input=document.getElementById(module==='orders'?'ordersSearch':'kolSearch');
     const filter=module==='orders'?filteredOrders:filteredKol;
     const queries=['MINEC','MB=M5; MINEC'];
     results[module]={};
     for(const query of queries){
      input.value=query;let t=performance.now();let rows=filter();const coldMs=performance.now()-t;
      const warm=[];for(let n=0;n<5;n++){t=performance.now();rows=filter();warm.push(performance.now()-t);}
      const typing=[];for(let n=1;n<=query.length;n++){input.value=query.slice(0,n);t=performance.now();filter();typing.push(performance.now()-t);}
      let reference;
      if(query==='MB=M5; MINEC'&&!window.BLTableSearch.entries){
       input.value='MINEC';const samples=[];let hits;
       for(let n=0;n<5;n++){t=performance.now();hits=filter().filter(row=>module==='collection'?Number(kolMonthCode(row.inStoreMonth).slice(4))===5:window.BLDateDimension.describe(window.BLCanonicalFields.value(row,'orders','inStore')).lcwMonth===5);samples.push(performance.now()-t);}
       reference={samples,results:hits.length};input.value=query;
      }
      results[module][query]={coldMs,warm,typing,results:rows.length,reference};
     }
    }
    return results;
   });
   await run.context.close();
  }
  result.pairs.push(samples);console.log('PAIR',pair+1,JSON.stringify(samples));
 }
 fs.writeFileSync(path.join(repo,'work/table-search-period-performance.json'),JSON.stringify(result,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}fs.closeSync(log);});
