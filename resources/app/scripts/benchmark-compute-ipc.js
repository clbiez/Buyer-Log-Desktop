'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),v8=require('node:v8');
const {performance}=require('node:perf_hooks'),{serializeForTransfer}=require('../server/lib/compute-ipc');
const {assertSyntheticFixture}=require('./lib/server-loop-probe');
const mode=process.argv[2],seed=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
if(!['before','after'].includes(mode)||seed.synthetic!==true||seed.status!=='passed'||seed.expected?.rows?.orders!==30000)throw Error('A validated 30k synthetic F0 report is required');
const root=assertSyntheticFixture(seed.fixtureRoot),cache=path.join(root,'local/page-cache/moderator'),manifest=JSON.parse(fs.readFileSync(path.join(cache,'manifest.json'),'utf8'));
if(manifest.activeGeneration!==seed.expected.generation||!/^[-a-z0-9]+$/i.test(manifest.activeGeneration))throw Error('Synthetic projection generation changed');
const cp=fs.readFileSync(path.join(cache,manifest.activeGeneration,'cp.json.gz')),hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
if(hash(cp)!==manifest.modules.cp.checksum||cp.length!==manifest.modules.cp.bytes)throw Error('Synthetic CP projection bytes changed');
const params={cachedCp:cp,overrides:{imagemap:{}},access:{userId:'moderator',systemRole:'moderator',viewScope:{all:true},authority:{},ownershipProfiles:[]}};
let legacyEncoded,bytes;const memoryBefore=process.memoryUsage(),start=performance.now();
if(mode==='before'){legacyEncoded=v8.serialize(params);bytes=Uint8Array.from(legacyEncoded).buffer;}
else bytes=serializeForTransfer(params);
const elapsedMs=performance.now()-start,memoryAfter=process.memoryUsage(),inputBytes=bytes.byteLength,encodedHash=hash(Buffer.from(bytes));
const moved=structuredClone(bytes,{transfer:[bytes]}),decoded=v8.deserialize(Buffer.from(moved));
if(bytes.byteLength!==0||hash(decoded.cachedCp)!==manifest.modules.cp.checksum||!cp.length)throw Error('IPC transfer changed synthetic input');
process.stdout.write(JSON.stringify({synthetic:true,mode,node:process.version,platform:process.platform,rows:30000,cpRows:seed.expected.rows.cp,inputCpBytes:cp.length,
  inputBytes,elapsedMs,arrayBuffersDelta:memoryAfter.arrayBuffers-memoryBefore.arrayBuffers,externalDelta:memoryAfter.external-memoryBefore.external,
  encodedHash,inputHash:manifest.modules.cp.checksum,legacyEncodedBytes:legacyEncoded?.byteLength||0,transferDetached:true,callerInputIntact:hash(cp)===manifest.modules.cp.checksum})+'\n');
