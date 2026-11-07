'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=name=>fs.readFileSync(path.join(__dirname,'../public',name),'utf8');
const source=read('perf-runtime.js'),html=read('index.html');

function harness(){
  const scripts=[],styles=[],view={loading:false,setAttribute(){this.loading=true;},removeAttribute(){this.loading=false;}};
  const anchor={dataset:{href:'lfl.css?v=fixture&rev=2'},before(el){styles.push(el);}};
  const document={baseURI:'http://buyerlog/',readyState:'complete',scripts:[],
    currentScript:{src:'http://buyerlog/perf-runtime.js?v=fixture'},getElementById(){return null;},
    querySelector(){return anchor;},querySelectorAll(){return [view];},
    createElement(tag){const handlers={};return {tag,dataset:{},addEventListener(k,fn){handlers[k]=fn;},removeEventListener(k){delete handlers[k];},remove(){this.removed=true;},fire(k){if(handlers[k])handlers[k]();else this['on'+k]?.();}};},
    head:{appendChild(el){if(el.tag==='script'){scripts.push(el);queueMicrotask(()=>el.fire('load'));}}},
  };
  const context={document,URL,setTimeout,clearTimeout,queueMicrotask,performance:{now:()=>1,mark(){}}};context.window=context;
  vm.runInNewContext(source,context);
  return {context,styles,scripts,view};
}

test('module styles gate execution and preserve their original cascade position and URL',async()=>{
  const h=harness(),a=h.context.BLPerf.ensureFeature('lfl'),b=h.context.BLPerf.ensureFeature('lfl');
  assert.equal(h.styles.length,1);assert.equal(h.view.loading,true);assert.equal(h.scripts.length,0);
  assert.equal(h.styles[0].href,'lfl.css?v=fixture&rev=2');
  h.styles[0].fire('load');await Promise.all([a,b]);
  assert.equal(h.view.loading,false);assert.equal(h.context.BLPerf.isFeatureLoaded('lfl'),true);
  assert.deepEqual(h.scripts.map(s=>new URL(s.src,'http://buyerlog/').pathname),['/lfl-calculation-engine.js','/lfl.js']);
  await h.context.BLPerf.ensureFeature('lfl');assert.equal(h.styles.length,1);assert.equal(h.scripts.length,2);
});

test('a failed stylesheet can retry without executing code or latching the feature as ready',async()=>{
  const h=harness(),first=h.context.BLPerf.ensureFeature('lfl');
  const failed=assert.rejects(first,/lfl\.css/);h.styles[0].fire('error');await failed;
  assert.equal(h.styles[0].removed,true);assert.equal(h.view.loading,false);
  assert.equal(h.context.BLPerf.isFeatureLoaded('lfl'),false);assert.equal(h.scripts.length,0);
  const next=h.context.BLPerf.ensureFeature('lfl');h.styles[1].fire('load');await next;
  assert.equal(h.context.BLPerf.isFeatureLoaded('lfl'),true);
});

test('an existing module global still waits for its missing stylesheet',async()=>{
  const h=harness();h.context.initLFL=()=>{};
  const pending=h.context.BLPerf.ensureFeature('lfl');
  assert.equal(h.context.BLPerf.isFeatureLoaded('lfl'),false);h.styles[0].fire('load');await pending;
  assert.equal(h.scripts.length,0);assert.equal(h.context.BLPerf.isFeatureLoaded('lfl'),true);
});

test('startup omits optional scripts and blocking module styles while preserving shared dependencies',()=>{
  for(const file of ['buyerlog-guide-data','buyerlog-trivia-data','buyerlog-trivia','buyerlog-guide','backlog-plan-actual-report','backlog-plan-actual','backlog-presentation-report','backlog-presentation','collection-spreadsheet-engine','collection-spreadsheet','excel-import-workbook','excel-import-match','excel-import-plan','excel-import-profiles','excel-import-ai','excel-import-wizard']){
    assert.doesNotMatch(html,new RegExp('<script[^>]+src="'+file+'\\.js[?]'));
    assert.ok(source.includes("'"+file+'.js'),file+' missing from feature manifest');
  }
  const anchors=[...html.matchAll(/<template data-bl-style="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(anchors.length,18);
  for(const file of anchors){assert.doesNotMatch(html,new RegExp('<link[^>]+href="'+file.replaceAll('.','\\.')+'[?]'));assert.ok(source.includes("'"+file+"'"));}
  for(const file of ['excel-import-mapping','backlog-chart','backlog-v3-report','backlog-overview'])assert.ok(html.includes('<script src="'+file+'.js?'));
});

test('the first Excel import click is delivered once after loading; later clicks use the wizard handler',async()=>{
  let capture,resolve,opens=0,ensures=0;
  const trigger={dataset:{excelImport:'cp'},setAttribute(){},removeAttribute(){}};
  const window={BLPerf:{ensureFeature:()=>{ensures++;return new Promise(r=>{resolve=r;});}}};
  const document={addEventListener:(name,fn,mode)=>{assert.equal(mode,true);capture=fn;}};
  vm.runInNewContext(read('startup-feature-entrypoints.js'),{window,document});
  const event=()=>({target:{closest:()=>trigger},preventDefault(){},stopImmediatePropagation(){}});
  const first=capture(event());await capture(event());assert.equal(ensures,1);
  window.BLExcelImportWizard={open:module=>{assert.equal(module,'cp');opens++;}};resolve();await first;
  await capture(event());assert.equal(opens,1);
});
