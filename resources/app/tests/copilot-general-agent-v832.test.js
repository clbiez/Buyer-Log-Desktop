'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createToolRegistry, filterRows } = require('../server/lib/agent-tool-registry');
const { createPolicyEngine } = require('../server/lib/agent-policy-engine');
const { createCopilotAssistant } = require('../server/lib/copilot-agent');

function registry(rowsBySource = {}) {
  return createToolRegistry({
    listDatasets: async (_ownerId, profile) => [
      { id: 'orders', area: 'orders', allowed: profile.allowedAreas.includes('orders') },
      { id: 'backlog', area: 'backlog', allowed: profile.allowedAreas.includes('backlog') },
    ],
    getDataset: async (_ownerId, profile, source) => {
      if (!profile.allowedAreas.includes(source)) {
        throw Object.assign(new Error('forbidden'), { code: 'AREA_FORBIDDEN', statusCode: 403 });
      }
      return rowsBySource[source] || [];
    },
    getDataContext: async (_ownerId, _profile, source) => ({ source, refreshedAt: '2026-09-03T09:42:00.000Z' }),
    refresh: async () => ({ ok: true }),
    snapshotOrder: async () => ({}),
    updateOrder: async () => ({ updated: 1 }),
    restoreOrder: async () => ({ restored: true }),
    httpRequest: async () => ({ ok: true }),
    browserRun: async () => ({ ok: true }),
  });
}

function policy() {
  return createPolicyEngine({
    userAccess: { hasArea: (profile, area) => !area || profile.allowedAreas.includes(area) },
  });
}

/* Eski JSON zarfı ({type:'tool_calls',calls}/{type:'answer',answer}) yerine
   native {content,toolCalls} şekli üretilir (bkz. copilot-agent.js
   toolIdFor — dot içeren araç kimliği '__' ile fonksiyon adına çevrilir). */
function toNativeName(id) { return String(id).replace(/\./g, '__'); }
function toNativeTurn(next, index) {
  if (typeof next === 'string') return { content: next, toolCalls: [] };
  if (next && next.type === 'tool_calls') {
    return {
      content: '',
      toolCalls: next.calls.map((call, i) => ({ id: `call_${index}_${i}`, name: toNativeName(call.id), args: call.args })),
    };
  }
  return { content: next && next.answer, toolCalls: [] };
}
function sequencedProvider(outputs, observed = []) {
  let index = 0;
  return {
    chat: async messages => {
      observed.push(messages);
      const next = outputs[index];
      if (next == null) throw new Error('Unexpected model call');
      const turn = toNativeTurn(next, index);
      index += 1;
      return { ...turn, model: 'gemma4:12b' };
    },
  };
}

const profile = { id: 'buyer-1', role: 'buyer', allowedAreas: ['orders'] };
const root = path.join(__dirname, '..');

test('v8.32 general questions are answered directly without forcing a Buyer Log tool', async () => {
  let providerCalls = 0;
  const assistant = createCopilotAssistant({ providerFactory: () => ({
    chat: async () => {
      providerCalls += 1;
      return { content: "Türkiye'nin başkenti Ankara'dır.", toolCalls: [] };
    },
  }) });

  const result = await assistant.respond({
    question: "Türkiye'nin başkenti?",
    ownerId: profile.id,
    profile,
    toolRegistry: registry({ orders: [] }),
    policyEngine: policy(),
  });

  assert.equal(result.answer, "Türkiye'nin başkenti Ankara'dır.");
  assert.equal(result.mode, 'general');
  assert.equal(result.toolCalls.length, 0);
  assert.equal(providerCalls, 1);
});

test('v8.32 calculator and timezone tools produce deterministic current-system results', async () => {
  const tools = registry({ orders: [] });
  const calculation = await tools.execute('system.calculate', { expression: '(5.37-4.82)/4.82*100' }, {});
  assert.ok(Math.abs(calculation.value - 11.4107883817) < 1e-9);

  const time = await tools.execute('system.datetime', { place: 'Bangladesh' }, { now: new Date('2026-09-03T10:00:00.000Z') });
  assert.equal(time.timeZone, 'Asia/Dhaka');
  assert.match(time.localDateTime, /16:00/);
});

