'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('LCW AI desktop outputs use the real Downloads folder and native safe open/reveal', () => {
  const main = read('electron/main.js');
  const backend = read('electron/backend.js');
  const preload = read('electron/preload.js');
  const store = read('server/lib/lcwai-output/output-store.js');
  const assistant = read('public/lcwai-assistant.js');

  assert.match(main, /downloadsRoot:\s*app\.getPath\('downloads'\)/);
  assert.match(backend, /env\.BUYER_LOG_AI_OUTPUTS_ROOT\s*=\s*this\.downloadsRoot/);
  assert.match(store, /process\.env\.BUYER_LOG_AI_OUTPUTS_ROOT/);
  assert.match(store, /LOCAL_DATA_ROOT, 'ai-outputs-index\.json'/, 'metadata stays in Buyer Log local data, not next to Downloads');

  assert.match(main, /function generatedDownloadPath\(fileName\)/);
  assert.match(main, /path\.basename\(name\) !== name/);
  assert.match(main, /ipcMain\.handle\('buyerlog:open-generated-download'/);
  assert.match(main, /ipcMain\.handle\('buyerlog:reveal-generated-download'/);
  assert.match(preload, /openGeneratedDownload: \(fileName\) => ipcRenderer\.invoke\('buyerlog:open-generated-download'/);
  assert.match(preload, /revealGeneratedDownload: \(fileName\) => ipcRenderer\.invoke\('buyerlog:reveal-generated-download'/);
  assert.match(assistant, /desktop\.openGeneratedDownload/);
  assert.match(assistant, /desktop\.revealGeneratedDownload/);
});

function loadChat(storageMap = new Map()) {
  const BLStorage = {
    getItem(key) { return storageMap.has(String(key)) ? storageMap.get(String(key)) : null; },
    setItem(key, value) { storageMap.set(String(key), String(value)); },
  };
  const window = {
    appLang: 'tr',
    BLStorage,
    BuyerLogAI: { registerContextProvider() {}, getAvailableContext() { return []; } },
  };
  window.window = window;
  const document = {
    documentElement: { lang: 'tr' },
    getElementById() { return null; },
  };
  const context = vm.createContext({
    window, document, console, Date, JSON, Map, Set, String, Number, Array, Object,
    encodeURIComponent, setTimeout, clearTimeout,
  });
  vm.runInContext(read('public/lcwai-chat.js'), context);
  return { chat: window.BLLcwAiChat, storageMap };
}

test('LCW AI conversation history survives reload without persisting attachment/context payloads', () => {
  const storage = new Map();
  const first = loadChat(storage).chat;
  first._state.conversations = [{
    id: 'local-1',
    chatId: 'remote-chat-42',
    title: 'Üretici fiyat görüşmesi',
    imageMap: { 'KOL-1': { source: 'secret-source' } },
    messages: [
      {
        role: 'user',
        text: 'sunum hazırla',
        contextLabels: ['Collection — Visible records'],
        fileNames: ['pricing.xlsx'],
        attachments: [{ url: 'SECRET_ATTACHMENT_URL', blobName: 'conversation-files/secret' }],
        contexts: [{ rows: [['SECRET_CONTEXT_ROW']] }],
        output: { format: 'pdf', orientation: 'portrait', detail: 'standard' },
      },
      {
        role: 'ai',
        text: 'hazır',
        model: 'GPT-6 Sol',
        file: {
          id: 'out-1', fileName: 'Sunum.pdf', format: 'pdf', bytes: 123,
          path: 'C:\\Users\\someone\\Downloads\\Sunum.pdf',
        },
      },
    ],
  }];
  first._state.activeId = 'local-1';
  first.persistConversations();

  const raw = storage.get('bl.lcwai.history.v1');
  assert.ok(raw);
  assert.doesNotMatch(raw, /SECRET_ATTACHMENT_URL|SECRET_CONTEXT_ROW|secret-source|C:\\\\Users/i);

  const second = loadChat(storage).chat;
  assert.equal(second.restoreConversations(), true);
  assert.equal(second._state.conversations[0].chatId, 'remote-chat-42');
  assert.equal(second._state.conversations[0].messages[0].text, 'sunum hazırla');
  assert.equal(second._state.conversations[0].messages[1].file.fileName, 'Sunum.pdf');
  assert.equal(second._state.conversations[0].messages[1].file.path, undefined);
});

test('LCW AI accepts external files through the same intake path used by file picker', () => {
  const { chat } = loadChat();
  chat._state.config = { limits: { maxFilesPerRequest: 2, maxFileBytes: 100 } };
  chat.addFiles([{ name: 'a.xlsx', size: 50 }, { name: 'b.pdf', size: 150 }, { name: 'c.txt', size: 1 }]);
  assert.equal(chat._state.files.length, 2);
  assert.equal(chat._state.files[0].error, '');
  assert.equal(chat._state.files[1].error, 'çok büyük');

  const source = read('public/lcwai-chat.js');
  assert.match(source, /addEventListener\('dragenter'/);
  assert.match(source, /addEventListener\('dragover'/);
  assert.match(source, /addEventListener\('drop'/);
  assert.match(source, /event\.dataTransfer && event\.dataTransfer\.files/);
  assert.match(require('./helpers/manifest-css')(['ui-tokens.css','app.css','design.css','experience.css','ui-components.css','lcwai-assistant.css']), /\.lcwaiChatPage\.is-file-drag \.lcwaiComposer/);
});

test('LCW AI history storage is user-scoped but deliberately not synced through user-preferences', () => {
  const storage = read('public/user-storage.js');
  assert.match(storage, /'bl\.lcwai\.history\.'/);
  const syncedBlock = storage.slice(storage.indexOf('var SYNCED=['), storage.indexOf('function synced'));
  assert.doesNotMatch(syncedBlock, /bl\.lcwai\.history/);
});
