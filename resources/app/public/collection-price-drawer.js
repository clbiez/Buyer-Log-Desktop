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
  const canEdit=()=>typeof kolWorkspaceCanEdit!=='undefined'&&Boolean(kolWorkspaceCanEdit);
  const findRow=id=>(typeof kolRows!=='undefined'&&Array.isArray(kolRows)?kolRows:[]).find(row=>String(row.id)===String(id))||null;

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
      (req.items||[]).forEach(line=>{
        if(line.dropped)return;
        let match=null;try{match=desk.findRow(line);}catch(_){}
        if(match!==row)return;
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
    if(k.ruleMissing)yd.push(`<li class="cpdStep isWarn"><span>⚠ ${esc(kolLicenseRuleMissingText(row))}</span></li>`);
    else{
      yd.push(step(`${esc('Supp. FOB')}${sourceLabel?` <em class="cpdBadge">${esc(sourceLabel)}${k.supp?.name?` · ${esc(k.supp.name)}`:''}</em>`:''}`,money2(k.ydBaseFob)));
      if(k.nonDtr){
        yd.push(step(esc(`÷ (1 − ${T('Royalty','Royalty')} %${pct(k.royaltyPct)})`),k.ydBaseFob!=null&&k.royaltyPct<100?money2(k.ydBaseFob/(1-k.royaltyPct/100)):'—'));
        yd.push(step(esc(`+ Hologram`),money2(k.hologramCost)));
      }
      yd.push(step(esc(`× ${T('YD çarpanı','Overseas multiplier')} ${pct(k.ydMult)}`),money2(k.ydLanded),'isTotal'));
    }
    const tr=[];
    if(k.trRuleMissing)tr.push(`<li class="cpdStep isWarn"><span>⚠ ${esc(kolTrLicenseRuleMissingText(row))}</span></li>`);
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

  function headHtml(row){
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
    state.panel.innerHTML=`${headHtml(row)}<div class="cpdBody">${offersHtml(row)}${waterfallHtml(row)}${endeksmatikHtml(row)}${canEdit()?'':`<p class="cpdNote">${esc(T('Bu sayfa salt okunur; değerler yalnız görüntülenir.','This page is read-only; values are view-only.'))}</p>`}</div>`;
    state.body=state.panel.querySelector('.cpdBody');
    if(state.body)state.body.scrollTop=scroll;
  }

  function commitField(input){
    const row=findRow(state?.rowId);if(!row||!canEdit())return;
    const key=input.dataset.cpdField,value=input.value;
    if(String(kolEffectiveValue(row,key)??'')===value)return;
    kolApplyCollectionCellChange({rowId:row.id,key,value,source:'drawer'},{rerender:true});
    render();
  }

  function onClick(event){
    if(!state)return;
    if(event.target===state.overlay||event.target.closest('[data-cpd-close]')){close();return;}
    const row=findRow(state.rowId);if(!row)return;
    const approve=event.target.closest('[data-cpd-approve]');
    if(approve){kolToggleConfirmedManufacturer(row,approve.dataset.cpdApprove);render();return;}
    if(event.target.closest('[data-cpd-manual]')){openKolManualPriceModal(row);return;}
    if(event.target.closest('[data-cpd-desk]')){close();void global.BL_QUOTATIONS?.openWorkspaceFromCollection?.([row]);return;}
    if(event.target.closest('[data-cpd-history]')){close();void global.BL_QUOTATIONS?.openPriceHistory?.([row]);}
  }

  function open(row){
    if(!row)return false;
    if(state){state.rowId=row.id;render();return true;}
    const overlay=document.createElement('div');overlay.className='kolPeriodDrawerBackdrop cpdBackdrop';
    const panel=document.createElement('aside');panel.className='kolPeriodDrawer cpdDrawer';panel.setAttribute('role','dialog');panel.setAttribute('aria-label',T('Fiyat çekmecesi','Price drawer'));
    overlay.appendChild(panel);document.body.appendChild(overlay);
    state={rowId:row.id,overlay,panel,body:null};
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
  function refresh(){
    if(!state||state.panel.contains(document.activeElement)&&document.activeElement.matches('input'))return;
    render();
  }

  global.BLCollectionPriceDrawer={open,close,refresh,isOpen:()=>Boolean(state)};
})(window);
