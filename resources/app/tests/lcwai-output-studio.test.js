'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../public/lcwai-output-layout');
const S = require('../public/lcwai-output-source');
const { createOutputService } = require('../server/lib/lcwai-output/output-service');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const XLSX = require('xlsx');
const templates = require('../server/lib/lcwai-output/output-user-templates');

test('studio: mixed spans preserve every record, never overlap and remain deterministic', () => {
  const groups = [{ title: 'A', items: Array.from({ length: 23 }, (_, i) => ({ title: `M${i}`, image: `KOL-${i + 1}` })) }];
  const records = Object.fromEntries(groups[0].items.map((m, i) => [m.image, { values: { setPieceCount: i % 3 === 1 ? 2 : 1 } }]));
  const raw = { columns: 3, rows: 3, autoFit: false, studio: { version: 1, sizing: 'sets', reflow: 'fixed' } };
  const pages = L.galleryPages(raw, groups, { records });
  assert.deepEqual(pages, L.galleryPages(raw, groups, { records }));
  assert.equal(pages.flatMap(p => p.cells).length, 23);
  for (const page of pages) for (const [i, a] of page.cells.entries()) {
    assert.equal(a.rowSpan, records[a.item.image].values.setPieceCount);
    for (const b of page.cells.slice(i + 1)) assert.ok(a.x + a.w <= b.x + .01 || b.x + b.w <= a.x + .01 || a.y + a.h <= b.y + .01 || b.y + b.h <= a.y + .01);
  }
  const equal = L.galleryPages({ ...raw, studio: { ...raw.studio, sizing: 'equal' } }, groups, { records });
  assert.ok(equal.flatMap(p => p.cells).every(c => c.rowSpan === 1));
});

test('studio: header reflow changes capacity without changing source; one-row sets remain valid', () => {
  const group = [{ title: 'A', items: Array.from({ length: 23 }, (_, i) => ({ title: `M${i}`, image: `KOL-${i + 1}` })) }];
  const before = JSON.stringify(group);
  const studio = { version: 1, sizing: 'sets', reflow: 'dense' };
  const small = L.galleryPages({ columns: 3, headerHeight: 50, studio }, group);
  const large = L.galleryPages({ columns: 3, headerHeight: 160, studio }, group);
  assert.ok(small[0].cells.length > large[0].cells.length);
  assert.equal(JSON.stringify(group), before);
  const records = { 'KOL-1': { values: { setPieceCount: 2 } } };
  const one = L.galleryPages({ columns: 3, rows: 1, studio: { ...studio, reflow: 'fixed' } }, group, { records });
  assert.equal(one[0].cells[0].rowSpan, 2);
});

test('studio: automatic sizing reserves room for detailed singles and preserves explicit overrides', () => {
  const records = { 'KOL-1': { values: { a: '1', b: '2', c: '3', d: '4', e: '5', setPieceCount: 1 } } };
  const groups = [{ items: [{ image: 'KOL-1', title: 'A' }] }];
  const layout = { cardFields: ['a', 'b', 'c', 'd', 'e'], studio: { sizing: 'auto', reflow: 'fixed' } };
  assert.equal(L.galleryPages(layout, groups, { records })[0].cells[0].rowSpan, 2);
  assert.equal(L.galleryPages({ ...layout, studio: { ...layout.studio, spans: { 'KOL-1': 1 } } }, groups, { records })[0].cells[0].rowSpan, 1);
});

test('studio: bound source values override AI fields, including missing values', () => {
  const item = { image: 'KOL-1', fields: [{ label: 'quantity', value: '999' }, { label: 'fob', value: '100' }] };
  const record = { values: { quantity: 0, fob: null }, labels: { quantity: 'Quantity', fob: 'FOB' } };
  assert.equal(L.fieldValue(item, 'quantity', { 'KOL-1': record }), '0');
  assert.deepEqual(L.cardDetails(item, { ...L.defaults('pptx'), cardFields: ['quantity', 'fob'] }, record).map(x => x.value), ['0']);
});