test('v8.32 schema inspection resolves common business fields through canonical IDs', async () => {
  const tools = registry({ orders: [{ Country: 'TR', Manufacturer: 'ABC', 'Buyer Group': 'Kids', 'Order Quantity': 10 }] });
  const result = await tools.execute('dataset.describe', { source: 'orders' }, { ownerId: profile.id, profile });
  const byCanonical = new Map(result.fields.filter(item => item.canonicalId).map(item => [item.canonicalId, item]));

  assert.equal(byCanonical.get('country').sourceKey, 'Country');
  assert.equal(byCanonical.get('manufacturer').sourceKey, 'Manufacturer');
  assert.equal(byCanonical.get('buyingGroup').sourceKey, 'Buyer Group');
  assert.equal(byCanonical.get('orderQuantity').sourceKey, 'Order Quantity');
});

test('v8.32 generic analysis groups by multiple dimensions and aggregates before returning data to Gemma', async () => {
  const tools = registry({ orders: [
    { Country: 'TR', Manufacturer: 'ABC', 'Buyer Group': 'Kids', Season: 'S7', 'Order Quantity': 10 },
    { Country: 'TR', Manufacturer: 'ABC', 'Buyer Group': 'Kids', Season: 'S8', 'Order Quantity': 20 },
    { Country: 'BD', Manufacturer: 'XYZ', 'Buyer Group': 'Men', Season: 'S8', 'Order Quantity': 40 },
  ] });

  const result = await tools.execute('dataset.analyze', {
    source: 'orders',
    dimensions: ['country', 'manufacturer', 'buyingGroup'],
    measures: [{ op: 'sum', field: 'orderQuantity', as: 'orderQty' }, { op: 'count', as: 'orderCount' }],
    orderBy: [{ field: 'orderQty', direction: 'desc' }],
  }, { ownerId: profile.id, profile, horizon: { seasons: ['S7'], outsideHorizon: 'allow' } });

  assert.deepEqual(result.rows[0], { country: 'BD', manufacturer: 'XYZ', buyingGroup: 'Men', orderQty: 40, orderCount: 1, orderQtySharePercent: 40 / 70 * 100 });
  assert.equal(result.matchedRows, 3);
  assert.equal(result.rawRowsReturned, 0);
  assert.equal(result.scope.outsideHorizon, true);
  assert.deepEqual(result.scope.outsideSeasons, ['S8']);
});

test('v8.32 analytical averages ignore non-numeric source values instead of treating them as zero', async () => {
  const tools = registry({ orders: [
    { Manufacturer: 'ABC', FOB: 4.82 },
    { Manufacturer: 'ABC', FOB: 'bekleniyor' },
  ] });

  const result = await tools.execute('dataset.analyze', {
    source: 'orders', dimensions: ['manufacturer'], measures: [{ op: 'avg', field: 'fob', as: 'averageFob' }],
  }, { ownerId: profile.id, profile });

  assert.equal(result.rows[0].averageFob, 4.82);
});

test('v8.32 structured filters resolve canonical fields and local calendar dates', async () => {
  const tools = registry({ orders: [{ Season: 'S7', Manufacturer: 'ABC' }] });
  const result = await tools.execute('dataset.query', {
    source: 'orders', filters: [{ field: 'season', operator: 'eq', value: 'S7' }], fields: ['manufacturer'], limit: 10,
  }, { ownerId: profile.id, profile, now: new Date('2026-09-03T23:30:00-04:00') });

  assert.equal(result.matched, 1);
  assert.deepEqual(result.rows, [{ manufacturer: 'ABC' }]);
  assert.equal(filterRows([{ shipped: new Date(2026, 8, 3) }], [{ field: 'shipped', operator: 'eq', value: '2026-09-03' }]).length, 1);
});

test('v8.32 Gemma can inspect schema, run another tool, and ground a business recommendation', async () => {
  const observed = [];
  const provider = sequencedProvider([
    { type: 'tool_calls', calls: [{ id: 'dataset.describe', args: { source: 'orders' } }] },
    { type: 'tool_calls', calls: [{ id: 'dataset.analyze', args: {
      dimensions: ['manufacturer'],
      measures: [{ op: 'avg', field: 'fob', as: 'averageFob' }],
      orderBy: [{ field: 'averageFob', direction: 'asc' }],
    } }] },
    { type: 'answer', mode: 'business', answer: "Mevcut verilere göre ABC'yi tercih ederdim; ortalama FOB 4,82 USD ile daha avantajlı." },
  ], observed);
  const assistant = createCopilotAssistant({ providerFactory: () => provider });

  const result = await assistant.respond({
    question: "ABC üreticisini tercih eder miydin?",
    ownerId: profile.id,
    profile,
    toolRegistry: registry({ orders: [{ Manufacturer: 'ABC', FOB: 4.82, Currency: 'USD' }] }),
    policyEngine: policy(),
    horizon: { seasons: ['S7'], outsideHorizon: 'allow' },
  });

  assert.equal(result.mode, 'business');
  assert.equal(result.businessGrounded, true);
  assert.deepEqual(result.toolCalls.map(item => item.id), ['dataset.describe', 'dataset.analyze']);
  assert.equal(result.toolCalls[1].args.source, 'orders', 'follow-up data tools inherit the already inspected dataset');
  assert.equal(observed.length, 3);
  assert.ok(result.evidence.some(item => item.source === 'orders'));
});

