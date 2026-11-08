'use strict';
// Adopted unchanged final-schema assertion; RED is retained in root evidence.
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./native-fixture.cjs');
test('successful model-column move renders the final remove snapshot',{timeout:5000},async()=>{
 const f=fixture({active:false});await f.open();await f.chooseConnection('b');await f.chooseField();await f.save();
 assert.deepEqual(f.patches.map(p=>p.command.op),['add','remove']);
 assert.equal(f.serverItems[0].cpColumns.length,0);assert.equal(f.serverItems[1].cpColumns.length,1);
 const displayed=f.events.find(e=>e[0]==='sync')[1],canonical=f.c.cpModelColumnDefinitionsFromConnections(f.c.modelConnState.items);
 assert.deepEqual(displayed.map(d=>d.id).sort(),canonical.map(d=>d.id).sort(),'final schema must reflect final source; old column-one is wrongly retained');
});
