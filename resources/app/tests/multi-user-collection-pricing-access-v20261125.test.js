'use strict';

/* Çok kullanıcılı yetki kampanyası (A): Koleksiyon ve Fiyat Masası.

   Gerçek server/server.js süreci yalıtılmış veri kökleriyle başlatılır ve 20
   sentetik kullanıcı aynı anda (Promise.all) HTTP oturumuyla çalışır:
     · Moderatör (kök) + ikinci Moderatör,
     · 5 Koleksiyon sahibi,
     · sahiplere view / edit izni verilmiş kullanıcılar,
     · hiç izni olmayanlar, yalnız sipariş kapsamı olan kullanıcı,
     · hiyerarşide sahiplerin yöneticisi olan kullanıcı,
     · izni sonradan geri alınan / düşürülen kullanıcılar,
     · rolü değişen kullanıcı.
   Sunucu sonucu, beklenen yetki matrisinin bağımsız hesabıyla ve istemcinin
   (public/quotations.js) kendi kararlarıyla birebir karşılaştırılır. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { startServer } = require('./helpers/multi-user-access-server');

const OWNERS = ['o1', 'o2', 'o3', 'o4', 'o5'];
const GRANTS = [
  ['o1', 'v1', 'view'], ['o2', 'v2', 'view'], ['o1', 'v3', 'view'], ['o2', 'v3', 'view'], ['o3', 'v4', 'view'],
  ['o1', 'e1', 'edit'], ['o2', 'e2', 'edit'], ['o3', 'e3', 'edit'], ['o1', 'e3', 'view'],
  ['o4', 'r1', 'view'], ['o5', 'r2', 'edit'],
];
const USERS = [
  { id: 'mod2', role: 'moderator' },
  ...OWNERS.map(id => ({ id, managerId: id === 'o1' || id === 'o2' ? 'mgr' : 'moderator' })),
  { id: 'v1' }, { id: 'v2' }, { id: 'v3' }, { id: 'v4' },
  { id: 'e1' }, { id: 'e2' }, { id: 'e3' },
  { id: 'n1' }, { id: 'n2', dataScope: { mode: 'CUSTOM', buyers: ['Ece B.'] } },
  { id: 'mgr', role: 'manager' },
  { id: 'r1' }, { id: 'r2' }, { id: 'c1' },
];
const ALL = ['moderator', ...USERS.map(user => user.id)];
const MODERATORS = new Set(['moderator', 'mod2']);
// Sentetik ASAS sipariş sahipliği: 4100002 Ece B. (n2 kapsamında), 4100000 kimsenin değil.
const ORDER_ACCESS = { 4100002: [{ buyer: 'Ece B.', merch: 'Demo', ageGroup: 'Demo', buyerGrup: 'Demo' }], 4100000: [{ buyer: 'Mert Y.', merch: 'Demo', ageGroup: 'Demo', buyerGrup: 'Demo' }] };

function grantLevel(grants, userId, ownerId) {
  if (userId === ownerId) return 'edit';
  const hit = grants.find(([owner, grantee]) => owner === ownerId && grantee === userId);
  return hit ? hit[2] : null;
}
function rowsFor(ownerId) {
  // Satır kimlikleri her sahipte 1'den başlar: rowId çakışması bilinçlidir.
  return [1, 2].map(id => ({ id, plmId: `PLM-${ownerId}-${id}`, modelKod: `MDL-${ownerId}-${id}`, pricing: { 'Demo Üretici A': `${id}0,00` }, targetPrice: '9,99' })); // i18n-ignore
}
const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

async function fixture(t) {
  const server = await startServer(t, { users: USERS, orderAccess: ORDER_ACCESS });
  const sessions = Object.fromEntries(await Promise.all(ALL.map(async id => [id, await server.login(id === 'moderator' ? 'demo.admin' : id)])));
  return { server, s: sessions };
}

test('20 eşzamanlı kullanıcı: Koleksiyon okuma/yazma/görsel yetkisi grant matrisiyle birebir; geri alma anında kapanır', async t => {
  const { server, s } = await fixture(t);

  // Sahipler sayfalarını ve izinlerini aynı anda kaydeder.
  const saves = await Promise.all(OWNERS.map(owner => s[owner].put(`/api/collection-workspaces/${owner}`, { rows: rowsFor(owner), nextId: 3 })));
  saves.forEach((result, index) => assert.equal(result.status, 200, `${OWNERS[index]} save ${JSON.stringify(result.body)}`));
  const grants = await Promise.all(GRANTS.map(([owner, grantee, level]) => s[owner].put(`/api/collection-permissions/${grantee}`, { level })));
  grants.forEach((result, index) => assert.equal(result.status, 200, `grant ${GRANTS[index]} ${JSON.stringify(result.body)}`));
  const revisions = grants.map(result => result.body.revision).sort((a, b) => a - b);
  assert.deepEqual(revisions, GRANTS.map((_, index) => index + 1), 'eşzamanlı izin yazımları kaybolmaz; her biri tek revizyon');

  /* Sahip olmayan izin veremez/alamaz. Yönetici rolü (varsayılan matriste
     COLLECTIONS.MANAGE taşır) kendine ya da ekibine başkasının Koleksiyonunu
     açamaz: rol/hiyerarşi Koleksiyon erişimini genişletmez. Başkası adına izin
     yönetimi yalnız Moderatördedir. */
  const mgrProfile = (await s.mgr.get('/api/current-user')).body.user;
  assert.equal(mgrProfile.capabilities.includes('COLLECTIONS.MANAGE'), true, 'ön koşul: yönetici rolü COLLECTIONS.MANAGE taşır');
  const forgedCalls = [
    ['v1', 'put', 'n1', { level: 'edit', ownerId: 'o1' }], ['e1', 'put', 'n1', { level: 'edit', ownerId: 'o1' }],
    ['mgr', 'put', 'n1', { level: 'view', ownerId: 'o1' }], ['mgr', 'put', 'mgr', { level: 'edit', ownerId: 'o1' }],
    ['mgr', 'put', 'mgr', { level: 'edit', ownerId: 'o3' }], ['mgr', 'del', 'v1', { ownerId: 'o1' }],
    ['e1', 'del', 'v1', { ownerId: 'o1' }], ['c1', 'put', 'c1', { level: 'view', ownerId: 'o2' }],
  ];
  const forged = await Promise.all(forgedCalls.map(([user, method, grantee, body]) => s[user][method](`/api/collection-permissions/${grantee}`, body)));
  forged.forEach((result, index) => assert.equal(result.status, 403, `${forgedCalls[index].slice(0, 3).join(' ')} ${JSON.stringify(forgedCalls[index][3])} → ${JSON.stringify(result.body)}`));
  assert.equal((await s.mgr.get('/api/collection-workspaces/o1')).status, 403, 'yönetici kendine izin açamadı');
  const delegated = await s.moderator.put('/api/collection-permissions/n1', { level: 'view', ownerId: 'o5' });
  assert.equal(delegated.status, 200, 'Moderatör sahip adına izin verebilir');
  assert.equal((await s.n1.get('/api/collection-workspaces/o5')).status, 200);
  assert.equal((await s.mod2.del('/api/collection-permissions/n1', { ownerId: 'o5' })).status, 200, 'ikinci Moderatör geri alabilir');
  assert.equal((await s.n1.get('/api/collection-workspaces/o5')).status, 403);

  // 20 kullanıcı × 5 sahip okuma matrisi, tek seferde paralel.
  const pairs = ALL.flatMap(user => OWNERS.map(owner => ({ user, owner })));
  const reads = await Promise.all(pairs.map(({ user, owner }) => s[user].get(`/api/collection-workspaces/${owner}`)));
  pairs.forEach(({ user, owner }, index) => {
    const result = reads[index], level = grantLevel(GRANTS, user, owner);
    if (!level) {
      assert.equal(result.status, 403, `${user} → ${owner} okunamaz (rol/hiyerarşi Koleksiyon açmaz)`);
      assert.equal(JSON.stringify(result.body).includes(`PLM-${owner}`), false, `${user} yanıtında ${owner} verisi sızmaz`);
      return;
    }
    assert.equal(result.status, 200, `${user} → ${owner} okur`);
    assert.equal(result.body.access.level, level);
    assert.equal(result.body.access.canEdit, level === 'edit', `${user} → ${owner} canEdit`);
    assert.deepEqual(result.body.workspace.rows.map(row => row.plmId), [`PLM-${owner}-1`, `PLM-${owner}-2`]);
    assert.equal(result.body.workspace.rows[0].pricing['Demo Üretici A'], '10,00', 'fiyat sütunu yetkili okumada görünür'); // i18n-ignore
  });

  // Liste ve izin görünümü yalnız kendi + verilmiş sahipleri içerir.
  const lists = await Promise.all(ALL.map(user => s[user].get('/api/collection-workspaces')));
  const views = await Promise.all(ALL.map(user => s[user].get('/api/collection-permissions')));
  ALL.forEach((user, index) => {
    const expected = OWNERS.filter(owner => grantLevel(GRANTS, user, owner)).concat(OWNERS.includes(user) ? [] : [user]).sort();
    assert.deepEqual(lists[index].body.workspaces.map(item => item.ownerId).sort(), expected, `${user} listesi`);
    assert.deepEqual(views[index].body.view.map(item => `${item.ownerId}:${item.level}`).sort(), expected.map(owner => `${owner}:${grantLevel(GRANTS, user, owner)}`).sort(), `${user} izin görünümü`);
  });

  // Çoklu görünüm: tüm sahiplerin kesişimi gerekir; tek eksik sahip tüm isteği reddeder.
  const batch = await Promise.all([s.v3.get('/api/collection-workspaces-batch?ownerIds=o1,o2'), s.v1.get('/api/collection-workspaces-batch?ownerIds=o1,o2'), s.n1.get('/api/collection-workspaces-batch?ownerIds=o1')]);
  assert.equal(batch[0].status, 200);
  assert.deepEqual(batch[0].body.workspaces.map(item => [item.owner.id, item.access.level, item.access.canEdit]), [['o1', 'view', false], ['o2', 'view', false]]);
  assert.equal(batch[1].status, 403); assert.equal(batch[2].status, 403);

  // Yazma matrisi (o1..o3): yalnız sahip ve edit izinli yazar; herkes aynı anda dener.
  const writers = ALL.flatMap(user => ['o1', 'o2', 'o3'].map(owner => ({ user, owner })));
  const writes = await Promise.all(writers.map(({ user, owner }) => s[user].put(`/api/collection-workspaces/${owner}`, { rows: [{ id: 1, plmId: `WRITE-${user}`, modelKod: 'X' }], nextId: 2 })));
  writers.forEach(({ user, owner }, index) => {
    const allowed = grantLevel(GRANTS, user, owner) === 'edit';
    assert.equal(writes[index].status, allowed ? 200 : 403, `${user} → ${owner} yazma`);
  });
  const finals = await Promise.all(['o1', 'o2', 'o3'].map(owner => s[owner].get(`/api/collection-workspaces/${owner}`)));
  finals.forEach((result, index) => {
    const owner = ['o1', 'o2', 'o3'][index], writer = result.body.workspace.rows[0].plmId.replace('WRITE-', '');
    assert.equal(grantLevel(GRANTS, writer, owner), 'edit', `${owner} son içeriği yetkili bir yazara ait (${writer})`);
  });

  // Görseller: sahibin paylaşılan Koleksiyon görseli izin seviyesine bağlıdır.
  const upload = await s.o1.post('/api/collection-images', { rowId: 'collection-shared:o1:1', filename: 'demo.png', mimeType: 'image/png', base64: image });
  assert.equal(upload.status, 200, JSON.stringify(upload.body));
  const imageId = upload.body.image.id;
  const imageReads = await Promise.all(ALL.map(user => s[user].as('GET', `/api/collection-images/${imageId}`, { raw: true })));
  ALL.forEach((user, index) => assert.equal(imageReads[index].status, grantLevel(GRANTS, user, 'o1') ? 200 : 403, `${user} görsel okuma`));
  const hydrate = await Promise.all(ALL.map(user => s[user].post('/api/model-images/shared/hydrate', { ownerId: 'o1' })));
  ALL.forEach((user, index) => { if (!grantLevel(GRANTS, user, 'o1')) assert.equal(hydrate[index].status, 403, `${user} görsel hidrasyonu`); });
  const imageDeletes = await Promise.all(['v1', 'v3', 'n1', 'mgr', 'mod2'].map(user => s[user].del(`/api/collection-images/${imageId}`)));
  imageDeletes.forEach(result => assert.equal(result.status, 403, 'view/izinsiz kullanıcı paylaşılan görseli silemez'));
  assert.equal((await s.e1.del(`/api/collection-images/${imageId}`)).status, 200, 'edit izinli silebilir');

  // Geri alma: r1 okurken izin kaldırılır. Kaldırma yanıtından sonraki ilk istek dahil her okuma reddedilir.
  assert.equal((await s.r1.get('/api/collection-workspaces/o4')).status, 200);
  const inflight = Promise.all(Array.from({ length: 20 }, () => s.r1.get('/api/collection-workspaces/o4')));
  const revoke = await s.o4.del('/api/collection-permissions/r1', {});
  assert.equal(revoke.status, 200);
  const settled = await inflight;
  settled.forEach(result => assert.ok([200, 403].includes(result.status)));
  const after = await Promise.all([
    s.r1.get('/api/collection-workspaces/o4'), s.r1.get('/api/collection-workspaces-batch?ownerIds=o4'),
    s.r1.post('/api/model-images/shared/hydrate', { ownerId: 'o4' }), s.r1.get('/api/collection-workspaces'),
  ]);
  assert.equal(after[0].status, 403, 'geri alınan izin anında kapanır');
  assert.equal(after[1].status, 403); assert.equal(after[2].status, 403);
  assert.deepEqual(after[3].body.workspaces.map(item => item.ownerId), ['r1']);

  // Düşürme: r2 edit → view → kaldırıldı; her adım bir sonraki istekte etkin.
  assert.equal((await s.r2.put('/api/collection-workspaces/o5', { rows: rowsFor('o5'), nextId: 3 })).status, 200);
  assert.equal((await s.o5.put('/api/collection-permissions/r2', { level: 'view' })).status, 200);
  const downgraded = await Promise.all([s.r2.put('/api/collection-workspaces/o5', { rows: [], nextId: 1 }), s.r2.get('/api/collection-workspaces/o5')]);
  assert.equal(downgraded[0].status, 403, 'view seviyesine düşen kullanıcı yazamaz');
  assert.equal(downgraded[1].body.access.level, 'view');
  assert.equal(downgraded[1].body.workspace.rows.length, 2, 'reddedilen yazma veriyi değiştirmedi');

  // İzin belgesinin süreç dışından değişmesi (hub içe aktarımı) önbelleği anında geçersiz kılar.
  const permissionFile = path.join(server.home, 'local', 'collection-permissions.json');
  const document = JSON.parse(fs.readFileSync(permissionFile, 'utf8'));
  document.grants = document.grants.filter(grant => grant.granteeId !== 'r2');
  document.revision += 1;
  fs.writeFileSync(permissionFile, JSON.stringify(document, null, 2));
  assert.equal((await s.r2.get('/api/collection-workspaces/o5')).status, 403, 'dış değişiklik bir sonraki istekte etkin');

  // Pasifleştirilen kullanıcı oturumu hiçbir Koleksiyon verisi alamaz.
  const deactivate = await s.moderator.put('/api/users/v4', { status: 'INACTIVE' });
  assert.equal(deactivate.status, 200, JSON.stringify(deactivate.body));
  const disabled = await s.v4.get('/api/collection-workspaces/o3');
  assert.notEqual(disabled.status, 200, 'pasif kullanıcı okuyamaz');
  assert.equal(JSON.stringify(disabled.body).includes('PLM-o3'), false);
});

