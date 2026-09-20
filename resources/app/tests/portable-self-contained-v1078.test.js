'use strict';
/*
 * PAKETIN KENDI KENDINE YETMESI — v7.78
 *
 * Gercek olay: kullanici portable klasoru is bilgisayarina kopyalayip
 * calistiracak. sync-settings.json icindeki `localDbPath` MUTLAK bir yol
 * tasiyor ve server.js:127'de BUYER_LOG_LOCAL_DB ortam degiskenini EZIYOR:
 *
 *     const configuredLocalDbPath =
 *       path.resolve(configuredSync.localDbPath || localDb.getFile());
 *     if (configuredLocalDbPath !== path.resolve(localDb.getFile()))
 *       localDb.setFolder(path.dirname(configuredLocalDbPath));
 *
 * Dokunmazsak iki kotu sonuc dogar:
 *   1. Klasoru kopyalayinca veritabani GELMEZ (paket kendi kendine yetmez).
 *   2. O yol hedef bilgisayarda yoksa uygulama oraya BOS bir veritabani acar
 *      ve desktop-migration.json "tamamlandi" dedigi icin hedefteki gercek
 *      veri hic tasinmaz -> ekranda veri kaybi.
 *
 * Iki savunma test ediliyor:
 *   rebasePortableSettings : tasimadan hemen sonra kosulsuz portable koke ceker
 *   healPortableSettings   : HER acilista, ama YALNIZ dis yol yoksa duzeltir
 *
 * healPortableSettings'in "dis yol varsa dokunma" kurali kasitlidir: orada
 * gercek veri olabilir, portable kopya eski olabilir. Sessizce eskiye donmek
 * de bir veri kaybidir.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const migration = require('../electron/first-run-migration');
const portablePaths = require('../electron/portable-paths');

function tempKok() {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-portable-'));
  const paths = portablePaths.desktopPaths(kok);
  fs.mkdirSync(paths.localDataRoot, { recursive: true });
  return { kok, paths };
}
const ayarYaz = (paths, deger) => {
  const f = path.join(paths.localDataRoot, 'sync-settings.json');
  fs.writeFileSync(f, JSON.stringify(deger, null, 2), 'utf8');
  return f;
};
const ayarOku = paths =>
  JSON.parse(fs.readFileSync(path.join(paths.localDataRoot, 'sync-settings.json'), 'utf8'));
const sessiz = () => {};

test('taşıma sonrası localDbPath koşulsuz portable köke çekilir — paket kendi kendine yetmeli', () => {
  const { paths } = tempKok();
  const yabanci = path.join(os.tmpdir(), 'BuyerLogYabanci', 'BuyerLogLocal.db');
  ayarYaz(paths, { localDbPath: yabanci, sharedSyncRoot: '\\\\sunucu\\paylasim', syncPeriodMinutes: 10 });

  const sonuc = migration.rebasePortableSettings(paths, sessiz);

  assert.equal(sonuc.changed, true);
  assert.equal(ayarOku(paths).localDbPath, path.resolve(paths.localDbPath));
});

test('taşıma sharedSyncRoot\'a DOKUNMAZ — ağ paylaşımı portable kökün içinde olmaz', () => {
  const { paths } = tempKok();
  const paylasim = '\\\\sunucu\\BuyerLog\\SYNC';
  ayarYaz(paths, { localDbPath: path.join(os.tmpdir(), 'x', 'BuyerLogLocal.db'), sharedSyncRoot: paylasim });

  migration.rebasePortableSettings(paths, sessiz);

  assert.equal(ayarOku(paths).sharedSyncRoot, paylasim);
});

test('zaten portable kökü gösteren ayar gereksiz yere yeniden yazılmaz', () => {
  const { paths } = tempKok();
  ayarYaz(paths, { localDbPath: path.resolve(paths.localDbPath) });

  assert.equal(migration.rebasePortableSettings(paths, sessiz).changed, false);
  assert.equal(migration.healPortableSettings(paths, sessiz).changed, false);
});

test('kopyalanan klasör: dış yol o bilgisayarda YOKSA portable köke çekilir (boş DB yaratılmaz)', () => {
  const { paths } = tempKok();
  const yabanci = path.join(os.tmpdir(), 'bl-olmayan-' + Date.now(), 'BuyerLogLocal.db');
  assert.ok(!fs.existsSync(yabanci), 'test kurulumu: yol gerçekten olmamalı');
  ayarYaz(paths, { localDbPath: yabanci });

  const sonuc = migration.healPortableSettings(paths, sessiz);

  assert.equal(sonuc.changed, true);
  assert.equal(sonuc.reason, 'foreign-path-missing');
  assert.equal(ayarOku(paths).localDbPath, path.resolve(paths.localDbPath));
});

test('dış yol VARSA ayara dokunulmaz — orada gerçek veri olabilir, sessizce eskiye dönmek de kayıptır', () => {
  const { paths } = tempKok();
  const klasor = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-canli-'));
  const yabanci = path.join(klasor, 'BuyerLogLocal.db');
  fs.writeFileSync(yabanci, 'x'.repeat(4096));
  ayarYaz(paths, { localDbPath: yabanci });

  const sonuc = migration.healPortableSettings(paths, sessiz);

  assert.equal(sonuc.changed, false);
  assert.equal(sonuc.reason, 'foreign-path-exists');
  assert.equal(ayarOku(paths).localDbPath, yabanci, 'var olan veriden uzaklaşılmamalı');
});

test('portable kökün İÇİNDEKİ farklı bir yol yabancı sayılmaz', () => {
  const { paths } = tempKok();
  const icerde = path.join(paths.dataRoot, 'local', 'alt', 'BuyerLogLocal.db');
  ayarYaz(paths, { localDbPath: icerde });

  assert.equal(migration.healPortableSettings(paths, sessiz).changed, false);
});

test('bozuk veya eksik sync-settings.json açılışı düşürmez', () => {
  const { paths } = tempKok();
  assert.equal(migration.healPortableSettings(paths, sessiz).changed, false); // dosya yok

  fs.writeFileSync(path.join(paths.localDataRoot, 'sync-settings.json'), '{bozuk', 'utf8');
  assert.equal(migration.healPortableSettings(paths, sessiz).changed, false);
  assert.equal(migration.rebasePortableSettings(paths, sessiz).changed, false);
});
