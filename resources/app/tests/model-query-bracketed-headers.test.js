'use strict';

/* IAS fact-row sorgusu (SELECTCOLUMNS) headerMap kullanmaz; ADODB sütun adlarını
   "[Sipariş Kod]" biçiminde döndürür. CSV ilk karakteri "[" olduğu için eskiden
   JSON sanılıp ayrıştırma sessizce boş satır listesine düşüyordu: PowerShell
   8/250 satır yazdığı hâlde IAS'tan hiç veri gelmiyordu. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const modelQuery = require('../server/lib/modelQuery');

function csvRunner(content, rowCount) {
  return async (args) => {
    const outFile = args[args.indexOf('-OutFile') + 1];
    fs.writeFileSync(outFile, '﻿' + content, 'utf8');
    return { stdout: JSON.stringify({ ok: true, provider: 'ADODB', rowCount, outFile }) + '\n', stderr: '' };
  };
}

test('bracketed SELECTCOLUMNS headers are parsed as CSV, not JSON', async () => {
  const csv = '[Sipariş Kod];[Renk Kod];[Yükleme Toplam Adet]\r\n1354499;R9J;14848\r\n1381850;LS3;\r\n';
  const result = await modelQuery.runModelRows(
    { server: 'srv', catalog: 'IASv2', query: 'EVALUATE x', generated: true },
    { runner: csvRunner(csv, 2) });
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows[0], { 'Sipariş Kod': '1354499', 'Renk Kod': 'R9J', 'Yükleme Toplam Adet': '14848' });
  assert.equal(result.rows[1]['Yükleme Toplam Adet'], '');
});

test('Table[Column] headers and legacy JSON results keep working', async () => {
  const csv = "Siparis Bilgileri[Sipariş Kod];[__BLRowGuard]\r\n1;1\r\n";
  const csvResult = await modelQuery.runModelRows(
    { server: 'srv', catalog: 'ASAS', query: 'EVALUATE x', generated: true },
    { runner: csvRunner(csv, 1) });
  assert.deepEqual(csvResult.rows, [{ 'Siparis Bilgileri[Sipariş Kod]': '1', __BLRowGuard: '1' }]);

  const jsonResult = await modelQuery.runModelRows(
    { server: 'srv', catalog: 'ASAS', query: 'EVALUATE x', generated: true },
    { runner: csvRunner('[{"A":"1"}]', 1) });
  assert.deepEqual(jsonResult.rows, [{ A: '1' }]);
});

test('an unreadable result with reported rows fails loudly instead of returning no data', async () => {
  const runner = async (args) => ({
    stdout: JSON.stringify({ ok: true, provider: 'ADODB', rowCount: 8, outFile: args[args.indexOf('-OutFile') + 1] + '.missing' }) + '\n',
    stderr: '',
  });
  await assert.rejects(
    modelQuery.runModelRows({ server: 'srv', catalog: 'IASv2', query: 'EVALUATE x', generated: true }, { runner }),
    error => error.code === 'MODEL_QUERY_PARSE_FAILED');
});
