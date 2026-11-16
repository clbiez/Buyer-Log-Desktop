'use strict';
// Presentation identifiers only. No row values or executable configuration is accepted.
const TABLES=new Set(['cp','orders','koleksiyon']),VIEWS=new Set(['focus','extended','all','custom']);
function invalid(){return Object.assign(new Error('Geçersiz rapor düzeni. / Invalid report layout.'),{statusCode:400,code:'REPORT_LAYOUT_INVALID'});}
function slot(table,view){if(!TABLES.has(table)||!VIEWS.has(view))throw invalid();return table+'.'+view;}
function layout(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>100)throw invalid();
  const out=Object.create(null);let count=0;
  for(const [group,lines] of Object.entries(value)){
    if(!group||group.length>512||['__proto__','constructor','prototype'].includes(group)||!Array.isArray(lines)||lines.length!==3)throw invalid();
    const seen=new Set();
    out[group]=lines.map(items=>{
      if(!Array.isArray(items))throw invalid();
      return items.map(key=>{
        if(typeof key!=='string'||!key||key.length>200||seen.has(key)||++count>1000)throw invalid();
        seen.add(key);return key;
      });
    });
  }
  return out;
}
function normalize(value){
  const slots={};
  for(const [key,entry]of Object.entries(value?.slots||{})){
    try{const parts=key.split('.');if(parts.length!==2||slot(...parts)!==key||typeof entry.id!=='string'||!entry.id||entry.id.length>80)continue;
      slots[key]={id:entry.id,layout:layout(entry.layout),updatedAt:String(entry.updatedAt||'').slice(0,40),updatedBy:String(entry.updatedBy||'').slice(0,160)};
    }catch(_){}
  }
  return {version:1,slots};
}
module.exports={slot,layout,normalize};
