'use strict';
const fs=require('node:fs'),path=require('node:path'),postcss=require('/workspace/.buyerlog-tools/node_modules/postcss');
const dir=path.resolve('resources/app/public'),definitions={},references={};
for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.css'))){const ast=postcss.parse(fs.readFileSync(path.join(dir,f),'utf8'));ast.walkDecls(d=>{if(d.prop.startsWith('--'))(definitions[d.prop]||=[]).push({file:f,selector:d.parent.selector,value:d.value});for(const m of d.value.matchAll(/var\((--[\w-]+)/g))(references[m[1]]||=[]).push({file:f,selector:d.parent.selector,property:d.prop});});}
fs.writeFileSync('docs/ai/ui-rebuild/phase-3/token-inventory.json',JSON.stringify({definitions,references},null,2)+'\n');
console.log(Object.keys(definitions).filter(k=>!k.startsWith('--ui-')).join(' '));
