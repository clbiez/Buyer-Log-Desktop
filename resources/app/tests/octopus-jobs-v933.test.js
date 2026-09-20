'use strict';

/* v9.33 — İKİNCİ SORU ARTIK DÜŞMÜYOR
 *
 * `ask()` tek uçuşluydu: `if(busy)return;`. Bir cevap beklenirken sorulan
 * ikinci soru SESSİZCE kayboluyordu — kullanıcı yazıyor, gönderiyor, hiçbir
 * şey olmuyor ve neden olmadığını da öğrenemiyor. Eksik bir özellik değil,
 * bir kusurdu.
 *
 * Kuyruk PARALELLİK için değil KAYBETMEMEK için var. Eşzamanlılık 1: model bu
 * makinede yerel çalışıyor ve tek GPU'yu paylaşıyor; iki isteği aynı anda
 * koşturmak ikisini birden yavaşlatır, büyük modelde yükleme hatası verir
 * (v9.27). Sıradaki soru bekletilir, düşürülmez.
 *
 * En kritik davranış: İŞ KONUŞMASINI TAŞIR. Cevap, sorunun sorulduğu
 * konuşmaya yazılır — kullanıcı beklerken başka bir konuşmaya geçse bile.
 * Aktif konuşmaya yazmak, cevabı yanlış yere koymak olurdu.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createJobQueue, STATUS } = require('../public/octopus-jobs.js');

const tick = () => new Promise(resolve => setImmediate(resolve));
/* Elle çözülen söz: işin TAM OLARAK ne zaman bittiğini testin belirlemesi,
   zamanlayıcıya güvenmekten çok daha az kırılgan. */
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/* ============================================== 1) SORU DÜŞMÜYOR */

test('v9.33 meşgulken sorulan soru KUYRUĞA girer, düşmez', async () => {
  const gates = [deferred(), deferred()];
  let started = 0;
  const queue = createJobQueue({ run: () => gates[started++].promise });

  const first = queue.enqueue({ question: 'ilk' });
  const second = queue.enqueue({ question: 'ikinci' });
  await tick();

  assert.equal(queue.get(first.id).status, STATUS.RUNNING);
  assert.equal(queue.get(second.id).status, STATUS.QUEUED, 'ikinci soru düşmemeli');
  assert.deepEqual(queue.stats(), { running: 1, queued: 1, active: 2, total: 2 });

  gates[0].resolve('a'); await tick(); await tick();
  assert.equal(queue.get(second.id).status, STATUS.RUNNING, 'sıradaki başlamalı');
  gates[1].resolve('b'); await queue.idle();
  assert.equal(queue.get(first.id).status, STATUS.DONE);
  assert.equal(queue.get(second.id).status, STATUS.DONE);
});

test('v9.33 eşzamanlılık 1: iki iş ASLA aynı anda koşmaz', async () => {
  /* Yerel model tek GPU paylaşıyor; ikisini birden koşturmak ikisini de
     yavaşlatır ve büyük modelde yükleme hatası verir. */
  let concurrent = 0, peak = 0;
  const gates = [];
  const queue = createJobQueue({
    run: () => { concurrent += 1; peak = Math.max(peak, concurrent);
      const gate = deferred(); gates.push(gate);
      return gate.promise.finally(() => { concurrent -= 1; }); },
  });
  for (let i = 0; i < 5; i += 1) queue.enqueue({ question: 'q' + i });
  for (let i = 0; i < 5; i += 1) { await tick(); gates[gates.length - 1].resolve('ok'); await tick(); await tick(); }
  await queue.idle();
  assert.equal(peak, 1, 'aynı anda en fazla bir iş koşmalı');
  assert.equal(queue.stats().total, 5);
});

/* ==================================== 2) İŞ KONUŞMASINI TAŞIR */

test('v9.33 iş, sorulduğu konuşmayı taşır', async () => {
  /* Kullanıcı beklerken başka konuşmaya geçebilir; cevabın aktif konuşmaya
     yazılması, onu yanlış yere koymak olurdu. */
  const seen = [];
  const queue = createJobQueue({ run: async job => { seen.push(job.conversationId); return job.question; } });
  queue.enqueue({ question: 'a', conversationId: 'conv-1' });
  queue.enqueue({ question: 'b', conversationId: 'conv-2' });
  await queue.idle();
  assert.deepEqual(seen, ['conv-1', 'conv-2']);
  assert.equal(queue.list().find(job => job.question === 'a').conversationId, 'conv-1');
});

