'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const app=path.resolve(__dirname,'../../../resources/app');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const file=path.join(app,'tests/fixtures/orders-ready-integration/consumer/remaining-consumer-gates.test.cjs');
const original=fs.readFileSync(file,'utf8');
assert.equal(hash(original),'3a698fa69e3bf9d6d0b29a76314f4a57957da2c0e6bde0cd74697fa76cbbbd3a');
let composed=original.replace("path.resolve(__dirname,'../../../..')","path.resolve(__dirname,'../../../resources/app')")
 .replace("require('../source.cjs')","require('./consumer-source.cjs')")
 .replace("vm.runInContext(names.map(n=>helper.extractFunction(source,n)).join('\\n')", "vm.runInContext(fs.readFileSync(path.join(__dirname,'action-ownership.js'),'utf8')+'\\nlet CP_MODEL_COLUMN_DEFS=[];\\n'+names.map(n=>helper.extractFunction(source,n)).join('\\n')");
assert.notEqual(composed,original);
const body=original.slice(original.indexOf("test('QFG save"));
assert.equal(composed.slice(composed.indexOf("test('QFG save")),body,'all original assertion bodies preserved exactly');
assert.equal((body.match(/\btest\(/g)||[]).length,15,'15 declarations expand to 19 tests');
fs.writeFileSync(path.join(__dirname,'remaining-consumer-gates.test.cjs'),composed);
fs.writeFileSync(path.join(__dirname,'consumer-proof.json'),JSON.stringify({originalSha256:hash(original),assertionBodiesSha256:hash(body),composedSha256:hash(composed),setupOnlyChanges:3,originalAssertionBodiesByteIdentical:true},null,2)+'\n');
console.log('19 original consumer assertions composed; assertion bodies byte-identical');
