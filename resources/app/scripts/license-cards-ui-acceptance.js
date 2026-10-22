/* Manual real-app acceptance for License cards (list view, inline rates, approval map,
   supplier atlas). Requires Playwright and Chromium. Starts its own server on demo data.
   Env: PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, BUYER_LOG_ATLAS_ARTIFACT_ROOT (screenshots),
   BUYER_LOG_ATLAS_TEST_PORT (default 6452). */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const app=path.resolve(__dirname,'..'),appRequire=createRequire(path.join(app,'package.json'));
const {chromium}=require('playwright');
const root=process.env.BUYER_LOG_ATLAS_ARTIFACT_ROOT||fs.mkdtempSync(path.join(os.tmpdir(),'buyer-log-license-cards-ui-'));
const port=Number(process.env.BUYER_LOG_ATLAS_TEST_PORT||6452),base=`http://127.0.0.1:${port}`;
fs.mkdirSync(root,{recursive:true});
const env={...process.env,BUYER_LOG_DATA_ROOT:path.join(root,'app'),BUYER_LOG_SERVER_DATA_ROOT:path.join(root,'server'),BUYER_LOG_LOCAL_DATA_ROOT:path.join(root,'local'),BUYER_LOG_TEMP_ROOT:path.join(root,'temp'),BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')};
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_TEMP_ROOT'])fs.mkdirSync(env[key],{recursive:true});
fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,sourceFolder:path.join(root,'source')}));
const cards=appRequire('./server/lib/license-cards');
const names=[['NORTH STAR','Demo Licensing'],['ORBIT CLUB','Demo Studio'],['STUDIO ONE','Demo Agency'],['BLUE HARBOR','Demo Rights'],['SUN VALLEY','']];
const state=cards.appendDiscovered({_revision:0,_revisions:{pricingRules:1},pricingRules:[]},names.map(([license,licensor])=>({license,licensor}))).overrides;
state.licenseCards.items.filter(c=>c.licensor).forEach((c,i)=>state.pricingRules.push({id:c.id+'-rule',license:c.license,licensor:c.licensor,royalty:10+i,trCommission:2,ydCommission:3,hologramCost:.15,opdStart:'2026-01-01',opdEnd:'',seasons:[]}));
state.pricingRules.push({id:'dtr-rule',license:'NORTH STAR',licensor:'DTR',royalty:8,trCommission:1,ydCommission:2,hologramCost:.2,opdStart:'2025-01-01',opdEnd:'',seasons:[]});
state.licenseCards.items[0].processAtlas={version:1,license:{id:'demo',name:'NORTH STAR',agency:'Demo Licensing',internalNotes:'PRIVATE INTERNAL',stages:[{id:'concept',title:'Konsept onayı',enabled:true,approver:'licensor',note:'PRIVATE NOTE',supplierShowSourceNote:false,supplierInstructions:'Tasarımı portal üzerinden gönderin.',submissions:[{id:'r1',method:'portal',recipientType:'licensor',recipient:'Demo Licensing',timing:'approval'}]},{id:'pps',title:'PPS onayı',enabled:true,approver:'LCW',testRequired:true,testQty:'2',submissions:[{id:'r2',method:'email',recipientType:'LCW',recipient:'LCW Lisans Ekibi',qty:'3',timing:'after'},{id:'r3',method:'physical',recipientType:'licensor',recipient:'Demo Licensing Studio Team',qty:'1',timing:'approval'}]}],addresses:[],portal:{url:'https://example.com/portal',notes:''}},sharedAddresses:[],visualLibrary:[]};
fs.writeFileSync(path.join(env.BUYER_LOG_SERVER_DATA_ROOT,'overrides.json'),JSON.stringify(state));
const log=fs.openSync(path.join(root,'server.log'),'a'),server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});
let browser;
(async()=>{
  for(let i=0;i<160;i++){try{if((await fetch(base+'/api/health')).status<500)break;}catch{}await new Promise(r=>setTimeout(r,250));}
  const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',newPassword:'demo-cards-test-123',password:'demo-cards-test-123'})});
  assert.equal(login.status,200,await login.text());const cookie=login.headers.get('set-cookie').split(';')[0];
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',acceptDownloads:true});
  const [name,...rest]=cookie.split('=');await context.addCookies([{name,value:rest.join('='),domain:'127.0.0.1',path:'/',httpOnly:true}]);
  await context.addInitScript(()=>{try{localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0');}catch{}setInterval(()=>document.querySelectorAll('.blRnDialog[open]').forEach(d=>d.close()),100);});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.__toasts=[];});
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.BLPerf&&typeof window.switchTab==='function',{timeout:60000});
  await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({timeout:4000}).catch(()=>{});
  await page.waitForFunction(()=>!document.getElementById('blBootGuard'),{timeout:60000});
  await page.evaluate(()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());switchTab('licensecards');});
  const rows=page.locator('.lcRow[data-row]');await rows.first().waitFor({timeout:30000});
  const api=()=>page.evaluate(async()=>(await (await fetch('/api/license-cards',{cache:'no-store'})).json()));
  const row=(license,licensor)=>rows.filter({hasText:license}).filter({hasText:licensor});
  await page.evaluate(()=>{const show=window.showToast;window.showToast=(m,...r)=>{window.__toasts.push(String(m));return show(m,...r);};});
  const toast=re=>page.waitForFunction(src=>window.__toasts.some(t=>new RegExp(src).test(t)),re.source,{timeout:15000});

  assert.equal(await rows.count(),6);assert.equal(await rows.filter({hasText:'NORTH STAR'}).count(),2,'two licensors → two rows');
  assert.equal(await page.locator('iframe').count(),0,'no legacy iframe');
  await page.screenshot({path:path.join(root,'list.png')});console.log('PASS list: one row per license × licensor');

  const orbit=row('ORBIT CLUB','Demo Studio');await orbit.locator('[data-lc-rate="royalty"]').fill('13,5');
  assert.equal(await orbit.evaluate(e=>e.classList.contains('isDirty')),true);await orbit.locator('[data-lc-rate="royalty"]').press('Enter');
  await page.waitForFunction(()=>!document.querySelector('.lcRow.isDirty'));
  assert.equal((await api()).cards.find(c=>c.license==='ORBIT CLUB').rules[0].royalty,13.5);console.log('PASS inline royalty saved with Enter');

  await orbit.locator('[data-lc-rate="royalty"]').fill('99');await orbit.locator('[data-lc-rate="trCommission"]').fill('5');await orbit.locator('[data-lc-act="save"]').first().click();
  await orbit.locator('.lcRowMsg').waitFor();assert.equal((await api()).cards.find(c=>c.license==='ORBIT CLUB').rules[0].royalty,13.5);
  await orbit.locator('[data-lc-rate="royalty"]').press('Escape');await page.waitForFunction(()=>!document.querySelector('.lcRow.isDirty'));console.log('PASS invalid rates blocked, Esc reverts');

  const blue=row('BLUE HARBOR','Demo Rights');await blue.locator('.lcName').click();await page.locator('.lcDetail').waitFor();
  await page.locator('.lcDetail [data-lc-act="addPeriod"]').click();await page.locator('.lcDetail .lcNote').waitFor();
  const newId=await page.evaluate(()=>[...document.querySelectorAll('.lcDetail [data-lc-key="opdStart"]')].find(i=>!i.closest('.lcContract').querySelector('[data-lc-key="opdEnd"]').value)?.dataset.lcRule);
  await page.evaluate(id=>{const el=document.querySelector(`.lcDetail [data-lc-rule="${id}"][data-lc-key="opdStart"]`);el.value='2026-11-01';el.dispatchEvent(new Event('input',{bubbles:true}));},newId);
  await page.locator('.lcSearch input').focus();await page.waitForTimeout(200);
  await page.locator('.lcDetail [data-lc-act="save"]').click();await page.waitForFunction(()=>!document.querySelector('.lcRow.isDirty'));
  const blueRules=(await api()).cards.find(c=>c.license==='BLUE HARBOR').rules.map(r=>[r.opdStart,r.opdEnd]).sort();
  assert.deepEqual(blueRules,[['2026-01-01','2026-10-31'],['2026-11-01','']]);console.log('PASS new period copies rates and keeps the previous end in sync (no gap)');
  await page.screenshot({path:path.join(root,'detail.png')});

  await row('NORTH STAR','Demo Licensing').locator('[data-lc-act="map"]').last().click();await page.locator('.lmDrawer').waitFor();
  await page.locator('[data-lm-act="addStage"]').click();await page.locator('.lmStage:last-child .lmTitle').fill('Final kontrol');
  await page.locator('.lmStage:last-child [data-lm-act="approver"][data-v="mixed"]').click();await page.screenshot({path:path.join(root,'map.png')});
  await page.locator('[data-lm-act="save"]').click();await page.locator('.lmScrim').waitFor({state:'detached'});
  const stages=(await api()).cards.find(c=>c.license==='NORTH STAR'&&c.licensor==='Demo Licensing').processAtlas.license.stages;
  assert.deepEqual(stages.map(s=>[s.title,s.approver]),[['Konsept onayı','licensor'],['PPS onayı','LCW'],['Final kontrol','mixed']]);
  assert.equal(stages[0].note,'PRIVATE NOTE','untouched fields survive');console.log('PASS map editor saves steps and preserves existing fields');

  // Manual licensor: an empty licensor is typed in place; another licensor gets its own row.
  const sun=rows.filter({hasText:'SUN VALLEY'});await page.locator('.lcRow.isOpen .lcName').click();await page.evaluate(()=>window.scrollTo(0,0));await sun.locator('.lcLicensorInput').fill('Demo Ri');await page.screenshot({path:path.join(root,'licensor-input.png')});await sun.locator('.lcLicensorInput').fill('Demo Rights');await sun.locator('.lcLicensorInput').press('Enter');
  await page.waitForFunction(()=>!document.querySelector('.lcLicensorInput[data-lc-licensor]')||![...document.querySelectorAll('.lcRow')].some(r=>r.textContent.includes('SUN VALLEY')&&r.querySelector('.lcLicensorInput')));
  assert.equal((await api()).cards.find(c=>c.license==='SUN VALLEY').licensor,'Demo Rights');await toast(/SUN VALLEY/);
  await row('ORBIT CLUB','Demo Studio').locator('.lcName').click();await page.locator('.lcDetail [data-lc-new-licensor]').fill('Demo Second');
  await page.screenshot({path:path.join(root,'licensor.png')});
  await page.locator('.lcDetail [data-lc-act="addLicensor"]').click();await rows.filter({hasText:'Demo Second'}).waitFor();
  assert.equal(await rows.filter({hasText:'ORBIT CLUB'}).count(),2,'another licensor → another row');
  assert.equal((await api()).cards.find(c=>c.licensor==='Demo Second').license,'ORBIT CLUB');console.log('PASS licensor typed in place and another licensor added as a row');

  // ASAS refresh always answers (here: no ASAS data loaded in the demo).
  await page.locator('.lcRow.isOpen .lcName').click();await page.evaluate(()=>document.querySelectorAll('[data-ui-feedback]').forEach(n=>n.closest('[data-ui-feedback]').remove()));
  await page.locator('[data-lc-act="refresh"]').click();await toast(/ASAS/);await page.waitForTimeout(400);await page.screenshot({path:path.join(root,'refresh.png')});console.log('PASS ASAS refresh gives feedback');

  // Stage templates: create once, link from two maps, one update reaches both.
  await page.locator('[data-lc-act="templates"]').click();await page.locator('.lmDrawer').waitFor();
  await page.locator('[data-lm-act="tplNew"]').click();await page.locator('#lmTemplateNameEdit').fill('Numune onayı');
  await page.locator('.lmStage .lmTitle').fill('Numune');await page.locator('.lmStage [data-lm-act="approver"][data-v="licensor"]').click();
  await page.locator('[data-lm-act="tplSave"]').click();await page.locator('.lmTemplate').waitFor();
  for(const [l,o] of [['NORTH STAR','Demo Licensing'],['ORBIT CLUB','Demo Studio']]){
    await page.locator('[data-lm-act="close"]').first().click().catch(()=>{});await page.locator('.lmScrim').waitFor({state:'detached'});
    await row(l,o).locator('[data-lc-act="map"]').last().click();await page.locator('.lmDrawer').waitFor();
    await page.locator('#lmTplSource').selectOption({label:'Numune onayı'});await page.locator('[data-lm-act="addFromTemplate"]').click();
    await page.locator('.lmStage:last-child .lmTpl').waitFor();
    if(l==='NORTH STAR'){await page.locator('.lmStage:last-child [data-lm-act="expand"]').click();await page.locator('.lmStage:last-child .lmLinked').waitFor();await page.screenshot({path:path.join(root,'linked.png')});}
    await page.locator('[data-lm-act="save"]').click();await page.locator('.lmScrim').waitFor({state:'detached'});
  }
  await page.locator('[data-lc-act="templates"]').click();await page.locator('.lmTemplate').filter({hasText:'2'}).waitFor();
  await page.screenshot({path:path.join(root,'templates.png')});
  await page.locator('[data-lm-act="tplEdit"]').click();await page.locator('.lmStage .lmTitle').fill('Numune v2');
  assert.match(await page.locator('[data-lm-act="tplSave"]').innerText(),/2/);await page.screenshot({path:path.join(root,'template-edit.png')});
  await page.locator('[data-lm-act="tplSave"]').click();await page.locator('.lmNotice').waitFor();
  const linked=(await api()).cards.filter(c=>(c.processAtlas?.license?.stages||[]).some(s=>s.templateId));
  assert.equal(linked.length,2);for(const c of linked)assert.equal(c.processAtlas.license.stages.find(s=>s.templateId).title,'Numune v2',c.license);
  await page.locator('[data-lm-act="close"]').first().click();await page.locator('.lmScrim').waitFor({state:'detached'});
  console.log('PASS stage template update reaches every linked license');

  for(const [l,o] of [['NORTH STAR','Demo Licensing'],['ORBIT CLUB','Demo Studio']])await row(l,o).locator('[data-lc-select]').check();
  await page.locator('.lcSelectionBar.isOn').waitFor();
  const download=page.waitForEvent('download');await page.locator('[data-lc-act="export"]').click();const file=path.join(root,'supplier.html');await (await download).saveAs(file);
  const html=fs.readFileSync(file,'utf8');
  for(const included of ['NORTH STAR','ORBIT CLUB','Final kontrol','Tasarımı portal üzerinden gönderin.','Numune v2'])assert.ok(html.includes(included),included);
  for(const excluded of ['STUDIO ONE','BLUE HARBOR','PRIVATE NOTE','PRIVATE INTERNAL','example.com/portal','13.5'])assert.ok(!html.includes(excluded),excluded);
  const supplier=await context.newPage();await supplier.goto('file://'+file);
  const drawers=supplier.locator('details.lic');assert.equal(await drawers.count(),2);assert.equal(await supplier.locator('details.lic[open]').count(),0,'all maps start closed');
  await drawers.first().locator('summary').click();assert.equal(await drawers.first().evaluate(d=>d.open),true);
  const lefts=await supplier.locator('details.lic[open] .route').evaluateAll(rs=>rs.map(r=>[...r.children].slice(0,3).map(c=>Math.round(c.getBoundingClientRect().left))));
  assert.ok(lefts.length>=3);for(const l of lefts)assert.deepEqual(l,lefts[0],'route columns line up');
  await supplier.screenshot({path:path.join(root,'supplier.png'),fullPage:true});
  await drawers.first().locator('summary').click();assert.equal(await drawers.first().evaluate(d=>d.open),false,'second click hides the map');
  await drawers.first().locator('summary').click();
  console.log('PASS supplier atlas holds only selected rows and supplier-visible content');

  await page.locator('#lcLicensor').selectOption({label:'DTR'});assert.equal(await rows.count(),1);await page.screenshot({path:path.join(root,'filter.png')});await page.locator('#lcLicensor').selectOption('');console.log('PASS licensor filter');
  await page.evaluate(()=>applyLanguage('en'));await page.getByText('Create supplier atlas',{exact:false}).first().waitFor();
  await page.evaluate(()=>{applyLanguage('tr');document.documentElement.dataset.theme='dark';});await page.waitForTimeout(300);await page.screenshot({path:path.join(root,'dark.png')});
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'no page-level horizontal overflow on mobile');
  await page.screenshot({path:path.join(root,'mobile.png')});console.log('PASS TR/EN, dark theme and mobile');
  assert.deepEqual(errors,[]);
  console.log('ARTIFACTS',root);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server.kill();});