test('v8.32 exact Buyer Log facts cannot be answered without a business-data tool call', async () => {
  const assistant = createCopilotAssistant({ providerFactory: () => sequencedProvider([
    { type: 'answer', mode: 'business', answer: 'ABC en ucuz üreticidir.' },
  ]) });

  await assert.rejects(() => assistant.respond({
    question: 'S7 T-Shirt en ucuz hangi üreticide?',
    ownerId: profile.id,
    profile,
    toolRegistry: registry({ orders: [] }),
    policyEngine: policy(),
  }), error => error && error.code === 'COPILOT_GROUNDING_REQUIRED');
});

test('v8.32 fabricated business numbers are rejected after tool execution', async () => {
  const assistant = createCopilotAssistant({ providerFactory: () => sequencedProvider([
    { type: 'tool_calls', calls: [{ id: 'dataset.analyze', args: {
      source: 'orders', dimensions: ['manufacturer'], measures: [{ op: 'avg', field: 'fob', as: 'averageFob' }],
    } }] },
    { type: 'answer', mode: 'business', answer: 'ABC ortalama fiyatı 999 USD.' },
    { type: 'answer', mode: 'business', answer: 'ABC ortalama fiyatı yine 999 USD.' },
    { type: 'answer', mode: 'business', answer: 'ABC ortalama fiyatı hâlâ 999 USD.' },
  ]) });

  await assert.rejects(() => assistant.respond({
    question: 'ABC fiyatı nedir?',
    ownerId: profile.id,
    profile,
    toolRegistry: registry({ orders: [{ Manufacturer: 'ABC', FOB: 4.82, Currency: 'USD' }] }),
    policyEngine: policy(),
  }), error => error && error.code === 'COPILOT_GROUNDING_FAILED');
});

test('v8.32 an ungrounded draft gets one constrained repair chance', async () => {
  const assistant = createCopilotAssistant({ providerFactory: () => sequencedProvider([
    { type: 'tool_calls', calls: [{ id: 'dataset.analyze', args: {
      source: 'orders', dimensions: ['manufacturer'], measures: [{ op: 'avg', field: 'fob', as: 'averageFob' }],
    } }] },
    { type: 'answer', mode: 'business', answer: 'ABC ortalama fiyatı 999 USD.' },
    { type: 'answer', mode: 'business', answer: 'ABC ortalama fiyatı 4,82 USD.' },
  ]) });

  const result = await assistant.respond({
    question: 'ABC fiyatı nedir?', ownerId: profile.id, profile,
    toolRegistry: registry({ orders: [{ Manufacturer: 'ABC', FOB: 4.82, Currency: 'USD' }] }),
    policyEngine: policy(),
  });
  assert.equal(result.answer, 'ABC ortalama fiyatı 4,82 USD.');
  assert.equal(result.businessGrounded, true);
});

test('v8.32 accepts a plain-text final response when Gemma ignores the JSON answer envelope', async () => {
  const assistant = createCopilotAssistant({ providerFactory: () => ({
    config: { provider: 'ollama' },
    chat: async () => ({ content: 'Merhaba! Bugün nasıl yardımcı olabilirim?', model: 'gemma4:26b' }),
  }) });

  const result = await assistant.respond({
    question: 'Merhaba', ownerId: profile.id, profile,
    toolRegistry: registry({ orders: [] }), policyEngine: policy(),
  });

  assert.equal(result.mode, 'general');
  assert.equal(result.answer, 'Merhaba! Bugün nasıl yardımcı olabilirim?');
});

