'use strict';
const {spawnSync}=require('node:child_process'),path=require('node:path');
const root=path.resolve(__dirname,'../../..'),app=path.join(root,'resources/app');
function run(args,options={}){
 console.log(JSON.stringify({command:['node',...args],cwd:options.cwd||root,candidate:options.env?.BL_RETIREMENT_APP_SOURCE||null}));
 const r=spawnSync(process.execPath,args,{cwd:root,env:process.env,stdio:'inherit',...options});
 if(r.status!==0)process.exit(r.status||1);
}
run(['--test',path.join(__dirname,'orders-config-writers.test.cjs')],{env:{...process.env,BL_RETIREMENT_APP_SOURCE:path.join(__dirname,'app-main.js')}});
run(['tests/run-tests.js','orders-remaining-consumers','orders-config-writers','orders-config-barriers','orders-full-promotion','orders-full-action-hook','orders-full-consumer-gates','orders-ui-command','orders-source-retirement','orders-add-column-v1083','data-management-source-writer','model-horizon-duplicate-columns','i18n-coverage-guard'],{cwd:app});
run(['scripts/i18n-coverage.js'],{cwd:app});
run([path.join(__dirname,'candidate-i18n.cjs')]);
run(['--check',path.join(__dirname,'app-main.js')]);
run([path.join(__dirname,'check-recipe.cjs')]);
const workflow=require('node:fs').readFileSync(path.join(root,'.github/workflows/buyerlog-pr-fast-checks.yml'),'utf8');
const quick=workflow.match(/name: CP checklist pass caches, single refresh and delta recalculation\n\s+run: node (.+)/)[1];
run(quick.split(' '),{cwd:app});
console.log('Native targeted validation complete; no full regression, browser or release acceptance claimed.');
