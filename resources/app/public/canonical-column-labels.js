(function(global){
  'use strict';

  /* UI-only label layer. Data/source/internal keys remain untouched. */
  var registry=null;
  if(typeof module==='object'&&module.exports){
    try{registry=require('./canonical-fields.js');}catch(_){registry=null;}
  }else registry=global.BLCanonicalFields||null;

  var UI_FIELD_IDS=['productDescription','category','mag','mmyg','specialCode','colourCode','buyingGroup','orderCode'];
  function buildGroups(){
    if(!registry)return [];
    return UI_FIELD_IDS.map(function(id){
      var def=registry.field(id);if(!def)return null;
      return {key:id,en:registry.label(id,'en'),tr:registry.label(id,'tr'),aliases:(def.aliases||[]).slice()};
    }).filter(Boolean);
  }
  var GROUPS=[];

  /*
   * Collection keeps PLM/internal keys. Only the visible text is aligned with
   * canonical labels. Distinct PLM fields are explicitly preserved.
   */
  var COLLECTION_KEY_TO_FIELD=Object.freeze({
    plmId:'plmId',modelKod:'modelName',lisans:'license',urunTipi:'category',specialCode:'specialCode',
    colourCode:'colourCode',colour:'colour',licensor:'licensor',mag:'mag',mmyg:'mmyg',
    buyingGroup:'buyingGroup',buyer:'buyer',season:'season',country:'country'
  });
  var COLLECTION_DISTINCT_LABELS=Object.freeze({
    productMainDefinition:Object.freeze({en:'Product Main Definition',tr:'Ürün Ana Tanım'}),
    line:Object.freeze({en:'Line',tr:'Line'}),
    buyingSampleManufacturer:Object.freeze({en:'Buying Sample',tr:'Buying Numunesi'})
  });

  function normalize(value){
    return String(value==null?'':value).replace(/\s+/g,' ').trim().toLocaleLowerCase('tr-TR');
  }
  function replaceCore(raw,replacement){
    var value=String(raw==null?'':raw),core=value.trim();
    if(!core||core===replacement)return value;
    var leading=(value.match(/^\s*/)||[''])[0],trailing=(value.match(/\s*$/)||[''])[0];
    return leading+replacement+trailing;
  }
  var byAlias=Object.create(null),api=null;
  function rebuildAliases(){
    byAlias=Object.create(null);var next=buildGroups();GROUPS.splice.apply(GROUPS,[0,GROUPS.length].concat(next));
    GROUPS.forEach(function(group){group.aliases.forEach(function(alias){byAlias[normalize(alias)]=group;});});
    if(api){api.registry=registry;api.groups=GROUPS;}
  }
  rebuildAliases();

  function currentLanguage(){
    try{var saved=global.BLStorage&&typeof global.BLStorage.getItem==='function'?global.BLStorage.getItem('lcw.lang.v1'):null;if(saved==='en'||saved==='tr')return saved;}catch(_){ }
    try{var htmlLang=global.document&&global.document.documentElement?String(global.document.documentElement.lang||'').toLowerCase():'';if(htmlLang.indexOf('en')===0)return'en';if(htmlLang.indexOf('tr')===0)return'tr';}catch(_){ }
    return'tr';
  }
  function canonicalize(value,language){
    var raw=String(value==null?'':value),core=raw.trim();if(!core)return raw;
    var group=byAlias[normalize(core)];if(!group)return raw;
    var lang=language==='en'||language==='tr'?language:currentLanguage();
    return replaceCore(raw,lang==='en'?group.en:group.tr);
  }
  function collectionLabelForKey(key,language,fallback){
    var lang=language==='en'||language==='tr'?language:currentLanguage(),fieldId=COLLECTION_KEY_TO_FIELD[key];
    if(fieldId&&registry)return registry.label(fieldId,lang);
    var distinct=COLLECTION_DISTINCT_LABELS[key];if(distinct)return lang==='en'?distinct.en:distinct.tr;
    return fallback==null?null:fallback;
  }
  function collectionKeyForHeader(header){
    if(!header||header.nodeType!==1||typeof header.closest!=='function')return'';
    var tableHeader=header.closest('#kolTable th[data-kcol]');if(tableHeader)return tableHeader.getAttribute('data-kcol')||'';
    var panelItem=header.closest('.colPanelItem');if(panelItem){var input=panelItem.querySelector('input[data-key]'),key=input&&input.getAttribute('data-key')||'';if(COLLECTION_KEY_TO_FIELD[key]||COLLECTION_DISTINCT_LABELS[key])return key;}
    return'';
  }
  function isCollectionLabelNode(node,header){
    var parent=node&&node.parentElement;if(!parent)return false;
    if(typeof parent.matches==='function'&&parent.matches('.thLabel,.colPanelName'))return true;
    return parent===header&&typeof header.matches==='function'&&header.matches('#kolTable th[data-kcol]');
  }

  var HEADER_SELECTOR='th,[role="columnheader"],.thLabel,.column-label,.col-label,.column-name,.colPanelName';
  function rewriteHeader(header){
    if(!header||header.nodeType!==1)return 0;
    // Kullanıcının verdiği EN/TR sütun adı (data-bl-user-label) kanonik etiketle ezilmez.
    if(typeof header.closest==='function'&&header.closest('[data-bl-user-label]'))return 0;
    var doc=header.ownerDocument||global.document;if(!doc||typeof doc.createTreeWalker!=='function')return 0;
    var walker=doc.createTreeWalker(header,global.NodeFilter&&global.NodeFilter.SHOW_TEXT||4),collectionKey=collectionKeyForHeader(header),collectionLabel=collectionKey?collectionLabelForKey(collectionKey):null,changed=0,node;
    while((node=walker.nextNode())){var next=collectionLabel&&isCollectionLabelNode(node,header)?replaceCore(node.nodeValue,collectionLabel):canonicalize(node.nodeValue);if(next!==node.nodeValue){node.nodeValue=next;changed++;}}
    return changed;
  }
  function apply(root){
    if(!global.document)return 0;var base=root||global.document;if(base.nodeType===3)base=base.parentElement;if(!base)return 0;var changed=0;
    if(base.nodeType===1&&typeof base.matches==='function'&&base.matches(HEADER_SELECTOR))changed+=rewriteHeader(base);
    if(typeof base.querySelectorAll==='function'){var headers=base.querySelectorAll(HEADER_SELECTOR);for(var i=0;i<headers.length;i++)changed+=rewriteHeader(headers[i]);}
    return changed;
  }

  var observer=null,scheduled=false,pendingRoots=[];
  function schedule(root){
    var target=root&&root.nodeType===3?root.parentElement:root;if(!target)target=global.document;
    if(pendingRoots.indexOf(target)<0)pendingRoots.push(target);if(pendingRoots.length>12)pendingRoots=[global.document];
    if(scheduled)return;scheduled=true;
    var run=function(){scheduled=false;var roots=pendingRoots.splice(0);for(var i=0;i<roots.length;i++)apply(roots[i]);};
    if(typeof global.requestAnimationFrame==='function')global.requestAnimationFrame(run);else if(typeof global.setTimeout==='function')global.setTimeout(run,0);else run();
  }
  function start(){
    if(!global.document)return;apply(global.document);
    if(typeof global.MutationObserver!=='function'||observer)return;
    observer=new global.MutationObserver(function(records){for(var i=0;i<records.length;i++){var r=records[i];if(r.type==='childList'||r.type==='characterData')schedule(r.target||global.document);}});
    var target=global.document.documentElement||global.document.body;if(target)observer.observe(target,{subtree:true,childList:true,characterData:true});
  }
  function setRegistry(next){registry=next||null;rebuildAliases();if(global.document)apply(global.document);}

  api={groups:GROUPS,registry:registry,canonicalize:canonicalize,collectionLabelForKey:collectionLabelForKey,apply:apply,currentLanguage:currentLanguage,start:start,setRegistry:setRegistry};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else{
    global.BLColumnLabels=api;
    if(!registry&&global.document){
      var existing=global.document.querySelector('script[data-bl-canonical-fields]');
      if(!existing){existing=global.document.createElement('script');existing.src='canonical-fields.js?rev=7.67'+(global.BL_ASSET_VERSION?'&v='+encodeURIComponent(global.BL_ASSET_VERSION):'');existing.async=false;existing.setAttribute('data-bl-canonical-fields','1');(global.document.head||global.document.documentElement).appendChild(existing);}
      existing.addEventListener('load',function(){setRegistry(global.BLCanonicalFields);start();},{once:true});
      existing.addEventListener('error',start,{once:true});
    }else if(global.document.readyState==='loading')global.document.addEventListener('DOMContentLoaded',start,{once:true});
    else start();
  }
})(typeof window!=='undefined'?window:globalThis);
