'use strict';

/* v9.24 — AJAN DEĞİŞİKLİK ÖNEREBİLİYOR, AMA YAZMIYOR.
 *
 * V1'in son parçası. Yazma yeteneğini modele VERMEK yerine, modelin
 * üretebileceği en güçlü şeyi bir ÖNERİ ile sınırlıyoruz: ne değişecek, hangi
 * kayıtta, eski ve yeni değer ne. Uygulamayı kullanıcı onayı tetikler ve
 * Buyer Log'un mevcut kayıt yolu yapar — revizyon kontrolü (409), yetki ve
 * audit olduğu gibi çalışır.
 *
 * Bu, güvenliği bir KURALA değil MİMARİYE bağlar. İş verisi içindeki metin
 * (tedarikçi maili, not, içe aktarılan Excel) untrusted'dır; modelin oradaki
 * bir talimatı yanlışlıkla izlemesi hâlinde üretebileceği en kötü şey,
 * kullanıcının ekranda görüp reddedeceği bir karttır. Enjekte edilmiş bir
 * cümle veri silemez, çünkü silme yeteneği hiçbir zaman modelde değildir.
 *
 * AYRICA: regex tabanlı niyet ayıklama artık LLM'den SONRA çalışıyor. Eskiden
 * "3 numaralı siparişe not: ..." cümlesi modele hiç ulaşmıyor, dar bir desene
 * çarpıyordu — ajanın doğal dili serbestçe yorumlamasını engelleyen asıl yapı
 * buydu. Yollar silinmedi; modelsiz de çalıştıkları için yedek kaldılar.
 *
 * CANLI KOŞU (Ollama + qwen3:8b): ajan önce "note.add" diye olmayan bir eylem
 * uydurdu, action.catalog ile gerçek listeyi öğrendi, order.note.set ile
 * yeniden önerdi ve cevabında "yaptım" demek yerine onay istedi.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const copilot = require('../server/lib/copilot-agent');
const grounding = require('../public/copilot-grounding.js');
const copilotActions = require('../public/copilot-actions.js');
const { createToolRegistry } = require('../server/lib/agent-tool-registry');
const { createPolicyEngine } = require('../server/lib/agent-policy-engine');

const CLIENT = fs.readFileSync(path.join(__dirname, '..', 'public', 'copilot.js'), 'utf8');

const userAccess = { hasArea: (p, area) => (p && p.areas || []).includes(area), appendAudit() {} };
const profile = { id: 'u1', areas: ['cp', 'orders', 'koleksiyon', 'automations'] };
const tools = () => createToolRegistry({ userAccess, getDataset: async () => [], listDatasets: async () => [] });

/* ------------------------------------------------ 1) ÖNERİ, YAZMA DEĞİL */

test('v9.24 action.propose hiçbir şey yazmaz, öneri döndürür', async () => {
  const result = await tools().execute('action.propose',
    { action: 'order.note.set', payload: { orderCode: '1083191', note: 'Ex-factory gecikti' }, reason: 'takip' },
    { profile, ownerId: 'u1' });
  assert.equal(result.proposal.status, copilotActions.STATUS.PROPOSED);
  assert.equal(result.proposal.type, 'order.note.set');
  assert.deepEqual(result.proposal.preview.after, { orderCode: '1083191', note: 'Ex-factory gecikti' });
  // Öneri tek kullanımlık bir kimlik taşır: onay bu kimliğe verilir, böylece
  // kullanıcının GÖRDÜĞÜ önizleme ile uygulanan değişiklik aynı şey olur.
  assert.match(result.proposal.proposalId, /^copilot-/);
});

test('v9.24 eylem listesi istemciyle TEK kaynaktan paylaşılıyor', async () => {
  /* Sunucuda kopyalamak iki doğru yaratırdı: istemci bir eylemi tanır,
     sunucu tanımaz — ya da tersi. */
  const registrySource = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'agent-tool-registry.js'), 'utf8');
  assert.match(registrySource, /require\('\.\.\/\.\.\/public\/copilot-actions\.js'\)/);
  const catalog = await tools().execute('action.catalog', {}, { profile });
  assert.deepEqual(catalog.actions.map(a => a.id).sort(), Object.keys(copilotActions.ACTIONS).sort());
  // Her eylem zorunlu alanlarını bildirmeli, yoksa model alan uydurur.
  assert.ok(catalog.actions.every(a => Array.isArray(a.requiredFields) && a.requiredFields.length));
});

test('v9.24 model yeni bir yetenek uyduramaz', async () => {
  // Liste kapalı: burada olmayan bir eylem önerilemez.
  await assert.rejects(() => tools().execute('action.propose',
    { action: 'order.delete', payload: { orderCode: '1' } }, { profile, ownerId: 'u1' }),
    error => error && error.code === 'PROPOSAL_INVALID');
});

