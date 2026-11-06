'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const script=fs.readFileSync(path.join(__dirname,'../public/motion-plus.js'),'utf8');

function harness({reduced=false,off=false,hidden=false,late=false}={}){
  const calls=[],timers=new Map(),events={},mediaEvents={},observers=[];let next=0;
  class Element{
    constructor(name,classes='',children=[]){this.name=name;this.classList=new Set(classes.split(' '));this.children=children;this.tagName='DIV';this.isConnected=true;this.hidden=false;this.editing=false;this.textContent=name;this.dataset={};}
    contains(el){return this===el||this.children.some(child=>child.contains(el));}
    matches(selector){return selector.split(',').some(s=>this.classList.has(s.trim().replace(/^\./,'')));}
    closest(){return null;}
    getBoundingClientRect(){return {left:10,top:20,right:800,bottom:300,width:790,height:280};}
    querySelectorAll(selector){const list=[];for(const child of this.children){if(child.matches(selector))list.push(child);list.push(...child.querySelectorAll(selector));}return list;}
    querySelector(selector){if(selector.includes(':focus')||selector.includes('blGridActiveCell'))return this.editing?{}:null;return this.querySelectorAll(selector)[0]||null;}
    animate(frames,options){const entry={name:this.name,frames,options,cancelled:false};calls.push(entry);const listeners={};return {cancel(){entry.cancelled=true;listeners.cancel?.();},addEventListener(event,fn){listeners[event]=fn;}};}
  }
  const header=new Element('header','workspaceContextBar'),summary=new Element('summary','kpirow');
  const filters=new Element('filters','activeFilterBar'),toolbar=new Element('toolbar','tableActionToolbar');
  const cell=new Element('cell');cell.tagName='TD';
  const row=new Element('row');row.tagName='TR';row.cells=[cell];
  const grid=new Element('grid','table');grid.tagName='TABLE';grid.tBodies=[{rows:[row]}];
  const table=new Element('table','tablewrap',[grid]);grid.closest=selector=>selector==='.tablewrap'?table:null;
  const panel=new Element('panel','panel',[header,filters,toolbar,table]);
  const view=new Element('view','',[summary,panel]);if(late)view.children=[];
  let current=view;
  const html={dataset:{blMotion:off?'off':'on'}};
  const doc={documentElement:html,body:{dataset:{activeTab:'cp'}},visibilityState:hidden?'hidden':'visible',readyState:'complete',
    querySelector:selector=>selector==='main > section.active'?current:null,querySelectorAll:()=>[],
    addEventListener(name,fn){(events[name]??=[]).push(fn);}};
  const values={'--ui-motion-flow':'440ms','--ui-motion-stagger':'40ms','--ui-motion-distance':'14px','--ui-ease':'cubic-bezier(.2,.7,.3,1)'};
  const root={document:doc,innerWidth:1200,innerHeight:800,getComputedStyle:()=>({getPropertyValue:name=>values[name]||''}),
    matchMedia:()=>({matches:reduced,addEventListener:(name,fn)=>mediaEvents[name]=fn}),
    setTimeout(fn,delay){const id=++next;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),addEventListener(){},
    MutationObserver:class{constructor(fn){this.fn=fn;}observe(el){if(el===doc.body)observers.push(this.fn);}}};
  vm.runInNewContext(script,{window:root});
  const emit=(name,target=view)=>{for(const fn of events[name]||[])fn({target});};
  function flush(){let guard=0;while(timers.size){if(++guard>20)throw Error('Unbounded timers');for(const [id,t] of [...timers].sort((a,b)=>a[1].delay-b[1].delay))if(timers.delete(id))t.fn();}}
  return {root,doc,calls,view,header,summary,filters,toolbar,table,timers,values,emit,flush,Element,
    tick(){const [id,t]=[...timers].sort((a,b)=>a[1].delay-b[1].delay)[0];timers.delete(id);t.fn();},
    ready(){view.children=[summary,panel];},
    switch(){current=new Element('next','',[new Element('next-header','workspaceContextBar'),new Element('next-body')]);doc.body.dataset.activeTab='orders';for(const cb of observers)cb();return current;},
    hide(){doc.visibilityState='hidden';emit('visibilitychange');},
    reduce(){reduced=true;mediaEvents.change?.();}};
}

