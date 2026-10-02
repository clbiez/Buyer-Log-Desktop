'use strict';

/* v7.205 — SOĞUK RUNTIME'DA KISMİ YENİLEME CP'Yİ SİLMEMELİ.
 *
 * Kullanıcı şikâyeti: "Başka sayfayı yenileyip CP'ye döndüğümde hiç veri
 * yokmuş gibi 'No CP data yet' görünüyor; baştan yenilemem gerekiyor."
 *
 * Kök neden: Moderatör dışındaki kullanıcıların ham model verisi RAM'de
 * tutulmaz (açılış yalnız hazır page-projection önbelleğini okur; ısınma
 * sonrası resetUserCache, 24 saatlik idle eviction). performRefresh kısmi
 * yenilemede (ör. yalnız LFL ya da Orders grubu) dokunulmayan hedefleri
 * cacheForUser(id).asasOrdersByTarget'tan korur. Runtime soğukken bu nesne
 * boştur; CP hedefi boş/yanlış veriyle yayınlanır, snapshot'a yazılır ve
 * page-projection CP satırları [] olur. Aynı soğuk runtime LFL satırlarını
 * ve "neler değişti" özetinin eski sipariş listesini de boşaltıyordu.
 *
 * Sözleşme: performRefresh, eski veriyi okumadan ve loadFromModels'i
 * çağırmadan önce runtime'ı snapshot'tan hydrate eder.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
const DRAWER = fs.readFileSync(path.join(__dirname, '..', 'public', 'detail-drawer.js'), 'utf8');

test('performRefresh soğuk runtime\'ı eski veriyi okumadan önce snapshot\'tan yükler', () => {
  const start = SERVER.indexOf('async function performRefresh(');
  assert.ok(start > 0, 'performRefresh bulunamadı');
  const body = SERVER.slice(start, SERVER.indexOf('await loadFromModels(', start));
  const hydrate = body.search(/await ensureDataLoaded\(id\)/);
  assert.ok(hydrate > 0, 'performRefresh runtime\'ı ensureDataLoaded ile hydrate etmeli');
  const oldOrders = body.indexOf('const oldOrders');
  assert.ok(oldOrders > hydrate, 'eski sipariş listesi hydrate SONRASI okunmalı');
  assert.match(body.slice(0, hydrate), /!\w+\.loadedAt\s*\|\|\s*!Array\.isArray\(\w+\.asasOrders\)/,
    'yalnız runtime soğukken hydrate edilmeli; sıcak runtime snapshot ile ezilmemeli');
});

test('detay paneli: kapandıktan sonra gelen arama input olayı null active ile çökmez', () => {
  const handler = DRAWER.slice(DRAWER.indexOf("querySelector('[data-bl-detail-search]')?.addEventListener('input'"));
  const firstLines = handler.slice(0, handler.indexOf('active.search='));
  assert.match(firstLines, /if\(!active\)return;/);
});
