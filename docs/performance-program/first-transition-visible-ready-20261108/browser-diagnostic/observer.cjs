'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const actual=require('/opt/codex/cua_node/lib/node_modules/playwright');
const sha=text=>crypto.createHash('sha256').update(text).digest('hex');
exports.chromium={launch:async options=>{
 const browser=await actual.chromium.launch(options),create=browser.newContext.bind(browser);
 browser.newContext=async options=>{
  const context=await create({...options,timezoneId:'Europe/Istanbul'}),close=context.close.bind(context);
  context.close=async()=>{
   try{
    const captures=[];
    for(const page of context.pages()){
     const value=await page.evaluate(()=>{
      const module=document.body.dataset.activeTab,rows=module==='cp'?state.cp.rows:state.orders.rows;
      const selector=module==='cp'?'#cpTable tbody tr[data-id]':'#ordersTable tbody tr[data-id]',row=document.querySelector(selector),rect=row?.getBoundingClientRect();
      const hit=rect?document.elementFromPoint((Math.max(0,rect.left)+Math.min(innerWidth,rect.right))/2,(Math.max(0,rect.top)+Math.min(innerHeight,rect.bottom))/2):null;
      return {module,rows:rows.length,snapshot:JSON.stringify(rows),cells:[...document.querySelectorAll(selector)].map(row=>({id:row.dataset.id,cells:[...row.querySelectorAll('td')].map(cell=>cell.textContent)})),
       unobscured:Boolean(hit&&(hit===row||row.contains(hit))),cover:hit?.className||null,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,localDay:new Date().toLocaleDateString('en-CA'),probe:window.__benchmarkFirstTransition};
     });
     const directory=path.dirname(process.env.FIRST_TRANSITION_EXTRA),rows=JSON.parse(value.snapshot),keys=[...new Set(rows.flatMap(row=>Object.keys(row)))];
     const fields={};for(const key of keys){const values=rows.map(row=>Object.hasOwn(row,key)?[true,row[key]]:[false]);fields[key]={sha256:sha(JSON.stringify(values)),samples:[0,1,2,100,rows.length-1].map(index=>({index,present:Object.hasOwn(rows[index],key),value:rows[index][key]}))};}
     fs.writeFileSync(path.join(directory,value.module+'-normalized-rows.json.gz'),zlib.gzipSync(Buffer.from(value.snapshot),{level:1}));
     fs.writeFileSync(path.join(directory,value.module+'-visible-cells.json'),JSON.stringify(value.cells,null,2)+'\n');
     captures.push({module:value.module,rows:value.rows,normalizedRowsSha256:sha(value.snapshot),ownKeyOrderSha256:sha(JSON.stringify(rows.map(row=>Object.keys(row)))),visibleCellsSha256:sha(JSON.stringify(value.cells)),visibleRows:value.cells.length,unobscured:value.unobscured,cover:value.cover,timezone:value.timezone,localDay:value.localDay,fields,probe:value.probe});
    }
    fs.writeFileSync(process.env.FIRST_TRANSITION_EXTRA,JSON.stringify([...(fs.existsSync(process.env.FIRST_TRANSITION_EXTRA)?JSON.parse(fs.readFileSync(process.env.FIRST_TRANSITION_EXTRA,'utf8')):[]),...captures],null,2)+'\n');
    if(captures.some(value=>!value.unobscured))throw Error('Post-timing screenshot/row is covered; capture preserved');
   }finally{await close();}
  };
  return context;
 };
 return browser;
}};
