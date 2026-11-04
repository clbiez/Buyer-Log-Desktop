'use strict';
// Actual shipped UI and routes; all storage and source data are isolated in memory.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const express=require('express'),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const cards=require('../../server/lib/license-cards'),validators=require('../../server/lib/resource-rule-service');
const register=require('../../server/routes/license-card-routes');

test('unified license workspace with demo data',async()=>{
 const rule=(id,categories=[],royalty=10)=>({id,license:'Brawl Demo',licensor:'ERMODA DEMO',opdStart:'',opdEnd:'',seasons:[],categories,royalty,trCommission:2,ydCommission:4,hologramCost:.057,legacyTrHologramCost:.079});
 let store=cards.appendDiscovered({pricingRules:[rule('general'),rule('home',['Home'],3),rule('tee',['T-shirt'],5)],_revision:1},[{license:'Brawl Demo',licensor:'ERMODA DEMO'},...Array.from({length:45},(_,i)=>({license:`Demo ${String(i).padStart(2,'0')}`,licensor:'DEMO AGENCY'}))]).overrides;
 const actor={id:'demo',enabled:true},audit=[],app=express();let permission=true;
 app.use(express.json());app.use((req,_res,next)=>{req.currentUser=actor;next();});
 register(app,{...validators,loadOverrides:()=>store,saveOverrides:next=>{store=next;return store;},getLicenseDiscoveryRows:async()=>({rows:[]}),publishSharedMasterChange:()=>{},
  userAccess:{requireAnyArea:()=>((_req,_res,next)=>next()),requirePermission:()=>((_req,res,next)=>permission?next():res.status(403).json({code:'FORBIDDEN'})),hasPermission:()=>permission,hasArea:()=>true,sessionProfile:()=>actor,appendAudit:(...args)=>audit.push(args)}});
 app.use(express.static(path.resolve(__dirname,'../../public')));app.use('/api',(_req,res)=>res.json({ok:true,rows:[],rules:[],items:[],revision:0}));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];
  page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.SERVER_BACKED=false;window.BL_USER_CONTEXT={id:'demo',displayName:'Demo Buyer',systemRole:'moderator',permissions:{manageBusinessRules:true},accessAreas:{cp:true,orders:true,overview:true,source:true,koleksiyon:true}};});
  await page.goto(`http://127.0.0.1:${server.address().port}/?module=cp`);
  await page.getByRole('button',{name:"Buyer Log'a devam et"}).click();await page.waitForFunction(()=>!blOverlayOpen());
  await page.evaluate(()=>{window.SERVER_BACKED=false;state.cp={rows:[{_id:1,'Order Code':'DEMO-1',License:'Brawl Demo',Licensor:'ERMODA DEMO',Category:'Home',Country:'TR',Season:'',OPD:'2026-11-04','FOB ($)':10}],fname:'Demo'};switchTab('licensecards');});
  await page.locator('.lcRow').first().waitFor();assert.equal(await page.locator('.lcRow').count(),46);
  await page.locator('#lcSearch').fill('ERMO; BRAW');assert.equal(await page.locator('.lcRow').count(),1);
  await page.locator('#lcSearch').fill('ERMO, DEMO AGENCY');assert.equal(await page.locator('.lcRow').count(),46);
  await page.locator('#lcSearch').fill('!ERMO');assert.equal(await page.locator('.lcRow').count(),45);
  await page.locator('#lcSearch').fill('');
  const toolbar=await page.locator('.lcToolbar').boundingBox();await page.locator('.lcTable').evaluate(el=>el.scrollTop=500);
  assert.equal((await page.locator('.lcToolbar').boundingBox()).y,toolbar.y);
  assert.ok(await page.locator('.lcTable').evaluate(el=>el.scrollTop>0&&el.scrollHeight>el.clientHeight));
  await page.locator('.lcRow').nth(20).locator('[data-lc-select]').check();assert.ok(await page.locator('.lcTable').evaluate(el=>el.scrollTop>0));
  assert.ok((await page.locator('[data-lc-act="export"]').boundingBox()).y<(await page.locator('.lcTable').boundingBox()).y);
  // Three-way calculator uses the exact existing decimal/hologram engine and never writes.
  assert.equal(await page.evaluate(()=>endeksmatikRoyaltyRule('cp',state.cp.rows[0]).royalty),5);assert.equal(await page.evaluate(()=>endeksmatikRoyaltyRule('orders',state.cp.rows[0]).royalty),5);
  const before=JSON.stringify(store);await page.locator('#lcQuickRule').selectOption('home');await page.locator('#lcQuickSupp').fill('1');
  assert.equal(await page.locator('#lcQuickTr').inputValue(),'1,13');assert.equal(JSON.stringify(store),before);
  await page.locator('#lcQuickTr').fill('10');assert.equal(await page.locator('#lcQuickSupp').inputValue(),'9,42');
  await page.locator('#lcQuickSupp').fill('abc');assert.equal(await page.locator('#lcQuickYd').inputValue(),'');
  await page.locator('#lcQuickSupp').blur();
  // Create and persist a manual card through the shipped permissioned transaction.
  await page.locator('[data-lc-act="newCard"]').click();await page.locator('[data-lc-new="license"]').fill('Manual Demo');await page.locator('[data-lc-new="licensor"]').fill('MANUAL AGENCY');
  await page.locator('[data-lc-act="createCard"]').click();await page.waitForFunction(()=>document.querySelector('.lcName')?.textContent?.includes('Brawl')&&[...document.querySelectorAll('.lcName')].some(el=>el.textContent.includes('Manual Demo')));
  assert.ok(store.licenseCards.items.some(c=>c.license==='Manual Demo'));assert.ok(audit.some(a=>a[1]==='LICENSE_CARD_CREATE'));
  // Category editing adds an independent scope and retains the general contract.
  await page.locator('#lcSearch').fill('Brawl');await page.locator('[data-lc-act="expand"]').first().click();
  await page.locator('[data-lc-act="addCategory"]').click();const category=page.locator('[data-lc-key="categories"]').last();
  await category.fill('Accessories');const contract=category.locator('..');await contract.locator('[data-lc-key="royalty"]').fill('7');
  await contract.locator('[data-lc-act="checkRule"]').click();await page.locator('#lcQuickSupp').fill('1');assert.equal(await page.locator('#lcQuickTr').inputValue(),'1,18');
  await contract.locator('[data-lc-key="hologramCost"]').fill('0,10');
  await page.locator('.lcDetailFoot [data-lc-act="save"]').click();await page.waitForFunction(()=>!document.querySelector('.lcRow.isDirty'));
  assert.equal(store.pricingRules.length,4);assert.equal(store.pricingRules.find(r=>r.id==='general').opdEnd,'');assert.equal(store.pricingRules.find(r=>r.categories?.includes('Accessories')).royalty,7);assert.equal(store.pricingRules.find(r=>r.categories?.includes('Accessories')).legacyTrHologramCost,null);
  // The contracts view keeps the removed screen's filters, sorting and editing access.
  await page.locator('[data-lc-act="contractView"]').click();assert.equal(await page.locator('.lcContractRecord').count(),4,JSON.stringify(errors));
  await page.locator('[data-lc-contract-filter="hologramCost"]').fill('0,057');assert.equal(await page.locator('.lcContractRecord').count(),3);await page.locator('[data-lc-contract-filter="hologramCost"]').fill('');
  await page.locator('[data-lc-contract-filter="categories"]').fill('Home');assert.equal(await page.locator('.lcContractRecord').count(),1);
  await page.locator('[data-lc-contract-filter="categories"]').fill('');await page.locator('[data-lc-contract-sort="royalty"]').click();
  assert.equal(await page.locator('.lcContractRecord').first().locator('[data-lc-key="royalty"]').inputValue(),'3');
  await page.locator('.lcContractRecord').first().locator('[data-lc-act="openContract"]').click();
  // Background refresh detects same-card conflicts and preserves the typed draft.
  const rate=page.locator('.lcRow [data-lc-rate="royalty"]').first();await rate.fill('8');await rate.blur();
  const current=cards.responseOf(store,true).cards.find(c=>c.license==='Brawl Demo');store=cards.updateCard(store,current.id,{editToken:current.editToken,profile:{workingNotes:'Changed elsewhere'}},validators).overrides;
  await page.evaluate(()=>window.BLLicenseCardsPage.invalidate());await page.locator('.lcRow.isConflict').waitFor();assert.equal(await rate.inputValue(),'8');
  await page.locator('.lcRow.isConflict [data-lc-act="discard"]').click();
  // All legacy entry points route here, including a contract deep link.
  await page.evaluate(()=>openSuppFobRulesModal('home'));assert.equal(await page.locator('#_suppFobRulesModal').count(),0);assert.equal(await page.locator('.lcDetail').count(),1);
  if(process.env.LICENSE_CARDS_SCREENSHOT){await page.locator('#lcQuickRule').selectOption('home');await page.locator('#lcQuickSupp').fill('1');await page.locator('#lcQuickSupp').blur();await page.locator('.lcTable').evaluate(el=>el.scrollTop=0);await page.waitForTimeout(1200);await page.screenshot({path:process.env.LICENSE_CARDS_SCREENSHOT});}
  if(process.env.LICENSE_CARDS_CAPTURE_DIR){
    const dir=process.env.LICENSE_CARDS_CAPTURE_DIR;
    assert.match(await page.locator('.lcName').first().innerText(),/Home/);
    await page.locator('[data-lc-act="newCard"]').click();await page.locator('[data-lc-new="license"]').fill('Future Demo');await page.locator('[data-lc-new="licensor"]').fill('DEMO AGENCY');
    await page.locator('[data-lc-new="licensor"]').blur();await page.screenshot({path:path.join(dir,'license-cards-manual.png')});await page.locator('.lcCreate [data-lc-act="newCard"]').click();
    await page.locator('[data-lc-act="contractView"]').click();await page.locator('[data-lc-contract-filter="licensor"]').fill('ERMO');await page.locator('[data-lc-contract-filter="licensor"]').blur();
    await page.screenshot({path:path.join(dir,'license-cards-contracts.png')});await page.locator('[data-lc-act="contractView"]').click();
  }
  // Changing a pending period scope/date and deleting it cannot close the general fallback.
  await page.evaluate(()=>openSuppFobRulesModal('general'));await page.locator('[data-lc-act="addPeriod"]').click();
  let pending=page.locator('.lcContract').first();const pendingId=await pending.locator('[data-lc-key="categories"]').getAttribute('data-lc-rule');
  await pending.locator('[data-lc-key="categories"]').fill('Home Future');await pending.locator('.dateKeyboardInput[data-lc-key="opdStart"]').fill('01.01.27');await pending.locator('.dateKeyboardInput[data-lc-key="opdStart"]').blur();
  assert.equal(await page.locator('input[type="date"][data-lc-rule="general"][data-lc-key="opdEnd"]').inputValue(),'');
  page.once('dialog',dialog=>dialog.accept());await page.locator(`[data-lc-act="deleteRule"][data-rule-id="${pendingId}"]`).click();
  await page.locator('[data-lc-act="addPeriod"]').click();pending=page.locator('.lcContract').first();const secondId=await pending.locator('[data-lc-key="categories"]').getAttribute('data-lc-rule');
  page.once('dialog',dialog=>dialog.accept());await page.locator(`[data-lc-act="deleteRule"][data-rule-id="${secondId}"]`).click();
  assert.equal(await page.locator('input[type="date"][data-lc-rule="general"][data-lc-key="opdEnd"]').inputValue(),'');assert.equal(store.pricingRules.length,4);
  // Both languages, themes and all shared interface scales keep actions outside the scroller.
  for(const language of ['tr','en'])for(const theme of ['light','dark'])for(const scale of ['s','m','l','xl']){
    await page.evaluate(({language,theme,scale})=>{appLang=language;document.documentElement.dataset.theme=theme;document.documentElement.dataset.uiScale=scale;window.BLLicenseCardsPage.renderLanguage();},{language,theme,scale});
    assert.equal(await page.locator('[data-lc-act="newCard"]').isVisible(),true);
    assert.ok((await page.locator('.lcTable').boundingBox()).height>100);
    assert.ok(await page.evaluate(()=>document.scrollingElement.scrollHeight<=innerHeight+1));
  }
  await page.emulateMedia({reducedMotion:'reduce'});await page.locator('[data-lc-act="contractView"]').click();assert.ok(await page.locator('.lcContractRecord').count()>0);
  // Revoked edit permission cannot create a card.
  permission=false;const denied=await page.evaluate(()=>fetch('/api/license-cards',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({license:'Denied'})}).then(r=>r.status));assert.equal(denied,403);assert.ok(!store.licenseCards.items.some(c=>c.license==='Denied'));
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
