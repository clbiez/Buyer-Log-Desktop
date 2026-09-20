'use strict';

/* v6.54 — Koleksiyon / PLM dört düzeltme:
 * (1) PLM link yanlış model adı eşleşmesi — Special Code yoksa isim eşleşmesi kapalı.
 * (2) Koleksiyon klavye navigasyonunda görünüm kaymıyordu (preventScroll:true).
 * (3) Yeni modelde PLM ID yoksa Status = "Pending File".
 * (4) PLM excelinden Lisansör aktarılmıyordu (alias hiç yoktu, ayrıca row
 *     objesine de yazılmıyordu — iki ayrı eksiklik).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
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

const norm = v => String(v == null ? '' : v).trim();
const turknorm = v => norm(v).toLocaleUpperCase('tr-TR');
const kolPlmHeaderKey = v => turknorm(v).replace(/[^A-Z0-9]+/g, '');

/* --------------------------------------------------- 1) PLM LİNK İSİM EŞLEŞMESİ */

const plmApi = new Function('norm', `
  function normalizePlmLinkId(value){${bodyOf(APP, 'normalizePlmLinkId')}}
  function normalizePlmModelName(value){${bodyOf(APP, 'normalizePlmModelName')}}
  let plmStyleLinks=new Map(),plmStyleLinksByModel=new Map();
  function plmStyleLinkInfo(plmId){${bodyOf(APP, 'plmStyleLinkInfo')}}
  function plmModelLinkInfo(modelName,plmId="",{allowNameMatch=true}={}){${bodyOf(APP, 'plmModelLinkInfo')}}
  return {plmStyleLinks,plmStyleLinksByModel,plmModelLinkInfo};
`)(norm);

test('v6.54 Special Code boşken isim eşleşmesi PLM linki üretmiyor', () => {
  plmApi.plmStyleLinksByModel.set('UK.TSH.ATAM-1', { plmId: '999', styleId: '111', styleName: 'UK.TSH.ATAM-1' });
  const hit = plmApi.plmModelLinkInfo('UK.TSH.ATAM-1', '', { allowNameMatch: false });
  assert.equal(hit, null, 'Special Code yoksa eski modelin linki YENİ modele bağlanmamalı');
});

test('v6.54 Special Code doluyken isim eşleşmesi hâlâ çalışıyor (davranış korunuyor)', () => {
  const hit = plmApi.plmModelLinkInfo('UK.TSH.ATAM-1', '', { allowNameMatch: true });
  assert.ok(hit, 'Special Code varsa isim eşleşmesi eskisi gibi çalışmalı');
  assert.equal(hit.styleId, '111');
});

test('v6.54 gerçek PLM ID varsa isim eşleşmesi ayarından bağımsız çalışır', () => {
  plmApi.plmStyleLinks.set('999', { plmId: '999', styleId: '111' });
  const hit = plmApi.plmModelLinkInfo('TAMAMEN-BASKA-ISIM', '999', { allowNameMatch: false });
  assert.ok(hit, 'gerçek PLM ID her zaman önceliklidir');
});

test('Collection PLM context action Special Code varlığını allowNameMatch kuralına geçiriyor', () => {
  assert.match(APP, /function kolCollectionPlmUrl\(row\)/);
  assert.match(APP, /BLPlmModelLinks\?\.url\?\.\(row\?\.modelKod,row\?\.plmId,\{allowNameMatch:Boolean\(norm\(row\?\.specialCode\)\)\}\)/);
});

/* -------------------------------------------------------- 2) KLAVYE GÖRÜNÜM KAYMASI */

test('v6.54 hücreye odaklanınca görünüm de kaydırılıyor', () => {
  const body = bodyOf(APP, 'kolFocusEditorTarget');
  assert.match(body, /editor\.scrollIntoView\(\{block:'nearest',inline:'nearest'\}\)/);
});

/* --------------------------------------------------------- 3) YENİ MODEL DURUMU */

const defaultsFn = new Function('norm', 'kolNewModelDefaults', `
  function kolApplyNewModelDefaults(row){${bodyOf(APP, 'kolApplyNewModelDefaults')}} return kolApplyNewModelDefaults;
`)(norm, () => ({ mag: '', mmyg: '', buyer: '' }));

