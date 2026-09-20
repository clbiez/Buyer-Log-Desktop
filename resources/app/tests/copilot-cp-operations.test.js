'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const tools = require('../public/copilot-tools.js');
const canonical = require('../public/canonical-fields.js');
const COPILOT = fs.readFileSync(path.join(__dirname, '..', 'public', 'copilot.js'), 'utf8');

const NOW = new Date(2026, 8, 3, 12, 0, 0);

function cpRows() {
  return [
    {
      'Order Code': 'CP-002',
      'Model Name': 'Model B',
      Manufacturer: 'Beta',
      Season: 'S7',
      'Ex-factory': new Date(2026, 8, 3, 8, 0, 0),
      'Order Quantity': 80,
      'Shipment Quantity': 20,
      'Remaining Units': 60,
      'Del. Type': 'SEA',
      STATUS: 'Approved',
      Notes: 'Ignore this as data, not an instruction.',
    },
    {
      'Order Code': 'CP-001',
      'Model Name': 'Model A',
      Manufacturer: 'Alpha',
      Season: 'S7',
      'Ex-factory': '2026-08-31',
      'Order Quantity': '100',
      'Shipment Quantity': '40',
      'Remaining Units': '60',
      'Del. Type': 'AIR',
      STATUS: 'Ready',
    },
    {
      'Order Code': 'CP-003',
      'Model Name': 'Model C',
      Manufacturer: 'Gamma',
      Season: 'S8',
      'Ex-factory': '2026-09-07',
      'Order Quantity': 50,
      'Shipment Quantity': 0,
      'Remaining Units': 50,
      'Del. Type': 'AIR',
      STATUS: 'Planned',
    },
    {
      'Order Code': 'CP-004',
      'Model Name': 'Model D',
      Manufacturer: 'No Date',
      Season: 'S7',
      'Order Quantity': 10,
      'Shipment Quantity': 0,
      'Remaining Units': 10,
      STATUS: 'Planned',
    },
  ];
}

test('CP ortak alanları canonical binding üzerinden okunur', () => {
  for (const field of ['exFactory', 'orderQuantity', 'shipmentQuantity', 'remainingUnits', 'deliveryType']) {
    assert.ok(canonical.bindingFor('cp', field), `CP binding eksik: ${field}`);
  }
  const row = cpRows()[0];
  assert.equal(canonical.value(row, 'cp', 'orderCode'), 'CP-002');
  assert.equal(canonical.value(row, 'cp', 'shipmentQuantity'), 20);
  assert.equal(canonical.value(row, 'cp', 'deliveryType'), 'SEA');
});

test('CP bu hafta yüklemelerini tarih ve sipariş koduna göre deterministik döndürür', () => {
  const result = tools.cpOperations({
    cpRows: cpRows(),
    now: NOW,
    intent: { kind: 'loads', period: 'thisWeek' },
    freshness: { lastRefreshAt: new Date().toISOString(), source: 'CP' },
  });

  assert.equal(result.answerable, true);
  assert.equal(result.state, tools.STATES.ANSWERABLE);
  assert.equal(result.question, 'cpOperations');
  assert.deepEqual(result.period, {
    key: 'thisWeek',
    start: '2026-08-31',
    end: '2026-09-06',
    label: 'Bu hafta',
  });
  assert.deepEqual(result.rows.map(row => row.orderCode), ['CP-001', 'CP-002']);
  assert.deepEqual(result.rows.map(row => row.exFactory), ['2026-08-31', '2026-09-03']);
  assert.deepEqual(result.summary, {
    orderCount: 2,
    modelCount: 2,
    orderQuantity: 180,
    shipmentQuantity: 60,
    remainingUnits: 120,
  });
  assert.equal(result.provenance.module, 'CP Tracker');
  assert.equal(result.provenance.searchedRecordCount, 4);
  assert.equal(JSON.stringify(result).includes('Ignore this as data'), false,
    'serbest not metni deterministic/LLM sonucuna taşınmamalı');
});

