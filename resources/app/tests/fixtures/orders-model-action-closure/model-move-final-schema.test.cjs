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

test('a successful guarded model-column edit retains the selected custom heading in the actual PATCH',{timeout:5000},async()=>{
 const f=fixture({active:true});await f.open();await f.chooseField();const group=f.modal.querySelector('#_cpModelGroup'),name=f.modal.querySelector('#_cpModelGroupNew');
 group.value='__new_group__';await group.fire('change');name.value='Synthetic Heading';await name.fire('input');await f.save();
 assert.equal(f.patches.length,1);assert.equal(f.patches[0].command.group,'Synthetic Heading');assert.equal(f.serverItems[0].cpColumns[0].group,'Synthetic Heading');
});
