'use strict';

/*
 * LCW AI Çıktı Düzenleyici + çıktı şablonları (kişisel / ekip).
 *
 * Korunan davranışlar:
 *  - Her AI çıktısı düzenlenebilir bir taslak bırakır; taslak yalnız sahibine
 *    açılır, düzenleme AYNI doğrulayıcıdan geçer ve yeni dosya üretir.
 *  - Uzun tablo / uzun hücre (kumaş, kompozisyon) KESİLMEZ: PPTX'te devam
 *    slaytlarına bölünür.
 *  - Şablon iş verisi taşımaz (yalnız yapı); ekip şablonunu yalnız sahibi ya
 *    da moderatör değiştirir; sohbetteki şablon sunucudaki depodan okunur.
 *  - Rapor HTML'i düzenleyicide betiksiz, CSP'li iframe'de çizilir.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const XLSX = require('xlsx');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'server', 'lib', 'lcwai-output');
const contracts = require(path.join(OUT, 'output-contracts'));
const userTemplates = require(path.join(OUT, 'output-user-templates'));
const { renderPresentation, expandSlides } = require(path.join(OUT, 'output-pptx'));
const { createOutputService } = require(path.join(OUT, 'output-service'));
const { createDraftStore } = require(path.join(OUT, 'output-drafts'));

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bl-ai-edit-'));
const unzip = buffer => {
  const cfb = XLSX.CFB.read(buffer, { type: 'buffer' });
  const files = {};
  cfb.FullPaths.forEach((name, index) => { const entry = cfb.FileIndex[index]; if (entry && entry.type === 2) files[name.replace(/^Root Entry\//, '')] = Buffer.from(entry.content).toString('utf8'); });
  return files;
};
function fakeEngine(answers) {
  const calls = [];
  return {
    calls,
    async chat(owner, input) {
      calls.push(input);
      const text = answers[Math.min(calls.length - 1, answers.length - 1)];
      return { requestId: 'r1', chatId: 'chat-1', text, model: { key: 'gpt-6-sol', label: 'GPT-6 Sol' }, finishReason: 'stop', modules: [] };
    },
  };
}
const FABRIC = '%62 Pamuk %33 Polyester %5 Elastan — 30/1 penye süprem, enzim yıkamalı, boyalı; çekmezlik testi A sınıfı, gramaj 180 gr/m², en 185 cm, Türkiye menşeli iplik';
const DECK = JSON.stringify({
  title: 'Kumaş Durumu', slides: [
    { layout: 'table', title: 'Kumaş Detayları', table: { columns: ['Model', 'Kumaş', 'Termin'], rows: Array.from({ length: 30 }, (_, i) => [`MDL-${i + 1}`, FABRIC, '15.11.2026']) } },
    { layout: 'bullets', title: 'Notlar', bullets: ['İplik tedariki takipte'] },
  ],
});
const REPORT = '```html\n<h1>Haftalık Rapor</h1><section class="bl-section"><h2>Özet</h2><div class="bl-kpis"><div class="bl-kpi ok"><span class="bl-kpi-label">Model</span><span class="bl-kpi-value">148</span></div></div><p>' + 'Sezon hedefte ilerliyor. '.repeat(5) + '</p></section><section class="bl-section"><h2>Kumaş Listesi</h2><table><thead><tr><th>Model</th><th>Kumaş</th></tr></thead><tbody><tr><td>MDL-1</td><td>Süprem</td></tr></tbody></table><img data-bl-image="KOL-1" alt="MDL-1"></section>\n```';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/* ---------------- Kısaltma yok: uzun tablo devam slaytına bölünür ---------------- */
test('PPTX: uzun tablo kesilmez, devam slaytlarına bölünür; uzun kumaş metni tam kalır', () => {
  const deck = contracts.parseOutput('pptx', DECK, { lang: 'tr' });
  assert.equal(deck.ok, true, deck.errors.join());
  const table = deck.data.slides[1].table;
  assert.equal(table.rows.length, 30, '30 satırın tamamı korunur (eskiden 12)');
  assert.equal(table.rows[0][1], FABRIC, 'uzun kumaş metni kısaltılmaz (eskiden 80 karakter)');
  const expanded = expandSlides(deck.data.slides);
  const parts = expanded.filter(slide => slide.layout === 'table');
  assert.ok(parts.length > 1, 'tablo birden çok slayta bölünür');
  assert.equal(parts.reduce((sum, slide) => sum + slide.table.rows.length, 0), 30, 'hiçbir satır kaybolmaz');
  assert.match(parts[0].title, /^Kumaş Detayları \(1\/\d+\)$/);
  const files = unzip(renderPresentation(deck.data, { lang: 'tr', date: new Date('2026-10-07T10:00:00Z') }));
  const slideXml = Object.keys(files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).map(name => files[name]).join('');
  assert.ok(slideXml.includes('%62 Pamuk %33 Polyester %5 Elastan'), 'metin dosyada tam');
  assert.ok(slideXml.includes('Türkiye menşeli iplik'));
  // Sözleşme talimatı kısaltmayı yasaklar.
  const instruction = contracts.buildInstruction({ format: 'pptx', template: require(path.join(OUT, 'output-templates')).TEMPLATES.general, lang: 'tr' });
  assert.match(instruction, /kumaş, kompozisyon[^.]*olduğu gibi ve TAM aktar/);
  assert.match(instruction, /Uzun tabloyu kesme/);
});

