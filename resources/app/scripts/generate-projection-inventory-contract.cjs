'use strict';

// Build/test tool only. Never imported by the application runtime.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const SOURCE='docs/performance-program/phase-6a/field-inventory.json';
const SHA='9ddb58477db99ce381dd57f311eced5e09c3b2176f3b9b58349456a92b6cb352';
const HEAD='5736f3370fb55bbd62414585956ca8c53d37ce82';
function render(bytes){
 if(crypto.createHash('sha256').update(bytes).digest('hex')!==SHA)throw Error('Original #891 inventory bytes changed; review the source contract first.');
 const original=JSON.parse(bytes),fields=original.fields.map(field=>({canonicalId:field.canonicalId,classification:field.classification,removable:field.removable}));
 if(fields.length!==42||new Set(fields.map(field=>field.canonicalId)).size!==42
  ||fields.some(field=>typeof field.canonicalId!=='string'||!field.canonicalId||field.removable!==false)
  ||fields.filter(field=>field.classification==='ince satırda gerekli').length!==32
  ||fields.filter(field=>field.classification==='belirsiz').length!==10)throw Error('Unexpected #891 projection; no IDs/classifications/removals may be inferred.');
 return `(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BLProjectionInventoryContract = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // Generated projection of #891 only; the repository inventory stays authoritative.
  const fields = [
${fields.map((field,index)=>'    '+JSON.stringify(field)+(index<fields.length-1?',':'')+' // i18n-ignore').join('\n')}
  ];
  fields.forEach(Object.freeze);
  return Object.freeze({
    formatVersion: 1,
    ref: Object.freeze({ pr: 891, head: '${HEAD}' }),
    source: Object.freeze({ path: '${SOURCE}', sha256: '${SHA}' }),
    fields: Object.freeze(fields)
  });
});
`;
}
if(require.main===module){
 const options={source:path.resolve(__dirname,'../../..',SOURCE),output:path.resolve(__dirname,'../public/projection-inventory-contract.js'),check:false};
 for(let index=2;index<process.argv.length;index++){
  const flag=process.argv[index];if(flag==='--check')options.check=true;
  else if(flag==='--source'||flag==='--output'){const value=process.argv[++index];if(!value)throw Error('Missing path');options[flag.slice(2)]=path.resolve(value);}
  else throw Error('Unknown generator option');
 }
 const output=render(fs.readFileSync(options.source));
 if(options.check){if(fs.readFileSync(options.output,'utf8')!==output)throw Error('Runtime contract is not the exact deterministic #891 projection.');}
 else fs.writeFileSync(options.output,output,'utf8');
}
module.exports=Object.freeze({render,SOURCE,SHA,HEAD});
