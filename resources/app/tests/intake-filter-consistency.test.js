'use strict';

/* INTAKE filtre tutarlılığı: yarış durumları, Genel Bakış senkronu, önbellek
   anahtarı ve canlı kaynak kesintisi. Tarayıcıda (Playwright) yeniden üretilen
   hatalar:
     · yükleme sürerken uygulanan filtre hiç sorgulanmıyor, çip geri siliniyordu,
     · art arda iki filtreden ikincisi kayboluyordu,
     · Genel Bakış'ın her yeniden çizimi elle seçilen filtreyi eziyor, Genel
       Bakış filtresi kalktıktan sonra da değer görünümde kalıyordu,
     · canlı kaynak düşünce tablo boşalıyordu,
     · her filtre uygulamasında tablo 4 kez baştan çiziliyordu. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const report = require('../server/lib/intake-report');
const { createIntakeStore } = require('../server/lib/intake-store');

const root = path.join(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'public', 'intake.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server', 'server.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'app.css'), 'utf8');

function fnBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunamadı`);
  // Varsayılan parametredeki `= {}` gövde sanılmasın: gövde `) {` ile başlar.
  const open = source.indexOf(') {', start) + 2;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${name} kapanmadı`);
}

test('Genel Bakış senkron kaydı (overviewSync) görünüm uzlaştırmasında korunur', () => {
  const base = report.defaultViewConfig();
  const season = base.query.filters.find(field => field.defaultLabel === 'SezonKod');
  const input = {
    ...base,
    query: { ...base.query, filterValues: { [season.id]: ['26W'] } },
    display: { ...base.display, overviewSync: { signature: 'sig', values: { [season.id]: ['26W', '', '26W'], 'intake-unknown': ['X'] } } },
  };
  const out = report.reconcileViewConfig(input, report.defaultFields());
  assert.deepEqual(out.display.overviewSync, { signature: 'sig', values: { [season.id]: ['26W'] } });
  const plain = report.reconcileViewConfig(base, report.defaultFields());
  assert.equal(Object.prototype.hasOwnProperty.call(plain.display, 'overviewSync'), false, 'boş senkron kaydı görünüme eklenmez');
});

test('INTAKE sorgu önbelleği sorgu seçeneklerini (sıfır bütçe gizleme) anahtara katar', () => {
  const store = createIntakeStore({ root: fs.mkdtempSync(path.join(os.tmpdir(), 'intake-key-')) });
  const base = { connection: { server: 's', catalog: 'c' }, rows: ['a'], measures: ['m'] };
  assert.notEqual(
    store.queryKey({ ...base, options: { hideZeroCurrentBudget: true } }),
    store.queryKey({ ...base, options: { hideZeroCurrentBudget: false } }));
});

test('sunucu önbellek anahtarı değersiz filtreleri ve değer sırasını yok sayar, sıfır bütçe seçeneğini içerir', () => {
  const key = fnBody(server, 'intakeQueryKey');
  assert.match(key, /if \(!list\.length\) continue;/);
  assert.match(key, /\.sort\(\)/);
  assert.match(key, /hideZeroCurrentBudget/);
});

test('canlı kaynak kesintisinde rapor yanıtı snapshot satırlarını üst düzeyde döndürür', () => {
  // Satırlar güncel görünüm id'lerine yeniden eşlenmiş snapshot'tan gelir (v7.191).
  assert.match(server, /return res\.json\(\{ \.\.\.fallback, rows: fallback\.snapshot\.rows, fetchedAt: previous\.fetchedAt, source: 'snapshot', fromCache: true \}\);/);
  assert.match(server, /rows: intakeReport\.remapRows\(snapshot\.rows, snapshot\.viewConfig, viewConfig\)/);
  const run = fnBody(ui, 'runReport');
  assert.match(run, /result\.snapshot && Array\.isArray\(result\.snapshot\.rows\)/);
  assert.match(run, /if \(rows\) setRows\(rows\);/, 'satır gelmezse ekrandaki veri korunmalı');
});

test('rapor isteği daha yeni kaydedilmiş görünüm ayarlarını (display) ezmez', () => {
  const save = fnBody(server, 'intakeSaveReportView');
  assert.match(save, /display: stored\.display/);
  const route = server.slice(server.indexOf("app.post('/api/intake/report'"), server.indexOf("app.post('/api/intake/report'") + 4000);
  assert.doesNotMatch(route, /intakeSaveView\(userId, built\.viewConfig\)/);
  assert.equal((route.match(/intakeSaveReportView\(userId, built\.viewConfig, found\.fields\)/g) || []).length, 2);
});

test('yükleme sürerken gelen yenileme sıraya alınır, eski yanıt yeni seçimi ezmez', () => {
  const refresh = fnBody(ui, 'refresh');
  assert.match(refresh, /if \(state\.loading\) \{\s*state\.refreshQueued = /);
  assert.match(refresh, /while \(state\.refreshQueued\)/);
  const run = fnBody(ui, 'runReport');
  assert.match(run, /if \(intakeQuerySignature\(state\.viewConfig\) !== signature\)/);
  assert.match(run, /if \(result\.viewConfig && revision === state\.viewRevision\) state\.viewConfig = result\.viewConfig;/);
});

test('görünüm kaydı sıralı ve birleştirilmiş; eski kayıt yanıtı yeni değişikliği geri almaz', () => {
  const persist = fnBody(ui, 'persistView');
  assert.match(persist, /if \(state\.saveInFlight\) return state\.saveInFlight;/);
  assert.match(persist, /while \(state\.savePending\)/);
  assert.match(persist, /revision === state\.viewRevision && !state\.savePending/);
  const save = fnBody(ui, 'saveView');
  assert.match(save, /state\.viewRevision \+= 1;/);
  assert.match(save, /if \(refreshing\) void refresh\(false\);/);
  assert.match(fnBody(ui, 'persistWidths'), /persistView\(\{ silent: true \}\)/);
});

test('Genel Bakış senkronu yalnız Genel Bakış filtresi değişince çalışır ve sahipliği kalıcı tutar', () => {
  const sync = fnBody(ui, 'syncOverviewFilters');
  assert.match(sync, /if \(signature === clean\(previous\.signature\)\) return;/);
  assert.match(sync, /if \(sameValues\(next\.query\.filterValues\[id\], values\)\) delete next\.query\.filterValues\[id\];/);
  assert.match(sync, /overviewSync: \{ signature, values: applied \}/);
  assert.doesNotMatch(ui, /globalFilterIds/);
  // Elle seçim / kaldırma senkron sahipliğini bırakır.
  assert.equal((ui.match(/releaseOverviewFilter\(next, /g) || []).length, 2);
});

test('tablo yalnız veri veya düzen değişince yeniden çizilir; yükleme tabloyu yerinde soluklaştırır', () => {
  const table = fnBody(ui, 'renderTable');
  assert.match(table, /if \(!options\.force && signature === state\.tableSignature && table\.firstChild\) return;/);
  const chrome = fnBody(ui, 'renderChrome');
  assert.match(chrome, /classList\.toggle\('isBusy', state\.loading\)/);
  assert.match(css, /\.intakeBody\.isBusy \.intakeTableWrap\{opacity:\.6;\}/);
});