/* ---------------- Taslak: düzenle → yeniden oluştur ---------------- */
test('taslak: her çıktı düzenlenebilir taslak bırakır; düzenleme yeniden doğrulanıp YENİ dosya olur; sahip izolasyonu', async () => {
  const dir = tempDir();
  const service = createOutputService({ engine: fakeEngine([DECK]), storeOptions: { root: path.join(dir, 'ai-outputs') } });
  const created = await service.create('u1', { message: 'kumaş sunumu', output: { format: 'pptx' } });
  assert.match(created.output.draftId, /^[a-f0-9]{24}$/);
  assert.equal(created.output.edited, false);
  const draft = service.getDraft('u1', created.output.draftId);
  assert.equal(draft.format, 'pptx');
  assert.equal(draft.data.slides[1].table.rows.length, 30);
  assert.deepEqual(draft.imageKeys, [], 'görsel anahtarı listesi (Yerleşim önizlemesi için)');
  assert.throws(() => service.getDraft('u2', created.output.draftId), error => error.code === 'LCWAI_OUTPUT_NOT_FOUND', 'başka kullanıcı taslağı göremez');
  assert.throws(() => service.getDraft('u1', '../../etc/passwd'), error => error.code === 'LCWAI_OUTPUT_NOT_FOUND');

  const edited = JSON.parse(JSON.stringify(draft.data));
  edited.slides[1].title = 'Kumaş Detayları (revize)';
  edited.slides.push({ layout: 'kpis', title: 'Özet', kpis: [{ label: 'Model', value: '30', tone: 'ok' }] });
  const result = service.renderDraft('u1', created.output.draftId, { data: edited, title: 'Kumaş Durumu v2' });
  assert.equal(result.output.edited, true);
  assert.equal(result.output.draftId, created.output.draftId);
  assert.notEqual(result.output.id, created.output.id, 'yeni dosya');
  assert.ok(fs.existsSync(created.output.path), 'eski dosya korunur');
  assert.match(result.output.fileName, /^Kumaş Durumu v2 - .*\.pptx$/);
  const files = unzip(fs.readFileSync(result.output.path));
  assert.ok(Object.values(files).some(xml => xml.includes('Kumaş Detayları (revize)')));
  const again = service.getDraft('u1', created.output.draftId);
  assert.equal(again.revision, 2);
  assert.equal(again.title, 'Kumaş Durumu v2');

  // Geçersiz düzenleme: Buyer Log'un kendi doğrulama sorunlarıyla 422.
  assert.throws(() => service.renderDraft('u1', created.output.draftId, { data: { slides: [{ layout: 'table', table: { columns: [] } }] } }), error => error.code === 'LCWAI_OUTPUT_EDIT_INVALID' && error.issues.length > 0);
  assert.throws(() => service.renderDraft('u1', created.output.draftId, {}), error => error.code === 'LCWAI_OUTPUT_EDIT_INVALID');
  const { publicError } = require('../server/lib/lcwai/lcwai-errors');
  try { service.renderDraft('u1', created.output.draftId, { data: { slides: [] } }); } catch (error) { assert.ok(Array.isArray(publicError(error).issues)); }
});

