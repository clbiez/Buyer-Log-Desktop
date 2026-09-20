'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const fields=require('../public/canonical-fields.js');
const serverFields=require('../server/lib/canonical-fields.js');

function loadBrowserModuleBindings(){
  const source=fs.readFileSync(path.join(__dirname,'../public/canonical-module-bindings.js'),'utf8');
  const window={BLCanonicalFields:fields};
  vm.runInNewContext(source,{window},{filename:'canonical-module-bindings.js'});
  return window;
}

test('browser and server use one canonical registry',()=>{
  assert.equal(fields.version,'7.67');
  assert.equal(serverFields,fields);
});

test('all current data-heavy modules have canonical bindings',()=>{
  const modules=['collection','cp','orders','backlog','overview','lfl','logistics','antrepo','openCosting','quotations','oab'];
  modules.forEach(moduleId=>assert.ok(fields.moduleFields(moduleId).length>0,`${moduleId} canonical binding missing`));
});

test('verified shared dimensions resolve across Collection, CP, Orders and LFL',()=>{
  assert.equal(fields.canonicalId('collection','colourCode'),'colourCode');
  assert.equal(fields.canonicalId('cp','C.Code'),'colourCode');
  assert.equal(fields.canonicalId('orders','Colour Code'),'colourCode');
  assert.equal(fields.canonicalId('lfl','colourCode'),'colourCode');
  assert.equal(fields.canonicalId('collection','urunTipi'),'category');
  assert.equal(fields.canonicalId('lfl','classification'),'category');
  assert.equal(fields.canJoin('collection','colourCode','lfl','colourCode'),true);
  assert.equal(fields.canJoin('collection','category','lfl','category'),true);
});

test('same-looking but different PLM/ASAS semantics are protected',()=>{
  assert.equal(fields.canonicalId('collection','productMainDefinition'),'productMainDefinition');
  assert.notEqual(fields.canonicalId('collection','productMainDefinition'),'productDescription');
  assert.equal(fields.canJoin('collection','modelName','lfl','modelName'),false);
  assert.equal(fields.compatibility('collection','line','lfl','line').reason,'different-semantics');
  assert.throws(()=>fields.requireJoinFields('collection','lfl',['modelName']),/Unsafe canonical join field/);
  assert.equal(fields.canonicalId('cp','Supplier'),'manufacturer');
  assert.equal(fields.canonicalId('collection','Supplier'),null);
});

test('Product Description never falls back to Product Main Definition',()=>{
  const collection={productMainDefinition:'TOP',productDescription:'T-SHIRT'};
  assert.equal(fields.value(collection,'collection','productDescription'),'T-SHIRT');
  assert.equal(fields.value({productMainDefinition:'TOP'},'collection','productDescription'),undefined);
});

test('canonical joins work even when module keys and visible headers differ',()=>{
  const collection=[{id:1,plmId:'12345',colourCode:'3e8',urunTipi:'T-Shirt'}];
  const lfl=[{id:9,plmId:'12345',colourCode:'3E8',classification:'T-SHIRT'}];
  const joined=fields.joinRows(collection,'collection',lfl,'lfl',{fields:['plmId','colourCode','category'],type:'inner'});
  assert.equal(joined.length,1);
  assert.equal(joined[0].left.id,1);
  assert.equal(joined[0].right.id,9);
});

test('canonical enrichment can bring real ASAS Product Description into Collection without renaming source keys',()=>{
  const collection={id:1,plmId:'100',colourCode:'A01',productMainDefinition:'KNIT'};
  const lfl=[{plmId:'100',colourCode:'A01',productDescription:'CREW NECK T-SHIRT'}];
  const enriched=fields.enrichRow(collection,'collection',lfl,'lfl',{profile:'modelColour',fields:['productDescription']});
  assert.equal(fields.canonicalValue(enriched,'collection','productDescription'),'CREW NECK T-SHIRT');
  assert.equal(collection.productMainDefinition,'KNIT');
  assert.equal(Object.prototype.hasOwnProperty.call(collection,'productDescription'),false);
});

test('Quotations and OAB module bindings load globally with safe semantics',()=>{
  const window=loadBrowserModuleBindings();
  assert.equal(window.BLCanonicalModuleBindings,true);
  assert.equal(fields.canonicalId('quotations','Category'),'category');
  assert.equal(fields.canJoin('quotations','category','collection','category'),true);
  assert.equal(fields.canJoin('quotations','modelName','collection','modelName'),false);
  assert.equal(fields.canonicalId('oab','Klasman Tanımı'),'category');
  assert.equal(fields.compatibility('oab','category','lfl','category').reason,'different-semantics');
  assert.equal(fields.canJoin('oab','Season','lfl','season'),true);
  assert.equal(fields.canJoin('oab','MAG','lfl','mag'),true);
  assert.equal(fields.canJoin('oab','Buyer Group','lfl','buyingGroup'),true);
});

test('new modules must explicitly register bindings before safe joins',()=>{
  const moduleId='futureModule_v765';
  assert.equal(fields.bindingFor(moduleId,'colourCode'),null);
  fields.registerModule(moduleId,{colourCode:{keys:['shadeCode'],semantic:'colourCode'},plmId:{keys:['styleId'],semantic:'plmId'}});
  assert.equal(fields.canonicalId(moduleId,'shadeCode'),'colourCode');
  assert.equal(fields.canJoin(moduleId,'shadeCode','collection','colourCode'),true);
});
