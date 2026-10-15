'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Engine=require('../public/collection-spreadsheet-engine.js');
const SHEET=fs.readFileSync(path.join(__dirname,'../public/collection-spreadsheet.js'),'utf8');

const STATUS_OPTIONS=[
  {value:'Pending File',textContent:'Bekleyen Dosya'},
  {value:'Approved',textContent:'Onaylandı'}
];

function harness({key='durum',value='Pending File'}={}){
  const listeners={},writes=[],validations=[],copies=[],toasts=[];
  const root={classList:{add(){}}};
  const table={addEventListener(){},setAttribute(){},removeAttribute(){},tHead:null};
  const td={
    dataset:{key},
    querySelector(selector){
      if(!selector.startsWith('select.editCell')||key!=='durum')return null;
      return {value,options:STATUS_OPTIONS};
    }
  };
  const document={
    readyState:'complete',
    body:{dataset:{activeTab:'koleksiyon'}},
    documentElement:{lang:'tr'},
    addEventListener(name,callback){listeners[name]=callback;},
    querySelectorAll(){return [];},
    querySelector(){return null;},
    getElementById(id){return id==='kolTable'?table:id==='view-koleksiyon'?root:null;}
  };
  const window={
    BLCollectionSpreadsheetEngine:Engine,
    showToast(message){toasts.push(message);},
    BLCopyRichToClipboard:async(_html,plain)=>{copies.push(plain);return true;},
    BLCollectionSpreadsheetBridge:{
      canEdit:()=>true,
      selectedCount:()=>0,
      rows:()=>[{id:1,[key]:value}],
      rawValue:(row,k)=>row[k],
      columnMeta:k=>({label:k,col:key==='durum'?{status:true}:key==='inStoreMonth'?{inStorePeriod:'month'}:key==='inStoreWeek'?{inStorePeriod:'week'}:{}}),
      validateValue:(rowId,k,raw)=>{validations.push(raw);return {ok:true,value:raw};},
      batchEdit:ops=>{writes.push(...ops);return {ok:true,changed:ops.length,updatedRows:1};}
    }
  };
  new Function('window','document','setTimeout',SHEET)(window,document,()=>{});
  const state=window.BLCollectionSpreadsheet.state;
  const coord={r:0,c:0,rowId:'1',key,td};
  state.active=state.anchor=state.focus=coord;
  state.cellRows=[[td]];
  state.coordByCell.set(td,coord);
  return {window,listeners,writes,validations,copies,toasts};
}
function makePasteEvent(text,target){
  return {
    target:target||{closest(){return null;}},
    clipboardData:{getData:()=>text},
    prevented:false,
    preventDefault(){this.prevented=true;},
    stopImmediatePropagation(){}
  };
}
function makeEditor(tagName,key){
  const editor={
    tagName,dataset:{k:key},
    closest(selector){
      if(selector==='input,textarea,select,[contenteditable="true"]'||selector==='#kolTable .editCell')return editor;
      if(selector==='td[data-key]')return {dataset:{key}};
      return null;
    }
  };
  return editor;
}

test('copied single MB month has no header and retains its exact period value',()=>{
  const h=harness({key:'inStoreMonth',value:'June 2027'});
  const event={target:{closest(){return null;}},preventDefault(){},stopImmediatePropagation(){}};
  assert.equal(h.window.BLCollectionSpreadsheet.handleCopyShortcut(event),true);
  assert.deepEqual(h.copies,['June 2027']);
});

test('copied MB week keeps full business-week code instead of displayed week number',()=>{
  const h=harness({key:'inStoreWeek',value:'2027-23'});
  assert.equal(h.window.BLCollectionSpreadsheet.handleCopyShortcut({target:{closest(){return null;}},preventDefault(){},stopImmediatePropagation(){}}),true);
  assert.deepEqual(h.copies,['2027-23']);
});

test('status paste from focused native dropdown is intercepted and canonicalized',()=>{
  const h=harness(),event=makePasteEvent('Onaylandı',makeEditor('SELECT','durum'));
  h.listeners.paste(event);
  assert.equal(event.prevented,true);
  assert.deepEqual(h.writes,[{rowId:'1',key:'durum',value:'Approved'}]);
  assert.deepEqual(h.validations,['Approved']);
});

test('invalid status paste never reaches the batch write',()=>{
  const h=harness(),event=makePasteEvent('Unrecognized Status',makeEditor('SELECT','durum'));
  h.listeners.paste(event);
  assert.equal(event.prevented,true);
  assert.deepEqual(h.writes,[]);
  assert.deepEqual(h.validations,[]);
});

test('MB Month and MB Week paste from grid surface use spreadsheet transaction',()=>{
  for(const [key,source] of [['inStoreMonth','June 2027'],['inStoreWeek','2027-23']]){
    const h=harness({key,value:''}),event=makePasteEvent(source);
    h.listeners.paste(event);
    assert.equal(event.prevented,true,key);
    assert.deepEqual(h.writes,[{rowId:'1',key,value:source}],key);
  }
});

test('regular text editor scalar paste remains native',()=>{
  const h=harness({key:'modelKod',value:'A'}),event=makePasteEvent('some text',makeEditor('INPUT','modelKod'));
  h.listeners.paste(event);
  assert.equal(event.prevented,false);
  assert.equal(h.writes.length,0);
});

test('multiline notes paste without tabs remains native',()=>{
  const h=harness({key:'not',value:'old'}),event=makePasteEvent('first\nsecond',makeEditor('TEXTAREA','not'));
  h.listeners.paste(event);
  assert.equal(event.prevented,false);
  assert.equal(h.writes.length,0);
});

test('dropdown resolver accepts canonical, translated and case/diacritic variants',()=>{
  const options=STATUS_OPTIONS.map(option=>({value:option.value,label:option.textContent}));
  for(const pasted of ['Approved','Onaylandı','ONAYLANDI','onaylandi',' onaylandı '])
    assert.deepEqual(Engine.resolveSelectPasteValue(pasted,options),{ok:true,value:'Approved'});
  assert.deepEqual(Engine.resolveSelectPasteValue('PENDING FILE',options),{ok:true,value:'Pending File'});
});

test('dropdown resolver rejects unknown or ambiguous status labels, preserving empty-cell clear',()=>{
  const options=[{value:'A',label:'Same'},{value:'B',label:'Same'}];
  assert.deepEqual(Engine.resolveSelectPasteValue('Same',options),{ok:false,reason:'invalid-option'});
  assert.deepEqual(Engine.resolveSelectPasteValue('No Such Status',options),{ok:false,reason:'invalid-option'});
  assert.deepEqual(Engine.resolveSelectPasteValue('',options),{ok:true,value:''});
});
