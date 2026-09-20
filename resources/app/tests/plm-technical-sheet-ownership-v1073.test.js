'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');

const ownership = require('../server/lib/plm-technical-sheet-ownership');

test('technical sheet ownership is canonical per PLM ID, not per Collection colour row', () => {
  assert.equal(ownership.canonicalTechnicalSheetKey('123456'), 'plm-tp-123456');
  assert.equal(ownership.canonicalTechnicalSheetKey(' 123456 '), 'plm-tp-123456');
  assert.equal(ownership.canonicalTechnicalSheetKey('_00123456.0'), 'plm-tp-123456');
  assert.equal(ownership.canonicalTechnicalSheetKey(''), '');
});

test('a single legacy technical sheet is promoted by metadata only, retaining its physical file', () => {
  const index = [{
    id: 'mf_old', modelKey: 'collection-41', storedName: 'mf_old_123456.pdf',
    plmSource: 'technical-sheet', plmLanguage: 'en', plmId: '123456',
  }];

  const resolved = ownership.resolveTechnicalSheetOwnership(index, ['123456']);

  assert.equal(resolved.migrated.length, 1);
  assert.equal(index[0].modelKey, 'plm-tp-123456');
  assert.equal(index[0].storedName, 'mf_old_123456.pdf');
  assert.deepEqual(resolved.statusByPlmId['123456'], {
    status: 'ready', hasTechnicalSheet: true, languages: ['en'], conflict: null,
  });
});

test('conflicting legacy technical sheets are never silently chosen', () => {
  const index = [
    { id: 'mf_black', modelKey: 'collection-41', storedName: 'black.pdf', plmSource: 'technical-sheet', plmLanguage: 'en', plmId: '123456' },
    { id: 'mf_blue', modelKey: 'collection-42', storedName: 'blue.pdf', plmSource: 'technical-sheet', plmLanguage: 'en', plmId: '123456' },
  ];

  const resolved = ownership.resolveTechnicalSheetOwnership(index, ['123456']);

  assert.equal(resolved.migrated.length, 0);
  assert.equal(index[0].modelKey, 'collection-41');
  assert.equal(index[1].modelKey, 'collection-42');
  assert.equal(resolved.conflicts.length, 1);
  assert.equal(resolved.statusByPlmId['123456'].status, 'conflict');
  assert.equal(resolved.statusByPlmId['123456'].hasTechnicalSheet, false);
});

test('an existing canonical sheet wins deterministically and legacy copies are preserved', () => {
  const index = [
    { id: 'mf_current', modelKey: 'plm-tp-123456', storedName: 'current.pdf', plmSource: 'technical-sheet', plmLanguage: 'en', plmId: '123456' },
    { id: 'mf_old', modelKey: 'collection-41', storedName: 'old.pdf', plmSource: 'technical-sheet', plmLanguage: 'en', plmId: '123456' },
  ];

  const resolved = ownership.resolveTechnicalSheetOwnership(index, ['123456']);

  assert.equal(resolved.migrated.length, 0);
  assert.equal(resolved.conflicts.length, 0);
  assert.equal(resolved.statusByPlmId['123456'].status, 'ready');
  assert.equal(index[1].modelKey, 'collection-41');
});

test('different legacy languages are still one ownership conflict for a PLM ID', () => {
  const index = [
    { id: 'mf_en', modelKey: 'collection-41', storedName: 'en.pdf', plmSource: 'technical-sheet', plmLanguage: 'en', plmId: '123456' },
    { id: 'mf_tr', modelKey: 'collection-42', storedName: 'tr.pdf', plmSource: 'technical-sheet', plmLanguage: 'tr', plmId: '123456' },
  ];

  const resolved = ownership.resolveTechnicalSheetOwnership(index, ['123456']);

  assert.equal(resolved.migrated.length, 0);
  assert.equal(resolved.conflicts.length, 1);
  assert.equal(resolved.conflicts[0].code, 'PLM_TP_LEGACY_CONFLICT');
  assert.equal(resolved.statusByPlmId['123456'].hasTechnicalSheet, false);
});

test('multiple live canonical references are reported instead of silently choosing one', () => {
  const index = [
    { id: 'mf_en', modelKey: 'plm-tp-123456', storedName: 'en.pdf', plmSource: 'technical-sheet', plmLanguage: 'en', plmId: '123456' },
    { id: 'mf_tr', modelKey: 'plm-tp-123456', storedName: 'tr.pdf', plmSource: 'technical-sheet', plmLanguage: 'tr', plmId: '123456' },
  ];

  const resolved = ownership.resolveTechnicalSheetOwnership(index, ['123456']);

  assert.equal(resolved.conflicts[0].code, 'PLM_TP_CANONICAL_CONFLICT');
  assert.equal(resolved.statusByPlmId['123456'].status, 'conflict');
  assert.equal(resolved.statusByPlmId['123456'].hasTechnicalSheet, false);
});

test('a missing physical file is stale, not an available Tech Pack', () => {
  const index = [{
    id: 'mf_missing', modelKey: 'plm-tp-123456', storedName: 'gone.pdf',
    plmSource: 'technical-sheet', plmLanguage: 'en', plmId: '123456',
  }];

  const resolved = ownership.resolveTechnicalSheetOwnership(index, ['123456'], {
    fileExists: () => false,
  });

  assert.equal(resolved.statusByPlmId['123456'].status, 'stale');
  assert.equal(resolved.statusByPlmId['123456'].hasTechnicalSheet, false);
  assert.deepEqual(resolved.statusByPlmId['123456'].staleFileIds, ['mf_missing']);
});

test('canonical resolution indexes files once for large multi-colour collections', () => {
  const count = 2500;
  const index = Array.from({ length: count }, (_, i) => ({
    id: `mf_${i}`, modelKey: `plm-tp-${i + 1}`, storedName: `${i}.pdf`,
    plmSource: 'technical-sheet', plmLanguage: 'en', plmId: String(i + 1),
  }));
  const started = performance.now();
  const resolved = ownership.resolveTechnicalSheetOwnership(index, index.map(item => item.plmId));
  const elapsed = performance.now() - started;

  assert.equal(Object.keys(resolved.statusByPlmId).length, count);
  assert.ok(elapsed < 250, `PLM ID lookup should be indexed, took ${Math.round(elapsed)} ms`);
});
