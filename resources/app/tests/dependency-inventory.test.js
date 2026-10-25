'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Inventory=require('../scripts/dependency-inventory');
test('checked-in SBOM covers the current lock and every packaged vendor/runtime file with explicit ownership',()=>{
 const bom=Inventory.buildInventory();assert.equal(fs.readFileSync(Inventory.OUTPUT,'utf8'),JSON.stringify(bom,null,2)+'\n','regenerate the inventory after any dependency/artifact change');
 const files=JSON.parse(bom.properties.find(p=>p.name==='buyerlog:artifact-manifest').value);assert.equal(files.length,Inventory.distributionFiles().length);assert.equal(new Set(files.map(f=>f.path)).size,files.length);
 for(const component of bom.components){assert.ok(component.licenses?.length,component.name+' license');assert.ok(component.properties.some(p=>p.name==='buyerlog:owner'&&p.value));assert.ok(component.properties.some(p=>p.name==='buyerlog:update-method'&&p.value));}
});
test('official reader artifact is pinned locally and byte-identical to the isolated browser reader',()=>{
 const app=path.join(__dirname,'..'),pkg=require('../package.json'),lock=require('../package-lock.json'),archive=fs.readFileSync(path.join(app,'vendor/xlsx-0.20.3.tgz'));
 assert.equal(pkg.dependencies.xlsx,'file:vendor/xlsx-0.20.3.tgz');assert.equal(lock.packages['node_modules/xlsx'].version,'0.20.3');assert.equal('sha512-'+crypto.createHash('sha512').update(archive).digest('base64'),lock.packages['node_modules/xlsx'].integrity);
 assert.deepEqual(fs.readFileSync(path.join(app,'public/vendor/xlsx-reader.min.js')),fs.readFileSync(path.join(app,'node_modules/xlsx/dist/xlsx.full.min.js')));
 const origins=require('../../../docs/audits/bl018-vendor-origins-20261025.json');for(const item of origins)for(const file of item.files.filter(f=>f.file!=='exceljs-shim.js')){assert.ok(file.exactMatches.length,item.name+' verified archive entry');assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(app,'public/vendor',file.file))).digest('hex'),file.sha256);}
});
