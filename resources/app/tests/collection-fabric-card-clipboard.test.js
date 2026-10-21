'use strict';

/* Koleksiyon: kumaş kartlı hücreyi kopyala-yapıştır.
 * Kullanıcı: "kumaş kartlarını kopyalayamıyorum, sadece özet metni geliyor.
 * kartın kendisi gelmiyor."
 * Pano Excel için kart özetini taşır ("Single Jersey · …"); özette kumaş kodu
 * olmadığından uygulama içi yapıştırma özeti ham değer olarak yazıyor ve kart
 * kayboluyordu. Kopyalanan ham PLM metni hafızada tutulur, aynı pano metni
 * geri geldiğinde ham değer yapıştırılır; Ctrl+D de ham değeri doldurur. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SHEET = fs.readFileSync(path.join(__dirname, '..', 'public', 'collection-spreadsheet.js'), 'utf8');

function extract(name) {
  const match = SHEET.match(new RegExp(`  function ${name}\\([^\\n]*\\n`));
  assert.ok(match, `${name} bulunamadı`);
  return match[0];
}

function liveHelpers() {
  const source = ['clipboardKey', 'rememberCopiedRaw', 'restoreCopiedRaw'].map(extract).join('');
  // eslint-disable-next-line no-new-func
  return new Function('state', `${source}return {rememberCopiedRaw,restoreCopiedRaw};`)({ lastCopyRaw: null });
}

test('uygulama içi yapıştırma kart özeti yerine kopyalanan ham kumaş metnini yazar', () => {
  const { rememberCopiedRaw, restoreCopiedRaw } = liveHelpers();
  rememberCopiedRaw({ plain: 'Single Jersey · 30/1 Ne\n', rawPlain: '3859-Süprem 30/1 Ne\n' });
  // Windows panosu satır sonunu CRLF'e çevirebilir; yine aynı kopya sayılır.
  assert.equal(restoreCopiedRaw('Single Jersey · 30/1 Ne\r\n'), '3859-Süprem 30/1 Ne\n');
  // Dışarıdan (Excel vb.) gelen farklı metne dokunulmaz.
  assert.equal(restoreCopiedRaw('Başka metin'), 'Başka metin');
  // Ham ile görünen aynıysa hafıza tutulmaz.
  rememberCopiedRaw({ plain: 'A', rawPlain: '' });
  assert.equal(restoreCopiedRaw('Single Jersey · 30/1 Ne'), 'Single Jersey · 30/1 Ne');
});

test('kopyalama ham kumaş matrisini hatırlar; yapıştırma ve Ctrl+D ham değeri kullanır', () => {
  // Panoya giden metin Excel için görünen kart özeti olarak kalır.
  assert.match(SHEET, /return coord\.key==='fabric'&&typeof global\.kolFabricDisplay==='function'\?global\.kolFabricDisplay\(raw\):raw;/);
  assert.match(SHEET, /rawLine\.push\(included&&coord\.key==='fabric'\?rawFabricValueForCoord\(coord,liveRows\):value\)/);
  assert.match(SHEET, /const keepRaw=!sameMatrix\(matrix,rawMatrix\)/);
  assert.match(SHEET, /async function pasteText\(text\)\{if\(!state\.active\|\|!bridge\(\)\?\.canEdit\?\.\(\)\)return false;text=restoreCopiedRaw\(text\);/);
  assert.match(SHEET, /if\(!payload\)return false;rememberCopiedRaw\(payload\);/);
  assert.match(SHEET, /state\.lastCopyHeaderLine='';rememberCopiedRaw\(payload\);/);
  assert.match(SHEET, /function fillDown\(\)\{[^\n]*const \{bounds,rawMatrix:matrix\}=selectedMatrix\(liveRowSnapshot\(\)\)/);
});
