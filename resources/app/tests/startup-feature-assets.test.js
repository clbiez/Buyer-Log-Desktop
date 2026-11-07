'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=name=>fs.readFileSync(path.join(__dirname,'../public',name),'utf8');
const source=read('perf-runtime.js'),html=read('index.html');

function harness({autoLoad=true,styleHrefs}={}){
  const scripts=[],styles=[],view={loading:false,setAttribute(){this.loading=true;},removeAttribute(){this.loading=false;}};
  const anchor={dataset:{href:'lfl.css?v=fixture&rev=2'},before(el){styles.push(el);}};
  const anchors=Object.fromEntries(Object.entries(styleHrefs||{}).map(([file,href])=>[file,{dataset:{href},before(el){styles.push(el);}}]));
  const document={baseURI:'http://buyerlog/',readyState:'complete',scripts:[],
    currentScript:{src:'http://buyerlog/perf-runtime.js?v=fixture'},getElementById(){return null;},
    querySelector(selector){return styleHrefs?anchors[selector.match(/data-bl-style="([^"]+)"/)?.[1]]||null:anchor;},querySelectorAll(){return [view];},
    createElement(tag){const handlers={};return {tag,dataset:{},addEventListener(k,fn){handlers[k]=fn;},removeEventListener(k){delete handlers[k];},remove(){this.removed=true;},fire(k){if(handlers[k])handlers[k]();else this['on'+k]?.();}};},
    head:{appendChild(el){if(el.tag==='script'){scripts.push(el);if(autoLoad)queueMicrotask(()=>el.fire('load'));}}},
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

test('a styled module stays hidden until its scripts finish registering the UI',async()=>{
  const h=harness({autoLoad:false}),pending=h.context.BLPerf.ensureFeature('lfl');
  h.styles[0].fire('load');await new Promise(setImmediate);
  assert.equal(h.view.loading,true);assert.equal(h.scripts.length,1);
  h.scripts[0].fire('load');await new Promise(setImmediate);
  assert.equal(h.view.loading,true);h.scripts[1].fire('load');await pending;
  assert.equal(h.view.loading,false);
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

test('first Manufacturers activation waits for order drill-down CSS; Backlog reuses its anchor and promise',async t=>{
  const files=['manufacturers.css','backlog-plan-actual.css','backlog-delivery-analysis.css','backlog-presentation.css'];
  const styleHrefs=Object.fromEntries(files.map(file=>[file,html.match(new RegExp('data-bl-style="'+file.replaceAll('.','\\.')+'" data-href="([^"]+)"'))[1]]));
  const h=harness({styleHrefs}),first=h.context.BLPerf.ensureFeature('manufacturers');
  t.after(()=>h.styles.forEach(s=>s.fire('load')));
  assert.deepEqual(h.styles.map(s=>s.dataset.blLazyStyle),files.slice(0,2));
  const shared=h.styles[1];assert.equal(shared.href,styleHrefs['backlog-plan-actual.css']);
  h.styles[0].fire('load');await new Promise(setImmediate);
  assert.equal(h.context.BLPerf.isFeatureLoaded('manufacturers'),false);assert.equal(h.scripts.length,0);assert.equal(h.view.loading,true);
  const duplicate=h.context.BLPerf.ensureFeature('manufacturers');assert.equal(h.styles.length,2);
  shared.fire('load');await Promise.all([first,duplicate]);
  assert.equal(h.context.BLPerf.isFeatureLoaded('manufacturers'),true);assert.equal(h.context.BLPerf.isFeatureLoaded('backlogAnalysis'),false);
  const backlog=h.context.BLPerf.ensureFeature('backlogAnalysis');
  assert.deepEqual(h.styles.map(s=>s.dataset.blLazyStyle),files);
  h.styles[2].fire('load');h.styles[3].fire('load');await backlog;
  assert.equal(h.styles.filter(s=>s.dataset.blLazyStyle==='backlog-plan-actual.css').length,1);
  assert.equal(h.styles[1],shared);assert.equal(h.context.BLPerf.isFeatureLoaded('backlogAnalysis'),true);
  const concurrent=harness({styleHrefs});
  t.after(()=>concurrent.styles.forEach(s=>s.fire('load')));
  const both=[concurrent.context.BLPerf.ensureFeature('manufacturers'),concurrent.context.BLPerf.ensureFeature('backlogAnalysis')];
  assert.equal(concurrent.styles.filter(s=>s.dataset.blLazyStyle==='backlog-plan-actual.css').length,1);
  concurrent.styles.forEach(s=>s.fire('load'));await Promise.all(both);
  assert.match(read('manufacturers.js'),/BLBacklogOverview\?\.openItems\?\./);
  assert.match(read('backlog-overview.js'),/className='bpaDrawerRoot blvDrawerRoot'/);
  assert.match(read('backlog-plan-actual.css'),/\.bpaDrawerRoot\{position:fixed;inset:0\}/);
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