/* ========================================= 3) HATA KUYRUĞU DURDURMAZ */

test('v9.33 başarısız iş kuyruğu kilitlemez, sebebi saklanır', async () => {
  const queue = createJobQueue({
    run: async job => { if (job.question === 'patla') throw new Error('model yüklenemedi'); return 'ok'; },
  });
  const bad = queue.enqueue({ question: 'patla' });
  const good = queue.enqueue({ question: 'devam' });
  await queue.idle();
  assert.equal(queue.get(bad.id).status, STATUS.FAILED);
  assert.equal(queue.get(bad.id).error, 'model yüklenemedi', 'sebep ekranda kalabilmeli');
  assert.equal(queue.get(good.id).status, STATUS.DONE, 'sonraki iş yine de koşmalı');
});

test('v9.33 dinleyicinin hatası kuyruğu durdurmaz', async () => {
  /* Çizim başarısız olduğu için bir işin çalışmaması, hatayı kullanıcının
     işine yıkmak olurdu. */
  const queue = createJobQueue({ run: async () => 'ok', onChange() { throw new Error('çizim hatası'); } });
  const job = queue.enqueue({ question: 'a' });
  await queue.idle();
  assert.equal(queue.get(job.id).status, STATUS.DONE);
});

/* ================================================== 4) İPTAL */

test('v9.33 bekleyen iş iptal edilince HİÇ koşmaz', async () => {
  const ran = [];
  const gate = deferred();
  const queue = createJobQueue({ run: async job => { ran.push(job.question); return gate.promise; } });
  queue.enqueue({ question: 'ilk' });
  const waiting = queue.enqueue({ question: 'bekleyen' });
  await tick();
  assert.equal(queue.cancel(waiting.id), true);
  gate.resolve('ok');
  await queue.idle();
  assert.deepEqual(ran, ['ilk'], 'iptal edilen iş çalışmamalı');
  assert.equal(queue.get(waiting.id).status, STATUS.CANCELLED);
});

test('v9.33 koşan iş iptal edilince sonucu YOK SAYILIR', async () => {
  /* Kullanıcının "vazgeç" dediği bir cevabı ekrana koymak, iptali anlamsız
     kılardı. */
  const gate = deferred();
  const queue = createJobQueue({ run: () => gate.promise });
  const job = queue.enqueue({ question: 'uzun' });
  await tick();
  queue.cancel(job.id);
  gate.resolve('geç gelen cevap');
  await tick(); await tick();
  assert.equal(queue.get(job.id).status, STATUS.CANCELLED);
  assert.equal(queue.resultOf(job.id), undefined, 'iptal edilen işin sonucu yazılmamalı');
});

test('v9.33 iptal isteğe de ulaşır', async () => {
  /* Sunucu tarafında iş sürüyorsa bırakılmalı; yalnız sonucu yok saymak
     modeli boşuna çalıştırmaya devam ederdi. */
  let aborted = false;
  const gate = deferred();
  const queue = createJobQueue({
    run: (job, ctx) => { ctx.signal.addEventListener('abort', () => { aborted = true; }); return gate.promise; },
  });
  const job = queue.enqueue({ question: 'uzun' });
  await tick();
  queue.cancel(job.id);
  assert.equal(aborted, true, 'AbortController tetiklenmeli');
  gate.resolve(''); await tick();
});

test('v9.33 biten iş iptal edilemez', async () => {
  const queue = createJobQueue({ run: async () => 'ok' });
  const job = queue.enqueue({ question: 'a' });
  await queue.idle();
  assert.equal(queue.cancel(job.id), false);
  assert.equal(queue.get(job.id).status, STATUS.DONE);
  assert.equal(queue.cancel('olmayan'), false);
});

/* ============================================= 5) SAYAÇ VE SINIRLAR */

