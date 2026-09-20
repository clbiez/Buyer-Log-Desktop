const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'agent-browser-connector.js'), 'utf8');

test('v6.15 fetches Attachment images like the working console collector', () => {
  // v6.41: fetch mantığı coreNectumImageFetchExpression'a taşındı (web-script-registry
  // üzerinden kullanıcı düzenlemesine açılabilsin diye); coreNectumImageFromUrl artık
  // ona delege ediyor. Aralık bunu da kapsayacak şekilde genişletildi.
  const imageFetch = SOURCE.slice(SOURCE.indexOf('function coreNectumImageFetchExpression'), SOURCE.indexOf('async function coreNectumBulkImages'));
  assert.match(imageFetch, /window\.fetch\.bind\(window\)/);
  assert.match(imageFetch, /credentials:'include'/);
  assert.doesNotMatch(imageFetch, /credentials:'omit'/);
  assert.doesNotMatch(imageFetch, /headers:cfg\.headers/);
});

test('v6.13 never replays cookie, origin, browser security, or user-agent headers', () => {
  const replay = SOURCE.slice(SOURCE.indexOf('function coreNectumReplayHeaders'), SOURCE.indexOf('async function coreNectumWaitCapturedImage'));
  assert.match(replay, /cookie\|origin\|referer/);
  assert.match(replay, /\^sec-/);
  assert.match(replay, /user-agent/);
});

test('v6.15 image workers preserve the signed-in browser credential mode', () => {
  const bulk = SOURCE.slice(SOURCE.indexOf('async function coreNectumBulkImages'), SOURCE.indexOf('async function coreNectumStyleListRowImage'));
  assert.match(bulk, /coreNectumImageFromUrl\(page,url\)/);
  assert.doesNotMatch(bulk, /capture\.templates/);
});
