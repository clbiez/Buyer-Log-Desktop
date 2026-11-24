'use strict';
// Gerçek Buyer Log, yalıtılmış demo veriyle. Playwright + Chromium gerekir; üretim verisi okunmaz.
// Doğrular: (1) ASAS yenilemesi merch hiyerarşisini kendiliğinden kurar, (2) CP sütun
// filtresi MAG kodunun altında MMYG adı + Marka Müdürlüğünü gösterir ve adla arar,
// (3) ASAS'ta ilişki değişince sonraki yenileme elle bakım olmadan günceller.
// Kullanım: node scripts/merch-hierarchy-ui-acceptance.js [--screenshot <png>]
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require('playwright');
const XLSX=require('xlsx');
const app=path.resolve(__dirname,'..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-merch-hierarchy-'));
const port=Number(process.env.BUYER_LOG_MERCH_PORT||6497),base=`http://127.0.0.1:${port}`;
const shotArg=process.argv.indexOf('--screenshot'),shotPath=shotArg>0?path.resolve(process.argv[shotArg+1]):'';
const env={...process.env,BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')};
for(const [key,dir] of Object.entries({BUYER_LOG_DATA_ROOT:'app',BUYER_LOG_SERVER_DATA_ROOT:'server',BUYER_LOG_LOCAL_DATA_ROOT:'local',BUYER_LOG_TEMP_ROOT:'temp'})){
  env[key]=path.join(root,dir);fs.mkdirSync(env[key],{recursive:true});
}
env.BUYER_LOG_AUTH_DATA_ROOT=env.BUYER_LOG_SERVER_DATA_ROOT;env.BL_DATA_DIR=env.BUYER_LOG_SERVER_DATA_ROOT;
const source=path.join(root,'source');fs.mkdirSync(source);
fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',sourceFolder:source,updates:{enabled:false}}));
const demo=require('./generate-demo-data').build({rows:40,seed:7,today:new Date('2026-11-03T00:00:00Z')});

// Demo ASAS'a anonim MMYG adı ve Marka Müdürlüğü sütunları eklenir (gerçek iş verisi yok).
const NAMES={KB:'ÖRNEK ERKEK ÇOCUK',KG:'ÖRNEK KIZ ÇOCUK',BB:'ÖRNEK ERKEK BEBEK',BG:'ÖRNEK KIZ BEBEK',WM:'ÖRNEK KADIN',MN:'ÖRNEK ERKEK'};
function writeAsas(moveFirstMag){
  const rows=demo.asas.map(row=>row.slice()),h=rows.findIndex(row=>row.includes('Sipariş Kod'));
  const header=rows[h],magI=header.indexOf('Merch Alt Grup Kod'),mmygI=header.indexOf('Merch Marka Yaş Grup Kod');
  header.push('Merch Marka Yaş Grup','Marka Müdürlükleri');
  const firstMag=rows[h+1][magI],parentOf=new Map();
  for(let r=h+1;r<rows.length;r++){
    const row=rows[r];if(!row||row[0]==null||row[0]==='')continue;
    // Rastgele demo bir MAG'i birden çok MMYG altına koyabiliyor; gerçek ASAS gibi tek üst verilir.
    if(!parentOf.has(row[magI]))parentOf.set(row[magI],row[mmygI]);row[mmygI]=parentOf.get(row[magI]);
    if(moveFirstMag&&row[magI]===firstMag)row[mmygI]='ZZ9';
    const mmyg=String(row[mmygI]||'');
    row.push(NAMES[mmyg]||(mmyg==='ZZ9'?'ÖRNEK YENİ GRUP':`ÖRNEK ${mmyg}`),mmyg==='ZZ9'?'ÖRNEK YENİ MARKA DİREKTÖRLÜĞÜ':`ÖRNEK ${mmyg.slice(0,1)} MARKA DİREKTÖRLÜĞÜ`);
  }
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'ASAS');XLSX.writeFile(wb,path.join(source,'ASAS - Demo.xlsx'));
  return firstMag;
}
const firstMag=writeAsas(false);
{const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(demo.antrepo),'Antrepo');XLSX.writeFile(wb,path.join(source,'Antrepo - Demo.xlsx'));}

