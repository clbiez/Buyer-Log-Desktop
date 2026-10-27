'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const publicRoot=path.join(__dirname,'..','public'),read=f=>fs.readFileSync(path.join(publicRoot,f),'utf8');

function harness({reduced=false,hidden=false,off=false}={}){
  const calls=[],timeouts=new Map();let next=0;
  const box=(x=10,y=20)=>({x,y,left:x,top:y,right:x+80,bottom:y+30,width:80,height:30});
  const node=(tag='TD',x=10,y=20)=>({
    tagName:tag,isConnected:true,hidden:false,textContent:'Saved data',dataset:{},
    getBoundingClientRect:()=>box(x,y),closest:()=>null,matches:()=>false,querySelector:()=>null,
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
test('Motion+ shared integration is loaded after canonical UI and KPI engine',()=>{
 const html=read('index.html');
 assert.ok(html.indexOf('ui-components.css')<html.indexOf('ui-motion.css'));
 assert.ok(html.indexOf('kpi-motion.js')<html.indexOf('motion-plus.js'));
 assert.match(read('ui-tokens.css'),/--ui-motion-table:390ms/);
 assert.match(read('ui-motion.css'),/prefers-reduced-motion:reduce/);
 assert.match(fs.readFileSync(path.resolve(publicRoot,'..','..','..','DESIGN_SYSTEM.md'),'utf8'),/Motion\+ zorunlu hareket sözleşmesidir/);
 assert.doesNotMatch(read('kpi-motion.js'),/data\.uiSystem==='manifest'.*overview/);
});
test('Diagonal table wave is bounded, starts top-left and never modifies cell text',()=>{
 const h=harness();h.flush();
 const wave=h.calls.filter(x=>x.tag==='TD');
 assert.equal(wave.length,4);
 assert.equal(wave[0].options.delay,0);
 assert.equal(wave[1].options.delay,12);
 assert.equal(wave[2].options.delay,23);
 assert.equal(wave[3].options.delay,35);
 assert.deepEqual(h.cells.map(c=>c.textContent),Array(4).fill('Saved data'));
 assert.equal(wave[0].frames[0].backgroundColor,'var(--ui-selected)');
 h.root.BLMotionPlus.activate(false);h.flush();
 assert.equal(h.calls.filter(x=>x.tag==='TD').length,4,'same active tab cannot repeat on redraw');
 h.root.BLMotionPlus.activate(true);h.flush();
 assert.equal(h.calls.filter(x=>x.tag==='TD').length,8,'explicit activation may replay');
});
test('Active cell is skipped and reduced motion, hidden tab and opt-out bypass animation',()=>{
 const a=harness();a.cells[0].matches=()=>true;a.flush();
 assert.equal(a.calls.filter(c=>c.tag==='TD').length,3);
 for(const config of [{reduced:true},{hidden:true},{off:true}]){
   const h=harness(config);h.flush();
   assert.equal(h.calls.length,0,JSON.stringify(config));
   assert.equal(h.root.BLMotionPlus.enabled(),false);
 }
});
test('Motion+ never creates full-table observers, infinite animations or new hard-coded colors',()=>{
 const script=read('motion-plus.js'),css=read('ui-motion.css');
 assert.match(script,/slice\(0,2\)/);assert.match(script,/bounds.right<=host.left/);assert.doesNotMatch(script,/cells.*slice\(0,12\)/);
 assert.doesNotMatch(script,/subtree\s*:\s*true|setInterval\(/);
 assert.doesNotMatch(css,/#[0-9a-f]{3,8}\b|rgba?\(|gradient\(/i);
 assert.doesNotMatch(css,/animation:[^;]*(?:infinite|loop)/i);
 assert.match(script,/blMotion!=='off'/);
});

test('KPI counter does not overlap Motion+ and returns the exact canonical string',()=>{
 const frames=[],el={textContent:'726.300',getBoundingClientRect:()=>({width:80,bottom:25,top:5})};
 const view={querySelectorAll:()=>[el]};
 const document={documentElement:{dataset:{}},querySelector:()=>view,addEventListener(){}};
 const window={document,innerHeight:800,matchMedia:()=>({matches:false}),
   requestAnimationFrame:callback=>frames.push(callback),setTimeout(){}};
 vm.runInNewContext(read('kpi-motion.js'),{window,performance:{now:()=>0}});
 window.BLKpiMotion.run(view);
 assert.equal(frames.length,1);
 frames.shift()(0);
 frames.shift()(320);
 window.BLKpiMotion.run(view);
 assert.equal(frames.length,1,'a second motion trigger must not restart an in-flight counter');
 frames.shift()(700);
 assert.equal(el.textContent,'726.300');
 window.BLKpiMotion.run(view);
 assert.equal(frames.length,0,'finished values are not restarted');
});
test('KPI counter drops out if its cell is rerendered during animation',()=>{
 const frames=[],el={textContent:'726.300',getBoundingClientRect:()=>({width:80,bottom:25,top:5})};
 const view={querySelectorAll:()=>[el]};
 const document={documentElement:{dataset:{}},querySelector:()=>view,addEventListener(){}};
 const window={document,innerHeight:800,matchMedia:()=>({matches:false}),
   requestAnimationFrame:callback=>frames.push(callback),setTimeout(){}};
 vm.runInNewContext(read('kpi-motion.js'),{window,performance:{now:()=>0}});
 window.BLKpiMotion.run(view);
 frames.shift()(0);el.textContent='4.000';frames.shift()(300);
 assert.equal(el.textContent,'4.000','canonical source wins over the abandoned animation');
});
