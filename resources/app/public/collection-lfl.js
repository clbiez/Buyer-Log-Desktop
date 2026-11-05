(function(global){
  'use strict';
  const Engine=global.BLCollectionLflEngine;
  let current=null;
  const en=()=>typeof appLang!=='undefined'&&appLang==='en';
  const T=(tr,english)=>en()?english:tr;
  const esc=value=>escapeHtml(String(value??''));
  const identity=()=>{const user=typeof state!=='undefined'?state.currentUser:global.BL_USER_CONTEXT;return JSON.stringify([user?.id,user?.iamRevision,user?.dataScope,user?.scopes]);};
  function session(){const id=identity();if(current?.id!==id){current={id,status:'idle',index:new Map(),detailRows:new Map(),pending:null,countries:[]};rulesCache=null;}return current;}
  /* BUYER ÜLKE KURALI: her buyer kendi çalışmadığı üretim ülkelerini Previous Season, LFL ve
     Sezon Etkisi referanslarından çıkarır. Kural kişisel tercihtir (hesapla eşitlenir); kaynak
     veri ve kalıcı referans özetleri değişmez, hariç tutma ülke kırılımı üzerinden hesaplanır. */
  const RULES_KEY='lcw.koleksiyon.analytics.lflCountryRules.v1';
  let rulesCache=null;
  function countryRules(){
    if(rulesCache)return rulesCache;
    let parsed=[];
    try{const raw=JSON.parse(global.BLStorage?.getItem(RULES_KEY)||'null');parsed=Array.isArray(raw?.rules)?raw.rules:[];}catch(_){parsed=[];}
    rulesCache=parsed.filter(rule=>rule&&typeof rule.buyer==='string'&&rule.buyer.trim()).map(rule=>({buyer:rule.buyer==='*'?'*':rule.buyer.trim(),countries:Engine.countryList(rule.countries)})).filter(rule=>rule.countries.length);
    return rulesCache;
  }
  const ruleId=buyer=>buyer==='*'?'*':String(buyer||'').trim().toLocaleUpperCase('tr-TR');
  function setCountryRule(buyer,countries){
    const name=buyer==='*'?'*':String(buyer||'').trim();if(!name)return false;
    const codes=Engine.countryList(countries),rules=countryRules().filter(rule=>ruleId(rule.buyer)!==ruleId(name));
    if(codes.length)rules.push({buyer:name,countries:codes});
    try{global.BLStorage?.setItem(RULES_KEY,JSON.stringify({rules}));}catch(_){return false;}
    rulesCache=rules;
    session().detailRows=new Map();
    repaint();
    return true;
  }
  const rowBuyer=(row,read=kolEffectiveValue)=>String(read(row,'buyer')||row?._collectionOwnerName||'').trim();
  // Saved pre-country summaries cannot be filtered; they are shown unchanged until references are refreshed.
  const excludedFor=(row,read)=>session().countryAware?Engine.countryRuleFor(countryRules(),rowBuyer(row,read)):[];
  const countryNames=new Map();
  function countryName(code){
    if(!code)return T('Bilinmiyor','Unknown');
    const lang=en()?'en':'tr',id=lang+':'+code;
    if(countryNames.has(id))return countryNames.get(id);
    let label=code;
    try{const name=new Intl.DisplayNames([lang],{type:'region'}).of(code);if(name&&name!==code)label=`${name} (${code})`;}catch(_){}
    countryNames.set(id,label);return label;
  }
  const exclusionText=codes=>codes.length?T(`Hariç ülkeler: ${codes.map(countryName).join(', ')}`,`Excluded countries: ${codes.map(countryName).join(', ')}`):'';
  function repaint(){
    if(document.body.dataset.activeTab==='koleksiyon'&&typeof renderKol==='function')renderKol();
    global.BLCollectionPriceDrawer?.refresh?.();
  }
  function ensure({rebuild=false}={}){
    const active=session();
    if(active.pending)return active.pending;
    if(!rebuild&&!active.invalidated&&active.status!=='idle')return Promise.resolve();
    active.invalidated=false;
    const hadReference=active.status==='ready';
    if(!hadReference)active.status='loading';
    active.refreshError='';
    active.detailRows=new Map();
    active.pending=(async()=>{
      try{
        const response=await fetch('/api/collection-lfl-reference'+(rebuild?'?rebuild=1':''),{cache:'no-store'});
        const data=await response.json();
        if(!response.ok){
          if(response.status===403){active.status='forbidden';active.index=new Map();active.timelines=null;}
          else if(hadReference){active.status='ready';active.refreshError=data.code||'LOAD_ERROR';}
          else active.status=data.code==='SOURCE_FILTER_REQUIRED'?'filter':'error';
          return;
        }
        active.index=new Map((data.references||[]).map(item=>[item.key,item]));active.countryAware=(data.references||[]).some(item=>Array.isArray(item.byCountry));active.countries=[...new Set((data.references||[]).filter(item=>item.currency==='USD').flatMap(item=>(item.byCountry||[]).map(part=>part.country)))].filter(Boolean).sort();active.timelines=Engine.createSeasonTimelines(data.references);active.version=String(data.version||'');active.calculatedAt=data.calculatedAt;active.status='ready';
      }catch(_){active.status=hadReference?'ready':'error';active.refreshError='LOAD_ERROR';}
      finally{active.pending=null;if(current===active)repaint();}
    })();
    return active.pending;
  }
  function invalidate(){
    // Source refreshes may clear their own runtime; retain displayed references
    // until a new durable response has successfully replaced them.
    const active=session();active.detailRows=new Map();active.invalidated=true;
    if(document.body.dataset.activeTab==='koleksiyon')void ensure({rebuild:false});
  }
  function projectRow(row,read=kolEffectiveValue){
    const projected={...row};
    for(const key of ['season','mag','urunTipi','inStoreMonth','quantity','targetPrice','confirmedManufacturer','buyer'])projected[key]=read(row,key);
    return projected;
  }
  function sampleWarning(reference){
    const unknownSample=Boolean(reference&&(reference.unidentifiedCount>0||!Number.isInteger(reference.orderCount)||reference.orderCount<1));
    const lowSample=Boolean(reference&&!unknownSample&&reference.orderCount<=3);
    const warning=unknownSample?T('Referanstaki farklı sipariş sayısı doğrulanamıyor; kıyaslamayı kontrol edin.','The number of distinct reference orders cannot be verified; review the comparison.'):lowSample?T(`Referans yalnız ${reference.orderCount} farklı siparişe dayanıyor. Model farkları sonucu etkileyebilir; kıyaslamayı kontrol edin.`,`The reference is based on only ${reference.orderCount} distinct order(s). Model differences may affect the result; review the comparison.`):'';
    const warningShort=unknownSample?T('⚠ Sipariş sayısı belirsiz','⚠ Order count unknown'):lowSample?T(`⚠ Yalnız ${reference.orderCount} sipariş`,`⚠ Only ${reference.orderCount} order(s)`):'';
    const compactWarning=unknownSample?T('⚠ Sayı belirsiz','⚠ Count unknown'):lowSample?T(`⚠ ${reference.orderCount} sipariş`,`⚠ ${reference.orderCount} orders`):'';
    const orderInfo=reference&&!unknownSample?T(`${reference.orderCount} farklı sipariş`,`${reference.orderCount} distinct order(s)`):'';
    return {lowSample,warning,warningShort,compactWarning,orderInfo};
  }
  function impactModel(row){
    const active=session(),projected=projectRow(row);
    const excluded=excludedFor(row),price=kolSuppFob(projected),result=active.status==='ready'?Engine.seasonImpact(active.timelines,projected,price?.price,excluded):{status:active.status};
    const reference=result.status==='ready'?result.reference:null,quality=sampleWarning(reference),month=Engine.budgetMonth(projected,'collection'),season=String(projected.season||''),period=[season,month].filter(Boolean).join(' · ');
    const messages={
      dimensions:T('Sezon, MAG ve Klasman gerekli.','Season, MAG and Classification are required.'),
      month:T('Sezon etkisi için Model Bütçe Ayı gerekli.','Model Budget Month is required for season impact.'),
      'no-prior':T('Sezonun ilk ayında veya önceki MB aylarında eşleşen USD siparişi yoksa sezon etkisi hesaplanmaz.','Season impact is unavailable in the first season month or when earlier MB months have no matching USD orders.'),
      'linked-order':T('Satır bir siparişe bağlı; sezona ikinci kez eklenmez.','This row is linked to an order and is not added to the season twice.'),
      quantity:T('Sezon etkisi için sıfırdan büyük adet gerekli.','A positive quantity is required for season impact.'),
      price:T('Sezon etkisi için geçerli Onaylı, Best veya Target fiyatı gerekli.','A valid Confirmed, Best or Target price is required for season impact.'),
      forbidden:T('LFL verisi için erişim yetkisi gerekli.','Access to LFL data is required.'),
      filter:T('Kaynak Veride LFL filtresini tamamlayın.','Complete the LFL filter in Source Data.'),
      error:T('Sezon referansı yüklenemedi.','Could not load the season reference.'),
    };
    const noData=result.status==='no-prior',message=reference?'':messages[result.status]||T('Sezon referansı yükleniyor…','Loading season reference…');
    const emptyText=({'no-prior':T('Önceki ay verisi yok','No earlier-month data'),quantity:T('Adet gerekli','Quantity required'),price:T('Fiyat gerekli','Price required'),'linked-order':T('Siparişe bağlı','Linked to an order'),month:T('MB ayı gerekli','MB month required')})[result.status]||'—';
    const money=value=>`$${kolFormatMoneyDisplay(String(value))}`,rounded=reference?(Math.abs(result.percent)<0.005?0:result.percent):null;
    const percentText=rounded==null?'':`${rounded>0?'+':''}${rounded.toLocaleString(en()?'en-GB':'tr-TR',{maximumFractionDigits:2})}%`;
    const averageText=reference?`${money(result.before)} → ${money(result.after)}`:'',source=price?({confirmed:'Confirmed Price',best:'Best Price',target:'Target Price'}[price.source]||''):'';
    const undated=reference?.undatedCount?T(`${reference.undatedCount} kaynak satırının MB ayı eksik; kapsama alınmadı.`,`${reference.undatedCount} source row(s) have no MB month and were excluded.`):'';
    const scope=reference?T(`${reference.firstMonth}–${reference.throughMonth} · ${reference.quantity} adet`,`${reference.firstMonth}–${reference.throughMonth} · ${reference.quantity} units`):'';
    const addition=reference?T(`Model: ${result.quantity} adet × ${money(result.price)} · ${source}`,`Model: ${result.quantity} units × ${money(result.price)} · ${source}`):'';
    const formula=T('Yeni ortalama = (mevcut tutar + model fiyatı × model adedi) / (mevcut adet + model adedi). Etki = (yeni ortalama / mevcut ortalama − 1) × 100. Aynı sezon, MAG, Klasman ve USD; yalnız modelin MB ayından önceki aylar. Her satır tek başına simüle edilir.','New average = (existing value + model price × model quantity) / (existing quantity + model quantity). Impact = (new average / existing average − 1) × 100. Same season, MAG, Classification and USD; only months before the model MB month. Each row is simulated independently.');
    const countries=exclusionText(excluded);
    const detail=reference?[period,`${projected.mag} · ${projected.urunTipi}`,scope,addition,`${averageText} · ${percentText}`,quality.orderInfo,quality.warning,undated,countries,formula].filter(Boolean).join('\n'):[message,countries].filter(Boolean).join('\n');
    return {reference,season,month,period,percent:result.percent,percentText,averageText,source,message,detail,noData,emptyText,excluded,...quality,text:reference?[period,averageText,percentText,addition,quality.warning,undated,countries].filter(Boolean).join(' · '):message,impact:result};
  }
  function model(row,mode='month'){
    if(mode==='impact')return impactModel(row);
    const active=session(),projected=projectRow(row);
    const season=Engine.previousSeason(projected.season),valid=Boolean(season&&String(projected.mag||'').trim()&&String(projected.urunTipi||'').trim());
    const month=mode==='month'?Engine.previousMonth(Engine.budgetMonth(projected,'collection')):'',period=[season,month].filter(Boolean).join(' · ');
    const excluded=excludedFor(row),reference=valid&&active.status==='ready'?Engine.reference(active.index,projected,mode,excluded):null;
    const price=kolSuppFob(projected),percent=reference?Engine.changePercent(price?.price,reference.average):null;
    const source=price?({confirmed:'Confirmed Price',best:'Best Price',target:'Target Price'}[price.source]||''):'';
    const rounded=percent==null?null:Math.abs(percent)<0.05?0:percent;
    const percentText=rounded==null?'':`${rounded>0?'+':''}${rounded.toLocaleString(en()?'en-GB':'tr-TR',{maximumFractionDigits:1})}%`;
    const averageText=reference?`$${kolFormatMoneyDisplay(String(reference.average))}`:'';
    const noData=Boolean(valid&&(mode!=='month'||month)&&active.status==='ready'&&!reference);
    const {lowSample,warning,warningShort,compactWarning,orderInfo}=sampleWarning(reference);
    const emptyText=noData?T('Kıyaslanacak veri yok','No comparison data'):'—';
    let message='';
    if(!valid)message=T('Sezon, MAG ve Klasman gerekli.','Season, MAG and Classification are required.');
    else if(mode==='month'&&!month)message=T('LFL için geçerli bir Model Bütçe Ayı gerekli.','A valid Model Budget Month is required for LFL.');
    else if(active.status==='forbidden')message=T('LFL verisi için erişim yetkisi gerekli.','Access to LFL data is required.');
    else if(active.status==='filter')message=T('Kaynak Veride LFL filtresini tamamlayın.','Complete the LFL filter in Source Data.');
    else if(active.status==='error')message=T('LFL referansı yüklenemedi.','Could not load the LFL reference.');
    else if(active.status!=='ready')message=T('LFL referansı yükleniyor…','Loading LFL reference…');
    else if(!reference)message=T(`Kıyaslanacak veri yok. ${period} için MAG + Klasman ile eşleşen USD siparişi bulunamadı.`,`No comparison data. No USD orders matching MAG + Classification were found for ${period}.`);
    const explanation=(mode==='month'?T('Önceki yılın aynı MB ayı + MAG + Klasman için adet ağırlıklı FOB ortalaması.','Quantity-weighted FOB average for the same MB month last year + MAG + Classification.'):T('Önceki sezonun tüm ayları + MAG + Klasman için adet ağırlıklı FOB ortalaması.','Quantity-weighted FOB average for all months of the previous season + MAG + Classification.'))+' '+T('Yalnız USD siparişleri. Fark = (geçerli fiyat / ortalama − 1) × 100.','USD orders only. Change = (applicable price / average − 1) × 100.');
    const countries=exclusionText(excluded);
    const detail=reference?[`${period} · ${projected.mag} · ${projected.urunTipi}`,`${orderInfo?orderInfo+' · ':''}${reference.count} ${T('kayıt','records')} · ${reference.quantity.toLocaleString(en()?'en-GB':'tr-TR')} ${T('adet','units')}`,source+(price?`: $${kolFormatMoneyDisplay(String(price.price))}`:''),warning,countries,explanation].filter(Boolean).join('\n'):[message,countries].filter(Boolean).join('\n');
    const text=reference?[period,averageText,percentText,source,orderInfo,warning,countries].filter(Boolean).join(' · '):noData?`${period} · ${emptyText}`:'';
    return {reference,season,month,period,percent,percentText,averageText,source,message,detail,text,noData,emptyText,excluded,lowSample,warning,warningShort,compactWarning};
  }
  function content(row,m=model(row)){
    if(!m.reference)return `<span class="kolPsEmpty" title="${esc(m.message)}">${esc(m.emptyText)}</span>`;
    const delta=m.percent==null?'':`<span class="kolBestDelta ${m.percent<=0?'isAtOrBelowTarget':'isAboveTarget'}">${esc(m.percentText)}</span>`;
    return `<div class="kolPs"><div class="kolPsLine"><b class="kolPsPrice">${esc(m.averageText)}</b>${delta}</div><div class="kolPsLine kolPsSub"><span class="kolPsMeta">${esc(m.period)}${m.source?` · ${esc(m.source)}`:''}</span></div>${m.warningShort?`<div class="kolPsLine"><span class="kolPsMeta kolPsWaiting" title="${esc(m.warning)}">${esc(m.warningShort)}</span></div>`:''}</div>`;
  }
  const modeForKey=key=>key==='__seasonImpact__'?'impact':key==='__previousSeason__'?'season':'month';
  const labelFor=key=>key==='__seasonImpact__'?T('Sezon Etkisi','Season Impact'):key==='__previousSeason__'?'Previous Season':'LFL';
  const footerKinds=new Set(['previousSeason','lfl','seasonImpact','priceReferences']);
  function footerSummaries(rows,modes){
    const active=session(),result=new Map(),groups=global.BLCollectionModelGroups;
    // Index all model parents once, including parents outside the active filter.
    const read=groups?.createValueReader?groups.createValueReader(typeof kolRows!=='undefined'?kolRows:rows):kolEffectiveValue;
    const items=(rows||[]).map(row=>{
      const projected=projectRow(row,read);let price;
      if(groups){const pricing=read(row,'pricing')||{},selected=groups.confirmedPricing(projected,pricing,groups.kolParseMoneyNum)||groups.bestPricing(pricing,groups.kolParseMoneyNum),target=groups.kolParseMoneyNum(projected.targetPrice);price=selected?.price??(Number.isFinite(target)&&target>0?target:null);}
      else price=kolSuppFob(projected)?.price;
      return {row:projected,price,quantity:projected.quantity,excluded:excludedFor(row,read)};
    });
    for(const mode of new Set(modes)){
      const observations=items.map(item=>{
        if(active.status!=='ready')return {quantity:item.quantity,reference:null,price:null};
        if(mode==='impact'){const impact=Engine.seasonImpact(active.timelines,item.row,item.price,item.excluded);return {quantity:item.quantity,reference:impact.status==='ready'?impact.before:null,price:impact.status==='ready'?impact.after:null};}
        return {quantity:item.quantity,reference:Engine.reference(active.index,item.row,mode,item.excluded)?.average,price:item.price};
      });
      result.set(mode,Engine.summarizeComparisons(observations));
    }
    return result;
  }
  function footerCells(rows,descriptors){
    const columns=(descriptors||[]).filter(d=>footerKinds.has(d.kind));if(!columns.length)return new Map();
    const keys=d=>d.kind==='priceReferences'?d.folds||[]:[d.k],summaries=footerSummaries(rows,columns.flatMap(d=>keys(d).map(modeForKey))),cells=new Map();
    const money=value=>Number.isFinite(value)?`$${esc(kolFormatMoneyDisplay(String(value)))}`:'—';
    const line=(caption,value)=>`<span class="collectionAverageLine"><span class="collectionFooterCaption">${esc(caption)}</span><strong>${value}</strong></span>`;
    const value=(s,mode,arithmetic=false)=>{const before=arithmetic?s.arithmeticBefore:s.weightedBefore,after=arithmetic?s.arithmeticAfter:s.weightedAfter;return mode==='impact'&&Number.isFinite(before)&&Number.isFinite(after)?`${money(before)} → ${money(after)}`:money(before);};
    const title=(s,mode)=>T(`Filtrelenmiş satırların model/renk adediyle ağırlıklı ortalaması. Ağırlıklı hesaba dahil: ${s.usedRows}/${s.totalRows} satır · ${s.quantity} adet. Eksik referans veya sıfır/eksik adet ağırlıklı hesaba katılmaz.`,`Quantity-weighted average of filtered model/colour rows. Included in weighted average: ${s.usedRows}/${s.totalRows} rows · ${s.quantity} units. Missing references and zero/missing quantities are excluded.`)+' '+(mode==='impact'?T('Satırların bağımsız sezon simülasyonlarının önce → sonra özeti.','Before → after summary of independent row-level season simulations.'):T(`Yüzde değişimi, fiyat ve referansı birlikte olan ${s.pairedRows} satırda ağırlıklı güncel fiyat / ağırlıklı referans − 1 ile hesaplanır.`,`Percentage change uses weighted current price / weighted reference − 1 across ${s.pairedRows} rows with both a price and a reference.`));
    for(const d of columns){
      let content='',titles=[];
      for(const key of keys(d)){
        const mode=modeForKey(key),s=summaries.get(mode);if(!s)continue;
        titles.push(`${labelFor(key)}: ${title(s,mode)}`);
        if(d.kind==='priceReferences'){content+=line(`${labelFor(key)} · ${T('Ağ.Ort.','W.Avg')}`,value(s,mode));continue;}
        content+=line(T('Ağ.Ort.','W.Avg'),value(s,mode))+line(T('Ort.','Avg'),value(s,mode,true));
        if(Number.isFinite(s.percent)){
          const rounded=Math.abs(s.percent)<0.005?0:s.percent,text=`${rounded>0?'+':''}${rounded.toLocaleString(en()?'en-GB':'tr-TR',{maximumFractionDigits:2})}%`;
          content+=line(T('Ağ.% Δ','W.% Δ'),`<span class="kolBestDelta ${rounded<=0?'isAtOrBelowTarget':'isAboveTarget'}">${esc(text)}</span>`);
        }
      }
      cells.set(d.k,`<td class="collectionWeightedAverage" data-kol-footer-key="${esc(d.k)}" title="${esc(titles.join('\n'))}">${content}</td>`);
    }
    return cells;
  }
  const combinedText=(row,keys)=>keys.map(key=>`${labelFor(key)}: ${model(row,modeForKey(key)).text||'—'}`).join(' | ');
  function cell(row,attributes,mode='month'){const m=model(row,mode);return `<td class="kolBestCell kolPriceStripTd" data-kol-drawer="${esc(row.id)}"${attributes} title="${esc(m.detail)}">${content(row,m)}</td>`;}
  function combinedCell(row,attributes,keys){
    const rows=keys.map(key=>{const m=model(row,modeForKey(key));return `<div class="kolPsLine" title="${esc(m.detail)}"><span class="kolPsMeta">${esc(labelFor(key))}</span><b class="${m.reference?'kolPsPrice':'kolPsEmpty'}">${esc(m.averageText||m.emptyText)}</b>${m.percentText?`<span class="kolBestDelta ${m.percent<=0?'isAtOrBelowTarget':'isAboveTarget'}">${esc(m.percentText)}</span>`:''}${m.compactWarning?`<span class="kolPsMeta kolPsWaiting" title="${esc(m.warning)}">${esc(m.compactWarning)}</span>`:''}</div>`;}).join('');
    return `<td class="kolBestCell kolPriceStripTd" data-kol-drawer="${esc(row.id)}"${attributes}><div class="kolPs">${rows}</div></td>`;
  }
  function detailError(code){
    const messages={
      SOURCE_FILTER_REQUIRED:T('Kaynak Veride LFL filtresini tamamlayın.','Complete the LFL filter in Source Data.'),
      LFL_REFERENCE_STALE:T('LFL kaynağı değişti. Kayıtlı referanslar korunuyor; güncel detay için Referansları yenile düğmesini kullanın.','The LFL source changed. Saved references are preserved; use Refresh references for current details.'),
      LFL_REFERENCE_NOT_FOUND:T('Bu referans için erişilebilir sipariş bulunamadı.','No accessible orders were found for this reference.'),
      FORBIDDEN:T('Sipariş detayları için Koleksiyon ve LFL erişimi gerekli.','Collection and LFL access are required for order details.'),
    };
    return Object.assign(new Error(messages[code]||T('Sipariş detayları yüklenemedi. Tekrar deneyin.','Could not load order details. Please try again.')),{code});
  }
  async function detailData(row,mode){
    if(!['season','month','impact'].includes(mode))throw detailError('INVALID_MODE');
    await ensure();
    const active=session(),m=model(row,mode),reference=m.reference;
    if(!reference)throw new Error(m.message);
    const cache=active.detailRows,key=reference.key,excluded=m.excluded||[],cacheKey=key+'|'+excluded.join(',');
    let task=cache.get(cacheKey);
    if(!task){
      task=(async()=>{
        const response=await fetch('/api/collection-lfl-detail',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,version:active.version,excludedCountries:excluded})});
        const data=await response.json();
        if(!response.ok)throw detailError(response.status===403?'FORBIDDEN':data.code);
        if(session()!==active||active.detailRows!==cache)throw detailError('LFL_DETAIL_CANCELLED');
        if(data.version!==active.version||data.reference?.key!==key||!Array.isArray(data.rows))throw detailError('LFL_REFERENCE_STALE');
        return data;
      })();
      // Details stay in memory only, bounded by the number of explicitly opened groups.
      if(cache.size>=12)cache.delete(cache.keys().next().value);
      cache.set(cacheKey,task);
      task.catch(()=>{if(cache.get(cacheKey)===task)cache.delete(cacheKey);});
    }
    try{return await task;}
    catch(error){
      throw error.code?error:detailError('LOAD_ERROR');
    }
  }
  async function detailReport(row,mode){
    const data=await detailData(row,mode),m=model(row,mode),projected=projectRow(row),reference=data.reference;
    if(m.reference?.key!==reference.key||session().version!==data.version)throw detailError('LFL_DETAIL_CANCELLED');
    const key=mode==='impact'?'__seasonImpact__':mode==='season'?'__previousSeason__':'__lfl__',label=labelFor(key);
    const fields=global.BLCanonicalFields,number=value=>Number(value).toLocaleString(en()?'en-GB':'tr-TR',{maximumFractionDigits:2});
    const field=(id,key=id)=>({key,canonicalId:id,label:fields.label(id,en()?'en':'tr'),type:fields.field(id).type,value:source=>fields.value(source,'lfl',id)});
    const columns=[field('orderCode'),field('modelName'),field('colour'),field('manufacturer'),field('season'),field('mag'),field('category','classification'),
      {key:'_referenceMonth',label:T('Model Bütçe Ayı','Model Budget Month')},
      {key:'_referenceQuantity',canonicalId:'orderQuantity',label:T('Sipariş Adedi','Order Quantity'),type:'number',format:number},
      {key:'_referenceFob',label:'FOB (USD)',type:'number',format:value=>`$${number(value)}`},
      {key:'_referenceValue',label:T('Tutar (USD)','Value (USD)'),type:'number',format:value=>`$${number(value)}`},
      {key:'_referenceWeight',label:T('Ağırlık Payı (%)','Weight Share (%)'),type:'number',format:value=>`${number(value)}%`},
      field('country'),field('buyer'),field('buyingGroup'),field('colourCode'),field('plmId'),field('inStore'),field('orderPlacementDate','opd'),field('license')];
    const title=`${label} · ${T('Sipariş detayları','Order details')}`;
    return {storageKey:'collection.price-reference.'+mode,source:'lfl',moduleId:'lfl',pageScope:'koleksiyon',title,
      subtitle:[projected.modelKod,m.period,projected.mag,projected.urunTipi,sampleWarning(reference).orderInfo,`${number(reference.quantity)} ${T('adet','units')}`,`${T('Ağ.Ort.','W.Avg')} $${number(reference.average)}`].filter(Boolean).join(' · '),
      note:m.detail+(mode==='impact'?' '+T('Tablo yerleşmiş ASAS siparişlerini gösterir; model yalnız simülasyondur, sipariş satırlarına eklenmez.','The table shows placed ASAS orders; the model is a simulation and is not added to the order rows.') :''),
      rows:data.rows,columns,defaultVisible:columns.slice(0,12).map(col=>col.key),exactDefaultVisible:true,viewPresets:{extended:columns.map(col=>col.key)},images:true,fileName:'Collection_'+label+'_Orders'};
  }
  let ruleScope='buyer';
  function countryRuleHtml(row){
    const buyer=rowBuyer(row),scope=buyer&&ruleScope==='buyer'?'buyer':'*',target=scope==='buyer'?buyer:'*';
    const own=countryRules().find(rule=>ruleId(rule.buyer)===ruleId(target)),selected=new Set(own?own.countries:[]);
    const active=session(),codes=[...new Set([...(active.countries||[]),...selected])].sort((a,b)=>countryName(a).localeCompare(countryName(b),en()?'en':'tr'));
    const applied=excludedFor(row),fallback=scope==='buyer'&&!own&&applied.length;
    const options=`<option value="buyer"${scope==='buyer'?' selected':''}${buyer?'':' disabled'}>${esc(buyer?T(`Bu buyer: ${buyer}`,`This buyer: ${buyer}`):T('Satırda buyer yok','No buyer on this row'))}</option><option value="*"${scope==='*'?' selected':''}>${esc(T('Tüm buyerlar (varsayılan)','All buyers (default)'))}</option>`;
    const boxes=codes.length?codes.map(code=>`<label class="cpdCountry"><input type="checkbox" data-cpd-lfl-country="${esc(code)}"${selected.has(code)?' checked':''}> ${esc(countryName(code))}</label>`).join(''):`<p class="cpdEmpty">${esc(active.status==='ready'?T('Referanslarda üretim ülkesi bulunamadı.','No production countries were found in the references.'):T('Ülkeler referanslar yüklenince listelenir.','Countries are listed once references load.'))}</p>`;
    const legacy=active.status==='ready'&&!active.countryAware;
    const status=legacy?T('Kayıtlı referanslar ülke kırılımı içermiyor; filtrenin uygulanması için Referansları yenile düğmesini kullanın.','Saved references have no country breakdown; use Refresh references to apply the filter.'):applied.length?exclusionText(applied)+(fallback?' · '+T('Tüm buyerlar kuralından','From the all-buyers rule'):''):T('Tüm ülkeler hesaba katılıyor.','All countries are included.');
    return `<div class="cpdSection cpdCountryRule"><header><h4>${esc(T('Ülke filtresi','Country filter'))}</h4><span>${esc(T('Previous Season · LFL · Sezon Etkisi','Previous Season · LFL · Season Impact'))}</span></header>
      <label class="cpdInput"><span>${esc(T('Kural kapsamı','Rule scope'))}</span><select data-cpd-lfl-country-scope>${options}</select></label>
      <fieldset class="cpdCountryList"><legend>${esc(T('Hesaba katılmayacak üretim ülkeleri','Production countries to exclude'))}</legend>${boxes}</fieldset>
      <p class="cpdNote" role="status">${esc(status)}</p>
      <p class="cpdNote">${esc(T('Seçim bu buyer\'ın tüm satırlarına anında uygulanır ve hesabınızla saklanır. Buyer kuralı yoksa “Tüm buyerlar” kuralı kullanılır. Türkiye siparişleri TRY olduğu için bu USD hesaplarına zaten girmez.','The choice applies immediately to all rows of this buyer and is saved with your account. Without a buyer rule, the “All buyers” rule is used. Türkiye orders are in TRY and are never part of these USD calculations.'))}</p></div>`;
  }
  function onDrawerChange(target,row){
    const scope=target.closest('[data-cpd-lfl-country-scope]');
    if(scope){ruleScope=scope.value==='*'?'*':'buyer';return true;}
    const box=target.closest('[data-cpd-lfl-country]');if(!box)return false;
    const panel=box.closest('.cpdCountryRule'),buyer=rowBuyer(row),scopeValue=panel?.querySelector('[data-cpd-lfl-country-scope]')?.value;
    const name=scopeValue==='buyer'&&buyer?buyer:'*';
    const codes=[...(panel?panel.querySelectorAll('[data-cpd-lfl-country]:checked'):[])].map(input=>input.dataset.cpdLflCountry);
    if(!setCountryRule(name,codes))global.showToast?.(T('Ülke filtresi kaydedilemedi.','Could not save the country filter.'));
    return true;
  }
  function drawer(row){
    void ensure();
    const sections=['__previousSeason__','__lfl__','__seasonImpact__'].map(key=>{const mode=modeForKey(key),m=model(row,mode),action=T('Sipariş detaylarını aç','Open order details');return `<div class="cpdSection"><header><h4><button type="button" class="tbtn" data-cpd-lfl-details="${mode}" title="${esc(action)}" aria-label="${esc(labelFor(key)+': '+action)}"${m.reference?'':' disabled'}>${esc(labelFor(key))} ↗</button></h4><span>${esc(key==='__seasonImpact__'?T('Tek model simülasyonu','Single-model simulation'):key==='__previousSeason__'?T('Sezon geneli','Full season'):T('Aynı MB ayı','Same MB month'))}</span></header>${content(row,m)}<p class="cpdNote">${esc(m.reference?m.detail:m.message)}</p></div>`;}).join('');
    const active=session(),note=active.refreshError
      ?(active.refreshError==='LFL_REFERENCE_INCOMPLETE'
        ?T('Kaynak boş veya eksik olduğu için yenilenemedi. Kayıtlı referanslar korundu; LFL kaynak kapsamını kontrol edin.','Refresh could not complete because the source is empty or incomplete. Saved references were preserved; check the LFL source scope.')
        :T('Referanslar yenilenemedi. Kayıtlı değerler korundu; tekrar deneyebilirsiniz.','Could not refresh references. Saved values were preserved; you can retry.'))
      :T('Referanslar kalıcı saklanır. Güncellemek için Referansları yenile düğmesini kullanın.','References are saved permanently. Use Refresh references to update them.');
    return sections+countryRuleHtml(row)+`<p class="cpdNote" role="status">${esc(note)}</p><div class="cpdActions"><button type="button" class="tbtn" data-cpd-lfl-refresh${active.pending||active.status==='loading'?' disabled':''}>${esc(T('Referansları yenile','Refresh references'))}</button></div>`;
  }
  global.BLCollectionLfl={ensure,invalidate,model,cell,combinedCell,combinedText,modeForKey,drawer,onDrawerChange,countryRules,setCountryRule,detailReport,footerSummaries,footerCells,text:(row,mode='month')=>model(row,mode).text};
})(window);
