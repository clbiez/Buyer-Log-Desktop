'use strict';

/* 30.000 satırlık ölçümde bulunan hata: sayfa önbelleği (page projection)
   hiçbir zaman okunamıyordu. Bağlam özeti bağlantı kapsamlarını içerir;
   kimliği saklanmamış (eski kayıt, türetilmiş Siparişler kapsamı) kapsamlara
   HER OKUMADA rastgele kimlik atandığı için özet her istekte değişiyor, yazılan
   önbellek hemen ardından "bulunamadı" oluyor ve her sayfa açılışı veriyi
   sunucuda baştan hesaplıyordu (CP: 8,4 sn / 50 MB). Okuma sırasında üretilen
   kimlik artık içerikten türetilir ve kararlıdır. */
const test = require('node:test');
const assert = require('node:assert/strict');
const scopes = require('../server/lib/model-scopes');

const horizon = value => ({ ...(value || {}) });

test('kimliği saklanmamış kapsamlar her okumada aynı kimliği alır', () => {
  for (const [raw, role] of [
    [[], 'asas'],
    [[{ targets: ['cp', 'backlog'], horizon: { seasons: ['6S27'] } }], 'asas'],
    [[{ targets: ['cp', 'orders'], horizon: {} }], 'asas'],
  ]) {
    const first = scopes.normalizeScopes(raw, role, {}, horizon);
    const second = scopes.normalizeScopes(JSON.parse(JSON.stringify(raw)), role, {}, horizon);
    assert.ok(first.length > 0);
    assert.deepEqual(first.map(item => item.id), second.map(item => item.id));
  }
});

test('saklanmış kimlik aynen korunur', () => {
  const out = scopes.normalizeScopes([{ id: 'sc_kalici', targets: ['cp'], horizon: {} }], 'asas', {}, horizon);
  assert.equal(out.find(item => item.targets.includes('cp')).id, 'sc_kalici');
});
