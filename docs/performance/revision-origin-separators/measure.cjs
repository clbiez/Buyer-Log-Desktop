const path=require('node:path');
const fs=require('node:fs'),crypto=require('node:crypto'),cp=require('node:child_process'),os=require('node:os');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(__dirname,'../../..'),base='15b364dd6cac88778174b565d5199ae60fa23222',candidate='f256f702';
const source=(ref,file)=>cp.execFileSync('git',['show',ref+':resources/app/public/'+file],{cwd:repo,encoding:'utf8',maxBuffer:8e6});
const variants=Object.fromEntries([['A',base],['B',candidate]].map(([key,ref])=>[key,Object.fromEntries(['app-main.js','business-rules.js'].map(file=>[file,source(ref,file)]))]));
const aa=process.argv.includes('--aa'),manual=process.argv.includes('--manual');
if(aa)variants.B=variants.A;
const report={base,candidate,manual,aa,node:process.version,cpu:os.cpus()[0].model,sourceHashes:Object.fromEntries(Object.entries(variants).map(([key,files])=>[key,Object.fromEntries(Object.entries(files).map(([name,body])=>[name,crypto.createHash('sha256').update(body).digest('hex')]))])),runs:[]};
const out=path.join(__dirname,aa?(manual?'aa-results.json':'mixed-aa-results.json'):manual?'manual-results.json':'results.json');
(async()=>{const lock=fs.openSync('/tmp/buyerlog-performance-measurement.lock','wx');fs.writeSync(lock,String(process.pid));
try{for(const size of (aa?[200]:[200,30000]))for(const [pair,order] of ['AB','BA','AB'].entries())for(const variant of order){
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--js-flags=--expose-gc']});
 const page=await browser.newPage({viewport:{width:1440,height:800},reducedMotion:'reduce'});
 for(const [file,body] of Object.entries(variants[variant]))await page.route('**/'+file+'*',route=>route.fulfill({status:200,contentType:'application/javascript',body}));
 await page.goto('http://127.0.0.1:8765');await page.waitForTimeout(2000);let requests=0;page.on('request',()=>requests++);
 const result=await page.evaluate(async ({size,manual})=>{
  window.SERVER_BACKED=false;applyLanguage('en');
  const template={_id:0,'Order Code':9000000,'Model Name':'SYNTHETIC','C.Code':'01',Country:'China',Season:'W6','Order Quantity':1500,'Remaining Units':1500,OPD:new Date(2026,4,1),'Original Ex-factory':new Date(2026,9,5),_asasExFactory:new Date(2026,9,30),'Ex-factory':new Date(2026,10,12),'Retail Date':new Date(2027,1,16),_asasRetailDate:new Date(2027,1,16),'In-Store (Model Budget)':new Date(2027,2,1),_asasInStore:new Date(2027,2,1),'Buying Son Onay Tarihi':new Date(2026,10,12),'Del. Type':'Gemi',STATUS:'Üretimde',_exFactoryRevision:{source:'loading-approval',previousDate:new Date(2026,9,30)}};
  const rows=Array.from({length:size},(_,i)=>({...template,_id:i,'Order Code':9000000+i,...(!manual&&i%2?{}:{_exFactoryRevision:null,'Buying Son Onay Tarihi':null})}));
  for(const r of rows)applyFormulas(r);
  state.cp={rows,fname:'Synthetic'};state.asasOrders=[];document.querySelectorAll('section[id^=view-]').forEach(e=>e.classList.remove('active'));document.getElementById('view-cp').classList.add('active');document.body.dataset.activeTab='cp';document.getElementById('cpEmpty').style.display='none';document.getElementById('cpContent').style.display='block';
  colmgr.cp.order=['Order Code','Model Name','Original Ex-factory','Ex-factory','Buying Son Onay Tarihi','LT','Retail Date','Ex→Retail','STATUS','Ant. Arrival'];colmgr.cp.hidden=new Set();
  const render=()=>renderFullTable('cpTable','cp',rows,state.cpSort,()=>{},{withChk:true,computeFn:computeFlags,virtualize:true});
  const frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  render();await frame();await new Promise(r=>setTimeout(r,0));
  const samples=[],tasks=[];const observer=new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>e.duration)));
  for(let i=0;i<5;i++){await new Promise(r=>setTimeout(r,0));observer.observe({type:'longtask'});document.getElementById('cpContent').style.display='block';const start=performance.now();render();const sync=performance.now()-start;await frame();const visible=performance.now()-start;await new Promise(r=>setTimeout(r,0));observer.disconnect();window.gc?.();samples.push({syncMs:sync,visibleMs:visible,dom:document.getElementById('cpTable').querySelectorAll('*').length,renderedRows:document.querySelectorAll('#cpTable tbody tr').length,heap:performance.memory?.usedJSHeapSize||null});document.getElementById('cpContent').style.display='none';await frame();}
  observer.disconnect();return {size,samples,tasks,sourceRows:rows.length,dataChecksum:rows.reduce((sum,row)=>sum+Number(row.LT)+Number(row['Ex→Retail']),0)};
 },{size,manual});
 report.browser=browser.version();report.runs.push({pair:pair+1,variant,requests,...result});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');await browser.close();process.stdout.write(`${size} pair ${pair+1} ${variant} done\n`);
} }finally{fs.closeSync(lock);fs.unlinkSync('/tmp/buyerlog-performance-measurement.lock');}})().catch(e=>{console.error(e);process.exitCode=1;});