test('taslak: rapor düzenlemesi yeniden temizlenir; görseller taslakta saklanıp tekrar istenmez; PDF kaydı taslağa bağlıdır', async () => {
  const dir = tempDir();
  const service = createOutputService({ engine: fakeEngine([REPORT]), storeOptions: { root: path.join(dir, 'ai-outputs') } });
  const created = await service.create('u1', { message: 'rapor', output: { format: 'html' } });
  assert.equal(created.output.pending, 'images');
  assert.ok(created.output.draftId);
  const record = service.completeImages('u1', created.output.pendingId, { 'KOL-1': PNG });
  assert.equal(record.imagesUsed, 1);
  const draft = service.getDraft('u1', created.output.draftId);
  assert.equal(draft.images['KOL-1'].startsWith('data:image/png;base64,'), true, 'görsel taslakta');
  assert.match(draft.previewCss, /\.bl-report/, 'önizleme için tema CSS');
  assert.deepEqual(draft.imageKeys, ['KOL-1']);

  const body = draft.data.body.replace('Kumaş Listesi', 'Kumaş Listesi (güncel)') + '<script>alert(1)</script><p onclick="x()">ek not</p>';
  const result = service.renderDraft('u1', created.output.draftId, { data: { body, styles: draft.data.styles } });
  const html = fs.readFileSync(result.output.path, 'utf8');
  assert.match(html, /Kumaş Listesi \(güncel\)/);
  assert.doesNotMatch(html, /<script|onclick/);
  assert.match(html, /data:image\/png;base64,/, 'görsel taslaktan gömülür');
  assert.match(html, /Content-Security-Policy/);

  const pdf = createOutputService({ engine: fakeEngine([REPORT.replace(/<img[^>]*>/, '')]), storeOptions: { root: path.join(dir, 'ai-outputs') } });
  const first = await pdf.create('u1', { message: 'rapor', output: { format: 'pdf' } });
  const pending = pdf.renderDraft('u1', first.output.draftId, { data: pdf.getDraft('u1', first.output.draftId).data, orientation: 'landscape' });
  assert.equal(pending.output.pending, 'pdf');
  assert.equal(pending.output.landscape, true);
  const saved = pdf.completePdf('u1', pending.output.pendingId, Buffer.from('%PDF-1.7\n'.padEnd(120, 'x')));
  assert.equal(saved.draftId, first.output.draftId);
  assert.equal(saved.edited, true);
  assert.throws(() => pdf.renderDraft('u1', first.output.draftId, { data: { body: '<script>x</script>' } }), error => error.code === 'LCWAI_OUTPUT_EDIT_INVALID');
});

test('taslak deposu: kullanıcı başına üst sınır, bozuk kimlik reddi', () => {
  const store = createDraftStore({ root: tempDir() });
  const ids = Array.from({ length: 45 }, (_, i) => store.create('u1', { format: 'xlsx', data: { i } }));
  const kept = ids.filter(id => store.get('u1', id));
  assert.ok(kept.length <= require(path.join(OUT, 'output-drafts')).MAX_PER_OWNER);
  assert.ok(store.get('u1', ids[44]), 'en yeni taslak korunur');
  assert.equal(store.get('u1', 'x'), null);
  assert.equal(store.get('u2', ids[44]), null);
});

