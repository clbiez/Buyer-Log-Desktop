'use strict';
const R=require('../../../resources/app/scripts/sync-e2e/runtime.cjs'),B=require('../../../resources/app/scripts/sync-e2e/browser.cjs'),assert=require('node:assert/strict');
const root=process.argv[2];let rt,browser,release,releaseAck;const journal=[];
const log=e=>{const v={at:Date.now(),...e};journal.push(v);R.fs.appendFileSync(R.path.join(root,'journal.jsonl'),JSON.stringify(v)+'\n')};
(async()=>{try{
 rt=await R.setup(root,{users:2,backends:1,port:7560});const m=rt.manifest,c=await R.login(rt.servers[0]);
 const old=R.check(await R.api(rt.servers[0],'/api/pricing-rules',{cookie:c}));
 R.check(await R.api(rt.servers[0],'/api/pricing-rules',{method:'PUT',cookie:c,body:{rules:old.rules.map(r=>({...r,royalty:24}))}}));
 browser=await B.launch();const a=await B.open(browser,rt.servers[0],m.accounts[0],m.owner),b=await B.open(browser,rt.servers[0],m.accounts[1],m.owner);B.instrument(a,log);B.instrument(b,log);await B.settle(a);await B.settle(b);
 const held=new Promise(r=>release=r);let heldCount=0;
 await b.page.route('**/api/pricing-rules*',async route=>{if(route.request().method()!=='GET')return route.continue();const response=await route.fetch();heldCount++;log({type:'real-rule-response-held',status:response.status()});await held;await route.fulfill({response})});
 let acceptedRev=null;
 const ackBarrier=new Promise(resolve=>releaseAck=resolve);
 await b.page.route('**/api/collection-workspaces/*',async route=>{
   if(route.request().method()!=='PATCH')return route.continue();
   const body=route.request().postDataJSON();
   if(!body.upserts?.some(row=>row.id===1&&String(row.royalty).startsWith('27')))return route.continue();
   const response=await route.fetch(),data=await response.json();
   const applied=data.applied?.find(item=>String(item.id)==='1');
   if(applied){acceptedRev=applied.rev;log({type:'real-stale-derived-acceptance',body,data,status:response.status()});}
   await ackBarrier;await route.fulfill({response});
 });
 await a.page.locator('#kolSearch').focus();
 const current=R.check(await R.api(rt.servers[0],'/api/pricing-rules',{cookie:c}));
 R.check(await R.api(rt.servers[0],'/api/pricing-rules',{method:'PUT',cookie:c,body:{rules:current.rules.map(r=>({...r,royalty:22}))}}));
 await a.page.waitForFunction(()=>state.overrides.pricingRules[0]?.royalty===22);
 await R.until(()=>heldCount>0,{ms:15000,label:'real response barrier'});
 // B is a real delayed client; only its genuine rule response is held.
 // Its old automatic fields arrive at A through native persistence and SSE.
 await b.page.evaluate(owner=>kolLoadWorkspace(owner),m.owner);
 await R.until(()=>acceptedRev,{ms:15000,label:'real acceptance of the delayed peer projection'});
 await a.page.waitForFunction(rev=>Number(kolRows.find(row=>row.id===1)?._rev)>=rev,acceptedRev,{timeout:15000});
 const before=await a.page.evaluate(()=>({row:kolRows.find(r=>r.id===1),rules:state.overrides.pricingRules,revision:state.storeRevisions.pricingRules,active:document.activeElement?.id}));log({type:'before-drawer',...before});
 const calc=await B.calculate(a,1,{keepOpen:true});log({type:'calculation',...calc});
 const total=calc.displayedWaterfall[0].total.replace(/[^0-9,.-]/g,'').replace(',','.');const expected=(4/(1-(22+3)/100)+.01)*1.11;
 await a.page.screenshot({path:R.path.join(root,'live-rule-projection.png')});
 assert.equal(Number(total),Number(expected.toFixed(2)),'drawer must use the currently loaded automatic rule, including after a deferred remote paint');
 releaseAck();releaseAck=null;release();release=null;await b.page.unroute('**/api/pricing-rules*');
 R.fs.writeFileSync(R.path.join(root,'result.json'),JSON.stringify({status:'passed',source:m.source,users:2,backends:1,heldCount,expected,displayed:total,scope:'Real delayed rules response, native row acceptance and SSE; no result or acceptance mocked'},null,2));console.log('PASS native automatic rule projection and real drawer total');
}finally{releaseAck?.();release?.();await browser?.close();if(rt)for(const s of rt.servers)await R.stopServer(s)}})().catch(e=>{R.fs.writeFileSync(R.path.join(root,'failure.json'),JSON.stringify({error:e.stack,status:'failed'},null,2));console.error(e);process.exitCode=1});
