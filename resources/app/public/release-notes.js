(function(global){
'use strict';
const INDEX_URL='release-notes/index.json';
const SEEN_KEY='bl.releaseNotes.lastSeenStable.v1';
let indexCache=null,dialog=null,state=null,legacyCache=null,lightbox=null;
let openGeneration=0;
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
function automaticPlan(entries,current,last){
  if(!/^\d+\.\d+(?:\.\d+)?$/.test(current||''))return null;
  if(!/^\d+\.\d+(?:\.\d+)?$/.test(last||''))last='';
  const eligible=(entries||[]).filter(e=>e?.version&&e.file&&cmp(e.version,current)<=0).sort((a,b)=>cmp(a.version,b.version));
  if(!eligible.length||last&&cmp(current,last)<=0)return null;
  const firstUse=!last,candidates=firstUse?eligible.slice(-1):eligible.filter(e=>cmp(e.version,last)>0);
  if(!candidates.length)return null;
  return {current,firstUse,candidates,entries:candidates.slice(-3),totalReleases:candidates.length};
}
function shortSummary(value){
  const text=String(value||'').trim();
  return text.length>360?text.slice(0,360).replace(/\s+\S*$/,'')+'…':text;
}
function ensureDialog(){
  if(dialog?.isConnected)return dialog;
  dialog=document.createElement('dialog');dialog.className='blRnDialog';dialog.dataset.uiMigrated='operations';dialog.setAttribute('aria-labelledby','blRnTitle');
  dialog.innerHTML='<header class="blRnHeader"><div><div class="blGuideEyebrow" data-rn-eyebrow></div><h1 id="blRnTitle" data-rn-title></h1><p data-rn-subtitle></p></div><button type="button" class="blRnClose" data-rn-close>×</button></header><div class="blRnLayout"><aside class="blRnArchive" data-rn-archive><div class="blRnArchiveHead" data-rn-archive-head></div><nav data-rn-list></nav></aside><main class="blRnMain"><div class="blRnStage" data-rn-stage></div></main></div>';
  document.body.appendChild(dialog);
  dialog.querySelector('[data-rn-close]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
  dialog.addEventListener('close',()=>{++openGeneration;if(state?.ackVersion)writeSeen(state.ackVersion);state=null;});
  dialog.addEventListener('keydown',e=>{
    if(!state||lightbox?.open)return;
    if(e.key==='ArrowLeft'&&state.index>0){e.preventDefault();state.index--;renderState();}
    if(e.key==='ArrowRight'){const total=state.releases?.reduce((n,r)=>n+(r.changes||[]).length,0)||0;if(state.index<total-1){e.preventDefault();state.index++;renderState();}}
  });
  return dialog;
}
function ensureLightbox(){
  if(lightbox?.isConnected)return lightbox;
  lightbox=document.createElement('dialog');lightbox.className='blRnLightbox';lightbox.dataset.uiMigrated='operations';lightbox.setAttribute('aria-modal','true');
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
function fallbackVisual(release,change,reason){
  const title=pick(change?.title)||pick(release?.title)||('v'+String(release?.version||'')),module=pick(change?.module)||'Buyer Log';
  const note=reason||L('Doğrulanmış ekran görüntüsü bulunamadığı için görsel gösterilmedi.','The visual was hidden because a verified screenshot is not available.');
  return '<div class="blRnFallbackVisual blRnFallbackVisual--safe" role="img" aria-label="'+esc(L('Doğrulanmış görsel yok','No verified visual'))+'"><div class="blRnFallbackMark">BL</div><div><span>'+esc(module)+'</span><b>'+esc(title)+'</b><small>'+esc(note)+'</small></div></div>';
}
function visualHtml(change,release){
  const v=change?.visual;if(!v?.src)return fallbackVisual(release,change);
  if(v.kind==='screenshot'&&!/\.png(?:\?|$)/i.test(String(v.src||'')))return fallbackVisual(release,change,L('Eski veya doğrulanmamış ekran görüntüsü güvenli şekilde gösterilmedi.','An old or unverified screenshot was hidden safely.'));
  const src=withVersion('release-notes/'+release.version+'/'+v.src),focus=v.focus;
  const focusHtml=focus?'<i class="blRnFocus" style="left:'+Number(focus.x)+'%;top:'+Number(focus.y)+'%;width:'+Number(focus.w)+'%;height:'+Number(focus.h)+'%"></i>':'';
  const alt=pick(v.alt)||pick(change.title),caption=pick(v.caption)||L('Gerçek Buyer Log ekranı','Real Buyer Log screen');
  return '<figure class="blRnVisual"><div class="blGuideVisualTop"><span>BUYER LOG</span><span>'+esc(pick(change.module))+'</span></div><button type="button" class="blRnShot" data-rn-zoom aria-label="'+esc(L('Görseli büyüt','Enlarge image'))+'"><img src="'+esc(src)+'" alt="'+esc(alt)+'">'+focusHtml+'<span class="blRnZoomHint" aria-hidden="true">↗ '+esc(L('Büyüt','Enlarge'))+'</span></button><figcaption>'+esc(caption)+'</figcaption></figure>';
}
function description(change,release){
  return String(pick(change?.body)||pick(change?.summary)||pick(release?.summary)||L('Bu değişiklik Buyer Log deneyimini daha anlaşılır ve kullanışlı hale getirir.','This change makes the Buyer Log experience clearer and easier to use.')).trim();
}
function screenshotDimensionsOk(img){
  const w=Number(img?.naturalWidth||0),h=Number(img?.naturalHeight||0),ratio=h?w/h:0;
  return w>=900&&h>=360&&ratio>=1.2&&ratio<=3.2;
}
function bindScreenshotGuard(stage,change,release){
  if(change?.visual?.kind!=='screenshot')return;
  const host=stage.querySelector('.blRnFigure'),img=host?.querySelector('.blRnVisual img');
  if(!host||!img)return;
  let replaced=false;
  const reject=()=>{
    if(replaced)return;replaced=true;
    host.innerHTML=fallbackVisual(release,change,L('Ekran görüntüsü bozuk, eksik veya okunamayacak kadar kırpılmış olduğu için gösterilmedi.','The screenshot was hidden because it is corrupt, incomplete, or cropped too tightly to read.'));
  };
  const verify=()=>{if(!screenshotDimensionsOk(img))reject();};
  img.addEventListener('error',reject,{once:true});
  img.addEventListener('load',verify,{once:true});
  if(img.complete){if(!img.naturalWidth)reject();else verify();}
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
  bindScreenshotGuard(stage,change,release);
  if(zoom){const img=zoom.querySelector('img'),cap=stage.querySelector('.blRnVisual figcaption');zoom.addEventListener('click',()=>openVisual(img.currentSrc||img.src,img.alt,cap?.textContent||''));}
}
function renderLegacy(row){
  dialog.querySelector('[data-rn-stage]').innerHTML='<div class="blRnMeta"><span>v'+esc(row.version)+'</span><span>'+esc(row.publishedAt||'')+'</span></div><div class="blRnCard"><div class="blRnFigure">'+fallbackVisual(row)+'</div><section class="blRnCopy blGuideCopy"><div class="blGuideEyebrow">'+esc(L('METİN ARŞİVİ','TEXT ARCHIVE'))+'</div><h2>'+esc(pick(row.title))+'</h2><ul class="blRnLegacyItems">'+row.items.map(x=>'<li>'+esc(pick(x))+'</li>').join('')+'</ul></section></div>';
}
function renderSummary(){
  const snapshot=state,latest=snapshot.releases.at(-1),changes=[];
  for(const release of [...snapshot.releases].reverse())for(const change of release.changes||[])if(changes.length<6)changes.push({release,change});
  const stage=dialog.querySelector('[data-rn-stage]');
  dialog.querySelector('[data-rn-title]').textContent=snapshot.plan.firstUse?L('Buyer Log’a hoş geldiniz','Welcome to Buyer Log'):L('Buyer Log güncellendi','Buyer Log has been updated');
  dialog.querySelector('[data-rn-subtitle]').textContent=snapshot.plan.firstUse?L('Başlamak için son sürümün kısa özeti.','A short summary of the latest release to get started.'):L('Son gördüğünüz sürümden sonraki yeniliklerin kısa özeti.','A short summary of changes since your last acknowledged version.');
  stage.innerHTML='<section class="blRnSummary"><div class="blRnMeta"><span>v'+esc(latest.version)+'</span><span>'+esc(latest.publishedAt||'')+'</span></div><h2>'+esc(pick(latest.title))+'</h2><p>'+esc(shortSummary(pick(latest.summary)))+'</p>'+(changes.length?'<ul>'+changes.map(({release,change})=>'<li><b>'+esc(pick(change.title))+'</b><small>'+esc(pick(change.module))+' · v'+esc(release.version)+'</small></li>').join('')+'</ul>':'')+'<p class="blRnSummaryCount">'+esc(snapshot.plan.firstUse?L('Eski sürümler sürüm geçmişinde saklanır.','Older releases remain available in Version History.'):L(snapshot.plan.totalReleases+' yeni sürüm · özet son '+snapshot.releases.length+' sürümden seçildi.',snapshot.plan.totalReleases+' new releases · highlights from the latest '+snapshot.releases.length+' releases.'))+'</p><div class="blRnSummaryActions"><button type="button" class="navActionBtn primary" data-rn-summary-close>'+esc(L('Başlayalım','Get started'))+'</button><button type="button" class="navActionBtn" data-rn-summary-details>'+esc(L('Yeni değişikliklerin detayları','Details of new changes'))+'</button><button type="button" class="navActionBtn" data-rn-summary-archive>'+esc(L('Tüm sürüm geçmişi','Full version history'))+'</button></div></section>';
  stage.querySelector('[data-rn-summary-close]').onclick=()=>dialog.close();
  stage.querySelector('[data-rn-summary-archive]').onclick=()=>{writeSeen(snapshot.ackVersion);void openArchive();};
  stage.querySelector('[data-rn-summary-details]').onclick=async event=>{
    const button=event.currentTarget,generation=openGeneration;button.disabled=true;
    const releases=(await Promise.all(snapshot.plan.candidates.map(loadRelease))).filter(Boolean);
    if(state!==snapshot||!dialog.open||generation!==openGeneration)return;
    if(releases.length){state={...snapshot,summary:false,releases,index:0};await renderState();dialog.querySelector('[data-rn-next]')?.focus();}
    else {button.disabled=false;global.BLUI?.notify?.(L('Sürüm ayrıntıları yüklenemedi.','Release details could not be loaded.'),{kind:'error',language:lang()});}
  };
}
async function renderState(){
  if(!state)return;setHeader(state.auto,state.releases.length);
  const rendering=state;
  dialog.classList.toggle('blRnDialog--summary',!!state.summary);
  const archive=dialog.querySelector('[data-rn-archive]');archive.hidden=!!state.auto;dialog.classList.toggle('blRnDialog--unseen',!!state.auto);
  if(state.summary)return renderSummary();
  if(!state.auto)await renderArchive(state.active);
  if(state!==rendering)return;
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
  const generation=++openGeneration;let next;
  ensureDialog();const first=(await loadIndex()).releases[0];
  if(first){const release=await loadRelease(first);next={auto:false,releases:release?[release]:[],index:0,active:first.version};}
  else {const l=(await legacyRows())[0];next={auto:false,releases:[],index:0,active:l?.version||'',legacy:l};}
  if(generation!==openGeneration)return;state=next;
  await renderState();if(generation===openGeneration&&state&&!dialog.open)dialog.showModal();
}
function bootReady(){const b=document.getElementById('blBootGuard');if(!b||b.hidden)return true;try{return getComputedStyle(b).display==='none';}catch(_){return false;}}
function waitForBoot(){return new Promise(resolve=>{if(bootReady())return setTimeout(resolve,350);const t=setInterval(()=>{if(bootReady()){clearInterval(t);setTimeout(resolve,350);}},400);});}
async function showUnseen(){
  const generation=++openGeneration,current=ver(),last=readSeen(),plan=automaticPlan((await loadIndex()).releases,current,last);
  if(!plan)return;
  const releases=(await Promise.all(plan.entries.map(loadRelease))).filter(Boolean);if(!releases.length)return;
  await waitForBoot();if(generation!==openGeneration)return;
  ensureDialog();state={auto:true,summary:true,plan,releases,index:0,ackVersion:current};await renderState();if(!dialog.open)dialog.showModal();dialog.querySelector('[data-rn-summary-close]')?.focus();
}
function bind(){
  const btn=document.getElementById('appVersionBtn');if(btn&&!btn.dataset.rnBound){btn.dataset.rnBound='1';btn.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();openArchive();},true);btn.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openArchive();}},true);}
  showUnseen();
}
global.BLReleaseNotes={open:openArchive,openVersion,showUnseen};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})(window);
