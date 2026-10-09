'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const code = fs.readFileSync(path.join(__dirname, '../public/master-releases-ui.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup(fetchJSON, confirm = () => true) {
  const global = { document: { documentElement: { lang: 'en' } }, confirm };
  vm.runInNewContext(code, { window: global });
  let markup = '', nodes = new Map(), restores = [];
  const host = { isConnected: true, get innerHTML() { return markup; }, set innerHTML(value) {
    markup = value;
    nodes = new Map(['[data-master-note]', '[data-master-refresh]', '[data-master-publish-form]'].map(key => [key, {}]));
    restores = [...value.matchAll(/data-master-restore="(\d+)"/g)].map(match => ({ dataset: { masterRestore: match[1] } }));
  }, querySelector: selector => nodes.get(selector), querySelectorAll: () => restores };
  return { global, host, mount: () => global.BLMasterReleasesUI.mount(host, { fetchJSON, confirm }), restores: () => restores };
}
function release(note = 'Demo') { return { version: 3, note, publishedBy: 'moderator', publishedAt: '2026-10-09T12:00:00.000Z', changedEntities: ['pricingRules'] }; }

test('lazy mount reads history and escapes all arbitrary textual release metadata', async () => {
  const calls = [], value = release('<img src=x onerror=alert(1)>');
  value.publishedBy = 'a<svg>'; value.changedEntities = ['a<script>'];
  const ui = setup(async (url, options) => { calls.push({ url, options }); return { releases: [value] }; });
  assert.equal(calls.length, 0);
  await ui.mount();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/shared-hub/master-releases');
  assert.ok(ui.host.innerHTML.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(ui.host.innerHTML.includes('a&lt;svg&gt;'));
  assert.ok(ui.host.innerHTML.includes('a&lt;script&gt;'));
  assert.ok(!ui.host.innerHTML.includes('<img'));
});

test('restore confirmation cancellation never sends a restore request', async () => {
  const calls = [], confirms = [];
  const ui = setup(async url => { calls.push(url); return { releases: [release()] }; }, message => { confirms.push(message); return false; });
  await ui.mount();
  ui.restores()[0].onclick(); await flush();
  assert.equal(calls.length, 1);
  assert.equal(confirms.length, 1);
  assert.ok(confirms[0].includes('v3'));
  assert.ok(confirms[0].includes('new release'));
});

test('restore sends the version and note, refreshes history and reports success', async () => {
  const calls = [];
  const ui = setup(async (url, options) => { calls.push({ url, options }); return options ? { published: true } : { releases: [release()] }; });
  await ui.mount();
  ui.host.querySelector('[data-master-note]').oninput({ target: { value: ' restore note ' } });
  ui.restores()[0].onclick(); await flush();
  const action = calls.find(call => call.url.endsWith('/restore'));
  assert.equal(action.options.method, 'POST');
  assert.deepEqual(JSON.parse(action.options.body), { version: 3, note: 'restore note' });
  assert.equal(calls.filter(call => !call.options).length, 2);
  assert.ok(ui.host.innerHTML.includes('selected rules were published as a new release'));
});

test('publishing posts an optional note and reads current language when rendering', async () => {
  const calls = [];
  const ui = setup(async (url, options) => { calls.push({ url, options }); return options ? { published: true } : { releases: [] }; });
  const controller = await ui.mount();
  assert.ok(ui.host.innerHTML.includes('Publish with note'));
  ui.global.document.documentElement.lang = 'tr';
  await controller.refresh();
  assert.ok(ui.host.innerHTML.includes('Not ekleyerek yayımla'));
  ui.host.querySelector('[data-master-note]').oninput({ target: { value: ' Rule change ' } });
  let prevented = false;
  ui.host.querySelector('[data-master-publish-form]').onsubmit({ preventDefault() { prevented = true; } });
  await flush();
  assert.equal(prevented, true);
  const action = calls.find(call => call.url.endsWith('/publish-master'));
  assert.deepEqual(JSON.parse(action.options.body), { note: 'Rule change' });
  assert.ok(ui.host.innerHTML.includes('Kurallar yayımlandı.'));
});

test('API failure renders escaped error text and re-enables future refresh', async () => {
  let fail = true;
  const ui = setup(async () => { if (fail) throw new Error('<script>bad</script>'); return { releases: [] }; });
  const controller = await ui.mount();
  assert.ok(ui.host.innerHTML.includes('&lt;script&gt;bad&lt;/script&gt;'));
  assert.ok(!ui.host.innerHTML.includes('<script>'));
  fail = false; await controller.refresh();
  assert.ok(ui.host.innerHTML.includes('No archived rule releases yet.'));
});

test('closed modal is not rendered after its pending history request resolves', async () => {
  let resolve;
  const ui = setup(() => new Promise(done => { resolve = done; }));
  const pending = ui.mount();
  const before = ui.host.innerHTML;
  ui.host.isConnected = false; resolve({ releases: [release()] }); await pending;
  assert.equal(ui.host.innerHTML, before);
});

test('protected publication preserves its note and never reports a successful release',async()=>{
 const ui=setup(async(url,options)=>options?{published:false,protected:true}:{releases:[]});await ui.mount();
 ui.host.querySelector('[data-master-note]').oninput({target:{value:'Keep this note'}});ui.host.querySelector('[data-master-publish-form]').onsubmit({preventDefault(){}});await flush();
 assert.ok(ui.host.innerHTML.includes('The rules were not published'));assert.ok(ui.host.innerHTML.includes('Keep this note'));assert.ok(!ui.host.innerHTML.includes('Rules published.'));
});
