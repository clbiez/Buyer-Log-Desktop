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

const PREF_PREFIX='buyerlog.detailDrawer.columns.';
const WIDTH_PREFIX='buyerlog.detailDrawer.width.';
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

const REFERENCE_PICTURE_KEYS=new Set(['__picture','__picture__']);
function isReferencePictureKey(key){return REFERENCE_PICTURE_KEYS.has(String(key||''));}
function referenceSetupFor(input){
  const tableKey=clean(input&&input.referenceTable);
  const api=root.BLTableViewSetup;
  if(!tableKey||!api||typeof api.snapshot!=='function')return null;
  try{
    const snapshot=api.snapshot(tableKey);
    if(!snapshot||!Array.isArray(snapshot.columns)||!snapshot.columns.length)return null;
    return snapshot;
  }catch(_){return null;}
}
function referenceRowFor(row){
  if(!active)return row;
  if(typeof active.referenceRow==='function'){
    try{const resolved=active.referenceRow(row);if(resolved&&typeof resolved==='object')return resolved;}catch(_){}
  }
  return row&&typeof row==='object'?(row.raw||row.row||row):row;
}
function referenceColumns(snapshot){
  const tableKey=snapshot&&snapshot.tableKey;
  return (snapshot&&Array.isArray(snapshot.columns)?snapshot.columns:[]).filter(meta=>!isReferencePictureKey(meta.key)).map(meta=>({
    key:meta.key,label:meta.label||meta.key,group:meta.group||'',type:meta.type||'ro',
    weight:Number(meta.weight)||10,widthPx:Number.isFinite(Number(meta.widthPx))?Number(meta.widthPx):null,
    value:row=>{const source=referenceRowFor(row);return source&&typeof source==='object'?source[meta.key]:undefined;},
    format:(value,row)=>{
      const source=referenceRowFor(row),api=root.BLTableViewSetup;
      if(api&&typeof api.text==='function'){
        try{return api.text(tableKey,meta.key,source);}catch(_){}
      }
      return value==null?'':String(value);
    }
  }));
}
function referencePresetState(snapshot,visible,images){
  if(!snapshot||!snapshot.presets)return 'custom';
  const selected=new Set(visible||[]);
  for(const preset of ['focus','extended','all']){
    const keys=Array.isArray(snapshot.presets[preset])?snapshot.presets[preset]:[];
    const textKeys=keys.filter(key=>!isReferencePictureKey(key));
    const wantsImage=keys.some(isReferencePictureKey);
    if(wantsImage!==Boolean(images)||textKeys.length!==selected.size)continue;
    if(textKeys.every(key=>selected.has(key)))return preset;
  }
  return 'custom';
}
function referencePresetHtml(){
  if(!active||!active.referenceSetup)return '';
  const selected=active.referencePreset;
  const labels={focus:L('Odak','Focus'),extended:L('Genişletilmiş','Extended'),all:L('Tümü','All')};
  return '<div class="blDetailPresetGroup" role="group" aria-label="'+escapeHtml(L('Tablo görünümü','Table view'))+'">'+
    '<span class="blDetailPresetLabel">'+escapeHtml(L('GÖRÜNÜM','VIEW'))+'</span>'+
    ['focus','extended','all'].map(preset=>'<button type="button" class="blDetailPreset" data-bl-detail-preset="'+preset+'" aria-pressed="'+String(selected===preset)+'">'+escapeHtml(labels[preset])+'</button>').join('')+
    '</div>';
}
function applyReferencePreset(preset){
  if(!active||!active.referenceTable||!['focus','extended','all'].includes(preset))return false;
  let snapshot=active.referenceSetup;
  try{snapshot=root.BLTableViewSetup?.snapshot?.(active.referenceTable)||snapshot;}catch(_){}
  const keys=snapshot&&snapshot.presets&&Array.isArray(snapshot.presets[preset])?snapshot.presets[preset]:[];
  if(!snapshot||!keys.length)return false;
  active.referenceSetup=snapshot;
  active.columns=normalizeColumns(referenceColumns(snapshot),active.rows);
  const allowed=new Set(active.columns.map(col=>col.key));
  active.visible=keys.filter(key=>!isReferencePictureKey(key)&&allowed.has(key));
  active.images=active.allowImages&&keys.some(isReferencePictureKey);
  active.referencePreset=preset;
  active.limit=RENDER_CHUNK;
  render();
  return true;
}


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
  const modelName=get('model','modelName','modelKod','Model Adı','Model Name','Style Name','Style','Option Adı','Option Name');
  const rawPlmId=get('plmId','PLM ID','PLM Id','PLMID','Plm Kod','PLM Kod','PLM Code');
  let plmId=rawPlmId;
  try{
    if(root.BLDetailImages?.resolvePlmId)plmId=root.BLDetailImages.resolvePlmId(rawPlmId,modelName)||rawPlmId;
  }catch(_){}
  return {
    plmId,
    modelName,
    colourCode:get('colourCode','colorCode','C.Code','Renk Kod','Renk Kodu','Colour Code','Color Code'),
    colour:get('colour','color','Colour','Color','Renk','Renk Tanım','Renk Adı'),
    orderCode:get('orderCode','orderKey','Sipariş Kod','Sipariş Kodu','Order Code','Order No')
  };
}
function imageUrl(row,index){
  const helper=root.BLDetailImages,id=modelIdentity(row);
  if(!helper)return '';
  return helper.urlFrom?.(index,{plmId:id.plmId,colourCode:id.colourCode,colour:id.colour,modelName:id.modelName})||
    helper.sourceFor?.({plmId:id.plmId,colourCode:id.colourCode,colour:id.colour,modelName:id.modelName})||'';
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
function filteredRows(){
  if(!active)return[];
  const q=clean(active.search).toLocaleLowerCase(isEn()?'en-GB':'tr-TR');
  if(!q)return active.rows;
  if(active.filterCache&&active.filterCache.q===q)return active.filterCache.rows;
  const rows=active.rows.filter((row,index)=>searchText(row,index).includes(q));
  active.filterCache={q,rows};return rows;
}
function currentColumns(){if(!active)return[];const set=new Set(active.visible);return active.columns.filter(col=>set.has(col.key));}
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
    active.visible=keys;
    if(active.referenceSetup){
      active.referencePreset=referencePresetState(active.referenceSetup,active.visible,active.images);
      document.querySelectorAll('#blSharedDetailDrawer [data-bl-detail-preset]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.blDetailPreset===active.referencePreset)));
    }else saveVisible(active.scope,active.pageScope,keys);
    renderTable();
  }));
  host.querySelector('[data-bl-detail-column-all]')?.addEventListener('click',()=>{
    if(active.referenceSetup){applyReferencePreset('all');return;}
    active.visible=active.columns.map(c=>c.key);saveVisible(active.scope,active.pageScope,active.visible);renderTable();renderColumnsPanel();
  });
}
function referenceGroupHeader(columns,showImages){
  if(!active||!active.referenceSetup)return '';
  const source=active.referenceSetup.columns||[],picture=source.find(meta=>isReferencePictureKey(meta.key));
  const items=[];
  if(showImages)items.push({group:clean(picture&&picture.group)||L('Sipariş Bilgisi','Order Info')});
  columns.forEach(col=>items.push({group:clean(col.group)||L('Diğer','Other')}));
  if(!items.length)return '';
  const groups=[];
  items.forEach(item=>{
    const last=groups[groups.length-1];
    if(last&&last.group===item.group)last.count++;
    else groups.push({group:item.group,count:1});
  });
  return '<tr class="blDetailGroupRow groupRow">'+groups.map(group=>'<th data-grp="'+escapeHtml(group.group)+'" colspan="'+group.count+'">'+escapeHtml(group.group)+'</th>').join('')+'</tr>';
}
function referenceColgroup(table,columns,showImages){
  const existing=table.querySelector('colgroup');
  if(!active||!active.referenceSetup){
    existing?.remove();table.style.minWidth='';table.style.width='';return;
  }
  const widths=columns.map(col=>Number.isFinite(Number(col.widthPx))?Math.max(44,Math.round(Number(col.widthPx))):120);
  const pictureMeta=(active.referenceSetup.columns||[]).find(meta=>isReferencePictureKey(meta.key));
  const pictureWidth=Number.isFinite(Number(pictureMeta&&pictureMeta.widthPx))?Math.max(44,Math.round(Number(pictureMeta.widthPx))):74;
  const colgroup=existing||document.createElement('colgroup');
  colgroup.innerHTML=(showImages?'<col data-key="__picture" style="width:'+pictureWidth+'px">':'')+
    columns.map((col,index)=>'<col data-key="'+escapeHtml(col.key)+'" style="width:'+widths[index]+'px">').join('');
  if(!existing)table.insertBefore(colgroup,table.firstChild);
  const total=(showImages?pictureWidth:0)+widths.reduce((sum,width)=>sum+width,0);
  table.style.minWidth=total+'px';table.style.width='max(100%, '+total+'px)';
}
function referenceCellClass(col){
  return ['int','num','pct','money','moneyEdit','plm'].includes(String(col&&col.type||''))?'num':'';
}
function renderTable(){
  const host=document.getElementById('blSharedDetailDrawer');if(!host||!active)return;
  const table=host.querySelector('[data-bl-detail-table]'),summary=host.querySelector('[data-bl-detail-summary]');
  if(!table)return;
  const rows=filteredRows(),columns=currentColumns(),helper=root.BLDetailImages;
  const imageIndex=helper?.buildIndex?helper.buildIndex():null,showImages=active.images&&Boolean(helper);
  const shown=rows.slice(0,Math.max(RENDER_CHUNK,active.limit||RENDER_CHUNK)),rest=rows.length-shown.length,colspan=Math.max(1,columns.length+(showImages?1:0));
  table.classList.toggle('hasReferenceSetup',Boolean(active.referenceSetup));
  referenceColgroup(table,columns,showImages);
  const groups=referenceGroupHeader(columns,showImages);
  table.querySelector('thead').innerHTML=groups+'<tr class="blDetailColumnHead">'+
    (showImages?'<th class="blDetailImageHead" data-k="__picture">'+escapeHtml(L('Görsel','Picture'))+'</th>':'')+
    columns.map(col=>'<th data-k="'+escapeHtml(col.key)+'" data-type="'+escapeHtml(col.type||'ro')+'">'+escapeHtml(col.label)+'</th>').join('')+'</tr>';
  table.querySelector('tbody').innerHTML=shown.length?shown.map(row=>'<tr>'+
    (showImages?'<td class="blDetailImageCell">'+imageCell(row,imageIndex)+'</td>':'')+
    columns.map(col=>{
      if(typeof col.html==='function'){let html='';try{html=col.html(row)||'';}catch(_){}return '<td class="'+referenceCellClass(col)+'" data-k="'+escapeHtml(col.key)+'">'+html+'</td>';}
      const value=textValue(col,row),cls=referenceCellClass(col);
      return '<td class="'+cls+'" data-k="'+escapeHtml(col.key)+'" title="'+escapeHtml(value)+'">'+escapeHtml(value||'—')+'</td>';
    }).join('')+'</tr>').join('')+
    (rest>0?'<tr><td class="blDetailMore" colspan="'+colspan+'"><button type="button" class="blDetailTool" data-bl-detail-more>'+escapeHtml(L('Daha fazla göster','Show more'))+' · '+rest.toLocaleString(isEn()?'en-GB':'tr-TR')+' '+escapeHtml(L('satır kaldı','rows left'))+'</button></td></tr>':''):
    '<tr><td class="blDetailEmpty" colspan="'+colspan+'">'+escapeHtml(L('Gösterilecek satır yok.','No rows to display.'))+'</td></tr>';
  if(summary)summary.textContent=(active.subtitle?active.subtitle+' · ':'')+rows.length.toLocaleString(isEn()?'en-GB':'tr-TR')+' '+L('satır','rows');
  registerAssetScope(host.querySelector('.blDetailDrawerPanel'),rows,imageIndex);
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
    '<div class="blDetailDrawerSubbar"><input type="search" data-bl-detail-search value="'+escapeHtml(active.search)+'" placeholder="'+escapeHtml(L('Detaylarda ara…','Search details…'))+'">'+
    referencePresetHtml()+
    '<div class="blDetailExtraActions" data-bl-detail-extra></div><div class="blDetailColumnPanel" data-bl-detail-column-panel hidden></div></div>'+
    (active.note?'<div class="blDetailDrawerNote">'+escapeHtml(active.note)+'</div>':'')+
    '<div class="blDetailTableWrap"><table class="blDetailTable" data-bl-detail-table><thead></thead><tbody></tbody></table></div></section>';
  host.classList.add('is-open');host.setAttribute('aria-hidden','false');
  const panel=host.querySelector('.blDetailDrawerPanel');applyPanelWidth(panel);bindResize(panel);
  host.querySelectorAll('[data-bl-detail-close]').forEach(el=>el.addEventListener('click',close));
  host.querySelector('[data-bl-detail-search]')?.addEventListener('input',event=>{
    active.search=event.target.value;active.limit=RENDER_CHUNK;if(active.searchTimer)clearTimeout(active.searchTimer);
    active.searchTimer=setTimeout(()=>{if(!active)return;active.searchTimer=0;renderTable();},120);
  });
  host.querySelector('[data-bl-detail-table]')?.addEventListener('click',event=>{
    if(!event.target.closest('[data-bl-detail-more]')||!active)return;active.limit=(active.limit||RENDER_CHUNK)+RENDER_CHUNK;renderTable();
  });
  host.querySelectorAll('[data-bl-detail-preset]').forEach(button=>button.addEventListener('click',()=>applyReferencePreset(button.dataset.blDetailPreset)));
  host.querySelector('[data-bl-detail-images]')?.addEventListener('click',()=>{
    active.images=!active.images;
    if(active.referenceSetup)active.referencePreset=referencePresetState(active.referenceSetup,active.visible,active.images);
    render();
  });
  host.querySelector('[data-bl-detail-columns]')?.addEventListener('click',()=>{
    const columnPanel=host.querySelector('[data-bl-detail-column-panel]');columnPanel.hidden=!columnPanel.hidden;if(!columnPanel.hidden)renderColumnsPanel();
  });
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
  const baseColumns=normalizeColumns(input.columns,rows),setup=referenceSetupFor(input);
  const columns=setup?normalizeColumns(referenceColumns(setup),rows):baseColumns;
  const scope=input.storageKey||input.scope||input.source||'generic',page=pageScope(input);
  const allowed=new Set(columns.map(col=>col.key));
  const setupVisible=setup?(setup.visible||[]).filter(key=>!isReferencePictureKey(key)&&allowed.has(key)):null;
  const allowImages=input.images!==false;
  const images=setup?allowImages&&(setup.visible||[]).some(isReferencePictureKey):allowImages;
  active={
    scope,pageScope:page,moduleId:input.moduleId||page,source:input.source||'shared-detail-drawer',
    title:clean(input.title)||L('Sipariş Detayları','Order Details'),
    subtitle:clean(input.subtitle),note:clean(input.note),fileName:input.fileName||input.title,
    rows,columns,visible:setup?setupVisible:loadVisible(scope,page,columns,input.defaultVisible||input.initialVisible),width:loadWidth(page),
    images,allowImages,referenceTable:setup?setup.tableKey:'',referenceSetup:setup,
    referenceRow:typeof input.referenceRow==='function'?input.referenceRow:null,
    referencePreset:setup?referencePresetState(setup,setupVisible,images):'',
    search:'',limit:RENDER_CHUNK,searchIndex:null,filterCache:null,searchTimer:0,actions:Array.isArray(input.actions)?input.actions:[],
    exporter:typeof input.exporter==='function'?input.exporter:null
  };
  render();
  requestAnimationFrame(()=>ensureHost().querySelector('[data-bl-detail-search]')?.focus());
}
function close(){if(active&&active.searchTimer)clearTimeout(active.searchTimer);active=null;const host=document.getElementById('blSharedDetailDrawer');if(host){host.classList.remove('is-open');host.setAttribute('aria-hidden','true');}}
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&active)close();});
return {open,close,inferColumns,normalizeColumns,safeFilePart,isOpen:()=>Boolean(active)};
});