const fs=require('node:fs');
const pw=require('/opt/codex/cua_node/lib/node_modules/playwright');
const launch=pw.chromium.launch.bind(pw.chromium);
pw.chromium.launch=async options=>{
  const browser=await launch(options),newContext=browser.newContext.bind(browser);
  browser.newContext=async options=>{
    const context=await newContext(options),newPage=context.newPage.bind(context);
    context.newPage=async()=>{
      const page=await newPage(),close=page.close.bind(page);
      page.close=async options=>{
        try{
          const metric=await page.evaluate(()=>{
            const nav=performance.getEntriesByType('navigation')[0],p=window.__startupProbe;
            const resources=performance.getEntriesByType('resource').filter(r=>/\.(js|css)$/.test(new URL(r.name).pathname)&&r.startTime<10000).map(r=>({path:new URL(r.name).pathname,kind:new URL(r.name).pathname.endsWith('.css')?'css':'js',startMs:r.startTime,decodedBytes:r.decodedBodySize,encodedBytes:r.encodedBodySize,transferBytes:r.transferSize}));
            return {module:new URL(location.href).searchParams.get('module'),domContentLoadedMs:nav?.domContentLoadedEventEnd,primaryScreenReadyMs:p?.primaryScreenReadyMs,longTaskTotalMs:p?.longTasks.reduce((s,t)=>s+t.duration,0),resources};
          });
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
