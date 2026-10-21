'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const formulas = require('../public/backlog-excel-formulas');

const HEADERS = [
  'Retail Depo Tarih Yıl Ay Gün',
  'GÜNCEL DURUM\n(STATUS)',
  'REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)',
  'ANTREPO GİRİŞ TARİHİ',
  'YÜKLEME TİPİ',
  'ANTREPO-RETAIL',
  'RİSK\n(PRIORITY)',
];

/* v9.53 — RİSK(PRIORITY) ARTIK TEK EŞİKTEN DEĞİL, SİNYALLERDEN GELİYOR.
 *
 * v5.74'te kural "ANTREPO-RETAIL > 5" idi ve formül plan tarafından
 * hesaplanıyordu. Artık iki şey birden değişti (backlog-excel-formulas.js ve
 * parse.js backlogRiskFromSignals içinde belgeli):
 *   · Formül altı operasyonel bayrağı OR'luyor: Delay, MB Delay, Handover,
 *     Ant. Delay, Discount ve üretim sonrası transit gecikmesi. Eski
 *     ANTREPO-RETAIL riski bu bayrakların içinde korunuyor.
 *   · `cached` artık Buyer Log'un kendi hesapladığı değerin AYNEN aktarımı;
 *     Excel'de gösterilen ile programda görünen ayrışamasın diye.
 *
 * Korunan asıl kusur değişmedi: Excel'e giden RİSK sütunu, ekrandakiyle aynı
 * kaynaktan gelmeli ve formülü sinyal sütunlarına bağlı olmalı.
 */
function row(value, risk){
  return {
    'Retail Depo Tarih Yıl Ay Gün':'2026-08-01',
    'GÜNCEL DURUM\n(STATUS)':'Yolda',
    'REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)':'2026-06-01',
    'ANTREPO GİRİŞ TARİHİ':'2026-08-02',
    'YÜKLEME TİPİ':'Gemi',
    'ANTREPO-RETAIL':value,
    'RİSK\n(PRIORITY)':risk,
    _backlogExcel:{transitDays:70,originalDelType:'Gemi'},
  };
}

test('v9.53 Antrepo Excel RİSK(PRIORITY) formülü operasyonel sinyalleri OR\'luyor',()=>{
  const plan=formulas.formulaPlan(HEADERS,row(6,'VAR'),2).formulas['RİSK\n(PRIORITY)'];
  // v20261021: kullanıcı kuralı üç bayraktır — Retail'e yetişmeme (ortalama yol
  // süresiyle tahmin), 3 günü aşan Handover bekleyişi ve yol süresi aşımı.
  // Biri düşerse o risk türü Excel'de kaybolur. MB tamponu / indirim / ETA
  // kayması CP Action Priority sinyalidir, Backlog RİSK'ine girmez.
  assert.match(plan.formula,/^IF\(OR\((?:[A-Z]+2,){2}[A-Z]+2\),"VAR","YOK"\)$/,
    'formül üç risk bayrağını OR\'lamalı');
  // Tek eşiğe geri dönülmemeli.
  assert.doesNotMatch(plan.formula,/>5/,'tek ANTREPO-RETAIL eşiğine geri dönülmemeli');
});

test('v9.53 Excel\'deki RİSK değeri programın hesabından AYNEN gelir',()=>{
  // Ayrışma olursa Excel ile ekran farklı risk gösterirdi.
  for(const value of ['VAR','YOK']){
    const plan=formulas.formulaPlan(HEADERS,row(6,value),2).formulas['RİSK\n(PRIORITY)'];
    assert.equal(plan.cached,value);
  }
});

test('v9.53 satır numarası formüle doğru yansıyor',()=>{
  for(const rowNumber of [2,3,4]){
    const plan=formulas.formulaPlan(HEADERS,row(6,'VAR'),rowNumber).formulas['RİSK\n(PRIORITY)'];
    assert.ok(plan.formula.includes(String(rowNumber)),`satır ${rowNumber} formülde olmalı`);
  }
});
