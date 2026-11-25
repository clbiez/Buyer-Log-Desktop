'use strict';
// Fiyat Masası durum sekmesi sayıları (Devam Eden / Onay Bekleyen / … / Tümü)
// listeyle aynı Buyer kapsamını kullanır. Eskiden sayılar kapsamı yok sayıyordu:
// başka bir sahibin Koleksiyonunu görme izni olan kullanıcı varsayılan
// "Benim kayıtlarım" kapsamında "Devam Eden 1" görüp altında "0 kayıt · Devam eden
// quotation kaydı bulunmuyor" okuyordu (gerçek tarayıcı kanıtı:
// scripts/multiuser-collection-pricing-e2e.js).
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/quotations.js'), 'utf8');
const start = source.indexOf('  function qPricingEngine(){');
const end = source.indexOf('\n  function qRenderNav(', start);

function fixture(scopeAllows) {
  const counts = {};
  const buttons = ['active', 'all'].map(key => ({
    dataset: { quotationStatusFilter: key }, classList: { toggle() {} }, setAttribute() {},
    querySelector: () => ({ set textContent(value) { counts[key] = value; } }),
  }));
  const ctx = {
    window: { BLPricingDesk: scopeAllows ? { scopeAllows } : undefined },
    document: { getElementById: id => id === 'quotationStatusTabs' ? { querySelectorAll: () => buttons } : null },
    qActiveSource: 'collection', qStatusFilter: 'active',
    qLoad: () => ({ requests: [
      { id: 'mine', source: 'collection', ownerId: 'me', status: 'active', items: [] },
      { id: 'other', source: 'collection', ownerId: 'owner', status: 'active', items: [] },
      { id: 'cp', source: 'cp', ownerId: 'me', status: 'active', items: [] },
    ] }),
    parseTableSearchTerms: () => [], tableSearchMatches: () => true, BLPricingWorkspaceEngine: null,
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start, end) + '\nthis.qRenderStatusTabs=qRenderStatusTabs;this.qVisibleRequests=qVisibleRequests;', ctx);
  return { ctx, counts };
}

test('kaynak bloğu bulunur', () => { assert.ok(start > 0 && end > start); });

test('sekme sayıları Buyer kapsamındaki listeyle aynıdır', () => {
  const { ctx, counts } = fixture(req => req.ownerId === 'me');
  ctx.qRenderStatusTabs();
  assert.equal(ctx.qVisibleRequests('collection', '').length, 1);
  assert.equal(counts.active, '1');
  assert.equal(counts.all, '1');
});

test('Fiyat Masası yüklü değilse (kapsam yok) herkes sayılır — eski davranış', () => {
  const { ctx, counts } = fixture(null);
  ctx.qRenderStatusTabs();
  assert.equal(counts.active, '2');
});
