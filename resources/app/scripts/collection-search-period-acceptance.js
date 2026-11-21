/* Real-app acceptance for Collection search: language-independent MB month and
 * MB / EXF / RT period shortcuts. All data is synthetic. Optional argv[2]: PNG path. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const {chromium}=require('playwright');
const app=path.resolve(__dirname,'..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-kol-search-'));
const port=6493,base=`http://127.0.0.1:${port}`,shot=process.argv[2]||'';
const env={...process.env,BUYER_LOG_DATA_ROOT:path.join(root,'app'),BUYER_LOG_SERVER_DATA_ROOT:path.join(root,'server'),BUYER_LOG_LOCAL_DATA_ROOT:path.join(root,'local'),BUYER_LOG_TEMP_ROOT:path.join(root,'temp'),BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')};
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_TEMP_ROOT'])fs.mkdirSync(env[key],{recursive:true});
fs.mkdirSync(path.join(root,'source'));fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,sourceFolder:path.join(root,'source')}));
const log=fs.openSync(path.join(root,'server.log'),'a');let server,browser,cookie;
async function start(){
  server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});
  let healthy=false;
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health',{signal:AbortSignal.timeout(500)})).status<500){healthy=true;break;}}catch(_){}await new Promise(r=>setTimeout(r,200));}
  assert.ok(healthy,'isolated server started');
  const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',newPassword:'demo-search-123',password:'demo-search-123'})});
  assert.equal(login.status,200,await login.clone().text());cookie=login.headers.get('set-cookie').split(';')[0];
}
const row=(id,season,month,exFactory,extra={})=>({id,plmId:'DEMO-'+id,modelKod:'DEMO MODEL '+id,productMainDefinition:'Demo T-Shirt',buyer:'DEMO BUYER',season,urunTipi:'DEMO',inStoreMonth:month,exFactory,retail:'',pricing:{},durum:'',colour:'BLUE',...extra});
const ROWS=[
  row(1,'S7','MART 2027','2026-12-14'),
  row(2,'S7','APRIL 2027','2027-01-11'),
  row(3,'S7','MAYIS 2027','2027-02-08'),
  row(4,'S7','HAZİRAN 2027','2027-03-08'),
  row(5,'W7','TEMMUZ 2027','2027-04-12'),
  row(6,'W7','JULY 2027','2027-04-19'),
  row(7,'W7','EKİM 2027','2027-06-14'),
];
(async()=>{
  await start();
  const launch={headless:true,args:['--no-sandbox']};if(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH)launch.executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  browser=await chromium.launch(launch);
  const context=await browser.newContext({viewport:{width:1400,height:800},deviceScaleFactor:shot?2:1,reducedMotion:'reduce'});
  const [name,...rest]=cookie.split('=');await context.addCookies([{name,value:rest.join('='),domain:'127.0.0.1',path:'/',httpOnly:true}]);
  await context.addInitScript(()=>localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0'));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.BLPerf&&typeof switchTab==='function',{timeout:60000});
  await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({timeout:4000}).catch(()=>{});
  await page.waitForFunction(()=>!document.getElementById('blBootGuard'),{timeout:60000});
  await page.evaluate(async rows=>{
    switchTab('koleksiyon');await window.BLPerf.ensureFeature('collectionTools');
    applyLanguage('en');kolRows=rows;
    kolWorkspaceList=kolWorkspaceList.map(item=>item.ownerId==='moderator'?{...item,ownerName:'DEMO BUYER A'}:item);
    kolColOrder=kolDefaultDisplayOrder();
    kolHiddenCols=new Set(kolColDefs().map(c=>c.k).filter(k=>!['plmId','modelKod','season','inStoreWeek','inStoreMonth','exFactory','buyer'].includes(k)));
    kolPictureHidden=true;kolColFilters={};kolHealthState.filter='';renderKol();
  },ROWS);
  const search=async query=>page.evaluate(q=>{
    const input=document.getElementById('kolSearch');input.value=q;input.dispatchEvent(new Event('input',{bubbles:true}));
    return new Promise(resolve=>setTimeout(()=>resolve(filteredKol().map(r=>r.id)),400));
  },query);
  // 1) MB ayı kayıt dilinden bağımsız.
  assert.deepEqual((await search('July')).sort(),[5,6],'July finds TR and EN stored months');
  assert.deepEqual((await search('Temmuz')).sort(),[5,6],'Temmuz finds TR and EN stored months');
  console.log('PASS MB month search is language independent');
  // 2) Dönem kısayolları (yıl yok, sezonla kapsam).
  assert.deepEqual((await search('S7; MB=M3-M5')).sort(),[1,2,3]);
  assert.deepEqual((await search('MB=M7')).sort(),[5,6]);
  assert.deepEqual((await search('MB=M11-M3')).sort(),[1],'range wraps the year end');
  assert.deepEqual((await search('W7; MB=M7!')).sort(),[7],'exclusion removes the whole period');
  const exf=await search('EXF=M4');
  assert.deepEqual(exf.sort(),[5,6],'Ex-Factory month uses the date');
  console.log('PASS MB / EXF period shortcuts filter Collection rows');
  // 2b) Merch takvimi değişince önbelleğe alınmış satırlar yeni dönemle eşleşir (sayfa yenilemeden).
  await page.evaluate(()=>window.BLDateDimension.setMerchCalendar({weeks:[{year:2027,week:15,month:3,monthWeek:5,start:'2027-04-12'}]}));
  // 12.04.2027 takvimde ay 3'e eşlenir; takvimde olmayan 08.03 ve 19.04 takvim ayına düşer.
  assert.deepEqual((await search('EXF=M3')).sort(),[4,5],'calendar maps 2027-04-12 to business month 3');
  assert.deepEqual((await search('EXF=M4')).sort(),[6],'cached row 5 no longer matches its old month');
  await page.evaluate(()=>window.BLDateDimension.clearMerchCalendar());
  assert.deepEqual((await search('EXF=M4')).sort(),[5,6],'clearing the calendar restores the default periods');
  console.log('PASS merch calendar change refreshes cached search periods');
  // 3) Sezon alanı ve yıllı dönem.
  assert.deepEqual((await search('SEZON=S7; MB=2027M4-2027M5')).sort(),[2,3]);
  assert.deepEqual((await search('SEASON=W7')).sort(),[5,6,7]);
  console.log('PASS season field and year-bound period shortcuts');
  // 4) Arama terim terim kip olarak görünür; × yalnız o terimi kaldırır.
  await search('DEMO-1, DEMO-5; MB=M3-M5');
  const chips=page.locator('#kolActiveFilterTokens .tableSearchChip');
  const labels=(await chips.allInnerTexts()).map(t=>t.trim());
  assert.deepEqual(labels,['DEMO-1','DEMO-5','MB · March–May'],'English chips: two OR terms + one period');
  assert.match(await page.locator('#kolActiveFilterTokens .tableSearchChips').innerText(),/DEMO-1\s*or\s*DEMO-5\s*and\s*MB/);
  await page.waitForFunction(()=>document.querySelector('#kolActiveFilterTokens [data-chip-key="demo-5"]')?.classList.contains('tableSearchChip--missing'));
  await chips.nth(1).click();
  await page.waitForFunction(()=>document.getElementById('kolSearch').value==='DEMO-1; MB=M3-M5');
  await page.waitForTimeout(400);
  assert.deepEqual(await page.evaluate(()=>filteredKol().map(r=>r.id)),[1]);
  console.log('PASS search chips show OR/AND structure, missing term and remove one term');
  // 5) Geçersiz kısayol açıkça uyarılır.
  await search('MB=M13');
  assert.equal(await page.locator('#kolActiveFilterTokens .tableSearchChip--invalid').count(),1);
  assert.match(await page.locator('#kolSearchFeedback').innerText(),/Invalid shortcut \(1\):[^]*MB=M13 — Month must be 1–12/);
  console.log('PASS invalid shortcut is explained');
  // 6) Öneri listesi: MB= yazınca tablodaki aylar, ok + Enter ile uygulanır.
  await search('');
  await page.locator('#kolSearch').click();
  await page.keyboard.type('S7; MB=');
  await page.waitForSelector('#tableSearchSuggestList [role="option"]');
  const options=(await page.locator('#tableSearchSuggestList [role="option"]').allInnerTexts()).map(t=>t.replace(/\s+/g,' ').trim());
  assert.ok(options.includes('MB=M3 March · 1 row')&&options.includes('MB=M7 July · 2 rows'),JSON.stringify(options));
  await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  assert.equal(await page.locator('#kolSearch').inputValue(),'S7; MB=M3');
  assert.equal(await page.locator('#tableSearchSuggestList').count(),0);
  await page.keyboard.press('Escape');
  console.log('PASS shortcut suggestions list table values and apply with the keyboard');
  // 6b) Aramanın ilk terimi olarak yazılan kısayol da öneri açar.
  await search('');
  await page.locator('#kolSearch').click();
  await page.keyboard.type('EXF=');
  await page.waitForSelector('#tableSearchSuggestList [role="option"]');
  assert.ok((await page.locator('#tableSearchSuggestList [role="option"]').allInnerTexts()).some(t=>/^EXF=M4/.test(t.trim())));
  await page.keyboard.press('Escape');
  console.log('PASS suggestions open for a shortcut at the start of the search');
  // 7) CP/Siparişler haystack'i aynı kısayolları anlar.
  const cp=await page.evaluate(()=>{
    const rows=[{'PLM ID':'CP-1','Season':'S7','Ex-factory':'15.03.2027','In-Store (Model Budget)':'2027-05-10'},{'PLM ID':'CP-2','Season':'W7','Ex-factory':'2027-08-16'}];
    const terms=parseTableSearchTerms('SEZON=S7; MB=M5');
    return rows.filter(r=>tableSearchMatches(cpSearchHaystack(r),terms,{plainMode:'contains'})).map(r=>r['PLM ID']);
  });
  assert.deepEqual(cp,['CP-1']);
  console.log('PASS CP / Orders search understands field shortcuts');
  // 7b) CP sıcak yolu: 30k satır arama metni; kısayol kullanılmadan ve kullanıldıktan sonra (ölçüm, eşik değil).
  const perf=await page.evaluate(()=>{
    const rows=Array.from({length:30000},(_,i)=>({'PLM ID':'P'+i,'Model Name':'MODEL '+i,'Season':i%2?'S7':'W7','Ex-factory':'2027-0'+(1+i%9)+'-15','In-Store (Model Budget)':'2027-0'+(1+i%9)+'-01','Retail Date':'2027-0'+(1+i%9)+'-20'}));
    const P=window.BLTableSearchPeriods,was=P.used,time=()=>{const t=performance.now();for(const r of rows)cpSearchHaystack(r);return performance.now()-t;};
    const median=list=>list.sort((a,b)=>a-b)[Math.floor(list.length/2)];
    P.used=false;const off=[time(),time(),time(),time(),time()];
    P.used=true;const first=time();const warm=[time(),time(),time(),time(),time()];
    P.used=was;
    return {offMs:off.map(v=>+v.toFixed(1)),offMedian:+median(off).toFixed(1),firstUseMs:+first.toFixed(1),warmMs:warm.map(v=>+v.toFixed(1)),warmMedian:+median(warm).toFixed(1)};
  });
  console.log('PERF cpSearchHaystack 30k',JSON.stringify(perf));
  // 8) Yardım penceresi kısayol bölümünü iki dilde gösterir.
  await page.locator('.tableSearchHelpButton[data-search-help-for="kolSearch"]').click();
  assert.match(await page.locator('#tableSearchHelpPopover').innerText(),/Date and season shortcuts[^]*SEASON=S7; MB=M3-M5/);
  await page.keyboard.press('Escape');
  await page.evaluate(()=>applyLanguage('tr'));
  await page.locator('.tableSearchHelpButton[data-search-help-for="kolSearch"]').click();
  assert.match(await page.locator('#tableSearchHelpPopover').innerText(),/Tarih ve sezon kısayolları/);
  console.log('PASS search help explains shortcuts in TR and EN');
  if(shot){
    await page.keyboard.press('Escape');
    await search('SEZON=S7; MB=M3-M5, MB=M7; DEMO MODEL');
    await page.waitForTimeout(500);
    await page.mouse.move(5,700);
    const missingBg=await page.locator('#kolActiveFilterTokens [data-chip-key="mb=m7"]').evaluate(el=>getComputedStyle(el).backgroundColor);
    const plainBg=await page.locator('#kolActiveFilterTokens [data-chip-key="demo model"]').evaluate(el=>getComputedStyle(el).backgroundColor);
    assert.notEqual(missingBg,plainBg,'missing chip has its own colour');
    const box=await page.locator('#kolSearch').boundingBox();
    const y=Math.max(0,box.y-150);
    await page.screenshot({path:shot,clip:{x:212,y,width:1188,height:400}});
    console.log('SCREENSHOT',shot);
  }
  assert.deepEqual(errors,[],'no page errors');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  await browser?.close().catch(()=>{});
  if(server){const stopped=once(server,'exit');server.kill();await stopped;}
  fs.rmSync(root,{recursive:true,force:true});
});
