/* Open Costing v2.24 — responsive workspace with stable costing-table columns */
(function(){
'use strict';
const SECTION_DEFS=[
  {key:'fabric',tr:'Kumaş',en:'Fabric',hintTr:'Ana kumaş, ribana, astar ve yardımcı kumaşlar',hintEn:'Main fabric, rib, lining and secondary fabrics'},
  {key:'labor',tr:'İşçilik / CMT',en:'Labor / CMT',hintTr:'Kesim, dikim, ütü, paketleme ve operasyon maliyetleri',hintEn:'Cutting, sewing, ironing, packing and operation costs'},
  {key:'accessories',tr:'Aksesuar',en:'Accessories',hintTr:'Fermuar, düğme, etiket, iplik ve diğer aksesuarlar',hintEn:'Zippers, buttons, labels, thread and trims'},
  {key:'printEmbroidery',tr:'Baskı / Nakış',en:'Print / Embroidery',hintTr:'Baskı, nakış, aplike ve artwork maliyetleri',hintEn:'Print, embroidery, applique and artwork costs'},
  {key:'specialProcess',tr:'Özel İşlem',en:'Special Process',hintTr:'Kaplama, bonding, lazer, taş, plisaj vb.',hintEn:'Coating, bonding, laser, stones, pleating etc.'},
  {key:'washing',tr:'Yıkama',en:'Washing',hintTr:'Yıkama, boya, enzim ve kurutma işlemleri',hintEn:'Washing, dyeing, enzyme and drying processes'},
  {key:'packaging',tr:'Paketleme',en:'Packaging',hintTr:'Poşet, koli, askı, sticker ve paketleme sarfları',hintEn:'Polybag, carton, hanger, sticker and packing supplies'},
  {key:'testing',tr:'Test / Uygunluk',en:'Testing / Compliance',hintTr:'Laboratuvar, denetim, sertifika ve kontrol giderleri',hintEn:'Laboratory, inspection, certification and control costs'},
  {key:'other',tr:'Diğer Maliyetler',en:'Other Costs',hintTr:'Nakliye, numune, kalıp ve diğer doğrudan maliyetler',hintEn:'Freight, samples, patterns and other direct costs'},
];
const RATE_DEFS=[
  {key:'productionWastePct',tr:'Genel Üretim Firesi',en:'Production Waste',amount:'productionWaste',subtotal:'afterWaste',subtotalTr:'Fire Sonrası',subtotalEn:'After Waste'},
  {key:'overheadPct',tr:'Genel Gider',en:'Overhead',amount:'overhead',subtotal:'afterOverhead',subtotalTr:'Genel Gider Sonrası',subtotalEn:'After Overhead'},
  {key:'financePct',tr:'Finansman',en:'Finance',amount:'finance',subtotal:'afterFinance',subtotalTr:'Finansman Sonrası',subtotalEn:'After Finance'},
  {key:'profitPct',tr:'Kâr',en:'Profit',amount:'profit',subtotal:null},
];
let records=[],current=null,dirty=false,loaded=false,bound=false,search='',imagePasteActive=false,storeRevision=0;
const $=id=>document.getElementById(id);
const tr=()=>typeof appLang==='undefined'||appLang!=='en';
const tx=(a,b)=>tr()?a:b;
const clone=v=>JSON.parse(JSON.stringify(v));
const safe=s=>typeof escapeHtml==='function'?escapeHtml(s):String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
function parseLocalizedNumber(value){return window.BLOpenCostingEngine.parseLocalizedNumber(value);}
const n=parseLocalizedNumber;
const pct=v=>Math.max(0,n(v));
function roundHalfUp(value,decimals=2){
  return window.BLBusinessRules.roundHalfUp(value,decimals);
}
function formatEditable(value,maxDecimals=4,minDecimals=0){
  if(value==null||String(value).trim()==='')return '';
  const valueNum=n(value);let out=roundHalfUp(valueNum,maxDecimals).toFixed(maxDecimals);
  if(maxDecimals>minDecimals){
    const [whole,decimal='']=out.split('.');let trimmed=decimal;
    while(trimmed.length>minDecimals&&trimmed.endsWith('0'))trimmed=trimmed.slice(0,-1);
    out=trimmed?whole+'.'+trimmed:whole;
  }
  return out.replace('.',',');
}
function formatByKind(value,kind){
  if(kind==='integer')return formatEditable(value,0,0);
  if(kind==='money2')return formatEditable(value,2,2);
  if(kind==='percent2')return formatEditable(value,2,0);
  return formatEditable(value,4,0);
}
function money(value,currency){return formatEditable(roundHalfUp(n(value),2),2,2)+' '+(currency||'USD');}
function quantityText(value){return formatEditable(n(value),4,0)||'0';}
function uid(prefix){return (prefix||'id')+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);}
function currentMonthKey(){return window.BLFX&&BLFX.monthKey?BLFX.monthKey(null):(()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');})();}
function emptyRow(currency='USD'){return {id:uid('row'),item:'',details:'',supplier:'',unit:'adet',qty:'',unitPrice:'',currency:currency||'USD',_currencyAuto:true,wastePct:''};}
function defaultSections(currency='USD'){const out={};SECTION_DEFS.forEach((d,i)=>{out[d.key]=i<3?[emptyRow(currency)]:[];});return out;}
function defaultRecord(){const currency='USD';return {id:null,title:tx('Yeni Ön Maliyet','New Preliminary Costing'),createdAt:null,updatedAt:null,meta:{modelCode:'',plmId:'',manufacturer:'',country:'',season:'',license:'',category:'',quantity:'',currency,fxMonth:currentMonthKey(),targetFob:'',notes:'',image:''},sections:defaultSections(currency),rates:{productionWastePct:'',overheadPct:'',financePct:'',profitPct:''},summary:{}};}
function normalizeRecord(raw){
  const base=defaultRecord(),r={...base,...clone(raw||{})};
  r.meta={...base.meta,...(raw&&raw.meta||{})};r.meta.fxMonth=window.BLOpenCostingEngine.normalizeFxMonth(r.meta.fxMonth);
  r.rates={...base.rates,...(raw&&raw.rates||{})};r.sections={};
  SECTION_DEFS.forEach(d=>{r.sections[d.key]=Array.isArray(raw&&raw.sections&&raw.sections[d.key])?raw.sections[d.key].map(x=>{const hadCurrency=!!String(x&&x.currency||'').trim();return {...emptyRow(r.meta.currency),...x,id:x.id||uid('row'),currency:hadCurrency?x.currency:r.meta.currency,_currencyAuto:x&&typeof x._currencyAuto==='boolean'?x._currencyAuto:!hadCurrency};}):[];});
  r.summary=raw&&raw.summary&&typeof raw.summary==='object'?raw.summary:{};return r;
}
async function request(url,opts={}){const requestOpts={...opts},expectedRevision=requestOpts.expectedRevision;delete requestOpts.expectedRevision;requestOpts.headers={'Content-Type':'application/json',...(requestOpts.headers||{})};if(expectedRevision!=null)requestOpts.headers['If-Match']=String(expectedRevision);const res=await fetch(url,requestOpts);const data=await res.json().catch(()=>({}));if(!res.ok){const err=new Error(data.error||res.statusText);err.code=data.code;err.currentRevision=data.currentRevision;throw err;}if(Number.isInteger(Number(data._revision)))storeRevision=Number(data._revision);return data;}
function setDirty(value=true){dirty=!!value;const badge=$('ocDirtyBadge');badge?.classList.toggle('show',dirty);if(badge)badge.textContent=tx('Kaydedilmemiş değişiklik','Unsaved changes');const save=$('ocSaveBtn');if(save)save.disabled=!current||!dirty;}
function normalizeText(value){return String(value||'').trim().toLocaleLowerCase('tr-TR');}
function collectionEffectiveValue(row,key){
  try{if(window.BLCollectionModelGroups?.effectiveValue&&typeof kolRows!=='undefined'&&Array.isArray(kolRows))return window.BLCollectionModelGroups.effectiveValue(row,key,kolRows);}catch(_){ }
  return row?.[key];
}
function collectionModel(value){
  try{if(typeof kolRows==='undefined')return null;const key=normalizeText(value);return kolRows.find(r=>normalizeText(r.modelKod)===key)||null;}catch(e){return null;}
}
function buildSuggestions(){
  const models=new Map(),mfrs=new Set(),countries=new Set(),seasons=new Set(),licenses=new Set(),categories=new Set();
  const add=(set,value)=>{const text=String(value||'').trim();if(text)set.add(text);};
  try{if(typeof kolRows!=='undefined')kolRows.forEach(r=>{const code=String(collectionEffectiveValue(r,'modelKod')||'').trim();if(code)models.set(code,r);add(seasons,collectionEffectiveValue(r,'season'));add(licenses,collectionEffectiveValue(r,'lisans'));add(categories,collectionEffectiveValue(r,'urunTipi'));add(countries,collectionEffectiveValue(r,'ulke')||collectionEffectiveValue(r,'country'));});}catch(e){}
  try{if(typeof state!=='undefined'&&state.cp&&Array.isArray(state.cp.rows))state.cp.rows.forEach(r=>{add(mfrs,r['Sub-Manufacturer']||r.Manufacturer);add(countries,r.Country);add(seasons,r.Season);add(licenses,r.License);add(categories,r.Category);const code=String(r['Model Name']||r['Model Code']||'').trim();if(code&&!models.has(code))models.set(code,r);});}catch(e){}
  try{if(typeof refreshSubmfrList==='function')refreshSubmfrList();if(typeof _submfrValsCache!=='undefined')_submfrValsCache.forEach(v=>add(mfrs,v));}catch(e){}
  try{if(typeof kolManufacturers!=='undefined')kolManufacturers.forEach(v=>add(mfrs,v.name));}catch(e){}
  (records||[]).forEach(r=>{add(mfrs,r.meta?.manufacturer);add(countries,r.meta?.country);add(seasons,r.meta?.season);add(licenses,r.meta?.license);add(categories,r.meta?.category);});
  const fill=(id,values)=>{const el=$(id);if(el)el.innerHTML=[...values].filter(Boolean).sort((a,b)=>a.localeCompare(b,'tr')).map(v=>`<option value="${safe(v)}"></option>`).join('');};
  fill('ocModelOptions',models.keys());fill('ocManufacturerOptions',mfrs);fill('ocCountryOptions',countries);fill('ocSeasonOptions',seasons);fill('ocLicenseOptions',licenses);fill('ocCategoryOptions',categories);
}
let ocMetaSuggestDrop=null,ocMetaSuggestInput=null,ocMetaSuggestIndex=-1;
function ocMetaSuggestionItems(input){
  const listId=input?.dataset?.options;if(!listId)return [];
  const list=$(listId);if(!list)return [];
  const seen=new Set(),items=[];
  [...list.querySelectorAll('option')].forEach(option=>{
    const value=String(option.value||option.textContent||'').trim();
    const label=String(option.dataset.label||option.label||option.textContent||value).trim()||value;
    const key=value.toLocaleLowerCase('tr-TR');
    if(value&&!seen.has(key)){seen.add(key);items.push({value,label});}
  });
  return items;
}
function ocMetaSuggestionValues(input){return ocMetaSuggestionItems(input).map(item=>item.value);}
function closeOcMetaSuggest(){
  if(ocMetaSuggestInput)ocMetaSuggestInput.setAttribute('aria-expanded','false');
  if(ocMetaSuggestDrop)ocMetaSuggestDrop.remove();
  ocMetaSuggestDrop=null;ocMetaSuggestInput=null;ocMetaSuggestIndex=-1;
}
function positionOcMetaSuggest(input){
  if(!ocMetaSuggestDrop||!input)return;
  const rect=input.getBoundingClientRect();
  const width=Math.max(rect.width,170),margin=8,gap=3;
  const left=Math.min(Math.max(margin,rect.left),Math.max(margin,window.innerWidth-width-margin));
  ocMetaSuggestDrop.style.width=width+'px';
  ocMetaSuggestDrop.style.left=left+'px';
  ocMetaSuggestDrop.style.maxHeight=Math.min(240,Math.max(110,window.innerHeight-24))+'px';
  const height=Math.min(ocMetaSuggestDrop.scrollHeight,240);
  const below=window.innerHeight-rect.bottom-gap-margin;
  const top=below>=Math.min(height,150)?rect.bottom+gap:Math.max(margin,rect.top-gap-height);
  ocMetaSuggestDrop.style.top=top+'px';
}
function updateOcMetaSuggestActive(){
  if(!ocMetaSuggestDrop)return;
  const items=[...ocMetaSuggestDrop.querySelectorAll('.submfrDropItem')];
  items.forEach((item,i)=>item.classList.toggle('active',i===ocMetaSuggestIndex));
  items[ocMetaSuggestIndex]?.scrollIntoView?.({block:'nearest'});
}
function selectOcMetaSuggestion(value){
  const input=ocMetaSuggestInput;if(!input)return;
  input.value=value;
  input.dispatchEvent(new Event('input',{bubbles:true}));
  input.dispatchEvent(new Event('change',{bubbles:true}));
  closeOcMetaSuggest();
  input.focus();
}
function showOcMetaSuggest(input,showAll=false){
  if(!input||input.dataset.kind!=='oc-meta-suggest'){closeOcMetaSuggest();return;}
  try{if(typeof closeSubmfrDrop==='function')closeSubmfrDrop();}catch(e){}
  buildSuggestions();populateFxControls();
  const query=showAll?'':String(input.value||'').trim().toLocaleLowerCase('tr-TR');
  const matches=ocMetaSuggestionItems(input)
    .filter(item=>!query||item.value.toLocaleLowerCase('tr-TR').includes(query)||item.label.toLocaleLowerCase('tr-TR').includes(query))
    .slice(0,14);
  if(!matches.length){closeOcMetaSuggest();return;}
  if(!ocMetaSuggestDrop){
    ocMetaSuggestDrop=document.createElement('div');
    ocMetaSuggestDrop.className='submfrDrop ocMetaSuggestDrop';ocMetaSuggestDrop.dataset.uiMigrated='commercial';
    ocMetaSuggestDrop.setAttribute('role','listbox');
    document.body.appendChild(ocMetaSuggestDrop);
  }
  ocMetaSuggestInput=input;ocMetaSuggestIndex=-1;
  input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-expanded','true');
  ocMetaSuggestDrop.style.zIndex=input.closest('.warnOverlay')?'var(--ui-z-modal-menu)':'var(--ui-z-popover)';
  ocMetaSuggestDrop.innerHTML=matches.map(item=>`<div class="submfrDropItem" role="option" data-value="${safe(item.value)}"><span>${safe(item.label)}</span>${item.label!==item.value?`<small>${safe(item.value)}</small>`:''}</div>`).join('');
  ocMetaSuggestDrop.querySelectorAll('.submfrDropItem').forEach(item=>item.addEventListener('mousedown',event=>{
    event.preventDefault();selectOcMetaSuggestion(item.dataset.value||item.textContent||'');
  }));
  positionOcMetaSuggest(input);
}
function handleOcMetaSuggestKeydown(event){
  const input=event.target;
  if(input?.dataset?.kind!=='oc-meta-suggest')return false;
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){
    if(!ocMetaSuggestDrop)showOcMetaSuggest(input,true);
    const count=ocMetaSuggestDrop?.querySelectorAll('.submfrDropItem').length||0;
    if(!count)return false;
    event.preventDefault();
    ocMetaSuggestIndex=event.key==='ArrowDown'?(ocMetaSuggestIndex+1)%count:(ocMetaSuggestIndex<=0?count-1:ocMetaSuggestIndex-1);
    updateOcMetaSuggestActive();return true;
  }
  if(event.key==='Enter'&&ocMetaSuggestDrop&&ocMetaSuggestIndex>=0){
    event.preventDefault();
    const item=ocMetaSuggestDrop.querySelectorAll('.submfrDropItem')[ocMetaSuggestIndex];
    if(item)selectOcMetaSuggestion(item.dataset.value||item.textContent||'');
    return true;
  }
  if(event.key==='Escape'&&ocMetaSuggestDrop){event.preventDefault();closeOcMetaSuggest();return true;}
  return false;
}
function renderRecordList(){
  const list=$('ocRecordList');if(!list)return;const q=search.trim().toLocaleLowerCase('tr-TR');
  const items=records.filter(r=>!q||[r.title,r.meta?.modelCode,r.meta?.manufacturer,r.meta?.season,r.meta?.license].some(v=>String(v||'').toLocaleLowerCase('tr-TR').includes(q)));
  if(!items.length){list.innerHTML=`<div class="ocSidebarEmpty">${tx('Kayıt bulunamadı. Yeni bir ön maliyet oluşturabilirsin.','No costing found. Create a new preliminary costing.')}</div>`;return;}
  list.innerHTML=items.map(r=>`<button type="button" class="ocRecordItem ${current&&current.id===r.id?'active':''}" data-id="${safe(r.id)}"><div class="ocRecordItemTitle"><span>${safe(r.title||tx('İsimsiz Maliyet','Untitled Costing'))}</span></div><div class="ocRecordItemMeta">${safe([r.meta?.modelCode,r.meta?.manufacturer,r.meta?.season].filter(Boolean).join(' · ')||tx('Maliyet çalışması','Costing sheet'))}</div></button>`).join('');
}
function lineTotal(row,record=current,missing){return window.BLOpenCostingEngine.lineTotal(row,record,missing,record?fxSnapFor(record):null);}
function calculateRecord(record){return window.BLOpenCostingEngine.calculateRecord(record,fxSnapFor(record));}
function calculate(){return calculateRecord(current);}
function setTextAll(selector,text){document.querySelectorAll(selector).forEach(el=>{el.textContent=text;});}
function hasCostValue(value){return Number.isFinite(Number(value))&&Math.abs(Number(value))>=0.0000001;}
function syncSummaryZeroVisibility(c){
  document.querySelectorAll('[data-oc-zero-section]').forEach(el=>{el.hidden=!hasCostValue(c.sectionTotals?.[el.dataset.ocZeroSection]);});
  document.querySelectorAll('[data-oc-zero-key]').forEach(el=>{el.hidden=!hasCostValue(c[el.dataset.ocZeroKey]);});
  document.querySelectorAll('[data-oc-zero-text]').forEach(el=>{const value=c[el.dataset.ocZeroText];if(!hasCostValue(value))el.textContent='';});
  const sections=document.querySelector('#ocSummaryBody .ocSummarySections');if(sections)sections.hidden=![...sections.children].some(el=>!el.hidden);
  const target=document.querySelector('#ocSummaryBody .ocTargetBox');if(target)target.hidden=![...target.querySelectorAll('.ocMetric')].some(el=>!el.hidden);
}
function finalAlternativeCurrencies(cur){
  const fixed=cur==='USD'?['TRY','EUR']:cur==='TRY'?['USD','EUR']:cur==='EUR'?['USD','TRY']:['USD','TRY'];
  const pool=[...fixed,...currencyPool(current)].filter(c=>c&&c!==cur);return [...new Set(pool)].slice(0,2);
}
function finalAlternativesHtml(finalFob){
  if(!current)return '';
  const cur=current.meta.currency||'USD',snap=fxSnapFor(current);
  return finalAlternativeCurrencies(cur).map(code=>{const v=BLFX.convert(Number(finalFob)||0,cur,code,snap);return `<span>${safe(code)}: <strong>${v==null?'—':money(roundHalfUp(v,2),code)}</strong></span>`;}).join('<span class="ocFxAltSep">·</span>');
}
function updateCalculatedDom(){
  if(!current)return;const c=calculate(),cur=current.meta.currency||'USD';current.summary=c;
  SECTION_DEFS.forEach(d=>{setTextAll(`[data-oc-section-total="${d.key}"]`,money(c.sectionTotals[d.key],cur));const sectionRows=current.sections[d.key]||[];sectionRows.forEach(row=>setTextAll(`[data-oc-line="${row.id}"]`,money(lineTotal(row,current),cur)));setTextAll(`[data-oc-qty-total="${d.key}"]`,sectionRows.reduce((sum,row)=>sum+n(row.qty),0).toLocaleString('tr-TR',{maximumFractionDigits:4}));});
  const values={direct:c.direct,productionWaste:c.productionWaste,afterWaste:c.afterWaste,overhead:c.overhead,afterOverhead:c.afterOverhead,finance:c.finance,afterFinance:c.afterFinance,profit:c.profit,finalFob:c.finalFob,target:c.target,gap:c.gap,orderTotal:c.orderTotal};
  Object.entries(values).forEach(([key,value])=>setTextAll(`[data-oc-value="${key}"]`,money(value,cur)));
  setTextAll('[data-oc-value="quantity"]',quantityText(current.meta.quantity));
  const gapBox=$('ocGapMetric');if(gapBox){gapBox.classList.toggle('over',!!c.target&&c.gap>0);gapBox.classList.toggle('under',!!c.target&&c.gap<=0);}
  syncSummaryZeroVisibility(c);
  const alt=$('ocFinalFxAlternatives');if(alt)alt.innerHTML=finalAlternativesHtml(c.finalFob);
  const line=$('ocFxBadgeLine');if(line)line.innerHTML=fxEditorBadgeHtml(c);
}
function textInput(section,row,field){return `<textarea rows="1" class="ocAutoGrow" data-section="${section}" data-row="${row.id}" data-field="${field}">${safe(row[field]||'')}</textarea>`;}
function numberInput(section,row,field,kind,placeholder){return `<input type="text" inputmode="decimal" class="ocNum" data-oc-number="${kind}" data-section="${section}" data-row="${row.id}" data-field="${field}" value="${safe(formatByKind(row[field],kind))}" placeholder="${placeholder||''}">`;}
function currencyPool(record=current){
  const set=new Set([record?.meta?.currency||'USD',BLFX.store.base||'USD',...(BLFX.allCurrencies?BLFX.allCurrencies():BLFX.displayCurrencies())]);
  SECTION_DEFS.forEach(d=>(record?.sections?.[d.key]||[]).forEach(r=>{if(r.currency)set.add(r.currency);}));return [...set].filter(Boolean);
}
function currencyOptionsHtml(selected,record=current){return currencyPool(record).map(c=>`<option value="${safe(c)}" ${c===selected?'selected':''}>${safe(c)}</option>`).join('');}
function autoGrowCostTextareas(root=document){root.querySelectorAll?.('.ocAutoGrow').forEach(el=>{el.style.height='auto';el.style.height=Math.min(112,Math.max(26,el.scrollHeight))+'px';});}
function rowHtml(section,row){
  const rowCur=row.currency||current?.meta?.currency||'USD';
  return `<tr><td>${textInput(section,row,'item')}</td><td>${textInput(section,row,'details')}</td><td><input list="ocUnitOptions" data-section="${section}" data-row="${row.id}" data-field="unit" value="${safe(row.unit||'')}"></td><td>${numberInput(section,row,'qty','decimal4','0,0000')}</td><td>${numberInput(section,row,'unitPrice','decimal4','0,0000')}</td><td><select class="ocLineCurrency" data-section="${section}" data-row="${row.id}" data-field="currency">${currencyOptionsHtml(rowCur)}</select></td><td>${numberInput(section,row,'wastePct','percent2','0,00')}</td><td><span class="ocLineAmount" data-oc-line="${row.id}"></span></td><td><button type="button" class="ocIconButton ocIconButton--danger" data-delete-section="${section}" data-delete-row="${row.id}" title="${tx('Satırı sil','Delete line')}"><svg class="ic"><use href="#i-trash"/></svg></button></td></tr>`;
}
/* Maliyet grubu açık mı gelsin?
   - Yeni (henüz kaydedilmemiş) maliyette: hepsi KAPALI.
   - Kaydedilmiş maliyette: içinde veri/değer olan gruplar AÇIK, boş veya
     toplamı 0 olanlar KAPALI. */
function rowHasData(row){
  if(!row)return false;
  if(hasCostValue(n(row.qty))||hasCostValue(n(row.unitPrice))||hasCostValue(n(row.wastePct)))return true;
  return ['item','details','supplier'].some(f=>String(row[f]||'').trim()!=='');
}
function sectionShouldOpen(key,rows){
  if(!current||!current.id)return false;            // ilk oluşturma → tümü kapalı
  const list=rows||current.sections?.[key]||[];
  if(!list.length)return false;
  if(list.some(rowHasData))return true;             // veri girişi olan satır var
  return hasCostValue(current.summary?.sectionTotals?.[key]);
}
function renderSections(){
  const host=$('ocSections');if(!host||!current)return;
  host.innerHTML=SECTION_DEFS.map(def=>{const rows=current.sections[def.key]||[];return `<details class="ocCostSection" data-section="${def.key}"${sectionShouldOpen(def.key,rows)?' open':''}><summary><span><span class="ocCostSectionName">${safe(tr()?def.tr:def.en)}</span><span class="ocCostSectionHint"> · ${safe(tr()?def.hintTr:def.hintEn)}</span></span><span class="ocSectionTotal" data-oc-section-total="${def.key}"></span></summary><div class="ocSectionBody"><div class="ocTableWrap"><table class="ocCostTable"><colgroup><col class="ocColItem"><col class="ocColDetails"><col class="ocColUnit"><col class="ocColQty"><col class="ocColUnitPrice"><col class="ocColCurrency"><col class="ocColWaste"><col class="ocColTotal"><col class="ocColDelete"></colgroup><thead><tr><th>${tx('Maliyet Kalemi','Cost Item')}</th><th>${tx('Açıklama','Description')}</th><th>${tx('Birim','Unit')}</th><th>${tx('Tüketim / Adet','Usage / Qty')}</th><th>${tx('Birim Fiyat','Unit Price')}</th><th>${tx('Döviz','Currency')}</th><th>${tx('Fire %','Waste %')}</th><th>${tx('Toplam','Total')}</th><th></th></tr></thead><tbody>${rows.length?rows.map(row=>rowHtml(def.key,row)).join(''):`<tr><td colspan="9" class="ocNoRows">${tx('Henüz maliyet satırı eklenmedi.','No cost line has been added yet.')}</td></tr>`}</tbody><tfoot><tr><td class="quantityTotalLabel">${tx('Toplam','Total')}</td><td></td><td></td><td class="quantityTotalValue" data-oc-qty-total="${def.key}"></td><td colspan="5"></td></tr></tfoot></table></div><button type="button" class="ocInlineButton" data-add-section="${def.key}"><svg class="ic"><use href="#i-copy-plus"/></svg>${tx('Satır Ekle','Add Line')}</button></div></details>`;}).join('');
  autoGrowCostTextareas(host);
}
function renderSummary(){
  const host=$('ocSummaryBody');if(!host||!current)return;
  const rateRows=RATE_DEFS.map(d=>`<div class="ocRateRow"><label>${safe(tr()?d.tr:d.en)} %</label><input type="text" inputmode="decimal" data-oc-number="percent2" data-rate="${d.key}" value="${safe(formatByKind(current.rates[d.key],'percent2'))}" placeholder="0,00"><span class="ocRateValue" data-oc-value="${d.amount}" data-oc-zero-text="${d.amount}"></span></div>${d.subtotal?`<div class="ocSubtotalRow" data-oc-zero-key="${d.subtotal}"><span>${safe(tr()?d.subtotalTr:d.subtotalEn)}</span><span data-oc-value="${d.subtotal}"></span></div>`:''}`).join('');
  host.innerHTML=`<div class="ocSummarySections">${SECTION_DEFS.map(d=>`<div class="ocSummaryRow" data-oc-zero-section="${d.key}"><span>${safe(tr()?d.tr:d.en)}</span><span data-oc-section-total="${d.key}"></span></div>`).join('')}<div class="ocSummaryRow ocDirectRow" data-oc-zero-key="direct"><span>${tx('Doğrudan Maliyet','Direct Cost')}</span><span data-oc-value="direct"></span></div></div><div class="ocRateFlow">${rateRows}</div><div class="ocGrandTotal" data-oc-zero-key="finalFob"><div class="ocGrandTotalLabel">${tx('Hesaplanan Birim FOB','Calculated Unit FOB')}</div><div class="ocGrandTotalValue" data-oc-value="finalFob"></div><div class="ocGrandTotalHint ocFinalFxAlternatives" id="ocFinalFxAlternatives"></div><div class="ocFxMetaLine" id="ocFxBadgeLine">${fxEditorBadgeHtml()}</div></div><div class="ocTargetBox"><div class="ocMetric" data-oc-zero-key="target"><label>${tx('Hedef FOB','Target FOB')}</label><strong data-oc-value="target"></strong></div><div class="ocMetric" id="ocGapMetric" data-oc-zero-key="gap"><label>${tx('Hedef Sapması','Target Gap')}</label><strong data-oc-value="gap"></strong></div><div class="ocMetric" data-oc-zero-key="quantity"><label>${tx('Sipariş Adedi','Order Quantity')}</label><strong data-oc-value="quantity"></strong></div><div class="ocMetric" data-oc-zero-key="orderTotal"><label>${tx('Toplam Sipariş Maliyeti','Total Order Cost')}</label><strong data-oc-value="orderTotal"></strong></div></div><div class="ocFormulaNote">${tx('Hesap sırası: satır maliyetleri (tüketim × birim fiyat × fire) → genel üretim firesi → genel gider → finansman → kâr. Birim FOB son adımda 2 haneye yuvarlanır.','Calculation order: line costs (usage × unit price × waste) → production waste → overhead → finance → profit. Unit FOB is rounded to 2 decimals at the final step.')}</div>`;
}
function placeholderImage(){
  if(typeof kolImagePlaceholderSvg==='function')return kolImagePlaceholderSvg();
  return 'data:image/svg+xml;utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 200"><rect width="160" height="200" fill="#EEF0F3"/><path d="M36 56h88M36 80h88M36 104h56" stroke="#B7BEC9" stroke-width="6" fill="none"/></svg>');
}
function ocDisplayedImageSource(){
  const manual=String(current?.meta?.image||'');
  if(manual)return manual;
  return window.BLDetailImages?.sourceFor?.({plmId:current?.meta?.plmId||'',modelName:current?.meta?.modelCode||''})||'';
}
function renderImagePanel(){
  const img=$('ocStyleImage'),stage=$('ocImageStage'),remove=$('ocImageRemoveBtn');if(!img||!stage)return;
  const manual=String(current?.meta?.image||''),src=ocDisplayedImageSource();img.src=src||placeholderImage();stage.classList.toggle('has-image',!!src);stage.classList.toggle('paste-active',imagePasteActive);if(remove)remove.disabled=!manual;
  const panel=stage.closest('.ocImagePanel');
  window.BLDetailImages?.registerScope?.(panel,{contextType:'open-costing',label:tx('Ön Maliyet','Open Costing'),identities:current?[{plmId:current.meta?.plmId||'',styleName:current.meta?.modelCode||'',hasImage:!!src,manualProtected:!!manual}]:[],repaint:renderImagePanel});
  const status=$('ocImageStatus');if(status)status.textContent=imagePasteActive?tx('Ctrl+V ile görsel yapıştırmaya hazır','Ready for Ctrl+V image paste'):tx('Tek tık: yapıştırma hedefi · Çift tık: dosya seç','Single click: paste target · Double click: choose file');
}
function populateFxControls(){
  if(!current)return;
  const currencyList=$('ocCurrencyOptions');
  if(currencyList)currencyList.innerHTML=currencyPool(current).map(c=>`<option value="${safe(c)}" data-label="${safe(c)}"></option>`).join('');
  const requested=current.meta.fxMonth||currentMonthKey(),months=new Set([requested,...Object.keys(BLFX.store.months||{})]);
  const sorted=[...months].filter(m=>/^\d{4}-\d{2}$/.test(m)).sort().reverse();
  const monthList=$('ocFxMonthOptions');
  if(monthList)monthList.innerHTML=sorted.map(m=>`<option value="${m}" data-label="${safe(fxMonthLabel(m))}"></option>`).join('');
}
function syncStaticLanguage(){
  const searchEl=$('ocSearch');if(searchEl)searchEl.placeholder=tx('Model, üretici veya sezon ara…','Search model, manufacturer or season…');
  document.querySelectorAll('[data-kind="oc-meta-suggest"]').forEach(el=>el.placeholder=tx('Yaz veya seç…','Type or select…'));
  const upload=$('ocImageUploadBtn'),remove=$('ocImageRemoveBtn');if(upload){upload.title=tx('Dosya Seç','Choose File');upload.setAttribute('aria-label',upload.title);}if(remove){remove.title=tx('Kaldır','Remove');remove.setAttribute('aria-label',remove.title);}
  populateFxControls();
}
function renderMetaValues(){
  populateFxControls();
  document.querySelectorAll('[data-oc-meta]').forEach(el=>{const value=current.meta[el.dataset.ocMeta]??'';el.value=el.dataset.ocNumber?formatByKind(value,el.dataset.ocNumber):value;});
  autoGrowCostTextareas($('ocEditor')||document);
}
/* Seçili çalışma yokken sağ alan boş beyaz kalmasın: tek yönlendirme. */
function renderWorkspaceEmpty(show){
  const host=$('ocWorkspaceEmpty');if(!host)return;
  host.hidden=!show;if(!show)return;
  const view={kind:'empty',icon:'calculator',
    title:tx('Bir maliyet çalışması seç','Select a costing sheet'),
    detail:tx('Soldaki listeden bir çalışma aç ya da yeni bir ön maliyet başlat. Formüller ve kur dönüşümleri otomatik hesaplanır.','Open a sheet from the list or start a new preliminary costing. Formulas and FX conversions are calculated automatically.'),
    actionLabel:tx('Yeni Maliyet','New Costing'),actionPrimary:true,actionOnce:false,
    onAction:()=>$('ocNewBtn')?.click()};
  if(window.BLUI&&typeof window.BLUI.renderState==='function')window.BLUI.renderState(host,view);
  else host.textContent=view.title;
}
function renderEditor(){
  syncStaticLanguage();
  ['ocDuplicateBtn','ocDeleteBtn','ocExportBtn'].forEach(id=>{const btn=$(id);if(btn)btn.disabled=!current;});
  const editor=$('ocEditor');renderWorkspaceEmpty(!current);
  if(!current){if(editor)editor.hidden=true;renderRecordList();return;}
  if(editor)editor.hidden=false;
  $('ocTitle').value=current.title||'';renderMetaValues();renderImagePanel();
  renderSections();renderSummary();updateCalculatedDom();renderRecordList();setDirty(dirty);buildSuggestions();
}
function canLeave(){return !dirty||confirm(tx('Kaydedilmemiş değişiklikler var. Devam edersen bu değişiklikler kaybolacak.','There are unsaved changes. They will be lost if you continue.'));}
function selectRecord(id){if(current&&current.id===id)return;if(!canLeave())return;const hit=records.find(r=>r.id===id);if(!hit)return;current=normalizeRecord(hit);imagePasteActive=false;setDirty(false);renderEditor();}
async function load(){if(loaded){buildSuggestions();return;}loaded=true;try{await BLFX.load();const data=await request('/api/open-costing');storeRevision=Number(data._revision)||0;records=(data.items||[]).map(normalizeRecord);renderRecordList();if(records.length){current=clone(records[0]);setDirty(false);renderEditor();}else renderWorkspaceEmpty(!current);}catch(err){loaded=false;show(err.message);}}
function show(msg){if(typeof showToast==='function')showToast(msg);else alert(msg);}
function addRow(section){if(!current)return;current.sections[section].push(emptyRow(current.meta.currency||'USD'));setDirty(true);renderSections();updateCalculatedDom();}
function deleteRow(section,rowId){if(!current)return;current.sections[section]=current.sections[section].filter(r=>r.id!==rowId);setDirty(true);renderSections();updateCalculatedDom();}
function syncModelFromCollection(value,previousModel){
  try{
    const hit=collectionModel(value);if(!hit)return false;
     const mapping={plmId:collectionEffectiveValue(hit,'plmId')||'',season:collectionEffectiveValue(hit,'season')||'',license:collectionEffectiveValue(hit,'lisans')||'',category:collectionEffectiveValue(hit,'urunTipi')||'',quantity:collectionEffectiveValue(hit,'quantity')||'',targetFob:collectionEffectiveValue(hit,'targetPrice')||'',image:collectionEffectiveValue(hit,'img')||''};
    Object.assign(current.meta,mapping);renderMetaValues();renderImagePanel();
    if(!current.title||/^Yeni (Açık|Ön) Maliyet|^New (Open|Preliminary) Costing/.test(current.title)||normalizeText(current.title)===normalizeText(previousModel)){current.title=value;$('ocTitle').value=value;}
    updateCalculatedDom();renderRecordList();return true;
  }catch(e){return false;}
}
function normalizeNumericInput(el){
  if(!el?.dataset?.ocNumber)return;
  const formatted=formatByKind(el.value,el.dataset.ocNumber);el.value=formatted;
  if(!current)return;
  if(el.dataset.ocMeta)current.meta[el.dataset.ocMeta]=formatted;
  else if(el.dataset.rate)current.rates[el.dataset.rate]=formatted;
  else if(el.dataset.section&&el.dataset.row&&el.dataset.field){const row=current.sections[el.dataset.section]?.find(r=>r.id===el.dataset.row);if(row)row[el.dataset.field]=formatted;}
  updateCalculatedDom();
}
function resizeImageDataUrl(dataUrl){
  return new Promise(resolve=>{
    if(!dataUrl||!String(dataUrl).startsWith('data:image/'))return resolve(dataUrl||'');
    const image=new Image();image.onload=()=>{
      const max=1400,scale=Math.min(1,max/Math.max(image.naturalWidth||1,image.naturalHeight||1));
      if(scale===1&&String(dataUrl).length<1400000)return resolve(dataUrl);
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
      const ctx=canvas.getContext('2d');ctx.fillStyle='#FFFFFF';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
      resolve(canvas.toDataURL('image/jpeg',0.88));
    };image.onerror=()=>resolve(dataUrl);image.src=dataUrl;
  });
}
function fileToDataUrl(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=async()=>resolve(await resizeImageDataUrl(reader.result));reader.onerror=reject;reader.readAsDataURL(file);});}
async function applyImageFile(file){
  if(!current||!file)return;try{current.meta.image=await fileToDataUrl(file);imagePasteActive=true;setDirty(true);renderImagePanel();show(tx('Model görseli eklendi.','Style image added.'));}catch(e){show(tx('Görsel okunamadı.','Image could not be read.'));}
}
function openImagePicker(){if(!current)return;$('ocImageInput')?.click();}
function activateImagePaste(){if(!current)return;imagePasteActive=true;renderImagePanel();show(tx('Görsel alanı aktif. Panodaki görseli Ctrl+V ile yapıştırabilirsin.','Image area is active. Paste an image with Ctrl+V.'));}
function removeImage(){if(!current||!current.meta.image)return;current.meta.image='';imagePasteActive=false;setDirty(true);renderImagePanel();}
async function save(){
  if(!current)return;current.title=String(current.title||'').trim()||tx('İsimsiz Ön Maliyet','Untitled Preliminary Costing');current.summary=calculate();
  current.fxSnapshot=BLFX.snapshotForMonth(current.meta.fxMonth||currentMonthKey(),current.meta.currency||'USD');
  const btn=$('ocSaveBtn'),old=btn?.innerHTML;if(btn){btn.disabled=true;btn.textContent=tx('Kaydediliyor…','Saving…');}
  try{const isNew=!current.id;const data=await request(isNew?'/api/open-costing':'/api/open-costing/'+encodeURIComponent(current.id),{method:isNew?'POST':'PUT',body:JSON.stringify(current),expectedRevision:storeRevision});records=(data.items||[]).map(normalizeRecord);current=normalizeRecord(data.item||records.find(r=>r.id===current.id));setDirty(false);renderEditor();show(tx('Ön maliyet kaydedildi.','Preliminary costing saved.'));}
  catch(err){show(tx('Kaydetme hatası: ','Save error: ')+err.message);}
  finally{if(btn){btn.innerHTML=old;btn.disabled=!dirty;}}
}
async function remove(){
  if(!current)return;if(!confirm(tx(`“${current.title}” kaydını silmek istiyor musun?`,`Delete “${current.title}”?`)))return;
  try{if(current.id){const data=await request('/api/open-costing/'+encodeURIComponent(current.id),{method:'DELETE',expectedRevision:storeRevision});records=(data.items||[]).map(normalizeRecord);}current=records.length?clone(records[0]):null;imagePasteActive=false;setDirty(false);renderEditor();show(tx('Ön maliyet silindi.','Preliminary costing deleted.'));}catch(err){show(err.message);}
}
function createNew(){if(!canLeave())return;current=defaultRecord();imagePasteActive=false;setDirty(true);renderEditor();setTimeout(()=>$('ocTitle')?.select(),0);}
/* "Çoğalt": maliyetin O ANKİ son halinin birebir kopyasını anında oluşturur ve
   sunucuya kaydeder. Kullanıcının ayrıca "Kaydet" demesine gerek yoktur. */
