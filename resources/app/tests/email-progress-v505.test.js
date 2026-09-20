'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
const CSS=fs.readFileSync(path.join(ROOT,'public','app.css'),'utf8');

function between(start,end){
  const a=APP.indexOf(start),b=APP.indexOf(end,a+start.length);
  assert.ok(a>=0,`${start} not found`);assert.ok(b>a,`${end} not found`);
  return APP.slice(a,b);
}

test('v5.05 Prepare E-Mail shows a live processing note under the source button',()=>{
  const block=between('function prepareEmailProgressStart','function renderKolMfrModal');
  assert.match(block,/prepareEmailProgressNote/);
  assert.match(block,/button\.getBoundingClientRect\(\)/);
  assert.match(block,/rect\.bottom\+6/);
  assert.match(block,/prepareEmailProgressFormatElapsed/);
  assert.match(block,/Dosya boyutuna ve iş yüküne göre işlem süresi uzayabilir/);
  assert.match(block,/pricingFormatBytes/);
});

test('v5.05 e-mail generation updates progress stages and always removes the note',()=>{
  const block=between("modal.querySelector('#kolMfrConfirm').addEventListener('click', async ()=>{", "document.getElementById('kolSendPricingBtn')");
  assert.match(block,/const prepareProgress=prepareEmailProgressStart/);
  assert.match(block,/Excel ve ekler hazırlanıyor/);
  assert.match(block,/Ekler 9,5 MB sınırına göre düzenleniyor/);
  assert.match(block,/E-posta görselleri ve tablosu hazırlanıyor/);
  assert.match(block,/Taslak e-posta oluşturuluyor/);
  assert.ok((block.match(/prepareProgress\.stop\(\)/g)||[]).length>=2);
});

test('v5.05 processing note has spinner and busy button styling',()=>{
  assert.match(CSS,/\.prepareEmailProgressNote\{/);
  assert.match(CSS,/\.prepareEmailProgressSpinner\{/);
  assert.match(CSS,/#cpProdStatusBtn\.prepareEmailBusy,#kolSendPricingBtn\.prepareEmailBusy/);
});
