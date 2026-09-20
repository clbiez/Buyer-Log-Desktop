'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const INDEX=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');

test('v7.83 Overview network-drive açıklama footerı kaldırılmıştır',()=>{
  assert.doesNotMatch(INDEX,/Sunucudan çekilen veriler ağ sürücüsündeki Excel dosyalarından okunur/);
  assert.doesNotMatch(INDEX,/Data pulled from the server is read from Excel files on the network drive/);
});
