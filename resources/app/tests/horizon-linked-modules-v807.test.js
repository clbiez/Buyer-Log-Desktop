'use strict';

/* v807 — BAĞLI HORIZON MODÜLLERİ (Horizon Group).
 *
 * Bu dosya "Linked Horizon Group" özelliğini sınıyordu: kişisel bir ufku
 * adlandırıp birden çok modüle bağlamak. Özellik v7.81'de KULLANICI KARARIYLA
 * KALDIRILDI — kullanıcının Veri Yönetimi'nde göremediği bir katman olarak
 * ortak filtreyi eziyordu ve "filtreyi değiştirdim, hiçbir şey olmadı"
 * şikâyetinin kaynaklarından biriydi.
 *
 * Dosya silinmiyor: kaldırmanın GERÇEKTEN tamamlandığını kilitliyor. Yarım
 * kalmış bir kaldırma, tıklanınca çalışmayan düğmeler bırakırdı.
 *
 * Birlikte yenileme ihtiyacı ortadan kalkmadı; Veri Yönetimi'ndeki YENİLEME
 * GRUPLARI onu karşılıyor (tests/refresh-groups-v781.test.js) ve o ortak bir
 * tanımdır, kişisel bir gölge katman değil.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const PREFS = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'user-preferences.js'), 'utf8');

test('v7.81 bağlı Horizon modülleri arayüzü tamamen kalkar', () => {
  assert.doesNotMatch(APP, /data-hz-group-target/);
  assert.doesNotMatch(APP, /_hzGroupNew|_hzGroupRename|_hzGroupDelete|_hzGroupSelect|_hzGroupRefresh/);
  assert.doesNotMatch(APP, /horizonGroupSectionOpen|horizonGroupMode|selectedHorizonGroupId/);
  assert.doesNotMatch(APP, /renderHorizonGroupSection|saveHorizonGroupState|syncHorizonGroupDraft/);
});

test('v7.81 grup uçları ve depo yardımcıları kalkar', () => {
  // Uç kalsaydı eski bir istemci özelliğin hâlâ çalıştığını sanardı.
  assert.doesNotMatch(SERVER, /app\.(get|put)\('\/api\/horizon-groups'/);
  assert.doesNotMatch(PREFS, /function (get|save)HorizonGroups/);
});

test('v7.81 gruba bağlı ESKİ kayıtlar okunmaya devam eder, veri silinmez', () => {
  /* Özelliği kaldırmak, kullanıcının diskindeki ufku silmek DEĞİLDİR.
     linkedGroupId artık çözümlenmez ama kaydın kendi ufku geçerli kalır;
     ayrıntılı davranış horizon-layer-provenance testlerinde kilitli. */
  assert.match(PREFS, /linkedGroupId ARTIK ÇÖZÜMLENMEZ/);
  assert.doesNotMatch(PREFS, /value\.linkedGroupId = linkedGroupId/);
});
