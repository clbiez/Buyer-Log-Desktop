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
function fxShape(data){return {base:data&&data.base||'USD',currencies:Array.isArray(data&&data.currencies)?data.currencies:[],months:data&&data.months&&typeof data.months==='object'?data.months:{},updatedAt:data&&data.updatedAt||null,sourceFile:data&&data.sourceFile||null,sourceType:data&&data.sourceType||null,sourceModifiedAt:data&&data.sourceModifiedAt||null,reportMonth:data&&data.reportMonth||null,sourceFingerprint:data&&data.sourceFingerprint||null,parser:data&&data.parser||null,folderSync:data&&data.folderSync||null,_revision:Number(data&&data._revision)||0};}
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
async function save(data,options={}){
  const expectedRevision=options.expectedRevision??(Number(store._revision)||0);
  const shaped=fxShape({...data,_revision:expectedRevision,updatedAt:data.updatedAt||new Date().toISOString()});
  try{
    const out=await requestSave(shaped,expectedRevision);
    Object.assign(store,out);fxLocalWrite(store);return store;
  }catch(error){
    if(!error.network)throw error;
    fxLocalWrite(shaped);Object.assign(store,shaped);
    fxPendingWrite({data:shaped,expectedRevision});
    return store;
  }
}
window.addEventListener('online',()=>{load(true).catch(()=>{});});

/* ---- Kur Tahmin Raporu Excel içe aktarma ----
   Dosya adı ve sayfa adındaki ay bilgisi bilinçli olarak dikkate alınmaz.
   Her sayfada bulunan B sütunu döviz kodları ile TÜM tarih sütunları okunur.
   Ay/döviz çakışmaları ortak motor tarafından doğrulanır; geçersiz rapor
   kaydedilmez. Kapsanmayan geçmiş aylar birleştirme sırasında korunur. */
function sheetToGrid(ws,sheetName){
  const engine=window.BLFxImportEngine;if(!ws||!ws['!ref'])return {sheetName,rows:[]};
  const range=XLSX.utils.decode_range(ws['!ref']);
  if((range.e.r+1)*(range.e.c+1)>engine.MAX_GRID_CELLS)throw new Error(L('Kur tablosu çok büyük.','FX table is too large.'));
  const rows=Array.from({length:range.e.r+1},(_,r)=>Array.from({length:range.e.c+1},(_,c)=>{
    const cell=ws[XLSX.utils.encode_cell({r,c})],value=cell&&(cell.v!=null?cell.v:cell.w);
    if(value instanceof Date)return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
    return typeof value==='number'||typeof value==='string'?value:null;
  }));return {sheetName,rows,startRow:range.s.r,startColumn:range.s.c};
}
function parseSheet(ws,sheetName='Sheet1'){
  const grid=sheetToGrid(ws,sheetName),layout=window.BLFxImportEngine.detectLayout(grid);
  return layout?window.BLFxImportEngine.extractWithLayout(grid,layout):null;
}
function importResult(parsed,fileName,metadata={},current=store){
  const engine=window.BLFxImportEngine,validation=engine.validateFxImport(parsed,current);
  const months=engine.mergeMonths(current.months,parsed.months);
  return {data:{base:'USD',currencies:[...new Set(Object.values(months).flatMap(Object.keys))].sort(),months,updatedAt:new Date().toISOString(),sourceFile:fileName||null,sourceType:'UPLOAD',parser:'deterministic',reportMonth:parsed.reportMonth,...metadata},stats:parsed.stats,parsed,validation,revision:current._revision};
}
function importWorkbook(wb,fileName){
  const engine=window.BLFxImportEngine,grids=wb.SheetNames.map(name=>sheetToGrid(wb.Sheets[name],name));
  const parts=grids.flatMap(grid=>{const layout=engine.detectLayout(grid);return layout?[engine.extractWithLayout(grid,layout)]:[];});
  const result=importResult(engine.combineParsed(parts),fileName);
  if(!parts.length||result.validation.errors.length){
    const error=new Error(L('Excel içinde geçerli kur tablosu bulunamadı. LCW AI ile düzeni okuyabilirsiniz.','No valid FX table was found. You can read the layout with LCW AI.'));
    error.fxRecovery={grids,fileName,validation:result.validation};throw error;
  }
  return result;
}
async function importFile(file){
  if(typeof XLSX==='undefined'&&window.BLPerf&&typeof window.BLPerf.ensureLibrary==='function')await window.BLPerf.ensureLibrary('xlsx');
  if(typeof XLSX==='undefined')throw new Error(L('Excel kütüphanesi yüklenemedi.','Excel library could not be loaded.'));
  window.BLExcelDates?.installSheetJsHooks(XLSX);
  const buf=await file.arrayBuffer(),wb=XLSX.read(buf,{type:'array',cellDates:true});
  const sourceFingerprint=[...new Uint8Array(await crypto.subtle.digest('SHA-256',buf))].map(b=>b.toString(16).padStart(2,'0')).join('');
  const metadata={sourceFingerprint,sourceModifiedAt:file.lastModified?new Date(file.lastModified).toISOString():null};
  try{const parsed=importWorkbook(wb,file.name);Object.assign(parsed.data,metadata);return parsed;}
  catch(error){if(error.fxRecovery)Object.assign(error.fxRecovery,metadata);throw error;}
}