/* İstemci (public/quotations.js) yetki ve Koleksiyon yansıtma kararları, gerçek
   kaynak dilimleri vm içinde çalıştırılarak alınır; sunucunun aynı kullanıcı
   için verdiği kararla birebir karşılaştırılır. */
const QUOTATIONS_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'public', 'quotations.js'), 'utf8');
function slice(start, end) {
  const from = QUOTATIONS_SOURCE.indexOf(start), to = QUOTATIONS_SOURCE.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `quotations.js dilimi bulunamadı: ${start}`);
  return QUOTATIONS_SOURCE.slice(from, to);
}
const CLIENT_SCRIPT = [
  "const qLang=(tr,en)=>(typeof appLang!=='undefined'&&appLang==='en')?en:tr;",
  "const qNorm=value=>String(value==null?'':value).trim();",
  "const qCurrentUser=()=>(typeof state!=='undefined'&&state.currentUser)||{};",
  'const qCurrentUserId=()=>qNorm(qCurrentUser()?.id);',
  "const qIsModerator=()=>qCurrentUser()?.role==='moderator';",
  'function qLoad(){return qState;}',
  'function qRefreshCollection(){}',
  slice('  const qItemOwners=new WeakMap();', '  function qLoad(){'),
  slice('  function qMoneyNumber(value){', '  function qRequestTitle(req){'),
  slice('  const qRowCollections=new WeakMap();', '  function qCollectionImageSrc('),
  slice('  function qCanEditRequest(req){', '  function qFabricValue(row){'),
  slice('  function qCollectionPricingMap(row){', '  function qSameCollectionRow(row,line){'),
  slice('  const PROJECTED_KEY=', '  function qRefreshCollection(){'),
].join('\n');
function client(user, requests, { kolRows = [], owner = '', canEdit = true, mode = '', lang = 'tr' } = {}) {
  const storage = new Map([['lcw.quotations.projectedLineEdits.v1', '{}']]);
  const c = {
    state: { currentUser: user }, appLang: lang, toasts: [], saves: 0,
    window: { BLCollectionModelGroups: require('../public/collection-model-groups') },
    BLStorage: { getItem: key => (storage.has(key) ? storage.get(key) : null), setItem: (key, value) => storage.set(key, String(value)) },
    kolRows, kolWorkspaceOwnerId: owner, kolWorkspaceMode: mode, kolWorkspaceSharedMode: false, kolWorkspaceCanEdit: canEdit,
  };
  c.showToast = message => c.toasts.push(message);
  c.saveKolRows = () => { c.saves += 1; };
  vm.createContext(c);
  vm.runInContext(CLIENT_SCRIPT, c);
  c.qState = { requests: JSON.parse(JSON.stringify(requests)) };
  c.qState.requests.forEach(request => c.qTrackOwners(request));
  return c;
}

