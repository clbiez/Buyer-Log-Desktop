'use strict';

// Aşama bazlı yol süresi modeli.
// Gerekçe: tek bir "ortalama yol süresi" erken gelecek ürünü göstermez, ortalamayı
// aşmış ama hâlâ yolda görünen ürünü "yetişecek" gösterir. Model IAS'ın gerçekleşen
// kilometre taşlarından her aşamanın ortalama/P80 süresini ve her kilometre
// taşından antrepoya KALAN süre dağılımını çıkarır; sipariş ETA'sı son gerçekleşen
// kilometre taşından yeniden hesaplanır.

const test = require('node:test');
const assert = require('node:assert/strict');
const SM = require('../public/transit-stage-model');

const D = (base, plus) => {
  const d = new Date(Date.UTC(2026, 0, 1) + (base + plus) * 86400000);
  return d.toISOString().slice(0, 10);
};
// Zincir: talep +3 handover +4 cutoff +2 yükleme +40 ETA +1 özet +1 ambar +1 transit +2 antrepo = 54
function shipment(start, overrides = {}) {
  const gaps = { handover: 3, cutOff: 4, actualLoading: 2, eta: 40, summaryDeclaration: 1, warehouseApproval: 1, transitDeclaration: 1, warehouseEntry: 2, ...overrides };
  const out = { country: 'Bangladesh', vehicle: 'Gemi', arrived: true, loadingRequest: D(start, 0) };
  let t = 0;
  for (const m of ['handover', 'cutOff', 'actualLoading', 'eta', 'summaryDeclaration', 'warehouseApproval', 'transitDeclaration', 'warehouseEntry']) {
    t += gaps[m]; out[m] = D(start, t);
  }
  return out;
}

function sampleModel() {
  const list = [];
  for (let i = 0; i < 10; i += 1) list.push(shipment(i * 3, { eta: 38 + (i % 5) })); // ETA ayağı 38..42
  return SM.buildModel(list, { today: '2026-12-31' });
}

test('aşama ortalamaları yalnız iki ucu gerçekleşen parsiyelden; kalan süre doğrudan ölçülür', () => {
  const model = sampleModel();
  const g = model.groups.find(x => x.scope === 'country');
  assert.equal(g.n, 10);
  assert.equal(g.stages['1'].mean, 3);
  assert.equal(g.stages['4'].mean, 40);
  // Talep → antrepo = 3+4+2+40+1+1+1+2 = 54 ortalama
  assert.equal(g.remaining.loadingRequest.mean, 54);
  assert.equal(g.remaining.handover.mean, 51);
  assert.equal(g.remaining.eta.mean, 5);
  assert.equal(g.remaining.loadingRequest.q.length, SM.QUANTILES.length);
  assert.ok(g.remaining.loadingRequest.p80 >= g.remaining.loadingRequest.mean);
  // Taşıt geneli yedek grup da kurulur.
  assert.ok(model.groups.some(x => x.scope === 'vehicle' && x.countryKey === '*'));
});

test('henüz varmamış ve tutarsız parsiyeller dağılımı bozmaz', () => {
  const list = [shipment(0), { ...shipment(3), arrived: false, warehouseEntry: '' }, { ...shipment(6), eta: '2024-01-01' }];
  for (let i = 0; i < 5; i += 1) list.push(shipment(10 + i));
  const model = SM.buildModel(list, { today: '2026-12-31' });
  assert.equal(model.stats.notArrived, 1);
  assert.equal(model.stats.inconsistent, 1);
  const g = model.groups.find(x => x.scope === 'country');
  assert.equal(g.stages['4'].mean, 40, 'bozuk ETA aşama 4 ortalamasına girmez');
});

test('erken tamamlanan aşama ETA\'yı öne çeker; ortalamayı aşan açık aşama ETA\'yı iter', () => {
  const model = sampleModel();
  const base = { loadingRequest: '2026-03-01' };
  // Handover 1 günde gerçekleşti (ortalama 3) → 2 gün kazanç beklenir.
  const early = SM.project({ ...base, handover: '2026-03-02' }, { model, country: 'Bangladesh', vehicle: 'Gemi', today: '2026-03-03' });
  assert.equal(early.anchor, 'handover');
  assert.equal(early.etaMean, '2026-04-22'); // 03-02 + 51
  // Temel çizgi ilk ölçülen kilometre taşından: talep + 54 = 04-24 → 2 gün erken.
  assert.equal(early.gainDays, 2);
  const plain = SM.project(base, { model, country: 'Bangladesh', vehicle: 'Gemi', today: '2026-03-02' });
  assert.equal(plain.etaMean, '2026-04-24');
  assert.equal(SM.dayOrdinal(plain.etaMean) - SM.dayOrdinal(early.etaMean), 2);
  const stage1 = early.stages.find(s => s.code === '1');
  assert.equal(stage1.status, 'done');
  assert.equal(stage1.deviation, -2);

  // Talep yapıldı, 10 gündür Handover yok (ortalama 3) → açık aşım 7 gün; ETA en erken bugün + Kalan(handover).
  const late = SM.project(base, { model, country: 'Bangladesh', vehicle: 'Gemi', today: '2026-03-11' });
  assert.equal(late.openOverrunDays, 7);
  assert.equal(late.etaMean, '2026-05-01'); // 03-11 + 51
  assert.equal(late.currentStage, '1');
  assert.ok(late.gainDays < 0, 'temel çizgiye göre geç');
});

