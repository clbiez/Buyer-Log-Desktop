'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

function withParseRows(rows, callback) {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'xlsx') return {
      SSF: {},
      utils: { sheet_to_json: () => rows },
    };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const resolved = require.resolve('../server/lib/parse');
    delete require.cache[resolved];
    return callback(require('../server/lib/parse'));
  } finally { Module._load = originalLoad; }
}

function baseOrder() {
  return {
    ocode: 1001, colour: 'Kırmızı', kalan: 10, qty: 10, antrepo: 0,
    license: '', manufacturer: 'Factory', season: 'W6', countryRaw: 'TURKIYE',
    buyerGrup: 'ORME', merch: 'CU4E', category: 'T-Shirt', ozel: '',
    plm: 1, model: 'M1', ccode: 'R1', fob: 5, opd: null,
    ex: new Date(2026, 6, 10), retail: null, mb: null, shipConf: null,
    ageGroup: '', buyer: '', line: '', merkezSevkeHazirKalan: 0,
    karisim: '', iplikNo: '', kumasTipi: '', fabricWeight: '',
  };
}
function overrides() {
  return { apprmap: {}, submap: {}, suppfobmap: {}, suppfobmetamap: {}, delmap: {}, licensormap: {}, pricingRules: [], transitRules: [], nonDtrManufacturers: [] };
}

/* v6.53 — Kaldırılan "ASAS - Fabric" (ayrı kaynak dosyası) mimarisini sınayan
   üç test buradan çıkarıldı. Kod tabanında doğrulandı: index.html'de
   "fabricRefreshBtn" / "Kumaş Bilgilerini Güncelle" YOK, server.js'te
   "/api/fabric/*" ucu YOK, db.js'te loadFabricInfo/saveFabricInfo YOK.
   parseFabricWorkbook (parse.js) hâlâ tanımlı ama server.js'in hiçbir
   yerinden çağrılmıyor — kasıtlı olarak ölü bırakılmış, silinmedi. Kumaş
   sütunları artık ASAS'ın kendi ayrıştırma akışının parçası; ayrı bir
   dosya/buton/API/depo yok. Bu üç test o kaldırılan akışı (bulanık sütun
   eşleştirme, "ASAS - Fabric.xlsx" dosyasını ayrı bulma, ayrı buton/uç
   varlığı) sınıyordu — bayat.
   Kalan "During Buying Approval is removed..." testi Fabric ile ilgisiz
   (Backlog/CP tarih mantığını sınıyor), değiştirilmeden korundu. */

test('During Buying Approval is removed and Backlog revised date always comes from ASAS original ex-factory', () => {
  withParseRows([], parse => {
  const order = baseOrder();
  // v4.39: eşleşme artık harita anahtarından değil, IAS kaydının kendi model/ccode
  // alanlarından (Sipariş Kod + Model Adı + Renk Kod) hesaplanıyor — bu alanlar
  // olmadan kayıt hiçbir ASAS siparişine bağlanmaz.
  const antrepo = {
    '1001|KIRMIZI': {
      ocode: 1001,
      model: 'M1',
      ccode: 'R1',
      statu: 'Yol Operasyonları',
      buyingApprovalQty: 999,
      revizeYuklemeTarihi: new Date(2030, 0, 1),
      arr: new Date(2026, 7, 1),
      vasita: 'Gemi',
      // Sipariş miktarının (order.qty=10) tamamı bu parsiyelde yüklü sayılmalı;
      // aksi halde backlogProductionRemainder eksik-yükleme/üretim segmenti
      // sentezleyip bu hit'in statüsünü (Yol Operasyonları) gölgeler.
      loadedQty: 10,
    },
  };
  const cp = parse.buildCPRowsFromASAS([order], antrepo, overrides())[0];
  assert.equal(cp.STATUS, 'Yol Operasyonları');
  const detail = parse.buildBacklogDetailRows([order], antrepo, overrides(), [1001])[0];
  // Sütun adı 'REVİZE YÜKLEME TARİHİ' -> 'REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)' olarak
  // Backlog'un diğer tarih sütunlarıyla tutarlı hale getirilmiş.
  assert.equal(detail['REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)'].getTime(), order.ex.getTime());
  assert.equal(Object.keys(detail).some(k => /Buying Onayı Bekleyen/i.test(k)), false);
  const template = parse.buildBacklogTemplateRows([order], antrepo, overrides(), [1001])[0];
  assert.equal(template['REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)'].getTime(), order.ex.getTime());
  assert.equal(Object.keys(template).some(k => /Buying Onayında Bekleyen/i.test(k)), false);
  });
});
