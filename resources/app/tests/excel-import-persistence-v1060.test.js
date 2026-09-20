'use strict';

/*
 * KULLANICI EXCEL'İ İÇERİ AKTARMA — KALICILIK, ATOMİKLİK, EŞ ZAMANLILIK
 *
 * Çivilenen davranışlar:
 *   1) Onaylanmış bir içe aktarma TEK işlemdir: Koleksiyon tarafında bir satır
 *      bile çakışırsa HİÇBİR satır yazılmaz (150. satırda hata 1–149'u
 *      "başarılı" bırakamaz).
 *   2) Normal düzenleme yolu DEĞİŞMEZ: atomic istenmediğinde çakışmayan
 *      satırlar yazılmaya devam eder.
 *   3) CP tarafı zaten tek revizyon kapılı tek yazmadır: bayat revizyonla
 *      gelen parti reddedilir ve dosyaya hiçbir şey yazılmaz.
 *   4) CP içe aktarımı mevcut override yollarını kullanır: not, not sütunu,
 *      alt üretici, Supp. FOB ve tarih revizyonu aynı kayıtla yazılır.
 *   5) Mevcut CP/Koleksiyon kaydetme davranışı bozulmaz.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-xlsimport-'));
Object.assign(process.env, {
  BUYER_LOG_SERVER_DATA_ROOT: path.join(root, 'data'),
  BUYER_LOG_DATA_ROOT: path.join(root, 'app'),
  BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local'),
  BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json'),
});

const store = require('../server/lib/collection-workspaces');
const db = require('../server/db');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

async function seed(ownerId, rows) {
  await store.saveWorkspaceAsync(ownerId, { rows, manufacturers: [], customColumns: [], nextId: rows.length + 1 }, null);
  return store.loadWorkspace(ownerId);
}

test('atomik içe aktarma: tek satır çakışırsa hiçbir satır yazılmaz', async () => {
  const owner = 'atomik';
  await seed(owner, [{ id: 1, not: '' }, { id: 2, not: '' }, { id: 3, not: '' }]);
  const current = store.loadWorkspace(owner);
  const revs = new Map(current.rows.map(row => [row.id, store.rowRev(row)]));

  // Başka bir kullanıcı 2. satırı değiştirir.
  await store.applyRowChangesAsync(owner, {
    upserts: [{ id: 2, not: 'ekip arkadaşı', _rev: revs.get(2) }], deletes: [], nextId: 4,
  });

  const before = store.loadWorkspace(owner);
  await assert.rejects(
    () => store.applyRowChangesAsync(owner, {
      atomic: true,
      upserts: [
        { id: 1, not: 'excel-1', _rev: revs.get(1) },
        { id: 2, not: 'excel-2', _rev: revs.get(2) },   // bayat
        { id: 3, not: 'excel-3', _rev: revs.get(3) },
      ],
      deletes: [], nextId: 4,
    }),
    error => error && error.code === 'COLLECTION_ATOMIC_CONFLICT' && error.statusCode === 409 && Array.isArray(error.conflicts),
  );

  const after = store.loadWorkspace(owner);
  assert.equal(after._revision, before._revision, 'revizyon artmaz');
  assert.equal(after.rows.find(row => row.id === 1).not, '', '1. satır yazılmadı');
  assert.equal(after.rows.find(row => row.id === 3).not, '', '3. satır yazılmadı');
  assert.equal(after.rows.find(row => row.id === 2).not, 'ekip arkadaşı', 'ekip arkadaşının değeri korunur');
});

test('atomic istenmediğinde mevcut satır bazlı davranış aynen sürer', async () => {
  const owner = 'normal';
  await seed(owner, [{ id: 1, not: '' }, { id: 2, not: '' }]);
  const revs = new Map(store.loadWorkspace(owner).rows.map(row => [row.id, store.rowRev(row)]));
  await store.applyRowChangesAsync(owner, { upserts: [{ id: 2, not: 'başkası', _rev: revs.get(2) }], deletes: [], nextId: 3 });

  const result = await store.applyRowChangesAsync(owner, {
    upserts: [{ id: 1, not: 'benim', _rev: revs.get(1) }, { id: 2, not: 'ezilmez', _rev: revs.get(2) }],
    deletes: [], nextId: 3,
  });
  assert.equal(result.applied.length, 1);
  assert.equal(result.conflicts.length, 1);
  assert.equal(store.loadWorkspace(owner).rows.find(row => row.id === 1).not, 'benim');
  assert.equal(store.loadWorkspace(owner).rows.find(row => row.id === 2).not, 'başkası');
});

test('atomik parti tamamen uygulanabiliyorsa tek yazmada geçer', async () => {
  const owner = 'temiz';
  await seed(owner, [{ id: 1, not: '' }, { id: 2, not: '' }]);
  const current = store.loadWorkspace(owner);
  const revs = new Map(current.rows.map(row => [row.id, store.rowRev(row)]));
  const result = await store.applyRowChangesAsync(owner, {
    atomic: true,
    upserts: [{ id: 1, not: 'a', _rev: revs.get(1) }, { id: 2, not: 'b', _rev: revs.get(2) }, { id: 9, not: 'yeni' }],
    deletes: [], nextId: 10,
  });
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.applied.length, 3);
  const saved = store.loadWorkspace(owner);
  assert.equal(saved.rows.length, 3);
  assert.equal(saved._revision, current._revision + 1, 'tek revizyon artışı');
});

test('atomik içe aktarma yapısal değişikliği (yeni özel sütun) aynı yazmada taşır', async () => {
  const owner = 'yapisal';
  await seed(owner, [{ id: 1, not: '' }]);
  const current = store.loadWorkspace(owner);
  const result = await store.applyRowChangesAsync(owner, {
    atomic: true,
    baseRevision: current._revision,
    structure: { customColumns: [{ k: 'cx_a1', label: 'Serbest' }], manufacturers: [], order: ['1'] },
    upserts: [{ id: 1, cx_a1: 'değer', _rev: store.rowRev(current.rows[0]) }],
    deletes: [], nextId: 2,
  });
  assert.equal(result.conflicts.length, 0);
  const saved = store.loadWorkspace(owner);
  assert.equal(saved.customColumns.length, 1);
  assert.equal(saved.rows[0].cx_a1, 'değer');
});

/* ---------------- CP ---------------- */

