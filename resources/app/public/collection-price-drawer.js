/* FİYAT ÇEKMECESİ (v2026-10-22) — Koleksiyon'da tek modelin bütün fiyat
   resmi: görsel, teklifler (onay), hedef, pazarlık turları, maliyet şelalesi
   (Supp. FOB → Royalty/Hologram → Overseas Landed; TR fiyatı → kur → TR
   Landed) ve Endeksmatik.

   Çekmece kendi hesabını YAPMAZ: değerler Koleksiyon'un kanonik
   yardımcılarından (kolLandedCalc, kolBestPricing, kolConfirmedPricing,
   kolPriceTargetDelta) okunur; yazımlar tablo hücreleriyle aynı yoldan
   (kolApplyCollectionCellChange, kolToggleConfirmedManufacturer,
   openKolManualPriceModal) geçer. Böylece geri al, model/renk bağı, senkron
   ve Fiyat Defteri davranışı tabloyla birebir aynıdır.

   Açma: Teklif & Onay / Landed Özeti hücresinde çift tık veya ⤢ düğmesi. */
(function(global){
  'use strict';
  let state=null; // {rowId, overlay, panel}

  const en=()=>global.appLang==='en'||(typeof appLang!=='undefined'&&appLang==='en');
  const T=(tr,enText)=>en()?enText:tr;
  const esc=value=>typeof escapeHtml==='function'?escapeHtml(value):String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const num=value=>value==null||value===''?NaN:Number(value);
  const money=value=>Number.isFinite(num(value))?`$${kolFormatMoneyDisplay(String(value))}`:'—';
  const money2=value=>Number.isFinite(num(value))?`$${kolMoney2(num(value))}`:'—';
  const pct=value=>Number(value).toLocaleString(en()?'en-GB':'tr-TR',{maximumFractionDigits:2});
  const canEdit=()=>state?.module==='collection'&&typeof kolWorkspaceCanEdit!=='undefined'&&Boolean(kolWorkspaceCanEdit)&&Boolean(findRow(state.rowId));
  const findRow=id=>state&&global.BLPriceLineageBridge?.resolve(state.binding)||null;

  function imageSrc(row){
    try{const src=global.BL_QUOTATIONS?.desk?.imageSrc?.(row);if(src)return src;}catch(_){}
    const img=document.querySelector(`#kolTable img.kolThumb[data-id="${CSS.escape(String(row.id))}"]`);
    return img&&img.dataset.hasImage==='1'?(img.dataset.src||img.src):'';
  }

  /* Bu modelin quotation satırları (Fiyat Defteri). Satır eşlemesi
     quotations.js'in sahip-duyarlı findRow'undan gelir; başka bir buyer'ın
     aynı numaralı satırı ASLA karışmaz. */
  function ledgerLines(row){
    const desk=global.BL_QUOTATIONS?.desk,engine=global.BLPricingDeskEngine;
    if(!desk?.requests||!desk?.findRow)return [];
    const out=[];
    (desk.requests()||[]).forEach(req=>{
      if(req.source!=='collection')return;
      (req.items||[]).forEach(line=>{
        if(line.dropped)return;
        let match=null;try{match=desk.findRow(line);}catch(_){}
        if(match!==row||!desk.identityMatchesRow?.(line,row))return;
        const summary=engine?.negotiation?engine.negotiation(line,req):null;
        out.push({req,line,summary,valid:desk.validPrice?desk.validPrice(line.price):Number.isFinite(kolParseMoneyNum(line.price))});
      });
    });
    return out;
  }

  function offersHtml(row){
    const pricing=kolEffectivePricing(row)||{},confirmed=kolConfirmedPricing(row),best=kolBestPricing(row);
    const offers=Object.entries(pricing).map(([name,value])=>({name,price:kolParseMoneyNum(value)})).filter(o=>Number.isFinite(o.price)&&o.price>0).sort((a,b)=>a.price-b.price);
    const ledger=ledgerLines(row),byName=new Map(ledger.map(item=>[norm(item.line.manufacturer),item]));
    const waiting=ledger.filter(item=>!item.valid).map(item=>item.line.manufacturer);
    const editable=canEdit();
    const rows=offers.map(o=>{
      const delta=kolPriceTargetDelta(row,o.price),isConfirmed=Boolean(confirmed&&norm(confirmed.name)===norm(o.name)),isBest=Boolean(best&&norm(best.name)===norm(o.name));
      const neg=byName.get(norm(o.name))?.summary;
      const trail=neg&&neg.rounds>1&&Number.isFinite(neg.first)&&neg.first!==neg.last?`<s>${esc(money(neg.first))}</s> → `:'';
      const roundText=neg&&neg.rounds>1?`<span class="cpdRound">${esc(T(`${neg.rounds}. tur`,`Round ${neg.rounds}`))}</span>`:'';
      return `<li class="cpdOffer${isConfirmed?' isConfirmed':''}${isBest?' isBest':''}">
        <button type="button" class="cpdApprove" data-cpd-approve="${esc(o.name)}" aria-pressed="${isConfirmed?'true':'false'}" title="${esc(isConfirmed?T('Üretici onayını kaldır','Remove manufacturer approval'):T('Bu üreticiyi ve fiyatı onayla','Approve this manufacturer and price'))}"${editable?'':' disabled'}>✓</button>
        <span class="cpdOfferName">${esc(o.name)}${isBest?`<em class="cpdBadge">${esc(T('En iyi','Best'))}</em>`:''}</span>
        <span class="cpdOfferTrail">${trail}<b>${esc(money(o.price))}</b>${roundText}</span>
        ${delta?`<span class="kolBestDelta ${delta.meetsTarget?'isAtOrBelowTarget':'isAboveTarget'}">${esc(delta.text)}</span>`:'<span></span>'}
      </li>`;
    }).join('');
    const waitingHtml=waiting.length?`<p class="cpdNote">${esc(T(`Cevap bekleyen: ${waiting.join(', ')}`,`Awaiting a reply: ${waiting.join(', ')}`))}</p>`:'';
    const empty=offers.length?'':`<p class="cpdEmpty">${esc(T('Bu model için henüz geçerli teklif yok.','No valid quotation for this model yet.'))}</p>`;
    return `<div class="cpdSection"><header><h4>${esc(T('Teklifler','Quotations'))}</h4><span>${esc(confirmed?T('Onaylı','Approved'):(offers.length?T('Onay bekliyor','Awaiting approval'):''))}</span></header>${empty}${rows?`<ul class="cpdOffers">${rows}</ul>`:''}${waitingHtml}
      <div class="cpdActions">
        <button type="button" class="tbtn" data-cpd-manual${editable?'':' disabled'}>✎ ${esc(T('Elle fiyat gir','Enter price manually'))}</button>
        <button type="button" class="tbtn" data-cpd-desk>${esc(T("Fiyat Masası'nda aç","Open in Pricing Desk"))}</button>
        <button type="button" class="tbtn" data-cpd-history>${esc(T('Fiyat Geçmişi','Pricing History'))}</button>
      </div></div>`;
  }

  function inputHtml(row,key,placeholder,label){
    const value=String(kolEffectiveValue(row,key)??'');
    return `<label class="cpdInput"><span>${esc(label)}</span><input type="text" inputmode="decimal" data-cpd-field="${esc(key)}" value="${esc(value)}" placeholder="${esc(placeholder)}"${canEdit()?'':' disabled'}></label>`;
  }

  function waterfallHtml(row){
    const k=kolLandedCalc(kolGroupSummaryEffectiveLandedRow(row));
    const sourceLabel=k.supp?({confirmed:T('Onaylı','Confirmed'),best:'Best Price',target:'Target Price'}[k.supp.source]||''):'';
    const step=(label,value,cls='')=>`<li class="cpdStep${cls?' '+cls:''}"><span>${label}</span><b>${esc(value)}</b></li>`;
    const yd=[];
    if(k.ruleMissing||k.ruleInvalid)yd.push(`<li class="cpdStep isWarn" role="status"><span>⚠ ${esc(k.ruleInvalid?kolPricingRuleInvalidText():kolLicenseRuleMissingText(row))}</span></li>`);
    else{
      yd.push(step(`${esc('Supp. FOB')}${sourceLabel?` <em class="cpdBadge">${esc(sourceLabel)}${k.supp?.name?` · ${esc(k.supp.name)}`:''}</em>`:''}`,money2(k.ydBaseFob)));
      if(k.nonDtr){
        yd.push(step(esc(`÷ (1 − ${T('Royalty','Royalty')} %${pct(k.royaltyPct)})`),k.ydBaseFob!=null&&k.royaltyPct<100?money2(k.ydBaseFob/(1-k.royaltyPct/100)):'—'));
        yd.push(step(esc(`+ Hologram`),money2(k.hologramCost)));
      }
      yd.push(step(esc(`× ${T('YD çarpanı','Overseas multiplier')} ${pct(k.ydMult)}`),money2(k.ydLanded),'isTotal'));
    }
    const tr=[];
    if(k.trRuleMissing||k.trRuleInvalid)tr.push(`<li class="cpdStep isWarn" role="status"><span>⚠ ${esc(k.trRuleInvalid?kolPricingRuleInvalidText(true):kolTrLicenseRuleMissingText(row))}</span></li>`);
    else{
      tr.push(step(esc(T('TR fiyatı (TL)','TR price (TRY)')),Number.isFinite(k.trPrice)&&k.trPrice>0?`₺${kolMoney2(k.trPrice)}`:'—'));
      tr.push(step(esc(`÷ ${T('Kur','FX')} ${k.fx==null?'—':kolMoney2(k.fx)}${k.fx!=null&&!k.fxIsManual?` (${T('Ex-Factory ayı','Ex-Factory month')})`:''}`),money2(k.trBaseUsd)));
      if(k.nonDtr)tr.push(step(esc(`TR Royalty %${pct(k.trRoyaltyPct)} + Hologram ${money2(k.trHologramCost)}`),money2(k.trCostedUsd)));
      tr.push(step(esc(`× ${T('TR çarpanı','TR multiplier')} ${pct(k.trMult)}`),money2(k.trLanded),'isTotal'));
    }
    const profit=k.profitPct==null?null:Math.round(k.profitPct*10)/10;
    const profitHtml=profit==null?'':`<p class="cpdProfit ${profit>0?'isGood':(profit<0?'isBad':'')}">${esc(T('Overseas avantajı','Overseas advantage'))}: <b>${profit>0?'+':''}${esc(pct(profit))}%</b></p>`;
    return `<div class="cpdSection"><header><h4>${esc(T('Maliyet şelalesi','Cost waterfall'))}</h4><span>${esc(k.nonDtr?'Non-DTR':'DTR')}</span></header>
      <div class="cpdWaterfall"><div><h5>Overseas Landed</h5><ol>${yd.join('')}</ol></div><div><h5>TR Landed</h5><ol>${tr.join('')}</ol></div></div>${profitHtml}
      <div class="cpdInputs">
        ${inputHtml(row,'trPrice','0,00',T('TR fiyatı (TL)','TR price (TRY)'))}
        ${inputHtml(row,'trFx',k.fxAuto==null?'—':kolMoney2(k.fxAuto),T('Kur (boş = otomatik)','FX (empty = automatic)'))}
        ${inputHtml(row,'trLandedMult',String(k.defaultTrMult).replace('.',en()?'.':','),T('TR çarpanı','TR multiplier'))}
        ${inputHtml(row,'ydLandedMult',String(k.defaultYdMult).replace('.',en()?'.':','),T('YD çarpanı','Overseas multiplier'))}
      </div></div>`;
  }

  function endeksmatikHtml(row){
    let text='';
    try{text=endeksmatikExcelText(kolEffectiveEndeksmatikRow(row))||'';}catch(_){}
    if(!text)return '';
    return `<div class="cpdSection"><header><h4>Endeksmatik</h4></header><p class="cpdNote cpdPre">${esc(text)}</p></div>`;
  }
  function lineageSnapshot(row){
    let provenance={};
    if(state.module==='collection'){
      const selected=kolSuppFob(kolGroupSummaryEffectiveLandedRow(row));
      provenance=global.BLPriceLineage.offerProvenance(ledgerLines(row),{engine:global.BLPricingDeskEngine,amount:selected?.price,manufacturer:selected?.name});
    }
    return global.BLPriceLineageBridge.snapshot(row,state.module,provenance);
  }
  function lineageRows(snapshot){
    const sourceLabels={confirmed:T('Onaylı teklif','Confirmed offer'),best:T('En iyi teklif','Best offer'),target:T('Hedef fiyat','Target price'),manual:T('Elle girilen','Manual'),rule:T('Fiyat kuralı','Pricing rule'),'cp-update':T('CP güncellemesi','CP update'),dtr:T('DTR kaynak fiyatı','DTR source price'),missing:T('Geçerli fiyat yok','No valid price')};
    const unknown=T('Bildirilmemiş','Not reported'),date=value=>Number.isFinite(Date.parse(value||''))?new Date(value).toLocaleString(en()?'en-GB':'tr-TR'):unknown;
    const facts=[{field:T('Kayıt','Record'),value:snapshot.record},{field:T('Fiyat kaynağı','Price source'),value:sourceLabels[snapshot.source.kind]||snapshot.source.kind},{field:T('Üretici','Manufacturer'),value:snapshot.source.name||'—'},{field:'Supp. FOB',value:snapshot.values.suppFob??'—'}];
    if(snapshot.precedence)facts.push({field:T('Kaynak önceliği','Source precedence'),value:T('Onaylı → En iyi → Hedef','Confirmed → Best → Target')});
    if(snapshot.source.origin)facts.push({field:T('Giriş yolu','Entry source'),value:({cpupdate:T('CP güncellemesi','CP update'),import:T('Üretici Excel’i','Supplier Excel'),manual:T('Elle giriş','Manual entry'),matrix:T('Fiyat matrisi','Pricing matrix'),paste:T('Yapıştırma','Paste'),undo:T('Geri alma','Undo'),legacy:T('Eski kayıt','Legacy record'),unconfirmed:T('Kaynağı doğrulanmamış','Source unconfirmed')})[snapshot.source.origin]||snapshot.source.origin});
    if(snapshot.source.requestId)facts.push({field:T('Teklif kayıt kimliği','Quotation record ID'),value:snapshot.source.requestId},{field:T('Teklif satırı kimliği','Quotation line ID'),value:snapshot.source.lineId});
    facts.push({field:T('Fiyat kaynağı tarihi','Price source date'),value:date(snapshot.source.at)},{field:T('Fiyat kaynağı yaşı (gün)','Price source age (days)'),value:snapshot.source.ageDays??unknown});
    facts.push({field:T('Kural kimliği','Rule ID'),value:snapshot.rule?.id||'—'},{field:T('TR kural kimliği','TR rule ID'),value:snapshot.trRule?.id||'—'});
    if(snapshot.module==='collection'){
      facts.push({field:T('Kur türü','FX mode'),value:snapshot.fx.manual?T('Elle girilen','Manual'):T('Otomatik','Automatic')},{field:'USD → TRY',value:snapshot.fx.rate??'—'},{field:T('İstenen kur ayı','Requested FX month'),value:snapshot.fx.requestedMonth||'—'},{field:T('Uygulanan kur ayı','Applied FX month'),value:snapshot.fx.resolvedMonth||'—'},{field:T('Önceki/ilk mevcut aya dönüş','Earlier/first available month fallback'),value:snapshot.fx.fallback?T('Evet','Yes'):T('Hayır','No')},{field:T('Kur kaynak dosyası','FX source file'),value:snapshot.fx.manual?'—':String(snapshot.fx.sourceFile||unknown).split(/[\\/]/).at(-1)},{field:T('Kur kaynağı tarihi','FX source date'),value:snapshot.fx.manual?'—':date(snapshot.fx.sourceModifiedAt||snapshot.fx.updatedAt)},{field:T('Kur kaynağı yaşı (gün)','FX source age (days)'),value:snapshot.fx.ageDays??unknown},{field:T('Kur kaynak sürümü','FX source revision'),value:snapshot.fx.revision??'—'},{field:'Overseas Landed',value:snapshot.values.overseasLanded??'—'},{field:'TR Landed',value:snapshot.values.trLanded??'—'});
    }
    Object.entries(snapshot.revisions).forEach(([key,value])=>facts.push({field:({collection:T('Koleksiyon sürümü','Collection revision'),row:T('Satır sürümü','Row revision'),pricingRules:T('Fiyat kuralı sürümü','Pricing rules revision'),orders:T('Sipariş sürümü','Orders revision'),suppFob:T('Supp. FOB sürümü','Supp. FOB revision')})[key]||key,value}));
    snapshot.blockers.forEach(value=>facts.push({field:T('Hesaplama engeli','Calculation blocker'),value}));
    facts.push({field:T('Açıklamanın alındığı an','Explanation captured at'),value:snapshot.capturedAt});
    return facts;
  }
  function lineageHtml(row){
    const snapshot=lineageSnapshot(row),facts=lineageRows(snapshot),rule=snapshot.rule||snapshot.trRule,manage=global.BLPriceLineageBridge.canManageRules(),needsRule=snapshot.blockers.length>0;
    const primary=new Set([T('Fiyat kaynağı','Price source'),'Supp. FOB',T('Kural kimliği','Rule ID'),T('Kur türü','FX mode'),T('İstenen kur ayı','Requested FX month'),T('Uygulanan kur ayı','Applied FX month'),T('Hesaplama engeli','Calculation blocker')]);
    const table=rows=>`<dl>${rows.map(fact=>`<div><dt>${esc(fact.field)}</dt><dd>${esc(['Overseas Landed','TR Landed'].includes(fact.field)&&Number.isFinite(fact.value)?kolMoney2(fact.value):fact.value)}</dd></div>`).join('')}</dl>`;
    return `<div class="cpdSection cpdLineage"><header><h4>${esc(T('Bu fiyat nereden geliyor?','Why this value?'))}</h4></header>${table(facts.filter(fact=>primary.has(fact.field)))}<details><summary>${esc(T('Tüm kaynaklar ve varsayımlar','All sources and assumptions'))}</summary>${table(facts.filter(fact=>!primary.has(fact.field)))}</details>${snapshot.blockers.length?`<p class="cpdNote" role="status">${esc(T('Kural düzeltilmeden ilgili hesap üretilmez.','The relevant calculation stays unavailable until the rule is corrected.'))}</p>`:''}<div class="cpdActions"><button class="tbtn" type="button" data-cpd-source-report>${esc(T('Kaynak raporu · Excel','Source report · Excel'))}</button><button class="tbtn" type="button" data-cpd-rule="${esc(rule?.id||'')}"${manage&&(rule?.id||needsRule)?'':' disabled'} title="${esc(!manage?T('İş kuralı yönetim yetkisi gerekli','Business-rule management permission required'):rule?.id||needsRule?T('Mevcut kural ekranını aç','Open the existing rule screen'):T('Eşleşen kural yok','No matching rule'))}">${esc(rule?.id?T('İlgili kuralı aç','Open matching rule'):needsRule?T('Kuralı tanımla','Define rule'):T('Eşleşen kural yok','No matching rule'))}</button></div></div>`;
  }

  function headHtml(row){
    if(state.module!=='collection')return `<div class="cpdHead"><div class="cpdImage">Supp. FOB</div><div class="cpdTitle"><small>${esc(T('FİYAT KAYNAĞI','PRICE SOURCE'))}</small><h3>${esc(lineageSnapshot(row).record)}</h3><p>${esc(money(row['Supp. FOB']))}</p></div><button type="button" class="kolPeriodDrawerClose" data-cpd-close aria-label="${esc(T('Kapat','Close'))}">×</button></div>`;
    const src=imageSrc(row);
    const title=[row.modelKod,row.productMainDefinition].map(value=>String(value||'').trim()).filter(Boolean).join(' · ')||String(row.plmId||row.id);
    const meta=[row.plmId,row.colour,row.lisans,row.urunTipi,row.season].map(value=>String(value||'').trim()).filter(Boolean).join(' · ');
    const target=kolParseMoneyNum(kolEffectiveValue(row,'targetPrice'));
    return `<div class="cpdHead">
      <div class="cpdImage">${src?`<img src="${esc(src)}" alt="" loading="eager" decoding="async">`:`<span aria-hidden="true">${esc(T('Görsel yok','No image'))}</span>`}</div>
      <div class="cpdTitle"><small>${esc(T('FİYAT ÇEKMECESİ','PRICE DRAWER'))}</small><h3>${esc(title)}</h3><p>${esc(meta)}</p>
        <label class="cpdInput cpdTarget"><span>Target Price</span><input type="text" inputmode="decimal" data-cpd-field="targetPrice" value="${esc(Number.isFinite(target)?kolFormatMoneyDisplay(String(target)):'')}" placeholder="0,00"${canEdit()?'':' disabled'}></label>
      </div>
      <button type="button" class="kolPeriodDrawerClose" data-cpd-close aria-label="${esc(T('Kapat','Close'))}">×</button>
    </div>`;
  }

  function render(){
    if(!state)return;
    const row=findRow(state.rowId);
    if(!row){close();return;}
    const scroll=state.body?.scrollTop||0;
    const session=state;session.rendering=true;
    try{session.panel.innerHTML=`${headHtml(row)}<div class="cpdBody">${lineageHtml(row)}${state.module==='collection'?offersHtml(row)+waterfallHtml(row)+endeksmatikHtml(row):''}${canEdit()?'':`<p class="cpdNote">${esc(T('Bu sayfa salt okunur; değerler yalnız görüntülenir.','This page is read-only; values are view-only.'))}</p>`}</div>`;}finally{session.rendering=false;}
    state.body=state.panel.querySelector('.cpdBody');
    if(state.body)state.body.scrollTop=scroll;
  }

  function commitField(input){
    if(!input.isConnected||state?.rendering||!state?.panel.contains(input))return;
    const row=findRow(state?.rowId);if(!row||!canEdit())return;
    const key=input.dataset.cpdField,value=input.value;
    if(String(kolEffectiveValue(row,key)??'')===value)return;
    kolApplyCollectionCellChange({rowId:row.id,key,value,source:'drawer'},{rerender:true});
    render();
  }

  // A release outside the drawer can produce a synthesized click on the backdrop
  // even when the press began INSIDE the drawer. Only a genuine backdrop tap closes it.
  function isBackdropTap(start,end,backdrop){
    return Boolean(start&&end
      &&start.target===backdrop&&end.target===backdrop
      &&start.pointerId===end.pointerId
      &&start.button===0&&start.isPrimary!==false
      &&Math.abs(start.clientX-end.clientX)<=6
      &&Math.abs(start.clientY-end.clientY)<=6);
  }

  function onClick(event){
    if(!state||!state.overlay.contains(event.target))return;
    const backdropTap=state.backdropTap;
    state.backdropTap=false;
    if(event.target===state.overlay){if(backdropTap)close();return;}
    if(event.target.closest('[data-cpd-close]')){close();return;}
    const row=findRow(state.rowId);if(!row)return;
    if(event.target.closest('[data-cpd-source-report]')){const snapshot=lineageSnapshot(row),rows=lineageRows(snapshot);close();global.BLDetailDrawer?.open({storageKey:'pricing.source-explanation',title:T('Fiyat kaynak açıklaması','Price source explanation'),rows,images:false,columns:[{key:'field',label:T('Alan / varsayım','Field / assumption')},{key:'value',label:T('Değer','Value')}]});return;}
    const rule=event.target.closest('[data-cpd-rule]');if(rule){const binding=state.binding,id=rule.dataset.cpdRule;if(!global.BLPriceLineageBridge.canManageRules())return;close();global.BLPriceLineageBridge.openRule(binding,id);return;}
    const approve=event.target.closest('[data-cpd-approve]');
    if(approve){if(!canEdit())return;kolToggleConfirmedManufacturer(row,approve.dataset.cpdApprove);render();return;}
    if(event.target.closest('[data-cpd-manual]')){if(!canEdit())return;openKolManualPriceModal(row);return;}
    if(event.target.closest('[data-cpd-desk]')){close();void global.BL_QUOTATIONS?.openWorkspaceFromCollection?.([row]);return;}
    if(event.target.closest('[data-cpd-history]')){close();void global.BL_QUOTATIONS?.openPriceHistory?.([row]);}
  }

  function open(row,module='collection'){
    if(!row)return false;
    const binding=global.BLPriceLineageBridge.binding(row,module);
    if(state){state.rowId=row.id??row._id;state.module=module;state.binding=binding;render();return true;}
    const overlay=document.createElement('div');overlay.className='kolPeriodDrawerBackdrop cpdBackdrop';
    const panel=document.createElement('aside');panel.className='kolPeriodDrawer cpdDrawer';panel.setAttribute('role','dialog');panel.setAttribute('aria-label',T('Fiyat çekmecesi','Price drawer'));
    overlay.appendChild(panel);document.body.appendChild(overlay);
    state={rowId:row.id??row._id,module,binding,overlay,panel,body:null,backdropDown:null,backdropTap:false};
    overlay.addEventListener('pointerdown',event=>{
      state.backdropDown=event;
      state.backdropTap=false;
    });
    overlay.addEventListener('pointerup',event=>{
      state.backdropTap=isBackdropTap(state.backdropDown,event,overlay);
      state.backdropDown=null;
    });
    overlay.addEventListener('pointercancel',()=>{
      state.backdropDown=null;
      state.backdropTap=false;
    });
    overlay.addEventListener('click',onClick);
    panel.addEventListener('change',event=>{const input=event.target.closest('[data-cpd-field]');if(input)commitField(input);});
    panel.addEventListener('keydown',event=>{const input=event.target.closest('[data-cpd-field]');if(input&&event.key==='Enter'){event.preventDefault();commitField(input);}});
    render();
    global.BLLayerSystem?.openDialog?.(overlay,{onClose:close});
    return true;
  }

  function close(){
    if(!state)return;
    const {overlay}=state;state=null;
    global.BLLayerSystem?.closeDialog?.(overlay);
    overlay.remove();
  }

  // Koleksiyon yeniden çizildiğinde açık çekmece güncel değerleri gösterir;
  // kullanıcı çekmecede yazarken odak bozulmaz.
  function refresh({force=false}={}){
    if(state&&!findRow(state.rowId)){close();return;}
    if(!state)return;
    const input=state.panel.contains(document.activeElement)&&document.activeElement.matches('[data-cpd-field]')?document.activeElement:null;
    if(!force&&canEdit()&&input)return;
    const draft=input&&canEdit()?{key:input.dataset.cpdField,value:input.value,start:input.selectionStart,end:input.selectionEnd}:null;
    render();
    if(draft&&state){const next=state.panel.querySelector('[data-cpd-field="'+CSS.escape(draft.key)+'"]');if(next&&!next.disabled){next.value=draft.value;next.focus();try{next.setSelectionRange(draft.start,draft.end);}catch(_){}}}
  }

  global.BLCollectionPriceDrawer={open,openCp:(row,module='cp')=>open(row,module),close,refresh,isOpen:()=>Boolean(state)};
})(window);
