'use strict';

/* VERİ EŞLEŞTİRME KURALLARI (v7.82) — ASAS↔IAS ikilisinin genellenmesi.
 *
 * Korunan karar: eşleştirme kuralı artık iki sabit tarafa değil, her biri BİR
 * KAYNAĞA bağlı operandlara yazılır. Bu dosya üç şeyi birlikte tutar:
 *
 *   1) Eski (v1) ASAS/IAS kayıtları YENİDEN OLUŞTURULMADAN yüklenmeli ve
 *      birebir aynı eşleşmeyi üretmeli.
 *   2) Alan ekleme/çıkarma kalıcı olmalı ve eşleşmeye gerçekten katılmalı.
 *   3) Üçüncü bir kaynak, kaynağa özgü bir kod dalı olmadan katılabilmeli.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const parse = require(path.join(ROOT, 'server', 'lib', 'parse.js'));

const LEGACY_V1 = {
  version: 1,
  conditions: [
    { id: 'ocode', asas: { header: 'Sipariş Kod', canonicalHeader: 'Sipariş Kod', table: '', name: '', kind: 'column' }, ias: { header: 'Sipariş Kod', canonicalHeader: 'Sipariş Kod', table: '', name: '', kind: 'column' } },
    { id: 'model', asas: { header: 'Model Adı', canonicalHeader: 'Model Adı', table: '', name: '', kind: 'column' }, ias: { header: 'Ürün Ad', canonicalHeader: 'Ürün Ad', table: '', name: '', kind: 'column' } },
    { id: 'ccode', asas: { header: 'Renk Kod', canonicalHeader: 'Renk Kod', table: '', name: '', kind: 'column' }, ias: { header: 'Renk Kod', canonicalHeader: 'Renk Kod', table: '', name: '', kind: 'column' } },
  ],
};

function asasRow(overrides = {}) {
  return {
    'Sipariş Kod': 'A', 'Model Adı': 'MODEL-1', 'Renk Kod': 'C01', 'Renk': 'SİYAH',
    'Net Alım Sipariş Miktarı': 100, 'FOB Fiyatı': 5, 'Üretici': 'SUPPLIER', 'Sezon': 'W6',
    'Orijinal Exfactory Merch Tarih': '2026-09-01',
    ...overrides,
  };
}
function iasRow(overrides = {}) {
  return {
    'Sipariş Kod': 'A', 'Ürün Adı': 'MODEL-1', 'Renk Kod': 'C01', 'Renk Tanım': 'SİYAH',
    'Supplier Portal Statü': 'Depoda', 'Tahmini Antrepo Giriş Tarihi': '2026-09-10',
    'Yükleme Toplam Adet': 100,
    ...overrides,
  };
}

test('eski ASAS↔IAS kaydı yeniden oluşturulmadan yüklenir ve varsayılan kalır', () => {
  const config = parse.normalizeAntrepoMatchConfig(LEGACY_V1);
  assert.strictEqual(config.version, 2);
  assert.strictEqual(config.conditions.length, 3);
  // Eski gövde operanda taşındı; roller ve mantıksal kaynak kimlikleri kuruldu.
  assert.deepStrictEqual(config.conditions[0].operands.map(o => o.role), ['asas', 'antrepo']);
  assert.deepStrictEqual(config.conditions[0].operands.map(o => o.sourceId), ['asas', 'ias']);
  // Davranış birebir aynı: bu kural hâlâ sistemin varsayılanı sayılır.
  assert.strictEqual(parse.isDefaultAntrepoMatchConfig(config), true);
  assert.strictEqual(
    parse.antrepoMatchConfigSignature(config),
    parse.antrepoMatchConfigSignature(parse.defaultAntrepoMatchConfig()));
});

test('eski kayıt üzerinden eşleşme değişmeden çalışır', () => {
  const orders = parse.parseASASRows([asasRow()], LEGACY_V1).orders;
  const map = parse.parseAntrepoRows([iasRow()], LEGACY_V1);
  const hit = parse.findAntrepoHit(map, orders[0], { config: LEGACY_V1 });
  assert.ok(hit);
  assert.strictEqual(hit.statu, 'Depoda');
  assert.strictEqual(hit._matchLevel, 'line');
});

test('alan eklemek eşleşmeye gerçekten katılır; çıkarmak geri alır', () => {
  const withColour = {
    version: 2,
    conditions: [
      ...LEGACY_V1.conditions,
      {
        id: 'colour',
        operands: [
          { sourceId: 'asas', role: 'asas', header: 'Renk' },
          { sourceId: 'ias', role: 'antrepo', header: 'Renk Tanım' },
        ],
      },
    ],
  };
  const orders = parse.parseASASRows([asasRow()], withColour).orders;
  assert.ok(parse.findAntrepoHit(parse.parseAntrepoRows([iasRow()], withColour), orders[0], { config: withColour }));

  // Eklenen alan AYIRT EDİCİDİR: farklı renk tanımı artık eşleşmez.
  const otherColour = parse.parseAntrepoRows([iasRow({ 'Renk Tanım': 'LACİVERT' })], withColour);
  assert.strictEqual(parse.findAntrepoHit(otherColour, orders[0], { config: withColour }), null);

  // Alan çıkarılınca aynı satır yeniden eşleşir.
  const withoutColour = { version: 2, conditions: LEGACY_V1.conditions };
  const baseOrders = parse.parseASASRows([asasRow()], withoutColour).orders;
  const relaxed = parse.parseAntrepoRows([iasRow({ 'Renk Tanım': 'LACİVERT' })], withoutColour);
  assert.ok(parse.findAntrepoHit(relaxed, baseOrders[0], { config: withoutColour }));
});

test('üçüncü kaynak kendi kimliğiyle katılır ve kaynağa özgü dal gerektirmez', () => {
  const threeSources = {
    version: 2,
    sources: [
      { id: 'asas-db', role: 'asas', profileId: 'asas-orders', label: 'ASAS' },
      { id: 'ias-db', role: 'antrepo', profileId: 'ias-warehouse', label: 'IAS' },
      { id: 'plm-db', role: 'plm', profileId: 'plm', label: 'PLM' },
    ],
    conditions: [
      {
        id: 'line',
        operands: [
          { sourceId: 'asas-db', role: 'asas', table: 'Orders', name: 'Line Key', header: 'Line Key' },
          { sourceId: 'ias-db', role: 'antrepo', table: 'IAS', name: 'Line Ref', header: 'Line Ref' },
          { sourceId: 'plm-db', role: 'plm', table: 'PLM', name: 'Line Ref', header: 'Line Ref' },
        ],
      },
    ],
  };
  const config = parse.normalizeAntrepoMatchConfig(threeSources);
  assert.strictEqual(config.conditions[0].operands.length, 3);
  assert.deepStrictEqual(config.sources.map(source => source.id), ['asas-db', 'ias-db', 'plm-db']);
  // Üçüncü kaynak kayıptan KORUNUR ama sipariş↔antrepo birleştirmesinde kısıt
  // üretmez: o ikili yalnız kendi operandlarıyla kurulur.
  assert.strictEqual(parse.matchConditionsForPair(config, 'asas', 'antrepo').length, 1);
  const orders = parse.parseASASRows([asasRow({ '__MATCH_line': 'KEY-01' })], config).orders;
  const map = parse.parseAntrepoRows([iasRow({ '__MATCH_line': 'KEY-01' })], config);
  assert.strictEqual(parse.findAntrepoHit(map, orders[0], { config }).statu, 'Depoda');
});

test('bu ikiliyi hiç kısıtlamayan kural HİÇBİR ŞEYİ eşleştirmez', () => {
  /* Koşulsuz bir birleştirme her antrepo satırını her siparişe bağlardı.
     Kural başka bir kaynak çiftine aitse anahtar boş kalır ve eşleşme kurulmaz. */
  const foreign = parse.normalizeAntrepoMatchConfig({
    version: 2,
    conditions: [{
      id: 'elsewhere',
      operands: [
        { sourceId: 'plm-db', role: 'plm', name: 'Key', header: 'Key' },
        { sourceId: 'erp-db', role: 'erp', name: 'Key', header: 'Key' },
      ],
    }],
  });
  assert.strictEqual(parse.matchConditionsForPair(foreign, 'asas', 'antrepo').length, 0);
  assert.strictEqual(parse.dynamicAntrepoMatchKey({ ocode: 'A', model: 'M', ccode: 'C' }, 'asas', foreign), '');
  const map = parse.parseAntrepoRows([iasRow()], LEGACY_V1);
  assert.strictEqual(parse.findAntrepoHit(map, { ocode: 'A', model: 'MODEL-1', ccode: 'C01' }, { config: foreign }), null);
});

