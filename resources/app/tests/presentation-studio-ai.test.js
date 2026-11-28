'use strict';
// Sunum Stüdyosu "LCW AI ile grupla": modelin bilgisi kesilmeden gider, paketler sunucunun kesintisiz
// sınırına sığar, cevaptaki her model tam bir kez doğrulanır; sunucu kesilecek bağlamı göndermez.
const test = require('node:test'), assert = require('node:assert/strict');
const AI = require('../public/presentation-studio-ai.js');
const config = require('../server/lib/lcwai/lcwai-config');
const prompts = require('../server/lib/lcwai/lcwai-prompt');
const { createLcwAiEngine } = require('../server/lib/lcwai/lcwai-engine');

test('alanlar kayıpsız: boş alan atlanır, uzun değer sırayla parçalara bölünür, hiçbir parça sunucu sınırını aşmaz', () => {
  const long = 'x'.repeat(4500) + 'SON';
  const lines = AI.fieldLines([{ label: 'Model', value: 'NBA-2-YD' }, { label: 'Boş', value: '' }, { label: 'Not', value: long }]);
  assert.equal(lines[0], 'Model: NBA-2-YD');
  assert.ok(lines.length >= 4);
  assert.ok(lines.every(l => l.length <= config.LIMITS.maxContextStringChars));
  const joined = lines.slice(1).map(l => l.replace(/^Not( \(devam\))?: /, '')).join('');
  assert.equal(joined, long, 'parçalar birleşince değer aynen geri gelir');
  const rec = AI.modelRecord('M1', 'sheet-1.jpg', lines);
  assert.equal(prompts.contextFits({ mode: 'plan', models: [rec] }), true);
});

test('paket planı: sıra korunur, model ve karakter sınırı aşılmaz; örnek tüm sete yayılır', () => {
  const items = Array.from({ length: 95 }, (_, i) => ({ id: 'id' + i, size: i === 40 ? 50000 : 1000 }));
  const batches = AI.planBatches(items, { maxModels: 30, maxChars: 42000 });
  assert.deepEqual(batches.flat(), items.map(i => i.id), 'her model tam bir kez, aynı sırada');
  for (const b of batches) {
    assert.ok(b.length <= 30);
    const size = b.reduce((s, id) => s + items.find(i => i.id === id).size, 0);
    assert.ok(size <= 42000 || b.length === 1, 'tek başına büyük model kendi paketinde');
  }
  const s = AI.sample(items.map(i => i.id), 24);
  assert.equal(s.length, 24); assert.equal(s[0], 'id0'); assert.ok(s.includes('id91'));
});

