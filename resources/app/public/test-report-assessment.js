/* Shared, source-grounded LCW AI review protocol. It prepares proposals only. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BLTestReportAssessment = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const PROTOCOL = 'buyerlog-test-assessment/1';
  const text = value => String(value == null ? '' : value).trim();
  const flat = value => text(value).replace(/\s+/g, ' ');
  const list = value => Array.isArray(value) ? value : [];
  const identifier = value => /^[A-Za-z0-9][A-Za-z0-9._/-]{3,79}$/.test(text(value)) && /\d/.test(text(value)) ? text(value) : '';
  const keyOf = value => [value.reportId, value.orderKey, value.step].join('::');
  function object(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null; } catch (_) { return null; }
  }
  function cpSnapshot(rows, options) {
    const opts = options || {};
    const fields = new Set();
    const result = list(rows).map(row => {
      const values = {};
      for (const [key, value] of Object.entries(row || {})) {
        if (key.startsWith('_') || typeof value === 'function' || typeof value === 'undefined') continue;
        // Keep image keys such as KOL-3, never the model image bytes.
        if (typeof value === 'string' && /^(?:data:|blob:)/i.test(value)) continue;
        if (value != null && typeof value === 'object') continue;
        fields.add(key); values[key] = value;
      }
      return { key: text(opts.keyOf && opts.keyOf(row)), orderCode: text(opts.orderCodeOf && opts.orderCodeOf(row)), fields: values,
        checklist: opts.checklistOf ? opts.checklistOf(row) : [] };
    });
    return { rowCount: result.length, columns: [...fields], rows: result };
  }
  function batches(packet) {
    const readable = packet.sources.filter(source => source.complete === true);
    const visual = packet.sources.filter(source => source.complete !== true);
    const out = [];
    for (let i = 0; i < Math.max(1, Math.ceil(visual.length / 4)); i++) {
      const images = visual.slice(i * 4, (i + 1) * 4);
      const sourceIds = (i === 0 ? readable : []).concat(images).map(source => source.id);
      if (sourceIds.length) out.push({ sourceIds, visualSourceIds: images.map(source => source.id) });
    }
    return out;
  }
  function validate(raw, packet, options) {
    const opts = options || {}, errors = [], assessments = [];
    const data = raw && typeof raw === 'object' ? raw : {};
    if (data.protocol !== PROTOCOL || data.caseId !== packet.caseId || data.snapshotId !== packet.snapshotId) errors.push('snapshot');
    const focus = opts.sourceIds || packet.sources.map(source => source.id);
    const covered = list(data.coveredSourceIds).map(text);
    if (new Set(covered).size !== focus.length || covered.length !== focus.length || focus.some(id => !covered.includes(id))) errors.push('coverage');
    const sources = new Map(packet.sources.map(source => [source.id, source]));
    const rows = new Map(packet.cp.rows.map(row => [row.key, row]));
    const steps = new Set(packet.checklistSteps.map(step => step.id));
    const statuses = new Map(packet.checklistStatuses.map(status => [status.id, status]));
    const seen = new Map();
    for (const input of list(data.assessments)) {
      const item = object(input);
      if (!item) { errors.push('shape'); continue; }
      const reportId = identifier(item.reportId);
      const orderKey = text(item.orderKey), row = rows.get(orderKey), orderCode = text(item.orderCode);
      if (!reportId) { errors.push('report-id'); continue; }
      if (orderKey && (!row || row.orderCode !== orderCode)) { errors.push('order'); continue; }
      if (!orderKey && item.scope !== 'unmatched') { errors.push('scope'); continue; }
      const evidence = [];
      for (const ref of list(item.evidence)) {
        const source = sources.get(ref.sourceId);
        const page = source && list(source.pages).find(p => p.page === Number(ref.page));
        const quote = flat(ref.quote);
        const visual = source && source.complete !== true && source.fileId && ['pdf', 'image'].includes(source.kind) && ref.visual === true && Number(ref.page) > 0 && Number(ref.page) <= source.pageCount;
        if (!source || !focus.includes(ref.sourceId) || !quote || quote.length < 3 || (!visual && (!page || !flat(page.text).includes(quote)))) { errors.push('evidence'); continue; }
        evidence.push({ sourceId: source.id, page: Number(ref.page), quote, ...(visual ? { visual: true } : {}) });
      }
      const quotes = evidence.map(ref => ref.quote).join('\n');
      const containsId = value => {
        const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp('(?:^|[^A-Za-z0-9])' + escaped + '(?=$|[^A-Za-z0-9])').test(quotes);
      };
      // Names and AI confidence do not establish report/order provenance.
      if (!evidence.length || !containsId(reportId) || (orderCode && !containsId(orderCode))) { errors.push('identity-evidence'); continue; }
      const escapedId = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const hasId = (sourceText, value) => new RegExp('(?:^|[^A-Za-z0-9])' + escapedId(value) + '(?=$|[^A-Za-z0-9])').test(sourceText);
      const sourceFacts = new Map([...new Set(evidence.map(ref => ref.sourceId))].map(id => {
        const source = sources.get(id), refs = evidence.filter(ref => ref.sourceId === id);
        return [id, refs.some(ref => ref.visual) ? refs.map(ref => ref.quote).join('\n') : source.pages.map(page => page.text).join('\n')];
      }));
      // A covering mail may omit the attached laboratory reference. Permit it
      // only through the extractor's parent/hash link, with the same printed PO
      // and a separately cited PDF that contains BOTH report and order identity.
      const linkedCover = (id, value) => {
        const parent = sources.get(id);
        return parent && ['msg', 'eml'].includes(parent.kind) && orderCode && hasId(value, orderCode)
          && [...sourceFacts].some(([childId, childText]) => {
            const child = sources.get(childId);
            return child && child.kind === 'pdf' && child.parentId === id && child.hash
              && list(parent.attachments).some(file => file.kind === 'pdf' && file.hash === child.hash)
              && hasId(childText, reportId) && hasId(childText, orderCode);
          });
      };
      // Report, PO and verdict cannot be assembled from unrelated documents.
      if (![...sourceFacts.values()].some(value => hasId(value, reportId) && (!orderCode || hasId(value, orderCode))) ||
          [...sourceFacts].some(([id, value]) => !hasId(value, reportId) && !linkedCover(id, value))) { errors.push('source-linkage'); continue; }
      const component = flat(item.component), labResult = flat(item.labResult), commercialDecision = flat(item.commercialDecision);
      if ((component && !flat(quotes).includes(component)) || (labResult && !flat(quotes).includes(labResult)) || (commercialDecision && !flat(quotes).includes(commercialDecision))) { errors.push('result-evidence'); continue; }
      const risks = list(item.risks).map(text).filter(Boolean);
      const step = steps.has(text(item.step)) ? text(item.step) : '';
      let status = statuses.has(text(item.status)) ? text(item.status) : '';
      const scope = ['verified', 'uncertain', 'unmatched'].includes(item.scope) ? item.scope : 'uncertain';
      const incomplete = evidence.some(ref => sources.get(ref.sourceId).complete !== true);
      let blocked = scope !== 'verified' || incomplete || !component || !labResult || Boolean(item.step && !step) || Boolean(item.status && !status);
      // A successful component test alone cannot close an unresolved rejection.
      if (statuses.get(status)?.resolved === true && (risks.length || !/^(pass|geçer|approved|ticari onay|commercial approval)$/i.test(commercialDecision || labResult))) blocked = true;
      if (blocked) status = '';
      const result = { reportId, orderKey, orderCode, step, status, scope, component, labResult, commercialDecision, blocked,
        summary: text(item.summary), actions: list(item.actions).map(text).filter(Boolean), risks, evidence,
        extraction: object(item.extraction) || {} };
      // Copy extracted facts only when present in the cited source pages.
      const sourceText = evidence.map(ref => ref.visual ? ref.quote : flat(sources.get(ref.sourceId).pages.find(page => page.page === ref.page).text)).join('\n');
      for (const [field, value] of Object.entries(result.extraction)) {
        if (['confidence', 'explanation'].includes(field)) continue;
        const values = Array.isArray(value) ? value.flatMap(line => String(line).split('|').map(flat)) : [flat(value)];
        if (values.some(value => value && !sourceText.includes(value))) { errors.push('extraction-evidence'); }
      }
      const key = keyOf(result), previous = seen.get(key);
      if (previous) { if (JSON.stringify(previous) !== JSON.stringify(result)) errors.push('conflicting-proposals'); continue; }
      seen.set(key, result); assessments.push(result);
    }
    if (!list(data.assessments).length && !list(data.unresolvedSourceIds).length) errors.push('empty');
    const targets = new Map();
    for (const item of assessments.filter(item => item.orderKey)) {
      const key = item.orderKey + '::' + item.step;
      if (!targets.has(key)) targets.set(key, []);
      targets.get(key).push(item);
    }
    for (const items of targets.values()) {
      const states = new Set(items.map(item => item.status).filter(Boolean));
      if (states.size > 1 || (items.some(item => item.blocked || !item.status) && items.some(item => statuses.get(item.status)?.resolved === true))) {
        items.forEach(item => { item.status = ''; item.blocked = true; });
      }
    }
    const unresolved = list(data.unresolvedSourceIds).map(text);
    if (unresolved.some(id => !focus.includes(id))) errors.push('unresolved-source');
    if (unresolved.length) assessments.filter(item => statuses.get(item.status)?.resolved === true).forEach(item => { item.status = ''; item.blocked = true; });
    // Every acknowledged source must actually participate in a finding or be unresolved.
    if (focus.some(id => !unresolved.includes(id) && !assessments.some(item => item.evidence.some(ref => ref.sourceId === id)))) errors.push('unaccounted-source');
    return { ok: !errors.length, errors: [...new Set(errors)], assessments, unresolvedSourceIds: unresolved };
  }
  return { PROTOCOL, cpSnapshot, batches, validate, keyOf, identifier };
});
