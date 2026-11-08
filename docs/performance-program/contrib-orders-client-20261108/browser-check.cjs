'use strict';
// Local classic-script smoke, real Chromium. Run under the shared flock.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const APP=path.resolve(__dirname,'../../../resources/app');
const {fixture,hostFunction}=require(path.join(APP,'tests/fixtures/orders-projection-client/runtime.cjs'));
async function main(){
  const f=await fixture();await f.initialize();const wire=await f.ready();
  const extra=hostFunction('fullParentHeaders',{Buffer,stale:()=>Error('stale')},
    fs.readFileSync(path.join(APP,'server/lib/orders-ready-http.js'),'utf8'))(f.metadata.token,
      {pin:{uncompressedBytes:Buffer.byteLength(f.rawText)},schema:{rowCount:2}});
  const server=http.createServer((_request,response)=>{
    response.setHeader('Content-Type','text/html; charset=utf-8');
    response.end('<!doctype html><meta charset="utf-8"><title>Synthetic module check</title>');
  });
  let browser;
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
    const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
    await page.evaluate(({columns,hidden,rawText})=>{
      const full=JSON.parse(rawText);
      const storage=new Map([['bl.formulaColumns.orders.v1','[]']]);
      window.BLStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value))};
      window.COLS_BY_TABLE={cp:[],orders:columns,ship:[]};window.colmgr={orders:{order:columns.map(c=>c.k),hidden:new Set(hidden)}};
      window.BLFormulaRows={orders:()=>full.rows};window.tableColumnLabel=(_table,column)=>column.label||column.k;
    },{columns:f.f.context.columns,hidden:f.f.context.hiddenKeys,rawText:f.rawText});
    const files=['canonical-fields.js','canonical-module-bindings.js','formula-engine.js','formula-columns.js',
      'projection-dependency-plan.js','projection-inventory-contract.js','orders-finite-closure.js',
      'module-projection-schema.js','orders-full-promotion.js','orders-projection-client.js'];
    for(const name of files)await page.addScriptTag({path:path.join(APP,'public',name)});
    const result=await page.evaluate(async({capture,metadata,headerMap,rawText,wire,extra})=>{
      // Parse owned JSON bytes in the browser. Automation's object bridge does
      // not preserve own __proto__ data properties and cannot be the row codec.
      const full=JSON.parse(rawText),ready=JSON.parse(wire.rawText);
      const check=(condition,message)=>{if(!condition)throw Error(message);};
      check(typeof require==='undefined'&&typeof Buffer==='undefined','Node globals leaked');
      const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
      const compiler=BLOrdersFiniteClosure.createOrdersFiniteClosure({canonical:BLCanonicalFields,formulaEngine:BLFormulaEngine,
        formulaColumns:BLFormulaColumns,dependencyPlan:BLProjectionDependencyPlan,inventory:BLProjectionInventoryContract,
        inventoryRef:BLProjectionInventoryContract.ref});
      const compileFailures=[];
      const checkedCompiler={compile(...args){const result=compiler.compile(...args);if(!result.supported)compileFailures.push(result.reason);return result;},
        compileSchema:compiler.compileSchema};
      const client=BLOrdersProjectionClient.create({finiteApi:BLOrdersFiniteClosure,compiler:checkedCompiler,schemaApi:BLModuleProjectionSchema,
        formulaColumns:BLFormulaColumns,readCurrent:()=>capture,settleOnFull:async()=>BLFormulaColumns.migrateReferences('orders'),
        sha256:text=>sha(new TextEncoder().encode(text))});
      const init=await client.initializeFull({metadata,afterMetadata:metadata,headers:new Headers(headerMap),fullWire:full,rawText});
      check(init.mode==='full-initialized','initialize: '+init.reason+' '+compileFailures.join(','));
      BLFormulaRows.orders=()=>{throw Error('metadata row-provider read');};
      const request=await client.prepare(metadata,'native_nonce');check(request.mode==='ready','prepare: '+request.reason);
      check(request.body.planHash===wire.planHash,'native/browser plan hash mismatch');
      const accepted=await client.accept(request,{payload:ready,headers:new Headers({...headerMap,
        'X-Orders-View-Mode':'ready','X-Orders-Request-Nonce':'native_nonce','X-Orders-Plan-Hash':request.body.planHash})});
      accepted.assertCurrent();
      check(accepted.payload.rows[0]['Order Code']===accepted.payload.rows[1]['Order Code'],'duplicate IDs lost');
      check(!Object.hasOwn(accepted.payload.rows[1],'Probe')&&accepted.payload.rows[0].Probe===0,'sparse zero lost');
      const parent=accepted.parent,t=parent.token;
      const live={...parent,sessionId:'browser-epoch',nonce:()=> 'parent_nonce',assertCurrent:accepted.assertCurrent};
      const expected={ownerId:t.ownerId,sessionId:live.sessionId,sourceId:t.sourceProjectionKey,generation:t.sourceGeneration,
        accessHash:t.accessHash,scopeHash:parent.guardStamp,module:'orders',planHash:parent.planHash,
        fullProjectionChecksum:parent.fullJsonSha256,fullByteLength:parent.fullJsonBytes,rowCount:parent.rowCount};
      const fetchFull=BLOrdersProjectionClient.createFetchFull({promotionApi:BLOrdersFullPromotion,sha256Bytes:sha,live:()=>live,
        fetch:async(_url,options)=>{const dto=JSON.parse(options.body);check(!Object.hasOwn(dto,'fullJsonSha256'),'raw hash sent as gzip pin');
          return new Response(new TextEncoder().encode(rawText),{headers:new Headers({...headerMap,...extra,
            'X-Orders-View-Mode':'full','X-Orders-Request-Nonce':'parent_nonce'})});}});
      let state={kind:'thin',rows:accepted.payload.rows,selectedRows:[accepted.payload.rows[1]],identity:expected,
        requiredKeys:[],ordinals:[0,1],mutationRevision:0,selectionRevision:0,dirty:false};
      const controller=BLOrdersFullPromotion.create({snapshot:()=>state,fetchFull,isCurrent:()=>true,
        normalize:async rows=>({rows,ordinals:[0,1]}),publish:(next,{expected,assertCurrent})=>{
          check(state===expected,'publication race');assertCurrent();return state=next;}});
      const restored=await controller.ensure();restored.assertCurrent();
      check(JSON.stringify(restored.rows)===JSON.stringify(full.rows),'full row presence/value/order changed');
      check(restored.selectedRows[0]===restored.rows[1],'duplicate-ID selection ordinal changed');
      check(parent.fullJsonSha256!==parent.fullGzipChecksum,'raw/gzip digests conflated');
      return {status:'passed',rows:restored.rows.length,planHash:request.body.planHash,rawSha256:parent.fullJsonSha256,
        gzipSha256:parent.fullGzipChecksum,classicScripts:true,nodeGlobals:false,actualUiIntegration:false};
    },{capture:f.capture(),metadata:f.metadata,headerMap:f.h,rawText:f.rawText,
      wire:{rawText:JSON.stringify(wire.payload),planHash:wire.request.body.planHash},extra});
    assert.equal(result.status,'passed');
    fs.writeFileSync(path.join(__dirname,'browser-result.json'),JSON.stringify({...result,chromium:await browser.version()},null,2)+'\n');
    console.log(result);
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
