/* Fiyat & Üretici Analizi — saf hesap motoru (tarayıcı + Node).
   Görünümden bağımsızdır: BLPriceSupplierAnalysisBridge'in ürettiği kanonik
   gözlemleri alır, buyer'ın sorduğu sorulara doğrudan cevap veren özetler üretir:
   - hangi klasmanda hangi üretici avantajlı (klasman ortalamasına göre fiyat),
   - üreticilerin aynı klasmanlardaki (like-for-like) fiyat değişimi,
   - yeni / çıkan üreticiler ve hacim hareketi,
   - buying group / MAG / MMYG / ülke gibi kırılımların hangi üreticilerle çalıştığı.
   Fiyat kıyasları yalnız seçilen TEK para biriminde yapılır; hacim kıyasları tüm
   kayıtları kullanır. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.BLPriceSupplierInsights=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const DIMENSIONS=['manufacturer','country','classification','productGroup','productMainDefinition','mag','mmyg','buyingGroup','buyer'];
  const FILTER_DIMENSIONS=['buyingGroup','buyer','mag','mmyg','classification','productGroup','productMainDefinition','country','manufacturer'];
  /* Kanonik boyutların dışında, kaynağın ham satırındaki HERHANGİ bir sütun
     "col:<başlık>" anahtarıyla filtre olarak kullanılabilir. Değerler ilk
     istekte tembel hesaplanır ve veri setinde önbelleklenir. */
  const COLUMN_PREFIX='col:';
  const PERIOD_FIELDS=Object.freeze({inStore:'inStoreMonth',opd:'opdMonth'});
  const GROUP_DIMENSIONS=['classification','productGroup','mag','mmyg'];
  const RELATION_DIMENSIONS=['buyingGroup','buyer','mag','mmyg','classification','productGroup','country'];
  const VOLUME_STATUS_BAND=10;
  const PRICE_SIGNAL=3;

  const text=value=>String(value==null?'':value).trim();
  const clean=value=>{const out=text(value);return /^(?:—|-|\(boş\)|\(empty\)|null|undefined)$/i.test(out)?'':out;};
  const keyOf=value=>clean(value).replace(/[ıİ]/g,'I').toUpperCase().replace(/Ş/g,'S').replace(/Ç/g,'C').replace(/Ö/g,'O').replace(/Ü/g,'U').replace(/Ğ/g,'G').replace(/\s+/g,' ');
  const positive=value=>{const n=Number(value);return Number.isFinite(n)&&n>0?n:0;};
  const round=(value,digits=1)=>value==null||!Number.isFinite(value)?null:Math.round(value*10**digits)/10**digits;
  const monthValue=value=>{const raw=clean(value);const m=/^(\d{4})[-/]?(\d{2})/.exec(raw);return m&&Number(m[2])>=1&&Number(m[2])<=12?`${m[1]}-${m[2]}`:'';};

  function field(obs,name){
    if(!obs)return '';
    if(obs[name]!=null&&clean(obs[name]))return obs[name];
    const row=obs.row||obs.raw;return row&&row[name]!=null?row[name]:'';
  }
  /* Gözlem → düz kayıt. Aynı üreticinin farklı yazımları (büyük/küçük harf,
     Türkçe karakter) tek anahtarda birleşir; ekranda ilk görülen yazım kalır. */
  function prepare(observations){
    const records=[],labels=Object.fromEntries(DIMENSIONS.map(dim=>[dim,new Map()]));
    // Normalization repeats for the same labels across thousands of rows.
    // Keep this bounded cache local to preparation; dataset changes start fresh.
    const normalizedLabels=new Map();
    let withQty=0;
    for(const obs of observations||[]){
      if(!obs)continue;
      const rec={obs,season:clean(field(obs,'season')),price:positive(obs.price)||null,currency:text(obs.currency).toUpperCase()||'USD',qty:positive(obs.quantity),model:text(obs.modelKey)||text(obs.model)||text(obs.rowId),k:{},l:{},periods:{
        inStore:monthValue(field(obs,'inStoreMonth'))||monthValue(field(obs,'month')),
        opd:monthValue(field(obs,'opdMonth')),
      }};
      for(const dim of DIMENSIONS){
        const label=clean(field(obs,dim));let key=normalizedLabels.get(label);
        if(key===undefined){key=keyOf(label);if(normalizedLabels.size<1024)normalizedLabels.set(label,key);}
        rec.k[dim]=key;
        if(key&&!labels[dim].has(key))labels[dim].set(key,label);
      }
      if(rec.qty>0)withQty++;
      records.push(rec);
    }
    for(const rec of records)for(const dim of DIMENSIONS)rec.l[dim]=rec.k[dim]?labels[dim].get(rec.k[dim]):'';
    /* Kayıtların çoğunda adet varsa ağırlık adettir (sipariş kaynakları);
       yoksa (ör. teklif listesi) her kayıt bir sayılır. */
    const weighted=records.length>0&&withQty/records.length>=0.5;
    for(const rec of records)rec.weight=weighted?rec.qty:1;
    const currencyWeight=new Map();
    for(const rec of records)if(rec.price&&rec.weight>0)currencyWeight.set(rec.currency,(currencyWeight.get(rec.currency)||0)+rec.weight);
    const currencies=[...currencyWeight.entries()].sort((a,b)=>b[1]-a[1]).map(([code])=>code);
    return {records,weighted,currencies,primaryCurrency:currencies[0]||'USD',labels};
  }

  function seasonCompare(a,b){
    const rules=typeof globalThis!=='undefined'&&globalThis.BLBusinessRules;
    if(rules&&typeof rules.compareSeasonPrefixThenNumber==='function')return rules.compareSeasonPrefixThenNumber(a,b);
    return String(a).localeCompare(String(b),'tr',{numeric:true});
  }
  function seasons(dataset){
    const set=new Set();for(const rec of dataset.records||[])if(rec.season)set.add(rec.season);
    return [...set].sort(seasonCompare);
  }
  function previousSeason(current,list){
    const rules=typeof globalThis!=='undefined'&&globalThis.BLBusinessRules;
    if(rules&&typeof rules.previousSeasonByPrefix==='function')return rules.previousSeasonByPrefix(current,list)||'';
    const index=list.indexOf(current);return index>0?list[index-1]:'';
  }
  function defaultPeriods(list){const current=list[list.length-1]||'';return {currentSeason:current,previousSeason:current?previousSeason(current,list):''};}
  const isColumnDim=dim=>typeof dim==='string'&&dim.startsWith(COLUMN_PREFIX)&&dim.length>COLUMN_PREFIX.length;
  const columnName=dim=>isColumnDim(dim)?dim.slice(COLUMN_PREFIX.length):'';
  const isFilterDim=dim=>FILTER_DIMENSIONS.includes(dim)||isColumnDim(dim);
  function rawRow(obs){const row=obs&&(obs.row||obs.raw);return row&&typeof row==='object'?row:null;}
  function cellText(value){
    if(value==null)return '';
    if(value instanceof Date)return Number.isNaN(value.getTime())?'':value.toISOString().slice(0,10);
    if(typeof value==='object')return '';
    return clean(value);
  }
  /* Ham satırlarda en az bir dolu değeri olan sütun başlıkları ('_' ile
     başlayan iç alanlar hariç). */
  function columnKeys(dataset){
    if(!dataset)return [];
    if(dataset.columnCache)return dataset.columnCache;
    const set=new Set();
    for(const rec of dataset.records||[]){
      const row=rawRow(rec.obs);if(!row)continue;
      for(const key of Object.keys(row)){if(!key||key[0]==='_'||set.has(key))continue;if(cellText(row[key]))set.add(key);}
    }
    const list=[...set].sort((a,b)=>a.localeCompare(b,'tr',{numeric:true,sensitivity:'base'}));
    Object.defineProperty(dataset,'columnCache',{value:list,configurable:true});
    return list;
  }
  function columnLabels(dataset,column){
    if(!dataset.columnLabels)Object.defineProperty(dataset,'columnLabels',{value:new Map(),configurable:true});
    let map=dataset.columnLabels.get(column);if(map)return map;
    map=new Map();
    for(const rec of dataset.records||[]){
      const row=rawRow(rec.obs),label=row?cellText(row[column]):'',key=keyOf(label);
      (rec.c||(rec.c={}))[column]=key;
      if(key&&!map.has(key))map.set(key,label);
    }
    dataset.columnLabels.set(column,map);
    return map;
  }
  function recordKey(rec,dim){
    if(!isColumnDim(dim))return rec.k[dim];
    const column=columnName(dim);
    if(rec.c&&rec.c[column]!==undefined)return rec.c[column];
    const row=rawRow(rec.obs),key=keyOf(row?cellText(row[column]):'');
    (rec.c||(rec.c={}))[column]=key;
    return key;
  }
  function dimensionValues(dataset,dim){
    const map=isColumnDim(dim)?columnLabels(dataset,columnName(dim)):dataset.labels&&dataset.labels[dim];if(!map)return [];
    return [...map.values()].sort((a,b)=>a.localeCompare(b,'tr',{numeric:true,sensitivity:'base'}));
  }
  function availableDimensions(dataset,list){return list.filter(dim=>dataset.labels&&dataset.labels[dim]&&dataset.labels[dim].size>0);}
  function periodValues(dataset,dateField,season=''){
    const field=PERIOD_FIELDS[dateField]?dateField:'inStore',wantedSeason=clean(season),set=new Set();
    for(const rec of dataset.records||[]){if(wantedSeason&&rec.season!==wantedSeason)continue;const value=rec.periods&&rec.periods[field];if(value)set.add(value);}
    return [...set].sort((a,b)=>a.localeCompare(b,'tr',{numeric:true}));
  }
  function periodMatches(rec,config){
    if(!config||!config.month)return true;
    const field=PERIOD_FIELDS[config.dateField]?config.dateField:'inStore';
    return (rec.periods&&rec.periods[field]||'')===monthValue(config.month);
  }

  function bucket(){return {volume:0,records:0,models:new Set(),pricedModels:new Set(),priceSum:0,priceWeight:0,items:[]};}
  function add(target,rec,currency){
    target.volume+=rec.weight;target.records++;if(rec.model)target.models.add(rec.model);target.items.push(rec.obs);
    if(rec.price&&rec.currency===currency&&rec.weight>0){target.priceSum+=rec.price*rec.weight;target.priceWeight+=rec.weight;if(rec.model)target.pricedModels.add(rec.model);}
  }
  const avg=target=>target&&target.priceWeight>0?target.priceSum/target.priceWeight:null;
  const pct=(value,base)=>value!=null&&base!=null&&base>0?(value/base-1)*100:null;
  /* Yeni/ayrılan kararı kayıt varlığından verilir: adet ağırlıklı veride adedi
     boş bir sipariş satırı hacme 0 katar ama üretici yine de o sezonda vardır. */
  function volumeStatus(current,previous,hasComparison,currentRecords,previousRecords){
    if(!hasComparison)return 'active';
    if(!previousRecords&&currentRecords)return 'new';
    if(!currentRecords&&previousRecords)return 'exit';
    const change=previous>0?(current-previous)/previous*100:0;
    return change>VOLUME_STATUS_BAND?'growing':change<-VOLUME_STATUS_BAND?'declining':'stable';
  }
  function prepareFilters(filters){
    const prepared=[];
    for(const dim of Object.keys(filters||{})){
      if(!isFilterDim(dim))continue;
      const raw=filters[dim],wanted=new Set((Array.isArray(raw)?raw:[raw]).map(keyOf).filter(Boolean));
      if(wanted.size)prepared.push({dim,wanted});
    }
    return prepared;
  }
  function matches(rec,filters){
    for(const {dim,wanted} of filters)if(!wanted.has(recordKey(rec,dim)))return false;
    return true;
  }
  function weightedMean(parts){let sum=0,weight=0;for(const part of parts){if(part.value==null||!(part.weight>0))continue;sum+=part.value*part.weight;weight+=part.weight;}return weight>0?{value:sum/weight,weight}:null;}

  /* Ana analiz. groupBy, "klasman" kıyaslarının hangi kırılımda yapılacağını
     belirler (Klasman, Ürün Grubu, MAG, MMYG). Fiyat değişimi ve fiyat seviyesi
     her zaman bu kırılımın İÇİNDE hesaplanır: ürün karması farkı, üreticinin
     pahalı/ucuz görünmesine yol açmaz. */
  function analyze(dataset,options={}){
    const currency=(dataset.currencies||[]).includes(options.currency)?options.currency:(dataset.primaryCurrency||'USD');
    const minSample=Math.max(1,Math.round(Number(options.minSample)||2));
    const groupBy=GROUP_DIMENSIONS.includes(options.groupBy)?options.groupBy:'classification';
    const currentSeason=text(options.currentSeason),previousSeasonValue=text(options.previousSeason);
    /* Kıyas yalnız belirli bir sezon seçiliyken anlamlıdır; "tüm sezonlar"
       seçiliyken kıyas sezonu güncel tarafa zaten dahildir. */
    const hasComparison=!!currentSeason&&!!previousSeasonValue&&previousSeasonValue!==currentSeason;
    const totals={cur:bucket(),prev:bucket()},manufacturers=new Map(),countries=new Map(),groups=new Map();
    const ensure=(map,key,label,extra)=>{let item=map.get(key);if(!item){item={key,name:label,cur:bucket(),prev:bucket(),...(extra?extra():{})};map.set(key,item);}return item;};
    const current=[],previous=[];
    const filters=prepareFilters(options.filters);
    for(const rec of dataset.records||[]){
      if(!matches(rec,filters))continue;
      const side=!currentSeason||rec.season===currentSeason?'cur':hasComparison&&rec.season===previousSeasonValue?'prev':'';
      if(!side)continue;
      if(!periodMatches(rec,side==='cur'?options.currentPeriod:options.previousPeriod))continue;
      (side==='cur'?current:previous).push(rec);
      add(totals[side],rec,currency);
      const mKey=rec.k.manufacturer,gKey=rec.k[groupBy]||'';
      if(mKey){
        const m=ensure(manufacturers,mKey,rec.l.manufacturer,()=>({groups:new Map(),countries:new Map(),buyingGroups:new Map()}));
        add(m[side],rec,currency);
        add(ensure(m.groups,gKey,rec.l[groupBy])[side],rec,currency);
        if(side==='cur'){add(ensure(m.countries,rec.k.country,rec.l.country).cur,rec,currency);add(ensure(m.buyingGroups,rec.k.buyingGroup,rec.l.buyingGroup).cur,rec,currency);}
      }
      if(rec.k.country)add(ensure(countries,rec.k.country,rec.l.country)[side],rec,currency);
      const g=ensure(groups,gKey,rec.l[groupBy],()=>({suppliers:new Map()}));
      add(g[side],rec,currency);
      if(mKey)add(ensure(g.suppliers,mKey,rec.l.manufacturer)[side],rec,currency);
    }
    const curVolume=totals.cur.volume,prevVolume=totals.prev.volume;

    /* Klasman bazında üretici konumu (güncel sezon). */
    const groupList=[...groups.values()].filter(g=>g.cur.records>0).map(g=>{
      const groupAvg=avg(g.cur);
      const suppliers=[...g.suppliers.values()].filter(s=>s.cur.records>0).map(s=>{
        /* Örnek eşiği yalnız seçili para biriminde fiyatı olan modelleri sayar. */
        const price=avg(s.cur),models=s.cur.models.size,priced=s.cur.pricedModels.size;
        return {key:s.key,name:s.name,price,index:pct(price,groupAvg),volume:s.cur.volume,share:g.cur.volume>0?s.cur.volume/g.cur.volume*100:0,models,eligible:price!=null&&priced>=minSample,items:s.cur.items};
      }).sort((a,b)=>b.volume-a.volume||a.name.localeCompare(b.name,'tr'));
      const eligible=suppliers.filter(s=>s.eligible);
      const ranked=eligible.slice().sort((a,b)=>a.price-b.price);
      return {key:g.key,name:g.name||'',volume:g.cur.volume,share:curVolume>0?g.cur.volume/curVolume*100:0,price:groupAvg,models:g.cur.models.size,suppliers,
        best:ranked.length>=2?ranked[0]:null,priciest:ranked.length>=2?ranked[ranked.length-1]:null,leader:suppliers[0]||null,comparable:ranked.length>=2,
        priceChange:hasComparison?pct(groupAvg,avg(g.prev)):null,items:g.cur.items};
    }).sort((a,b)=>b.volume-a.volume||a.name.localeCompare(b.name,'tr'));
    const groupIndex=new Map(groupList.map(g=>[g.key,g]));

    /* Piyasa geneli like-for-like fiyat değişimi: her klasmanın kendi
       ortalamasındaki değişim, güncel hacimle ağırlıklandırılır. */
    const marketChange=hasComparison?weightedMean([...groups.values()].map(g=>({value:pct(avg(g.cur),avg(g.prev)),weight:g.cur.volume}))):null;

    const manufacturerList=[...manufacturers.values()].map(m=>{
      const curPrice=avg(m.cur),groupRows=[...m.groups.values()].filter(row=>row.cur.records>0||row.prev.records>0).map(row=>{
        const g=groupIndex.get(row.key),price=avg(row.cur),models=row.cur.models.size,priced=row.cur.pricedModels.size;
        return {key:row.key,name:row.name||'',volume:row.cur.volume,previousVolume:row.prev.volume,records:row.cur.records,price,models,index:g&&g.comparable&&priced>=minSample?pct(price,g.price):null,
          groupShare:g&&g.volume>0?row.cur.volume/g.volume*100:0,priceChange:hasComparison?pct(price,avg(row.prev)):null,items:row.cur.items};
      }).sort((a,b)=>b.volume-a.volume||a.name.localeCompare(b.name,'tr'));
      const level=weightedMean(groupRows.map(row=>({value:row.index,weight:row.volume})));
      const change=hasComparison?weightedMean(groupRows.map(row=>({value:row.priceChange,weight:row.volume}))):null;
      const strengths=groupRows.filter(row=>row.index!=null&&row.index<=-PRICE_SIGNAL).sort((a,b)=>a.index-b.index);
      const listOf=map=>[...map.values()].filter(row=>row.key&&row.cur.records>0).map(row=>({name:row.name,volume:row.cur.volume,share:m.cur.volume>0?row.cur.volume/m.cur.volume*100:0})).sort((a,b)=>b.volume-a.volume);
      return {key:m.key,name:m.name,volume:m.cur.volume,previousVolume:m.prev.volume,share:curVolume>0?m.cur.volume/curVolume*100:0,previousShare:prevVolume>0?m.prev.volume/prevVolume*100:0,
        volumeChange:m.prev.volume>0?(m.cur.volume-m.prev.volume)/m.prev.volume*100:null,price:curPrice,previousPrice:avg(m.prev),models:m.cur.models.size,
        priceLevel:level?level.value:null,priceChange:change?change.value:null,priceChangeCoverage:change&&m.cur.volume>0?Math.min(100,change.weight/m.cur.volume*100):0,
        records:m.cur.records,previousRecords:m.prev.records,status:volumeStatus(m.cur.volume,m.prev.volume,hasComparison,m.cur.records,m.prev.records),groups:groupRows,strengths,countries:listOf(m.countries),buyingGroups:listOf(m.buyingGroups),items:m.cur.items,previousItems:m.prev.items};
    }).sort((a,b)=>b.volume-a.volume||b.previousVolume-a.previousVolume||a.name.localeCompare(b.name,'tr'));
    const active=manufacturerList.filter(m=>m.records>0);

    const countryList=[...countries.values()].map(c=>({key:c.key,name:c.name,volume:c.cur.volume,previousVolume:c.prev.volume,share:curVolume>0?c.cur.volume/curVolume*100:0,previousShare:prevVolume>0?c.prev.volume/prevVolume*100:0,
      records:c.cur.records,previousRecords:c.prev.records,price:avg(c.cur),priceChange:hasComparison?pct(avg(c.cur),avg(c.prev)):null,items:c.cur.items})).filter(c=>c.records>0||c.previousRecords>0).sort((a,b)=>b.volume-a.volume||b.previousVolume-a.previousVolume);
    countryList.forEach(c=>{c.shareChange=hasComparison?c.share-c.previousShare:null;});

    const topShare=count=>curVolume>0?active.slice(0,count).reduce((sum,m)=>sum+m.volume,0)/curVolume*100:0;
    return {
      currency,currencies:dataset.currencies||[],weighted:!!dataset.weighted,groupBy,minSample,currentSeason,previousSeason:hasComparison?previousSeasonValue:'',hasComparison,
      totals:{volume:curVolume,previousVolume:prevVolume,volumeChange:hasComparison&&prevVolume>0?(curVolume-prevVolume)/prevVolume*100:null,price:avg(totals.cur),previousPrice:avg(totals.prev),
        marketPriceChange:marketChange?marketChange.value:null,models:totals.cur.models.size,records:totals.cur.records,manufacturers:active.length,
        newManufacturers:active.filter(m=>m.status==='new').length,exitManufacturers:manufacturerList.filter(m=>m.status==='exit').length,countries:countryList.filter(c=>c.records>0).length,top3Share:topShare(3)},
      manufacturers:manufacturerList,countries:countryList,groups:groupList,current,previous,
    };
  }

  /* Fiyat hareketi: yalnız kıyas döneminde de aynı klasmanda fiyatı olan
     üreticiler. En az %30 hacim kapsaması aranır; aksi hâlde "değişim" birkaç
     modelin tesadüfi fiyatını yansıtır. */
  function priceMovers(model,limit=8){
    const eligible=(model.manufacturers||[]).filter(m=>m.records>0&&m.priceChange!=null&&m.priceChangeCoverage>=30);
    const up=eligible.filter(m=>m.priceChange>0).sort((a,b)=>b.priceChange-a.priceChange).slice(0,limit);
    const down=eligible.filter(m=>m.priceChange<0).sort((a,b)=>a.priceChange-b.priceChange).slice(0,limit);
    return {up,down,count:eligible.length};
  }
  function volumeMovers(model,limit=8){
    const list=(model.manufacturers||[]).filter(m=>m.records>0||m.previousRecords>0).map(m=>({...m,volumeDelta:m.volume-m.previousVolume}));
    return {up:list.filter(m=>m.volumeDelta>0).sort((a,b)=>b.volumeDelta-a.volumeDelta).slice(0,limit),down:list.filter(m=>m.volumeDelta<0).sort((a,b)=>a.volumeDelta-b.volumeDelta).slice(0,limit)};
  }
  function newcomers(model){return (model.manufacturers||[]).filter(m=>m.status==='new');}
  function leavers(model){return (model.manufacturers||[]).filter(m=>m.status==='exit').sort((a,b)=>b.previousVolume-a.previousVolume);}

  /* "Kim kiminle çalışıyor": seçilen kırılımın her değeri için üretici payları. */
  function relations(model,dimension='buyingGroup',top=3){
    const dim=RELATION_DIMENSIONS.includes(dimension)?dimension:'buyingGroup',rows=new Map();
    for(const rec of model.current||[]){
      const key=rec.k[dim];if(!key)continue;
      let row=rows.get(key);if(!row){row={key,name:rec.l[dim],volume:0,suppliers:new Map(),items:[]};rows.set(key,row);}
      row.volume+=rec.weight;row.items.push(rec.obs);
      const mKey=rec.k.manufacturer||'',name=rec.l.manufacturer||'';
      let supplier=row.suppliers.get(mKey);if(!supplier){supplier={key:mKey,name,volume:0,items:[]};row.suppliers.set(mKey,supplier);}
      supplier.volume+=rec.weight;supplier.items.push(rec.obs);
    }
    return [...rows.values()].filter(row=>row.items.length>0).map(row=>{
      const share=s=>row.volume>0?s.volume/row.volume*100:s.items.length/row.items.length*100;
      const suppliers=[...row.suppliers.values()].sort((a,b)=>b.volume-a.volume||b.items.length-a.items.length||a.name.localeCompare(b.name,'tr')).map(s=>({...s,share:share(s)}));
      const head=suppliers.slice(0,top),rest=suppliers.slice(top);
      const other=rest.length?{key:'__other__',name:'',volume:rest.reduce((sum,s)=>sum+s.volume,0),share:rest.reduce((sum,s)=>sum+s.share,0),count:rest.length,items:rest.flatMap(s=>s.items)}:null;
      return {key:row.key,name:row.name,volume:row.volume,supplierCount:suppliers.length,segments:head,other,items:row.items};
    }).sort((a,b)=>b.volume-a.volume||a.name.localeCompare(b.name,'tr'));
  }

  /* Buyer'a dönük düz dilli öneriler. Her öneri bir sekmeye yönlendirir. */
  function insights(model,lang='tr'){
    const en=String(lang).toLowerCase().startsWith('en'),locale=en?'en-GB':'tr-TR',out=[];
    const n=value=>Math.round(value||0).toLocaleString(locale),p=value=>Math.abs(Number(value)||0).toLocaleString(locale,{maximumFractionDigits:1});
    if(!model||!(model.totals.records>0))return out;
    const t=model.totals;
    if(model.hasComparison&&t.volumeChange!=null)out.push({tone:t.volumeChange>=0?'info':'warn',tab:'overview',icon:'chart-histogram',
      text:en?`${model.currentSeason} volume is ${p(t.volumeChange)}% ${t.volumeChange>=0?'above':'below'} ${model.previousSeason}.`:`${model.currentSeason} hacmi ${model.previousSeason} sezonuna göre %${p(t.volumeChange)} ${t.volumeChange>=0?'daha yüksek':'daha düşük'}.`});
    const opportunity=(model.groups||[]).find(g=>g.best&&g.best.index!=null&&g.best.index<=-5);
    if(opportunity)out.push({tone:'good',tab:'advantage',icon:'star',focus:opportunity.key,
      text:en?`Best value in ${opportunity.name}: ${opportunity.best.name}, ${p(opportunity.best.index)}% below the average price.`:`${opportunity.name} için en avantajlı üretici ${opportunity.best.name}: ortalama fiyatın %${p(opportunity.best.index)} altında.`});
    const movers=priceMovers(model,1);
    if(movers.up[0]&&movers.up[0].priceChange>=PRICE_SIGNAL)out.push({tone:'bad',tab:'movement',icon:'arrows-down-up',focus:movers.up[0].key,
      text:en?`Largest price increase: ${movers.up[0].name}, +${p(movers.up[0].priceChange)}% in the same categories.`:`Fiyatı en çok artan üretici ${movers.up[0].name}: aynı klasmanlarda +%${p(movers.up[0].priceChange)}.`});
    if(movers.down[0]&&movers.down[0].priceChange<=-PRICE_SIGNAL)out.push({tone:'good',tab:'movement',icon:'arrows-down-up',focus:movers.down[0].key,
      text:en?`Largest price decrease: ${movers.down[0].name}, −${p(movers.down[0].priceChange)}% in the same categories.`:`Fiyatı en çok düşen üretici ${movers.down[0].name}: aynı klasmanlarda −%${p(movers.down[0].priceChange)}.`});
    const expensive=(model.manufacturers||[]).filter(m=>m.records>0).slice(0,5).filter(m=>m.priceLevel!=null&&m.priceLevel>=8).sort((a,b)=>b.priceLevel-a.priceLevel)[0];
    if(expensive)out.push({tone:'warn',tab:'scorecard',icon:'coins',focus:expensive.key,
      text:en?`${expensive.name} is a major supplier but prices ${p(expensive.priceLevel)}% above category averages — room to negotiate.`:`${expensive.name} büyük bir üretici ama klasman ortalamalarının %${p(expensive.priceLevel)} üstünde fiyat veriyor — pazarlık fırsatı.`});
    const fresh=newcomers(model);
    if(fresh.length)out.push({tone:'info',tab:'movement',icon:'star',
      text:en?`${fresh.length} new supplier${fresh.length>1?'s':''} this season: ${fresh.slice(0,3).map(m=>m.name).join(', ')}${fresh.length>3?'…':''}.`:`Bu sezon ${fresh.length} yeni üretici var: ${fresh.slice(0,3).map(m=>m.name).join(', ')}${fresh.length>3?'…':''}.`});
    if(t.manufacturers>=4&&t.top3Share>=60)out.push({tone:'warn',tab:'scorecard',icon:'users-group',
      text:en?`${p(t.top3Share)}% of volume sits with the top 3 suppliers — consider developing alternatives.`:`Hacmin %${p(t.top3Share)}'i ilk 3 üreticide — alternatif üretici geliştirmeyi düşünebilirsiniz.`});
    const lead=(model.countries||[])[0];
    if(lead&&lead.volume>0)out.push({tone:'info',tab:'overview',icon:'globe',
      text:en?`Leading country: ${lead.name} with ${p(lead.share)}% share${lead.shareChange!=null?` (${lead.shareChange>=0?'+':'−'}${p(lead.shareChange)} pts)`:''}.`:`Lider üretim ülkesi ${lead.name}: %${p(lead.share)} pay${lead.shareChange!=null?` (${lead.shareChange>=0?'+':'−'}${p(lead.shareChange)} puan)`:''}.`});
    return out.slice(0,6);
  }

  return {DIMENSIONS,FILTER_DIMENSIONS,COLUMN_PREFIX,isColumnDim,columnName,isFilterDim,columnKeys,PERIOD_FIELDS,GROUP_DIMENSIONS,RELATION_DIMENSIONS,keyOf,prepare,seasons,defaultPeriods,previousSeason,dimensionValues,availableDimensions,periodValues,analyze,priceMovers,volumeMovers,newcomers,leavers,relations,insights,round};
});