test('20 eşzamanlı kullanıcı: Fiyat Masası görünürlüğü Koleksiyon izniyle, düzenleme sahip/editör/Moderatörle birebir; istemci sunucuyla aynı karar verir', async t => {
  const { s } = await fixture(t);
  const grants = GRANTS.map(item => item.slice());
  await Promise.all(OWNERS.map(owner => s[owner].put(`/api/collection-workspaces/${owner}`, { rows: rowsFor(owner), nextId: 3 })));
  (await Promise.all(grants.map(([owner, grantee, level]) => s[owner].put(`/api/collection-permissions/${grantee}`, { level }))))
    .forEach(result => assert.equal(result.status, 200));

  const line = (owner, rowId, extra = {}) => ({ modelKey: `kol:${rowId}`, rowId, plmId: `PLM-${owner}-${rowId}`, manufacturer: 'Demo Üretici A', targetPrice: '9,99', picture: `/api/collection-images/demo-${owner}-${rowId}`, ...extra }); // i18n-ignore
  const cpLine = (code, extra = {}) => ({ modelKey: `cp:${code}`, orderCode: code, manufacturer: 'Demo Üretici A', ...extra }); // i18n-ignore
  const specs = {
    QA: ['o1', { source: 'collection', manufacturers: [{ name: 'Demo Üretici A' }], items: [line('o1', 1, { price: '10,00' }), line('o1', 2)] }], // i18n-ignore
    QB: ['o2', { source: 'collection', items: [line('o2', 1)] }],
    // Üretici seçmeden açılan talep: yalnız bekleyen modeller (request.models).
    QC: ['o3', { source: 'collection', manufacturers: [], items: [], models: [{ modelKey: 'kol:1', rowId: 1, plmId: 'PLM-o3-1' }, { modelKey: 'kol:2', rowId: 2, plmId: 'PLM-o3-2' }] }],
    QD: ['o1', { source: 'cp', items: [cpLine('4100002')] }],
    QE: ['o1', { source: 'cp', items: [cpLine('4100000')] }],
    QF: ['o2', { source: 'cp', items: [], models: [{ modelKey: 'cp:4100002', orderCode: '4.100.002' }] }],
    QG: ['o4', { source: 'collection', items: [line('o4', 1)] }],
  };
  const created = await Promise.all(Object.entries(specs).map(([, [owner, body]]) => s[owner].post('/api/quotations', body)));
  const ids = {}, owners = {};
  Object.keys(specs).forEach((key, index) => {
    assert.equal(created[index].status, 201, `${key} ${JSON.stringify(created[index].body)}`);
    ids[key] = created[index].body.request.id; owners[key] = specs[key][0];
  });
  assert.deepEqual(created[2].body.request.models.map(model => model.modelKey), ['kol:1', 'kol:2'], 'üreticisiz talep modelleri taşır');
  const editors = { QA: ['e1'] };
  assert.equal((await s.e1.patch(`/api/quotations/${ids.QA}/editors`, { editorIds: ['e1', 'n1'] })).status, 403, 'editör yetki listesini değiştiremez');
  assert.equal((await s.o1.patch(`/api/quotations/${ids.QA}/editors`, { editorIds: editors.QA })).status, 200);

  let moderators = new Set(MODERATORS);
  const profiles = Object.fromEntries((await Promise.all(ALL.map(user => s[user].get('/api/current-user')))).map((result, index) => [ALL[index], result.body.user]));
  // "Tüm siparişleri yönetme" (ORDERS.MANAGE; varsayılan yönetici rolleri) CP taleplerini açar — sipariş yetkisiyle aynı.
  const manageAllOrders = new Set(ALL.filter(user => profiles[user].permissions.manageAllOrders));
  assert.deepEqual([...manageAllOrders].sort(), ['mgr', 'mod2', 'moderator'], 'ön koşul: yalnız yönetici ve Moderatörler tüm siparişleri yönetir');
  const scopeCodes = { n2: new Set(['4100002']) };
  const keyOf = id => Object.keys(ids).find(key => ids[key] === id);
  const canEditExpected = (user, key) => moderators.has(user) || owners[key] === user || (editors[key] || []).includes(user);
  const visibleExpected = (user, key) => {
    if (canEditExpected(user, key)) return true;
    const spec = specs[key][1];
    if (spec.source === 'collection') return Boolean(grantLevel(grants, user, owners[key]));
    if (manageAllOrders.has(user)) return true;
    return [...(spec.items || []), ...(spec.models || [])].some(item => (scopeCodes[user] || new Set()).has(String(item.orderCode).replace(/\./g, '')));
  };
  async function assertVisibility(label) {
    const lists = await Promise.all(ALL.map(user => s[user].get('/api/quotations')));
    ALL.forEach((user, index) => {
      assert.equal(lists[index].status, 200, `${label}: ${user}`);
      const expected = Object.keys(ids).filter(key => visibleExpected(user, key)).sort();
      assert.deepEqual(lists[index].body.requests.map(request => keyOf(request.id)).sort(), expected, `${label}: ${user} görünür talepler`);
      const text = JSON.stringify(lists[index].body.requests);
      Object.keys(ids).filter(key => !expected.includes(key)).forEach(key => assert.equal(text.includes(ids[key]), false, `${label}: ${user} yanıtında ${key} sızmaz`));
    });
    return Object.fromEntries(ALL.map((user, index) => [user, lists[index].body.requests]));
  }
  let visible = await assertVisibility('ilk');
  assert.deepEqual(visible.v4.find(request => request.id === ids.QC).models.map(model => model.plmId), ['PLM-o3-1', 'PLM-o3-2'], 'view izinli kullanıcı bekleyen modelleri görür');

  // Düzenleme matrisi: herkes her talebe aynı anda yazmayı dener.
  const attempts = ALL.flatMap(user => Object.keys(ids).map(key => ({ user, key })));
  const lineIds = Object.fromEntries(created.map((result, index) => [Object.keys(specs)[index], (result.body.request.items[0] || {}).id]));
  const results = await Promise.all(attempts.map(({ user, key }) => lineIds[key]
    ? s[user].patch(`/api/quotations/${ids[key]}/lines/${lineIds[key]}`, { price: `${ALL.indexOf(user) + 1},50`, source: 'manual' })
    : s[user].post(`/api/quotations/${ids[key]}/rounds`, { note: user })));
  attempts.forEach(({ user, key }, index) => {
    const allowed = canEditExpected(user, key);
    assert.equal(results[index].status, allowed ? 200 : 403, `${user} → ${key} düzenleme`);
    if (!allowed) assert.equal(JSON.stringify(results[index].body).includes('Demo Üretici A'), false, `${user} → ${key} ret yanıtı içerik sızdırmaz`); // i18n-ignore
    // İstemci parite: görünür her talepte qCanEditRequest sunucu kararıyla aynı.
    const request = visible[user].find(item => item.id === ids[key]);
    if (request) assert.equal(client(profiles[user], visible[user]).qCanEditRequest(request), allowed, `${user} → ${key} istemci qCanEditRequest`);
  });
  const finalLines = (await s.moderator.get('/api/quotations')).body.requests;
  for (const key of ['QA', 'QB', 'QD', 'QE', 'QG']) {
    const history = finalLines.find(request => request.id === ids[key]).items.find(item => item.id === lineIds[key]).history;
    const actors = [...new Set(history.filter(event => event.type !== 'create').map(event => event.by))];
    actors.forEach(actor => assert.equal(canEditExpected(actor, key), true, `${key} defterinde yetkisiz yazar yok (${actor})`));
  }

  // View-only kullanıcı: fiyat/onay/drop/durum/tam kayıt/toplu fiyat/üretici ekleme/birleştirme reddedilir.
  const qa = finalLines.find(request => request.id === ids.QA), qaLine = qa.items.find(item => item.id === lineIds.QA);
  const viewOnly = [
    s.v1.patch(`/api/quotations/${ids.QA}/lines/${lineIds.QA}`, { approved: true }),
    s.v1.patch(`/api/quotations/${ids.QA}/lines/${lineIds.QA}`, { dropped: true }),
    s.v1.patch(`/api/quotations/${ids.QA}/status`, { status: 'closed' }),
    s.v1.put(`/api/quotations/${ids.QA}`, { ...qa, manufacturers: [...qa.manufacturers, { name: 'Demo Üretici B' }], items: [...qa.items, line('o1', 1, { manufacturer: 'Demo Üretici B' })] }), // i18n-ignore
    s.v1.post(`/api/quotations/${ids.QA}/lines/batch`, { changes: [{ lineId: qaLine.id, baseRev: qaLine.rev, price: '1,00', identity: qaLine }] }),
    s.v1.patch(`/api/quotations/${ids.QA}/editors`, { editorIds: ['v1'] }),
    s.v1.post('/api/quotations/merge', { sourceId: ids.QA, targetId: ids.QB }),
    s.v4.put(`/api/quotations/${ids.QC}`, { ...visible.v4.find(request => request.id === ids.QC), manufacturers: [{ name: 'Demo Üretici A' }], items: [line('o3', 1)] }), // i18n-ignore
    s.e3.put(`/api/quotations/${ids.QC}`, { ...visible.e3.find(request => request.id === ids.QC), manufacturers: [{ name: 'Demo Üretici A' }], items: [line('o3', 1)] }), // i18n-ignore
    s.e1.post('/api/quotations/merge', { sourceId: ids.QD, targetId: ids.QE }),
  ];
  (await Promise.all(viewOnly)).forEach((result, index) => assert.equal(result.status, 403, `view-only/editor yasak işlem #${index}: ${JSON.stringify(result.body)}`));
  const viewer = client(profiles.v1, visible.v1);
  assert.equal(viewer.qCanEditRequest(viewer.qState.requests.find(request => request.id === ids.QA)), false);
  viewer.qViewOnlyNotice({ status: 'active' });
  assert.match(viewer.toasts.pop(), /yalnız görüntüleme yetkiniz var/);
  const viewerEn = client(profiles.v1, visible.v1, { lang: 'en' });
  viewerEn.qViewOnlyNotice({ status: 'active' });
  assert.match(viewerEn.toasts.pop(), /view-only access/);

  // Sahip üretici ekler: bekleyen model satıra dönüşür, görünürlük korunur.
  const qcOwner = visible.o3.find(request => request.id === ids.QC);
  const added = await s.o3.put(`/api/quotations/${ids.QC}`, { ...qcOwner, manufacturers: [{ name: 'Demo Üretici A' }], items: [line('o3', 1)] }); // i18n-ignore
  assert.equal(added.status, 200, JSON.stringify(added.body));
  assert.deepEqual(added.body.request.models.map(model => model.modelKey), ['kol:2']);
  assert.deepEqual((await s.v4.get('/api/quotations')).body.requests.find(request => request.id === ids.QC).items.map(item => item.plmId), ['PLM-o3-1']);

  // Editör onaylar → yansıtma yalnız sahibin istemcisinden ve sahibin satırına.
  const approve = await s.e1.patch(`/api/quotations/${ids.QA}/lines/${lineIds.QA}`, { price: '8,80', approved: true });
  assert.equal(approve.status, 200, JSON.stringify(approve.body));
  visible = await assertVisibility('onay sonrası');
  const ownRows = owner => rowsFor(owner).map(row => ({ ...row, pricing: { ...row.pricing } }));
  const ownerClient = client(profiles.o1, visible.o1, { kolRows: ownRows('o1'), owner: 'o1' });
  assert.equal(ownerClient.qProjectForeignLineEdits(), 1, 'sahip, editörün onayını kendi Koleksiyonuna bir kez yansıtır');
  assert.equal(ownerClient.kolRows[0].pricing['Demo Üretici A'], '8.80'); // i18n-ignore
  assert.equal(ownerClient.kolRows[0].confirmedManufacturer, 'Demo Üretici A'); // i18n-ignore
  assert.equal(ownerClient.qProjectForeignLineEdits(), 0, 'ikinci açılış yeniden yazmaz');
  const editorClient = client(profiles.e1, visible.e1, { kolRows: ownRows('e1'), owner: 'e1' });
  const editorLine = editorClient.qState.requests.find(request => request.id === ids.QA).items.find(item => item.id === lineIds.QA);
  assert.equal(editorClient.qLineOwnerId(editorLine), 'o1', 'satır sahibi talep sahibidir');
  assert.equal(editorClient.qFindCollectionRow(editorLine), null, 'başka buyer talebindeki rowId 1 editörün kendi 1 numaralı satırına eşlenmez');
  assert.equal(editorClient.qProjectForeignLineEdits(), 0);
  assert.equal(editorClient.qWritePriceToCollection(editorClient.qState.requests.find(request => request.id === ids.QA), editorLine), false);
  assert.deepEqual(editorClient.kolRows, ownRows('e1'), 'editörün kendi Koleksiyonu değişmedi');
  assert.equal(editorClient.saves, 0);
  const editorOnOwner = client(profiles.e1, visible.e1, { kolRows: ownRows('o1'), owner: 'o1', canEdit: true });
  const editorOnOwnerReq = editorOnOwner.qState.requests.find(request => request.id === ids.QA);
  assert.equal(editorOnOwner.qWritePriceToCollection(editorOnOwnerReq, editorOnOwnerReq.items.find(item => item.id === lineIds.QA), { save: false }), true, 'sahibin sayfasını düzenleme yetkisiyle açan editör sahibin satırına yazar');
  assert.equal(editorOnOwner.qProjectForeignLineEdits(), 0, 'editör istemcisi sahibin kayıtlarını toplu yeniden yazmaz');
  const viewerOnOwner = client(profiles.v1, visible.v1, { kolRows: ownRows('o1'), owner: 'o1', canEdit: false });
  const viewerReq = viewerOnOwner.qState.requests.find(request => request.id === ids.QA);
  assert.equal(viewerOnOwner.qWritePriceToCollection(viewerReq, viewerReq.items.find(item => item.id === lineIds.QA)), false, 'view-only sayfaya yazılmaz');
  const multi = client(profiles.v3, visible.v3, { kolRows: ownRows('o1').map(row => ({ ...row, _collectionOwnerId: 'o1', _collectionSourceId: row.id })), owner: 'v3', mode: 'multi' });
  const multiReq = multi.qState.requests.find(request => request.id === ids.QA);
  assert.equal(multi.qWritePriceToCollection(multiReq, multiReq.items.find(item => item.id === lineIds.QA)), false, 'çoklu görünüm salt okunurdur');

  // Geri alma ve editörlükten çıkarma bir sonraki istekte etkin.
  const revokeAndRemove = await Promise.all([s.o1.del('/api/collection-permissions/v1', {}), s.o1.patch(`/api/quotations/${ids.QA}/editors`, { editorIds: [] })]);
  revokeAndRemove.forEach(result => assert.equal(result.status, 200));
  grants.splice(grants.findIndex(([owner, grantee]) => owner === 'o1' && grantee === 'v1'), 1);
  editors.QA = [];
  const afterRevoke = await Promise.all([
    s.v1.as('POST', `/api/quotations/${ids.QA}/restore`), s.v1.del(`/api/quotations/${ids.QA}`),
    s.e1.patch(`/api/quotations/${ids.QA}/lines/${lineIds.QA}`, { price: '1,00' }),
  ]);
  // Buyer'da QUOTATIONS.DELETE yoktur (403); olsaydı görünmeyen kayıt 404 dönerdi. İkisi de erişim yok demektir.
  assert.ok([403, 404].includes(afterRevoke[0].status), 'geri alınan kullanıcı gizli talebi geri yükleyemez');
  assert.ok([403, 404].includes(afterRevoke[1].status), 'geri alınan kullanıcı talebe dokunamaz');
  assert.equal((await s.mod2.del(`/api/quotations/${ids.QE}`)).status, 200, 'görünür talep kişisel olarak gizlenir');
  assert.equal((await s.mod2.as('POST', `/api/quotations/${ids.QE}/restore`)).status, 200);
  assert.equal(afterRevoke[2].status, 403, 'editörlükten çıkarılan yazamaz');
  await assertVisibility('geri alma sonrası');

  // Rol değişimi: buyer → Moderatör → buyer; açık oturum her adımda yeni rolü kullanır.
  const promote = await s.moderator.put('/api/users/c1', { systemRole: 'moderator', reason: 'Demo rol testi', confirmCritical: true });
  assert.equal(promote.status, 200, JSON.stringify(promote.body));
  assert.equal((await s.c1.get('/api/current-user')).status, 200, 'rol değişimi açık oturumu düşürmez; yeni rol aynı oturumda etkin');
  moderators = new Set([...MODERATORS, 'c1']);
  visible = await assertVisibility('terfi sonrası');
  const promoted = (await s.c1.get('/api/current-user')).body.user;
  assert.equal(promoted.role, 'moderator');
  assert.equal((await s.c1.patch(`/api/quotations/${ids.QB}/lines/${lineIds.QB}`, { price: '6,60' })).status, 200);
  assert.equal(client(promoted, visible.c1).qCanEditRequest(visible.c1.find(request => request.id === ids.QB)), true);
  assert.equal((await s.c1.get('/api/collection-workspaces/o2')).status, 403, 'Moderatör rolü de başkasının Koleksiyon sayfasını izinsiz açmaz');
  const demote = await s.moderator.put('/api/users/c1', { systemRole: 'buyer' });
  assert.equal(demote.status, 200, JSON.stringify(demote.body));
  assert.equal((await s.c1.get('/api/current-user')).body.user.role, 'buyer');
  moderators = new Set(MODERATORS);
  await assertVisibility('düşürme sonrası');
  assert.equal((await s.c1.patch(`/api/quotations/${ids.QB}/lines/${lineIds.QB}`, { price: '6,70' })).status, 403);

  // Eski önbellek içe aktarımı sahiplik/editör/kimlik taklidi yapamaz.
  const qaBefore = (await s.moderator.get('/api/quotations')).body.requests.find(request => request.id === ids.QA);
  const spoof = await s.n1.post('/api/quotations/import', { requests: [
    { ...qaBefore, ownerId: 'n1', items: [line('o1', 1, { price: '0,01', approved: true })] },
    { id: 'quotation-demo-spoof', source: 'collection', ownerId: 'o1', editorIds: ['n1'], items: [line('o1', 1)] },
  ] });
  assert.equal(spoof.status, 200, JSON.stringify(spoof.body));
  assert.equal(spoof.body.imported, 1, 'var olan talep kimliği üzerine yazılmaz');
  assert.deepEqual(spoof.body.requests.map(request => request.id), ['quotation-demo-spoof'], 'yanıt yalnız içe aktaranın görebildiklerini taşır');
  const after = (await s.moderator.get('/api/quotations')).body.requests;
  assert.deepEqual(after.find(request => request.id === ids.QA), qaBefore, 'sahibin talebi değişmedi');
  const imported = after.find(request => request.id === 'quotation-demo-spoof');
  assert.deepEqual([imported.ownerId, imported.editorIds], ['n1', []], 'sahiplik içe aktarana sabitlenir');
  assert.equal(grantLevel(grants, 'v3', 'o1'), 'view');
  assert.equal((await s.v3.get('/api/quotations')).body.requests.some(request => request.id === 'quotation-demo-spoof'), false, 'taklit talep sahibin Koleksiyon izinlilerine görünmez');
});

