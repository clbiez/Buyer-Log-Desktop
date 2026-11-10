/* Shared Fabric Card segment contract: pure, deterministic and bilingual. */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.BLFabricSegments=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const FIELDS=Object.freeze(['type','yarn','weight','composition']);
  const SEPARATOR=' · ',BAD=/[·•|;\r\n]/;
  const TERMS=Object.freeze([
    ['Üç İplik Şardonlu','Brushed Three Thread',['3 iplik şardonlu','brushed 3 thread']],
    ['Üç İplik Şardonsuz','Unbrushed Three Thread',['3 iplik şardonsuz','unbrushed 3 thread']],
    ['Üç İplik','Three Thread',['3 iplik','3 thread']],
    ['İki İplik','Two Thread',['2 iplik','2 thread']],
    ['Süprem','Single Jersey',['suprem']],['İnterlok','Interlock',[]],
    ['Ribana','Rib',[]],['Kaşkorse','Ribbed Knit',[]],['Pike','Pique',[]],
    ['Polar','Fleece',[]],['Scuba','Scuba',[]]
  ]);
  const FIBRES=Object.freeze([
    ['Geri Dönüşümlü Polyester','Recycled Poliester'],
    ['Geri Dönüşümlü Pamuk','Recycled Cotton'],
    ['Organik Pamuk','Organic Cotton'],
    ['Polyester','Poliester'],['Poliester','Poliester'],['Pamuk','Cotton'],
    ['Viskon','Viscose'],['Viskoz','Viscose'],['Elastan','Elastane'],
    ['Poliamid','Polyamide'],['Akrilik','Acrylic'],['Keten','Linen'],['Yün','Wool']
  ]);
  function clean(value){return String(value==null?'':value).replace(/\s+/g,' ').trim();}
  function fold(value){return clean(value).toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i');}
  function numbers(value){return (clean(value).match(/\d+(?:[.,]\d+)?/g)||[]).map(v=>v.replace(',','.'));}
  function numbersMatch(a,b){const x=numbers(a),y=numbers(b);return x.length===y.length&&x.every((v,i)=>v===y[i]);}
  function validPiece(value){const x=clean(value);return !!x&&x.length<=500&&!BAD.test(x);}
  function parse(summary){const pieces=String(summary||'').split(SEPARATOR);return pieces.length===4&&pieces.every(validPiece)?pieces.map(clean):null;}
  function compose(parts){return Array.isArray(parts)&&parts.length===4&&parts.every(validPiece)?parts.map(clean).join(SEPARATOR):'';}
  function weight(text){const m=clean(text).match(/^(\d+(?:[.,]\d+)?)\s*(?:gsm|gr|g|g\/m2|g\/m²)?$/i);return m?m[1].replace(',','.')+' gsm':null;}
  function translateKnown(value,field,from){
    const text=clean(value);
    if(!validPiece(text)||!FIELDS.includes(field))return {status:'invalid',value:''};
    if(field==='yarn'){
      const x=text.replace(/\s*\/\s*/g,'/');
      if(/^\d+(?:\/\d+)*(?:\s*(?:Ne|Nm|Tex))?$/i.test(x))return {status:'known',value:x};
      const translations=from==='tr'?[['Penye','Combed'],['Karde','Carded']]:[['Combed','Penye'],['Carded','Karde']];
      const translated=translations.reduce((value,pair)=>value.replace(new RegExp('\\b'+pair[0]+'\\b','gi'),pair[1]),x);
      return /^\d+(?:\/\d+)*(?:\s*(?:Ne|Nm|Tex))?\s+(?:Penye|Karde|Combed|Carded)$/i.test(translated)
        ? {status:'known',value:translated}:{status:'needs-review',value:''};
    }
    if(field==='weight'){const x=weight(text);return x?{status:'known',value:x}:{status:'needs-ai',value:''};}
    if(field==='type'){
      const pair=TERMS.find(pair=>[pair[0],pair[1],...(pair[2]||[])].some(a=>fold(a)===fold(text)));
      return pair?{status:'known',value:pair[from==='tr'?1:0],canonical:pair[from==='tr'?0:1]}:{status:'needs-ai',value:''};
    }
    const pairs=FIBRES.slice().sort((a,b)=>b[from==='tr'?0:1].length-a[from==='tr'?0:1].length);
    let rest=text,changed=false;const marks=[];
    for(const pair of pairs){
      const src=pair[from==='tr'?0:1],dst=pair[from==='tr'?1:0];
      const escaped=src.replace(/[\^$.*+?()[\]{}|]/g,'\\$&');
      const rx=new RegExp('(^|[^A-Za-zÇĞİÖŞÜçğıöşü])('+escaped+')(?![A-Za-zÇĞİÖŞÜçğıöşü])','gi');
      rest=rest.replace(rx,function(_,lead){changed=true;marks.push(dst);return lead+'\u0001'+(marks.length-1)+'\u0002';});
    }
    rest=rest.replace(/\u0001(\d+)\u0002/g,(_,i)=>marks[Number(i)]);
    const knownWords=['Geri Dönüşümlü','Organik','Polyester','Poliester','Pamuk','Viskon','Viskoz','Elastan','Poliamid','Akrilik','Keten','Yün','Cotton','Viscose','Elastane','Polyamide','Acrylic','Linen','Wool','Recycled','Organic'];
    let leftover=rest.replace(/\d+(?:[.,]\d+)?/g,'').replace(/[%\s\/.,()+-]/g,'');
    for(const word of knownWords)leftover=leftover.replace(new RegExp(word,'gi'),'');
    return changed&&!leftover&&numbersMatch(text,rest)?{status:'known',value:rest}:{status:'needs-ai',value:''};
  }
  function validatePair(tr,en){
    if(!Array.isArray(tr)||!Array.isArray(en)||tr.length!==4||en.length!==4||!tr.every(validPiece)||!en.every(validPiece))
      return {ok:false,code:'FABRIC_SEGMENTS_INVALID'};
    const yarnTechnical=x=>clean(x).replace(/[^\d\/.,]/g,'').replace(/,/g,'.');
    if(yarnTechnical(tr[1])!==yarnTechnical(en[1])||weight(tr[2])===null||weight(tr[2])!==weight(en[2]))
      return {ok:false,code:'FABRIC_TECHNICAL_MISMATCH'};
    if(![1,2,3].every(i=>numbersMatch(tr[i],en[i])))
      return {ok:false,code:'FABRIC_NUMBERS_MISMATCH'};
    return {ok:true,tr:tr.map(clean),en:en.map(clean)};
  }
  function fromCard(card){
    const raw=card&&card.summarySegments;
    if(raw&&raw.tr&&raw.en){const c=validatePair(raw.tr,raw.en);if(c.ok)return {tr:c.tr,en:c.en,legacy:false};}
    const tr=parse(card&&card.summary),en=parse(card&&card.summaryEn);
    if(tr&&en&&validatePair(tr,en).ok)return {tr,en,legacy:false};
    return {tr:tr||['','','',''],en:en||['','','',''],legacy:Boolean(card&&card.summary)};
  }
  return Object.freeze({FIELDS,SEPARATOR,TERMS,clean,parse,compose,validPiece,weight,numbers,numbersMatch,translateKnown,validatePair,fromCard});
});
