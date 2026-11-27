'use strict';
/*
 * Fiyat Masası'nda tablodan manuel üretici eklendiğinde matris yenilenmiyordu;
 * üretici ancak başka ekrana gidip dönünce görünüyordu.
 *
 * Kök neden: qHydrateShared(true) (canlı senkron refresh'i, kullanıcının kendi
 * kaydından doğan 'quotation' revizyonu dahil) qState'i YENİ talep nesneleriyle
 * değiştiriyordu. Görünen içerik imzası aynıysa masa yeniden çizilmiyor, matris
 * dinleyicileri artık depoda olmayan eski `req` nesnesini tutuyordu. Üretici o
 * eski nesneye ekleniyor (ve sunucuya gidiyor), qRenderDetail ise depodaki yeni
 * nesneyi çizdiği için tablo değişmemiş görünüyordu.
 *
 * Çözüm: qReplaceRequest ile aynı ilke — hydrate de mevcut talep nesnesini
 * yerinde günceller, kimlik korunur (bkz. quotations-drop-identity-v424).
 */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/quotations.js'), 'utf8');

function slice(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start > 0 && end > start, `kaynak bloğu bulunamadı: ${startMarker}`);
  return source.slice(start, end);
}

function fixture(serverRequests, { pending = [] } = {}) {
  const local = [{ id: 'q1', ownerId: 'u1', updatedAt: '1', manufacturers: [{ name: 'A' }], items: [{ id: 'l1', modelKey: 'm1', manufacturer: 'A', price: '' }], stale: true }];
  const ctx = {
    qState: { version: 2, requests: local }, qHydrated: true, qProfiles: [],
    MIGRATION_KEY: 'mig', BLStorage: { getItem: () => '1', setItem() {} },
    qApi: async () => ({ profiles: [], requests: JSON.parse(JSON.stringify(serverRequests)) }),
    qNormalizeRequest: req => JSON.parse(JSON.stringify(req)),
    qTrackOwners: req => req, qReapplyPendingLines: req => req,
    qPersistLocal() {}, qProjectForeignLineEdits() {}, qNotifyCollectionQuotes() {},
    qLang: tr => tr, showToast() {},
  };
  ctx.qLoad = () => ctx.qState;
  vm.createContext(ctx);
  vm.runInContext(`var qState=this.qState,qHydrated=this.qHydrated,qProfiles=this.qProfiles;
    function qLoad(){return qState;}
    const qServerState=new Map(),qExpectedState=new Map();this.serverState=qServerState;
    const qClonePlain=value=>JSON.parse(JSON.stringify(value));
    ${slice('  function qRememberServerState(', '\n')}
    ${slice('  const qStructuralSaves=', '\n  function qPlanSave(')}
    ${JSON.stringify(pending)}.forEach(id=>qStructuralSave(id,1));
    ${slice('  function qMergeRequestInPlace(', '\n  function qReplaceRequest(')}
    ${slice('  async function qHydrateShared(', '\n  /* Koleksiyon')}
    this.hydrate=qHydrateShared;this.state=()=>qState;`, ctx);
  return ctx;
}
const server = [{ id: 'q1', ownerId: 'u1', updatedAt: '1', manufacturers: [{ name: 'A' }], items: [{ id: 'l1', modelKey: 'm1', manufacturer: 'A', price: '' }] }];

test('hydrate ekrandaki talep nesnesinin kimliğini korur', async () => {
  const f = fixture(server);
  const rendered = f.state().requests[0];
  await f.hydrate(true);
  assert.equal(f.state().requests[0], rendered, 'matris dinleyicilerinin kapattığı nesne depoda kalmalı');
  assert.equal('stale' in rendered, false, 'sunucuda olmayan alan temizlenir');
});