test('module entry follows header, summaries and content, with one animation per block',()=>{
  const h=harness();h.flush();
  assert.deepEqual(h.calls.map(c=>c.name),['header','summary','filters','toolbar','row']);
  assert.deepEqual(h.calls.slice(0,4).map(c=>c.options.delay),[0,40,80,120]);
  assert.equal(h.calls[4].options.delay,390*.18);
  assert.ok(h.calls.every(c=>c.options.duration+c.options.delay<=440));
  assert.equal(h.calls[0].frames[0].transform,'translate3d(0,14px,0)');
  assert.equal(h.calls[0].options.fill,'backwards','delayed blocks stay hidden until their turn, without a persistent transform');
  assert.equal(h.calls[0].options.easing,'cubic-bezier(.2,.7,.3,1)');
  assert.equal(h.view.textContent,'view');
  assert.equal(h.table.children.length,1,'entry never clones or rewrites table content');
  const count=h.calls.length;h.root.BLMotionPlus.activate(false);h.flush();assert.equal(h.calls.length,count,'same-module reactivation cannot replay the sequence');
});
test('late lazy content enters once, without replaying already visible blocks',()=>{
  const h=harness({late:true});assert.equal(h.calls.length,0);h.ready();h.flush();
  assert.equal(h.calls.filter(c=>c.name==='row').length,1);
  assert.equal(h.calls.filter(c=>c.name==='table').length,0,'table parents stay still');
  assert.equal(h.calls.filter(c=>c.name==='header').length,1);
});
test('fast navigation cancels the old sequence and leaves only the current module running',()=>{
  const h=harness();h.flush();const old=[...h.calls];h.switch();h.flush();
  assert.ok(old.length>0);assert.ok(old.every(c=>c.cancelled));
  assert.ok(h.calls.slice(old.length).every(c=>c.name.startsWith('next-')));
});
test('flow respects reduced motion, hidden documents and user opt-out',()=>{
  for(const opts of [{reduced:true},{hidden:true},{off:true}]){const h=harness(opts);h.flush();assert.equal(h.calls.length,0);}
  for(const action of ['hide','reduce']){const h=harness();h.flush();h[action]();assert.ok(h.calls.every(c=>c.cancelled));}
  const h=harness();h.flush();h.root.BLMotionPlus.setEnabled(false);assert.ok(h.calls.every(c=>c.cancelled));
});
test('editing, selection and interaction keep the data block stable',()=>{
  const h=harness({late:true});h.table.editing=true;h.ready();h.flush();
  assert.ok(h.calls.length>0);assert.equal(h.calls.filter(c=>c.name==='table').length,0);
  const a=harness();a.flush();const editor=new a.Element('editor');editor.tagName='INPUT';a.table.children.push(editor);a.emit('focusin',editor);assert.ok(a.calls.every(c=>c.cancelled));
});
test('table rows never overlap a moving parent or fall back to a cell wave',()=>{
  for(const editing of [false,true]){const h=harness({late:true});h.table.editing=editing;h.ready();h.flush();assert.equal(h.calls.filter(c=>c.name==='cell'||c.name==='table').length,0);}
});
test('settled empty states animate while loading placeholders stay still',()=>{
  const h=harness({late:true});h.table.classList.add('empty');h.table.querySelector=selector=>selector==='.uiState--empty,.uiState--error'?{}:null;h.ready();h.flush();
  assert.equal(h.calls.filter(c=>c.name==='table').length,1);
  const loading=harness({late:true});loading.table.classList.add('empty');loading.ready();loading.flush();assert.equal(loading.calls.filter(c=>c.name==='table').length,0);
});
test('a visible empty lazy host does not consume the later content entrance',()=>{
  const h=harness({late:true}),host=new h.Element('lazy-host');host.textContent='';h.view.children=[host];
  h.tick();assert.equal(h.calls.length,0,'an empty host stays unanimated while its module is loading');
  // No new module activation; its already scheduled readiness retries find the content.
  host.children=[h.header,h.summary,h.table];host.textContent='loaded';h.flush();
  assert.deepEqual(h.calls.map(c=>c.name),['header','summary','row']);
});
test('the real shell page title leads the flow when a module has no local heading',()=>{
  const h=harness(),title=new h.Element('shell-title');h.flush();h.doc.getElementById=id=>id==='pageTitle'?title:null;
  const count=h.calls.length;h.root.BLMotionPlus.activate(true);h.flush();assert.equal(h.calls[count].name,'shell-title');
});
test('layout scroll restoration does not cancel entry; user scrolling does',()=>{
  const h=harness();h.flush();h.emit('scroll');assert.ok(h.calls.every(c=>!c.cancelled));h.emit('wheel');assert.ok(h.calls.every(c=>c.cancelled));
});
