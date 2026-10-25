'use strict';
// Full production server fixture. The only replaced boundary is OS file opening;
// email applications and sending are never invoked by this test.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net'),assert=require('node:assert/strict');
const APP=path.resolve(__dirname,'../..'),root=path.resolve(process.argv[2]);
for(const key of Object.keys(process.env))if(key.startsWith('BUYER_LOG_'))delete process.env[key];
process.env.BL_HOST_APPDATA=process.env.BL_HOST_LOCALAPPDATA='';
for(const [key,relative] of Object.entries({BUYER_LOG_SERVER_DATA_ROOT:'server',BUYER_LOG_DATA_ROOT:'app',BUYER_LOG_LOCAL_DATA_ROOT:'local',BUYER_LOG_AUTH_DATA_ROOT:'local/auth',BUYER_LOG_TEMP_ROOT:'temp',APPDATA:'appdata',LOCALAPPDATA:'localappdata'})){process.env[key]=path.join(root,relative);fs.mkdirSync(process.env[key],{recursive:true});}
process.env.TEMP=process.env.TMP=process.env.TMPDIR=process.env.BUYER_LOG_TEMP_ROOT;process.env.BUYER_LOG_CENTRAL_IAM_ENABLED='0';process.env.BL_TEST_SEED='1';process.env.BUYER_LOG_CONFIG_PATH=path.join(root,'config.json');fs.mkdirSync(path.join(root,'empty-source'));
const iam=require('../../server/lib/iam-core'),salt=Buffer.alloc(16,7),hash=['scrypt',salt.toString('hex'),crypto.scryptSync('Fixture-only-123',salt,32).toString('hex')].join('$'),moderator={id:'moderator',role:'moderator',systemRole:'moderator',username:'fixture-admin',displayName:'Fixture Admin',title:'Moderator',enabled:true,passwordHash:hash,pinHash:hash,permissions:{},accessAreas:{},mags:[],mmygs:[],buyingGroups:[]};
fs.writeFileSync(path.join(process.env.BUYER_LOG_AUTH_DATA_ROOT,'user-access.json'),JSON.stringify(iam.migrateStore({schemaVersion:8,_revision:0,users:[],orderAccess:{},moderator})));
let opens=0;require('../../server/lib/platform').openPathExternally=()=>{opens++;return false;};require('../../server/lib/platform').openPathExternallyAsync=async()=>{opens++;return false;};
let releaseAutomation=null;
const executorModule=require('../../server/lib/automation-execution-service'),createExecutor=executorModule.createAutomationExecutor;
executorModule.createAutomationExecutor=deps=>{const execute=createExecutor(deps);return async(...args)=>{if(String(args[2]?.name||'').startsWith('HELD AUTHORITY')){process.send({event:'automation-held'});await new Promise(resolve=>{releaseAutomation=resolve;});}return execute(...args);};};
const accessModule=require('../../server/lib/user-access'),build=accessModule.buildUserAccess;let access,base,official,keys;
accessModule.buildUserAccess=(...args)=>{access=build(...args);return access;};
async function request(url,method='GET',body,cookie){const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
function snapshots(){
 const files={};function visit(dir){if(!fs.existsSync(dir))return;for(const item of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,item.name);if(item.isDirectory()){if(!item.name.includes('write-lock')&&!item.name.endsWith('.lock'))visit(full);}else if(!/\.tmp$|\.log$|\.ndjson$/.test(item.name))files[path.relative(root,full)]=crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');}}
 for(const name of ['overrides.json','overrides.json.bak','checklist-supplier-sync.json','checklist-supplier-sync.last-good.json']){const full=path.join(root,'server',name);if(fs.existsSync(full))files['server/'+name]=crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');}
 for(const directory of [path.join(root,'server/checklist-attachments'),path.join(root,'server/test-reports'),path.join(root,'server/automation-mail-drafts'),path.join(root,'local/collection-images'),path.join(root,'temp')])visit(directory);
 return {files:Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b))),opens};
}
process.on('message',async message=>{try{
 if(message.command==='snapshot')process.send({id:message.id,result:snapshots()});
 else if(message.command==='releaseAutomation'){releaseAutomation?.();releaseAutomation=null;process.send({id:message.id,result:true});}
 else if(message.command==='seedAgentDraft'){const result=require('../../server/lib/automation-email').createDraft({name:'Agent CP namespace fixture',ownerId:message.ownerId,subject:'Scoped agent output',open:false});process.send({id:message.id,result:{filename:result.filename}});}
 else if(message.command==='seedSharedImage'){const result=require('../../server/user-data').saveCollectionImage({rowId:'collection-shared:'+message.ownerId+':fixture',filename:'demo.png',mimeType:'image/png',base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII='});process.send({id:message.id,result});}
 else if(message.command==='seedLegacyDraft'){const result=require('../../server/lib/automation-email').createDraft({name:'Ownerless legacy fixture',subject:'Unattributed legacy output',open:false});process.send({id:message.id,result:{filename:result.filename}});}
 else if(message.command==='identity'){const raw=JSON.parse(fs.readFileSync(path.join(process.env.BUYER_LOG_AUTH_DATA_ROOT,'user-access.json'),'utf8'));process.send({id:message.id,result:{revision:raw._revision,users:raw.users.map(user=>({id:user.id,status:user.status,enabled:user.enabled,credentialRevision:user.credentialRevision}))}});}
 else if(message.command==='deleteForeignOrder'){official=official.filter(row=>row.ocode!==4100002);access.syncProfiles(official,{authoritative:true});process.send({id:message.id,result:true});}
 else if(message.command==='transferOwnOrder'){official=official.map(row=>row.ocode===4100001?{...row,buyer:message.restore?'Buyer A':'Buyer B'}:row);access.syncProfiles(official,{authoritative:true});process.send({id:message.id,result:true});}
 else if(message.command==='seedExceptionDates'){
  official=official.map(row=>({...row,ex:row.ocode===4100001?new Date(2026,0,1):new Date(2026,10,1)}));
  for(const user of access.allPublicProfiles().filter(user=>['fixture-a','fixture-b','fixture-admin'].includes(user.username)))global.__blSeedAsas(official,user.id,['cp','orders']);
  access.syncProfiles(official,{authoritative:true});process.send({id:message.id,result:true});
 }
 else if(message.command==='seedScale'){
  const count=Math.max(1,Math.min(30000,Number(message.count)||2000)),owner=access.allPublicProfiles().find(user=>user.username==='fixture-a');
  official=[...official.slice(0,2),...Array.from({length:count},(_,i)=>({...official[0],ocode:4200000+i,model:'DEMO-SCALE-'+i,buyer:'Buyer A'}))];
  for(const id of ['moderator',owner.id])global.__blSeedAsas(official,id,['cp','orders']);access.syncProfiles(official,{authoritative:true});
  const collectionCount=message.collectionCount===0?0:12;
  const workspaces=require('../../server/lib/collection-workspaces');for(const id of [owner.id,'moderator','shared-collection']){const workspace=workspaces.loadWorkspace(id);await workspaces.saveWorkspace(id,{rows:Array.from({length:collectionCount},(_,i)=>({id:i+1,modelKod:'DEMO-COLLECTION-'+(i+1),season:'W26',country:'China',qty:25})),manufacturers:[]},workspace._revision);}
  process.send({id:message.id,result:{count:official.length}});
 }
}catch(error){process.send({id:message.id,error:error.message});}});
async function main(){
 const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));base='http://127.0.0.1:'+port;fs.writeFileSync(process.env.BUYER_LOG_CONFIG_PATH,JSON.stringify({host:'127.0.0.1',port,sourceFolder:path.join(root,'empty-source'),centralIamEnabled:false,refreshWithExcel:false,updates:{enabled:false}}));require('../../server/server');
 let admin;for(let i=0;i<150;i++){try{admin=await request('/api/user-login','POST',{username:'fixture-admin',password:'Fixture-only-123'});break;}catch(_){await new Promise(resolve=>setTimeout(resolve,100));}}assert.equal(admin?.status,200);
 const users=[];for(const [name,displayName] of [['fixture-a','Buyer A'],['fixture-b','Buyer B']]){const directory=await request('/api/users/admin','GET',null,admin.cookie),created=await request('/api/users','POST',{expectedRevision:directory.body.revision,username:name,displayName,title:'Buyer',systemRole:'buyer',orgLevel:'job_title',managerId:'moderator',status:'ACTIVE',password:'Fixture-only-123'},admin.cookie);assert.equal(created.status,201,JSON.stringify(created.body));const login=await request('/api/user-login','POST',{username:name,password:'Fixture-only-123'});assert.equal(login.status,200);users.push({id:created.body.user.id,name,displayName,cookie:login.cookie});}
 for(const cookie of [admin.cookie,...users.map(user=>user.cookie)]){assert.equal((await request('/api/data','GET',null,cookie)).status,200);assert.equal((await request('/api/test-reports','GET',null,cookie)).status,200);}
 official=users.map((user,i)=>({ocode:4100001+i,model:i?'DEMO-B':'DEMO-A',ccode:'01',colour:'BLUE',buyer:user.displayName,buyerGrup:'DEMO',manufacturer:'Demo Supplier',countryRaw:'TURKIYE',qty:25,kalan:25,fob:5,opd:new Date(2026,9,1),ex:new Date(2026,10,1),retail:new Date(2026,10,15),mb:new Date(2026,10,30)}));global.__blSeedAsas(official,'moderator',['cp','orders']);for(const user of users)global.__blSeedAsas(official.map(row=>({...row,buyer:user.displayName})),user.id,['cp','orders']);access.syncProfiles(official,{authoritative:true});
 const parse=require('../../server/lib/parse'),CP=require('../../public/cp-readiness-engine'),rows=parse.buildOrdersRowsFromASAS(official,{},{});keys=rows.map(row=>CP.analyzeOrder(row).orderKey);require('../../server/lib/test-reports/store').commit(rows.map((row,i)=>({report:{talepNo:String(510001+i),siparisKodu:String(official[i].ocode),modelAdi:official[i].model,talepTipi:'Demo Test',testler:[{ad:'Pilling',sonuc:'fail'}],dosyalar:[],kaynaklar:[]},orderKey:keys[i],itemId:'tests',context:{orderCode:String(official[i].ocode)}})),{},moderator,null);
 process.send({ready:true,port,root,users:users.map(({cookie,...user})=>user),keys});
}
main().catch(error=>{console.error(error);process.exit(1);});
