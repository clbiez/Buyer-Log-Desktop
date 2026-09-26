'use strict';

/* 30.000 satırlık ölçümde bulunan hata: LFL sayfası ilk açıldığında kendi
   dosyasını yükleyip runtime.sources.lfl alanını dolduruyor; sayfa önbelleğinin
   geçerlilik anahtarı bu alanı da içerdiği için LFL'yi hiç kullanmayan CP,
   Siparişler ve Genel Bakış önbellekleri geçersiz sayılıyor, bir sonraki
   tıklamada veri baştan hesaplanıyordu (CP 8 sn, Siparişler 23 sn). LFL sayfa
   önbelleği modülü değildir; anahtardan çıkarılır. */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { extractFunction } = require('./helpers/app-main-functions');
const SERVER = require('./helpers/server-source')();

const context = vm.createContext({ require, JSON, Object, String, Array });
vm.runInContext(`const crypto=require('crypto');${extractFunction(SERVER, 'stableHashValue')}\n${extractFunction(SERVER, 'projectionSourceRevision')}\nglobalThis.fn=projectionSourceRevision;`, context);

test('LFL kaynağının yüklenmesi CP/Siparişler/Genel Bakış önbellek anahtarını değiştirmez', () => {
  const base = { loadedAt: '2026-09-26T09:00:00Z', sources: { asas: 'ASAS.xlsx', antrepo: 'Excel: Antrepo.xlsx' }, excelRefresh: null };
  const afterLfl = { ...base, sources: { ...base.sources, lfl: 'LFL - Demo.xlsx' } };
  assert.equal(context.fn(afterLfl), context.fn(base));
});

test('ASAS/Antrepo kaynağı veya yenileme zamanı değişirse anahtar değişir', () => {
  const base = { loadedAt: '2026-09-26T09:00:00Z', sources: { asas: 'ASAS.xlsx', antrepo: 'Excel: Antrepo.xlsx' } };
  assert.notEqual(context.fn({ ...base, loadedAt: '2026-09-26T10:00:00Z' }), context.fn(base));
  assert.notEqual(context.fn({ ...base, sources: { ...base.sources, antrepo: 'Dashboard: Power BI' } }), context.fn(base));
});