/* Canlı olay akışı (SSE): satır yaması ve "yeniden yükle" olayı yalnız o
   Koleksiyonu görebilen aboneye gider; izin geri alındıktan sonraki olay
   artık eski aboneye ulaşmaz (abone profili yayın anında taze çözülür). */
function subscribe(server, session, clientId) {
  const controller = new AbortController(), events = [];
  const ready = fetch(`${server.base}/api/live-events?clientId=${clientId}`, { headers: { Cookie: session.cookie }, signal: controller.signal }).then(async response => {
    const decoder = new TextDecoder(); let buffer = '';
    (async () => {
      try {
        for await (const chunk of response.body) {
          buffer += decoder.decode(chunk, { stream: true });
          let index;
          while ((index = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, index); buffer = buffer.slice(index + 2);
            const data = block.split('\n').filter(lineText => lineText.startsWith('data:')).map(lineText => lineText.slice(5).trim()).join('');
            if (data) events.push(JSON.parse(data));
          }
        }
      } catch (_) { /* abort */ }
    })();
  });
  return { events, ready, close: () => controller.abort() };
}
async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (predicate()) return true; await new Promise(resolve => setTimeout(resolve, 25)); }
  return false;
}

test('canlı Koleksiyon olayları yalnız yetkili aboneye; geri alınan kullanıcı sonraki olayı almaz', async t => {
  const { server, s } = await fixture(t);
  assert.equal((await s.o1.put('/api/collection-workspaces/o1', { rows: rowsFor('o1'), nextId: 3 })).status, 200);
  await Promise.all([['v1', 'view'], ['r1', 'view'], ['e1', 'edit']].map(([grantee, level]) => s.o1.put(`/api/collection-permissions/${grantee}`, { level })));
  const watchers = Object.fromEntries(['o1', 'v1', 'r1', 'e1', 'n1', 'mgr', 'moderator'].map(user => [user, subscribe(server, s[user], `client-${user}`)]));
  t.after(() => Object.values(watchers).forEach(watcher => watcher.close()));
  await Promise.all(Object.values(watchers).map(watcher => watcher.ready));
  await new Promise(resolve => setTimeout(resolve, 100));

  const patchRow = async (session, plmId) => {
    // Satır bazlı kayıt satır revizyonunu ister: güncel satır üzerine yazılır.
    const current = (await session.get('/api/collection-workspaces/o1')).body.workspace.rows.find(row => row.id === 1);
    const result = await session.as('PATCH', '/api/collection-workspaces/o1', { body: { upserts: [{ ...current, plmId }] } });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.applied.length, 1, JSON.stringify(result.body));
  };
  const collectionEvents = user => watchers[user].events.filter(event => event.area === 'collection' && event.ownerId === 'o1');
  const sawPlm = (user, plmId) => collectionEvents(user).some(event => JSON.stringify(event.rowPatches || []).includes(plmId));
  await patchRow(s.e1, 'PLM-LIVE-1');
  assert.equal(await waitFor(() => ['o1', 'v1', 'r1'].every(user => sawPlm(user, 'PLM-LIVE-1'))), true, 'yetkili aboneler satır yamasını alır');
  await new Promise(resolve => setTimeout(resolve, 400));
  for (const user of ['n1', 'mgr', 'moderator']) {
    assert.equal(collectionEvents(user).length, 0, `${user} o1 Koleksiyon olayını almaz`);
    assert.equal(JSON.stringify(watchers[user].events).includes('PLM-LIVE-1'), false, `${user} satır değerini görmez`);
  }

  assert.equal((await s.o1.del('/api/collection-permissions/r1', {})).status, 200);
  const r1Before = collectionEvents('r1').length;
  assert.equal(await waitFor(() => watchers.r1.events.some(event => event.area === 'collection-permissions')), true, 'geri alınan kullanıcı listesini tazelemek için izin olayını alır ');
  await patchRow(s.o1, 'PLM-LIVE-2');
  assert.equal(await waitFor(() => sawPlm('v1', 'PLM-LIVE-2')), true);
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(sawPlm('r1', 'PLM-LIVE-2'), false, 'geri alma sonrası satır yaması eski aboneye gitmez');
  assert.equal(JSON.stringify(watchers.n1.events).includes('"ownerId":"o1"'), false, 'izinsiz abone sahip etkinliğini bile görmez');

  // Yapısal kayıt (yamasız "reload" olayı) da yalnız yetkili aboneye gider.
  const v1Before = collectionEvents('v1').length;
  assert.equal((await s.o1.put('/api/collection-workspaces/o1', { rows: [...rowsFor('o1'), { id: 3, plmId: 'PLM-LIVE-3' }], nextId: 4 })).status, 200);
  assert.equal(await waitFor(() => collectionEvents('v1').length > v1Before), true, 'yetkili abone tam kayıt olayını alır');
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(collectionEvents('r1').length, r1Before, 'geri alma sonrası hiçbir o1 Koleksiyon olayı eski aboneye gitmez');
  assert.equal(collectionEvents('n1').length + collectionEvents('mgr').length + collectionEvents('moderator').length, 0);
});

