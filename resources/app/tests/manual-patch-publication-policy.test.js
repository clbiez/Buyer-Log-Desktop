'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const workflow=fs.readFileSync(path.join(__dirname,'../../../.github/workflows/buyerlog-auto-manual-patch.yml'),'utf8');
test('manual patch migration cannot auto-publish or run untrusted PR heads',()=>{
 assert.match(workflow,/workflow_dispatch:/);
 assert.doesNotMatch(workflow,/^  (?:push|pull_request_target|pull_request|schedule):/m);
 assert.match(workflow,/REVIEWED_SHA: \$\{\{ inputs\.commit_sha \}\}/);
 assert.match(workflow,/\$main -ne \$env:REVIEWED_SHA/);
 assert.doesNotMatch(workflow,/github\.event\.pull_request/);
 assert.match(workflow,/persist-credentials: false/);
});
test('unsigned publisher has no release capability or Actions ZIP storage',()=>{
 assert.doesNotMatch(workflow,/BUYER_LOG_RELEASE_TOKEN|BUYER_LOG_RELEASE_SIGNING_KEY|secrets\.|gh release|git .*push|upload-artifact|download-artifact/);
 assert.match(workflow,/contents: read/);
 assert.match(workflow,/No release, feed update or Actions ZIP artifact/);
});
test('full application failures stop before retained Windows installer tests',()=>{
 const regression=workflow.indexOf('npm test'),build=workflow.indexOf('python scripts/mini_patch_builder.py'),installer=workflow.indexOf('python scripts/mini_patch_ci.py');
 assert.ok(regression>=0&&regression<build&&build<installer);
 for(const message of ['Application regression failed','Patch build failed','Patch compatibility or rollback failed'])assert.ok(workflow.includes(message));
 assert.doesNotMatch(workflow,/continue-on-error|if: always\(\)|\|\| true/);
 assert.match(workflow,/runs-on: windows-latest/);
});
