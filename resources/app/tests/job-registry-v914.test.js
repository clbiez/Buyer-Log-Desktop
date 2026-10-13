'use strict';
/* v9.14 — PLM iş kaydı: jobId bazlı, kapsamı izole ilerleme.

   ÇÖZÜLEN SORUN: ilerleme durumu kullanıcı başına TEK slotta tutuluyordu
   (modelOperationProgress). Koleksiyon'da başlatılan bir iş, CP ekranında da
   aynı metni gösteriyordu; ikinci bir iş başlayınca birincinin bilgisi
   eziliyordu. İstemcide de tek bir zamanlayıcı değişkeni vardı.

   Bu testler zamanı ENJEKTE ederek oran/ETA hesaplarını belirlenimci sınar. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createJobRegistry } = require(path.join(__dirname, '..', 'server/lib/job-registry.js'));

// Zamanı elle ilerletebilen bir kayıt: hız/ETA testleri saate bağlı kalmasın.
function fixedClock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: ms => { now += ms; }, set: value => { now = value; } };
}

test('iki ayrı işin sayaçları birbirine karışmaz', () => {
  const registry = createJobRegistry();
  const a = registry.create('u1', { kind: 'plm-sync', scope: 'koleksiyon', total: 100 });
  const b = registry.create('u1', { kind: 'plm-images', scope: 'cp', total: 40 });

  registry.update('u1', a.id, { processed: 30, activeModel: '2100968' });
  registry.update('u1', b.id, { processed: 5, activeModel: '2119399' });

  assert.equal(registry.describe('u1', a.id).processed, 30);
  assert.equal(registry.describe('u1', b.id).processed, 5);
  assert.equal(registry.describe('u1', a.id).activeModel, '2100968');
  assert.equal(registry.describe('u1', b.id).activeModel, '2119399');
});

test('KAPSAM süzgeci: bir sayfanın işi başka sayfada görünmez', () => {
  const registry = createJobRegistry();
  registry.create('u1', { kind: 'plm-sync', scope: 'koleksiyon', total: 10 });
  registry.create('u1', { kind: 'plm-images', scope: 'cp', total: 10 });
  registry.create('u1', { kind: 'plm-links', scope: 'orders', total: 10 });

  assert.deepEqual(registry.list('u1', { scope: 'koleksiyon' }).map(j => j.scope), ['koleksiyon']);
  assert.deepEqual(registry.list('u1', { scope: 'cp' }).map(j => j.scope), ['cp']);
  // Kapsam verilmezse hepsi döner — operasyon merkezi bunu kullanır.
  assert.equal(registry.list('u1').length, 3);
});

test('kullanıcılar birbirinin işini görmez', () => {
  const registry = createJobRegistry();
  registry.create('u1', { kind: 'plm-sync', scope: 'koleksiyon', total: 5 });
  registry.create('u2', { kind: 'plm-sync', scope: 'koleksiyon', total: 5 });
  assert.equal(registry.list('u1').length, 1);
  assert.equal(registry.list('u2').length, 1);
});

test('sayfa değişse de iş çalışmaya devam eder (kayıt silinmez)', () => {
  const registry = createJobRegistry();
  const job = registry.create('u1', { kind: 'plm-sync', scope: 'koleksiyon', total: 100 });
  registry.update('u1', job.id, { processed: 10 });
  // Kullanıcı CP'ye geçti: CP kendi kapsamını sorar, Koleksiyon işi görünmez…
  assert.equal(registry.list('u1', { scope: 'cp' }).length, 0);
  // …ama iş durmadı, geri dönünce yerinde.
  assert.equal(registry.describe('u1', job.id).processed, 10);
  assert.equal(registry.describe('u1', job.id).running, true);
});

test('ilerleme ölçüleri: kalan, yüzde, hız ve ETA', () => {
  const clock = fixedClock();
  const registry = createJobRegistry({ now: clock.now });
  const job = registry.create('u1', { kind: 'plm-sync', scope: 'koleksiyon', total: 100 });

  clock.advance(60_000);                       // 1 dakika geçti
  registry.update('u1', job.id, { processed: 20 });
  const view = registry.describe('u1', job.id);

  assert.equal(view.remaining, 80);
  assert.equal(view.percent, 20);
  assert.equal(view.elapsedMs, 60_000);
  assert.equal(view.ratePerMinute, 20);        // dakikada 20 model
  assert.equal(view.etaMs, 240_000);           // kalan 80 → 4 dakika
});

test('hiç iş yapılmadan ETA uydurulmaz', () => {
  const clock = fixedClock();
  const registry = createJobRegistry({ now: clock.now });
  const job = registry.create('u1', { kind: 'plm-sync', scope: 'koleksiyon', total: 100 });
  clock.advance(5_000);
  const view = registry.describe('u1', job.id);
  assert.equal(view.ratePerMinute, 0);
  assert.equal(view.etaMs, null, 'veri yokken ETA gösterilmemeli');
});

test('başarısız modeller ayrıntısıyla saklanır ve yalnız onlar yeniden denenebilir', () => {
  const registry = createJobRegistry();
  const job = registry.create('u1', { kind: 'plm-sync', scope: 'koleksiyon', total: 3 });
  registry.update('u1', job.id, { processed: 3, succeeded: 1 });
  registry.addFailure('u1', job.id, { plmId: '2100968', model: 'PSG-5-YD', error: 'PLM yanıt vermedi', code: 'TIMEOUT' });
  registry.addFailure('u1', job.id, { plmId: '2119399', model: 'PSG-6-YD', error: 'Style ID yok', code: 'STYLE_ID' });

  const view = registry.describe('u1', job.id);
  assert.equal(view.failed, 2);
  assert.equal(view.failureCount, 2);

  const failures = registry.failures('u1', job.id);
  assert.equal(failures[0].model, 'PSG-5-YD');
  assert.equal(failures[0].code, 'TIMEOUT');
  // "Yalnız başarısızları yeniden dene" için gereken kimlikler.
  assert.deepEqual(registry.failedIds('u1', job.id), ['2100968', '2119399']);
});

test('iptal ANINDA sonlandırmaz; iş kendi güvenli noktasında durur', () => {
  const registry = createJobRegistry();
  const job = registry.create('u1', { kind: 'plm-sync', scope: 'koleksiyon', total: 10 });
  registry.requestCancel('u1', job.id);

  assert.equal(registry.isCancelled('u1', job.id), true);
  // Hâlâ çalışıyor sayılır — yarım yazma bırakmamak için.
  assert.equal(registry.describe('u1', job.id).running, true);
  assert.equal(registry.describe('u1', job.id).cancelRequested, true);

  registry.finish('u1', job.id, {});
  assert.equal(registry.describe('u1', job.id).status, 'cancelled');
});

test('biten iş geçmişte kalır, durumu ve süresi donar', () => {
  const clock = fixedClock();
  const registry = createJobRegistry({ now: clock.now });
  const job = registry.create('u1', { kind: 'plm-sync', scope: 'koleksiyon', total: 10 });
  clock.advance(30_000);
  registry.update('u1', job.id, { processed: 10, succeeded: 10 });
  registry.finish('u1', job.id, { status: 'succeeded' });

  clock.advance(120_000);                       // aradan zaman geçti
  const view = registry.describe('u1', job.id);
  assert.equal(view.status, 'succeeded');
  assert.equal(view.running, false);
  assert.equal(view.elapsedMs, 30_000, 'bitmiş işin süresi artmamalı');
  assert.equal(view.etaMs, null);
});

test('geçmiş sınırsız büyümez ama ÇALIŞAN iş asla budanmaz', () => {
  const registry = createJobRegistry({ historyLimit: 3 });
  const running = registry.create('u1', { kind: 'plm-sync', scope: 'koleksiyon', total: 1 });
  for (let i = 0; i < 6; i += 1) {
    const job = registry.create('u1', { kind: 'plm-images', scope: 'cp', total: 1 });
    registry.finish('u1', job.id, { status: 'succeeded' });
  }
  const all = registry.list('u1');
  assert.equal(all.filter(job => !job.running).length, 3, 'yalnız son 3 biten iş kalmalı');
  assert.ok(all.some(job => job.id === running.id), 'çalışan iş budanmamalı');
});

test('çalışan/biten süzgeci', () => {
  const registry = createJobRegistry();
  const a = registry.create('u1', { kind: 'plm-sync', scope: 'koleksiyon', total: 1 });
  const b = registry.create('u1', { kind: 'plm-sync', scope: 'koleksiyon', total: 1 });
  registry.finish('u1', b.id, { status: 'succeeded' });
  assert.deepEqual(registry.list('u1', { running: true }).map(j => j.id), [a.id]);
  assert.deepEqual(registry.list('u1', { running: false }).map(j => j.id), [b.id]);
});

test('bilinmeyen iş kimliği çökertmez', () => {
  const registry = createJobRegistry();
  assert.equal(registry.describe('u1', 'yok'), null);
  assert.equal(registry.update('u1', 'yok', { processed: 1 }), null);
  assert.equal(registry.addFailure('u1', 'yok', {}), null);
  assert.equal(registry.finish('u1', 'yok', {}), null);
  assert.equal(registry.requestCancel('u1', 'yok'), null);
  assert.deepEqual(registry.failures('u1', 'yok'), []);
});

/* ---- sunucu tarafı bağlantısı (kaynak sözleşmesi) ---- */
const fs = require('node:fs');
const SERVER = require('./helpers/server-source')();