test('Fiyat Masası istemci yazma girişleri view-only kullanıcıda sunucuya gitmeden durur (qCanEditLine/qCanEditRequest + qViewOnlyNotice)', () => {
  const body = (name, length = 400) => {
    const start = QUOTATIONS_SOURCE.search(new RegExp(`\\n  (?:async )?function ${name}\\(`));
    assert.ok(start >= 0, name);
    return QUOTATIONS_SOURCE.slice(start, start + length);
  };
  for (const name of ['qToggleApproval', 'qToggleDrop', 'qSaveLineOptions', 'qPromoteLineOption', 'qAddManufacturerLines']) {
    assert.match(body(name), /if\(![^)]*qCanEdit(?:Line|Request)\(req(?:,line)?\)\)\{qViewOnlyNotice\(req\);return/, `${name} view-only kapısı`);
  }
  // Toplu fiyat kuyruk içinde, istek gönderilmeden önce güncel talep üzerinden yeniden denetlenir.
  const batch = body('qApplyPricesBatch', 1200);
  assert.ok(batch.indexOf('if(!req||!qCanEditRequest(req))throw') > 0 && batch.indexOf('if(!req||!qCanEditRequest(req))throw') < batch.indexOf('/lines/batch'), 'toplu fiyat kapısı');
  const desk = QUOTATIONS_SOURCE.slice(QUOTATIONS_SOURCE.indexOf('  const qDeskApi={'), QUOTATIONS_SOURCE.indexOf('selectRequest(id)'));
  assert.match(desk, /applyPrice\(req,line,value,source='matrix'\)\{if\(!req\|\|!line\|\|!qCanEditLine\(req,line\)\)\{qViewOnlyNotice\(req\);return null;\}/);
  assert.match(desk, /async startRound\(req,note=''\)\{\s*if\(!req\|\|!qCanEditRequest\(req\)\)\{qViewOnlyNotice\(req\);return null;\}/);
});
