'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createLoginThrottle } = require('../server/lib/login-throttle');
const identity = (account = 'known-user', peer = '127.0.0.1', known = true) => ({ account, peer, known });
test('account limiter survives trusted peer rotation, releases on expiry, and clears all peer histories on success', () => {
  let time = 100000;
  const limiter = createLoginThrottle({ now: () => time });
  for (let i = 0; i < 5; i++) limiter.failure(identity('a', '192.0.2.' + i));
  assert.equal(limiter.check(identity('a', '203.0.113.9')).retryAfter, 60);
  time += 30000; assert.equal(limiter.check(identity('a')).retryAfter, 30);
  time += 30001; assert.equal(limiter.check(identity('a')).retryAfter, 0);
  for (let i = 0; i < 4; i++) limiter.failure(identity('b', '192.0.2.1'));
  limiter.clear(identity('b', '192.0.2.2'));
  limiter.failure(identity('b', '192.0.2.1'));
  assert.equal(limiter.check(identity('b')).retryAfter, 0);
});
test('random unknown names and peers cannot grow pools or evict a live lock; known users keep access', () => {
  let time = 100000;
  const limiter = createLoginThrottle({ maxBuckets: 8, now: () => time });
  const target = identity('absent', '127.0.0.1', false);
  for (let i = 0; i < 5; i++) limiter.failure(target);
  for (let i = 0; i < 1000; i++) {
    const candidate = identity('random-' + i, '192.0.2.' + i, false);
    if (!limiter.check(candidate).retryAfter) limiter.failure(candidate);
  }
  assert.ok(limiter.size().unknown <= 8);
  assert.equal(limiter.check(target).retryAfter, 60, 'active protection was not evicted');
  assert.equal(limiter.check(identity('real-user')).retryAfter, 0, 'unknown-name pool does not lock the team');
  time += 300001;
  assert.equal(limiter.check(identity('new-absent', '127.0.0.1', false)).retryAfter, 0);
});
test('failure window expiration resets history even when the lock threshold was not reached', () => {
  let time = 100000;
  const limiter = createLoginThrottle({ now: () => time });
  for (let i = 0; i < 4; i++) limiter.failure(identity());
  time += 300001;
  limiter.failure(identity());
  assert.equal(limiter.check(identity()).retryAfter, 0);
});
test('known-peer floods remain bounded while the account bucket remains authoritative', () => {
  const limiter = createLoginThrottle({ maxBuckets: 8 });
  for (let i = 0; i < 1000; i++) {
    const candidate = identity('same', '192.0.2.' + i);
    if (!limiter.check(candidate).retryAfter) limiter.failure(candidate);
  }
  assert.ok(limiter.size().known <= 8);
  assert.ok(limiter.check(identity('same', 'other')).retryAfter > 0);
});
test('known-pool saturation fails closed without evicting history and recovers after the failure window', () => {
  let time = 100000;
  const limiter = createLoginThrottle({ maxBuckets: 8, now: () => time });
  for (let i = 0; i < 4; i++) limiter.failure(identity('known-' + i));
  assert.equal(limiter.size().known, 8);
  assert.equal(limiter.check(identity('untouched')).retryAfter, 300);
  time += 300001;
  assert.equal(limiter.check(identity('untouched')).retryAfter, 0);
  assert.equal(limiter.size().known, 0);
});
test('actual sign-in error formatter uses localized structured retry seconds', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, '../public/select-user.html'), 'utf8');
  const start = source.indexOf('  function loginErrorMessage('), end = source.indexOf('\n  }', start) + 4;
  let lang = 'tr';
  const context = { tr: (tr, en) => lang === 'en' ? en : tr };
  vm.createContext(context); vm.runInContext(source.slice(start, end), context);
  const data = { code: 'LOGIN_TEMPORARILY_LOCKED', retryAfter: 42, error: 'server-language fallback' };
  assert.equal(context.loginErrorMessage(data), 'Çok fazla hatalı deneme. 42 saniye sonra tekrar deneyin.');
  lang = 'en';
  assert.equal(context.loginErrorMessage(data), 'Too many failed attempts. Try again in 42 seconds.');
});