test('v9.24 eksik alan modele geri besleniyor, yetki reddi durduruyor', async () => {
  /* İkisi FARKLI: eksik alan düzeltilebilir bir hatadır, yetki bir sınırdır. */
  await assert.rejects(() => tools().execute('action.propose',
    { action: 'order.note.set', payload: { orderCode: '1' } }, { profile, ownerId: 'u1' }),
    error => error && error.code === 'PROPOSAL_INVALID' && /note/.test(error.message));
  await assert.rejects(() => tools().execute('action.propose',
    { action: 'collection.row.patch', payload: { rowId: '1', changes: 'x' } },
    { profile: { areas: ['cp'] }, ownerId: 'u1' }),
    error => error && error.code === 'AREA_FORBIDDEN');
  // Yetki reddi geri beslenmez: model başka bir yol deneyip kullanıcıyı
  // yanıltmamalı, kullanıcı yapamayacağını öğrenmeli.
  assert.ok(copilot.toolCatalog(tools()).length > 0);
});

/* --------------------------------------------- 2) ONAY KAPISI KULLANICIDA */

test('v9.24 öneri üretmek onay gerektirmez ama uygulamak gerektirir', () => {
  /* Araç seviyesinde onay istemek aynı kapıyı iki kez kurmak olurdu:
     öneri zaten atıl, gerçek kapı kullanıcının Onayla'ya basması. */
  const policy = createPolicyEngine({ userAccess });
  const decision = policy.evaluate(profile, { id: 'action.propose', risk: 'propose', area: '' }, {}, {});
  assert.equal(decision.allowed, true);
  assert.equal(decision.approvalRequired, false);
  // Gerçek yazma araçları hâlâ onaya bağlı.
  const write = policy.evaluate(profile, { id: 'app.order.update', risk: 'write', area: 'cp', approval: true }, {}, {});
  assert.equal(write.allowed, false);
  assert.equal(write.approvalRequired, true);
});

test('v9.24 onay yanlış öneriye verilemez', async () => {
  const proposal = (await tools().execute('action.propose',
    { action: 'order.note.set', payload: { orderCode: '1', note: 'x' } }, { profile, ownerId: 'u1' })).proposal;
  // Başka bir kimlikle onay reddedilmeli; aksi hâlde önizleme ile uygulanan
  // değişiklik ayrışabilirdi.
  const wrong = await copilotActions.apply(proposal, { proposalId: 'baska-id', confirmed: true }, { writers: {} });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.status, copilotActions.STATUS.REJECTED);
  // Onaylanmamış öneri de uygulanmamalı.
  const unconfirmed = await copilotActions.apply(proposal, { proposalId: proposal.proposalId, confirmed: false }, { writers: {} });
  assert.equal(unconfirmed.ok, false);
});

/* ------------------------------------------- 3) AJAN "YAPTIM" DEMİYOR */

test('v9.24 sistem promptu öneri ile uygulamayı ayırıyor', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'copilot-agent.js'), 'utf8');
  const block = source.slice(source.indexOf('function systemPrompt('), source.indexOf('function likelyBusinessFact'));
  assert.match(block, /You never write data yourself: you produce a proposal the user confirms/);
  assert.match(block, /never claim the change is done/);
  /* Eski satır "Never request or perform mutation" diyordu ve artık verilen
     öneri yeteneğiyle ÇELİŞİYORDU; model kendi yeteneğini yasaklıyordu. */
  assert.ok(!block.includes('Never request or perform mutation'));
  assert.match(block, /You cannot write data directly/);
});

