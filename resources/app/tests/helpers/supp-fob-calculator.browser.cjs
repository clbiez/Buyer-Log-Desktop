'use strict';
// Real shipped Buyer Log UI with isolated demo data and a local static server.
// PLAYWRIGHT_MODULE=<module> CHROMIUM_PATH=<exe> node --test tests/helpers/supp-fob-calculator.browser.cjs
// Optional SUPP_FOB_SCREENSHOT=<absolute PNG path> captures the actual result.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const express=require('express'),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');

test('Supp. FOB quick calculator in real Buyer Log',async t=>{
  const app=express();app.use(express.static(path.resolve(__dirname,'../../public')));
  app.use('/api',(_req,res)=>res.json({ok:true,rows:[],rules:[],items:[],revision:0}));
  const server=await new Promise(resolve=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));});
  const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:900},permissions:['clipboard-read','clipboard-write']});
    const page=await context.newPage(),errors=[],writes=[];page.setDefaultTimeout(8000);
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',req=>{if(req.url().includes('/api/')&&req.method()!=='GET')writes.push(req.method()+' '+new URL(req.url()).pathname);});
    await page.addInitScript(()=>{window.SERVER_BACKED=false;window.BL_USER_CONTEXT={id:'demo',displayName:'Demo Buyer',systemRole:'moderator',permissions:{manageBusinessRules:true},accessAreas:{cp:true,orders:true,overview:true,source:true,koleksiyon:true}};});
    await page.goto(`http://127.0.0.1:${server.address().port}/?module=cp`);
    await page.getByRole('button',{name:"Buyer Log'a devam et"}).click();
    await page.waitForFunction(()=>!blOverlayOpen());
    await page.evaluate(()=>{
      window.SERVER_BACKED=false;
      const row={_id:1,'Order Code':'DEMO-1001','Model Name':'DEMO KNIT','C.Code':'101','Order Quantity':4946,Country:'Bangladesh',Season:'S7',OPD:'2026-03-01',Licensor:'DEMO LICENSOR',License:'DEMO LICENSE','FOB ($)':2.27,'Supp. FOB':1.68,'Sub-Manufacturer':'Demo Supplier',STATUS:'OPEN','Ex-factory':'2027-03-13'};
      state.cp={rows:[row],fname:'Demo'};state.orders={rows:[{...row}],fname:'Demo'};
      state.overrides.pricingRules=normalizePricingRules([{id:'demo-rule',licensor:row.Licensor,license:row.License,opdStart:'2026-01-01',opdEnd:'2026-12-31',seasons:['S7'],royalty:17,trCommission:3,ydCommission:9,hologramCost:0}]);
      document.querySelectorAll('main section').forEach(section=>section.classList.toggle('active',section.id==='view-cp'));document.body.dataset.activeTab='cp';
      renderCPNow();
    });
    await page.waitForFunction(()=>!!window.BLRowMenu);
    const modal=page.locator('#_suppFobPricePreview'),input=page.locator('#_suppFobPreviewInput'),output=page.locator('#_suppFobPreviewFinal');
    t.afterEach(async()=>{if(await modal.count())await page.keyboard.press('Escape');});
    const snapshot=()=>page.evaluate(()=>JSON.stringify({cp:state.cp.rows,orders:state.orders.rows,overrides:state.overrides}));
    async function open(table='cpTable',language='tr'){
      await page.locator(`#${table} tbody td[data-key="Supp. FOB"]`).click({button:'right'});
      assert.equal(await page.getByRole('menuitem',{name:language==='tr'?'Başlıklarla kopyala':'Copy with headers',exact:true}).count(),1,JSON.stringify(await page.evaluate(()=>({menu:document.querySelector('.rowCtxMenu')?.innerText,overlay:blTopOverlay()?.className,language:appLang}))));
      await page.getByRole('menuitem',{name:language==='tr'?'Supp. FOB → Final FOB Hesapla':'Supp. FOB → Calculate Final FOB',exact:true}).click();
      await modal.waitFor({state:'visible'});
    }
    await t.test('right-click calculation preserves rows, overrides and checked selections; copying works',async()=>{
      await page.evaluate(()=>state.cpSelected.add(1));
      const before=await snapshot(),writeCount=writes.length;
      await open();assert.equal(await input.evaluate(el=>el===document.activeElement),true);
      await input.fill('1,85');assert.equal(await output.textContent(),'2,50');
      assert.match(await modal.innerText(),/Fark: \+0,23 USD/);
      await page.locator('[data-preview-copy]').click();
      await page.waitForFunction(async()=>await navigator.clipboard.readText()==='2,50');
      assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'2,50');
      assert.equal(await snapshot(),before);assert.equal(writes.length,writeCount);
      assert.deepEqual(await page.evaluate(()=>[...state.cpSelected]),[1]);
      if(process.env.SUPP_FOB_SCREENSHOT){
        // Allow shared Motion+ and transient startup/copy notifications to settle.
        await page.waitForTimeout(6000);
        await page.screenshot({path:process.env.SUPP_FOB_SCREENSHOT});
      }
      await page.keyboard.press('Escape');assert.equal(await modal.count(),0);
      await page.waitForFunction(()=>document.activeElement.id==='cpTable');
    });
    await t.test('compact card keeps contract details collapsed and preserves the trial when expanded',async()=>{
      await open();await input.fill('1,85');
      const details=modal.locator('details'),summary=details.locator('summary');
      assert.equal(await details.evaluate(el=>el.open),false);
      assert.equal(await modal.locator('[data-preview-contract]').isVisible(),false);
      await summary.focus();await page.keyboard.press('Enter');
      assert.equal(await details.evaluate(el=>el.open),true);
      assert.match(await modal.locator('[data-preview-contract]').innerText(),/Royalty 17%/);
      await page.keyboard.press('Enter');assert.equal(await details.evaluate(el=>el.open),false);
      assert.equal(await input.inputValue(),'1,85');assert.equal(await output.textContent(),'2,50');
      await page.keyboard.press('Escape');
    });
    await t.test('empty, malformed, negative and zero trials clear or replace previous output',async()=>{
      await open();
      for(const value of ['','abc','-1','1,2,3']){
        await input.fill(value);assert.equal(await output.textContent(),'—');
        assert.equal(await page.locator('[data-preview-copy]').isDisabled(),true);
        assert.match(await page.locator('#_suppFobPreviewStatus').innerText(),/fiyat girin/);
      }
      await input.fill('0');assert.equal(await output.textContent(),'0,00');
      await page.keyboard.press('Escape');
    });
    await t.test('TR, legacy hologram, missing rules, OPD/season mismatch and invalid totals use real matching',async()=>{
      await page.evaluate(()=>{state.cp.rows[0].Country='Türkiye';state.overrides.pricingRules[0].legacyTrHologramCost=0.079;});
      await open();await input.fill('1,85');assert.equal(await output.textContent(),'2,39');
      await modal.locator('summary').click();
      assert.match(await modal.innerText(),/TR komisyon 3% = 20%/);await page.keyboard.press('Escape');
      for(const patch of [{OPD:'2025-01-01'},{Season:'W9'}]){
        await page.evaluate(patch=>Object.assign(state.cp.rows[0],{OPD:'2026-03-01',Season:'S7'},patch),patch);
        await open();await input.fill('1');assert.equal(await output.textContent(),'—');
        assert.match(await page.locator('#_suppFobPreviewStatus').innerText(),/eşleşen lisans sözleşmesi yok/);await page.keyboard.press('Escape');
      }
      await page.evaluate(()=>{Object.assign(state.cp.rows[0],{OPD:'2026-03-01',Season:'S7'});state.overrides.pricingRules[0].royalty=97;});
      await open();await input.fill('1');assert.equal(await output.textContent(),'—');
      assert.match(await page.locator('#_suppFobPreviewStatus').innerText(),/%100/);await page.keyboard.press('Escape');
      await page.evaluate(()=>{state.overrides.pricingRules[0].royalty=17;state.cp.rows[0].Country='Bangladesh';});
    });
    await t.test('both languages, two themes and four UI sizes fit and trap keyboard focus with reduced motion',async()=>{
      await page.emulateMedia({reducedMotion:'reduce'});
      for(const language of ['tr','en'])for(const theme of ['light','dark'])for(const size of ['compact','standard','large','xl']){
        await page.evaluate(({language,theme,size})=>{applyLanguage(language);document.documentElement.dataset.theme=theme;document.documentElement.dataset.uiScale=size;},{language,theme,size});
        await open('cpTable',language);await input.fill('1.85');assert.equal(await output.textContent(),language==='tr'?'2,50':'2.50');
        const geometry=await modal.locator('[role="dialog"]').boundingBox();assert.ok(geometry.x>=0&&geometry.y>=0&&geometry.x+geometry.width<=1440&&geometry.y+geometry.height<=900);
        assert.ok(geometry.width<=360&&geometry.height<=240,`compact card: ${geometry.width}×${geometry.height}`);
        assert.equal(await modal.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
        await modal.locator('summary').focus();await page.keyboard.press('Tab');
        assert.equal(await modal.locator('[data-preview-close]').first().evaluate(el=>el===document.activeElement),true);
        await page.keyboard.press('Escape');assert.equal(await modal.count(),0);
      }
      await page.setViewportSize({width:960,height:620});await open('cpTable','en');
      assert.equal(await modal.evaluate(el=>el.scrollWidth<=el.clientWidth),true);await page.keyboard.press('Escape');
    });
    await t.test('Orders opens its own row; unrelated cells keep the copy-only menu',async()=>{
      await page.evaluate(()=>{applyLanguage('en');document.querySelectorAll('main section').forEach(s=>s.classList.toggle('active',s.id==='view-orders'));document.body.dataset.activeTab='orders';renderOrdersNow();});
      await open('ordersTable','en');await input.fill('1.85');assert.equal(await output.textContent(),'2.50');
      await modal.locator('summary').click();
      assert.match(await modal.innerText(),/Price trials do not change the order/);await page.keyboard.press('Escape');
      await page.locator('#ordersTable tbody td[data-key="Country"]').click({button:'right'});
      assert.equal(await page.getByRole('menuitem',{name:'Supp. FOB → Calculate Final FOB'}).count(),0);await page.keyboard.press('Escape');
    });
    await t.test('failed royalty refresh blocks stale preview; successful refresh uses latest rates',async()=>{
      await page.route('**/api/pricing-rules?*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Demo offline'})}));
      await page.evaluate(()=>{window.SERVER_BACKED=true;});
      await page.locator('#ordersTable tbody td[data-key="Supp. FOB"]').click({button:'right'});
      await page.getByRole('menuitem',{name:'Supp. FOB → Calculate Final FOB'}).click();
      await page.waitForFunction(()=>document.body.textContent.includes('Current royalty rules could not be loaded'));
      assert.equal(await modal.count(),0);
      await page.unroute('**/api/pricing-rules?*');
      const latest=await page.evaluate(()=>({...state.overrides.pricingRules[0],ydCommission:3}));
      await page.route('**/api/pricing-rules?*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({rules:[latest],revision:50})}));
      await open('ordersTable','en');await input.fill('1.85');assert.equal(await output.textContent(),'2.31');
      await page.keyboard.press('Escape');
    });
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