test('v9.33 sayaç GERÇEK durumu söyler', async () => {
  const gate = deferred();
  const changes = [];
  const queue = createJobQueue({ run: () => gate.promise, onChange: s => changes.push(s.active) });
  assert.deepEqual(queue.stats(), { running: 0, queued: 0, active: 0, total: 0 });
  queue.enqueue({ question: 'a' });
  queue.enqueue({ question: 'b' });
  await tick();
  assert.equal(queue.stats().active, 2, 'koşan + bekleyen');
  gate.resolve('ok');
  await queue.idle();
  assert.equal(queue.stats().active, 0);
  assert.ok(changes.length >= 3, 'her durum değişimi bildirilmeli');
});

test('v9.33 geçmiş kapaklı ama ÇALIŞAN iş asla kırpılmaz', async () => {
  /* Kapağa çarptı diye bir işi listeden düşürmek onu görünmez yapardı. */
  const queue = createJobQueue({ run: async () => 'ok', maxHistory: 3 });
  for (let i = 0; i < 8; i += 1) queue.enqueue({ question: 'q' + i });
  await queue.idle();
  assert.equal(queue.list().length, 3, 'biten işler kırpılmalı');

  const gate = deferred();
  const busy = createJobQueue({ run: () => gate.promise, maxHistory: 1 });
  const running = busy.enqueue({ question: 'koşan' });
  const queued = busy.enqueue({ question: 'bekleyen' });
  await tick();
  assert.ok(busy.get(running.id), 'koşan iş listede kalmalı');
  assert.ok(busy.get(queued.id), 'bekleyen iş listede kalmalı');
  gate.resolve('ok'); await busy.idle();
});

test('v9.33 çalıştırıcı olmadan iş eklenemez', () => {
  /* Sessizce hiçbir şey yapmayan bir kuyruk, soruyu düşüren eski davranışın
     ta kendisi olurdu. */
  const queue = createJobQueue({});
  assert.throws(() => queue.enqueue({ question: 'a' }), /çalıştırıcı/);
});

/* ============================================ 6) İSTEMCİ BAĞLANTISI */

const CLIENT = fs.readFileSync(path.join(__dirname, '..', 'public', 'copilot.js'), 'utf8');
const LOADER = fs.readFileSync(path.join(__dirname, '..', 'public', 'perf-runtime.js'), 'utf8');

