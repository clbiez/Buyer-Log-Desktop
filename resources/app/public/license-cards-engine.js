/* Pure license-card presentation and loaded-row statistics. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.BLLicenseCardsEngine=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const text=v=>String(v==null?'':v).trim();
  const key=v=>text(v).toUpperCase().replace(/[İŞÇÖÜĞ]/g,c=>({'İ':'I','Ş':'S','Ç':'C','Ö':'O','Ü':'U','Ğ':'G'}[c])).replace(/\s+/g,' ');
  function date(value){
    const v=text(value);if(!v)return '';
    const m=v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);if(!m)return null;
    const d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));
    return d.getUTCFullYear()===+m[1]&&d.getUTCMonth()===+m[2]-1&&d.getUTCDate()===+m[3]?`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`:null;
  }
  function today(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
  function ruleStatus(rule,day){
    const a=date(rule.opdStart),b=date(rule.opdEnd);
    if(a===null||b===null||(a&&b&&a>b))return 'invalid';
    if(a&&a>day)return 'future';if(b&&b<day)return 'expired';return 'active';
  }
  function contracts(rules,day=today()){
    const source=Array.isArray(rules)?rules:[];
    return {active:source.filter(r=>ruleStatus(r,day)==='active'),history:source.map(rule=>({rule,status:ruleStatus(rule,day)})).sort((a,b)=>String(b.rule.opdStart||'').localeCompare(String(a.rule.opdStart||'')))};
  }
  function latestContract(rules,day=today()){
    const groups=contracts(rules,day),byStart=(a,b)=>String(b.opdStart||'').localeCompare(String(a.opdStart||''))||String(a.id||'').localeCompare(String(b.id||''));
    return groups.active.sort(byStart)[0]||groups.history.filter(x=>x.status==='future').map(x=>x.rule).sort((a,b)=>String(a.opdStart).localeCompare(String(b.opdStart)))[0]||groups.history.filter(x=>x.status==='expired').map(x=>x.rule).sort(byStart)[0]||null;
  }
  // Kartta bugün geçerli TÜM sezon kapsamları görünür; yoksa en yakın sözleşme.
  function currentContracts(rules,day=today()){
    const active=contracts(rules,day).active.sort((a,b)=>String(b.opdStart||'').localeCompare(String(a.opdStart||''))||String(a.id||'').localeCompare(String(b.id||'')));
    if(active.length)return active;
    const latest=latestContract(rules,day);return latest?[latest]:[];
  }
  function previousDay(day){
    const d=date(day);if(!d)return '';
    const t=new Date(Date.UTC(+d.slice(0,4),+d.slice(5,7)-1,+d.slice(8,10))-86400000);
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth()+1).padStart(2,'0')}-${String(t.getUTCDate()).padStart(2,'0')}`;
  }
  const seasonsOf=rule=>(Array.isArray(rule&&rule.seasons)?rule.seasons:(rule&&rule.season?[rule.season]:[])).map(key).filter(Boolean);
  const sides=rule=>[rule&&rule.trCommission!=null&&text(rule.trCommission)!==''?'TR':'',rule&&rule.ydCommission!=null&&text(rule.ydCommission)!==''?'YD':''].filter(Boolean);
  // Yeni dönem: oranlar en güncel sözleşmeden kopyalanır (0 royalty ile
  // yanlışlıkla kaydedilmez) ve aynı kapsamdaki açık önceki dönem bir gün
  // önce kapatılır; aksi hâlde sunucu çakışma nedeniyle kaydı reddeder.
  function nextContractPeriod(rules,card,day=today(),id=`license-rule-${Date.now()}-${Math.random().toString(36).slice(2,9)}`){
    const list=(Array.isArray(rules)?rules:[]).map(rule=>({...rule}));
    const base=latestContract(list,day),start=date(day)||today(),end=previousDay(start);
    const next={id,license:card.license,licensor:card.licensor,opdStart:start,opdEnd:'',seasons:base?[...(Array.isArray(base.seasons)?base.seasons:(base.season?[base.season]:[]))]:[],
      royalty:base?base.royalty:null,trCommission:base?base.trCommission??null:0,ydCommission:base?base.ydCommission??null:0,hologramCost:base?base.hologramCost??0:0};
    if(next.trCommission==null&&next.ydCommission==null){next.trCommission=0;next.ydCommission=0;}
    const nextSeasons=seasonsOf(next),nextSides=sides(next),closed=[];
    for(const rule of list){
      const from=date(rule.opdStart),to=date(rule.opdEnd),ruleSeasons=seasonsOf(rule);
      if(from===null||to===null||(from&&from>=start)||(to&&to<start))continue;
      if(nextSeasons.length&&ruleSeasons.length&&!ruleSeasons.some(s=>nextSeasons.includes(s)))continue;
      if(!sides(rule).some(side=>nextSides.includes(side)))continue;
      rule.opdEnd=end;closed.push(rule.id);
    }
    return {rules:[next,...list],rule:next,closed};
  }
  /* ---- License list (rows, inline rates, compact approval map) ---- */
  const RATE_FIELDS=Object.freeze(['royalty','trCommission','ydCommission','hologramCost']);
  // Card image: the atlas cover wins, the legacy symbol is the fallback.
  function cardImage(card){
    const cover=text(card&&card.processAtlas&&card.processAtlas.license&&card.processAtlas.license.cover);
    if(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(cover))return cover;
    return symbolUrl(card&&card.symbolDataUrl);
  }
  // The contract a row edits: newest active one; else the nearest upcoming; else the latest past one.
  function primaryContract(rules,day=today()){
    const groups=contracts(rules,day),rule=latestContract(rules,day);
    return {rule,status:rule?ruleStatus(rule,day):'none',extraActive:Math.max(0,groups.active.length-1)};
  }
  // '' clears an optional rate; comma decimals are accepted; anything else is NaN.
  function parseRate(value){
    if(value==null||text(value)==='')return null;
    const n=Number(text(value).replace(/\s/g,'').replace(',','.'));
    return Number.isFinite(n)?n:NaN;
  }
  const exact=n=>Number(n.toFixed(10));
  // Same limits as the server (server/lib/license-cards.js normalizeRules).
  function rateError(rule){
    const r=rule||{},royalty=r.royalty,commissions=[r.trCommission,r.ydCommission].filter(v=>v!=null);
    if(royalty==null||!Number.isFinite(royalty)||royalty<0||royalty>100)return 'royalty';
    if(!commissions.length)return 'commission-missing';
    if(commissions.some(v=>!Number.isFinite(v)||v<0||exact(v+royalty)>100))return 'commission';
    if(r.hologramCost==null||!Number.isFinite(r.hologramCost)||r.hologramCost<0)return 'hologram';
    const a=date(r.opdStart),b=date(r.opdEnd);
    if(a===null||b===null||(a&&b&&a>b))return 'date';
    return '';
  }
  const APPROVERS=Object.freeze(['LCW','licensor','mixed','agency','unknown']);
  // Minimal map: enabled steps in order with who approves, test and route count.
  function mapSummary(card){
    const stages=(card&&card.processAtlas&&card.processAtlas.license&&Array.isArray(card.processAtlas.license.stages)?card.processAtlas.license.stages:[]).filter(s=>s&&s.enabled!==false);
    return stages.map((s,i)=>({id:s.id,index:i+1,title:text(s.title),approver:APPROVERS.includes(s.approver)?s.approver:'unknown',test:s.testRequired===true,routes:Array.isArray(s.submissions)?s.submissions.length:0,shared:s.manufacturerVisible!==false}));
  }
  function licensorOptions(cards){
    const seen=new Map();
    for(const c of Array.isArray(cards)?cards:[]){const k=key(c.licensor);if(!seen.has(k))seen.set(k,text(c.licensor));}
    return [...seen.entries()].sort((a,b)=>(a[0]==='')-(b[0]==='')||a[1].localeCompare(b[1],'tr')).map(([value,label])=>({value,label}));
  }
  // One row per card (license × licensor); several licensors are never merged.
  /* Licensor name nuances ("ERMODA" / "ERMODA UK LTD") of one license are shown as one row.
     mergeKey is BLBusinessRules.licensorMergeKey; split lists the keys the user separated.
     The row's card is the richest one (map, contracts); the others stay as `merged`. */
  function richness(card,day){return [(card.processAtlas&&card.processAtlas.license&&(card.processAtlas.license.stages||[]).length)?1:0,primaryContract(card.rules,day).status==='active'?1:0,(card.rules||[]).length,-text(card.licensor).length];}
  function groupCards(cards,{merges=null,mergeKey=null,groupKey=null,day=today()}={}){
    const split=new Set((merges&&Array.isArray(merges.split)?merges.split:[]).map(k=>mergeKey?mergeKey(k):k)),groups=new Map();
    for(const card of Array.isArray(cards)?cards:[]){
      const mk=text(card.licensor)?(groupKey?groupKey(card.licensor,merges):mergeKey?mergeKey(card.licensor):''):'';
      const g=mk&&(groupKey||!split.has(mk))?`${key(card.license)}|${mk}`:`id|${card.id}`;
      if(!groups.has(g))groups.set(g,{mergeKey:mk,members:[]});
      groups.get(g).members.push(card);
    }
    return [...groups.values()].map(g=>{
      const sorted=[...g.members].sort((a,b)=>{const x=richness(a,day),y=richness(b,day);for(let i=0;i<x.length;i++)if(x[i]!==y[i])return y[i]-x[i];return text(a.licensor).localeCompare(text(b.licensor),'tr');});
      return {card:sorted[0],merged:sorted.slice(1),mergeKey:g.mergeKey};
    });
  }
  // Every licensor key that has several spellings: shown so a wrong merge can be split.
  function mergeSummary(cards,{merges=null,mergeKey=null}={}){
    if(!mergeKey)return [];
    const split=new Set((merges&&Array.isArray(merges.split)?merges.split:[]).map(k=>mergeKey(k))),byKey=new Map();
    for(const card of Array.isArray(cards)?cards:[]){
      if(!text(card.licensor))continue;
      const mk=mergeKey(card.licensor);if(!byKey.has(mk))byKey.set(mk,{key:mk,names:new Map(),licenses:new Set()});
      const e=byKey.get(mk);e.names.set(key(card.licensor),text(card.licensor));e.licenses.add(text(card.license));
    }
    const automatic=[...byKey.values()].filter(e=>e.names.size>1).map(e=>({key:e.key,names:[...e.names.values()].sort((a,b)=>a.length-b.length||a.localeCompare(b,'tr')),licenses:[...e.licenses].sort((a,b)=>a.localeCompare(b,'tr')),split:split.has(e.key)}));
    const manual=Object.entries(merges?.entries||{}).filter(([id,e])=>id.startsWith('m:')&&e?.source&&e?.target).map(([id,e])=>({
      key:id,source:e.source,target:e.target,manual:true,split:e.split===true,names:[e.source,e.target],
      licenses:[...new Set((cards||[]).filter(c=>[key(e.source),key(e.target)].includes(key(c.licensor))).map(c=>text(c.license)))].sort((a,b)=>a.localeCompare(b,'tr'))
    }));
    return [...automatic,...manual].sort((a,b)=>a.names[0].localeCompare(b.names[0],'tr'));
  }
  function rows(cards,{query='',licensor=null,status='all',sort={key:'license',dir:'asc'},day=today(),merges=null,mergeKey=null,groupKey=null}={}){
    const q=key(query);
    const list=groupCards(cards,{merges,mergeKey,groupKey,day}).map(({card,merged,mergeKey:mk})=>{
      const primary=primaryContract(card.rules,day),map=mapSummary(card);
      return {card,id:card.id,license:text(card.license),licensor:text(card.licensor),image:cardImage(card)||merged.map(cardImage).find(Boolean)||'',primary,map,hasAtlas:Boolean(card.processAtlas),merged,mergeKey:mk};
    }).filter(row=>{
      const names=[row.licensor,...row.merged.map(c=>text(c.licensor))];
      if(q&&!key(`${row.license} ${names.join(' ')}`).includes(q))return false;
      if(licensor!=null&&!names.some(n=>key(n)===licensor))return false;
      if(status==='active')return row.primary.status==='active';
      if(status==='missing')return row.primary.status!=='active';
      if(status==='noLicensor')return !row.licensor;
      if(status==='noMap')return !row.map.length;
      return true;
    });
    const dir=sort&&sort.dir==='desc'?-1:1,k=sort&&sort.key||'license';
    const val=row=>RATE_FIELDS.includes(k)?(row.primary.rule&&Number.isFinite(Number(row.primary.rule[k]))&&row.primary.rule[k]!==null?Number(row.primary.rule[k]):null):k==='licensor'?row.licensor:k==='map'?row.map.length:row.license;
    return list.sort((a,b)=>{
      const x=val(a),y=val(b);
      if(x===y)return a.license.localeCompare(b.license,'tr')||a.licensor.localeCompare(b.licensor,'tr');
      if(x==null)return 1;if(y==null)return -1;
      return (typeof x==='number'?x-y:String(x).localeCompare(String(y),'tr'))*dir;
    });
  }
  function quantity(v){
    if(v==null||text(v)==='')return null;
    let s=text(v).replace(/\s/g,'');
    if(/^\d{1,3}(\.\d{3})+$/.test(s))s=s.replace(/\./g,'');
    else if(/^\d{1,3}(,\d{3})+$/.test(s))s=s.replace(/,/g,'');
    else if(s.includes(',')&&!s.includes('.'))s=s.replace(',','.');
    const n=Number(s);return Number.isFinite(n)&&n>=0?n:null;
  }
  function statistics(rows,card,moduleId,canonical){
    const module=moduleId==='cp'?'cp':'orders',orders=new Set(),seen=new Set();
    const result={module,orders:0,lines:0,quantity:0,unknownQuantities:0};
    const read=canonical&&(canonical.canonicalValue||canonical.value);
    if(typeof read!=='function')return result;
    (Array.isArray(rows)?rows:[]).forEach(row=>{
      const get=id=>read.call(canonical,row,module,id);
      if(key(get('license'))!==key(card.license)||key(get('licensor'))!==key(card.licensor))return;
      const order=text(get('orderCode')),model=text(get('modelName')),colour=text(get('colourCode'));
      const identity=JSON.stringify([key(order),key(model),key(colour)]);
      if(order&&seen.has(identity))return;
      if(order){seen.add(identity);orders.add(key(order));}
      result.lines++;const q=quantity(get('orderQuantity'));if(q==null)result.unknownQuantities++;else result.quantity+=q;
    });
    result.orders=orders.size;return result;
  }
  function portalHref(value){try{const u=new URL(text(value));return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch(_){return '';}}
  function symbolUrl(value){const s=text(value);return /^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(s)&&s.length<=350000?s:'';}
  /* Map copy/paste from the list: the steps, their addresses, guide images and custom
     labels come from the source; the target keeps its own identity, image, portal,
     requirements and internal notes. */
  function pasteMap(sourceAtlas,target){
    const src=JSON.parse(JSON.stringify(sourceAtlas||{})),own=target&&target.processAtlas?JSON.parse(JSON.stringify(target.processAtlas)):null;
    const sl=src.license||{},tl=own&&own.license||{};
    const used=new Set((sl.stages||[]).flatMap(s=>(s.submissions||[]).map(r=>r.addressId)).filter(Boolean));
    const guides=new Set((sl.stages||[]).map(s=>s.visualGuideId).filter(Boolean));
    // Routes may point to the source's shared addresses; those travel as the target's own.
    const srcAddresses=[...(sl.addresses||[]),...(src.sharedAddresses||[]).filter(a=>!(sl.addresses||[]).some(b=>b.id===a.id))];
    const keepAddresses=(tl.addresses||[]).filter(a=>!srcAddresses.some(b=>b.id===a.id));
    return {...(own||{}),version:1,
      license:{...tl,id:target.id,name:text(target.license),agency:text(target.licensor),stages:sl.stages||[],
        addresses:[...keepAddresses,...srcAddresses.filter(a=>used.has(a.id))],
        portal:tl.portal||{url:'',notes:''},cover:tl.cover||'',manufacturerVisible:tl.manufacturerVisible!==false},
      sharedAddresses:own&&own.sharedAddresses||[],
      visualLibrary:[...((own&&own.visualLibrary)||[]).filter(v=>!guides.has(v.id)),...(src.visualLibrary||[]).filter(v=>guides.has(v.id))],
      customSelectOptions:unionOptions((own&&own.customSelectOptions)||{},src.customSelectOptions||{})};
  }
  function unionOptions(a,b){
    const out={};
    for(const k of new Set([...Object.keys(a),...Object.keys(b)])){const seen=new Set();out[k]=[...(a[k]||[]),...(b[k]||[])].filter(o=>o&&!seen.has(o.value)&&seen.add(o.value));}
    return out;
  }
  return Object.freeze({RATE_FIELDS,APPROVERS,cardImage,primaryContract,parseRate,rateError,mapSummary,licensorOptions,groupCards,mergeSummary,pasteMap,rows,latestContract,currentContracts,nextContractPeriod,previousDay,contracts,ruleStatus,statistics,portalHref,symbolUrl,today});
});
