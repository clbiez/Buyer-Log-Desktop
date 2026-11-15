/* Buyer Log — tablo içi Rapor görünümü (CP / Siparişler / Koleksiyon).
 * Ana tablo kendi yerinde rapor düzenine döner: görünen alanlar BLDetailReportLayout
 * rol gruplarında iki satırlı hücrelere toplanır. Satırlar tablonun o anki filtre,
 * sıralama ve sayfa aralığından gelir (aynı sayfalama çubuğu çalışır). Salt okunurdur:
 * kayıtlar, seçim, düzenleme, dışa aktarma ve filtre durumu değişmez; tabloya dönünce
 * her şey olduğu gibidir. Görünmeyen sekmede çizim yapmaz; dönüşte yeniden çizer.
 */
(function(root){
'use strict';
const doc=root.document;if(!doc)return;
const STORE_PREFIX='buyerlog.tableReportMode.v1.';
const CHUNK=300;
const adapters=new Map(),dirty=new Set(),limits=new Map();
let frame=0;
const isEn=()=>{try{return typeof root.appLang!=='undefined'?root.appLang==='en':doc.documentElement.lang==='en';}catch(_){return false;}};
const L=(tr,en)=>isEn()?en:tr;
const clean=value=>String(value==null?'':value).replace(/\s+/g,' ').trim();
const esc=value=>clean(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function store(){return root.BLStorage||root.localStorage;}
function saved(key){try{return store().getItem(STORE_PREFIX+key)==='1';}catch(_){return false;}}
function save(key,on){try{if(on)store().setItem(STORE_PREFIX+key,'1');else store().removeItem(STORE_PREFIX+key);}catch(_){}}
const modes=new Map();
function isActive(key){if(!modes.has(key))modes.set(key,saved(key));return modes.get(key)===true;}
function register(key,adapter){adapters.set(key,adapter);if(isActive(key))schedule(key);}
function tabVisible(adapter){return doc.body?.dataset?.activeTab===adapter.tab;}
function sourceWrap(adapter){return adapter.table()?.closest?.('.tablewrap')||null;}
function host(key,adapter,create){
  let el=sourceWrap(adapter)?.querySelector(':scope > [data-table-report-inline="'+key+'"]');
  if(el||!create)return el;
  const wrap=sourceWrap(adapter);if(!wrap)return null;
  el=doc.createElement('div');el.className='blTableReportInline';el.dataset.tableReportInline=key;
  el.innerHTML='<div class="blTableReportBar"><b data-tr-title></b><span data-tr-count></span><button type="button" class="tbtn" data-table-report-exit></button></div>'+
    '<table class="blDetailTable blTableReportTable" id="blTableReport-'+key+'"><colgroup></colgroup><thead></thead><tbody></tbody></table>';
  wrap.appendChild(el);
  el.addEventListener('click',event=>{
    if(event.target.closest('[data-table-report-exit]')){setMode(key,false);return;}
    if(event.target.closest('[data-tr-more]')){limits.set(key,(limits.get(key)||CHUNK)+CHUNK);render(key);return;}
    const filter=event.target.closest('[data-tr-filter]');
    if(filter){
      event.preventDefault();event.stopPropagation();
      const menu=filter.closest('details');if(menu)menu.open=false;
      try{adapter.filter?.(filter.dataset.trFilter,filter);}catch(err){console.warn('[rapor görünümü] filtre açılamadı',err);}
    }
  });
  return el;
}
function labels(){return {identity:L('Sipariş / Model','Order / Model'),buyer:L('Buyer / Grup','Buyer / Group'),supplier:L('Üretici / Sezon','Manufacturer / Season'),status:L('Durum / Portföy','Status / Portfolio'),context:L('Sevkiyat / Rota','Shipment / Route')};}
function cellText(field,row){try{const text=clean(field.text(row));return text==='—'?'':text;}catch(_){return '';}}
function cellHtml(col,row,moduleId){
  const parts=col.fields.map(field=>{const text=cellText(field,row);return text?{field,text}:null;}).filter(Boolean);
  if(!parts.length)return '—';
  const layout=root.BLDetailReportLayout,canonical=root.BLCanonicalFields;
  const span=part=>'<span title="'+esc(part.field.label+': '+part.text)+'">'+(col.reportRole==='buyer'&&layout?.fieldId(part.field,moduleId,canonical)==='mag'?'MAG: ':'')+esc(part.text)+'</span>';
  const [primary,...rest]=parts;
  return '<div class="blDetailReportPrimary">'+(col.reportRole==='status'?'<span class="blDetailReportBadge">'+esc(primary.text)+'</span>':span(primary))+'</div>'+
    (rest.length?'<div class="blDetailReportSub">'+rest.map(span).join(' · ')+'</div>':'');
}
function imageCell(row){
  const helper=root.BLDetailImages;if(!helper?.thumbHtml)return '';
  const pick=(...keys)=>{for(const source of [row,row&&row.raw,row&&row.row]){if(!source||typeof source!=='object')continue;for(const key of keys){const v=clean(source[key]);if(v)return v;}}return '';};
  const modelName=pick('modelKod','modelName','model','Model Adı','Model Name','Style Name');
  let plmId=pick('plmId','PLM ID','PLM Id','PLMID');
  try{if(helper.resolvePlmId)plmId=helper.resolvePlmId(plmId,modelName)||plmId;}catch(_){}
  const colourCode=pick('colourCode','ccode','C.Code','Renk Kod','Colour Code'),colour=pick('colour','Colour','Renk');
  const url=helper.sourceFor?.({plmId,colourCode,colour,modelName})||'';
  return helper.thumbHtml(url,{modelId:plmId||modelName,plmId,modelName,colourCode,colour},{title:L('Büyük önizleme için üzerine gelin','Hover for large preview'),allowEmpty:true});
}
function render(key){
  const adapter=adapters.get(key);if(!adapter)return;
  const el=host(key,adapter,true);if(!el)return;
  const wrap=sourceWrap(adapter);
  wrap?.classList.add('blTableReportMode');el.hidden=false;
  const moduleId=adapter.moduleId||key;
  let columns=[],rows=[];
  try{columns=adapter.columns()||[];rows=adapter.rows()||[];}catch(err){console.warn('[rapor görünümü] veri alınamadı',err);}
  const layout=root.BLDetailReportLayout,canonical=root.BLCanonicalFields;
  const projected=layout?layout.project(columns,moduleId,canonical,labels()):columns.map(col=>({...col,fields:[col],reportRole:'field'}));
  const limit=limits.get(key)||CHUNK,shown=rows.slice(0,limit),rest=rows.length-shown.length;
  const images=Boolean(root.BLDetailImages?.thumbHtml)&&adapter.images?.()!==false;
  const span=projected.length+(images?1:0)||1;
  const table=el.querySelector('table');
  const widths=projected.map(col=>Number(col.widthPx)||140);
  table.querySelector('colgroup').innerHTML=(images?'<col style="width:74px">':'')+widths.map(w=>'<col style="width:'+w+'px">').join('');
  // table-layout:fixed: genişlik sütunların toplamıdır; rol grupları sıkışmaz.
  table.style.width=(widths.reduce((sum,w)=>sum+w,0)+(images?74:0))+'px';
  table.querySelector('thead').innerHTML='<tr class="blDetailColumnRow">'+(images?'<th class="blDetailImageHead">'+esc(L('Görsel','Image'))+'</th>':'')+projected.map(col=>{
    const filterable=typeof adapter.filter==='function';
    return '<th data-key="'+esc(col.key)+'"'+(col.reportRole==='number'?' class="blDetailNumeric"':'')+'><div class="blDetailReportHeading"><span>'+esc(col.label)+'</span>'+
      (filterable?'<details class="blDetailReportFilter"><summary aria-label="'+esc(L('Alanları filtrele','Filter fields')+': '+col.label)+'">▾</summary><div>'+
        col.fields.map(field=>'<button type="button" data-tr-filter="'+esc(field.key)+'">'+esc(field.label)+'</button>').join('')+'</div></details>':'')+'</div></th>';
  }).join('')+'</tr>';
  const body=shown.map(row=>'<tr>'+(images?'<td class="blDetailImageCell">'+imageCell(row)+'</td>':'')+projected.map(col=>'<td'+(col.reportRole==='number'?' class="blDetailNumeric"':'')+'>'+cellHtml(col,row,moduleId)+'</td>').join('')+'</tr>').join('');
  table.querySelector('tbody').innerHTML=shown.length?body+(rest>0?'<tr><td class="blDetailMore" colspan="'+span+'"><button type="button" class="tbtn" data-tr-more>'+esc(L('Daha fazla göster','Show more'))+' · '+rest.toLocaleString(isEn()?'en-GB':'tr-TR')+' '+esc(L('satır kaldı','rows left'))+'</button></td></tr>':''):
    '<tr><td class="blDetailEmpty" colspan="'+span+'">'+esc(L('Gösterilecek satır yok.','No rows to display.'))+'</td></tr>';
  el.querySelector('[data-tr-title]').textContent=L('Rapor görünümü','Report view');
  const locale=isEn()?'en-GB':'tr-TR';let total=rows.length;try{total=Number(adapter.total?.())||rows.length;}catch(_){}
  el.querySelector('[data-tr-count]').textContent=rows.length.toLocaleString(locale)+' / '+total.toLocaleString(locale)+' '+L('satır · geçerli filtre, sıralama ve sayfa','rows · current filters, sorting and page');
  const exit=el.querySelector('[data-table-report-exit]');exit.textContent=L('Tablo görünümüne dön','Back to table view');
}
function flush(){
  frame=0;
  for(const key of Array.from(dirty)){
    const adapter=adapters.get(key);
    if(!adapter||!isActive(key)){dirty.delete(key);continue;}
    if(!tabVisible(adapter))continue; // Görünmeyen sekme: sekme açılınca tablo yeniden çizilir ve buraya döner.
    dirty.delete(key);render(key);
  }
}
function schedule(key){
  if(!isActive(key))return;
  dirty.add(key);
  if(!frame)frame=root.requestAnimationFrame?root.requestAnimationFrame(flush):root.setTimeout(flush,0);
}
function setMode(key,on){
  const adapter=adapters.get(key);if(!adapter)return false;
  on=Boolean(on);modes.set(key,on);save(key,on);limits.delete(key);
  if(on){dirty.add(key);render(key);dirty.delete(key);}
  else{
    const el=host(key,adapter,false);if(el)el.hidden=true;
    sourceWrap(adapter)?.classList.remove('blTableReportMode');
  }
  // Çizgi stilinde görünüm değişimi yeni bir ekran gibi çizgiyle çizilir (Klasik'te etkisiz).
  try{root.BLMotionPlus?.play?.('frame',sourceWrap(adapter));}catch(_){}
  try{adapter.changed?.(on);}catch(_){}
  return true;
}
function toggle(key){return setMode(key,!isActive(key));}
root.BLTableReportInline=Object.freeze({register,schedule,setMode,toggle,isActive});
})(typeof window!=='undefined'?window:globalThis);