test('v9.33 sessizce düşüren kilit KALDIRILDI', () => {
  // NOT: dilim sınırı 'runAsk(job,ctx){' — bir önceki `ctx` parametresi
  // eklendiğinde bu arama dizesi güncellenmemiş, indexOf hep -1 dönüp
  // slice(start,-1) neredeyse dosyanın TAMAMINI alıyordu. Testin ötekİ
  // iddiaları (tek guard, kilidin yalnız yedek dalda kalması) bu yüzden
  // şans eseri geçiyordu; görsel ek alanı eklenince (queue.enqueue
  // gövdesi değişince) bu kısayol bozuldu — gerçek regresyon değil.
  const ask = CLIENT.slice(CLIENT.indexOf('async function ask(question){'), CLIENT.indexOf('async function runAsk(job,ctx){'));
  assert.match(ask, /queue\.enqueue\(\{question:text,conversationId,attachments\}\)/, 'soru kuyruğa girmeli');
  /* Tek uçuş kilidi YALNIZ yedek dalda kalır: kuyruk modülü yüklenmediyse
     panel eski davranışına düşer ve orada düşürmek, iki isteği aynı anda
     modele göndermekten iyidir. Kilidin ANA yolda kalması kusurun geri
     gelmesi demek olurdu. */
  const guards = ask.match(/if\(busy\)return;/g) || [];
  assert.equal(guards.length, 1, 'kilit yalnız bir yerde kalmalı');
  assert.match(ask, /if\(!queue\)\{ if\(busy\)return;/, 'kilit yalnız kuyruk yokken geçerli');
});

test('v9.33 rozet kuyruğun GERÇEK sayısını gösterir', () => {
  const jobsFn = CLIENT.slice(CLIENT.indexOf('function renderJobs('), CLIENT.indexOf('function paint('));
  assert.match(jobsFn, /stats\(\)/);
  assert.equal(/1 iş çalışıyor/.test(jobsFn), false, 'sabit sayaç kalmamalı');
});

test('v9.33 modül yükleme listesinde ve copilot.js’ten ÖNCE', () => {
  const line = LOADER.split(/\r?\n/).find(text => text.includes('copilot:['));
  assert.match(line, /'octopus-jobs\.js'/);
  assert.ok(line.indexOf('octopus-jobs.js') < line.indexOf("'copilot.js'"));
});

/* ================================ 7) CANLI: KUYRUK GERÇEKTEN BAĞLI MI

   Yukarıdaki testler kuyruğun KENDİSİNİ doğruluyor; mevcut copilot testleri
   ise sanal DOM'larında BLOctopusJobs olmadığı için YEDEK dala düşüyor. Yani
   asıl düzeltilen yol — ask() -> kuyruk -> runAsk — hiçbir yerde canlı
   koşmuyordu. Burası onu koşturuyor. */

function driveWithQueue({ answers = {} } = {}) {
  const istekler = [];
  const iptaller = [];
  const painted = [];
  const body = { get innerHTML() { return this._v || ''; }, set innerHTML(v) { this._v = v; painted.push(v); } };
  const shell = { style: {}, dataset: {}, offsetWidth: 880, offsetHeight: 620, addEventListener() {} };
  const el = {
    className: '', dataset: {}, hidden: true, innerHTML: '',
    querySelector: sel => {
      if (sel.includes('bCpWindow')) return shell;
      if (sel.includes('bCpLive') || sel.includes('bCpBody')) return body;
      if (sel.includes('input')) return { value: '', focus() {} };
      if (sel.includes('bCpState')) return { textContent: '', className: '' };
      /* İş listesi GERÇEK markup gibi kapalı başlar; açık başlarsa test,
         uygulamada olmayan bir durumu doğrular. */
      if (sel.includes('bCpJobs')) return badge;
      if (sel.includes('bCpJobList') || sel.includes('bcp-job-list')) return jobList;
      return { addEventListener() {}, hidden: false, textContent: '', innerHTML: '' };
    },
    addEventListener() {}, appendChild() {},
  };
  const badge = { hidden: true, textContent: '', setAttribute() {}, getAttribute: () => null };
  const jobList = { hidden: true, innerHTML: '' };

  const store = {};
  const sandbox = {
    appLang: 'tr',
    escapeHtml: v => String(v == null ? '' : v),
    state: { modelScopes: [{ seasons: ['S7'] }], storeRevisions: {}, currentUser: { id: 'u1' } },
    sourceStatus: {},
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    },
    BLOctopusJobs: require('../public/octopus-jobs.js'),
    BLOctopusConversations: require('../public/octopus-conversations.js'),
    BLOctopusWindow: require('../public/octopus-window.js'),
    BLCopilotTools: { }, BLCopilotGrounding: { validate: () => ({ ok: true }) },
    document: { createElement: () => el, body: { appendChild() {} }, addEventListener() {} },
    fetch: async (url, init) => {
      if (String(url).includes('status')) return { ok: true, json: async () => ({ status: 'AI_READY', ok: true, models: ['m'], model: 'm' }) };
      if (String(url).includes('/api/copilot/ask')) {
        const question = JSON.parse(init.body).question;
        istekler.push({ question, signalVar: !!(init && init.signal) });
        const gate = answers[question];
        if (gate) {
          /* Gerçek fetch iptalde REDDEDER. Taklidin de reddetmesi gerekiyor,
             yoksa iptal testi hiçbir şey kanıtlamaz. */
          await new Promise((resolve, reject) => {
            gate.promise.then(resolve, reject);
            const signal = init && init.signal;
            if (signal) signal.addEventListener('abort', () => {
              iptaller.push(question);
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            });
          });
        }
        return { ok: true, json: async () => ({ ok: true, answer: 'cevap: ' + question, evidence: [], toolCalls: [] }) };
      }
      return { ok: true, json: async () => ({}) };
    },
  };
  sandbox.window = sandbox;
  const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'public', 'copilot.js'), 'utf8');
  new Function('window', 'document', 'fetch', 'appLang', 'escapeHtml',
    `${source}\nreturn window.BLCopilot;`)(sandbox, sandbox.document, sandbox.fetch, sandbox.appLang, sandbox.escapeHtml);
  return { copilot: sandbox.BLCopilot, painted, badge, sandbox, istekler, iptaller };
}

