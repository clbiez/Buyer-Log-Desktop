const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const connector = require('../server/lib/agent-browser-connector');
const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'agent-browser-connector.js'), 'utf8');

test('v6.15 detects supported images returned as application/octet-stream', () => {
  assert.equal(connector.coreNectumImageMime(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]), 'application/octet-stream'), 'image/png');
  assert.equal(connector.coreNectumImageMime(Buffer.from([0xff,0xd8,0xff,0xe0,0,0,0,0,0,0,0,0]), 'application/octet-stream'), 'image/jpeg');
  assert.equal(connector.coreNectumImageMime(Buffer.from('GIF89a000000'), 'application/octet-stream'), 'image/gif');
  assert.equal(connector.coreNectumImageMime(Buffer.from('RIFF0000WEBP'), 'application/octet-stream'), 'image/webp');
});

test('v6.15 normalizes MIME parameters while preserving safe image types', () => {
  assert.equal(connector.coreNectumImageMime(Buffer.alloc(12), 'image/jpeg; charset=binary'), 'image/jpeg');
  assert.equal(connector.coreNectumImageMime(Buffer.alloc(12), 'image/svg+xml'), '');
});

test('v6.15 reads Blob bytes before MIME detection and has a PNG conversion fallback', () => {
  const imageFetch = SOURCE.slice(SOURCE.indexOf('function coreNectumImageFetchExpression'), SOURCE.indexOf('async function coreNectumBulkImages'));
  assert.match(imageFetch, /response\.blob\(\)/);
  assert.match(imageFetch, /blob\.arrayBuffer\(\)/);
  assert.match(imageFetch, /createImageBitmap\(blob\)/);
  assert.match(imageFetch, /canvas\.toBlob/);
  assert.match(imageFetch, /new Blob\(\[bytes\],\{type:mime\}\)/);
});
