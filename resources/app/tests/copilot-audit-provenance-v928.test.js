'use strict';

/* v9.28 — "BU NOTU KİM YAZDI, AJAN MI ÖNERDİ?"
 *
 * Onayla akışı canlı doğrulandı ve çalışıyor: öneri copilot-mtn6bnoq-mcvso2
 * @16:34:12.289Z → not overrides.json'a @16:34:12.878Z → ORDER_UPDATE audit
 * kaydı @16:34:12.889Z, yazar oturumdan "Gökberk". Yani audit izi VARDI ve
 * eksiksizdi. Eksik olan BAĞLANTIydı: ORDER_UPDATE bu değişikliğin bir
 * Copilot önerisinden geldiğini söylemiyordu; ancak zaman yakınlığından
 * çıkarılabiliyordu ve o da kanıt değil tahmindir.
 *
 * Bunu doğuran şey aslında bir GÜVENLİK tercihiydi: Copilot'a kendi yazma
 * yolu verilmedi, onaylanan öneri kullanıcının elle düzenlerken kullandığı
 * uca gönderildi. Yetki, revizyon çakışması ve audit bedavaya geldi — bedeli
 * de sunucunun iki yazmayı ayırt edememesi oldu.
 *
 * Çözümde İKİ tuzak var ve testler ikisini de tutuyor:
 *
 *   1) KAYNAK istemciden gelir, AKTÖR oturumdan. İstemcinin bildirdiği bir
 *      kimlik kabul edilseydi provenance bir kanıt değil bir iddia olurdu.
 *   2) origin bir AUDIT alanıdır, VERİ değil. Yamadan ayıklanmazsa sipariş
 *      kaydına "origin" diye anlamsız bir alan olarak girer, projeksiyon
 *      önbelleğine yazılır ve canlı yayınla bütün cihazlara dağılırdı. Bu
 *      yüzden yamanın AŞAĞI AKAN ÜÇ KOPYASI da (kayıt, önbellek, yayın)
 *      ayıklanmış gövdeyi kullanmak zorunda.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const provenance = require('../server/lib/copilot-provenance');
const copilotActions = require('../public/copilot-actions.js');

const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const SERVER = require('./helpers/server-source')();
const CLIENT = read('public/copilot.js');
const APP = read('public/app-main.js');

/* ------------------------------------------- 1) ORIGIN VERİYE KARIŞMIYOR */

test('v9.28 origin yamadan ayıklanır, gövde değişmez', () => {
  const body = { notes: { Notes: 'Ex-factory gecikti' }, delType: 'SEA', origin: { source: 'copilot', proposalId: 'p1', type: 'order.note.set' } };
  const { patch, origin } = provenance.splitOrigin(body);
  assert.deepEqual(patch, { notes: { Notes: 'Ex-factory gecikti' }, delType: 'SEA' });
  assert.equal('origin' in patch, false, 'origin override deposuna girmemeli');
  assert.equal(origin.proposalId, 'p1');
  // Çağıranın gövdesi bozulmamalı: aynı istek başka yerlerde de okunuyor.
  assert.ok('origin' in body);
});

test('v9.28 origin yoksa yama olduğu gibi kalır', () => {
  const body = { notes: { Notes: 'elle yazıldı' } };
  const { patch, origin } = provenance.splitOrigin(body);
  assert.deepEqual(patch, body);
  assert.equal(origin, undefined);
  assert.equal(provenance.describeWrite(body).origin, null, 'elle düzenleme etiketlenmemeli');
});

test('v9.28 gövde yoksa çökmez', () => {
  [null, undefined, 'metin', 42].forEach(value => {
    const write = provenance.describeWrite(value);
    assert.deepEqual(write.patch, {});
    assert.equal(write.origin, null);
    assert.deepEqual(write.fields, []);
  });
});

/* ------------------------------------------------ 2) KAYNAK DOĞRULANIYOR */

test('v9.28 yalnız tanınan kaynak etiketlenir', () => {
  assert.deepEqual(provenance.originMeta({ source: 'copilot', proposalId: 'p9', type: 'order.note.set' }),
    { source: 'COPILOT', proposalId: 'p9', actionType: 'order.note.set' });
  /* Tanınmayan bir kaynak SESSİZCE etiketlenmez: yanlış provenance, hiç
     provenance olmamasından kötüdür — birinin elle yaptığı işi ajana
     yıkmak, kaydın tamamını güvenilmez kılar. */
  [null, undefined, 'copilot', ['copilot'], {}, { source: 'admin' }, { source: 'COPILOT' }]
    .forEach(value => assert.equal(provenance.originMeta(value), null, JSON.stringify(value)));
});

test('v9.28 istemciden gelen alanlar sınırlanır', () => {
  const meta = provenance.originMeta({ source: 'copilot', proposalId: 'x'.repeat(400), type: 'y'.repeat(400) });
  assert.equal(meta.proposalId.length, 120);
  assert.equal(meta.actionType.length, 60);
  // Boş bir kimlik null olur; "" audit'te sessiz bir yalan olurdu.
  assert.deepEqual(provenance.originMeta({ source: 'copilot', proposalId: '   ' }),
    { source: 'COPILOT', proposalId: null, actionType: null });
});

test('v9.28 audit alan listesi origin ve beklenen-revizyon alanlarını taşımaz', () => {
  const write = provenance.describeWrite({
    notes: {}, subManufacturer: 'Nova', expectedRevision: 12, expectedSuppFobRevision: 3,
    origin: { source: 'copilot', proposalId: 'p1', type: 'order.supplier.set' },
  });
  assert.deepEqual(write.fields, ['notes', 'subManufacturer']);
  assert.equal(write.origin.actionType, 'order.supplier.set');
});

