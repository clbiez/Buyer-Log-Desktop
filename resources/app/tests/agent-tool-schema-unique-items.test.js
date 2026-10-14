'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validate}=require('../server/lib/agent-tool-schema');

test('advertised uniqueItems contracts reject duplicates instead of being ignored',()=>{
  const schema={type:'array',items:{type:'string'},uniqueItems:true,maxItems:5};
  assert.deepEqual(validate(schema,['cp','orders']),['cp','orders']);
  assert.throws(()=>validate(schema,['cp','cp']),{code:'OFFICE_TOOL_SCHEMA'});
  const objects={type:'array',items:{type:'object'},uniqueItems:true};
  assert.throws(()=>validate(objects,[{a:1},{a:1}]),{code:'OFFICE_TOOL_SCHEMA'});
  assert.deepEqual(validate({type:'array',items:{type:'string'}},['cp','cp']),['cp','cp']);
});