test('iş uçları tanımlı ve kapsam süzgeci uyguluyor', () => {
  for (const route of ['/api/plm-jobs', '/api/plm-jobs/:id', '/api/plm-jobs/:id/cancel',
    '/api/plm-jobs/:id/failed-ids', '/api/plm-jobs/clear-finished']) {
    assert.ok(SERVER.includes(`'${route}'`), `${route} tanımlı olmalı`);
  }
  // Liste ucu kapsam süzgecini uygulamalı; yoksa sayfalar arası karışma sürer.
  const start = SERVER.indexOf("app.get('/api/plm-jobs'");
  const block = SERVER.slice(start, start + 700);
  assert.match(block, /PLM_JOB_SCOPES\.includes/);
  assert.match(block, /plmJobs\.list\(req\.currentUser\.id, filter\)/);
});

test('kapsam istemciden gelir ve bilinmeyen değer sızmaz', () => {
  const start = SERVER.indexOf('function plmJobScope(req)');
  const block = SERVER.slice(start, start + 400);
  assert.match(block, /PLM_JOB_SCOPES\.includes\(raw\) \? raw : 'genel'/);
});

test('PLM işlemleri iş kaydına bağlı ve kapsamları doğru', () => {
  // Koleksiyon'a özgü işler CP/Orders kapsamına yazılmamalı.
  assert.match(SERVER, /kind: 'plm-sync', scope, total/);
  assert.match(SERVER, /\['koleksiyon','cp','orders'\]\.includes\(requestedScope\)\?requestedScope:'koleksiyon'/);
  assert.match(SERVER, /kind: 'plm-files', scope: 'koleksiyon'/);
  // Link ve görsel her üç ekrandan da çalıştığı için kapsam istemciden gelir.
  assert.match(SERVER, /kind:'plm-links', scope:plmJobScope\(req\)/);
  assert.match(SERVER, /kind: 'plm-images', scope: plmJobScope\(req\)/);
});

