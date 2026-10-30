'use strict';
/* Price view buttons must keep working after table-view-drawers.js moves them
   into the Collection view menu and removes #kolPriceViewActions. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const APP=fs.readFileSync('public/app-main.js','utf8');
const DRAWERS=fs.readFileSync('public/table-view-drawers.js','utf8');

function between(src,start,end){
  const from=src.indexOf(start),to=src.indexOf(end,from+start.length);
  assert.ok(from>=0&&to>from,'Missing source block: '+start);
  return src.slice(from,to);
}
function makeButton(mode){
  const attrs={};
  const button={dataset:{kolPriceView:mode},setAttribute:(k,v)=>{attrs[k]=v;},getAttribute:k=>attrs[k],
    closest:sel=>sel==='[data-kol-price-view]'?button:null};
  return button;
}
test('drawer script still removes the original price group (precondition)',()=>{
  assert.match(DRAWERS,/getElementById\('kolPriceViewActions'\)\?\.remove\(\)/);
});
test('price view buttons work without #kolPriceViewActions in the DOM',()=>{
  const buttons=['compact','detail','cost'].map(makeButton);
  const listeners=[];
  const document={
    getElementById:()=>null,
    querySelectorAll:sel=>sel==='[data-kol-price-view]'?buttons:[],
    addEventListener:(type,fn)=>listeners.push({type,fn})
  };
  const calls=[];
  const context=vm.createContext({document,commitActiveTableEditor:()=>calls.push('commit'),
    setKolPriceView:mode=>calls.push(mode),kolPriceViewMode:()=>'compact'});
  vm.runInContext(between(APP,'let kolPriceViewClickBound','/* VERİ SAĞLIĞI')+';this.sync=syncKolPriceViewToggle;',context);
  context.sync();context.sync();
  assert.equal(buttons[0].getAttribute('aria-pressed'),'true');
  assert.equal(buttons[1].getAttribute('aria-pressed'),'false');
  const clicks=listeners.filter(l=>l.type==='click');
  assert.equal(clicks.length,1,'click handler must be bound exactly once');
  clicks[0].fn({target:buttons[2]});
  assert.deepEqual(calls,['commit','cost']);
  clicks[0].fn({target:{closest:()=>null}});
  assert.deepEqual(calls,['commit','cost']);
});
