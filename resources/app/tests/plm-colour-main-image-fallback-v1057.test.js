'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const connector = require('../server/lib/agent-browser-connector');
const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'agent-browser-connector.js'), 'utf8');

test('renk görseli varsa ana model görselinden önce kullanılır', () => {
  const colourImage = { mimeType: 'image/jpeg', base64: 'colour' };
  const mainImage = { mimeType: 'image/jpeg', base64: 'main' };
  const images = new Map([['2123595\u0000CVL\u0000NEW BLACK', colourImage]]);

  assert.equal(
    connector.coreNectumResolveRequestedImage(
      { plmId: '2123595', colourCode: 'CVL', colour: 'NEW BLACK' },
      images,
      mainImage,
    ),
    colourImage,
  );
});

test('renk görseli yoksa aynı modelin ana görseli fallback olarak kullanılır', () => {
  const mainImage = { mimeType: 'image/jpeg', base64: 'main' };

  assert.equal(
    connector.coreNectumResolveRequestedImage(
      { plmId: '2123595', colourCode: 'HEC', colour: 'DARK BROWN' },
      new Map(),
      mainImage,
    ),
    mainImage,
  );
});

test('ne renk ne ana görsel varsa resolver null döndürür', () => {
  assert.equal(
    connector.coreNectumResolveRequestedImage(
      { plmId: '2123595', colourCode: 'ZZX', colour: 'GREY' },
      new Map(),
      null,
    ),
    null,
  );
});

test('yalnız ikinci renk istendiğinde gereksiz Style List görsel indirmesi yapılmaz', () => {
  assert.match(
    SOURCE,
    /imageRecords=records\.filter\(record=>selectionPlans\.get\(record\.plmId\)\?\.hasGenericRequest\)/,
  );
});
