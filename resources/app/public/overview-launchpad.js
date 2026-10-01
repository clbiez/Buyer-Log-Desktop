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
  const HOLIDAY_KEY='buyerlog.overview.worldClocks.holidays.v1';
  const HOLIDAY_PERIOD_KEY='buyerlog.overview.worldClocks.holidayMonths.v1';
  const HOLIDAY_API='https://date.nager.at/api/v3/PublicHolidays';
  const DEFAULT_HOLIDAY_MONTHS=3;
  const HOLIDAY_MONTH_OPTIONS=Object.freeze([1,3,6,12]);
  const HOLIDAY_MAX_ITEMS=50;
  const DEFAULT_CLOCKS=Object.freeze(['TR','BD','IN','CN','EG']);
  const DEFAULT_DISPLAY='digital';
  const CLOCKS=Object.freeze([
    {id:'TR',tr:'Türkiye',en:'Türkiye',timeZone:'Europe/Istanbul',countryCode:'TR'},
    {id:'BD',tr:'Bangladeş',en:'Bangladesh',timeZone:'Asia/Dhaka',countryCode:'BD'},
    {id:'IN',tr:'Hindistan',en:'India',timeZone:'Asia/Kolkata',countryCode:'IN'},
    {id:'CN',tr:'Çin',en:'China',timeZone:'Asia/Shanghai',countryCode:'CN'},
    {id:'EG',tr:'Mısır',en:'Egypt',timeZone:'Africa/Cairo',countryCode:'EG'},
    {id:'PK',tr:'Pakistan',en:'Pakistan',timeZone:'Asia/Karachi',countryCode:'PK'},
    {id:'VN',tr:'Vietnam',en:'Vietnam',timeZone:'Asia/Ho_Chi_Minh',countryCode:'VN'},
    {id:'ID',tr:'Endonezya',en:'Indonesia',timeZone:'Asia/Jakarta',countryCode:'ID'},
    {id:'GB',tr:'Birleşik Krallık',en:'United Kingdom',timeZone:'Europe/London',countryCode:'GB'},
    {id:'DE',tr:'Almanya',en:'Germany',timeZone:'Europe/Berlin',countryCode:'DE'},
    {id:'IT',tr:'İtalya',en:'Italy',timeZone:'Europe/Rome',countryCode:'IT'},
    {id:'ES',tr:'İspanya',en:'Spain',timeZone:'Europe/Madrid',countryCode:'ES'},
    {id:'US-NY',tr:'ABD · New York',en:'USA · New York',timeZone:'America/New_York',countryCode:'US'},
    {id:'US-LA',tr:'ABD · Los Angeles',en:'USA · Los Angeles',timeZone:'America/Los_Angeles',countryCode:'US'},
    {id:'BR',tr:'Brezilya',en:'Brazil',timeZone:'America/Sao_Paulo',countryCode:'BR'},
    {id:'MX',tr:'Meksika',en:'Mexico',timeZone:'America/Mexico_City',countryCode:'MX'},
    {id:'ZA',tr:'Güney Afrika',en:'South Africa',timeZone:'Africa/Johannesburg',countryCode:'ZA'},
    {id:'AE',tr:'BAE',en:'UAE',timeZone:'Asia/Dubai',countryCode:'AE'},
    {id:'SA',tr:'Suudi Arabistan',en:'Saudi Arabia',timeZone:'Asia/Riyadh',countryCode:'SA'},
    {id:'JP',tr:'Japonya',en:'Japan',timeZone:'Asia/Tokyo',countryCode:'JP'},
    {id:'KR',tr:'Güney Kore',en:'South Korea',timeZone:'Asia/Seoul',countryCode:'KR'},
    {id:'AU',tr:'Avustralya · Sidney',en:'Australia · Sydney',timeZone:'Australia/Sydney',countryCode:'AU'},
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
  function normalizeHolidayPref(value){return value==null?true:!['0','false','off','no'].includes(String(value).trim().toLowerCase());}
  function normalizeHolidayMonths(value){const n=Math.round(Number(value));return HOLIDAY_MONTH_OPTIONS.includes(n)?n:DEFAULT_HOLIDAY_MONTHS;}
  function addMonthsISO(localISO,months){
    const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(localISO||''));if(!match)return '';
    const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]),count=normalizeHolidayMonths(months);
    const first=new Date(Date.UTC(year,month-1+count,1)),targetYear=first.getUTCFullYear(),targetMonth=first.getUTCMonth();
    const lastDay=new Date(Date.UTC(targetYear,targetMonth+1,0)).getUTCDate(),targetDay=Math.min(day,lastDay);
    return [targetYear,String(targetMonth+1).padStart(2,'0'),String(targetDay).padStart(2,'0')].join('-');
  }
  function zonedISODate(date,timeZone){
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
    const map=Object.fromEntries(parts.map(part=>[part.type,part.value]));
    return [map.year,map.month,map.day].join('-');
  }
  function isoDayDiff(fromISO,toISO){
    const a=Date.parse(String(fromISO||'')+'T00:00:00Z'),b=Date.parse(String(toISO||'')+'T00:00:00Z');
    return Number.isFinite(a)&&Number.isFinite(b)?Math.round((b-a)/86400000):NaN;
  }
  function upcomingHolidays(holidays,localISO,months=DEFAULT_HOLIDAY_MONTHS,limit=HOLIDAY_MAX_ITEMS){
    const cutoff=addMonthsISO(localISO,months);if(!cutoff)return [];
    return (Array.isArray(holidays)?holidays:[]).filter(item=>item&&item.date&&item.global!==false).map(item=>({item,diff:isoDayDiff(localISO,item.date)})).filter(entry=>Number.isFinite(entry.diff)&&entry.diff>=0&&String(entry.item.date)<=cutoff).sort((a,b)=>a.diff-b.diff||String(a.item.date).localeCompare(String(b.item.date))).slice(0,Math.max(1,Number(limit)||HOLIDAY_MAX_ITEMS)).map(entry=>entry.item);
  }
  function clockSearchKey(value){return String(value==null?'':value).toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').replace(/[_/.-]+/g,' ').replace(/\s+/g,' ').trim();}
  function clockMatchesSearch(item,query,l='tr'){
    if(!item)return false;const q=clockSearchKey(query);if(!q)return true;
    return clockSearchKey([item.tr,item.en,item.timeZone,zoneLabel(item.timeZone),countryName(item,l)].join(' ')).includes(q);
  }

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
  // Intl.DateTimeFormat kurulumu pahalıdır; saniyelik tick her saat için yenisini kurmasın.
  const formatterCache=new Map();
  function clockFormatter(locale,timeZone){
    const key=locale+'|'+timeZone;let formatter=formatterCache.get(key);
    if(!formatter){formatter=new Intl.DateTimeFormat(locale,{timeZone,hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',weekday:'short',day:'2-digit',month:'short'});formatterCache.set(key,formatter);}
    return formatter;
  }
  function clockParts(date,timeZone,lang='tr'){
    const locale=lang==='en'?'en-GB':'tr-TR';
    const parts=clockFormatter(locale,timeZone).formatToParts(date);
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

  if(typeof document==='undefined')return {STORAGE_KEY,DISPLAY_KEY,HOLIDAY_KEY,HOLIDAY_PERIOD_KEY,DEFAULT_HOLIDAY_MONTHS,HOLIDAY_MONTH_OPTIONS,HOLIDAY_MAX_ITEMS,DEFAULT_CLOCKS,DEFAULT_DISPLAY,CLOCKS,greetingKey,greeting,normalizeSelection,normalizeDisplayMode,normalizeHolidayPref,normalizeHolidayMonths,addMonthsISO,zonedISODate,isoDayDiff,upcomingHolidays,clockParts,clockAngles,supportedTimeZones,clockFromId,clockSearchKey,clockMatchesSearch};

  const lang=()=>(document.documentElement.lang||'tr').toLowerCase().startsWith('en')?'en':'tr';
  const esc=value=>String(value==null?'':value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  function store(){return window.BLStorage||null;}
  function loadSelection(){try{const raw=store()?.getItem(STORAGE_KEY);return raw==null?DEFAULT_CLOCKS.slice():normalizeSelection(JSON.parse(raw));}catch(_){return DEFAULT_CLOCKS.slice();}}
  function saveSelection(value){try{store()?.setItem(STORAGE_KEY,JSON.stringify(normalizeSelection(value)));}catch(_){}}
  function loadDisplayMode(){try{return normalizeDisplayMode(store()?.getItem(DISPLAY_KEY));}catch(_){return DEFAULT_DISPLAY;}}
  function saveDisplayMode(value){try{store()?.setItem(DISPLAY_KEY,normalizeDisplayMode(value));}catch(_){}}
  function loadHolidayEnabled(){try{return normalizeHolidayPref(store()?.getItem(HOLIDAY_KEY));}catch(_){return true;}}
  function saveHolidayEnabled(value){try{store()?.setItem(HOLIDAY_KEY,value?'1':'0');}catch(_){}}
  function loadHolidayMonths(){try{return normalizeHolidayMonths(store()?.getItem(HOLIDAY_PERIOD_KEY));}catch(_){return DEFAULT_HOLIDAY_MONTHS;}}
  function saveHolidayMonths(value){try{store()?.setItem(HOLIDAY_PERIOD_KEY,String(normalizeHolidayMonths(value)));}catch(_){}}
  function refreshing(){return Boolean(document.getElementById('topRefreshBtn')?.classList.contains('spinning'));}
  function pulseHtml(l){
    if(!refreshing())return '';
    const text=l==='en'?'Refreshing data…':'Veriler yenileniyor…';
    return '<p class="ovLaunchPulse" data-pulse="thinking"><span class="blOrb blOrb--sm" data-state="thinking" aria-hidden="true"></span><span>'+esc(text)+'</span></p>';
  }
  function countryName(item,l){return item?(l==='en'?item.en:item.tr):'';}
  function filterClockOptions(host,value){
    const select=host&&host.querySelector('[data-clock-select]');if(!select)return;
    const q=clockSearchKey(value),options=[...select.querySelectorAll('option')];let first=null;
    options.forEach(option=>{const show=!q||clockSearchKey(option.dataset.clockSearchText||option.textContent).includes(q);option.hidden=!show;option.disabled=!show;if(show&&!first)first=option;});
    select.querySelectorAll('optgroup').forEach(group=>{group.hidden=![...group.querySelectorAll('option')].some(option=>!option.hidden);});
    const current=select.selectedOptions&&select.selectedOptions[0];if(first&&(!current||current.hidden||current.disabled))select.value=first.value;
  }
  const holidayCache=new Map();
  function fetchHolidayYear(year,countryCode){
    const code=String(countryCode||'').toUpperCase(),key=code+'|'+year;
    if(!code)return Promise.resolve([]);
    if(holidayCache.has(key))return holidayCache.get(key);
    const request=fetch(HOLIDAY_API+'/'+encodeURIComponent(year)+'/'+encodeURIComponent(code),{headers:{Accept:'application/json'}})
      .then(response=>response.ok?response.json():Promise.reject(new Error('holiday '+response.status)))
      .then(rows=>Array.isArray(rows)?rows:[]).catch(()=>[]);
    holidayCache.set(key,request);return request;
  }
  function holidayDateLabel(iso,l){
    const date=new Date(String(iso||'')+'T12:00:00Z');
    if(!Number.isFinite(date.getTime()))return '';
    return new Intl.DateTimeFormat(l==='en'?'en-GB':'tr-TR',{day:'numeric',month:'short'}).format(date);
  }
  function holidayWhenLabel(diff,l){
    if(diff===0)return l==='en'?'Today':'Bugün';
    if(diff===1)return l==='en'?'Tomorrow':'Yarın';
    return l==='en'?diff+' days':diff+' gün';
  }
  function holidayPeriodLabel(months,l){
    const n=normalizeHolidayMonths(months);return l==='en'?'Next '+n+' '+(n===1?'month':'months'):'Önümüzdeki '+n+' ay';
  }
  function holidayMarkup(rows,localISO,l,months){
    if(!rows.length)return '';
    return '<div class="ovClockHolidayTitle"><span>'+esc(l==='en'?'Upcoming public holidays':'Yakındaki resmi tatiller')+'</span><small>'+esc(holidayPeriodLabel(months,l))+'</small></div>'+rows.map(item=>{
      const diff=isoDayDiff(localISO,item.date),name=String(item.name||item.localName||'').trim();
      return '<div class="ovClockHoliday"><span class="ovClockHolidayWhen">'+esc(holidayWhenLabel(diff,l))+'</span><span class="ovClockHolidayName">'+esc(name)+'</span><span class="ovClockHolidayDate">'+esc(holidayDateLabel(item.date,l))+'</span></div>';
    }).join('');
  }
  let holidayRenderSeq=0;
  async function refreshHolidayNotes(){
    const seq=++holidayRenderSeq,host=document.getElementById('ovLaunchpad');if(!host||!loadHolidayEnabled())return;
    const now=new Date(),l=lang(),holidayMonths=loadHolidayMonths(),nodes=[...host.querySelectorAll('[data-clock-holidays][data-clock-country]')];
    await Promise.all(nodes.map(async node=>{
      const code=String(node.dataset.clockCountry||''),zone=String(node.dataset.clockZone||'');if(!code||!zone)return;
      let localISO='';try{localISO=zonedISODate(now,zone);}catch(_){return;}
      const year=Number(localISO.slice(0,4));if(!year)return;
      const sets=await Promise.all([fetchHolidayYear(year,code),fetchHolidayYear(year+1,code)]);
      if(seq!==holidayRenderSeq||!node.isConnected)return;
      const rows=upcomingHolidays(sets.flat(),localISO,holidayMonths);
      node.innerHTML=holidayMarkup(rows,localISO,l,holidayMonths);node.hidden=!rows.length;
    }));
  }
  function analogHtml(parts){
    const a=clockAngles(parts);
    return '<div class="ovAnalogClock" data-clock-analog aria-hidden="true"><span class="ovAnalogDialMark ovAnalogDialMark--12">12</span><span class="ovAnalogDialMark ovAnalogDialMark--3">3</span><span class="ovAnalogDialMark ovAnalogDialMark--6">6</span><span class="ovAnalogDialMark ovAnalogDialMark--9">9</span><i class="ovAnalogHand ovAnalogHand--hour" data-clock-hand="hour" style="transform:translateX(-50%) rotate('+a.hour+'deg)"></i><i class="ovAnalogHand ovAnalogHand--minute" data-clock-hand="minute" style="transform:translateX(-50%) rotate('+a.minute+'deg)"></i><i class="ovAnalogHand ovAnalogHand--second" data-clock-hand="second" style="transform:translateX(-50%) rotate('+a.second+'deg)"></i><b class="ovAnalogPin"></b></div>';
  }
  function tick(){
    // Sekme arka plandayken veya Genel Bakış görünmüyorken saatler DOM'a yazılmaz;
    // görünür olunca ilk tick güncel saati hemen gösterir.
    if(document.hidden)return;
    const host=document.getElementById('ovLaunchpad');if(!host||!host.getClientRects().length)return;
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
    const l=lang(),now=new Date(),selected=loadSelection(),displayMode=loadDisplayMode(),holidayEnabled=loadHolidayEnabled(),holidayMonths=loadHolidayMonths(),user=window.BL_USER_CONTEXT||{};
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
        (holidayEnabled&&item.countryCode?'<div class="ovClockHolidays" data-clock-holidays data-clock-country="'+esc(item.countryCode)+'" data-clock-zone="'+esc(item.timeZone)+'" hidden></div>':'')+
        (manageOpen?'<button type="button" class="ovClockRemove" data-clock-remove="'+esc(item.id)+'" title="'+esc(l==='en'?'Remove clock':'Saati kaldır')+'">×</button>':'')+
      '</div>';
    }).join('');
    const selectedZones=new Set(selected.map(id=>clockFromId(id)?.timeZone).filter(Boolean));
    const available=CLOCKS.filter(item=>!selected.includes(item.id));
    const extraZones=supportedTimeZones().filter(zone=>!selectedZones.has(zone)&&!CLOCKS.some(item=>item.timeZone===zone));
    const commonOptions=available.map(item=>'<option value="'+esc(item.id)+'" data-clock-search-text="'+esc([item.tr,item.en,item.timeZone,zoneLabel(item.timeZone)].join(' '))+'">'+esc(countryName(item,l))+'</option>').join('');
    const zoneOptions=extraZones.map(zone=>'<option value="'+esc('TZ:'+zone)+'" data-clock-search-text="'+esc(zone+' '+zoneLabel(zone))+'">'+esc(zoneLabel(zone))+'</option>').join('');
    const holidayPeriodOptions=HOLIDAY_MONTH_OPTIONS.map(months=>'<option value="'+months+'"'+(holidayMonths===months?' selected':'')+'>'+esc(holidayPeriodLabel(months,l))+'</option>').join('');
    const controls=manageOpen
      ?'<div class="ovClockManageControls"><label class="ovClockModeControl"><span>'+esc(l==='en'?'Clock style':'Saat görünümü')+'</span><select data-clock-display-select><option value="digital"'+(displayMode==='digital'?' selected':'')+'>'+esc(l==='en'?'Digital':'Dijital')+'</option><option value="analog"'+(displayMode==='analog'?' selected':'')+'>'+esc(l==='en'?'Analog':'Analog')+'</option><option value="both"'+(displayMode==='both'?' selected':'')+'>'+esc(l==='en'?'Analog + digital':'Analog + dijital')+'</option></select></label>'+
        '<label class="ovClockHolidayToggle"><input type="checkbox" data-clock-holiday-toggle'+(holidayEnabled?' checked':'')+'><span>'+esc(l==='en'?'Show upcoming public holidays':'Yakındaki resmi tatilleri göster')+'</span></label>'+
        '<label class="ovClockHolidayPeriod"><span>'+esc(l==='en'?'Holiday period':'Tatil periyodu')+'</span><select data-clock-holiday-period'+(holidayEnabled?'':' disabled')+'>'+holidayPeriodOptions+'</select></label>'+
        '<div class="ovClockAddControls"><input type="search" data-clock-search autocomplete="off" placeholder="'+esc(l==='en'?'Search country or time zone':'Ülke veya saat dilimi ara')+'" aria-label="'+esc(l==='en'?'Search country or time zone':'Ülke veya saat dilimi ara')+'"><select data-clock-select aria-label="'+esc(l==='en'?'Country / time zone':'Ülke / saat dilimi')+'">'+
        '<optgroup label="'+esc(l==='en'?'Common countries':'Sık kullanılan ülkeler')+'">'+commonOptions+'</optgroup>'+
        '<optgroup label="'+esc(l==='en'?'All world time zones':'Tüm dünya saat dilimleri')+'">'+zoneOptions+'</optgroup>'+
        '</select><button type="button" class="ovClockAddBtn" data-clock-add'+((available.length||extraZones.length)?'':' disabled')+'>'+esc(l==='en'?'Add':'Ekle')+'</button></div></div>'
      :'';
    body.innerHTML='<div class="ovLaunchHead"><div class="ovLaunchHeading"><p class="ovLaunchDate">'+esc(date)+'</p>'+
      '<h2 class="ovLaunchTitle">'+esc(greeting(now.getHours(),l))+(name?', '+esc(name):'')+'</h2>'+
      '<p class="ovLaunchSub">'+esc(l==='en'?'Live local times for the countries you work with.':'Çalıştığın ülkelerin canlı yerel saatleri.')+'</p>'+pulseHtml(l)+'</div></div>'+
      '<div class="ovClockPanel"><div class="ovClockToolbar"><button type="button" class="ovClockManageBtn" data-clock-manage aria-pressed="'+(manageOpen?'true':'false')+'">'+
      esc(manageOpen?(l==='en'?'Done':'Tamam'):(l==='en'?'Manage clocks':'Saatleri düzenle'))+'</button></div>'+controls+
      (cards?'<div class="ovClockGrid is-'+esc(displayMode)+'" data-clock-count="'+selected.length+'">'+cards+'</div>':'<div class="ovClockEmpty">'+esc(l==='en'?'No clocks selected. Use Manage clocks to add one.':'Saat seçili değil. Eklemek için Saatleri düzenle seçeneğini kullan.')+'</div>')+'</div>';
    tick();if(holidayEnabled)refreshHolidayNotes();else holidayRenderSeq++;
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
      const mode=event.target.closest('[data-clock-display-select]');if(mode){saveDisplayMode(mode.value);render();return;}
      const period=event.target.closest('[data-clock-holiday-period]');if(period){saveHolidayMonths(period.value);render();return;}
      const holidays=event.target.closest('[data-clock-holiday-toggle]');if(holidays){saveHolidayEnabled(Boolean(holidays.checked));render();}
    });
    host.addEventListener('input',event=>{
      const search=event.target.closest('[data-clock-search]');if(search)filterClockOptions(host,search.value);
    });
    new MutationObserver(render).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
    window.addEventListener('bl:user-access-applied',render);
    const refreshBtn=document.getElementById('topRefreshBtn');
    if(refreshBtn)new MutationObserver(()=>{
      const pulse=host.querySelector('.ovLaunchPulse');
      if(refreshing()||pulse)render();
    }).observe(refreshBtn,{attributes:true,attributeFilter:['class']});
    render();timer=window.setInterval(tick,1000);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick();});
    window.addEventListener('beforeunload',()=>{if(timer)clearInterval(timer);},{once:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
  return {STORAGE_KEY,DISPLAY_KEY,HOLIDAY_KEY,HOLIDAY_PERIOD_KEY,DEFAULT_HOLIDAY_MONTHS,HOLIDAY_MONTH_OPTIONS,HOLIDAY_MAX_ITEMS,DEFAULT_CLOCKS,DEFAULT_DISPLAY,CLOCKS,greetingKey,greeting,normalizeSelection,normalizeDisplayMode,normalizeHolidayPref,normalizeHolidayMonths,addMonthsISO,zonedISODate,isoDayDiff,upcomingHolidays,clockParts,clockAngles,supportedTimeZones,clockFromId,clockSearchKey,clockMatchesSearch,render};
});
