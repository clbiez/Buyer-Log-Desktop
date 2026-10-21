'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-retired-grants-'));
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_AUTH_DATA_ROOT'])process.env[key]=root;
const store=require('../server/lib/automation-recipe-store'),schedule=require('../server/lib/automation-schedule-service');
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
test('retired grants disable only their schedules across reloads and ordinary native schedules still run',()=>{
 const recipe={name:'Demo schedule',source:'cp',purpose:'email',enabled:true,schedule:{enabled:true,mode:'daily',time:'09:00'}};
 const retired=store.createRecipe('buyer',recipe).result,native=store.createRecipe('buyer',recipe).result;
 const raw=JSON.parse(fs.readFileSync(store.STORE_FILE,'utf8'));raw.agentScheduleGrants={[retired.id]:{agentId:'retired-agent'}};fs.writeFileSync(store.STORE_FILE,JSON.stringify(raw));
 const loaded=store.loadStore(),find=id=>loaded.recipes.find(r=>r.id===id),now=new Date(2026,9,21,9,10);
 assert.equal(find(retired.id).schedule.enabled,false);assert.equal(find(native.id).schedule.enabled,true);
 assert.equal(schedule.automationDueOccurrence(find(retired.id),now),null);assert.ok(schedule.automationDueOccurrence(find(native.id),now));
 store.updateRecipe('buyer',native.id,{name:'Native edited'});
 assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(store.STORE_FILE,'utf8')),'agentScheduleGrants'),false);
 assert.equal(store.recipeForOwner('buyer',retired.id).schedule.enabled,false);
});
