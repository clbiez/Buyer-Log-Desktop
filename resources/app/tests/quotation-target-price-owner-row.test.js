'use strict';
// Fiyat Masası "Hedef" ve "Δ Hedef" her yetkili kullanıcıda talep sahibinin
// Koleksiyon satırındaki güncel hedef fiyattan okunur. Eskiden sahip olmayan
// kullanıcı (düzenleyici/görüntüleyen) talep oluşturulurken kopyalanan eski
// item.targetPrice'ı görüyordu: sahip hedefi $3,90'a indirdiğinde sahip
// "$3,90 / +5,1%", görüntüleyen aynı satırda "$4,50 / −8,9%" görüyordu
// (gerçek tarayıcı kanıtı: scripts/multiuser-collection-pricing-e2e.js).
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/quotations.js'), 'utf8');
const start = source.indexOf('  function qItemTargetPrice(');
const end = source.indexOf('\n  function qTargetDelta(', start);
function target({ me = 'viewer', loadedOwner = 'viewer', row = { targetPrice: '3,90' }, source: src = 'collection' } = {}) {
  const ctx = {
    qNorm: v => String(v == null ? '' : v).trim(), qCurrentUserId: () => me, qLoadedWorkspaceOwner: () => loadedOwner,
    qFindCollectionRow: () => row, qFindCpRow: () => null, qCollectionEffectiveValue: (r, key) => r[key],
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start, end) + '\nthis.f=qItemTargetPrice;', ctx);
  return ctx.f({ ownerId: 'owner', source: src }, { targetPrice: '4,50' });
}

test('kaynak bloğu bulunur', () => { assert.ok(start > 0 && end > start); });
test('sahip olmayan kullanıcı sahibin güncel satır hedefini görür', () => { assert.equal(target(), '3,90'); });
test('sahip satırı bulunamazsa talepteki hedef kullanılır', () => { assert.equal(target({ row: null }), '4,50'); });
test('Koleksiyon bağlamı bilinmiyorsa (sahip kapsamı yok) yabancı satır okunmaz', () => { assert.equal(target({ loadedOwner: '' }), '4,50'); });
test('CP kaynaklı yabancı talepte talepteki hedef korunur', () => { assert.equal(target({ source: 'cp' }), '4,50'); });
test('sahip için eski davranış', () => { assert.equal(target({ me: 'owner', loadedOwner: 'owner' }), '3,90'); });