test('başarısız modeller işe yazılıyor (yalnız onları yeniden denemek için)', () => {
  assert.match(SERVER, /plmJobs\.addFailure\(profile\.id, fetchRun\.job\.id/);
  assert.match(SERVER, /plmJobs\.addFailure\(req\.currentUser\.id,linkRun\.job\.id/);
  assert.match(SERVER, /plmJobs\.addFailure\(req\.currentUser\.id, sheetRun\.job\.id/);
});

test('istemci işi izleyebilsin diye yanıtlar jobId taşıyor', () => {
  assert.match(SERVER, /styleLinks, jobId: fetchRun\.job\.id/);
  assert.match(SERVER, /jobId:linkRun\.job\.id/);
  assert.match(SERVER, /jobId: sheetRun\.job\.id/);
});

test('eski tek-slot ucu KORUNDU (mevcut istemci kodu bozulmasın)', () => {
  assert.ok(SERVER.includes("app.get('/api/model-operation-status'"));
  // Görsel rotalarında ilerleme hem eskiye hem işe yazılıyor.
  const start = SERVER.indexOf('function reportImageProgress');
  const block = SERVER.slice(start, start + 500);
  assert.match(block, /setModelOperationProgress/);
  assert.match(block, /plmJobs\.update/);
});

test('görsel işleri hata durumunda da kapanıyor', () => {
  const start = SERVER.indexOf('function finishImageJob');
  const block = SERVER.slice(start, start + 400);
  assert.match(block, /status: 'failed'/);
  assert.match(block, /status: 'succeeded'/);
  // Her iki görsel rotasında da hem başarı hem hata yolunda çağrılmalı.
  assert.ok((SERVER.match(/finishImageJob\(req, imageJobRef/g) || []).length >= 4);
});
