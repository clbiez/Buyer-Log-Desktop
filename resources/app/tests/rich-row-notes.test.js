'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
const dbSource=fs.readFileSync(path.join(__dirname,'../server/db.js'),'utf8');
test('rich note transactions preserve readable text, author attribution and format-only changes',()=>{
 const start=dbSource.indexOf('function applyOrderPatch('),end=dbSource.indexOf('\nfunction ',start+1);
 const sandbox={validatePricingRestore:()=>null,overrideWriteKey:(code,p)=>code+'|'+p.model+'|'+p.ccode,NOTE_AUTHOR_FIELDS:[{field:'Notes',at:'NotesAt',by:'NotesBy',byName:'NotesByName'},{field:'EkNot',at:'EkNotAt',by:'EkNotBy',byName:'EkNotByName'}],Date,Buffer};
 vm.createContext(sandbox);vm.runInContext(dbSource.slice(start,end)+'\n;this.apply=applyOrderPatch',sandbox);
 const ov={notesmap:{}},actor={id:'demo',name:'Demo'},key='1|MODEL|01';
 sandbox.apply(ov,1,{model:'MODEL',ccode:'01',notes:{Notes:'Plan',NotesHtml:'<b>Plan</b>'}},{actor});
 assert.equal(ov.notesmap[key].Notes,'Plan');assert.equal(ov.notesmap[key].NotesHtml,'<b>Plan</b>');assert.equal(ov.notesmap[key].NotesBy,'demo');
 sandbox.apply(ov,1,{model:'MODEL',ccode:'01',notes:{Notes:'Plan',NotesHtml:'<i>Plan</i>'}},{actor:{id:'other',name:'Other'}});
 assert.equal(ov.notesmap[key].NotesHtml,'<i>Plan</i>');assert.equal(ov.notesmap[key].NotesBy,'other');
 sandbox.apply(ov,1,{model:'MODEL',ccode:'01',notes:{Notes:''}},{actor});
 assert.equal(ov.notesmap[key].NotesHtml,'');assert.equal(ov.notesmap[key].NotesAt,'');
 assert.throws(()=>sandbox.apply(ov,1,{model:'MODEL',ccode:'01',notes:{Notes:'draft',NotesHtml:'ü'.repeat(1000000)}},{actor}),error=>error.code==='VALIDATION_ERROR');
 assert.equal(ov.notesmap[key].Notes,'','oversized content must not partially replace the note');
});
test('an image-only note survives the shared-store tombstone projection',()=>{
 const store=require('../server/lib/cp-shared-store');
 assert.equal(store.notesExplicitlyCleared({Notes:'',NotesHtml:'<img src="data:image/png;base64,AA==">',EkNot:''}),false);
 assert.equal(store.notesExplicitlyCleared({Notes:'',NotesHtml:'',EkNot:''}),true);
});
test('row note editors share Notebook controls and recheck current ownership before save',()=>{
 assert.match(app,/bindRichNoteEditor\(modal,ta\)/);assert.match(app,/bindRichNoteEditor\(modal,editor\)/);
 assert.match(app,/owner!==kolWorkspaceOwnerId/);assert.match(app,/row\[target.key\+'Html'\]/);
 assert.match(app,/richNoteHtml\(ta\)/);assert.match(app,/target\.prevHtml/);
});
