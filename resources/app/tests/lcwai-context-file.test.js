'use strict';
/* Bağlam tabloları kesilmez: tüm satırlar/sütunlar CSV eki olarak gider,
   mesajda yalnız özet kalır (eskiden 200 satır / 25 sütun / 20 bin karakter). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'public', 'lcwai-chat.js'), 'utf8');

function load() {
  const window = { appLang: 'tr', addEventListener() {} };
  vm.runInContext(SOURCE, vm.createContext({ window, document: { documentElement: { lang: 'tr' } }, File, console }));
  return window.BLLcwAiChat;
}

test('tüm satırlar ve sütunlar CSV dosyasına gider; özel karakterler doğru kaçışlanır', async () => {
  const chat = load();
  const columns = Array.from({ length: 40 }, (_, i) => `Kolon ${i}`);
  const rows = Array.from({ length: 1000 }, (_, r) => columns.map((_, c) => (r === 0 && c === 0 ? 'a,"b"\nc' : `${r}-${c}`)));
  const { file, context } = chat.contextAsFile({ label: 'Overview — CP kümesi', screen: 'overview', summary: '1000 satır', columns, rows, totalRows: 1000 });
  assert.equal(file.name, 'BuyerLog-Overview-CP-kumesi.csv');
  assert.equal(file.type, 'text/csv');
  const text = await file.text();
  const lines = text.replace(/^﻿/, '').trimEnd().split('\r\n');
  assert.equal(lines[0].split(',').length, 40, 'tüm sütunlar');
  assert.ok(text.includes('"a,""b""\nc"'), 'RFC 4180 kaçışlama');
  assert.ok(text.includes('999-39'), 'son satır ve son sütun dahil');
  assert.equal(context.rows, undefined, 'mesaja satır gitmez');
  assert.equal(context.columns, undefined);
  assert.match(context.text, /“BuyerLog-Overview-CP-kumesi\.csv” dosyasında: 1000 satır, 40 sütun/);
  assert.equal(context.summary, '1000 satır');
});

test('tablosuz bağlam (yalnız filtreler) dosyaya çevrilmez; kesme sınırları kaldırıldı', () => {
  const chat = load();
  const result = chat.contextAsFile({ label: 'Filtreler', filters: { Sezon: '26S' }, columns: [], rows: [] });
  assert.equal(result.file, null);
  assert.equal(chat.contextAsFile({ label: 'Backlog — kayıtlar', columns: ['a'], rows: [[1]] }).file.name, 'BuyerLog-Backlog-kayitlar.csv', 'Türkçe ı dosya adında korunur');
  assert.doesNotMatch(SOURCE, /MAX_TABLE_ROWS|MAX_TABLE_COLUMNS|slice\(0, 200\)/);
  assert.match(SOURCE, /userMessage\.attachments\.push\(await api\.uploadFile\(prepared\.file\)\)/, 'mevcut LCW AI upload yolu');
});
