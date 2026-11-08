'use strict';
const assert=require('node:assert/strict');
function handler(source,id,event){const start="document.getElementById('"+id+"').addEventListener('"+event+"',";const at=source.indexOf(start);assert.ok(at>=0,id);const end=source.indexOf('\n});',at);assert.ok(end>at,id);return source.slice(at,end+4);}
module.exports={handler};
