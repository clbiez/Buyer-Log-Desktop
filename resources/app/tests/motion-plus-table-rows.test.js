'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const script=fs.readFileSync(path.join(__dirname,'../public/motion-plus.js'),'utf8');

function harness({reduced=false,hidden=false,off=false,software=false,count=10,tableCount=1,late=false,protect=[],outside=[],hostBottom}={}){
  const calls=[],timers=new Map(),events={};let next=0;
  const box=(y=20)=>({left:10,top:y,right:790,bottom:y+30,width:780,height:30});
  const node=(tag,y=20)=>({
    tagName:tag,isConnected:true,hidden:false,textContent:'Saved data',dataset:{},
    getBoundingClientRect(){calls.push({read:tag});return box(y);},
    closest:()=>null,matches:()=>false,querySelector:()=>null,
    animate(frames,options){const call={tag,frames,options,cancelled:false,target:this};calls.push(call);const listeners={};return {cancel(){call.cancelled=true;listeners.cancel?.();},addEventListener(event,fn){listeners[event]=fn;}};}
  });
  const tables=Array.from({length:tableCount},()=>{
    const table=node('TABLE');
    if(hostBottom)table.closest=selector=>selector==='.tablewrap'?{getBoundingClientRect:()=>({...box(),top:20,bottom:hostBottom})}:null;
    table.tBodies=[{rows:Array.from({length:count},(_,i)=>{
      const row=node('TR',outside.includes(i)?900:20+i*32);
      row.cells=[node('TD'),node('TD')];
      row.querySelector=()=>protect.includes(i)?{}:null;
      return row;
    })}];
    return table;
  });
  let ready=!late;
  const view=node('SECTION');view.contains=target=>target===view;
  view.querySelectorAll=s=>s==='table'&&ready?tables:[];
  const doc={documentElement:{dataset:{blMotion:off?'off':'on',blRender:software?'software':'gpu'}},body:{dataset:{activeTab:'cp'}},
    visibilityState:hidden?'hidden':'visible',readyState:'complete',querySelector:()=>view,querySelectorAll:()=>[],
    addEventListener(name,fn){(events[name]??=[]).push(fn);}};
  const root={document:doc,innerWidth:1200,innerHeight:800,
    matchMedia:()=>({matches:reduced,addEventListener(){}}),
    setTimeout(fn,delay){const id=++next;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),addEventListener(){}};
  vm.runInNewContext(script,{window:root});
  function flush(){let guard=0;while(timers.size){if(++guard>20)throw Error('Timer loop');for(const [id,t] of [...timers].sort((a,b)=>a[1].delay-b[1].delay))if(timers.delete(id))t.fn();}}
  return {root,doc,view,tables,calls,flush,ready(){ready=true;},emit(name){for(const fn of events[name]||[])fn({target:view});}};
}

