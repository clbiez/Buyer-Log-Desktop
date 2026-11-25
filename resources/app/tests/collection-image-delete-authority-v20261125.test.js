'use strict';

/* Koleksiyon satır görseli silme yetkisi (çok kullanıcılı kampanya A2).

   Görsel deposu modüller arası ortak bir kaynaktır; okuma kimliği (48 bit
   rastgele) bilen herkese açıktır ve kimlik yalnız yetkili görünümlerde
   (Koleksiyon satırı, fiyat talebi resmi, CP model görseli) açığa çıkar.
   Silme ise veriyi yok eder: bir Koleksiyon satırında kullanılan görsel
   yalnız o sayfayı DÜZENLEYEBİLEN kullanıcı (sahip ya da edit izinli) tarafından
   silinebilir. Önceden view izinli kullanıcı, hiç izni olmayan kullanıcı ve CP
   alanı olan herkes kimliği bildiği sahibin satır görselini silebiliyordu. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/multi-user-access-server');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const USERS = [{ id: 'o1' }, { id: 'o2' }, { id: 'v1' }, { id: 'e1' }, { id: 'n1' }, { id: 'mgr', role: 'manager' }, { id: 'mod2', role: 'moderator' }];

test('Koleksiyon satırında kullanılan görseli yalnız o sayfayı düzenleyebilen silebilir; okuma ve sahip akışları korunur', async t => {
  const server = await startServer(t, { users: USERS });
  const ids = ['moderator', ...USERS.map(user => user.id)];
  const s = Object.fromEntries(await Promise.all(ids.map(async id => [id, await server.login(id === 'moderator' ? 'demo.admin' : id)])));
  // Arayüzün yüklediği biçim: rowId yalnız satır numarası, sahip bilgisi yok.
  const upload = async (session, rowId) => {
    const result = await session.post('/api/collection-images', { rowId, filename: 'demo.png', mimeType: 'image/png', base64: PNG });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body.image.id;
  };
  const [a, b, unused] = await Promise.all([upload(s.o1, 1), upload(s.o1, 2), upload(s.o1, 3)]);
  const rows = [{ id: 1, plmId: 'PLM-DEMO-1', imgRef: a }, { id: 2, plmId: 'PLM-DEMO-2', img: `/api/collection-images/${b}` }];
  assert.equal((await s.o1.put('/api/collection-workspaces/o1', { rows, nextId: 3 })).status, 200);
  assert.equal((await s.o2.put('/api/collection-workspaces/o2', { rows: [{ id: 1, plmId: 'PLM-DEMO-O2' }], nextId: 2 })).status, 200);
  await Promise.all([s.o1.put('/api/collection-permissions/v1', { level: 'view' }), s.o1.put('/api/collection-permissions/e1', { level: 'edit' })]);

  // Yetkili görüntüleyen görseli okur; izinsiz kullanıcı kimliği hiçbir Koleksiyon yanıtından öğrenemez.
  const viewer = await s.v1.get('/api/collection-workspaces/o1');
  assert.deepEqual(viewer.body.workspace.rows.map(row => row.imgRef || row.img), [a, `/api/collection-images/${b}`]);
  assert.equal((await s.v1.as('GET', `/api/collection-images/${a}`, { raw: true })).status, 200);
  const outsider = await Promise.all([s.n1.get('/api/collection-workspaces'), s.n1.get('/api/collection-workspaces/o1'), s.n1.get('/api/collection-permissions')]);
  outsider.forEach(result => assert.equal(JSON.stringify(result.body).includes(a), false, 'izinsiz yanıtta görsel kimliği yok'));

  // Satırda kullanılan görseli düzenleme yetkisi olmayan hiç kimse silemez (aynı anda, iki uçtan).
  const attempts = [];
  for (const user of ['v1', 'n1', 'o2', 'mgr', 'mod2', 'moderator']) {
    for (const ref of [a, b]) {
      attempts.push([user, `/api/collection-images/${ref}`], [user, `/api/cp-images/${ref}`]);
    }
  }
  const denied = await Promise.all(attempts.map(([user, url]) => s[user].del(url)));
  denied.forEach((result, index) => assert.equal(result.status, 403, `${attempts[index].join(' DELETE ')} → ${JSON.stringify(result.body)}`));
  for (const ref of [a, b]) assert.equal((await s.o1.as('GET', `/api/collection-images/${ref}`, { raw: true })).status, 200, 'sahibin satır görseli yerinde');

  // Edit izinli kullanıcının değiştir-ve-eskiyi-sil akışı (istemci kolDeleteUnusedImageRefs) çalışır.
  const replacement = await upload(s.e1, 1);
  const current = (await s.e1.get('/api/collection-workspaces/o1')).body.workspace;
  assert.equal((await s.e1.put('/api/collection-workspaces/o1', { ...current, rows: current.rows.map(row => (row.id === 1 ? { ...row, imgRef: replacement } : row)) })).status, 200);
  const editorDelete = await s.e1.del(`/api/collection-images/${a}`);
  assert.equal(editorDelete.status, 200); assert.equal(editorDelete.body.deleted, true);
  // Edit izinli kullanıcı satırda hâlâ kullanılan görseli de silebilir (görseli kaldır akışı).
  assert.equal((await s.e1.del(`/api/collection-images/${replacement}`)).status, 200);
  // Sahip kendi satır görselini ve kullanılmayan görselini siler.
  assert.equal((await s.o1.del(`/api/collection-images/${b}`)).body.deleted, true);
  assert.equal((await s.o1.del(`/api/collection-images/${unused}`)).body.deleted, true);
  // Olmayan kimlik: yetki hatası değil, silinecek bir şey yok.
  const missing = await s.n1.del('/api/collection-images/ci_0_000000000000');
  assert.equal(missing.status, 200); assert.equal(missing.body.deleted, false);
});

test('ownersReferencingImage: img/imgRef/URL biçimleri, data: atlanır, dosya değişince önbellek anında yenilenir', () => {
  const { spawnSync } = require('node:child_process');
  const script = `
    const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert');
    process.env.BUYER_LOG_SERVER_DATA_ROOT=fs.mkdtempSync(path.join(os.tmpdir(),'bl-img-owner-'));
    const ws=require('./server/lib/collection-workspaces');
    const write=(owner,rows,pretty)=>{const file=ws.workspaceFile(owner);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify({ownerId:owner,initialized:true,rows,nextId:9},null,pretty?2:0));fs.renameSync(file+'.tmp',file);};
    write('a',[{id:1,imgRef:'ci_1_aaaaaaaaaaaa'},{id:2,img:'/api/collection-images/ci_2_bbbbbbbbbbbb?v=3'},{id:3,img:'data:image/png;base64,ci_3_cccccccccccc'}],true);
    write('b',[{id:1,img:'/api/cp-images/ci_2_bbbbbbbbbbbb'}],false);
    assert.deepEqual(ws.ownersReferencingImage('ci_1_aaaaaaaaaaaa').sort(),['a']);
    assert.deepEqual(ws.ownersReferencingImage('ci_2_bbbbbbbbbbbb').sort(),['a','b']);
    assert.deepEqual(ws.ownersReferencingImage('ci_3_cccccccccccc'),[],'gömülü data: kimlik sayılmaz');
    assert.deepEqual(ws.ownersReferencingImage('ci_2_bbbbbbbbbbbb',{actorId:'a'}),['b'],'aktörün kendi sayfası atlanır');
    assert.deepEqual(ws.ownersReferencingImage('ci_2_bbbbbbbbbbbb',{skipOwner:o=>o==='b'}),['a']);
    write('b',[{id:1,imgRef:'ci_9_dddddddddddd'}],false);
    assert.deepEqual(ws.ownersReferencingImage('ci_2_bbbbbbbbbbbb'),['a'],'yeniden yazılan sayfa önbellekten eski kimliği döndürmez');
    assert.deepEqual(ws.ownersReferencingImage('ci_9_dddddddddddd'),['b']);
    fs.rmSync(process.env.BUYER_LOG_SERVER_DATA_ROOT,{recursive:true,force:true});`;
  const result = spawnSync(process.execPath, ['-e', script], { cwd: require('node:path').join(__dirname, '..'), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
