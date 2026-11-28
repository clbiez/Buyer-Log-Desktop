// Sürüm notu ekran görüntüsü: gerçek Buyer Log, demo veri, CP'de üretim bakiyesi + depoda parsiyelli satır.
const L=require('./lib.js'),U=require('./ui.js');const [APP,SRC,OUT,Q]=process.argv.slice(2);
(async()=>{const app=await L.createApp({APP,source:SRC,env:{},label:'shot'});let b;
 try{await L.boot(app);b=await L.newBrowser(app);const page=await U.openCp(app,b.context);
  await page.setViewportSize({width:1600,height:900});
  await page.fill('#cpSearch',Q);await page.press('#cpSearch','Enter');await L.delay(2500);
  await page.waitForSelector('#cpTable tbody tr[data-id] .cpLogisticToggle',{timeout:60000});
  await page.click('#cpTable tbody tr[data-id] .cpLogisticToggle');await L.delay(1500);await U.clearOverlays(page);
  await page.evaluate(()=>{const ths=[...document.querySelectorAll('#cpTable thead th')];const th=ths.find(t=>/DURUM|STATUS/i.test(t.innerText.trim())&&!/YÜKLEME/i.test(t.innerText));
    let el=th&&th.parentElement;while(el&&!(el.scrollWidth>el.clientWidth+10&&/(auto|scroll)/.test(getComputedStyle(el).overflowX)))el=el.parentElement;
    if(el&&th){el.scrollLeft=Math.max(0,th.offsetLeft-420);}});await L.delay(1200);
  const heads=await page.evaluate(()=>[...document.querySelectorAll('#cpTable thead tr:last-child th')].filter(t=>{const r=t.getBoundingClientRect();return r.right>220&&r.left<1600;}).map(t=>t.innerText.trim().split('\n')[0]));console.log(JSON.stringify(heads));
  const box=await page.evaluate(()=>{const t=document.querySelector('#cpTable');const r=t.closest('.tableWrap,.tblWrap,section,main')||t;const a=r.getBoundingClientRect();return {x:Math.max(0,a.x),y:Math.max(0,a.y),w:a.width,h:a.height};});
  const info=await page.evaluate(()=>{const tr=document.querySelector('#cpTable tbody tr[data-id]');return {row:tr&&tr.innerText.slice(0,300),detail:(document.querySelector('.cpLogisticDetailRow')||{}).innerText};});
  console.log(JSON.stringify(info));
  await page.screenshot({path:OUT,clip:{x:0,y:Math.max(0,box.y-60),width:1600,height:Math.min(560,900-Math.max(0,box.y-60))}});
 }catch(e){console.error(e);}finally{if(b)await b.browser.close();await app.stop();}})();
