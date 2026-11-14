'use strict';

/* INTAKE canlı kaynak hatası snapshot'a düşerken gerçek neden yutuluyordu:
   backend.log'da hiçbir iz yoktu ve ekran yalnız "Live source is unavailable"
   diyordu. DNS/VPN, katalog adı veya DAX hatası birbirinden ayrılamıyordu. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
const client = fs.readFileSync(path.join(__dirname, '..', 'public', 'intake.js'), 'utf8');

function routeBlock(startMarker, endMarker) {
  const start = server.indexOf(startMarker);
  assert.ok(start > 0, `${startMarker} bulunamadı`);
  const end = server.indexOf(endMarker, start + startMarker.length);
  return server.slice(start, end > start ? end : undefined);
}

test('INTAKE source failures are logged with code, source and redacted detail', () => {
  const start = server.indexOf('function intakeSourceFailure(');
  assert.ok(start > 0, 'intakeSourceFailure yardımcısı yok');
  const block = server.slice(start, server.indexOf('\n}', start));
  assert.match(block, /redactSecrets\(/);
  assert.match(block, /console\.error\(/);
  assert.match(block, /\[INTAKE\]/);
  assert.match(block, /connection\.server/);
  assert.match(block, /connection\.catalog/);
});

test('metadata, distinct and report routes record the real failure and return it as sourceError', () => {
  const routes = [
    routeBlock("app.get('/api/intake/metadata'", "app.post('/api/intake/distinct'"),
    routeBlock("app.post('/api/intake/distinct'", "app.post('/api/intake/report'"),
    routeBlock("app.post('/api/intake/report'", 'function currentUserIsModerator'),
  ];
  for (const block of routes) {
    assert.match(block, /intakeSourceFailure\(/);
    assert.match(block, /sourceError/);
  }
});

test('the offline snapshot banner shows the underlying source error in both languages', () => {
  const start = client.indexOf('async function runReport(');
  const block = client.slice(start, client.indexOf('function refresh(', start));
  assert.match(block, /sourceError/);
  assert.match(block, /text\('Ayrıntı', 'Detail'\)/);
});
