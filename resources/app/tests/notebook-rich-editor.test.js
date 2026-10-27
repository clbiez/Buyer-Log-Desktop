'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
const notebook=app.slice(app.indexOf('const TODO_KEY ='),app.indexOf("document.getElementById('todoBtn')?.addEventListener"));
function context(entries={}){
  const store=new Map(Object.entries(entries));
  const sandbox={appLang:'tr',BLStorage:{getItem:key=>store.get(key),setItem:(key,value)=>store.set(key,value)},setTimeout,clearTimeout,TextEncoder};
  vm.createContext(sandbox);vm.runInContext(notebook,sandbox);return {sandbox,store,run:code=>vm.runInContext(code,sandbox)};
}
test('plain legacy notes migrate without interpreting text as HTML',()=>{
  const c=context({'lcw.todo.text.v1':'<script>plain text</script>\nsecond line'});
  assert.equal(c.run('todoActive().text'),'<script>plain text</script>\nsecond line');
  assert.equal(c.run('todoActive().html'),undefined);
  assert.equal(c.run('todoSave(null)'),true);
  assert.equal(c.store.get('lcw.todo.text.v1'),'<script>plain text</script>\nsecond line');
});
test('rich page HTML and searchable plain text survive saving and loading',()=>{
  const c=context({'lcw.todo.pages.v1':JSON.stringify({pages:[{id:'p1',title:'Plan',text:'Important task',html:'<b>Important</b> task'},{id:'p2',title:'Other',text:'Separate page'}],activeId:'p1'})});
  assert.equal(c.run('todoFiltered("task").length'),1);
  c.run('todoSave(null); _todoState=null');
  assert.equal(c.run('todoActive().html'),'<b>Important</b> task');
  assert.equal(c.run('todoLoad().pages[1].text'),'Separate page');
  assert.equal(c.store.get('lcw.todo.text.v1'),'Important task');
});
test('save failures remain explicit and keep note state in memory',()=>{
  const c=context();c.run('todoActive().html="<b>Keep me</b>"; BLStorage.setItem=()=>{throw new Error("quota")};');
  assert.equal(c.run('todoSave(null)'),false);
  assert.equal(c.run('todoActive().html'),'<b>Keep me</b>');
});
test('all save paths read rich content and image budget covers the entire notebook',()=>{
  assert.match(app,/if\(ta\) todoReadEditor\(ta,page\)/);
  assert.match(notebook,/new TextEncoder\(\)\.encode\(JSON\.stringify\(candidate\)\)\.length<=1800000/);
  assert.match(notebook,/st\.pages\.map/);
  assert.match(notebook,/addImages\(\[\.\.\.e\.dataTransfer\.files\],range/);
  assert.match(notebook,/function bindRichNoteEditor/);
  assert.match(notebook,/!ta\.isConnected/);
});

test('oversized UTF-8 notebooks never report a successful save or overwrite persisted notes',()=>{
  const c=context({'lcw.todo.text.v1':'persisted'});
  c.run('todoActive().text="ü".repeat(1100000)');
  assert.equal(c.run('todoSave(null)'),false);
  assert.equal(c.store.get('lcw.todo.text.v1'),'persisted');
  assert.equal(c.run('todoActive().text.length'),1100000);
});