test('v8.32 accepts and validates a grounded plain-text final report after tool calls', async () => {
  const responses = [
    { content: '', toolCalls: [{ id: 'call_1', name: 'dataset__analyze', args: {
      source: 'orders', dimensions: ['manufacturer'], measures: [{ op: 'avg', field: 'fob', as: 'averageFob' }],
    } }] },
    { content: 'ABC ortalama fiyatı 4,82 USD.', toolCalls: [] },
  ];
  const assistant = createCopilotAssistant({ providerFactory: () => ({
    config: { provider: 'ollama' },
    chat: async () => ({ ...responses.shift(), model: 'gemma4:26b' }),
  }) });

  const result = await assistant.respond({
    question: 'ABC fiyatı nedir?', ownerId: profile.id, profile,
    toolRegistry: registry({ orders: [{ Manufacturer: 'ABC', FOB: 4.82, Currency: 'USD' }] }),
    policyEngine: policy(),
  });

  assert.equal(result.mode, 'business');
  assert.equal(result.answer, 'ABC ortalama fiyatı 4,82 USD.');
  assert.equal(result.businessGrounded, true);
});

test('v8.32 conversational context is retained but untrusted history is bounded', async () => {
  const observed = [];
  const assistant = createCopilotAssistant({ providerFactory: () => sequencedProvider([
    { type: 'answer', mode: 'general', answer: 'Termin tarafını da değerlendirebilirim.' },
  ], observed) });
  const history = Array.from({ length: 30 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: `${index}: ${'x'.repeat(6000)}`,
  }));

  await assistant.respond({
    question: 'Peki termin?', history,
    ownerId: profile.id, profile,
    toolRegistry: registry({ orders: [] }), policyEngine: policy(),
  });

  const sent = observed[0];
  assert.ok(sent.some(item => item.role === 'user' && item.content === 'Peki termin?'));
  assert.ok(sent.length <= 14, 'system + at most 12 history messages + current question');
  assert.ok(sent.every(item => item.content.length <= 4000 || item.role === 'system'));
});

test('v8.32 read-only Copilot rejects mutation and external connector tools', async () => {
  const assistant = createCopilotAssistant({ providerFactory: () => sequencedProvider([
    { type: 'tool_calls', calls: [{ id: 'app.order.update', args: { orderCode: 1, notes: { Notes: 'x' } } }] },
  ]) });

  await assert.rejects(() => assistant.respond({
    question: 'Siparişi değiştir', ownerId: profile.id, profile,
    toolRegistry: registry({ orders: [] }), policyEngine: policy(),
  }), error => error && error.code === 'COPILOT_TOOL_BLOCKED');
});

test('v8.32 tool loop has an explicit resource guard', async () => {
  let callIndex = 0;
  const assistant = createCopilotAssistant({
    providerFactory: () => ({
      chat: async () => ({
        content: '',
        toolCalls: [{ id: `call_${callIndex++}`, name: 'system__calculate', args: { expression: '1+1' } }],
      }),
    }),
    maxToolRounds: 2,
  });

  await assert.rejects(() => assistant.respond({
    question: 'Devam et', ownerId: profile.id, profile,
    toolRegistry: registry({ orders: [] }), policyEngine: policy(),
  }), error => error && error.code === 'COPILOT_TOOL_LIMIT');
});

test('v8.32 local Gemma inference gets a bounded cold-start allowance without blocking startup', () => {
  const source = fs.readFileSync(path.join(root, 'server', 'lib', 'copilot-agent.js'), 'utf8');
  assert.match(source, /timeoutMs:\s*120000/);
  assert.doesNotMatch(source, /listModels\(\)|showModel\(\)/, 'module import must not eagerly probe or load the model');
});

test('v8.32 server exposes a permission-aware general Copilot endpoint backed by the shared agent tools', () => {
  const server = require('./helpers/server-source')();
  assert.match(server, /require\('\.\/lib\/copilot-agent'\)/);
  assert.match(server, /app\.post\('\/api\/copilot\/ask'/);
  assert.match(server, /copilotAgent\.respond\(\{/);
  assert.match(server, /toolRegistry:agentToolRegistry/);
  assert.match(server, /policyEngine:agentPolicyEngine/);
  assert.match(server, /listDatasets:/);
  assert.match(server, /getDataContext:/);
});

test('v8.32 Copilot UI uses Gemma general-agent flow while retaining deterministic mutation confirmation', () => {
  const source = fs.readFileSync(path.join(root, 'public', 'copilot.js'), 'utf8');
  assert.match(source, /fetch\('\/api\/copilot\/ask'/);
  assert.match(source, /conversationHistory/);
  assert.match(source, /renderAssistantResponse/);
  assert.match(source, /parseWriteIntent\(question\)/, 'write intent remains outside the autonomous read-only loop');
  assert.match(source, /actions\.propose\(write/);
  assert.match(source, /routeFor\(question\)/, 'deterministic query path remains an offline fallback');
});
