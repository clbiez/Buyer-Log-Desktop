'use strict';

const fields = require('./canonical-fields');
const CP = require('../../public/cp-readiness-engine');
const Rules = require('../../public/cp-rules-engine');
const Checklist = require('../../public/cp-checklist-engine');
const Reports = require('../../public/test-report-engine');
const Samples = require('../../public/plm-sample-requests-engine');
const DecisionSupport=require('./agent-office-decision-support');
const { hash } = require('./agent-office-store');
const IDENTITY = ['orderCode', 'plmId', 'colourCode'];
const SNAPSHOT_FIELDS = ['orderCode', 'plmId', 'colourCode', 'modelName', 'orderQuantity', 'shipmentQuantity', 'remainingUnits', 'manufacturer', 'exFactory', 'retailDate', 'orderStatus'];
const PRIORITY = { CRITICAL: 100, ACTION_TODAY: 90, HIGH: 80, ACTION_THIS_WEEK: 60, MEDIUM: 50, WATCH: 30, ON_TRACK: 0 };
/* CP öncelikleri (Bugün/Bu hafta aksiyon) genel bulgu düzeyleriyle aynı basamakta
   sayılır: eşik ve sayımlar tek yerden okunur. */
const SEVERITY_LEVEL = { CRITICAL: 4, ACTION_TODAY: 3, HIGH: 3, ACTION_THIS_WEEK: 2, MEDIUM: 2, WATCH: 1 };
const severityLevel = severity => SEVERITY_LEVEL[severity] || 0;
const bilingual = (tr, en) => ({ tr, en });
function identity(row, module = 'cp') { return fields.project(row, module, IDENTITY); }
function orderKey(row) { return Reports.defaultKey ? Reports.defaultKey(row, { orderCode: CP.FIELDS.orderCode, model: CP.FIELDS.model, colourCode: CP.FIELDS.colourCode }) : CP.analyzeOrder(row).orderKey; }
function provenance(source, id, updatedAt, confidence = 'HIGH') {
  return { source, id: String(id || ''), updatedAt: updatedAt || null, confidence, stale: !updatedAt || !Number.isFinite(Date.parse(updatedAt)) || Date.now() - Date.parse(updatedAt) > 86400000 };
}
function finding(code, key, severity, title, action, sources, extra = {}) {
  return { id: hash(`${code}:${key}`).slice(0, 32), code, orderKey: key, severity, title, action, sources,
    confidence: sources.some(source => source.confidence === 'LOW' || source.stale) ? 'LOW' : 'HIGH', origin: 'deterministic', ...extra };
}

