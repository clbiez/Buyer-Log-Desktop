'use strict';

/*
 * v7.0.253 — Başarısız yenileme yanlış adımda "sürüyor" görünüyordu.
 *
 * Saha bulgusu: ASAS sorgusu sunucu bellek hatasıyla (MODEL_QUERY_OUT_OF_MEMORY)
 * düştü; ilerleme penceresi "Başarısız" rozetine rağmen 3. adımı ("Denetleme ve
 * Kaydetme") dönen noktalarla gösteriyordu ve teşhis "sınıflandırılamadı"
 * diyordu. Hata fazı artık son gerçek faza göre adımına yerleşir ve o adım
 * "başarısız" çizilir; sunucu bellek hatası kendi teşhisini alır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { diagnoseRefreshError } = require('../server/lib/refresh-error-diagnostics');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const CSS = require('./helpers/manifest-css')(['ui-tokens.css','app.css','design.css','experience.css','ui-components.css'] );
const source = APP.slice(APP.indexOf('function refreshCompactConnectionKind'), APP.indexOf('function refreshCompactStepHtml'));
const ctx = {};
vm.runInNewContext(`${source};this.stageIndex=refreshCompactStageIndex;`, ctx);

const asasFailedJob = {
  running: false, phase: 'error', error: 'There\'s not enough memory to complete this operation.',
  phases: [{ phase: 'source-setup' }, { phase: 'database' }],
  operations: [
    { type: 'start', connection: 'ASAS', operation: 'server-query' },
    { type: 'end', connection: 'ASAS', operation: 'server-query', error: 'not enough memory' },
  ],
};

test('v7.0.253 ASAS sorgusunda düşen yenileme 1. adımda kalır, 3. adıma atlamaz', () => {
  assert.equal(ctx.stageIndex(asasFailedJob), 1);
});

test('v7.0.253 kaydetme sırasında düşen yenileme 3. adımda gösterilir', () => {
  assert.equal(ctx.stageIndex({ ...asasFailedJob, phases: [{ phase: 'database' }, { phase: 'comparing' }, { phase: 'saving' }] }), 3);
});

test('v7.0.253 başarısız adım dönen nokta yerine başarısız durumla çizilir', () => {
  const html = APP.slice(APP.indexOf('function refreshCompactStepHtml'), APP.indexOf('function renderRefreshStagesBody'));
  assert.match(html, /is-failed|'failed'/);
  assert.match(html, /Failed/);
  assert.match(html, /Başarısız/);
  assert.match(CSS, /\.refreshCompactStep\.is-failed/);
});

test('v7.0.253 sunucu bellek hatası kendi teşhisini alır, "sınıflandırılamadı" demez', () => {
  const error = Object.assign(new Error('There\'s not enough memory to complete this operation. Please try again later when there may be more memory available.'), { code: 'MODEL_QUERY_OUT_OF_MEMORY' });
  const diagnosis = diagnoseRefreshError(error, { operations: [{ type: 'end', connection: 'ASAS', error: 'x' }] });
  assert.equal(diagnosis.category, 'source-memory');
  assert.equal(diagnosis.source, 'ASAS Database');
  assert.equal(diagnosis.vpnRelated, false);
  assert.ok(diagnosis.title.tr && diagnosis.title.en);
  assert.ok(diagnosis.action.tr && diagnosis.action.en);
});
