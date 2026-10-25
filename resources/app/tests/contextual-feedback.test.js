'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),UI=require('../public/ui-primitives');
test('persistence feedback distinguishes durable local acknowledgement, pending sharing, conflict and failure',()=>{
 const values=['local','pending','conflict','failed'].map(status=>UI.persistenceView(status,{language:'en'}));
 assert.equal(new Set(values).size,4);assert.match(values[0],/Saved on this device/);assert.match(values[1],/Sharing pending/);assert.match(values[2],/Conflict/);assert.match(values[3],/Save failed/);
 assert.match(UI.persistenceView('failed',{detail:'<img onerror=bad>'}),/&lt;img/);assert.doesNotMatch(values.join(''),/Spinner|animation/);
});
test('export progress follows completed units, yields and prevents work after cancellation',async()=>{
 const events=[];let yielded=0;const op=UI.createProgress({total:10,onProgress:x=>events.push(x),yieldTask:async()=>yielded++});
 op.checkpoint(3,'Rows');await op.yield();assert.equal(yielded,1);assert.equal(events.at(-1).completed,3);assert.equal(events.at(-1).total,10);
 op.checkpoint(1,'Rows');assert.equal(events.at(-1).completed,3,'progress cannot move backwards');op.checkpoint(99,'Rows');assert.equal(events.at(-1).completed,10);
 op.cancel();assert.throws(()=>op.checkpoint(10,'Done'),{name:'AbortError'});await assert.rejects(op.yield(),{name:'AbortError'});assert.equal(yielded,1,'cancelled work does not schedule another slice');
});
test('packing has no fabricated percentage and an independent export is not cancelled',()=>{
 const events=[],a=UI.createProgress({total:2,onProgress:v=>events.push(v)}),b=UI.createProgress({total:1});a.checkpoint(2,'Packing',{indeterminate:true});assert.equal(events.at(-1).indeterminate,true);a.cancel();assert.doesNotThrow(()=>b.checkpoint(1,'Done'));
 const html=UI.progressView({label:'Packing <file>',completed:2,total:2,indeterminate:true,cancellable:true,language:'en'});assert.match(html,/Packing &lt;file&gt;/);assert.match(html,/data-ui-progress-cancel/);assert.doesNotMatch(html,/<progress[^>]*value=/);
});
test('progress updates retain the same cancel button so pointer and keyboard activation remain possible',()=>{
 let nodes=null,replacements=0;
 const make=()=>({textContent:'',hidden:false,setAttribute(){},removeAttribute(){}});
 const target={set innerHTML(_value){replacements++;nodes={'.uiProgress':make(),'[data-ui-progress-label]':make(),'progress':make(),'[data-ui-progress-units]':make(),'[data-ui-progress-cancel]':make()};},querySelector:key=>nodes?.[key]||null};
 let cancelled=0;UI.renderProgress(target,{completed:1,total:100,cancellable:true,onCancel:()=>cancelled++});const button=target.querySelector('[data-ui-progress-cancel]');
 for(let completed=2;completed<=100;completed++)UI.renderProgress(target,{completed,total:100,cancellable:true,onCancel:()=>cancelled++});
 assert.equal(replacements,1);assert.equal(target.querySelector('[data-ui-progress-cancel]'),button);button.onclick();assert.equal(cancelled,1);
});
