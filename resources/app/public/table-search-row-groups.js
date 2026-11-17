(function(root,factory){
  'use strict';

  const api=factory(typeof module==='object'&&module.exports?require('./table-search-core'):root.BLTableSearchCore);
  if(typeof module==='object'&&module.exports)module.exports=api;

  if(root){
    root.BLTableSearchRowGroups=api;
    if(root.BLTableSearch)api.install(root);
    if(root.document)api.bindPaste(root.document,root);
  }
})(typeof globalThis!=='undefined'?globalThis:this,function(core){
  'use strict';

  const SEARCH_IDS=Object.freeze(['cpSearch','ordersSearch','kolSearch']);
  const ROW_GROUP_MODE='rowGroup';
  const boundDocuments=new WeakSet();

  const clean=value=>String(value==null?'':value).trim();

  const criterionFromCell=core.criterion;
  const parseRowGroups=core.parseRowGroups;

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

    const parseTerms=legacyParse;
    const matches=(haystack,terms,options)=>
      legacyMatches(haystack,terms,options);

    table.parseTerms=parseTerms;
    table.matches=matches;
    // Rank once per row, never inside the sort comparator. Keep the existing
    // column order within each search item; clearing search restores that order.
    table.orderRows=(rows,terms,getHaystack,options)=>{
      const parsed=Array.isArray(terms)?terms:parseTerms(terms);
      const grouped=isRowGroupTerms(parsed);
      const groups=Array.isArray(parsed[0])?parsed:[parsed];
      const alternatives=grouped?parsed:(groups.find(group=>group.filter(term=>term.mode!=='notContains').length>1)||[]).filter(term=>term.mode!=='notContains');
      if(alternatives.length<2||rows.length<2)return rows;
      const buckets=Array.from({length:alternatives.length+1},()=>[]);
      for(const row of rows){
        const value=getHaystack(row);
        const haystacks=Array.isArray(value)?value:[value];
        const rank=alternatives.findIndex(term=>haystacks.some(haystack=>matches(haystack,[term],{...options,periods:options?.periodsOf?()=>options.periodsOf(row):options?.periods})));
        buckets[rank<0?alternatives.length:rank].push(row);
      }
      return buckets.flat();
    };
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
