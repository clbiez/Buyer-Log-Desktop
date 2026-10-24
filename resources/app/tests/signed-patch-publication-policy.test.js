'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../../..'),publisher=require(path.join(root,'.github/scripts/buyerlog-signed-patch-publish'));
test('publication configuration requires per-publication explicit approval and complete immutable identity',()=>{
 const valid={APPROVED_SOURCE_SHA:'a'.repeat(40),BASE_VERSION:'7.0.294',PATCH_SEQUENCE:'1',RELEASE_REPO:'clbiez/Buyer-Log-Releases',PUBLISH_APPROVED:'true',RUNNER_TEMP:path.resolve(__dirname,'fixture-temp')};
 assert.equal(publisher.config(valid).tag,'signed-patch-v7.0.294-1');
 for(const patch of [{PUBLISH_APPROVED:'false'},{PUBLISH_APPROVED:''},{APPROVED_SOURCE_SHA:'main'},{PATCH_SEQUENCE:'0'},{PATCH_SEQUENCE:'1.5'},{BASE_VERSION:'latest'},{RELEASE_REPO:'../source'},{RUNNER_TEMP:''}])assert.throws(()=>publisher.config({...valid,...patch}));
});
test('the approved workflow has no automatic publication event or Actions ZIP storage and gates signing behind full tests',()=>{
 const workflow=fs.readFileSync(path.join(root,'.github/workflows/buyerlog-signed-manual-patch.yml'),'utf8');
 assert.match(workflow,/workflow_dispatch:/);assert.doesNotMatch(workflow,/^\s+(push|pull_request|workflow_run|schedule):/m);
 assert.match(workflow,/default: false/);assert.match(workflow,/inputs\.publish_approved == true && github\.ref == 'refs\/heads\/main'/);
 assert.match(workflow,/contents: read/);assert.match(workflow,/persist-credentials: false/);
 assert.ok(workflow.indexOf('run: npm test')<workflow.indexOf('secrets.BUYER_LOG_RELEASE_SIGNING_KEY'));
 assert.ok(workflow.indexOf('branches/main')<workflow.indexOf('secrets.BUYER_LOG_RELEASE_TOKEN'));
 assert.doesNotMatch(workflow,/actions\/(?:upload|download)-artifact|--clobber|contents: write/);
 const code=fs.readFileSync(path.join(root,'.github/scripts/buyerlog-signed-patch-publish.js'),'utf8');
 assert.doesNotMatch(code,/latest\.json|git.*push|--clobber|writeFileSync\([^\n]*(?:private|pem)/i);
});
