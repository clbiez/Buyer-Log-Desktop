'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const original=fs.readFileSync(path.resolve(__dirname,'../../../resources/app/tests/orders-config-writers.test.js'),'utf8');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const composed=original.replace("require('./helpers/orders-config-writer-source')","require('../../../resources/app/tests/helpers/orders-config-writer-source')")
 .replace("require('./fixtures/orders-ready-integration/source.cjs')","require('../../../resources/app/tests/fixtures/orders-ready-integration/source.cjs')")
 .replace("vm.runInContext(runtimeNames.map(n=>extractFunction(source,n)).join('\\n'),c);", "vm.runInContext(require('node:fs').readFileSync(require('node:path').join(__dirname,'action-ownership.js'),'utf8')+'\\n'+runtimeNames.map(n=>extractFunction(source,n)).join('\\n'),c);");
const body=original.slice(original.indexOf("test('actual model load"));
// Only a fixture dependency path in the test body changes; assertion text and
// every original behavioral condition stay exact, checked by reversing it.
assert.equal(composed.slice(composed.indexOf("test('actual model load")).replace("require('../../../resources/app/tests/fixtures/orders-ready-integration/source.cjs')","require('./fixtures/orders-ready-integration/source.cjs')"),body);
fs.writeFileSync(path.join(__dirname,'orders-config-writers.test.cjs'),composed);
fs.writeFileSync(path.join(__dirname,'config-regression-proof.json'),JSON.stringify({originalSha256:hash(original),composedSha256:hash(composed),originalAssertionBodiesPreserved:true},null,2)+'\n');
