(function(root,factory){
  'use strict';

  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;

  if(root){
    root.BLTableSearchRowGroups=api;
    if(root.BLTableSearch)api.install(root);
    if(root.document)api.bindPaste(root.document,root);
  }
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const SEARCH_IDS=Object.freeze(['cpSearch','ordersSearch','kolSearch']);
  const ROW_GROUP_MODE='rowGroup';
  const boundDocuments=new WeakSet();

  const clean=value=>String(value==null?'':value).trim();

  function criterionFromCell(value){
    let text=clean(value);
    if(!text)return null;
    let mode='exact';
    if(text[0]==='/'&&text.length>1){mode='contains';text=clean(text.slice(1));}
    else if(text[0]==='!'&&text.length>1){mode='notContains';text=clean(text.slice(1));}
    if(!text)return null;
    return {mode,value:text.toLocaleLowerCase('tr-TR')};
  }

  function decodeEscaped(value){
    let out='',escaped=false;
    for(const ch of String(value==null?'':value)){
      if(escaped){out+=ch;escaped=false;continue;}
      if(ch==='\\'){escaped=true;continue;}
      out+=ch;
    }
    if(escaped)out+='\\';
    return out;
  }

  function splitGroupContent(content){
    const out=[];
    let current='',escaped=false;
    for(const ch of String(content==null?'':content)){
      if(escaped){current+=ch;escaped=false;continue;}
      if(ch==='\\'){escaped=true;continue;}
      if(ch===';'){out.push(current);current='';continue;}
      current+=ch;
    }
    if(escaped)current+='\\';
    out.push(current);
    return out;
  }

  function parseRowGroups(value){
    const source=clean(value);
    if(!source||source[0]!=='(')return null;

    const groups=[];
    let index=0;
    const skipSpace=()=>{while(index<source.length&&/\s/.test(source[index]))index++;};

    while(index<source.length){
      skipSpace();
      if(source[index]!=='(')return null;
      index++;

      const start=index;
      let depth=1,escaped=false;
      for(;index<source.length;index++){
        const ch=source[index];
        if(escaped){escaped=false;continue;}
        if(ch==='\\'){escaped=true;continue;}
        if(ch==='('){depth++;continue;}
        if(ch===')'){
          depth--;
          if(depth===0)break;
        }
      }
      if(depth!==0||index>=source.length)return null;

      const rawContent=source.slice(start,index);
      const terms=splitGroupContent(rawContent)
        .map(decodeEscaped)
        .map(criterionFromCell)
        .filter(Boolean);
      if(!terms.length)return null;

      groups.push({mode:ROW_GROUP_MODE,value:'',terms});
      index++;
      skipSpace();
      if(index>=source.length)break;
      if(source[index]!==',')return null;
      index++;
      skipSpace();
      if(source[index]!=='(')return null;
    }

    if(!groups.length)return null;
    try{Object.defineProperty(groups,'__blRowGroups',{value:true,enumerable:false});}catch(_){}
    return groups;
  }

  function isRowGroupTerms(terms){
    return Array.isArray(terms)&&terms.length>0&&terms.every(group=>
      group&&group.mode===ROW_GROUP_MODE&&Array.isArray(group.terms)&&group.terms.length>0
    );
  }

  function groupedMatches(haystack,groups,legacyMatches,options){
    if(typeof legacyMatches!=='function')return true;
    return groups.some(group=>group.terms.every(term=>legacyMatches(haystack,[term],options)));
  }

  function escapeCell(value){
    return clean(value).replace(/\\/g,'\\\\').replace(/[;()]/g,ch=>'\\'+ch);
  }

  function formatClipboardMatrix(text){
    const raw=String(text==null?'':text);
    if(!raw)return '';

    const lines=raw.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
    while(lines.length&&lines[lines.length-1]==='')lines.pop();
    if(!lines.length)return '';

    const rows=lines.map(line=>line.split('\t').map(clean));
    const multiColumn=rows.some(row=>row.length>1);

    if(!multiColumn){
      const seen=new Set(),values=[];
      for(const row of rows){
        const value=clean(row[0]);
        if(!value||seen.has(value))continue;
        seen.add(value);values.push(value);
      }
      return values.join(', ');
    }

    const seenGroups=new Set(),groups=[];
    for(const row of rows){
      const seenValues=new Set(),values=[];
      for(const rawValue of row){
        const value=clean(rawValue);
        if(!value||seenValues.has(value))continue;
        seenValues.add(value);values.push(escapeCell(value));
      }
      if(!values.length)continue;
      const group='('+values.join('; ')+')';
      if(seenGroups.has(group))continue;
      seenGroups.add(group);groups.push(group);
    }
    return groups.join(', ');
  }

  function install(host){
    const table=host&&host.BLTableSearch;
    if(!table||typeof table.parseTerms!=='function'||typeof table.matches!=='function')return false;
    if(table.__rowGroupsV1===true)return true;

    const legacyParse=table.parseTerms;
    const legacyMatches=table.matches;

    const parseTerms=value=>parseRowGroups(value)||legacyParse(value);
    const matches=(haystack,terms,options)=>
      isRowGroupTerms(terms)?groupedMatches(haystack,terms,legacyMatches,options):legacyMatches(haystack,terms,options);

    table.parseTerms=parseTerms;
    table.matches=matches;
    try{Object.defineProperty(table,'__rowGroupsV1',{value:true,enumerable:false});}
    catch(_){table.__rowGroupsV1=true;}

    /*
     * app-main.js bu iki yardımcıyı üst-seviye function declaration olarak da
     * kullanır. Classic script global binding'i window özelliğiyle bağlıdır;
     * böylece CP / Orders / Collection içindeki doğrudan çağrılar da aynı
     * genişletilmiş motoru kullanır.
     */
    try{host.parseTableSearchTerms=parseTerms;}catch(_){}
    try{host.tableSearchMatches=matches;}catch(_){}

    return true;
  }

  function bindPaste(doc,host){
    if(!doc||boundDocuments.has(doc))return false;
    boundDocuments.add(doc);

    doc.addEventListener('paste',event=>{
      const target=event&&event.target;
      if(!target||!SEARCH_IDS.includes(target.id))return;

      const clipboard=event.clipboardData||(host&&host.clipboardData);
      const text=clipboard&&typeof clipboard.getData==='function'?clipboard.getData('text/plain'):'';
      if(!/[\t\r\n]/.test(text))return;

      const formatted=formatClipboardMatrix(text);
      if(!formatted)return;

      event.preventDefault?.();
      event.stopImmediatePropagation?.();

      target.value=formatted;
      try{target.setSelectionRange?.(formatted.length,formatted.length);}catch(_){}

      let inputEvent;
      const EventCtor=(host&&host.Event)||(typeof Event==='function'?Event:null);
      if(EventCtor)inputEvent=new EventCtor('input',{bubbles:true});
      else inputEvent={type:'input',bubbles:true};
      target.dispatchEvent?.(inputEvent);
    },true);

    return true;
  }

  return {
    SEARCH_IDS,
    ROW_GROUP_MODE,
    criterionFromCell,
    parseRowGroups,
    isRowGroupTerms,
    groupedMatches,
    formatClipboardMatrix,
    install,
    bindPaste,
  };
});
