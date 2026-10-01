'use strict';

/*
 * Get OAB: tarayıcı bir kez açılsın ve doğrudan PASS'e gitsin; açık PASS
 * sekmesi varsa o kullanılsın. Veri, PLM'de olduğu gibi sekmenin İÇİNDEN
 * doğrudan API ile çekilir; site raporu kendisi çalıştırmaz.
 *
 *   1) Açık PASS sekmesinin token'ı PASS tarafından kabul ediliyorsa sekme
 *      yeniden yüklenmez/gezilmez.
 *   2) PASS sekmesi yoksa Buyer Log'un başlattığı tarayıcının boş başlangıç
 *      sekmesi kullanılır; ikinci sekme açılmaz.
 *   3) Gezinme filtresiz viewer'a yapılır (filtreli adres PASS'in raporu
 *      sitede çalıştırmasına yol açıyordu).
 *   4) Viewer rapor isteği atmasa da sekmedeki token geçerli olunca bağlantı
 *      tamamlanır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CONNECTOR = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'agent-browser-connector.js'), 'utf8');
const between = (source, start, end) => {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, start);
  return source.slice(from, source.indexOf(end, from + start.length));
};
const capture = between(CONNECTOR, 'async function capturePassAuthorization', '\nfunction requirePassAuth');

test('açık PASS sekmesi geçerli token taşıyorsa sekmeye dokunulmaz', () => {
  const probe = capture.indexOf('await passPageTokenAccepted(page)');
  assert.notEqual(probe, -1);
  assert.ok(probe < capture.indexOf('page.goto(targetUrl'), 'token kontrolü gezinmeden önce yapılmalı');
  assert.match(capture, /source:'page-storage'/);
});

test('PASS sekmesi yoksa boş başlangıç sekmesi, o da yoksa tek yeni sekme kullanılır', () => {
  const reuse = capture.indexOf('if(!page)page=passReusableStartupPage(context);');
  const open = capture.indexOf('if(!page)page=await pageForCurrentBuyerLogProfile(context,targetUrl)');
  assert.ok(reuse > -1 && open > reuse);
  const helper = between(CONNECTOR, 'function passReusableStartupPage', '\n}');
  assert.match(helper, /reusableBlankPageInBoundProfile\(context,binding\)/);
  assert.match(helper, /binding\.bound\?/, 'bağlama belirsizse başka profildeki boş sekme alınmaz');
  const forRequest = between(CONNECTOR, 'async function passPageForRequest', '\n}');
  assert.ok(forRequest.indexOf('passReusableStartupPage(context)') < forRequest.indexOf('pageForCurrentBuyerLogProfile'));
});

test('gezinme filtresiz viewer\'a yapılır; seçili rapordaki sekme yeniden yüklenmez', () => {
  assert.match(capture, /const targetUrl=passViewerUrl\(\{\}\);/);
  assert.match(capture, /page\.url\(\)!==targetUrl&&page\.url\(\)!==selectedViewerUrl/);
});

test('rapor isteği gelmese de sekmedeki token kabul edilince bağlantı tamamlanır', () => {
  assert.match(capture, /storageAccepted=true;break;/);
  assert.match(capture, /if\(!captured&&storageAccepted\)/);
  const probe = between(CONNECTOR, 'async function passPageTokenAccepted', '\n}');
  assert.match(probe, /passRequestExpression\(PASS_TOKEN_PROBE_URL,'POST',\{\},PASS_TOKEN_PROBE_BODY\)/);
  assert.match(probe, /result&&result\.ok/);
  assert.doesNotMatch(probe, /return result;/, 'token/yanıt Node tarafına taşınmaz, yalnız kabul durumu döner');
});
