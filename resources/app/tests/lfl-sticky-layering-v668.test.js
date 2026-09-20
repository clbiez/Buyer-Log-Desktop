'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const CSS=fs.readFileSync(path.join(ROOT,'public','lfl.css'),'utf8');

function rule(selector){
  const escaped=selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const matches=[...CSS.matchAll(new RegExp(escaped+'\\{([^}]+)\\}','g'))];
  assert.ok(matches.length,`${selector} kuralı bulunamadı`);
  return matches[matches.length-1][1];
}

test('v6.68 LFL analiz kaydırma alanları bağımsız ve opak bir katman oluşturur',()=>{
  const block=rule('.lflOrderTableWrap,.lflOrderMatrixWrap');
  assert.match(block,/position:relative/);
  assert.match(block,/isolation:isolate/);
  assert.match(block,/background:var\(--card\)/);
});

test('v6.68 Dağılım Matrisi başlık, sabit sütun ve köşe hücresini ayrı katmanlarda tutar',()=>{
  const header=rule('.lflOrderMatrix thead th');
  const frozen=rule('.lflOrderMatrix tbody th');
  const corner=rule('.lflOrderMatrix thead th:first-child');
  assert.match(header,/z-index:5/);assert.match(header,/background:var\(--card2-strong\)/);
  assert.match(frozen,/left:0/);assert.match(frozen,/z-index:4/);assert.match(frozen,/background:var\(--card2\)/);
  assert.match(corner,/left:0/);assert.match(corner,/z-index:7/);assert.match(corner,/background:var\(--card2-strong\)/);
});

test('v6.68 LFL toplam satırı şeffaf değildir ve gövde metninden ayrılır',()=>{
  const footer=rule('.lflOrderTable tfoot td');
  assert.match(footer,/z-index:4/);
  assert.match(footer,/background:var\(--card2\)/);
  assert.match(footer,/box-shadow:/);
});
