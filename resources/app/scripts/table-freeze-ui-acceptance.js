/* Real Buyer Log acceptance for Freeze Columns on Collection, CP Tracker and Orders.
   Uses isolated demo data; never reads the user's workspace.
   Run: node scripts/table-freeze-ui-acceptance.js
   PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH selects a local Chromium binary.

   For every table and freeze width it scrolls horizontally/vertically and checks
   the rendered page: frozen header and body cells stay aligned with each other,
   stay at the left edge, are not painted over by scrolling cells, and are opaque.
   It also changes the picture size and a frozen column width after freezing
   (the original overlap cause), the two independently scrolling panes (frozen
   pane bar, horizontal wheel, boundary drag) and the picker. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawn,spawnSync}=require('node:child_process');
const {chromium}=require('playwright');
const app=path.resolve(__dirname,'..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-freeze-ui-')),port=6493,base='http://127.0.0.1:'+port;
const IDS={koleksiyon:'kolTable',cp:'cpTable',orders:'ordersTable'};
let child,browser,logs='';

async function audit(page,tableId){
  return page.evaluate(tableId=>{
    const t=document.getElementById(tableId),wrap=t.closest('.tablewrap'),wr=wrap.getBoundingClientRect(),issues=[];
    const hdr=[...t.querySelectorAll('thead tr.colRow > th.frzL')],H=hdr.map(c=>c.getBoundingClientRect());
    const opaque=el=>{const c=getComputedStyle(el).backgroundColor;if(c==='transparent')return false;const m=c.match(/\/\s*([\d.]+)\)$/)||c.match(/rgba\([^)]*,\s*([\d.]+)\)$/);return !m||Number(m[1])>=0.99;};
    for(let i=1;i<H.length;i++)if(Math.abs(H[i].left-H[i-1].right)>1.5)issues.push(`header gap ${i}`);
    if(H.length&&Math.abs(H[0].left-wr.left-wrap.clientLeft)>2)issues.push('first frozen header left the edge');
    hdr.forEach((c,i)=>{if(!opaque(c))issues.push(`header ${i} transparent`);});
    const edge=H.length?H[H.length-1].right:wr.left;
    const headB=Math.max(...[...t.tHead.querySelectorAll('th')].map(c=>c.getBoundingClientRect().bottom));
    const footT=t.tFoot&&t.tFoot.rows.length?Math.min(...[...t.tFoot.querySelectorAll('td,th')].map(c=>c.getBoundingClientRect().top)):wr.bottom;
    let checked=0;
    for(const row of t.querySelectorAll('thead tr.colRow, tbody tr, tfoot tr')){
      const b=row.getBoundingClientRect();if(!b.height||b.bottom<wr.top+2||b.top>wr.bottom-2)continue;
      const cells=[...row.children];if(cells.some(c=>c.colSpan>1))continue;
      const head=row.parentElement.tagName==='THEAD';
      const fz=head?cells.filter(c=>c.classList.contains('frzL')):cells.slice(0,H.length).filter(c=>getComputedStyle(c).position==='sticky');
      if(fz.length!==H.length){issues.push(`${row.parentElement.tagName} row frozen ${fz.length}/${H.length}`);continue;}
      fz.forEach((c,i)=>{const r=c.getBoundingClientRect();
        if(Math.abs(r.left-H[i].left)>1.5||Math.abs(r.width-H[i].width)>1.5)issues.push(`${row.parentElement.tagName} cell ${i} misaligned`);
        if(!opaque(c))issues.push(`${row.parentElement.tagName} cell ${i} transparent`);
        const y=(r.top+r.bottom)/2,visible=row.parentElement.tagName!=='TBODY'||(y>headB+1&&y<footT-1);
        if(visible&&y>wr.top&&y<wr.bottom)for(const x of [r.left+3,(r.left+r.right)/2,r.right-3]){const el=document.elementFromPoint(x,y),owner=el&&el.closest('td,th');if(el&&el.closest('.blFreezePane'))continue;if(owner!==c){issues.push(`${row.parentElement.tagName} cell ${i} covered by ${owner?(owner.dataset.key||owner.dataset.k||owner.dataset.kcol||owner.className):el&&el.tagName}`);break;}}
        checked++;});
      const nf=cells[H.length];
      if(nf){const r=nf.getBoundingClientRect(),y=(r.top+r.bottom)/2;if(r.left<edge-1&&r.right>edge+4&&y>wr.top&&y<wr.bottom&&(row.parentElement.tagName!=='TBODY'||(y>headB+1&&y<footT-1))){const el=document.elementFromPoint(edge-2,y);if(el&&el.closest('td,th')===nf)issues.push('scrolling cell paints over the frozen edge');}}
    }
    return {frozen:H.length,checked,issues:[...new Set(issues)]};
  },tableId);
}

async function paneAudit(page,id){
  return page.evaluate(id=>{
    const t=document.getElementById(id),wrap=t.closest('.tablewrap'),wr=wrap.getBoundingClientRect(),info=BLTableFreeze.info(t),issues=[];
    const L=wr.left+wrap.clientLeft,P=L+info.pane,K=info.offsets.length;
    const headB=Math.max(...[...t.tHead.querySelectorAll('th')].map(c=>c.getBoundingClientRect().bottom));
    const footT=t.tFoot&&t.tFoot.rows.length?Math.min(...[...t.tFoot.querySelectorAll('td,th')].map(c=>c.getBoundingClientRect().top)):wr.bottom;
    const bar=wrap.querySelector('.blFreezePaneBar:not([hidden])'),barTop=bar?bar.getBoundingClientRect().top:Infinity;
    if(!info.inner||!bar)issues.push('frozen pane is not independently scrollable');
    let rows=0;
    for(const row of t.querySelectorAll('thead tr.colRow, tbody tr, tfoot tr')){
      const cells=[...row.children];if(cells.some(c=>c.colSpan>1))continue;
      const r=row.getBoundingClientRect();if(!r.height)continue;
      const y=(r.top+r.bottom)/2,sec=row.parentElement.tagName;
      if(sec==='TBODY'&&(y<headB+2||y>footT-2))continue;if(y<wr.top+2||y>wr.bottom-16||y>barTop-1)continue;
      rows++;
      cells.slice(0,K).forEach((c,i)=>{const cr=c.getBoundingClientRect(),exp=L+info.offsets[i]-info.scroll;if(Math.abs(cr.left-exp)>1.5)issues.push(`${sec} frozen cell ${i} misplaced`);});
      for(let x=L+3;x<wr.right-20;x+=23){const el=document.elementFromPoint(x,y),o=el&&el.closest('td,th');if(!o||o.parentElement!==row)continue;const idx=cells.indexOf(o);
        if(x<P-3&&idx>=K)issues.push(`${sec} scrolling cell inside the frozen pane`);
        if(x>P+5&&idx<K)issues.push(`${sec} frozen cell leaks into the right pane`);}
      if(wrap.scrollLeft===0&&sec==='THEAD'&&Math.abs(cells[K].getBoundingClientRect().left-P)>1.5)issues.push('right pane does not start at the boundary');
    }
    const div=wrap.querySelector('.blFreezePaneDivider').getBoundingClientRect();
    if(Math.abs((div.left+div.right)/2-P)>2)issues.push('boundary divider misplaced');
    return {rows,issues:[...new Set(issues)]};
  },id);
}

(async()=>{
  const source=path.join(root,'source');fs.mkdirSync(source);
  const generated=spawnSync(process.execPath,[path.join(app,'scripts/generate-demo-data.js'),source,'--rows','120'],{cwd:app,encoding:'utf8'});assert.equal(generated.status,0,generated.stderr);
  const env={...process.env,BUYER_LOG_CONFIG_PATH:path.join(root,'config.json'),BL_KEEP_ALIVE:'1'};
  for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_TEMP_ROOT']){env[key]=path.join(root,key.toLowerCase());fs.mkdirSync(env[key],{recursive:true});}
  env.BUYER_LOG_AUTH_DATA_ROOT=path.join(env.BUYER_LOG_SERVER_DATA_ROOT,'auth');fs.mkdirSync(env.BUYER_LOG_AUTH_DATA_ROOT,{recursive:true});
  fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',sourceFolder:source,refreshWithExcel:false,updates:{enabled:false}}));
  child=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
  for(let i=0;i<160;i++){try{if((await fetch(base+'/api/user-profiles')).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
  const password=crypto.randomBytes(20).toString('hex');
  const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',newPassword:password,password})});assert.equal(login.status,200,await login.clone().text());
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const api=async(url,options={})=>{const r=await fetch(base+url,{...options,headers:{cookie,'Content-Type':'application/json'}});assert.ok(r.ok,await r.clone().text());return r.json();};
  await api('/api/refresh',{method:'POST',body:'{}'});for(let i=0;i<240;i++){if(!(await api('/api/refresh-status')).running)break;await new Promise(r=>setTimeout(r,250));}
  assert.ok((await api('/api/data/cp')).rows.length>=50,'demo CP rows');
  const names=['DEMO ORBIT','DEMO COMET','DEMO RIVER','DEMO MAPLE','DEMO PIXEL','DEMO HARBOR'];
  const rows=Array.from({length:40},(_,i)=>({id:i+1,plmId:String(900000+i*37),modelKod:`${names[i%names.length]} ${i+1}`,season:'S7',inStoreMonth:'MARCH 2027',urunTipi:i%5?'T-Shirt':'Set',buyer:'DEMO BUYER',mag:'DEMO',quantity:String(2000+i*311),durum:'Fiyatlandı',colour:'BLACK',licensor:['DEMO LICENSOR A','DEMO LICENSOR B'][i%2],targetPrice:String(1+i%3/2),pricing:{'DEMO A':String(1.4+i%5/10),'DEMO B':String(1.6+i%4/10)}})); // i18n-ignore
  await api('/api/collection-workspaces/moderator',{method:'PUT',body:JSON.stringify({rows,nextId:41,manufacturers:[{name:'DEMO A'},{name:'DEMO B'}],customColumns:[],statusCatalog:[]})});

  // Real scrollbars (as in the desktop app): the frozen pane has its own bar.
  browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined,headless:true,args:['--no-sandbox'],ignoreDefaultArgs:['--hide-scrollbars']});
  const context=await browser.newContext({viewport:{width:1600,height:900},reducedMotion:'reduce'});
  const [name,...val]=cookie.split('=');await context.addCookies([{name,value:val.join('='),url:base}]);
  await context.addInitScript(()=>localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0'));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForSelector('nav.tabs button[data-tab="cp"]',{timeout:60000});
  await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).first().click({timeout:6000}).catch(()=>{});
  await page.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:60000});
  const open=async tab=>{await page.locator(`nav.tabs button[data-tab="${tab}"]`).click();await page.waitForFunction(id=>document.querySelectorAll(`#${id} tbody tr`).length>=5,IDS[tab],{timeout:60000});await page.waitForTimeout(500);};
  const scroll=async(tab,x,y=0)=>{await page.evaluate(({id,x,y})=>{const w=document.getElementById(id).closest('.tablewrap');w.scrollLeft=x;w.scrollTop=y;},{id:IDS[tab],x,y});
    await page.waitForFunction(id=>!document.getElementById(id).closest('.tablewrap').classList.contains('kolScrollPerfMode'),IDS[tab]);await page.waitForTimeout(250);};
  const check=async(label,tab)=>{const r=await audit(page,IDS[tab]);assert.ok(r.frozen>0&&r.checked>0,`${label}: nothing frozen`);assert.deepEqual(r.issues,[],label);console.log('ok',label,`frozen=${r.frozen} cells=${r.checked}`);};

  for(const tab of ['koleksiyon','cp','orders']){
    await open(tab);
    for(const count of [3,6]){
      // Real user flow: toolbar button → laser → click the last column to freeze.
      await page.evaluate(({id,tab})=>{BLTableFramework.clearFreeze(id,tab);document.getElementById(id).closest('.tablewrap').scrollLeft=0;BLTableFramework.startFreeze(id,tab);},{id:IDS[tab],tab});
      const th=page.locator(`#${IDS[tab]} thead tr.colRow th:not(.chkTh)`).nth(count-1);await th.waitFor({state:'visible'});const box=await th.boundingBox();
      await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
      assert.equal(await page.locator(`#${IDS[tab]} thead .freezePreview`).count(),count,'picker previews the frozen range');
      await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
      assert.equal(await page.evaluate(tab=>getFreeze(tab).left,tab),count);
      for(const [x,y] of [[0,0],[350,0],[1200,0],[1200,500]]){await scroll(tab,x,y);await check(`${tab} freeze ${count} scroll ${x},${y}`,tab);}
      await scroll(tab,0,0);
    }
  }
  // Picture size and column width change AFTER freezing: offsets must follow.
  for(const tab of ['orders','koleksiyon']){
    await open(tab);await page.evaluate(tab=>{setFreeze(tab,5);tab==='orders'?renderOrders():renderKol();},tab);
    for(const size of ['max','min']){
      await page.evaluate(({tab,size})=>{const b=tableImageSizeBounds(tab);setTableImageSize(tab,size==='max'?b.max:b.min);if(tab==='koleksiyon')renderKol();},{tab,size});
      await page.waitForTimeout(400);await scroll(tab,700);await check(`${tab} picture ${size}`,tab);
    }
  }
  await open('orders');await scroll('orders',700);
  await page.evaluate(()=>{const t=document.getElementById('ordersTable'),th=t.querySelector('thead tr.colRow th[data-k]');colmgr.orders.widthPx[th.dataset.k]=(colmgr.orders.widthPx[th.dataset.k]||120)+90;applyColgroupWidths(t,'orders',true);});
  await page.waitForTimeout(300);await check('orders frozen column resized',"orders");
  // Two panes: more frozen columns than fit → the frozen pane scrolls on its own.
  for(const tab of ['cp','orders','koleksiyon']){
    await open(tab);
    const id=IDS[tab];
    const first=await page.evaluate(({tab,id})=>{setFreeze(tab,40);tab==='cp'?renderCP():tab==='orders'?renderOrders():renderKol();return BLTableFreeze.info(document.getElementById(id));},{tab,id});
    assert.equal(first.suspended,false,`${tab}: a wide freeze becomes a scrollable pane`);assert.equal(first.inner,true);
    await page.evaluate(({tab,id})=>{setFreeze(tab,10);setFreezePane(tab,520);tab==='cp'?renderCP():tab==='orders'?renderOrders():renderKol();},{tab,id});
    for(const [s,x] of [[0,0],[260,0],[99999,0],[260,700],[99999,99999]]){
      await page.evaluate(({id,s,x})=>{const t=document.getElementById(id);BLTableFreeze.scrollPane(t,s);t.closest('.tablewrap').scrollLeft=x;},{id,s,x});
      await page.waitForFunction(id=>!document.getElementById(id).closest('.tablewrap').classList.contains('kolScrollPerfMode'),id);await page.waitForTimeout(250);
      const r=await paneAudit(page,id);assert.deepEqual(r.issues,[],`${tab} pane ${s}/${x}`);assert.ok(r.rows>5);console.log('ok',`${tab} two panes frozen=${s} right=${x}`,`rows=${r.rows}`);
    }
    // Horizontal wheel over the frozen pane scrolls only that pane.
    await page.evaluate(id=>{const t=document.getElementById(id);BLTableFreeze.scrollPane(t,0);t.closest('.tablewrap').scrollLeft=300;},id);
    const wb=await page.evaluate(id=>{const r=document.getElementById(id).closest('.tablewrap').getBoundingClientRect();return {x:r.left,y:r.top};},id);
    await page.mouse.move(wb.x+200,wb.y+250);await page.mouse.wheel(180,0);await page.waitForTimeout(250);
    const wheel=await page.evaluate(id=>{const t=document.getElementById(id);return {pane:BLTableFreeze.info(t).scroll,right:t.closest('.tablewrap').scrollLeft};},id);
    assert.ok(wheel.pane>0&&wheel.right===300,`${tab} wheel ${JSON.stringify(wheel)}`);
    // Dragging the boundary resizes the pane and is remembered.
    const d=await page.locator(`#${id}`).locator('xpath=..').locator('.blFreezePaneDivider').boundingBox();
    await page.mouse.move(d.x+d.width/2,d.y+d.height/2);await page.mouse.down();await page.mouse.move(d.x+d.width/2+150,d.y+d.height/2,{steps:5});await page.mouse.up();
    const drag=await page.evaluate(({tab,id})=>({pane:BLTableFreeze.info(document.getElementById(id)).pane,saved:getFreeze(tab).pane}),{tab,id});
    assert.ok(Math.abs(drag.pane-670)<=2&&drag.saved===drag.pane,`${tab} drag ${JSON.stringify(drag)}`);
    const after=await paneAudit(page,id);assert.deepEqual(after.issues,[],`${tab} after drag`);console.log('ok',`${tab} pane wheel and drag`);
    await page.evaluate(({tab})=>{setFreeze(tab,5);tab==='cp'?renderCP():tab==='orders'?renderOrders():renderKol();},{tab});
    await scroll(tab,900);await check(`${tab} back to a single frozen pane`,tab);
  }
  // Esc cancels the picker without changing the saved freeze.
  await open('cp');
  await page.evaluate(()=>{BLTableFramework.clearFreeze('cpTable','cp');BLTableFramework.startFreeze('cpTable','cp');});await page.keyboard.press('Escape');
  assert.deepEqual(await page.evaluate(()=>({picking:BLTableFreeze.isPicking(),left:getFreeze('cp').left,laser:document.querySelectorAll('.freezeLaser').length})),{picking:false,left:0,laser:0});
  // Dark theme keeps frozen cells opaque.
  await page.evaluate(()=>{setFreeze('cp',6);renderCP();applyTheme('dark');});await page.waitForTimeout(500);await scroll('cp',900,200);await check('cp dark theme',"cp");
  await page.evaluate(()=>applyTheme('light'));

  // Release-note visual: two independently scrolled panes.
  if(process.env.BL_FREEZE_SCREENSHOT!=='0'){
    const assets=path.join(app,'public/release-notes/next-assets');fs.mkdirSync(assets,{recursive:true});
    const quiet=()=>page.evaluate(()=>document.querySelectorAll('.uiFeedbackRegion').forEach(region=>region.replaceChildren()));
    await page.evaluate(()=>{setFreeze('cp',10);setFreezePane('cp',560);renderCP();BLTableFreeze.scrollPane(document.getElementById('cpTable'),300);});await scroll('cp',700,0);await page.mouse.move(5,5);await quiet();
    assert.ok(await page.evaluate(()=>{const b=document.querySelector('#cpTable').closest('.tablewrap').querySelector('.blFreezePaneBar');return b.offsetHeight-b.clientHeight>0&&b.scrollLeft>0;}),'the frozen pane shows its own scrollbar');
    await page.screenshot({path:path.join(assets,'table-freeze-pane-scroll.png')});
  }
  assert.deepEqual(errors,[]);
  console.log('Freeze Columns acceptance passed');
})().catch(error=>{console.error(error);if(logs)console.error(logs.slice(-4000));process.exitCode=1;}).finally(async()=>{await browser?.close().catch(()=>{});child?.kill();fs.rmSync(root,{recursive:true,force:true});});
