/* Genel Bakış · Bugün + canlı dünya saatleri.
   Sayfa kısayolları kaldırıldı. Saat seçimi kullanıcı-kapsamlı BLStorage'da
   tutulur; Intl/IANA time-zone kullanıldığı için yaz/kış saati otomatik işler. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.BLOverviewLaunchpad=factory();
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const STORAGE_KEY='buyerlog.overview.worldClocks.v1';
  const DEFAULT_CLOCKS=Object.freeze(['TR','BD','IN','CN','EG']);
  const CLOCKS=Object.freeze([
    {id:'TR',tr:'Türkiye',en:'Türkiye',timeZone:'Europe/Istanbul'},
    {id:'BD',tr:'Bangladeş',en:'Bangladesh',timeZone:'Asia/Dhaka'},
    {id:'IN',tr:'Hindistan',en:'India',timeZone:'Asia/Kolkata'},
    {id:'CN',tr:'Çin',en:'China',timeZone:'Asia/Shanghai'},
    {id:'EG',tr:'Mısır',en:'Egypt',timeZone:'Africa/Cairo'},
    {id:'PK',tr:'Pakistan',en:'Pakistan',timeZone:'Asia/Karachi'},
    {id:'VN',tr:'Vietnam',en:'Vietnam',timeZone:'Asia/Ho_Chi_Minh'},
    {id:'ID',tr:'Endonezya',en:'Indonesia',timeZone:'Asia/Jakarta'},
    {id:'GB',tr:'Birleşik Krallık',en:'United Kingdom',timeZone:'Europe/London'},
    {id:'DE',tr:'Almanya',en:'Germany',timeZone:'Europe/Berlin'},
    {id:'IT',tr:'İtalya',en:'Italy',timeZone:'Europe/Rome'},
    {id:'ES',tr:'İspanya',en:'Spain',timeZone:'Europe/Madrid'},
    {id:'US-NY',tr:'ABD · New York',en:'USA · New York',timeZone:'America/New_York'},
    {id:'US-LA',tr:'ABD · Los Angeles',en:'USA · Los Angeles',timeZone:'America/Los_Angeles'},
    {id:'BR',tr:'Brezilya',en:'Brazil',timeZone:'America/Sao_Paulo'},
    {id:'MX',tr:'Meksika',en:'Mexico',timeZone:'America/Mexico_City'},
    {id:'ZA',tr:'Güney Afrika',en:'South Africa',timeZone:'Africa/Johannesburg'},
    {id:'AE',tr:'BAE',en:'UAE',timeZone:'Asia/Dubai'},
    {id:'SA',tr:'Suudi Arabistan',en:'Saudi Arabia',timeZone:'Asia/Riyadh'},
    {id:'JP',tr:'Japonya',en:'Japan',timeZone:'Asia/Tokyo'},
    {id:'KR',tr:'Güney Kore',en:'South Korea',timeZone:'Asia/Seoul'},
    {id:'AU',tr:'Avustralya · Sidney',en:'Australia · Sydney',timeZone:'Australia/Sydney'},
  ]);
  const BY_ID=new Map(CLOCKS.map(item=>[item.id,item]));

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
  function normalizeSelection(value){
    if(!Array.isArray(value))return DEFAULT_CLOCKS.slice();
    const seen=new Set(),out=[];
    value.forEach(id=>{id=String(id||'').trim();if(BY_ID.has(id)&&!seen.has(id)&&out.length<12){seen.add(id);out.push(id);}});
    return out;
  }
  function clockParts(date,timeZone,lang='tr'){
    const locale=lang==='en'?'en-GB':'tr-TR';
    const parts=new Intl.DateTimeFormat(locale,{timeZone,hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',weekday:'short',day:'2-digit',month:'short'}).formatToParts(date);
    const map=Object.fromEntries(parts.map(part=>[part.type,part.value]));
    return {time:[map.hour,map.minute,map.second].filter(Boolean).join(':'),date:[map.weekday,map.day,map.month].filter(Boolean).join(' ')};
  }

  if(typeof document==='undefined')return {STORAGE_KEY,DEFAULT_CLOCKS,CLOCKS,greetingKey,greeting,normalizeSelection,clockParts};

  const lang=()=>(document.documentElement.lang||'tr').toLowerCase().startsWith('en')?'en':'tr';
  const esc=value=>String(value==null?'':value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  function store(){return window.BLStorage||null;}
  function loadSelection(){try{const raw=store()?.getItem(STORAGE_KEY);return raw==null?DEFAULT_CLOCKS.slice():normalizeSelection(JSON.parse(raw));}catch(_){return DEFAULT_CLOCKS.slice();}}
  function saveSelection(value){try{store()?.setItem(STORAGE_KEY,JSON.stringify(normalizeSelection(value)));}catch(_){}}
  function refreshing(){return Boolean(document.getElementById('topRefreshBtn')?.classList.contains('spinning'));}
  function pulseHtml(l){
    const busy=refreshing();
    const text=busy?(l==='en'?'Refreshing data…':'Veriler yenileniyor…'):(l==='en'?'Workspace ready':'Çalışma alanı hazır');
    return '<p class="ovLaunchPulse" data-pulse="'+(busy?'thinking':'idle')+'"><span class="blOrb blOrb--sm" data-state="'+(busy?'thinking':'idle')+'" aria-hidden="true"></span><span>'+esc(text)+'</span></p>';
  }
  function countryName(item,l){return item?(l==='en'?item.en:item.tr):'';}
  function tick(){
    const host=document.getElementById('ovLaunchpad');if(!host)return;
    const now=new Date(),l=lang();
    host.querySelectorAll('[data-clock-zone]').forEach(card=>{
      try{
        const parts=clockParts(now,card.dataset.clockZone,l);
        const time=card.querySelector('[data-clock-time]'),date=card.querySelector('[data-clock-date]');
        if(time)time.textContent=parts.time;if(date)date.textContent=parts.date;
      }catch(_){}
    });
  }
  let manageOpen=false,timer=0;
  function render(){
    const host=document.getElementById('ovLaunchpad');if(!host)return;
    let body=host.querySelector(':scope > .ovLaunchBody');
    if(!body){body=document.createElement('div');body.className='ovLaunchBody';host.appendChild(body);}
    const l=lang(),now=new Date(),selected=loadSelection(),user=window.BL_USER_CONTEXT||{};
    const name=String(user.displayName||user.username||'').trim().split(/\s+/)[0]||'';
    const locale=l==='en'?'en-GB':'tr-TR';
    const date=now.toLocaleDateString(locale,{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    const cards=selected.map(id=>{
      const item=BY_ID.get(id);if(!item)return '';
      let parts={time:'--:--:--',date:''};try{parts=clockParts(now,item.timeZone,l);}catch(_){}
      return '<div class="ovClockCard" data-clock-id="'+esc(item.id)+'" data-clock-zone="'+esc(item.timeZone)+'">'+
        '<div class="ovClockCountry"><span class="ovClockCode">'+esc(item.id.replace(/^US-/,'US'))+'</span><span>'+esc(countryName(item,l))+'</span></div>'+
        '<div class="ovClockTime" data-clock-time>'+esc(parts.time)+'</div><div class="ovClockDate" data-clock-date>'+esc(parts.date)+'</div>'+
        (manageOpen?'<button type="button" class="ovClockRemove" data-clock-remove="'+esc(item.id)+'" title="'+esc(l==='en'?'Remove clock':'Saati kaldır')+'">×</button>':'')+
      '</div>';
    }).join('');
    const available=CLOCKS.filter(item=>!selected.includes(item.id));
    const controls=manageOpen
      ?'<div class="ovClockAddControls"><select data-clock-select aria-label="'+esc(l==='en'?'Country / time zone':'Ülke / saat dilimi')+'">'+
        (available.length?available.map(item=>'<option value="'+esc(item.id)+'">'+esc(countryName(item,l))+'</option>').join(''):'<option value="">'+esc(l==='en'?'All available clocks added':'Tüm saatler eklendi')+'</option>')+
        '</select><button type="button" class="ovClockAddBtn" data-clock-add'+(available.length?'':' disabled')+'>'+esc(l==='en'?'Add':'Ekle')+'</button></div>'
      :'';
    body.innerHTML='<div class="ovLaunchHead"><div class="ovLaunchHeading"><p class="ovLaunchDate">'+esc(date)+'</p>'+
      '<h2 class="ovLaunchTitle">'+esc(greeting(now.getHours(),l))+(name?', '+esc(name):'')+'</h2>'+
      '<p class="ovLaunchSub">'+esc(l==='en'?'Live local times for the countries you work with.':'Çalıştığın ülkelerin canlı yerel saatleri.')+'</p>'+pulseHtml(l)+'</div></div>'+
      '<div class="ovClockPanel"><div class="ovClockToolbar"><button type="button" class="ovClockManageBtn" data-clock-manage aria-pressed="'+(manageOpen?'true':'false')+'">'+
      esc(manageOpen?(l==='en'?'Done':'Tamam'):(l==='en'?'Manage clocks':'Saatleri düzenle'))+'</button></div>'+controls+
      (cards?'<div class="ovClockGrid">'+cards+'</div>':'<div class="ovClockEmpty">'+esc(l==='en'?'No clocks selected. Use Manage clocks to add one.':'Saat seçili değil. Eklemek için Saatleri düzenle seçeneğini kullan.')+'</div>')+'</div>';
    tick();
  }
  function bind(){
    const host=document.getElementById('ovLaunchpad');if(!host||host.dataset.bound)return;host.dataset.bound='1';
    host.addEventListener('click',event=>{
      if(event.target.closest('[data-clock-manage]')){manageOpen=!manageOpen;render();return;}
      const remove=event.target.closest('[data-clock-remove]');
      if(remove){saveSelection(loadSelection().filter(id=>id!==remove.dataset.clockRemove));render();return;}
      if(event.target.closest('[data-clock-add]')){
        const select=host.querySelector('[data-clock-select]'),id=String(select?.value||'');if(id&&BY_ID.has(id)){saveSelection(loadSelection().concat(id));render();}return;
      }
    });
    new MutationObserver(render).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
    window.addEventListener('bl:user-access-applied',render);
    const refreshBtn=document.getElementById('topRefreshBtn');
    if(refreshBtn)new MutationObserver(()=>{
      const pulse=host.querySelector('.ovLaunchPulse');
      if(pulse&&pulse.dataset.pulse!==(refreshing()?'thinking':'idle'))render();
    }).observe(refreshBtn,{attributes:true,attributeFilter:['class']});
    render();timer=window.setInterval(tick,1000);
    window.addEventListener('beforeunload',()=>{if(timer)clearInterval(timer);},{once:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
  return {STORAGE_KEY,DEFAULT_CLOCKS,CLOCKS,greetingKey,greeting,normalizeSelection,clockParts,render};
});