/* -------------------------------------- 3) ROTA AYIKLANMIŞ GÖVDEYİ KULLANIR */

test('v9.28 override rotası origin ayıklanmış gövdeyi üç yere de verir', () => {
  const route = SERVER.slice(SERVER.indexOf("app.patch('/api/overrides/:orderCode'"));
  const body = route.slice(0, route.indexOf('async function rewriteProjectionCacheForImageItems'));
  assert.match(body, /const write = copilotProvenance\.describeWrite\(req\.body\);/);
  assert.match(body, /patchOrderOverride\(orderCode, patchBody,/);
  /* Önbellek ve canlı yayın da satır yaması alıyor. req.body oraya sızarsa
     "origin" diğer cihazlarda bir sipariş alanı olarak belirir. */
  assert.match(body, /rewriteProjectionCacheForRowPatches\(req\.currentUser,beforeContext,\[\{orderCode,patch:patchBody\}\]\)/);
  assert.match(body, /liveRowPatchesFor\(\[\{ orderCode, patch: patchBody \}\]\)/);
  assert.equal(/patch:\s*req\.body/.test(body), false, 'ham gövde aşağı akmamalı');
  assert.match(body, /userAccess\.appendAudit\(req\.currentUser, 'ORDER_UPDATE', String\(orderCode\), \{\s*[\r\n]+\s*fields: write\.fields,\s*[\r\n]+\s*\.\.\.\(write\.origin \|\| \{\}\),/);
});

/* ------------------------------------------ 4) İSTEMCİ ÖNERİYİ İŞARETLER */

test('v9.28 her sipariş yazıcısı yazmadan önce kaynağı işaretler', () => {
  ['order.note.set', 'order.supplier.set'].forEach(type => {
    const start = CLIENT.indexOf(`async '${type}'(payload)`);
    assert.ok(start > 0, type);
    const writer = CLIENT.slice(start, CLIENT.indexOf('syncOverridesFromRow(row)', start));
    assert.ok(writer.includes(`markCopilotOrigin(row,'${type}')`), `${type} kaynağı işaretlemeli`);
  });
  /* İşaret yalnız onaylanmış bir öneri varken konur: pendingProposal yoksa
     ortada etiketlenecek bir öneri de yoktur. */
  assert.match(CLIENT, /function markCopilotOrigin\(row,type\)\{\s*[\r\n]+\s*if\(!row\|\|!pendingProposal\)return;/);
  assert.match(CLIENT, /proposalId:pendingProposal\.proposalId/);
});

test('v9.28 işaret TEK KULLANIMLIK', () => {
  /* Yazma 500 ms geciktiriliyor ve toplu gidiyor. Bayrak gönderimden sonra
     silinmezse, kullanıcının daha sonra ELLE yaptığı bir düzenleme aynı
     satırda "Copilot" etiketi alırdı. */
  const line = APP.split(/\r?\n/).find(text => text.includes('_copilotOrigin'));
  assert.ok(line, 'syncOverrideToServer bayrağı okumalı');
  assert.match(line, /body\.origin=row\._copilotOrigin/);
  assert.match(line, /delete row\._copilotOrigin/);
  // Bayrak SADECE bu satırda geçmeli: başka bir yerde okunması, tek kullanımlık
  // olma güvencesini sessizce delerdi.
  assert.equal((APP.match(/_copilotOrigin/g) || []).length, (line.match(/_copilotOrigin/g) || []).length,
    'bayrak tek yerde okunup silinmeli');
});

/* --------------------------------- 5) DİĞER EYLEMLER İÇİN ONAY KAYDI VAR */

test('v9.28 sipariş dışı eylemler de bir provenance kaydı bırakır', () => {
  /* automation.recipe.create başka bir uca yazıyor (AUTOMATION_CREATE) ve o
     kayıt önerinin kimliğini taşımıyor. Onay ANI ayrı bir uçta kayda geçer.
     Ne KANITLADIĞI konusunda dürüst olmak gerekir: veriyi neyin değiştirdiğini
     değil, kullanıcının neyi onayladığını gösterir — bu yüzden
     clientReported. */
  assert.match(SERVER, /app\.post\('\/api\/copilot\/audit'/);
  assert.match(SERVER, /'COPILOT_APPLY'/);
  assert.match(SERVER, /clientReported: true/);
  // Eylem listesi kapalı: istemci uydurma bir tür bildirip audit'i kirletemez.
  assert.match(SERVER, /copilotActions\.ACTIONS, type/);
  assert.match(SERVER, /COPILOT_AUDIT_TYPE_INVALID/);
  assert.match(CLIENT, /fetch\('\/api\/copilot\/audit'/);

  /* Her yazma eyleminin en az bir provenance yolu olmalı; yeni bir eylem
     eklenince bu test onu görünür kılar. */
  const covered = { 'order.note.set': 'ORDER_UPDATE', 'order.supplier.set': 'ORDER_UPDATE',
    'collection.row.patch': 'COPILOT_APPLY', 'automation.recipe.create': 'COPILOT_APPLY' };
  assert.deepEqual(Object.keys(copilotActions.ACTIONS).sort(), Object.keys(covered).sort(),
    'yeni eylem eklendi: provenance yolunu da belirleyin');
});
