'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
const CSS=require('./helpers/manifest-css')(['ui-tokens.css','app.css','design.css','experience.css','ui-components.css'] );

function between(start,end){
  const a=APP.indexOf(start),b=APP.indexOf(end,a+start.length);
  assert.ok(a>=0,`${start} not found`);assert.ok(b>a,`${end} not found`);
  return APP.slice(a,b);
}

test('Prepare E-Mail uses the lower-right Operation Center summary and stacks above PLM jobs',()=>{
  const block=between('function prepareEmailProgressStart','function renderKolMfrModal');
  assert.match(block,/prepareEmailProgressNote/);
  assert.match(block,/plmOpsStrip/);
  assert.match(block,/plmStrip\.offsetHeight/);
  assert.match(block,/note\.style\.right='16px'/);
  assert.match(block,/note\.style\.bottom=/);
  assert.match(block,/prepareEmailOperationTitle/);
  assert.match(block,/prepareEmailOperationStage/);
  assert.match(block,/plmOpsBadge isRun/);
  assert.match(block,/prepareEmailProgressFormatElapsed/);
  assert.match(block,/Dosya boyutuna ve iş yüküne göre işlem süresi uzayabilir/);
  assert.match(block,/pricingFormatBytes/);
  assert.doesNotMatch(block,/button\.getBoundingClientRect\(\)/);
});

test('e-mail generation updates the live Operation Center stage and always removes it',()=>{
  const block=between("modal.querySelector('#kolMfrConfirm').addEventListener('click', async ()=>{", "document.getElementById('kolSendPricingBtn')");
  assert.match(block,/const prepareProgress=prepareEmailProgressStart/);
  assert.match(block,/Excel ve ekler hazırlanıyor/);
  assert.match(block,/Ekler 9,5 MB sınırına göre düzenleniyor/);
  assert.match(block,/E-posta görselleri ve tablosu hazırlanıyor/);
  assert.match(block,/Taslak e-posta oluşturuluyor/);
  assert.ok((block.match(/prepareProgress\.stop\(\)/g)||[]).length>=2);
});

test('e-mail Operation Center card reuses PLM visual language and busy-button styling',()=>{
  assert.match(CSS,/\.prepareEmailProgressNote\{/);
  assert.match(CSS,/right:16px;bottom:16px/);
  assert.match(CSS,/\.prepareEmailOperationTitle\{/);
  assert.match(CSS,/\.prepareEmailOperationStage\{/);
  assert.match(CSS,/\.prepareEmailOperationBar>span\{/);
  assert.match(CSS,/\.prepareEmailProgressSpinner\{/);
  for(const id of ["cpProdStatusBtn","kolSendPricingBtn"]) assert.ok(CSS.includes(`#${id}.prepareEmailBusy`));
});
