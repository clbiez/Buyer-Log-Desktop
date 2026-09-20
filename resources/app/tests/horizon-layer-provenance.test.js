'use strict';

/* v7.81 — FİLTRE HANGİ KATMANDAN GELİYOR?
 *
 * Korunan kusur: bir modülün ufku beş ayrı yerden gelebiliyordu ve ekran
 * hangisinin kazandığını söylemiyordu. Kullanıcı ortak ayarı değiştiriyor,
 * ekranında hiçbir şey değişmiyordu — çünkü kendi kişisel ayarı üstteydi.
 * Sessiz ve açıklaması olmayan bir davranış.
 *
 * v7.81 İKİNCİ ADIM: 'preset' ve 'group' katmanları KALDIRILDI (kullanıcı
 * kararı). İkisi de kullanıcının hiç görmediği katmanlardı; katmanı
 * raporlamak sorunu görünür kılıyordu ama çözmüyordu. Geriye kullanıcının
 * kendi ayarı, rolünün şablonu ve kaynağın ortak filtresi kaldı — üçü de
 * Veri Yönetimi ekranından görülebiliyor.
 *
 * Buradaki asıl güvence, katman bilgisinin İKİNCİ bir çözümleme yazılarak
 * üretilmemesi. İkinci uygulama er geç asıldan sapar ve ekran yanlış katmanı
 * gösterir. Bu yüzden her senaryoda resolveHorizonProvenance().horizon ile
 * resolveHorizon() değerinin AYNI olduğu ayrıca sınanır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-layer-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server-data');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app-data');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local-data');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');

const prefs = require('../server/lib/user-preferences');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

let seq = 0;
const newUser = () => `layer-user-${++seq}`;

function horizonOf(table, values) {
  return {
    table,
    groups: [{ id: 'g', conditions: [{ id: 'c', table, field: 'Sezon', op: 'in', valueType: 'text', values }] }],
  };
}
const SOURCE = horizonOf('ASAS', ['W6']);

/* Her senaryoda İKİ şey sınanır: doğru katman VE eski API ile aynı değer. */
function check(userId, moduleName, expectedLayer, context = {}, roleEntries = null) {
  const provenance = prefs.resolveHorizonProvenance(userId, moduleName, SOURCE, context, roleEntries);
  const plain = prefs.resolveHorizon(userId, moduleName, SOURCE, context, roleEntries);
  assert.deepEqual(provenance.horizon, plain, 'katman çözümlemesi değeri değiştirmemeli');
  assert.equal(provenance.layer, expectedLayer);
  return provenance;
}

/* ------------------------------------------------------------------ */

test('v7.81 hiç tercih yoksa kaynağın kendi ufku geçerlidir', () => {
  const user = newUser();
  const result = check(user, 'cp', 'source');
  assert.deepEqual(result.horizon, SOURCE);
});

test('v7.81 kişisel ayar en üstte kalır ve öyle raporlanır', () => {
  const user = newUser();
  prefs.saveHorizon(user, 'cp', horizonOf('ASAS', ['S7']));
  const result = check(user, 'cp', 'personal');
  assert.deepEqual(result.horizon.groups[0].conditions[0].values, ['S7']);
});

test('v7.81 modüle özel ayar yoksa kişisel varsayılana düşer', () => {
  const user = newUser();
  prefs.saveHorizon(user, 'default', horizonOf('ASAS', ['S8']));
  const result = check(user, 'cp', 'personalDefault');
  assert.deepEqual(result.horizon.groups[0].conditions[0].values, ['S8']);
});

test('v7.81 kişisel ayar yoksa rol şablonu kazanır', () => {
  const user = newUser();
  const roleEntries = { [prefs.horizonKey('cp')]: JSON.stringify({ horizon: horizonOf('ASAS', ['W7']) }) };
  const result = check(user, 'cp', 'roleTemplate', {}, roleEntries);
  assert.deepEqual(result.horizon.groups[0].conditions[0].values, ['W7']);
});

test('v7.81 kişisel ayar rol şablonunu ezer — sessizce değil, raporlanarak', () => {
  const user = newUser();
  prefs.saveHorizon(user, 'cp', horizonOf('ASAS', ['S7']));
  const roleEntries = { [prefs.horizonKey('cp')]: JSON.stringify({ horizon: horizonOf('ASAS', ['W7']) }) };
  const result = check(user, 'cp', 'personal', {}, roleEntries);
  // Ekran bunu göstermeliydi: rol şablonu değişse de kullanıcı etkilenmez.
  assert.deepEqual(result.horizon.groups[0].conditions[0].values, ['S7']);
});