test('CP içe aktarımı tek revizyon kapılı tek partidir; bayat revizyon hiçbir şey yazmaz', () => {
  const first = db.patchOrderOverrides([
    { orderCode: 5001, patch: { model: 'M1', ccode: '001', notes: { Notes: 'excel-1' } } },
    { orderCode: 5002, patch: { model: 'M2', ccode: '002', notes: { Notes: 'excel-2' } } },
  ], 0, null, { actor: { id: 'u1', name: 'Test' } });
  assert.equal(first.updated, 2);
  assert.equal(first.revision, 1);

  assert.throws(
    () => db.patchOrderOverrides([{ orderCode: 5003, patch: { notes: { Notes: 'geç kalan' } } }], 0),
    error => error && error.code === 'REVISION_CONFLICT' && error.currentRevision === 1,
  );
  const overrides = db.loadOverrides();
  assert.equal(overrides._revisions.orders, 1, 'reddedilen parti revizyonu artırmaz');
  assert.ok(!Object.keys(overrides.notesmap).some(key => String(key).startsWith('5003')), 'reddedilen parti hiçbir satır yazmaz');
});

test('CP içe aktarımı mevcut override alanlarını kullanır (not, not sütunu, alt üretici, FOB, tarih)', () => {
  const columns = db.replaceNoteColumnDefs([{ id: 'note_imp', label: 'Excel Notu' }], null);
  assert.equal(columns.columns.length, 1);
  const revision = db.loadOverrides()._revisions.orders;
  const saved = db.patchOrderOverrides([{
    orderCode: 6001,
    patch: {
      model: 'MX', ccode: '010',
      notes: { Notes: 'aktarıldı' },
      noteColumns: { note_imp: 'özel değer' },
      subManufacturer: 'ALT ÜRETİCİ',
      suppFob: 4.75, suppFobMeta: { source: 'manual' },
      dates: { exFactory: '2026-05-06', retailDate: null },
    },
  }], revision, 0, { actor: { id: 'u1', name: 'Test' } });
  assert.equal(saved.updated, 1);

  const overrides = db.loadOverrides();
  const key = Object.keys(overrides.notesmap).find(item => item.startsWith('6001'));
  assert.ok(key, 'satır bazlı anahtar kullanılır');
  assert.equal(overrides.notesmap[key].Notes, 'aktarıldı');
  assert.equal(overrides.notesmap[key].NotesByName, 'Test', 'yazar sunucudan gelir');
  assert.equal(overrides.noteColumnValues[key].note_imp, 'özel değer');
  assert.equal(overrides.submap[key], 'ALT ÜRETİCİ');
  assert.equal(overrides.suppfobmap[key], 4.75);
  assert.equal(overrides.datemap[key].ex, '2026-05-06');
  assert.ok(!overrides.datemap[key].retail, 'null tarih revizyonu kaldırır');
});

test('bilinmeyen not sütununa yazılamaz (silinmiş sütun hayalet değer bırakmaz)', () => {
  const revision = db.loadOverrides()._revisions.orders;
  db.patchOrderOverrides([{
    orderCode: 6002, patch: { model: 'MY', ccode: '011', noteColumns: { note_yok: 'olmamalı' } },
  }], revision);
  const overrides = db.loadOverrides();
  const key = Object.keys(overrides.noteColumnValues).find(item => item.startsWith('6002'));
  assert.equal(key, undefined);
});

test('geçersiz sipariş kodu sessizce yutulmaz, atlandı olarak raporlanır', () => {
  const revision = db.loadOverrides()._revisions.orders;
  const saved = db.patchOrderOverrides([
    { orderCode: 'abc', patch: { notes: { Notes: 'x' } } },
    { orderCode: 6003, patch: { notes: { Notes: 'y' } } },
  ], revision);
  assert.equal(saved.updated, 1);
  assert.equal(saved.skipped.length, 1);
  assert.equal(saved.skipped[0].reason, 'invalid-order-code');
});
