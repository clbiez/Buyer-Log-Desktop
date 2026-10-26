'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const notes=require('../public/personal-order-notes');

function browserFor(userId,native){
  const actual=key=>`bl.user.${userId}.${key}`;
  return {
    native:{get length(){return native.size;},key:index=>[...native.keys()][index]??null},
    actualKey:actual,
    getItem:key=>native.get(actual(key))??null,
    setItem:(key,value)=>native.set(actual(key),String(value)),
    removeItem:key=>native.delete(actual(key)),
  };
}
const definition=(id,label)=>({id,label,labelTr:label,labelEn:label});
const india=definition('personal_note_india01','Hindistan Seyahat Notları');
const line='12345678|THREE THREAD TERRY|RED';

test('personal note definitions and values are isolated between account-scoped stores',()=>{
  const native=new Map(),mine=notes.create(browserFor('buyerA',native)),other=notes.create(browserFor('buyerB',native));
  assert.deepEqual(mine.setDefinitions([india]),[india]);
  assert.equal(mine.writeValue(india.id,line,'Üretici ile görüşüldü'),'Üretici ile görüşüldü');
  assert.equal(mine.readValue(india.id,line),'Üretici ile görüşüldü');
  assert.deepEqual(other.definitions(),[]);
  assert.equal(other.readValue(india.id,line),'');
  assert.throws(()=>other.writeValue(india.id,line,'Read-only order modification'),/PERSONAL_NOTE_INVALID_TARGET/);
  assert.equal(native.has(`bl.user.buyerA.lcw.personalOrderNotes.value.v1.${india.id}.${encodeURIComponent(line)}`),true);
});

test('note identity uses order, model and colour; never spills across line items',()=>{
  const native=new Map(),mine=notes.create(browserFor('a',native));mine.setDefinitions([india]);
  mine.writeValue(india.id,line,'C01');
  assert.equal(mine.readValue(india.id,'12345678|THREE THREAD TERRY|BLUE'),'');
  assert.equal(mine.readValue(india.id,'12345679|THREE THREAD TERRY|RED'),'');
  assert.throws(()=>mine.writeValue(india.id,'not-a-valid-order','bad'),/PERSONAL_NOTE_INVALID_TARGET/);
  mine.writeValue(india.id,line,'');
  assert.equal(mine.readValue(india.id,line),'');
  assert.equal(native.has(`bl.user.a.lcw.personalOrderNotes.value.v1.${india.id}.${encodeURIComponent(line)}`),true,'clear persists an empty synced value');
});

test('deleted private columns no longer expose data and cannot be edited',()=>{
  const native=new Map(),mine=notes.create(browserFor('a',native)),other=definition('personal_note_trip02','Vietnam');
  mine.setDefinitions([india,other]);
  mine.writeValue(india.id,line,'private');
  mine.writeValue(other.id,line,'still here');
  assert.equal(mine.removeDefinition(india.id),true);
  assert.deepEqual(mine.definitions(),[other]);
  assert.equal(mine.readValue(india.id,line),'');
  assert.equal(mine.readValue(other.id,line),'still here');
  assert.throws(()=>mine.writeValue(india.id,line,'regression'),/PERSONAL_NOTE_INVALID_TARGET/);
});

test('private notes have explicit bounds and reject malformed column identifiers',()=>{
  const client=notes.create(browserFor('a',new Map()));
  assert.throws(()=>client.setDefinitions([{id:'note_shared',label:'Legacy'}]),/PERSONAL_NOTE_INVALID_COLUMNS/);
  assert.throws(()=>client.setDefinitions(Array.from({length:25},(_,i)=>definition(`personal_note_column_${i}`,'Title'))),/PERSONAL_NOTE_COLUMN_LIMIT/);
  client.setDefinitions([india]);
  assert.equal(client.writeValue(india.id,line,'x'.repeat(4001)).length,4000);
});

test('app uses private edit path even for view-only Orders; shared overrides still enforce IAM',()=>{
  const root=path.join(__dirname,'..');
  const app=fs.readFileSync(path.join(root,'public','app-main.js'),'utf8');
  const server=fs.readFileSync(path.join(root,'server','server.js'),'utf8');
  const storage=fs.readFileSync(path.join(root,'public','user-storage.js'),'utf8');
  const prefs=fs.readFileSync(path.join(root,'server','lib','user-preferences.js'),'utf8');
  assert.match(app,/if\(c\.personalNote\)\{/);
  assert.match(app,/blPersonalOrderNote"/);
  assert.match(app,/bindPersonalOrderNoteHandlers\('ordersTable'\)/);
  assert.match(app,/bindPersonalOrderNoteHandlers\('cpTable'\)/);
  assert.match(app,/else if\(action==='personal-note'\)void addPersonalOrderNoteColumn\(done\)/);
  assert.match(app,/notes\.writeValue\(id,key,t\.value\)/);
  assert.match(app,/function readPrivateOrderNote\(row,key\)/);
  assert.match(app,/if\(c\.personalNote\)return readPrivateOrderNote\(r,c\.k\)/);
  assert.doesNotMatch(app,/row\[def\.id\]\s*=/,'private notes must never mutate shared order rows');
  assert.match(server,/if \(rejectUnauthorizedOrders\(req, res, \[orderCode\]\)\) return;/);
  assert.match(server,/if \(rejectUnauthorizedOrders\(req, res, items\.map\(item => item && item\.orderCode\)\)\) return;/);
  assert.match(storage,/'lcw\.personalOrderNotes\.'/);
  assert.match(prefs,/'lcw\.personalOrderNotes\.'/);
  assert.doesNotMatch(notes.writeValue.toString(),/overrides|notesmap|patchOrderOverride/);
  const workspacePrefixes=prefs.split('const WORKSPACE_CATEGORY_PREFIXES')[1].split('const WORKSPACE_CATEGORIES')[0];
  assert.doesNotMatch(workspacePrefixes,/personalOrderNotes/,'private data must not enter copyable workspace categories');
});