test('hydrate sonrası tablodan eklenen üretici depodaki aktif talepte görünür', async () => {
  const f = fixture(server);
  const rendered = f.state().requests[0];
  await f.hydrate(true);
  rendered.manufacturers.push({ name: 'Yeni Üretici' });
  rendered.items.push({ id: 'l2', modelKey: 'm1', manufacturer: 'Yeni Üretici', price: '' });
  const active = f.state().requests.find(req => req.id === 'q1');
  assert.deepEqual(active.manufacturers.map(m => m.name), ['A', 'Yeni Üretici']);
  assert.equal(active.items.length, 2);
});

test('sunucudan gelen yeni talep eklenir, sunucuda olmayan talep düşer', async () => {
  const f = fixture([...server, { id: 'q2', ownerId: 'u1', items: [] }]);
  await f.hydrate(true);
  assert.deepEqual(f.state().requests.map(req => req.id), ['q1', 'q2']);
  const g = fixture([]);
  await g.hydrate(true);
  assert.deepEqual(g.state().requests, []);
});

test('kuyrukta gönderilmemiş yapı kaydı olan talep hydrate ile ezilmez (Codex P1)', async () => {
  // Kullanıcı B üreticisini ekledi; PUT kuyrukta bekliyor, gövde görev çalışınca req'ten kurulur.
  const f = fixture(server, { pending: ['q1'] });
  const rendered = f.state().requests[0];
  rendered.manufacturers.push({ name: 'B' });
  rendered.items.push({ id: 'l2', modelKey: 'm1', manufacturer: 'B', price: '' });
  await f.hydrate(true);
  assert.equal(f.state().requests[0], rendered, 'bekleyen kayıt depoda kalır');
  assert.deepEqual(rendered.manufacturers.map(m => m.name), ['A', 'B'], 'kuyruktaki PUT B ile gönderilir');
  assert.equal(rendered.items.length, 2);
  assert.deepEqual([...f.serverState.get('q1').manufacturers.map(m => m.name)], ['A'], 'sunucu hâli (revler) yine sunucudan hatırlanır');
});

test('yapı kaydı sayacı sunucu yanıtından sonra, hydrate/birleştirmeden önce düşer', () => {
  const body = slice('  function qSave(requests=null){', '\n  // Quotation içeriği');
  const put = body.slice(body.indexOf('qQueue(async()=>{'));
  const done = put.indexOf('qStructuralSave(req.id,-1)');
  assert.ok(body.indexOf('qStructuralSave(req.id,1)') > 0 && body.indexOf('qStructuralSave(req.id,1)') < body.indexOf('qQueue(async()=>{'), 'kayıt kuyruğa girerken işaretlenir');
  assert.ok(done > 0 && done < put.indexOf('qReplaceRequest(') && done < put.indexOf('qHydrateShared(true)'), '403 yolu yetkisiz yerel hâli korumaz');
});

