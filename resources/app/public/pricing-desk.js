/* Buyer Log — Fiyat Masası (Pricing Desk).

   Quotations ve Fiyat Geçmişi tek çalışma alanında birleşir:
     · Masa     — fiyat talepleri + model × üretici matrisi (görselli, hızlı giriş)
     · Turlar   — talep panosu (durum şeritleri) + pazarlık turları
     · Geçmiş   — model başına fiyat trendi (Fiyat Defteri olayları) + kayıt tablosu
     · Analiz   — klasman / MAG / MMYG / buyer × üretici fiyat analizi
   Üst çubuktaki Buyer kapsamı (Ben / seçili buyer'lar / tümü) dört sekmeye de
   uygulanır; yetki sunucudadır (yalnız görmeye yetkili olunan talepler gelir).

   Veri ve yazım quotations.js iç API'sinden (BL_QUOTATIONS.desk) geçer; hesap
   pricing-desk-engine.js saf motorundadır. Bu dosya yalnız görünüm ve etkileşimdir. */
(function(){
  'use strict';

  const E=window.BLPricingDeskEngine;
  if(!E)return;
  const Q=()=>window.BL_QUOTATIONS&&window.BL_QUOTATIONS.desk||null;
  const isEn=()=>typeof appLang!=='undefined'&&appLang==='en';
  const L=(tr,en)=>isEn()?en:tr;
  const clean=value=>String(value==null?'':value).trim();
  const esc=value=>String(value==null?'':value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const locale=()=>isEn()?'en-GB':'tr-TR';
  const money=value=>Number.isFinite(value)?'$'+value.toLocaleString(locale(),{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
  const moneyPlain=value=>Number.isFinite(value)?value.toLocaleString(locale(),{minimumFractionDigits:2,maximumFractionDigits:2}):'';
  const pctText=value=>{if(!Number.isFinite(value))return '—';const r=Math.round(value*10)/10;return `${r>0?'+':r<0?'−':''}${Math.abs(r).toLocaleString(locale(),{maximumFractionDigits:1})}%`;};
  const dateText=iso=>{const d=new Date(iso);return Number.isNaN(d.getTime())?'—':d.toLocaleDateString(locale());};
  const toneOf=value=>!Number.isFinite(value)?'isNeutral':value<=0?'isGood':'isBad';
  const reducedMotion=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const store={get(key,fallback){try{const raw=BLStorage.getItem(key);return raw?JSON.parse(raw):fallback;}catch(_){return fallback;}},set(key,value){try{BLStorage.setItem(key,JSON.stringify(value));}catch(_){}}};

  const TAB_KEY='lcw.pricingDesk.tab.v1',SCOPE_KEY='lcw.pricingDesk.scope.v1',VIEW_KEY='lcw.pricingDesk.detailView.v1',ANALYSIS_KEY='lcw.pricingDesk.analysis.v1',HISTORY_KEY='lcw.pricingDesk.history.v1',SUPPLIERS_KEY='lcw.pricingDesk.suppliers.v1';
  const TABS=['desk','rounds','history','analysis'];
  const state={
    tab:TABS.includes(store.get(TAB_KEY,'desk'))?store.get(TAB_KEY,'desk'):'desk',
    scope:normalizeScope(store.get(SCOPE_KEY,null)),
    detailViews:store.get(VIEW_KEY,{})||{},
    expandedSuppliers:store.get(SUPPLIERS_KEY,{})||{},
    analysis:{groupBy:'classification',basis:'latest',view:'matrix',filters:{},allSuppliers:false,...(store.get(ANALYSIS_KEY,{})||{})},
    history:{view:'models',query:'',filters:{},selected:'',limit:48,...(store.get(HISTORY_KEY,{})||{})},
    hosts:new Set(),ownerRows:new Map(),ownerRowsLoading:null,ownerRowsFailed:new Set(),
    roundsSelected:'',lastBest:new Map(),flash:new Set(),focus:null,undo:[],drill:null,
  };
  function normalizeScope(raw){
    const src=raw&&typeof raw==='object'?raw:{};
    return {all:Boolean(src.all),ownerIds:Array.isArray(src.ownerIds)?[...new Set(src.ownerIds.map(clean).filter(Boolean))].slice(0,100):[]};
  }

  /* ---------------- Buyer kapsamı ---------------- */
  function me(){return clean(Q()?.currentUserId?.());}
  function scopeOwnerIds(){const ids=new Set(state.scope.ownerIds);if(!ids.size)ids.add(me());return ids;}
  function scopeAllows(req){
    if(!req)return false;
    if(state.scope.all)return true;
    const ids=scopeOwnerIds(),self=me();
    if(ids.has(clean(req.ownerId)))return true;
    // "Ben" seçiliyken düzenleme yetkisi bana verilmiş başkasının talebi de görünür.
    return ids.has(self)&&Array.isArray(req.editorIds)&&req.editorIds.includes(self);
  }
  function scopeIsMulti(){return state.scope.all||scopeOwnerIds().size>1||!scopeOwnerIds().has(me());}
  function availableOwners(){
    const api=Q();if(!api)return [];
    const map=new Map(),self=me();
    map.set(self,{id:self,name:L('Ben','Me'),count:0,self:true});
    api.requests().forEach(req=>{
      const id=clean(req.ownerId);if(!id)return;
      if(!map.has(id))map.set(id,{id,name:api.ownerLabel(req),count:0,self:id===self});
      map.get(id).count++;
    });
    return [...map.values()].sort((a,b)=>(b.self-a.self)||a.name.localeCompare(b.name,'tr'));
  }
  function scopeLabel(){
    if(state.scope.all)return L('Tüm erişilebilir buyer\'lar','All accessible buyers');
    const ids=[...scopeOwnerIds()],owners=new Map(availableOwners().map(owner=>[owner.id,owner]));
    if(ids.length===1)return ids[0]===me()?L('Benim kayıtlarım','My records'):(owners.get(ids[0])?.name||ids[0]);
    return L(`${ids.length} buyer`,`${ids.length} buyers`);
  }
  function setScope(next){
    state.scope=normalizeScope(next);store.set(SCOPE_KEY,state.scope);
    void loadOwnerRows().then(()=>renderAllHosts());
    renderAllHosts();
  }
  /* Talep sahibinin Koleksiyon satırları (salt okunur). Yüklü Koleksiyon sayfası
     o sahibin değilse görsel, klasman ve hedef fiyat için sahibin sayfası
     okunur; yetki sunucu tarafından kesişimle uygulanır (Multi-Buyer ile aynı uç). */
  function ownerRows(ownerId){const rows=state.ownerRows.get(clean(ownerId));return Array.isArray(rows)?rows:null;}
  async function loadOwnerRows(){
    const api=Q();if(!api)return false;
    const loadedOwner=typeof kolWorkspaceOwnerId!=='undefined'?clean(kolWorkspaceOwnerId):'',mode=typeof kolWorkspaceMode!=='undefined'?kolWorkspaceMode:'';
    const wanted=new Set();
    api.requests().filter(req=>req.source==='collection'&&scopeAllows(req)).forEach(req=>{
      const owner=clean(req.ownerId);
      if(!owner||state.ownerRows.has(owner)||state.ownerRowsFailed.has(owner))return;
      if(mode!=='multi'&&owner===loadedOwner)return;
      if(mode==='multi'&&typeof kolRows!=='undefined'&&kolRows.some(row=>clean(row._collectionOwnerId)===owner))return;
      wanted.add(owner);
    });
    if(!wanted.size)return false;
    if(state.ownerRowsLoading)return state.ownerRowsLoading;
    state.ownerRowsLoading=(async()=>{
      try{
        const ids=[...wanted].slice(0,50);
        const res=await fetch(`/api/collection-workspaces-batch?ownerIds=${encodeURIComponent(ids.join(','))}`,{credentials:'same-origin',cache:'no-store'});
        const data=await res.json().catch(()=>({}));
        if(!res.ok){ids.forEach(id=>state.ownerRowsFailed.add(id));return false;}
        (Array.isArray(data.workspaces)?data.workspaces:[]).forEach(item=>{
          const id=clean(item&&item.owner&&item.owner.id),rows=Array.isArray(item&&item.workspace&&item.workspace.rows)?item.workspace.rows:[];
          if(id)state.ownerRows.set(id,rows.map(row=>({...row,_collectionOwnerId:id,_collectionOwnerName:clean(item.owner.displayName)})));
        });
        ids.filter(id=>!state.ownerRows.has(id)).forEach(id=>state.ownerRowsFailed.add(id));
        return true;
      }catch(_){[...wanted].forEach(id=>state.ownerRowsFailed.add(id));return false;}
      finally{state.ownerRowsLoading=null;}
    })();
    return state.ownerRowsLoading;
  }
  function scopedRequests(source='collection'){
    const api=Q();if(!api)return [];
    return api.requests().filter(req=>(!source||req.source===source)&&scopeAllows(req));
  }

  /* ---------------- Satır bilgisi (görsel, klasman, hedef) ---------------- */
  let infoCache=new WeakMap();
  function lineInfo(req,item){
    if(infoCache.has(item))return infoCache.get(item);
    const api=Q(),row=req.source==='collection'?api.findRow(item):null;
    const v=key=>row?clean(api.rowValue(row,key)):'';
    const info={
      row,model:v('modelKod')||clean(item.modelCode)||clean(item.plmId)||clean(item.orderCode)||'—',plmId:v('plmId')||clean(item.plmId),
      colour:v('colour')||clean(item.colour),colourCode:clean(row&&row.colourCode)||clean(item.colourCode),
      classification:clean(api.itemCategory(req,item))||'—',mag:v('mag'),mmyg:v('mmyg'),buyingGroup:v('buyingGroup'),
      buyer:clean(api.ownerLabel(req)),season:v('season')||clean(item.season),license:v('lisans')||clean(item.license),
      productMainDefinition:v('productMainDefinition'),fabric:clean(api.itemFabric(req,item)),
      target:E.price(api.itemTarget(req,item)),image:req.source==='collection'?clean(api.imageSrc(row,item)):clean(item.picture),
    };
    infoCache.set(item,info);
    return info;
  }
  function thumbHtml(req,item,classes='pdThumb'){
    const api=Q(),info=lineInfo(req,item);
    return api.thumb(info.image,{modelId:info.plmId||info.model,plmId:info.plmId,modelName:info.model,colourCode:info.colourCode,colour:info.colour,classes})||`<span class="${esc(classes)} pdThumbEmpty" aria-hidden="true"></span>`;
  }
  function bindThumbs(host){try{window.BLDetailImages?.bindThumbs?.(host);}catch(_){}}

  /* ---------------- Bildirim + geri al ---------------- */
  let toastTimer=null;
  function toast(message,{undo=false}={}){
    let el=document.getElementById('pdToast');
    if(!el){el=document.createElement('div');el.id='pdToast';el.className='pdToast';el.setAttribute('role','status');document.body.appendChild(el);}
    el.innerHTML=`<span>${esc(message)}</span>${undo?`<button type="button" class="tbtn" data-pd-toast-undo>${esc(L('Geri al','Undo'))}</button>`:''}`;
    el.classList.remove('isOut');el.hidden=false;
    el.querySelector('[data-pd-toast-undo]')?.addEventListener('click',()=>{undoLast();hideToast();});
    clearTimeout(toastTimer);toastTimer=setTimeout(hideToast,undo?7000:3200);
  }
  function hideToast(){const el=document.getElementById('pdToast');if(!el)return;el.classList.add('isOut');setTimeout(()=>{el.hidden=true;},reducedMotion()?0:190);}
  function snapshot(line){return {price:clean(line.price),approved:!!line.approved,dropped:!!line.dropped};}
  function pushUndo(req,lines,label){
    const entries=lines.filter(Boolean).map(line=>({lineId:line.id,prev:snapshot(line)}));
    if(!entries.length)return;
    state.undo.push({requestId:req.id,entries,label});
    if(state.undo.length>50)state.undo.shift();
  }
  async function undoLast(){
    const api=Q(),group=state.undo[state.undo.length-1];if(!api||!group)return false;
    const req=api.requests().find(item=>item.id===group.requestId);if(!req)return false;
    if(group.bulkGuard){
      const guard=group.bulkGuard;
      if(!api.canEdit(req)||api.currentUserId()!==guard.user||req.ownerId!==guard.owner||group.entries.some(entry=>Number(req.items.find(item=>item.id===entry.lineId)?.rev)!==guard.revisions[entry.lineId])){toast(L('Toplu geri alma güncelliğini yitirdi; fiyatları yeniden kontrol edin.','This bulk undo is stale; review the current prices.'));return false;}
      if(group.saving)return false;group.saving=true;
      try{await api.applyPricesBatch(req.id,group.entries.map(entry=>({lineId:entry.lineId,baseRev:guard.revisions[entry.lineId],price:entry.prev.price})),'undo');const index=state.undo.indexOf(group);if(index>=0)state.undo.splice(index,1);api.renderDetail();toast(L('Son değişiklik kaydedilerek geri alındı.','Last change undone and saved.'));return true;}
      catch(error){toast(error.message||L('Geri alma doğrulanamadı.','Undo could not be confirmed.'));return false;}finally{group.saving=false;}
    }
    state.undo.pop();
    group.entries.forEach(entry=>{
      const line=req.items.find(item=>item.id===entry.lineId);if(!line)return;
      if(clean(line.price)!==entry.prev.price)api.applyPrice(req,line,entry.prev.price,'undo');
      if(!!line.dropped!==entry.prev.dropped)api.toggleDrop(req,line,'undo');
      if(!!line.approved!==entry.prev.approved)api.setApproval(req,line,entry.prev.approved,'undo');
      state.flash.add(line.id);
    });
    api.renderDetail();
    toast(L('Son değişiklik geri alındı.','Last change undone.'));
    return true;
  }

  /* ================= MASA: model × üretici matrisi ================= */
  function detailView(req){
    if(!req)return 'list';
    const saved=state.detailViews[req.id];
    if(saved==='matrix'||saved==='list')return saved;
    return req.source==='collection'?'matrix':'list';
  }
  function setDetailView(req,view){if(!req)return;state.detailViews[req.id]=view==='list'?'list':'matrix';store.set(VIEW_KEY,state.detailViews);}

  /* Alternatif fiyat rozeti hücrenin sol üst köşesinde, fiyat metninin üstündeki
     boşluktadır (hücre taşanı kırptığı ve üst şerit ilk satırda sabit başlığın
     altında kaldığı için hücre dışına çıkmaz). Alternatif varsa daima görünür;
     yoksa düzenleme yetkisinde yalnız üzerine gelince / odakta "+" çıkar. */
  function optionBadgeHtml(line,label,canEdit){
    const list=E.lineOptions(line);
    if(!list.length&&!canEdit)return '';
    const main=`${clean(line.priceLabel)||L('Ana teklif','Main offer')}: ${E.price(line.price)!=null?money(E.price(line.price)):'—'}`;
    const tip=list.length?[main,...list.map((option,i)=>`${option.label||L(`Opsiyon ${i+1}`,`Option ${i+1}`)}: ${option.value!=null?money(option.value):(option.price||'—')}${option.note?` · ${option.note}`:''}`)].join('\n'):L('Alternatif fiyat ekle (O)','Add alternative price (O)');
    return `<button type="button" class="pdOptBadge${list.length?' hasOptions':''}" data-pd-options="${esc(line.id)}" tabindex="-1" title="${esc(tip)}" aria-label="${esc(L(`${label}: alternatif fiyatlar (${list.length})`,`${label}: alternative prices (${list.length})`))}">${list.length?esc(L(`OPS ${list.length}`,`OPT ${list.length}`)):esc(L('+ OPS','+ OPT'))}</button>`;
  }
  function cellHtml(req,model,name,stats,ctx){
    const line=model.cell(name);
    if(!line){
      if(!ctx.canEdit)return `<td class="pdCell isEmpty"><span class="pdNoLine" aria-label="${esc(L('Teklif yok','No offer'))}">—</span></td>`;
      const label=`${lineInfo(req,model.first).model} · ${name}`;
      return `<td class="pdCell isEmpty"><button type="button" class="pdAddLine" data-pd-add-line="${esc(name)}" data-pd-add-model="${esc(model.modelKey)}" title="${esc(L('Bu üretici için fiyat hücresi aç','Open a price cell for this manufacturer'))}" aria-label="${esc(L(`${label} için teklif satırı ekle`,`Add an offer line for ${label}`))}"><span aria-hidden="true">—</span><b aria-hidden="true">+</b></button></td>`;
    }
    const info=lineInfo(req,model.first),value=E.price(line.price),dropped=!!line.dropped;
    const isBest=!dropped&&stats.best&&stats.best.lineId===line.id&&stats.priced>1,isAppr=!!line.approved&&!dropped,outlier=stats.outliers.has(line.id);
    const neg=E.negotiation(line,req),prev=neg&&neg.previous!=null&&Math.abs(neg.previous-(value||0))>0.0001?neg.previous:null;
    const classes=['pdCell',isBest?'isBest':'',isAppr?'isApproved':'',dropped?'isDropped':'',outlier?'isOutlier':'',state.flash.has(line.id)?'pdFlash':''].filter(Boolean).join(' ');
    const label=`${info.model} · ${name}`;
    return `<td class="${classes}" data-pd-line="${esc(line.id)}">
      <div class="pdCellTop">${prev!=null?`<s class="pdPrev" title="${esc(L('Önceki teklif','Previous offer'))}">${esc(moneyPlain(prev))}</s>`:''}${isBest?`<span class="pdBestTag${ctx.moved?' isMoved':''}">${esc(L('EN İYİ','BEST'))}</span>`:''}${isAppr?`<span class="pdApprovedTag">${esc(L('ONAYLI','APPROVED'))}</span>`:''}</div>
      <div class="pdCellMain">
        <input type="text" inputmode="decimal" class="pdCellInput" data-pd-input="${esc(line.id)}" data-r="${ctx.mi}" data-c="${ctx.ci}" value="${esc(value!=null?moneyPlain(value):clean(line.price))}" placeholder="—" aria-label="${esc(L(`${label} teklif fiyatı`,`${label} quotation price`)+(E.lineOptions(line).length?L(` · ${E.lineOptions(line).length} alternatif fiyat`,` · ${E.lineOptions(line).length} alternative prices`):''))}" ${ctx.canEdit&&!dropped?'':'disabled'}>
        <button type="button" class="pdApprove${isAppr?' isOn':''}" data-pd-approve="${esc(line.id)}" tabindex="-1" aria-pressed="${isAppr?'true':'false'}" ${ctx.canEdit&&!dropped&&value!=null?'':'disabled'} title="${esc(isAppr?L('Onayı kaldır (A)','Remove approval (A)'):L('Onayla (A)','Approve (A)'))}" aria-label="${esc((isAppr?L('Onayı kaldır: ','Remove approval: '):L('Onayla: ','Approve: '))+label)}"><svg class="ic" aria-hidden="true"><use href="#i-check"/></svg></button>
        <button type="button" class="pdDrop${dropped?' isOn':''}" data-pd-drop="${esc(line.id)}" tabindex="-1" aria-pressed="${dropped?'true':'false'}" ${ctx.canEdit?'':'disabled'} title="${esc(dropped?L('Drop işaretini kaldır (D)','Remove Drop (D)'):L('Drop (D)','Drop (D)'))}" aria-label="${esc('Drop: '+label)}"><svg class="ic" aria-hidden="true"><use href="#i-x"/></svg></button>
      </div>
      <div class="pdCellOpt">${optionBadgeHtml(line,label,ctx.canEdit)}</div>
      <div class="pdCellNote">${outlier?esc(L('Olağan dışı · emin misin?','Unusual · are you sure?')):(dropped?esc(L('Drop','Dropped')):(neg&&neg.rounds>1?esc(L(`${neg.rounds} tur · ${pctText(neg.gainPct)}`,`${neg.rounds} rounds · ${pctText(neg.gainPct)}`)):''))}</div>
    </td>`;
  }
  function matrixRowsHtml(req,matrix,ctx){
    const api=Q(),prevBest=state.lastBest.get(req.id)||new Map(),nextBest=new Map();
    const html=matrix.models.map((model,mi)=>{
      const info=lineInfo(req,model.first),stats=E.rowStats(model.lines);
      const bestId=stats.best?stats.best.lineId:'';nextBest.set(model.modelKey,bestId);
      const moved=Boolean(bestId&&prevBest.has(model.modelKey)&&prevBest.get(model.modelKey)!==bestId);
      const shown=stats.approved&&stats.approved.price!=null?stats.approved:stats.best;
      const delta=shown&&info.target?E.pct(shown.price,info.target):null;
      const cells=matrix.manufacturers.map((name,ci)=>cellHtml(req,model,name,stats,{mi,ci,canEdit:ctx.canEdit,moved:moved&&bestId===model.cell(name)?.id}));
      if(ctx.other.length){const offers=ctx.other.map(s=>model.cell(s.name)).filter(line=>line&&!line.dropped&&E.price(line.price)!=null).sort((a,b)=>E.price(a.price)-E.price(b.price));const best=offers[0];cells.push(`<td class="pdCell pdOther"><button type="button" data-pd-expand aria-label="${esc(L('Diğer üreticileri aç','Expand other manufacturers'))}">${best?`<b>${esc(money(E.price(best.price)))}</b><small>${esc(best.manufacturer)}</small>`:'—'}</button></td>`);}
      const meta=[info.classification!=='—'?info.classification:'',info.colour].filter(Boolean).join(' · ');
      return `<tr data-pd-model="${esc(model.modelKey)}">
        <th scope="row" class="pdModelCell"><div class="pdModel">${thumbHtml(req,model.first)}<div class="pdModelText"><b title="${esc(info.model)}">${esc(info.model)}</b><span title="${esc(meta)}">${esc(meta||'—')}</span>${info.fabric?`<small title="${esc(info.fabric)}">${esc(info.fabric)}</small>`:''}</div></div></th>
        <td class="pdNum pdTarget">${info.target!=null?esc(money(info.target)):'—'}</td>
        <td class="pdNum pdBestCol pdStickyBest" data-pd-best>${shown?`<b>${esc(money(shown.price))}</b><span>${esc(shown.manufacturer)}${stats.approved?` · ${esc(L('onaylı','approved'))}`:''}</span>`:'<span>—</span>'}</td>
        <td class="pdNum pdStickyDelta" data-pd-delta><span class="pdChip ${toneOf(delta)}">${esc(pctText(delta))}</span></td>
        ${cells.join('')}${ctx.canEdit?'<td class="pdAddMfrCell" aria-hidden="true"></td>':''}
      </tr>`;
    }).join('');
    state.lastBest.set(req.id,nextBest);
    return html;
  }
  function supplierHeadHtml(card){
    const coverage=L(`${card.models}/${card.total} model, ${card.wins} kazanma`,`${card.models}/${card.total} models, ${card.wins} wins`);
    return `<b title="${esc(card.name)}">${esc(card.name)}</b><small title="${esc(coverage)}" aria-label="${esc(coverage)}">${card.models}/${card.total} · ${card.wins} ${esc(L('en iyi','best'))}</small><small class="${toneOf(card.modelIndex)}" title="${esc(L('Aynı modelin teklif ortalamasına göre fark','Difference to the same model’s average offer'))}">${esc(pctText(card.modelIndex))}</small>`;
  }
  function renderMatrix(host,req){
    const api=Q();if(!host||!req||!api)return;
    infoCache=new WeakMap();
    const canEdit=api.canEdit(req),layout=E.supplierLayout(E.supplierScorecards(req),Boolean(state.expandedSuppliers[req.id])),matrix={...E.requestMatrix(req),manufacturers:layout.visible.map(s=>s.name)};
    const candidates=canEdit?E.bulkApproveCandidates(req,item=>api.itemTarget(req,item)):[];
    const gain=E.requestGain(req),round=Math.max(1,Number(req.round)||1);
    const heads=layout.visible.map(card=>`<th scope="col" class="pdMfrHead" data-pd-supplier="${esc(card.key)}">${supplierHeadHtml(card)}</th>`).join('');
    const otherHead=layout.other.length?`<th scope="col" class="pdMfrHead"><button type="button" class="linkBtn" data-pd-expand aria-expanded="false">${esc(L(`Diğer (${layout.other.length})`,`Other (${layout.other.length})`))}</button></th>`:'';
    // Tablodan üretici ekleme sütunu (Send to Pricing kullanmadan fiyat veren üretici için).
    const addHead=canEdit?`<th scope="col" class="pdMfrHead pdAddMfrHead"><button type="button" class="pdAddMfr" data-pd-add-mfr title="${esc(L('Tabloya üretici ekle','Add a manufacturer to the table'))}"><svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg>${esc(L('Üretici','Manufacturer'))}</button></th>`:'';
    const columnCount=matrix.manufacturers.length+(layout.other.length?1:0)+(canEdit?1:0);
    host.innerHTML=`<div class="pdMatrixBar">
        <span class="pdLegend"><i class="pdLegendBest"></i>${esc(L('En iyi','Best'))}<i class="pdLegendAppr"></i>${esc(L('Onaylı','Approved'))}<i class="pdLegendOut"></i>${esc(L('Olağan dışı','Unusual'))}</span>
        <span class="pdRoundBadge" title="${esc(L('Bu talepteki pazarlık turu','Negotiation round of this request'))}">${esc(L(`Tur ${round}`,`Round ${round}`))}</span>
        ${gain&&Number.isFinite(gain.gainPct)&&Math.abs(gain.gainPct)>=0.05?`<span class="pdChip ${toneOf(gain.gainPct)}" title="${esc(L('İlk tur en iyi tekliflerine göre güncel fiyat','Current price versus first-round best offers'))}">${esc(L('Pazarlık','Negotiation'))} ${esc(pctText(gain.gainPct))}</span>`:''}
        <span class="pdBarSpacer"></span>
        ${state.expandedSuppliers[req.id]&&matrix.manufacturers.length>8?`<button type="button" class="tbtn" data-pd-collapse aria-expanded="true">${esc(L('Üreticileri katla','Collapse manufacturers'))}</button>`:''}
        ${canEdit&&candidates.length?`<button type="button" class="tbtn" data-pd-bulk><svg class="ic"><use href="#i-check"/></svg>${esc(L(`Hedefin altındakileri onayla (${candidates.length})`,`Approve below target (${candidates.length})`))}</button>`:''}
        ${canEdit?`<button type="button" class="tbtn" data-pd-import title="${esc(L('Üreticinin doldurduğu fiyat talep Excel’ini seç ya da tabloya sürükle','Choose the pricing request Excel returned by the manufacturer, or drag it onto the table'))}"><svg class="ic"><use href="#i-file-import"/></svg>${esc(L('Dönüş Excel’i','Supplier Excel'))}</button><input type="file" accept=".xlsx,.xls" data-pd-import-file hidden>`:''}
        ${canEdit?`<button type="button" class="tbtn" data-pd-round><svg class="ic"><use href="#i-refresh"/></svg>${esc(L('Yeni tur','New round'))}</button>`:''}
        <button type="button" class="tbtn" data-pd-undo ${state.undo.some(group=>group.requestId===req.id)?'':'disabled'} title="Ctrl+Z"><svg class="ic"><use href="#i-arrow-back-up"/></svg>${esc(L('Geri al','Undo'))}</button>
      </div>
      <div class="pdBulkPanel" data-pd-bulk-panel hidden></div>
      <div class="pdRoundPanel" data-pd-round-panel hidden></div>
      <div class="pdImportPanel" data-pd-import-panel hidden></div>
      <div class="pdMfrPanel" data-pd-mfr-panel hidden></div>
      <div class="pdOptionsPanel" data-pd-options-panel hidden></div>
      <div class="pdMatrixScroll"><table class="pdMatrix" style="--pd-columns:${columnCount}" aria-label="${esc(L('Model × üretici teklif matrisi','Model × manufacturer quotation matrix'))}">
        <colgroup><col class="pdModelWidth"><col class="pdTargetWidth"><col class="pdBestWidth"><col class="pdDeltaWidth">${Array.from({length:columnCount},()=>'<col class="pdSupplierWidth">').join('')}</colgroup>
        <thead><tr><th scope="col" class="pdModelHead">${esc(L('Model','Model'))}</th><th scope="col" class="pdNum pdTarget">${esc(L('Hedef','Target'))}</th><th scope="col" class="pdNum pdStickyBest">${esc(L('En iyi / Onaylı','Best / Approved'))}</th><th scope="col" class="pdNum pdStickyDelta">Δ ${esc(L('Hedef','Target'))}</th>${heads}${otherHead}${addHead}</tr></thead>
        <tbody>${matrix.models.length?matrixRowsHtml(req,matrix,{canEdit,other:layout.other}):`<tr><td colspan="${columnCount+4}"><div class="pricingEmptyState">${esc(L('Bu talepte model yok.','There are no models in this request.'))}</div></td></tr>`}</tbody>
      </table></div>
      <div class="pdHints" aria-hidden="true"><span><kbd>Enter</kbd> ${esc(L('alt satır','next row'))}</span><span><kbd>Tab</kbd> ${esc(L('sonraki üretici','next manufacturer'))}</span><span><kbd>A</kbd> ${esc(L('onayla','approve'))}</span><span><kbd>D</kbd> Drop</span><span><kbd>O</kbd> ${esc(L('alternatif fiyat','alternative price'))}</span><span><kbd>Ctrl+V</kbd> ${esc(L('Excel’den blok yapıştır','paste a block from Excel'))}</span><span><kbd>Ctrl+Z</kbd> ${esc(L('geri al','undo'))}</span><span><kbd>Esc</kbd> ${esc(L('vazgeç','cancel'))}</span></div>`;
    host.querySelectorAll('[data-pd-expand],[data-pd-collapse]').forEach(button=>button.addEventListener('click',()=>{
      const scroll=host.querySelector('.pdMatrixScroll'),left=scroll?.scrollLeft||0;
      if(button.hasAttribute('data-pd-expand'))state.expandedSuppliers[req.id]=true;else delete state.expandedSuppliers[req.id];
      store.set(SUPPLIERS_KEY,state.expandedSuppliers);renderMatrix(host,req);
      const next=host.querySelector('.pdMatrixScroll');if(next)next.scrollLeft=left;
      host.querySelector('[data-pd-collapse],[data-pd-expand]')?.focus({preventScroll:true});
    }));
    // Yazarken ve hücreler arasında ilerlerken sütunları yerinden oynatma.
    host.onfocusout=()=>setTimeout(()=>{
      if(host.dataset.pdOrderDirty!=='1'||host.contains(document.activeElement))return;
      delete host.dataset.pdOrderDirty;
      const left=host.querySelector('.pdMatrixScroll')?.scrollLeft||0;
      renderMatrix(host,req);const scroll=host.querySelector('.pdMatrixScroll');if(scroll)scroll.scrollLeft=left;
    },0);
    state.flash.clear();
    bindMatrix(host,req,matrix,candidates);
    bindThumbs(host);
    restoreFocus(host,req);
  }
  function restoreFocus(host,req){
    const target=state.focus;state.focus=null;
    if(!target||target.requestId!==req.id)return;
    const input=host.querySelector(`[data-pd-input="${CSS.escape(target.lineId)}"]`);
    if(input&&!input.disabled){input.focus();if(target.select!==false)input.select();}
  }
  function lineOf(req,id){return (req.items||[]).find(item=>item.id===id)||null;}
  function moveFocus(host,input,dr,dc){
    const r=Number(input.dataset.r)+dr,c=Number(input.dataset.c)+dc;
    const next=host.querySelector(`.pdCellInput[data-r="${r}"][data-c="${c}"]`);
    if(next&&!next.disabled){next.focus();next.select();return true;}
    return false;
  }
  /* Değer yazıldıktan sonra yalnız ilgili model satırının en iyi/onay/Δ
     bilgisi güncellenir; inputlar yeniden çizilmez, odak ve yazma akışı bozulmaz. */
  function refreshModelRow(host,req,modelKey){
    const matrix=E.requestMatrix(req),model=matrix.models.find(item=>item.modelKey===modelKey);
    const tr=host.querySelector(`tr[data-pd-model="${CSS.escape(modelKey)}"]`);
    if(!model||!tr)return;
    infoCache=new WeakMap();
    const stats=E.rowStats(model.lines),info=lineInfo(req,model.first);
    const prev=(state.lastBest.get(req.id)||new Map()).get(modelKey)||'',bestId=stats.best?stats.best.lineId:'';
    const map=state.lastBest.get(req.id)||new Map();map.set(modelKey,bestId);state.lastBest.set(req.id,map);
    model.lines.forEach(line=>{
      const td=tr.querySelector(`td[data-pd-line="${CSS.escape(line.id)}"]`);if(!td)return;
      const name=line.manufacturer,fresh=document.createElement('tbody');
      fresh.innerHTML=`<tr>${cellHtml(req,model,name,stats,{mi:Number(td.querySelector('.pdCellInput')?.dataset.r||0),ci:Number(td.querySelector('.pdCellInput')?.dataset.c||0),canEdit:Q().canEdit(req),moved:Boolean(bestId&&prev&&prev!==bestId&&bestId===line.id)})}</tr>`;
      const next=fresh.querySelector('td');
      td.className=next.className;
      td.querySelector('.pdCellTop').innerHTML=next.querySelector('.pdCellTop').innerHTML;
      td.querySelector('.pdCellNote').innerHTML=next.querySelector('.pdCellNote').innerHTML;
      const opt=td.querySelector('.pdCellOpt');if(opt)opt.innerHTML=next.querySelector('.pdCellOpt').innerHTML;
      ['.pdApprove','.pdDrop'].forEach(selector=>{const a=td.querySelector(selector),b=next.querySelector(selector);if(a&&b){a.className=b.className;a.disabled=b.disabled;a.setAttribute('aria-pressed',b.getAttribute('aria-pressed'));a.title=b.title;}});
    });
    const shown=stats.approved&&stats.approved.price!=null?stats.approved:stats.best;
    const delta=shown&&info.target?E.pct(shown.price,info.target):null;
    const best=tr.querySelector('[data-pd-best]');if(best)best.innerHTML=shown?`<b>${esc(money(shown.price))}</b><span>${esc(shown.manufacturer)}${stats.approved?` · ${esc(L('onaylı','approved'))}`:''}</span>`:'<span>—</span>';
    const deltaCell=tr.querySelector('[data-pd-delta]');if(deltaCell)deltaCell.innerHTML=`<span class="pdChip ${toneOf(delta)}">${esc(pctText(delta))}</span>`;
    E.supplierScorecards(req).forEach(card=>{const head=host.querySelector(`[data-pd-supplier="${CSS.escape(card.key)}"]`);if(head)head.innerHTML=supplierHeadHtml(card);});
    host.dataset.pdOrderDirty='1';
    const undo=host.querySelector('[data-pd-undo]');if(undo)undo.disabled=!state.undo.some(group=>group.requestId===req.id);
  }
  function flashCell(host,lineId){
    const td=host.querySelector(`td[data-pd-line="${CSS.escape(lineId)}"]`);if(!td||reducedMotion())return;
    td.classList.remove('pdFlash');void td.offsetWidth;td.classList.add('pdFlash');
  }
  function commitInput(host,req,input,source='matrix'){
    const api=Q(),line=lineOf(req,input.dataset.pdInput);if(!api||!line)return false;
    const raw=clean(input.value),current=clean(line.price);
    const same=(E.price(raw)!=null||E.price(current)!=null)?Math.abs((E.price(raw)||0)-(E.price(current)||0))<0.00005&&(E.price(raw)!=null)===(E.price(current)!=null):raw===current;
    if(same){const v=E.price(current);input.value=v!=null?moneyPlain(v):current;return false;}
    pushUndo(req,[line],'price');
    api.applyPrice(req,line,raw,source);
    const v=E.price(line.price);input.value=v!=null?moneyPlain(v):clean(line.price);
    refreshModelRow(host,req,line.modelKey);flashCell(host,line.id);
    return true;
  }
  function toggleApprove(host,req,line,source='matrix'){
    const api=Q();if(!api||!line)return;
    if(!E.price(line.price)){toast(L('Onaylamak için önce geçerli bir teklif fiyatı gir.','Enter a valid quotation price before approval.'));return;}
    const affected=(req.items||[]).filter(item=>item.modelKey===line.modelKey);
    pushUndo(req,affected,'approve');
    state.focus={requestId:req.id,lineId:line.id};state.flash.add(line.id);
    api.setApproval(req,line,!line.approved,source);
  }
  function toggleDrop(host,req,line){
    const api=Q();if(!api||!line)return;
    pushUndo(req,[line],'drop');
    state.focus={requestId:req.id,lineId:line.id,select:false};
    api.toggleDrop(req,line,'matrix');
  }
  /* Excel'den kopyalanan blok (sekme/satır ayrımlı) odaktaki hücreden başlayarak
     matrise yazılır. Tek geri alma adımıdır. */
  function pasteBlock(host,req,input,text){
    const rows=String(text||'').replace(/\r/g,'').split('\n');
    if(rows.length&&rows[rows.length-1]==='')rows.pop();
    const grid=rows.map(row=>row.split('\t'));
    if(grid.length<=1&&(grid[0]||[]).length<=1)return false;
    const r0=Number(input.dataset.r),c0=Number(input.dataset.c),targets=[];
    grid.forEach((cells,dr)=>cells.forEach((value,dc)=>{
      const el=host.querySelector(`.pdCellInput[data-r="${r0+dr}"][data-c="${c0+dc}"]`);
      if(!el||el.disabled)return;
      const line=lineOf(req,el.dataset.pdInput);if(!line)return;
      targets.push({el,line,value:clean(value)});
    }));
    if(!targets.length)return false;
    pushUndo(req,targets.map(item=>item.line),'paste');
    let changed=0;
    targets.forEach(item=>{item.el.value=item.value;const before=state.undo.length;if(commitInput(host,req,item.el,'paste'))changed++;while(state.undo.length>before)state.undo.pop();});
    toast(L(`${changed} teklif hücresi yapıştırıldı.`,`${changed} quotation cells pasted.`),{undo:changed>0});
    return true;
  }
  function openBulk(host,req,candidates){
    const panel=host.querySelector('[data-pd-bulk-panel]');if(!panel)return;
    if(!panel.hidden){panel.hidden=true;return;}
    panel.innerHTML=`<div class="pdPanelHead"><b>${esc(L('Toplu onay önizlemesi','Bulk approval preview'))}</b><span>${esc(L('Onayı olmayan ve en iyi teklifi hedefin altında/eşit olan modeller. Onay sizde; uygulamadan önce kontrol edin.','Models without approval whose best offer is at or below target. You decide; review before applying.'))}</span></div>
      <div class="pdPanelList">${candidates.map(item=>{const info=lineInfo(req,item.line);return `<div class="pdPanelRow">${thumbHtml(req,item.line,'pdThumb isSmall')}<b>${esc(info.model)}</b><span>${esc(item.manufacturer)}</span><span class="pdNum">${esc(money(item.price))}</span><span class="pdChip ${toneOf(item.deltaPct)}">${esc(pctText(item.deltaPct))}</span></div>`;}).join('')}</div>
      <div class="pdPanelActions"><button type="button" class="tbtn" data-pd-bulk-cancel>${esc(L('Vazgeç','Cancel'))}</button><button type="button" class="tbtn primary" data-pd-bulk-apply>${esc(L(`${candidates.length} modeli onayla`,`Approve ${candidates.length} models`))}</button></div>`;
    panel.hidden=false;bindThumbs(panel);
    panel.querySelector('[data-pd-bulk-cancel]').addEventListener('click',()=>{panel.hidden=true;});
    panel.querySelector('[data-pd-bulk-apply]').addEventListener('click',()=>{
      const api=Q();
      const lines=candidates.flatMap(item=>(req.items||[]).filter(line=>line.modelKey===item.modelKey));
      pushUndo(req,lines,'bulk');
      candidates.forEach(item=>{state.flash.add(item.lineId);api.setApproval(req,item.line,true,'bulk');});
      toast(L(`${candidates.length} model onaylandı; Koleksiyon güncellendi.`,`${candidates.length} models approved; Collection updated.`),{undo:true});
    });
  }
  function openRoundPanel(host,req){
    const panel=host.querySelector('[data-pd-round-panel]');if(!panel)return;
    if(!panel.hidden){panel.hidden=true;return;}
    const next=Math.max(1,Number(req.round)||1)+1;
    panel.innerHTML=`<div class="pdPanelHead"><b>${esc(L(`Tur ${next} başlat`,`Start round ${next}`))}</b><span>${esc(L('Mevcut fiyatlar korunur; bundan sonra girilen teklifler yeni tur olarak kaydedilir ve eski fiyatlar geçmişte üstü çizili görünür.','Current prices are kept; offers entered from now on are recorded as the new round and earlier prices appear struck through in history.'))}</span></div>
      <label class="pdField"><span>${esc(L('Tur notu (ör. karşı teklif hedefi)','Round note (e.g. counter-offer target)'))}</span><input type="text" maxlength="300" data-pd-round-note placeholder="${esc(L('Karşı teklif: …','Counter-offer: …'))}"></label>
      <div class="pdPanelActions"><button type="button" class="tbtn" data-pd-round-cancel>${esc(L('Vazgeç','Cancel'))}</button><button type="button" class="tbtn primary" data-pd-round-apply>${esc(L('Turu başlat','Start round'))}</button></div>`;
    panel.hidden=false;
    const note=panel.querySelector('[data-pd-round-note]');setTimeout(()=>note?.focus(),0);
    panel.querySelector('[data-pd-round-cancel]').addEventListener('click',()=>{panel.hidden=true;});
    panel.querySelector('[data-pd-round-apply]').addEventListener('click',async event=>{
      event.currentTarget.disabled=true;
      const saved=await Q().startRound(req,note?.value||'');
      if(saved){toast(L(`Tur ${saved.round} başladı.`,`Round ${saved.round} started.`));Q().renderDetail();}
      else event.currentTarget.disabled=false;
    });
  }
  function playPanel(panel){try{window.BLMotionPlus?.play?.('card',panel);}catch(_){}}
  function closeSiblingPanels(host,keep){host.querySelectorAll('[data-pd-mfr-panel],[data-pd-options-panel]').forEach(panel=>{if(panel!==keep)panel.hidden=true;});}
  /* Talepte yeni üretici: her model için boş fiyat hücresi açılır ve ilk hücreye
     odaklanılır. Ad, Koleksiyon üretici listesi ve diğer taleplerden önerilir. */
  function focusAdded(req,result){
    if(!result||!result.added.length)return false;
    if(E.requestMatrix(req).manufacturers.length>8&&!state.expandedSuppliers[req.id]){state.expandedSuppliers[req.id]=true;store.set(SUPPLIERS_KEY,state.expandedSuppliers);}
    state.focus={requestId:req.id,lineId:result.added[0].id};
    Q().renderDetail();
    return true;
  }
  function openManufacturerPanel(host,req){
    const api=Q(),panel=host.querySelector('[data-pd-mfr-panel]');if(!api||!panel)return;
    if(!panel.hidden){panel.hidden=true;return;}
    closeSiblingPanels(host,panel);
    const present=new Map(E.supplierScorecards(req).map(card=>[card.key,card])),models=E.requestMatrix(req).models.length;
    const suggestions=api.manufacturerSuggestions().filter(item=>{const card=present.get(E.keyOf(item.name));return !card||card.models<models;});
    const listId=`pdMfrList-${String(req.id).replace(/[^A-Za-z0-9_-]/g,'_')}`;
    panel.innerHTML=`<div class="pdPanelHead"><b>${esc(L('Tabloya üretici ekle','Add a manufacturer to the table'))}</b><span>${esc(L(`Send to Pricing kullanmadan fiyat veren üreticiyi ekle. Bu talepteki ${models} model için boş fiyat hücresi açılır; fiyatı doğrudan matrise yazarsın.`,`Add a manufacturer that quoted without Send to Pricing. Empty price cells open for the ${models} models of this request; type prices straight into the matrix.`))}</span></div>
      <div class="pdMfrFields">
        <label class="pdField"><span>${esc(L('Üretici','Manufacturer'))}</span><input type="text" maxlength="240" list="${esc(listId)}" data-pd-mfr-name autocomplete="off" placeholder="${esc(L('Üretici adı','Manufacturer name'))}"></label>
        <label class="pdField"><span>${esc(L('E-posta (isteğe bağlı)','E-mail (optional)'))}</span><input type="email" maxlength="320" data-pd-mfr-email autocomplete="off" placeholder="name@example.com"></label>
        <datalist id="${esc(listId)}">${suggestions.map(item=>`<option value="${esc(item.name)}"></option>`).join('')}</datalist>
      </div>
      <div class="pdPanelActions"><button type="button" class="tbtn" data-pd-mfr-cancel>${esc(L('Vazgeç','Cancel'))}</button><button type="button" class="tbtn primary" data-pd-mfr-apply>${esc(L('Üreticiyi ekle','Add manufacturer'))}</button></div>`;
    panel.hidden=false;playPanel(panel);
    const name=panel.querySelector('[data-pd-mfr-name]'),email=panel.querySelector('[data-pd-mfr-email]');
    name?.focus();
    name.addEventListener('change',()=>{const hit=suggestions.find(item=>E.keyOf(item.name)===E.keyOf(name.value));if(hit&&hit.email&&!clean(email.value))email.value=hit.email;});
    const apply=()=>{
      const typed=clean(name.value);
      if(!typed){toast(L('Üretici adını yaz ya da listeden seç.','Type a manufacturer name or pick one from the list.'));name.focus();return;}
      const result=api.addManufacturer(req,{name:typed,email:clean(email.value)});
      if(!result)return;
      if(!result.added.length){toast(L(`${result.manufacturer.name} bu talepteki bütün modellerde zaten var.`,`${result.manufacturer.name} is already on every model of this request.`));return;}
      toast(L(`${result.manufacturer.name} eklendi; ${result.added.length} model için fiyat girebilirsin.`,`${result.manufacturer.name} added; enter prices for ${result.added.length} models.`));
      focusAdded(req,result);
    };
    panel.querySelector('[data-pd-mfr-apply]').addEventListener('click',apply);
    panel.querySelector('[data-pd-mfr-cancel]').addEventListener('click',()=>{panel.hidden=true;});
    [name,email].forEach(input=>input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();apply();}if(event.key==='Escape'){event.preventDefault();panel.hidden=true;}}));
  }
  // Boş hücre: üretici talepte var ama bu model için satırı yok → tek satır açılır.
  function addLineFor(host,req,manufacturer,modelKey){
    const api=Q();if(!api||!manufacturer||!modelKey)return;
    const result=api.addManufacturer(req,{name:manufacturer},{modelKeys:[modelKey]});
    if(result&&result.added.length)focusAdded(req,result);
  }
  /* Alternatif fiyatlar: üretici aynı model için koşula bağlı ayrı fiyat
     verebilir (ör. kumaş gramajı / işçilik değişirse opsiyon 1, değişmezse
     opsiyon 2). Ana fiyat en iyi teklif, onay ve Koleksiyon hesabına girer;
     alternatif "Ana fiyat yap" ile seçilir, önceki ana fiyat alternatif olarak kalır. */
  function openOptionsPanel(host,req,line){
    const api=Q(),panel=host.querySelector('[data-pd-options-panel]');if(!api||!panel||!line)return;
    if(!panel.hidden&&panel.dataset.pdLine===line.id){panel.hidden=true;return;}
    closeSiblingPanels(host,panel);
    const canEdit=api.canEdit(req),info=lineInfo(req,line);
    const blank=()=>({id:`opt-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,label:'',price:'',note:''});
    const draft={priceLabel:clean(line.priceLabel),priceNote:clean(line.priceNote),options:E.lineOptions(line).map(option=>({id:option.id||blank().id,label:option.label,price:option.value!=null?moneyPlain(option.value):option.price,note:option.note}))};
    if(!draft.options.length&&canEdit)draft.options.push(blank());
    const mainValue=E.price(line.price);
    const dis=canEdit?'':'disabled';
    const render=focusIndex=>{
      panel.innerHTML=`<div class="pdPanelHead"><b>${esc(L('Alternatif fiyatlar','Alternative prices'))} · ${esc(info.model)} · ${esc(line.manufacturer)}</b><span>${esc(L('Üretici aynı model için farklı koşullarla fiyat verebilir (ör. kumaş gramajı ya da işçilik değişirse opsiyon 1, değişmezse opsiyon 2). En iyi teklif, onay ve Koleksiyon yalnız ana fiyatı kullanır; bir alternatifi “Ana fiyat yap” ile seçebilirsin.','A manufacturer may quote the same model under different conditions (e.g. option 1 if fabric weight or workmanship changes, option 2 if not). Best offer, approval and Collection use only the main price; pick an alternative with “Make main price”.'))}</span></div>
        <div class="pdOptGrid" role="table" aria-label="${esc(L('Alternatif fiyat listesi','Alternative price list'))}">
          <div class="pdOptRow pdOptHeadRow" role="row"><span role="columnheader">${esc(L('Seçenek','Option'))}</span><span role="columnheader" class="pdNum">${esc(L('Fiyat (USD)','Price (USD)'))}</span><span role="columnheader">${esc(L('Koşul / not','Condition / note'))}</span><span role="columnheader"></span></div>
          <div class="pdOptRow isMain" role="row"><input type="text" maxlength="120" data-pd-main-label value="${esc(draft.priceLabel)}" placeholder="${esc(L('Ana teklif','Main offer'))}" aria-label="${esc(L('Ana fiyat etiketi','Main price label'))}" ${dis}><span class="pdNum pdOptMainPrice" title="${esc(L('Ana fiyat matristeki hücreden girilir','The main price is entered in the matrix cell'))}">${esc(mainValue!=null?money(mainValue):'—')}</span><input type="text" maxlength="500" data-pd-main-note value="${esc(draft.priceNote)}" placeholder="${esc(L('ör. mevcut gramaj, mevcut işçilik','e.g. current fabric weight and workmanship'))}" aria-label="${esc(L('Ana fiyat notu','Main price note'))}" ${dis}><span class="pdOptMainTag">${esc(L('ANA FİYAT','MAIN PRICE'))}</span></div>
          ${draft.options.map((option,i)=>{const value=E.price(option.price);return `<div class="pdOptRow" role="row" data-pd-opt-row="${i}"><input type="text" maxlength="120" data-pd-opt-label="${i}" value="${esc(option.label)}" placeholder="${esc(L(`Opsiyon ${i+1}`,`Option ${i+1}`))}" aria-label="${esc(L(`Opsiyon ${i+1} etiketi`,`Option ${i+1} label`))}" ${dis}><input type="text" inputmode="decimal" class="pdNum" data-pd-opt-price="${i}" value="${esc(option.price)}" placeholder="—" aria-label="${esc(L(`Opsiyon ${i+1} fiyatı`,`Option ${i+1} price`))}" ${dis}><input type="text" maxlength="500" data-pd-opt-note="${i}" value="${esc(option.note)}" placeholder="${esc(L('ör. 160 gr kumaş, nakışsız','e.g. 160 gsm fabric, no embroidery'))}" aria-label="${esc(L(`Opsiyon ${i+1} notu`,`Option ${i+1} note`))}" ${dis}><span class="pdOptActions">${canEdit?`<button type="button" class="tbtn" data-pd-opt-promote="${i}" ${value!=null&&!line.dropped?'':'disabled'} title="${esc(L('Bu alternatifi ana fiyat yap; mevcut ana fiyat alternatif olarak saklanır','Make this alternative the main price; the current main price is kept as an alternative'))}">${esc(L('Ana fiyat yap','Make main price'))}</button><button type="button" class="pdOptRemove" data-pd-opt-remove="${i}" title="${esc(L('Alternatifi sil','Remove alternative'))}" aria-label="${esc(L(`Opsiyon ${i+1} sil`,`Remove option ${i+1}`))}"><svg class="ic" aria-hidden="true"><use href="#i-x"/></svg></button>`:''}</span></div>`;}).join('')}
        </div>
        <div class="pdPanelActions">${canEdit?`<button type="button" class="tbtn" data-pd-opt-add ${draft.options.length>=10?'disabled':''}><svg class="ic"><use href="#i-plus"/></svg>${esc(L('Alternatif ekle','Add alternative'))}</button><span class="pdBarSpacer"></span>`:''}<button type="button" class="tbtn" data-pd-opt-cancel>${esc(canEdit?L('Vazgeç','Cancel'):L('Kapat','Close'))}</button>${canEdit?`<button type="button" class="tbtn primary" data-pd-opt-save>${esc(L('Kaydet','Save'))}</button>`:''}</div>`;
      panel.dataset.pdLine=line.id;
      panel.querySelector('[data-pd-main-label]')?.addEventListener('input',event=>{draft.priceLabel=event.target.value;});
      panel.querySelector('[data-pd-main-note]')?.addEventListener('input',event=>{draft.priceNote=event.target.value;});
      panel.querySelectorAll('[data-pd-opt-label],[data-pd-opt-price],[data-pd-opt-note]').forEach(input=>input.addEventListener('input',()=>{
        const i=Number(input.dataset.pdOptLabel??input.dataset.pdOptPrice??input.dataset.pdOptNote),field=input.hasAttribute('data-pd-opt-label')?'label':input.hasAttribute('data-pd-opt-price')?'price':'note';
        if(draft.options[i])draft.options[i][field]=input.value;
        if(field==='price'){const promote=panel.querySelector(`[data-pd-opt-promote="${i}"]`);if(promote)promote.disabled=E.price(input.value)==null||!!line.dropped;}
      }));
      panel.querySelectorAll('[data-pd-opt-remove]').forEach(button=>button.addEventListener('click',()=>{draft.options.splice(Number(button.dataset.pdOptRemove),1);render();}));
      panel.querySelector('[data-pd-opt-add]')?.addEventListener('click',()=>{if(draft.options.length>=10)return;draft.options.push(blank());render(draft.options.length-1);});
      panel.querySelector('[data-pd-opt-cancel]')?.addEventListener('click',()=>{panel.hidden=true;});
      panel.querySelector('[data-pd-opt-save]')?.addEventListener('click',()=>{if(save())toast(L('Alternatif fiyatlar kaydedildi.','Alternative prices saved.'));});
      panel.querySelectorAll('[data-pd-opt-promote]').forEach(button=>button.addEventListener('click',()=>{
        const option=draft.options[Number(button.dataset.pdOptPromote)];if(!option)return;
        const id=option.id;if(!save({render:false}))return;
        if(api.promoteOption(req,line,id,'matrix')){state.flash.add(line.id);toast(L('Alternatif ana fiyat yapıldı; önceki ana fiyat alternatif olarak saklandı.','Alternative is now the main price; the previous main price is kept as an alternative.'));}
        api.renderDetail();
      }));
      if(focusIndex!=null)panel.querySelector(`[data-pd-opt-label="${focusIndex}"]`)?.focus();
    };
    // Boş satırlar atılır; fiyat yazılmışsa geçerli olmalıdır. Etiketsiz alternatif sırasıyla adlandırılır.
    const save=({render:rerender=true}={})=>{
      const options=[];
      for(const option of draft.options){
        const label=clean(option.label),price=clean(option.price),note=clean(option.note);
        if(!label&&!price&&!note)continue;
        if(price&&E.price(price)==null){toast(L(`Geçersiz fiyat: “${price}”. Sayı olarak yaz (ör. 4,15).`,`Invalid price: “${price}”. Enter a number (e.g. 4.15).`));return false;}
        options.push({id:option.id,label:label||L(`Opsiyon ${options.length+1}`,`Option ${options.length+1}`),price,note});
      }
      if(!api.saveLineOptions(req,line,{priceLabel:draft.priceLabel,priceNote:draft.priceNote,options}))return false;
      if(rerender){panel.hidden=true;state.focus={requestId:req.id,lineId:line.id,select:false};api.renderDetail();}
      return true;
    };
    panel.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();panel.hidden=true;}};
    render();panel.hidden=false;playPanel(panel);
    if(canEdit)panel.querySelector(draft.options.length===1&&!draft.options[0].label?'[data-pd-opt-label="0"]':'[data-pd-main-label]')?.focus();
  }
  function bindMatrix(host,req,matrix,candidates){
    const api=Q();
    host.querySelectorAll('.pdCellInput').forEach(input=>{
      input.addEventListener('focus',()=>{input.select();host.querySelectorAll('.pdFocusRow').forEach(el=>el.classList.remove('pdFocusRow'));input.closest('tr')?.classList.add('pdFocusRow');});
      input.addEventListener('change',()=>commitInput(host,req,input));
      input.addEventListener('blur',()=>commitInput(host,req,input));
      input.addEventListener('keydown',event=>{
        if(event.isComposing)return;
        const line=lineOf(req,input.dataset.pdInput);
        if(event.key==='Enter'||event.key==='ArrowDown'||event.key==='ArrowUp'){
          event.preventDefault();commitInput(host,req,input);
          moveFocus(host,input,(event.key==='ArrowUp'||(event.key==='Enter'&&event.shiftKey))?-1:1,0);return;
        }
        if(event.key==='Escape'){const v=E.price(line?.price);input.value=v!=null?moneyPlain(v):clean(line?.price);input.blur();return;}
        if((event.ctrlKey||event.metaKey)&&!event.shiftKey&&event.key.toLowerCase()==='z'){
          const v=E.price(line?.price);if(clean(input.value)===(v!=null?moneyPlain(v):clean(line?.price))){event.preventDefault();undoLast();}
          return;
        }
        if(event.ctrlKey||event.metaKey||event.altKey)return;
        const key=event.key.toLowerCase();
        if(key==='a'){event.preventDefault();commitInput(host,req,input);toggleApprove(host,req,line);return;}
        if(key==='d'){event.preventDefault();toggleDrop(host,req,line);return;}
        if(key==='o'){event.preventDefault();commitInput(host,req,input);openOptionsPanel(host,req,line);return;}
        if(key==='h'){event.preventDefault();openTab('history',{query:lineInfo(req,line).model});}
      });
      input.addEventListener('paste',event=>{const text=event.clipboardData?.getData('text/plain')||'';if(/[\t\n]/.test(text.replace(/\r?\n$/,''))){event.preventDefault();pasteBlock(host,req,input,text);}});
    });
    host.querySelectorAll('[data-pd-approve]').forEach(button=>button.addEventListener('click',()=>{const active=document.activeElement;if(active?.classList?.contains('pdCellInput'))commitInput(host,req,active);toggleApprove(host,req,lineOf(req,button.dataset.pdApprove));}));
    host.querySelectorAll('[data-pd-drop]').forEach(button=>button.addEventListener('click',()=>toggleDrop(host,req,lineOf(req,button.dataset.pdDrop))));
    host.querySelector('[data-pd-bulk]')?.addEventListener('click',()=>openBulk(host,req,candidates));
    host.querySelector('[data-pd-round]')?.addEventListener('click',()=>openRoundPanel(host,req));
    host.querySelector('[data-pd-add-mfr]')?.addEventListener('click',()=>openManufacturerPanel(host,req));
    // Hücre içi rozet/boş hücre düğmeleri kısmi yenilemede yeniden çizildiği için tablo kabında dinlenir.
    host.querySelector('.pdMatrixScroll')?.addEventListener('click',event=>{
      const optionButton=event.target.closest('[data-pd-options]');
      if(optionButton){event.preventDefault();const active=document.activeElement;if(active?.classList?.contains('pdCellInput'))commitInput(host,req,active);openOptionsPanel(host,req,lineOf(req,optionButton.dataset.pdOptions));return;}
      const addButton=event.target.closest('[data-pd-add-line]');
      if(addButton){event.preventDefault();addLineFor(host,req,addButton.dataset.pdAddLine,addButton.dataset.pdAddModel);}
    });
    host.querySelector('[data-pd-undo]')?.addEventListener('click',()=>undoLast());
    const fileInput=host.querySelector('[data-pd-import-file]');
    host.querySelector('[data-pd-import]')?.addEventListener('click',()=>fileInput?.click());
    fileInput?.addEventListener('change',()=>{const file=fileInput.files&&fileInput.files[0];fileInput.value='';if(file)void importSupplierWorkbook(host,req,file);});
    if(api.canEdit(req)){
      host.addEventListener('dragover',event=>{if([...(event.dataTransfer?.types||[])].includes('Files')){event.preventDefault();host.classList.add('pdDropActive');}});
      host.addEventListener('dragleave',event=>{if(!host.contains(event.relatedTarget))host.classList.remove('pdDropActive');});
      host.addEventListener('drop',event=>{const file=event.dataTransfer?.files&&event.dataTransfer.files[0];if(!file)return;event.preventDefault();host.classList.remove('pdDropActive');if(/\.xlsx?$/i.test(file.name))void importSupplierWorkbook(host,req,file);else toast(L('Yalnız Excel (.xlsx) dosyası içe aktarılabilir.','Only Excel (.xlsx) files can be imported.'));});
    }
  }

  /* ---------------- Üretici dönüş Excel'i ----------------
     Fiyat talep Excel'i Buyer Log tarafından üretilir; her satırda gizli bir
     satır anahtarı (BL Key = rowId) ve model adı bulunur. Üreticinin doldurduğu
     dosyada fiyat sütunu bulunur, satırlar anahtar (yoksa model adı / PLM ID)
     ile talepteki satıra eşlenir; önce fark gösterilir, onaysız yazılmaz. */
  async function readWorkbookRows(file,control={}){
    if(window.XLSX?.read){
      const wb=await window.BLFileParser.readWorkbook(file,{type:'array'},control);
      const sheet=wb.Sheets[wb.SheetNames[0]];
      return window.XLSX.utils.sheet_to_json(sheet,{header:1,raw:false,defval:''});
    }
    if(window.ExcelJS?.Workbook){
      const wb=new window.ExcelJS.Workbook();wb.model=await window.BLFileParser.readExcelJsModel(file,control);
      const ws=wb.worksheets[0],out=[];
      ws.eachRow({includeEmpty:false},row=>{const values=[];row.eachCell({includeEmpty:true},(cell,col)=>{const v=cell.value;values[col-1]=v&&typeof v==='object'?(v.result??v.text??(v.richText?v.richText.map(part=>part.text).join(''):'')):v;});out.push(values.map(value=>value==null?'':String(value)));});
      return out;
    }
    throw new Error(L('Excel okuyucu hazır değil.','Excel reader is not available.'));
  }
  // TR yerelinde "ID" → "ıd" olur; başlık eşlemesi noktasız ı'yı i'ye indirger.
  const headerKey=value=>clean(value).toLocaleLowerCase('tr-TR').replace(/ı/g,'i').replace(/\s+/g,' ');
  // Dosya adı karşılaştırması: Türkçe harfler ASCII'ye, alt çizgi/tire boşluğa indirgenir.
  const foldName=value=>clean(value).toLocaleLowerCase('tr-TR').replace(/ı/g,'i').replace(/ş/g,'s').replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ö/g,'o').replace(/ç/g,'c').replace(/[^a-z0-9]+/g,' ').trim();
  function findColumn(header,patterns){return header.findIndex(cell=>patterns.some(pattern=>pattern.test(headerKey(cell))));}
  function supplierWorkbookPlan(req,rows,manufacturerHint){
    const headerIndex=rows.findIndex(row=>row.some(cell=>/(model|plm|bl key)/i.test(clean(cell))));
    if(headerIndex<0)return {error:L('Excel’de model başlığı bulunamadı.','No model header was found in the Excel file.')};
    const header=rows[headerIndex];
    const keyCol=findColumn(header,[/^bl key$/,/^bl row$/]),plmCol=findColumn(header,[/^plm id$/,/^plm$/]),modelCol=findColumn(header,[/^model name$/,/^model$/,/^model adi$/,/^model kodu$/]);
    let priceCol=findColumn(header,[/^(fob|quotation|offer|teklif|fiyat|price)( price| fiyati| fiyat)?( \(usd\)| usd| \$)?$/,/^supplier (fob|price)$/,/^üretici fiyati$/,/quotation price/]);
    if(priceCol<0)priceCol=header.findIndex(cell=>/price|fiyat|fob/i.test(clean(cell))&&!/target|hedef/i.test(clean(cell)));
    if(priceCol<0)return {error:L('Excel’de fiyat sütunu bulunamadı (ör. “Quotation Price”, “FOB”, “Fiyat”).','No price column was found (e.g. “Quotation Price”, “FOB”, “Price”).')};
    const manufacturers=[...new Set((req.items||[]).map(item=>clean(item.manufacturer)).filter(Boolean))];
    const hint=` ${foldName(manufacturerHint)} `;
    let manufacturer=manufacturers.find(name=>foldName(name)&&hint.includes(` ${foldName(name)} `))||'';
    if(!manufacturer&&manufacturers.length===1)manufacturer=manufacturers[0];
    const changes=[],unmatched=[],used=new Set();let same=0,invalid=0;
    const lower=value=>clean(value).toLocaleLowerCase('tr-TR');
    const own=(req.items||[]).filter(item=>clean(item.manufacturer)===manufacturer);
    rows.slice(headerIndex+1).forEach(row=>{
      const raw=clean(row[priceCol]);if(!raw)return;
      const value=E.price(raw);if(value==null){invalid++;return;}
      const key=keyCol>=0?clean(row[keyCol]):'',plm=plmCol>=0?clean(row[plmCol]):'',model=modelCol>=0?clean(row[modelCol]):'';
      /* Eşleme önceliği: satır anahtarı (BL Key) varsa YALNIZ ona bakılır; yoksa
         PLM ID, sonra model kodu. Aynı modelin birden çok renk satırı varsa PLM /
         model kodu belirsizdir: tek aday yoksa satır eşleşmemiş sayılır, bir
         talep satırına iki kez fiyat yazılmaz. */
      let candidates=key?own.filter(item=>String(item.rowId)===key):[];
      if(!key&&plm)candidates=own.filter(item=>lower(item.plmId)===lower(plm));
      if(!key&&!candidates.length&&model)candidates=own.filter(item=>lower(item.modelCode)===lower(model));
      const line=candidates.length===1&&!used.has(candidates[0].id)?candidates[0]:null;
      if(!line){unmatched.push(model||plm||key||'—');return;}
      used.add(line.id);
      const before=E.price(line.price);
      if(before!=null&&Math.abs(before-value)<0.00005){same++;return;}
      changes.push({line,before,value});
    });
    return {manufacturer,manufacturers,changes,unmatched,same,invalid};
  }
  const supplierReaders=new WeakMap();
  async function importSupplierWorkbook(host,req,file){
    const panel=host.querySelector('[data-pd-import-panel]');if(!panel)return;
    supplierReaders.get(host)?.abort();const reader=new AbortController();supplierReaders.set(host,reader);
    let rows;
    try{rows=await readWorkbookRows(file,{signal:reader.signal});}catch(err){if(err.code!=='FILE_PARSE_CANCELLED')toast(err?.message||L('Excel okunamadı.','Excel could not be read.'));return;}
    if(reader.signal.aborted||!host.isConnected||!panel.isConnected)return;
    let retryKeys=null;
    const render=manufacturerName=>{
      const plan=supplierWorkbookPlan(req,rows,manufacturerName||file.name);
      if(retryKeys&&plan.changes)plan.changes=plan.changes.filter(change=>retryKeys.has(change.line.id));
      if(plan.error){panel.innerHTML=`<div class="pdPanelHead"><b>${esc(file.name)}</b><span class="isBad">${esc(plan.error)}</span></div><div class="pdPanelActions"><button type="button" class="tbtn" data-pd-import-cancel>${esc(L('Kapat','Close'))}</button></div>`;}
      else{
        const picker=plan.manufacturers.length>1?`<label class="pdField isInline"><span>${esc(L('Üretici','Manufacturer'))}</span><select data-pd-import-mfr>${plan.manufacturers.map(name=>`<option value="${esc(name)}"${name===plan.manufacturer?' selected':''}>${esc(name)}</option>`).join('')}</select></label>`:'';
        panel.innerHTML=`<div class="pdPanelHead"><b>${esc(L('Dönüş Excel’i önizlemesi','Supplier Excel preview'))} · ${esc(file.name)}</b><span>${esc(L(`${plan.changes.length} değişiklik · ${plan.same} aynı · ${plan.unmatched.length} eşleşmeyen satır`,`${plan.changes.length} changes · ${plan.same} unchanged · ${plan.unmatched.length} unmatched rows`))}</span>${picker}</div>
          ${plan.manufacturer?'':`<div class="pdPanelNote isBad">${esc(L('Dosyanın hangi üreticiye ait olduğu seçilmeli.','Choose which manufacturer this file belongs to.'))}</div>`}
          <div class="pdPanelList">${plan.changes.map(change=>{const info=lineInfo(req,change.line);return `<div class="pdPanelRow">${thumbHtml(req,change.line,'pdThumb isSmall')}<b>${esc(info.model)}</b><span>${esc(change.line.manufacturer)}</span><s class="pdNum">${esc(change.before!=null?money(change.before):'—')}</s><b class="pdNum isGood">${esc(money(change.value))}</b></div>`;}).join('')||`<div class="pricingEmptyState">${esc(L('Uygulanacak yeni fiyat yok.','No new prices to apply.'))}</div>`}</div>
          ${plan.unmatched.length?`<div class="pdPanelNote">${esc(L('Eşleşmeyen: ','Unmatched: '))}${esc(plan.unmatched.slice(0,8).join(', '))}${plan.unmatched.length>8?'…':''}</div>`:''}
          <div class="pdPanelActions"><button type="button" class="tbtn" data-pd-import-cancel>${esc(L('Vazgeç','Cancel'))}</button><button type="button" class="tbtn primary" data-pd-import-apply ${plan.changes.length?'':'disabled'}>${esc(L(`${plan.changes.length} fiyatı uygula`,`Apply ${plan.changes.length} prices`))}</button></div>`;
        panel.querySelector('[data-pd-import-mfr]')?.addEventListener('change',event=>render(event.target.value));
        const previewUser=Q()?.currentUserId(),previewOwner=req.ownerId,baseline=new Map(plan.changes.map(change=>[change.line.id,JSON.stringify(change.line)]));
        panel.querySelector('[data-pd-import-apply]')?.addEventListener('click',async event=>{
          event.currentTarget.disabled=true;
          const api=Q(),items=plan.changes.map(change=>({key:change.line.id,label:lineInfo(req,change.line).model+' · '+change.line.manufacturer,before:change.before==null?'—':money(change.before),after:money(change.value)}));
          const guard=()=>!reader.signal.aborted&&api.currentUserId()===previewUser&&api.canEdit(req)&&req.ownerId===previewOwner&&plan.changes.every(change=>JSON.stringify(api.requests().find(item=>item.id===req.id)?.items.find(item=>item.id===change.line.id))===baseline.get(change.line.id));
          const spec={module:'supplier-prices',owner:previewOwner,items,expected:{lines:Object.fromEntries(plan.changes.map(change=>[change.line.id,change.line.rev||0]))},title:L('Üretici fiyatlarını kaydet','Save supplier prices'),counts:{skipped:plan.unmatched.length,invalid:plan.invalid,readonly:api.canEdit(req)?0:items.length},guard,
            async send(){
              const entries=plan.changes.map(change=>({lineId:change.line.id,prev:snapshot(change.line)}));
              const data=await api.applyPricesBatch(req.id,plan.changes.map(change=>({lineId:change.line.id,baseRev:change.line.rev||0,price:moneyPlain(change.value)})));
              state.undo.push({requestId:req.id,entries,label:'import',bulkGuard:{user:previewUser,owner:previewOwner,revisions:Object.fromEntries((data.request?.items||[]).map(item=>[item.id,item.rev||0]))}});
              panel.hidden=true;api.renderDetail();return data;
            },
            async retry(keys){await api.hydrate(true);if(reader.signal.aborted)return null;const current=api.requests().find(item=>item.id===req.id);if(current){req=current;retryKeys=new Set(keys);render(plan.manufacturer);}return null;}
          };
          await window.BLBulkOperations.run(spec);
          if(panel.isConnected)panel.querySelector('[data-pd-import-apply]')?.removeAttribute('disabled');
        });
      }
      panel.querySelector('[data-pd-import-cancel]')?.addEventListener('click',()=>{reader.abort();panel.hidden=true;});
      panel.hidden=false;bindThumbs(panel);
    };
    render('');
  }

  /* ================= SHELL ================= */
  const TAB_LABELS={desk:['Masa','Desk'],rounds:['Turlar','Rounds'],history:['Geçmiş','History'],analysis:['Analiz','Analysis']};
  const TAB_ICONS={desk:'i-table',rounds:'i-layout-dashboard',history:'i-chart-histogram',analysis:'i-chart-bar'};
  function shellHtml(tab){
    return `<div class="pdShell">
      <div class="pdTopBar">
        <nav class="pdTabs" role="tablist" aria-label="${esc(L('Fiyat Masası','Pricing Desk'))}">${TABS.map(key=>`<button type="button" role="tab" data-pd-tab="${key}" aria-selected="${key===tab?'true':'false'}" class="${key===tab?'isActive':''}"><svg class="ic" aria-hidden="true"><use href="#${TAB_ICONS[key]}"/></svg>${esc(L(...TAB_LABELS[key]))}</button>`).join('')}</nav>
        <span class="pdBarSpacer"></span>
        <div class="pdScope"><button type="button" class="tbtn" data-pd-scope aria-haspopup="dialog"><svg class="ic" aria-hidden="true"><use href="#i-users-group"/></svg><span>${esc(L('Buyer','Buyer'))}:</span> <b>${esc(scopeLabel())}</b><svg class="ic" aria-hidden="true"><use href="#i-chevron-down"/></svg></button><div class="pdScopePanel" data-pd-scope-panel hidden></div></div>
      </div>
      <div class="pdBody" data-pd-body></div>
    </div>`;
  }
  function scopePanelHtml(){
    const owners=availableOwners(),ids=scopeOwnerIds();
    return `<div class="pdPanelHead"><b>${esc(L('Buyer kapsamı','Buyer scope'))}</b><span>${esc(L('Yetkiniz olan buyer’ların fiyat çalışmalarını tek ekranda birlikte görün. Düzenleme yetkisi değişmez.','See the pricing work of buyers you have access to on one screen. Editing rights do not change.'))}</span></div>
      <label class="pdCheck"><input type="checkbox" data-pd-scope-all ${state.scope.all?'checked':''}><span>${esc(L('Tüm erişilebilir buyer’lar','All accessible buyers'))}</span></label>
      <div class="pdScopeList">${owners.map(owner=>`<label class="pdCheck"><input type="checkbox" value="${esc(owner.id)}" data-pd-scope-owner ${state.scope.all||ids.has(owner.id)?'checked':''} ${state.scope.all?'disabled':''}><span>${esc(owner.name)}</span><small>${esc(L(`${owner.count} talep`,`${owner.count} requests`))}</small></label>`).join('')}</div>
      <div class="pdPanelActions"><button type="button" class="tbtn" data-pd-scope-mine>${esc(L('Yalnız ben','Only me'))}</button><button type="button" class="tbtn primary" data-pd-scope-apply>${esc(L('Uygula','Apply'))}</button></div>`;
  }
  function bindShell(host){
    host.querySelectorAll('[data-pd-tab]').forEach(button=>button.addEventListener('click',()=>{Q()?.commitActive?.(host);openTab(button.dataset.pdTab);}));
    const panel=host.querySelector('[data-pd-scope-panel]'),toggle=host.querySelector('[data-pd-scope]');
    toggle?.addEventListener('click',event=>{
      event.stopPropagation();
      if(!panel.hidden){panel.hidden=true;return;}
      panel.innerHTML=scopePanelHtml();panel.hidden=false;
      const all=panel.querySelector('[data-pd-scope-all]');
      all?.addEventListener('change',()=>panel.querySelectorAll('[data-pd-scope-owner]').forEach(box=>{box.disabled=all.checked;if(all.checked)box.checked=true;}));
      panel.querySelector('[data-pd-scope-mine]')?.addEventListener('click',()=>{panel.hidden=true;setScope({all:false,ownerIds:[me()]});});
      panel.querySelector('[data-pd-scope-apply]')?.addEventListener('click',()=>{
        const ids=[...panel.querySelectorAll('[data-pd-scope-owner]:checked')].map(box=>box.value);
        panel.hidden=true;setScope({all:!!all?.checked,ownerIds:ids.length?ids:[me()]});
      });
    });
  }
  // Kapsam paneli dışına tıklanınca kapanır (tek, kalıcı dinleyici).
  document.addEventListener('mousedown',event=>{
    document.querySelectorAll('[data-pd-scope-panel]').forEach(panel=>{
      if(panel.hidden)return;
      const scope=panel.closest('.pdScope');
      if(scope&&!scope.contains(event.target))panel.hidden=true;
    });
  },{capture:true});
  async function mount(host,{tab}={}){
    const api=Q();if(!host||!api)return false;
    await api.ready();await api.hydrate(true);
    if(tab&&TABS.includes(tab))state.tab=tab;
    state.hosts.add(host);host.dataset.pdMounted='1';
    renderHost(host);
    void loadOwnerRows().then(changed=>{if(changed)renderHost(host);});
    return true;
  }
  function renderHost(host){
    if(!host||!host.isConnected)return;
    infoCache=new WeakMap();
    host.innerHTML=shellHtml(state.tab);
    bindShell(host);
    const body=host.querySelector('[data-pd-body]');
    body.classList.add('pdViewIn');
    // Klavyeyle seçilebilen kartlar/hücreler (role=button, tabindex=0) Enter/Space ile açılır.
    body.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&event.target.matches?.('[data-pd-acell],[data-pd-asupplier],[data-pd-req]')){event.preventDefault();event.target.click();}});
    if(state.tab==='desk')void Q().mountWorkspace(body,{source:'collection',preserveContext:true});
    else if(state.tab==='rounds')renderRounds(body);
    else if(state.tab==='history')renderHistory(body);
    else renderAnalysis(body);
  }
  function renderAllHosts(){[...state.hosts].forEach(host=>{if(!host.isConnected){state.hosts.delete(host);return;}if(host.offsetParent!==null||host.closest('section')?.classList.contains('active'))renderHost(host);});}
  function openTab(tab,options={}){
    if(!TABS.includes(tab))return;
    state.tab=tab;store.set(TAB_KEY,tab);
    if(tab==='history'&&options.query!=null){state.history.query=clean(options.query);state.history.view='models';store.set(HISTORY_KEY,historyPrefs());}
    const active=typeof currentActiveTab==='function'?currentActiveTab():document.body?.dataset?.activeTab;
    if(active!=='quotations'&&active!=='pricinghistory'&&typeof switchTab==='function'){switchTab('quotations');return;}
    renderAllHosts();
  }

  /* ================= TURLAR ================= */
  const LANES=[['sent','Gönderildi','Sent'],['waiting','Teklif bekleniyor','Awaiting quotes'],['compare','Karşılaştırma','Comparing'],['approved','Onaylandı','Approved'],['closed','Kapandı','Closed']];
  function renderRounds(body){
    const api=Q(),requests=scopedRequests('collection').slice().sort((a,b)=>String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt)));
    const multi=scopeIsMulti();
    if(!state.roundsSelected||!requests.some(req=>req.id===state.roundsSelected))state.roundsSelected=requests.find(req=>E.lane(req)==='compare')?.id||requests[0]?.id||'';
    const lanes=LANES.map(([key,tr,en])=>{
      const list=requests.filter(req=>E.lane(req)===key);
      return `<section class="pdLane" data-lane="${key}"><div class="pdLaneHead"><b>${esc(L(tr,en))}</b><span>${list.length}</span></div><div class="pdLaneBody">${list.slice(0,key==='closed'?12:40).map(req=>roundCardHtml(req,multi)).join('')||`<div class="pdLaneEmpty">${esc(L('Kayıt yok','No records'))}</div>`}${key==='closed'&&list.length>12?`<div class="pdLaneEmpty">${esc(L(`+${list.length-12} kapalı talep`,`+${list.length-12} closed requests`))}</div>`:''}</div></section>`;
    }).join('');
    const selected=requests.find(req=>req.id===state.roundsSelected)||null;
    body.innerHTML=`<div class="pdRoundsGrid"><div class="pdBoard">${lanes}</div><aside class="pdRoundsPanel" aria-live="polite">${selected?roundsPanelHtml(selected):`<div class="pricingEmptyState">${esc(L('Kapsamda fiyat talebi yok.','No pricing requests in scope.'))}</div>`}</aside></div>`;
    body.querySelectorAll('[data-pd-req]').forEach(card=>card.addEventListener('click',event=>{if(event.target.closest('[data-pd-remind]'))return;state.roundsSelected=card.dataset.pdReq;renderRounds(body);}));
    body.querySelectorAll('[data-pd-remind]').forEach(button=>button.addEventListener('click',event=>{event.stopPropagation();const req=api.requests().find(item=>item.id===button.dataset.pdRemind);if(req)api.reminder(req);}));
    body.querySelector('[data-pd-open-desk]')?.addEventListener('click',event=>{api.selectRequest(event.currentTarget.dataset.pdOpenDesk);api.setStatusFilter('all');openTab('desk');});
    body.querySelector('[data-pd-new-round]')?.addEventListener('click',async event=>{const req=api.requests().find(item=>item.id===event.currentTarget.dataset.pdNewRound);if(!req)return;event.currentTarget.disabled=true;const saved=await api.startRound(req,'');if(saved){toast(L(`Tur ${saved.round} başladı.`,`Round ${saved.round} started.`));renderRounds(body);}});
    bindThumbs(body);
  }
  function roundCardHtml(req,multi){
    const api=Q(),rates=E.responseRates(req),priced=rates.reduce((a,r)=>a+r.priced,0),total=rates.reduce((a,r)=>a+r.total,0),rate=total?Math.round(priced/total*100):0;
    const waiting=rates.filter(r=>r.priced<r.total).length,gain=E.requestGain(req),models=new Set((req.items||[]).map(item=>item.modelKey)).size,round=Math.max(1,Number(req.round)||1);
    const canEdit=api.canEdit(req);
    return `<div role="button" tabindex="0" class="pdCard${req.id===state.roundsSelected?' isActive':''}" data-pd-req="${esc(req.id)}">
      <div class="pdCardHead"><div><b title="${esc(api.workspaceTitle(req))}">${esc(api.workspaceTitle(req))}</b><span>${esc(api.date(req.createdAt,false))} · ${esc(L(`${models} model`,`${models} models`))}${round>1?` · ${esc(L(`Tur ${round}`,`Round ${round}`))}`:''}</span></div><span class="pdRing isLarge" style="--pd-rate:${rate}%" title="${esc(L(`${priced}/${total} satır fiyatlı`,`${priced}/${total} lines priced`))}" aria-hidden="true"></span></div>
      ${multi||clean(req.ownerId)!==me()?`<span class="pdOwnerChip">${esc(api.ownerLabel(req))}</span>`:''}
      <div class="pdCardChips">${rates.slice(0,6).map(r=>`<span class="pdMiniChip${r.approved?' isApproved':r.priced===r.total?' isDone':r.priced?' isPartial':''}" title="${esc(r.name)}">${esc(r.name.length>14?r.name.slice(0,13)+'…':r.name)} ${r.priced}/${r.total}</span>`).join('')}</div>
      <div class="pdCardFoot">${gain&&Number.isFinite(gain.gainPct)&&Math.abs(gain.gainPct)>=0.05?`<span class="pdChip ${toneOf(gain.gainPct)}">${esc(L('Pazarlık','Negotiation'))} ${esc(pctText(gain.gainPct))}</span>`:'<span></span>'}${canEdit&&waiting&&req.status!=='closed'?`<button type="button" class="tbtn sm" data-pd-remind="${esc(req.id)}"><svg class="ic" aria-hidden="true"><use href="#i-bell"/></svg>${esc(L(`Hatırlat (${waiting})`,`Remind (${waiting})`))}</button>`:''}</div>
    </div>`;
  }
  function roundOffersHtml(req,round,byLine){
    const groups=new Map();
    round.offers.forEach(offer=>{const line=byLine.get(offer.lineId),key=line?.modelKey||offer.lineId;if(!groups.has(key))groups.set(key,{line,offers:[]});groups.get(key).offers.push(offer);});
    return [...groups.values()].map(({line,offers})=>{const info=line?lineInfo(req,line):{model:'—'},prices=offers.map(o=>o.price).filter(Number.isFinite),best=prices.length?Math.min(...prices):null;
      return `<div class="pdRoundModelGroup"><div class="pdRoundModelHead">${line?thumbHtml(req,line,'pdThumb isSmall'):''}<b>${esc(info.model)}</b><span>${esc(L('En iyi','Best'))} ${esc(money(best))}</span></div><div class="pdRoundChips">${offers.map(offer=>{const change=offer.previous!=null&&offer.price!=null?E.pct(offer.price,offer.previous):null;return `<span class="pdRoundQuote${offer.price===best?' isBest':''}" title="${esc(change==null?'':pctText(change))}"><b>${esc(offer.manufacturer)}</b>${offer.previous!=null?`<s>${esc(moneyPlain(offer.previous))}</s>`:''}<strong>${offer.price!=null?esc(money(offer.price)):esc(L('geri çekildi','withdrawn'))}</strong>${change!=null?`<small class="${toneOf(change)}">${esc(pctText(change))}</small>`:''}</span>`;}).join('')}</div></div>`;
    }).join('')||`<div class="pdLaneEmpty">${esc(L('Bu turda henüz teklif yok.','No offers in this round yet.'))}</div>`;
  }
  function roundsPanelHtml(req){
    const api=Q(),rounds=E.rounds(req),gain=E.requestGain(req),byLine=new Map((req.items||[]).map(item=>[item.id,item]));
    const list=rounds.slice().reverse().map(round=>`<div class="pdRound">
      <div class="pdRoundHead"><i class="pdRoundDot${round.n===Math.max(1,Number(req.round)||1)?' isCurrent':''}" aria-hidden="true"></i><b>${esc(L(`Tur ${round.n}`,`Round ${round.n}`))}</b><span>${esc(round.at?dateText(round.at):'')}${round.byName?` · ${esc(round.byName)}`:''}</span></div>
      ${round.note?`<div class="pdRoundNote">${esc(round.note)}</div>`:''}
      <div class="pdRoundOffers">${roundOffersHtml(req,round,byLine)}</div>
    </div>`).join('');
    return `<div class="pdPanelHead"><b>${esc(api.workspaceTitle(req))}</b><span>${esc(api.ownerLabel(req))} · ${esc(api.date(req.createdAt,false))}</span></div>
      ${gain?`<div class="pdGain"><div><span>${esc(L('İlk tur ort. en iyi','First-round avg best'))}</span><b>${esc(money(gain.firstAvg))}</b></div><div><span>${esc(L('Güncel ort.','Current avg'))}</span><b>${esc(money(gain.currentAvg))}</b></div><div><span>${esc(L('Kazanım','Gain'))}</span><b class="${toneOf(gain.gainPct)}">${esc(pctText(gain.gainPct))}</b></div></div>`:''}
      <div class="pdPanelActions"><button type="button" class="tbtn primary" data-pd-open-desk="${esc(req.id)}"><svg class="ic" aria-hidden="true"><use href="#i-table"/></svg>${esc(L('Masada aç','Open in Desk'))}</button>${api.canEdit(req)&&req.status!=='closed'?`<button type="button" class="tbtn" data-pd-new-round="${esc(req.id)}"><svg class="ic" aria-hidden="true"><use href="#i-refresh"/></svg>${esc(L('Yeni tur başlat','Start new round'))}</button>`:''}</div>
      <div class="pdRoundList">${list}</div>`;
  }

  /* ================= GEÇMİŞ ================= */
  function historyPrefs(){return {view:state.history.view,query:state.history.query,filters:state.history.filters,limit:48};}
  /* Koleksiyon'dan "Fiyat Geçmişi" ile açıldığında yalnız seçili modeller gösterilir. */
  function setHistoryContext(rows){
    const loadedOwner=typeof kolWorkspaceOwnerId!=='undefined'?clean(kolWorkspaceOwnerId):me();
    const keys=(Array.isArray(rows)?rows:[]).filter(Boolean).map(row=>`${clean(row._collectionOwnerId)||loadedOwner}|kol:${row._collectionSourceId??row.id}`);
    state.history.context=keys.length?keys:null;state.history.view='models';state.history.query='';state.history.selected=keys.length===1?keys[0]:'';
    state.tab='history';
  }
  function historyEvents(){
    const out=[],context=Array.isArray(state.history.context)&&state.history.context.length?new Set(state.history.context):null;
    scopedRequests('collection').forEach(req=>(req.items||[]).forEach(line=>{
      if(line.dropped)return;
      if(context&&!context.has(`${clean(req.ownerId)}|${clean(line.modelKey)}`))return;
      const info=lineInfo(req,line);
      E.offers(line,req).forEach(event=>{
        if(event.value==null)return;
        out.push({identityKey:`${clean(req.ownerId)}|${clean(line.modelKey)}`,modelKey:line.modelKey,model:info.model,plmId:info.plmId,image:info.image,colourCode:info.colourCode,colour:info.colour,manufacturer:clean(line.manufacturer),value:event.value,at:event.at,round:event.round||1,approved:!!line.approved,target:info.target,
          classification:info.classification,season:info.season||'—',buyer:info.buyer,requestId:req.id,itemId:line.id,byName:clean(event.byName),source:event.source||'manual',req,line});
      });
    }));
    return out;
  }
  const SERIES_CLASSES=['pdS0','pdS1','pdS2','pdS3','pdS4','pdS5'];
  function seriesChart(model){
    const all=model.series.flatMap(entry=>entry.points);
    const times=all.map(point=>Date.parse(point.at)).filter(Number.isFinite);
    const values=all.map(point=>point.value).concat(model.target!=null?[model.target]:[]);
    let lo=Math.min(...values),hi=Math.max(...values);if(hi-lo<0.01){lo-=0.5;hi+=0.5;}
    const pad=(hi-lo)*0.12;lo-=pad;hi+=pad;
    const t0=Math.min(...times),t1=Math.max(...times),W=300,H=96,P=8;
    const x=at=>{const t=Date.parse(at);return t1>t0?P+(t-t0)/(t1-t0)*(W-2*P):W/2;};
    const y=v=>H-P-(v-lo)/(hi-lo)*(H-2*P);
    const lines=model.series.map((entry,index)=>{
      const cls=SERIES_CLASSES[index%SERIES_CLASSES.length],pts=entry.points.map(point=>`${x(point.at).toFixed(1)},${y(point.value).toFixed(1)}`).join(' ');
      const last=entry.points[entry.points.length-1];
      return `<polyline class="pdSeries ${cls}" points="${pts}"/>${entry.points.map(point=>`<rect class="pdDot ${cls}" x="${(x(point.at)-(point===last?3.4:2.2)).toFixed(1)}" y="${(y(point.value)-(point===last?3.4:2.2)).toFixed(1)}" width="${point===last?6.8:4.4}" height="${point===last?6.8:4.4}"><title>${esc(`${entry.manufacturer} · ${dateText(point.at)} · ${money(point.value)} · ${L('Tur','Round')} ${point.round}`)}</title></rect>`).join('')}`;
    }).join('');
    const target=model.target!=null?`<line class="pdTargetLine" x1="0" x2="${W}" y1="${y(model.target).toFixed(1)}" y2="${y(model.target).toFixed(1)}"/>`:'';
    return `<svg class="pdChart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(L(`${model.model} fiyat trendi`,`${model.model} price trend`))}">${target}${lines}</svg>`;
  }
  function renderHistory(body){
    const view=state.history.view==='records'?'records':'models';
    body.innerHTML=`<div class="pdHistory"><div class="pdSubBar"><div class="pdSeg" role="group" aria-label="${esc(L('Geçmiş görünümü','History view'))}"><button type="button" data-pd-hview="models" class="${view==='models'?'isActive':''}" aria-pressed="${view==='models'}">${esc(L('Modeller','Models'))}</button><button type="button" data-pd-hview="records" class="${view==='records'?'isActive':''}" aria-pressed="${view==='records'}">${esc(L('Kayıt tablosu','Records table'))}</button></div><div class="pdSubTools" data-pd-htools></div></div><div class="pdHistoryBody" data-pd-hbody></div></div>`;
    body.querySelectorAll('[data-pd-hview]').forEach(button=>button.addEventListener('click',()=>{state.history.view=button.dataset.pdHview;store.set(HISTORY_KEY,historyPrefs());renderHistory(body);}));
    const host=body.querySelector('[data-pd-hbody]');
    if(view==='records'){void Q().mountHistoryTable(host,{preserveContext:true});return;}
    renderHistoryModels(body,host);
  }
  function renderHistoryModels(body,host){
    const events=historyEvents(),tools=body.querySelector('[data-pd-htools]');
    const dims=[['classification','Klasman','Classification'],['manufacturer','Üretici','Manufacturer'],['season','Sezon','Season'],...(scopeIsMulti()?[['buyer','Buyer','Buyer']]:[])];
    const filters=state.history.filters||{};
    const contextCount=Array.isArray(state.history.context)?state.history.context.length:0;
    tools.innerHTML=`${contextCount?`<span class="pdContextChip">${esc(L(`Koleksiyon seçimi: ${contextCount} model`,`Collection selection: ${contextCount} models`))}<button type="button" class="linkBtn" data-pd-hcontext-clear>${esc(L('Tümünü göster','Show all'))}</button></span>`:''}<label class="pdSearch"><svg class="ic" aria-hidden="true"><use href="#i-search"/></svg><span class="pdSr">${esc(L('Model ara','Search model'))}</span><input type="search" data-pd-hsearch value="${esc(state.history.query)}" placeholder="${esc(L('Model, PLM ID veya üretici ara…','Search model, PLM ID or manufacturer…'))}"></label>${dims.map(([dim,tr,en])=>`<label class="pdField isInline"><span class="pdSr">${esc(L(tr,en))}</span><select data-pd-hfilter="${dim}"><option value="">${esc(L(`Tüm ${tr.toLocaleLowerCase('tr-TR')}`,`All ${en.toLowerCase()}`))}</option>${E.dimensionValues(events,dim).map(item=>`<option value="${esc(item.label)}"${(filters[dim]||[])[0]===item.label?' selected':''}>${esc(item.label)}</option>`).join('')}</select></label>`).join('')}`;
    const query=clean(state.history.query).toLocaleLowerCase('tr-TR');
    const filtered=E.filterObservations(events,filters).filter(event=>!query||`${event.model} ${event.plmId} ${event.manufacturer} ${event.classification}`.toLocaleLowerCase('tr-TR').includes(query));
    const series=E.historySeries(filtered);
    const limit=Math.max(12,Number(state.history.limit)||48);
    const selected=series.find(model=>model.identityKey===state.history.selected)||null;
    const totalModels=series.length,rounds=new Set(filtered.map(event=>`${event.requestId}|${event.round}`)).size;
    const improving=series.filter(model=>Number.isFinite(model.trendPct)&&model.trendPct<0);
    host.innerHTML=`<div class="pdKpis"><div class="pricingMetric isHistory"><span>${esc(L('Model','Models'))}</span><b>${totalModels}</b></div><div class="pricingMetric isHistory"><span>${esc(L('Teklif olayı','Offer events'))}</span><b>${filtered.length}</b></div><div class="pricingMetric isHistory"><span>${esc(L('Tur','Rounds'))}</span><b>${rounds}</b></div><div class="pricingMetric isHistory"><span>${esc(L('Pazarlıkla düşen','Lowered by negotiation'))}</span><b>${improving.length}</b></div><div class="pricingMetric isHistory"><span>${esc(L('Ort. tur kazancı','Avg negotiation gain'))}</span><b>${esc(pctText(E.mean(improving.map(model=>model.trendPct))))}</b></div></div>
      <div class="pdHistoryGrid"><div class="pdCards">${series.slice(0,limit).map((model,index)=>historyCardHtml(model,index)).join('')||`<div class="pricingEmptyState">${esc(L('Bu filtrelerde fiyat geçmişi yok.','No pricing history for these filters.'))}</div>`}${series.length>limit?`<button type="button" class="tbtn pdMore" data-pd-more>${esc(L(`${series.length-limit} model daha göster`,`Show ${series.length-limit} more models`))}</button>`:''}</div>
      <aside class="pdHistoryDetail" aria-live="polite">${selected?historyDetailHtml(selected):`<div class="pricingEmptyState">${esc(L('Ayrıntı ve tur kayıtları için bir model kartı seç.','Select a model card for details and round records.'))}</div>`}</aside></div>`;
    tools.querySelector('[data-pd-hcontext-clear]')?.addEventListener('click',()=>{state.history.context=null;renderHistoryModels(body,host);});
    tools.querySelector('[data-pd-hsearch]')?.addEventListener('input',event=>{state.history.query=event.target.value;clearTimeout(renderHistoryModels._t);renderHistoryModels._t=setTimeout(()=>{store.set(HISTORY_KEY,historyPrefs());renderHistoryModels(body,host);const input=body.querySelector('[data-pd-hsearch]');if(input){input.focus();input.setSelectionRange(input.value.length,input.value.length);}},160);});
    tools.querySelectorAll('[data-pd-hfilter]').forEach(select=>select.addEventListener('change',()=>{const next={...(state.history.filters||{})};if(select.value)next[select.dataset.pdHfilter]=[select.value];else delete next[select.dataset.pdHfilter];state.history.filters=next;store.set(HISTORY_KEY,historyPrefs());renderHistoryModels(body,host);}));
    host.querySelectorAll('[data-pd-hcard]').forEach(card=>card.addEventListener('click',()=>{state.history.selected=card.dataset.pdHcard;renderHistoryModels(body,host);}));
    host.querySelector('[data-pd-more]')?.addEventListener('click',()=>{state.history.limit=limit+48;renderHistoryModels(body,host);});
    host.querySelector('[data-pd-benchmark]')?.addEventListener('click',event=>{const event0=filtered.find(item=>`${item.requestId}:${item.itemId}`===event.currentTarget.dataset.pdBenchmark);if(event0)Q().applyBenchmark({requestId:event0.requestId,itemId:event0.itemId,price:event0.value,model:event0.model});});
    host.querySelectorAll('[data-pd-open-req]').forEach(button=>button.addEventListener('click',()=>{const api=Q();api.selectRequest(button.dataset.pdOpenReq);api.setStatusFilter('all');openTab('desk');}));
    bindThumbs(host);
  }
  function historyCardHtml(model,index){
    const first=model.events[0],req=first.req,line=first.line;
    const legend=model.series.map((entry,i)=>{const last=entry.points[entry.points.length-1];return `<span class="pdLegendItem"><i class="${SERIES_CLASSES[i%SERIES_CLASSES.length]}"></i>${esc(entry.manufacturer)} <b>${esc(moneyPlain(last.value))}</b></span>`;}).join('');
    return `<button type="button" class="pdHCard${model.identityKey===state.history.selected?' isActive':''}" data-pd-hcard="${esc(model.identityKey)}" style="--pd-delay:${Math.min(index,16)*30}ms">
      <div class="pdHCardHead">${thumbHtml(req,line)}<div class="pdHCardText"><b>${esc(model.model)}</b><span>${esc(first.classification)}${scopeIsMulti()?` · ${esc(first.buyer)}`:''}</span></div><div class="pdHCardValue"><b>${esc(money(model.latestBest))}</b><span class="pdChip ${toneOf(model.trendPct)}">${esc(pctText(model.trendPct))}</span></div></div>
      ${seriesChart(model)}
      <div class="pdLegendRow">${legend}${model.target!=null?`<span class="pdLegendItem isTarget"><i></i>${esc(L('Hedef','Target'))} <b>${esc(moneyPlain(model.target))}</b></span>`:''}</div>
    </button>`;
  }
  function historyDetailHtml(model){
    const first=model.events[0],events=model.events.slice().sort((a,b)=>String(b.at).localeCompare(String(a.at)));
    const latestBest=events.filter(event=>event.value===model.latestBest)[0];
    return `<div class="pdPanelHead"><div class="pdHDetailHead">${thumbHtml(first.req,first.line,'pdThumb isLarge')}<div><b>${esc(model.model)}</b><span>${esc(first.classification)} · ${esc(first.season)}</span><span>${esc(first.buyer)}</span></div></div></div>
      <dl class="pricingDecisionStats"><div><dt>${esc(L('İlk tur en iyi','First-round best'))}</dt><dd>${esc(money(model.firstBest))}</dd></div><div><dt>${esc(L('Güncel en iyi','Current best'))}</dt><dd>${esc(money(model.latestBest))}</dd></div><div><dt>${esc(L('Değişim','Change'))}</dt><dd class="${toneOf(model.trendPct)}">${esc(pctText(model.trendPct))}</dd></div><div><dt>${esc(L('Hedef','Target'))}</dt><dd>${esc(money(model.target))}</dd></div></dl>
      <div class="pdPanelActions">${latestBest?`<button type="button" class="tbtn" data-pd-benchmark="${esc(`${latestBest.requestId}:${latestBest.itemId}`)}">${esc(L('Hedef fiyat olarak uygula','Apply as Target Price'))}</button>`:''}</div>
      <div class="pdEventList">${events.map(event=>`<div class="pdEvent"><span class="pdEventDate">${esc(dateText(event.at))}</span><span><b>${esc(event.manufacturer)}</b><small>${esc(L(`Tur ${event.round}`,`Round ${event.round}`))}${event.byName?` · ${esc(event.byName)}`:''}${event.source&&event.source!=='manual'?` · ${esc(sourceLabel(event.source))}`:''}</small></span><b class="pdNum">${esc(money(event.value))}</b><button type="button" class="linkBtn" data-pd-open-req="${esc(event.requestId)}">${esc(L('Talep','Request'))}</button></div>`).join('')}</div>`;
  }
  function sourceLabel(source){return ({undo:L('geri alma','undo'),matrix:L('matris','matrix'),paste:L('yapıştırma','paste'),import:L('dönüş Excel’i','supplier Excel'),bulk:L('toplu onay','bulk approval'),legacy:L('eski kayıt','legacy record'),exclusive:L('tek onay kuralı','single approval rule'),ai:'LCW AI',collection:L('Koleksiyon','Collection')})[source]||source;}

  /* ================= ANALİZ ================= */
  const GROUP_LABELS={classification:['Klasman','Classification'],mag:['MAG','MAG'],mmyg:['MMYG','MMYG'],buyingGroup:['Buying Group','Buying Group'],buyer:['Buyer','Buyer'],productMainDefinition:['Ürün Ana Tanım','Product Main Definition'],season:['Sezon','Season'],license:['Lisans','License']};
  const FILTER_DIMS=['season','classification','manufacturer','buyer','mag','mmyg','buyingGroup'];
  const BASIS=[['latest','Son teklif','Latest offer'],['first','İlk tur teklifi','First-round offer'],['approved','Yalnız onaylı','Approved only']];
  function analysisObservations(){
    const basis=state.analysis.basis,out=[];
    scopedRequests('collection').forEach(req=>(req.items||[]).forEach(line=>{
      if(line.dropped)return;
      if(basis==='approved'&&!line.approved)return;
      let value=E.price(line.price);
      if(basis==='first'){const list=E.offers(line,req).filter(event=>event.value!=null);value=list.length?list[0].value:null;}
      if(value==null)return;
      const info=lineInfo(req,line);
      out.push({identityKey:`${clean(req.ownerId)}|${clean(line.modelKey)}`,modelKey:line.modelKey,model:info.model,plmId:info.plmId,manufacturer:clean(line.manufacturer),value,approved:!!line.approved,
        classification:info.classification,mag:info.mag||'—',mmyg:info.mmyg||'—',buyingGroup:info.buyingGroup||'—',buyer:info.buyer||'—',season:info.season||'—',license:info.license||'—',productMainDefinition:info.productMainDefinition||'—',
        target:info.target,requestId:req.id,itemId:line.id,req,line});
    }));
    return out;
  }
  function analysisPrefs(){return {groupBy:state.analysis.groupBy,basis:state.analysis.basis,view:state.analysis.view,filters:state.analysis.filters,allSuppliers:state.analysis.allSuppliers};}
  function heatClass(index){if(!Number.isFinite(index))return '';if(index<=-8)return 'isHeat-3';if(index<=-3)return 'isHeat-2';if(index<0)return 'isHeat-1';if(index>=8)return 'isHeat3';if(index>=3)return 'isHeat2';if(index>0)return 'isHeat1';return '';}
  function renderAnalysis(body){
    const observations=analysisObservations(),a=state.analysis;
    const result=E.analyze(observations,{groupBy:a.groupBy,filters:a.filters});
    const multi=scopeIsMulti();
    const views=[['matrix','Klasman × Üretici','Group × Manufacturer'],['scorecard','Üretici karnesi','Manufacturer scorecard'],...(multi?[['buyers','Buyer karşılaştırması','Buyer comparison']]:[])];
    const view=views.some(item=>item[0]===a.view)?a.view:'matrix';
    const filterChips=FILTER_DIMS.filter(dim=>dim!=='buyer'||multi).map(dim=>{
      const values=E.dimensionValues(observations,dim),chosen=new Set((a.filters[dim]||[]).map(E.keyOf));
      const label=dim==='manufacturer'?L('Üretici','Manufacturer'):L(...(GROUP_LABELS[dim]||[dim,dim]));
      return `<details class="pdFilter${chosen.size?' isOn':''}"><summary>${esc(label)}${chosen.size?` <b>${chosen.size}</b>`:''}<svg class="ic" aria-hidden="true"><use href="#i-chevron-down"/></svg></summary><div class="pdFilterList">${values.map(item=>`<label class="pdCheck"><input type="checkbox" data-pd-afilter="${dim}" value="${esc(item.label)}" ${chosen.has(item.key)?'checked':''}><span>${esc(item.label)}</span><small>${item.count}</small></label>`).join('')||`<span class="pdLaneEmpty">${esc(L('Değer yok','No values'))}</span>`}</div></details>`;
    }).join('');
    const spread=result.groups.filter(group=>Number.isFinite(group.spreadPct)).sort((x,y)=>y.spreadPct-x.spreadPct)[0];
    body.innerHTML=`<div class="pdAnalysis">
      <div class="pdSubBar">
        <label class="pdField isInline"><span>${esc(L('Kırılım','Group by'))}</span><select data-pd-agroup>${Object.keys(GROUP_LABELS).filter(key=>key!=='buyer'||multi).map(key=>`<option value="${key}"${a.groupBy===key?' selected':''}>${esc(L(...GROUP_LABELS[key]))}</option>`).join('')}</select></label>
        <label class="pdField isInline"><span>${esc(L('Fiyat','Price'))}</span><select data-pd-abasis>${BASIS.map(([key,tr,en])=>`<option value="${key}"${a.basis===key?' selected':''}>${esc(L(tr,en))}</option>`).join('')}</select></label>
        <div class="pdFilters">${filterChips}</div>
        ${Object.values(a.filters||{}).some(list=>list&&list.length)?`<button type="button" class="linkBtn" data-pd-aclear>${esc(L('Filtreleri temizle','Clear filters'))}</button>`:''}
        <span class="pdBarSpacer"></span>
        <div class="pdSeg" role="group" aria-label="${esc(L('Analiz görünümü','Analysis view'))}">${views.map(([key,tr,en])=>`<button type="button" data-pd-aview="${key}" class="${view===key?'isActive':''}" aria-pressed="${view===key}">${esc(L(tr,en))}</button>`).join('')}</div>
      </div>
      <div class="pdKpis"><div class="pricingMetric isHistory"><span>${esc(L('Model','Models'))}</span><b>${result.models}</b></div><div class="pricingMetric isHistory"><span>${esc(L('Teklif','Offers'))}</span><b>${result.count}</b></div><div class="pricingMetric isHistory"><span>${esc(L('Üretici','Manufacturers'))}</span><b>${result.suppliers.length}</b></div><div class="pricingMetric isHistory"><span>${esc(L('Ortalama','Average'))}</span><b>${esc(money(result.avg))}</b></div><div class="pricingMetric isHistory"><span>${esc(L('En geniş yayılım','Widest spread'))}</span><b title="${esc(spread?spread.label:'')}">${spread?esc(`${pctText(spread.spreadPct)} · ${spread.label}`):'—'}</b></div></div>
      <div class="pdAnalysisGrid"><div class="pdAnalysisMain" data-pd-amain></div><aside class="pdDrill" data-pd-drill aria-live="polite"></aside></div>
    </div>`;
    const main=body.querySelector('[data-pd-amain]');
    if(view==='scorecard')main.innerHTML=scorecardHtml(result);
    else if(view==='buyers')main.innerHTML=buyersHtml(observations);
    else main.innerHTML=matrixAnalysisHtml(result);
    renderDrill(body.querySelector('[data-pd-drill]'),result);
    body.querySelector('[data-pd-agroup]')?.addEventListener('change',event=>{a.groupBy=event.target.value;state.drill=null;store.set(ANALYSIS_KEY,analysisPrefs());renderAnalysis(body);});
    body.querySelector('[data-pd-abasis]')?.addEventListener('change',event=>{a.basis=event.target.value;state.drill=null;store.set(ANALYSIS_KEY,analysisPrefs());renderAnalysis(body);});
    body.querySelectorAll('[data-pd-aview]').forEach(button=>button.addEventListener('click',()=>{a.view=button.dataset.pdAview;state.drill=null;store.set(ANALYSIS_KEY,analysisPrefs());renderAnalysis(body);}));
    body.querySelector('[data-pd-aclear]')?.addEventListener('click',()=>{a.filters={};state.drill=null;store.set(ANALYSIS_KEY,analysisPrefs());renderAnalysis(body);});
    body.querySelectorAll('[data-pd-afilter]').forEach(box=>box.addEventListener('change',()=>{
      const dim=box.dataset.pdAfilter,values=[...body.querySelectorAll(`[data-pd-afilter="${dim}"]:checked`)].map(input=>input.value);
      const next={...(a.filters||{})};if(values.length)next[dim]=values;else delete next[dim];a.filters=next;state.drill=null;store.set(ANALYSIS_KEY,analysisPrefs());
      const open=dim;renderAnalysis(body);body.querySelector(`[data-pd-afilter="${open}"]`)?.closest('details')?.setAttribute('open','');
    }));
    body.querySelectorAll('[data-pd-acell]').forEach(cell=>cell.addEventListener('click',()=>{const group=cell.dataset.pdAcellGroup,supplier=cell.dataset.pdAcell;state.drill={type:'cell',group,supplier};renderDrill(body.querySelector('[data-pd-drill]'),result);body.querySelectorAll('.isDrill').forEach(el=>el.classList.remove('isDrill'));cell.classList.add('isDrill');}));
    body.querySelector('[data-pd-all-suppliers]')?.addEventListener('click',()=>{a.allSuppliers=!a.allSuppliers;store.set(ANALYSIS_KEY,analysisPrefs());renderAnalysis(body);});
    body.querySelectorAll('[data-pd-asupplier]').forEach(row=>row.addEventListener('click',()=>{state.drill={type:'supplier',supplier:row.dataset.pdAsupplier};renderDrill(body.querySelector('[data-pd-drill]'),result);}));
  }
  function matrixAnalysisHtml(result){
    if(!result.groups.length)return `<div class="pricingEmptyState">${esc(L('Bu kapsamda analiz edilecek teklif yok. Buyer kapsamını veya filtreleri genişletin.','No offers to analyse in this scope. Widen the buyer scope or the filters.'))}</div>`;
    const columns=state.analysis.allSuppliers?result.columns:result.columns.slice(0,12);
    const groupLabel=L(...(GROUP_LABELS[result.groupBy]||['Grup','Group']));
    return `${result.columns.length>12?`<div class="pdSubBar"><button type="button" class="tbtn" data-pd-all-suppliers aria-pressed="${Boolean(state.analysis.allSuppliers)}">${esc(state.analysis.allSuppliers?L('İlk 12','Top 12'):L(`Tümü (${result.columns.length})`,`All (${result.columns.length})`))}</button></div>`:''}<div class="pdAnalysisNote">${esc(L('Hücre: üreticinin bu gruptaki ortalama teklifi; çip: grup ortalamasına göre fark (yeşil = daha ucuz). Çerçeveli hücre grubun en avantajlı üreticisidir. Ayrıntı için hücreye tıklayın.','Cell: the manufacturer’s average offer in this group; chip: difference to the group average (green = cheaper). The framed cell is the group’s most advantageous manufacturer. Click a cell for details.'))}</div>
      <div class="pdHeatScroll"><table class="pdHeat"><thead><tr><th scope="col" class="pdHeatGroup">${esc(groupLabel)}</th><th scope="col" class="pdNum">${esc(L('Ort.','Avg'))}</th>${columns.map(col=>`<th scope="col" title="${esc(col.name)}">${esc(col.name)}</th>`).join('')}</tr></thead>
      <tbody>${result.groups.map(group=>`<tr><th scope="row" class="pdHeatGroup"><b>${esc(group.label)}</b><small>${esc(L(`${group.models} model · ${group.count} teklif`,`${group.models} models · ${group.count} offers`))}</small></th><td class="pdNum"><b>${esc(money(group.avg))}</b></td>${columns.map(col=>{const cell=group.cell(col.key);if(!cell)return '<td class="pdHeatCell isEmpty">·</td>';const best=group.best&&group.best.key===cell.key;return `<td class="pdHeatCell ${heatClass(cell.index)}${best?' isBest':''}${cell.eligible?'':' isLowSample'}" data-pd-acell-group="${esc(group.key)}" data-pd-acell="${esc(cell.key)}" tabindex="0" title="${esc(`${cell.name} · ${money(cell.avg)} · ${L('min','min')} ${money(cell.min)} · ${L('maks','max')} ${money(cell.max)} · ${cell.models} ${L('model','models')}`)}"><b>${esc(moneyPlain(cell.avg))}</b><span>${esc(pctText(cell.index))}</span><small>${cell.models}</small></td>`;}).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function scorecardHtml(result){
    if(!result.suppliers.length)return `<div class="pricingEmptyState">${esc(L('Bu kapsamda üretici teklifi yok.','No manufacturer offers in this scope.'))}</div>`;
    const groupLabel=L(...(GROUP_LABELS[result.groupBy]||['Grup','Group'])).toLocaleLowerCase(isEn()?'en-GB':'tr-TR');
    return `<div class="pdAnalysisNote">${esc(L(`Grup endeksi: üreticinin her ${groupLabel} içindeki fiyatının o grubun ortalamasına göre (teklif sayısıyla ağırlıklı) farkı. Aynı model endeksi: birden çok üreticinin fiyat verdiği modellerde, üreticinin fiyatının o modelin ortalamasına göre farkı — ürün karması etkisini eler.`,`Group index: the manufacturer’s price in each ${groupLabel} versus that group’s average (weighted by offers). Same-model index: on models priced by several manufacturers, the manufacturer’s price versus the model average — removes product-mix effects.`))}</div>
      <div class="pdHeatScroll"><table class="pdScore"><thead><tr><th scope="col">${esc(L('Üretici','Manufacturer'))}</th><th scope="col" class="pdNum">${esc(L('Teklif','Offers'))}</th><th scope="col" class="pdNum">${esc(L('Model','Models'))}</th><th scope="col" class="pdNum">${esc(L('Ort. fiyat','Avg price'))}</th><th scope="col" class="pdNum">${esc(L('Grup endeksi','Group index'))}</th><th scope="col" class="pdNum">${esc(L('Aynı model endeksi','Same-model index'))}</th><th scope="col" class="pdNum">${esc(L('En avantajlı','Most advantageous'))}</th><th scope="col" class="pdNum">${esc(L('Onay oranı','Approval rate'))}</th>${scopeIsMulti()?`<th scope="col">${esc(L('Buyer’lar','Buyers'))}</th>`:''}</tr></thead>
      <tbody>${result.suppliers.map(item=>`<tr data-pd-asupplier="${esc(item.key)}" tabindex="0"><th scope="row"><b>${esc(item.name)}</b></th><td class="pdNum">${item.count}</td><td class="pdNum">${item.models}</td><td class="pdNum">${esc(money(item.avg))}</td><td class="pdNum"><span class="pdChip ${toneOf(item.groupIndex)}">${esc(pctText(item.groupIndex))}</span></td><td class="pdNum">${item.modelIndexSample?`<span class="pdChip ${toneOf(item.modelIndex)}">${esc(pctText(item.modelIndex))}</span><small> (${item.modelIndexSample})</small>`:'—'}</td><td class="pdNum">${esc(L(`${item.wins} grup`,`${item.wins} groups`))}</td><td class="pdNum">${esc(pctText(item.approvalRate).replace(/^\+/,''))}</td>${scopeIsMulti()?`<td><small>${esc(item.buyers.join(', '))}</small></td>`:''}</tr>`).join('')}</tbody></table></div>`;
  }
  function buyersHtml(observations){
    const list=E.buyerComparison(observations,{groupBy:state.analysis.groupBy==='buyer'?'classification':state.analysis.groupBy,filters:state.analysis.filters});
    if(!list.length)return `<div class="pricingEmptyState">${esc(L('Karşılaştırılacak buyer verisi yok.','No buyer data to compare.'))}</div>`;
    return `<div class="pdAnalysisNote">${esc(L('Endeks: buyer’ın tekliflerinin aynı gruptaki tüm buyer ortalamasına göre farkı (yeşil = daha avantajlı fiyat).','Index: the buyer’s offers versus the average of all buyers in the same group (green = more advantageous price).'))}</div>
      <div class="pdBuyerBars">${list.map(item=>{const maxAbs=Math.max(1,...list.map(entry=>Math.abs(entry.index||0)));const width=Math.min(48,Math.abs(item.index||0)/maxAbs*48);return `<div class="pdBuyerRow"><b>${esc(item.name)}</b><span class="pdBuyerMeta">${esc(L(`${item.models} model · ${item.count} teklif · ${item.suppliers} üretici`,`${item.models} models · ${item.count} offers · ${item.suppliers} manufacturers`))}</span><div class="pdBuyerTrack"><i class="pdBuyerZero"></i><i class="pdBuyerBar ${toneOf(item.index)}" style="--pd-left:${item.index<0?50-width:50}%;--pd-width:${width}%"></i></div><span class="pdChip ${toneOf(item.index)}">${esc(pctText(item.index))}</span><span class="pdNum">${esc(money(item.avg))}</span></div>`;}).join('')}</div>`;
  }
  function renderDrill(host,result){
    if(!host)return;
    const drill=state.drill;
    let items=[],title='',sub='';
    if(drill&&drill.type==='cell'){const group=result.groups.find(item=>item.key===drill.group),cell=group&&group.cells.find(item=>item.key===drill.supplier);if(cell){items=cell.items;title=`${cell.name} · ${group.label}`;sub=L(`Ort. ${money(cell.avg)} · grup ort. ${money(group.avg)} · ${pctText(cell.index)}`,`Avg ${money(cell.avg)} · group avg ${money(group.avg)} · ${pctText(cell.index)}`);}}
    else if(drill&&drill.type==='supplier'){const supplier=result.suppliers.find(item=>item.key===drill.supplier);if(supplier){items=supplier.items;title=supplier.name;sub=L(`${supplier.models} model · ort. ${money(supplier.avg)}`,`${supplier.models} models · avg ${money(supplier.avg)}`);}}
    if(!items.length){
      const best=result.groups.filter(group=>group.best).slice(0,6);
      host.innerHTML=`<div class="pdPanelHead"><b>${esc(L('Öne çıkanlar','Highlights'))}</b><span>${esc(L('Her grubun en avantajlı üreticisi','The most advantageous manufacturer of each group'))}</span></div>${best.map(group=>`<div class="pdHighlight"><span><b>${esc(group.label)}</b><small>${esc(group.best.name)}</small></span><span class="pdChip isGood">${esc(pctText(group.best.index))}</span></div>`).join('')||`<div class="pricingEmptyState">${esc(L('Karşılaştırma için bir grupta en az iki üretici gerekir.','A group needs at least two manufacturers to compare.'))}</div>`}`;
      return;
    }
    const groupAvg=new Map(result.groups.map(group=>[group.key,group.avg]));
    host.innerHTML=`<div class="pdPanelHead"><b>${esc(title)}</b><span>${esc(sub)}</span></div><div class="pdDrillList">${items.slice().sort((a,b)=>a.value-b.value).slice(0,120).map(item=>{const base=groupAvg.get(E.keyOf(item[result.groupBy]||'—'));const diff=E.pct(item.value,base);return `<div class="pdDrillRow">${thumbHtml(item.req,item.line,'pdThumb isSmall')}<span class="pdRoundModel"><b>${esc(item.model)}</b><small>${esc(item.manufacturer)}${scopeIsMulti()?` · ${esc(item.buyer)}`:''}</small></span><b class="pdNum">${esc(money(item.value))}</b><span class="pdChip ${toneOf(diff)}">${esc(pctText(diff))}</span>${item.approved?`<span class="pdApprovedTag">${esc(L('ONAYLI','APPROVED'))}</span>`:'<span></span>'}</div>`;}).join('')}</div>`;
    bindThumbs(host);
  }

  window.BLPricingDesk={renderLanguage(){state.hosts.forEach(host=>{if(host.isConnected&&host.getClientRects().length)renderHost(host);});},mount,openTab,setHistoryContext,renderMatrix,detailView,setDetailView,scopeAllows,ownerRows,setScope,undo:undoLast,_test:{supplierWorkbookPlan,state}};
})();