test('studio: canonical source is a snapshot; every order row stays distinct', () => {
  const rows = [{ _id: '1', modelName: 'A', quantity: 0, setPieceCount: 2 }, { _id: '2', modelName: 'A', quantity: 30 }];
  const source = S.build({ module: 'orders', rows });
  rows[0].quantity = 999;
  assert.equal(source.records['ORD-1'].values.orderQuantity, 0);
  assert.equal(source.items.length, 2);
  assert.equal(source.source.grain, 'order-row');
  assert.deepEqual(source.fields.includes('nonexistent'), false);
});

test('studio: strict operations reject business mutations and invalid batches atomically', () => {
  const raw = { studio: { sizing: 'sets' }, columns: 3 };
  const before = JSON.stringify(raw);
  assert.throws(() => L.applyOperations(raw, [{ op: 'setReflow', value: 'large' }, { op: 'setQuantity', value: 99 }]));
  assert.equal(JSON.stringify(raw), before);
  assert.throws(() => L.applyOperations(raw, [{ op: 'setCardFields', value: ['secret'] }], { fields: ['quantity'] }));
  assert.equal(L.applyOperations(raw, [{ op: 'setSizing', value: 'equal' }]).layout.studio.sizing, 'equal');
});

test('studio: offline draft, owner isolation and real PDF/HTML/PPTX/XLSX paths preserve records', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-studio-'));
  try {
    const service = createOutputService({ engine: { chat() { throw Error('AI must not be called'); } }, storeOptions: { root } });
    const source = S.build({ module: 'orders', rows: Array.from({ length: 123 }, (_, i) => ({ _id: `r${i}`, modelName: `Model ${i}`, quantity: i, setPieceCount: i % 4 ? 1 : 2 })) });
    const draft = service.createStudio('u1', source);
    assert.equal(draft.source.count, 123);
    assert.equal(draft.data.slides.flatMap(s => s.items || []).length, 123, 'no 60-card truncation');
    assert.throws(() => service.getDraft('u2', draft.id));
    const pptx = service.renderDraft('u1', draft.id, { data: draft.data, format: 'pptx' }).output;
    assert.ok(fs.readFileSync(pptx.path).subarray(0, 2).equals(Buffer.from('PK')));
    const html = service.renderDraft('u1', draft.id, { data: draft.data, format: 'html' }).output;
    const text = fs.readFileSync(html.path, 'utf8');
    assert.equal((text.match(/class="bl-studio-card"/g) || []).length, 123);
    assert.ok(text.includes('Model 122'));
    const pdf = service.renderDraft('u1', draft.id, { data: draft.data, format: 'pdf' }).output;
    assert.equal(pdf.pending, 'pdf');
    assert.equal((pdf.html.match(/class="bl-studio-card"/g) || []).length, 123);
    const xlsx = service.renderDraft('u1', draft.id, { data: draft.data, format: 'xlsx' }).output;
    const wb = XLSX.read(fs.readFileSync(xlsx.path), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames.at(-1)], { header: 1 });
    assert.equal(rows.length, 124);
    assert.ok(rows.flat().includes(122));
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(`${root}-drafts`, { recursive: true, force: true }); }
});

test('studio: every paper/orientation keeps mixed cards within page bounds', () => {
  const source = S.build({ module: 'collection', rows: Array.from({ length: 23 }, (_, i) => ({ id: i, plmId: `M${i}`, setPieceCount: i % 3 ? 1 : 2 })) });
  for (const paper of Object.keys(L.PAPERS)) for (const orientation of ['portrait', 'landscape']) {
    const layout = { ...source.data.layout, margin: 20, studio: { ...source.data.layout.studio, paper, orientation } };
    const size = L.pageSize(layout);
    const pages = L.expandGalleries(source.data.slides, layout, { records: source.records });
    assert.equal(pages.flatMap(p => p.page ? p.page.cells : []).length, 23);
    for (const page of pages) for (const cell of page.page ? page.page.cells : []) {
      assert.ok(cell.x >= 0 && cell.y >= 0 && cell.x + cell.w <= size.width + .01 && cell.y + cell.h <= size.height + .01, `${paper}/${orientation}`);
    }
  }
});

