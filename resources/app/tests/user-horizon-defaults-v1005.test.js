'use strict';

/* v1005 — KULLANICI HORIZON YÖNETİMİ.
 *
 * v7.81'de bu ekranın ön ayar bölümü KALDIRILDI (kullanıcı kararı). Ön ayar,
 * kullanıcının MAG/MMYG/Buying Group profiline göre ona görünmeyen bir ufuk
 * atıyor ve Veri Yönetimi'ndeki ortak filtreyi sessizce eziyordu: kullanıcı
 * ortak filtreyi değiştirip ekranında hiçbir şeyin değişmediğini görüyordu.
 *
 * Geriye yöneticinin anlamlı tek eylemi kaldı: bir kullanıcının kişisel
 * ufkunu sıfırlayıp onu ortak filtreye döndürmek. Aşağıdaki testler hem o
 * eylemin durduğunu hem de ön ayarın gerçekten gittiğini kilitler —
 * yarım kalmış bir kaldırma, çalışmayan düğmeler bırakırdı.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const USER_MANAGEMENT = fs.readFileSync(path.join(ROOT, 'public', 'user-management.js'), 'utf8');
const SERVER = require('./helpers/server-source')();

test('v1005 user Horizon administration exposes every source-driven screen', () => {
  assert.match(USER_MANAGEMENT, /const HORIZON_MODULES = \[/);
  assert.match(USER_MANAGEMENT, /\['priceanalysis',/);
});

test('v7.81 ön ayar yönetimi ekrandan tamamen kalkar', () => {
  // Çalışmayan bir düğme bırakmak, kullanıcının onu denemesi demektir.
  assert.doesNotMatch(USER_MANAGEMENT, /data-act="horizonCreatePreset"/);
  assert.doesNotMatch(USER_MANAGEMENT, /data-act="horizonApply"/);
  assert.doesNotMatch(USER_MANAGEMENT, /openHorizonPresetCreateDialog/);
  assert.doesNotMatch(USER_MANAGEMENT, /horizonPresetId/);
  assert.doesNotMatch(USER_MANAGEMENT, /data-um-horizonpreset/);
});

test('v7.81 ön ayar uçları sunucudan kalkar ve modül silinir', () => {
  /* Uç kalsaydı istemci 200 alıp özelliğin çalıştığını sanardı; modül kalsaydı
     bir sonraki okuyucu var olmayan bir özelliği anlatan kod bulurdu. */
  assert.doesNotMatch(SERVER, /app\.(get|put)\('\/api\/horizon-presets'/);
  assert.doesNotMatch(SERVER, /app\.(get|put)\('\/api\/horizon-groups'/);
  assert.equal(fs.existsSync(path.join(ROOT, 'server', 'lib', 'horizon-presets.js')), false);
});

test('v7.81 kişisel ufku sıfırlama yolu DURUYOR', () => {
  // Kaldırma, yöneticinin kullanıcıyı ortak filtreye döndürme yolunu almamalı.
  assert.match(USER_MANAGEMENT, /data-act="horizonReset"/);
  assert.match(USER_MANAGEMENT, /\/horizon\/reset/);
  assert.match(SERVER, /app\.post\('\/api\/iam\/users\/:id\/horizon\/reset'/);
});