test('v9.24 öneri turu gerçek iş sayılıyor', async () => {
  /* Saf öneri turunda hiçbir dataset.* aracı çağrılmaz; grounding kapısı bunu
     "araç kullanılmadı" sayıp turu düşürüyordu. */
  const assistant = copilot.createCopilotAssistant({
    providerFactory: () => {
      let i = 0;
      const turns = [
        { toolCalls: [{ id: 'call1', name: 'action__propose', args: { action: 'order.note.set', payload: { orderCode: '1083191', note: 'gecikti' } } }] },
        { content: '1083191 siparişi için not önerisi hazır, onayınızı bekliyorum.' },
      ];
      return {
        config: { provider: 'ollama', model: 'test' },
        async chat() {
          const turn = turns[Math.min(i++, turns.length - 1)];
          return { content: turn.content || '', toolCalls: turn.toolCalls || [], model: 'test' };
        },
      };
    },
  });
  const result = await assistant.respond({
    question: '1083191 numaralı siparişe not ekle: gecikti', ownerId: 'u1', profile,
    toolRegistry: tools(), policyEngine: createPolicyEngine({ userAccess }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].status, 'PROPOSED');
});

/* ------------------------------ 4) KULLANICININ KENDİ DEĞERİ UYDURMA DEĞİL */

test('v9.24 sorudaki değer cevapta geri söylenebiliyor', () => {
  /* "1083191 numaralı siparişe not ekle" dendiğinde ajanın o kodu geri
     söylemesi doğru davranıştır; doğrulayıcı onu araç sonuçlarında bulamayıp
     cevabı düşürüyordu. Kaynak kullanıcının kendi cümlesi, model değil. */
  const base = { answerable: true, toolResults: [{ rows: [{ manufacturer: 'Star Apparel' }] }] };
  const check = (answer, question) => grounding.validate(answer, { ...base, question }).problems;
  assert.deepEqual(check('1083191 siparişine not önerdim.', '1083191 numaralı siparişe not ekle'), []);
  assert.deepEqual(check('Nova Tekstil için öneri hazır.', 'Nova Tekstil siparişlerini incele'), []);
  // Gevşetme DAR: modelin uydurduğu bir değer soruda geçmez, hâlâ yakalanır.
  assert.equal(check('9999999 siparişine not önerdim.', '1083191 numaralı siparişe not ekle').length, 1);
  assert.equal(check('Gizli Tedarikci için öneri.', 'Nova Tekstil incele').length, 1);
  // Soru verilmezse davranış eskisi gibi katı kalır.
  assert.equal(check('1083191 siparişine not.', '').length, 1);
});

test('v9.24 uygulamanın kendi adı uydurma sayılmıyor', () => {
  const base = { answerable: true, toolResults: [{ rows: [{ manufacturer: 'Star Apparel' }] }] };
  assert.deepEqual(grounding.validate('Buyer Log verisine göre Star Apparel pahalı.', base).problems, []);
});

/* ------------------------------------- 5) SABİT INTENT ARTIK ÖNCE DEĞİL */

test('v9.24 ajan regex niyet ayıklamadan ÖNCE çalışıyor', () => {
  /* Asıl engel buydu: kullanıcının cümlesi modele ulaşmadan dar bir desene
     çarpıyordu. Artık önce ajan görüyor; desenler yedek. */
  /* v9.33'te gövde ask()'ten runAsk()'e taşındı (soru artık kuyruğa giriyor)
     ve çağrı bağlam alıyor. SIRA kuralı değişmedi: ajan önce görür. */
  const ask = CLIENT.slice(CLIENT.indexOf('async function runAsk(job,ctx)'), CLIENT.indexOf('async function applyPending'));
  const agentAt = ask.indexOf('askGeneralAssistant(question,');
  const automationAt = ask.indexOf('AUTOMATION_HINT.test(question');
  const writeAt = ask.indexOf('parseWriteIntent(question);');
  assert.ok(agentAt > 0 && automationAt > 0 && writeAt > 0);
  assert.ok(agentAt < automationAt, 'ajan otomasyon deseninden önce çalışmalı');
  assert.ok(agentAt < writeAt, 'ajan yazma deseninden önce çalışmalı');
  // Tek çağrı olmalı: eski konumdaki blok kaldırıldı, iki kez çalışmamalı.
  assert.equal((ask.match(/askGeneralAssistant\(question,/g) || []).length, 1);
});

test('v9.24 deterministic yollar SİLİNMEDİ, yedek olarak duruyor', () => {
  /* Model olmadan da çalışıyorlar; silmek çevrimdışı yeteneği yok ederdi. */
  assert.match(CLIENT, /function parseWriteIntent\(question\)/);
  assert.match(CLIENT, /function routeFor\(/);
  const ask = CLIENT.slice(CLIENT.indexOf('async function ask(question)'), CLIENT.indexOf('async function applyPending'));
  // Ajan hata verirse yedeklerden birine düşebilmeli.
  assert.match(ask, /const recoverable=AUTOMATION_HINT\.test\([\s\S]*?parseWriteIntent\(question\)\|\|routeFor\(question\)/);
});

test('v9.24 sunucu önerisi onay kartına dönüşüyor', () => {
  /* Sunucu eski değeri bilemez (yüklü tablo istemcide); önizleme burada
     tamamlanır — "eski değeri göstermeden onay istemek kör imza attırmaktır". */
  /* v9.33: çizim bağlamı parametreye taşındı — öneri kartı, üretildiği
     konuşmaya çizilir. Kartın varlığı ve işlevi aynı. */
  assert.match(CLIENT, /function showAgentProposal\(result,ctx\)/);
  assert.match(CLIENT, /const before=currentValueOf\(proposal\.type,proposal\.payload\|\|\{\}\)/);
  assert.match(CLIENT, /pendingProposal=\{\.\.\.proposal,preview:\{\.\.\.\(proposal\.preview\|\|\{\}\),before\}\}/);
  // Ve mevcut uygulama yolu değişmeden kullanılmalı.
  assert.match(CLIENT, /async function applyPending\(proposalId\)/);
});
