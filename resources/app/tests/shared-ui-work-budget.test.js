'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=file=>fs.readFileSync(path.join(__dirname,'../public',file),'utf8');

function headerRuntime(){
  const events=[],frames=[],listeners={},labels=[];
  const rect=(name,left,right)=>{events.push('read:'+name);return {left,right};};
  const groups=[0,1,2].map(i=>{
    const label={style:new Proxy({},{set(target,key,value){events.push('write:'+i+':'+key);target[key]=key==='transform'?value.replace(/,\s*0(?:px)?/g,', 0px'):value;return true;}})};labels.push(label);
    return {querySelector:()=>label,classList:{contains:()=>i===0},getBoundingClientRect:()=>rect('group'+i,i*250-150,(i+1)*250-150)};
  });
  const columns=[0,1,2].map(i=>({style:new Proxy({top:'25px'},{set(target,key,value){events.push('write:column'+i+':'+key);target[key]=value;return true;}})}));
  const groupRow={get offsetHeight(){events.push('read:header-height');return 33;}};
  const thead={querySelector:selector=>selector==='tr.groupRow'?groupRow:{getBoundingClientRect:()=>rect('freeze',0,100)},querySelectorAll:selector=>selector==='tr.colRow th'?columns:groups};
  const table={tHead:thead,getAttribute:()=>240};
  const wrap={clientWidth:600,clientLeft:1,isConnected:true,querySelector:()=>table,getBoundingClientRect:()=>rect('wrap',0,600),addEventListener:(name,cb)=>listeners[name]=cb};
  table.closest=()=>wrap;
  vm.runInNewContext(source('table-header-tracking.js'),{window:{addEventListener(){}},document:{readyState:'complete',getElementById:id=>id==='cpTable'?table:null,addEventListener(){}},MutationObserver:class{observe(){}},requestAnimationFrame:cb=>frames.push(cb)});
  return {events,labels,columns,tick(){for(const cb of frames.splice(0))cb();},scroll(){listeners.scroll();}};
}
test('SHELL-08 reads all group geometry before writing styles, and skips identical writes',()=>{
  const ui=headerRuntime();ui.tick();
  const firstWrite=ui.events.findIndex(e=>e.startsWith('write:'));
  assert.ok(firstWrite>0);assert.ok(ui.events.slice(0,firstWrite).includes('read:group2'));
  assert.equal(ui.events.slice(firstWrite).some(e=>e.startsWith('read:')),false,ui.events.join(','));
  ui.events.length=0;ui.scroll();ui.scroll();ui.tick();
  assert.equal(ui.events.filter(e=>e==='read:wrap').length,1,'one update per frame');
  assert.equal(ui.events.some(e=>e.startsWith('write:')),false,'unchanged captions must not mutate style');
});

test('SHELL-08 sticky column headings follow the measured group band height',()=>{
  const ui=headerRuntime();ui.tick();
  for(const th of ui.columns)assert.equal(th.style.top,'33px');
});
