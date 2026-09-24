'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');

const provider=require('../electron/update/github-provider');

test('GitHub updater keeps a Node fetch fallback outside Electron',()=>{
  const transports=provider.fetchTransports();
  assert.ok(Array.isArray(transports));
  assert.ok(transports.some(item=>item&&item.name==='node-fetch'));
});

test('GitHub updater reports which transport failed',async()=>{
  const originalFetch=global.fetch;
  global.fetch=async()=>{const error=Object.assign(new Error('simulated network failure'),{code:'SIMULATED_NETWORK'});throw error;};
  try{
    await assert.rejects(
      ()=>provider.fetchPublic('https://github.com/clbiez/Buyer-Log-Releases/releases/download/stable-v7.0.120/BuyerLog-7.0.120.zip',1000),
      error=>{
        assert.equal(error.code,'SIMULATED_NETWORK');
        assert.equal(error.transport,'node-fetch');
        assert.match(error.message,/simulated network failure/);
        return true;
      }
    );
  }finally{
    global.fetch=originalFetch;
  }
});
