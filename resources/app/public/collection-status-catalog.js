'use strict';
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.BLCollectionStatusCatalog=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const DEFAULT_COLOR='#667085';
  const PRESET_COLORS=['#667085','#1570EF','#6172F3','#7F56D9','#DC6803','#F79009','#039855','#079455','#0E9384','#D92D20'];
  const STATUS_LABELS=[
    {name:'Dosya Teslimi Alındı',en:'File Received'},
    {name:'Pending File',en:'Pending File'},
    {name:'MB Onaya Gönderildi',en:'Sent for MB Approval'},
    {name:'GTIP',en:'HS Code'},
    {name:'Lisans Tanım',en:'License Definition'},
    {name:'Fiyatlamada',en:'In Pricing'},
    {name:'Capacity Request',en:'Capacity Request'},
    {name:'Siparişe Hazır',en:'Ready for Order'},
    {name:'Sipariş Onayda',en:'Order in Approval'},
    {name:'Sipariş Geçildi',en:'Order Placed'},
    {name:'Dummy PO Placed',en:'Dummy PO Placed'},
    {name:'İptal',en:'Dropped'},
    // Older built-in-like values can still exist in Collection rows/catalogs.
    {name:'Konsept Onaylı',en:'Concept Approved'},
    {name:'Konsept Onayı Bekleniyor',en:'Awaiting Concept Approval'},
    {name:'Buying Numunesi Onaylı',en:'Buying Sample Approved'},
    {name:'Üretimde',en:'In Production'},
    {name:'Depoda',en:'In Warehouse'},
  ];
  const SEED=[
    {name:'Dosya Teslimi Alındı',color:'#667085',builtin:true},
    {name:'Pending File',color:'#98A2B3',builtin:true},
    {name:'MB Onaya Gönderildi',color:'#7F56D9',builtin:true},
    {name:'GTIP',color:'#2E90FA',builtin:true},
    {name:'Lisans Tanım',color:'#6172F3',builtin:true},
    {name:'Fiyatlamada',color:'#1570EF',builtin:true},
    {name:'Capacity Request',color:'#DC6803',builtin:true},
    {name:'Siparişe Hazır',color:'#039855',builtin:true},
    {name:'Sipariş Onayda',color:'#F79009',builtin:true},
    {name:'Sipariş Geçildi',color:'#079455',builtin:true},
    {name:'Dummy PO Placed',color:'#0E9384',builtin:true},
    {name:'İptal',color:'#D92D20',builtin:true},
  ];
  function rawKey(value){return String(value==null?'':value).trim().toLocaleLowerCase('tr-TR');}
  const CANONICAL_BY_ALIAS=new Map();
  const LABEL_BY_CANONICAL=new Map();
  STATUS_LABELS.forEach(function(item){
    const canonical=String(item.name||'').trim(),en=String(item.en||canonical).trim();
    if(!canonical)return;
    CANONICAL_BY_ALIAS.set(rawKey(canonical),canonical);
    CANONICAL_BY_ALIAS.set(rawKey(en),canonical);
    LABEL_BY_CANONICAL.set(rawKey(canonical),{tr:canonical,en:en||canonical});
  });
  function canonicalName(value){
    const text=String(value==null?'':value).trim();
    return CANONICAL_BY_ALIAS.get(rawKey(text))||text;
  }
  function key(value){return rawKey(canonicalName(value));}
  function label(value,language){
    const canonical=canonicalName(value),item=LABEL_BY_CANONICAL.get(rawKey(canonical));
    if(!item)return String(value==null?'':value).trim();
    return String(language||'tr').toLowerCase()==='en'?item.en:item.tr;
  }
  function normalizeColor(value,fallback){
    const text=String(value||'').trim();
    const short=text.match(/^#([0-9a-f]{3})$/i);
    if(short)return '#'+short[1].split('').map(function(ch){return ch+ch;}).join('').toUpperCase();
    const full=text.match(/^#([0-9a-f]{6})$/i);
    return full?'#'+full[1].toUpperCase():String(fallback||DEFAULT_COLOR).toUpperCase();
  }
  function clone(entry){return {name:String(entry.name||'').trim(),color:normalizeColor(entry.color),builtin:Boolean(entry.builtin)};}
  function seed(){return SEED.map(clone);}
  function normalize(value,options){
    const opts=options&&typeof options==='object'?options:{};
    const source=Array.isArray(value)&&value.length?value:SEED;
    const out=[],seen=new Set();
    source.forEach(function(item){
      const raw=typeof item==='string'?{name:item}:item;
      const inputName=String(raw&&raw.name||'').trim(),name=canonicalName(inputName),lookup=key(name);
      if(!name||seen.has(lookup))return;
      seen.add(lookup);
      const seeded=SEED.find(function(entry){return key(entry.name)===lookup;});
      out.push({name:seeded?seeded.name:name,color:normalizeColor(raw&&raw.color,seeded&&seeded.color||DEFAULT_COLOR),builtin:seeded?true:(raw&&Object.prototype.hasOwnProperty.call(raw,'builtin')?Boolean(raw.builtin):false)});
    });
    (Array.isArray(opts.rowStatuses)?opts.rowStatuses:[]).forEach(function(value){
      const inputName=String(value==null?'':value).trim(),name=canonicalName(inputName),lookup=key(name);
      if(!name||seen.has(lookup))return;
      seen.add(lookup);
      const seeded=SEED.find(function(entry){return key(entry.name)===lookup;});
      out.push({name:seeded?seeded.name:name,color:seeded?seeded.color:DEFAULT_COLOR,builtin:Boolean(seeded)});
    });
    return out.length?out:seed();
  }
  function find(catalog,name){
    const lookup=key(name);
    return normalize(catalog).find(function(entry){return key(entry.name)===lookup;})||null;
  }
  function color(catalog,name){const entry=find(catalog,name);return entry?entry.color:DEFAULT_COLOR;}
  function toArgb(value){return 'FF'+normalizeColor(value).slice(1);}
  function textArgb(value){
    const hex=normalizeColor(value).slice(1),r=parseInt(hex.slice(0,2),16),g=parseInt(hex.slice(2,4),16),b=parseInt(hex.slice(4,6),16);
    return (0.2126*r+0.7152*g+0.0722*b)/255>0.58?'FF101828':'FFFFFFFF';
  }
  return {DEFAULT_COLOR:DEFAULT_COLOR,PRESET_COLORS:PRESET_COLORS.slice(),SEED:seed(),seed:seed,normalize:normalize,normalizeColor:normalizeColor,key:key,canonicalName:canonicalName,label:label,find:find,color:color,toArgb:toArgb,textArgb:textArgb};
});
