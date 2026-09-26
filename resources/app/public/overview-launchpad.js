/* Genel Bakış · "Bugün" başlangıç modülü.
   Selamlama + tarih ve kullanıcının en sık açtığı çalışma alanlarına tek tık
   erişim. Kutucuklar rail'deki GÖRÜNÜR sekme düğmelerinden türetilir; böylece
   yetki/rol filtresi tek kaynaktan (rail) gelir ve modül hiçbir görünümü
   kendisi başlatmaz — tıklama yalnız ilgili rail düğmesine devredilir.
   Ziyaret sayıları cihazda, kullanıcı-kapsamlı BLStorage'da tutulur. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.BLOverviewLaunchpad=factory();
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const STORAGE_KEY='buyerlog.overview.launchpad.v1';
  const MAX_TILES=6;
  const HOME_TAB='overview';

  function greetingKey(hour){
    const h=Number(hour);
    if(h>=5&&h<12)return 'morning';
    if(h>=12&&h<18)return 'day';
    if(h>=18&&h<23)return 'evening';
    return 'night';
  }
  const GREETINGS={
    morning:{tr:'Günaydın',en:'Good morning'},
    day:{tr:'İyi günler',en:'Good afternoon'},
    evening:{tr:'İyi akşamlar',en:'Good evening'},
    night:{tr:'İyi geceler',en:'Good night'},
  };
  function greeting(hour,lang){return GREETINGS[greetingKey(hour)][lang==='en'?'en':'tr'];}

  function normalizeVisits(value){
    const out={};
    if(!value||typeof value!=='object')return out;
    Object.entries(value).forEach(([tab,entry])=>{
      if(!tab||tab===HOME_TAB||!entry||typeof entry!=='object')return;
      const count=Math.max(0,Math.min(1e6,Math.trunc(Number(entry.count)||0)));
      const last=Math.max(0,Number(entry.last)||0);
      if(count>0)out[tab]={count,last};
    });
    return out;
  }
  function recordVisit(visits,tab,now){
    const next=normalizeVisits(visits);
    if(!tab||tab===HOME_TAB)return next;
    const prev=next[tab]||{count:0,last:0};
    next[tab]={count:prev.count+1,last:Number(now)||Date.now()};
    return next;
  }
  /* Sık kullanılanlar önce (sayı, sonra yakınlık); kalan yer rail sırasıyla
     dolar. Rail'de artık görünmeyen sekmeler (yetki değişimi) elenir. */
  function rankTabs(available,visits,limit=MAX_TILES){
    const list=(Array.isArray(available)?available:[]).filter(tab=>tab&&tab!==HOME_TAB);
    const known=normalizeVisits(visits);
    const index=new Map(list.map((tab,i)=>[tab,i]));
    const used=list.filter(tab=>known[tab]).sort((a,b)=>
      known[b].count-known[a].count||known[b].last-known[a].last||index.get(a)-index.get(b));
    const rest=list.filter(tab=>!known[tab]);
    return used.concat(rest).slice(0,Math.max(0,limit));
  }

  if(typeof document==='undefined')return {STORAGE_KEY,greetingKey,greeting,normalizeVisits,recordVisit,rankTabs};

  const lang=()=>(document.documentElement.lang||'tr').toLowerCase().startsWith('en')?'en':'tr';
  const esc=value=>String(value==null?'':value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  function store(){return window.BLStorage||null;}
  function loadVisits(){try{return normalizeVisits(JSON.parse(store()?.getItem(STORAGE_KEY)||'null'));}catch(_){return {};}}
  function saveVisits(value){try{store()?.setItem(STORAGE_KEY,JSON.stringify(normalizeVisits(value)));}catch(_){}}

  function railTabs(){
    const out=[];let group='';
    document.querySelectorAll('nav.tabs > *').forEach(node=>{
      if(node.classList.contains('railGroupLabel')){group=(node.textContent||'').trim();return;}
      const tab=node.dataset&&node.dataset.tab;
      if(!tab||tab===HOME_TAB||node.hidden||node.offsetParent===null)return;
      const label=(node.querySelector('span')?.textContent||node.textContent||'').trim();
      const icon=node.querySelector('svg use')?.getAttribute('href')||'#i-layout-dashboard';
      out.push({tab,label,icon,group});
    });
    return out;
  }
  function relativeTime(ts,l){
    if(!ts)return '';
    const diff=Math.max(0,Date.now()-ts),min=Math.round(diff/60000);
    if(min<1)return l==='en'?'just now':'az önce';
    if(min<60)return l==='en'?`${min} min ago`:`${min} dk önce`;
    const h=Math.round(min/60);if(h<24)return l==='en'?`${h} h ago`:`${h} sa önce`;
    const d=Math.round(h/24);return l==='en'?`${d} d ago`:`${d} gün önce`;
  }

  /* Veri nabzı: üst çubuktaki yenileme düğmesi dönerken orb "düşünür". */
  function refreshing(){return Boolean(document.getElementById('topRefreshBtn')?.classList.contains('spinning'));}
  function pulseHtml(l){
    const busy=refreshing();
    const text=busy?(l==='en'?'Refreshing data…':'Veriler yenileniyor…'):(l==='en'?'Workspace ready':'Çalışma alanı hazır');
    return `<p class="ovLaunchPulse" data-pulse="${busy?'thinking':'idle'}"><span class="blOrb blOrb--sm" data-state="${busy?'thinking':'idle'}" aria-hidden="true"></span><span>${esc(text)}</span></p>`;
  }
  function render(){
    const host=document.getElementById('ovLaunchpad');if(!host)return;
    /* Düzen düzenleme kontrolleri host'a eklenir; içerik ayrı gövdeye yazılır. */
    let body=host.querySelector(':scope > .ovLaunchBody');
    if(!body){body=document.createElement('div');body.className='ovLaunchBody';host.appendChild(body);}
    const l=lang(),now=new Date(),visits=loadVisits(),tabs=railTabs();
    const byTab=new Map(tabs.map(item=>[item.tab,item]));
    const ranked=rankTabs(tabs.map(item=>item.tab),visits).map(tab=>byTab.get(tab)).filter(Boolean);
    const user=window.BL_USER_CONTEXT||{};
    const name=String(user.displayName||user.username||'').trim().split(/\s+/)[0]||'';
    const locale=l==='en'?'en-GB':'tr-TR';
    const date=`${now.toLocaleDateString(locale,{weekday:'long'})}, ${now.toLocaleDateString(locale,{day:'numeric',month:'long',year:'numeric'})}`;
    const hasHistory=ranked.some(item=>visits[item.tab]);
    const sub=hasHistory
      ?(l==='en'?'Your most used workspaces, one click away.':'En sık kullandığın çalışma alanları tek tık uzağında.')
      :(l==='en'?'Pick a workspace to start. Your favourites will surface here as you work.':'Başlamak için bir çalışma alanı seç. Kullandıkça favorilerin burada öne çıkar.');
    const tiles=ranked.map(item=>{
      const visit=visits[item.tab];
      const meta=visit?relativeTime(visit.last,l):item.group;
      return `<button type="button" class="ovLaunchTile" data-launch-tab="${esc(item.tab)}" title="${esc(item.label)}">`+
        `<span class="ovLaunchIcon" aria-hidden="true"><svg class="ic"><use href="${esc(item.icon)}"/></svg></span>`+
        `<span class="ovLaunchText"><b>${esc(item.label)}</b><small>${esc(meta)}</small></span>`+
        `<svg class="ic ovLaunchArrow" aria-hidden="true"><use href="#i-chevron-right"/></svg></button>`;
    }).join('');
    body.innerHTML=`<div class="ovLaunchHead"><div class="ovLaunchHeading">`+
      `<p class="ovLaunchDate">${esc(date)}</p>`+
      `<h2 class="ovLaunchTitle">${esc(greeting(now.getHours(),l))}${name?`, ${esc(name)}`:''}</h2>`+
      `<p class="ovLaunchSub">${esc(sub)}</p>`+pulseHtml(l)+`</div></div>`+
      (tiles?`<div class="ovLaunchGrid" role="list" aria-label="${esc(l==='en'?'Quick access':'Hızlı erişim')}">${tiles}</div>`:'');
  }

  function bind(){
    const host=document.getElementById('ovLaunchpad');if(!host||host.dataset.bound)return;host.dataset.bound='1';
    host.addEventListener('click',event=>{
      const tile=event.target.closest('[data-launch-tab]');if(!tile)return;
      document.querySelector(`nav.tabs button[data-tab="${CSS.escape(tile.dataset.launchTab)}"]`)?.click();
    });
    let lastTab=document.body.dataset.activeTab||'';
    new MutationObserver(()=>{
      const tab=document.body.dataset.activeTab||'';if(tab===lastTab)return;lastTab=tab;
      if(tab&&tab!==HOME_TAB)saveVisits(recordVisit(loadVisits(),tab,Date.now()));
      if(tab===HOME_TAB)render();
    }).observe(document.body,{attributes:true,attributeFilter:['data-active-tab']});
    new MutationObserver(render).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
    window.addEventListener('bl:user-access-applied',render);
    const refreshBtn=document.getElementById('topRefreshBtn');
    if(refreshBtn)new MutationObserver(()=>{
      const pulse=host.querySelector('.ovLaunchPulse');
      if(pulse&&pulse.dataset.pulse!==(refreshing()?'thinking':'idle'))render();
    }).observe(refreshBtn,{attributes:true,attributeFilter:['class']});
    render();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});
  else bind();
  return {STORAGE_KEY,greetingKey,greeting,normalizeVisits,recordVisit,rankTabs,render};
});
