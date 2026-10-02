(function(global){
'use strict';
const INDEX_URL='release-notes/index.json';
const SEEN_KEY='bl.releaseNotes.lastSeenStable.v1';
let indexCache=null,dialog=null,state=null,legacyCache=null;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const lang=()=>{try{return typeof appLang!=='undefined'&&appLang==='en'?'en':'tr';}catch(_){return document.documentElement.lang==='en'?'en':'tr';}};
const L=(tr,en)=>lang()==='en'?en:tr;
const pick=v=>v&&typeof v==='object'?(v[lang()]||v.tr||v.en||''):String(v||'');
const parts=v=>String(v||'').split('.').map(x=>parseInt(x,10)||0);
const cmp=(a,b)=>{const aa=parts(a),bb=parts(b);for(let i=0;i<Math.max(aa.length,bb.length,3);i++){const d=(aa[i]||0)-(bb[i]||0);if(d)return d;}return 0;};
const ver=()=>String(global.BL_APP_VERSION||'').trim();
const withVersion=src=>{const v=encodeURIComponent(String(global.BL_ASSET_VERSION||global.BL_APP_VERSION||''));return src+(src.includes('?')?'&':'?')+'v='+v;};
async function fetchJson(src){const r=await fetch(withVersion(src),{cache:'no-store'});if(!r.ok)throw new Error(String(r.status));return r.json();}
async function loadIndex(){if(indexCache)return indexCache;try{indexCache=await fetchJson(INDEX_URL);}catch(_){indexCache={schemaVersion:1,releases:[]};}indexCache.releases=(indexCache.releases||[]).filter(x=>x&&x.version&&x.file).sort((a,b)=>cmp(b.version,a.version));return indexCache;}
async function loadRelease(entry){try{return {...await fetchJson(entry.file),_entry:entry};}catch(_){return null;}}
async function legacyRows(){
  if(legacyCache)return legacyCache;
  try{await global.BLPerf?.ensureFeature?.('versionHistory');}catch(_){}
  const visual=new Set((await loadIndex()).releases.map(x=>x.version));
  legacyCache=(Array.isArray(global.BL_VERSION_HISTORY)?global.BL_VERSION_HISTORY:[]).map(x=>({
    version:x?.v==='__CURRENT__'?ver():String(x?.v||''),publishedAt:x?.date||'',title:x?.title||{},items:Array.isArray(x?.items)?x.items:[],legacy:true
  })).filter(x=>x.version&&!visual.has(x.version));
  return legacyCache;
}
function readSeen(){try{return String(localStorage.getItem(SEEN_KEY)||'').trim();}catch(_){return '';}}
function writeSeen(v){if(!v)return;try{localStorage.setItem(SEEN_KEY,v);}catch(_){}}
function ensureDialog(){
  if(dialog?.isConnected)return dialog;
  dialog=document.createElement('dialog');dialog.className='blRnDialog';dialog.setAttribute('aria-labelledby','blRnTitle');
  dialog.innerHTML='<header class="blRnHeader"><div><div class="blGuideEyebrow" data-rn-eyebrow></div><h1 id="blRnTitle" data-rn-title></h1><p data-rn-subtitle></p></div><button type="button" class="blRnClose" data-rn-close>×</button></header><div class="blRnLayout"><aside class="blRnArchive" data-rn-archive><div class="blRnArchiveHead" data-rn-archive-head></div><nav data-rn-list></nav></aside><main class="blRnMain"><div class="blRnStage" data-rn-stage></div></main></div>';
  document.body.appendChild(dialog);
  dialog.querySelector('[data-rn-close]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
  dialog.addEventListener('close',()=>{if(state?.auto)writeSeen(ver());state=null;});
  return dialog;
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
  return '<figure class="blRnVisual"><div class="blGuideVisualTop"><span>BUYER LOG</span><span>'+esc(pick(change.module))+'</span></div><div class="blRnShot"><img src="'+esc(src)+'" alt="'+esc(pick(v.alt)||pick(change.title))+'">'+focusHtml+'</div><figcaption>'+esc(pick(v.caption)||L('Gerçek Buyer Log ekranı','Real Buyer Log screen'))+'</figcaption></figure>';
}
function typeLabel(type){return ({feature:L('YENİ ÖZELLİK','NEW FEATURE'),improvement:L('İYİLEŞTİRME','IMPROVEMENT'),fix:L('DÜZELTME','FIX')})[type]||L('GÜNCELLEME','UPDATE');}
function renderCard(deck,index){
  const {release,change}=deck[index],stage=dialog.querySelector('[data-rn-stage]');
  stage.innerHTML='<div class="blRnMeta"><span>v'+esc(release.version)+'</span><span>'+esc(release.publishedAt||'')+'</span><span>'+(index+1)+' / '+deck.length+'</span></div><div class="blRnCard"><div class="blRnFigure">'+visualHtml(change,release)+'</div><section class="blRnCopy blGuideCopy"><div class="blGuideEyebrow">'+esc(typeLabel(change.type))+' · '+esc(pick(change.module))+'</div><h2>'+esc(pick(change.title))+'</h2><p>'+esc(pick(change.body))+'</p>'+(change.path?'<div class="blGuidePath">'+esc(pick(change.path))+'</div>':'')+'</section></div><div class="blRnNav"><div class="blTriviaProgress"><i style="transform:scaleX('+((index+1)/deck.length)+')"></i></div><div class="blRnNavRow"><span>'+esc(pick(release.title))+'</span><div class="blTriviaBtns"><button type="button" class="blTriviaBtn" data-rn-prev>‹</button><button type="button" class="blTriviaBtn blTriviaBtn--next" data-rn-next>›</button></div></div></div>';
  const prev=stage.querySelector('[data-rn-prev]'),next=stage.querySelector('[data-rn-next]');
  prev.disabled=index===0;next.disabled=index===deck.length-1;
  prev.title=prev.setAttribute('aria-label',L('Önceki değişiklik','Previous change'))||L('Önceki değişiklik','Previous change');
  next.title=next.setAttribute('aria-label',L('Sonraki değişiklik','Next change'))||L('Sonraki değişiklik','Next change');
  prev.addEventListener('click',()=>{state.index--;renderState();});next.addEventListener('click',()=>{state.index++;renderState();});
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