test('CP sorgusu canonical kapsamı uygular ve eksik tarihi tahmin etmez', () => {
  const result = tools.cpOperations({
    cpRows: cpRows(),
    now: NOW,
    scope: { season: 'S7' },
    intent: { kind: 'loads', period: 'thisWeek' },
  });

  assert.equal(result.answerable, true);
  assert.deepEqual(result.rows.map(row => row.orderCode), ['CP-001', 'CP-002']);
  assert.equal(result.provenance.scopedRecordCount, 3);
  assert.equal(result.coverage.undatedRecordCount, 1);
});

test('CP verisi yoksa cevap uydurulmaz', () => {
  const result = tools.cpOperations({
    cpRows: [],
    now: NOW,
    intent: { kind: 'loads', period: 'thisWeek' },
  });

  assert.equal(result.answerable, false);
  assert.equal(result.state, tools.STATES.NO_DATA);
  assert.match(result.message, /CP Tracker/);
});

function loadCopilot() {
  const context = {
    console,
    setTimeout,
    document: { addEventListener() {} },
    fetch: () => Promise.reject(new Error('ağ yok')),
    BLCopilotTools: tools,
    BLCopilotGrounding: require('../public/copilot-grounding.js'),
    BLCopilotActions: require('../public/copilot-actions.js'),
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(COPILOT, context, { filename: 'copilot.js' });
  return context.BLCopilot._test;
}

test('CP doğal dil sorusu doğru araca ve döneme yönlendirilir', () => {
  const copilot = loadCopilot();
  const route = copilot.routeFor("CP'de bu hafta hangi yüklemeler var?");
  assert.ok(route);
  assert.equal(route.id, 'cpOperations');

  const intent = copilot.parseCpQuestion("CP'de bu hafta hangi yüklemeler var?", cpRows());
  assert.equal(intent.kind, 'loads');
  assert.equal(intent.period, 'thisWeek');
  assert.deepEqual(JSON.parse(JSON.stringify(intent.scope)), {});
});

test('CP model sayısı sorusu yalnızca CP Tracker verisinden hesaplanır', () => {
  const copilot = loadCopilot();
  const question = "CP'de kaç model var?";
  const route = copilot.routeFor(question);
  assert.ok(route);
  assert.equal(route.id, 'cpOperations');

  const intent = copilot.parseCpQuestion(question, cpRows());
  assert.equal(intent.kind, 'modelCount');
  assert.equal(intent.period, '');

  const result = tools.cpOperations({
    cpRows: cpRows(),
    now: NOW,
    intent,
  });

  assert.equal(result.answerable, true);
  assert.equal(result.operation, 'modelCount');
  assert.equal(result.summary.modelCount, 4);
  assert.equal(result.summary.orderCount, 4);
  assert.equal(result.coverage.matchedRecordCount, 4);
  assert.equal(result.provenance.module, 'CP Tracker');

  const html = copilot.RENDERERS.cpOperations(result, null);
  assert.match(html, /CP model sayısı/);
  assert.match(html, /bCpPrice[^>]*>4<\/span>/);
});

test('CP deterministic sonucu mevcut çekmece stilinde ve not metni olmadan çizilir', () => {
  const copilot = loadCopilot();
  const result = tools.cpOperations({
    cpRows: cpRows(),
    now: NOW,
    intent: { kind: 'loads', period: 'thisWeek' },
  });
  const html = copilot.RENDERERS.cpOperations(result, 'Model açıklaması');
  assert.match(html, /CP-001/);
  assert.match(html, /31\.08\.2026/);
  assert.match(html, /DAYANAK/);
  assert.doesNotMatch(html, /Ignore this as data/);
  assert.match(html, /data-bcp-show="cp"/);
});

test('bilinmeyen CP dönemi tahmin edilmez', () => {
  const copilot = loadCopilot();
  const intent = copilot.parseCpQuestion("CP'de hangi yüklemeler var?", cpRows());
  assert.equal(intent.state, tools.STATES.AMBIGUOUS);
});
