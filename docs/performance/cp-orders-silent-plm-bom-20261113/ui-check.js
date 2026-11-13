'use strict';
// Real Buyer Log server + Chromium on an isolated synthetic fixture (no business data, no PLM/AI network).
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),net=require('node:net');
const {chromium}=require('playwright');
const arg=(n,f)=>{const i=process.argv.indexOf(n);return i<0?f:process.argv[i+1];};
const APP=path.resolve(arg('--app'));const SRC=path.resolve(arg('--fixture'));const root=path.resolve(arg('--root'));const mode=arg('--mode','probe');const out=arg('--out','');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
fs.rmSync(root,{recursive:true,force:true});fs.cpSync(SRC,root,{recursive:true});
const env={...process.env,BUYER_LOG_CENTRAL_IAM_ENABLED:'0',BUYER_LOG_SERVER_DATA_ROOT:path.join(root,'data'),BUYER_LOG_AUTH_DATA_ROOT:path.join(root,'data'),
  BUYER_LOG_DATA_ROOT:path.join(root,'app'),BUYER_LOG_LOCAL_DATA_ROOT:path.join(root,'local'),BUYER_LOG_LOCAL_DB:path.join(root,'local','BuyerLogLocal.db'),
  BUYER_LOG_CONFIG_PATH:path.join(root,'config.json'),BUYER_LOG_TEMP_ROOT:path.join(root,'tmp')};
