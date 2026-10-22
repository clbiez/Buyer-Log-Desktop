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
  function rows(cards,{query='',licensor=null,status='all',sort={key:'license',dir:'asc'},day=today()}={}){
    const q=key(query);
    const list=(Array.isArray(cards)?cards:[]).map(card=>{
      const primary=primaryContract(card.rules,day),map=mapSummary(card);
      return {card,id:card.id,license:text(card.license),licensor:text(card.licensor),image:cardImage(card),primary,map,hasAtlas:Boolean(card.processAtlas)};
    }).filter(row=>{
      if(q&&!key(`${row.license} ${row.licensor}`).includes(q))return false;
      if(licensor!=null&&key(row.licensor)!==licensor)return false;
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
  return Object.freeze({RATE_FIELDS,APPROVERS,cardImage,primaryContract,parseRate,rateError,mapSummary,licensorOptions,rows,latestContract,currentContracts,nextContractPeriod,previousDay,contracts,ruleStatus,statistics,portalHref,symbolUrl,today});
});