test('tek operandlı koşul kurala giremez', () => {
  const config = parse.normalizeAntrepoMatchConfig({
    version: 2,
    conditions: [{ id: 'lonely', operands: [{ sourceId: 'asas', role: 'asas', header: 'Sipariş Kod' }] }],
  });
  // Geçerli koşul kalmadığı için güvenli varsayılana dönülür; kural boş kalmaz.
  assert.strictEqual(parse.isDefaultAntrepoMatchConfig(config), true);
});

test('aynı kaynak bir koşulda iki kez yer alamaz', () => {
  const config = parse.normalizeAntrepoMatchConfig({
    version: 2,
    conditions: [{
      id: 'self',
      operands: [
        { sourceId: 'asas', role: 'asas', header: 'Sipariş Kod' },
        { sourceId: 'asas', role: 'asas', header: 'Renk Kod' },
        { sourceId: 'ias', role: 'antrepo', header: 'Sipariş Kod' },
      ],
    }],
  });
  assert.deepStrictEqual(config.conditions[0].operands.map(o => o.sourceId), ['asas', 'ias']);
});

test('çözülemeyen alan sayılabilir ve denetimde görünür', () => {
  const broken = parse.normalizeAntrepoMatchConfig({
    version: 2,
    conditions: [{
      id: 'ocode',
      operands: [
        { sourceId: 'asas', role: 'asas', header: 'Sipariş Kod' },
        { sourceId: 'ias', role: 'antrepo', header: 'Kaybolan Sütun', unresolved: 'column' },
      ],
    }],
  });
  const unresolved = parse.unresolvedMatchOperands(broken);
  assert.strictEqual(unresolved.length, 1);
  assert.strictEqual(unresolved[0].reason, 'column');
  assert.strictEqual(unresolved[0].label, 'Kaybolan Sütun');
  const audit = parse.auditAntrepoMatching([], {}, broken);
  assert.strictEqual(audit.unresolved.length, 1);
});

