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
  const rows=[{cells:cells.slice(0,2)},{cells:cells.slice(2,4)}];
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

// waveTable used to start each cell animation and immediately measure the next
// cell; every animate() dirtied style, turning each read into a forced layout.
test('table wave measures every candidate cell before starting any animation',()=>{
  const h=harness();h.flush();
  const cellEvents=h.calls.filter(call=>call.read==='TD'||(call.tag==='TD'&&call.frames));
  const firstStart=cellEvents.findIndex(call=>call.frames);
  assert.ok(firstStart>0,'cells are animated');
  assert.equal(cellEvents.slice(firstStart).filter(call=>call.read).length,0,'no cell read after the first start');
  const delays=h.calls.filter(call=>call.tag==='TD'&&call.frames).map(call=>call.options.delay);
  assert.deepEqual(delays,[0,12,23,35],'stagger by row and column is unchanged');
});
