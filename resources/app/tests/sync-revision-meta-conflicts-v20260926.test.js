'use strict';

/* Çok cihazlı gerçek kullanım senaryosunda bulunan hata: her cihaz kendi CP
   düzenlemesinde store:overrides.json belgesinin storeRevisionMeta alanını
   (yerel revizyon sayacı + zaman damgası) güncelliyor. Bu defter alanı ortak
   alan gibi birleştirildiği için HER eşzamanlı düzenleme bir "senkron
   çakışması" üretiyordu; beş kişilik ekipte Sync durumu anlamsız çakışmalarla
   doluyor ve gerçek çakışmaları gizliyordu. Defter alanı çakışma üretmez
   (yüksek revizyon kazanır); iş alanlarındaki gerçek çakışma aynen kaydedilir. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLocalDb } = require('../server/lib/local-db');

function meta(revision, updatedAt) { return { revision, revisions: { orders: revision }, updatedAt }; }

test('storeRevisionMeta eşzamanlı yazımda çakışma üretmez; gerçek alan çakışması korunur', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-revision-meta-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const db = createLocalDb(path.join(root, 'BuyerLogLocal.db'));
  const id = 'store:overrides.json';
  // Ortak başlangıç (revizyon 1), ardından bu cihaz yerelde iki alanı değiştirir.
  await db.applyDelta({ id, eventId: 'seed', revision: 1, patch: { pricingRules: [], storeRevisionMeta: meta(1, '2026-09-26T00:00:00.000Z') } });
  await db.queuePatch({ id, patch: { pricingRules: [{ id: 'local' }], storeRevisionMeta: meta(3, '2026-09-26T00:00:03.000Z') } });
  // Başka cihaz aynı taban revizyonundan kendi değişikliğini gönderir.
  await db.applyDelta({ id, eventId: 'remote-1', revision: 2, baseRevision: 1, deviceId: 'other', patch: { pricingRules: [{ id: 'remote' }], storeRevisionMeta: meta(2, '2026-09-26T00:00:02.000Z') } });

  const conflicts = await db.listConflicts();
  assert.deepEqual(conflicts.map(item => item.field), ['pricingRules'], 'yalnız gerçek iş alanı çakışır');
  const record = (await db.read()).records[id];
  assert.deepEqual(record.pricingRules, [{ id: 'local' }], 'çakışan yerel değer kullanıcı çözene kadar korunur');
  assert.equal(record.storeRevisionMeta.revision, 3, 'yüksek revizyonlu defter kaydı korunur');

  // Uzak defter daha yeniyse sessizce uygulanır (çakışma yok).
  await db.applyDelta({ id, eventId: 'remote-2', revision: 4, baseRevision: 2, deviceId: 'other', patch: { storeRevisionMeta: meta(7, '2026-09-26T00:00:07.000Z') } });
  assert.equal((await db.read()).records[id].storeRevisionMeta.revision, 7);
  assert.equal((await db.listConflicts()).length, 1);
});
