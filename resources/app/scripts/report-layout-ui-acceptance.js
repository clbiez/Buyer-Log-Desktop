'use strict';
// Real Buyer Log, isolated synthetic account and data; no production data is read.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require('playwright'),XLSX=require('xlsx'),{execFileSync}=require('node:child_process');
const app=path.resolve(__dirname,'..'),root=path.resolve(app,'../../work/report-layout-acceptance');fs.mkdirSync(root,{recursive:true});
const port=6497,base=`http://127.0.0.1:${port}`,env={...process.env,BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')};
for(const [key,dir] of Object.entries({BUYER_LOG_DATA_ROOT:'app',BUYER_LOG_SERVER_DATA_ROOT:'server',BUYER_LOG_LOCAL_DATA_ROOT:'local',BUYER_LOG_TEMP_ROOT:'temp'})){env[key]=path.join(root,dir);fs.mkdirSync(env[key],{recursive:true});}
env.BUYER_LOG_AUTH_DATA_ROOT=env.BUYER_LOG_SERVER_DATA_ROOT;env.BL_DATA_DIR=env.BUYER_LOG_SERVER_DATA_ROOT;
fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',updates:{enabled:false}}));
const assets=path.join(app,'public/release-notes/next-assets');fs.mkdirSync(assets,{recursive:true});
const log=fs.openSync(path.join(root,'server.log'),'a'),server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});let browser;
(async()=>{
 let ready=false;for(let i=0;i<120;i++){try{ready=(await fetch(base+'/api/health')).status<500;if(ready)break;}catch{}await new Promise(r=>setTimeout(r,250));}assert.ok(ready,'isolated server ready');
 const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',password:'demo-report-123',newPassword:'demo-report-123'})});assert.ok(login.ok,await login.clone().text());
 const cookie=login.headers.get('set-cookie').split(';')[0],split=cookie.indexOf('=');
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1600,height:960},reducedMotion:'reduce',permissions:['clipboard-read','clipboard-write']});
 await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),domain:'127.0.0.1',path:'/',httpOnly:true}]);
 await context.addInitScript(()=>localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0'));
 const page=await context.newPage(),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
 await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.BLPerf&&typeof switchTab==='function',{timeout:60000});
 await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({timeout:4000}).catch(()=>{});await page.waitForFunction(()=>!document.getElementById('blBootGuard'),{timeout:60000});
 await page.evaluate(()=>{applyLanguage('en');switchTab('cp');});
 await page.waitForTimeout(800);
 const seedCp=()=>{
   const rows=Array.from({length:4},(_,i)=>({_id:i+1,'PLM ID':990001+i,'Model Name':'DEMO MODEL '+(i+1),'Product Main Description':i%2?'T-Shirt':'Sweat','C.Code':'DEMO-C'+i,Colour:'NAVY','Order Code':880001+i,Season:'S7',Country:'DEMO','Order Quantity':100+i,Manufacturer:'DEMO FACTORY','Ex-factory':'2027-03-10','Retail Date':'2027-04-10','Del. Type':'Regular',STATUS:'Order Placed'}));
   state.cp={...(state.cp||{}),rows};state.orders={...(state.orders||{}),rows:rows.map(r=>({...r}))};state.cpSelected.clear();state.ordersSelected.clear();
   state.cpSort={key:null,dir:1};state.ordersSort={key:null,dir:1};
   colmgr.cp.order=CP_COLS.map(c=>c.k);colmgr.cp.hidden=new Set(CP_COLS.filter(c=>!['PLM ID','Model Name','Product Main Description','C.Code','Colour','Season','Country','Order Code','Order Quantity','Manufacturer','Ex-factory','Retail Date'].includes(c.k)).map(c=>c.k));
   applyPlmStyleLinksPayload({links:rows.map(row=>({plmId:row['PLM ID'],styleId:row['PLM ID']+100,styleName:row['Model Name']}))});
   for(const key of ['custom','focus','extended','all'])BLStorage.removeItem('buyerlog.tableReportMode.v1.layout.cp.'+key);
   renderCP();BLFlushTableRenders();ensureTableReportAdapters();BLTableReportInline.setMode('cp',true);
 };
 await page.evaluate(seedCp);await page.evaluate(()=>BLTableReportInline.refreshShared());
 if(process.env.REPORT_FLOW_ONLY==='1'){
   await page.emulateMedia({reducedMotion:'no-preference'});await page.evaluate(()=>BLMotionPlus.setEnabled(true));await page.waitForTimeout(650);
   const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=200;c.height=120;const x=c.getContext('2d');x.fillStyle='#ebeff3';x.fillRect(0,0,200,120);for(const offset of [0,100]){x.fillStyle=offset?'#7b263a':'#96354a';x.beginPath();for(const [i,[a,b]] of [[0,[30,10]],[1,[5,25]],[2,[0,50]],[3,[24,60]],[4,[28,45]],[5,[28,110]],[6,[78,110]],[7,[78,45]],[8,[84,60]],[9,[100,50]],[10,[95,25]],[11,[70,10]]]){if(i===0)x.moveTo(a+offset,b);else x.lineTo(a+offset,b);}x.closePath();x.fill();}return c.toDataURL('image/png');});
   await page.route('**/api/*-images/flow-demo',route=>route.fulfill({contentType:'image/png',body:Buffer.from(png.split(',')[1],'base64')}));
   await page.evaluate(()=>{BLDetailImages.sourceFor=()=>'/api/collection-images/flow-demo';colmgr.cp.hidden.delete('__picture');renderCP();BLFlushTableRenders();BLTableReportInline.setMode('cp',true);});
   const evidence=[];
   async function checkFlow(key,report){
     await page.evaluate(({key,report})=>BLTableReportInline.setMode(key,report),{key,report});await page.waitForTimeout(100);
     const tableId=report?'blTableReport-'+key:key==='koleksiyon'?'kolTable':key==='orders'?'ordersTable':'cpTable';
     const input=page.locator('#'+tableId+(report?' [data-tr-check="0"]':' tbody input.rowChk')).first();
     const idle=await input.evaluate(i=>({background:getComputedStyle(i).backgroundColor,border:getComputedStyle(i).borderColor,borderWidth:getComputedStyle(i).borderTopWidth,width:i.getBoundingClientRect().width,checked:i.checked}));
     assert.equal(idle.checked,false);assert.equal(idle.width,8);assert.equal(idle.borderWidth,'1px');assert.equal(idle.background,'rgba(0, 0, 0, 0)');
     await input.check();await page.waitForFunction(tableId=>document.getAnimations().some(a=>a.id==='bl-row-selection'&&a.effect?.target?.closest('table')?.id===tableId),tableId);
     const motion=await page.evaluate(()=>{const a=document.getAnimations().find(a=>a.id==='bl-row-selection');return {frames:a.effect.getKeyframes().map(f=>({transform:f.transform,opacity:f.opacity})),duration:a.effect.getTiming().duration};});assert.equal(motion.duration,360);assert.equal(motion.frames[0].transform,'scaleY(0)');
     await page.waitForTimeout(440);assert.equal(await input.isChecked(),true);assert.equal(await input.evaluate(i=>getComputedStyle(i,'::before').transform),'matrix(1, 0, 0, 1, 0, 0)');
     if(key==='cp'){
       await page.evaluate(()=>markDirty(1));await page.waitForTimeout(100);
       const dirty=await input.evaluate(i=>({row:i.closest('tr').classList.contains('rowDirty'),blue:getComputedStyle(i,'::before').backgroundColor,orange:getComputedStyle(i,'::after').backgroundColor,stripe:getComputedStyle(i,'::after').width,display:getComputedStyle(i,'::after').display}));
       assert.equal(dirty.row,true);assert.equal(dirty.stripe,'3px');assert.equal(dirty.display,'block');assert.notEqual(dirty.blue,dirty.orange);assert.notEqual(dirty.orange,'rgba(0, 0, 0, 0)');
     }
     const row=input.locator('xpath=ancestor::tr'),box=await row.boundingBox();await page.mouse.move(1000,box.y+box.height/2);await page.waitForTimeout(650);
     const hover=await row.evaluate(r=>{const s=getComputedStyle(r,'::after');return {opacity:s.opacity,background:s.backgroundColor,width:parseFloat(s.width),rowWidth:r.getBoundingClientRect().width,pointerEvents:s.pointerEvents};});assert.equal(hover.opacity,'1');assert.ok(Math.abs(hover.width-hover.rowWidth)<1);assert.equal(hover.pointerEvents,'none');
     const second=row.locator('xpath=following-sibling::tr').first();const next=await second.boundingBox();if(next){await page.mouse.move(1000,next.y+next.height/2);await page.waitForTimeout(120);const fading=Number(await row.evaluate(r=>getComputedStyle(r,'::after').opacity));assert.ok(fading>0&&fading<1);await page.waitForTimeout(550);assert.equal(await row.evaluate(r=>r.classList.contains('blSoftRowHover')),false,'faded row releases its light layer');}
     if(key==='cp'&&report){
       await page.waitForFunction(()=>document.querySelector('#blTableReport-cp img')?.dataset.blImageLoaded==='1');
       for(const theme of ['dark','light']){await page.evaluate(theme=>applyTheme(theme),theme);await page.waitForTimeout(650);await page.screenshot({path:path.join(assets,'flow-selection-'+theme+'.png')});}
       await page.evaluate(()=>applyTheme('dark'));
       await page.evaluate(()=>{renderCP();BLFlushTableRenders();});await page.waitForTimeout(130);assert.equal(await page.evaluate(()=>document.getAnimations().filter(a=>a.id==='bl-row-selection').length),0,'refresh does not replay selection motion');
     }
     await input.uncheck();await page.waitForTimeout(500);assert.equal(await input.isChecked(),false);
     evidence.push({key,report,idle,motion,hover});console.log('PASS visible rail, native selection, Akış fill and full-row fade: '+key+' '+(report?'report':'table'));
   }
   for(const key of ['cp','orders','koleksiyon']){
     if(key==='orders')await page.evaluate(()=>{switchTab('orders');colmgr.orders.hidden=new Set(colmgr.cp.hidden);renderOrders();BLFlushTableRenders();});
     if(key==='koleksiyon'){
       await page.evaluate(async()=>{switchTab('koleksiyon');await BLPerf.ensureFeature('collectionTools');});
       await page.evaluate(()=>{kolRows=Array.from({length:3},(_,i)=>({id:91001+i,plmId:String(990001+i),modelKod:'DEMO COLLECTION '+i,season:'S7',mag:'DEMO',urunTipi:'DEMO',country:'DEMO',quantity:'200',targetPrice:'14',pricing:{},durum:'',colour:'NAVY'}));kolColOrder=kolDefaultDisplayOrder();kolHiddenCols=new Set(kolColDefs().map(c=>c.k).filter(k=>!['modelKod','season','quantity','targetPrice'].includes(k)));kolPictureHidden=false;kolColFilters={};kolSelected.clear();renderKol();});
     }
     await checkFlow(key,true);await checkFlow(key,false);
   }
   await page.evaluate(async()=>{switchTab('cp');await discardAllChangesAsync();BLTableReportInline.setMode('cp',true);});await page.waitForTimeout(100);assert.equal(await page.locator('#blTableReport-cp tr.rowDirty').count(),0,'discard removes dirty stripe in report');
   await page.evaluate(()=>{switchTab('cp');BLMotionPlus.setEnabled(false);BLTableReportInline.setMode('cp',true);});await page.locator('#blTableReport-cp [data-tr-check="0"]').check();await page.waitForTimeout(80);assert.equal(await page.evaluate(()=>document.getAnimations().filter(a=>a.id==='bl-row-selection').length),0);
   await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>BLMotionPlus.setEnabled(true));await page.locator('#blTableReport-cp [data-tr-check="0"]').uncheck();await page.waitForTimeout(80);assert.equal(await page.evaluate(()=>document.getAnimations().filter(a=>a.id==='bl-row-selection').length),0);
   assert.deepEqual(errors,[]);fs.writeFileSync(path.join(root,'flow-results.json'),JSON.stringify({ok:true,evidence,errors},null,2));return;
 }
 if(process.env.REPORT_STICKY_ONLY==='1'){
   const results=[];
   async function checkPin(selector,label){
     const target=page.locator(selector).first();await target.waitFor();
     const before=await target.evaluate(input=>{const cell=input.closest('td,th'),wrap=cell.closest('.tablewrap');wrap.scrollLeft=0;return {left:cell.getBoundingClientRect().left,wrap:wrap.getBoundingClientRect().left,width:cell.getBoundingClientRect().width};});
     await target.evaluate(input=>{input.closest('.tablewrap').scrollLeft=260;});await page.waitForTimeout(80);
     const after=await target.evaluate(input=>{const cell=input.closest('td,th'),wrap=cell.closest('.tablewrap'),r=input.getBoundingClientRect();return {left:cell.getBoundingClientRect().left,scroll:wrap.scrollLeft,position:getComputedStyle(cell).position,z:getComputedStyle(cell).zIndex,hit:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===input,hitHtml:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.outerHTML.slice(0,500),rect:{left:r.left,top:r.top,width:r.width,height:r.height}};});
     assert.ok(after.scroll>100,label+' actually scrolled');assert.ok(Math.abs(before.left-after.left)<2,label+' stays fixed: '+JSON.stringify({before,after}));assert.equal(after.position,'sticky');if(!after.hit){await page.screenshot({path:path.join(root,'sticky-failure.png')});console.log(await target.evaluate(input=>{const td=input.closest('td,th'),r=input.getBoundingClientRect();return {input:input.outerHTML,td:td.outerHTML.slice(0,600),pe:getComputedStyle(input).pointerEvents,tdPe:getComputedStyle(td).pointerEvents,stack:document.elementsFromPoint(r.left+r.width/2,r.top+r.height/2).slice(0,8).map(el=>({tag:el.tagName,cls:el.className,z:getComputedStyle(el).zIndex,pe:getComputedStyle(el).pointerEvents}))};}));}assert.ok(after.hit,label+' remains clickable '+JSON.stringify(after));results.push({label,before,after});
   }
   for(const key of ['cp','orders','koleksiyon']){
     if(key==='orders')await page.evaluate(()=>{switchTab('orders');colmgr.orders.hidden=new Set(colmgr.cp.hidden);renderOrders();BLFlushTableRenders();});
     if(key==='koleksiyon'){
       await page.evaluate(async()=>{switchTab('koleksiyon');await BLPerf.ensureFeature('collectionTools');});
       await page.evaluate(()=>{kolRows=[{id:91001,plmId:'990001',modelKod:'DEMO COLLECTION',season:'S7',mag:'DEMO',urunTipi:'DEMO',country:'DEMO',quantity:'200',targetPrice:'14',pricing:{},durum:'',colour:'NAVY'}];kolColOrder=kolDefaultDisplayOrder();kolHiddenCols=new Set(kolColDefs().map(c=>c.k).filter(k=>!['modelKod','season','quantity','targetPrice'].includes(k)));kolPictureHidden=true;kolColFilters={};kolSelected.clear();renderKol();});
     }
     await page.evaluate(key=>{BLTableReportInline.setMode(key,false);const table=tableImageSizeTable(key),wrap=table.closest('.tablewrap');wrap.style.width='620px';wrap.style.maxWidth='620px';table.style.minWidth='1500px';BLTableFreeze.clear(table);},key);
     const tableId=key==='koleksiyon'?'kolTable':key==='orders'?'ordersTable':'cpTable';
     await checkPin('#'+tableId+' tbody input.rowChk',key+' normal body');
     await checkPin('#'+tableId+' thead input[type="checkbox"]',key+' normal header');
     await page.evaluate(key=>{const table=tableImageSizeTable(key);BLTableFreeze.apply(table,{count:3,pane:100});},key);
     await page.waitForTimeout(120);
     await page.evaluate(key=>BLTableFreeze.scrollPane(tableImageSizeTable(key),180),key);
     await checkPin('#'+tableId+' tbody input.rowChk',key+' inner frozen pane');
     await page.evaluate(key=>{BLTableFreeze.clear(tableImageSizeTable(key));BLTableReportInline.setMode(key,true);document.querySelector('#blTableReport-'+key).style.minWidth='1500px';},key);
     await checkPin('#blTableReport-'+key+' [data-tr-check="0"]',key+' report body');
     await checkPin('#blTableReport-'+key+' [data-tr-check="all"]',key+' report header');
     await page.locator('#blTableReport-'+key+' [data-tr-check="0"]').check();
     if(key==='cp')await page.screenshot({path:path.join(assets,'selection-rail-sticky.png')});
     console.log('PASS selection pin: '+key+' normal/report/header/inner pane');
   }
   const matrix=await page.evaluate(()=>{
     const attrs=['class="rowChk"','class="shipCompareChk"','class="shipRowChk"','data-tr-check="0"','data-ship-chk-all','data-fabric-pick="0"','data-bin-id="demo"','data-cpa-queue-check="demo"','data-dc-item="demo"','data-dc-toggle-all','data-ta-pick="demo"','data-ta-all','data-act="selectRow"','data-act="selectAll"','id="fixture_selAll"'];
     const wrap=document.createElement('div');wrap.style.cssText='position:fixed;left:900px;top:100px;width:300px;overflow:auto';
     wrap.innerHTML='<table style="width:1500px"><tbody>'+attrs.map(attr=>'<tr><td><input type="checkbox" '+attr+'></td><td>Demo</td></tr>').join('')+'<tr><td><label><input type="checkbox" data-xim="include">Source row</label></td><td>Demo</td></tr><tr><td><input type="checkbox" data-um-rolecell="read"></td><td>Permission</td></tr><tr><td>Value</td><td><input type="checkbox" class="rowChk"></td></tr></tbody></table>';document.body.append(wrap);
     wrap.scrollLeft=260;const result=[...wrap.querySelectorAll('input')].map(input=>({position:getComputedStyle(input.closest('td')).position,left:input.closest('td').getBoundingClientRect().left}));wrap.remove();return result;
   });
   for(const result of matrix.slice(0,-2)){assert.equal(result.position,'sticky');assert.ok(Math.abs(result.left-900)<2);}for(const result of matrix.slice(-2))assert.notEqual(result.position,'sticky');
   await page.evaluate(()=>{switchTab('cp');const seed=state.cp.rows[0],rows=Array.from({length:300},(_,i)=>({...seed,_id:i+1,'Model Name':'DEMO MODEL '+i}));BLTableReportInline.register('cp',{tab:'cp',table:()=>document.getElementById('cpTable'),rows:()=>rows,columns:()=>tableReportCoreColumns('cp'),images:()=>false,...tableReportInteraction('cp')});BLTableReportInline.setMode('cp',true);document.getElementById('blTableReport-cp').style.minWidth='2200px';});
   const samples=[];
   for(let pair=0;pair<3;pair++)for(const candidate of [false,true]){
     const raw=await page.evaluate(candidate=>{
       const sheet=document.getElementById('blRowSelectionPinStyle').sheet;sheet.disabled=!candidate;
       const table=document.getElementById('blTableReport-cp'),wrap=table.closest('.tablewrap'),rail=table.querySelector('[data-tr-check="0"]');wrap.scrollLeft=0;rail.getBoundingClientRect();
       const values=[];for(let i=0;i<30;i++){const start=performance.now();wrap.scrollLeft=i%2?220:560;rail.getBoundingClientRect();values.push(performance.now()-start);}sheet.disabled=false;return values;
     },candidate);samples.push({pair,variant:candidate?'pinned':'baseline',raw,mean:raw.reduce((a,b)=>a+b,0)/raw.length});
   }
   fs.writeFileSync(path.join(root,'sticky-performance.json'),JSON.stringify({scenario:'L2: synchronous horizontal scroll plus rail geometry; 300 actual report rows, three alternating pairs, 30 samples each; baseline disables only the new pin stylesheet',samples},null,2));
   assert.deepEqual(errors,[]);fs.writeFileSync(path.join(root,'sticky-results.json'),JSON.stringify({ok:true,results,matrix,errors},null,2));return;
 }
 if(process.env.REPORT_IMAGES_ONLY==='1'){
   const svg='<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120"><rect width="200" height="120" fill="#edf2f5"/><path d="M35 12L9 29L3 53L27 61L32 46V108H89V46L94 61L117 53L111 29L85 12Q60 32 35 12Z" fill="#58747e"/><path d="M140 12L120 27V108H193V27L175 12Z" fill="#506b75"/></svg>';
   const png=await page.evaluate(svg=>new Promise(resolve=>{const image=new Image();image.onload=()=>{const canvas=document.createElement('canvas');canvas.width=200;canvas.height=120;canvas.getContext('2d').drawImage(image,0,0);resolve(canvas.toDataURL('image/png'));};image.src='data:image/svg+xml;base64,'+btoa(svg);}),svg);
   await page.route('**/api/*-images/report-size-demo*',route=>route.fulfill({contentType:'image/png',body:Buffer.from(png.split(',')[1],'base64')}));
   await page.evaluate(()=>{BLDetailImages.sourceFor=()=>'/api/cp-images/report-size-demo';colmgr.cp.hidden.delete('__picture');renderCP();BLFlushTableRenders();BLTableReportInline.setMode('cp',true);});
   const evidence=[];
   for(const key of ['cp','orders','koleksiyon']){
     if(key==='orders')await page.evaluate(()=>{switchTab('orders');colmgr.orders.hidden=new Set(colmgr.cp.hidden);renderOrders();BLFlushTableRenders();BLTableReportInline.setMode('orders',true);});
     if(key==='koleksiyon'){
       await page.evaluate(async()=>{switchTab('koleksiyon');await BLPerf.ensureFeature('collectionTools');});
       await page.evaluate(()=>{kolRows=[{id:91001,plmId:'990001',modelKod:'DEMO COLLECTION',season:'S7',mag:'DEMO',urunTipi:'DEMO',country:'DEMO',quantity:'200',targetPrice:'14',pricing:{},durum:'',colour:'NAVY'}];kolColOrder=kolDefaultDisplayOrder();kolHiddenCols=new Set(kolColDefs().map(c=>c.k).filter(k=>!['modelKod','season','quantity','targetPrice'].includes(k)));kolPictureHidden=false;kolColFilters={};kolSelected.clear();renderKol();BLTableReportInline.setMode('koleksiyon',true);});
     }
     const header=page.locator('#blTableReport-'+key+' [data-tr-image-size]');
     await page.waitForFunction(key=>{const img=document.querySelector('#blTableReport-'+key+' .blDetailImageCell img');return img?.dataset.blImageLoaded==='1'&&img.complete&&img.naturalWidth>0;},key).catch(async error=>{console.log(await page.locator('#blTableReport-'+key+' .blDetailImageCell img').first().evaluate(img=>({html:img.outerHTML,src:img.currentSrc})));throw error;});
     await header.click();
     const range=page.locator('#tableImageSizeRange');await range.waitFor();
     const maximum=Number(await range.getAttribute('max')),minimum=Number(await range.getAttribute('min'));
     const sizes=[];
     for(const value of [minimum,maximum]){
       await range.fill(String(value));await range.dispatchEvent('input');await range.dispatchEvent('change');
       await page.waitForFunction(({key,value})=>parseInt(getComputedStyle(document.querySelector('#blTableReport-'+key)).getPropertyValue('--bl-report-image-width'))===value,{key,value});
       sizes.push(await page.locator('#blTableReport-'+key+' .blDetailImageCell img').first().evaluate(img=>({width:img.getBoundingClientRect().width,height:img.getBoundingClientRect().height,col:img.closest('td').getBoundingClientRect().width,row:img.closest('tr').getBoundingClientRect().height,loaded:img.complete&&img.naturalWidth>0})));
     }
     assert.equal(sizes[0].width,minimum);assert.equal(sizes[1].width,maximum);assert.ok(sizes[1].height>sizes[0].height);assert.ok(sizes[1].row>sizes[0].row);assert.ok(sizes[1].col>sizes[0].col);
     const persisted=await page.evaluate(key=>BLStorage.getItem(TABLE_IMAGE_SIZE_CONFIG[key].preferenceKey),key);assert.equal(Number(persisted),maximum);
     // Same underlying preference and renderer, including resize while the report is hidden.
     await page.keyboard.press('Escape');
     if(key==='cp'){
       await header.click();await page.screenshot({path:path.join(assets,'report-image-size.png')});await page.keyboard.press('Escape');
       await page.evaluate(()=>applyLanguage('tr'));assert.equal(await header.textContent(),'Görsel');assert.equal(await header.getAttribute('title'),'Görsel boyutunu değiştir');await page.evaluate(()=>applyLanguage('en'));
     }
     await page.evaluate(key=>{BLTableReportInline.setMode(key,false);setTableImageSize(key,tableImageSizeBounds(key).min,{persist:true});BLTableReportInline.setMode(key,true);},key);
     await page.waitForFunction(({key,minimum})=>parseInt(getComputedStyle(document.querySelector('#blTableReport-'+key)).getPropertyValue('--bl-report-image-width'))===minimum,{key,minimum});
     evidence.push({key,minimum,maximum,sizes});console.log('PASS report/table shared image sizing, persistence, geometry and hidden-view update: '+key);
   }
   assert.deepEqual(errors,[]);fs.writeFileSync(path.join(root,'image-results.json'),JSON.stringify({ok:true,evidence,errors},null,2));return;
 }
 if(process.env.REPORT_PERF_ONLY==='1'){
   const baseline=process.env.REPORT_PERF_BASE||'e6794e78fc4ec8c841f664dde7b65ba60c3cf454';
   const original=name=>execFileSync('git',['show',baseline+':resources/app/public/'+name],{cwd:app,encoding:'utf8',maxBuffer:8*1024*1024});
   const sources={main:original('table-report-inline.js'),candidate:fs.readFileSync(path.join(app,'public/table-report-inline.js'),'utf8')};
   const styles={main:original('ui-tokens.css')+'\n'+original('ui-components.css'),candidate:fs.readFileSync(path.join(app,'public/ui-tokens.css'),'utf8')+'\n'+fs.readFileSync(path.join(app,'public/ui-components.css'),'utf8')};
   const samples=[];
   for(let pair=0;pair<3;pair++)for(const variant of ['main','candidate']){
     await page.evaluate(({source,css})=>{
       for(const sheet of document.querySelectorAll('link[href^="ui-tokens.css"],link[href^="ui-components.css"]'))sheet.disabled=true;
       let style=document.getElementById('reportPerfStyles');if(!style){style=document.createElement('style');style.id='reportPerfStyles';document.head.append(style);}style.textContent=css;
       BLTableReportInline.setMode('cp',false);document.querySelector('[data-table-report-inline="cp"]')?.remove();
       (0,eval)(source);
       const seed=state.cp.rows[0],rows=Array.from({length:300},(_,i)=>({...seed,_id:i+1,'PLM ID':990001+i,'Model Name':'DEMO MODEL '+i}));
       BLTableReportInline.register('cp',{tab:'cp',table:()=>document.getElementById('cpTable'),rows:()=>rows,columns:()=>tableReportCoreColumns('cp'),images:()=>false,...tableReportInteraction('cp')});
       BLTableReportInline.setMode('cp',true);
     },{source:sources[variant],css:styles[variant]});
     await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
     const measurement=await page.evaluate(()=>{
       const raw=[];
       for(let i=0;i<10;i++){const start=performance.now();BLTableReportInline.setMode('cp',true);document.querySelector('#blTableReport-cp').getBoundingClientRect();raw.push(performance.now()-start);}
       return {raw,mean:raw.reduce((a,b)=>a+b,0)/raw.length,rows:document.querySelectorAll('#blTableReport-cp tbody tr[data-id]').length||300};
     });samples.push({pair,variant,...measurement});
   }
   const evidence={base:baseline,scenario:'Actual Buyer Log unchanged report refresh and layout; baseline/candidate report JS and canonical CSS, same final app shell; 300 synthetic rows, 12 fields; 3 alternating pairs, 10 renders per sample',budget:'Existing report rendering: no reproducible regression; new edit and selection interactions <=200ms',samples};
   fs.writeFileSync(path.join(root,'performance.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));return;
 }
 console.log('Report rows',await page.locator('#blTableReport-cp tbody tr[data-id]').count());
 await page.screenshot({path:path.join(root,'initial.png')});
 assert.equal(await page.locator('#blTableReport-cp tbody tr[data-id]').count(),4);
 // Every preset has a pencil and it opens the existing Fields drawer.
 await page.locator('#cpTableViewActions [data-bl-view-trigger]').click();await page.screenshot({path:path.join(assets,'view-fields-pencils.png')});await page.locator('#cpTableViewActions [data-fields-view="extended"]').click();
 assert.ok(await page.locator('#_tableFieldsMenu').isVisible());await page.locator('[data-table-fields-close]').click();await page.keyboard.press('Escape');
 // Drag a field from the supporting line into the primary line.
 await page.locator('[data-table-report-inline="cp"] [data-tr-action="edit"]').click();
 const field=page.locator('[data-table-report-inline="cp"] [data-tr-field="Model Name"]'),group=await field.locator('xpath=ancestor::*[@data-tr-group]').getAttribute('data-tr-group');
 const primary=page.locator('[data-table-report-inline="cp"] [data-tr-group="'+group+'"] [data-tr-line="0"]');
 await field.dragTo(primary);
 await page.screenshot({path:path.join(assets,'report-cell-layout.png')});
 await page.locator('[data-table-report-inline="cp"] [data-tr-action="save"]').click();
 const savedLayout=await page.evaluate(()=>BLStorage.getItem('buyerlog.tableReportMode.v1.layout.cp.custom'));
 assert.ok(savedLayout.includes('Model Name'));
 await page.locator('[data-table-report-inline="cp"] [data-tr-action="edit"]').click();
 await page.locator('[data-table-report-inline="cp"] [data-tr-action="reset"]').click();
 await page.locator('[data-table-report-inline="cp"] [data-tr-action="cancel"]').click();
 assert.equal(await page.evaluate(()=>BLStorage.getItem('buyerlog.tableReportMode.v1.layout.cp.custom')),savedLayout);
 console.log('PASS saved drag, reset preview and cancel');
 // Select a report group and copy; output must be the underlying table columns.
 const cell=page.locator('#blTableReport-cp tbody tr[data-id]').first().locator('td[data-key]').nth(Number(group));await cell.click();await page.keyboard.press('Control+c');
 console.log('Selection',await page.evaluate(()=>({grid:BLGridClipboard.state('blTableReport-cp'),overlay:blOverlayOpen(),active:document.body.dataset.activeTab})),errors);
 await page.waitForFunction(async()=>Boolean(await navigator.clipboard.readText()),{timeout:5000});
 const copied=await page.evaluate(()=>navigator.clipboard.readText());console.log('Copied:',JSON.stringify(copied));assert.ok(copied.includes('990001'));assert.ok(copied.includes('\t'));
 const expected=await page.evaluate(()=>BLTableExport.toTSV(BLTableExport.buildMatrix({records:[state.cp.rows[0]],columns:visibleCols('cp').filter(c=>['PLM ID','Model Name','C.Code','Colour'].includes(c.k)),columnLabel:c=>tableColumnLabel('cp',c),cellText:(c,r)=>cellPlainText(c,r,computeFlags(r))}),{includeHeaders:false}));
 assert.equal(copied,expected,'report group is the original table cells in original order');
 await cell.click({modifiers:['Shift']});
 await page.screenshot({path:path.join(assets,'report-table-selection.png')});
 // Same shared row menu, exact canonical links, and the real BOM dialog.
 await cell.click({button:'right'});
 await page.locator('.rowCtxMenu').waitFor();
 for(const label of ['Open in PLM','Open TROY Order','Open TROY Shipment Request','PLM BOM / Print Details'])assert.ok(await page.locator('.rowCtxMenu').getByText(label,{exact:true}).isVisible(),label);
 await page.screenshot({path:path.join(assets,'report-row-actions.png')});await page.keyboard.press('Escape');
 const urls=[];await page.exposeFunction('captureReportLink',url=>urls.push(url));await page.evaluate(()=>{window.open=(url)=>{window.captureReportLink(url);return null;};});
 for(const label of ['Open in PLM','Open TROY Order','Open TROY Shipment Request']){await cell.click({button:'right'});await page.locator('.rowCtxMenu').getByText(label,{exact:true}).click();}
 assert.deepEqual(urls,['https://corenectum.lcwaikiki.com/models-options/style-overview?styleId=990101&m=2','https://troy.lcwaikiki.com/order-management/orders/880001','https://troy.lcwaikiki.com/cps-management/shipment-request/880001']);
 await cell.click({button:'right'});await page.locator('.rowCtxMenu').getByText('PLM BOM / Print Details',{exact:true}).click();
 await page.locator('[data-bom-close]').first().waitFor();await page.locator('[data-bom-close]').first().click();
 assert.deepEqual(await page.evaluate(()=>[...state.cpSelected]),[],'opening row actions does not replace cell or row selection');
 console.log('PASS canonical PLM / TROY links and real BOM dialog');
 // Shared CSS covers row selectors and excludes boolean data/permission fields.
 const railMatrix=await page.evaluate(()=>{
   const attrs=['class="rowChk"','class="shipCompareChk"','class="shipRowChk"','data-tr-check="0"','data-ship-chk-all','data-fabric-pick="0"','data-bin-id="demo"','data-cpa-queue-check="demo"','data-dc-item="demo"','data-dc-toggle-all','data-ta-pick="demo"','data-ta-all','data-act="selectRow"','data-act="selectAll"','id="shipChkAll"'];
   const table=document.createElement('table');table.style.cssText='position:absolute;left:-3000px;top:0;width:300px;table-layout:fixed';
   table.innerHTML='<tbody>'+attrs.map(attr=>'<tr style="height:48px"><td><input type="checkbox" '+attr+' checked></td><td>Demo</td></tr>').join('')+'<tr><td><input type="checkbox" data-um-rolecell="read"></td><td><input type="checkbox" data-ed-xbar="0"></td></tr></tbody>';document.body.append(table);
   const result=[...table.querySelectorAll('input')].map(input=>({appearance:getComputedStyle(input).appearance,width:input.getBoundingClientRect().width,height:input.getBoundingClientRect().height}));table.remove();return result;
 });
 for(const item of railMatrix.slice(0,-2)){assert.equal(item.appearance,'none');assert.equal(item.width,8);assert.ok(item.height>=44);}
 for(const item of railMatrix.slice(-2))assert.notEqual(item.appearance,'none','boolean property inputs retain their own control');
 const importRail=await page.evaluate(()=>{const table=document.createElement('table');table.style.cssText='position:absolute;left:-3000px;top:0';table.innerHTML='<tbody><tr style="height:48px"><td><label class="ximToggle"><input type="checkbox" data-xim="include" checked><span>Excel 1</span></label></td></tr></tbody>';document.body.append(table);const input=table.querySelector('input'),result={appearance:getComputedStyle(input).appearance,width:input.getBoundingClientRect().width,height:input.getBoundingClientRect().height};table.remove();return result;});
 assert.equal(importRail.appearance,'none');assert.equal(importRail.width,8);assert.ok(importRail.height>=44);

 // Native checkbox semantics, full-height rail and mixed header state.
 await page.locator('#blTableReport-cp [data-tr-check="1"]').check();
 const rail=await page.locator('#blTableReport-cp [data-tr-check="1"]').evaluate(input=>({appearance:getComputedStyle(input).appearance,width:input.getBoundingClientRect().width,height:input.getBoundingClientRect().height,cellHeight:input.closest('td').getBoundingClientRect().height,color:getComputedStyle(input).backgroundColor,cellWidth:input.closest('td').getBoundingClientRect().width}));
 assert.equal(rail.appearance,'none');assert.equal(rail.width,8);assert.equal(rail.cellWidth,8);assert.ok(Math.abs(rail.height-rail.cellHeight)<2);assert.notEqual(rail.color,'rgba(0, 0, 0, 0)');
 assert.ok(await page.locator('#blTableReport-cp [data-tr-check="all"]').evaluate(input=>input.indeterminate));
 await page.evaluate(()=>applyTheme('dark'));await page.screenshot({path:path.join(assets,'row-selection-rails.png')});await page.evaluate(()=>applyTheme('light'));
 await page.locator('#blTableReport-cp [data-tr-check="1"]').uncheck();
 // Real Moderator publish + buyer read/deny, including an older personal layout.
 const profilesResponse=await fetch(base+'/api/users/admin',{headers:{cookie}}),profiles=await profilesResponse.json();
 let buyer=profiles.profiles.find(profile=>profile.username==='report-buyer');
 if(!buyer){const response=await fetch(base+'/api/users',{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:profiles.revision,username:'report-buyer',displayName:'Demo Buyer',title:'Buyer',managerId:'moderator',password:'Demo-buyer-123'})});const created=await response.json();assert.equal(response.status,201,JSON.stringify(created));buyer=created.user;}
 const buyerLogin=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:buyer.id,password:'Demo-buyer-123'})});assert.equal(buyerLogin.status,200);const buyerCookie=buyerLogin.headers.get('set-cookie').split(';')[0];
 const forbidden=await fetch(base+'/api/table-report-layouts',{method:'PUT',headers:{cookie:buyerCookie,'Content-Type':'application/json'},body:JSON.stringify({table:'cp',view:'custom',layout:{},expectedId:''})});assert.equal(forbidden.status,403,'server denies non-Moderator even with a forged request');
 const buyerContext=await browser.newContext({viewport:{width:1600,height:960},reducedMotion:'reduce'}),eq=buyerCookie.indexOf('=');await buyerContext.addCookies([{name:buyerCookie.slice(0,eq),value:buyerCookie.slice(eq+1),domain:'127.0.0.1',path:'/'}]);
 await buyerContext.addInitScript(()=>localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0'));
 const buyerPage=await buyerContext.newPage();buyerPage.setDefaultTimeout(10000);await buyerPage.goto(base);await buyerPage.waitForFunction(()=>typeof switchTab==='function',{timeout:60000});await buyerPage.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({timeout:4000}).catch(()=>{});await buyerPage.waitForFunction(()=>!document.getElementById('blBootGuard'),{timeout:60000});
 await buyerPage.evaluate(()=>{applyLanguage('en');switchTab('cp');});await buyerPage.evaluate(seedCp);await buyerPage.evaluate(()=>BLTableReportInline.refreshShared());
 await buyerPage.locator('[data-table-report-inline="cp"] [data-tr-action="edit"]').click();assert.equal(await buyerPage.locator('[data-tr-action="save-all"]').count(),0,'shared save is hidden for buyer');
 await buyerPage.locator('[data-tr-action="reset"]').click();await buyerPage.locator('[data-tr-action="save"]').click();
 await page.locator('[data-table-report-inline="cp"] [data-tr-action="edit"]').click();await page.screenshot({path:path.join(assets,'report-save-everyone.png')});
 const publication=page.waitForResponse(response=>response.url().endsWith('/api/table-report-layouts')&&response.request().method()==='PUT');await page.locator('[data-tr-action="save-all"]').click();const published=await (await publication).json();assert.ok(published.slots['cp.custom'].id);await page.waitForFunction(()=>!document.querySelector('[data-tr-action="save-all"]'));
 await buyerPage.evaluate(()=>BLTableReportInline.refreshShared());
 await buyerPage.locator('[data-table-report-inline="cp"] [data-tr-action="edit"]').click();
 assert.equal(await buyerPage.locator('[data-tr-field="Model Name"]').evaluate(button=>button.closest('[data-tr-line]').dataset.trLine),'0','the new publication replaces the older personal layout');
 await buyerPage.locator('[data-tr-action="cancel"]').click();
 // A stale moderator cannot overwrite a newer publication.
 const stale=await fetch(base+'/api/table-report-layouts',{method:'PUT',headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify({table:'cp',view:'custom',layout:{},expectedId:''})});assert.equal(stale.status,409);
 await buyerPage.close();await buyerContext.close();console.log('PASS 8px rails, Moderator publication, buyer inheritance and server authority/conflict guards');
 // A delayed failed publish must not reopen a report the user has already left.
 let releaseFailure;const held=new Promise(resolve=>{releaseFailure=resolve;});
 const holdPublish=async route=>{if(route.request().method()==='PUT'){await held;await route.fulfill({status:503,json:{code:'DEMO_OFFLINE'}});}else await route.continue();};
 await page.route('**/api/table-report-layouts',holdPublish);
 await page.locator('[data-table-report-inline="cp"] [data-tr-action="edit"]').click();
 const failure=page.waitForResponse(response=>response.url().endsWith('/api/table-report-layouts')&&response.request().method()==='PUT');
 await page.locator('[data-tr-action="save-all"]').click();await page.evaluate(()=>BLTableReportInline.setMode('cp',false));releaseFailure();await failure;await page.waitForTimeout(100);
 assert.equal(await page.locator('[data-table-report-inline="cp"]').isVisible(),false);
 await page.unroute('**/api/table-report-layouts',holdPublish);await page.evaluate(()=>BLTableReportInline.setMode('cp',true));
 console.log('PASS delayed save failure preserves the user exit from report mode');

 // Row checkbox shares the ordinary table's selection.
 await page.locator('#blTableReport-cp [data-tr-check="1"]').check();assert.deepEqual(await page.evaluate(()=>[...state.cpSelected]),[2]);
 assert.equal(await page.evaluate(()=>BLGridClipboard.state('blTableReport-cp')?.selectionRange),null,'checking a row supersedes the old cell selection, as in the normal table');
 await page.evaluate(()=>BLTableReportInline.setMode('cp',false));assert.equal(await page.locator('#cpTable tbody tr[data-id="2"] .rowChk').isChecked(),true);
 // Selected-row rich clipboard is byte-identical in both presentations.
 await page.evaluate(()=>copyManagedTableLikeExcel('cp',filteredCP(),state.cpSelected,'navCopy'));
 const plainTable=await page.evaluate(()=>navigator.clipboard.readText());
 await page.evaluate(()=>BLTableReportInline.setMode('cp',true));
 await page.evaluate(()=>copyGridSelection(true));
 await page.waitForTimeout(100);
 assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),plainTable);
 // Real XLSX exports retain the table schema and rows while report is visible.
 async function workbook(report){await page.evaluate(on=>BLTableReportInline.setMode('cp',on),report);const download=page.waitForEvent('download');await page.evaluate(()=>exportActiveTableStyled());const file=await download;const saved=path.join(root,report?'report.xlsx':'table.xlsx');await file.saveAs(saved);const book=XLSX.readFile(saved);return XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1,defval:''});}
 assert.deepEqual(await workbook(true),await workbook(false));
 console.log('PASS identical selected-row clipboard and real XLSX export');
 // Orders and Collection share the same report interaction without changing their source.
 await page.evaluate(()=>{switchTab('orders');colmgr.orders.hidden=new Set(colmgr.cp.hidden);renderOrders();BLFlushTableRenders();BLTableReportInline.setMode('orders',true);});
 assert.equal(await page.locator('#blTableReport-orders tbody tr[data-id]').count(),4);
 await page.locator('#blTableReport-orders tbody td[data-key]').first().click();await page.keyboard.press('Control+c');
 await page.waitForFunction(async()=>(await navigator.clipboard.readText()).includes('990001'));
 await page.evaluate(async()=>{switchTab('koleksiyon');await BLPerf.ensureFeature('collectionTools');});
 await page.evaluate(()=>{kolRows=[{id:91001,plmId:'990001',modelKod:'DEMO COLLECTION',season:'S7',mag:'DEMO',urunTipi:'DEMO',country:'DEMO',quantity:'200',targetPrice:'14',pricing:{},durum:'',colour:'NAVY'}];kolColOrder=kolDefaultDisplayOrder();kolHiddenCols=new Set(kolColDefs().map(c=>c.k).filter(k=>!['modelKod','season','quantity','targetPrice'].includes(k)));kolPictureHidden=true;kolColFilters={};kolSelected.clear();renderKol();BLTableReportInline.setMode('koleksiyon',true);});
 assert.equal(await page.locator('#blTableReport-koleksiyon tbody tr[data-id]').count(),1);
 const collectionCell=page.locator('#blTableReport-koleksiyon tbody td[data-key]').filter({hasText:'DEMO COLLECTION'}).first();await collectionCell.click();await page.keyboard.press('Control+c');
 await page.waitForFunction(async()=>(await navigator.clipboard.readText()).includes('DEMO COLLECTION'));
 await page.locator('#blTableReport-koleksiyon [data-tr-check="0"]').check();assert.deepEqual(await page.evaluate(()=>[...kolSelected]),[91001]);
 await page.evaluate(()=>applyLanguage('tr'));
 await page.waitForFunction(()=>document.querySelector('[data-table-report-inline="koleksiyon"] [data-tr-action="edit"]')?.textContent==='Düzeni özelleştir').catch(async error=>{console.log('LANG',await page.evaluate(()=>({lang:document.documentElement.lang,text:document.querySelector('[data-table-report-inline="koleksiyon"]')?.textContent})));throw error;});
 await page.locator('[data-table-report-inline="koleksiyon"] [data-tr-action="edit"]').click();assert.ok(await page.getByRole('button',{name:'Kaydet',exact:true}).isVisible());
 console.log('PASS CP, Orders, Collection and live TR/EN');
 await page.locator('[data-table-report-inline="koleksiyon"] [data-tr-action="cancel"]').click();
 await page.evaluate(()=>{switchTab('cp');state.cpSelected.clear();const seed=state.cp.rows[0];state.cp.rows=Array.from({length:305},(_,i)=>({...seed,_id:i+1,'PLM ID':990001+i,'Model Name':'DEMO MODEL '+(i+1)}));invalidateCoreFacetCaches();_tableRangeViews.get(document.getElementById('cpTable')).controller.setSize('all');renderCPNow();BLFlushTableRenders();BLTableReportInline.setMode('cp',true);});
 assert.equal(await page.locator('#blTableReport-cp tbody tr[data-id]').count(),300,'report DOM remains chunk bounded');
 await page.locator('#blTableReport-cp tbody tr[data-id]').first().locator('td[data-key]').first().click();await page.keyboard.press('Control+a');
 assert.equal(await page.evaluate(()=>BLGridClipboard.state('blTableReport-cp').selectionRange.endRow),304);
 await page.keyboard.press('Control+c');await page.waitForFunction(async()=>(await navigator.clipboard.readText()).split(/\r?\n/).length===305);
 console.log('PASS Ctrl+A copies all 305 page rows across the 300-row report render chunk');
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(root,'results.json'),JSON.stringify({ok:true,errors},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.kill();fs.closeSync(log);});
