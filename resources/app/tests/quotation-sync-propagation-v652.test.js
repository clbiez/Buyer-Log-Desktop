'use strict';

/* v6.52 — Koleksiyon'daki üretici adı ve model bilgisi değişiklikleri artık
 * KAPALI quotation kayıtlarına da yansıyor.
 *
 * Kullanıcı isteği: "Üretici adı değişirse eski kayıtlara da yansıt. Hatta
 * model bilgileri değişince de yansıt."
 *
 * İki ayrı iş:
 * (1) renameManufacturer — v6.51'de içerik düzenleme kilidi kalkmıştı, ama bu
 *     fonksiyon KENDİ eski "kapalı kayıtları atla" şartını hâlâ taşıyordu.
 * (2) syncModelFields (YENİ) — Koleksiyon'da PLM ID / Model Name / Category /
 *     Colour / Season / License değiştiğinde, o modele ait quotation
 *     satırları rowId (Koleksiyon satırının KALICI kimliği) üzerinden bulunup
 *     güncellenir. recordRequest ile AYNI alan haritasını kullanır.
 *
 * İkisinde de sahiplik kontrolü (yalnız kendi kayıtların) BİLEREK korunuyor —
 * kullanıcı yalnız "kapalı/eski kayıt" kısıtlamasından bahsetti, başkasının
 * kaydına yazma yetkisinden değil.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const UI = fs.readFileSync(path.join(ROOT, 'public', 'quotations.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');

function bodyOf(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunmalı`);
  let paren = 0, i = source.indexOf('(', start);
  for (; i < source.length; i++) {
    if (source[i] === '(') paren++;
    else if (source[i] === ')' && --paren === 0) break;
  }
  const open = source.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) return source.slice(open + 1, j);
  }
  throw new Error(`${name} ayrıştırılamadı`);
}

function bindRenameManufacturer(requests, currentUserId) {
  let saved = null;
  const fn = new Function('qReady', 'qLoad', 'qSave', 'qNow', 'qNorm', 'qCurrentUserId',
    `async function renameManufacturer(oldName,newName){${bodyOf(UI, 'renameManufacturer')}} return renameManufacturer;`
  )(Promise.resolve(), () => ({ requests }), (l) => { saved = l; }, () => 'NOW',
    v => String(v == null ? '' : v).trim(), () => currentUserId);
  return { run: fn, getSaved: () => saved };
}

function bindSyncModelFields(requests, currentUserId) {
  let saved = null;
  const KOL_MODEL_FIELD_MAP = { modelKod: 'modelCode', plmId: 'plmId', urunTipi: 'category', colour: 'colour', season: 'season', lisans: 'license' };
  const fn = new Function('qLoad', 'qSave', 'qNow', 'qNorm', 'qCurrentUserId', 'KOL_MODEL_FIELD_MAP',
    `function syncModelFields(rowId,kolFieldKey,value){${bodyOf(UI, 'syncModelFields')}} return syncModelFields;`
  )(() => ({ requests }), (l) => { saved = l; }, () => 'NOW',
    v => String(v == null ? '' : v).trim(), () => currentUserId, KOL_MODEL_FIELD_MAP);
  return { run: fn, getSaved: () => saved };
}

/* ---------------------------------------------------- 1) ÜRETİCİ ADI DEĞİŞİKLİĞİ */

test('v6.52 renameManufacturer artık kapalı kayıtları atlamıyor', () => {
  const requests = [{ id: 'r1', ownerId: 'u1', status: 'closed', updatedAt: '', manufacturers: [{ name: 'Eski Ad' }], items: [{ manufacturer: 'Eski Ad' }] }];
  const { run, getSaved } = bindRenameManufacturer(requests, 'u1');
  return run('Eski Ad', 'Yeni Ad').then(() => {
    assert.equal(requests[0].manufacturers[0].name, 'Yeni Ad');
    assert.equal(requests[0].items[0].manufacturer, 'Yeni Ad');
    assert.ok(getSaved(), 'değişen kayıt kaydedilmeli');
  });
});

test('v6.52 renameManufacturer başkasının kaydını değiştirmiyor (sahiplik korunuyor)', () => {
  const requests = [{ id: 'r1', ownerId: 'u2', status: 'active', updatedAt: '', manufacturers: [{ name: 'Eski Ad' }], items: [{ manufacturer: 'Eski Ad' }] }];
  const { run, getSaved } = bindRenameManufacturer(requests, 'u1');
  return run('Eski Ad', 'Yeni Ad').then(() => {
    assert.equal(requests[0].manufacturers[0].name, 'Eski Ad', 'başkasının kaydına dokunulmamalı');
    assert.equal(getSaved(), null);
  });
});

test('v6.52 kaynak kodda eski "kapalı kayıtları atla" şartı kalmamış', () => {
  const body = bodyOf(UI, 'renameManufacturer');
  assert.doesNotMatch(body, /req\.status==='closed'/);
  assert.match(body, /req\.ownerId!==qCurrentUserId\(\)/, 'sahiplik kontrolü korunmalı');
});

/* ------------------------------------------------------- 2) MODEL BİLGİSİ SENKRONU */

