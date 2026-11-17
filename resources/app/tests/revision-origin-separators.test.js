'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Revision=require('../public/revision-display'),BR=require('../public/business-rules'),parse=require('../server/lib/parse');
const app=fs.readFileSync(require.resolve('../public/app-main.js'),'utf8');
function renderer(lang='en'){
 const context={BLRevision:Revision,appLang:lang,escapeHtml:String,revisionText:(_key,value)=>String(value),L:String};vm.createContext(context);
 vm.runInContext(app.match(/function revisionHtml\([\s\S]*?\n\}/)[0],context);return context.revisionHtml;
}
const text=html=>html.replace(/<[^>]*>/g,'');
test('manual date revisions retain arrows, computed columns use dots regardless of the initiating edit',()=>{
 const render=renderer();
 for(const key of ['Ex-factory','Retail Date','In-Store (Model Budget)'])assert.equal(text(render(key,{from:'old',to:'new'})),'old→new',key);
 for(const key of ['LT','Ex→Retail','Priority'])for(const source of [undefined,'manual','loading-approval'])assert.equal(text(render(key,{from:10,to:20,source})),'10·20',key);
});
test('automatic date revision and calculated old/new values use the same dot in TR and EN',()=>{
 for(const language of ['tr','en']){
  const render=renderer(language);
  assert.equal(text(render('Ex-factory',{from:'12.12.26',to:'12.11.26',source:'loading-approval'})),'12.12.26·12.11.26');
  const html=render('LT',{from:225,to:195,source:'loading-approval'});
  assert.match(html,/data-rev-title="225 · 195"/);
  assert.doesNotMatch(html,/→/);
 }
});
test('custom badge/link renderers remain intact in automatic pairs',()=>{
 const html=renderer()('Ex→Retail',{from:66,to:96},value=>value===96?`<a href="/demo">${value}</a>`:String(value));
 assert.equal(text(html),'66·96');assert.match(html,/<a href="\/demo">96<\/a>/);
});
test('approval is authoritative before, after or on the same day as planned and saved revisions',()=>{
 for(const planned of ['2026-10-01','2026-11-12','2026-12-12',null]){
  const result=BR.resolveExFactoryDate(planned,'2026-11-12',parse.dateOrdinal);
  assert.equal(result.value,'2026-11-12');assert.equal(result.automatic,true);
 }
});
