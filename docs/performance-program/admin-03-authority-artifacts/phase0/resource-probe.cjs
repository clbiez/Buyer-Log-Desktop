const fs=require('node:fs');
const pw=require('/opt/codex/cua_node/lib/node_modules/playwright');
const launch=pw.chromium.launch.bind(pw.chromium);
pw.chromium.launch=async options=>{
  const browser=await launch(options),newContext=browser.newContext.bind(browser);
  browser.newContext=async options=>{
    const context=await newContext(options),newPage=context.newPage.bind(context);
    context.newPage=async()=>{
      const page=await newPage(),close=page.close.bind(page);
      await page.addInitScript(()=>{
        performance.setResourceTimingBufferSize(20000);
        window.__shellResourceBufferFull=0;
        performance.addEventListener('resourcetimingbufferfull',()=>window.__shellResourceBufferFull++);
      });
      page.close=async options=>{
        try{
          const metric=await page.evaluate(()=>{
            const nav=performance.getEntriesByType('navigation')[0],p=window.__startupProbe;
            const resources=performance.getEntriesByType('resource').filter(r=>/\.(js|css)$/.test(new URL(r.name).pathname)&&r.startTime<10000).map(r=>({path:new URL(r.name).pathname,kind:new URL(r.name).pathname.endsWith('.css')?'css':'js',initiatorType:r.initiatorType,startMs:r.startTime,endMs:r.responseEnd,decodedBytes:r.decodedBodySize,encodedBytes:r.encodedBodySize,transferBytes:r.transferSize}));
            return {totalResourceRecords:performance.getEntriesByType('resource').length,resourceBufferFull:window.__shellResourceBufferFull,module:new URL(location.href).searchParams.get('module'),domContentLoadedMs:nav?.domContentLoadedEventEnd,primaryScreenReadyMs:p?.primaryScreenReadyMs,longTaskTotalMs:p?.longTasks.reduce((s,t)=>s+t.duration,0),resources};
          });
          if(process.env.SHELL_GUIDE_PROBE==='1'){
            const started=await page.evaluate(()=>performance.now());
            await page.keyboard.press('F1');await page.waitForSelector('[data-guide-search]');
            await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
            metric.guideFirstOpenMs=await page.evaluate(start=>performance.now()-start,started);
            await page.locator('[data-guide-close]').click();
            await page.waitForFunction(()=>BLPerf.timeline().some(mark=>mark.name==='BACKGROUND_WARMUP_DONE'),null,{timeout:180000});
            metric.collectionInitiallyLoaded=await page.evaluate(()=>BLPerf.isFeatureLoaded('collectionTools'));
            const collectionStarted=await page.evaluate(()=>performance.now());
            await page.evaluate(()=>switchTab('koleksiyon'));
            await page.evaluate(async()=>{await BLPerf.ensureFeature('collectionTools');await ensureCollectionCatalogLoaded();});
            await page.waitForSelector('#kolTable');
            await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
            metric.collectionFirstOpenMs=await page.evaluate(start=>performance.now()-start,collectionStarted);
          }
          const file=process.env.SHELL_METRICS_FILE;if(file){const all=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):[];all.push(metric);fs.writeFileSync(file,JSON.stringify(all,null,2)+'\n');}
        }catch(error){console.error('shell-metrics: '+error.message);}
        return close(options);
      };
      return page;
    };
    return context;
  };
  return browser;
};
module.exports=pw;