// Uçtan uca (gerçek qSave/qQueue/qPlanSave/qHydrateShared/qReplaceRequest): Codex'in
// bildirdiği sıra. Kuyruk önceki bir işle bloke → B eklenir ve kaydedilir → canlı
// refresh hydrate eder → kuyruk serbest kalır → PUT gövdesinde B bulunmalı.
function saveFlow(src, { gatePuts = false } = {}) {
  const cut = (a, b) => { const s = src.indexOf(a), e = src.indexOf(b, s); assert.ok(s > 0 && e > s, a); return src.slice(s, e); };
  const block = src.includes('  function qMergeRequestInPlace(')
    ? cut('  function qMergeRequestInPlace(', '\n  // Quotation içeriği')
    : cut('  function qReplaceRequest(request){', '\n  // Quotation içeriği');
  const serverReq = { id: 'q1', ownerId: 'u1', updatedAt: '1', manufacturers: [{ name: 'A' }], items: [{ id: 'l1', modelKey: 'm1', manufacturer: 'A', price: '', rev: 1 }] };
  const puts = [];
  let release;
  const ctx = {
    serverJson: JSON.stringify([serverReq]), puts, putGates: [], gate: new Promise(resolve => { release = resolve; }),
    qApi: async (url, options = {}) => {
      if (options.method === 'PUT') { const body = JSON.parse(options.body); puts.push(body); if (gatePuts) await new Promise(resolve => ctx.putGates.push(resolve)); return { request: body }; }
      return { profiles: [], requests: JSON.parse(ctx.serverJson) };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(`const MIGRATION_KEY='mig';let qProfiles=[],qHydrated=true,qSaveQueue=Promise.resolve(),qSaveFailureSerial=0,qSaveFailureError=null;
    const BLStorage={getItem:()=>'1',setItem(){}},qApi=this.qApi,qItemOwners=new WeakMap();
    const qNorm=v=>v==null?'':String(v).trim(),qMoneyNumber=v=>{const n=Number(String(v).replace(',','.'));return String(v).trim()&&Number.isFinite(n)?n:NaN;};
    const qLang=t=>t,showToast=()=>{},qPersistLocal=()=>true,qProjectForeignLineEdits=()=>{},qOpenWorkspaceSignature=()=>'',qRefreshOpenWorkspace=()=>{};
    const qNormalizeRequest=r=>JSON.parse(JSON.stringify(r)),qTrackOwners=r=>r;
    let qState={version:2,requests:JSON.parse(this.serverJson)};function qLoad(){return qState;}
    ${block}
    qState.requests.forEach(qRememberServerState);
    this.state=()=>qState;this.save=qSave;this.hydrate=qHydrateShared;this.queue=qQueue;this.flush=()=>qSaveQueue;`, ctx);
  return { ctx, puts, release };
}

async function codexScenario(src) {
  const { ctx, puts, release } = saveFlow(src);
  const req = ctx.state().requests[0];           // matrisin kapattığı nesne
  ctx.queue(() => ctx.gate);                     // önceki kayıt hâlâ sürüyor
  req.manufacturers.push({ name: 'B' });
  req.items.push({ id: 'l2', modelKey: 'm1', manufacturer: 'B', price: '' });
  ctx.save(req);                                 // yapı kaydı kuyrukta
  await ctx.hydrate(true);                       // canlı senkron refresh'i
  release();
  await ctx.flush();
  return { puts, active: ctx.state().requests.find(item => item.id === 'q1') };
}

test('Codex P1: kuyruktaki yapı kaydı hydrate sonrasında da B ile gönderilir ve tabloda kalır', async () => {
  const { puts, active } = await codexScenario(source);
  assert.equal(puts.length, 1);
  assert.deepEqual(puts[0].manufacturers.map(m => m.name), ['A', 'B']);
  assert.deepEqual(puts[0].items.map(item => item.id), ['l1', 'l2']);
  assert.deepEqual([...active.manufacturers.map(m => m.name)], ['A', 'B'], 'ekrandaki talep B ile kalır');
});

test('önceki PUT yanıt beklerken eklenen üretici, o yanıtın birleşmesiyle kaybolmaz', async () => {
  // Main'de de vardı: PUT1 yanıtı (B yok) kuyruktaki PUT2'nin req nesnesine birleşip B'yi siliyordu.
  const { ctx, puts } = saveFlow(source, { gatePuts: true });
  const tick = () => new Promise(resolve => setTimeout(resolve, 5));
  const req = ctx.state().requests[0];
  req.note = 'X'; ctx.save(req); await tick();             // PUT1 uçuşta
  req.manufacturers.push({ name: 'B' });
  req.items.push({ id: 'l2', modelKey: 'm1', manufacturer: 'B', price: '' });
  ctx.save(req);                                           // PUT2 kuyrukta
  ctx.putGates.shift()(); await tick();                    // PUT1 yanıtı gelir
  while (ctx.putGates.length) { ctx.putGates.shift()(); await tick(); }
  await ctx.flush();
  assert.equal(puts.length, 2);
  assert.deepEqual(puts[1].manufacturers.map(m => m.name), ['A', 'B'], 'PUT2 B ile gider');
  assert.equal(puts[1].note, 'X');
  assert.deepEqual([...ctx.state().requests[0].manufacturers.map(m => m.name)], ['A', 'B']);
});