async function freePort(){return new Promise(r=>{const s=net.createServer();s.listen(0,()=>{const p=s.address().port;s.close(()=>r(p));});});}
(async()=>{
  const port=await freePort();env.PORT=String(port);env.BUYER_LOG_PORT=String(port);
  const log=fs.openSync(path.join(root,'ui-server.log'),'a');
  const server=spawn(process.execPath,[path.join(APP,'server/server.js')],{cwd:APP,env,stdio:['ignore',log,log]});
  let base='';
  try{
    const cfg=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8'));
    for(let i=0;i<120;i++){for(const p of [port,cfg.port,3000,3210]){if(!p)continue;try{const r=await fetch(`http://127.0.0.1:${p}/api/status`);if(r.status<500){base=`http://127.0.0.1:${p}`;break;}}catch(_){}}if(base)break;await delay(250);}
    if(!base)throw Error('server not up');
    const password='synthetic-startup-only-123';
    const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',password,newPassword:password})});
    const cookie=String(login.headers.get('set-cookie')||'').split(';')[0];
    const browser=await chromium.launch();
    const context=await browser.newContext({viewport:{width:1500,height:900},deviceScaleFactor:Number(arg('--dpr',1)),reducedMotion:'reduce'});
    const [name,value]=cookie.split('=');await context.addCookies([{name,value,url:base}]);
    const page=await context.newPage();
    const requests=[];page.on('request',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/plm-sync/bom/silent')||/corenectum|lcwai/i.test(u.pathname))requests.push({path:u.pathname,at:Date.now()});});
    await page.goto(base+'/?module=cp',{waitUntil:'domcontentloaded',timeout:120000});
    await page.waitForFunction(()=>window.BLBootGuard,null,{timeout:600000}).catch(()=>{});
    await page.waitForFunction(()=>Number.isFinite(window.__startupProbe?.startupReadyMs)||document.getElementById('blBootGuard')?.dataset.ready==='1'||state?.cp?.rows?.length>0,null,{timeout:600000,polling:250}).catch(()=>{});
    await page.evaluate(()=>window.BLBootGuard?.continue?.({})).catch(()=>{});
    await page.waitForFunction(()=>state.cp?.rows.length>0&&document.querySelector('#cpTable tbody tr[data-id]'),null,{timeout:600000,polling:250});
    const result={mode,base};
    result.rows=await page.evaluate(()=>({cp:state.cp.rows.length,withPlm:state.cp.rows.filter(r=>r['PLM ID']).length,sample:state.cp.rows.slice(0,3).map(r=>r['PLM ID']),ids:window.BLCPPlmDetails?.ids?.().length,silent:Boolean(window.BLCPPlmSilentBom),silentStatus:window.BLCPPlmSilentBom?.status?.()}));
    if(mode==='patch'){
      const ids=await page.evaluate(()=>window.BLCPPlmDetails.ids().slice(0,100));
      const store={schemaVersion:2,_revision:1,_updatedAt:new Date().toISOString(),models:{}};
      const entry=(id,v)=>({plmId:id,styleId:'9'+id,fabric:`SYNTH FABRIC v${v}`,placements:v===1?[{componentCode:'B1',placement:'front_body',printType:'Pigment',count:1}]:[{componentCode:'B1',placement:'front_body',printType:'Pigment',count:1},{componentCode:'B2',placement:'back_body',printType:'Pigment',count:1}],ai:{status:'not-needed'}});
      for(const id of ids)store.models[id]=entry(id,1);
      fs.writeFileSync(path.join(root,'data','plm-bom.json'),JSON.stringify(store));
      await page.evaluate(()=>window.BLCPPlmDetails.refresh());await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
      // make table scroll a bit and mark nodes/selection to verify they survive
      if(process.env.NOSELECT)await page.evaluate(()=>{window.__select=false;});
      const before=await page.evaluate(ids=>{
        const wrap=document.querySelector('#cpTable')?.closest('.tablewrap')||document.scrollingElement;wrap.scrollTop=400;wrap.scrollLeft=200;
        const trs=[...document.querySelectorAll('#cpTable tbody tr[data-id]')];trs.forEach(tr=>{tr.__mark=1;});
        const first=state.cp.rows.find(r=>ids.includes(String(r['PLM ID'])));const chk=document.querySelector(`#cpTable tbody tr[data-id="${first._id}"] input.rowChk`);if(window.__select!==false&&chk&&!chk.checked)chk.click();
        const td=document.querySelector(`#cpTable tbody tr[data-id="${first._id}"] > td[data-key="Artwork Detail"]`);
        let renders=0;const orig=window.renderCP;window.__renders=()=>renders;try{window.renderCP=function(){renders++;return orig.apply(this,arguments);};}catch(_){}
        return {scrollTop:wrap.scrollTop,scrollLeft:wrap.scrollLeft,trs:trs.length,firstId:first._id,artwork:td?.textContent,selected:state.cpSelected.has(first._id)};
      },ids);
      await delay(2500); // seçim tıklamasının ertelenmiş işi ölçüm penceresine taşmasın
      for(const id of ids)store.models[id]=entry(id,2);store._revision=2;
      fs.writeFileSync(path.join(root,'data','plm-bom.json'),JSON.stringify(store));
      const cdp=await context.newCDPSession(page);if(process.env.PROFILE){await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:200});await cdp.send('Profiler.start');}
      const after=await page.evaluate(async({ids,firstId})=>{
        const longTasks=[];const po=new PerformanceObserver(l=>l.getEntries().forEach(e=>longTasks.push(e.duration)));po.observe({type:'longtask',buffered:false});
        let patchMs=0;const details=window.BLCPPlmDetails;window.__lt=longTasks;
        const t0=performance.now();const changed=await details.applyIds(ids);const t1=performance.now();
        await new Promise(r=>setTimeout(r,800));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));po.disconnect();
        const wrap=document.querySelector('#cpTable')?.closest('.tablewrap')||document.scrollingElement;
        const trs=[...document.querySelectorAll('#cpTable tbody tr[data-id]')];
        const td=document.querySelector(`#cpTable tbody tr[data-id="${firstId}"] > td[data-key="Artwork Detail"]`);
        return {changed,applyIdsMs:t1-t0,longTasks,scrollTop:wrap.scrollTop,scrollLeft:wrap.scrollLeft,sameNodes:trs.every(tr=>tr.__mark===1),trs:trs.length,artwork:td?.textContent,dataKey:td?.dataset.key,selected:state.cpSelected.has(firstId),checkbox:document.querySelector(`#cpTable tbody tr[data-id="${firstId}"] input.rowChk`)?.checked};
      },{ids,firstId:before.firstId});
      if(process.env.PROFILE){const {profile}=await cdp.send('Profiler.stop');const self=new Map();const byId=new Map(profile.nodes.map(n=>[n.id,n]));const dt=profile.timeDeltas;profile.samples.forEach((id,i)=>{const n=byId.get(id);const k=n.callFrame.functionName+' '+n.callFrame.url.split('/').pop().split('?')[0]+':'+n.callFrame.lineNumber;self.set(k,(self.get(k)||0)+(dt[i]||0)/1000);});result.profile=[...self].sort((a,b)=>b[1]-a[1]).slice(0,15);
        const parent=new Map();profile.nodes.forEach(n=>(n.children||[]).forEach(c=>parent.set(c,n.id)));
        const name=n=>n.callFrame.functionName+' '+n.callFrame.url.split('/').pop().split('?')[0]+':'+n.callFrame.lineNumber;
        const roots=new Map();profile.samples.forEach((id,i)=>{let chain=[];let cur=id;while(cur!=null){const n=byId.get(cur);if(n.callFrame.functionName==='(root)')break;chain.unshift(name(n));cur=parent.get(cur);}if(!chain.length||/\(program\)|\(idle\)/.test(chain[0]))return;const k=chain.slice(0,3).join(' > ');roots.set(k,(roots.get(k)||0)+(dt[i]||0)/1000);});
        result.roots=[...roots].sort((a,b)=>b[1]-a[1]).slice(0,14);}
      result.patch={ids:ids.length,before,after};
    }
    if(mode==='scroll'){
      await page.waitForFunction(()=>{window.BLBootGuard?.continue?.({intentAtMs:performance.now()});const g=document.getElementById('blBootGuard');return !g||!g.isConnected||g.hidden||getComputedStyle(g).display==='none';},null,{timeout:120000,polling:500});
      await delay(5000);
      result.scroll=await page.evaluate(async()=>{
        const wrap=document.querySelector('#cpTable')?.closest('.tablewrap')||document.scrollingElement;
        const longTasks=[];const po=new PerformanceObserver(l=>l.getEntries().forEach(e=>longTasks.push(e.duration)));po.observe({type:'longtask'});
        const frames=[];let last=performance.now();const t0=last;
        for(let i=0;i<60;i++){wrap.scrollTop+=500;await new Promise(r=>requestAnimationFrame(r));const now=performance.now();frames.push(now-last);last=now;}
        await new Promise(r=>setTimeout(r,500));po.disconnect();
        frames.sort((a,b)=>a-b);
        return {totalMs:last-t0,maxFrameMs:frames[frames.length-1],medianFrameMs:frames[frames.length>>1],longTaskCount:longTasks.length,longTaskTotalMs:longTasks.reduce((a,b)=>a+b,0),maxLongTaskMs:Math.max(0,...longTasks),domRows:document.querySelectorAll('#cpTable tbody tr[data-id]').length,scrollTop:wrap.scrollTop};
      });
    }
    if(mode==='rowrefresh'){
      await delay(2500);
      result.rowrefresh=[];
      for(let k=0;k<3;k++){result.rowrefresh.push(await page.evaluate(async k=>{
        const longTasks=[];const po=new PerformanceObserver(l=>l.getEntries().forEach(e=>longTasks.push(e.duration)));po.observe({type:'longtask'});
        const id=state.cp.rows[k]._id;const t0=performance.now();refreshCpRowOnly(id);const js=performance.now()-t0;
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));await new Promise(r=>setTimeout(r,300));po.disconnect();return {js,longTasks};
      },k));}
    }
    if(mode==='screenshot'){

      await page.waitForFunction(()=>{window.BLBootGuard?.continue?.({intentAtMs:performance.now()});const g=document.getElementById('blBootGuard');return !g||!g.isConnected||g.hidden||getComputedStyle(g).display==='none'||getComputedStyle(g).visibility==='hidden';},null,{timeout:120000,polling:500});
      await delay(3000);
      for(let k=0;k<4;k++){await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));await page.keyboard.press('Escape');await delay(400);}
      result.overlays=await page.evaluate(()=>[...document.querySelectorAll('dialog[open],.warnOverlay,[role=dialog]')].filter(e=>e.offsetParent||e.open).map(e=>e.id||e.className).slice(0,5));
      await page.evaluate(()=>{void openCoreNectumApiSettings();});
      await page.waitForSelector('#_coreNectumApiSettings [data-plm-silent-bom]',{timeout:20000});
      await delay(400);
      const box=await page.locator('#_coreNectumApiSettings .modalCard').boundingBox();
      const pad=40;const clip={x:Math.max(0,box.x-pad*4),y:Math.max(0,box.y-pad),width:Math.min(1500,box.width+pad*8),height:Math.min(900,box.height+pad*2)};
      await page.screenshot({path:out,clip});
      result.clip=clip;result.checked=await page.locator('#_coreNectumApiSettings [data-plm-silent-bom]').isChecked();
    }
    result.silentRequests=requests;
    console.log(JSON.stringify(result,null,1));
    await browser.close();
  }finally{server.kill('SIGTERM');await delay(500);}
})().catch(e=>{console.error(e);process.exit(1);});
