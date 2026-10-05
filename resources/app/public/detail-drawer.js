/* Buyer Log — ortak sağ detay çekmecesi.
 * Detay tabloları tek davranışta toplar: görsel, sütun seçimi, PLM görsel senkronu
 * ve görünen sütunları Excel'e aktarma. İş kuralları bu katmanda tutulmaz.
 */
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root&&root.document)root.BLDetailDrawer=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
'use strict';

const PREF_PREFIX='buyerlog.detailDrawer.report.columns.v1.';
const WIDTH_PREFIX='buyerlog.detailDrawer.width.';
const COL_WIDTH_PREFIX='buyerlog.detailDrawer.report.colWidths.v1.';
const PRESET_PREFIX='buyerlog.detailDrawer.report.preset.v1.';
// Sütun genişliği sınırları: uzun başlık sarılır, sütunu genişletmez.
const COL_MIN=56,COL_MAX=640,COL_FIT_MAX=360,COL_DEFAULT_MAX=240;
// Büyük detay kümelerinde tablo parça parça çizilir; Excel ve arama bütün satırlarla çalışır.
const RENDER_CHUNK=300;
const clean=value=>String(value==null?'':value).replace(/\s+/g,' ').trim();
const safeFilePart=value=>clean(value).replace(/[\\/:*?"<>|]+/g,' ').replace(/\s+/g,' ').trim().slice(0,90)||'BuyerLog_Detail';
const escapeHtml=value=>clean(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function inferColumns(rows){
  const seen=new Set(),out=[];
  (rows||[]).slice(0,40).forEach(row=>Object.keys(row||{}).forEach(key=>{
    if(!key||key.startsWith('_')||seen.has(key))return;
    seen.add(key);out.push({key,label:key});
  }));
  return out;
}
function normalizeColumns(columns,rows){
  const source=Array.isArray(columns)&&columns.length?columns:inferColumns(rows);
  const seen=new Set();
  return source.map((col,index)=>{
    if(typeof col==='string')col={key:col,label:col};
    const key=clean(col&&col.key)||('column_'+index);
    if(seen.has(key))return null;seen.add(key);
    return {...col,key,label:clean(col&&col.label)||key};
  }).filter(Boolean);
}
if(!root||!root.document)return {inferColumns,normalizeColumns,safeFilePart};

const document=root.document;
const isEn=()=>String(document.documentElement.lang||'tr').toLowerCase().startsWith('en');
const L=(tr,en)=>isEn()?en:tr;
const store=()=>root.BLStorage||root.localStorage;
let active=null;

function storagePart(value){return clean(value||'generic').replace(/[^a-z0-9_.-]+/gi,'_');}
function pageScope(input){
  const explicit=clean(input&&input.pageScope);
  if(explicit)return explicit;
  return clean(document.body&&document.body.dataset&&document.body.dataset.activeTab)||'global';
}
function prefKey(scope,page){return PREF_PREFIX+storagePart(page)+'.'+storagePart(scope);}
function loadVisible(scope,page,columns,defaults){
  const allowed=new Set(columns.map(c=>c.key));
  try{
    const raw=JSON.parse(store().getItem(prefKey(scope,page))||'null');
    const selected=Array.isArray(raw)?raw.filter(key=>allowed.has(key)):[];
    if(selected.length)return selected;
  }catch(_){}
  const preferred=Array.isArray(defaults)?defaults.filter(key=>allowed.has(key)):[];
  return preferred.length?preferred:columns.map(c=>c.key);
}
function saveVisible(scope,page,keys){try{store().setItem(prefKey(scope,page),JSON.stringify(keys));}catch(_){}}
function colWidthKey(scope,page){return COL_WIDTH_PREFIX+storagePart(page)+'.'+storagePart(scope);}
function loadColWidths(scope,page){
  try{
    const raw=JSON.parse(store().getItem(colWidthKey(scope,page))||'null');
    return raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
  }catch(_){return {};}
}
function saveColWidths(){if(!active)return;try{store().setItem(colWidthKey(active.scope,active.pageScope),JSON.stringify(active.colWidths||{}));}catch(_){}}
function presetKey(scope,page){return PRESET_PREFIX+storagePart(page)+'.'+storagePart(scope);}
function loadPreset(scope,page){try{const v=clean(store().getItem(presetKey(scope,page))).toLowerCase();return ['focus','extended','all','custom'].includes(v)?v:'';}catch(_){return '';}}
function savePreset(){if(!active||active.tableSetup||!active.viewPresets)return;try{store().setItem(presetKey(active.scope,active.pageScope),active.preset);}catch(_){}}
// Bağlama özel (tableSetup olmayan) Odak/Genişletilmiş görünüm listeleri.
// Tümü her zaman bütün sütunlardır.
function normalizeViewPresets(input,columns){
  const raw=input&&input.viewPresets;
  if(!raw||typeof raw!=='object')return null;
  const allowed=new Set(columns.map(col=>col.key)),out={};
  ['focus','extended'].forEach(name=>{
    const keys=(Array.isArray(raw[name])?raw[name]:[]).map(clean).filter(key=>allowed.has(key));
    if(keys.length)out[name]=[...new Set(keys)];
  });
  if(!out.focus&&!out.extended)return null;
  if(!out.focus)out.focus=out.extended.slice();
  if(!out.extended)out.extended=out.focus.slice();
  return out;
}
function viewPresetVisible(preset){
  if(!active)return[];
  if(preset==='all')return active.columns.map(col=>col.key);
  if(active.tableSetup)return setupVisibleKeys(active.tableSetup,preset,active.contextKeys);
  return active.viewPresets&&active.viewPresets[preset]?active.viewPresets[preset].slice():[];
}

function tableSetupSnapshot(input){
  const tableKey=clean(input&&input.tableSetup);
  if(!tableKey||!root.BLTableViewSetup||typeof root.BLTableViewSetup.snapshot!=='function')return null;
  try{
    const snapshot=root.BLTableViewSetup.snapshot(tableKey);
    return snapshot&&Array.isArray(snapshot.columns)&&snapshot.columns.length?snapshot:null;
  }catch(err){console.warn('Detay çekmecesi tablo görünümü alınamadı:',err);return null;}
}
function setupPresetKeys(snapshot,preset){
  if(!snapshot||!snapshot.presets)return[];
  const keys=snapshot.presets[preset];
  return Array.isArray(keys)?keys.slice():[];
}
function setupInitialPreset(snapshot){
  const preset=clean(snapshot&&snapshot.activePreset).toLowerCase();
  return ['focus','extended','all'].includes(preset)?preset:'custom';
}
function widthKey(page){return WIDTH_PREFIX+storagePart(page);}
function loadWidth(page){
  try{
    const value=Number(store().getItem(widthKey(page)));
    return Number.isFinite(value)&&value>=420?value:null;
  }catch(_){return null;}
}
function saveWidth(page,width){try{store().setItem(widthKey(page),String(Math.round(width)));}catch(_){}}
function ensureHost(){
  let host=document.getElementById('blSharedDetailDrawer');
  if(host)return host;
  host=document.createElement('aside');
  host.id='blSharedDetailDrawer';
  host.className='blDetailDrawer';
  host.setAttribute('aria-hidden','true');
  document.body.appendChild(host);
  return host;
}
function hasValue(value){return value!==undefined&&value!==null&&!(typeof value==='string'&&clean(value)==='');}
function rowSources(row){
  const sources=[row,row&&row.row,row&&row.raw,row&&row.source,row&&row.data].filter(item=>item&&typeof item==='object');
  return [...new Set(sources)];
}
function fieldRefs(col){
  const refs=[col&&col.key,col&&col.label].filter(Boolean),extra=[];
  refs.forEach(ref=>{
    const text=String(ref);
    let match;
    const rx=/\(([^)]+)\)/g;
    while((match=rx.exec(text)))if(clean(match[1]))extra.push(clean(match[1]));
    const without=clean(text.replace(/\([^)]+\)/g,' '));
    if(without)extra.push(without);
  });
  return [...new Set(refs.concat(extra).map(clean).filter(Boolean))];
}
function detailModule(){
  const known=['overview','cp','orders','backlog','collection','lfl','logistics','antrepo','openCosting'];
  const aliases={koleksiyon:'collection',collection:'collection',priceanalysis:'',shipping:'logistics'};
  const candidates=[active&&active.moduleId,active&&active.pageScope,active&&active.scope,active&&active.source].map(clean).filter(Boolean);
  for(const raw of candidates){
    const lower=raw.toLowerCase();
    if(Object.prototype.hasOwnProperty.call(aliases,lower)&&aliases[lower])return aliases[lower];
    for(const id of known){
      const canonical=String(id).toLowerCase();
      if(lower===canonical||lower.startsWith(canonical+'.')||lower.includes('.'+canonical+'.'))return id;
    }
  }
  return '';
}
function lookupValue(col,row){
  const refs=fieldRefs(col),sources=rowSources(row);
  for(const source of sources){
    for(const ref of refs){
      if(Object.prototype.hasOwnProperty.call(source,ref)&&hasValue(source[ref]))return source[ref];
    }
  }
  const canonical=root.BLCanonicalFields,moduleId=detailModule();
  if(canonical&&moduleId){
    for(const ref of refs){
      const id=canonical.canonicalId?.(moduleId,ref);
      if(!id)continue;
      for(const source of sources){
        const value=canonical.canonicalValue?.(source,moduleId,id);
        if(hasValue(value))return value;
      }
    }
  }
  const token=canonical&&canonical.token?canonical.token:(value=>String(value==null?'':value).toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim());
  const wanted=[...new Set(refs.map(token).filter(Boolean))];
  for(const source of sources){
    const keys=Object.keys(source);
    for(const key of keys){
      if(wanted.includes(token(key))&&hasValue(source[key]))return source[key];
    }
  }
  return undefined;
}
function rawValueOf(col,row){
  try{
    let value;
    if(typeof col.value==='function'){
      value=col.value(row);
      if(!hasValue(value))value=lookupValue(col,row);
    }else value=lookupValue(col,row);
    return value;
  }catch(_){return undefined;}
}
const columnSchemaCache=new WeakMap();
function columnSchema(col,rows){
  const resolver=root.BLColumnSchema&&root.BLColumnSchema.resolveColumnSchema;
  if(typeof resolver!=='function'||!col)return null;
  const sourceRows=Array.isArray(rows)?rows:[];
  const cached=columnSchemaCache.get(col);
  if(cached&&cached.rows===sourceRows)return cached.schema;
  try{
    const schema=resolver({...col,field:col.field||col.key},sourceRows,col.sourceMetadata||col.metadata);
    columnSchemaCache.set(col,{rows:sourceRows,schema});
    return schema;
  }catch(_){return null;}
}
function fallbackDateText(value){
  if(!(value instanceof Date)||Number.isNaN(value.getTime()))return '';
  if(typeof root.fmtDate==='function')return root.fmtDate(value);
  const p=n=>String(n).padStart(2,'0');
  return p(value.getDate())+'.'+p(value.getMonth()+1)+'.'+String(value.getFullYear()).slice(-2);
}
function valueOf(col,row){
  try{
    const value=rawValueOf(col,row);
    if(typeof col.format==='function')return col.format(value,row);
    if(!hasValue(value))return '';
    const schema=columnSchema(col,active&&active.rows||[row]);
    if(value instanceof Date&&!Number.isNaN(value.getTime())&&(!schema||!['date','datetime'].includes(schema.dataType)))return fallbackDateText(value);
    if(schema&&['integer','quantity','decimal','currency'].includes(schema.dataType)){
      const number=schema.parse?.(value);
      if(typeof number==='number'&&Number.isFinite(number))return number.toLocaleString(isEn()?'en-GB':'tr-TR',{minimumFractionDigits:schema.dataType==='currency'?2:0,maximumFractionDigits:['integer','quantity'].includes(schema.dataType)?0:2});
    }
    if(schema&&typeof schema.format==='function')return schema.format(value,{row});
    if(value instanceof Date&&!Number.isNaN(value.getTime()))return fallbackDateText(value);
    if(typeof value==='object')return JSON.stringify(value);
    return value;
  }catch(_){return '';}
}
function excelValueOf(col,row){
  const raw=rawValueOf(col,row);
  if(!hasValue(raw))return '';
  const schema=columnSchema(col,active&&active.rows||[row]);
  if(raw instanceof Date&&!Number.isNaN(raw.getTime())&&(!schema||!['date','datetime'].includes(schema.dataType)))return raw;
  if(schema&&typeof schema.excelValue==='function')return schema.excelValue(raw,{row});
  if(typeof col.exportValue==='function')return col.exportValue(raw,row);
  if(col.type==='number'&&typeof raw==='number')return raw;
  if(typeof col.format==='function')return col.format(raw,row);
  if(schema&&typeof schema.exportValue==='function')return schema.exportValue(raw,{row});
  return typeof raw==='object'&&!(raw instanceof Date)?JSON.stringify(raw):raw;
}
function excelFormatOf(col,row){
  const raw=rawValueOf(col,row),schema=columnSchema(col,active&&active.rows||[row]);
  const format=schema&&typeof schema.excelNumberFormat==='function'?schema.excelNumberFormat(raw,{row}):'';
  if(format)return format;
  return raw instanceof Date&&!Number.isNaN(raw.getTime())?(root.BLExcelDates?.DATE_FORMAT||'dd.mm.yy'):'';
}
function textValue(col,row){const value=valueOf(col,row);return value==null?'':String(value);}
function modelIdentity(row){
  const nested=row&&typeof row==='object'?(row.row||row.raw||null):null;
  const get=(...keys)=>{
    for(const source of [row,nested]){
      if(!source)continue;
      for(const key of keys){const v=source[key];if(v!=null&&clean(v))return clean(v);}
    }
    return '';
  };
  /* Backlog detay satırı PLM ID/renk/model kimliğini görünmeyen iç meta
     alanlarında (_plmId/_colourCode/_modelName) taşır. Bunlar okunmazsa
     istemci PLM ID'yi model adından çözemez ve PLM SYNC'in kaydettiği
     görsel tabloya hiç işlenmez. */
  const modelName=get('model','modelName','modelKod','Model Adı','Model Name','Style Name','Style','Option Adı','Option Name','_modelName');
  const rawPlmId=get('plmId','plm','_plmId','PLM ID','PLM Id','PLMID','Plm Kod','PLM Kod','PLM Code');
  let plmId=rawPlmId;
  try{
    if(root.BLDetailImages?.resolvePlmId)plmId=root.BLDetailImages.resolvePlmId(rawPlmId,modelName)||rawPlmId;
  }catch(_){}
  return {
    plmId,
    modelName,
    colourCode:get('colourCode','ccode','_colourCode','colorCode','C.Code','Renk Kod','Renk Kodu','Colour Code','Color Code'),
    colour:get('colour','color','Colour','Color','Renk','Renk Tanım','Renk Adı'),
    orderCode:get('orderCode','ocode','orderKey','Sipariş Kod','Sipariş Kodu','Order Code','Order No')
  };
}
function imageUrl(row,index){
  const helper=root.BLDetailImages,id=modelIdentity(row);
  if(!helper)return '';
  const directRef=clean(row&&row._imageRef);
  return helper.urlFrom?.(index,{plmId:id.plmId,colourCode:id.colourCode,colour:id.colour,modelName:id.modelName})||
    helper.sourceFor?.({plmId:id.plmId,colourCode:id.colourCode,colour:id.colour,modelName:id.modelName})||
    (directRef?'/api/cp-images/'+encodeURIComponent(directRef):'');
}
function imageCell(row,index){
  const helper=root.BLDetailImages,id=modelIdentity(row);
  if(!helper||!helper.thumbHtml)return '<span class="blDetailNoImage">—</span>';
  const url=imageUrl(row,index);
  return helper.thumbHtml(url,{modelId:id.plmId||id.modelName,plmId:id.plmId,modelName:id.modelName,colourCode:id.colourCode,colour:id.colour},{
    title:L('Büyük önizleme için üzerine gelin','Hover for large preview'),allowEmpty:true
  });
}
function searchText(row,index){
  if(!active.searchIndex)active.searchIndex=new Array(active.rows.length);
  let text=active.searchIndex[index];
  if(text==null){const locale=isEn()?'en-GB':'tr-TR';text=active.columns.map(col=>textValue(col,row).toLocaleLowerCase(locale)).join('\u0001');active.searchIndex[index]=text;}
  return text;
}
/* Sütun filtresi CP başlık filtresiyle aynı değer kümesi mantığını kullanır:
   değerler ekranda görünen (biçimlendirilmiş) metindir, boş küme = filtre yok. */
function cellFilterValue(col,row){return clean(textValue(col,row));}
function columnByKey(key){return active&&(active.columns.find(col=>col.key===key)||reportColumns().find(col=>col.key===key))||null;}
function rowPassesFilters(row,skipKey){
  if(!active||!active.filters)return true;
  for(const [key,set] of active.filters){
    if(key===skipKey||!set||!set.size)continue;
    const col=columnByKey(key);if(!col)continue;
    if(!set.has(cellFilterValue(col,row)))return false;
  }
  return true;
}
function filteredRows(){
  if(!active)return[];
  const q=clean(active.search).toLocaleLowerCase(isEn()?'en-GB':'tr-TR');
  const sig=q+'\u0002'+(active.filterVersion||0);
  if(!q&&!(active.filters&&active.filters.size))return active.rows;
  if(active.filterCache&&active.filterCache.sig===sig)return active.filterCache.rows;
  const rows=active.rows.filter((row,index)=>(!q||searchText(row,index).includes(q))&&rowPassesFilters(row));
  active.filterCache={sig,rows};return rows;
}
function filterValueSort(a,b){
  if(a==='')return 1;if(b==='')return -1;
  return a.localeCompare(b,isEn()?'en-GB':'tr-TR',{numeric:true,sensitivity:'base'});
}
function openColumnFilter(key,anchor){
  const col=columnByKey(key),openPanel=root.openValueFilterPanel;
  if(!col||typeof openPanel!=='function')return;
  const values=new Set(),activeValues=new Set();
  active.rows.forEach(row=>{
    const value=cellFilterValue(col,row);values.add(value);
    if(rowPassesFilters(row,key))activeValues.add(value);
  });
  openPanel({
    anchorEl:anchor,title:col.label,values:[...values].sort(filterValueSort),activeValues,
    selected:new Set(active.filters.get(key)||[]),
    labelFor:value=>value===''?L('(boş)','(blank)'):value,
    onApply:selected=>setColumnFilter(key,selected),
    onRemove:()=>setColumnFilter(key,null)
  });
}
function setColumnFilter(key,selected){
  if(!active)return;
  if(selected&&selected.size)active.filters.set(key,new Set(selected));else active.filters.delete(key);
  active.filterVersion=(active.filterVersion||0)+1;active.limit=RENDER_CHUNK;
  renderTable();
}
function clearColumnFilters(){
  if(!active||!active.filters.size)return;
  active.filters.clear();active.filterVersion=(active.filterVersion||0)+1;active.limit=RENDER_CHUNK;renderTable();
}
function syncFilterTools(){
  const host=document.getElementById('blSharedDetailDrawer');if(!host||!active)return;
  const button=host.querySelector('[data-bl-detail-clear-filters]');if(!button)return;
  const count=active.filters.size;
  button.hidden=!count;
  button.textContent='✕ '+L('Filtreleri Temizle','Clear Filters')+(count?' ('+count+')':'');
}

/* ----- Sütun genişliği: sürükle, çift tıkla sığdır, Sütunları Sığdır ----- */
let measureCtx=null;
function measureText(text,font){
  try{
    if(!measureCtx)measureCtx=document.createElement('canvas').getContext('2d');
    if(measureCtx){measureCtx.font=font;return Math.ceil(measureCtx.measureText(String(text)).width);}
  }catch(_){}
  return Math.ceil(String(text).length*6.4);
}
function tableFonts(){
  const table=document.querySelector('#blSharedDetailDrawer [data-bl-detail-table]');
  let family='Arial, sans-serif',size='11px';
  try{if(table){const cs=root.getComputedStyle(table);family=cs.fontFamily||family;size=cs.fontSize||size;}}catch(_){}
  return {cell:'400 '+size+' '+family,head:'600 11px '+family};
}
// En dar okunabilir genişlik: hücre içeriği tek satır sığar, başlık ise
// kelime kelime sarılır (en uzun kelime + en fazla `lines` satır).
function fitWidthOf(col,maxPx,lines){
  const fonts=tableFonts(),visibleRows=filteredRows(),rows=visibleRows.length?visibleRows:active.rows;
  let data=0;
  if(col.fields)return Math.max(col.widthPx||120,...col.fields.map(field=>fitWidthOf(field,maxPx,lines)));
  const sample=rows.length>600?rows.slice(0,600):rows;
  sample.forEach(row=>{const text=textValue(col,row);if(text)data=Math.max(data,measureText(text,fonts.cell));});
  const label=clean(col.label),longestWord=label.split(' ').reduce((max,word)=>Math.max(max,measureText(word,fonts.head)),0);
  const header=Math.max(longestWord,Math.ceil(measureText(label,fonts.head)/(lines||3)))+22+18;
  return Math.max(COL_MIN,Math.min(maxPx||COL_FIT_MAX,Math.max(data+22,header)));
}
function columnWidth(col){
  const saved=Number(active.colWidths&&active.colWidths[col.key]);
  if(Number.isFinite(saved)&&saved>=COL_MIN)return Math.min(COL_MAX,Math.round(saved));
  if(!active.autoWidths)active.autoWidths={};
  if(active.autoWidths[col.key])return active.autoWidths[col.key];
  const inherited=Number(col.widthPx)||0;
  const px=inherited?Math.max(COL_MIN,Math.min(COL_MAX,Math.round(inherited))):fitWidthOf(col,COL_DEFAULT_MAX,2);
  active.autoWidths[col.key]=px;return px;
}
function applyTableWidth(table,columns,showImages){
  const total=columns.reduce((sum,col)=>sum+columnWidth(col),showImages?74:0);
  table.style.width=total+'px';
}
function fitAllColumns(){
  if(!active)return;
  if(!active.colWidths)active.colWidths={};
  reportColumns().forEach(col=>{active.colWidths[col.key]=fitWidthOf(col);});
  saveColWidths();renderTable();
  root.showToast?.(L('Sütunlar en dar okunabilir genişliğe getirildi.','Columns were fitted to their narrowest readable width.'));
}
function bindColumnResize(table){
  table.querySelectorAll('[data-bl-detail-col-resize]').forEach(grip=>{
    grip.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();});
    grip.addEventListener('dblclick',event=>{
      event.preventDefault();event.stopPropagation();
      const col=columnByKey(grip.dataset.blDetailColResize);if(!col)return;
      active.colWidths[col.key]=fitWidthOf(col);saveColWidths();renderTable();
    });
    grip.addEventListener('pointerdown',event=>{
      if(event.button!==0)return;
      event.preventDefault();event.stopPropagation();
      const key=grip.dataset.blDetailColResize,col=columnByKey(key),th=grip.closest('th');
      if(!col||!th)return;
      const index=[...th.parentElement.children].indexOf(th),colEl=table.querySelectorAll('colgroup col')[index];
      const startX=event.clientX,startPx=Math.round(th.getBoundingClientRect().width)||columnWidth(col);
      const showImages=Boolean(table.querySelector('.blDetailImageCol'));
      const move=ev=>{
        const next=Math.max(COL_MIN,Math.min(COL_MAX,Math.round(startPx+(ev.clientX-startX))));
        active.colWidths[key]=next;
        if(colEl)colEl.style.width=next+'px';
        applyTableWidth(table,reportColumns(),showImages);
      };
      const end=()=>{
        root.removeEventListener('pointermove',move);root.removeEventListener('pointerup',end);
        document.body.classList.remove('blColResizing');
        if(active)saveColWidths();
      };
      document.body.classList.add('blColResizing');
      root.addEventListener('pointermove',move);root.addEventListener('pointerup',end);
    });
  });
}
function currentColumns(){if(!active)return[];const set=new Set(active.visible);return active.columns.filter(col=>set.has(col.key));}

