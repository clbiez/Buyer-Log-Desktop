// Real isolated Buyer Log + synthetic records. Only corporate AI generation is simulated.
// Run: node scripts/lcwai-analysis-acceptance.js [--baseline SHA] [--functional-only]
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const repo=path.resolve(__dirname,'../../..'),appRoot=path.join(repo,'resources/app');
const {start}=require(path.join(appRoot,'scripts/lib/client-performance-app'));
const XLSX=require(path.join(appRoot,'node_modules/xlsx'));
const evidence=path.join(repo,'docs/performance/lcwai-weighted-20261109');
const repeatArg=process.argv.indexOf('--repeats');const repeatCount=repeatArg<0?5:Number(process.argv[repeatArg+1]);
const baselineArg=process.argv.indexOf('--baseline');const baseline=baselineArg<0?'9e667430e3ac7ca30b321f06893d53f24d6ed5a3':process.argv[baselineArg+1];
const baselineFiles=new Map(['lcwai-data-query.js','lcwai-chat.js','perf-runtime.js','lfl-calculation-engine.js'].map(name=>[name,execFileSync('git',['show',`${baseline}:resources/app/public/${name}`],{cwd:repo,encoding:'utf8'})]));
fs.mkdirSync(evidence,{recursive:true});let app,page,variant='candidate',baseUrl='';
(async()=>{
 app=await start();page=app.page;baseUrl=page.url();
 await page.context().route('**/*',route=>['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
 await page.context().route('**/*.js*',route=>{if(!['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname))return route.abort();const name=new URL(route.request().url()).pathname.split('/').pop();return variant==='baseline'&&baselineFiles.has(name)?route.fulfill({contentType:'application/javascript',body:baselineFiles.get(name)}):route.continue();});
 const cases=[],retainedHeapSamples=[];
 async function open(mode,count=37183){
  variant=mode;const context=page.context();await page.close();page=await context.newPage();page.setDefaultTimeout(60000);page.on('pageerror',e=>app.errors.push(e.message));await page.goto(baseUrl,{waitUntil:'domcontentloaded'});
  await page.locator('[data-boot-continue]').click();await page.waitForFunction(()=>!document.getElementById('blBootGuard'));
  await page.locator('button[data-tab="lcwai"]').first().click();await page.locator('[data-chat-input]').waitFor();
  await page.evaluate(async count=>{
   await BLEnsureOrdersLoaded({deferRender:true});
   const table=BLAIScreenData.table('orders',{all:true}),CF=BLCanonicalFields,base=table.rows[0];
   const keys=Object.fromEntries(table.columns.map(c=>[CF.canonicalId('orders',c.key),c.key]));
   window.__keys=keys;
   const set=(row,id,value)=>{if(keys[id])row[keys[id]]=value;};
   state.orders.rows=Array.from({length:count},(_,i)=>{const row={...base,_id:i+1};for(const [k,v] of Object.entries({season:'S7',mag:'CU4E',mmyg:'KIDS',country:i%2?'BANGLADESH':'CHINA',buyingGroup:'LİSANS',productDescription:'T-Shirt',category:'K.KOL-LİSANS',manufacturer:i%2?'DEMO BETA':'DEMO ALPHA',orderQuantity:i%2?300:100,fob:i%2?6:2,inStore:new Date(2027,i%3,10),orderCode:'DEMO-'+i}))set(row,k,v);return row;});
   window.__calls={ask:0,chat:0,uploads:0,worksheets:[]};

   BuyerLogAI.ask=async options=>{__calls.ask++;window.__planReadyAt=performance.now();await new Promise(resolve=>setTimeout(resolve,0));return {data:window.__plan,model:{label:'Demo planner'}};};
   BuyerLogAI.chat=async()=>{__calls.chat++;throw Error('Unexpected model chat');};
   BuyerLogAI.uploadFile=async()=>{__calls.uploads++;throw Error('Unexpected upload');};
   window.__sourceRows=count;window.__stages=[];const original=BLDataQuery;window.BLDataQuery={...original,normalizeSpec(...args){const start=performance.now();const result=original.normalizeSpec(...args);__stages.push({stage:'normalize',start,end:performance.now()});return result;},execute(...args){const start=performance.now();const result=original.execute(...args);__stages.push({stage:'execute-sync',start,end:performance.now()});return result;},schemaText(...args){const start=performance.now();const result=original.schemaText(...args);__stages.push({stage:'schema',start,end:performance.now()});return result;},async executeAsync(...args){const start=performance.now();const result=await original.executeAsync(...args);__stages.push({stage:'execute',start,end:performance.now()});return result;}};
  },count);
  await page.waitForTimeout(1500);
 }
 async function run(weighted=false,lang='tr'){
  return page.evaluate(async({weighted,lang})=>{
   await applyLanguage(lang);
   const chat=BLLcwAiChat,s=chat._state,k=window.__keys;
   s.conversations=[];s.activeId='';s.contexts=[{id:'orders:all',label:lang==='tr'?'Siparişler — Demo tüm kayıtlar':'Orders — all demo records'}];s.output.format='';
   window.__plan={mode:'query',assumptions:[lang==='tr'?'Sentetik demo veri; FOB adet ile ağırlıklandırıldı.':'Synthetic demo data; FOB weighted by order quantity.'],specJson:JSON.stringify({dataset:'orders',title:weighted?(lang==='tr'?'Demo · CU4E S7 toplam adet ve ağırlıklı FOB':'Demo · CU4E S7 total quantity and weighted FOB'):'Demo · Total quantity',measures:[{agg:'sum',field:k.orderQuantity},...(weighted?[{agg:'weighted_avg',field:k.fob,weightField:k.orderQuantity}]:[])]})};
   window.__stages=[];const tasks=[],observer=new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration}))));observer.observe({type:'longtask',buffered:false});
   const start=performance.now();let feedbackMs=null;requestAnimationFrame(()=>{feedbackMs=performance.now()-start;});await chat.send(weighted?(lang==='tr'?'CU4E S7 sipariş toplam adetini ve ağırlıklı FOB ortalamasını çıkar':'CU4E S7 total quantity and weighted FOB average'):'sipariş toplam adet');
   await new Promise(requestAnimationFrame);const visible=performance.now();await new Promise(resolve=>setTimeout(resolve,30));observer.disconnect();
   const answer=s.conversations[0].messages.at(-1);if(answer.error)throw Error(answer.error);
   return {feedbackMs,requestToVisibleMs:visible-start,planToVisibleMs:visible-__planReadyAt,longTasksMs:tasks.map(e=>e.duration),longTasks:tasks,stages:__stages,answer:answer.text,calls:{ask:__calls.ask,chat:__calls.chat,uploads:__calls.uploads},spec:answer.query.spec};
  },{weighted,lang});
 }
 if(process.argv.includes('--memory-only')){const samples=[];for(const mode of ['baseline','candidate']){await open(mode);for(let i=0;i<15;i++)await run(mode==='candidate');const cdp=await page.context().newCDPSession(page),heaps=[];for(let i=0;i<6;i++){if(i)await run(mode==='candidate');await page.waitForTimeout(1000);await cdp.send('HeapProfiler.collectGarbage');heaps.push((await cdp.send('Runtime.getHeapUsage')).usedSize);}await cdp.detach();samples.push({mode,heaps});}fs.writeFileSync(path.join(evidence,'memory-cycles.json'),JSON.stringify({baseline,warmupQueries:15,cycles:5,samples},null,2));console.log(JSON.stringify(samples));return;}
 if(!process.argv.includes('--functional-only'))for(let pair=0;pair<3;pair++)for(const mode of process.argv.includes('--aa')?['baseline','baseline']:pair%2?['candidate','baseline']:['baseline','candidate']){
  await open(mode);const first=await run(),repeats=[];for(let i=0;i<repeatCount;i++)repeats.push(await run());cases.push({pair,mode,first,repeats});console.log('pair',pair,mode,first.requestToVisibleMs,repeats.map(r=>r.requestToVisibleMs));
 }
 if(process.argv.includes('--sum-only')){fs.writeFileSync(path.join(evidence,process.argv.includes('--aa')?'baseline-aa.json':'sum-repeat.json'),JSON.stringify({baseline,cases},null,2));return;}
 await open('candidate');const weighted=await run(true);console.log('weighted',JSON.stringify(weighted));assert.match(weighted.answer,/Ağırlıklı ortalama/);assert.equal(weighted.calls.uploads,0);
 await page.screenshot({path:path.join(appRoot,'public/release-notes/next-assets/lcwai-weighted-metrics.png')});
 const cdp=await page.context().newCDPSession(page);for(let i=0;i<6;i++){if(i)await run(true);await cdp.send('HeapProfiler.collectGarbage');retainedHeapSamples.push((await cdp.send('Runtime.getHeapUsage')).usedSize);}await cdp.detach();
 const weightedEn=await run(true,'en');assert.match(weightedEn.answer,/Weighted average/);
 // Production Excel route, real numeric workbook and persisted draft.
 const numeric=await page.evaluate(()=>{const table=BLAIScreenData.table('orders',{all:true});const ds=BLDataQuery.createDataset({id:'orders',screen:'orders',rows:table.rows,columns:table.columns});const n=BLDataQuery.normalizeSpec(__plan.specJson,[ds]);const result=BLDataQuery.execute(n.spec,ds);return BLDataQuery.toWorkbook(result,{title:'Demo weighted FOB'});});
 const output=await (await app.api('/api/lcwai/outputs/table',{data:numeric,lang:'en'})).json();assert.equal(output.output.format,'xlsx');
 const excelPath=fs.readdirSync(app.root,{recursive:true}).map(String).find(p=>p.includes('ai-outputs')&&p.endsWith('.xlsx'));assert.ok(excelPath);const wb=XLSX.readFile(path.join(app.root,excelPath)),sheet=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1});assert.ok(sheet.some(r=>r[0]===7436500&&r[1]===37182200/7436500),'export retains the unrounded weighted FOB');
 // Authorized LFL upload, then query it without opening the LFL page.
 const lflBook=XLSX.utils.book_new(),lflRows=['S6','S7'].flatMap((season,j)=>['CHINA','TURKEY'].map((country,i)=>({'Sipariş Kod':`DEMO-LFL-${j}-${i}`,'Model Adı':'DEMO TSHIRT','Merch Alt Grup Kod':'CU4E','Merch Marka Yaş Grup Kod':'KIDS','Ürün Klasman':'T-Shirt','Sezon':season,'Üretici':i?'DEMO BETA':'DEMO ALPHA','Siparişin Üretildiği Ülke':country,'Buyer Grup (TR)':'LİSANS','Buyer':'DEMO BUYER','Model Bütçe Tarih Yıl Ay Gün':`202${6+j}-01-10`,'Net Alım Sipariş Miktarı':j?300:100,'FOB Fiyatı':i?(j?110:100):(j?3:4)})));
 const lflScaleRows=Array.from({length:37184},(_,i)=>({...lflRows[i%4],'Sipariş Kod':'DEMO-LFL-SCALE-'+i}));XLSX.utils.book_append_sheet(lflBook,XLSX.utils.json_to_sheet(lflScaleRows),'Demo');await app.api('/api/lfl/upload',{name:'Demo LFL.xlsx',dataBase64:XLSX.write(lflBook,{type:'buffer',bookType:'xlsx'}).toString('base64')});
 const lfl=await page.evaluate(async()=>{await applyLanguage('tr');const s=BLLcwAiChat._state;s.conversations=[];s.activeId='';s.contexts=[];s.output.format='';window.__plan={mode:'query',specJson:JSON.stringify({dataset:'lfl',title:'Demo · LFL fiyat kıyası',comparison:{type:'lfl'}})};__stages=[];let feedbackMs=null;const begin=performance.now();requestAnimationFrame(()=>feedbackMs=performance.now()-begin);const tasks=[],observer=new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration}))));observer.observe({type:'longtask',buffered:false});await BLLcwAiChat.send('Basit bir LFL analizi yapar mısın');await new Promise(requestAnimationFrame);const visibleMs=performance.now()-begin;await new Promise(r=>setTimeout(r,30));observer.disconnect();const answer=s.conversations[0].messages.at(-1);answer.acceptanceMetrics={feedbackMs,visibleMs,planToVisibleMs:begin+visibleMs-__planReadyAt,stages:__stages,longTasks:tasks};return answer;});
 assert.equal(lfl.error,undefined);assert.match(lfl.text,/-25/);await page.screenshot({path:path.join(appRoot,'public/release-notes/next-assets/lcwai-lfl-analysis.png')});
 const backlog=await page.evaluate(async()=>{const response=await fetch('/api/backlog-export?format=json');const body=await response.json();const ds=BLDataQuery.datasetFromRecords({id:'backlog',rows:body.rows||[]});return {count:body.rows?.length,fields:ds.fields.map(f=>({id:f.id,canonical:f.canonical,kind:f.kind}))};});

 const backlogAnswer=await page.evaluate(async()=>{const s=BLLcwAiChat._state;s.conversations=[];s.activeId='';s.contexts=[];window.__plan={mode:'query',specJson:JSON.stringify({dataset:'backlog',title:'Demo · Backlog kalan adet',rows:['manufacturer'],measures:[{agg:'sum',field:'remainingUnits'}],sort:{by:0,dir:'desc'}})};await BLLcwAiChat.send('Backlog kalan adedi üretici bazında çıkar');return s.conversations[0].messages.at(-1);});assert.equal(backlogAnswer.error,undefined);assert.ok(backlogAnswer.query);await page.screenshot({path:path.join(appRoot,'public/release-notes/next-assets/lcwai-backlog-analysis.png')});
 const before=await(await app.api('/api/collection-workspaces/moderator')).json();
 await app.api('/api/collection-workspaces/moderator',{expectedRevision:before.workspace?._revision,rows:[{id:1,modelKod:'DEMO TSHIRT',urunTipi:'T-Shirt',productMainDefinition:'T-Shirt',season:'S7',mag:'CU4E',mmyg:'KIDS',country:'CHINA',quantity:100,pricing:{'DEMO ALPHA':4,'DEMO BETA':3}}],nextId:2,manufacturers:['DEMO ALPHA','DEMO BETA'],customColumns:[],statusCatalog:[]},'PUT');
 await open('candidate',2000);
 const suppliers=await page.evaluate(async()=>{const s=BLLcwAiChat._state;s.conversations=[];s.activeId='';s.contexts=[];s.output.format='';window.__plan={mode:'query',specJson:JSON.stringify({title:'Demo · Üretici teklif ve hacim kıyası',queries:[{dataset:'quotations',title:'En düşük t-shirt teklifi (USD)',filters:[{field:'category',values:['T-Shirt']}],rows:['manufacturer','currency'],measures:[{agg:'min',field:'fob'},{agg:'count'}],sort:{by:0,dir:'asc'},limit:1},{dataset:'orders',title:'En yüksek t-shirt sipariş hacmi',filters:[{field:'productDescription',values:['T-Shirt']}],rows:['manufacturer'],measures:[{agg:'sum',field:'orderQuantity'},{agg:'count_distinct',field:'orderCode'}],sort:{by:0,dir:'desc'},limit:1}]})};await BLLcwAiChat.send('t-shirt için en uygun fiyat veren ve en çok t-shirt siparişi alan üreticiyi göster');return {answer:s.conversations[0].messages.at(-1),collectionRows:kolRows.length,calls:__calls};});
 assert.equal(suppliers.answer.error,undefined,JSON.stringify(suppliers));assert.ok(suppliers.answer.text.includes('DEMO BETA'));assert.equal(suppliers.calls.uploads,0);
 await page.screenshot({path:path.join(appRoot,'public/release-notes/next-assets/lcwai-supplier-analysis.png')});
 fs.writeFileSync(path.join(evidence,process.argv.includes('--functional-only')?'acceptance-functional.json':'acceptance-raw.json'),JSON.stringify({baseline,node:process.version,chromium:page.context().browser().version(),sourceHashes:Object.fromEntries(['public/lcwai-data-query.js','public/lcwai-chat.js','public/lcwai-lfl-query.js','public/lfl-calculation-engine.js','public/app-main.js','public/canonical-fields.js','public/perf-runtime.js','server/lib/lcwai/lcwai-prompt.js','server/lib/lcwai/lcwai-knowledge.js'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(appRoot,f))).digest('hex')])),syntheticRows:37183,fixtureRecipeHash:crypto.createHash('sha256').update('lcwai-synthetic-37183-alternating-100x2-300x6-v1').digest('hex'),cases,weighted,weightedEn,retainedHeapSamples,lfl,backlog,backlogAnswer,suppliers,excel:{format:output.output.format,sheets:wb.SheetNames},errors:app.errors},null,2));
 console.log(JSON.stringify({weightedMs:weighted.requestToVisibleMs,weightedLongTasks:weighted.longTasksMs,lfl:lfl.text,backlog},null,2));
})().catch(async e=>{console.error(e);if(page)await page.screenshot({path:path.join(evidence,'failure.png')}).catch(()=>{});process.exitCode=1;}).finally(async()=>{await app?.close();});
