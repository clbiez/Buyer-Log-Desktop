'use strict';
const path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../../..'),relative=file=>path.relative(root,path.join(__dirname,file));
function evidence(label,args,expected=0,baseline=false){
 const r=spawnSync(process.execPath,[relative('run-evidence.cjs'),label,...args],{cwd:root,env:{...process.env,BL_MODEL_ACTION_BASELINE:baseline?'1':'0'},stdio:'inherit'});
 if(r.status!==expected)throw Error(label+': expected exit '+expected+', got '+r.status);
}
// The same final assertions, dependencies, timeout and fixture in both arms.
evidence('ownership-red-accepted',['node','--test',relative('model-action.test.cjs')],1,true);
evidence('ownership-green-accepted',['node','--test',relative('model-action.test.cjs'),relative('remaining-consumer-gates.test.cjs')]);
evidence('move-schema-baseline-diagnostic',['node','--test',relative('independent-move-schema.probe.cjs')],1,true);
evidence('move-schema-candidate-diagnostic',['node','--test',relative('independent-move-schema.probe.cjs')],1);
evidence('native-accepted',['node',relative('validate-native.cjs')]);
console.log('Expected RED diagnostics retained; ownership candidate and targeted native gates passed.');