test('studio: templates keep bindings and preferences but discard record-specific spans', () => {
  const def = templates.normalizeDefinition({ format: 'pptx', layout: { cardFields: ['plmId'], groupBy: ['season'], studio: { sizing: 'sets', reflow: 'large', spans: { 'KOL-1': 2 }, note: 'Reusable text' } } });
  assert.deepEqual(def.layout.studio.spans, {});
  assert.equal(def.layout.studio.note, 'Reusable text');
  assert.deepEqual(def.layout.cardFields, ['plmId']);
});

test('studio: reordering a scope larger than the image cap preserves the same resolved images', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-studio-images-'));
  try {
    const service = createOutputService({ storeOptions: { root } });
    const source = S.build({ module: 'orders', rows: Array.from({ length: 205 }, (_, i) => ({ _id: `r${i}`, modelName: `M${i}` })) });
    source.images = { 'ORD-1': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' };
    const draft = service.createStudio('u1', source);
    const items = draft.data.slides.find(slide => slide.items).items;
    items.push(items.shift());
    const output = service.renderDraft('u1', draft.id, { data: draft.data, format: 'html' }).output;
    assert.match(fs.readFileSync(output.path, 'utf8'), /src="data:image\/png;base64,/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(`${root}-drafts`, { recursive: true, force: true }); }
});

test('studio: old translated record labels resolve saved canonical bindings without changing values', () => {
  const records = S.bindLegacyRecords({ 'CP-1': [['Net Alım Sipariş Miktarı', '25'], ['FOB', '4.20'], ['Set Parça Sayısı', '2']] }, 'en');
  assert.equal(L.fieldValue({ image: 'CP-1' }, 'orderQuantity', records), '25');
  const pages = L.galleryPages({ columns: 3, rows: 2, studio: { sizing: 'sets', reflow: 'fixed' } }, [{ items: [{ image: 'CP-1', title: 'M' }] }], { records });
  assert.equal(pages[0].cells[0].rowSpan, 2);
});

test('studio: canonical grouping keys merge translated countries and grouping never loses records', () => {
  const source = S.build({ module: 'orders', rows: [{ country: 'Türkiye', modelName: 'A' }, { country: 'Turkey', modelName: 'B' }] });
  // Use the canonical registry's actual module binding for country.
  const C = require('../public/canonical-fields');
  const id = C.moduleFields('orders').find(id => C.field(id).type === 'country');
  assert.ok(id);
  const binding = C.bindingFor('orders', id).keys[0];
  const data = S.build({ module: 'orders', rows: [{ [binding]: 'Türkiye', modelName: 'A' }, { [binding]: 'Turkey', modelName: 'B' }] });
  const pages = L.expandGalleries(data.data.slides, { ...data.data.layout, groupBy: [id] }, { records: data.records }).filter(p => p.page);
  assert.equal(pages.length, 1); assert.equal(pages[0].page.groups.length, 1); assert.equal(pages[0].page.cells.length, 2);
});

test('studio: legacy HTML galleries reuse span packing while preserving surrounding report text', () => {
  const source = '<h1>Report</h1><p>Keep this executive summary.</p><div class="bl-gallery"><div class="bl-card"><h3>A</h3><img data-bl-image="KOL-1"></div><div class="bl-card"><h3>B</h3><img data-bl-image="KOL-2"></div></div><p>Keep the closing note.</p>';
  const report = L.prepareReport(source, { studio: { sizing: 'sets', reflow: 'dense', paper: 'A4' } }, { records: { 'KOL-1': { values: { setPieceCount: 2 } } } });
  assert.ok(report.includes('Keep this executive summary.'));
  assert.ok(report.includes('Keep the closing note.'));
  assert.equal((report.match(/class="bl-studio-card"/g) || []).length, 2);
});
