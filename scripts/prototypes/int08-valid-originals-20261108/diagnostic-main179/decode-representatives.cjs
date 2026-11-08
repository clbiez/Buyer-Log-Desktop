'use strict';
// Native Chromium decoder comparison, separate from the CP/Orders workload.
// No product endpoint, thumbnail cache, canvas, renderer patch or mock table.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const arg=name=>{const i=process.argv.indexOf(name);assert(i>=0,name);return process.argv[i+1];};
const {chromium}=require(path.resolve(arg('--playwright-module')));
const stage=path.resolve(arg('--stage-root')),quality=path.resolve(arg('--quality-root'));
const output=path.resolve(arg('--output-dir'));fs.mkdirSync(output,{recursive:false});
const temp=path.join(output,'tmp');fs.mkdirSync(temp);const fd=fs.openSync(temp,'r');
process.env.TMPDIR='/proc/'+process.pid+'/fd/'+fd;
const derivatives=JSON.parse(fs.readFileSync(path.join(quality,'representative-derivatives.json')));
const originals=JSON.parse(fs.readFileSync(path.join(stage,'fixture-manifest.json'))).images;
let browser;
(async()=>{
  browser=await chromium.launch({headless:true,executablePath:path.resolve(arg('--chromium')),args:['--no-sandbox']});
  const results=[];
  // Each original/edge gets a fresh context and unique data URL; no warmed
  // decode cache or application code participates in this microdiagnostic.
  for(const index of [...new Set(derivatives.images.map(x=>x.originalIndex))]){
    const original=originals.find(x=>x.index===index);
    const cases=[{file:path.join(stage,'originals',original.file),edge:'original',mime:original.mime},
      ...derivatives.images.filter(x=>x.originalIndex===index).map(x=>({...x,file:path.join(quality,x.file)}))];
    for(const sample of cases){
      const context=await browser.newContext(),page=await context.newPage();
      await context.route('**/*',route=>['data:','about:','blob:'].includes(new URL(route.request().url()).protocol)?route.continue():route.abort());
      const cdp=await context.newCDPSession(page);
      const raw=fs.readFileSync(sample.file),url='data:'+sample.mime+';base64,'+raw.toString('base64');
      const value=await page.evaluate(async url=>{
        const image=new Image();image.decoding='async';
        const start=performance.now();image.src=url;await image.decode();
        return {decodePromiseElapsedMs:performance.now()-start,width:image.naturalWidth,height:image.naturalHeight};
      },url);
      results.push({originalIndex:index,edge:sample.edge,encodedBytes:raw.length,...value,
        heapUsage:await cdp.send('Runtime.getHeapUsage')});
      await context.close();
    }
  }
  fs.writeFileSync(path.join(output,'native-decode.json'),JSON.stringify({scope:'six representative native Image.decode microdiagnostic; one observation per case, not paired CP/Orders speed or thread CPU',chromium:browser.version(),results},null,2)+'\n');
})().catch(error=>{fs.writeFileSync(path.join(output,'error.json'),JSON.stringify({message:error.message,stack:error.stack}));process.exitCode=1;})
.finally(async()=>{await browser?.close();});
