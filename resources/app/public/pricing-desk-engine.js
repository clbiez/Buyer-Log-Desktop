/* Buyer Log — Fiyat Masası saf hesap motoru (tarayıcı + Node).

   Görünümden bağımsızdır; quotation kayıtlarını ve (varsa) Koleksiyon satır
   bilgisini alıp Fiyat Masası ekranlarının sorduğu sorulara cevap üretir:
     · Matris: talep içinde model × üretici, en iyi teklif, olağan dışı fiyat,
     · Toplu onay adayları (hedefin altındaki en iyi teklif),
     · Pazarlık turları ve tur kazancı (Fiyat Defteri olaylarından),
     · Geçmiş serileri (model başına, üretici başına),
     · Klasman / kategori / MAG… × üretici analizi ve üretici karnesi.
   İş gerçeği Fiyat Defteri'dir (bkz. server/lib/quotation-ledger.js); bu motor
   yalnız okur, hiçbir kaydı değiştirmez. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.BLPricingDeskEngine=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const clean=value=>String(value==null?'':value).trim();
  const keyOf=value=>clean(value).toLocaleUpperCase('tr-TR').replace(/\s+/g,' ');
  const OUTLIER_RATIO=3;
  const GROUP_DIMENSIONS=['classification','mag','mmyg','buyingGroup','buyer','productMainDefinition','season','license'];

  function price(value){
    if(value==null||value==='')return null;
    if(typeof value==='number')return Number.isFinite(value)&&value>0?value:null;
    let text=clean(value).replace(/\s+/g,'').replace(/[$€£₺]/g,'');
    if(!text)return null;
    if(text.includes(',')&&text.includes('.')){
      if(text.lastIndexOf(',')>text.lastIndexOf('.'))text=text.replace(/\./g,'').replace(',','.');
      else text=text.replace(/,/g,'');
    }else if(text.includes(',')){
      const parts=text.split(',');
      text=parts.length===2&&parts[1].length<=3?`${parts[0].replace(/\./g,'')}.${parts[1]}`:text.replace(/,/g,'');
    }else if(/^\d{1,3}(?:\.\d{3})+$/.test(text))text=text.replace(/\./g,'');
    const n=Number(text);
    return Number.isFinite(n)&&n>0?n:null;
  }
  const mean=values=>{const list=values.filter(Number.isFinite);return list.length?list.reduce((a,b)=>a+b,0)/list.length:null;};
  function median(values){
    const list=values.filter(Number.isFinite).sort((a,b)=>a-b);
    if(!list.length)return null;
    const mid=Math.floor(list.length/2);
    return list.length%2?list[mid]:(list[mid-1]+list[mid])/2;
  }
  const pct=(value,base)=>Number.isFinite(value)&&Number.isFinite(base)&&base>0?(value-base)/base*100:null;

  /* Sunucudaki quotation-ledger.effectiveHistory ile aynı kural: defteri
     olmayan eski satır için talep tarihinde tek bir "legacy" teklif türetilir. */
  function effectiveHistory(line,request){
    const history=(Array.isArray(line&&line.history)?line.history:[]).filter(event=>event&&event.type&&event.at).slice()
      .sort((a,b)=>String(a.at).localeCompare(String(b.at))||String(a.id).localeCompare(String(b.id)));
    if(history.some(event=>event.type==='offer'))return history;
    const synthetic=[];
    const createdAt=clean(request&&(request.createdAt||request.updatedAt));
    if(price(line&&line.price)!=null&&createdAt)synthetic.push({id:`legacy-offer-${clean(line.id)}`,type:'offer',price:clean(line.price),at:createdAt,by:clean(request&&request.ownerId),byName:clean(request&&request.ownerName),round:1,source:'legacy'});
    if(line&&line.approved&&!history.some(event=>event.type==='approve')){
      const at=clean(request&&(request.updatedAt||request.createdAt));
      if(at)synthetic.push({id:`legacy-approve-${clean(line.id)}`,type:'approve',at,by:clean(request&&request.ownerId),byName:clean(request&&request.ownerName),round:1,source:'legacy'});
    }
    return [...synthetic,...history].sort((a,b)=>String(a.at).localeCompare(String(b.at)));
  }
  /* Geri alınan yazım hatası (ör. 9,50 yerine 95) defterde kalır ama
     teklif geçmişini ve pazarlık hesabını bozmaz: "undo" kaynaklı olay ve
     hemen önündeki teklif birlikte okunmaz. */
  function offers(line,request){
    const list=[];
    effectiveHistory(line,request).filter(event=>event.type==='offer').forEach(event=>{
      if(event.source==='undo'){list.pop();return;}
      list.push({...event,value:price(event.price)});
    });
    return list;
  }
  /* Bir satırın pazarlık özeti: ilk geçerli teklif → son geçerli teklif. */
  function negotiation(line,request){
    const list=offers(line,request).filter(event=>event.value!=null);
    if(!list.length)return null;
    const first=list[0],last=list[list.length-1];
    return {first:first.value,last:last.value,count:list.length,rounds:new Set(list.map(event=>event.round||1)).size,gainPct:pct(last.value,first.value),firstAt:first.at,lastAt:last.at,previous:list.length>1?list[list.length-2].value:null};
  }

  /* MATRİS: talep içindeki satırlar model × üretici olarak düzenlenir.
     Model sırası talepteki ilk görünme sırasıdır; üretici sırası talebin
     üretici listesi, ardından satırlarda görülen diğer adlar. */
  function requestMatrix(request){
    const manufacturers=[],seen=new Set();
    const addManufacturer=name=>{const value=clean(name);if(!value)return;const key=keyOf(value);if(seen.has(key))return;seen.add(key);manufacturers.push(value);};
    (request&&request.manufacturers||[]).forEach(item=>addManufacturer(item&&item.name));
    const models=new Map();
    (request&&request.items||[]).forEach(item=>{
      if(!item||!clean(item.modelKey))return;
      addManufacturer(item.manufacturer);
      let model=models.get(item.modelKey);
      if(!model){model={modelKey:item.modelKey,first:item,cells:new Map()};models.set(item.modelKey,model);}
      model.cells.set(keyOf(item.manufacturer),item);
    });
    return {manufacturers,models:[...models.values()].map(model=>({modelKey:model.modelKey,first:model.first,cell:name=>model.cells.get(keyOf(name))||null,lines:[...model.cells.values()]}))};
  }
  /* Bir model satırının istatistiği: en iyi (en düşük) teklif, medyan ve
     medyanın 3 katı / üçte biri dışındaki olağan dışı değerler. Drop edilmiş
     satırlar hesaba girmez. */
  function rowStats(lines){
    const priced=(lines||[]).filter(line=>line&&!line.dropped).map(line=>({line,value:price(line.price)})).filter(entry=>entry.value!=null);
    const med=median(priced.map(entry=>entry.value));
    let best=null;
    priced.forEach(entry=>{if(!best||entry.value<best.value)best=entry;});
    const outliers=new Set();
    if(priced.length>1&&med)priced.forEach(entry=>{const ratio=entry.value/med;if(ratio>=OUTLIER_RATIO||ratio<=1/OUTLIER_RATIO)outliers.add(entry.line.id);});
    const approved=(lines||[]).find(line=>line&&line.approved&&!line.dropped)||null;
    return {priced:priced.length,median:med,best:best?{lineId:best.line.id,manufacturer:clean(best.line.manufacturer),price:best.value}:null,outliers,approved:approved?{lineId:approved.id,manufacturer:clean(approved.manufacturer),price:price(approved.price)}:null};
  }
  /* Alternatif fiyatlar: ana fiyat (line.price) dışında üreticinin farklı
     koşullarla verdiği fiyatlar. En iyi teklif/onay hesabına girmez; farklı
     özellik (ör. kumaş gramajı) aynı fiyat gibi kıyaslanmaz. */
  function lineOptions(line){
    return (Array.isArray(line&&line.options)?line.options:[]).filter(option=>option&&(clean(option.label)||clean(option.price)||clean(option.note)))
      .map(option=>({id:clean(option.id),label:clean(option.label),price:clean(option.price),note:clean(option.note),value:price(option.price)}));
  }
  // Kapsam puan değildir: aynı modellerde rekabet, sonra kapsama bakılır.
  function compareSuppliers(a,b){
    const wins=s=>s.modelWins??s.wins??0;
    const index=s=>Number.isFinite(s.modelIndex)?s.modelIndex:Infinity;
    return wins(b)-wins(a)||(index(a)-index(b)||0)||(b.models||0)-(a.models||0)||a.name.localeCompare(b.name,'tr',{numeric:true});
  }
  function modelWinCounts(observations){
    const models=new Map(),wins=new Map();
    (observations||[]).forEach(o=>{if(!Number.isFinite(o.value)||o.value<=0)return;const id=clean(o.identityKey||o.modelKey);if(!id)return;if(!models.has(id))models.set(id,new Map());const bySupplier=models.get(id),key=keyOf(o.manufacturer);if(!bySupplier.has(key))bySupplier.set(key,[]);bySupplier.get(key).push(o.value);});
    models.forEach(suppliers=>{const averages=[...suppliers].map(([key,values])=>({key,value:mean(values)})),best=Math.min(...averages.map(o=>o.value));averages.filter(o=>Math.abs(o.value-best)<1e-9).forEach(o=>wins.set(o.key,(wins.get(o.key)||0)+1));});
    return wins;
  }
  function supplierScorecards(request){
    const matrix=requestMatrix(request),observations=matrix.models.flatMap(model=>model.lines.filter(line=>!line.dropped&&price(line.price)!=null).map(line=>({identityKey:model.modelKey,manufacturer:line.manufacturer,value:price(line.price),approved:!!line.approved})));
    const analyzed=new Map(analyze(observations).suppliers.map(s=>[s.key,s]));
    return matrix.manufacturers.map(name=>{const s=analyzed.get(keyOf(name));return {key:keyOf(name),name,total:matrix.models.length,models:s?.models||0,wins:s?.modelWins||0,approved:s?.approved||0,modelIndex:s?.modelIndex??null};}).sort(compareSuppliers);
  }
  function supplierLayout(cards,expanded=false,limit=8){
    const sorted=cards.slice().sort(compareSuppliers),visible=[],other=[];
    sorted.forEach((card,i)=>{(expanded||sorted.length<=limit||i<limit||(card.modelWins??card.wins)>0||card.approved>0?visible:other).push(card);});
    return {visible,other};
  }
  function outlierRatio(value,lines){
    const stats=rowStats(lines),n=price(value);
    if(n==null||!stats.median||stats.priced<2)return null;
    const ratio=n/stats.median;
    return ratio>=OUTLIER_RATIO||ratio<=1/OUTLIER_RATIO?ratio:null;
  }
  /* Toplu onay: onayı olmayan ve en iyi teklifi hedefin altında/eşit olan
     modeller. Hedefi bilinmeyen model aday olmaz (karar kullanıcıda kalır). */
  function bulkApproveCandidates(request,targetOf){
    const matrix=requestMatrix(request),out=[];
    matrix.models.forEach(model=>{
      const stats=rowStats(model.lines);
      if(!stats.best||stats.approved)return;
      const target=price(typeof targetOf==='function'?targetOf(model.first):null);
      if(target==null||stats.best.price>target)return;
      out.push({modelKey:model.modelKey,lineId:stats.best.lineId,manufacturer:stats.best.manufacturer,price:stats.best.price,target,deltaPct:pct(stats.best.price,target),line:model.lines.find(line=>line.id===stats.best.lineId)});
    });
    return out;
  }

  /* PAZARLIK TURLARI: Fiyat Defteri teklif olayları tur numarasına göre
     gruplanır; her olayda bir önceki fiyat (aynı satırın) da verilir. */
  function rounds(request){
    const byRound=new Map();
    const meta=new Map((request&&request.rounds||[]).map(round=>[Number(round.n),round]));
    (request&&request.items||[]).forEach(line=>{
      let previous=null;
      offers(line,request).forEach(event=>{
        const n=Math.max(1,Number(event.round)||1);
        if(!byRound.has(n))byRound.set(n,{n,at:clean(meta.get(n)?.at),byName:clean(meta.get(n)?.byName),note:clean(meta.get(n)?.note),offers:[]});
        byRound.get(n).offers.push({lineId:line.id,modelKey:line.modelKey,manufacturer:clean(line.manufacturer),price:event.value,priceText:clean(event.price),previous,at:event.at,byName:clean(event.byName),source:event.source||'manual'});
        if(event.value!=null)previous=event.value;
      });
    });
    const current=Math.max(1,Number(request&&request.round)||1);
    for(let n=1;n<=current;n++)if(!byRound.has(n))byRound.set(n,{n,at:clean(meta.get(n)?.at),byName:clean(meta.get(n)?.byName),note:clean(meta.get(n)?.note),offers:[]});
    return [...byRound.values()].sort((a,b)=>a.n-b.n).map(round=>{
      round.offers.sort((a,b)=>String(a.at).localeCompare(String(b.at)));
      if(!round.at&&round.offers.length)round.at=round.offers[0].at;
      return round;
    });
  }
  /* Talep düzeyinde kazanım: her model için ilk turun en iyi teklifi ile
     güncel en iyi (onaylıysa onaylı) fiyat karşılaştırılır. */
  function requestGain(request){
    const matrix=requestMatrix(request);let firstSum=0,lastSum=0,models=0;
    matrix.models.forEach(model=>{
      const firsts=[],stats=rowStats(model.lines);
      model.lines.forEach(line=>{if(line.dropped)return;const list=offers(line,request).filter(event=>event.value!=null);if(list.length)firsts.push(list[0].value);});
      const current=stats.approved&&stats.approved.price!=null?stats.approved.price:stats.best?stats.best.price:null;
      if(!firsts.length||current==null)return;
      firstSum+=Math.min(...firsts);lastSum+=current;models++;
    });
    return models?{models,firstAvg:firstSum/models,currentAvg:lastSum/models,gainPct:pct(lastSum,firstSum)}:null;
  }
  /* Durum şeritleri (Turlar panosu). Kapalı → closed; onaylı model varsa
     approved; geçerli fiyat varsa compare (karşılaştırma); hiç fiyat yoksa ve
     satır var ise waiting; satırsız talep sent. */
  function lane(request){
    if(request&&request.status==='closed')return 'closed';
    const items=(request&&request.items||[]).filter(item=>item&&!item.dropped);
    if(!items.length)return 'sent';
    const models=new Set(items.map(item=>item.modelKey)),approved=new Set(items.filter(item=>item.approved&&price(item.price)!=null).map(item=>item.modelKey));
    if(approved.size&&approved.size>=models.size)return 'approved';
    if(items.some(item=>price(item.price)!=null))return 'compare';
    return 'waiting';
  }
  function responseRates(request){
    const map=new Map();
    (request&&request.items||[]).forEach(item=>{
      if(!item||item.dropped)return;
      const key=keyOf(item.manufacturer);
      if(!map.has(key))map.set(key,{name:clean(item.manufacturer),total:0,priced:0,approved:0});
      const entry=map.get(key);entry.total++;if(price(item.price)!=null)entry.priced++;if(item.approved)entry.approved++;
    });
    return [...map.values()].map(entry=>({...entry,rate:entry.total?entry.priced/entry.total:0}));
  }

  /* GEÇMİŞ SERİLERİ: gözlemler (her biri tek bir teklif olayı) model
     kimliğine, ardından üreticiye göre gruplanır; noktalar zamana göre sıralı. */
  function historySeries(events){
    const models=new Map();
    (events||[]).forEach(event=>{
      if(!event||event.value==null)return;
      const id=clean(event.identityKey||event.modelKey);if(!id)return;
      if(!models.has(id))models.set(id,{identityKey:id,model:event.model,plmId:event.plmId,image:event.image,colourCode:event.colourCode,target:null,series:new Map(),events:[]});
      const model=models.get(id);
      if(event.target!=null&&model.target==null)model.target=event.target;
      const key=keyOf(event.manufacturer);
      if(!model.series.has(key))model.series.set(key,{manufacturer:clean(event.manufacturer),points:[]});
      model.series.get(key).points.push({at:event.at,value:event.value,round:event.round||1,approved:!!event.approved});
      model.events.push(event);
    });
    return [...models.values()].map(model=>{
      const series=[...model.series.values()].map(entry=>({...entry,points:entry.points.sort((a,b)=>String(a.at).localeCompare(String(b.at)))}));
      const values=model.events.map(event=>event.value);
      const latest=series.map(entry=>entry.points[entry.points.length-1]).filter(Boolean);
      const bestLatest=latest.length?Math.min(...latest.map(point=>point.value)):null;
      const firstValues=series.map(entry=>entry.points[0]).filter(Boolean).map(point=>point.value);
      const firstBest=firstValues.length?Math.min(...firstValues):null;
      return {...model,series,min:Math.min(...values),max:Math.max(...values),latestBest:bestLatest,firstBest,trendPct:pct(bestLatest,firstBest),count:model.events.length};
    }).sort((a,b)=>b.count-a.count||String(a.model).localeCompare(String(b.model),'tr',{numeric:true}));
  }

  /* ANALİZ: gözlem = bir quotation satırının seçilen fiyatı (son / ilk tur /
     onaylı) ve satırın Koleksiyon boyutları (klasman, MAG, MMYG, buyer…).
     Grup ortalaması, üretici ortalaması ve endeks (+%/−% grup ortalamasına
     göre) hesaplanır. "Aynı model" endeksi ürün karması farkını eler: bir
     modelde birden çok üretici fiyat verdiyse her üreticinin fiyatı o modelin
     ortalamasıyla kıyaslanır. */
  function observationValue(observation,dim){return clean(observation&&observation[dim])||'—';}
  function filterObservations(observations,filters){
    const active=Object.entries(filters||{}).filter(([,values])=>Array.isArray(values)&&values.length).map(([dim,values])=>[dim,new Set(values.map(keyOf))]);
    if(!active.length)return (observations||[]).slice();
    return (observations||[]).filter(observation=>active.every(([dim,set])=>set.has(keyOf(observationValue(observation,dim)))));
  }
  function dimensionValues(observations,dim){
    const map=new Map();
    (observations||[]).forEach(observation=>{const label=observationValue(observation,dim),key=keyOf(label);if(!map.has(key))map.set(key,{key,label,count:0});map.get(key).count++;});
    return [...map.values()].sort((a,b)=>a.label.localeCompare(b.label,'tr',{numeric:true,sensitivity:'base'}));
  }
  function modelIndexMap(observations){
    const byModel=new Map();
    (observations||[]).forEach(observation=>{
      if(observation.value==null)return;
      const key=clean(observation.identityKey||observation.modelKey);if(!key)return;
      if(!byModel.has(key))byModel.set(key,[]);byModel.get(key).push(observation);
    });
    const indexOf=new Map();
    byModel.forEach(list=>{
      const suppliers=new Set(list.map(item=>keyOf(item.manufacturer)));
      if(suppliers.size<2)return;
      const avg=mean(list.map(item=>item.value));
      list.forEach(item=>indexOf.set(item,pct(item.value,avg)));
    });
    return indexOf;
  }
  function analyze(observations,options={}){
    const groupBy=GROUP_DIMENSIONS.includes(options.groupBy)?options.groupBy:'classification';
    const minSample=Math.max(1,Math.round(Number(options.minSample)||1));
    const list=filterObservations(observations,options.filters).filter(observation=>observation&&observation.value!=null);
    const modelIndex=modelIndexMap(list),modelWins=modelWinCounts(list);
    const groups=new Map(),suppliers=new Map();
    list.forEach(observation=>{
      const label=observationValue(observation,groupBy),gKey=keyOf(label),sLabel=clean(observation.manufacturer)||'—',sKey=keyOf(sLabel);
      if(!groups.has(gKey))groups.set(gKey,{key:gKey,label,values:[],models:new Set(),cells:new Map(),items:[]});
      const group=groups.get(gKey);
      group.values.push(observation.value);group.models.add(clean(observation.identityKey||observation.modelKey));group.items.push(observation);
      if(!group.cells.has(sKey))group.cells.set(sKey,{key:sKey,name:sLabel,values:[],models:new Set(),approved:0,items:[],modelIndexes:[]});
      const cell=group.cells.get(sKey);
      cell.values.push(observation.value);cell.models.add(clean(observation.identityKey||observation.modelKey));cell.items.push(observation);if(observation.approved)cell.approved++;
      if(modelIndex.has(observation))cell.modelIndexes.push(modelIndex.get(observation));
      if(!suppliers.has(sKey))suppliers.set(sKey,{key:sKey,name:sLabel,values:[],models:new Set(),approved:0,wins:0,groupIndexes:[],modelIndexes:[],items:[],buyers:new Set(),groups:new Set()});
      const supplier=suppliers.get(sKey);
      supplier.values.push(observation.value);supplier.models.add(clean(observation.identityKey||observation.modelKey));supplier.items.push(observation);supplier.groups.add(gKey);
      if(observation.approved)supplier.approved++;
      if(clean(observation.buyer))supplier.buyers.add(clean(observation.buyer));
      if(modelIndex.has(observation))supplier.modelIndexes.push(modelIndex.get(observation));
    });
    const groupList=[...groups.values()].map(group=>{
      const avg=mean(group.values);
      const cells=[...group.cells.values()].map(cell=>{
        const cellAvg=mean(cell.values);
        return {key:cell.key,name:cell.name,avg:cellAvg,min:Math.min(...cell.values),max:Math.max(...cell.values),count:cell.values.length,models:cell.models.size,approved:cell.approved,index:pct(cellAvg,avg),modelIndex:mean(cell.modelIndexes),eligible:cell.models.size>=minSample,items:cell.items};
      }).sort((a,b)=>a.avg-b.avg);
      const eligible=cells.filter(cell=>cell.eligible);
      const best=eligible.length>=2?eligible[0]:null;
      if(best&&suppliers.has(best.key))suppliers.get(best.key).wins++;
      return {key:group.key,label:group.label,avg,count:group.values.length,models:group.models.size,min:Math.min(...group.values),max:Math.max(...group.values),spreadPct:pct(Math.max(...group.values),Math.min(...group.values)),cells,best,priciest:eligible.length>=2?eligible[eligible.length-1]:null,cell:key=>cells.find(cell=>cell.key===keyOf(key))||null,items:group.items};
    }).sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label,'tr',{numeric:true}));
    groupList.forEach(group=>group.cells.forEach(cell=>{if(cell.index!=null&&suppliers.has(cell.key))suppliers.get(cell.key).groupIndexes.push({value:cell.index,weight:cell.count});}));
    const weighted=parts=>{let sum=0,weight=0;parts.forEach(part=>{if(Number.isFinite(part.value)&&part.weight>0){sum+=part.value*part.weight;weight+=part.weight;}});return weight?sum/weight:null;};
    const supplierList=[...suppliers.values()].map(supplier=>({key:supplier.key,name:supplier.name,avg:mean(supplier.values),count:supplier.values.length,models:supplier.models.size,approved:supplier.approved,wins:supplier.wins,groups:supplier.groups.size,buyers:[...supplier.buyers].sort((a,b)=>a.localeCompare(b,'tr')),
      groupIndex:weighted(supplier.groupIndexes),modelWins:modelWins.get(supplier.key)||0,modelIndex:mean(supplier.modelIndexes),modelIndexSample:supplier.modelIndexes.length,approvalRate:supplier.values.length?supplier.approved/supplier.values.length*100:0,items:supplier.items}))
      .sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'tr'));
    const totalAvg=mean(list.map(observation=>observation.value));
    return {groupBy,minSample,count:list.length,models:new Set(list.map(observation=>clean(observation.identityKey||observation.modelKey))).size,avg:totalAvg,groups:groupList,suppliers:supplierList,observations:list,
      columns:supplierList.slice().sort(compareSuppliers).map(supplier=>({key:supplier.key,name:supplier.name}))};
  }
  /* Buyer karşılaştırması (çok buyer'lı görünüm): her buyer'ın aynı
     gruplardaki fiyatı grup ortalamasına göre nerede? */
  function buyerComparison(observations,options={}){
    const groupBy=GROUP_DIMENSIONS.includes(options.groupBy)?options.groupBy:'classification';
    const list=filterObservations(observations,options.filters).filter(observation=>observation&&observation.value!=null);
    const groupAvg=new Map();
    const groupValues=new Map();
    list.forEach(observation=>{const key=keyOf(observationValue(observation,groupBy));if(!groupValues.has(key))groupValues.set(key,[]);groupValues.get(key).push(observation.value);});
    groupValues.forEach((values,key)=>groupAvg.set(key,mean(values)));
    const buyers=new Map();
    list.forEach(observation=>{
      const name=clean(observation.buyer)||'—',key=keyOf(name);
      if(!buyers.has(key))buyers.set(key,{key,name,values:[],indexes:[],models:new Set(),suppliers:new Set(),approved:0});
      const buyer=buyers.get(key);
      buyer.values.push(observation.value);buyer.models.add(clean(observation.identityKey||observation.modelKey));buyer.suppliers.add(keyOf(observation.manufacturer));if(observation.approved)buyer.approved++;
      const base=groupAvg.get(keyOf(observationValue(observation,groupBy)));
      const index=pct(observation.value,base);if(index!=null)buyer.indexes.push(index);
    });
    return [...buyers.values()].map(buyer=>({key:buyer.key,name:buyer.name,avg:mean(buyer.values),count:buyer.values.length,models:buyer.models.size,suppliers:buyer.suppliers.size,approved:buyer.approved,index:mean(buyer.indexes)}))
      .sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'tr'));
  }

  return {lineOptions,compareSuppliers,supplierScorecards,supplierLayout,OUTLIER_RATIO,GROUP_DIMENSIONS,price,mean,median,pct,keyOf,effectiveHistory,offers,negotiation,requestMatrix,rowStats,outlierRatio,bulkApproveCandidates,rounds,requestGain,lane,responseRates,historySeries,filterObservations,dimensionValues,analyze,buyerComparison};
});