// Never select the first PO match: color/model identity and multiplicity remain
// visible. Collection model names have different semantics, so join on PLM+color.
function correlate(cpRows, collectionRows) {
  const joins = fields.joinRows(cpRows, 'cp', collectionRows, 'collection', { fields: ['plmId', 'colourCode'] });
  const index = new Map();
  for (const join of joins) {
    if (!join.right) continue;
    const code = fields.normalizedValue(join.left, 'cp', 'plmId'), colour = fields.normalizedValue(join.left, 'cp', 'colourCode');
    if (!code || !colour) continue;
    const key = `${code}|${colour}`;
    if (!index.has(key)) index.set(key, []);
    if (!index.get(key).includes(join.right)) index.get(key).push(join.right);
  }
  return index;
}
function analyzeOperationalData(input = {}) {
  const rows = input.cpRows || [], reports = input.reports || { reports: {}, links: {} }, checklist = input.checklist || { answers: {}, definitions: [] };
  const collectionIndex = correlate(rows, input.collectionRows || []), findings = [], orders = [], groups = new Map(), suppliers = new Map();
  const scope = input.scope || {}, asAt = input.sourceUpdatedAt || null;
  const reportGroups = new Map();
  for (const [request, link] of Object.entries(reports.links || {})) {
    if (!link || !reports.reports?.[request]) continue;
    if (!reportGroups.has(link.orderKey)) reportGroups.set(link.orderKey, []);
    reportGroups.get(link.orderKey).push({ request, link, report: reports.reports[request] });
  }
  const rules = Rules.mergeWithDefaults(input.personalRules || checklist.definitions || [], input.deletedRuleIds || []), preparedRules = Rules.prepareEvaluation(rules);
  let processed = 0;
  for (const row of rows) {
    const ident = identity(row), base = CP.analyzeOrder(row, { transitRules: input.transitRules || [], today: input.today, settings: input.settings || {} });
    if (scope.orderCode && String(ident.orderCode || '') !== String(scope.orderCode)) continue;
    if (scope.plmId && String(ident.plmId || '') !== String(scope.plmId)) continue;
    if (scope.colourCode && String(ident.colourCode || '').toUpperCase() !== String(scope.colourCode).toUpperCase()) continue;
    processed++;
    const key = base.orderKey, source = provenance('CP / ASAS', key, asAt, base.confidence || 'LOW');
    const local = [];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
    if (base.priority !== 'ON_TRACK') local.push(finding('CP_PRIORITY', key, base.priority, CP.PRIORITY_LABELS.tr[base.priority] ? bilingual(CP.PRIORITY_LABELS.tr[base.priority], CP.PRIORITY_LABELS.en[base.priority]) : bilingual(base.priority, base.priority),
      bilingual('CP öncelik gerekçelerini incele; termin ve yükleme bilgisini doğrula.', 'Review CP priority reasons; verify schedule and shipment data.'), [source],
      { reasons: base.riskReasons.map(code => ({ code, title: bilingual(CP.RISK_REASON_LABELS.tr[code] || code, CP.RISK_REASON_LABELS.en[code] || code) })) }));
    if (base.dateSync.status === 'REVISED_IN_BUYER_LOG') local.push(finding('ASAS_DATE_DIFFERENCE', key, 'MEDIUM', bilingual('Buyer Log ve ASAS tarihleri farklı', 'Buyer Log and ASAS dates differ'),
      bilingual('Tarih revizesinin ASAS’a yansımasını kontrol et.', 'Check whether the revised dates have reached ASAS.'), [source], { differences: base.dateSync.differences }));
    for (const field of IDENTITY) {
      if (fields.value(row, 'cp', field) == null || fields.value(row, 'cp', field) === '') local.push(finding('MISSING_IDENTITY_' + field, key, 'WATCH',
        bilingual(`${fields.label(field, 'tr')} değeri boş; güvenli eşleştirme yapılamıyor`, `${fields.label(field, 'en')} is empty; a safe match is unavailable`),
        bilingual('Kaynak sistemde kimlik bilgisini doğrula.', 'Verify the identity in the source system.'), [source]));
    }
    const qty = Number(fields.value(row, 'cp', 'orderQuantity')), shipped = Number(fields.value(row, 'cp', 'shipmentQuantity'));
    if ((Number.isFinite(qty) && qty < 0) || (Number.isFinite(shipped) && shipped < 0) || (qty > 0 && shipped > qty)) local.push(finding('QUANTITY_REVIEW', key, 'MEDIUM',
      bilingual('Adet değerleri inceleme gerektiriyor', 'Quantity values need review'), bilingual('Fazla yükleme veya kaynak veri hatasını kontrol et.', 'Check for overshipment or a source-data error.'), [source], { qty, shipped }));
    const sample = input.samples?.models?.[String(ident.plmId || '')], milestones = sample ? Samples.summarizeMilestones(sample.requests || []) : null;
    const ctx = { answers: checklist.answers || {}, customItems: checklist.definitions || [], plmEvidence: (_analysis, itemId) => Samples.evidenceFor(milestones, itemId) };
    const evaluated = Rules.evaluateOrder(base,{rules,preparedRules,answers:ctx.answers,plmEvidence:ctx.plmEvidence,checklistEnabled:input.checklistEnabled !== false,today:input.today});
    base.calculatedPriority = base.priority; base.priority = evaluated.priority;
    const priorPriority = local.find(item=>item.code === 'CP_PRIORITY');
    if(priorPriority){priorPriority.severity=base.priority;priorPriority.title=bilingual(CP.PRIORITY_LABELS.tr[base.priority] || base.priority,CP.PRIORITY_LABELS.en[base.priority] || base.priority);priorPriority.reasons.push(...evaluated.signals.map(signal=>({code:signal.code,title:bilingual(signal.textTr,signal.textEn)})));}
    else if(base.priority !== 'ON_TRACK')local.push(finding('CP_PRIORITY',key,base.priority,bilingual(CP.PRIORITY_LABELS.tr[base.priority] || base.priority,CP.PRIORITY_LABELS.en[base.priority] || base.priority),bilingual('Kişisel CP kuralı aksiyon gerektiriyor.','Your personal CP rule requires action.'),[source],{reasons:evaluated.signals.map(signal=>({code:signal.code,title:bilingual(signal.textTr,signal.textEn)}))}));
    const states = evaluated.checklistState, evidence = [], linked = reportGroups.get(key) || [];
    for (const [itemId, state] of Object.entries(states)) {
      if (state === 'notApplicable') continue;
      const definition = rules.find(rule=>rule.id === itemId);
      const directAnswer = ctx.answers[Checklist.answerKey(key,itemId)], optionAnswer = definition?.approvalScope === 'option' ? ctx.answers[Checklist.optionAnswerKey(base,itemId)] : null;
      const answer = directAnswer || optionAnswer, plm = Samples.evidenceFor(milestones, itemId), testList = linked.filter(item => item.link.itemId === itemId);
      const testState = Reports.deriveStepStatus(testList.map(item => item.report));
      const item = Checklist.ITEM_BY_ID[itemId] || checklist.definitions.find(def => def.id === itemId) || { tr: itemId, en: itemId };
      const sources = [provenance('Checklist', `${key}::${itemId}`, answer?.at || checklist.updatedAt, answer ? 'USER_REPORTED' : 'LOW')];
      if (plm) sources.push(provenance('PLM requests', `${ident.plmId}:${itemId}`, sample?.fetchedAt));
      for (const test of testList) sources.push(provenance('Test report', test.request, reports.updatedAt));
      evidence.push({ itemId, title: bilingual(item.tr || item.name, item.en || item.name), state, userState: answer?.state || '', plmState: plm?.state || plm?.status || '', testState: testState.state, sources });
      if (state === 'open' || state === 'rejected') local.push(finding('APPROVAL_' + itemId, key, state === 'rejected' ? 'HIGH' : 'WATCH',
        bilingual(`${item.tr || item.name}: ${state === 'rejected' ? 'ret kaydı var' : 'yanıt/onay bekliyor'}`, `${item.en || item.name}: ${state === 'rejected' ? 'rejection recorded' : 'awaiting answer/approval'}`),
        bilingual('İlgili kontrolü ve kaynak kanıtını incele.', 'Review the check and its source evidence.'), sources));
      const plmState = plm?.state || plm?.status;
      if (answer?.state === 'approved' && (testState.state === 'rejected' || plmState === 'rejected')) local.push(finding('APPROVAL_CONFLICT_' + itemId, key, 'HIGH',
        bilingual(`${item.tr || item.name}: onay ile kaynak ret kararı çelişiyor`, `${item.en || item.name}: approval conflicts with a source rejection`),
        bilingual('Son kararı ve kapsamını doğrula; onayı otomatik değiştirme.', 'Verify the latest decision and its scope; do not change the approval automatically.'), sources));
      if (answer?.state === 'approved' && !plm && !testList.length && !(answer.attachments || []).length && !answer.reportNumber) local.push(finding('APPROVAL_EVIDENCE_' + itemId, key, 'WATCH',
        bilingual(`${item.tr || item.name}: kullanıcı onayı var; erişilebilir kanıt eklenmemiş`, `${item.en || item.name}: user approval recorded; no accessible evidence attached`),
        bilingual('Gerekliyse rapor veya onay kanıtını ekle. Bu bulgu onayı geçersiz saymaz.', 'Attach the report or approval evidence if needed. This finding does not invalidate the approval.'), sources));
      for (const attachment of answer?.attachments || []) if (input.attachmentExists && !input.attachmentExists(attachment.id)) local.push(finding('ATTACHMENT_UNAVAILABLE_' + attachment.id, key, 'MEDIUM',
        bilingual('Checklist eki bu cihazda erişilebilir değil', 'Checklist attachment is unavailable on this device'), bilingual('Ekin kaynağını veya aktarımını kontrol et.', 'Check the attachment source or transfer.'), sources));
    }
    for (const test of linked) {
      const match = Reports.matchReport(test.report, [row], { keyOf: () => key });
      if (match.level === 'none' || match.status === 'none' || match.reason) local.push(finding('REPORT_MATCH_' + test.request, key, 'HIGH',
        bilingual('Bağlı test raporunun kimlik/kapsam eşleşmesini doğrula', 'Verify the identity/scope match of the linked test report'),
        bilingual('Sipariş, model, renk ve bileşen bilgisini raporla karşılaştır.', 'Compare order, model, color and component with the report.'), [provenance('Test report', test.request, reports.updatedAt)], { match }));
    }
    const collectionKey = `${fields.normalizedValue(row, 'cp', 'plmId')}|${fields.normalizedValue(row, 'cp', 'colourCode')}`, collection = collectionIndex.get(collectionKey) || [];
    if (collection.length > 1) local.push(finding('COLLECTION_AMBIGUOUS', key, 'WATCH', bilingual('Birden fazla koleksiyon eşleşmesi var', 'Multiple collection matches exist'),
      bilingual('Varyant/bileşen kapsamını seçmeden kayıtları birleştirme.', 'Do not merge records before selecting the variant/component scope.'), [source, provenance('Collection', collectionKey, input.collectionUpdatedAt)], { matches: collection.length }));
    const bom = input.bom?.models?.[String(ident.plmId || '')];
    const record = { identity: ident,dimensions:fields.project(row,'cp',['manufacturer','season','orderQuantity']),snapshotValues:fields.project(row,'cp',SNAPSHOT_FIELDS), orderKey: key, analysis: base, evidence, collection: collection.map(item => fields.project(item, 'collection')), bom: bom ? { fetchedAt: bom.fetchedAt, components: bom.fullComponents?.length?bom.fullComponents:bom.components||[],coverage:bom.fullCoverage==='all-normalized'?(bom.fullComponents.length<bom.fullComponentCount?'truncated-normalized-bom':'all-normalized-bom'):'decoration-only',componentCount:bom.fullComponentCount||bom.components?.length||0,fullFingerprint:bom.fullFingerprint||null } : null,
      findings: local, sources: [source], unavailable: [...(bom?.fullCoverage==='all-normalized'?[]:['full-fabric-bom']), ...(sample ? [] : ['plm-requests']), ...(bom ? [] : ['decoration-bom'])] };
    orders.push(record); findings.push(...local);
    const supplier = String(fields.value(row, 'cp', 'manufacturer') || 'UNKNOWN');
    if (!suppliers.has(supplier)) suppliers.set(supplier, { name: supplier, orderKeys: new Set(), quantity: 0, atRisk: 0, late: 0, qualityRejected: 0, unknown: 0, sources: [] });
    const performance = suppliers.get(supplier);
    if (!performance.orderKeys.has(key)) {
      performance.orderKeys.add(key); performance.quantity += Math.max(0, qty || 0);
      performance.atRisk += Number(base.deliveryOutcome === 'AT_RISK');
      performance.late += Number(['EXPECTED_LATE','ALREADY_LATE'].includes(base.deliveryOutcome));
      performance.unknown += Number(base.deliveryOutcome === 'UNKNOWN');
      performance.qualityRejected += Number(evidence.some(item => item.testState === 'rejected'));
    }
  }
  for (const [key, duplicates] of groups) if (duplicates.length > 1) findings.push(finding('DUPLICATE_IDENTITY', key, 'MEDIUM',
    bilingual('Aynı sipariş/model/renkte birden fazla satır var', 'Multiple rows share the same order/model/color'),
    bilingual('Parçalı yükleme veya tekrar kaydını doğrula; otomatik silme.', 'Verify partial shipments or duplicate records; do not delete automatically.'), [provenance('CP / ASAS', key, asAt)], { count: duplicates.length }));
  findings.sort((a,b) => (PRIORITY[b.severity] || 0) - (PRIORITY[a.severity] || 0) || Number(b.code === 'CP_PRIORITY') - Number(a.code === 'CP_PRIORITY') || a.orderKey.localeCompare(b.orderKey));
  const pipeline=DecisionSupport.collectionPipeline(input.collectionRows||[],orders);
  return {decisionSupport:{supplierHistory:DecisionSupport.supplierHistory(orders,rows),historicalPrices:DecisionSupport.historicalPrices(input.lflRows,input.sourceUpdatedAt),collectionPipeline:pipeline.groups}, computedAt: new Date().toISOString(), sourceUpdatedAt: asAt, origin: 'deterministic', scope, rowCount: processed,
    findings, orders, suppliers: [...suppliers.values()].map(item => ({ ...item, orderCount: item.orderKeys.size, orderKeys: [...item.orderKeys] })),
    coverage: { cp: Boolean(input.cpAvailable), collection: Boolean(input.collectionAvailable), samples: Boolean(input.samples), reports: Boolean(input.reports), checklist: Boolean(input.checklist), personalRules: Boolean(input.personalRules), priority:'cp-engine-with-rule-evaluator', source:input.operationalSource || 'cp', lfl:input.lflSummary || null, sourceErrors:input.sourceErrors || [], bom: orders.some(o=>o.bom?.coverage==='all-normalized-bom')?'normalized-components-available':'decoration-only-or-unavailable',
      prices: input.priceInsights || null },
    bomEvidence:Object.entries(input.bom?.models||{}).slice(0,30).map(([plmId,bom])=>({id:'bom:'+plmId,plmId,fetchedAt:bom.fetchedAt,coverage:bom.fullCoverage||'decoration-only',components:(bom.fullComponents?.length?bom.fullComponents:bom.components||[]).slice(0,20),omittedComponents:Math.max(0,(bom.fullComponentCount||bom.components?.length||0)-20),sources:[provenance('PLM BOM',plmId,bom.fetchedAt)]})),
    collection: { options:(input.collectionRows || []).slice(0,12).map((row,index)=>({id:'collection:'+String(row.id || row._id || index),values:fields.project(row,'collection'),sources:[provenance('Collection',String(row.id || index),input.collectionUpdatedAt)]})), rows: (input.collectionRows || []).length, models: new Set((input.collectionRows || []).map(row => fields.value(row, 'collection', 'plmId')).filter(Boolean)).size },
    snapshots: pipeline.snapshots.concat(orders.map(order => ({ key: order.orderKey, values: order.snapshotValues,
      priority: order.analysis.priority, evidence: order.evidence.map(item => ({ itemId: item.itemId, state: item.state, testState: item.testState, plmState: item.plmState })) }))) };
}
function compareSnapshots(previous, current) {
  const old = new Map((previous || []).map(item => [item.key, item])), changes = [];
  for (const item of current || []) {
    const before = old.get(item.key);
    if (!before) { changes.push({ key: item.key, kind: 'new', before: null, after: item }); continue; }
    for (const key of new Set([...Object.keys(before.values || {}), ...Object.keys(item.values || {})])) {
      if (JSON.stringify(before.values[key]) !== JSON.stringify(item.values[key])) changes.push({ key: item.key, field: key, kind: 'source-change', before: before.values[key] ?? null, after: item.values[key] ?? null });
    }
    if (JSON.stringify(before.evidence) !== JSON.stringify(item.evidence)) changes.push({ key: item.key, field: 'approvalEvidence', kind: 'approval-change', before: before.evidence, after: item.evidence });
  }
  const keys = new Set((current || []).map(item => item.key));
  for (const item of previous || []) if (!keys.has(item.key)) changes.push({ key: item.key, kind: 'left-current-scope', before: item, after: null });
  return changes;
}
module.exports = { analyzeOperationalData, compareSnapshots, correlate, identity, provenance, SNAPSHOT_FIELDS, PRIORITY, severityLevel, bilingual };
