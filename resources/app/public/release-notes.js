(function(global){
'use strict';
const INDEX_URL='release-notes/index.json';
const SEEN_KEY='bl.releaseNotes.lastSeenStable.v1';
let indexCache=null,dialog=null,state=null,legacyCache=null,lightbox=null;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const lang=()=>{try{return typeof appLang!=='undefined'&&appLang==='en'?'en':'tr';}catch(_){return document.documentElement.lang==='en'?'en':'tr';}};
const L=(tr,en)=>lang()==='en'?en:tr;
const pick=v=>v&&typeof v==='object'?(v[lang()]||v.tr||v.en||''):String(v||'');
function versionParts(v){
  const raw=String(v||'').trim().split('.').filter(Boolean).map(x=>parseInt(x,10)||0);
  // Historical Buyer Log versions used "7.137" to mean today's "7.0.137".
  // Normalize that legacy two-part format before comparing it with semantic versions.
  if(raw.length===2)return [raw[0]||0,0,raw[1]||0];
  while(raw.length<3)raw.push(0);
  return raw;
}
const versionKey=v=>versionParts(v).slice(0,3).join('.');
const cmp=(a,b)=>{const aa=versionParts(a),bb=versionParts(b);for(let i=0;i<Math.max(aa.length,bb.length,3);i++){const d=(aa[i]||0)-(bb[i]||0);if(d)return d;}return 0;};
const ver=()=>String(global.BL_APP_VERSION||'').trim();
const withVersion=src=>{const v=encodeURIComponent(String(global.BL_ASSET_VERSION||global.BL_APP_VERSION||''));return src+(src.includes('?')?'&':'?')+'v='+v;};
async function fetchJson(src){const r=await fetch(withVersion(src),{cache:'no-store'});if(!r.ok)throw new Error(String(r.status));return r.json();}
async function loadIndex(){if(indexCache)return indexCache;try{indexCache=await fetchJson(INDEX_URL);}catch(_){indexCache={schemaVersion:1,releases:[]};}indexCache.releases=(indexCache.releases||[]).filter(x=>x&&x.version&&x.file).sort((a,b)=>cmp(b.version,a.version));return indexCache;}
async function loadRelease(entry){try{return {...await fetchJson(entry.file),_entry:entry};}catch(_){return null;}}
async function legacyRows(){
  if(legacyCache)return legacyCache;
  try{await global.BLPerf?.ensureFeature?.('versionHistory');}catch(_){}
  const visual=new Set((await loadIndex()).releases.map(x=>versionKey(x.version)));
  legacyCache=(Array.isArray(global.BL_VERSION_HISTORY)?global.BL_VERSION_HISTORY:[]).map(x=>({
    version:x?.v==='__CURRENT__'?ver():String(x?.v||''),publishedAt:x?.date||'',title:x?.title||{},items:Array.isArray(x?.items)?x.items:[],legacy:true
  })).filter(x=>x.version&&!visual.has(versionKey(x.version)));
  return legacyCache;
}
function seenStorage(){return global.BLStorage||global.localStorage;}
function readSeen(){try{return String(seenStorage()?.getItem(SEEN_KEY)||'').trim();}catch(_){return '';}}
function writeSeen(v){if(!v)return;try{seenStorage()?.setItem(SEEN_KEY,v);}catch(_){}}
function ensureDialog(){
  if(dialog?.isConnected)return dialog;
  dialog=document.createElement('dialog');dialog.className='blRnDialog';dialog.setAttribute('aria-labelledby','blRnTitle');
  dialog.innerHTML='<header class="blRnHeader"><div><div class="blGuideEyebrow" data-rn-eyebrow></div><h1 id="blRnTitle" data-rn-title></h1><p data-rn-subtitle></p></div><button type="button" class="blRnClose" data-rn-close>×</button></header><div class="blRnLayout"><aside class="blRnArchive" data-rn-archive><div class="blRnArchiveHead" data-rn-archive-head></div><nav data-rn-list></nav></aside><main class="blRnMain"><div class="blRnStage" data-rn-stage></div></main></div>';
  document.body.appendChild(dialog);
  dialog.querySelector('[data-rn-close]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
  dialog.addEventListener('close',()=>{if(state?.auto)writeSeen(ver());state=null;});
  dialog.addEventListener('keydown',e=>{
    if(!state||lightbox?.open)return;
    if(e.key==='ArrowLeft'&&state.index>0){e.preventDefault();state.index--;renderState();}
    if(e.key==='ArrowRight'){const total=state.releases?.reduce((n,r)=>n+(r.changes||[]).length,0)||0;if(state.index<total-1){e.preventDefault();state.index++;renderState();}}
  });
  return dialog;
}
function ensureLightbox(){
  if(lightbox?.isConnected)return lightbox;
  lightbox=document.createElement('dialog');lightbox.className='blRnLightbox';lightbox.setAttribute('aria-modal','true');
  lightbox.innerHTML='<button type="button" class="blRnLightboxClose" data-rn-lightbox-close>×</button><div class="blRnLightboxBody"><img data-rn-lightbox-img alt=""><div class="blRnLightboxCaption" data-rn-lightbox-caption></div></div>';
  document.body.appendChild(lightbox);
  const close=lightbox.querySelector('[data-rn-lightbox-close]');
  close.addEventListener('click',()=>lightbox.close());
  lightbox.addEventListener('click',e=>{if(e.target===lightbox)lightbox.close();});
  lightbox.addEventListener('keydown',e=>{if(e.key==='Escape')lightbox.close();});
  return lightbox;
}
function openVisual(src,alt,caption){
  const box=ensureLightbox(),img=box.querySelector('[data-rn-lightbox-img]'),cap=box.querySelector('[data-rn-lightbox-caption]');
  img.src=src;img.alt=alt||'';cap.textContent=caption||'';
  box.querySelector('[data-rn-lightbox-close]').title=L('Kapat','Close');
  if(!box.open)box.showModal();
}
function setHeader(auto,count){
  const d=ensureDialog(),close=d.querySelector('[data-rn-close]');
  d.querySelector('[data-rn-eyebrow]').textContent=auto?L('BUYER LOG · YENİLİKLER','BUYER LOG · WHAT’S NEW'):L('BUYER LOG · SÜRÜM ARŞİVİ','BUYER LOG · RELEASE ARCHIVE');
  d.querySelector('[data-rn-title]').textContent=auto?L('Buyer Log güncellendi','Buyer Log has been updated'):L('Sürüm Geçmişi','Version History');
  d.querySelector('[data-rn-subtitle]').textContent=auto?(count>1?L(count+' stable sürümdeki yenilikler tek akışta gösteriliyor.','Changes across '+count+' stable releases are shown in one flow.'):L('Yeni sürümde nelerin değiştiğine göz atın.','See what changed in the new version.')):L('Stable değişikliklerini gerçek Buyer Log ekranlarıyla yeniden inceleyin.','Review stable changes again with real Buyer Log screens.');
  d.querySelector('[data-rn-archive-head]').textContent=L('STABLE SÜRÜMLER','STABLE RELEASES');
  close.title=L('Kapat','Close');close.setAttribute('aria-label',close.title);
}
async function archiveRows(){
  return [...(await loadIndex()).releases.map(x=>({...x,legacy:false})),...(await legacyRows())].sort((a,b)=>cmp(b.version,a.version));
}
async function renderArchive(active){
  const list=dialog.querySelector('[data-rn-list]'),rows=await archiveRows();
  list.innerHTML=rows.length?rows.map(row=>'<button type="button" class="blRnReleaseRow'+(row.version===active?' is-active':'')+'" data-rn-version="'+esc(row.version)+'"><span><b>v'+esc(row.version)+'</b><small>'+esc(row.publishedAt||row.date||'')+'</small></span><em>'+esc(pick(row.title)||L('Bakım ve güncelleme','Maintenance and updates'))+'</em>'+(row.legacy?'<i>'+esc(L('Metin arşivi','Text archive'))+'</i>':'')+'</button>').join(''):'<div class="blRnEmpty">'+esc(L('Henüz arşivlenmiş stable sürüm yok.','There are no archived stable releases yet.'))+'</div>';
  list.querySelectorAll('[data-rn-version]').forEach(b=>b.addEventListener('click',()=>openVersion(b.dataset.rnVersion)));
}
function fallbackVisual(release){
  return '<div class="blRnFallbackVisual" role="img" aria-label="'+esc(L('Sürüm arşivi görseli','Release archive visual'))+'"><div class="blRnFallbackMark">BL</div><div><span>BUYER LOG</span><b>v'+esc(release.version)+'</b><small>'+esc(L('Sürüm arşivi','Release archive'))+'</small></div></div>';
}
function visualHtml(change,release){
  const v=change?.visual;if(!v?.src)return fallbackVisual(release);
  const src=withVersion('release-notes/'+release.version+'/'+v.src),focus=v.focus;
  const focusHtml=focus?'<i class="blRnFocus" style="left:'+Number(focus.x)+'%;top:'+Number(focus.y)+'%;width:'+Number(focus.w)+'%;height:'+Number(focus.h)+'%"></i>':'';
  const alt=pick(v.alt)||pick(change.title),caption=pick(v.caption)||L('Gerçek Buyer Log ekranı','Real Buyer Log screen');
  return '<figure class="blRnVisual"><div class="blGuideVisualTop"><span>BUYER LOG</span><span>'+esc(pick(change.module))+'</span></div><button type="button" class="blRnShot" data-rn-zoom aria-label="'+esc(L('Görseli büyüt','Enlarge image'))+'"><img src="'+esc(src)+'" alt="'+esc(alt)+'">'+focusHtml+'<span class="blRnZoomHint" aria-hidden="true">↗ '+esc(L('Büyüt','Enlarge'))+'</span></button><figcaption>'+esc(caption)+'</figcaption></figure>';
}
function description(change,release){
  return String(pick(change?.body)||pick(change?.summary)||pick(release?.summary)||L('Bu değişiklik Buyer Log deneyimini daha anlaşılır ve kullanışlı hale getirir.','This change makes the Buyer Log experience clearer and easier to use.')).trim();
}
function typeLabel(type){return ({feature:L('YENİ ÖZELLİK','NEW FEATURE'),improvement:L('İYİLEŞTİRME','IMPROVEMENT'),fix:L('DÜZELTME','FIX')})[type]||L('GÜNCELLEME','UPDATE');}
function renderCard(deck,index){
  const {release,change}=deck[index],stage=dialog.querySelector('[data-rn-stage]'),body=description(change,release);
  stage.innerHTML='<div class="blRnMeta"><span>v'+esc(release.version)+'</span><span>'+esc(release.publishedAt||'')+'</span><span>'+(index+1)+' / '+deck.length+'</span></div><div class="blRnCard"><div class="blRnFigure">'+visualHtml(change,release)+'</div><section class="blRnCopy blGuideCopy"><div class="blGuideEyebrow">'+esc(typeLabel(change.type))+' · '+esc(pick(change.module))+'</div><h2>'+esc(pick(change.title)||pick(release.title))+'</h2><p>'+esc(body)+'</p>'+(change.path?'<div class="blGuidePath">'+esc(pick(change.path))+'</div>':'')+'</section></div><div class="blRnNav"><div class="blTriviaProgress"><i style="transform:scaleX('+((index+1)/deck.length)+')"></i></div><div class="blRnNavRow"><span>'+esc(pick(release.title))+'</span><div class="blRnNavBtns"><button type="button" class="blRnNavBtn" data-rn-prev><span aria-hidden="true">‹</span><b>'+esc(L('Önceki','Previous'))+'</b></button><button type="button" class="blRnNavBtn blRnNavBtn--next" data-rn-next><b>'+esc(L('Sonraki','Next'))+'</b><span aria-hidden="true">›</span></button></div></div></div>';
  const prev=stage.querySelector('[data-rn-prev]'),next=stage.querySelector('[data-rn-next]'),zoom=stage.querySelector('[data-rn-zoom]');
  prev.disabled=index===0;next.disabled=index===deck.length-1;
  prev.title=L('Önceki değişiklik','Previous change');prev.setAttribute('aria-label',prev.title);
  next.title=L('Sonraki değişiklik','Next change');next.setAttribute('aria-label',next.title);
  prev.addEventListener('click',()=>{state.index--;renderState();});next.addEventListener('click',()=>{state.index++;renderState();});
  if(zoom){const img=zoom.querySelector('img'),cap=stage.querySelector('.blRnVisual figcaption');zoom.addEventListener('click',()=>openVisual(img.currentSrc||img.src,img.alt,cap?.textContent||''));}
}
function renderLegacy(row){
  dialog.querySelector('[data-rn-stage]').innerHTML='<div class="blRnMeta"><span>v'+esc(row.version)+'</span><span>'+esc(row.publishedAt||'')+'</span></div><div class="blRnCard"><div class="blRnFigure">'+fallbackVisual(row)+'</div><section class="blRnCopy blGuideCopy"><div class="blGuideEyebrow">'+esc(L('METİN ARŞİVİ','TEXT ARCHIVE'))+'</div><h2>'+esc(pick(row.title))+'</h2><ul class="blRnLegacyItems">'+row.items.map(x=>'<li>'+esc(pick(x))+'</li>').join('')+'</ul></section></div>';
}
async function renderState(){
  if(!state)return;setHeader(state.auto,state.releases.length);
  const archive=dialog.querySelector('[data-rn-archive]');archive.hidden=!!state.auto;dialog.classList.toggle('blRnDialog--unseen',!!state.auto);
  if(!state.auto)await renderArchive(state.active);
  if(state.legacy)return renderLegacy(state.legacy);
  const deck=[];state.releases.forEach(release=>(release.changes||[]).forEach(change=>deck.push({release,change})));
  if(!deck.length){dialog.querySelector('[data-rn-stage]').innerHTML='<div class="blRnEmpty">'+esc(L('Bu sürüm için gösterilecek değişiklik bulunmuyor.','There are no changes to show for this release.'))+'</div>';return;}
  state.index=Math.max(0,Math.min(state.index,deck.length-1));renderCard(deck,state.index);
}
async function openVersion(version){
  const entry=(await loadIndex()).releases.find(x=>x.version===version);
  if(entry){const release=await loadRelease(entry);if(release){state={auto:false,releases:[release],index:0,active:version};return renderState();}}
  const legacy=(await legacyRows()).find(x=>x.version===version);if(legacy){state={auto:false,releases:[],index:0,active:version,legacy};return renderState();}
}
async function openArchive(){
  ensureDialog();const first=(await loadIndex()).releases[0];
  if(first){const release=await loadRelease(first);state={auto:false,releases:release?[release]:[],index:0,active:first.version};}
  else {const l=(await legacyRows())[0];state={auto:false,releases:[],index:0,active:l?.version||'',legacy:l};}
  await renderState();if(!dialog.open)dialog.showModal();
}
function bootReady(){const b=document.getElementById('blBootGuard');if(!b||b.hidden)return true;try{return getComputedStyle(b).display==='none';}catch(_){return false;}}
function waitForBoot(){return new Promise(resolve=>{if(bootReady())return setTimeout(resolve,350);const t=setInterval(()=>{if(bootReady()){clearInterval(t);setTimeout(resolve,350);}},400);});}
async function showUnseen(){
  const current=ver(),last=readSeen(),entries=(await loadIndex()).releases;
  if(!current||!entries.length)return;
  let candidates=entries.filter(e=>cmp(e.version,current)<=0&&(!last||cmp(e.version,last)>0)).sort((a,b)=>cmp(a.version,b.version));
  // İlk kez görsel arşiv kullanan cihazda önceki sürüm anahtarı olmayabilir.
  // Bu durumda mevcut sürüme kadarki tüm görsel stable arşivi gösterilir; böylece
  // birkaç sürüm atlayarak güncelleyen kullanıcı ara sürümleri kaçırmaz.
  if(!candidates.length)return;
  const releases=(await Promise.all(candidates.map(loadRelease))).filter(Boolean);if(!releases.length)return;
  await waitForBoot();ensureDialog();state={auto:true,releases,index:0};await renderState();if(!dialog.open)dialog.showModal();
}
function bind(){
  const btn=document.getElementById('appVersionBtn');if(btn&&!btn.dataset.rnBound){btn.dataset.rnBound='1';btn.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();openArchive();},true);btn.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openArchive();}},true);}
  showUnseen();
}
global.BLReleaseNotes={open:openArchive,openVersion,showUnseen};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})(window);