const L=(tr,en)=>typeof appLang!=='undefined'&&appLang==='en'?en:tr;
function confirmOlderReport(data){
  return !store.reportMonth||!data.reportMonth||data.reportMonth>=store.reportMonth||window.confirm(L(
    `Bu dosya mevcut kurlardan daha eski bir rapor (${monthLabel(data.reportMonth)} < ${monthLabel(store.reportMonth)}). Yine de uygula?`,
    `This file is an older report than the current rates (${monthLabel(data.reportMonth,true)} < ${monthLabel(store.reportMonth,true)}). Apply anyway?`));
}
function folderSyncText(){
  const sync=store.folderSync;if(!sync)return '';
  const file=sync.file||'KUR.xlsx',month=sync.reportMonth?` (${monthLabel(sync.reportMonth,typeof appLang!=='undefined'&&appLang==='en')})`:'';
  if(sync.reason==='older-report')return L(`Klasördeki ${file}${month} mevcut kurlardan eski; uygulanmadı.`,`Folder ${file}${month} is older than the current rates; not applied.`);
  if(sync.reason==='current-newer')return L(`Mevcut kurlar klasördeki ${file}${month} dosyasından daha yeni; uygulanmadı.`,`Current rates are newer than folder ${file}${month}; not applied.`);
  if(sync.reason==='parse-failed')return L(`Klasördeki ${file} okunamadı; mevcut kurlar korundu.`,`Folder ${file} could not be read; current rates were preserved.`);
  return '';
}
async function applySourceKur(){
  const sync=store.folderSync;if(!sync?.fingerprint)return false;
  if(!window.confirm(L('Klasördeki dosya mevcut kurların üzerine uygulanacak. Onaylıyor musunuz?','The folder file will replace covered current rates. Apply?')))return false;
  const res=await fetch('/api/fx/apply-source-kur',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fingerprint:sync.fingerprint,expectedRevision:store._revision})});
  if(!res.ok)throw new Error(L('Dosya veya kurlar değişti. Yenileyip tekrar deneyin.','The file or rates changed. Refresh and try again.'));
  await load(true);return true;
}
function renderFolderSync(host){
  if(!host)return;host.replaceChildren();const text=folderSyncText();host.hidden=!text;if(!text)return;
  const label=document.createElement('span');label.textContent=text;host.append(label);
  if(store.folderSync.reason==='parse-failed'){
    const button=document.createElement('button');button.type='button';button.className='btn';button.textContent=L('LCW AI ile oku','Read with LCW AI');
    button.onclick=()=>openFolderRecovery().catch(error=>window.showToast?.(error.message));host.append(' ',button);
  }
  if(['older-report','current-newer'].includes(store.folderSync.reason)){
    const button=document.createElement('button');button.type='button';button.className='btn';button.textContent=L('Yine de uygula','Apply anyway');
    button.onclick=async()=>{try{await applySourceKur();renderFolderSync(host);}catch(error){window.showToast?.(error.message);}};host.append(' ',button);
  }
}
const html=value=>String(value==null?'':value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let recoverySession=null;
function issueText(item){return [L(item.tr,item.en),item.currency,item.month,item.address].filter(Boolean).join(' · ');}
async function readWithAiLayout(recovery,signal){
  if(!window.BuyerLogAI)await window.BLPerf?.ensureFeature('fxAi');
  if(!window.BuyerLogAI)throw new Error(L('LCW AI istemcisi yüklenemedi.','LCW AI client could not be loaded.'));
  const status=await window.BuyerLogAI.getStatus({refresh:false});
  if(!status?.connected){window.BuyerLogAI.openConnectionDialog();return null;}
  await load(true);
  const current=JSON.parse(JSON.stringify(store)),engine=window.BLFxImportEngine;
  const sheetPreviews=engine.previewGrids(recovery.grids).map(sheet=>({sheetName:sheet.sheetName,totalRows:sheet.totalRows,totalColumns:sheet.totalColumns,
    previewLines:sheet.cells.map(row=>row.map(cell=>cell.address+'='+cell.value).join(' | '))}));
  const result=await window.BuyerLogAI.ask({source:'fx-kur-layout',signal,task:L(
    'Yalnız KUR tablosunun düzenini tarif et. Kur sayısı üretme. Yönü ve kotasyon ölçeğini başlıktan belirle.',
    'Describe only the KUR table layout. Never generate rate values. Identify direction and quote scale from the heading.'),context:{sheetPreviews}});
  if(!result.structured?.ok||!result.data)throw new Error(L('LCW AI geçerli bir tablo düzeni döndürmedi.','LCW AI did not return a valid table layout.'));
  let layout,parsed;
  try{
    layout=engine.normalizeLayout(result.data);
    const grid=recovery.grids.find(item=>item.sheetName===layout.sheetName);
    // No model-provided rate values reach extraction: only the original normalized grid.
    parsed=engine.extractWithLayout(grid,layout);
  }catch(_){throw new Error(L('Önerilen tablo düzeni veya hücre aralığı geçersiz. LCW AI ile yeniden okuyun.','The proposed table layout or cell range is invalid. Read again with LCW AI.'));}
  const proposed=importResult(parsed,recovery.fileName,{sourceType:'LCWAI',parser:'lcwai-layout',reportMonth:parsed.reportMonth,
    sourceFingerprint:recovery.sourceFingerprint,sourceModifiedAt:recovery.sourceModifiedAt},current);
  return {...proposed,layout,revision:current._revision,differences:engine.diffCells(parsed,current)};
}
function closeImportRecovery(){
  const session=recoverySession;if(!session)return;
  session.controller?.abort();session.host.remove();document.removeEventListener('keydown',session.onKey);document.removeEventListener('bl:language-changed',session.onLanguage);
  recoverySession=null;session.focus?.focus?.();
}
function renderRecovery(){
  const session=recoverySession;if(!session)return;
  const result=session.result,validation=result?.validation||session.recovery.validation||{errors:[],warnings:[]};
  let content=`<p class="ocFxHint">${html(L('Kurallı okuma tamamlanamadı. LCW AI yalnız düzeni belirler; kurlar dosyadaki hücrelerden okunur.','Deterministic reading failed. LCW AI identifies only the layout; rates are read from file cells.'))}</p>`;
  if(result){
    const layout=result.layout,stats=result.stats;
    content=`<div class="ocFxImportSummary"><strong>${html(L('Kur önizlemesi — henüz kaydedilmedi','FX preview — not saved yet'))}</strong>
      <span>${html(L('Kaynak','Source'))}: ${html(layout.sheetName)} · ${html(layout.codeColumn+layout.firstDataRow)}:${html(layout.monthColumns.at(-1).col+layout.lastDataRow)} · ${html(L('Başlık satırı','Header row'))}: ${layout.headerRow}</span>
      <span>${html(L('Kapsam','Coverage'))}: ${html(stats.firstMonth)} → ${html(stats.lastMonth)} · ${stats.currencyCount} ${html(L('döviz','currencies'))} · ${stats.monthCount} ${html(L('ay','months'))}</span>
      <span>${html(L('AI güveni','AI confidence'))}: ${(layout.confidence*100).toFixed(0)}% · ${html(layout.direction==='per_usd'?L('1 USD = X döviz','1 USD = X currency'):L('1 birim = X USD','1 unit = X USD'))} · ${html(L('Ölçek','Scale'))}: ${layout.scale}</span>
      <span>${html(L('AI yalnız düzeni önerdi. Aşağıdaki tüm sayılar özgün dosyadan okundu.','AI suggested only the layout. Every number below was read from the original file.'))}</span></div>`;
    if(layout.warnings.length)content+=`<div class="ocFxImportSummary">${layout.warnings.map(w=>`<span>${html(w)}</span>`).join('')}</div>`;
    content+=`<h3>${html(L('Mevcut kurlarla farklar','Differences from current rates'))}</h3><div class="ocCompareTableWrap"><table class="ocCompareTable" data-fx-differences><thead><tr>
      <th>${html(L('Döviz','Currency'))}</th><th>${html(L('Ay','Month'))}</th><th>${html(L('Eski → Yeni','Old → New'))}</th><th>${html(L('% Fark','% Change'))}</th></tr></thead><tbody>${result.differences.map(cell=>`<tr${cell.flagged?' class="ocFxDiffFlag"':''}><td>${cell.flagged?'⚠ ':''}${html(cell.currency)}</td><td>${html(cell.month)}</td><td>${cell.old==null?'—':html(cell.old)} → ${html(cell.value)}</td><td>${cell.percent==null?'—':cell.percent.toFixed(2)+'%'}</td></tr>`).join('')}</tbody></table></div>`;
  }
  if(validation.errors.length)content+=`<div class="ocFxImportSummary" role="status"><strong>${html(L('Kaydı engelleyen hatalar','Errors blocking save'))}</strong>${validation.errors.map(item=>`<span>${html(issueText(item))}</span>`).join('')}</div>`;
  if(result&&validation.warnings.length)content+=`<div class="ocFxImportSummary"><strong>${html(L('Uyarılar','Warnings'))}</strong>${validation.warnings.map(item=>`<span>${html(issueText(item))}</span>`).join('')}</div>`;
  if(session.message)content+=`<p class="ocFxHint" role="status">${html(session.message)}</p>`;
  session.host.innerHTML=`<div class="ocCompareCard ocFxCard" role="dialog" aria-modal="true" aria-labelledby="fxRecoveryTitle" tabindex="-1"><div class="ocCompareHead"><div class="ocCompareHeadText"><h2 id="fxRecoveryTitle">${html(L('LCW AI ile kur tablosunu oku','Read FX table with LCW AI'))}</h2><p class="ocCompareSub">${html(session.recovery.fileName||'KUR.xlsx')}</p></div><button type="button" class="ocIconButton" data-fx-recovery-close aria-label="${html(L('Kapat','Close'))}">×</button></div>
    <div class="ocFxResult">${content}</div><div class="ocFxFooter"><button type="button" class="ocButton" data-fx-read-ai ${session.busy?'disabled':''}>${html(session.busy?L('Düzen okunuyor…','Reading layout…'):L('LCW AI ile oku','Read with LCW AI'))}</button><span class="ocSpacer"></span><button type="button" class="ocButton" data-fx-recovery-close>${html(L('Kapat','Close'))}</button><button type="button" class="ocButton ocButton--primary" data-fx-recovery-save ${!result||validation.errors.length||session.busy?'disabled':''}>${html(L('Onayla ve kurları kaydet','Confirm and save rates'))}</button></div></div>`;
  session.host.querySelectorAll('[data-fx-recovery-close]').forEach(button=>button.onclick=closeImportRecovery);
  session.host.querySelector('[data-fx-read-ai]').onclick=async()=>{
    session.busy=true;session.result=null;session.message='';session.controller=new AbortController();renderRecovery();
    try{const result=await readWithAiLayout(session.recovery,session.controller.signal);if(recoverySession!==session)return;session.result=result;
      if(!result)session.message=L('LCW AI bağlantısını tamamladıktan sonra tekrar oku düğmesine basın.','Complete the LCW AI connection, then press Read again.');
    }catch(error){if(recoverySession!==session)return;session.message=error.message||L('Düzen okunamadı.','Could not read the layout.');}
    finally{session.busy=false;if(recoverySession===session)renderRecovery();}
  };
  session.host.querySelector('[data-fx-recovery-save]').onclick=async()=>{
    if(!session.result||session.result.validation.errors.length||session.busy)return;
    if(!confirmOlderReport(session.result.data)||!window.confirm(L('Önizlemedeki doğrulanmış kurları kaydetmek istiyor musunuz?','Save the validated rates shown in the preview?')))return;
    session.busy=true;renderRecovery();
    try{await window.BLFX.save(session.result.data,{expectedRevision:session.result.revision});
      closeImportRecovery();window.dispatchEvent(new CustomEvent('bl-fx-imported'));window.showToast?.(L('Döviz kurları güncellendi.','FX rates updated.'));
    }catch(error){session.message=error.code==='REVISION_CONFLICT'?L('Kurlar önizleme sırasında değişti. Düzeni yeniden okuyup farkları inceleyin.','Rates changed during the preview. Read the layout again and review the differences.'):error.message;session.busy=false;session.result=null;renderRecovery();}
  };
}
function showImportRecovery(error){
  if(!error?.fxRecovery)return false;closeImportRecovery();
  const host=document.createElement('div');host.className='ocCompareOverlay';host.id='fxImportRecovery';
  const session={host,recovery:error.fxRecovery,result:null,busy:false,message:'',focus:document.activeElement};
  session.onKey=e=>{if(e.key==='Escape'){e.stopImmediatePropagation();closeImportRecovery();}
    if(e.key==='Tab'){const nodes=[...host.querySelectorAll('button:not([disabled])')];const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};
  session.onLanguage=renderRecovery;recoverySession=session;document.body.append(host);document.addEventListener('keydown',session.onKey);document.addEventListener('bl:language-changed',session.onLanguage);
  renderRecovery();host.querySelector('[role=dialog]').focus();return true;
}
async function openFolderRecovery(){
  const response=await fetch('/api/fx/source-kur-preview',{cache:'no-store'});
  if(!response.ok)throw new Error(L('Klasör dosyası okunamadı.','Could not read the folder file.'));
  showImportRecovery({fxRecovery:await response.json()});
}

window.BLFX={store,load,save,monthKey,monthLabel,resolveMonth,snapshotFor,snapshotForMonth,convert,rateText,
             displayCurrencies,allCurrencies,importFile,importWorkbook,FAVORITES,confirmOlderReport,folderSyncText,renderFolderSync,applySourceKur,showImportRecovery,openFolderRecovery};
})();
