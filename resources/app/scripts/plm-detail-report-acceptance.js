/* PLM Kumaş + PLM Artwork — alt detay raporu ve LFL filtreleri.
 * İzole sunucu, demo LFL dosyası ve demo PLM BOM kaydı; kullanıcı verisi
 * okunmaz, PLM/SSAS'a bağlanılmaz.
 *   node scripts/plm-detail-report-acceptance.js
 *   BUYER_LOG_PLM_DETAIL_SCREENSHOT=1 → sürüm notu PNG'si next-assets'e yazılır. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require('playwright'),XLSX=require('xlsx');
const app=path.resolve(__dirname,'..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-plm-detail-'));
const port=Number(process.env.BUYER_LOG_PLM_DETAIL_PORT||6491),base=`http://127.0.0.1:${port}`;
const env={...process.env,BUYER_LOG_DATA_ROOT:path.join(root,'app'),BUYER_LOG_SERVER_DATA_ROOT:path.join(root,'server'),BUYER_LOG_LOCAL_DATA_ROOT:path.join(root,'local'),BUYER_LOG_TEMP_ROOT:path.join(root,'temp'),BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')};
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_TEMP_ROOT'])fs.mkdirSync(env[key],{recursive:true});
env.BUYER_LOG_AUTH_DATA_ROOT=env.BUYER_LOG_SERVER_DATA_ROOT;env.BL_DATA_DIR=env.BUYER_LOG_SERVER_DATA_ROOT;
fs.mkdirSync(path.join(root,'source'));fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',sourceFolder:path.join(root,'source'),updates:{enabled:false}}));
const fabrics=['Orme,Süprem,150 gsm,100% Cotton','Orme,Jersey,150 gsm,100% Cotton','Orme,Ribana,220 gsm,95% Cotton 5% Elastane','Orme,Interlok,180 gsm,100% Cotton'];
const models={};
for(let i=1;i<=4;i++)models[String(7000+i)]={plmId:String(7000+i),styleId:String(9100+i),fabric:fabrics[i-1],
  placements:i%2?[{placement:'front_body',placementTr:'Ön',placementEn:'Front',count:1,printType:'Pigment'}]:[{placement:'back_body',placementTr:'Arka',placementEn:'Back',count:1,printType:'Transfer'},{placement:'chest',placementTr:'Göğüs',placementEn:'Chest',count:1,printType:'Transfer'}]};
fs.writeFileSync(path.join(env.BUYER_LOG_SERVER_DATA_ROOT,'plm-bom.json'),JSON.stringify({_revision:1,models}));
const log=fs.openSync(path.join(root,'server.log'),'a');
const server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});let browser;
(async()=>{
  for(let i=0;i<120;i++){try{if((await fetch(base+'/api/health',{signal:AbortSignal.timeout(500)})).status<500)break;}catch(_){}await new Promise(r=>setTimeout(r,250));}
  const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',newPassword:'demo-plm-123',password:'demo-plm-123'})});
  assert.equal(login.status,200,await login.clone().text());const cookie=login.headers.get('set-cookie').split(';')[0];
  const api=async(url,body)=>{const res=await fetch(base+url,{method:body?'POST':'GET',headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.equal(res.status,200,await res.clone().text());return res.json();};
  await api('/api/lfl');
  const head=['ORDER CODE','MODEL','PLM ID','MAG','MMYG','KLASMAN','SEZON','IN STORE','FOB','ORDER QUANTITY','MANUFACTURER','COUNTRY','BUYING GROUP','BUYER','ANA KUMAS MI','KUMAS TIPI','GRAMAJ'];
  const matrix=[head];
  for(let i=1;i<=4;i++)matrix.push([`DEMO-S7-${i}`,`DEMO MODEL ${i}`,String(7000+i),'CU4E','DEMO','K.KOL','S7','2027-01-12',10+i,100*i,'DEMO A','CHINA','DEMO','DEMO',1,'ASAS TIP','999 GR']);
  for(let i=1;i<=3;i++)matrix.push([`DEMO-S6-${i}`,`DEMO OLD ${i}`,'','CU4E','DEMO','K.KOL','S6','2026-01-12',9+i,100,'DEMO B','CHINA','DEMO','DEMO',1,'Single Jersey','150 GR']);
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(matrix),'Demo');
  await api('/api/lfl/upload',{name:'demo-lfl.xlsx',dataBase64:XLSX.write(wb,{type:'buffer',bookType:'xlsx'}).toString('base64')});
  const lfl=await api('/api/lfl');
  const s7=lfl.rows.find(row=>row.orderCode==='DEMO-S7-1'),s6=lfl.rows.find(row=>row.orderCode==='DEMO-S6-1');
  const plm=lfl.meta.plmDetails['7001'];assert.equal(plm.plmFabric,fabrics[0]);assert.equal(plm.plmArtwork,'Ön: 1 | Pigment | Toplam: 1');
  assert.equal(s7.plmFabric,undefined,'PLM metinleri satır başına tekrarlanmaz');assert.equal(s7.kumasTipi,'Jersey');
  assert.equal(s6.plmId,'');assert.equal(s6.kumasTipi,s7.kumasTipi,'ASAS Single Jersey ile PLM Süprem/Jersey aynı filtre değerinde birleşir');
  const batch=await api('/api/plm-model-details/batch',{plmIds:['7002','0']});assert.equal(batch.entries['7002'].plmArtworkEn,'Back: 1 • Chest: 1 | Transfer | Total: 2');

  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1600,height:900},deviceScaleFactor:1,reducedMotion:'reduce'});
  const [name,...rest]=cookie.split('=');await context.addCookies([{name,value:rest.join('='),domain:'127.0.0.1',path:'/',httpOnly:true}]);
  await context.addInitScript(()=>{localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0');});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.BLPerf&&typeof switchTab==='function',{timeout:60000});
  await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({timeout:4000}).catch(()=>{});
  await page.waitForFunction(()=>!document.getElementById('blBootGuard'),{timeout:60000});
  await page.evaluate(async()=>{switchTab('lfl');await window.BLPerf.ensureFeature('lfl');});
  await page.waitForTimeout(4000);
  if(process.env.BL_DEBUG)await page.screenshot({path:path.join(process.env.BL_DEBUG,'debug.png')});
  if(process.env.BL_DEBUG)console.log(await page.evaluate(()=>({cur:document.getElementById('lflCurrentSeason')?.value,cmp:document.getElementById('lflCompareSeason')?.value,opts:[...(document.getElementById('lflCurrentSeason')?.options||[])].map(o=>o.value),dis:document.getElementById('lflCurrentPortfolioBtn')?.disabled})));
  await page.waitForFunction(()=>!document.getElementById('lflCurrentPortfolioBtn')?.disabled,{timeout:30000});
  // Filtre: PLM Kumaş panelinde PLM değerleri listelenir.
  await page.locator('#lflFabricGroupBtn').click();await page.locator('#lflDimBtn_plmFabric').click();
  await page.waitForTimeout(800);
  if(process.env.BL_DEBUG){console.log(await page.evaluate(()=>({hidden:document.getElementById('lflDimPanel_plmFabric')?.hidden,text:document.getElementById('lflDimPanel_plmFabric')?.innerText.slice(0,400),grp:document.getElementById('lflFabricGroupPanel')?.hidden})));await page.screenshot({path:path.join(process.env.BL_DEBUG,'debug2.png')});}
  await page.waitForFunction(t=>document.getElementById('lflDimPanel_plmFabric')?.textContent.toLocaleLowerCase('tr').includes(t.toLocaleLowerCase('tr')),fabrics[2]);
  await page.locator('#lflDimBtn_kumasTipi').click();
  const typeText=await page.locator('#lflDimPanel_kumasTipi').textContent();assert.ok(!/ASAS TIP/.test(typeText),'PLM kaydı olan modelde ASAS kumaş tipi gösterilmez');
  await page.keyboard.press('Escape');await page.mouse.click(5,5);
  await page.locator('#lflCurrentPortfolioBtn').click();
  const drawer=page.locator('#blSharedDetailDrawer');await drawer.locator('tbody tr').first().waitFor();
  const head2=await drawer.locator('thead').textContent();assert.match(head2,/PLM Kumaş/i);assert.match(head2,/PLM Artwork/i);
  const body=await drawer.locator('tbody').textContent();assert.ok(body.includes('Orme,Ribana,220 gsm'));assert.ok(body.includes('Arka: 1 • Göğüs: 1 | Transfer | Toplam: 2'));
  if(process.env.BUYER_LOG_PLM_DETAIL_SCREENSHOT==='1'){
    const assets=path.join(app,'public/release-notes/next-assets');fs.mkdirSync(assets,{recursive:true});
    await page.evaluate(()=>{const p=document.querySelector('#blSharedDetailDrawer .blDetailDrawerPanel');if(p)p.style.width='1560px';});
    await drawer.locator('.blDetailDrawerPanel').screenshot({path:path.join(assets,'plm-fabric-artwork-detail-reports.png')});
  }
  await page.keyboard.press('Escape');
  await page.evaluate(()=>applyLanguage('en'));await page.locator('#lflCurrentPortfolioBtn').click();await drawer.locator('tbody tr').first().waitFor();
  assert.match(await drawer.locator('thead').textContent(),/PLM Fabric/i);assert.ok((await drawer.locator('tbody').textContent()).includes('Back: 1 • Chest: 1 | Transfer | Total: 2'));
  // Fiyat & Üretici Analizi (LFL kaynağı): PLM alanları filtre olarak seçilebilir ve değer taşır.
  await page.evaluate(()=>applyLanguage('tr'));
  await page.evaluate(async()=>{switchTab('priceanalysis');await window.BLPerf.ensureFeature?.('collectionTools');});
  await page.waitForFunction(()=>document.querySelector('[data-ps-filter-toggle="plmFabric"]'),{timeout:30000});
  const psa=await page.evaluate(()=>{const box=document.querySelector('[data-ps-filter-toggle="plmFabric"]'),art=document.querySelector('[data-ps-filter-toggle="plmArtwork"]'),type=document.querySelector('[data-ps-filter-toggle="kumasTipi"]');return {source:window.BLPriceSupplierAnalysis.state.source,fabric:!box.disabled,artwork:!art.disabled,type:!type.disabled,label:box.closest('label')?.textContent||''};});
  assert.equal(psa.source,'lfl');assert.ok(psa.fabric&&psa.artwork&&psa.type,JSON.stringify(psa));assert.match(psa.label,/PLM Kumaş/);
  assert.deepEqual(errors,[]);
  console.log('PLM detail report acceptance: PASS');
})().catch(err=>{console.error(err);try{console.error(fs.readFileSync(path.join(root,'server.log'),'utf8').slice(-3000));}catch(_){}process.exitCode=1;}).finally(async()=>{if(browser)await browser.close().catch(()=>{});server.kill();});
