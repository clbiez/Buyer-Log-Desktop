'use strict';
// Real shipped UI, card routes, account storage and supplier export; demo data only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'license-favorites-ui-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT=path.join(root,'server');process.env.BUYER_LOG_DATA_ROOT=path.join(root,'app');
const express=require('express'),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const cards=require('../../server/lib/license-cards'),prefs=require('../../server/lib/user-preferences');
const register=require('../../server/routes/license-card-routes'),KEY='buyerlog.favorites.licenseCards.v1';

test('personal license favorites with two viewers, a fresh browser session and a real atlas download',async()=>{
 const names=['BLUE HARBOR','NORTH STAR','ORBIT STUDIO','PAPER MOON','SUNNY DAYS','WILD GARDEN'];
 let store=cards.appendDiscovered({},names.map(license=>({license,licensor:'DEMO LICENSING'}))).overrides;
 for(const card of store.licenseCards.items)card.processAtlas={version:1,license:{id:card.id,name:card.license,agency:card.licensor,manufacturerVisible:true,stages:[{id:'concept',title:'Concept approval',enabled:true,approver:'licensor',submissions:[]}],addresses:[],portal:{url:'',notes:''}},sharedAddresses:[],visualLibrary:[]};
 const actors={alice:{id:'alice',enabled:true},bob:{id:'bob',enabled:true}},app=express();
 app.use(express.json());app.use((req,_res,next)=>{req.currentUser=actors[/demo-actor=bob/.test(req.headers.cookie||'')?'bob':'alice'];next();});
 app.get('/api/user-preferences',async(req,res)=>res.json({entries:(await prefs.loadAsync(req.currentUser.id)).entries}));
 app.put('/api/user-preferences',async(req,res)=>res.json(await prefs.mergeAsync(req.currentUser.id,req.body.entries)));
 register(app,{loadOverrides:()=>store,saveOverrides:next=>{store=next;return store;},getLicenseDiscoveryRows:async()=>({rows:[]}),publishSharedMasterChange(){},userAccess:{requireAnyArea:()=>((_req,_res,next)=>next()),requirePermission:()=>((_req,res)=>res.status(403).json({code:'FORBIDDEN'})),hasPermission:()=>false,hasArea:()=>true,sessionProfile:req=>req.currentUser,appendAudit(){}}});
 app.use(express.static(path.resolve(__dirname,'../../public')));app.use('/api',(_req,res)=>res.json({ok:true,rows:[],rules:[],items:[],revision:0}));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 const errors=[];
 async function open(actor){
  const context=await browser.newContext({viewport:{width:1600,height:1000},acceptDownloads:true});await context.addCookies([{name:'demo-actor',value:actor,url:base}]);
  await context.addInitScript(({actor})=>{window.SERVER_BACKED=false;window.BL_USER_CONTEXT={id:actor,displayName:'Demo Buyer',systemRole:'buyer',permissions:{manageBusinessRules:false},accessAreas:{cp:true,orders:true,overview:true,source:false,koleksiyon:true}};},{actor});
  const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/?module=cp');await page.getByRole('button',{name:"Buyer Log'a devam et"}).click();await page.waitForFunction(()=>!blOverlayOpen());
  await page.evaluate(()=>{window.SERVER_BACKED=false;switchTab('licensecards');});await page.locator('.lcRow').first().waitFor();return page;
 }
 try{
  const alice=await open('alice'),before=JSON.stringify(store),rows=alice.locator('.lcRow');assert.equal(await rows.count(),6);
  assert.equal(await alice.locator('.lcRate').first().isDisabled(),true);assert.equal(await alice.locator('[data-lc-act="newCard"]').count(),0);
  const first=await rows.nth(0).getAttribute('data-row'),second=await rows.nth(1).getAttribute('data-row');
  await rows.nth(0).locator('[data-lc-act="favorite"]').click();await rows.nth(1).locator('[data-lc-act="favorite"]').click();
  await alice.evaluate(()=>window.BLStorage.flushPending());assert.deepEqual(JSON.parse((await prefs.loadAsync('alice')).entries[KEY].value),[first,second]);
  // The shortcut includes favorites hidden by search, retaining manual selections.
  await rows.nth(5).locator('[data-lc-select]').check();await alice.locator('#lcSearch').fill('WILD GARDEN');await alice.locator('[data-lc-act="selectFavorites"]').click();
  assert.match(await alice.locator('.lcSelectionBar').innerText(),/3 lisans seçildi/);
  await alice.locator('[data-lc-act="clearSelection"]').click();await alice.locator('#lcSearch').fill('');await alice.locator('[data-lc-act="selectFavorites"]').click();assert.equal(await alice.locator('[data-lc-select]:checked').count(),2);
  const bob=await open('bob');assert.equal(await bob.locator('[data-lc-act="favorite"][aria-pressed="true"]').count(),0);
  await bob.locator('.lcRow').nth(2).locator('[data-lc-act="favorite"]').click();await bob.evaluate(()=>window.BLStorage.flushPending());
  assert.deepEqual(JSON.parse((await prefs.loadAsync('alice')).entries[KEY].value),[first,second]);
  const freshAlice=await open('alice');await freshAlice.locator('[data-lc-act="favorite"][aria-pressed="true"]').nth(1).waitFor();assert.equal(await freshAlice.locator('[data-lc-select]:checked').count(),0);
  await alice.locator('[data-lc-act="favoritesOnly"]').click();assert.equal(await alice.locator('.lcRow').count(),2);
  await alice.locator('[data-lc-act="favoritesOnly"]').click();await alice.locator('[data-lc-act="favorite"]').first().focus();await alice.keyboard.press('Space');assert.equal(await alice.locator('[data-lc-act="favorite"][aria-pressed="true"]').count(),1);
  await alice.keyboard.press('Space');assert.equal(await alice.locator('[data-lc-act="favorite"][aria-pressed="true"]').count(),2);
  const download=alice.waitForEvent('download');await alice.locator('[data-lc-act="export"]').click();const html=fs.readFileSync(await (await download).path(),'utf8');
  assert.ok(html.includes('BLUE HARBOR')&&html.includes('NORTH STAR'));assert.ok(!html.includes('WILD GARDEN'));
  assert.equal(JSON.stringify(store),before,'personal favorites and export never change shared cards');
  assert.equal(await alice.evaluate(()=>fetch('/api/license-cards/'+document.querySelector('.lcRow').dataset.row,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({profile:{workingNotes:'denied'}})}).then(r=>r.status)),403);
  for(const language of ['en','tr']){
   await alice.evaluate(language=>{appLang=language;window.BLLicenseCardsPage.renderLanguage();},language);
   assert.equal(await alice.getByRole('button',{name:language==='en'?'Select favorites':'Favorileri seç',exact:true}).isVisible(),true);
  }
  await alice.emulateMedia({reducedMotion:'reduce'});
  for(const theme of ['dark','light']){
   await alice.evaluate(theme=>{document.documentElement.dataset.theme=theme;window.BLLicenseCardsPage.renderLanguage();},theme);
   assert.equal(await alice.locator('[data-lc-act="favorite"][aria-pressed="true"]').count(),2);
   assert.ok((await alice.locator('[data-lc-act="selectFavorites"]').boundingBox()).y<(await alice.locator('.lcTable').boundingBox()).y);
  }
  if(process.env.LICENSE_FAVORITES_SCREENSHOT){await alice.locator('[data-lc-act="selectFavorites"]').focus();await alice.screenshot({path:process.env.LICENSE_FAVORITES_SCREENSHOT});}
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});}
});
