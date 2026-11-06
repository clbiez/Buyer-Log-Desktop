'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {extractFunction}=require('./helpers/app-main-functions'),source=fs.readFileSync(require.resolve('../scripts/benchmark-server-openings'),'utf8');
function setup(){
  const state={rows:[],loading:true,error:'',parity:null},flags={active:'backlog',tree:true,overviewOpen:false,hero:false};
  const c={window:{BLBacklogAnalysis:{_state:state}},lastBacklogData:{totalRows:2},document:{body:{dataset:{get activeTab(){return flags.active;}}},
    getElementById:()=>({getAttribute:()=>String(flags.overviewOpen)}),querySelector:selector=>selector.includes('backlogTreeTable')?(flags.tree?{}:null):(flags.hero?{}:null)}};
  vm.createContext(c);vm.runInContext(extractFunction(source,'backlogScreenReady')+';globalThis.ready=backlogScreenReady;',c);return {c,state,flags};
}
test('a ready pivot does not end the opening window while the visible Delivery report is still loading',()=>{
  const f=setup();assert.equal(f.c.ready(),false);f.state.rows=[{},{}];assert.equal(f.c.ready(),false);
  f.state.loading=false;f.state.parity={match:true};assert.equal(f.c.ready(),true);
  f.state.rows.pop();assert.equal(f.c.ready(),false);
});
test('an error, parity mismatch, inactive tab or expanded unready Overview cannot be reported as ready',()=>{
  const f=setup();Object.assign(f.state,{rows:[{},{}],loading:false,parity:{match:true}});
  f.state.error='synthetic failure';assert.equal(f.c.ready(),false);f.state.error='';f.state.parity.match=false;assert.equal(f.c.ready(),false);f.state.parity.match=true;
  f.flags.active='overview';assert.equal(f.c.ready(),false);f.flags.active='backlog';f.flags.overviewOpen=true;assert.equal(f.c.ready(),false);f.flags.hero=true;assert.equal(f.c.ready(),true);
});
test('fatal server exceptions fail an opening even after renderer and timing checks passed',()=>{
 const c={};vm.createContext(c);vm.runInContext(extractFunction(source,'assertNoFatalServerErrors')+';globalThis.check=assertNoFatalServerErrors;',c);
 assert.doesNotThrow(()=>c.check('[RUNTIME] event-loop-stall blockedMs=100\n[2026-11-06] expected connection error'));
 for(const line of ['[2026-11-06] uncaughtException: synthetic exception','[2026-11-06] unhandledRejection: synthetic rejection'])assert.throws(()=>c.check(line),/Fatal server exception/);
});
test('forced or failed server shutdown cannot qualify as a successful opening run',()=>{
 const c={};vm.createContext(c);vm.runInContext(extractFunction(source,'assertServerShutdown')+';globalThis.check=assertServerShutdown;',c);
 for(const result of [{code:0,signal:null,forced:false},{code:null,signal:'SIGTERM',forced:false}])assert.doesNotThrow(()=>c.check(result));
 for(const result of [{code:0,signal:null,forced:true},{code:1,signal:null,forced:false},{code:null,signal:'SIGKILL',forced:true}])assert.throws(()=>c.check(result),/Server shutdown failed/);
});
