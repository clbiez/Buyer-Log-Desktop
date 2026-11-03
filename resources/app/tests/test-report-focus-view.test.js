'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),View=require('../public/test-report-focus-view');
test('focus view keeps model, AI comments and report tests visible and escapes untrusted report text',()=>{
 const view=View.render({T:(_tr,en)=>en,entry:{id:'r0',report:{talepNo:'LAB-001',talepTipi:'<script>bad</script>',testler:[{ad:'Formaldehyde <img onerror=x>',bilesen:'FABRIC',sonuc:'Fail'}]}},session:'id',options:[],tab:'report',modelName:'MODEL <x>',orderCode:'4100001',colour:'BLUE',image:'/api/cp-images/known',aiReview:'<p>Verified assessment</p>',resultLabel:v=>v,evidence:'',sourceLinks:'',readingDetails:'',descriptions:'',issues:'',history:[]});
 assert.match(view,/trFocusModel/);assert.match(view,/Verified assessment/);assert.match(view,/Formaldehyde &lt;img onerror=x&gt;/);assert.doesNotMatch(view,/<script>bad/);assert.match(view,/trFocusSource/);
});
test('document operations is a lazy Tools action and never a sidebar module',()=>{
 const read=file=>fs.readFileSync(path.join(__dirname,'../public',file),'utf8');
 const index=read('index.html'),at=index.indexOf('id="cpToolsMenu"'),end=index.indexOf('id="cpMoreWrap"',at);
 assert.match(index.slice(at,end),/id="cpDocumentReviewBtn"/);
 assert.doesNotMatch(index,/<button[^>]*data-tab="(?:documents|documentOperations|testReports)"/);
 assert.match(read('app-main.js'),/cpDocumentReviewBtn[\s\S]{0,500}ensureFeature\('testReportImport'\)/);
 assert.doesNotMatch(index,/<script[^>]*test-report-focus-view/);
 assert.match(read('perf-runtime.js'),/testReportImport:\[[^\]]*test-report-focus-view\.js[^\]]*test-report-import\.js/);
});
