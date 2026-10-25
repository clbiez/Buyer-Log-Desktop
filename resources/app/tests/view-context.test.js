'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const api=require('../public/view-context');
const fs=require('node:fs'),vm=require('node:vm');
const canonical=(page,key)=>({'Order Code':'orderCode',order:'orderCode',renamed:'orderCode',name:'modelName'}[key]||null);
const env={page:'cp',columns:['order','name','notes'],canonical};
test('saved view carries density, filters and canonical column IDs without changing the legacy payload',()=>{
 const original={__page:'cp',cp:{order:['order','name'],hidden:['name'],widthPx:{order:123},sorting:{key:'order',dir:-1}}};
 const saved=api.pack(original,{...env,density:'compact',filters:{__page:'cp',cp:{search:'DEMO'}},context:{owner:'alice'}});
 assert.equal(saved.__viewVersion,1);assert.equal(saved.cp.density,'compact');assert.equal(saved.cp.columnIds.order,'field:orderCode');assert.equal(saved.__filters.cp.search,'DEMO');assert.equal(original.__viewVersion,undefined);
});
test('renamed canonical bindings survive upgrade while removed local columns and invalid widths are dropped',()=>{
 const saved=api.pack({__page:'cp',cp:{order:['order','notes'],hidden:['notes'],widthPx:{order:123,notes:Infinity},sorting:{key:'order',dir:-1}}},env);
 const restored=api.unpack(saved,{...env,columns:['renamed','name','new']});
 assert.deepEqual(restored.cp.order,['renamed']);assert.deepEqual(restored.cp.hidden,[]);assert.deepEqual(restored.cp.widthPx,{renamed:123});assert.deepEqual(restored.cp.sorting,{key:'renamed',dir:-1});
});
test('canonical collisions retain exact local bindings and never guess among multiple replacement columns',()=>{
 const saved=api.pack({__page:'cp',cp:{order:['order','Order Code']}},{...env,columns:['order','Order Code']});
 assert.deepEqual(api.unpack(saved,{...env,columns:['order','Order Code']}).cp.order,['order','Order Code']);
 assert.deepEqual(api.unpack(saved,{...env,columns:['renamed','Order Code']}).cp.order,['Order Code']);
});
test('legacy view remains compatible; foreign page and unknown future schema cannot change the view',()=>{
 const saved={__page:'cp',cp:{order:['name','removed'],widthPx:{name:100},hidden:[]}};
 assert.deepEqual(api.unpack(saved,env).cp.order,['name']);assert.equal(api.unpack({...saved,__page:'orders'},env),null);assert.equal(api.unpack({...saved,__viewVersion:999},env),null);
});
test('bundled filters are remapped only to current columns and cannot target arbitrary controls',()=>{
 const saved=api.pack({__page:'cp',cp:{order:['order']}},{...env,filters:{__page:'cp',cp:{search:'DEMO',selects:{cpFSeason:'W26',viewSaveBtn:'bad'},colFilters:{order:{values:['A']},removed:{values:['B']}}}}});
 const data=api.unpack(saved,{...env,columns:['renamed'],filterIds:['cpFSeason']});assert.deepEqual(Object.keys(data.__filters.cp.colFilters),['renamed']);assert.deepEqual(data.__filters.cp.selects,{cpFSeason:'W26'});
});
test('row context rejects another user, collection workspace, reused numeric ID, and empty identities',()=>{
 const fields={canonicalValue:(row,page,key)=>row[key]||''},options={page:'koleksiyon',owner:'alice',user:'alice',fields};
 const row={id:1,modelName:'DEMO',colourCode:'01'},binding=api.rowBinding(row,options);
 assert.equal(api.matchesRow(binding,row,options),true);assert.equal(api.matchesRow(binding,row,{...options,user:'bob'}),false);assert.equal(api.matchesRow(binding,row,{...options,owner:'bob'}),false);assert.equal(api.matchesRow(binding,{...row,modelName:'OTHER'},options),false);assert.equal(api.matchesRow(api.rowBinding({id:1},options),{id:1},options),false);
});
test('resume storage is user scoped, bounded, permission checked and explicit routes take precedence',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};let user='alice';
 const resume=api.createResume({storage,user:()=>user,allowed:module=>['cp','overview'].includes(module)});
 resume.save('cp',{__page:'cp',cp:{order:['order']}});assert.equal(resume.read().module,'cp');assert.equal(resume.target('orders'),'orders');assert.equal(resume.target(null),'cp');
 user='bob';assert.equal(resume.read(),null);user='alice';resume.save('source');assert.equal(resume.read().module,'cp');
 const denied=api.createResume({storage,user:()=>user,allowed:module=>module==='overview'});assert.equal(denied.target(null),'overview');
 resume.save('cp',{huge:'x'.repeat(300000)});assert.equal(resume.read().data,null);
});
test('system default clears the native profile picker without mutating the stored favourite',()=>{
 const source=fs.readFileSync(require.resolve('../public/app-main.js'),'utf8'),start=source.indexOf('function clearProfileSelection(');assert.ok(start>=0,'reset requires an implemented picker helper');
 const end=source.indexOf('\nfunction resetViewToSystemDefault',start),select={value:'saved'},calls=[];
 const context={document:{getElementById:id=>id==='viewSelect'?select:null},window:{syncProfilePicker:el=>calls.push(el)}};
 vm.runInNewContext(source.slice(start,end)+';clearProfileSelection("view");',context);assert.equal(select.value,'');assert.equal(calls[0],select);
});