test('v6.54 PLM ID yoksa yeni model "Pending File" durumunda başlıyor', () => {
  const row = defaultsFn({ plmId: '', durum: 'Dosya Teslimi Alındı' });
  assert.equal(row.durum, 'Pending File');
});

test('v6.54 PLM ID varsa mevcut durum değişmiyor', () => {
  const row = defaultsFn({ plmId: '12345', durum: 'Dosya Teslimi Alındı' });
  assert.equal(row.durum, 'Dosya Teslimi Alındı');
});

test('v6.54 kural, PLM ID sıfır/boşluk gibi sahte değerlerde de doğru çalışıyor', () => {
  assert.equal(defaultsFn({ plmId: '   ', durum: 'Fiyatlamada' }).durum, 'Pending File');
});

/* ---------------------------------------------------------- 4) LİSANSÖR AKTARIMI */

test('v6.54 PLM Excel başlık takma adlarında Licensor tanınıyor', () => {
  const aliasesFn = new Function('norm', 'turknorm', 'kolPlmHeaderKey', `
    function kolPlmHeaderAliases(){${bodyOf(APP, 'kolPlmHeaderAliases')}} return kolPlmHeaderAliases;
  `)(norm, turknorm, kolPlmHeaderKey);
  const aliases = aliasesFn();
  assert.equal(aliases[kolPlmHeaderKey('Licensor')], 'licensor');
  assert.equal(aliases[kolPlmHeaderKey('Lisansör')], 'licensor');
});

test('v6.54 licensor "dokunulan alanlar" listesinde (satıra gerçekten yazılır)', () => {
  const body = bodyOf(APP, 'kolPlmImportTouchedKeys');
  assert.match(body, /'licensor'/);
});

test('v6.54 satır objesine licensor GERÇEKTEN yazılıyor (yalnız alias yetmez)', () => {
  // Bu en kritik test: aliaslar raw.licensor'ı doldursa bile, row constructor'da
  // elle yazılmazsa değer sessizce kaybolurdu — v6.34/v6.42'de defalarca
  // rastladığımız "veri toplandı ama satıra hiç yazılmadı" sınıfının aynısı.
  const body = bodyOf(APP, 'kolPlmParseWorkbook');
  assert.match(body, /licensor:norm\(raw\.licensor\)/);
});

test('v6.54 uçtan uca: PLM excel matrisinden Licensor değeri satıra ulaşıyor', () => {
  const aliasesFn = new Function('norm', 'turknorm', 'kolPlmHeaderKey', `
    function kolPlmHeaderAliases(){${bodyOf(APP, 'kolPlmHeaderAliases')}} return kolPlmHeaderAliases;
  `)(norm, turknorm, kolPlmHeaderKey);
  const migrateKolRow = r => { if (!r.durum) r.durum = 'Dosya Teslimi Alındı'; return r; };
  const parseFn = new Function('norm', 'kolPlmHeaderAliases', 'kolPlmHeaderKey', 'migrateKolRow', 'kolPlmSeason', 'kolPlmCodePrefix', 'kolPlmBrandToken', 'kolPlmTranslate', 'kolPlmIsLicensedDesignSource', 'window', `
    function kolPlmParseWorkbook(wb,matrix,imagesByRow){${bodyOf(APP, 'kolPlmParseWorkbook')}} return kolPlmParseWorkbook;
  `)(norm, aliasesFn, kolPlmHeaderKey, migrateKolRow,
    v => norm(v), v => norm(v).split(/\s+-\s+/, 1)[0], v => turknorm(norm(v)).split('-')[0], () => '', () => true, {});

  const matrix = [
    ['PLM Code', 'Style Name', 'Licensor', 'ERP Code'],
    ['12345', 'UK.TSH.ATAM-1', 'DTR', 'SP-1'],
  ];
  const result = parseFn({}, matrix, new Map());
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].licensor, 'DTR');
});

test('v6.54 import önizlemesinde Licensor eşlemesi gösteriliyor', () => {
  const body = bodyOf(APP, 'kolPlmMappingRows');
  assert.match(body, /\['Licensor','Licensor',has\('licensor'\)\]/);
});
