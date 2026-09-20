'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');

function scryptHash(password){
  const salt=crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(String(password).trim(),salt,32).toString('hex')}`;
}
function clearModules(){
  for(const mod of ['../server/lib/user-access','../server/user-data']){
    try{delete require.cache[require.resolve(mod)];}catch(_){}
  }
}

test('v5.60 kullanıcı şifreleri sürüm klasöründen bağımsız auth köküne taşınır ve hash korunur',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyer-log-login-persist-'));
  const serverRoot=path.join(root,'legacy-server-data'), authRoot=path.join(root,'persistent-auth');
  fs.mkdirSync(serverRoot,{recursive:true});
  const hash=scryptHash('Secret123');
  const legacy={schemaVersion:4,moderator:{id:'moderator',role:'moderator',username:'Gökberk',displayName:'Gökberk',title:'Moderatör',enabled:true,passwordHash:hash,pinHash:hash},users:[],orderAccess:{},_revision:7};
  fs.writeFileSync(path.join(serverRoot,'user-access.json'),JSON.stringify(legacy));
  const oldServer=process.env.BUYER_LOG_SERVER_DATA_ROOT, oldAuth=process.env.BUYER_LOG_AUTH_DATA_ROOT;
  process.env.BUYER_LOG_SERVER_DATA_ROOT=serverRoot; process.env.BUYER_LOG_AUTH_DATA_ROOT=authRoot; clearModules();
  const {buildUserAccess}=require('../server/lib/user-access');
  const access=buildUserAccess({ensureDataLoaded:async()=>{},getOrders:()=>[]});
  const profiles=access.allPublicProfiles();
  assert.equal(profiles[0].username,'Gökberk');
  const migrated=JSON.parse(fs.readFileSync(path.join(authRoot,'user-access.json'),'utf8'));
  assert.equal(migrated.moderator.passwordHash,hash);
  assert.equal(migrated._revision,7);
  if(oldServer==null)delete process.env.BUYER_LOG_SERVER_DATA_ROOT;else process.env.BUYER_LOG_SERVER_DATA_ROOT=oldServer;
  if(oldAuth==null)delete process.env.BUYER_LOG_AUTH_DATA_ROOT;else process.env.BUYER_LOG_AUTH_DATA_ROOT=oldAuth;
  clearModules(); fs.rmSync(root,{recursive:true,force:true});
});

test('v5.60 explicit BUYER_LOG_SERVER_DATA_ROOT kullanımlarında geriye dönük auth yolu korunur',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyer-log-login-explicit-'));
  const oldServer=process.env.BUYER_LOG_SERVER_DATA_ROOT, oldAuth=process.env.BUYER_LOG_AUTH_DATA_ROOT;
  process.env.BUYER_LOG_SERVER_DATA_ROOT=root; delete process.env.BUYER_LOG_AUTH_DATA_ROOT; clearModules();
  const source=fs.readFileSync(path.join(__dirname,'..','server','lib','user-access.js'),'utf8');
  assert.match(source,/process\.env\.BUYER_LOG_SERVER_DATA_ROOT \? SERVER_DATA_ROOT/);
  const {buildUserAccess}=require('../server/lib/user-access');
  const access=buildUserAccess({ensureDataLoaded:async()=>{},getOrders:()=>[]}); access.allPublicProfiles();
  assert.equal(fs.existsSync(path.join(root,'auth','user-access.json')),false);
  if(oldServer==null)delete process.env.BUYER_LOG_SERVER_DATA_ROOT;else process.env.BUYER_LOG_SERVER_DATA_ROOT=oldServer;
  if(oldAuth==null)delete process.env.BUYER_LOG_AUTH_DATA_ROOT;else process.env.BUYER_LOG_AUTH_DATA_ROOT=oldAuth;
  clearModules(); fs.rmSync(root,{recursive:true,force:true});
});


test('v5.61 kalıcı auth deposu taze/yanlışsa daha zengin ve yüksek revizyonlu eski kullanıcı deposu geri kazanılır',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyer-log-login-recover-'));
  const serverRoot=path.join(root,'legacy-server-data'), authRoot=path.join(root,'persistent-auth');
  fs.mkdirSync(serverRoot,{recursive:true}); fs.mkdirSync(authRoot,{recursive:true});
  const correct=scryptHash('CorrectSecret123'), wrong=scryptHash('WrongSecret123');
  const legacy={schemaVersion:4,moderator:{id:'moderator',role:'moderator',username:'Gökberk',displayName:'Gökberk',title:'Moderatör',enabled:true,passwordHash:correct,pinHash:correct},users:[{id:'u1',role:'buyer',username:'buyer1',displayName:'Buyer 1',enabled:true,passwordHash:scryptHash('BuyerSecret123'),pinHash:''}],orderAccess:{},_revision:23,_updatedAt:'2026-08-01T00:00:00.000Z'};
  const stale={schemaVersion:4,moderator:{id:'moderator',role:'moderator',username:'Gökberk',displayName:'Gökberk',title:'Moderatör',enabled:true,passwordHash:wrong,pinHash:wrong},users:[],orderAccess:{},_revision:1,_updatedAt:'2026-08-10T00:00:00.000Z'};
  fs.writeFileSync(path.join(serverRoot,'user-access.json'),JSON.stringify(legacy));
  fs.writeFileSync(path.join(authRoot,'user-access.json'),JSON.stringify(stale));
  const oldServer=process.env.BUYER_LOG_SERVER_DATA_ROOT, oldAuth=process.env.BUYER_LOG_AUTH_DATA_ROOT;
  process.env.BUYER_LOG_SERVER_DATA_ROOT=serverRoot; process.env.BUYER_LOG_AUTH_DATA_ROOT=authRoot; clearModules();
  const {buildUserAccess}=require('../server/lib/user-access');
  const access=buildUserAccess({ensureDataLoaded:async()=>{},getOrders:()=>[]}); access.allPublicProfiles();
  const recovered=JSON.parse(fs.readFileSync(path.join(authRoot,'user-access.json'),'utf8'));
  assert.equal(recovered.moderator.passwordHash,correct);
  assert.equal(recovered._revision,23);
  assert.equal(recovered.users.length,1);
  assert.equal(fs.existsSync(path.join(authRoot,'user-access.json.pre-migration.bak')),true);
  if(oldServer==null)delete process.env.BUYER_LOG_SERVER_DATA_ROOT;else process.env.BUYER_LOG_SERVER_DATA_ROOT=oldServer;
  if(oldAuth==null)delete process.env.BUYER_LOG_AUTH_DATA_ROOT;else process.env.BUYER_LOG_AUTH_DATA_ROOT=oldAuth;
  clearModules(); fs.rmSync(root,{recursive:true,force:true});
});
