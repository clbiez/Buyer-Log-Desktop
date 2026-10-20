/* Manual real-app acceptance. Requires Playwright and a Chromium installation. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const app=path.resolve(__dirname,'..'),appRequire=createRequire(path.join(app,'package.json'));
const {chromium}=require('playwright');
const root=process.env.BUYER_LOG_ATLAS_ARTIFACT_ROOT||fs.mkdtempSync(path.join(os.tmpdir(),'buyer-log-atlas-ui-'));
const testPort=Number(process.env.BUYER_LOG_ATLAS_TEST_PORT||6452),base=`http://127.0.0.1:${testPort}`;
fs.mkdirSync(root,{recursive:true});
const env={...process.env,BUYER_LOG_DATA_ROOT:path.join(root,'app'),BUYER_LOG_SERVER_DATA_ROOT:path.join(root,'server'),BUYER_LOG_LOCAL_DATA_ROOT:path.join(root,'local'),BUYER_LOG_TEMP_ROOT:path.join(root,'temp'),BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')};
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_TEMP_ROOT'])fs.mkdirSync(env[key],{recursive:true});
fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port:testPort,sourceFolder:path.join(root,'source')}));
const cards=appRequire('./server/lib/license-cards');
const pairs=[{license:'NORTH STAR',licensor:'Demo Licensing'},{license:'ORBIT CLUB',licensor:'Demo Studio'},{license:'STUDIO ONE',licensor:'Demo Agency'}];
const state=cards.appendDiscovered({_revision:0,_revisions:{pricingRules:1},pricingRules:[]},pairs).overrides;
for(const c of state.licenseCards.items)state.pricingRules.push({id:c.id+'-rule',license:c.license,licensor:c.licensor,royalty:10,trCommission:2,ydCommission:3,hologramCost:.15,opdStart:'2026-01-01',opdEnd:'',seasons:[]});
const atlas={version:1,license:{id:'demo-atlas',name:'NORTH STAR',agency:'Demo Licensing',rightsHolder:'Demo Studio',manufacturerVisible:true,requirements:'PRIVATE REQUIREMENTS',stages:[{id:'concept',title:'Konsept onayı',i18n:{en:{title:'Concept approval'}},enabled:true,manufacturerVisible:true,approver:'agency',note:'PRIVATE SOURCE NOTE',supplierInstructions:'Onay için tasarım görselini portal üzerinden gönderin.',i18n:{en:{title:'Concept approval',supplierInstructions:'Submit artwork through the portal for approval.'}},submissions:[{id:'route-1',method:'portal',note:'PRIVATE ROUTE NOTE',supplierShowNotes:false,supplierInstructions:'Gönderim için üretici yönergesi',label:'Tasarım gönderimi',recipient:'Demo Licensing',timing:'approval',qty:'',addressId:'',manufacturerVisible:true}]},{id:'pps',title:'PPS onayı',i18n:{en:{title:'PPS approval'}},enabled:true,manufacturerVisible:true,approver:'licensor',supplierInstructions:'Üretim öncesi iki numune gönderin.',submissions:[{id:'route-2',method:'physical',label:'Numune gönderimi',recipient:'Demo Sample Office',qty:'2',timing:'approval',addressId:'demo-address',manufacturerVisible:true}]},{id:'hologram',title:'Hologram ve hangtag',i18n:{en:{title:'Hologram and hangtag'}},enabled:true,manufacturerVisible:false,approver:'agency',submissions:[]}],addresses:[{id:'demo-address',label:'Demo Sample Office',text:'Demo Street 12, Sample City',manufacturerVisible:true}],portal:{url:'https://example.com/portal',notes:'Demo portal',manufacturerVisible:true}},sharedAddresses:[],visualLibrary:[]};
atlas.license.supplierShowRequirements=false;atlas.license.stages[0].supplierShowSourceNote=false;atlas.license.portal.manufacturerVisible=false;atlas.license.agency='DTR';
state.licenseCards.items[0].processAtlas=atlas;
state.pricingRules.push({id:'dtr-rule',license:'NORTH STAR',licensor:'DTR',royalty:8,trCommission:1,ydCommission:2,hologramCost:.2,opdStart:'2025-01-01',opdEnd:'',seasons:[]});
state.pricingRules.push({id:'old-rule',license:'NORTH STAR',licensor:'Demo Licensing',royalty:9,trCommission:1,ydCommission:2,hologramCost:.1,opdStart:'2025-01-01',opdEnd:'2025-12-31',seasons:[]});
fs.writeFileSync(path.join(env.BUYER_LOG_SERVER_DATA_ROOT,'overrides.json'),JSON.stringify(state));
const log=fs.openSync(path.join(root,'server.log'),'a');const server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});
let browser;
(async()=>{
 for(let i=0;i<160;i++){try{if((await fetch(base+'/api/health')).status<500)break;}catch{}await new Promise(r=>setTimeout(r,250));}
 const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',newPassword:'demo-atlas-test-123',password:'demo-atlas-test-123'})});assert.equal(login.status,200,await login.text());const cookie=login.headers.get('set-cookie').split(';')[0];
 const api=async(url,options={})=>{const res=await fetch(base+url,{...options,headers:{cookie,'Content-Type':'application/json',...options.headers}});return {status:res.status,data:await res.json()};};
 const lib=await api('/api/license-cards/atlas-library');assert.equal(lib.status,200);assert.equal(lib.data.licenses.length,18);
 console.log('server and library ready');const original=(await api('/api/license-cards')).data;assert.equal(original.cards.length,4);
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:1600,height:1100},reducedMotion:'reduce',acceptDownloads:true});const [name,...rest]=cookie.split('=');await context.addCookies([{name,value:rest.join('='),domain:'127.0.0.1',path:'/',httpOnly:true}]);await context.addInitScript(()=>{try{localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0');}catch{}setInterval(()=>document.querySelectorAll('.blRnDialog[open]').forEach(d=>d.close()),100);});const page=await context.newPage();
 page.on('pageerror',err=>console.log('PAGEERROR',err.message));
 await page.goto(base,{waitUntil:'domcontentloaded'});console.log('page loaded',page.url());await page.waitForFunction(()=>window.BLPerf&&typeof window.switchTab==='function',{timeout:60000});
 await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({timeout:4000}).catch(()=>{});
 await page.waitForFunction(()=>!document.getElementById('blBootGuard'),{timeout:60000});
 await page.evaluate(()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());switchTab('licensecards');});


 const atlasFrame=page.frameLocator('.lcAtlasFrame');
 await atlasFrame.locator('.license-card').first().waitFor({timeout:30000});
 assert.equal(await atlasFrame.locator('.license-card').count(),3);
 assert.ok((await atlasFrame.locator('.license-card').first().innerText()).includes('Demo Licensing · DTR'));
 await page.screenshot({path:path.join(root,'atlas-home.png')});
 await atlasFrame.locator('.license-card').first().click();await atlasFrame.locator('.bl-commerce').waitFor();
 const embedded=await (await page.locator('.lcAtlasFrame').elementHandle()).contentFrame();
 assert.equal(await embedded.evaluate(()=>{const expected=document.createElement('div');expected.innerHTML=treeDiagram(chosen(),stagesOf(chosen()));return expected.firstElementChild.outerHTML===document.querySelector('.tree-section').outerHTML;}),true);
 console.log('PASS exact original tree DOM');
 const title=atlasFrame.locator('[data-map-field="title"]').first();await title.fill('Güncel konsept onayı');await title.dispatchEvent('change');
 await atlasFrame.locator('#blAtlasSave:not([hidden])').waitFor();
 let failed=false;await page.route('**/api/license-cards/atlas-batch',async route=>{if(!failed){failed=true;return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Temporary failure'})});}await route.continue();});
 await atlasFrame.locator('[data-action="blSave"]').click();await atlasFrame.locator('#blAtlasSave [role="alert"]').waitFor();assert.equal(await title.inputValue(),'Güncel konsept onayı');
 assert.equal((await api('/api/license-cards')).data.cards[0].processAtlas.license.stages[0].title,'Konsept onayı');
 await atlasFrame.locator('[data-action="blSave"]').click();await atlasFrame.locator('#blAtlasSave').waitFor({state:'hidden'});await page.unroute('**/api/license-cards/atlas-batch');
 const after=(await api('/api/license-cards')).data;assert.equal(after.cards[0].processAtlas.license.stages[0].title,'Güncel konsept onayı');assert.deepEqual(after.cards.map(c=>c.rules),original.cards.map(c=>c.rules));
 console.log('PASS failed save retains draft; retry saves without changing contracts');
 const immediateDownload=page.waitForEvent('download');await atlasFrame.locator('[data-action="blExportOne"]').click();const immediate=await immediateDownload,immediatePath=path.join(root,'supplier-immediate.html');await immediate.saveAs(immediatePath);assert.ok(fs.readFileSync(immediatePath,'utf8').includes('Güncel konsept onayı'));
 console.log('PASS immediate export uses the just-saved tree');
 await atlasFrame.locator('[data-action="edit"]').first().click();
 await atlasFrame.locator('.drawer .bl-business [data-lc-key="royalty"]').first().waitFor();
 assert.equal(await atlasFrame.locator('.drawer-head .overline').innerText(),'LİSANS DETAYLARI');
 assert.equal(await atlasFrame.locator('.editor-language-banner').count(),0);
 await atlasFrame.locator('.drawer [data-lc-key="royalty"]').first().fill('12');
 await atlasFrame.locator('.bl-business details summary').click();await atlasFrame.locator('[name="contactName"]').fill('Demo Contact');await atlasFrame.locator('[name="accessReference"]').fill('Demo password manager record');await atlasFrame.locator('.bl-business details summary').click();
 page.once('dialog',d=>d.dismiss());await atlasFrame.locator('.bl-business [data-lc-key="royalty"]').first().press('Escape');assert.equal(await atlasFrame.locator('.drawer').isVisible(),true);
 await atlasFrame.locator('[data-tab="general"]').click();assert.equal(await atlasFrame.locator('[data-path="symbol"],[data-path="description"]').count(),0);
 await atlasFrame.locator('[data-tab="sharing"]').click();assert.equal(await atlasFrame.locator('.share-intro').count(),0);assert.equal(await atlasFrame.locator('[data-path="portal|manufacturerVisible"]').isChecked(),false);assert.equal(await atlasFrame.locator('[data-path="addresses|0|manufacturerVisible"]').isChecked(),true);await page.screenshot({path:path.join(root,'atlas-sharing.png')});
 await atlasFrame.locator('[data-tab="contracts"]').click();assert.equal(await atlasFrame.locator('.bl-business [data-lc-key="royalty"]').first().inputValue(),'12');
 await page.evaluate(()=>applyLanguage('en'));await atlasFrame.locator('.drawer-head .overline').getByText('LICENSE DETAILS',{exact:true}).waitFor();await atlasFrame.getByText('These contracts are shared with Royalty Calculations. Edit dates and season scopes here.',{exact:true}).waitFor();assert.equal(await atlasFrame.locator('.bl-business [data-lc-key="royalty"]').first().inputValue(),'12');
 await page.evaluate(()=>applyLanguage('tr'));await atlasFrame.getByText('Royalty Calculations ile aynı sözleşmeler. Tarih ve sezon kapsamlarını burada düzenleyebilirsiniz.',{exact:true}).waitFor();
 await page.screenshot({path:path.join(root,'atlas-commerce.png')});
 await atlasFrame.locator('[data-action="saveEditor"]').click();await atlasFrame.locator('.drawer').waitFor({state:'hidden'});
 assert.equal((await api('/api/license-cards')).data.cards[0].rules[0].royalty,12);assert.equal((await api('/api/license-cards')).data.cards[0].contactName,'Demo Contact');assert.equal((await api('/api/license-cards')).data.cards[0].accessReference,'Demo password manager record');
 assert.ok((await atlasFrame.locator('.bl-commerce').innerText()).includes('12%'));
 // A second licensor shares the license card while keeping its own contract.
 await atlasFrame.locator('[data-bl-licensor="view"]').selectOption(original.cards.find(c=>c.licensor==='DTR').id);
 await atlasFrame.locator('[data-action="edit"]').first().click();await atlasFrame.locator('.bl-business [data-lc-key="royalty"]').waitFor();
 assert.equal(await atlasFrame.locator('.bl-business [data-lc-key="royalty"]').inputValue(),'8');await atlasFrame.locator('[data-tab="sharing"]').click();assert.equal(await atlasFrame.locator('[data-path="supplierShowRequirements"]').isChecked(),true);assert.equal(await atlasFrame.locator('[data-path="portal|manufacturerVisible"]').isChecked(),false);await atlasFrame.locator('[data-tab="contracts"]').click();
 await atlasFrame.locator('.bl-business [data-lc-key="royalty"]').fill('11');await atlasFrame.locator('[data-action="saveEditor"]').click();await atlasFrame.locator('.drawer').waitFor({state:'hidden'});
 assert.equal((await api('/api/pricing-rules')).data.rules.find(r=>r.id==='dtr-rule').royalty,11);
 // The canonical calculator endpoint updates the exact same record in the drawer.
 const pricing=(await api('/api/pricing-rules')).data;const rules=pricing.rules.map(r=>r.id==='dtr-rule'?{...r,royalty:13}:r);
 const priced=await api('/api/pricing-rules',{method:'PUT',body:JSON.stringify({rules,expectedRevision:pricing.revision})});assert.equal(priced.status,200,JSON.stringify(priced.data));
 await page.evaluate(()=>window.BLLicenseCardsPage.invalidate());await atlasFrame.locator('.bl-commerce').getByText('13%',{exact:true}).waitFor();
 await atlasFrame.locator('[data-action="edit"]').first().click();await atlasFrame.locator('.bl-business [data-lc-key="royalty"]').waitFor();
 assert.equal(await atlasFrame.locator('.bl-business [data-lc-key="royalty"]').inputValue(),'13');await atlasFrame.locator('[data-action="closeEditor"]').first().click();
 await atlasFrame.locator('[data-bl-licensor="view"]').selectOption(original.cards[0].id);
 console.log('PASS one card, multiple licensors, canonical contracts edited in both directions');
 // Recovery previews every target and performs one atomic Atlas-only update.
 const backup={licenses:[{...atlas.license,stages:atlas.license.stages.map((st,i)=>i?st:{...st,title:'Recovered concept'})}],sharedAddresses:[]};
 const invalidBackup=JSON.parse(JSON.stringify(backup));invalidBackup.licenses[0].manufacturerVisible='false';const revisionBeforeRecovery=(await api('/api/license-cards')).data.revision;
 const invalidChooser=page.waitForEvent('filechooser');await atlasFrame.locator('[data-action="blRecovery"]').click();await (await invalidChooser).setFiles({name:'invalid-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(invalidBackup))});await atlasFrame.locator('.bl-recovery').waitFor();assert.equal(await atlasFrame.locator('[data-action="blRecoveryApply"]').count(),0);await atlasFrame.locator('[data-action="blRecoveryCancel"]').click();assert.equal((await api('/api/license-cards')).data.revision,revisionBeforeRecovery);
 const chooser=page.waitForEvent('filechooser');await atlasFrame.locator('[data-action="blRecovery"]').click();await (await chooser).setFiles({name:'atlas-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
 await atlasFrame.locator('[data-action="blRecoveryApply"]').waitFor();assert.equal(await atlasFrame.locator('.bl-recovery li').count(),2);
 await page.screenshot({path:path.join(root,'atlas-recovery.png')});const rulesBefore=(await api('/api/license-cards')).data.pricingRules;
 await atlasFrame.locator('[data-action="blRecoveryApply"]').click();await atlasFrame.locator('.bl-recovery').waitFor({state:'hidden'});
 const recovered=(await api('/api/license-cards')).data;assert.deepEqual(recovered.pricingRules,rulesBefore);for(const c of recovered.cards.filter(c=>c.license==='NORTH STAR'))assert.equal(c.processAtlas.license.stages[0].title,'Recovered concept');
 console.log('PASS recovery previews both licensors and leaves all commercial rules unchanged');
 // The downloaded producer copy uses the original interactive supplier template, with a public projection only.
 const download=page.waitForEvent('download');await atlasFrame.locator('[data-action="blExportOne"]').click();const exported=await download,filePath=path.join(root,'supplier.html');await exported.saveAs(filePath);
 const html=fs.readFileSync(filePath,'utf8');assert.ok(!html.includes('PRIVATE'));assert.ok(!html.includes('royalty'));assert.ok(html.includes('Demo Licensing'));assert.ok(html.includes('Recovered concept'));assert.ok(html.includes('Gönderim için üretici yönergesi'));
 const supplier=await context.newPage();await supplier.route('**/__atlas_supplier_preview',route=>route.fulfill({status:200,contentType:'text/html',body:html}));await supplier.goto(base+'/__atlas_supplier_preview');await supplier.locator('.license-card').first().click();await supplier.locator('.tree-section').waitFor();if(!await supplier.locator('.tree-focus').count())await supplier.locator('[data-action="stage"]').first().click();await supplier.getByText('Gönderim için üretici yönergesi',{exact:false}).first().waitFor();await supplier.screenshot({path:path.join(root,'atlas-supplier.png')});assert.equal(await supplier.locator('[data-map-field]').count(),0);await supplier.close();
 console.log('PASS commercial edit + original supplier UI and privacy');
 // Apply the entire original process tree through Process Studio.
 await atlasFrame.locator('.nav-actions [data-action="studio"]').click();await atlasFrame.locator('#studioSource').selectOption('lic:'+after.cards[0].id);
 await atlasFrame.locator('[data-action="studioNoTargets"]').click();await atlasFrame.locator('[data-studio-target="'+after.cards[1].id+'"]').check();
 await page.screenshot({path:path.join(root,'atlas-bulk-copy.png')});page.once('dialog',d=>d.accept());await atlasFrame.locator('[data-action="studioApply"]').click();await atlasFrame.locator('[data-action="studioClose"]').first().click();
 await atlasFrame.locator('[data-action="blSave"]').click();await atlasFrame.locator('#blAtlasSave').waitFor({state:'hidden'});
 const copied=(await api('/api/license-cards')).data;assert.equal(copied.cards[1].processAtlas.license.stages.length,3);assert.equal(copied.cards[1].processAtlas.license.stages[0].title,'Recovered concept');
 console.log('PASS full-tree bulk copy');
 // Capture the unchanged original tree lanes with the commerce summary.
 if(await atlasFrame.locator('[data-action="mapCloseStage"]').count())await atlasFrame.locator('[data-action="mapCloseStage"]').first().click();await atlasFrame.locator('.bl-commerce').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(root,'atlas-tree.png')});
 await page.evaluate(()=>applyLanguage('en'));await atlasFrame.getByText('Contracts and rates',{exact:true}).waitFor();await page.screenshot({path:path.join(root,'atlas-english.png')});
 await page.evaluate(()=>applyLanguage('tr'));
 await page.evaluate(()=>applyTheme('dark'));await embedded.waitForFunction(()=>document.documentElement.dataset.theme==='dark');assert.equal(await embedded.evaluate(()=>getComputedStyle(document.body).getPropertyValue('--bg').trim()),await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--paper').trim()));await page.screenshot({path:path.join(root,'atlas-dark.png')});
 await page.evaluate(()=>applyTheme('light'));await embedded.waitForFunction(()=>document.documentElement.dataset.theme==='light');
 assert.equal(await atlasFrame.locator('[data-action="theme"]:visible,[data-action="lang"]:visible').count(),0);
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.getElementById('railCollapse').click());
 await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth,null,{timeout:5000});await embedded.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+1,null,{timeout:5000});
 await page.screenshot({path:path.join(root,'atlas-mobile.png')});
 await page.setViewportSize({width:1600,height:1100});
 // A peer can update the atlas while this sandbox holds a dirty tree. Never
 // pair a fresh commercial token with that old tree to bypass the conflict.
 await atlasFrame.locator('[data-action="stage"][data-stage="concept"]').first().click();
 const pendingTitle=atlasFrame.locator('[data-map-field="title"]').first();await pendingTitle.fill('Local pending');await pendingTitle.dispatchEvent('change');
 const live=(await api('/api/license-cards')).data.cards.find(c=>c.id===original.cards[0].id),peer=JSON.parse(JSON.stringify(live.processAtlas));peer.license.stages[0].title='Peer current';
 const peerSaved=await api('/api/license-cards/'+live.id,{method:'PUT',body:JSON.stringify({editToken:live.editToken,profile:{processAtlas:peer}})});assert.equal(peerSaved.status,200);
 await page.evaluate(()=>window.BLLicenseCardsPage.invalidate());await atlasFrame.locator('[data-action="edit"]').first().click();await atlasFrame.locator('.bl-business [data-lc-key="royalty"]').first().waitFor();
 await atlasFrame.locator('.bl-business [data-lc-key="royalty"]').first().fill('16');await atlasFrame.locator('[data-action="saveEditor"]').click();await atlasFrame.locator('#blAtlasSave [role="alert"]').waitFor();assert.equal(await atlasFrame.locator('.drawer').isVisible(),true);
 assert.equal((await api('/api/license-cards')).data.cards.find(c=>c.id===live.id).processAtlas.license.stages[0].title,'Peer current');
 page.once('dialog',d=>d.accept());await atlasFrame.locator('[data-action="closeEditor"]').first().click();page.once('dialog',d=>d.accept());await atlasFrame.locator('[data-action="blDiscard"]').click();await atlasFrame.locator('#blAtlasSave').waitFor({state:'hidden'});
 console.log('PASS stale tree + fresh contract token cannot overwrite a peer; Escape preserves drafts');
 // Verify permission changes against the real view. Read-only users still expand the same tree.
 await page.route('**/api/license-cards',async route=>{const response=await route.fetch(),data=await response.json();data.canEdit=false;await route.fulfill({response,json:data});});
 await page.evaluate(()=>window.BLLicenseCardsPage.invalidate());await atlasFrame.locator('[data-action="blRecovery"]').waitFor({state:'hidden'});
 await atlasFrame.locator('[data-action="edit"]').first().click();await atlasFrame.locator('.bl-business').waitFor();assert.equal(await atlasFrame.locator('[data-action="saveEditor"]').isVisible(),false);await atlasFrame.locator('[data-action="closeEditor"]').first().click();
 await atlasFrame.locator('[data-action="stage"][data-stage="concept"]').first().click();assert.ok(await title.isDisabled());
 console.log('PASS TR/EN, mobile without overflow, readonly expansion');
 // Delete the last pricing-only pair before it was ever materialized as a card.
 const prior=(await api('/api/pricing-rules')).data,newRule={...prior.rules[0],id:'nova-only-rule',license:'NOVA DEMO',licensor:'Demo New'};
 const added=await api('/api/pricing-rules',{method:'PUT',body:JSON.stringify({rules:[...prior.rules,newRule],expectedRevision:prior.revision})});assert.equal(added.status,200);
 const removed=await api('/api/pricing-rules',{method:'PUT',body:JSON.stringify({rules:prior.rules,expectedRevision:added.data.revision})});assert.equal(removed.status,200);
 const local=appRequire('./server/lib/local-db').createLocalDb(path.join(env.BUYER_LOG_LOCAL_DATA_ROOT,'BuyerLogLocal.db')),journal=appRequire('./server/lib/delta-store').createDeltaStore({localDb:local});await journal.hydrate();assert.deepEqual(journal.readAllSync('license-card')[cards.cardId('NOVA DEMO','Demo New')].contracts.rules,[]);
 console.log('PASS last virtual contract deletion stages an empty peer snapshot');
 console.log('ARTIFACTS '+root);
})().catch(async err=>{console.error(err);const p=browser?.contexts()[0]?.pages()[0];if(p){await p.screenshot({path:path.join(root,'failure.png')}).catch(()=>{});console.log((await p.locator('body').innerText()).slice(0,1200));const fr=await (await p.locator('.lcAtlasFrame').elementHandle())?.contentFrame();if(fr)console.log('OVERFLOW',await fr.evaluate(()=>[...document.querySelectorAll('body *')].filter(el=>{const r=el.getBoundingClientRect();return r.width&&r.right>innerWidth+1;}).slice(0,12).map(el=>[el.tagName,el.className,el.getBoundingClientRect().right,innerWidth]))); }process.exitCode=1;}).finally(async()=>{await browser?.close();server.kill();fs.closeSync(log);});