test('sunucu kaynak kataloğu ve doğrulaması kaynak adına GÖMÜLÜ değildir', () => {
  const server = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
  const start = server.indexOf('function matchRuleSourceCatalog(');
  const end = server.indexOf("app.get('/api/match-audit'", start);
  assert.ok(start > 0 && end > start, 'eşleştirme bloğu bulunamadı');
  const block = server.slice(start, end);
  // Katalog profillerden üretilir; üçüncü bir kaynak için kod dalı yazılmaz.
  assert.match(block, /dataManagementSourceProfiles\.fromLegacyRole/);
  assert.doesNotMatch(block, /source3|thirdDatabase|üçüncü bağlantı/i);
  // Çözülemeyen alan REDDEDİLİR; benzerine kaymaz.
  assert.match(block, /MATCH_COLUMN_UNRESOLVED/);
  assert.match(block, /MATCH_CONDITION_DUPLICATE/);
});

test('düzenleyici alan ekleme/çıkarma ve kaynak seçimini sunar', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'public', 'data-management-matchrule.js'), 'utf8');
  assert.match(ui, /data-add-operand/, 'koşula alan eklenebilmeli');
  assert.match(ui, /data-drop-operand/, 'koşuldan alan çıkarılabilmeli');
  assert.match(ui, /data-source=/, 'operandın veri kaynağı seçilebilmeli');
  assert.match(ui, /state\.sources/, 'kaynak listesi sunucudan gelmeli');
  assert.match(ui, /fullSource=/, 'database sütun seçimi seçilen kaynağın canlı şemasını istemeli');
  assert.match(ui, /ensureDatabaseColumns/, 'tam database şeması seçim anında lazy yüklenmeli');
  /* Yorumlar ELENİR: açıklama metni ASAS/IAS'ı anlatabilir, kodun kendisi
     kaynak adına dallanmamalı. */
  const code = ui.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(code, /sideEntries|condition\.asas|condition\.ias/);
  assert.doesNotMatch(code, /'ASAS sütunu'|'IAS sütunu'/);
});
