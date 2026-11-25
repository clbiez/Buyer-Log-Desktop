'use strict';
// Açık Fiyat Masası başka kullanıcının fiyat/onay değişikliğini yenilemeden gösterir.
// Eskiden BL_QUOTATIONS.refresh (paylaşılan revizyon 'quotation' değişince çağrılır)
// yalnız qState'i ve Koleksiyon'u tazeliyordu; açık matris eski değeri göstermeye
// devam ediyordu (gerçek tarayıcı kanıtı: scripts/multiuser-collection-pricing-e2e.js,
// gözlemcinin deposu 3,33 iken hücre boş). Yeniden çizim: kullanıcı hücre düzenliyor
// ya da panel açıksa ertelenir; görünen içerik değişmediyse yapılmaz; matris/liste
// kaydırması (sanal pencere dahil) ve odaktaki talep korunur.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/quotations.js'), 'utf8');
const start = source.indexOf('  let qOpenWorkspaceRefreshPending=');
const end = source.indexOf('\n  async function mountWorkspace(', start);

function fixture({ visible = true, mounted = true, focus = null, panelOpen = false, mode = 'quotations' } = {}) {
  const renders = [], listeners = [], events = [];
  const panel = { hidden: !panelOpen };
  const detail = { querySelectorAll: () => (panelOpen ? [panel] : []) };
  const scroller = () => ({ scrollTop: 0, scrollLeft: 0, dispatchEvent: e => events.push(e.type) });
  const doms = { '.pdMatrixScroll': scroller(), '#quotationNav': scroller() };
  const navItem = { dataset: { quotationId: 'req-1' }, focused: false, focus() { this.focused = true; } };
  const host = {
    offsetParent: visible ? {} : null,
    contains: el => Boolean(el && el.inHost),
    addEventListener: (type, fn) => listeners.push({ type, fn }),
    querySelector: selector => doms[selector] || null,
    querySelectorAll: () => [navItem],
  };
  const requests = [{ id: 'req-1', updatedAt: '1', status: 'active', items: [{ id: 'l1', rev: 1, price: '3,00' }] }];
  const ctx = {
    qWorkspaceMounted: mounted, qWorkspaceMode: mode, qActiveId: 'req-1', qActiveSource: 'collection',
    qLoad: () => ({ requests }), qVisibleRequests: () => requests,
    qRenderWorkspaceAll: query => { renders.push(query); doms['.pdMatrixScroll'] = scroller(); doms['#quotationNav'] = scroller(); },
    document: {
      activeElement: focus,
      getElementById: id => ({ quotationWorkspacePage: host, quotationDetail: detail, quotationSearch: { value: 'q' } })[id] || null,
    },
    Event: class { constructor(type) { this.type = type; } },
    setTimeout: fn => fn(),
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start, end) + '\nthis.refresh=qRefreshOpenWorkspace;this.signature=qOpenWorkspaceSignature;', ctx);
  return { ctx, renders, listeners, events, doms, requests, navItem };
}
const editingInput = { inHost: true, matches: selector => /input/.test(selector) };

test('kaynak bloğu bulunur ve refresh imzayla açık masayı tazeler', () => {
  assert.ok(start > 0 && end > start);
  assert.match(source, /refresh:\(\)=>\{const before=qOpenWorkspaceSignature\(\);return qHydrateShared\(true\)\.then\(result=>\{qRefreshOpenWorkspace\(before\);return result;\}\);\},/);
});

test('görünen içerik değiştiyse masa çizilir (arama korunur)', () => {
  const f = fixture();
  const before = f.ctx.signature();
  f.requests[0].items[0] = { id: 'l1', rev: 2, price: '3,33' };
  f.ctx.refresh(before);
  assert.deepEqual(f.renders, ['q']);
});

test('görünen içerik değişmediyse çizim yapılmaz', () => {
  const f = fixture();
  f.ctx.refresh(f.ctx.signature());
  assert.deepEqual(f.renders, []);
});

test('matris ve liste kaydırması korunur, sanal pencere için scroll olayı gönderilir', () => {
  const f = fixture();
  f.doms['.pdMatrixScroll'].scrollTop = 6000; f.doms['#quotationNav'].scrollTop = 120;
  f.ctx.refresh();
  assert.equal(f.doms['.pdMatrixScroll'].scrollTop, 6000);
  assert.equal(f.doms['#quotationNav'].scrollTop, 120);
  assert.deepEqual(f.events, ['scroll', 'scroll']);
});

test('odaktaki talep düğmesi yeniden çizimden sonra odakta kalır', () => {
  const focused = { inHost: true, matches: () => false, dataset: { quotationId: 'req-1' } };
  const f = fixture({ focus: focused });
  f.ctx.refresh();
  assert.equal(f.navItem.focused, true);
});

test('görünmeyen veya bağlı olmayan masa çizilmez', () => {
  for (const options of [{ visible: false }, { mounted: false }, { mode: 'pricinghistory' }]) {
    const f = fixture(options);
    f.ctx.refresh();
    assert.deepEqual(f.renders, [], JSON.stringify(options));
  }
});

test('hücre düzenlenirken çizim ertelenir (girilmemiş değer ezilmez), odak çıkınca bir kez uygulanır', () => {
  const f = fixture({ focus: editingInput });
  f.ctx.refresh(); f.ctx.refresh();
  assert.deepEqual(f.renders, []);
  assert.equal(f.listeners.length, 1, 'tek bekleyen dinleyici');
  f.ctx.document.activeElement = null;
  f.listeners[0].fn();
  assert.deepEqual(f.renders, ['q']);
});

test('açık panel varken çizim ertelenir', () => {
  const f = fixture({ panelOpen: true });
  f.ctx.refresh();
  assert.deepEqual(f.renders, []);
  assert.equal(f.listeners.length, 1);
});