async function duplicate(){
  if(!current)return;
  const copy=clone(current);
  copy.id=null;copy.createdAt=null;copy.updatedAt=null;
  copy.title=(copy.title||tx('Ön Maliyet','Preliminary Costing'))+tx(' - Kopya',' - Copy');
  Object.values(copy.sections).flat().forEach(r=>r.id=uid('row'));
  const dup=normalizeRecord(copy);
  dup.summary=calculateRecord(dup);
  dup.fxSnapshot=BLFX.snapshotForMonth(dup.meta.fxMonth||currentMonthKey(),dup.meta.currency||'USD');
  const btn=$('ocDuplicateBtn'),old=btn?.innerHTML;
  if(btn){btn.disabled=true;btn.textContent=tx('Kopyalanıyor…','Duplicating…');}
  try{
    const data=await request('/api/open-costing',{method:'POST',body:JSON.stringify(dup),expectedRevision:storeRevision});
    records=(data.items||[]).map(normalizeRecord);
    current=normalizeRecord(data.item||records[0]);
    imagePasteActive=false;setDirty(false);renderEditor();
    show(tx('Maliyetin kopyası oluşturuldu.','A copy of the costing was created.'));
  }catch(err){
    show(tx('Kopyalanamadı: ','Could not duplicate: ')+err.message);
  }finally{
    if(btn){btn.innerHTML=old;btn.disabled=!current;}
  }
}
/* ===========================================================================
   EXCEL DIŞA / İÇE AKTARIM.

   Amaç: ön maliyeti ekranda göründüğü düzende, CANLI FORMÜLLERLE ve
   biçimlendirmesiyle Excel'e taşımak; düzenlenip geri alınabilmesini sağlamak.

   Neden formül: v4.26'ya kadar dışa aktarım hesaplanmış SAYILARI yazıyordu.
   Excel'de bir tüketim ya da birim fiyat değiştirildiğinde hiçbir şey
   güncellenmiyordu; dosya bir ekran görüntüsü gibiydi. Artık satır toplamları,
   grup ara toplamları ve bütün özet zinciri formüldür — Excel kendi hesaplar.

   Döviz çevrimi: satır para birimi kayıt para biriminden farklı olabiliyor.
   Formülün Excel'de de çalışabilmesi için kurlar ayrı bir "Kurlar" sayfasına
   yazılır ve satır formülü oradan VLOOKUP ile okur.

   Geri alma (içe aktarım): her anlamlı satıra J sütununda görünmez bir ANAHTAR
   yazılır (META:, LINE:, RATE:, ID:). İçe aktarım bu anahtarlara bakar, satır
   sırasına değil — böylece Excel'de satır eklenip silinse de dosya okunabilir.
=========================================================================== */
const OC_KEY_COL=9;           // J sütunu: görünmez anahtar
const OC_LINE_COLS=9;         // A..I
const OC_SHEET_FX='Kurlar';

