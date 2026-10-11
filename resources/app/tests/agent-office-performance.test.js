'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function office(){
  const requests=[],events=new Map();
  const host={innerHTML:'',querySelector(){return null;},querySelectorAll(){return [];},addEventListener(){}};
  const document={documentElement:{lang:'en'},body:{dataset:{activeTab:'overview'}},hidden:false,getElementById:id=>id==='agentOfficeRoot'?host:id==='agentOfficeCss'?{}:null,addEventListener(){}};
  const root={addEventListener:(name,fn)=>events.set(name,fn),BuyerLogAI:{onStatus(){}},BL_USER_CONTEXT:{id:'a'}};
  const context={window:root,document,MutationObserver:class{observe(){}},structuredClone,setInterval(){},setTimeout,fetch:(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}))};
  const source=fs.readFileSync(path.join(__dirname,'../public/agent-office.js'),'utf8').replace('root.BLAgentOffice={mount,','root.BLAgentOffice={api, mount,');
  vm.runInNewContext(source,context);
  return {root,requests,switchOwner:()=>events.get('bl:user-access-applied')({detail:{id:'b'}}),respond:(index,value={})=>requests[index].resolve({ok:true,json:async()=>value})};
}
test('Agent Office coalesces pending reads only until a mutation or owner change',async t=>{
  const f=office(),api=f.root.BLAgentOffice.api;
  const first=api('/state'),second=api('/state');
  const count=f.requests.length;t.diagnostic(`Concurrent office state reads: ${count} request(s)`);
  for(let i=0;i<count;i++)f.respond(i,{state:{owner:'a'}});
  const [a,b]=await Promise.all([first,second]);a.state.owner='changed';assert.equal(b.state.owner,'a');assert.equal(count,1);
  const read=api('/state'),mutation=api('/sync',{}),fresh=api('/state');
  assert.equal(f.requests.length,4);f.respond(1);f.respond(2);f.respond(3);await Promise.all([read,mutation,fresh]);
  const write=api('/sync',{}),during=api('/state');f.respond(4);await write;
  const after=api('/state');assert.equal(f.requests.length,7);f.respond(5);f.respond(6);await Promise.all([during,after]);
  const mount=f.root.BLAgentOffice.mount(),old=api('/state');assert.equal(f.requests.length,8);f.switchOwner();
  const next=api('/state');assert.equal(f.requests.length,9);f.respond(7,{state:{profiles:[]}});f.respond(8,{state:{owner:'b'}});
  await assert.rejects(old,e=>e.code==='OFFICE_SESSION_CHANGED');await mount;assert.equal((await next).state.owner,'b');
});
test('unchanged Agent Office scene updates and controls avoid render invalidation',t=>{
  let invalidations=0;
  const source=fs.readFileSync(path.join(__dirname,'../public/agent-office-scene.js'),'utf8').replace("import('/agent-office-workshop-model.js')",'Promise.resolve(null)').replace('function schedule(){','function schedule(){testInvalidation();');
  const root={matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}})};
  const document={hidden:false,addEventListener(){},removeEventListener(){}};
  const canvas={getContext:()=>({}),addEventListener(){},removeEventListener(){},dataset:{},classList:{toggle(){}}};
  vm.runInNewContext(source,{window:root,document,Image:class{},structuredClone,requestAnimationFrame:()=>1,cancelAnimationFrame(){},setTimeout,clearTimeout,performance:{now:()=>1},testInvalidation:()=>invalidations++});
  const scene=root.BLAgentOfficeScene.create(canvas),data={profiles:[],office:{scene:'workshop-v1',furniture:[],period:'noon'},connected:false};
  scene.update(data);scene.select('a');scene.edit(true);scene.setSimulation(false);scene.start();
  const initial=invalidations;
  for(let i=0;i<100;i++){scene.update(structuredClone(data));scene.select('a');scene.edit(true);scene.setSimulation(false);scene.start();}
  t.diagnostic(`100 identical scene renders: ${invalidations-initial} invalidations`);
  assert.equal(invalidations,initial);
  scene.update({...data,connected:true});scene.select('b');scene.edit(false);scene.setSimulation(true);
  assert.equal(invalidations,initial+4);scene.destroy();
});
