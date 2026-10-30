/* Manual real-app acceptance for form field boundaries (7.0.322). Requires Playwright and
   Chromium. Starts its own server on demo data, visits every tab plus the shared modals in
   light/dark theme and asserts that every visible editable field (native input/select/
   textarea and value-showing custom triggers) has a boundary of at least 3:1 against its
   surroundings. Also asserts the License Royalty dialog has no Turkish UI text in EN.
   Env: PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, BUYER_LOG_FIELD_ARTIFACT_ROOT (screenshots),
   BUYER_LOG_FIELD_TEST_PORT (default 6463). */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const app=path.resolve(__dirname,'..');
const root=process.env.BUYER_LOG_FIELD_ARTIFACT_ROOT||fs.mkdtempSync(path.join(os.tmpdir(),'buyer-log-field-border-'));
const port=Number(process.env.BUYER_LOG_FIELD_TEST_PORT||6463),base=`http://127.0.0.1:${port}`;
fs.mkdirSync(root,{recursive:true});
const env={...process.env,BUYER_LOG_DATA_ROOT:path.join(root,'app'),BUYER_LOG_SERVER_DATA_ROOT:path.join(root,'server'),BUYER_LOG_LOCAL_DATA_ROOT:path.join(root,'local'),BUYER_LOG_TEMP_ROOT:path.join(root,'temp'),BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')};
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_TEMP_ROOT'])fs.mkdirSync(env[key],{recursive:true});
fs.mkdirSync(path.join(root,'source'),{recursive:true});
fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,sourceFolder:path.join(root,'source')}));
fs.writeFileSync(path.join(env.BUYER_LOG_SERVER_DATA_ROOT,'overrides.json'),JSON.stringify({_revision:0,_revisions:{pricingRules:1},pricingRules:[{id:'demo-rule',license:'NORTH STAR',licensor:'Demo Licensing',royalty:9,trCommission:5,ydCommission:9,hologramCost:0,opdStart:'',opdEnd:'2026-03-11',seasons:[],legacyTrHologramCost:.05}]}));
const MIN_RATIO=2.95; // 3:1 contract; tolerance only for sub-pixel colour blending
const MIN_DISABLED_RATIO=1.3; // inactive fields (WCAG 1.4.11 exempt) stay visible but softer
const TABS=['overview','cp','orders','koleksiyon','licensecards','manufacturers','quotations','priceanalysis','opencosting','shipping','backlog','lfl','automations','lcwai','source'];
// Open-only dialogs and drawers reachable from each tab; a missing/disabled opener is skipped.
const DIALOGS=[['cp','cpLicenseRoyaltyBtn'],['cp','cpEndeksmatikBtn'],['cp','cpCapacityRequestBtn'],['cp','cpHologramRequestBtn'],['koleksiyon','kolManageStatusesBtn'],['koleksiyon','kolEndeksmatikSetsBtn'],['koleksiyon','kolLflTrialBtn'],['koleksiyon','kolPricingExcelColsBtn'],['lfl','lflScenarioAddBtn'],['lfl','lflTrialBtn'],['opencosting','ocNewBtn'],['opencosting','ocFxBtn'],['shipping','shipFreightBtn'],['backlog','backlogPivotSettingsBtn'],['backlog','backlogExcelOptionsBtn'],['overview','ovHomeAddWidgetBtn']];
const server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',fs.openSync(path.join(root,'server.log'),'a'),fs.openSync(path.join(root,'server.log'),'a')]});
let browser;

function auditFields(label){
  const FIELD='input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=range]):not([type=file]):not([type=color]):not([type=button]):not([type=submit]),select,textarea,.pricingRuleSeasonBtn,.psaMultiTrigger,.lflDimBtn,.lflBreakdownBtn,.oabMultiTrigger,.cpaFieldPickerBtn,.endeksmatikMonthControl';
  const parse=c=>{const m=String(c).match(/[\d.]+/g)||[];const v=m.map(Number);if(v.length<4)v[3]=v.length?1:0;return v;};
  const lum=([r,g,b])=>{const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4);};return .2126*f(r)+.7152*f(g)+.0722*f(b);};
  const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
  const blend=(top,bot)=>[0,1,2].map(i=>top[i]*top[3]+bot[i]*(1-top[3]));
  const bgOf=el=>{const stack=[];for(let e=el;e;e=e.parentElement){const c=parse(getComputedStyle(e).backgroundColor);stack.push(c);if(c[3]>=1)break;}let col=[255,255,255];for(let i=stack.length-1;i>=0;i--)col=blend(stack[i],col);return col;};
  const out=[];
  for(const el of document.querySelectorAll(FIELD)){
    if(el.closest('td')||el.closest('.endeksmatikMonthControl')&&el.tagName==='INPUT')continue; // grid editors / composite inner input
    const rc=el.getBoundingClientRect(),cs=getComputedStyle(el);
    if(rc.width<20||rc.height<14||cs.visibility==='hidden'||cs.display==='none'||+cs.opacity===0)continue;
    if(rc.bottom<0||rc.top>innerHeight||rc.right<0||rc.left>innerWidth)continue;
    const hit=document.elementFromPoint(rc.left+rc.width/2,rc.top+Math.min(rc.height/2,10));
    if(!hit||!(hit===el||el.contains(hit)||hit.contains(el)))continue;
    const outer=el.parentElement?bgOf(el.parentElement):[255,255,255];
    const fill=ratio(bgOf(el),outer);
    const width=parseFloat(cs.borderTopWidth),border=width>0&&cs.borderTopStyle!=='none'?ratio(blend(parse(cs.borderTopColor),outer),outer):1;
    const best=Math.max(fill,border);
    const disabled=el.disabled||el.getAttribute('aria-disabled')==='true'||!!el.closest('fieldset:disabled');
    out.push({label,disabled,field:(el.id?'#'+el.id:el.tagName.toLowerCase()+'.'+String(el.className).trim().split(/\s+/)[0]).slice(0,60),text:(el.placeholder||el.textContent||'').trim().slice(0,30),ratio:+best.toFixed(2)});
  }
  return out;
}

