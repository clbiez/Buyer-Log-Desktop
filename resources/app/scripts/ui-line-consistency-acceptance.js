'use strict';
// Çizgi arayüz stili bütünlük kabulü (DESIGN_SYSTEM.md §2.1, kararlar K1–K7).
// Real Buyer Log on isolated demo data. Requires Playwright + Chromium.
// NODE_PATH can point at an external Playwright installation. No production data is read.
// Opens every module and the shared drawers in the Line style and asserts that each
// component family has one look: actions, segments, fields, filter chips, headings,
// menus, drawers and permanent cards. A module that renders a private variant fails.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require('playwright');
const app=path.resolve(__dirname,'..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-line-consistency-'));
const port=Number(process.env.BUYER_LOG_LINE_AUDIT_PORT||6493),base=`http://127.0.0.1:${port}`;
const env={...process.env,BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')};
for(const [key,dir] of Object.entries({BUYER_LOG_DATA_ROOT:'app',BUYER_LOG_SERVER_DATA_ROOT:'server',BUYER_LOG_LOCAL_DATA_ROOT:'local',BUYER_LOG_TEMP_ROOT:'temp'})){
  env[key]=path.join(root,dir);fs.mkdirSync(env[key],{recursive:true});
}
env.BUYER_LOG_AUTH_DATA_ROOT=env.BUYER_LOG_SERVER_DATA_ROOT;
env.BL_DATA_DIR=env.BUYER_LOG_SERVER_DATA_ROOT;
const source=path.join(root,'source');fs.mkdirSync(source);
fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',sourceFolder:source,updates:{enabled:false}}));
const demo=require('./generate-demo-data').build({rows:120,seed:7,today:new Date('2026-11-14T00:00:00Z')});
const XLSX=require('xlsx');
for(const [name,rows] of [['ASAS',demo.asas],['Antrepo',demo.antrepo]]){
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),name);XLSX.writeFile(wb,path.join(source,`${name} - Demo.xlsx`));
}
const log=fs.openSync(path.join(root,'server.log'),'a');
const server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});
let browser,cookie;
function paletteAudit(){
  const MARKS='.badge,.bpaSeg,.bpaDot,.blvBuyerStackSeg,.bpaRingValue,.psaBarTrack i,.psaDonut :is(rect,circle),.mfpMonthBars i,.mfpLegend i,#backlogOverview .bpaTileValue';
  const rgb=v=>{const m=String(v||'').match(/rgba?\(([^)]+)\)/);if(!m)return null;const [r,g,b,a=1]=m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);return a<.05?null:[r,g,b];};
  const mark=rgb(getComputedStyle(document.documentElement).getPropertyValue('--ui-line-mark').trim().replace(/^#(..)(..)(..)$/,(_,a,b,c)=>`rgb(${parseInt(a,16)},${parseInt(b,16)},${parseInt(c,16)})`));
  const ok=c=>!c||Math.max(...c)-Math.min(...c)<=24||(mark&&c.every((v,i)=>Math.abs(v-mark[i])<=6));
  const out=new Set();
  for(const el of document.querySelectorAll('main > section.active :is('+MARKS+')')){
    const r=el.getBoundingClientRect();if(!r.width&&!r.height)continue;
    const cs=getComputedStyle(el),svg=el instanceof SVGElement;
    for(const [prop,value] of svg?[['fill',cs.fill],['stroke',cs.stroke]]:[['background',cs.backgroundColor],['color',cs.color]])
      if(!ok(rgb(value)))out.add(`${(el.getAttribute('class')||el.tagName).split(' ').slice(0,2).join('.')} ${prop} ${value}`);
  }
  return [...out].slice(0,8);
}
async function api(url,body){
  const res=await fetch(base+url,{method:body?'POST':'GET',headers:{cookie:cookie||'','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  assert.ok(res.ok,await res.clone().text());return res;
}
// Families and the selectors that own them (same lists as ui-components.css).
const FAMILIES={
  action:'.tbtn,.navActionBtn,.lflButton,.ocButton,.mfpBtn,.lcBtn,.lcwaiBtn:not(.is-link),.psaGhostBtn,.cpaBtn',
  chip:'button.kpiGroupLabel,.lcChip,.mfpChip,.lflDimBtn,.lflBreakdownBtn,.psaMultiTrigger,.oabMultiTrigger,.cpaFieldPickerBtn',
  segment:':is(.ovPremiumSegment,.ovInboxTabs,.ovBreakdownDims,.gfSegment,.bpaSeg2,.cpaSeg,.backlogChartTypeSwitch,.sourceModeGroup,.dmViewToggle,.quotationStatusTabs,.lcChips) > button',
  heading:'main > section :is(h1,h2,h3)',
  card:'.lflCard,.ocCard,.backlogChartPanel',
  drawer:'.blDetailDrawerPanel,.bpaDrawer,.blvFilterDrawer,.lmDrawer,.ovHomeDrawer,.cfpDrawer,.globalFlowDrawer,.kolPeriodDrawer,.colPanel,.tableFieldsDrawer',
  close:'[data-blv-close],[data-blvf-close],[data-bpa-close],[data-table-fields-close],[data-cpd-close],[data-home-drawer-close],.kolPeriodDrawerClose,.ovHomeDrawerClose,.umDrawerClose,.blDetailClose,.tableFieldsClose',
};
function audit(F){
  const vis=e=>{const r=e.getBoundingClientRect();const cs=getComputedStyle(e);return r.width>1&&r.height>1&&cs.visibility!=='hidden'&&cs.display!=='none';};
  const probe=document.createElement('span');document.body.appendChild(probe);
  const color=v=>{probe.style.color=`var(${v})`;return getComputedStyle(probe).color;};
  const ink=color('--ui-line-ink'),mark=color('--ui-line-mark'),divider=color('--ui-row-divider'),accent=color('--ui-accent'),surfaceStrong=color('--ui-surface-strong');
  probe.remove();
  const SHELL=F.segment+',.appTop *,.blSelectionBar *,td *,[role="menu"] *,.toolbarMoreMenu *,.blViewPickerMenu *,.railAppearanceMenu *,#corporateConnections *,.vfMenu *,'+F.close;
  const fail=[],count={};
  const id=e=>(e.id?'#'+e.id+' ':'')+String(e.className||e.tagName).split(/\s+/).slice(0,3).join('.')+' "'+(e.textContent||'').trim().slice(0,24)+'"';
  for(const e of document.querySelectorAll(F.action)){
    if(!vis(e)||e.matches(SHELL))continue;count.action=(count.action||0)+1;const cs=getComputedStyle(e);
    const border=cs.borderTopWidth==='1px'&&cs.borderTopStyle==='solid'&&[ink,mark,divider].includes(cs.borderTopColor);
    const bg=['rgba(0, 0, 0, 0)',accent,surfaceStrong].includes(cs.backgroundColor)||cs.backgroundColor===color('--ui-accent-hover');
    if(!border||!bg||!/Schibsted/.test(cs.fontFamily)||cs.fontWeight!=='500')fail.push(`action ${id(e)}: ${cs.borderTopWidth} ${cs.borderTopColor} ${cs.backgroundColor} ${cs.fontFamily.split(',')[0]} ${cs.fontWeight}`);
  }
  for(const e of document.querySelectorAll(F.chip)){
    if(!vis(e)||e.closest('td'))continue;count.chip=(count.chip||0)+1;const cs=getComputedStyle(e);
    if(!/JetBrains/.test(cs.fontFamily)||cs.fontWeight!=='400'||cs.borderTopWidth!=='1px'||cs.borderTopColor!==ink)fail.push(`chip ${id(e)}: ${cs.fontFamily.split(',')[0]} ${cs.fontWeight} ${cs.borderTopWidth} ${cs.borderTopColor}`);
  }
  for(const e of document.querySelectorAll(F.segment)){
    if(!vis(e))continue;count.segment=(count.segment||0)+1;const cs=getComputedStyle(e);
    const active=e.matches('.isActive,.is-active,.is-on,.active,[aria-pressed="true"],[aria-selected="true"]');
    if(cs.borderTopColor!==ink||(active?cs.backgroundColor!==accent:![`rgba(0, 0, 0, 0)`,surfaceStrong].includes(cs.backgroundColor)))fail.push(`segment ${id(e)}: active=${active} ${cs.borderTopColor} ${cs.backgroundColor}`);
  }
  for(const e of document.querySelectorAll(F.heading)){
    if(!vis(e)||e.closest('.autoEyebrow'))continue;count.heading=(count.heading||0)+1;const cs=getComputedStyle(e);
    if(cs.fontWeight!=='500'||cs.textTransform!=='none'||!/Schibsted/.test(cs.fontFamily))fail.push(`heading ${id(e)}: ${cs.fontSize} ${cs.fontWeight} ${cs.textTransform}`);
  }
  for(const e of document.querySelectorAll(F.card)){
    if(!vis(e))continue;count.card=(count.card||0)+1;const cs=getComputedStyle(e);
    if(cs.boxShadow!=='none')fail.push(`card ${id(e)}: permanent card has a shadow`);
  }
  for(const e of document.querySelectorAll(F.drawer)){
    if(!vis(e))continue;count.drawer=(count.drawer||0)+1;const cs=getComputedStyle(e);
    if(cs.borderLeftWidth!=='1px'||cs.borderLeftColor!==ink)fail.push(`drawer ${id(e)}: left ${cs.borderLeftWidth} ${cs.borderLeftColor}`);
  }
  for(const e of document.querySelectorAll(F.close)){
    if(!vis(e))continue;count.close=(count.close||0)+1;const cs=getComputedStyle(e);
    if(cs.borderTopStyle!=='none'&&cs.borderTopWidth!=='0px')fail.push(`close ${id(e)}: framed`);
  }
  return {fail,count};
}
(async()=>{
  console.log('Artifacts:',root);
  let ready=false;
  for(let i=0;i<160;i++){try{ready=(await fetch(base+'/api/health')).status<500;if(ready)break;}catch{}await new Promise(r=>setTimeout(r,250));}
  assert.ok(ready,'demo server did not start; see server.log');
  const login=await api('/api/user-login',{userId:'moderator',newPassword:'demo-line-123',password:'demo-line-123'});
  cookie=login.headers.get('set-cookie').split(';')[0];
  await api('/api/refresh',{});
  for(let i=0;i<160;i++){if(!(await (await api('/api/refresh-status')).json()).running)break;await new Promise(r=>setTimeout(r,250));}
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1600,height:1000},reducedMotion:'reduce'});
  const split=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),domain:'127.0.0.1',path:'/',httpOnly:true}]);
  await context.addInitScript(()=>localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0'));
  const page=await context.newPage(),errors=[],failures=[],totals={};
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof switchTab==='function',null,{timeout:60000});
  await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({timeout:4000}).catch(()=>{});
  await page.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:60000});
  const tabs=await page.evaluate(()=>[...document.querySelectorAll('nav.tabs button[data-tab]')].map(b=>b.dataset.tab));
  const check=async label=>{const r=await page.evaluate(audit,FAMILIES);for(const f of r.fail)failures.push(`${label} · ${f}`);for(const [k,v] of Object.entries(r.count))totals[k]=(totals[k]||0)+v;};
  const SEQUENCES=[
    ['cp',['[data-bl-view-picker="cp"] [data-bl-view-trigger]','[data-table-report="cp"]']],
    ['cp',['[data-bl-view-picker="cp"] [data-bl-view-trigger]','[data-table-fields="cp"]']],
    ['backlog',['#backlogOverviewFilter']],
    ['backlog',['#backlogOverview .bpaTile']],
  ];
  for(const theme of ['light','dark']){
    await page.evaluate(t=>{applyUiStyle('line',{persist:false});applyTheme(t);},theme);
    for(const tab of tabs){
      await page.evaluate(t=>switchTab(t),tab);await page.waitForTimeout(1800);
      await check(`${theme}/${tab}`);
      // Sunum A paleti: etiket ve grafik işaretleri nötr basamak ya da tek kırmızı vurgu.
      for(const f of await page.evaluate(paletteAudit))failures.push(`${theme}/${tab} · palette · ${f}`);
      if(theme==='light')await page.screenshot({path:path.join(root,`line-${tab}.png`)});
    }
    for(const [tab,seq] of SEQUENCES){
      await page.evaluate(t=>switchTab(t),tab);await page.waitForTimeout(1600);
      for(const s of seq){await page.click(s,{timeout:6000});await page.waitForTimeout(700);}
      await check(`${theme}/${tab} › ${seq.at(-1)}`);
      if(theme==='light')await page.screenshot({path:path.join(root,`line-${tab}-${seq.length}-${seq.at(-1).replace(/[^a-z]/gi,'')}.png`)});
      for(let k=0;k<3;k++){await page.keyboard.press('Escape');await page.waitForTimeout(200);}
    }
  }
  await page.evaluate(()=>{applyUiStyle('classic',{persist:false});applyTheme('light');});
  // Rapor görünümü: tablo yerinde rapora döner (çekmece açılmaz), aynı sayfa satırlarını gösterir, geri döner.
  const report={};
  for(const style of ['line','classic'])for(const key of ['cp','orders']){
    await page.evaluate(([s,k])=>{applyUiStyle(s,{persist:false});BLTableReportInline.setMode(k,false);switchTab(k);},[style,key]);await page.waitForTimeout(1500);
    await page.click(`[data-bl-view-picker="${key}"] [data-bl-view-trigger]`);await page.waitForTimeout(300);
    await page.click(`[data-table-report="${key}"]`);await page.waitForTimeout(900);
    const on=await page.evaluate(k=>{const el=document.querySelector(`[data-table-report-inline="${k}"]`),table=document.getElementById(k+'Table');
      return {inline:Boolean(el&&!el.hidden),rows:el?el.querySelectorAll('tbody tr').length:0,page:Number(document.querySelector(`#${k}TableToolbar [data-range-size]`)?.value)||0,
        tableHidden:getComputedStyle(table).display==='none',drawer:Boolean(document.querySelector('#blSharedDetailDrawer.is-open')),pressed:document.querySelector(`[data-table-report="${k}"]`).getAttribute('aria-pressed'),
        groups:[...el.querySelectorAll('thead th')].some(th=>/Sipariş \/ Model|Order \/ Model/.test(th.textContent))};},key);
    await page.click(`[data-table-report-inline="${key}"] [data-table-report-exit]`);await page.waitForTimeout(700);
    const off=await page.evaluate(k=>({tableShown:getComputedStyle(document.getElementById(k+'Table')).display!=='none',rows:document.querySelectorAll(`#${k}Table tbody tr`).length}),key);
    report[style+'/'+key]=`${on.rows} rows`;
    if(!on.inline||!on.tableHidden||on.drawer||on.pressed!=='true'||!on.groups||on.rows!==Math.min(on.page,on.rows)||on.rows<1)failures.push(`report ${style}/${key} · on ${JSON.stringify(on)}`);
    if(!off.tableShown||off.rows<1)failures.push(`report ${style}/${key} · off ${JSON.stringify(off)}`);
  }
  // Çizgi hareketi ve kimlik: hareket açık ayrı bağlamda; açılış çizilir, kapanış silinir, Klasik'e hiçbir şey eklenmez.
  const motionContext=await browser.newContext({viewport:{width:1600,height:1000},reducedMotion:'no-preference'});
  await motionContext.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),domain:'127.0.0.1',path:'/',httpOnly:true}]);
  await motionContext.addInitScript(()=>{localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0');window.__lineFrames=[];
    new MutationObserver(list=>{for(const m of list)for(const n of m.addedNodes)if(n.classList?.contains('blLineFrame'))window.__lineFrames.push(n.getAttribute('height')==='2'?'rule':n.querySelector('path')?.getAttribute('stroke-dashoffset')==='0'?'erase':'draw');}).observe(document,{childList:true,subtree:true});});
  const motion=await motionContext.newPage();motion.on('pageerror',e=>errors.push(e.message));
  await motion.goto(base,{waitUntil:'domcontentloaded'});
  await motion.waitForFunction(()=>typeof switchTab==='function',null,{timeout:60000});
  await motion.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({timeout:4000}).catch(()=>{});
  await motion.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:60000});
  const frames=async()=>{await motion.waitForTimeout(1200);return motion.evaluate(()=>{const f=window.__lineFrames;window.__lineFrames=[];return {draw:f.filter(x=>x==='draw').length,erase:f.filter(x=>x==='erase').length,rule:f.filter(x=>x==='rule').length};});};
  const motionResult={};
  for(const style of ['line','classic']){
    await motion.evaluate(s=>{applyUiStyle(s,{persist:false});switchTab('orders');},style);await frames();
    const steps={tab:await motion.evaluate(()=>switchTab('cp')).then(frames)};
    await motion.click('[data-bl-view-picker="cp"] [data-bl-view-trigger]');steps.menuOpen=await frames();
    await motion.keyboard.press('Escape');steps.menuClose=await frames();
    await motion.click('[data-bl-view-picker="cp"] [data-bl-view-trigger]');await motion.waitForTimeout(300);await motion.click('[data-table-fields="cp"]');steps.drawerOpen=await frames();
    await motion.click('[data-table-fields-close]').catch(()=>motion.keyboard.press('Escape'));steps.drawerClose=await frames();
    steps.logo=await motion.evaluate(()=>getComputedStyle(document.querySelector('.rail .blLineLogo')).display);
    motionResult[style]=steps;
    const ok=style==='line'
      ?steps.tab.rule>0&&steps.menuOpen.draw>0&&steps.menuClose.erase>0&&steps.drawerOpen.draw>0&&steps.drawerClose.erase>0&&steps.logo==='block'
      :Object.values(steps).every(v=>typeof v==='string'?v==='none':v.draw+v.erase+v.rule===0);
    if(!ok)failures.push(`motion ${style} · ${JSON.stringify(steps)}`);
  }
  await motionContext.close();
  fs.writeFileSync(path.join(root,'results.json'),JSON.stringify({totals,failures,report,motion:motionResult},null,2));
  assert.deepEqual(failures.slice(0,40),[],`${failures.length} Line style family deviations`);
  for(const family of Object.keys(FAMILIES))assert.ok(totals[family]>0,`${family}: no instance was rendered; the audit lost coverage`);
  assert.deepEqual(errors,[],'browser errors');
  console.log(`PASS Line style: ${tabs.length} modules × light/dark + 4 drawers · ${Object.entries(totals).map(([k,v])=>k+' '+v).join(' · ')}`);
  console.log(`PASS Report view in place (${Object.entries(report).map(([k,v])=>k+' '+v).join(', ')}) · Line motion draws/erases every surface, Classic adds none · Line logo only in Line`);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();
  if(server.exitCode===null){const stopped=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');const timer=setTimeout(()=>server.kill('SIGKILL'),5000);await stopped;clearTimeout(timer);}
  fs.closeSync(log);
});