function setupVisibleKeys(snapshot,preset,contextKeys){
  const base=preset==='custom'&&Array.isArray(snapshot&&snapshot.visible)?snapshot.visible:setupPresetKeys(snapshot,preset);
  return [...new Set([...(base||[]),...(contextKeys||[])])];
}
function applyViewPreset(preset){
  if(!active||!(active.tableSetup||active.viewPresets)||!['focus','extended','all'].includes(preset))return false;
  const allowed=new Set(active.columns.map(col=>col.key));
  const next=(active.tableSetup?setupVisibleKeys(active.tableSetup,preset,active.contextKeys):viewPresetVisible(preset)).filter(key=>allowed.has(key));
  if(!next.length)return false;
  active.preset=preset;active.visible=next;savePreset();
  return true;
}
function syncViewPresetButtons(){
  const host=document.getElementById('blSharedDetailDrawer');if(!host||!active)return;
  host.querySelectorAll('[data-bl-detail-view-preset]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.blDetailViewPreset===active.preset)));
}
function viewPresetHtml(){
  if(!active||!(active.tableSetup||active.viewPresets))return'';
  return '<div class="blDetailViewActions" role="group" aria-label="'+escapeHtml(L('Tablo görünümü','Table view'))+'">'+
    '<span class="blDetailViewLabel">'+escapeHtml(L('GÖRÜNÜM','VIEW'))+'</span>'+
    ['focus','extended','all'].map(preset=>{
      const label=preset==='focus'?L('Odak','Focus'):preset==='extended'?L('Genişletilmiş','Extended'):L('Tümü','All');
      return '<button type="button" class="blDetailViewPreset" data-bl-detail-view-preset="'+preset+'" aria-pressed="'+String(active.preset===preset)+'">'+escapeHtml(label)+'</button>';
    }).join('')+'</div>';
}
function groupHeaderHtml(columns,showImages){
  if(!columns.some(col=>clean(col.group)))return'';
  const cells=[];let last='',count=0;
  const flush=()=>{if(count)cells.push('<th colspan="'+count+'" data-group="'+escapeHtml(last)+'">'+escapeHtml(last||L('Detay','Detail'))+'</th>');};
  columns.forEach(col=>{const group=clean(col.group)||L('Detay','Detail');if(count&&group!==last){flush();count=0;}last=group;count++;});
  flush();
  return '<tr class="blDetailGroupRow">'+(showImages?'<th class="blDetailImageHead" aria-hidden="true"></th>':'')+cells.join('')+'</tr>';
}
function registerAssetScope(panel,rows,imageIndex){
  const helper=root.BLDetailImages;if(!helper?.registerScope)return;
  try{
    const index=imageIndex||helper.buildIndex?.();
    helper.registerScope(panel,{
      contextType:'shared-detail-drawer',label:active.title,
      identities:rows.map((row,i)=>{
        const id=modelIdentity(row);
        return {...id,rowId:String(i),hasImage:index?Boolean(imageUrl(row,index)):null};
      }),
      repaint:render
    });
  }catch(err){console.warn('Detay çekmecesi model varlık kapsamı kaydedilemedi:',err);}
}
function renderColumnsPanel(){
  const host=document.querySelector('#blSharedDetailDrawer [data-bl-detail-column-panel]');
  if(!host||!active)return;
  const selected=new Set(active.visible);
  host.innerHTML='<div class="blDetailColumnPanelHead"><b>'+escapeHtml(L('Görünen sütunlar','Visible columns'))+'</b><button type="button" data-bl-detail-column-all>'+escapeHtml(L('Tümü','All'))+'</button></div>'+
    '<div class="blDetailColumnList">'+active.columns.map(col=>'<label><input type="checkbox" value="'+escapeHtml(col.key)+'"'+(selected.has(col.key)?' checked':'')+'><span>'+escapeHtml(col.label)+'</span></label>').join('')+'</div>';
  host.querySelectorAll('input[type="checkbox"]').forEach(input=>input.addEventListener('change',()=>{
    const keys=[...host.querySelectorAll('input[type="checkbox"]:checked')].map(x=>x.value);
    if(!keys.length){input.checked=true;return;}
    active.visible=keys;active.preset='custom';saveVisible(active.scope,active.pageScope,keys);savePreset();renderTable();syncViewPresetButtons();
  }));
  host.querySelector('[data-bl-detail-column-all]')?.addEventListener('click',()=>{
    active.visible=active.columns.map(c=>c.key);active.preset=active.tableSetup||active.viewPresets?'all':'custom';saveVisible(active.scope,active.pageScope,active.visible);savePreset();renderTable();renderColumnsPanel();syncViewPresetButtons();
  });
}
function reportColumns(){
  if(!active)return[];
  const labels={identity:L('Sipariş / Model','Order / Model'),buyer:L('Buyer / Grup','Buyer / Group'),supplier:L('Üretici / Sezon','Manufacturer / Season'),status:L('Durum / Portföy','Status / Portfolio'),context:L('Sevkiyat / Rota','Shipment / Route')};
  return root.BLDetailReportLayout.project(currentColumns(),detailModule(),root.BLCanonicalFields,labels);
}
function reportCell(col,row){
  const parts=col.fields.map(field=>{
    const text=clean(textValue(field,row));if(!text||text==='—')return null;
    let html=escapeHtml(text);
    if(typeof field.html==='function'){try{html=field.html(row)||html;}catch(_){} }
    else{
      const linked=root.BLDetailLinks?.cellHtml?.({column:field.key,label:field.label,value:rawValueOf(field,row),displayValue:text,row,plmId:modelIdentity(row).plmId});
      if(linked!=null)html=linked;
    }
    return {field,text,html};
  }).filter(Boolean);
  if(!parts.length)return '—';
  const primary=parts[0],secondary=parts.slice(1);
  const span=part=>'<span title="'+escapeHtml(part.field.label+': '+part.text)+'">'+part.html+'</span>';
  return '<div class="blDetailReportPrimary">'+(col.reportRole==='status'?'<span class="blDetailReportBadge">'+primary.html+'</span>':span(primary))+'</div>'+
    (secondary.length?'<div class="blDetailReportSub">'+secondary.map(span).join(' · ')+'</div>':'');
}
function renderReportStats(rows){
  const stats=document.querySelector('#blSharedDetailDrawer [data-bl-detail-stats]');if(!stats||!active)return;
  const layout=root.BLDetailReportLayout,moduleId=detailModule(),canonical=root.BLCanonicalFields;
  const find=id=>active.columns.find(col=>layout.fieldId(col,moduleId,canonical)===id);
  const unique=col=>new Set(rows.map(row=>clean(rawValueOf(col,row))).filter(value=>value&&value!=='—')).size;
  const order=find('orderCode'),plm=find('plmId'),model=find('modelName');
  const quantity=(moduleId==='backlog'?find('shipmentQuantity'):null)||find('orderQuantity')||find('collectionQuantity');
  const cards=[{value:rows.length,label:L('satır','lines')}];
  if(order)cards.push({value:unique(order),label:L('sipariş','orders')});
  if(plm||model)cards.push({value:new Set(rows.map(row=>(plm&&clean(rawValueOf(plm,row)))||(model&&clean(rawValueOf(model,row)))).filter(value=>value&&value!=='—')).size,label:L('model','models')});
  if(quantity){
    const values=rows.map(row=>rawValueOf(quantity,row)).map(value=>root.BLColumnSchema?.parseNumber?root.BLColumnSchema.parseNumber(value):(typeof value==='number'?value:null)).filter(value=>typeof value==='number'&&Number.isFinite(value));
    if(values.length)cards.unshift({value:values.reduce((sum,value)=>sum+value,0),label:quantity.label});
  }
  stats.innerHTML=cards.map(card=>'<div><b>'+escapeHtml(card.value.toLocaleString(isEn()?'en-GB':'tr-TR',{maximumFractionDigits:2}))+'</b><span>'+escapeHtml(card.label)+'</span></div>').join('');
}
function renderTable(){
  const host=document.getElementById('blSharedDetailDrawer');if(!host||!active)return;
  const table=host.querySelector('[data-bl-detail-table]'),summary=host.querySelector('[data-bl-detail-summary]');if(!table)return;
  const rows=filteredRows(),columns=reportColumns(),helper=root.BLDetailImages;
  const imageIndex=helper?.buildIndex?helper.buildIndex():null,showImages=active.images&&Boolean(helper);
  const shown=rows.slice(0,Math.max(RENDER_CHUNK,active.limit||RENDER_CHUNK)),rest=rows.length-shown.length,colspan=Math.max(1,columns.length+(showImages?1:0));
  table.querySelector('colgroup').innerHTML=(showImages?'<col class="blDetailImageCol" style="width:74px">':'')+columns.map(col=>'<col style="width:'+columnWidth(col)+'px">').join('');
  applyTableWidth(table,columns,showImages);
  table.querySelector('thead').innerHTML='<tr>'+(showImages?'<th class="blDetailImageHead">'+escapeHtml(L('Görsel','Image'))+'</th>':'')+columns.map(col=>{
    const filtered=col.fields.some(field=>active.filters.has(field.key));
    return '<th data-key="'+escapeHtml(col.key)+'" class="'+(col.reportRole==='number'?'blDetailNumeric ':'')+(filtered?'columnFilterActive':'')+'"><div class="blDetailReportHeading"><span>'+escapeHtml(col.label)+'</span>'+
      '<details class="blDetailReportFilter"><summary aria-label="'+escapeHtml(L('Alanları filtrele','Filter fields')+': '+col.label)+'">▾</summary><div>'+col.fields.map(field=>'<button type="button" data-bl-detail-filter="'+escapeHtml(field.key)+'"'+(active.filters.has(field.key)?' class="filterActive"':'')+'>'+escapeHtml(field.label)+'</button>').join('')+'</div></details></div>'+
      '<span class="colResizer" data-bl-detail-col-resize="'+escapeHtml(col.key)+'" title="'+escapeHtml(L('Sürükleyerek genişliği ayarla · çift tıklayarak sığdır','Drag to resize · double-click to fit'))+'"></span></th>';
  }).join('')+'</tr>';
  bindColumnResize(table);
  table.querySelector('tbody').innerHTML=shown.length?shown.map(row=>'<tr>'+(showImages?'<td class="blDetailImageCell">'+imageCell(row,imageIndex)+'</td>':'')+columns.map(col=>'<td class="'+(col.reportRole==='number'?'blDetailNumeric':'')+'">'+reportCell(col,row)+'</td>').join('')+'</tr>').join('')+
    (rest>0?'<tr><td class="blDetailMore" colspan="'+colspan+'"><button type="button" class="blDetailTool" data-bl-detail-more>'+escapeHtml(L('Daha fazla göster','Show more'))+' · '+rest.toLocaleString(isEn()?'en-GB':'tr-TR')+' '+escapeHtml(L('satır kaldı','rows left'))+'</button></td></tr>':''):
    '<tr><td class="blDetailEmpty" colspan="'+colspan+'">'+escapeHtml(L('Gösterilecek satır yok.','No rows to display.'))+'</td></tr>';
  if(summary)summary.textContent=(active.subtitle?active.subtitle+' · ':'')+rows.length.toLocaleString(isEn()?'en-GB':'tr-TR')+' '+L('satır','rows');
  renderReportStats(rows);syncFilterTools();registerAssetScope(host.querySelector('.blDetailDrawerPanel'),rows,imageIndex);
}

function downloadBuffer(buffer,name,mime){
  const helper=root.BLDetailImages;
  if(helper?.downloadBuffer){helper.downloadBuffer(buffer,name,mime);return;}
  const blob=new Blob([buffer],{type:mime}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
async function exportExcelJsWithImages(columns,rows,fileName){
  const helper=root.BLDetailImages;
  if(!active.images||!helper?.prepareForExcel||!helper?.addToExcel)return false;
  if(root.BLPerf?.ensureLibrary)await root.BLPerf.ensureLibrary('exceljs');
  if(!root.ExcelJS)return false;
  const wb=new root.ExcelJS.Workbook(),ws=wb.addWorksheet(L('Detay','Detail')),imageIndex=helper.buildIndex?.();
  ws.columns=[{header:L('Görsel','Image'),key:'__image',width:12},...columns.map((col,index)=>({header:col.label,key:'c'+index,width:Math.max(11,Math.min(40,Number(col.exportWidth)||18))}))];
  const head=ws.getRow(1);head.height=22;head.font={bold:true};head.alignment={vertical:'middle',wrapText:true};
  rows.forEach(row=>{const excelRow=ws.addRow(['',...columns.map(col=>excelValueOf(col,row))]);excelRow.height=48;columns.forEach((col,index)=>{const fmt=excelFormatOf(col,row);if(fmt)excelRow.getCell(index+2).numFmt=fmt;});});
  for(let start=0;start<rows.length;start+=8){
    const slice=rows.slice(start,start+8);
    const prepared=await Promise.all(slice.map(async row=>{const url=imageUrl(row,imageIndex);if(!url)return null;try{return await helper.prepareForExcel(url);}catch(_){return null;}}));
    prepared.forEach((image,offset)=>{if(image)helper.addToExcel(ws,wb,image,start+offset+2,1,null,{moveAndSizeWithCells:true});});
  }
  ws.views=[{state:'frozen',ySplit:1}];
  if(rows.length)ws.autoFilter={from:{row:1,column:1},to:{row:rows.length+1,column:Math.max(1,columns.length+1)}};
  root.BLExcelDates?.normalizeExcelJsWorkbookDateColumns?.(wb);
  const buffer=await wb.xlsx.writeBuffer();
  downloadBuffer(buffer,fileName,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  return true;
}
function applyPanelWidth(panel){
  if(!panel||!active||root.innerWidth<=760)return;
  const max=Math.max(420,root.innerWidth-24),width=Math.min(max,Math.max(420,Number(active.width)||panel.getBoundingClientRect().width||980));
  panel.style.width=Math.round(width)+'px';
}
function bindResize(panel){
  const handle=panel&&panel.querySelector('[data-bl-detail-resize]');
  if(!handle||root.innerWidth<=760)return;
  handle.addEventListener('pointerdown',event=>{
    event.preventDefault();
    const startX=event.clientX,startWidth=panel.getBoundingClientRect().width;
    const move=ev=>{
      const max=Math.max(420,root.innerWidth-24);
      const next=Math.min(max,Math.max(420,startWidth+(startX-ev.clientX)));
      active.width=next;panel.style.width=Math.round(next)+'px';
    };
    const end=()=>{
      root.removeEventListener('pointermove',move);root.removeEventListener('pointerup',end);
      if(active&&active.width)saveWidth(active.pageScope,active.width);
      document.body.classList.remove('blDetailResizing');
    };
    document.body.classList.add('blDetailResizing');
    root.addEventListener('pointermove',move);root.addEventListener('pointerup',end,{once:true});
  });
}
function toggleExportMenu(){
  const menu=document.querySelector('#blSharedDetailDrawer [data-bl-detail-export-menu]');
  if(menu)menu.hidden=!menu.hidden;
}
async function exportExcel(mode='visible'){
  if(!active)return;
  const button=document.querySelector('#blSharedDetailDrawer [data-bl-detail-excel]'),old=button&&button.textContent;
  if(button){button.disabled=true;button.textContent=L('Hazırlanıyor…','Preparing…');}
  try{
    const columns=mode==='all'?active.columns:currentColumns(),rows=filteredRows(),fileName=safeFilePart(active.fileName||active.title)+'.xlsx';
    if(typeof active.exporter==='function'){
      await active.exporter({rows,columns,includeImages:active.images,fileName,title:active.title,source:active.source,valueOf});
    }else if(!(await exportExcelJsWithImages(columns,rows,fileName))){
      if(!root.XLSX&&root.BLPerf?.ensureLibrary)await root.BLPerf.ensureLibrary('xlsx');
      if(!root.XLSX)throw new Error(L('Excel kütüphanesi yüklenemedi.','Excel library could not be loaded.'));
      const data=[columns.map(c=>c.label),...rows.map(row=>columns.map(col=>excelValueOf(col,row)))];
      const ws=root.XLSX.utils.aoa_to_sheet(data,{cellDates:true});
      rows.forEach((row,rowIndex)=>columns.forEach((col,colIndex)=>{const fmt=excelFormatOf(col,row);if(!fmt)return;const ref=root.XLSX.utils.encode_cell({r:rowIndex+1,c:colIndex}),cell=ws[ref];if(cell)cell.z=fmt;}));
      if(data.length&&columns.length)ws['!autofilter']={ref:root.XLSX.utils.encode_range({r:0,c:0},{r:Math.max(0,data.length-1),c:columns.length-1})};
      ws['!cols']=columns.map(col=>({wch:Math.max(11,Math.min(40,Number(col.exportWidth)||18))}));
      const wb=root.XLSX.utils.book_new();root.XLSX.utils.book_append_sheet(wb,ws,L('Detay','Detail'));
      root.XLSX.writeFile(wb,fileName);
    }
    root.showToast?.(mode==='all'?L('Detay satırları tüm sütunlarla Excel’e aktarıldı.','Detail rows were exported to Excel with all columns.'):L('Görünen detay satırları ve seçili sütunlar Excel’e aktarıldı.','Visible detail rows and selected columns were exported to Excel.'));
  }catch(err){root.showToast?.(err&&err.message?err.message:String(err));}
  finally{if(button){button.disabled=false;button.textContent=old||'⇩ Excel';}}
}
function render(){
  const host=ensureHost();if(!active){host.classList.remove('is-open');host.setAttribute('aria-hidden','true');return;}
  host.innerHTML='<div class="blDetailDrawerBackdrop" data-bl-detail-close></div><section class="blDetailDrawerPanel" role="dialog" aria-modal="true" aria-labelledby="blDetailDrawerTitle">'+
    '<div class="blDetailResizeHandle" data-bl-detail-resize title="'+escapeHtml(L('Genişliği değiştirmek için sürükleyin','Drag to resize'))+'"></div>'+
    '<header class="blDetailDrawerHead"><div class="blDetailDrawerTitle"><b id="blDetailDrawerTitle">'+escapeHtml(active.title)+'</b><span data-bl-detail-summary></span></div>'+
    '<div class="blDetailDrawerActions"><button type="button" class="blDetailTool" data-bl-detail-images aria-pressed="'+(active.images?'true':'false')+'">▧ '+escapeHtml(L('Görseller','Images'))+'</button>'+
    '<span data-bl-detail-plm></span><button type="button" class="blDetailTool" data-bl-detail-columns>☷ '+escapeHtml(L('Sütunlar','Columns'))+'</button>'+
    '<button type="button" class="blDetailTool" data-bl-detail-excel>⇩ Excel</button>'+
    '<div class="blDetailExportMenu" data-bl-detail-export-menu hidden><button type="button" data-bl-export-mode="all">'+escapeHtml(L('Tüm Sütunlarla','All Columns'))+'</button><button type="button" data-bl-export-mode="visible">'+escapeHtml(L('Görünen Sütunlarla','Visible Columns'))+'</button></div>'+
    '<button type="button" class="blDetailClose" data-bl-detail-close aria-label="'+escapeHtml(L('Kapat','Close'))+'">×</button></div></header>'+
    '<div class="blDetailDrawerSubbar">'+viewPresetHtml()+'<input type="search" data-bl-detail-search value="'+escapeHtml(active.search)+'" placeholder="'+escapeHtml(L('Detaylarda ara…','Search details…'))+'">'+
    '<button type="button" class="blDetailTool" data-bl-detail-fit title="'+escapeHtml(L('Tüm sütunları en dar okunabilir genişliğe getir','Fit all columns to the narrowest readable width'))+'">⇔ '+escapeHtml(L('Sütunları Sığdır','Fit Column Width'))+'</button>'+
    '<button type="button" class="blDetailTool" data-bl-detail-clear-filters hidden></button>'+
    '<div class="blDetailExtraActions" data-bl-detail-extra></div><div class="blDetailColumnPanel" data-bl-detail-column-panel hidden></div></div>'+
    '<div class="blDetailReportStats" data-bl-detail-stats></div><div class="blDetailReportAccent"></div>'+
    (active.note?'<div class="blDetailDrawerNote">'+escapeHtml(active.note)+'</div>':'')+
    '<div class="blDetailTableWrap"><table class="blDetailTable" data-bl-detail-table><colgroup></colgroup><thead></thead><tbody></tbody></table></div></section>';
  host.classList.add('is-open');host.setAttribute('aria-hidden','false');
  const panel=host.querySelector('.blDetailDrawerPanel');applyPanelWidth(panel);bindResize(panel);
  host.querySelectorAll('[data-bl-detail-close]').forEach(el=>el.addEventListener('click',close));
  host.querySelector('[data-bl-detail-search]')?.addEventListener('input',event=>{
    // Sorgu hemen state'e yazılır (Excel/yeniden çizim aynı sorguyu görür); yalnız tablo çizimi gecikir.
    if(!active)return;active.search=event.target.value;active.limit=RENDER_CHUNK;if(active.searchTimer)clearTimeout(active.searchTimer);
    active.searchTimer=setTimeout(()=>{if(!active)return;active.searchTimer=0;renderTable();},120);
  });
  host.querySelector('[data-bl-detail-table]')?.addEventListener('click',event=>{
    if(!active)return;
    const filterButton=event.target.closest('[data-bl-detail-filter]');
    if(filterButton){event.preventDefault();event.stopPropagation();const menu=filterButton.closest('details');if(menu)menu.open=false;openColumnFilter(filterButton.dataset.blDetailFilter,filterButton);return;}
    if(!event.target.closest('[data-bl-detail-more]'))return;active.limit=(active.limit||RENDER_CHUNK)+RENDER_CHUNK;renderTable();
  });
  host.querySelector('[data-bl-detail-fit]')?.addEventListener('click',fitAllColumns);
  host.querySelector('[data-bl-detail-clear-filters]')?.addEventListener('click',clearColumnFilters);
  host.querySelector('[data-bl-detail-images]')?.addEventListener('click',()=>{active.images=!active.images;render();});
  host.querySelector('[data-bl-detail-columns]')?.addEventListener('click',()=>{
    const panel=host.querySelector('[data-bl-detail-column-panel]');panel.hidden=!panel.hidden;if(!panel.hidden)renderColumnsPanel();
  });
  host.querySelectorAll('[data-bl-detail-view-preset]').forEach(button=>button.addEventListener('click',()=>{
    if(applyViewPreset(button.dataset.blDetailViewPreset)){render();syncViewPresetButtons();}
  }));
  host.querySelector('[data-bl-detail-excel]')?.addEventListener('click',toggleExportMenu);
  host.querySelectorAll('[data-bl-export-mode]').forEach(button=>button.addEventListener('click',()=>{
    const menu=host.querySelector('[data-bl-detail-export-menu]');if(menu)menu.hidden=true;
    void exportExcel(button.dataset.blExportMode==='all'?'all':'visible');
  }));
  const extra=host.querySelector('[data-bl-detail-extra]');
  (active.actions||[]).forEach(action=>{
    const button=document.createElement('button');button.type='button';button.className='blDetailTool';button.textContent=action.label||L('Aç','Open');
    button.addEventListener('click',()=>{try{action.run?.(filteredRows(),active);}catch(err){console.warn(err);}});extra.appendChild(button);
  });
  const plm=host.querySelector('[data-bl-detail-plm]');
  if(root.BLDetailImages?.modelImagesButtonHtml&&root.BLDetailImages?.bindModelImagesButton){
    const id='blSharedDetailModelImages';plm.innerHTML=root.BLDetailImages.modelImagesButtonHtml(id);root.BLDetailImages.bindModelImagesButton(id);
  }else if(plm)plm.hidden=true;
  renderTable();
}
function open(options){
  const input=options&&typeof options==='object'?options:{};
  const rows=Array.isArray(input.rows)?input.rows.filter(Boolean):[];
  const setup=tableSetupSnapshot(input);
  const contextColumns=normalizeColumns(input.columns,rows);
  const setupColumns=setup?normalizeColumns(setup.columns,rows):[];
  const contextKeys=setup?contextColumns.map(col=>col.key).filter(key=>!setupColumns.some(col=>col.key===key)):[];
  const columns=setup?normalizeColumns([...setupColumns,...contextColumns.filter(col=>!setupColumns.some(base=>base.key===col.key))],rows):contextColumns;
  const scope=input.storageKey||input.scope||input.source||'generic',page=pageScope(input);
  const canonical=root.BLCanonicalFields,moduleId=input.moduleId||input.source||page;
  const focus=[...new Set(root.BLDetailReportLayout.focusKeys(columns,moduleId,canonical,input.defaultVisible||input.initialVisible).concat(contextKeys))];
  const supplied=setup?{focus:setupPresetKeys(setup,'focus'),extended:setupPresetKeys(setup,'extended')}:normalizeViewPresets(input,columns);
  const extended=[...new Set(focus.concat(supplied?.extended||columns.slice(0,24).map(col=>col.key),contextKeys))];
  const viewPresets={focus,extended};
  let preset='focus';
  if(viewPresets){
    const saved=loadPreset(scope,page),fallback=['focus','extended','all'].includes(input.defaultPreset)?input.defaultPreset:'focus';
    preset=saved||fallback;
  }
  const initialVisible=viewPresets&&preset!=='custom'?(preset==='all'?columns.map(col=>col.key):viewPresets[preset])
    :loadVisible(scope,page,columns,input.defaultVisible||input.initialVisible);
  const allowed=new Set(columns.map(col=>col.key));
  active={
    scope,pageScope:page,moduleId:input.moduleId||page,source:input.source||'shared-detail-drawer',
    title:clean(input.title)||L('Sipariş Detayları','Order Details'),
    subtitle:clean(input.subtitle),note:clean(input.note),fileName:input.fileName||input.title,
    rows,columns,visible:initialVisible.filter(key=>allowed.has(key)),width:loadWidth(page)||Math.min(1280,root.innerWidth*0.96),
    tableSetup:null,viewPresets,contextKeys,preset,
    colWidths:loadColWidths(scope,page),autoWidths:null,filters:new Map(),filterVersion:0,
    images:input.images!==false,search:'',limit:RENDER_CHUNK,searchIndex:null,filterCache:null,searchTimer:0,actions:Array.isArray(input.actions)?input.actions:[],
    exporter:typeof input.exporter==='function'?input.exporter:null
  };
  render();
  requestAnimationFrame(()=>ensureHost().querySelector('[data-bl-detail-search]')?.focus());
}
function close(){if(active&&active.searchTimer)clearTimeout(active.searchTimer);if(typeof root.closeHeaderFilter==='function')root.closeHeaderFilter();active=null;const host=document.getElementById('blSharedDetailDrawer');if(host){host.classList.remove('is-open');host.setAttribute('aria-hidden','true');}}
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape'||!active)return;
  // Açık sütun filtresi paneli önce kapanır; çekmece ikinci Escape ile kapanır.
  if(document.querySelector('.colFilterPanel')){if(typeof root.closeHeaderFilter==='function')root.closeHeaderFilter();return;}
  close();
});
if(typeof root.MutationObserver==='function')new root.MutationObserver(()=>{if(active)render();}).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
return {open,close,inferColumns,normalizeColumns,safeFilePart,isOpen:()=>Boolean(active)};
});
