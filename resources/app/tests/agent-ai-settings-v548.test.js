'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');

function loadSettingsWithRoot(root){
  const oldRoot=process.env.BUYER_LOG_SERVER_DATA_ROOT;
  process.env.BUYER_LOG_SERVER_DATA_ROOT=root;
  const userDataPath=require.resolve('../server/user-data');
  const settingsPath=require.resolve('../server/lib/agent-ai-settings');
  delete require.cache[userDataPath];delete require.cache[settingsPath];
  const mod=require('../server/lib/agent-ai-settings');
  return {mod,restore(){delete require.cache[userDataPath];delete require.cache[settingsPath];if(oldRoot==null)delete process.env.BUYER_LOG_SERVER_DATA_ROOT;else process.env.BUYER_LOG_SERVER_DATA_ROOT=oldRoot;}};
}

test('v5.48 AI key is encrypted at rest and never exposed by public settings',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'buyer-log-ai-'));
  const oldOpenAi=process.env.OPENAI_API_KEY,oldBuyer=process.env.BUYER_LOG_AGENT_OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;delete process.env.BUYER_LOG_AGENT_OPENAI_API_KEY;
  const {mod,restore}=loadSettingsWithRoot(tmp);
  try{
    const key='sk-test-very-secret-1234567890';
    const saved=mod.saveSettings({apiKey:key,model:'gpt-5'});
    assert.equal(saved.configured,true);assert.equal(saved.source,'application');assert.equal(saved.hasStoredKey,true);
    assert.equal(Object.prototype.hasOwnProperty.call(saved,'apiKey'),false);
    const raw=fs.readFileSync(path.join(tmp,'agent-ai-settings.json'),'utf8');assert.equal(raw.includes(key),false,'plaintext key must not be persisted');
    assert.equal(mod.credentials().apiKey,key);assert.match(saved.maskedStoredKey,/7890$/);
  }finally{restore();fs.rmSync(tmp,{recursive:true,force:true});if(oldOpenAi==null)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldOpenAi;if(oldBuyer==null)delete process.env.BUYER_LOG_AGENT_OPENAI_API_KEY;else process.env.BUYER_LOG_AGENT_OPENAI_API_KEY=oldBuyer;}
});

test('v5.48 environment key takes precedence over Buyer Log stored key',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'buyer-log-ai-env-'));
  const oldOpenAi=process.env.OPENAI_API_KEY,oldBuyer=process.env.BUYER_LOG_AGENT_OPENAI_API_KEY;
  delete process.env.BUYER_LOG_AGENT_OPENAI_API_KEY;delete process.env.OPENAI_API_KEY;
  const {mod,restore}=loadSettingsWithRoot(tmp);
  try{
    mod.saveSettings({apiKey:'sk-stored-1234567890',model:'gpt-5'});
    process.env.OPENAI_API_KEY='sk-env-abcdef123456';
    const creds=mod.credentials();assert.equal(creds.apiKey,'sk-env-abcdef123456');assert.equal(creds.source,'environment');
    assert.equal(mod.publicSettings().environmentConfigured,true);
  }finally{restore();fs.rmSync(tmp,{recursive:true,force:true});if(oldOpenAi==null)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldOpenAi;if(oldBuyer==null)delete process.env.BUYER_LOG_AGENT_OPENAI_API_KEY;else process.env.BUYER_LOG_AGENT_OPENAI_API_KEY=oldBuyer;}
});

/* v6.36: Agent arayüzü kaldırıldı, bu yüzden AI ayarları ARAYÜZÜNE ait iddia
   düştü. Uçların moderatör korumasında kaldığı sunucu tarafında doğrulanmaya
   devam ediyor — yetki kuralı arayüzden bağımsız olarak geçerli. */
test('v5.48 AI settings endpoints stay behind moderator authorization',()=>{
  const root=path.join(__dirname,'..');
  const server=fs.readFileSync(path.join(root,'server','server.js'),'utf8');
  assert.match(server,/app\.post\('\/api\/agent-platform\/ai-settings'/);
  assert.match(server,/app\.post\('\/api\/agent-platform\/ai-settings\/test'/);
  assert.match(server,/userAccess\.requireModerator/);
});
