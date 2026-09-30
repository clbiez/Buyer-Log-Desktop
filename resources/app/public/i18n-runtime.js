/* ===================================================================
   Buyer Log — TR/EN dil bütünlüğü katmanı (i18n-runtime.js)
   Modüller metinlerini kendi TR/EN çiftleriyle üretir; ancak bazı metinler
   yalnız tek dilde yazılmıştı veya dil değiştiğinde yeniden çizilmeyen
   ekranlarda eski dilde kalıyordu. Bu katman i18n-dictionary.js sözlüğünü
   kullanarak görünen metni aktif dile tamamlar:
     • EN kipinde Türkçe kalan metin → İngilizce karşılığı
     • TR kipinde İngilizce kalan metin → Türkçe karşılığı
   Yalnız görünen metin, title, placeholder, aria-label ve alt öznitelikleri
   değişir; veri, input değerleri, <option value> ve tablo veri hücreleri
   (tbody td) hiçbir zaman değiştirilmez. Orijinal metin saklanır; dil
   geri alındığında birebir geri yüklenir.
   =================================================================== */
(function(root){
  'use strict';
  if(!root||root.BLI18n)return;
  const doc=root.document;
  const RAW=root.BL_I18N_DICTIONARY||{pairs:[],same:[]};
  const ATTRS=['title','placeholder','aria-label','alt'];
  const SKIP_TAGS=new Set(['SCRIPT','STYLE','NOSCRIPT','CODE','PRE','svg','SVG','TEMPLATE','IFRAME','CANVAS']);
  // Metni kullanıcı verisi olan alanlar: öznitelikleri (placeholder/title) çevrilir, içeriği asla.
  const TEXT_ONLY_SKIP=new Set(['TEXTAREA','INPUT','SELECT']);
  const TR_LETTER=/[çğıİöşüÇĞŞÜÖ]/;
  const LETTER=/[A-Za-zçğıöşüÇĞİÖŞÜ]/;
  const WORD_SPLIT=/[^A-Za-z0-9çğıöşüÇĞİÖŞÜ]+/;
  const PH=/\{(\d+)\}/g;

  const norm=value=>String(value==null?'':value).replace(/\s+/g,' ').trim();
  const lower=value=>value.toLocaleLowerCase('tr-TR');
  const escapeRe=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

  // ---- sözlük indeksleri --------------------------------------------------
  const exact={en:new Map(),tr:new Map()};      // hedef dil → (kaynak → hedef)
  const patterns={en:new Map(),tr:new Map()};   // hedef dil → (anahtar kelime → [kalıp])
  const openPatterns={en:[],tr:[]};             // anahtar kelimesi olmayan kalıplar
  const same=new Set((RAW.same||[]).map(norm));
  function literalWords(template){
    return template.replace(PH,' ').split(WORD_SPLIT).filter(word=>word.length>=3&&LETTER.test(word));
  }
  function addPattern(lang,source,target){
    const words=literalWords(source);
    // "{0}: {1}" gibi harf içermeyen kalıplar her metne uyar; güvenli değildir.
    if(words.join('').length<3)return;
    const order=[];let reSource='^';let last=0;let match;
    PH.lastIndex=0;
    while((match=PH.exec(source))){
      reSource+=escapeRe(source.slice(last,match.index))+'(.+?)';
      order.push(Number(match[1]));last=match.index+match[0].length;
    }
    reSource+=escapeRe(source.slice(last))+'$';
    const entry={re:new RegExp(reSource),order,target};
    const key=lower(words.reduce((a,b)=>b.length>a.length?b:a,''));
    const bucket=patterns[lang].get(key);
    if(bucket)bucket.push(entry);else patterns[lang].set(key,[entry]);
  }
  function addPair(tr,en){
    tr=norm(tr);en=norm(en);
    if(!tr||!en||tr===en)return;
    const hasPh=/\{\d+\}/.test(tr);
    // EN kipinde: Türkçe → İngilizce
    if(!same.has(tr)){
      if(hasPh)addPattern('en',tr,en);
      else if(!exact.en.has(tr))exact.en.set(tr,en);
    }
    // TR kipinde: İngilizce → Türkçe (iki dilde aynı kalan jargon hariç)
    if(!same.has(en)&&!TR_LETTER.test(en)){
      if(hasPh)addPattern('tr',en,tr);
      else if(!exact.tr.has(en))exact.tr.set(en,tr);
    }
  }
  (RAW.pairs||[]).forEach(pair=>{if(Array.isArray(pair))addPair(pair[0],pair[1]);});
  // Eski statik sözlükler (app-main.js) de aynı kaynağa katılır.
  let legacyAbsorbed=false;
  function absorbLegacy(){
    if(legacyAbsorbed)return;
    legacyAbsorbed=true;
    cache.en.clear();cache.tr.clear();
    try{
      if(typeof TR_EN_DICT==='object')Object.entries(TR_EN_DICT).forEach(([tr,en])=>addPair(tr,en));
      if(typeof KOL_DURUM_EN==='object')Object.entries(KOL_DURUM_EN).forEach(([tr,en])=>addPair(tr,en));
    }catch(_){}
  }

  // ---- çeviri ---------------------------------------------------------------
  let lang='tr';
  const cache={en:new Map(),tr:new Map()};
  const CACHE_MAX=20000;
  function needsWork(text,target){
    // EN kipinde yalnız Türkçe görünen, TR kipinde yalnız harf içeren metinler aday olur.
    if(!LETTER.test(text))return false;
    return true;
  }
  function translatePatterns(text,target,depth){
    const words=text.split(WORD_SPLIT).filter(word=>word.length>=3);
    const tried=new Set();
    for(const word of words){
      const key=lower(word);
      if(tried.has(key))continue;tried.add(key);
      const bucket=patterns[target].get(key);
      if(!bucket)continue;
      for(const entry of bucket){
        const match=entry.re.exec(text);
        if(!match)continue;
        return entry.target.replace(PH,(_,index)=>{
          const position=entry.order.indexOf(Number(index));
          const value=position>=0?match[position+1]:'';
          return depth<2?translateCore(value,target,depth+1):value;
        });
      }
    }
    return null;
  }
  // Başta/sonda ikon, ok, iki nokta veya üç nokta varsa çekirdek metni çevirip geri ekler.
  const AFFIX=/^([^A-Za-z0-9çğıöşüÇĞİÖŞÜ"“(]*)(.*?)([\s:：…▾▴▸›»→.!?]*)$/;
  function translateCore(text,target,depth){
    if(!text)return text;
    const direct=exact[target].get(text);
    if(direct!=null)return direct;
    if(same.has(text))return text;
    const viaPattern=translatePatterns(text,target,depth);
    if(viaPattern!=null)return viaPattern;
    const affix=AFFIX.exec(text);
    if(affix&&(affix[1]||affix[3])&&affix[2]&&affix[2]!==text){
      const inner=exact[target].get(affix[2])||translatePatterns(affix[2],target,depth);
      if(inner!=null)return affix[1]+inner+affix[3];
      // Sondaki nokta sözlükte anahtarın parçası olabilir.
      const withDot=exact[target].get(affix[2]+affix[3].trim());
      if(withDot!=null)return affix[1]+withDot;
    }
    // "Create 0", "4 Season" gibi sayı önekli/sonekli etiketler: sayı korunur, etiket çevrilir.
    const numeric=/^([\d.,%+\-]+\s+)?(.*?[^\d\s].*?)(\s+[\d.,%()+\-]+)?$/.exec(text);
    if(numeric&&(numeric[1]||numeric[3])&&numeric[2]){
      const inner=exact[target].get(numeric[2]);
      if(inner!=null)return (numeric[1]||'')+inner+(numeric[3]||'');
    }
    // " · ", " — ", " | " ayırıcılı bileşik metinler parça parça çevrilir.
    if(depth<2&&/ · | — | \| | → /.test(text)){
      const parts=text.split(/( · | — | \| | → )/);
      let changed=false;
      const next=parts.map((part,index)=>{
        if(index%2===1||!part)return part;
        const value=translateCore(part,target,depth+1);
        if(value!==part)changed=true;
        return value;
      });
      if(changed)return next.join('');
    }
    // "Başlık: ayrıntı" biçimindeki mesajlar (ör. hata önekleri) iki parçada çevrilir.
    if(depth<2){
      const colon=text.indexOf(': ');
      if(colon>1&&colon<text.length-2){
        const head=text.slice(0,colon+1),tail=text.slice(colon+2);
        const headT=exact[target].get(head)||exact[target].get(text.slice(0,colon));
        const headOut=headT==null?head:(exact[target].has(head)?headT:headT+':');
        const tailOut=translateCore(tail,target,depth+1);
        // Önek zaten hedef dildeyse (ör. "Filtrele: Country") yalnız ayrıntı çevrilir.
        if(headT!=null||tailOut!==tail)return headOut+' '+tailOut;
      }
    }
    return text;
  }
  function translate(value,target){
    target=target||lang;
    if(value==null)return value;
    const raw=String(value);
    const text=norm(raw);
    if(!text||!needsWork(text,target))return raw;
    if(text.length>1200)return raw;
    const memo=cache[target];
    let out=memo.get(text);
    if(out===undefined){
      out=translateCore(text,target,0);
      if(memo.size>CACHE_MAX)memo.clear();
      memo.set(text,out);
    }
    if(out===text)return raw;
    // Baştaki/sondaki boşluklar korunur (metin düğümleri birbirine yaslanır).
    const lead=raw.match(/^\s*/)[0],trail=raw.match(/\s*$/)[0];
    return lead+out+trail;
  }

  // ---- DOM ------------------------------------------------------------------
  const textState=new WeakMap();   // Text → {orig, applied}
  const attrState=new WeakMap();   // Element → {attr: {orig, applied}}
  function isDataCell(cell){
    if(!cell||cell.tagName!=='TD')return false;
    if(cell.hasAttribute('colspan')||cell.classList.contains('empty'))return false;
    const section=cell.parentElement&&cell.parentElement.parentElement;
    return !!section&&section.tagName==='TBODY';
  }
  function skipElement(el){
    if(!el||el.nodeType!==1)return true;
    if(SKIP_TAGS.has(el.tagName))return true;
    if(el.isContentEditable)return true;
    if(el.hasAttribute('data-no-i18n'))return true;
    if(el.tagName==='OPTION'&&!el.hasAttribute('value'))return true;
    return false;
  }
  function blockedByAncestor(el){
    for(let node=el;node&&node.nodeType===1;node=node.parentElement){
      if(skipElement(node))return true;
      if(isDataCell(node))return true;
    }
    return false;
  }
  function applyText(node){
    if(node.parentElement&&TEXT_ONLY_SKIP.has(node.parentElement.tagName))return;
    const value=node.nodeValue;
    if(!value||!LETTER.test(value))return;
    const state=textState.get(node);
    const base=state&&value===state.applied?state.orig:value;
    const next=translate(base,lang);
    if(next===value){if(state&&base===value)textState.delete(node);return;}
    textState.set(node,{orig:base,applied:next});
    node.nodeValue=next;
  }
  function applyAttr(el,name){
    const value=el.getAttribute(name);
    if(value==null||!LETTER.test(value))return;
    let states=attrState.get(el);
    const state=states&&states[name];
    const base=state&&value===state.applied?state.orig:value;
    const next=translate(base,lang);
    if(next===value)return;
    if(!states){states={};attrState.set(el,states);}
    states[name]={orig:base,applied:next};
    el.setAttribute(name,next);
  }
  function applyAttrs(el){
    for(const name of ATTRS)if(el.hasAttribute(name))applyAttr(el,name);
  }
  const FILTER={acceptNode(node){
    if(node.nodeType===3)return NodeFilter.FILTER_ACCEPT;
    if(skipElement(node)||isDataCell(node))return NodeFilter.FILTER_REJECT;
    if(TEXT_ONLY_SKIP.has(node.tagName)){applyAttrs(node);return NodeFilter.FILTER_REJECT;}
    return NodeFilter.FILTER_ACCEPT;
  }};
  function applyTree(rootNode){
    if(!rootNode)return;
    if(rootNode.nodeType===3){
      if(rootNode.parentElement&&!blockedByAncestor(rootNode.parentElement))applyText(rootNode);
      return;
    }
    if(rootNode.nodeType!==1&&rootNode.nodeType!==9&&rootNode.nodeType!==11)return;
    if(rootNode.nodeType===1&&blockedByAncestor(rootNode))return;
    if(rootNode.nodeType===1){applyAttrs(rootNode);if(TEXT_ONLY_SKIP.has(rootNode.tagName))return;}
    const walker=doc.createTreeWalker(rootNode,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT,FILTER);
    let node;
    while((node=walker.nextNode())){
      if(node.nodeType===3)applyText(node);
      else applyAttrs(node);
    }
  }
  let observer=null,paused=0;
  function onMutations(records){
    if(paused)return;
    for(const record of records){
      if(record.type==='childList'){
        record.addedNodes.forEach(node=>{if(node.isConnected)applyTree(node);});
      }else if(record.type==='characterData'){
        const node=record.target;
        if(node.parentElement&&!blockedByAncestor(node.parentElement))applyText(node);
      }else if(record.type==='attributes'){
        const el=record.target;
        if(ATTRS.includes(record.attributeName)&&!blockedByAncestor(el))applyAttr(el,record.attributeName);
      }
    }
  }
  function startObserver(){
    if(observer||typeof MutationObserver!=='function'||!doc||!doc.documentElement)return;
    observer=new MutationObserver(onMutations);
    observer.observe(doc.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:ATTRS});
  }
  function applyDocumentTitle(){
    try{
      const state=textState.get(doc);
      const value=doc.title;
      const base=state&&value===state.applied?state.orig:value;
      const next=translate(base,lang);
      if(next!==value){textState.set(doc,{orig:base,applied:next});doc.title=next;}
    }catch(_){}
  }
  function setLanguage(next){
    lang=next==='en'?'en':'tr';
    if(!doc||!doc.body)return;
    paused++;
    try{applyTree(doc.body);applyDocumentTitle();}
    finally{paused--;}
    if(observer)observer.takeRecords();
  }

  // Yerel alert/confirm/prompt metinleri DOM'da değildir; burada çevrilir.
  ['alert','confirm','prompt'].forEach(name=>{
    const original=root[name];
    if(typeof original!=='function')return;
    root[name]=function(message,...rest){
      return original.call(root,translate(message,lang),...rest);
    };
  });

  let initialLang='tr';
  try{
    const saved=root.BLStorage&&root.BLStorage.getItem('lcw.lang.v1');
    if(saved==='en'||saved==='tr')initialLang=saved;
  }catch(_){}
  lang=initialLang;
  startObserver();

  root.BLI18n={
    translate:(value,target)=>translate(value,target||lang),
    setLanguage,
    getLanguage:()=>lang,
    absorbLegacy,
    refresh:()=>setLanguage(lang),
  };
})(typeof window!=='undefined'?window:null);
