'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const publicRoot=path.join(__dirname,'..','public'),read=f=>fs.readFileSync(path.join(publicRoot,f),'utf8');

function harness({reduced=false,hidden=false,off=false}={}){
  const calls=[],timeouts=new Map();let next=0;
  const box=(x=10,y=20)=>({x,y,left:x,top:y,right:x+80,bottom:y+30,width:80,height:30});
  const node=(tag='TD',x=10,y=20)=>({
    tagName:tag,isConnected:true,hidden:false,textContent:'Saved data',dataset:{},
    getBoundingClientRect:()=>{calls.push({read:tag});return box(x,y);},closest:()=>null,matches:()=>false,querySelector:()=>null,
    animate(frames,options){calls.push({tag,frames,options});return {cancel(){},addEventListener(){}};}
  });
  const cells=[node('TD',10,20),node('TD',90,20),node('TD',10,50),node('TD',90,50)];
  const rows=[node('TR',10,20),node('TR',10,50)];
  rows.forEach((row,i)=>row.cells=cells.slice(i*2,i*2+2));
  const table=node('TABLE');table.tBodies=[{rows}];
  const card=node('DIV');
  const view=node('SECTION');
  view.querySelectorAll=s=>s==='table'?[table]:s.includes('.bpaTile')?[card]:[];
  view.querySelector=()=>null;
  const body={dataset:{activeTab:'cp'},addEventListener(){}};
  const doc={documentElement:{dataset:{blMotion:off?'off':'on'}},body,
    visibilityState:hidden?'hidden':'visible',readyState:'complete',
    querySelector:()=>view,querySelectorAll:()=>[],addEventListener(){}};
  const root={document:doc,innerWidth:1200,innerHeight:800,
    matchMedia:()=>({matches:reduced,addEventListener(){}}),
    setTimeout(fn,delay){const id=++next;timeouts.set(id,{fn,delay});return id;},
    clearTimeout:id=>timeouts.delete(id),addEventListener(){}};
  vm.runInNewContext(read('motion-plus.js'),{window:root});
  function flush(){
    let guard=0;
    while(timeouts.size){if(++guard>20)throw Error('Timer loop');
      const entries=Array.from(timeouts.entries()).sort((a,b)=>a[1].delay-b[1].delay);
      for(const [id,t] of entries){if(timeouts.delete(id))t.fn();}
    }
  }
  return {root,doc,view,cells,calls,flush};
}

// Keep the former cell-wave regression at row level: all geometry reads must
// complete before any animation writes can invalidate layout.
test('table entry measures every candidate row before starting any animation',()=>{
  const h=harness();h.flush();
  const rowEvents=h.calls.filter(call=>call.read==='TR'||(call.tag==='TR'&&call.frames));
  const firstStart=rowEvents.findIndex(call=>call.frames);
  assert.ok(firstStart>0,'rows are animated');
  assert.equal(rowEvents.slice(firstStart).filter(call=>call.read).length,0,'no row read after the first start');
  const delays=h.calls.filter(call=>call.tag==='TR'&&call.frames).map(call=>call.options.delay);
  assert.deepEqual(delays,[390*.18,390*(.18+.06)],'rows use the selected stagger recipe');
});
