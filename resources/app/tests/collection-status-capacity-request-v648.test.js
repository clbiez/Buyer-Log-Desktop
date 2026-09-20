'use strict';

/* v6.48 — Koleksiyon Durum listesine "Capacity Request" eklendi.
 * v6.42'deki "Dummy PO Placed" eklemesiyle aynı üç yer kapsanmalı: seçenek
 * listesi, İngilizce karşılığı, Excel renk paleti — sonuncusunu atlamak yeni
 * değeri Excel'de renksiz bırakırdı (v6.42 dersi).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');

test('v6.48 "Capacity Request" durum listesinde ve İngilizce karşılığı var', () => {
  const decl = APP.slice(APP.indexOf('const KOL_DURUM_OPTS ='), APP.indexOf('const KOL_DURUM_OPTS =') + 400);
  const opts = new Function(`${decl.slice(0, decl.indexOf(';') + 1)} return KOL_DURUM_OPTS;`)();
  assert.ok(opts.includes('Capacity Request'));
  // Fiyatlamada ile Siparişe Hazır arasında, kapasite talebinin sipariş öncesi
  // bir aşama olduğu iş akışını yansıtır.
  assert.ok(opts.indexOf('Fiyatlamada') < opts.indexOf('Capacity Request'));
  assert.ok(opts.indexOf('Capacity Request') < opts.indexOf('Siparişe Hazır'));
  assert.match(APP, /'Capacity Request':'Capacity Request',/);
});

test('v6.48 yeni durum Excel renk paletinde de tanımlı', () => {
  const line = APP.match(/const pal = \{[^}]*\}\[raw\];/);
  assert.ok(line);
  assert.match(line[0], /'Capacity Request':/);
  const pal = new Function(`${line[0].replace('[raw]', '')} return pal;`)();
  assert.equal(typeof pal['Capacity Request'], 'string');
  assert.match(pal['Capacity Request'], /^FF[0-9A-F]{6}$/);
});

test('v6.48 önceki durum eklemesi (Dummy PO Placed) hâlâ listede', () => {
  // Bu ekleme öncekini silmemeli / sıralamayı bozmamalı.
  const decl = APP.slice(APP.indexOf('const KOL_DURUM_OPTS ='), APP.indexOf('const KOL_DURUM_OPTS =') + 400);
  const opts = new Function(`${decl.slice(0, decl.indexOf(';') + 1)} return KOL_DURUM_OPTS;`)();
  assert.ok(opts.includes('Dummy PO Placed'));
  assert.ok(opts.includes('İptal'), 'İptal listenin sonunda kalmalı');
});
