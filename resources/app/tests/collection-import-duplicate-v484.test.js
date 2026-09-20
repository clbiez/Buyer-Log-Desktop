'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = (fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8'));

function extractFunction(name, nextName) {
  const start = SRC.indexOf(`function ${name}(`);
  const nextFunction = SRC.indexOf(`function ${nextName}(`, start + 1);
  const asyncPrefix = SRC.lastIndexOf('async ', nextFunction);
  const end = asyncPrefix >= start && asyncPrefix + 'async '.length === nextFunction
    ? asyncPrefix
    : nextFunction;
  assert.ok(start >= 0, `${name} bulunamadı`);
  assert.ok(end > start, `${nextName} sınırı bulunamadı`);
  return SRC.slice(start, end);
}

test('v4.89 Excel Category birleşik değeri ASAS kataloğuna indirger, bilinmeyen serbest metni korur', () => {
  const block = extractFunction('kolImportCategoryCatalogMatch', 'closeKolCatalogDrop');
  const catalog = ['KEY ORME BODY K,KOL', 'DOKUMA ALT'];
  const norm = value => String(value == null ? '' : value).trim();
  const match = (_kind, value) => catalog.find(item => item.toLocaleUpperCase('tr-TR') === norm(value).toLocaleUpperCase('tr-TR')) || '';
  const fn = new Function('norm', 'kolCatalogMatch', `${block}\nreturn kolImportCategoryCatalogMatch;`)(norm, match);

  assert.equal(fn('KEY ORME BODY K,KOL - LİSANS'), 'KEY ORME BODY K,KOL');
  assert.equal(fn('DOKUMA ALT'), 'DOKUMA ALT');
  assert.equal(fn('BİLİNMEYEN - LİSANS'), 'BİLİNMEYEN - LİSANS');
});

test('v4.89 Excel import Category alanını LFL doğrulamasına bağlamaz', () => {
  const importStart = SRC.indexOf('const plan=kolBuildImportPlan(imported,touchedKeys,knownByKey);');
  const importEnd = SRC.indexOf('const approved=await showKolImportPlanModal(plan);', importStart);
  assert.ok(importStart >= 0 && importEnd > importStart);
  const block = SRC.slice(importStart, importEnd);
  assert.doesNotMatch(block, /plan\.creates\.forEach/);
  assert.doesNotMatch(block, /LFL Klasman/);
  assert.match(block, /serbest giriş alanları Excel'deki metin gibi kabul edilir/);
});

test('v4.84 Duplicate plan kaynak satırdaki Conf. FOB ve fiyat verilerini değiştirmez', () => {
  const block = extractFunction('kolBuildDuplicatePlan', 'duplicateKolSelectedRows');
  const migrate = row => row;
  const clear = row => {
    row.pricing = {};
    row.pricingSent = {};
    row.confirmedManufacturer = '';
    row.fob = '';
    return row;
  };
  const build = new Function('kolClearDuplicateCommercialHistory', 'migrateKolRow', `${block}\nreturn kolBuildDuplicatePlan;`)(clear, migrate);

  const source = {
    id: 7,
    modelKod: 'MODEL A',
    pricing: {'MFR A': '2,35'},
    pricingSent: {'MFR A': true},
    confirmedManufacturer: 'MFR A',
    fob: '2,62',
    targetPrice: '2,50',
  };
  const before = JSON.parse(JSON.stringify(source));
  const result = build([source], new Set([7]), 20);

  assert.deepEqual(source, before, 'girdi kaynak nesnesi değişmemeli');
  assert.deepEqual(result.rows[0], before, 'çıktıdaki kaynak satır eksiksiz korunmalı');
  assert.equal(result.rows[1].id, 20);
  assert.deepEqual(result.rows[1].pricing, {});
  assert.equal(result.rows[1].confirmedManufacturer, '');
  assert.equal(result.rows[1].fob, '');
});
