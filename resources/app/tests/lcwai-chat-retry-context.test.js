'use strict';
/* Regresyon: bağlam/dosya hazırlığı yarıda kalan (ör. CSV yüklemesi
   başarısız) bir mesaj "Tekrar Dene" / "Yeniden üret" ile tekrarlandığında
   LCW AI'a bağlamsız ve eksiz gidiyordu; kullanıcı mesajında hâlâ
   "Orders — All records" çipi göründüğü hâlde model veriyi hiç almıyor ve
   "veri sağlanmadı" diye boş dosya üretiyordu. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'public', 'lcwai-chat.js'), 'utf8');

function load({ storage = new Map(), failUploads = 0 } = {}) {
  const calls = { chat: [], uploads: [], builds: [] };
  let failures = failUploads;
  const api = {
    registerContextProvider() {},
    getAvailableContext() { return []; },
    async buildContext(id) {
      calls.builds.push(id);
      return { id, screen: 'orders', label: 'Orders — all records', summary: '2 kayıt', columns: ['PO', 'Qty'], rows: [['PO1', 10], ['PO2', 20]], totalRows: 2 };
    },
    async uploadFile(file) {
      calls.uploads.push(file.name);
      if (failures > 0) { failures--; throw Object.assign(new Error('upload'), { code: 'LCWAI_UPLOAD_FAILED' }); }
      return { blobName: `blob/${file.name}`, contentType: file.type, fileName: file.name, size: file.size, url: '' };
    },
    async chat(options) {
      calls.chat.push(JSON.parse(JSON.stringify({ chatId: options.chatId, contexts: options.contexts, attachments: options.attachments })));
      return { chatId: 'remote-1', text: 'ok' };
    },
    errorText(error) { return String(error && error.code || 'error'); },
    needsLogin() { return false; },
  };
  const window = {
    appLang: 'tr',
    BuyerLogAI: api,
    BLStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); },
    },
    addEventListener() {},
  };
  window.window = window;
  vm.runInContext(SOURCE, vm.createContext({
    window, document: { documentElement: { lang: 'tr' }, getElementById() { return null; } },
    File, console, Date, JSON, Map, Set, setTimeout, clearTimeout, requestAnimationFrame: fn => setTimeout(fn, 0),
  }));
  return { chat: window.BLLcwAiChat, calls, storage };
}

const lastAnswer = chat => chat._state.conversations[0].messages.at(-1);

test('bağlam yüklemesi başarısız olduysa Tekrar Dene bağlamı ve CSV ekini yeniden hazırlar', async () => {
  const { chat, calls } = load({ failUploads: 1 });
  chat._state.contexts = [{ id: 'orders:all', label: 'Orders — All records (2)' }];
  await chat.send('MAG CU4E W6 Buying Group tablosu');
  assert.equal(calls.chat.length, 0, 'ilk deneme yükleme hatasında durur');
  assert.ok(lastAnswer(chat).error, 'hata kullanıcıya gösterilir');

  await chat.retryLast();
  assert.equal(calls.chat.length, 1);
  const sent = calls.chat[0];
  assert.equal(sent.contexts.length, 1, 'bağlam tekrar denemede kaybolmaz');
  assert.match(sent.contexts[0].text, /BuyerLog-Orders-all-records\.csv/);
  assert.equal(sent.attachments.length, 1, 'CSV eki tekrar denemede yeniden yüklenir');
  assert.deepEqual(calls.builds, ['orders:all', 'orders:all']);
});

test('başarıyla hazırlanmış mesajın yeniden üretiminde yüklenmiş ekler tekrar kullanılır', async () => {
  const { chat, calls } = load();
  chat._state.contexts = [{ id: 'orders:all', label: 'Orders — All records (2)' }];
  await chat.send('özet');
  await chat.retryLast();
  assert.equal(calls.chat.length, 2);
  assert.equal(calls.uploads.length, 1, 'aynı CSV ikinci kez yüklenmez');
  assert.equal(calls.chat[1].contexts.length, 1);
  assert.equal(calls.chat[1].attachments.length, 1);
});

test('geçmişten geri yüklenen, hiç gönderilemeyen mesaj tekrarlanınca bağlam yeniden kurulur', async () => {
  const storage = new Map();
  const first = load({ storage, failUploads: 1 });
  first.chat._state.contexts = [{ id: 'orders:all', label: 'Orders — All records (2)' }];
  await first.chat.send('tablo');
  assert.equal(first.calls.chat.length, 0);
  const raw = storage.get('bl.lcwai.history.v1');
  assert.doesNotMatch(raw, /PO1|blob\//, 'veri/ek kalıcı depoya yazılmaz; yalnız bağlam kimliği');

  const second = load({ storage });
  assert.equal(second.chat.restoreConversations(), true);
  await second.chat.retryLast();
  assert.equal(second.calls.chat.length, 1);
  assert.equal(second.calls.chat[0].chatId, null);
  assert.equal(second.calls.chat[0].contexts.length, 1);
  assert.equal(second.calls.chat[0].attachments.length, 1);
});

test('geri yüklenen mesajın kullanıcı dosyaları artık yoksa sessizce eksiz gönderilmez', async () => {
  const storage = new Map();
  storage.set('bl.lcwai.history.v1', JSON.stringify([{ id: 'c1', chatId: null, title: 't', messages: [
    { role: 'user', text: 'dosyayı incele', contextLabels: [], fileNames: ['fiyat.xlsx'] },
    { role: 'ai', text: '', error: 'LCWAI_UPLOAD_FAILED' },
  ] }]));
  const { chat, calls } = load({ storage });
  assert.equal(chat.restoreConversations(), true);
  await chat.retryLast();
  assert.equal(calls.chat.length, 0, 'eksik dosyayla istek gönderilmez');
  assert.match(lastAnswer(chat).error, /fiyat\.xlsx/);
});

test('başarıyla gönderilmiş geçmiş mesajda yeniden üretim LCW AI sohbet geçmişine dayanır (yeniden yükleme yok)', async () => {
  const storage = new Map();
  const first = load({ storage });
  first.chat._state.contexts = [{ id: 'orders:all', label: 'Orders — All records (2)' }];
  await first.chat.send('özet');
  const second = load({ storage });
  assert.equal(second.chat.restoreConversations(), true);
  await second.chat.retryLast();
  assert.equal(second.calls.chat.length, 1);
  assert.equal(second.calls.chat[0].chatId, 'remote-1');
  assert.equal(second.calls.uploads.length, 0);
  assert.equal(second.calls.builds.length, 0);
});