test('planlı gelecek ETA (gemi tarifesi) çapayı geçer; olasılık dağılımdan gelir', () => {
  const model = sampleModel();
  const p = SM.project({ loadingRequest: '2026-03-01', handover: '2026-03-04', cutOff: '2026-03-08', actualLoading: '2026-03-10', eta: '2026-04-30' },
    { model, country: 'Bangladesh', vehicle: 'Gemi', today: '2026-03-20' });
  assert.equal(p.anchor, 'actualLoading');
  assert.equal(p.plan, 'eta');
  assert.equal(p.etaMean, '2026-05-05'); // 04-30 + 5
  // 10 gündür yolda (ortalama ETA ayağı 40 gün): planlı ETA gelecekte → açık aşım yok.
  assert.equal(p.openOverrunDays, 0);
  const sailing = SM.project({ loadingRequest: '2026-03-01', handover: '2026-03-04', cutOff: '2026-03-08', actualLoading: '2026-03-10', eta: '2026-06-30' },
    { model, country: 'Bangladesh', vehicle: 'Gemi', today: '2026-05-20' });
  assert.equal(sailing.openOverrunDays, 0, 'gemi tarifesi gecikmiş olsa da planlı ETA aşımı açık aşım değildir; ETA planla ileri gider');
  assert.equal(sailing.etaMean, '2026-07-05');
  assert.equal(p.probability('2026-05-20'), 1);
  assert.equal(p.probability('2026-04-01'), 0);
  const c = SM.compact(p, { retail: '2026-05-20', inStore: '2026-04-01' });
  assert.equal(c.pRetail, 1);
  assert.equal(c.pInStore, 0);
  assert.equal(c.stages.length, SM.STAGES.length);
  assert.equal(JSON.parse(JSON.stringify(c)).etaMean, '2026-05-05');
});

test('olasılık çapadan beri geçen süreyle koşullanır; varmış parsiyelde projeksiyon yok', () => {
  const model = sampleModel();
  const p = SM.project({ loadingRequest: '2026-03-01', handover: '2026-03-04', cutOff: '2026-03-08', actualLoading: '2026-03-10' },
    { model, country: 'Bangladesh', vehicle: 'Gemi', today: '2026-04-25' });
  // 46 gün geçti; kalan (fiili yükleme → antrepo) 43..47 → hedef bugünden önce olamaz.
  assert.equal(p.probability('2026-04-20'), 0);
  assert.ok(p.probability('2026-05-10') >= 0.99);
  assert.equal(SM.project({ ...shipment(0) }, { model, country: 'Bangladesh', vehicle: 'Gemi', today: '2026-12-31' }), null);
});

test('örneklem azsa taşıt geneline düşer, o da yoksa projeksiyon üretmez', () => {
  const model = sampleModel();
  const other = SM.project({ loadingRequest: '2026-03-01' }, { model, country: 'Vietnam', vehicle: 'Gemi', today: '2026-03-02' });
  assert.equal(other.scope, 'vehicle');
  assert.equal(SM.project({ loadingRequest: '2026-03-01' }, { model, country: 'Bangladesh', vehicle: 'Uçak', today: '2026-03-02' }), null);
});

test('normalizeModel kalıcı şekli doğrular; eski Excel analizi model sayılmaz', () => {
  const model = sampleModel();
  const again = SM.normalizeModel(JSON.parse(JSON.stringify(model)));
  assert.deepEqual(again.groups, model.groups);
  assert.equal(SM.normalizeModel({ version: 1, records: [{ country: 'X' }] }), null);
  assert.equal(SM.normalizeModel(null), null);
  // Evrak tarihi yoksa geç teslim oranı bilinmiyor (0 değil).
  assert.equal(again.groups[0].docsLateShare, null);
});
