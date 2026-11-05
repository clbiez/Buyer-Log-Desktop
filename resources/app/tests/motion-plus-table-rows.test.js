'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const script=fs.readFileSync(path.join(__dirname,'../public/motion-plus.js'),'utf8');

function harness({reduced=false,hidden=false,off=false,software=false,count=10,tableCount=1,late=false,protect=[],outside=[]}={}){
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
  assert.equal(entries.length,12,'at most six visible rows in each of two tables');
  assert.equal(h.calls.filter(c=>c.tag==='TD'||c.tag==='TABLE').length,0,'no cell or table-parent effects');
  assert.equal(h.calls.filter(c=>c.read==='TR').length,12,'stop probing after six visible rows');
  entries.slice(0,6).forEach((c,i)=>{
    assert.equal(c.options.delay,390*(.18+i*.06));
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
  assert.equal(entries.length,4,'only eligible rows among the first six visible data rows enter');
  for(const i of [0,1,2])assert.ok(!entries.some(c=>c.target===h.tables[0].tBodies[0].rows[i]));
  assert.equal(h.tables[0].tBodies[0].rows[0].cells[0].textContent,'Saved data');
});
test('lazy tables enter once; redraws and same-module clicks never replay rows',()=>{
  const h=harness({late:true});assert.equal(h.calls.filter(c=>c.tag==='TR').length,0);
  h.ready();h.flush();assert.equal(h.calls.filter(c=>c.tag==='TR').length,6);
  h.root.BLMotionPlus.activate(false);h.flush();assert.equal(h.calls.filter(c=>c.tag==='TR').length,6);
  h.root.BLMotionPlus.activate(true);h.flush();assert.equal(h.calls.filter(c=>c.tag==='TR').length,12);
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
