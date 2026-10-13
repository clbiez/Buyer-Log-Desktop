'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/agent-office.js'),'utf8');
function client(){
  const events=new Map(),clicks=new Map(),requests=[];
  const host={innerHTML:'',addEventListener(name,callback){clicks.set(name,callback);},querySelector(){return null;},querySelectorAll(){return [];}};
  const document={documentElement:{lang:'en'},body:{dataset:{activeTab:'overview'}},hidden:false,getElementById(id){return id==='agentOfficeRoot'?host:id==='agentOfficeCss'?{}:null;},addEventListener(){},createElement(){return {setAttribute(){}};}};
  const root={addEventListener(name,callback){events.set(name,callback);},BuyerLogAI:{onStatus(){}},BL_USER_CONTEXT:{id:'owner-a'}};
  const context=vm.createContext({window:root,document,MutationObserver:class{observe(){}},structuredClone,setInterval(){},setTimeout,fetch(url){return new Promise(resolve=>requests.push({url,resolve}));}});
  vm.runInContext(source,context,{filename:'agent-office.js'});
  const respond=(index,value,ok=true)=>requests[index].resolve({ok,json:async()=>value});
  const refresh=()=>clicks.get('click')({preventDefault(){},target:{closest(selector){return selector==='[data-ao-action]'?{dataset:{aoAction:'refresh'}}:null;}}});
  const switchOwner=()=>events.get('bl:user-access-applied')({detail:{id:'owner-b'}});
  return {root,host,requests,respond,refresh,switchOwner};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('pending mount cannot render an old-owner response or stale failure into the new office',async()=>{
  const c=client(),mount=c.root.BLAgentOffice.mount();assert.equal(c.requests.length,1);
  c.switchOwner();c.respond(0,{state:{profiles:[{id:'private-old-owner'}]}});await mount;
  assert.equal(c.root.BLAgentOffice.getState().generation,1);
  assert.equal(c.root.BLAgentOffice.getState().data,null);
  assert.equal(c.root.BLAgentOffice.getState().error,'');assert.equal(c.host.innerHTML,'');
});
test('pending UI action is discarded across owner change while current permission errors remain visible',async()=>{
  const c=client(),mount=c.root.BLAgentOffice.mount();c.refresh();assert.equal(c.requests.length,1);
  c.switchOwner();c.respond(0,{code:'OFFICE_AUTOMATION_FORBIDDEN'},false);await settle();
  assert.equal(c.root.BLAgentOffice.getState().error,'');assert.equal(c.root.BLAgentOffice.getState().data,null);
  await mount;
  c.refresh();assert.equal(c.requests.length,2);c.respond(1,{code:'OFFICE_AUTOMATION_FORBIDDEN'},false);await settle();
  assert.match(c.root.BLAgentOffice.getState().error,/do not have permission/);
  assert.equal(c.root.BLAgentOffice.getState().data,null);
});
test('profile task-execution checkbox roundtrips the persistent boolean and paused errors are localized',()=>{const block=source.slice(source.indexOf('function profileDialog('),source.indexOf('function memoryDialog('));assert.match(block,/name="enabled" \$\{agent\.enabled!==false\?'checked':''\}/);assert.match(block,/enabled:checked\(modal,'enabled'\)/);assert.match(block,/Run approved and scheduled tasks/);assert.match(source,/OFFICE_AGENT_DISABLED:L\('Agentın görev yürütmesi duraklatıldı\.[^']*','Task execution is paused for this agent\.[^']*'\)/);});
