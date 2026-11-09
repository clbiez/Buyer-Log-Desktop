'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(process.env.BACKLOG_DATE_SOURCE||require.resolve('../public/backlog-date-range.js'),'utf8');
const start=source.indexOf('  function syncDisclosure('),end=source.indexOf('  function positionPanel()',start);
function fixture(collapsed){
 const calls=[],attributes={};
 const body={hidden:false,setAttribute:(key,value)=>{attributes[key]=value;},getBoundingClientRect(){throw Error('Initial date panel setup must not force layout');}};
 const toggle={setAttribute:(key,value)=>{attributes[key]=value;}},summary={textContent:'',hidden:false};
 const host={classList:{toggle(){}},querySelector:selector=>({'[data-range-body]':body,'[data-range-toggle]':toggle,'[data-range-summary]':summary})[selector]};
 const context={host,collapsed,FIELDS:{},window:{BLMotionPlus:{disclosure:(element,open,options)=>calls.push({element,open,options})}}};
 return {context,body,toggle,attributes,calls};
}
for(const collapsed of [false,true])test('initial date panel state avoids measuring layout: collapsed='+collapsed,()=>{
 const f=fixture(collapsed);vm.runInNewContext(source.slice(start,end)+'\nsyncDisclosure(true);',f.context);
 assert.equal(f.calls.length,0);assert.equal(f.body.hidden,collapsed);
 assert.equal(f.attributes['aria-hidden'],String(collapsed));assert.equal(f.attributes['aria-expanded'],String(!collapsed));
});
test('interactive date disclosure still uses shared Motion+',()=>{
 const f=fixture(true);vm.runInNewContext(source.slice(start,end)+'\nsyncDisclosure(false);',f.context);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].element,f.body);assert.equal(f.calls[0].open,false);assert.equal(f.calls[0].options.trigger,f.toggle);
});
