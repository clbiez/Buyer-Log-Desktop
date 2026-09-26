/* Genel Bakış · Bugün + canlı dünya saatleri.
   Sayfa kısayolları kaldırıldı. Saat seçimi kullanıcı-kapsamlı BLStorage'da
   tutulur; Intl/IANA time-zone kullanıldığı için yaz/kış saati otomatik işler. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.BLOverviewLaunchpad=factory();
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const STORAGE_KEY='buyerlog.overview.worldClocks.v1';
  const DISPLAY_KEY='buyerlog.overview.worldClocks.display.v1';
  const DEFAULT_CLOCKS=Object.freeze(['TR','BD','IN','CN','EG']);
  const DEFAULT_DISPLAY='digital';
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
  function supportedTimeZones(){
    try{
      if(typeof Intl.supportedValuesOf==='function')return Intl.supportedValuesOf('timeZone');
    }catch(_){}
    return [...new Set(CLOCKS.map(item=>item.timeZone))];
  }
  const TIME_ZONE_SET=new Set(supportedTimeZones());
  function zoneLabel(zone){
    return String(zone||'').split('/').map(part=>part.replace(/_/g,' ')).join(' · ');
  }
  function clockFromId(id){
    const key=String(id||'').trim();
    if(BY_ID.has(key))return BY_ID.get(key);
    if(key.startsWith('TZ:')){
      const zone=key.slice(3);
      if(TIME_ZONE_SET.has(zone))return {id:key,tr:zoneLabel(zone),en:zoneLabel(zone),timeZone:zone,dynamic:true};
    }
    return null;
  }
  function normalizeDisplayMode(value){return ['digital','analog','both'].includes(String(value||''))?String(value):DEFAULT_DISPLAY;}

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
    value.forEach(id=>{id=String(id||'').trim();if(clockFromId(id)&&!seen.has(id)){seen.add(id);out.push(id);}});
    return out;
  }
  function clockParts(date,timeZone,lang='tr'){
    const locale=lang==='en'?'en-GB':'tr-TR';
    const parts=new Intl.DateTimeFormat(locale,{timeZone,hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',weekday:'short',day:'2-digit',month:'short'}).formatToParts(date);
    const map=Object.fromEntries(parts.map(part=>[part.type,part.value]));
    return {
      time:[map.hour,map.minute,map.second].filter(Boolean).join(':'),
      date:[map.weekday,map.day,map.month].filter(Boolean).join(' '),
      hour:Number(map.hour)||0,minute:Number(map.minute)||0,second:Number(map.second)||0,
    };
  }
  function clockAngles(parts){
    const hour=(Number(parts&&parts.hour)||0)%12,minute=Number(parts&&parts.minute)||0,second=Number(parts&&parts.second)||0;
    return {hour:(hour+minute/60+second/3600)*30,minute:(minute+second/60)*6,second:second*6};
  }

  if(typeof document==='undefined')return {STORAGE_KEY,DISPLAY_KEY,DEFAULT_CLOCKS,DEFAULT_DISPLAY,CLOCKS,greetingKey,greeting,normalizeSelection,normalizeDisplayMode,clockParts,clockAngles,supportedTimeZones,clockFromId};

  const lang=()=>(document.documentElement.lang||'tr').toLowerCase().startsWith('en')?'en':'tr';
  const esc=value=>String(value==null?'':value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  function store(){return window.BLStorage||null;}
  function loadSelection(){try{const raw=store()?.getItem(STORAGE_KEY);return raw==null?DEFAULT_CLOCKS.slice():normalizeSelection(JSON.parse(raw));}catch(_){return DEFAULT_CLOCKS.slice();}}
  function saveSelection(value){try{store()?.setItem(STORAGE_KEY,JSON.stringify(normalizeSelection(value)));}catch(_){}}
  function loadDisplayMode(){try{return normalizeDisplayMode(store()?.getItem(DISPLAY_KEY));}catch(_){return DEFAULT_DISPLAY;}}
  function saveDisplayMode(value){try{store()?.setItem(DISPLAY_KEY,normalizeDisplayMode(value));}catch(_){}}
  function refreshing(){return Boolean(document.getElementById('topRefreshBtn')?.classList.contains('spinning'));}
  function pulseHtml(l){
    if(!refreshing())return '';
    const text=l==='en'?'Refreshing data…':'Veriler yenileniyor…';
    return '<p class="ovLaunchPulse" data-pulse="thinking"><span class="blOrb blOrb--sm" data-state="thinking" aria-hidden="true"></span><span>'+esc(text)+'</span></p>';
  }
  function countryName(item,l){return item?(l==='en'?item.en:item.tr):'';}
  function analogHtml(parts){
    const a=clockAngles(parts);
    return '<div class="ovAnalogClock" data-clock-analog aria-hidden="true"><span class="ovAnalogDialMark ovAnalogDialMark--12">12</span><span class="ovAnalogDialMark ovAnalogDialMark--3">3</span><span class="ovAnalogDialMark ovAnalogDialMark--6">6</span><span class="ovAnalogDialMark ovAnalogDialMark--9">9</span><i class="ovAnalogHand ovAnalogHand--hour" data-clock-hand="hour" style="transform:translateX(-50%) rotate('+a.hour+'deg)"></i><i class="ovAnalogHand ovAnalogHand--minute" data-clock-hand="minute" style="transform:translateX(-50%) rotate('+a.minute+'deg)"></i><i class="ovAnalogHand ovAnalogHand--second" data-clock-hand="second" style="transform:translateX(-50%) rotate('+a.second+'deg)"></i><b class="ovAnalogPin"></b></div>';
  }
  function tick(){
    const host=document.getElementById('ovLaunchpad');if(!host)return;
    const now=new Date(),l=lang();
    host.querySelectorAll('[data-clock-zone]').forEach(card=>{
      try{
        const parts=clockParts(now,card.dataset.clockZone,l),angles=clockAngles(parts);
        const time=card.querySelector('[data-clock-time]'),date=card.querySelector('[data-clock-date]');
        if(time)time.textContent=parts.time;if(date)date.textContent=parts.date;
        for(const key of ['hour','minute','second']){
          const hand=card.querySelector('[data-clock-hand="'+key+'"]');if(hand)hand.style.transform='translateX(-50%) rotate('+angles[key]+'deg)';
        }
      }catch(_){}
    });
  }
  let manageOpen=false,timer=0;
  function render(){
    const host=document.getElementById('ovLaunchpad');if(!host)return;
    let body=host.querySelector(':scope > .ovLaunchBody');
    if(!body){body=document.createElement('div');body.className='ovLaunchBody';host.appendChild(body);}
    const l=lang(),now=new Date(),selected=loadSelection(),displayMode=loadDisplayMode(),user=window.BL_USER_CONTEXT||{};
    const name=String(user.displayName||user.username||'').trim().split(/\s+/)[0]||'';
    const locale=l==='en'?'en-GB':'tr-TR';
    const date=now.toLocaleDateString(locale,{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    const cards=selected.map(id=>{
      const item=clockFromId(id);if(!item)return '';
      let parts={time:'--:--:--',date:'',hour:0,minute:0,second:0};try{parts=clockParts(now,item.timeZone,l);}catch(_){}
      const showAnalog=displayMode==='analog'||displayMode==='both',showDigital=displayMode==='digital'||displayMode==='both';
      const code=item.dynamic?'TZ':item.id.replace(/^US-/,'US');
      return '<div class="ovClockCard" data-clock-id="'+esc(item.id)+'" data-clock-zone="'+esc(item.timeZone)+'" data-clock-display="'+esc(displayMode)+'">'+
        '<div class="ovClockCountry"><span class="ovClockCode">'+esc(code)+'</span><span>'+esc(countryName(item,l))+'</span></div>'+
        '<div class="ovClockReadout is-'+esc(displayMode)+'">'+(showAnalog?analogHtml(parts):'')+'<div class="ovClockText">'+
          (showDigital?'<div class="ovClockTime" data-clock-time>'+esc(parts.time)+'</div>':'')+'<div class="ovClockDate" data-clock-date>'+esc(parts.date)+'</div></div></div>'+
        (manageOpen?'<button type="button" class="ovClockRemove" data-clock-remove="'+esc(item.id)+'" title="'+esc(l==='en'?'Remove clock':'Saati kaldır')+'">×</button>':'')+
      '</div>';
    }).join('');
    const selectedZones=new Set(selected.map(id=>clockFromId(id)?.timeZone).filter(Boolean));
    const available=CLOCKS.filter(item=>!selected.includes(item.id));
    const extraZones=supportedTimeZones().filter(zone=>!selectedZones.has(zone)&&!CLOCKS.some(item=>item.timeZone===zone));
    const controls=manageOpen
      ?'<div class="ovClockManageControls"><label class="ovClockModeControl"><span>'+esc(l==='en'?'Clock style':'Saat görünümü')+'</span><select data-clock-display-select><option value="digital"'+(displayMode==='digital'?' selected':'')+'>'+esc(l==='en'?'Digital':'Dijital')+'</option><option value="analog"'+(displayMode==='analog'?' selected':'')+'>'+esc(l==='en'?'Analog':'Analog')+'</option><option value="both"'+(displayMode==='both'?' selected':'')+'>'+esc(l==='en'?'Analog + digital':'Analog + dijital')+'</option></select></label>'+
        '<div class="ovClockAddControls"><select data-clock-select aria-label="'+esc(l==='en'?'Country / time zone':'Ülke / saat dilimi')+'">'+
        '<optgroup label="'+esc(l==='en'?'Common countries':'Sık kullanılan ülkeler')+'">'+available.map(item=>'<option value="'+esc(item.id)+'">'+esc(countryName(item,l))+'</option>').join('')+'</optgroup>'+
        '<optgroup label="'+esc(l==='en'?'All world time zones':'Tüm dünya saat dilimleri')+'">'+extraZones.map(zone=>'<option value="'+esc('TZ:'+zone)+'">'+esc(zoneLabel(zone))+'</option>').join('')+'</optgroup>'+
        '</select><button type="button" class="ovClockAddBtn" data-clock-add'+((available.length||extraZones.length)?'':' disabled')+'>'+esc(l==='en'?'Add':'Ekle')+'</button></div></div>'
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
        const select=host.querySelector('[data-clock-select]'),id=String(select?.value||'');if(id&&clockFromId(id)){saveSelection(loadSelection().concat(id));render();}return;
      }
    });
    host.addEventListener('change',event=>{
      const mode=event.target.closest('[data-clock-display-select]');if(mode){saveDisplayMode(mode.value);render();}
    });
    new MutationObserver(render).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
    window.addEventListener('bl:user-access-applied',render);
    const refreshBtn=document.getElementById('topRefreshBtn');
    if(refreshBtn)new MutationObserver(()=>{
      const pulse=host.querySelector('.ovLaunchPulse');
      if(refreshing()||pulse)render();
    }).observe(refreshBtn,{attributes:true,attributeFilter:['class']});
    render();timer=window.setInterval(tick,1000);
    window.addEventListener('beforeunload',()=>{if(timer)clearInterval(timer);},{once:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
  return {STORAGE_KEY,DISPLAY_KEY,DEFAULT_CLOCKS,DEFAULT_DISPLAY,CLOCKS,greetingKey,greeting,normalizeSelection,normalizeDisplayMode,clockParts,clockAngles,supportedTimeZones,clockFromId,render};
});
