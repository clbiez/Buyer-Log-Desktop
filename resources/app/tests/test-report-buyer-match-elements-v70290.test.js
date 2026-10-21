'use strict';

/* v7.0.290 — Kullanıcı talebi (Checklist / Test raporu):
   - takım modellerde birden fazla set parçası seçilebilmeli,
   - eşleşme bulunmasa da / bulunsa da bir ya da birden çok siparişle elle
     eşleştirilebilmeli (LCW AI tamamlanmasa bile),
   - aynı test ürünün farklı bileşenlerine ayrı sonuç verebilmeli
     (Main Fabric · Rejected | Neck RIB · Approved) ve tek hücrede görünmeli. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-buyer-match-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = root;
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const Components = require('../public/checklist-components-engine');
const Checklist = require('../public/cp-checklist-engine');
const { createService } = require('../server/lib/test-reports/service');
const reportStore = require('../server/lib/test-reports/store');
const answerStore = require('../server/lib/checklist-supplier-store');

const profile = { id: 'demo', displayName: 'Demo' };
const orders = new Map([['po7', { orderCode: '1381207' }], ['po9', { orderCode: '1381209' }]]);
const canonical = {
  cp: { rows: [
    { key: 'po7', orderCode: '1381207', fields: { Category: 'T-shirt' }, checklist: [] },
    { key: 'po9', orderCode: '1381209', fields: { Category: 'Takım 2 li set' }, checklist: [{ itemId: '@set-components', answer: { state: 'open', componentCount: 2 } }] },
  ] },
  checklistSteps: [{ id: 'fabric' }, { id: 'fabric~part~A' }, { id: 'fabric~part~B' }],
  checklistStatuses: [{ id: 'open' }, { id: 'approved', resolved: true }, { id: 'rejected' }],
};
const service = createService({ authorizedOrders: async () => orders, sourceRevision: () => 'v1', reviewContext: async () => canonical });

async function parse(id) {
  const mail = 'From: lab@example.test\r\nTo: buyer@example.test\r\nSubject: Test\r\nDate: Tue, 20 Oct 2026 10:00:00 +0300\r\n\r\nReport ' + id + ' Order 9999999 FABRIC Fail';
  const parsed = await service.parse(profile, [{ name: 'result.eml', base64: Buffer.from(mail).toString('base64') }]);
  // An unrecognised mail still opens a preview; the buyer's manual path uses the staged report.
  const report = require('../public/test-report-engine').reportFromAiExtract({ talepNo: id, confidence: 'HIGH' });
  const staging = require('../server/lib/test-reports/staging');
  const session = staging.getSession(parsed.sessionId, profile.id);
  session.reports = [report]; staging.persistSession(session);
  return { ...parsed, reports: [report] };
}

test('buyer can link a report without any LCW AI review, to one or several orders and set parts', async () => {
  const parsed = await parse('90777');
  const talepNo = parsed.reports[0].talepNo;
  assert.ok(talepNo);
  const buyer = (orderKey, itemId, targetStatus) => ({ talepNo, orderKey, itemId, confirmMatch: true, confirmEvidence: true, targetStatus,
    manualMatch: { buyer: true, fromOrderKey: '', fromItemId: '' } });
  // Unverified manual match is refused.
  await assert.rejects(service.commit(profile, { sessionId: parsed.sessionId, items: [{ ...buyer('po7', 'fabric', 'rejected'), confirmEvidence: false }] }), { code: 'TEST_REPORT_MANUAL_MATCH_REQUIRED' });
  // A set order needs a part; a single product cannot take a part answer.
  await assert.rejects(service.commit(profile, { sessionId: parsed.sessionId, items: [buyer('po9', 'fabric', 'rejected')] }), { code: 'TEST_REPORT_MANUAL_MATCH_REQUIRED' });
  await assert.rejects(service.commit(profile, { sessionId: parsed.sessionId, items: [buyer('po7', 'fabric~part~A', 'rejected')] }), { code: 'TEST_REPORT_MANUAL_MATCH_REQUIRED' });
  const result = await service.commit(profile, { sessionId: parsed.sessionId, items: [
    buyer('po7', 'fabric', 'rejected'), buyer('po9', 'fabric~part~A', 'rejected'), buyer('po9', 'fabric~part~B', 'approved'),
  ] });
  assert.equal(result.results.length, 3);
  const links = require('../public/test-report-engine').reportLinks(reportStore.read().links[talepNo]);
  assert.deepEqual(links.map(link => link.orderKey + ':' + link.itemId).sort(), ['po7:fabric', 'po9:fabric~part~A', 'po9:fabric~part~B']);
  assert.ok(links.every(link => link.review && link.review.matchSource === 'buyer'), 'buyer matches stay distinguishable from AI proposals');
});

test('re-mapping the same order to another step still replaces the old target', () => {
  const engine = require('../public/test-report-engine');
  const report = engine.reportFromAiExtract({ talepNo: '90888', confidence: 'HIGH' });
  reportStore.commit([{ report, orderKey: 'po7', itemId: 'fabric' }], {}, profile, null);
  reportStore.commit([{ report, orderKey: 'po7', itemId: 'gs' }], {}, profile, null);
  assert.deepEqual(engine.reportLinks(reportStore.read().links['90888']).map(link => link.itemId), ['gs']);
});

test('component results aggregate into one answer and one cell label', () => {
  const answer = Checklist.makeAnswer('approved', { plannedLoadDate: 1 }, {
    elements: [{ name: 'Main Fabric', state: 'rejected' }, { name: 'Neck RIB', state: 'approved' }, { name: ' main fabric ', state: 'approved' }, { name: '', state: 'approved' }],
  });
  assert.equal(answer.state, 'rejected', 'one rejected component rejects the check');
  assert.deepEqual(answer.elements.map(item => item.name), ['Main Fabric', 'Neck RIB'], 'names are trimmed, unique and editable');
  assert.equal(Components.elementsLabel(answer.elements, id => Checklist.statusLabel(id, 'en')), 'Main Fabric · Rejected | Neck RIB · Approved');
  const upgraded = Components.upsertElement(answer.elements, { name: 'MAIN FABRIC', state: 'approved' }, Checklist.normalizeStatus);
  assert.equal(Components.elementsState(upgraded, Checklist.isResolved), 'approved');
  assert.equal(Checklist.makeAnswer('approved', null, {}).elements, undefined, 'single component stays the default');
});

test('components survive the shared checklist store and are preserved when omitted', () => {
  answerStore.applyEntries([{ orderKey: 'po7', itemId: 'fabric', state: 'rejected', at: '2026-10-20T10:00:00.000Z',
    elements: [{ name: 'Main Fabric', state: 'rejected' }, { name: 'Neck RIB', state: 'approved' }] }], profile);
  answerStore.applyEntries([{ orderKey: 'po7', itemId: 'fabric', state: 'rejected', at: '2026-10-20T11:00:00.000Z', note: 'retest' }], profile);
  const saved = answerStore.publicPayload().answers['po7::fabric'];
  assert.deepEqual(saved.elements.map(item => item.name + ':' + item.state), ['Main Fabric:rejected', 'Neck RIB:approved']);
  assert.throws(() => answerStore.applyEntries([{ orderKey: 'po7', itemId: 'fabric', state: 'rejected', at: '2026-10-20T12:00:00.000Z', elements: 'x' }], profile), { code: 'CHECKLIST_EVIDENCE_INVALID' });
});

test('test report preview: manual match works without LCW AI; several set parts become separate rows', () => {
  const rows = [{ 'Order Code': 'PO1', Category: 'T-shirt' }, { 'Order Code': 'PO2', Category: 'Takım 2 li set' }];
  const analyses = rows.map((sourceRow, i) => ({ sourceRow, orderKey: 'key' + i, checklistItemIds: ['tests'] }));
  const context = { document: { documentElement: { lang: 'en' } }, state: { cp: { rows } }, BLCpChecklistEngine: Checklist, BLTestReports: require('../public/test-report-engine'),
    BLCpAssistant: { _state: { rules: [{ id: 'tests', kind: 'checklist' }], answers: { 'key1::@set-components': { state: 'open', componentCount: 2 } } } } };
  context.window = context; vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/test-report-import.js'), 'utf8'), context);
  const api = context.BLTestReportImport;
  const report = require('../public/test-report-engine').reportFromAiExtract({ talepNo: '90002', confidence: 'HIGH' });
  const entry = { id: 'source', report, candidates: [], chosen: '', itemId: '', include: false };
  api._ui.decision = { byRow: new Map(rows.map((row, i) => [row, analyses[i]])) };
  api._ui.store = { reports: {}, links: {} }; api._ui.entries = [entry];
  api._ui.ai = { state: 'error', message: 'CP coverage is incomplete or changed.', reviews: {} };
  // No match and no AI: the buyer chooses the order, verifies and picks a status.
  api._changeMatch(entry, 'key0');
  entry.itemId = 'tests';
  assert.equal(api._plan(entry).ready, false, 'verification is required');
  entry.reviewVerified = true;
  assert.equal(api._plan(entry).next, '', 'no status is invented without AI');
  entry.status = 'rejected';
  assert.equal(api._plan(entry).next, 'rejected');
  // Add a second order (set) and select both parts.
  api._addPo(entry);
  const extra = api._ui.entries[1];
  api._changeMatch(extra, 'key1');
  extra.itemId = 'tests~part~A'; extra.reviewVerified = true; extra.status = 'approved';
  assert.equal(api._plan(extra).ready, true);
  api._togglePart(extra, 'B', true);
  const partB = api._ui.entries.find(item => item.partOf === extra.id);
  assert.equal(partB.itemId, 'tests~part~B');
  assert.equal(api._plan(partB).ready, false, 'each extra part is verified on its own');
  partB.reviewVerified = true; partB.status = 'rejected';
  [entry, extra, partB].forEach(item => { item.include = true; });
  assert.equal(api._selectionConflicts(api._ui.entries.map(api._plan)), false, 'parts of one report are distinct targets');
  api._togglePart(extra, 'B', false);
  assert.equal(api._ui.entries.some(item => item.partOf === extra.id), false);
});