/* ---------------- Şablonlar: yalnız yapı, veri yok ---------------- */
test('şablon iskeleti iş verisi taşımaz; talimat yapıyı, tam alanları ve ek talimatı taşır', () => {
  const deck = contracts.parseOutput('pptx', DECK, { lang: 'tr' }).data;
  const skeleton = userTemplates.skeletonFromData('pptx', deck);
  assert.deepEqual(skeleton.map(item => item.kind), ['table', 'bullets']);
  assert.deepEqual(skeleton[0].columns.map(column => column.name), ['Model', 'Kumaş', 'Termin']);
  assert.doesNotMatch(JSON.stringify(skeleton), /MDL-1|Pamuk|15\.11\.2026|İplik tedariki/, 'satır/madde değeri iskelete girmez');

  const workbook = contracts.normalizeWorkbook({ title: 'Liste', kpis: [{ label: 'Toplam', value: 42 }], sheets: [{ name: 'Siparişler', columns: [{ header: 'PO', type: 'text' }, { header: 'Adet', type: 'integer' }], rows: [['PO-77', 1200]] }] }).data;
  const xlsxSkeleton = userTemplates.skeletonFromData('xlsx', workbook);
  assert.deepEqual(xlsxSkeleton.map(item => item.kind), ['summary', 'sheet']);
  assert.deepEqual(xlsxSkeleton[1].columns, [{ name: 'PO' }, { name: 'Adet', type: 'integer' }]);
  assert.doesNotMatch(JSON.stringify(xlsxSkeleton), /PO-77|1200|42/);

  const html = contracts.parseOutput('pdf', REPORT).data;
  const htmlSkeleton = userTemplates.skeletonFromData('pdf', html);
  assert.deepEqual(htmlSkeleton.map(item => item.title), ['Özet', 'Kumaş Listesi']);
  assert.deepEqual(htmlSkeleton[0].parts, ['text', 'kpis']);
  assert.ok(htmlSkeleton[1].parts.includes('table') && htmlSkeleton[1].parts.includes('images'));
  assert.doesNotMatch(JSON.stringify(htmlSkeleton), /148|MDL-1|Süprem/);

  assert.equal(userTemplates.normalizeDefinition({ format: 'docx' }), null);
  const def = userTemplates.normalizeDefinition({ format: 'pptx', detail: 'x', keepFull: ['Kumaş', 'Kumaş', ' Kompozisyon '], structure: [...skeleton, { kind: 'nope', title: 'Ek' }], instructions: 'Termin sırasına göre diz.' });
  assert.equal(def.detail, 'standard');
  assert.deepEqual(def.keepFull, ['Kumaş', 'Kompozisyon']);
  assert.equal(def.structure[2].kind, 'bullets');
  const tr = userTemplates.templateInstruction(def, { name: 'Haftalık Kumaş', lang: 'tr' });
  assert.match(tr, /KULLANICI ŞABLONU: «Haftalık Kumaş»/);
  assert.match(tr, /1\. Tablo \(layout: table\): Kumaş Detayları — sütunlar: Model \| Kumaş \| Termin/);
  assert.match(tr, /asla kısaltma[^:]*: Kumaş, Kompozisyon/);
  assert.match(tr, /Termin sırasına göre diz\./);
  assert.match(userTemplates.templateInstruction(def, { name: 'Weekly', lang: 'en' }), /Never shorten, summarise or paraphrase these fields/);
});

test('servis: kullanıcı şablonu sözleşmenin sonuna eklenir; etiket şablon adıdır', async () => {
  const engine = fakeEngine([DECK]);
  const service = createOutputService({ engine, storeOptions: { root: path.join(tempDir(), 'ai-outputs') } });
  const definition = { format: 'pptx', keepFull: ['Kumaş'], structure: [{ kind: 'table', title: 'Kumaş Detayları', columns: ['Model', 'Kumaş'] }] };
  const result = await service.create('u1', { message: 'haftalık', output: { format: 'pptx', userTemplate: { name: 'Haftalık Kumaş', definition } } });
  const sent = engine.calls[0].outputInstruction;
  assert.ok(sent.indexOf('ÇIKTI SÖZLEŞMESİ') < sent.indexOf('KULLANICI ŞABLONU'), 'şablon sözleşmeden sonra');
  assert.match(sent, /sütunlar: Model \| Kumaş/);
  assert.equal(result.output.templateLabel, 'Haftalık Kumaş');
});

