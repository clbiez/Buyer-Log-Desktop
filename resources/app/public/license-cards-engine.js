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
  return Object.freeze({latestContract,currentContracts,nextContractPeriod,previousDay,contracts,ruleStatus,statistics,portalHref,symbolUrl,today});
});
