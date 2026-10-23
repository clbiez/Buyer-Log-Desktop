/* Buyer Log FX v1.0 — uygulama geneli döviz kuru modülü.
   Model: { base:'USD', currencies:[...], months:{ 'YYYY-MM': { TRY:41.32, EUR:0.85, ... } },
            updatedAt, sourceFile }
   DEĞER YÖNÜ: 1 <base> = X <döviz>  (Kur Tahmin Raporu Excel'i ile aynı yön).
   Her sayfa (Ön Maliyet, CP, Nakliye...) window.BLFX üzerinden kur çekebilir. */
(function(){
'use strict';
const FAVORITES=['TRY','EUR','GBP','CNY','EGP','RON','UAH','GEL','INR','CHF','JPY','USD'];
const store={base:'USD',currencies:[],months:{},updatedAt:null,sourceFile:null,sourceType:null,sourceModifiedAt:null,_revision:0};
const FX_LOCAL_KEY='buyerlog.fx.persist.v1';
const FX_PENDING_KEY='buyerlog.fx.pending.v1';
let loadedPromise=null;

function monthKey(d){const dt=d?new Date(d):new Date();if(isNaN(dt))return monthKey(null);return dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0');}
function monthLabel(mk,en){
  if(!mk)return '—';
  const [y,m]=String(mk).split('-');const idx=parseInt(m,10)-1;
  const tr=['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'];
  const enN=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return ((en?enN:tr)[idx]||m)+' '+y;
}
// Bir ay için kur haritası: tam ay yoksa en yakın ÖNCEKİ ay, hiç yoksa ilk ay.
function resolveMonth(mk,src){return window.BLFxCalculationEngine.resolveMonth(mk,src||store);}
// Belirli bir yıl/ay için anlık kur görüntüsü. Ay bulunamazsa en yakın önceki ayı kullanır.
function snapshotForMonth(mk,currency){
  const requested=/^\d{4}-\d{2}$/.test(String(mk||''))?String(mk):monthKey(null);
  const r=resolveMonth(requested);
  return {base:store.base||'USD',dir:'per_base',month:r.month,requestedMonth:requested,exact:r.exact,
          rates:r.rates||{},currency:currency||null,capturedAt:new Date().toISOString()};
}
// Bir tarih (örn. costing createdAt) için anlık kur görüntüsü.
function snapshotFor(date,currency){return snapshotForMonth(monthKey(date),currency);}
// value: from → to. snap yoksa canlı tablo + bugünün ayı kullanılır.
// dir 'per_base' (yeni): rate = 1 base kaç döviz → unit(cur)=1/rate
// dir yoksa (eski v2.02 anlık görüntüleri): rate = 1 döviz kaç base → unit(cur)=rate
function convert(value,from,to,snap){return window.BLFxCalculationEngine.convert(value,from,to,snap||snapshotFor(null),store);}
// Bugün için "1 USD = 41,32 TRY" metni; kur yoksa null.
function rateText(currency,snap){
  const s=snap||snapshotFor(null);const base=s.base||'USD';
  if(currency===base)return null;
  const v=convert(1,base,currency,s);
  if(v==null)return null;
  const digits=v>=20?2:4;
  return '1 '+base+' = '+v.toFixed(digits).replace('.',',')+' '+currency;
}
function allCurrencies(){
  const all=new Set([store.base||'USD',...(store.currencies||[])]);
  Object.values(store.months||{}).forEach(rates=>Object.keys(rates||{}).forEach(code=>all.add(String(code||'').trim().toUpperCase())));
  return [...all].filter(Boolean);
}
function displayCurrencies(){
  const all=new Set(allCurrencies());
  const fav=FAVORITES.filter(c=>all.has(c));
  const rest=[...all].filter(c=>!fav.includes(c)).sort((a,b)=>a.localeCompare(b,'en'));
  return [...new Set([...fav,...rest])];
}
function fxLocalRead(){try{return JSON.parse(BLStorage.getItem(FX_LOCAL_KEY)||'null');}catch(e){return null;}}
function fxLocalWrite(data){try{BLStorage.setItem(FX_LOCAL_KEY,JSON.stringify(data));}catch(e){}}
function fxPendingRead(){try{return JSON.parse(BLStorage.getItem(FX_PENDING_KEY)||'null');}catch(e){return null;}}
function fxPendingWrite(data){try{BLStorage.setItem(FX_PENDING_KEY,JSON.stringify(data));}catch(e){}}
function fxPendingClear(){try{BLStorage.removeItem(FX_PENDING_KEY);}catch(e){}}
function fxStamp(data){const t=Date.parse(data&&data.updatedAt||'');return Number.isFinite(t)?t:0;}
function serverHasValues(data){return Boolean(data&&Object.values(data.months||{}).some(rates=>rates&&Object.keys(rates).length));}
function fxShape(data){return {base:data&&data.base||'USD',currencies:Array.isArray(data&&data.currencies)?data.currencies:[],months:data&&data.months&&typeof data.months==='object'?data.months:{},updatedAt:data&&data.updatedAt||null,sourceFile:data&&data.sourceFile||null,sourceType:data&&data.sourceType||null,sourceModifiedAt:data&&data.sourceModifiedAt||null,_revision:Number(data&&data._revision)||0};}
async function requestSave(data,expectedRevision){
  let res;
  try{res=await fetch('/api/fx',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':String(expectedRevision||0),...(window.BL_CLIENT_ID?{'X-Client-Id':window.BL_CLIENT_ID}:{})},body:JSON.stringify(data)});}
  catch(error){error.network=true;throw error;}
  const out=await res.json().catch(()=>({}));
  if(!res.ok){const error=new Error(out.error||res.statusText);error.code=out.code||'';error.network=false;throw error;}
  return fxShape(out);
}
async function replayPending(){
  const pending=fxPendingRead();
  if(!pending||!pending.data)return false;
  try{
    const synced=await requestSave(pending.data,pending.expectedRevision);
    fxPendingClear();Object.assign(store,synced);fxLocalWrite(store);return true;
  }catch(error){
    // Revision conflict is intentionally retained: a reconnect must never silently
    // overwrite another user's intervening shared-master update.
    if(!error.network)window.dispatchEvent(new CustomEvent('bl-fx-sync-conflict',{detail:{error,pending}}));
    return false;
  }
}
async function load(force){
  if(loadedPromise&&!force)return loadedPromise;
  loadedPromise=fetch('/api/fx',{cache:'no-store'}).then(r=>r.json()).then(async serverData=>{
    const local=fxLocalRead(),server=fxShape(serverData);
    const pending=fxPendingRead();
    // Browser kaydı yalnız ilk, boş ortak store için migration adayıdır. Dolu
    // shared veri hiçbir zaman cihazdaki eski localStorage kopyasıyla ezilmez.
    const useLocal=!!(local&&!serverHasValues(server)&&serverHasValues(local));
    const chosen=useLocal?fxShape(local):server;
    Object.assign(store,pending&&pending.data?fxShape(pending.data):chosen);fxLocalWrite(store);
    if(useLocal){try{const syncRes=await fetch('/api/fx',{method:'PUT',headers:{'Content-Type':'application/json','If-Match':String(server._revision||0),...(window.BL_CLIENT_ID?{'X-Client-Id':window.BL_CLIENT_ID}:{})},body:JSON.stringify(chosen)});if(syncRes.ok){const synced=await syncRes.json();Object.assign(store,fxShape(synced));fxLocalWrite(store);}}catch(e){}}
    if(pending)await replayPending();
    return store;
  }).catch(()=>{const local=fxLocalRead();if(local)Object.assign(store,fxShape(local));return store;});
  return loadedPromise;
}
async function save(data){
  const expectedRevision=Number(store._revision)||0;
  const shaped=fxShape({...data,_revision:expectedRevision,updatedAt:data.updatedAt||new Date().toISOString()});
  fxLocalWrite(shaped);Object.assign(store,shaped);
  try{
    const out=await requestSave(shaped,expectedRevision);
    Object.assign(store,out);fxLocalWrite(store);return store;
  }catch(error){
    if(!error.network)throw error;
    fxPendingWrite({data:shaped,expectedRevision});
    return store;
  }
}
window.addEventListener('online',()=>{load(true).catch(()=>{});});

/* ---- Kur Tahmin Raporu Excel içe aktarma ----
   Dosya adı ve sayfa adındaki ay bilgisi bilinçli olarak dikkate alınmaz.
   Her sayfada bulunan B sütunu döviz kodları ile TÜM tarih sütunları okunur.
   Aynı yıl/ay+döviz birden fazla sayfada varsa çalışma kitabındaki son geçerli
   değer kullanılır. Böylece rapordaki tüm geçmiş ve gelecek aylar belleğe alınır. */
// Excel hücresindeki sayı: 49,35 / 1.234,56 / 1,234.56 biçimlerini kabul eder.
function cellNum(v){
  if(typeof v==='number')return Number.isFinite(v)?v:null;
  const t=String(v??'').trim().replace(/\s+/g,'');if(!t)return null;
  let n=t;
  if(t.includes(',')&&t.includes('.'))n=t.lastIndexOf(',')>t.lastIndexOf('.')?t.replace(/\./g,'').replace(',','.'):t.replace(/,/g,'');
  else if(t.includes(','))n=t.replace(',','.');
  const out=Number(n);return Number.isFinite(out)?out:null;
}
// Başlık hücresi tarih değilse metin ay/tarih kalıpları (2026-10, 31.10.2026, 10.2026) denenir.
function cellDate(x){
  if(!x)return null;
  if(x.t==='d'&&x.v instanceof Date)return isNaN(x.v)?null:x.v;
  if(x.t==='n'&&x.v>25000&&x.v<80000){const p=XLSX.SSF&&XLSX.SSF.parse_date_code?XLSX.SSF.parse_date_code(x.v):null;return p?new Date(p.y,p.m-1,p.d||1):null;}
  if(x.t!=='s')return null;
  const t=String(x.v||'').trim();let m=t.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?$/);
  if(m)return new Date(+m[1],+m[2]-1,+(m[3]||1));
  m=t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);if(m)return new Date(+m[3],+m[2]-1,+m[1]);
  m=t.match(/^(\d{1,2})[-/.](\d{4})$/);if(m)return new Date(+m[2],+m[1]-1,1);
  return null;
}
function parseSheet(ws){
  if(!ws||!ws['!ref'])return null;
  const range=XLSX.utils.decode_range(ws['!ref']);
  const cell=(r,c)=>ws[XLSX.utils.encode_cell({r,c})];
  // Tarih başlık satırını bul (en az 1 tarih hücresi yeterlidir). Sunucu
  // okuyucusu (server/lib/fxWorkbook.js) ile aynı 20 satırlık pencere.
  let headRow=-1;const monthCols=[]; // [{col, mk}]
  for(let r=range.s.r;r<=Math.min(range.e.r,range.s.r+20);r++){
    const found=[];
    for(let c=Math.max(range.s.c+2,2);c<=range.e.c;c++){
      const d=cellDate(cell(r,c));
      if(d&&!isNaN(d))found.push({col:c,mk:monthKey(d)});
    }
    if(found.length>=1){headRow=r;monthCols.push(...found);break;}
  }
  if(headRow<0)return null;
  // Aynı ay birden fazla sütuna denk gelirse ilkini tut
  const seen=new Set();const cols=monthCols.filter(m=>{if(seen.has(m.mk))return false;seen.add(m.mk);return true;});
  const rows=[]; // {code, values:{mk:num}}
  for(let r=headRow+1;r<=range.e.r;r++){
    // Döviz kodu KUR şablonunda B sütunundadır; B boşsa A ve C de denenir.
    let code='';
    for(const c of [1,0,2]){const x=cell(r,c);const v=String(x&&x.v!=null?x.v:'').trim().toUpperCase();if(/^[A-Z]{3,4}$/.test(v)){code=v;break;}}
    if(!code)continue;
    const values={};let any=false;
    cols.forEach(({col,mk})=>{const x=cell(r,col);const v=x?cellNum(x.v!=null?x.v:x.w):null;if(v!=null&&v>0){values[mk]=v;any=true;}});
    if(any)rows.push({code,values});
  }
  if(!rows.length)return null;
  return {reportMonth:cols[0].mk,monthKeys:cols.map(c=>c.mk),rows};
}
// workbook → yeni store önerisi. mevcut store üzerine birleştirir.
function importWorkbook(wb,fileName){
  const sheets=[];
  wb.SheetNames.forEach(name=>{const p=parseSheet(wb.Sheets[name]);if(p)sheets.push({name,...p});});
  if(!sheets.length)throw new Error('Excel içinde kur tablosu bulunamadı. Döviz kodu ve en az bir tarih sütunu bekleniyor.');
  const months=JSON.parse(JSON.stringify(store.months||{}));
  const currencies=new Set(store.currencies||[]);
  let valueCount=0;
  // Sayfa adları veya rapor ayı yerine, her sayfanın tüm tarih hücrelerini birleştir.
  sheets.forEach(sh=>{
    sh.rows.forEach(row=>{
      Object.entries(row.values).forEach(([mk,v])=>{
        if(v==null||v<=0)return;
        if(!months[mk])months[mk]={};
        months[mk][row.code]=v;currencies.add(row.code);valueCount++;
      });
    });
  });
  const mkList=Object.keys(months).filter(m=>months[m]&&Object.keys(months[m]).length).sort();
  return {
    data:{base:'USD',currencies:[...currencies],months,updatedAt:new Date().toISOString(),sourceFile:fileName||null},
    stats:{sheetCount:sheets.length,latestSheet:sheets[sheets.length-1].name,
           currencyCount:currencies.size,monthCount:mkList.length,valueCount,
           firstMonth:mkList[0]||null,lastMonth:mkList[mkList.length-1]||null}
  };
}

async function importFile(file){
  // XLSX perf-runtime ile tembel yüklenir; oturumda başka Excel akışı açılmamış
  // olabilir. Kütüphane yüklenmeden okumak "XLSX is not defined" ile düşüyordu.
  if(typeof XLSX==='undefined'&&window.BLPerf&&typeof window.BLPerf.ensureLibrary==='function')await window.BLPerf.ensureLibrary('xlsx');
  if(typeof XLSX==='undefined')throw new Error(typeof appLang!=='undefined'&&appLang==='en'?'Excel library could not be loaded.':'Excel kütüphanesi yüklenemedi.');
  const buf=await file.arrayBuffer();
  const wb=XLSX.read(buf,{type:'array',cellDates:true});
  return importWorkbook(wb,file.name);
}

window.BLFX={store,load,save,monthKey,monthLabel,resolveMonth,snapshotFor,snapshotForMonth,convert,rateText,
             displayCurrencies,allCurrencies,importFile,importWorkbook,FAVORITES};
})();