test('row entrance measures its bounded queue before any animation writes',()=>{
  const h=harness({tableCount:3});h.flush();
  const events=h.calls.filter(c=>c.read==='TR'||c.tag==='TR'),first=events.findIndex(c=>c.frames);
  assert.ok(first>0,'visible rows animate');
  assert.equal(events.slice(first).filter(c=>c.read).length,0,'no row measurements after the first animation write');
  const entries=h.calls.filter(c=>c.tag==='TR');
  assert.equal(entries.length,20,'every visible row in each of two tables enters, including rows below the sixth');
  assert.equal(h.calls.filter(c=>c.tag==='TD'||c.tag==='TABLE').length,0,'no cell or table-parent effects');
  assert.equal(h.calls.filter(c=>c.read==='TR').length,20,'measure only the first two tables');
  entries.forEach((c,i)=>{
    assert.equal(c.options.delay,390*(.18+Math.min(i%10,5)*.06));
    assert.equal(c.options.duration,390*.52);
    assert.ok(c.options.delay+c.options.duration<=391);
    assert.equal(c.frames[0].transform,'translate3d(0,10px,0)');
    assert.equal(c.options.fill,'backwards');
    assert.deepEqual(Object.keys(c.frames[0]).sort(),['opacity','transform']);
    assert.equal(c.target.textContent,'Saved data');
  });
});
test('protected and offscreen rows stay still without changing cell state',()=>{
  const h=harness({count:8,protect:[0,2],outside:[1]});h.flush();
  const entries=h.calls.filter(c=>c.tag==='TR');
  assert.equal(entries.length,5,'every eligible visible data row enters');
  for(const i of [0,1,2])assert.ok(!entries.some(c=>c.target===h.tables[0].tBodies[0].rows[i]));
  assert.equal(h.tables[0].tBodies[0].rows[0].cells[0].textContent,'Saved data');
});
test('lazy tables enter once; redraws and same-module clicks never replay rows',()=>{
  const h=harness({late:true});assert.equal(h.calls.filter(c=>c.tag==='TR').length,0);
  h.ready();h.flush();assert.equal(h.calls.filter(c=>c.tag==='TR').length,10);
  h.root.BLMotionPlus.activate(false);h.flush();assert.equal(h.calls.filter(c=>c.tag==='TR').length,10);
  h.root.BLMotionPlus.activate(true);h.flush();assert.equal(h.calls.filter(c=>c.tag==='TR').length,20);
});
test('viewport height limits entry, not a fixed row count',()=>{
  const h=harness({count:1000});h.flush();
  const entries=h.calls.filter(c=>c.tag==='TR');
  assert.equal(entries.length,25,'all rows intersecting the 800px viewport enter');
  assert.ok(entries.every(c=>c.options.delay+c.options.duration<=391),'lower rows finish within the shared motion budget');
  assert.ok(!entries.some(c=>c.target===h.tables[0].tBodies[0].rows[25]),'rows below the viewport stay still');
  assert.ok(h.calls.filter(c=>c.read==='TR').length<=128,'large datasets retain the bounded probe');
});
test('rows below the sixth still respect selection and the scroll container',()=>{
  const h=harness({count:30,protect:[7],hostBottom:340});h.flush();
  const entries=h.calls.filter(c=>c.tag==='TR');
  assert.equal(entries.length,9,'ten rows intersect the scroll container, one is protected');
  assert.ok(entries.some(c=>c.target===h.tables[0].tBodies[0].rows[9]),'last unprotected visible row enters');
  assert.ok(!entries.some(c=>c.target===h.tables[0].tBodies[0].rows[7]),'selected lower row stays still');
  assert.ok(!entries.some(c=>c.target===h.tables[0].tBodies[0].rows[10]),'clipped rows stay still');
});
test('row effects respect motion preferences, visibility and software compositing',()=>{
  for(const opts of [{reduced:true},{hidden:true},{off:true},{software:true}]){
    const h=harness(opts);h.flush();assert.equal(h.calls.filter(c=>c.tag==='TR').length,0,JSON.stringify(opts));
  }
});
test('interaction and navigation cancel old row effects and stop pending retries',()=>{
  const h=harness(),old=h.calls.filter(c=>c.tag==='TR');h.emit('wheel');h.flush();
  assert.ok(old.length>0&&old.every(c=>c.cancelled));
  assert.equal(h.calls.filter(c=>c.tag==='TR').length,old.length);
  const a=harness(),before=a.calls.filter(c=>c.tag==='TR');a.doc.body.dataset.activeTab='orders';a.root.BLMotionPlus.activate(false);a.flush();
  assert.ok(before.every(c=>c.cancelled));
});
test('deep saved scroll positions have a bounded measurement budget',()=>{
  const h=harness({count:10000,outside:Array.from({length:10000},(_,i)=>i)});h.flush();
  assert.ok(h.calls.filter(c=>c.read==='TR').length<=128*4,'row probes stay bounded across readiness retries');
  assert.equal(h.calls.filter(c=>c.tag==='TR').length,0);
});