/* ---------------- Route'lar: şablon CRUD, paylaşım, yetki ---------------- */
function memoryTemplateStore() {
  const files = new Map();
  let seq = 0;
  const key = userId => String(userId || 'shared');
  const load = userId => ({ items: (files.get(key(userId)) || []).map(item => JSON.parse(JSON.stringify(item))) });
  return {
    load,
    add(userId, name, data) { const list = files.get(key(userId)) || []; list.push({ id: `p${++seq}`, name, data, userId: userId || null, updatedAt: '2026-10-07T00:00:00Z' }); files.set(key(userId), list); },
    update(userId, id, data, revision, name) { const list = files.get(key(userId)) || []; const item = list.find(entry => entry.id === id); if (!item) throw new Error('missing'); item.data = data; if (name) item.name = name; },
    remove(userId, id) { files.set(key(userId), (files.get(key(userId)) || []).filter(entry => entry.id !== id)); },
  };
}

test('routes: şablon kaydet/paylaş/kopyala/sil; ekip şablonunu yalnız sahibi ya da moderatör siler; sohbet şablonu depodan okur', async () => {
  const express = require('express');
  const app = express();
  let user = { id: 'u1', displayName: 'Ayşe' };
  app.use((req, res, next) => { req.currentUser = user; next(); });
  const engine = fakeEngine([DECK]);
  const service = createOutputService({ engine, storeOptions: { root: path.join(tempDir(), 'ai-outputs') } });
  const audits = [];
  require('../server/routes/lcwai-routes')(app, {
    express, engine, outputService: service, outputTemplates: memoryTemplateStore(),
    userAccess: { appendAudit: (...args) => audits.push(args), hasPermission: (profile, key) => key === 'manageAllOrders' && profile.id === 'mod' },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body) => (await fetch(`${base}${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: body == null ? undefined : JSON.stringify(body) })).json();
  try {
    const definition = { format: 'pptx', keepFull: ['Kumaş'], structure: [{ kind: 'table', title: 'Kumaş Detayları', columns: ['Model', 'Kumaş'] }] };
    assert.equal((await call('POST', '/api/lcwai/output-templates', { name: '', definition })).code, 'LCWAI_OUTPUT_TEMPLATE_INVALID');
    let lists = await call('POST', '/api/lcwai/output-templates', { name: 'Haftalık Kumaş', definition });
    assert.equal(lists.personal.length, 1);
    assert.equal(lists.shared.length, 0);
    const mine = lists.personal[0];
    lists = await call('POST', `/api/lcwai/output-templates/${mine.id}/share`, {});
    assert.equal(lists.shared.length, 1, 'paylaşım kopyalar');
    assert.equal(lists.personal.length, 1, 'kişisel kopya kalır');
    assert.equal(lists.shared[0].ownerName, 'Ayşe');
    assert.equal(lists.shared[0].mine, true);
    const team = lists.shared[0];
    const all = await call('GET', '/api/lcwai/output-templates');
    assert.ok(all.builtIn.some(item => item.key === 'executive'));

    // Başka kullanıcı: görür, kopyalar; değiştiremez/silemez.
    user = { id: 'u2', displayName: 'Mehmet' };
    lists = await call('GET', '/api/lcwai/output-templates');
    assert.equal(lists.personal.length, 0);
    assert.equal(lists.shared[0].canEdit, false);
    assert.equal((await call('DELETE', `/api/lcwai/output-templates/${team.id}?shared=1`)).code, 'LCWAI_OUTPUT_TEMPLATE_FORBIDDEN');
    assert.equal((await call('PUT', `/api/lcwai/output-templates/${team.id}?shared=1`, { name: 'x' })).code, 'LCWAI_OUTPUT_TEMPLATE_FORBIDDEN');
    lists = await call('POST', `/api/lcwai/output-templates/${team.id}/copy`, {});
    assert.equal(lists.personal.length, 1);
    assert.equal(lists.personal[0].name, 'Haftalık Kumaş');

    // Sohbet: istemcinin gönderdiği tanım değil, depodaki şablon kullanılır.
    const text = await (await fetch(`${base}/api/lcwai/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'haftalık', output: { format: 'xlsx', userTemplate: { id: team.id, shared: true, definition: { format: 'xlsx', instructions: 'SAHTE' } } } }) })).text();
    const result = text.trim().split('\n').map(line => JSON.parse(line)).at(-1);
    assert.equal(result.type, 'result', JSON.stringify(result));
    assert.equal(result.result.output.format, 'pptx', 'biçim şablondan gelir');
    const sent = engine.calls.at(-1).outputInstruction;
    assert.match(sent, /KULLANICI ŞABLONU: «Haftalık Kumaş»/);
    assert.doesNotMatch(sent, /SAHTE/);
    const missing = (await (await fetch(`${base}/api/lcwai/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'x', output: { format: 'pptx', userTemplate: { id: 'nope', shared: true } } }) })).text()).trim().split('\n').map(line => JSON.parse(line)).at(-1);
    assert.equal(missing.error.code, 'LCWAI_OUTPUT_TEMPLATE_NOT_FOUND');

    // Taslak uçları: sahip izolasyonu + düzenleme doğrulaması.
    const draftId = result.result.output.draftId;
    assert.equal((await call('GET', `/api/lcwai/output-drafts/${draftId}`)).draft.format, 'pptx');
    const skeleton = await call('POST', `/api/lcwai/output-drafts/${draftId}/skeleton`, {});
    assert.deepEqual(skeleton.definition.structure.map(item => item.kind), ['table', 'bullets']);
    const bad = await call('POST', `/api/lcwai/output-drafts/${draftId}/render`, { data: { slides: [] } });
    assert.equal(bad.code, 'LCWAI_OUTPUT_EDIT_INVALID');
    assert.ok(Array.isArray(bad.issues));
    const draft = (await call('GET', `/api/lcwai/output-drafts/${draftId}`)).draft;
    const rendered = await call('POST', `/api/lcwai/output-drafts/${draftId}/render`, { data: draft.data, title: 'Yeni' });
    assert.equal(rendered.ok, true);
    assert.equal(rendered.output.edited, true);
    user = { id: 'u1', displayName: 'Ayşe' };
    assert.equal((await call('GET', `/api/lcwai/output-drafts/${draftId}`)).code, 'LCWAI_OUTPUT_NOT_FOUND', 'başkasının taslağı açılmaz');

    // Moderatör ekip şablonunu silebilir.
    user = { id: 'mod', displayName: 'Moderatör' };
    lists = await call('DELETE', `/api/lcwai/output-templates/${team.id}?shared=1`);
    assert.equal(lists.shared.length, 0);
    assert.ok(audits.every(([, action, , details]) => /^LCWAI_/.test(action) && !JSON.stringify(details).includes('Kumaş')), 'audit şablon içeriği yazmaz');
  } finally { server.close(); }
});

test('db: çıktı şablonları kişisel ve ortak (senkronlu) profil deposunda; ayrı tür', () => {
  const dir = tempDir();
  const script = `
    const db = require(${JSON.stringify(path.join(ROOT, 'server', 'db'))});
    db.addAiOutputTemplate('u1', 'Kişisel', { definition: { format: 'pptx' } }, null);
    db.addAiOutputTemplate(null, 'Ekip', { definition: { format: 'xlsx' } }, null);
    const personal = db.loadAiOutputTemplates('u1');
    const shared = db.loadAiOutputTemplates(null);
    require('node:fs').writeSync(1,JSON.stringify({ kind: personal.kind, personal: personal.items.map(item => item.name), shared: shared.items.map(item => item.name), views: db.loadViews ? 'ok' : '' }));
    setTimeout(() => process.exit(0), 50);`;
  const run = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, BUYER_LOG_SERVER_DATA_ROOT: dir, BUYER_LOG_DATA_ROOT: path.join(dir, 'app'), BUYER_LOG_LOCAL_DATA_ROOT: path.join(dir, 'local') }, encoding: 'utf8', timeout: 60000 });
  const line = String(run.stdout || '').split('\n').find(text => text.startsWith('{'));
  assert.ok(line, run.stderr || run.stdout);
  const out = JSON.parse(line);
  assert.equal(out.kind, 'aiOutputTemplate');
  assert.deepEqual(out.personal, ['Kişisel']);
  assert.deepEqual(out.shared, ['Ekip']);
  assert.ok(fs.existsSync(path.join(dir, 'ai-output-templates.json')), 'ekip şablonları ortak dosyada');
  assert.ok(fs.existsSync(path.join(dir, 'user-profiles', 'u1', 'ai-output-templates.json')), 'kişisel şablon kullanıcı klasöründe');
});

/* ---------------- Arayüz kaynak sözleşmesi ---------------- */
test('arayüz: düzenleyici tembel yüklenir; rapor iframe’i betiksiz + CSP; Düzenle/Şablonlar/şablon seçici; TR/EN', () => {
  const editor = fs.readFileSync(path.join(ROOT, 'public', 'lcwai-output-editor.js'), 'utf8');
  assert.match(editor, /sandbox="allow-same-origin"/);
  assert.doesNotMatch(editor, /sandbox="[^"]*allow-scripts/, 'önizlemede betik çalışmaz');
  assert.match(editor, /script-src 'none'/);
  assert.match(editor, /iframe\.srcdoc = reportSrcdoc/);
  assert.doesNotMatch(editor, /insertAdjacentHTML\([^)]*body|document\.write/, 'rapor HTML’i ana belgeye yazılmaz');
  assert.match(editor, /img\.removeAttribute\('src'\)/, 'önizleme görselleri gövdeye geri yazılmaz');
  assert.equal((editor.match(/setAttribute\('data-no-i18n', ''\)/g) || []).length, 3, 'sözlük katmanı kullanıcı verisini (başlık/sütun/şablon adı) çevirmez');
  for (const text of ["L('Dosyayı Oluştur', 'Create File')", "L('Şablon olarak kaydet', 'Save as template')", "L('Ekiple paylaş', 'Share with the team')", "L('Kısaltılmayacak alanlar', 'Fields never to shorten')", "L('Kopyasını al', 'Make a copy')"]) assert.ok(editor.includes(text), text);
  const chat = fs.readFileSync(path.join(ROOT, 'public', 'lcwai-chat.js'), 'utf8');
  assert.match(chat, /data-file-edit=/);
  assert.match(chat, /data-output-template /);
  assert.match(chat, /data-output-templates /);
  assert.match(chat, /ensureFeature\('lcwaiOutputEditor'\)/);
  assert.match(chat, /request\.userTemplate = \{ id: chosen\.item\.id, shared: chosen\.kind === 'team' \}/, 'yalnız kimlik gönderilir');
  const perf = fs.readFileSync(path.join(ROOT, 'public', 'perf-runtime.js'), 'utf8');
  assert.match(perf, /X/, 'yerleşim modülü düzenleyiciden önce');
  const index = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert.doesNotMatch(index, /lcwai-output-editor\.js/, 'açılışta yüklenmez');
  const assistant = fs.readFileSync(path.join(ROOT, 'public', 'lcwai-assistant.js'), 'utf8');
  for (const code of ['LCWAI_OUTPUT_EDIT_INVALID', 'LCWAI_OUTPUT_TEMPLATE_NOT_FOUND', 'LCWAI_OUTPUT_TEMPLATE_INVALID', 'LCWAI_OUTPUT_TEMPLATE_FORBIDDEN']) {
    assert.ok(assistant.includes(`${code}: { tr:`), code);
    assert.ok(require('../server/lib/lcwai/lcwai-errors').CODES[code.replace('LCWAI_', '')], code);
  }
  const renderDraft = assistant.slice(assistant.indexOf('async function renderDraft'), assistant.indexOf('const draftSkeleton'));
  assert.match(renderDraft, /finalizePdf\(result, onProgress\)/, 'PDF yine masaüstü kabuğunda basılır');
});

test('TSV yapıştırma ayrıştırıcısı: sekme/satır, tırnaklı çok satırlı hücre', () => {
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(ROOT, 'public', 'lcwai-output-editor.js'), 'utf8');
  const sandbox = { window: {}, document: { documentElement: { lang: 'tr' } } };
  vm.runInNewContext(source, sandbox);
  const parse = sandbox.window.BLOutputEditor._parseTsv;
  assert.deepEqual(JSON.parse(JSON.stringify(parse('A\tB\r\n1\t2\r\n'))), [['A', 'B'], ['1', '2']]);
  assert.deepEqual(JSON.parse(JSON.stringify(parse('"Pamuk\n%100"\tSüprem'))), [['Pamuk\n%100', 'Süprem']]);
  assert.deepEqual(JSON.parse(JSON.stringify(parse('"a ""b"""\tc'))), [['a "b"', 'c']]);
});