const log=fs.openSync(path.join(root,'server.log'),'a');
const server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});
let browser,cookie;
async function api(url,body){
  const res=await fetch(base+url,{method:body?'POST':'GET',headers:{cookie:cookie||'','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  assert.ok(res.ok,await res.clone().text());return res;
}
async function refresh(){
  await api('/api/refresh',{});
  for(let i=0;i<200;i++){if(!(await (await api('/api/refresh-status')).json()).running)return;await new Promise(r=>setTimeout(r,250));}
  throw new Error('refresh timeout');
}
(async()=>{
  for(let i=0;i<120;i++){try{if((await fetch(base+'/api/auth-status')).ok)break;}catch(_){}await new Promise(r=>setTimeout(r,250));}
  const login=await api('/api/user-login',{userId:'moderator',newPassword:'demo-merch-123',password:'demo-merch-123'});
  cookie=login.headers.get('set-cookie').split(';')[0];
  await refresh();
  const h1=await (await api('/api/merch-hierarchy')).json();
  const magEntry=h1.mag[firstMag];
  assert.ok(magEntry&&magEntry.mmyg,'hiyerarşi yenilemede kendiliğinden kuruldu');
  assert.ok(h1.mmyg[magEntry.mmyg].name.startsWith('ÖRNEK'),'MMYG adı ASAS satırından');
  assert.match(h1.mmyg[magEntry.mmyg].directorate,/MARKA DİREKTÖRLÜĞÜ$/);
  console.log('hierarchy', Object.keys(h1.mag).length,'MAG /',Object.keys(h1.mmyg).length,'MMYG; örnek',firstMag,'→',magEntry.mmyg,h1.mmyg[magEntry.mmyg].name);

  browser=await chromium.launch();
  const context=await browser.newContext({viewport:{width:1280,height:820},deviceScaleFactor:shotPath?2:1});
  const split=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),domain:'127.0.0.1',path:'/',httpOnly:true}]);
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof window.switchTab==='function'&&window.BLMerchHierarchy,null,{timeout:60000});
  // Açılış karşılama katmanı kapatılır (kullanıcının "Buyer Log'a devam et" adımı).
  await page.waitForSelector('[data-boot-continue]',{state:'visible',timeout:60000}).then(el=>el.click()).catch(()=>{});
  await page.waitForFunction(()=>!document.querySelector('[data-boot-continue]')?.offsetParent,null,{timeout:20000}).catch(()=>{});
  // Sürüm notları penceresi açılışta gelirse kapatılır (sayfanın geri kalanını etkileşime kapatıyor).
  await page.waitForSelector('.blRnClose',{state:'visible',timeout:5000}).then(el=>el.click()).catch(()=>{});
  await page.waitForFunction(()=>!document.querySelector('.blRnClose')?.offsetParent,null,{timeout:10000}).catch(()=>{});
  await page.evaluate(()=>window.switchTab('cp'));
  await page.waitForFunction(()=>document.querySelectorAll('#view-cp tbody tr').length>0,null,{timeout:60000});
  const opened=await page.evaluate(()=>{
    const btn=document.querySelector('.thFilterBtn[data-fk="Merch Alt Grup Kod"]');
    if(btn){btn.scrollIntoView({block:'nearest',inline:'center'});btn.click();return 'click';}
    // Sütun varsayılan görünümde gizliyse aynı bileşen başlık düğmesinin yerine sekme düğmesine bağlanır.
    window.openHeaderFilter('cp','Merch Alt Grup Kod',document.querySelector('#view-cp .thFilterBtn')||document.body,window.renderCP);return 'direct';
  });
  await page.waitForSelector('.colFilterPanel .blMerchCtx',{timeout:15000});
  // Pencereli CP, tam satırlar yüklenince paneli yeniden açar (mevcut davranış); yeni panel
  // de bağlamı taşımalı. Panel kimliği sabitlenene kadar beklenir.
  await page.evaluate(()=>new Promise(resolve=>{let last=document.querySelector('.colFilterPanel'),stable=0;const t=setInterval(()=>{const now=document.querySelector('.colFilterPanel');stable=now===last?stable+1:0;last=now;if(stable>=8){clearInterval(t);resolve();}},150);}));
  await page.waitForSelector('.colFilterPanel .blMerchCtx',{timeout:15000});
  const items=await page.$$eval('.colFilterPanel .cfpItem.blMerchItem',els=>els.map(el=>({code:el.querySelector('.blMerchCode')?.textContent.trim(),ctx:el.querySelector('.blMerchCtx')?.textContent.trim(),value:el.querySelector('input').value})));
  assert.ok(items.length>0);
  const sample=items.find(item=>item.value===firstMag);
  assert.ok(sample&&sample.ctx.includes(h1.mmyg[magEntry.mmyg].name),'MAG altında MMYG adı görünür');
  assert.ok(/Md\.$/.test(sample.ctx),'müdürlük kısaltılmış görünür');
  // Adla arama: MMYG adını yazınca o gruba bağlı MAG'ler listede kalır, değer yine ham kod.
  await page.fill('.colFilterPanel:has(.blMerchItem) .cfpSearch',h1.mmyg[magEntry.mmyg].name.toLocaleLowerCase('tr-TR'));
  const visible=await page.$$eval('.colFilterPanel:has(.blMerchItem) .cfpItem',els=>els.filter(el=>el.style.display!=='none').map(el=>el.querySelector('input').value));
  const expected=Object.keys(h1.mag).filter(k=>h1.mag[k].mmyg===magEntry.mmyg);
  assert.ok(visible.length>0&&visible.every(v=>expected.includes(v)),`adla arama yalnız ${magEntry.mmyg} altındaki MAG'leri bırakır: ${visible}`);
  await page.fill('.colFilterPanel:has(.blMerchItem) .cfpSearch','');
  // L1 ölçüm: 500 öğelik MAG listesinde bağlam ekleme süresi (gerçek modül, gerçek CSS).
  const decorateMs=await page.evaluate(()=>{
    const H=window.BLMerchHierarchy;
    const list=document.createElement('div');list.className='cfpList';
    list.innerHTML=Array.from({length:500},(_,i)=>`<label class="cfpItem" data-txt="m${i}"><input type="checkbox" value="M${i}"> M${i}</label>`).join('');
    document.body.appendChild(list);
    const samples=[];for(let r=0;r<5;r++){list.querySelectorAll('.blMerchCtx').forEach(e=>e.remove());const t=performance.now();H.decorate(list,'mag');list.getBoundingClientRect();samples.push(+(performance.now()-t).toFixed(2));}
    list.remove();return samples;
  });
  console.log('decorate-500-items-ms',JSON.stringify(decorateMs));
  if(shotPath){
    const panel=await page.$('.colFilterPanel');const box=await panel.boundingBox();
    // Panel ve arkasındaki gerçek CP tablosu birlikte (en-boy 1.2–3.2, ≥900×360).
    const width=Math.min(1280,Math.max(900,box.width+560)),x=Math.max(0,Math.min(box.x-280,1280-width));
    const y=Math.max(0,box.y-120),height=Math.min(820-y,Math.max(420,box.height+170));
    await page.screenshot({path:shotPath,clip:{x,y,width,height}});
    console.log('screenshot',shotPath,`${width*2}x${height*2}`,opened);
  }
  // Kendiliğinden güncellenme: ASAS'ta ilk MAG başka bir MMYG'ye taşınır, yeniden yenilenir.
  writeAsas(true);await refresh();
  const h2=await (await api('/api/merch-hierarchy')).json();
  assert.equal(h2.mag[firstMag].mmyg,'ZZ9','yenileme ilişkiyi elle bakım olmadan güncelledi');
  assert.equal(h2.mmyg.ZZ9.name,'ÖRNEK YENİ GRUP');
  assert.deepEqual(errors,[],'sayfa hatası yok');
  console.log('PASS merch hierarchy UI acceptance');
})().catch(err=>{console.error(err);console.error(fs.readFileSync(path.join(root,'server.log'),'utf8').slice(-3000));process.exitCode=1;})
  .finally(async()=>{try{await browser?.close();}catch(_){}server.kill();setTimeout(()=>fs.rmSync(root,{recursive:true,force:true}),500);});