test('v7.81 hiçbir kayıt yoksa KAYNAĞIN ortak filtresi geçerlidir', () => {
  /* Eskiden burada profil (MAG/MMYG/Buying Group) eşleşmesine göre bir ön ayar
     devreye giriyordu. Kullanıcı o ayarı hiç seçmemişti ve ekranda göremiyordu;
     Veri Yönetimi'nden ortak filtreyi değiştirince de bir şey değişmiyordu.
     Ön ayar kaldırıldı: seçim yapmamış kullanıcı artık doğrudan ortak filtreyi
     görür ve onu değiştirmek ekranını gerçekten değiştirir. */
  const user = newUser();
  const result = check(user, 'cp', 'source');
  assert.deepEqual(result.horizon, SOURCE);
});

test('v7.81 ön ayar çözümleyicisi ARTIK KABUL EDİLMEZ', () => {
  /* Fazladan bir argüman sessizce yok sayılırsa, eski bir çağıran ön ayarın
     hâlâ çalıştığını sanabilir. Katman listesinde de yeri kalmamalı. */
  // Function.length varsayılanlı parametrelerden önceki sayıyı verir.
  assert.equal(prefs.resolveHorizon.length, 3);
  assert.equal(prefs.resolveHorizonProvenance.length, 3);
  assert.ok(!prefs.HORIZON_LAYERS.includes('preset'));
  assert.ok(!prefs.HORIZON_LAYERS.includes('group'));
  assert.equal(typeof prefs.getHorizonGroups, 'undefined');
  assert.equal(typeof prefs.saveHorizonGroups, 'undefined');
});

test('v7.81 gruba bağlı ESKİ kayıt kendi ufkuyla çalışmaya devam eder', () => {
  /* Horizon grupları kaldırıldı ama kullanıcıların diskindeki kayıtlar duruyor.
     Bir gruba bağlı eski kayıt sessizce BOŞ ufka düşmemeli: kendi içinde bir
     ufuk varsa o geçerlidir. Aksi hâlde özelliği kaldırmak, o kullanıcının
     filtresini de kaldırmak olurdu. */
  const user = newUser();
  prefs.saveHorizon(user, 'cp', horizonOf('ASAS', ['S7']), { linkedGroupId: 'grp-lic' });
  const result = check(user, 'cp', 'personal');
  assert.deepEqual(result.horizon.groups[0].conditions[0].values, ['S7']);
});

test('v7.81 linkedGroupId ARTIK KAYDA YAZILMAZ', () => {
  // Hiçbir şeyin okumadığı bir işaret bırakmak, sonraki okuyucuyu yanıltır.
  const user = newUser();
  prefs.saveHorizon(user, 'cp', horizonOf('ASAS', ['S7']), { linkedGroupId: 'grp-lic' });
  const stored = prefs.getHorizon(user, 'cp');
  assert.equal(stored.linkedGroupId, undefined);
});

test('v7.81 içi boş bir tercih kaydı kaynağın ufkunu geçersiz kılmaz', () => {
  const user = newUser();
  prefs.saveHorizon(user, 'cp', {});
  const result = check(user, 'cp', 'source');
  assert.deepEqual(result.horizon, SOURCE);
});

test('v7.81 katman adları kapalı bir listedir', () => {
  const user = newUser();
  prefs.saveHorizon(user, 'cp', horizonOf('ASAS', ['S7']));
  const result = prefs.resolveHorizonProvenance(user, 'cp', SOURCE);
  assert.ok(prefs.HORIZON_LAYERS.includes(result.layer), `bilinmeyen katman: ${result.layer}`);
});

test('v7.81 bağlantıya özel kişisel ufuk doğru bağlantıda uygulanır', () => {
  const user = newUser();
  prefs.saveHorizon(user, 'cp', horizonOf('ASAS', ['S9']), { connectionId: 'mc_asas' });
  // Kayıt byConnection altında tutulur; başka bağlantıda geçerli olmamalı.
  const mine = check(user, 'cp', 'personal', { connectionId: 'mc_asas' });
  assert.deepEqual(mine.horizon.groups[0].conditions[0].values, ['S9']);
  const other = prefs.resolveHorizonProvenance(user, 'cp', SOURCE, { connectionId: 'mc_baska' });
  assert.deepEqual(other.horizon, prefs.resolveHorizon(user, 'cp', SOURCE, { connectionId: 'mc_baska' }));
});