test('cevap doğrulaması: eksik, iki kez yazılan, bilinmeyen anahtar ve listede olmayan kategori kabul edilmez', () => {
  const cats = AI.normalizeCategories(['Kapüşonlu', ' bisiklet  yaka ', 'KAPÜŞONLU', '?', 'Fermuarlı']);
  assert.deepEqual(cats, ['Kapüşonlu', 'bisiklet yaka', 'Fermuarlı']);
  const r = AI.parseAssignments([
    'k=M1|c=kapüşonlu|r=Kapüşon görünüyor', 'k=M2|c=Bisiklet Yaka', 'k=M3|c=?|r=görsel yok',
    'k=M4|c=Polo yaka', 'k=M5|c=Fermuarlı', 'k=M5|c=Kapüşonlu', 'k=M9|c=Fermuarlı',
  ], ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'], cats);
  assert.deepEqual([...r.values.entries()].map(([k, v]) => [k, v.c]), [['M1', 'Kapüşonlu'], ['M2', 'bisiklet yaka'], ['M3', '?']]);
  assert.deepEqual(r.missing, ['M4', 'M5', 'M6']);
  assert.deepEqual(r.duplicate, ['M5']); assert.deepEqual(r.invalid, ['M4']); assert.deepEqual(r.unknown, ['M9']);
  assert.equal(r.values.get('M1').r, 'Kapüşon görünüyor');
});

test('kayıtlı sonuç sadeleşir: bilinmeyen model ve kategori atılır', () => {
  const g = AI.normalizeGrouping({ q: 'Yaka tipi', cats: ['A', 'B'], vals: { a: 'A', b: '?', c: 'Z', x: 'A' }, fp: { a: 'f1' }, why: { b: 'görsel yok' }, at: '2026-11-27' }, ['a', 'b', 'c']);
  assert.deepEqual(g.vals, { a: 'A', b: '?' });
  assert.deepEqual(g.fp, { a: 'f1' }); assert.deepEqual(g.why, { b: 'görsel yok' });
  assert.equal(AI.normalizeGrouping({ cats: [] }), null);
});

test('sunucu sözleşmesi: kesintisiz (strict); istemde tüm modeller ve alanlar aynen yer alır', () => {
  const c = prompts.contractFor('presentation-grouping');
  assert.ok(c && c.strict && c.fields.assignments.items >= AI.LIMITS.batchModels + 10);
  const models = Array.from({ length: 30 }, (_, i) => AI.modelRecord('M' + (i + 1), 'BuyerLog-grouping-1.jpg', AI.fieldLines(Array.from({ length: 28 }, (_, j) => ({ label: 'Alan ' + j, value: `değer ${i}-${j} ` + 'y'.repeat(20) })))));
  const context = { mode: 'classify', categories: ['A', 'B'], models };
  assert.ok(JSON.stringify(context).length <= AI.LIMITS.batchChars + 2000);
  const built = prompts.buildPrompt({ source: 'presentation-grouping', task: 'Yaka tipine göre grupla', context, lang: 'tr' });
  assert.equal(built.truncated, false);
  for (const m of models) for (const f of m.fields) assert.ok(built.prompt.includes(f), 'alan istemde aynen');
  assert.match(built.prompt, /c=\?/);
  const parsed = prompts.parseStructured(JSON.stringify({ categories: ['A', 'B'], assignments: models.map(m => `k=${m.k}|c=A`), explanation: 'ok' }), 'presentation-grouping');
  assert.equal(parsed.ok, true); assert.equal(parsed.data.assignments.length, 30);
});

test('motor: kesilecek bağlam LCW AI\'a hiç gönderilmez (CONTEXT_TOO_LARGE); sığan bağlam gider', async () => {
  let sent = 0;
  const engine = createLcwAiEngine({ auth: {}, client: { sendMessage: async () => { sent++; return { text: '{"categories":["A"],"assignments":["k=M1|c=A"]}', modelKey: config.DEFAULT_MODEL }; } } });
  const big = { mode: 'plan', models: [{ k: 'M1', image: 'none', fields: ['x'.repeat(config.LIMITS.maxContextStringChars + 1)] }] };
  await assert.rejects(engine.ask('demo', { source: 'presentation-grouping', task: 'grupla', context: big }), e => e.code === 'LCWAI_CONTEXT_TOO_LARGE');
  const many = { mode: 'plan', models: Array.from({ length: config.LIMITS.maxContextArrayItems + 1 }, (_, i) => ({ k: 'M' + i, image: 'none', fields: [] })) };
  await assert.rejects(engine.ask('demo', { source: 'presentation-grouping', task: 'grupla', context: many }), e => e.code === 'LCWAI_CONTEXT_TOO_LARGE');
  const huge = { mode: 'plan', models: Array.from({ length: 60 }, (_, i) => ({ k: 'M' + i, image: 'none', fields: Array.from({ length: 2 }, () => 'z'.repeat(1500)) })) };
  await assert.rejects(engine.ask('demo', { source: 'presentation-grouping', task: 'grupla', context: huge }), e => e.code === 'LCWAI_CONTEXT_TOO_LARGE');
  assert.equal(sent, 0, 'hiçbiri gönderilmedi');
  const ok = await engine.ask('demo', { source: 'presentation-grouping', task: 'grupla', context: { mode: 'plan', models: [{ k: 'M1', image: 'none', fields: ['Model: A'] }] } });
  assert.equal(sent, 1); assert.deepEqual(ok.data.assignments, ['k=M1|c=A']);
  // Diğer kaynaklarda eski davranış (kısaltıp gönderme) değişmez.
  await engine.ask('demo', { source: 'excel-import', task: 'x', context: big });
  assert.equal(sent, 2);
});

/* Sahte LCW AI: istemdeki modelleri okur, kurala göre cevap verir; davranış senaryoya göre bozulur. */
function fakeRun({ n = 70, images = id => (Number(id.slice(1)) % 5 ? `/img/${id}.png` : null), ask, failDraw = () => false } = {}) {
  const ids = Array.from({ length: n }, (_, i) => 'r' + i);
  const calls = [], uploads = [];
  return {
    ids, calls, uploads,
    opts: {
      ids, question: 'Yaka tipine göre ayır',
      recordOf: id => [{ label: 'Model', value: 'MODEL-' + id }, { label: 'Ürün grubu', value: Number(id.slice(1)) % 2 ? 'Sweatshirt' : 'Hoodie' }],
      imageOf: images,
      drawSheets: async list => { const ok = list.filter(x => !failDraw(x.id)), out = []; for (let i = 0; i < ok.length; i += 12) out.push({ name: `BuyerLog-grouping-${out.length + 1}.jpg`, blob: { size: 1 }, ids: ok.slice(i, i + 12).map(x => x.id) }); return out; },
      upload: async (blob, name) => { uploads.push(name); return { fileId: 'f' + uploads.length }; },
      ask: async payload => { calls.push(payload); return ask(payload, calls.length); },
    },
  };
}
const answer = (payload, cats, pick = m => (m.fields.some(f => f.includes('Hoodie')) ? cats[0] : cats[1])) => ({
  data: { categories: payload.context.mode === 'plan' ? cats : payload.context.categories, assignments: payload.context.models.map(m => `k=${m.k}|c=${pick(m)}|r=test`) },
});

test('çalıştırıcı: önce örnekle kategori planı, sonra tüm modeller; her model tam bir kez, görselli olanlar paftada', async () => {
  const f = fakeRun({ ask: p => answer(p, ['Kapüşonlu', 'Bisiklet yaka']) });
  const r = await AI.runGrouping(f.opts);
  assert.equal(r.stopped, null);
  assert.deepEqual(r.cats, ['Kapüşonlu', 'Bisiklet yaka']);
  assert.equal(Object.keys(r.vals).length, 70); assert.deepEqual(r.failed, {});
  assert.equal(f.calls[0].context.mode, 'plan'); assert.ok(f.calls.slice(1).every(c => c.context.mode === 'classify' && c.context.categories.length === 2));
  const sent = f.calls.flatMap(c => c.context.models.map(m => m.fields[0]));
  assert.equal(new Set(sent).size, 70, 'her model gönderildi');
  for (const c of f.calls) {
    assert.ok(c.context.models.length <= AI.LIMITS.batchModels);
    for (const m of c.context.models) assert.equal(m.image === 'none', !f.opts.imageOf('r' + m.fields[0].split('-r')[1]), 'görseli olmayan "none", olan pafta adıyla');
    assert.ok(c.attachments.length <= 5);
  }
  assert.equal(r.noImage.length, 14);
});

test('çalıştırıcı: eksik/geçersiz cevap bir kez yeniden sorulur, yine gelmezse tahmin edilmez (tamamlanamadı)', async () => {
  const f = fakeRun({ n: 20, ask: (p, n) => {
    const out = answer(p, ['A', 'B']);
    if (p.context.mode === 'classify') out.data.assignments = out.data.assignments.filter(l => !/k=M(1|2)\|/.test(l) || n > 1).map(l => l.replace(/k=M3\|c=\w+/, 'k=M3|c=Polo'));
    return out;
  } });
  f.opts.cats = ['A', 'B'];
  const r = await AI.runGrouping(f.opts);
  assert.equal(f.calls.length, 2, 'ilk paket + eksikler için bir tekrar');
  assert.deepEqual(Object.keys(r.failed).sort(), ['r2'], 'kategorisi geçersiz model iki denemede de tamamlanamadı');
  assert.equal(Object.keys(r.vals).length, 19);
});

test('çalıştırıcı: sunucu "sığmıyor" ya da "kesildi" derse paket ikiye bölünür; tek model de sığmazsa tamamlanamadı', async () => {
  const f = fakeRun({ n: 30, ask: p => {
    if (p.context.models.length > 8) throw Object.assign(new Error('x'), { code: 'LCWAI_CONTEXT_TOO_LARGE' });
    if (p.context.models.some(m => m.fields[0] === 'Model: MODEL-r29')) return { truncated: true, data: null };
    return answer(p, ['A', 'B']);
  } });
  f.opts.cats = ['A', 'B'];
  const r = await AI.runGrouping(f.opts);
  assert.deepEqual(r.failed, { r29: 'too-large' });
  assert.equal(Object.keys(r.vals).length, 29);
  assert.ok(f.calls.every(c => c.context.models.length <= 30));
});

test('çalıştırıcı: iptal ya da kota hatasında o ana kadarki sonuç korunur, kalanlar nedeniyle listelenir', async () => {
  const controller = new AbortController();
  const f = fakeRun({ n: 90, ask: (p, n) => { if (n === 2) controller.abort(); if (n === 3) throw Object.assign(new Error('q'), { code: 'LCWAI_QUOTA_EXCEEDED' }); return answer(p, ['A', 'B']); } });
  f.opts.cats = ['A', 'B']; f.opts.signal = controller.signal;
  const r = await AI.runGrouping(f.opts);
  assert.equal(r.stopped.code, 'LCWAI_CANCELLED');
  assert.equal(Object.keys(r.vals).length, 60);
  assert.equal(Object.keys(r.failed).length, 30); assert.ok(Object.values(r.failed).every(v => v === 'LCWAI_CANCELLED'));
  const g = fakeRun({ n: 90, ask: (p, n) => { if (n === 2) throw Object.assign(new Error('q'), { code: 'LCWAI_QUOTA_EXCEEDED' }); return answer(p, ['A', 'B']); } });
  g.opts.cats = ['A', 'B'];
  const r2 = await AI.runGrouping(g.opts);
  assert.equal(r2.stopped.code, 'LCWAI_QUOTA_EXCEEDED'); assert.equal(Object.keys(r2.vals).length, 30); assert.equal(Object.keys(r2.failed).length, 60);
});

test('çalıştırıcı: okunamayan görsel modeli düşürmez; model yalnız bilgileriyle gönderilir ve listelenir', async () => {
  const f = fakeRun({ n: 12, images: id => `/img/${id}.png`, failDraw: id => id === 'r3', ask: p => answer(p, ['A', 'B']) });
  f.opts.cats = ['A', 'B'];
  const r = await AI.runGrouping(f.opts);
  assert.deepEqual(r.noImage, ['r3']);
  assert.equal(Object.keys(r.vals).length, 12);
  assert.equal(f.calls[0].context.models.find(m => m.fields[0] === 'Model: MODEL-r3').image, 'none');
});

test('tam kayıt: tablo sütunu 300 karakterde kesilmez, ağır sütun atılmaz; boş değer atlanır', () => {
  const OS = require('../public/lcwai-output-source.js');
  const long = 'Açıklama '.repeat(120).trim();
  const rows = [{ _id: 'r1', modelKod: 'NBA-2-YD', note: long, empty: '' }];
  const columns = [{ key: 'note', label: 'Tasarım notu', readValue: r => r.note }, { key: 'empty', label: 'Boş', readValue: r => r.empty }];
  const built = OS.build({ module: 'collection', rows, rowId: r => r._id, columns });
  const rec = Object.values(built.records)[0];
  assert.ok(rec.values['col.note'].length <= 300, 'tablo verisi sunum için kısaltılır');
  const full = OS.fullRecord({ module: 'collection', row: rows[0], columns });
  assert.equal(full.find(f => f.label === 'Tasarım notu').value, long, 'LCW AI için tam değer');
  assert.ok(full.some(f => f.value === 'NBA-2-YD'));
  assert.ok(!full.some(f => f.label === 'Boş'));
  const lines = AI.fieldLines(full);
  assert.equal(lines.filter(l => l.startsWith('Tasarım notu')).map(l => l.replace(/^Tasarım notu( \(devam\))?: /, '')).join(''), long);
});
