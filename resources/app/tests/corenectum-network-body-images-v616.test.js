const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const connector = require('../server/lib/agent-browser-connector');
const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'agent-browser-connector.js'), 'utf8');

test('v6.16 recovers image bytes from CDP Network after a large Runtime result fails', async () => {
  const url = 'https://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/Attachment/GetAttachment/a80f9adffd69a3aab37e2fd28df00360';
  const expected = { mimeType:'image/png', base64:'iVBORw0KGgo=' };
  const capture = { images:new Map() };
  const page = {
    async _evaluateValue() {
      capture.images.set(url, expected);
      return { ok:false, code:'CDP_TRANSFER_FAILED' };
    },
  };
  const images = await connector.coreNectumBulkImages(page, capture, [{plmId:'2108736',imageUrl:url}], 1);
  assert.deepEqual(images.get('2108736'), expected);
  assert.equal(images.failures.size, 0);
});

test('v6.16 waits for Network.getResponseBody after triggering native fetch', () => {
  const bulk = SOURCE.slice(SOURCE.indexOf('async function coreNectumBulkImages'), SOURCE.indexOf('async function coreNectumStyleListRowImage'));
  const firstWait = bulk.indexOf('coreNectumWaitCapturedImage');
  const fetch = bulk.indexOf('coreNectumImageFromUrl');
  const secondWait = bulk.indexOf('coreNectumWaitCapturedImage', firstWait + 1);
  assert.ok(firstWait >= 0 && fetch > firstWait && secondWait > fetch);
  assert.match(bulk, /output\.failures=failures/);
});

test('v6.16 returns a specific reason instead of swallowing every Attachment failure', () => {
  const imageFetch = SOURCE.slice(SOURCE.indexOf('function coreNectumImageFetchExpression'), SOURCE.indexOf('async function coreNectumBulkImages'));
  assert.match(imageFetch, /HTTP_ERROR/);
  assert.match(imageFetch, /EMPTY_IMAGE/);
  assert.match(imageFetch, /UNSUPPORTED_IMAGE/);
  assert.match(imageFetch, /CDP_TRANSFER_FAILED/);
});

test('v6.17 generates syntactically valid browser code for Attachment image fetches', () => {
  const url = 'https://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/Attachment/GetAttachment/a80f9adffd69a3aab37e2fd28df00360';
  const expression = connector.coreNectumImageFetchExpression(url);
  assert.doesNotThrow(() => new Function(`return (${expression})`));
  assert.match(expression, /supported=\['image\/jpeg','image\/png','image\/webp','image\/gif'\]/);
  assert.ok(expression.includes(url));
});
