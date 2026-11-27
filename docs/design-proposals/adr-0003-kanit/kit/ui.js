'use strict';
const L=require('./lib.js');
async function openCp(app,context){
  const page=await context.newPage();
  await page.goto(app.base+'/?module=cp',{waitUntil:'domcontentloaded',timeout:180000});
  await page.waitForFunction(()=>window.BLBootGuard!=null,null,{timeout:180000}).catch(()=>{});
  await page.evaluate(()=>{try{window.BLBootGuard?.continue?.({intentAtMs:performance.now()});}catch(_){}}).catch(()=>{});
  await L.waitRows(page,'cp');
  await page.waitForFunction(()=>typeof state!=='undefined'&&state.cp&&Array.isArray(state.cp.rows)&&state.cp.rows.length>0&&![...document.querySelectorAll('.uiState--loading')].some(e=>e.getBoundingClientRect().width>0)&&typeof cpRMWindowedActive==='function'&&cpRMWindowedActive()&&!(typeof isAreaFrozen==='function'&&isAreaFrozen('cp')),null,{timeout:300000,polling:250});
  await L.delay(3000);await clearOverlays(page);return page;}
async function clearOverlays(page){
  for(let i=0;i<20;i++){
    const n=await page.evaluate(()=>{let n=0;try{window.BLBootGuard?.continue?.({intentAtMs:performance.now()});}catch(_){}
      for(const d of document.querySelectorAll('dialog[open].blRnDialog')){try{d.close();}catch(_){d.removeAttribute('open');}n++;}
      const g=document.getElementById('blBootGuard');if(g){const r=g.getBoundingClientRect(),cs=getComputedStyle(g);if(cs.display!=='none'&&r.width>0){g.style.display='none';n++;}}
      return n;});
    if(!n&&i>2)break;await L.delay(400);}
}
module.exports={openCp,clearOverlays};
