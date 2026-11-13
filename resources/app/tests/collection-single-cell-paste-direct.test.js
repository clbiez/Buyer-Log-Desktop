'use strict';

// Regression: 7.0.355 "tek tık yalnız seçer" değişikliğinden sonra tek hücreye
// Ctrl+V artık yerel input yapıştırması değil, ızgara yapıştırma hattından geçer.
// Bu hat her tek hücre yapıştırmasını toplu önizleme diyaloğuna sokuyordu;
// önceki kayıt beklemedeyse ise hiçbir mesaj vermeden yapıştırmayı düşürüyordu.

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const SRC=fs.readFileSync(path.join(__dirname,'..','public','collection-spreadsheet.js'),'utf8');

function applyMatrixSource(){
  const start=SRC.indexOf('async function applyMatrix(');
  const end=SRC.indexOf('\n',start);
  assert.ok(start>=0&&end>start,'applyMatrix bulunamadı');
  return SRC.slice(start,end);
}

test('tek hücre yapıştırma toplu önizleme diyaloğu açmadan tek geri alma adımıyla uygulanır',()=>{
  const fn=applyMatrixSource();
  // Önizleme yalnız çok hücreli / atlanan / geçersiz / salt-okunur içeren planlarda.
  assert.match(fn,/multi=plan\.total>1\|\|plan\.invalid\|\|plan\.readonly\|\|plan\.skipped/);
  assert.match(fn,/if\(multi&&bridge\(\)\?\.previewBatch\)\{/);
  assert.doesNotMatch(fn,/if\(bridge\(\)\?\.previewBatch\)\{/);
  // Tek hücre doğrudan batchEdit yolundan geçer (kayıt + tek undo adımı).
  assert.match(fn,/const result=bridge\(\)\?\.batchEdit\?\.\(plan\.ops,summary\)/);
});

test('önizleme öncesi kayıt beklemede kalırsa yapıştırma sessizce düşmez, TR/EN uyarı verir',()=>{
  const fn=applyMatrixSource();
  assert.match(fn,/result\?\.pending&&!result\?\.receipt/);
  assert.match(fn,/Önceki değişiklikler henüz kaydedilemediği için yapıştırma uygulanmadı/);
  assert.match(fn,/Earlier changes could not be saved yet, so nothing was pasted/);
});
