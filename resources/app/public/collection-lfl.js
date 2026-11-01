(function(global){
  'use strict';
  const Engine=global.BLCollectionLflEngine;
  let current=null;
  const en=()=>typeof appLang!=='undefined'&&appLang==='en';
  const T=(tr,english)=>en()?english:tr;
  const esc=value=>escapeHtml(String(value??''));
  const identity=()=>{const user=typeof state!=='undefined'?state.currentUser:global.BL_USER_CONTEXT;return JSON.stringify([user?.id,user?.iamRevision,user?.dataScope,user?.scopes]);};
  function session(){const id=identity();if(current?.id!==id)current={id,status:'idle',index:new Map(),pending:null};return current;}
  function repaint(){
    if(document.body.dataset.activeTab==='koleksiyon'&&typeof renderKol==='function')renderKol();
    global.BLCollectionPriceDrawer?.refresh?.();
  }
  function ensure({rebuild=false}={}){
    const active=session();
    if(active.pending)return active.pending;
    if(!rebuild&&active.status!=='idle')return Promise.resolve();
    active.status='loading';
    active.pending=(async()=>{
      try{
        const response=await fetch('/api/collection-lfl-reference'+(rebuild?'?rebuild=1':''),{cache:'no-store'});
        const data=await response.json();
        if(!response.ok){active.status=response.status===403?'forbidden':data.code==='SOURCE_FILTER_REQUIRED'?'filter':'error';return;}
        active.index=new Map((data.references||[]).map(item=>[item.key,item]));active.timelines=Engine.createSeasonTimelines(data.references);active.calculatedAt=data.calculatedAt;active.status='ready';
      }catch(_){active.status='error';}
      finally{active.pending=null;if(current===active)repaint();}
    })();
    return active.pending;
  }
  function invalidate(){current=null;if(document.body.dataset.activeTab==='koleksiyon')void ensure();}
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
    const active=session(),projected={...row};
    for(const key of ['season','mag','urunTipi','inStoreMonth','quantity','targetPrice','confirmedManufacturer'])projected[key]=kolEffectiveValue(row,key);
    const price=kolSuppFob(projected),result=active.status==='ready'?Engine.seasonImpact(active.timelines,projected,price?.price):{status:active.status};
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
    const detail=reference?[period,`${projected.mag} · ${projected.urunTipi}`,scope,addition,`${averageText} · ${percentText}`,quality.orderInfo,quality.warning,undated,formula].filter(Boolean).join('\n'):message;
    return {reference,season,month,period,percent:result.percent,percentText,averageText,source,message,detail,noData,emptyText,...quality,text:reference?[period,averageText,percentText,addition,quality.warning,undated].filter(Boolean).join(' · '):message,impact:result};
  }
  function model(row,mode='month'){
    if(mode==='impact')return impactModel(row);
    const active=session(),projected={...row};
    for(const key of ['season','mag','urunTipi','inStoreMonth','targetPrice','confirmedManufacturer'])projected[key]=kolEffectiveValue(row,key);
    const season=Engine.previousSeason(projected.season),valid=Boolean(season&&String(projected.mag||'').trim()&&String(projected.urunTipi||'').trim());
    const month=mode==='month'?Engine.previousMonth(Engine.budgetMonth(projected,'collection')):'',period=[season,month].filter(Boolean).join(' · ');
    const reference=valid&&active.status==='ready'?Engine.reference(active.index,projected,mode):null;
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
    const detail=reference?[`${period} · ${projected.mag} · ${projected.urunTipi}`,`${orderInfo?orderInfo+' · ':''}${reference.count} ${T('kayıt','records')} · ${reference.quantity.toLocaleString(en()?'en-GB':'tr-TR')} ${T('adet','units')}`,source+(price?`: $${kolFormatMoneyDisplay(String(price.price))}`:''),warning,explanation].filter(Boolean).join('\n'):message;
    const text=reference?[period,averageText,percentText,source,orderInfo,warning].filter(Boolean).join(' · '):noData?`${period} · ${emptyText}`:'';
    return {reference,season,month,period,percent,percentText,averageText,source,message,detail,text,noData,emptyText,lowSample,warning,warningShort,compactWarning};
  }
  function content(row,m=model(row)){
    if(!m.reference)return `<span class="kolPsEmpty" title="${esc(m.message)}">${esc(m.emptyText)}</span>`;
    const delta=m.percent==null?'':`<span class="kolBestDelta ${m.percent<=0?'isAtOrBelowTarget':'isAboveTarget'}">${esc(m.percentText)}</span>`;
    return `<div class="kolPs"><div class="kolPsLine"><b class="kolPsPrice">${esc(m.averageText)}</b>${delta}</div><div class="kolPsLine kolPsSub"><span class="kolPsMeta">${esc(m.period)}${m.source?` · ${esc(m.source)}`:''}</span></div>${m.warningShort?`<div class="kolPsLine"><span class="kolPsMeta kolPsWaiting" title="${esc(m.warning)}">${esc(m.warningShort)}</span></div>`:''}</div>`;
  }
  const modeForKey=key=>key==='__seasonImpact__'?'impact':key==='__previousSeason__'?'season':'month';
  const labelFor=key=>key==='__seasonImpact__'?T('Sezon Etkisi','Season Impact'):key==='__previousSeason__'?'Previous Season':'LFL';
  const combinedText=(row,keys)=>keys.map(key=>`${labelFor(key)}: ${model(row,modeForKey(key)).text||'—'}`).join(' | ');
  function cell(row,attributes,mode='month'){const m=model(row,mode);return `<td class="kolBestCell kolPriceStripTd" data-kol-drawer="${esc(row.id)}"${attributes} title="${esc(m.detail)}">${content(row,m)}</td>`;}
  function combinedCell(row,attributes,keys){
    const rows=keys.map(key=>{const m=model(row,modeForKey(key));return `<div class="kolPsLine" title="${esc(m.detail)}"><span class="kolPsMeta">${esc(labelFor(key))}</span><b class="${m.reference?'kolPsPrice':'kolPsEmpty'}">${esc(m.averageText||m.emptyText)}</b>${m.percentText?`<span class="kolBestDelta ${m.percent<=0?'isAtOrBelowTarget':'isAboveTarget'}">${esc(m.percentText)}</span>`:''}${m.compactWarning?`<span class="kolPsMeta kolPsWaiting" title="${esc(m.warning)}">${esc(m.compactWarning)}</span>`:''}</div>`;}).join('');
    return `<td class="kolBestCell kolPriceStripTd" data-kol-drawer="${esc(row.id)}"${attributes}><div class="kolPs">${rows}</div></td>`;
  }
  function drawer(row){
    void ensure();
    const sections=['__previousSeason__','__lfl__','__seasonImpact__'].map(key=>{const m=model(row,modeForKey(key));return `<div class="cpdSection"><header><h4>${esc(labelFor(key))}</h4><span>${esc(key==='__seasonImpact__'?T('Tek model simülasyonu','Single-model simulation'):key==='__previousSeason__'?T('Sezon geneli','Full season'):T('Aynı MB ayı','Same MB month'))}</span></header>${content(row,m)}<p class="cpdNote">${esc(m.reference?m.detail:m.message)}</p></div>`;}).join('');
    return sections+`<div class="cpdActions"><button type="button" class="tbtn" data-cpd-lfl-refresh${session().status==='loading'?' disabled':''}>${esc(T('Referansları yenile','Refresh references'))}</button></div>`;
  }
  global.BLCollectionLfl={ensure,invalidate,model,cell,combinedCell,combinedText,modeForKey,drawer,text:(row,mode='month')=>model(row,mode).text};
})(window);
