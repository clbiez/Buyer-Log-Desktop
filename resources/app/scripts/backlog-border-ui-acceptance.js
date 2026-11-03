'use strict';
// Real Buyer Log on isolated demo data. Requires Playwright + Chromium.
// NODE_PATH can point at an external Playwright installation. No production data is read.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require('playwright');
const app=path.resolve(__dirname,'..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-backlog-borders-'));
const port=Number(process.env.BUYER_LOG_BACKLOG_BORDER_PORT||6492),base=`http://127.0.0.1:${port}`;
const env={...process.env,BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')};
for(const [key,dir] of Object.entries({BUYER_LOG_DATA_ROOT:'app',BUYER_LOG_SERVER_DATA_ROOT:'server',BUYER_LOG_LOCAL_DATA_ROOT:'local',BUYER_LOG_TEMP_ROOT:'temp'})){
  env[key]=path.join(root,dir);fs.mkdirSync(env[key],{recursive:true});
}
env.BUYER_LOG_AUTH_DATA_ROOT=env.BUYER_LOG_SERVER_DATA_ROOT;
env.BL_DATA_DIR=env.BUYER_LOG_SERVER_DATA_ROOT;
const source=path.join(root,'source');fs.mkdirSync(source);
fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',sourceFolder:source,updates:{enabled:false}}));
const demo=require('./generate-demo-data').build({rows:20,seed:7,today:new Date('2026-11-03T00:00:00Z')});
const XLSX=require('xlsx');
for(const [name,rows] of [['ASAS',demo.asas],['Antrepo',demo.antrepo]]){
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),name);XLSX.writeFile(wb,path.join(source,`${name} - Demo.xlsx`));
}
const log=fs.openSync(path.join(root,'server.log'),'a');
const server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});
let browser,cookie;
async function api(url,body){
  const res=await fetch(base+url,{method:body?'POST':'GET',headers:{cookie:cookie||'','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  assert.ok(res.ok,await res.clone().text());return res;
}
// Inspect all rendered controls, including those below the fold. Do not count hidden
// templates, chart marks, grid editors or menu rows as framed form controls.
function audit(){
  const scope='#view-backlog,.blvFilterRoot,.bpaDrawerRoot';
  const visible=e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0&&getComputedStyle(e).visibility!=='hidden';
  const groups={
    frames:'.panel,.bpaCardBox,.bpaRing,.bpaControlGroup,.bpaSection,.bdaSection,.blvFilterDrawer,.bpaDrawer',
    actions:'.tbtn,.bpaTile,.bdaKpi,.blWorkspaceIconBtn,.blvModuleToggle,.bpaModuleToggle,.bdaTitleToggle,.bdaFoldHead,.bdaLink,.blvQualityChip,.bpaTodayBtn,.bpaSeg2>button,.backlogChartTypeSwitch>button,.blvFilterHeadActions button,.blvFilterEditorHead button,.blvFilterValueTools button,.blvFilterSourceTabs button',
    fields:'input:not([type="hidden"],[type="checkbox"],[type="radio"],[type="range"],[type="file"]),select,textarea,.oabMultiTrigger'
  };
  const results={},failures=[];
  for(const [kind,selectors] of Object.entries(groups)){
    const els=[...document.querySelectorAll(scope)].flatMap(root=>[...root.querySelectorAll(selectors)]).filter(visible);
    results[kind]=els.length;
    for(const el of els){
      if(el.closest('td'))continue;
      const cs=getComputedStyle(el),sides=['Top','Right','Bottom','Left'];
      const expected=cs.getPropertyValue(kind==='fields'&&!el.disabled&&!el.readOnly?'--ui-field-border':'--ui-group-divider').trim();
      // Enhanced dates form a single field: the input owns the left edge,
      // its calendar button owns the right edge.
      const checked=el.classList.contains('dateKeyboardInput')?sides.filter(s=>s!=='Right'):el.classList.contains('datePickerBtn')?sides.filter(s=>s!=='Left'):sides;
      const colorProbe=document.createElement('span');colorProbe.style.color=expected;document.body.appendChild(colorProbe);
      const color=getComputedStyle(colorProbe).color;colorProbe.remove();
      if(checked.some(side=>cs['border'+side+'Width']!=='1px'||cs['border'+side+'Style']!=='solid'||cs['border'+side+'Color']!==color)){
        failures.push({kind,id:el.id,cls:el.className,text:el.textContent.trim().slice(0,35),border:cs.borderTop});
      }
    }
  }
  return {counts:results,failures};
}
(async()=>{
  console.log('Artifacts:',root);
  let ready=false;
  for(let i=0;i<120;i++){try{ready=(await fetch(base+'/api/health')).status<500;if(ready)break;}catch{}await new Promise(r=>setTimeout(r,250));}
  assert.ok(ready,'demo server did not start; see server.log');
  const login=await api('/api/user-login',{userId:'moderator',newPassword:'demo-borders-123',password:'demo-borders-123'});
  cookie=login.headers.get('set-cookie').split(';')[0];
  await api('/api/refresh',{});
  for(let i=0;i<120;i++){if(!(await (await api('/api/refresh-status')).json()).running)break;await new Promise(r=>setTimeout(r,250));}
  const original=await (await api('/api/backlog-export?format=json')).json();assert.ok(original.rows.length>0);
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1600,height:1000},reducedMotion:'reduce'});
  const split=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),domain:'127.0.0.1',path:'/',httpOnly:true}]);
  await context.addInitScript(()=>localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0'));
  const page=await context.newPage(),errors=[],results=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof switchTab==='function',null,{timeout:60000});
  await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({timeout:4000}).catch(()=>{});
  await page.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:60000});
  await page.evaluate(async()=>{switchTab('backlog');await BLPerf.ensureFeature('backlogAnalysis');});
  await page.locator('#backlogOverview .bpaTile').first().waitFor();
  await page.evaluate(()=>document.getElementById('backlogPlanActualToggle').click());
  await page.locator('[data-bpa-control="preset"]').waitFor();
  for(const lang of ['tr','en'])for(const theme of ['light','dark'])for(const scale of ['standard','large','xl','compact']){
    await page.evaluate(({lang,theme,scale})=>{applyLanguage(lang);document.documentElement.dataset.theme=theme;document.documentElement.dataset.uiScale=scale;},{lang,theme,scale});
    await page.waitForTimeout(150);
    const result=await page.evaluate(audit),label=`${lang}/${theme}/${scale}`;
    assert.ok(result.counts.frames>=8&&result.counts.actions>=40&&result.counts.fields>=10,`${label}: incomplete rendered screen`);
    assert.deepEqual(result.failures,[],label);results.push({label,...result.counts});
    await page.locator('[data-range-unit="month"]').click();
    await page.locator('[data-range-unit="week"]').click();
    await page.locator('[data-range-unit="week"]').focus();await page.keyboard.press('Tab');
    const focus=await page.evaluate(()=>{const s=getComputedStyle(document.activeElement);return {style:s.outlineStyle,width:s.outlineWidth};});
    assert.deepEqual(focus,{style:'solid',width:'2px'},`${label}: keyboard focus`);
    if(scale==='standard'){
      await page.locator('#backlogDateRange').evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)parent.scrollTop=0;});
      await page.screenshot({path:path.join(root,`backlog-${lang}-${theme}.png`)});
    }
  }
  await page.evaluate(()=>{applyLanguage('tr');document.documentElement.dataset.theme='light';document.documentElement.dataset.uiScale='standard';document.getElementById('backlogOverviewFilter').click();});
  await page.locator('#blvFilterRoot.is-open [data-blvf-add]').first().waitFor();
  await page.locator('[data-blvf-add]').first().click();
  await page.locator('[data-blvf-value-search]').waitFor();
  for(const theme of ['light','dark']){
    await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
    assert.deepEqual((await page.evaluate(audit)).failures,[],`${theme}: filter drawer`);
    await page.screenshot({path:path.join(root,`backlog-filters-${theme}.png`)});
  }
  await page.locator('#blvFilterRoot .blvFilterHeadActions [data-blvf-close]').click();
  await page.locator('#blvFilterRoot').waitFor({state:'hidden'});
  await page.locator('#backlogOverview .bpaTile').first().click();
  await page.locator('#blvDrawer .bpaDrawer').waitFor();
  assert.deepEqual((await page.evaluate(audit)).failures,[],'order detail drawer');
  const after=await (await api('/api/backlog-export?format=json')).json();
  assert.deepEqual(after.rows,original.rows,'appearance controls must not mutate Backlog rows');
  assert.deepEqual(errors,[],'browser errors');
  fs.writeFileSync(path.join(root,'results.json'),JSON.stringify(results,null,2));
  console.log(`PASS ${results.length} TR/EN × light/dark × four-size screens; field/button/panel borders, focus, filter/detail drawers and unchanged rows`);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();
  if(server.exitCode===null){const stopped=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');const timer=setTimeout(()=>server.kill('SIGKILL'),5000);await stopped;clearTimeout(timer);}
  fs.closeSync(log);
});
