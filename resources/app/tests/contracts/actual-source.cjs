'use strict';
// Test-only loader: actual public/server files, no copied app snapshots.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const APP=path.resolve(__dirname,'../..'),pins=require('./source-pins.json'),cache=new Map();
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function pinned(name){
 if(cache.has(name))return cache.get(name);
 const pin=pins.captures[name];assert.ok(pin,'known actual source '+name);
 const bytes=fs.readFileSync(path.join(APP,pin.path));
 assert.equal(hash(bytes),pin.sha256,'actual approved source SHA256: '+name);
 assert.equal(crypto.createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex'),pin.gitBlob,'actual approved Git blob: '+name);
 const text=bytes.toString('utf8');cache.set(name,text);return text;
}
function authoritative(file,expected){
 const bytes=fs.readFileSync(path.resolve(APP,'../../docs/performance-program/phase-6a',file));
 assert.equal(crypto.createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex'),expected,'original #891 reference: '+file);
 return JSON.parse(bytes);
}
module.exports={APP,pins,pinned,authoritative,inventory:require('../../public/projection-inventory-contract')};
