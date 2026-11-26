/* ===================================================================
   KOPYALAMA SÜTUN PROFİLLERİ VE HASSAS SÜTUNLAR (CP · Siparişler · Koleksiyon)

   Kullanıcı talebi: satır kopyalama / dışarı aktarıp başka yere yapıştırma
   için özel sütun seçimi; seçilen sütunlar "hassas" işaretlenebilsin.
   Ctrl+C ve normal Kopyala HİÇ değişmez (tüm görünür sütunlar).

   İki ayrı çıktı vardır:
   1) "Özel sütunlarla kopyala": kullanıcının seçtiği sütunlar, seçtiği sırada.
   2) "Hassaslar gizli kopyala": normal kopyanın görünür sütunları, hassas
      işaretli sütunlar çıkarılarak.

   Hassas listesi varsayılan + kişisel fark olarak saklanır (sensitiveOn /
   sensitiveOff). Böylece sonraki sürümde varsayılana eklenen bir sütun, kullanıcı
   o sütun için açıkça karar vermediyse kendiliğinden hassas gelir; kullanıcının
   kaldırdığı varsayılan ise kaldırılmış kalır.

   Bu dosya yalnız sütun ANAHTARLARIYLA çalışır; satır verisi, hücre metni veya
   pano içeriği burada okunmaz ve saklanmaz.
   =================================================================== */
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BLCopyColumnProfiles=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';

  const MODULES=Object.freeze(['cp','orders','koleksiyon']);
  // Kullanıcıya özel ve hesapla taşınan tercih (user-storage.js önek listeleri).
  const STORAGE_KEY='lcw.copyColumns.v1';
  const CHANGE_EVENT='bl:copy-columns-changed';

  /* Varsayılan hassas sütunlar (sonradan sütun ayarından değiştirilebilir).
     Retail Date, Ex→Retail, MB Week/Month istendi. CP/Siparişler'de MB
     Week/Month sütunu yoktur; aynı bilgiyi taşıyan MB tarihi
     (In-Store (Model Budget)) hassas gelir. Koleksiyon'da MB Date de aynı
     gerekçeyle hassastır. Koleksiyon'un fiyat analizi (Previous Season, LFL,
     Sezon Etkisi, Hedefe Fark), onaylı üretici/fiyat ve Endeksmatik & Avantaj
     grubundaki bütün sütunlar da varsayılan olarak hassastır. */
  const CP_ORDERS_DEFAULT=Object.freeze(['Retail Date','Ex→Retail','In-Store (Model Budget)']); // i18n-ignore — sütun anahtarları
  const DEFAULT_SENSITIVE=Object.freeze({
    cp:CP_ORDERS_DEFAULT,
    orders:CP_ORDERS_DEFAULT,
    koleksiyon:Object.freeze([
      'retail','exToRetail','inStoreWeek','inStoreMonth','inStore',
      '__previousSeason__','__lfl__','__seasonImpact__','__referenceSummary__','__targetDiff__',
      '__confirmedName__','__confirmedPrice__',
      'endeksmatik','ydLanded','trLanded','__landedSummary__',
    ]),
  });
  // Bu gruptaki her sütun (Endeksmatik ayrıntıları, Landed, Avantaj %) varsayılan hassastır.
  const SENSITIVE_GROUPS=Object.freeze({koleksiyon:Object.freeze(['Endeksmatik & Avantaj'])}); // i18n-ignore — grup anahtarı

  const text=value=>value==null?'':String(value);
  const uniqueKeys=list=>{
    const out=[],seen=new Set();
    (Array.isArray(list)?list:[]).forEach(value=>{const key=text(value);if(!key||seen.has(key))return;seen.add(key);out.push(key);});
    return out;
  };
  const validModule=module=>MODULES.includes(module);

  function normalizeEntry(raw){
    const source=raw&&typeof raw==='object'?raw:{};
    return {
      columns:Array.isArray(source.columns)?uniqueKeys(source.columns):null,
      sensitiveOn:uniqueKeys(source.sensitiveOn),
      sensitiveOff:uniqueKeys(source.sensitiveOff),
    };
  }
  function normalizeStore(raw){
    const out={};
    const source=raw&&typeof raw==='object'?raw:{};
    MODULES.forEach(module=>{if(source[module])out[module]=normalizeEntry(source[module]);});
    return out;
  }

  function catalogKeys(catalog){return (Array.isArray(catalog)?catalog:[]).map(item=>text(item&&item.key)).filter(Boolean);}

  function defaultSensitive(module,catalog){
    const out=new Set(DEFAULT_SENSITIVE[module]||[]);
    const groups=new Set(SENSITIVE_GROUPS[module]||[]);
    if(groups.size)(Array.isArray(catalog)?catalog:[]).forEach(item=>{if(item&&groups.has(text(item.group)))out.add(text(item.key));});
    return out;
  }
  function sensitiveSet(module,catalog,entry){
    const current=normalizeEntry(entry);
    const out=defaultSensitive(module,catalog);
    current.sensitiveOn.forEach(key=>out.add(key));
    current.sensitiveOff.forEach(key=>out.delete(key));
    return out;
  }
  // Seçilen hassas kümesini varsayılana göre farka çevirir.
  function sensitiveDiff(module,catalog,chosen){
    const defaults=defaultSensitive(module,catalog);
    const selected=new Set([...(chosen||[])].map(text));
    const keys=catalogKeys(catalog);
    return {
      sensitiveOn:keys.filter(key=>selected.has(key)&&!defaults.has(key)),
      sensitiveOff:keys.filter(key=>!selected.has(key)&&defaults.has(key)),
    };
  }
  // Özel profil: kayıtlı sıra korunur; artık var olmayan sütunlar atlanır.
  function profileKeys(catalog,entry){
    const current=normalizeEntry(entry);
    if(!current.columns)return null;
    const available=new Set(catalogKeys(catalog));
    return current.columns.filter(key=>available.has(key));
  }
  function withoutSensitive(columns,keyOf,sensitive){
    const set=sensitive instanceof Set?sensitive:new Set(sensitive||[]);
    const list=Array.isArray(columns)?columns:[];
    const kept=list.filter(column=>!set.has(text(keyOf(column))));
    return {columns:kept,hidden:list.length-kept.length};
  }
  function orderedByKeys(columns,keyOf,keys){
    const byKey=new Map((Array.isArray(columns)?columns:[]).map(column=>[text(keyOf(column)),column]));
    return (Array.isArray(keys)?keys:[]).map(key=>byKey.get(text(key))).filter(Boolean);
  }

  /* ---------- Kalıcı depolama (kişisel; BLStorage kullanıcı önekiyle) ---------- */
  function storage(){
    if(root.BLStorage&&typeof root.BLStorage.getItem==='function')return root.BLStorage;
    try{return root.localStorage||null;}catch(_){return null;}
  }
  function readStore(){
    const box=storage();if(!box)return {};
    try{return normalizeStore(JSON.parse(box.getItem(STORAGE_KEY)||'{}'));}catch(_){return {};}
  }
  function writeStore(store){
    const box=storage();if(!box)return false;
    try{box.setItem(STORAGE_KEY,JSON.stringify(normalizeStore(store)));return true;}catch(_){return false;}
  }
  function getEntry(module){return normalizeEntry(readStore()[module]);}
  function saveEntry(module,entry){
    if(!validModule(module))return false;
    const store=readStore();store[module]=normalizeEntry(entry);
    const ok=writeStore(store);
    if(ok&&root.document&&typeof root.CustomEvent==='function')root.document.dispatchEvent(new root.CustomEvent(CHANGE_EVENT,{detail:{module}}));
    return ok;
  }

  /* ---------- Düzenleme penceresi ----------
     Modül ilk kullanımda lazy yüklenir (BLPerf._loadScript); stili de pencere ilk
     açılırken aynı sürüm sorgusuyla eklenir. Açılış yolu değişmez. */
  const SCRIPT_SRC=text(root.document&&root.document.currentScript&&root.document.currentScript.src);
  let stylePromise=null;
  function ensureStyle(){
    const doc=root.document;if(!doc)return Promise.resolve();
    if(stylePromise)return stylePromise;
    const href=SCRIPT_SRC?SCRIPT_SRC.replace('copy-column-profiles.js','copy-column-profiles.css').replace(/&h=[0-9a-f]+/,''):'copy-column-profiles.css';
    stylePromise=new Promise(resolve=>{
      const link=doc.createElement('link');link.rel='stylesheet';link.href=href;link.dataset.blCopyColumns='1';
      const timer=root.setTimeout(resolve,4000);
      link.onload=link.onerror=()=>{root.clearTimeout(timer);resolve();};
      doc.head.appendChild(link);
    });
    return stylePromise;
  }
  const isEn=()=>typeof appLang!=='undefined'&&appLang==='en';
  const L=(tr,en)=>isEn()?en:tr;
  const esc=value=>text(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const MODULE_LABELS={cp:['CP Tracker','CP Tracker'],orders:['Siparişler','Orders'],koleksiyon:['Koleksiyon','Collection']};
  let openDialog=null;

  function closeEditor(){if(openDialog){const close=openDialog;openDialog=null;close();}}

  /* options: {module, catalog:[{key,label,group}], visibleKeys:[...], focus:'sensitive'|'profile', onSave(entry)}
     catalog tablonun TÜM sütunlarıdır (gizliler dahil), tablo sırasıyla. */
  function openEditor(options){
    const doc=root.document;if(!doc||!options||!validModule(options.module))return Promise.resolve(false);
    closeEditor();
    return ensureStyle().then(()=>renderEditor(doc,options));
  }
  function renderEditor(doc,options){
    closeEditor();
    const module=options.module,catalog=(Array.isArray(options.catalog)?options.catalog:[]).filter(item=>item&&text(item.key));
    const byKey=new Map(catalog.map(item=>[text(item.key),item]));
    const entry=getEntry(module);
    const saved=profileKeys(catalog,entry);
    const visible=uniqueKeys(options.visibleKeys).filter(key=>byKey.has(key));
    const initialIncluded=saved||visible;
    const draft={
      order:uniqueKeys([...initialIncluded,...catalogKeys(catalog)]),
      included:new Set(initialIncluded),
      sensitive:sensitiveSet(module,catalog,entry),
      query:'',
    };
    const focusSensitive=options.focus==='sensitive';
    const overlay=doc.createElement('div');
    overlay.className='kolSpreadsheetPasteOverlay blCopyColsOverlay';
    const titleId='blCopyColsTitle';
    const moduleLabel=L(...(MODULE_LABELS[module]||['','']));
    overlay.innerHTML=`<div class="kolSpreadsheetPasteCard blCopyColsCard" role="dialog" aria-modal="true" aria-labelledby="${titleId}" tabindex="-1">
      <div class="kolSpreadsheetPasteHead blCopyColsHead">
        <div><b id="${titleId}">${esc(focusSensitive?L('Hassas sütunlar','Sensitive columns'):L('Kopyalama sütunları','Copy columns'))}</b>
        <span>${esc(moduleLabel)} · ${esc(focusSensitive
          ?L('Hassas sütunlar "Hassaslar gizli kopyala" çıktısına girmez. Ctrl+C ve normal Kopyala değişmez.','Sensitive columns are left out of "Copy without sensitive". Ctrl+C and normal Copy are unchanged.')
          :L('"Özel sütunlarla kopyala" yalnız işaretli sütunları bu sırayla kopyalar.','"Copy custom columns" copies only the checked columns, in this order.'))}</span></div>
        <button type="button" class="iconbtn" data-cc-close aria-label="${esc(L('Kapat','Close'))}"><svg class="ic" aria-hidden="true"><use href="#i-x"/></svg></button>
      </div>
      <div class="blCopyColsTools">
        <input type="search" class="blCopyColsSearch" data-cc-search placeholder="${esc(L('Sütun ara','Search columns'))}" aria-label="${esc(L('Sütun ara','Search columns'))}">
        <span class="blCopyColsSummary" data-cc-summary aria-live="polite"></span>
      </div>
      <div class="blCopyColsHeadRow hint" aria-hidden="true"><span>${esc(L('Özel kopya','Custom copy'))}</span><span>${esc(L('Sütun','Column'))}</span><span>${esc(L('Hassas','Sensitive'))}</span><span>${esc(L('Sıra','Order'))}</span></div>
      <div class="blCopyColsList" data-cc-list role="list"></div>
      <div class="kolSpreadsheetPasteFoot blCopyColsFoot">
        <div class="blCopyColsFootStart">
          <button type="button" class="tbtn" data-cc-visible>${esc(L('Görünür sütunları al','Use visible columns'))}</button>
          <button type="button" class="tbtn" data-cc-defaults>${esc(L('Hassasları varsayılana döndür','Reset sensitive to defaults'))}</button>
        </div>
        <div class="blCopyColsFootEnd">
          <button type="button" class="tbtn" data-cc-cancel>${esc(L('Vazgeç','Cancel'))}</button>
          <button type="button" class="tbtn primary" data-cc-save>${esc(L('Kaydet','Save'))}</button>
        </div>
      </div>
    </div>`;
    const card=overlay.querySelector('.blCopyColsCard'),list=overlay.querySelector('[data-cc-list]'),summary=overlay.querySelector('[data-cc-summary]');

    function drawSummary(){
      const included=draft.order.filter(key=>draft.included.has(key)).length;
      const sensitive=draft.order.filter(key=>draft.sensitive.has(key)).length;
      summary.textContent=L(`${included} sütun özel kopyada · ${sensitive} hassas`,`${included} column(s) in custom copy · ${sensitive} sensitive`);
    }
    function draw(){
      const query=draft.query.toLocaleLowerCase(isEn()?'en-US':'tr-TR');
      const rows=draft.order.map((key,index)=>{
        const item=byKey.get(key);if(!item)return '';
        const label=text(item.label||key);
        if(query&&!label.toLocaleLowerCase(isEn()?'en-US':'tr-TR').includes(query)&&!key.toLowerCase().includes(query))return '';
        const included=draft.included.has(key),sensitive=draft.sensitive.has(key);
        const sensitiveTitle=sensitive?L('Hassas — gizli kopyada çıkarılır','Sensitive — left out of the hidden copy'):L('Hassas olarak işaretle','Mark as sensitive');
        return `<div class="blCopyColsRow" role="listitem" data-cc-key="${esc(key)}">
          <input type="checkbox" data-cc-include${included?' checked':''} aria-label="${esc(L(`${label} özel kopyaya dahil`,`Include ${label} in custom copy`))}">
          <span class="blCopyColsLabel"><b>${esc(label)}</b>${item.group?`<span class="hint">${esc(item.groupLabel||item.group)}</span>`:''}</span>
          <button type="button" class="tbtn blCopyColsSensitive" data-cc-sensitive aria-pressed="${sensitive?'true':'false'}" title="${esc(sensitiveTitle)}" aria-label="${esc(`${label}: ${sensitiveTitle}`)}"><svg class="ic" aria-hidden="true"><use href="#i-eye-off"/></svg><span>${esc(sensitive?L('Hassas','Sensitive'):L('Normal','Normal'))}</span></button>
          <span class="blCopyColsMove">
            <button type="button" class="iconbtn" data-cc-up${index===0?' disabled':''} aria-label="${esc(L(`${label} yukarı`,`Move ${label} up`))}"><svg class="ic" aria-hidden="true"><use href="#i-chevron-up"/></svg></button>
            <button type="button" class="iconbtn" data-cc-down${index===draft.order.length-1?' disabled':''} aria-label="${esc(L(`${label} aşağı`,`Move ${label} down`))}"><svg class="ic" aria-hidden="true"><use href="#i-chevron-down"/></svg></button>
          </span>
        </div>`;
      }).join('');
      list.innerHTML=rows||`<div class="blCopyColsEmpty hint">${esc(L('Aramayla eşleşen sütun yok.','No columns match the search.'))}</div>`;
      drawSummary();
    }
    function move(key,step){
      const index=draft.order.indexOf(key),target=index+step;
      if(index<0||target<0||target>=draft.order.length)return;
      draft.order.splice(index,1);draft.order.splice(target,0,key);
      draw();
      list.querySelector(`[data-cc-key="${root.CSS&&root.CSS.escape?root.CSS.escape(key):key}"] [data-cc-${step<0?'up':'down'}]`)?.focus();
    }
    let releaseKeyboard=()=>{};
    const close=()=>{releaseKeyboard();overlay.remove();if(openDialog===close)openDialog=null;};
    openDialog=close;
    overlay.addEventListener('click',event=>{
      if(event.target===overlay){close();return;}
      const row=event.target.closest('[data-cc-key]'),key=row?row.dataset.ccKey:'';
      if(event.target.closest('[data-cc-close],[data-cc-cancel]')){close();return;}
      if(event.target.closest('[data-cc-sensitive]')&&key){
        if(draft.sensitive.has(key))draft.sensitive.delete(key);else draft.sensitive.add(key);
        draw();list.querySelector(`[data-cc-key="${root.CSS&&root.CSS.escape?root.CSS.escape(key):key}"] [data-cc-sensitive]`)?.focus();return;
      }
      if(event.target.closest('[data-cc-up]')&&key){move(key,-1);return;}
      if(event.target.closest('[data-cc-down]')&&key){move(key,1);return;}
      if(event.target.closest('[data-cc-visible]')){
        draft.included=new Set(visible);draft.order=uniqueKeys([...visible,...draft.order]);draw();return;
      }
      if(event.target.closest('[data-cc-defaults]')){draft.sensitive=defaultSensitive(module,catalog);draw();return;}
      if(event.target.closest('[data-cc-save]')){
        const next={columns:draft.order.filter(key=>draft.included.has(key)),...sensitiveDiff(module,catalog,draft.sensitive)};
        const ok=saveEntry(module,next);
        close();
        if(typeof options.onSave==='function')options.onSave(next,ok);
      }
    });
    overlay.addEventListener('change',event=>{
      const box=event.target.closest('[data-cc-include]');if(!box)return;
      const key=box.closest('[data-cc-key]')?.dataset.ccKey;if(!key)return;
      if(box.checked)draft.included.add(key);else draft.included.delete(key);
      drawSummary();
    });
    overlay.querySelector('[data-cc-search]').addEventListener('input',event=>{draft.query=text(event.target.value).trim();draw();});
    draw();
    doc.body.appendChild(overlay);
    releaseKeyboard=root.BLUI&&typeof root.BLUI.bindDialogKeyboard==='function'?root.BLUI.bindDialogKeyboard(card,{onEscape:close}):(()=>{});
    overlay.querySelector('[data-cc-search]')?.focus();
    root.BLMotionPlus?.play?.('overlay',card);
    return true;
  }

  return Object.freeze({
    MODULES,STORAGE_KEY,CHANGE_EVENT,DEFAULT_SENSITIVE,SENSITIVE_GROUPS,
    normalizeEntry,normalizeStore,defaultSensitive,sensitiveSet,sensitiveDiff,profileKeys,withoutSensitive,orderedByKeys,
    getEntry,saveEntry,openEditor,closeEditor,
  });
});