(async()=>{
  for(let i=0;i<200;i++){try{if((await fetch(base+'/api/health')).status<500)break;}catch{}await new Promise(r=>setTimeout(r,250));}
  const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',newPassword:'demo-field-test-123',password:'demo-field-test-123'})});
  assert.equal(login.status,200,await login.text());const cookie=login.headers.get('set-cookie').split(';')[0];
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  const [name,...rest]=cookie.split('=');await context.addCookies([{name,value:rest.join('='),domain:'127.0.0.1',path:'/',httpOnly:true}]);
  await context.addInitScript(()=>{try{localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0');}catch{}setInterval(()=>document.querySelectorAll('.blRnDialog[open]').forEach(d=>d.close()),100);});
  let page;const errors=[];
  const closeLayers=()=>page.evaluate(()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());document.querySelectorAll('.warnOverlay,.modalOverlay,[role=dialog]').forEach(d=>{if(!d.closest('#app'))d.remove();});document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));});
  const results=[],opened=[];
  const boot=async()=>{if(page)await page.close({runBeforeUnload:false});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss().catch(()=>{}));
    await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.BLPerf&&typeof window.switchTab==='function',{timeout:60000});
    await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({timeout:4000}).catch(()=>{});
    await page.waitForFunction(()=>!document.getElementById('blBootGuard'),{timeout:60000});};
  for(const theme of ['light','dark']){
    await boot(); // her tema temiz sayfadan başlar; önceki çekmece/katman hit-test'i kapatmaz
    await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);
    for(const tab of TABS){
      await page.evaluate(t=>switchTab(t),tab);await page.waitForTimeout(1500);
      const found=await page.evaluate(auditFields,`${theme}/${tab}`);results.push(...found);
      if(['cp','orders','koleksiyon','manufacturers','priceanalysis','backlog','lfl'].includes(tab))assert.ok(found.length>0,`${theme}/${tab}: no field audited (blocked layer?)`);
      if(theme==='light')await page.screenshot({path:path.join(root,`${tab}.png`)});
    }
    for(const [tab,id] of DIALOGS){
      await closeLayers();await page.evaluate(t=>switchTab(t),tab);await page.waitForTimeout(800);
      const clicked=await page.evaluate(id=>{const b=document.getElementById(id);if(!b||b.disabled)return false;b.click();return true;},id);
      if(!clicked)continue;await page.waitForTimeout(1200);
      const found=await page.evaluate(auditFields,`${theme}/${tab}#${id}`);results.push(...found);opened.push(`${theme}/${id}:${found.length}`);
      await page.screenshot({path:path.join(root,`${theme}-${id}.png`)});
    }
    await closeLayers();
  }
  const weak=results.filter(r=>r.ratio<(r.disabled?MIN_DISABLED_RATIO:MIN_RATIO));
  fs.writeFileSync(path.join(root,'fields.json'),JSON.stringify(results,null,1));
  console.log('dialogs:',opened.join(' '));console.log(`checked ${results.length} visible fields in ${new Set(results.map(r=>r.label)).size} screens`);
  assert.deepEqual(weak,[],'every editable field needs a ≥3:1 boundary');
  console.log('PASS every visible editable field has a ≥3:1 boundary (light + dark)');

  await boot();
  // EN: the License Royalty dialog renders its own TR/EN pairs (no dictionary fallback).
  await page.evaluate(()=>{document.documentElement.setAttribute('data-theme','light');applyLanguage('en');switchTab('cp');});await page.waitForTimeout(1000);
  await page.evaluate(()=>document.getElementById('cpLicenseRoyaltyBtn').click());await page.locator('#_suppFobRulesModal .applyRule').first().waitFor({timeout:15000});
  const turkish=await page.evaluate(()=>{const m=document.getElementById('_suppFobRulesModal'),seen=[];const w=document.createTreeWalker(m,NodeFilter.SHOW_TEXT);while(w.nextNode()){const t=w.currentNode.nodeValue.trim();if(t&&/[çğıöşüÇĞİÖŞÜ]/.test(t)&&!w.currentNode.parentElement.closest('tbody td:not(:last-child),select'))seen.push(t);}for(const el of m.querySelectorAll('[placeholder],[aria-label],[title]'))for(const a of ['placeholder','aria-label','title'])if(/[çğıöşüÇĞİÖŞÜ]/.test(el.getAttribute(a)||''))seen.push(a+': '+el.getAttribute(a));return seen;});
  assert.deepEqual(turkish,[],'License Royalty dialog shows Turkish UI text in EN');
  assert.equal((await page.locator('#_suppFobRulesModal .applyRule').first().innerText()).trim(),'Apply');
  await page.screenshot({path:path.join(root,'royalty-en.png')});
  console.log('PASS License Royalty dialog is fully English in EN');
  assert.deepEqual(errors,[],'page errors');
  console.log('Artifacts:',root);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.kill();});