function ocExcelNum(value){const num=Number(value);return Number.isFinite(num)?num:0;}

// Kayıt para birimine göre, satırlarda geçen her para biriminin kuru.
function ocCurrencyRates(record){
  const to=String(record.meta.currency||'USD');
  const snap=fxSnapFor(record);
  const seen=new Set([to]);
  SECTION_DEFS.forEach(d=>(record.sections[d.key]||[]).forEach(r=>{
    const cur=String(r.currency||to).trim();
    if(cur) seen.add(cur);
  }));
  return [...seen].map(cur=>{
    if(cur===to) return [cur,1];
    const rate=BLFX.convert(1,cur,to,snap);
    return [cur,Number.isFinite(rate)?rate:1];
  });
}

function exportExcel(){
  if(!current||typeof XLSX==='undefined'){show(tx('Dışa aktarılacak ön maliyet yok.','There is no preliminary costing to export.'));return;}
  const c=calculate(),cur=String(current.meta.currency||'USD');
  const rows=[];                 // {cells:[...], key:'...'}
  const push=(cells,key)=>{rows.push({cells:cells||[],key:key||''});return rows.length-1;};
  const R=i=>i+1;                // 0 tabanlı satır → Excel satır numarası

  push([tx('ÖN MALİYET','PRELIMINARY COSTING')]);
  push([]);
  push([tx('Model ve Teklif Bilgileri','Style and Quotation Information')]);
  const metaFields=[
    ['title',tx('Maliyet Adı','Costing Name'),current.title],
    ['modelCode',tx('Model / Style','Model / Style'),current.meta.modelCode],
    ['plmId',tx('PLM ID','PLM ID'),String(current.meta.plmId||'').replace(/\.(?=\d{3}(?:\D|$))/g,'')],
    ['manufacturer',tx('Üretici','Manufacturer'),current.meta.manufacturer],
    ['country',tx('Ülke','Country'),current.meta.country],
    ['season',tx('Sezon','Season'),current.meta.season],
    ['license',tx('Lisans','License'),current.meta.license],
    ['category',tx('Kategori','Category'),current.meta.category],
    ['quantity',tx('Sipariş Adedi','Order Quantity'),n(current.meta.quantity)],
    ['currency',tx('Para Birimi','Currency'),cur],
    ['fxMonth',tx('Kur Ayı','FX Month'),String(current.meta.fxMonth||currentMonthKey())],
    ['targetFob',tx('Hedef FOB','Target FOB'),n(current.meta.targetFob)],
    ['notes',tx('Notlar','Notes'),current.meta.notes||''],
  ];
  metaFields.forEach(([key,label,value])=>push([label,value],'META:'+key));
  push([]);

  push([tx('Maliyet Kalemleri','Cost Items')]);
  const headerRow=push([
    tx('Maliyet Grubu','Cost Group'),tx('Maliyet Kalemi','Cost Item'),tx('Açıklama','Description'),
    tx('Birim','Unit'),tx('Tüketim / Adet','Usage / Qty'),tx('Birim Fiyat','Unit Price'),
    tx('Döviz','Currency'),tx('Fire %','Waste %'),tx('Satır Toplamı','Line Total'),
  ]);

  const sectionSubtotalRows=[];
  SECTION_DEFS.forEach(def=>{
    const list=current.sections[def.key]||[];
    if(!list.length) return;
    const sectionTitleRow=push([tr()?def.tr:def.en],'SEC:'+def.key);
    const first=rows.length;
    list.forEach(r=>{
      const i=push([
        tr()?def.tr:def.en, r.item||'', r.details||'', r.unit||'',
        ocExcelNum(r.qty), ocExcelNum(r.unitPrice), String(r.currency||cur),
        pct(r.wastePct)/100, null,
      ],'LINE:'+def.key);
      // Satır toplamı = tüketim × birim fiyat × (1 + fire) × kur
      rows[i].formulas={8:`E${R(i)}*F${R(i)}*(1+H${R(i)})*IFERROR(VLOOKUP(G${R(i)},${OC_SHEET_FX}!$A:$B,2,FALSE),1)`};
    });
    const last=rows.length-1;
    const sub=push([tx('Ara Toplam','Subtotal'),'','','','','','','',null],'SUBTOTAL:'+def.key);
    rows[sub].formulas={8:`SUM(I${R(first)}:I${R(last)})`};
    rows[sub].isSubtotal=true;
    rows[sectionTitleRow].isSectionTitle=true;
    sectionSubtotalRows.push(sub);
  });

  push([]);
  push([tx('Özet','Summary')]);
  const directRow=push([tx('Doğrudan Maliyet','Direct Cost'),null],'CALC:direct');
  rows[directRow].formulas={1:sectionSubtotalRows.length?sectionSubtotalRows.map(i=>`I${R(i)}`).join('+'):'0'};
  rows[directRow].isTotal=true;

  // Oran zinciri: her adım bir öncekinin ara toplamı üzerinden ilerler.
  let baseRow=directRow;
  RATE_DEFS.forEach(def=>{
    const amount=push([tr()?def.tr:def.en,pct(current.rates[def.key])/100,null],'RATE:'+def.key);
    rows[amount].formulas={2:`B${R(baseRow)}*B${R(amount)}`};
    rows[amount].isRate=true;
    const sub=push([tr()?def.subtotalTr:def.subtotalEn,null],'CALC:'+def.subtotal);
    rows[sub].formulas={1:`B${R(baseRow)}+C${R(amount)}`};
    baseRow=sub;
  });
  const fobRow=push([tx('Hesaplanan Birim FOB','Calculated Unit FOB'),null],'CALC:finalFob');
  rows[fobRow].formulas={1:`ROUND(B${R(baseRow)},2)`};
  rows[fobRow].isTotal=true;
  const targetRow=push([tx('Hedef FOB','Target FOB'),ocExcelNum(current.meta.targetFob)],'CALC:target');
  const gapRow=push([tx('Hedef Sapması','Target Gap'),null],'CALC:gap');
  rows[gapRow].formulas={1:`IF(B${R(targetRow)}=0,0,ROUND(B${R(fobRow)}-B${R(targetRow)},2))`};
  const qtyRow=push([tx('Sipariş Adedi','Order Quantity'),ocExcelNum(current.meta.quantity)],'CALC:quantity');
  const orderRow=push([tx('Toplam Sipariş Maliyeti','Total Order Cost'),null],'CALC:orderTotal');
  rows[orderRow].formulas={1:`ROUND(B${R(fobRow)}*B${R(qtyRow)},2)`};
  rows[orderRow].isTotal=true;
  push([]);
  push([tx('Kimlik (silmeyin)','Identity (do not delete)'),String(current.id||'')],'ID:record');

  // ---- Sayfayı kur ----
  const aoa=rows.map(r=>{
    const cells=r.cells.slice(0,OC_LINE_COLS);
    while(cells.length<OC_KEY_COL) cells.push(null);
    cells[OC_KEY_COL]=r.key||null;
    return cells;
  });
  const ws=XLSX.utils.aoa_to_sheet(aoa);
  rows.forEach((r,i)=>{
    Object.entries(r.formulas||{}).forEach(([col,formula])=>{
      const addr=XLSX.utils.encode_cell({r:i,c:Number(col)});
      ws[addr]={t:'n',f:formula,v:0};
    });
  });
  const plm=rows.findIndex(r=>r.key==='META:plmId');
  if(plm>=0){const addr=XLSX.utils.encode_cell({r:plm,c:1});if(ws[addr]){ws[addr].t='s';ws[addr].v=String(ws[addr].v??'');ws[addr].z='@';}}

  ws['!cols']=[{wch:20},{wch:26},{wch:36},{wch:11},{wch:13},{wch:13},{wch:9},{wch:10},{wch:16},{wch:16,hidden:true}];
  ws['!merges']=[XLSX.utils.decode_range('A1:I1')];

  const THIN={style:'thin',color:{rgb:'FFE4E7EC'}};
  const base={font:{name:'Aptos',sz:10,color:{rgb:'FF101828'}},alignment:{vertical:'center',wrapText:true},border:{bottom:THIN}};
  const range=XLSX.utils.decode_range(ws['!ref']);
  for(let rr=0;rr<=range.e.r;rr++){
    const meta=rows[rr]||{};
    for(let cc=0;cc<=range.e.c;cc++){
      const addr=XLSX.utils.encode_cell({r:rr,c:cc}),cell=ws[addr];
      if(!cell)continue;
      cell.s={...base};
      if(rr===0) cell.s={font:{name:'Aptos Display',sz:16,bold:true,color:{rgb:'FFFFFFFF'}},fill:{fgColor:{rgb:'FF1B5FA8'}},alignment:{horizontal:'center',vertical:'center'}};
      else if(rr===headerRow) cell.s={font:{name:'Aptos',sz:10,bold:true,color:{rgb:'FF475467'}},fill:{fgColor:{rgb:'FFF2F4F7'}},alignment:{horizontal:'center',vertical:'center',wrapText:true},border:{top:THIN,bottom:THIN,left:THIN,right:THIN}};
      else if(meta.isSectionTitle) cell.s={font:{name:'Aptos',sz:10,bold:true,color:{rgb:'FF1B5FA8'}},fill:{fgColor:{rgb:'FFEFF4FB'}},alignment:{vertical:'center'},border:{bottom:THIN}};
      else if(meta.isSubtotal) cell.s={font:{name:'Aptos',sz:10,bold:true,color:{rgb:'FF344054'}},alignment:{vertical:'center'},border:{top:THIN,bottom:THIN}};
      else if(meta.isTotal) cell.s={font:{name:'Aptos',sz:11,bold:true,color:{rgb:'FF101828'}},fill:{fgColor:{rgb:'FFF7F9FC'}},alignment:{vertical:'center'},border:{top:THIN,bottom:THIN}};
      // Sayı biçimleri: yüzdeler yüzde, tutarlar iki hane.
      if(String(meta.key||'').startsWith('LINE:')&&(cc===4||cc===5||cc===8)) cell.z='#,##0.00';
      if(String(meta.key||'').startsWith('LINE:')&&cc===7) cell.z='0.00%';
      if(String(meta.key||'').startsWith('RATE:')&&cc===1) cell.z='0.00%';
      if(String(meta.key||'').startsWith('RATE:')&&cc===2) cell.z='#,##0.00';
      if((String(meta.key||'').startsWith('CALC:')||meta.isSubtotal)&&(cc===1||cc===8)) cell.z='#,##0.00';
    }
  }

  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,tx('Ön Maliyet','Preliminary Costing'));
  // Kur sayfası: satır formülleri buradan okur, kullanıcı da düzeltebilir.
  const fx=ocCurrencyRates(current);
  const fxWs=XLSX.utils.aoa_to_sheet([[tx('Para Birimi','Currency'),tx('Kur','Rate')+' → '+cur],...fx]);
  fxWs['!cols']=[{wch:14},{wch:18}];
  XLSX.utils.book_append_sheet(wb,fxWs,OC_SHEET_FX);

  const filename=String(current.title||'Preliminary_Costing').replace(/[\\/:*?"<>|]/g,'_')+'.xlsx';
  XLSX.writeFile(wb,filename);
  show(tx('Ön maliyet formülleriyle Excel’e aktarıldı.','Preliminary costing exported to Excel with formulas.'));
}

/*
 * Anahtarlı satırlardan kayıt kurar. Saf fonksiyon: dosya okuma ve arayüz
 * dışarıda kalır, böylece davranışı testle korunabilir.
 *
 * Yalnız J sütunundaki anahtar önemlidir; satır sırası ve araya eklenen satırlar
 * değil. Dosyadaki kimlik mevcut bir kayda aitse o kayıt TABANIN kendisidir
 * (görsel gibi Excel'de taşınmayan alanlar korunur); değilse yeni kayıt kurulur.
 */
function ocRecordFromKeyedRows(keyed,existingRecords){
  const idRow=keyed.find(k=>k.key==='ID:record');
  const fileId=idRow?String(idRow.row[1]||'').trim():'';
  const existing=fileId?(existingRecords||[]).find(r=>r.id===fileId)||null:null;
  const target=normalizeRecord(existing?clone(existing):{});

  keyed.forEach(({key,row})=>{
    const [kind,name]=String(key).split(':');
    const value=row[1];
    if(kind==='META'){
      if(name==='title') target.title=String(value==null?'':value).trim();
      else if(name==='quantity'||name==='targetFob') target.meta[name]=Number(value)||0;
      else target.meta[name]=value==null?'':String(value).trim();
    }else if(kind==='RATE'){
      // Yüzde hücresi Excel'de kesir olarak durur (0,08 = %8).
      target.rates[name]=Number(value)*100||0;
    }
  });
  if(!/^\d{4}-\d{2}$/.test(String(target.meta.fxMonth||''))) target.meta.fxMonth=currentMonthKey();

  const sections={};
  SECTION_DEFS.forEach(d=>sections[d.key]=[]);
  keyed.forEach(({key,row})=>{
    if(!String(key).startsWith('LINE:')) return;
    const sectionKey=String(key).slice(5);
    if(!sections[sectionKey]) return;
    const currency=String(row[6]||target.meta.currency||'USD').trim();
    sections[sectionKey].push({
      ...emptyRow(target.meta.currency||'USD'),
      item:String(row[1]==null?'':row[1]).trim(),
      details:String(row[2]==null?'':row[2]).trim(),
      unit:String(row[3]==null?'':row[3]).trim()||'adet',
      qty:row[4]==null?'':Number(row[4])||0,
      unitPrice:row[5]==null?'':Number(row[5])||0,
      currency,_currencyAuto:false,
      wastePct:row[7]==null?'':(Number(row[7])*100||0),
    });
  });
  target.sections=sections;
  return {record:target,existing};
}

/* İçe aktarım: dosyayı ANAHTAR sütununa göre okur. Satır sırası veya araya
   eklenen satırlar önemli değildir; yalnız J sütunundaki anahtar sayılır.
   Dosyadaki kimlik mevcut bir kayda aitse o kayıt güncellenir, değilse yeni
   kayıt oluşturulur — hiçbir durumda başka bir kayıt ezilmez. */
async function importExcel(file){
  if(!file) return;
  if(typeof XLSX==='undefined'){show(tx('Excel kitaplığı yüklenmedi.','The Excel library is not loaded.'));return;}
  try{
    const buffer=await file.arrayBuffer();
    const wb=await window.BLFileParser.readWorkbook(buffer,{type:'array',cellFormula:false,cellDates:false});
    const ws=wb.Sheets[wb.SheetNames[0]];
    if(!ws) throw new Error(tx('Sayfa okunamadı.','The sheet could not be read.'));
    const grid=XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:null});
    const keyed=[];
    grid.forEach(row=>{
      const key=String((row&&row[OC_KEY_COL])||'').trim();
      if(key) keyed.push({key,row});
    });
    if(!keyed.length) throw new Error(tx('Bu dosya bu ekrandan aktarılmış bir ön maliyet değil.','This file is not a preliminary costing exported from this screen.'));

    const {record,existing}=ocRecordFromKeyedRows(keyed,records);
    current=normalizeRecord(record);
    if(existing) current.id=existing.id; else delete current.id;
    imagePasteActive=false;
    setDirty(true);
    renderEditor();
    show(existing
      ? tx('Ön maliyet dosyadan güncellendi. Kaydet ile onaylayın.','Preliminary costing updated from the file. Confirm with Save.')
      : tx('Ön maliyet dosyadan yeni kayıt olarak yüklendi. Kaydet ile onaylayın.','Preliminary costing loaded from the file as a new record. Confirm with Save.'));
  }catch(err){
    show(tx('İçe aktarılamadı: ','Could not import: ')+err.message);
  }
}
/* ===================== KARŞILAŞTIRMA (COMPARE) ===================== */
let compareSel=new Set();      // seçili kayıt id'leri
let compareBaseline=null;      // baz alınan kayıt id'si
let compareDisplayCur=null;    // karşılaştırmada gösterim para birimi
function compareRecordName(r){return r.title||tx('İsimsiz Maliyet','Untitled Costing');}
function compareOpen(){
  // Varsayılan seçim: düzenlenen kayıt + listedeki ilk birkaç kayıt (en az 2, ideal 3).
  compareSel=new Set();
  if(current&&current.id)compareSel.add(current.id);
  for(const r of records){ if(compareSel.size>=3)break; if(r.id)compareSel.add(r.id); }
  compareBaseline=current&&current.id&&compareSel.has(current.id)?current.id:[...compareSel][0]||null;
  compareDisplayCur=null;
  const ov=$('ocCompareOverlay');if(ov)ov.hidden=false;
  renderComparePicker();renderCompareResult();
}
function compareClose(){const ov=$('ocCompareOverlay');if(ov)ov.hidden=true;}
function compareToggle(id){
  if(compareSel.has(id))compareSel.delete(id);else compareSel.add(id);
  if(!compareSel.has(compareBaseline))compareBaseline=[...compareSel][0]||null;
  renderComparePicker();renderCompareResult();
}
function renderComparePicker(){
  const host=$('ocComparePicker');if(!host)return;
  if(!records.length){host.innerHTML=`<div class="ocComparePickHint">${tx('Karşılaştırılacak kayıtlı ön maliyet yok.','No saved costings to compare.')}</div>`;return;}
  const chips=records.map(r=>{
    const on=compareSel.has(r.id);
    const meta=[r.meta?.modelCode,r.meta?.manufacturer,r.meta?.season].filter(Boolean).join(' · ');
    return `<button type="button" class="ocComparePickChip ${on?'selected':''}" data-cmp-id="${safe(r.id)}"><span class="ocPickDot">${on?'<svg class="ic"><use href="#i-check"/></svg>':''}</span><span>${safe(compareRecordName(r))}${meta?` <span class="ocComparePickMeta">${safe(meta)}</span>`:''}</span></button>`;
  }).join('');
  host.innerHTML=chips+`<div class="ocComparePickHint">${tx('İpucu: En az 2, dilediğin kadar çalışma seçebilirsin.','Tip: pick at least 2 — as many as you like.')}</div>`;
}
function compareDeltaHtml(value,baseValue,cur,invertGood){
  // invertGood=true → düşük değer iyi (maliyet). Fark = value - base.
  if(baseValue==null||!Number.isFinite(baseValue))return '';
  const diff=roundHalfUp(value-baseValue,2);
  if(Math.abs(diff)<0.005)return `<span class="ocCompareDelta flat">±0</span>`;
  const up=diff>0;
  const dirClass=invertGood?(up?'up':'down'):(up?'down':'up');
  const pct=baseValue?` (${up?'+':''}${roundHalfUp(diff/Math.abs(baseValue)*100,1).toString().replace('.',',')}%)`:'';
  return `<span class="ocCompareDelta ${dirClass}">${up?'+':'−'}${money(Math.abs(diff),cur)}${pct}</span>`;
}
function renderCompareResult(){
  const host=$('ocCompareResult');if(!host)return;
  const items=[...compareSel].map(id=>records.find(r=>r.id===id)).filter(Boolean);
  if(items.length<2){
    host.innerHTML=`<div class="ocCompareEmpty">${tx('Karşılaştırmak için yukarıdan en az iki ön maliyet seç.','Select at least two costings above to compare.')}</div>`;
    return;
  }
  const calcs=items.map(r=>({r,c:calculateRecord(r),cur:r.meta?.currency||'USD',snap:fxSnapFor(r)}));
  if(!calcs.some(x=>x.r.id===compareBaseline))compareBaseline=calcs[0].r.id;
  const base=calcs.find(x=>x.r.id===compareBaseline)||calcs[0];

  // Görüntüleme para birimi: varsayılan baz çalışmanın para birimi. Tüm değerler
  // her çalışmanın KENDİ kur anlık görüntüsüyle bu birime çevrilir.
  const currencyPool=[...new Set(calcs.map(x=>x.cur).concat(BLFX.store.base||'USD',BLFX.allCurrencies?BLFX.allCurrencies():BLFX.displayCurrencies()))];
  if(!compareDisplayCur||!currencyPool.includes(compareDisplayCur))compareDisplayCur=base.cur;
  const dispCur=compareDisplayCur;
  // Her çalışma için dispCur'a dönüştürülebiliyor mu?
  const convFail=[];
  calcs.forEach(x=>{const t=BLFX.convert(1,x.cur,dispCur,x.snap);if(t==null&&x.cur!==dispCur)convFail.push(x.cur);});
  const conv=(value,x)=>{const out=BLFX.convert(value,x.cur,dispCur,x.snap);return out==null?value:out;};
  const anyFail=convFail.length>0;

  const baselineOptions=calcs.map(x=>`<option value="${safe(x.r.id)}" ${x.r.id===compareBaseline?'selected':''}>${safe(compareRecordName(x.r))}</option>`).join('');
  const curOptions=currencyPool.map(c=>`<option value="${c}" ${c===dispCur?'selected':''}>${c}</option>`).join('');
  const legend=`<span class="ocCompareLegend"><b><span class="swatchBest"></span>${tx('En düşük','Lowest')}</b><b><span class="swatchWorst"></span>${tx('En yüksek','Highest')}</b></span>`;
  const warn=anyFail?`<span class="ocFxWarning">${tx(''+[...new Set(convFail)].join(', ')+' için kur yok — bu değerler çevrilmeden gösterildi. Kur Güncelle ile yükleyebilirsin.','No rate for '+[...new Set(convFail)].join(', ')+' — shown unconverted. Load it via Update FX.')}</span>`:'';
  const curPick=`<span class="ocCompareCurrencyPick"><label>${tx('Para birimi','Currency')}:</label><select id="ocCompareCurSelect">${curOptions}</select></span>`;
  const baselineBar=`<div class="ocCompareBaselineBar"><label>${tx('Baz alınan','Baseline')}:</label><select id="ocCompareBaseSelect">${baselineOptions}</select>${curPick}${warn}${legend}</div>`;

  // Sütun başlıkları — her çalışmanın kendi kuru gösterilir
  const colHead=calcs.map(x=>{
    const meta=[x.r.meta?.modelCode,x.r.meta?.manufacturer,x.r.meta?.season].filter(Boolean).join(' · ');
    const isBase=x.r.id===compareBaseline;
    const rateNote=(x.cur!==dispCur)?`<span class="ocColMeta">${safe(x.cur)} → ${safe(dispCur)}${x.snap.month?' · '+safe(fxMonthLabel(x.snap.month)):''}</span>`:'';
    return `<th class="ocColTitle">${safe(compareRecordName(x.r))}${meta?`<span class="ocColMeta">${safe(meta)}</span>`:''}${rateNote}${isBase?`<span class="ocCompareBaseTag">${tx('Baz','Base')}</span>`:''}</th>`;
  }).join('');

  // Bir satır üretici: değerler dispCur'a çevrilir; en iyi/kötü işaretleme + baza göre fark
  function row(label,rawVals,opts){
    opts=opts||{};
    const isCost=opts.cost!==false;const noConv=opts.noConvert===true;
    const vals=rawVals.map((v,i)=>noConv?v:roundHalfUp(conv(v,calcs[i]),2));
    const finite=vals.map(v=>Number.isFinite(v)?v:null).filter(v=>v!=null);
    const min=Math.min(...finite),max=Math.max(...finite);
    const baseIdx=calcs.findIndex(x=>x.r.id===compareBaseline);
    const baseVal=vals[baseIdx];
    const tds=vals.map((v,i)=>{
      const shown=opts.percent?(roundHalfUp(v,2).toString().replace('.',',')+' %'):(noConv?(roundHalfUp(v,0).toLocaleString('tr-TR')):money(v,dispCur));
      let cls='ocNumCell';
      if(opts.mark!==false&&finite.length>1&&min!==max){
        if(v===min)cls+=isCost?' isBest':' isWorst';
        else if(v===max)cls+=isCost?' isWorst':' isBest';
      }
      const delta=(opts.delta!==false&&i!==baseIdx&&!noConv)?compareDeltaHtml(v,baseVal,dispCur,isCost):'';
      return `<td class="${cls}">${shown}${delta}</td>`;
    }).join('');
    const rowCls=opts.rowClass?` class="${opts.rowClass}"`:'';
    return `<tr${rowCls}><td class="ocRowHeadCell">${safe(label)}</td>${tds}</tr>`;
  }
  function groupHead(label){return `<tr class="ocGroupHeadRow"><td class="ocRowHeadCell">${safe(label)}</td>${calcs.map(()=>'<td></td>').join('')}</tr>`;}

  let body='';
  // Maliyet grupları (bölümler)
  body+=groupHead(tx('Maliyet Grupları','Cost Groups'));
  SECTION_DEFS.forEach(d=>{
    const vals=calcs.map(x=>x.c.sectionTotals[d.key]||0);
    if(vals.every(v=>Math.abs(v)<0.005))return; // hiçbir çalışmada kullanılmayan grubu gizle
    body+=row(tr()?d.tr:d.en,vals);
  });
  body+=row(tx('Doğrudan Maliyet','Direct Cost'),calcs.map(x=>x.c.direct),{rowClass:'ocSubtotalMark'});
  // Oran adımları
  body+=groupHead(tx('Oranlar ve Adımlar','Rates & Steps'));
  body+=row(tx('Üretim Firesi','Production Waste'),calcs.map(x=>x.c.productionWaste));
  body+=row(tx('Genel Gider','Overhead'),calcs.map(x=>x.c.overhead));
  body+=row(tx('Finansman','Finance'),calcs.map(x=>x.c.finance));
  body+=row(tx('Kâr','Profit'),calcs.map(x=>x.c.profit),{cost:false});
  // Sonuç
  body+=groupHead(tx('Sonuç','Result'));
  body+=row(tx('Birim FOB','Unit FOB'),calcs.map(x=>x.c.finalFob),{rowClass:'ocTotalRow'});
  body+=row(tx('Hedef FOB','Target FOB'),calcs.map(x=>x.c.target),{mark:false,delta:false});
  body+=row(tx('Hedef Sapması','Target Gap'),calcs.map(x=>x.c.gap),{delta:false});
  body+=row(tx('Sipariş Adedi','Order Quantity'),calcs.map(x=>n(x.r.meta?.quantity)),{mark:false,delta:false,noConvert:true});
  body+=row(tx('Toplam Sipariş Maliyeti','Total Order Cost'),calcs.map(x=>x.c.orderTotal));

  host.innerHTML=baselineBar+`<div class="ocCompareTableWrap"><table class="ocCompareTable"><thead><tr><th class="ocRowHeadCell">${tx('Kalem','Item')}</th>${colHead}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/* ===================== KUR (FX) — uygulama geneli BLFX modülü kullanılır ===================== */
/* Kurlar "Kur Güncelle" ile Kur Tahmin Raporu Excel'inden yüklenir; yön: 1 USD = X döviz. */
function fxSnapFor(record){
  const requested=window.BLOpenCostingEngine.normalizeFxMonth(record?.meta?.fxMonth);
  return BLFX.snapshotForMonth(requested,record?.meta?.currency||'USD');
}
function fxMonthLabel(mk){return BLFX.monthLabel(mk,!tr());}
// Editörde: bu maliyetin hangi kurla çalıştığını gösteren rozet
function fxEditorBadgeHtml(calc){
  if(!current)return '';
  const cur=current.meta.currency||'USD',snap=fxSnapFor(current),base=snap.base||'USD',monthTxt=snap.month?fxMonthLabel(snap.month):'—';
  const staleTag=snap.exact===false?` · ${tx('en yakın ay','nearest month')}`:'';
  let main='';
  if(cur===base)main=`<span class="ocFxBadge">${tx('Hesap para birimi baz ('+base+')','Calculation currency is base ('+base+')')} · ${safe(monthTxt)}${staleTag}</span>`;
  else{const one=BLFX.convert(1,base,cur,snap);main=one==null?`<span class="ocFxBadge none">${tx(cur+' için kur yüklü değil','No rate loaded for '+cur)}</span>`:`<span class="${snap.exact===false?'ocFxBadge stale':'ocFxBadge'}" title="${tx('Seçili kur ayı','Selected FX month')}">1 ${safe(base)} = ${one.toFixed(one>=20?2:4).replace('.',',')} ${safe(cur)} · ${safe(monthTxt)}${staleTag}</span>`;}
  const missing=(calc||calculateRecord(current)).missingCurrencies||[];
  return main+(missing.length?` <span class="ocFxBadge none">${tx('Kur eksik: ','Missing rate: ')}${safe(missing.join(', '))}</span>`:'');
}
/* ---- "Kur Güncelle" dialogu ---- */
let fxPendingImport=null; // {data, stats}
async function fxOpen(){const ov=$('ocFxOverlay');if(ov)ov.hidden=false;fxPendingImport=null;await BLFX.load(true);renderFxDialog();}
function fxCloseDialog(){const ov=$('ocFxOverlay');if(ov)ov.hidden=true;fxPendingImport=null;}
function fxStatusHtml(){
  const st=BLFX.store;const months=Object.keys(st.months||{}).sort();
  if(!months.length)return `<div class="ocFxEmpty">${tx('Henüz kur yüklenmedi. Aylık Kur Tahmin Raporu Excel dosyasını seçerek kurları yükleyebilirsin.','No rates loaded yet. Pick the monthly FX forecast Excel to load rates.')}</div>`;
  const upd=st.updatedAt?(()=>{const d=new Date(st.updatedAt),p=n=>String(n).padStart(2,'0');return isNaN(d)?'—':`${p(d.getDate())}.${p(d.getMonth()+1)}.${String(d.getFullYear()).slice(-2)} ${p(d.getHours())}:${p(d.getMinutes())}`;})():'—';
  const rows=[
    [tx('Baz para birimi','Base currency'),safe(st.base||'USD')],
    [tx('Kapsanan aylar','Months covered'),safe(fxMonthLabel(months[0]))+' → '+safe(fxMonthLabel(months[months.length-1]))+' ('+months.length+')'],
    [tx('Döviz sayısı','Currencies'),(st.currencies||[]).length],
    [tx('Son güncelleme','Last update'),safe(upd)],
    [tx('Kaynak dosya','Source file'),safe(st.sourceFile||'—')],
  ].map(([k,v])=>`<div class="ocFxStatRow"><span>${k}</span><strong>${v}</strong></div>`).join('');
  // Bu ayın öne çıkan kurları
  const snap=BLFX.snapshotFor(null);
  const chips=BLFX.FAVORITES.filter(c=>c!==st.base).map(c=>{
    const t=BLFX.rateText(c,snap);return t?`<span class="ocFxRateChip">${safe(t)}</span>`:'';
  }).filter(Boolean).join('');
  const monthNote=`<p class="ocFxHint">${tx('Bu ay için geçerli kurlar','Rates in effect this month')} (${safe(fxMonthLabel(snap.month))}${snap.exact===false?' · '+tx('en yakın ay','nearest month'):''}):</p>`;
  return `<div class="ocFxStatGrid">${rows}</div>${chips?monthNote+`<div class="ocFxRateChips">${chips}</div>`:''}`;
}
function renderFxDialog(){
  const host=$('ocFxBody');if(!host)return;
  let importHtml='';
  if(fxPendingImport){
    const st=fxPendingImport.stats;
    importHtml=`<div class="ocFxImportSummary">
      <strong>${tx('İçe aktarılmaya hazır','Ready to import')}</strong>
      <span>${tx('Okunan sayfa','Sheets read')}: ${st.sheetCount} · ${tx('Son işlenen sayfa','Last processed sheet')}: ${safe(st.latestSheet)}</span>
      <span>${tx('Kapsam','Coverage')}: ${safe(fxMonthLabel(st.firstMonth))} → ${safe(fxMonthLabel(st.lastMonth))} (${st.monthCount} ${tx('ay','months')}) · ${st.currencyCount} ${tx('döviz','currencies')}</span>
      <span class="ocFxHint">${(fxPendingImport.validation?.warnings||[]).map(item=>safe(tx(item.tr,item.en))+' '+safe(item.currency||'')).join(' · ')}</span>
      <span class="ocFxHint">${tx('Dosya ve sayfa adındaki ay bilgisi kullanılmaz; her sayfadaki tüm tarih sütunları belleğe alınır.','Month text in file and sheet names is ignored; every dated column on every sheet is stored.')}</span>
    </div>`;
  }
  host.innerHTML='<div id="ocFxFolderSync" class="ocFxHint"></div>'+fxStatusHtml()+importHtml;
  BLFX.renderFolderSync($('ocFxFolderSync'));
  const saveBtn=$('ocFxSave');if(saveBtn)saveBtn.disabled=!fxPendingImport;
  const status=$('ocFxStatus');if(status&&!fxPendingImport)status.textContent='';
}
async function fxHandleFile(file){
  if(!file)return;
  const status=$('ocFxStatus');
  try{
    if(status)status.textContent=tx('Excel okunuyor…','Reading Excel…');
    await BLFX.load(true);
    fxPendingImport=await BLFX.importFile(file);
    if(status)status.textContent='';
    renderFxDialog();
  }catch(e){fxPendingImport=null;if(status)status.textContent='';show(tx('Excel okunamadı: ','Could not read Excel: ')+e.message);renderFxDialog();BLFX.showImportRecovery(e);}
}
async function fxSaveImport(){
  if(!fxPendingImport)return;
  const btn=$('ocFxSave');if(btn)btn.disabled=true;
  try{
    if(!BLFX.confirmOlderReport(fxPendingImport.data)){if(btn)btn.disabled=false;return;}
    await BLFX.save(fxPendingImport.data,{expectedRevision:fxPendingImport.revision});
    fxPendingImport=null;
    show(tx('Döviz kurları güncellendi.','FX rates updated.'));
    renderFxDialog();
    if(current)renderEditor();
  }catch(e){show(tx('Kur kaydı hatası: ','FX save error: ')+e.message);if(btn)btn.disabled=false;}
}

window.addEventListener('bl-fx-imported',()=>{fxPendingImport=null;renderFxDialog();if(current)renderEditor();});
function bind(){
  if(bound)return;
  bound=true;
  $('ocNewBtn')?.addEventListener('click',createNew);$('ocDuplicateBtn')?.addEventListener('click',duplicate);$('ocDeleteBtn')?.addEventListener('click',remove);$('ocSaveBtn')?.addEventListener('click',save);$('ocExportBtn')?.addEventListener('click',exportExcel);
  $('ocImportBtn')?.addEventListener('click',()=>{const f=$('ocImportFile');if(f){f.value='';f.click();}});
  $('ocImportFile')?.addEventListener('change',e=>{const file=e.target.files&&e.target.files[0];if(file)void importExcel(file);});
  $('ocCompareBtn')?.addEventListener('click',compareOpen);
  $('ocFxBtn')?.addEventListener('click',fxOpen);
  $('ocFxClose')?.addEventListener('click',fxCloseDialog);
  $('ocFxCancel')?.addEventListener('click',fxCloseDialog);
  $('ocFxSave')?.addEventListener('click',fxSaveImport);
  $('ocFxOverlay')?.addEventListener('click',e=>{if(e.target.id==='ocFxOverlay')fxCloseDialog();});
  $('ocFxFile')?.addEventListener('change',async e=>{const f=e.target.files?.[0];await fxHandleFile(f);e.target.value='';});
  $('ocCompareClose')?.addEventListener('click',compareClose);
  $('ocCompareOverlay')?.addEventListener('click',e=>{if(e.target.id==='ocCompareOverlay')compareClose();});
  $('ocComparePicker')?.addEventListener('click',e=>{const chip=e.target.closest('[data-cmp-id]');if(chip)compareToggle(chip.dataset.cmpId);});
  $('ocCompareResult')?.addEventListener('change',e=>{
    if(e.target.id==='ocCompareBaseSelect'){compareBaseline=e.target.value;renderCompareResult();}
    else if(e.target.id==='ocCompareCurSelect'){compareDisplayCur=e.target.value;renderCompareResult();}
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!$('ocCompareOverlay')?.hidden)compareClose();else if(!$('ocFxOverlay')?.hidden)fxCloseDialog();}});
  $('ocSearch')?.addEventListener('input',e=>{search=e.target.value;renderRecordList();});
  // NOT: 'click' yerine 'mousedown'. Bir alana yazı yazdıktan sonra listeye
  // tıklandığında blur→input→renderRecordList() zinciri butonu DOM'dan
  // kaldırıyor ve 'click' hiç oluşmuyordu (ilk tık yutuluyordu). mousedown
  // yeniden çizimden önce çalıştığı için tek tık her zaman işler.
  $('ocRecordList')?.addEventListener('mousedown',e=>{
    const btn=e.target.closest('[data-id]');
    if(!btn)return;
    e.preventDefault();               // odak kaymasından kaynaklı yeniden çizimi engelle
    selectRecord(btn.dataset.id);
  });
  // Klavye erişilebilirliği: Enter/Space ile de seçilebilsin.
  $('ocRecordList')?.addEventListener('keydown',e=>{
    if(e.key!=='Enter'&&e.key!==' ')return;
    const btn=e.target.closest('[data-id]');
    if(btn){e.preventDefault();selectRecord(btn.dataset.id);}
  });
  $('ocEditor')?.addEventListener('focusin',e=>{const el=e.target;if(el?.dataset?.kind==='oc-meta-suggest')showOcMetaSuggest(el,true);});
  $('ocEditor')?.addEventListener('input',e=>{
    if(!current)return;const el=e.target;if(el?.dataset?.kind==='oc-meta-suggest')showOcMetaSuggest(el);
    if(el.id==='ocTitle'){current.title=el.value;setDirty(true);renderRecordList();return;}
    if(el.dataset.ocMeta){const key=el.dataset.ocMeta,previous=current.meta[key];current.meta[key]=el.value;setDirty(true);if(key==='modelCode')syncModelFromCollection(el.value,previous);if(key==='currency'){current.fxSnapshot=BLFX.snapshotForMonth(current.meta.fxMonth||currentMonthKey(),el.value);}if(key==='fxMonth'){current.fxSnapshot=BLFX.snapshotForMonth(el.value,current.meta.currency||'USD');}updateCalculatedDom();
      // Listeyi yalnızca listede görünen alanlar değiştiğinde yeniden çiz.
      if(['modelCode','manufacturer','season'].includes(key))renderRecordList();
      return;}
    if(el.dataset.rate){current.rates[el.dataset.rate]=el.value;setDirty(true);updateCalculatedDom();return;}
    if(el.dataset.section&&el.dataset.row&&el.dataset.field){const row=current.sections[el.dataset.section].find(r=>r.id===el.dataset.row);if(row){row[el.dataset.field]=el.value;if(el.dataset.field==='currency')row._currencyAuto=false;if(el.classList.contains('ocAutoGrow'))autoGrowCostTextareas(el.parentElement);setDirty(true);updateCalculatedDom();}}
  });
  $('ocEditor')?.addEventListener('focusout',e=>{if(e.target.matches?.('[data-oc-number]'))normalizeNumericInput(e.target);});
  $('ocEditor')?.addEventListener('keydown',e=>{if(handleOcMetaSuggestKeydown(e))return;if(e.key==='Enter'&&e.target.matches?.('[data-oc-number]')){e.preventDefault();e.target.blur();}});
  $('ocEditor')?.addEventListener('click',e=>{const add=e.target.closest('[data-add-section]');if(add){addRow(add.dataset.addSection);return;}const del=e.target.closest('[data-delete-row]');if(del)deleteRow(del.dataset.deleteSection,del.dataset.deleteRow);});
  $('ocImageStage')?.addEventListener('click',activateImagePaste);$('ocImageStage')?.addEventListener('dblclick',openImagePicker);$('ocImageUploadBtn')?.addEventListener('click',openImagePicker);$('ocImageRemoveBtn')?.addEventListener('click',removeImage);
  $('ocPlmSyncBtn')?.addEventListener('click',event=>window.BLModelAssets?.openCurrentViewImageAction?.(event.currentTarget));
  $('ocImageStage')?.addEventListener('contextmenu',event=>{
    if(!current?.meta?.image)return;
    event.preventDefault();event.stopPropagation();
    const anchor=$('ocStyleImage')||$('ocImageStage');
    if(typeof window.BLConfirmImageDelete==='function')window.BLConfirmImageDelete(anchor,{message:tx('Bu model görseli kaldırılsın mı?','Remove this style image?'),onConfirm:async()=>removeImage()});
  });
  $('ocImageInput')?.addEventListener('change',async e=>{const file=e.target.files?.[0];if(file)await applyImageFile(file);e.target.value='';});
  $('ocImageStage')?.addEventListener('mouseenter',e=>{const src=ocDisplayedImageSource();if(src&&typeof kolShowImgPopup==='function')kolShowImgPopup(src,e);});
  $('ocImageStage')?.addEventListener('mousemove',e=>{const pop=$('kolImgPopup');if(pop&&typeof kolPositionPopup==='function')kolPositionPopup(pop,e);});
  $('ocImageStage')?.addEventListener('mouseleave',()=>{if(typeof kolHideImgPopup==='function')kolHideImgPopup();});
  document.addEventListener('mousedown',e=>{if(ocMetaSuggestDrop&&!ocMetaSuggestDrop.contains(e.target)&&e.target!==ocMetaSuggestInput)closeOcMetaSuggest();});
  window.addEventListener('resize',()=>closeOcMetaSuggest());
  window.addEventListener('scroll',e=>{if(ocMetaSuggestDrop&&!ocMetaSuggestDrop.contains(e.target))closeOcMetaSuggest();},true);
  document.addEventListener('paste',async e=>{
    if(document.body.dataset.activeTab!=='opencosting'||!imagePasteActive||!current)return;
    const items=(e.clipboardData||window.clipboardData)?.items;if(!items)return;
    for(const item of items){if(item.type?.startsWith('image/')){const file=item.getAsFile();if(file){e.preventDefault();await applyImageFile(file);}break;}}
  });
  window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
}
async function initOpenCosting(){
  // Open Costing betiği performans için sayfa açıldıktan sonra yüklenebilir.
  // Bu nedenle DOMContentLoaded olayına güvenmeyip her girişte bağlayıcıları
  // idempotent olarak hazırla; aksi halde ekran çizilir ancak hiçbir kontrol
  // tıklanamaz hâlde kalır.
  bind();
  buildSuggestions();
  return load();
}
window.initOpenCosting=initOpenCosting;
/* ---- Dış sayfalardan ön maliyet oluşturma ("Maliyet Oluştur") ----
   CP veya Koleksiyon satırlarından yeni ön maliyet kayıtları üretir ve sunucuya kaydeder.
   Her satır için tek bir kayıt açılır; meta alanları kaynak satırdan doldurulur. */
window.createOpenCostingsFromRows=async function(rows,opts){
  const list=Array.isArray(rows)?rows:[];
  if(!list.length)return {created:0,items:[]};
  const source=(opts&&opts.source)||'';
  if(!loaded){ // liste henüz yüklenmediyse mevcut kayıtları çek (çakışma olmasın)
    try{const data=await request('/api/open-costing');records=(data.items||[]).map(normalizeRecord);loaded=true;}catch(e){}
  }
  const created=[];
  for(const meta of list){
    const rec=defaultRecord();
    rec.title=String(meta.title||'').trim()||tx('Yeni Ön Maliyet','New Preliminary Costing');
    Object.keys(rec.meta).forEach(k=>{ if(meta[k]!=null && meta[k]!=='') rec.meta[k]=String(meta[k]); });
    if(meta.image)rec.meta.image=meta.image;
    rec.meta.notes=[rec.meta.notes,source].filter(Boolean).join(' · ');
    try{
      const saved=await request('/api/open-costing',{method:'POST',body:JSON.stringify(rec),expectedRevision:storeRevision});
      if(saved&&Array.isArray(saved.items))records=saved.items.map(normalizeRecord);
      const item=saved&&saved.item?normalizeRecord(saved.item):null;
      if(item)created.push(item);
    }catch(err){ console.warn('Ön maliyet oluşturulamadı:',err); }
  }
  if(created.length){
    current=clone(created[0]);setDirty(false);
    renderRecordList();renderEditor();buildSuggestions();
  }
  return {created:created.length,items:created};
};
window.renderOpenCostingLanguage=function(){syncStaticLanguage();if(current)renderEditor();else renderRecordList();if(!$('ocCompareOverlay')?.hidden){renderComparePicker();renderCompareResult();}if(!$('ocFxOverlay')?.hidden){renderFxDialog();}};
window.__openCostingTest={parseLocalizedNumber,roundHalfUp,formatEditable,calculateRecord,lineTotal,fxSnapFor,currentMonthKey,normalizeRecord,hasCostValue,finalAlternativeCurrencies,finalAlternativesHtml,buildSuggestions,currencyPool,ocMetaSuggestionItems,ocMetaSuggestionValues,setRecordsForTest(items){records=(items||[]).map(normalizeRecord);}};
function startOpenCostingFeature(){
  bind();
  buildSuggestions();
  if(document.body.dataset.activeTab==='opencosting')void load();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',startOpenCostingFeature,{once:true});
else queueMicrotask(startOpenCostingFeature);
})();
