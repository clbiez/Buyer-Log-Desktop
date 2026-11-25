'use strict';
// Açık Fiyat Masası başka kullanıcının fiyat/onay değişikliğini yenilemeden gösterir.
// Eskiden BL_QUOTATIONS.refresh (paylaşılan revizyon 'quotation' değişince çağrılır)
// yalnız qState'i ve Koleksiyon'u tazeliyordu; açık matris eski değeri göstermeye
// devam ediyordu (gerçek tarayıcı kanıtı: scripts/multiuser-collection-pricing-e2e.js,
// gözlemcinin deposu 3,33 iken hücre boş). Kullanıcı bir hücreyi düzenliyorsa veya
// bir panel açıksa çizim ertelenir; odak hücreden çıkınca uygulanır.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/quotations.js'), 'utf8');
const start = source.indexOf('  let qOpenWorkspaceRefreshPending=');
const end = source.indexOf('\n  async function mountWorkspace(', start);

function fixture({ visible = true, mounted = true, focus = null, panelOpen = false, mode = 'quotations' } = {}) {
  const renders = [], listeners = [];
  const panel = { hidden: !panelOpen };
  const detail = { querySelectorAll: () => (panelOpen ? [panel] : []) };
  const host = {
    offsetParent: visible ? {} : null,
    contains: el => Boolean(el && el.inHost),
    addEventListener: (type, fn) => listeners.push({ type, fn }),
  };
  const ctx = {
    qWorkspaceMounted: mounted, qWorkspaceMode: mode,
    qRenderWorkspaceAll: query => renders.push(query),
    document: {
      activeElement: focus,
      getElementById: id => ({ quotationWorkspacePage: host, quotationDetail: detail, quotationSearch: { value: 'q' } })[id] || null,
    },
    setTimeout: fn => fn(),
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start, end) + '\nthis.qRefreshOpenWorkspace=qRefreshOpenWorkspace;', ctx);
  return { ctx, renders, listeners };
}
const editingInput = { inHost: true, matches: selector => /input/.test(selector) };
const navButton = { inHost: true, matches: () => false };

test('kaynak bloğu bulunur ve refresh açık masayı tazeler', () => {
  assert.ok(start > 0 && end > start);
  assert.match(source, /refresh:\(\)=>qHydrateShared\(true\)\.then\(result=>\{qRefreshOpenWorkspace\(\);return result;\}\)/);
});

test('görünür masa uzak değişiklikte yeniden çizilir (arama korunur)', () => {
  const { ctx, renders } = fixture({ focus: navButton });
  ctx.qRefreshOpenWorkspace();
  assert.deepEqual(renders, ['q']);
});

test('görünmeyen veya bağlı olmayan masa çizilmez', () => {
  for (const options of [{ visible: false }, { mounted: false }, { mode: 'pricinghistory' }]) {
    const { ctx, renders } = fixture(options);
    ctx.qRefreshOpenWorkspace();
    assert.deepEqual(renders, [], JSON.stringify(options));
  }
});

test('hücre düzenlenirken çizim ertelenir, odak çıkınca bir kez uygulanır', () => {
  const { ctx, renders, listeners } = fixture({ focus: editingInput });
  ctx.qRefreshOpenWorkspace();
  ctx.qRefreshOpenWorkspace();
  assert.deepEqual(renders, []);
  assert.equal(listeners.length, 1, 'tek bekleyen dinleyici');
  ctx.document.activeElement = null;
  listeners[0].fn();
  assert.deepEqual(renders, ['q']);
});

test('açık panel varken çizim ertelenir', () => {
  const { ctx, renders, listeners } = fixture({ panelOpen: true });
  ctx.qRefreshOpenWorkspace();
  assert.deepEqual(renders, []);
  assert.equal(listeners.length, 1);
});
