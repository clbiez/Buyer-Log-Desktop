'use strict';
// Diagnostic only: native benchmark, renderers, data, assertions and clocks stay intact.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const actual=require('/opt/codex/cua_node/lib/node_modules/playwright');
const out=process.env.PR908_OUT;
const save=(name,value)=>fs.writeFileSync(path.join(out,name),JSON.stringify(value,null,2)+'\n');
const hash=value=>require('node:crypto').createHash('sha256').update(value).digest('hex');
exports.chromium={launch:async options=>{
  const browser=await actual.chromium.launch(options),create=browser.newContext.bind(browser);
  browser.newContext=async options=>{
    const context=await create({...options,timezoneId:'Europe/Istanbul'}),newPage=context.newPage.bind(context),close=context.close.bind(context);
    let module,cdp,trace=[],traceBytes=0,traceLoss=false,traceComplete,profiled=false,stopped=false,closed=false;
    const traceDone=new Promise(resolve=>traceComplete=resolve);
    context.newPage=async()=>{
      const page=await newPage(),goto=page.goto.bind(page),wait=page.waitForFunction.bind(page);
      await page.addInitScript(()=>{
        window.__pr908Observation={preparation:[],lifecycle:[]};
        window.addEventListener('bl:module-preparation',e=>window.__pr908Observation.preparation.push({atMs:performance.now(),snapshot:JSON.parse(JSON.stringify(e.detail))}));
        for(const name of ['bl:primary-screen-ready','bl:startup-ready','bl:startup-complete'])window.addEventListener(name,()=>window.__pr908Observation.lifecycle.push({name,atMs:performance.now()}));
      });
      if(process.env.PR908_PROFILE==='1'){
        cdp=await context.newCDPSession(page);
        cdp.on('Tracing.dataCollected',({value})=>{
          traceBytes+=JSON.stringify(value).length;
          if(traceBytes>96*1024*1024)throw Error('Trace exceeds diagnostic 96 MiB admission');
          trace.push(...value);
        });
        cdp.on('Tracing.tracingComplete',value=>{traceLoss=!!value.dataLossOccurred;traceComplete();});
        page.goto=async(...args)=>{
          await cdp.send('Performance.enable');
          await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:1000});
          await cdp.send('Profiler.start');
          await cdp.send('Tracing.start',{categories:'devtools.timeline,v8.execute,toplevel,blink.user_timing',transferMode:'ReportEvents'});
          profiled=true;return goto(...args);
        };
        page.waitForFunction=async(...args)=>{
          const value=await wait(...args);
          if(String(args[0]).includes("['passed','failed'].includes(window.__benchmarkFirstTransition?.status)")){
            const [profile]=await Promise.all([cdp.send('Profiler.stop'),cdp.send('Tracing.end').then(()=>traceDone)]);
            stopped=true;
            module=await page.evaluate(()=>window.__benchmarkFirstTransition.module);
            fs.writeFileSync(path.join(out,module+'.cpuprofile.gz'),zlib.gzipSync(JSON.stringify(profile.profile)));
            fs.writeFileSync(path.join(out,module+'.trace.json.gz'),zlib.gzipSync(JSON.stringify({traceEvents:trace,traceLoss})));
            save(module+'-cdp-metrics.json',await cdp.send('Performance.getMetrics'));
            if(traceLoss)throw Error('Trace data loss; artifacts retained');
          }
          return value;
        };
      }
      return page;
    };
    context.close=async()=>{
      if(closed)return;closed=true;
      try{
        for(const page of context.pages()){
          const value=await page.evaluate(()=>{
            const module=window.__benchmarkFirstTransition.module,rows=state[module].rows;
            const table=document.getElementById(module+'Table'),row=table.querySelector('tbody tr[data-id]'),r=row.getBoundingClientRect();
            const hit=document.elementFromPoint((Math.max(0,r.left)+Math.min(innerWidth,r.right))/2,(Math.max(0,r.top)+Math.min(innerHeight,r.bottom))/2);
            return {module,snapshot:JSON.stringify(rows),keys:JSON.stringify(rows.map(r=>Object.keys(r))),
              cells:Array.from(table.querySelectorAll('tbody tr[data-id]')).map(r=>({id:r.dataset.id,cells:Array.from(r.querySelectorAll('td')).map(c=>({key:c.dataset.k||null,text:c.textContent}))})),
              header:Array.from(table.querySelectorAll('thead th[data-k]')).map(th=>({key:th.dataset.k,text:th.textContent.trim()})),
              unobscured:!!(hit&&(hit===row||row.contains(hit))),probe:window.__benchmarkFirstTransition,
              observedAtMs:performance.now(),observations:window.__pr908Observation,
              marks:performance.getEntriesByType('mark').map(e=>({name:e.name,startTime:e.startTime})),
              timeline:window.BLPerf?.timeline?.(),preparation:window.BLModulePreparation?.snapshot?.(),
              revisions:{orders:Number(state.storeRevisions.orders)||0,suppFob:Number(state.storeRevisions.suppFob)||0},
              rowCount:rows.length,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone};
          });
          module=value.module;
          fs.writeFileSync(path.join(out,module+'-rows.json.gz'),zlib.gzipSync(value.snapshot));
          value.rowsSha256=hash(value.snapshot);value.ownKeyOrderSha256=hash(value.keys);
          value.cellsSha256=hash(JSON.stringify(value.cells));value.schemaSha256=hash(JSON.stringify(value.header));
          delete value.snapshot;delete value.keys;
          save(module+'-observations.json',value);
          if(!value.unobscured)throw Error('Post-timing row obscured; evidence retained');
          if(profiled&&!stopped)throw Error('Profiler did not stop at native completion');
        }
      }finally{await cdp?.detach();await close();}
    };
    return context;
  };
  return browser;
}};
