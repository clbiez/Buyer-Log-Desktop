'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=f=>fs.readFileSync(path.join(__dirname,'../public',f),'utf8');
function harness({reduced=false,hidden=false,off=false}={}){
 const calls=[],media={matches:reduced,addEventListener(){}},listeners={};
 function node(height=180){
  const values=new Map(),attrs={};
  const el={hidden:false,inert:false,isConnected:true,children:[],attrs,dataset:{},
   style:{getPropertyValue:k=>values.get(k)?.[0]||'',getPropertyPriority:k=>values.get(k)?.[1]||'',setProperty:(k,v,p='')=>values.set(k,[v,p]),removeProperty:k=>values.delete(k)},
   getBoundingClientRect:()=>({left:0,right:400,top:30,bottom:30+height,width:400,height:el.hidden&&values.get('display')?.[1]!=='important'?0:height}),
   closest:()=>null,matches:()=>false,contains:x=>x===el||el.children.includes(x),setAttribute:(k,v)=>attrs[k]=v,
   animate(frames,options){const events={};const a={frames,options,target:el,cancelled:false,addEventListener:(n,fn)=>{events[n]=fn;},finish:()=>events.finish?.(),cancel(){if(a.cancelled)return;a.cancelled=true;events.cancel?.();}};calls.push(a);return a;}
  };return el;
 }
 const doc={documentElement:{dataset:{blMotion:off?'off':'on'}},visibilityState:hidden?'hidden':'visible',readyState:'loading',activeElement:null,addEventListener:(n,fn)=>{listeners[n]=fn;}};
 const root={document:doc,innerWidth:1000,innerHeight:800,matchMedia:()=>media,getComputedStyle:el=>({opacity:'1',display:el.hidden?'none':'grid',getPropertyValue:key=>({'--ui-motion-disclosure':'390ms','--ui-motion-disclosure-step':'32ms'}[key]||'')})};
 vm.runInNewContext(read('motion-plus.js'),{window:root});
 const panel=node();panel.parentElement=node();panel.children=Array.from({length:12},()=>node(20));
 const trigger={focus(){doc.activeElement=trigger;},isConnected:true,hidden:false,closest:()=>null,getBoundingClientRect:()=>({left:0,right:400,top:0,bottom:30,width:400,height:30})};
 return {root,doc,calls,panel,trigger,media,listeners,node};
}
test('shared disclosure animates actual opening and closing; state, values and DOM identity survive',()=>{
 const h=harness(),{panel,root,calls,trigger}=h,children=panel.children.slice();panel.hidden=true;
 const open=root.BLMotionPlus.disclosure(panel,true,{trigger});
 assert.equal(open.frames[0].height,'0px');assert.equal(open.frames[1].height,'180px');
 assert.equal(open.options.duration,390);assert.equal(panel.hidden,false);
 assert.deepEqual(calls.slice(1).map(a=>a.options.delay),[0,32,64,96,128,160]);
 open.finish();assert.equal(panel.inert,false);assert.equal(panel.style.getPropertyValue('display'),'');
 h.doc.activeElement=panel.children[0];
 const close=root.BLMotionPlus.disclosure(panel,false,{trigger});
 assert.equal(panel.hidden,true);assert.equal(panel.inert,true);assert.equal(h.doc.activeElement,trigger);
 assert.equal(close.frames[0].height,'180px');assert.equal(close.frames[1].height,'0px');
 assert.equal(close.options.duration,304.2);assert.equal(panel.style.getPropertyPriority('display'),'important');
 close.finish();assert.equal(panel.style.getPropertyValue('display'),'');
 root.BLMotionPlus.disclosure(panel,true,{trigger}).finish();
 assert.equal(panel.inert,false,'reopening restores the original interaction state');assert.deepEqual(panel.children,children);
});
test('rapid reversals cancel old work and settle on the latest request, preserving inline layout',()=>{
 const h=harness(),{panel,root,trigger}=h;
 panel.style.setProperty('overflow','auto');panel.style.setProperty('height','180px');
 const closing=root.BLMotionPlus.disclosure(panel,false,{trigger});
 const opening=root.BLMotionPlus.disclosure(panel,true,{trigger});
 assert.equal(closing.cancelled,true);opening.finish();
 assert.equal(panel.hidden,false);assert.equal(panel.inert,false);
 assert.equal(panel.style.getPropertyValue('height'),'180px');assert.equal(panel.style.getPropertyValue('overflow'),'auto');
 assert.equal(h.calls.every(a=>a.cancelled),true);
});
test('reduced motion, hidden document, opt-out and initial restoration take the immediate path',()=>{
 for(const options of [{reduced:true},{hidden:true},{off:true},{}]){
  const h=harness(options);h.panel.hidden=true;
  h.root.BLMotionPlus.disclosure(h.panel,true,{trigger:h.trigger,initial:!Object.keys(options).length});
  assert.equal(h.calls.length,0);assert.equal(h.panel.hidden,false);assert.equal(h.panel.inert,false);
 }
});
test('active editing and selected cells do not receive stagger effects; disabling motion settles closures',()=>{
 const h=harness();h.doc.activeElement=h.panel.children[0];h.panel.children[1].matches=s=>s.includes('[aria-selected');
 h.root.BLMotionPlus.disclosure(h.panel,true,{trigger:h.trigger,initial:true});
 h.root.BLMotionPlus.disclosure(h.panel,false,{trigger:h.trigger});
 assert.equal(h.calls.some(a=>a.target===h.panel.children[1]),false);
 h.root.BLMotionPlus.setEnabled(false);
 assert.equal(h.panel.hidden,true);assert.equal(h.panel.style.getPropertyValue('display'),'');assert(h.calls.every(a=>a.cancelled));
});
test('native details preserve native semantics and floating pickers, using shared timing and reduced-motion guards',()=>{
 const css=read('ui-motion.css'),js=read('motion-plus.js');
 assert.match(css,/interpolate-size:allow-keywords/);assert.match(css,/content-visibility[^;]+allow-discrete/);
 assert.match(css,/data-bl-disclosure="overlay"/);assert.match(css,/prefers-reduced-motion:reduce/);
 assert.match(read('ui-tokens.css'),/--ui-motion-disclosure-step:32ms/);assert.match(js,/doc\.addEventListener\('toggle'/);
 assert.doesNotMatch(js,/subtree\s*:\s*true|setInterval\(/);
});
test('closing native details removes its editors from Tab order and restores original inert state on reopen',()=>{
 const h=harness({off:true});h.listeners.DOMContentLoaded();
 const summary=h.node(20),body=h.node(),editor=h.node(20),details=h.node();
 summary.tagName='SUMMARY';summary.focus=()=>{h.doc.activeElement=summary;};
 body.children=[editor];details.tagName='DETAILS';details.children=[summary,body];details.querySelector=()=>summary;
 h.doc.activeElement=editor;details.open=false;h.listeners.toggle({target:details});
 assert.equal(body.inert,true);assert.equal(h.doc.activeElement,summary);
 details.open=true;h.listeners.toggle({target:details});assert.equal(body.inert,false);
 const locked=h.node();locked.inert=true;details.children=[summary,locked];
 details.open=false;h.listeners.toggle({target:details});details.open=true;h.listeners.toggle({target:details});
 assert.equal(locked.inert,true,'an existing read-only body remains inert');
});
