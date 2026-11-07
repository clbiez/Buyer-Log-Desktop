'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

test('temporary server data roots keep durable recovery records inside the temporary root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-user-data-recovery-'));
  try {
    const serverRoot = path.join(root, 'server');
    const profileRoot = path.join(root, 'profile');
    const script = [
      `const path = require(${JSON.stringify('node:path')});`,
      `const { atomicWriteJson } = require(${JSON.stringify(path.join(ROOT, 'server', 'user-data.js'))});`,
      'atomicWriteJson(path.join(process.env.BUYER_LOG_SERVER_DATA_ROOT, "probe.json"), { ok: true });',
    ].join('');
    const childEnv = {
        ...process.env,
        BUYER_LOG_SERVER_DATA_ROOT: serverRoot,
        BUYER_LOG_DATA_ROOT: path.join(root, 'app'),
        BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json'),
        LOCALAPPDATA: profileRoot,
        APPDATA: profileRoot,
      };
    // This case exercises the default (no explicit local-data override). A
    // suite-level override must not silently change that fixture's contract.
    delete childEnv.BUYER_LOG_LOCAL_DATA_ROOT;
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: ROOT,
      env: childEnv,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(path.join(serverRoot, '.buyerlog-write-recovery')), true);
    assert.equal(fs.existsSync(path.join(profileRoot, 'BuyerLog', 'write-recovery')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('explicit local-data root owns recovery while durable writes still reject an unrelated workspace path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-explicit-recovery-'));
  const forbidden = path.resolve(ROOT, '../../../buyerlog-denied-demo-' + process.pid + '.json');
  try {
    const serverRoot=path.join(root,'server'),localRoot=path.join(root,'local');
    const script=`const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
      const {atomicWriteJson}=require(${JSON.stringify(path.join(ROOT,'server/user-data.js'))});
      atomicWriteJson(path.join(process.env.BUYER_LOG_SERVER_DATA_ROOT,'probe.json'),{ok:true});
      assert.throws(()=>atomicWriteJson(${JSON.stringify(forbidden)},{private:'synthetic'}),{code:'DATA_INTEGRITY_ERROR'});
      assert.equal(fs.existsSync(${JSON.stringify(forbidden)}),false);`;
    const result=spawnSync(process.execPath,['-e',script],{cwd:ROOT,encoding:'utf8',env:{...process.env,
      BUYER_LOG_SERVER_DATA_ROOT:serverRoot,BUYER_LOG_DATA_ROOT:path.join(root,'app'),BUYER_LOG_LOCAL_DATA_ROOT:localRoot,
      BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')}});
    assert.equal(result.status,0,result.stderr);
    assert.equal(fs.existsSync(path.join(localRoot,'write-recovery')),true);
    assert.equal(fs.existsSync(path.join(serverRoot,'.buyerlog-write-recovery')),false);
  } finally {
    fs.rmSync(root,{recursive:true,force:true});
    fs.rmSync(forbidden,{force:true});
  }
});