test('v9.33 CANLI: ikinci soru düşmüyor, ikisi de cevaplanıyor', async () => {
  const first = deferred();
  const { copilot, sandbox } = driveWithQueue({ answers: { ilk: first } });
  copilot.open();
  /* open() durum sorgusunu ASENKRON yapıyor; beklemeden sormak aiState hazır
     olmadan deterministic yola düşmek demek. Testin taklit ettiği şey gerçek
     akış olmalı. */
  await new Promise(resolve => setTimeout(resolve, 10));

  void copilot.ask('ilk');
  await tick();
  void copilot.ask('ikinci');
  await tick();

  /* ESKİ DAVRANIŞ: ikinci soru sessizce düşerdi ve konuşmaya bile girmezdi. */
  const store = sandbox.BLOctopusConversations.createConversationStore({ storage: sandbox.localStorage, userId: 'u1' });
  const conv = store.list()[0];
  const texts = store.get(conv.id).messages.map(m => m.content);
  assert.ok(texts.includes('ilk'), 'ilk soru kayıtta');
  assert.ok(texts.includes('ikinci'), 'ikinci soru DÜŞMEMELİ');

  first.resolve();
  await new Promise(resolve => setTimeout(resolve, 80));
  /* Depo örneği kurulduğu andaki durumu tutuyor; sonradan yazılanları
     görmek için TAZE bir örnek gerekiyor. Aynı örnekten okumak, testin
     kendi anlık görüntüsünü doğrulaması olurdu. */
  const after = sandbox.BLOctopusConversations
    .createConversationStore({ storage: sandbox.localStorage, userId: 'u1' })
    .get(conv.id).messages.map(m => m.content);
  assert.ok(after.includes('cevap: ikinci'), 'ikinci cevap da yazılmalı');
});

test('v9.33 CANLI: cevap SORULDUĞU konuşmaya yazılır', async () => {
  /* Kullanıcı beklerken başka konuşmaya geçerse, cevap yine de sorunun
     sorulduğu yere gitmeli. Aktif konuşmaya yazmak veriyi karıştırırdı.
     Konuşmalar copilot'ın KENDİ API'sinden sürülür: dışarıdan kurulan ikinci
     bir depo örneği kendi anlık görüntüsünü tutuyor ve boş sanıp aynı
     konuşmayı geri veriyor. */
  const gate = deferred();
  const { copilot, sandbox } = driveWithQueue({ answers: { 'eski konuşmadaki soru': gate } });
  copilot.open();
  await new Promise(resolve => setTimeout(resolve, 10));

  void copilot.ask('eski konuşmadaki soru');
  await tick();
  const firstConv = copilot._test.activeConversationId();

  // Kullanıcı yeni bir konuşmaya geçiyor — cevap hâlâ yolda.
  const secondConv = copilot._test.newConversation();
  assert.notEqual(secondConv, firstConv, 'gerçekten yeni bir konuşma olmalı');

  gate.resolve();
  await new Promise(resolve => setTimeout(resolve, 80));

  const fresh = sandbox.BLOctopusConversations.createConversationStore({ storage: sandbox.localStorage, userId: 'u1' });
  const original = fresh.get(firstConv).messages.map(m => m.content);
  assert.ok(original.includes('cevap: eski konuşmadaki soru'), 'cevap kendi konuşmasına yazılmalı');
  assert.equal(fresh.get(secondConv).messages.length, 0, 'baktığı konuşmaya sızmamalı');
});

/* =================================== 8) İPTAL GERÇEKTEN BIRAKIYOR MU */

