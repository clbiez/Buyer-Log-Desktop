/* Real-app sidebar acceptance. Isolated demo data; requires Playwright + Chromium.
   Run: PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium node scripts/sidebar-ui-acceptance.js
   BUYER_LOG_SIDEBAR_ARTIFACT_ROOT selects the screenshot/report directory. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const app=path.resolve(__dirname,'..');
const root=process.env.BUYER_LOG_SIDEBAR_ARTIFACT_ROOT||fs.mkdtempSync(path.join(os.tmpdir(),'buyer-log-sidebar-'));
const port=Number(process.env.BUYER_LOG_SIDEBAR_TEST_PORT||6464),base=`http://127.0.0.1:${port}`;
fs.mkdirSync(root,{recursive:true});
const env={...process.env,BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')};
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_TEMP_ROOT']){
  env[key]=path.join(root,key.toLowerCase());fs.mkdirSync(env[key],{recursive:true});
}
fs.mkdirSync(path.join(root,'source'),{recursive:true});
fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,sourceFolder:path.join(root,'source')}));
const log=fs.openSync(path.join(root,'server.log'),'a');
const server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});
let browser;
const results=[];
function geometry(){
  const rail=document.querySelector('.rail'),r=rail.getBoundingClientRect();
  const buttons=[...document.querySelectorAll('nav.tabs>button,.railFoot>button')];
  const rgb=c=>(c.match(/[\d.]+/g)||[]).slice(0,3).map(Number);
  const lum=c=>rgb(c).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;}).reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i],0);
  const contrast=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
  const railBg=getComputedStyle(rail).backgroundColor;
  return {railWidth:r.width,bodyLeft:parseFloat(getComputedStyle(document.body).paddingLeft),
    rows:buttons.map(b=>{const c=b.getBoundingClientRect(),i=b.querySelector('.ic').getBoundingClientRect();
      const cs=getComputedStyle(b),bg=cs.backgroundColor==='rgba(0, 0, 0, 0)'?railBg:cs.backgroundColor;
      return {id:b.dataset.tab||b.id,x:i.x+i.width/2,y:c.y,height:c.height,
        centerError:Math.abs(i.x+i.width/2-r.x-r.width/2),inside:c.x>=r.x&&c.right<=r.right+.5,
        contrast:contrast(cs.color,bg),name:b.querySelector('span')?.textContent.trim(),display:getComputedStyle(b.querySelector('span')).display};}),
    navOverflow:document.querySelector('nav.tabs').scrollHeight>document.querySelector('nav.tabs').clientHeight};
}
(async()=>{
  for(let i=0;i<160;i++){try{if((await fetch(base+'/api/health')).status<500)break;}catch{}await new Promise(r=>setTimeout(r,250));}
  const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',newPassword:'demo-sidebar-123',password:'demo-sidebar-123'})});
  assert.equal(login.status,200,await login.text());
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  const [name,...value]=login.headers.get('set-cookie').split(';')[0].split('=');
  await context.addCookies([{name,value:value.join('='),domain:'127.0.0.1',path:'/',httpOnly:true}]);
  await context.addInitScript(()=>{localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0');});
  const page=await context.newPage();
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.BLPerf&&typeof window.switchTab==='function',null,{timeout:60000});
  await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({timeout:4000}).catch(()=>{});
  await page.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:60000});
  for(const theme of ['light','dark'])for(const scale of ['compact','standard','large','xl'])for(const lang of ['tr','en']){
    const label=`${theme}/${scale}/${lang}`;
    await page.mouse.move(900,80);
    await page.evaluate(({theme,scale,lang})=>{
      document.activeElement?.blur();document.querySelector('.rail').classList.remove('railKeyboardOpen');
      applyLanguage(lang);Object.assign(document.documentElement.dataset,{theme,uiScale:scale,rail:'min'});
    },{theme,scale,lang});
    await page.waitForTimeout(50);
    const min=await page.evaluate(geometry);results.push({label,state:'min',...min});
    for(const row of min.rows){assert.ok(row.centerError<=.5,`${label} ${row.id}: icon is ${row.centerError}px off center`);assert.ok(row.inside,`${label} ${row.id}: row outside rail`);assert.ok(row.contrast>=4.5,`${label} ${row.id}: text contrast ${row.contrast}`);}
    assert.equal(min.railWidth,min.bodyLeft,`${label}: collapsed layout reservation`);
    if(scale==='standard'&&lang==='tr')await page.screenshot({path:path.join(root,`sidebar-${theme}-collapsed.png`)});
    await page.locator('nav.tabs>button').first().hover();
    const hover=await page.evaluate(geometry);results.push({label,state:'hover',...hover});
    assert.ok(hover.railWidth>min.railWidth,`${label}: hover expansion`);
    assert.equal(hover.bodyLeft,min.bodyLeft,`${label}: overlay must not move workspace`);
    for(let i=0;i<min.rows.length;i++){
      assert.ok(Math.abs(hover.rows[i].x-min.rows[i].x)<=.5,`${label} ${min.rows[i].id}: icon moves horizontally on hover`);
      assert.ok(Math.abs(hover.rows[i].y-min.rows[i].y)<=.5,`${label} ${min.rows[i].id}: row moves vertically on hover`);
    }
    if(scale==='standard'&&lang==='tr')await page.screenshot({path:path.join(root,`sidebar-${theme}-hover.png`)});
    await page.locator('#railCollapse').click();
    const max=await page.evaluate(geometry);results.push({label,state:'max',...max});assert.equal(max.railWidth,max.bodyLeft,`${label}: expanded layout reservation`);
    assert.equal(await page.locator('#railCollapse').getAttribute('aria-label'),lang==='en'?'Collapse menu':'Menüyü daralt',`${label}: collapse accessible name`);
    // Real click path persists the preference and retains accessible labels after collapsing.
    await page.locator('#railCollapse').click();await page.mouse.move(900,80);
    await page.locator('#railCollapse').evaluate(e=>e.blur());
    assert.equal(await page.locator('#railCollapse').getAttribute('aria-label'),lang==='en'?'Expand menu':'Menüyü genişlet',`${label}: expand accessible name`);
    assert.equal(await page.evaluate(()=>BLStorage.getItem('lcw_rail')),'min',`${label}: persisted collapsed state`);
    await page.getByRole('button',{name:lang==='en'?'Orders':'Siparişler',exact:true}).count().then(n=>assert.equal(n,1,`${label}: collapsed accessible name`));
    await page.locator('#railCollapse').click();
    if(scale==='standard'&&lang==='tr')await page.screenshot({path:path.join(root,`sidebar-${theme}-expanded.png`)});
  }
  await page.setViewportSize({width:960,height:480});
  await page.mouse.move(900,80);
  await page.evaluate(()=>{document.documentElement.dataset.rail='min';document.activeElement?.blur();});
  await page.keyboard.press('Tab');
  await page.locator('nav.tabs>button').first().focus();
  assert.ok(await page.locator('.rail').evaluate(e=>e.classList.contains('railKeyboardOpen')),'keyboard expands rail');
  assert.ok((await page.evaluate(geometry)).navOverflow,'short viewport scrolls navigation');
  await page.keyboard.press('End');
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.tab),'source','End focuses last module');
  await page.keyboard.press('Home');
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.tab),'overview','Home focuses first module');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.tab),'lcwai','ArrowDown moves focus');
  assert.equal(await page.locator('nav.tabs>button.active').getAttribute('data-tab'),'overview','focus does not activate a module');
  await page.locator('#railAppearanceBtn').click();
  await page.locator('#railThemeFxToggle').click();
  assert.equal(await page.locator('#themeFxEffect option:checked').textContent(),'Triangles folding in sequence','dynamic effect translated to EN');
  assert.equal(await page.locator('#themeFxSpeedValue').textContent(),'Fastest','dynamic speed translated to EN');
  await page.evaluate(()=>applyLanguage('tr'));
  assert.equal(await page.locator('#themeFxEffect option:checked').textContent(),'Sırayla katlanan üçgenler','open settings follow TR language');
  await page.evaluate(()=>applyLanguage('en'));
  const menuRect=await page.locator('#railAppearanceMenu').boundingBox();
  assert.ok(menuRect.y>=8&&menuRect.y+menuRect.height<=480,'expanded appearance settings fit short viewport');
  await page.screenshot({path:path.join(root,'sidebar-short-appearance.png')});
  await page.locator('#railAppearanceBtn').focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'railLangBtn','appearance menu keyboard entry');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#railAppearanceBtn').getAttribute('aria-expanded'),'false');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'railAppearanceBtn','Escape restores trigger focus');
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.rail').evaluate(e=>getComputedStyle(e).transitionDuration),'0s','reduced motion disables rail animation');
  await page.emulateMedia({reducedMotion:'no-preference'});
  assert.notEqual(await page.locator('.rail').evaluate(e=>getComputedStyle(e).transitionDuration),'0s','Motion+ controls rail transition');
  fs.writeFileSync(path.join(root,'geometry.json'),JSON.stringify(results,null,2));
  console.log(`PASS ${results.length} geometry states; short viewport, keyboard, appearance and Motion+. Artifacts: ${root}`);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.kill();fs.closeSync(log);});
