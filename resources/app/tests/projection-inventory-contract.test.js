'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const contract=require('../public/projection-inventory-contract');
const generator=require('../scripts/generate-projection-inventory-contract.cjs');
const sourceBytes=fs.readFileSync(path.resolve(__dirname,'../../..',generator.SOURCE));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
test('sealed runtime fields equal the exact ordered original #891 projection with no new IDs/classes/removals',()=>{
 assert.equal(sha(sourceBytes),generator.SHA);const original=JSON.parse(sourceBytes);
 const fields=original.fields.map(field=>({canonicalId:field.canonicalId,classification:field.classification,removable:field.removable}));
 assert.deepEqual(contract.fields,fields);assert.equal(contract.fields.length,42);assert.equal(new Set(fields.map(field=>field.canonicalId)).size,42);
 assert.equal(fields.filter(field=>field.classification==='ince satırda gerekli').length,32);assert.equal(fields.filter(field=>field.classification==='belirsiz').length,10);assert.equal(fields.some(field=>field.removable),false);
 assert.deepEqual(contract.ref,{pr:891,head:generator.HEAD});assert.equal(contract.source.sha256,generator.SHA);assert.equal(contract.source.path,generator.SOURCE);
});
test('candidate artifact is byte-exact deterministic generation from that source only',()=>{
 const file=path.join(__dirname,'../public/projection-inventory-contract.js');assert.equal(fs.readFileSync(file,'utf8'),generator.render(sourceBytes));assert.ok(fs.statSync(file).size<12288);
 assert.throws(()=>generator.render(Buffer.from('{}')));
});
test('runtime contract is readonly and cannot become a replacement mutable inventory',()=>{
 assert.ok(Object.isFrozen(contract));assert.ok(Object.isFrozen(contract.ref));assert.ok(Object.isFrozen(contract.source));assert.ok(Object.isFrozen(contract.fields));assert.ok(contract.fields.every(Object.isFrozen));
 assert.throws(()=>{contract.fields[0].removable=true;});assert.throws(()=>{contract.fields.push({canonicalId:'new'});});
});
test('official public helpers retain the already-reviewed algorithms byte-for-byte',()=>{
 const helper=fs.readFileSync(path.join(__dirname,'../public/orders-finite-closure.js')),dependency=fs.readFileSync(path.join(__dirname,'../public/projection-dependency-plan.js'));
 assert.equal(sha(helper),'d5ae598f48da2ca4ff99302143c0b50383d18f07126a90449824c28285456886');
 const original=fs.readFileSync(path.join(__dirname,'contracts/dependency/projection-dependency-plan-before-i18n.cjs'),'utf8');
 assert.equal(sha(Buffer.from(original)),'0e58a3c0abacbfb0b542014ed574feb33d37d9df163f64fadde6d80b7953f368');
 const dataLines=original.split('\n').filter(line=>line.includes("'ince satırda gerekli'"));assert.equal(dataLines.length,2);
 let expected=original;for(const line of dataLines)expected=expected.replace(line+'\n',line+' // i18n-ignore\n');
 assert.equal(dependency.toString('utf8'),expected,'only two data-key comments may differ; every algorithm byte stays unchanged');
 assert.equal(typeof require('../public/orders-finite-closure').createOrdersFiniteClosure,'function');assert.equal(require('../public/projection-dependency-plan').INVENTORY_HEAD,contract.ref.head);
 const f=require('./contracts/orders/runtime-fixture.cjs').fixture(),full=f.compiler.compile(f.full,f.context);
 assert.equal(full.supported,true,full.reason);assert.deepEqual(f.compiler.compileSchema(f.context),full);
});
test('the same public artifacts load in a browser realm without repo docs, fs or a network inventory',()=>{
 const browser=vm.createContext({});for(const file of ['projection-inventory-contract.js','projection-dependency-plan.js','orders-finite-closure.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../public',file),'utf8'),browser);
 assert.equal(JSON.stringify(browser.BLProjectionInventoryContract),JSON.stringify(contract));assert.equal(typeof browser.BLProjectionDependencyPlan.createCompiler,'function');assert.equal(typeof browser.BLOrdersFiniteClosure.createOrdersFiniteClosure,'function');
});