test('v6.52 model bilgisi rowId üzerinden doğru kayda (kapalı dahil) yansıyor', () => {
  const requests = [
    { id: 'r1', ownerId: 'u1', status: 'closed', updatedAt: '', items: [{ id: 'i1', rowId: 42, modelCode: 'ESKI', plmId: 'P1', category: 'C', colour: 'RED', season: 'S6', license: 'L' }] },
    { id: 'r2', ownerId: 'u1', status: 'active', updatedAt: '', items: [{ id: 'i2', rowId: 99, modelCode: 'BASKA', plmId: 'P2', category: 'C2', colour: 'BLUE', season: 'S7', license: 'L2' }] },
  ];
  const { run, getSaved } = bindSyncModelFields(requests, 'u1');
  run(42, 'modelKod', 'YENI-MODEL-ADI');
  assert.equal(requests[0].items[0].modelCode, 'YENI-MODEL-ADI', 'eşleşen rowId güncellenmeli (kapalı kayıt dahil)');
  assert.equal(requests[1].items[0].modelCode, 'BASKA', 'farklı rowId etkilenmemeli');
  const saved = getSaved();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].id, 'r1');
});

test('v6.52 model senkronu başkasının kaydını değiştirmiyor', () => {
  const requests = [{ id: 'r1', ownerId: 'u2', status: 'active', updatedAt: '', items: [{ id: 'i1', rowId: 42, modelCode: 'BASKA-KULLANICI' }] }];
  const { run, getSaved } = bindSyncModelFields(requests, 'u1');
  run(42, 'modelKod', 'YENI');
  assert.equal(requests[0].items[0].modelCode, 'BASKA-KULLANICI', 'başkasının kaydına dokunulmamalı');
  assert.equal(getSaved(), null);
});

test('v6.52 tüm izlenen model alanları haritalanıyor (PLM ID, Category, Colour, Season, License)', () => {
  const requests = [{ id: 'r1', ownerId: 'u1', status: 'active', updatedAt: '', items: [{ id: 'i1', rowId: 1, plmId: 'old', category: 'old', colour: 'old', season: 'old', license: 'old' }] }];
  const cases = [['plmId', 'plmId', 'NEWPLM'], ['urunTipi', 'category', 'NEWCAT'], ['colour', 'colour', 'NEWCOLOUR'], ['season', 'season', 'NEWSEASON'], ['lisans', 'license', 'NEWLIC']];
  for (const [kolKey, itemField, value] of cases) {
    const { run } = bindSyncModelFields(requests, 'u1');
    run(1, kolKey, value);
    assert.equal(requests[0].items[0][itemField], value, `${kolKey} -> ${itemField} haritalanmalı`);
  }
});

test('v6.52 izlenmeyen bir hücre alanı (ör. quantity) sessizce yok sayılıyor', () => {
  // commitKolEditor HER hücre değişikliğinde çağırır; ilgisiz alanlar hata
  // vermeden, hiçbir şeye dokunmadan geçmeli.
  const requests = [{ id: 'r1', ownerId: 'u1', status: 'active', updatedAt: '', items: [{ id: 'i1', rowId: 1, modelCode: 'X' }] }];
  const { run, getSaved } = bindSyncModelFields(requests, 'u1');
  assert.doesNotThrow(() => run(1, 'quantity', '500'));
  assert.equal(getSaved(), null, 'izlenmeyen alan hiçbir kaydı değiştirmemeli');
});

test('v6.52 syncModelFields dışa açık ve commitKolEditor içinde çağrılıyor', () => {
  assert.match(UI, /renameManufacturer,syncModelFields,setPrice/, 'window.BL_QUOTATIONS üzerinden erişilebilir olmalı');
  const body = bodyOf(APP, 'commitKolEditor');
  const rowAssignAt = body.indexOf('row=kolWriteGroupedStorageValue(row,k,val);');
  const syncAt = body.indexOf('window.BL_QUOTATIONS?.syncModelFields');
  assert.ok(rowAssignAt >= 0 && syncAt > rowAssignAt, 'senkron çağrısı kanonik cell write TAMAMLANDIKTAN SONRA yapılmalı');
  assert.match(body, /window\.BL_QUOTATIONS\.syncModelFields\(id,k,val\)/);
});

test('v6.52 alan haritası recordRequest ile tutarlı (iki yol ayrışmamış)', () => {
  // recordRequest kolRows->item eşlemesini kurarken kullandığı alan adları
  // (modelKod->modelCode, urunTipi->category, lisans->license) syncModelFields
  // ile AYNI olmalı; aksi halde ilk oluşturma ile sonraki senkron farklı
  // alanlara yazar ve veriler zamanla tutarsızlaşır.
  assert.match(UI, /modelCode:qNorm\(row\.modelKod\|\|row\['Model Name'\]\)/);
  assert.match(UI, /category:qNorm\(row\.urunTipi\|\|row\['Category'\]\)/);
  assert.match(UI, /license:qNorm\(row\.lisans\|\|row\['License'\]\)/);
  const mapBody = UI.slice(UI.indexOf('const KOL_MODEL_FIELD_MAP'), UI.indexOf('const KOL_MODEL_FIELD_MAP') + 200);
  assert.match(mapBody, /modelKod:'modelCode'/);
  assert.match(mapBody, /urunTipi:'category'/);
  assert.match(mapBody, /lisans:'license'/);
});
