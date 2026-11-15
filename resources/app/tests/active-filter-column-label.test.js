'use strict';

/* Aktif filtre çipi sütun adı, tablo başlığıyla aynı çözümleyiciyi kullanmalı.
   Regresyon: checklist sütunu çipte "__checklist__rule_x: Onaylandı" görünüyordu
   çünkü etiket var olmayan `column.l` alanından okunuyor, ham anahtara düşüyordu. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

function extractFunction(name) {
  const start = APP.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} bulunamadı`);
  let depth = 0;
  for (let i = APP.indexOf('{', start); i < APP.length; i += 1) {
    if (APP[i] === '{') depth += 1;
    else if (APP[i] === '}' && --depth === 0) return APP.slice(start, i + 1);
  }
  throw new Error(`${name} kapanmadı`);
}

function makeContext(lang, renames = {}) {
  const ctx = {
    appLang: lang,
    L: value => `L(${value})`,
    CP_EN_HEADER_LABELS: { cpSystem: 'System EN' },
    CP_TR_HEADER_LABELS: { cpSystem: 'Sistem TR' },
    COLS_BY_TABLE: {
      cp: [
        { k: 'cpSystem', label: 'System' },
        { k: '__checklist__rule_wjwad3bg', label: 'PPS Portal', checklistSupplierColumn: true },
        { k: '__formula__f1', label: 'f', formulaCustom: true, formulaDef: { labelTr: 'Formül TR', labelEn: 'Formula EN' } },
      ],
    },
    kolColDefs: () => [{ k: 'kolField', label: 'Kol Field' }],
    kolFilterMeta: key => (key === 'synthetic' ? { k: key, label: 'Synthetic' } : null),
    BLColumnNames: null,
  };
  ctx.window = ctx;
  ctx.BLColumnNames = {
    resolve: (table, key, language, fallback) => renames[`${table}:${key}`] || fallback,
    definitionLabel: (def, language) => (language === 'en' ? def.labelEn : def.labelTr),
  };
  vm.createContext(ctx);
  vm.runInContext([
    'tableColumnDefaultLabel', 'tableColumnLabel', 'kolColumnDefaultLabel', 'kolColumnLabel', 'activeFilterColumnLabel',
  ].map(extractFunction).join('\n'), ctx);
  return ctx;
}

test('checklist sütun çipi başlıktaki adı gösterir, ham __checklist__ anahtarını göstermez', () => {
  const ctx = makeContext('tr');
  const key = '__checklist__rule_wjwad3bg';
  const column = ctx.COLS_BY_TABLE.cp.find(c => c.k === key);
  const chip = ctx.activeFilterColumnLabel('cp', key);
  assert.equal(chip, ctx.tableColumnLabel('cp', column));
  assert.doesNotMatch(chip, /__checklist__/);
});

test('çip etiketi sistem, formül ve kişisel adlarda başlık çözümleyicisiyle aynıdır', () => {
  for (const lang of ['tr', 'en']) {
    const ctx = makeContext(lang, { 'cp:cpSystem': 'Benim Adım', 'koleksiyon:kolField': 'Kol Kişisel' });
    for (const column of ctx.COLS_BY_TABLE.cp) {
      assert.equal(ctx.activeFilterColumnLabel('cp', column.k), ctx.tableColumnLabel('cp', column), `${lang}:${column.k}`);
    }
    assert.equal(ctx.activeFilterColumnLabel('koleksiyon', 'kolField'), 'Kol Kişisel');
    assert.equal(ctx.activeFilterColumnLabel('koleksiyon', 'synthetic'), 'L(Synthetic)');
  }
  assert.equal(makeContext('en').activeFilterColumnLabel('cp', '__formula__f1'), 'Formula EN');
});