test('v9.33 iptal sinyali FETCH’e ulaşıyor', async () => {
  /* Kuyruk iptalde AbortController'ı tetikliyordu ve sonucu yok sayıyordu —
     ama istek ağda sürüyor, model sunucuda boşuna çalışmaya devam ediyordu.
     Kullanıcı "vazgeçtim" dediğinde iş GERÇEKTEN bırakılmalı. */
  const gate = deferred();
  const { copilot, sandbox, istekler, iptaller } = driveWithQueue({ answers: { 'uzun soru': gate } });
  copilot.open();
  await new Promise(resolve => setTimeout(resolve, 10));

  void copilot.ask('uzun soru');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(istekler.length, 1, 'istek gitmiş olmalı');
  assert.equal(istekler[0].signalVar, true, 'fetch bir iptal sinyali almalı');

  /* Iptal GERCEK yoldan: arayuzdeki dugme de kuyrugu kimlikle iptal ediyor. */
  const queue = copilot._test.jobs();
  const running = queue.list().find(job => job.status === 'running');
  assert.ok(running, 'kosan is bulunmali');
  assert.equal(queue.cancel(running.id), true);
  await new Promise(resolve => setTimeout(resolve, 30));

  assert.deepEqual(iptaller, ['uzun soru'], 'istek gerçekten bırakılmalı');
  const store = sandbox.BLOctopusConversations.createConversationStore({ storage: sandbox.localStorage, userId: 'u1' });
  const conv = store.list()[0];
  const texts = store.get(conv.id).messages.map(m => m.content);
  assert.ok(texts.includes('uzun soru'), 'soru kayıtta kalır');
  assert.equal(texts.some(text => text.startsWith('cevap:')), false, 'iptal edilen işin cevabı yazılmamalı');
  gate.resolve();
});

/* ============================================ 9) KUYRUK GÖRÜNÜR MÜ */

test('v9.33 kuyruk arayüzde GÖRÜNÜR ve iptal edilebilir', () => {
  /* İptal kuyrukta çalışıyordu ama kullanıcının ona ulaşacağı hiçbir yol
     yoktu: rozet kaç iş olduğunu söylüyor, hangileri olduğunu ve nasıl
     durdurulacağını söylemiyordu. Yarım bırakılmış bir yetenek. */
  /* Not: aşağıdaki desenlerde parantez ve boru işareti KAÇIRILMALI. İlk
     yazımda kaçmamışlardı ve `||` alternasyona dönüştüğü için iddia yanlış
     sebeple geçiyordu — metnin yarısını görmek yetiyordu. */
  assert.ok(CLIENT.includes('data-bcp-job-list'));
  assert.ok(CLIENT.includes('function renderJobList(queue,stats)'));
  // Yalnız AKTİF işlerde iptal düğmesi olur; biteni iptal etmek anlamsız.
  assert.ok(CLIENT.includes("const active=job.status==='queued'||job.status==='running';"));
  assert.ok(CLIENT.includes('<button type="button" class="bCpJobCancel" data-bcp-job-cancel='));
  // Tıklama gerçekten kuyruğa iletilmeli.
  assert.ok(CLIENT.includes('queue.cancel(jobCancel.dataset.bcpJobCancel)'));
  /* Rozet kaybolunca liste de kapanır: açık kalan boş bir kutu, işlerin hâlâ
     sürdüğü izlenimi verirdi. */
  assert.match(CLIENT, /if\(!stats\.active&&list\.hidden===false\)\{list\.hidden=true;/);
  // Hata sebebi listede görünmeli; yoksa başarısız iş sessizce kaybolur.
  assert.match(CLIENT, /job\.error\?` · \$\{esc\(job\.error\)\}`:''/);
});

test('v9.33 iptal sinyali deterministic yoldaki çağrılara da geçiyor', () => {
  /* İptal edilen bir işin arkasından model açıklaması istemek anlamsız. */
  const runAsk = CLIENT.slice(CLIENT.indexOf('async function runAsk(job,ctx)'), CLIENT.indexOf('function applyGeometry'));
  assert.match(runAsk, /const signal=ctx&&ctx\.signal;/);
  const explains = runAsk.match(/fetch\('\/api\/copilot\/explain',\{method:'POST',signal,/g) || [];
  assert.equal(explains.length, 2, 'her iki açıklama çağrısı da sinyal taşımalı');
  assert.match(CLIENT, /signal:ctx&&ctx\.signal,/, 'ana ajan çağrısı da sinyal taşımalı');
});
