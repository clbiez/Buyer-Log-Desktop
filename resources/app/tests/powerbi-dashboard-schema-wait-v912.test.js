'use strict';
/* v9.12 — Antrepo Source = Dashboard seçildiğinde veri çekilememesi.

   BELİRTİ (kullanıcı günlüğünden, aynı gün iki çalıştırma):
     PowerBiDashboardError: Dashboard IAS/Antrepo yenilemesi başlatılamadı.
     Eksik alanlar: Sipariş Kod, Model Adı, Renk Kod, Supplier Portal Statü,
                    Tahmini Antrepo Giriş Tarihi, İthalat Dosya No.
     ... ve ikinci çalıştırmada listede "Yükleme Toplam Adet" de vardı.

   KÖK NEDEN: Power BI rapor sayfası HER GÖRSEL için ayrı bir querydata isteği
   atar; her yanıt yalnız o görselin kolonlarını taşır ve şema bu yanıtlardan
   biriktirilir. agent-browser-connector'daki bekleme döngüsü ise

       while (... && (!templates.length || !schema.length)) await sleep(200);

   koşuluyla İLK yanıt gelir gelmez çıkıyordu. Şema tek bir görselin
   kolonlarından ibaret kalıyor, doğrulama da haklı olarak patlıyordu.
   Eksik alan listesinin her çalıştırmada değişmesi de bundandı: hangi görselin
   önce döndüğü ağ zamanlamasına bağlı.

   Bu dosya kararı (powerBiSchemaWaitDecision) GERÇEKTEN çalıştırarak sınar. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dashboard = require(path.join(root, 'server/lib/power-bi-import-dashboard.js'));
const connector = require(path.join(root, 'server/lib/agent-browser-connector.js'));
const CONNECTOR_SRC = fs.readFileSync(path.join(root, 'server/lib/agent-browser-connector.js'), 'utf8');

const { powerBiSchemaWaitDecision, POWERBI_SCHEMA_QUIET_MS } = connector;

/* Gerçek Power BI kolon adları tablo önekiyle gelir (ör.
   "Siparis Bilgileri.Sipariş Kod") — testler bu biçimi kullanır. */
const VISUAL_A = ['Siparis Bilgileri.Sipariş Kod', 'Ithalat.Model Adı', 'Siparis Bilgileri.Renk Tanım'];
const VISUAL_B = ['Ithalat.Supplier Portal Statü', 'Ithalat.Tahmini Antrepo Giriş Tarihi'];
const VISUAL_C = ['Ithalat.Yükleme Toplam Adet', 'Dim_Ithalat.İthalat Dosya No'];
const FULL = [...VISUAL_A, ...VISUAL_B, ...VISUAL_C];

test('tam şema Antrepo için yeterli sayılır', () => {
  assert.deepEqual(dashboard.dashboardSchemaMissingFields(FULL, { sourceMode: 'dashboard' }).missing, []);
  assert.deepEqual(dashboard.validateDashboardSchema(FULL, { sourceMode: 'dashboard' }), { ok: true, columns: FULL });
});

test('dashboardSchemaMissingFields ile validateDashboardSchema aynı listeyi üretir', () => {
  const partial = [...VISUAL_A];
  const { missing } = dashboard.dashboardSchemaMissingFields(partial, { sourceMode: 'dashboard' });
  assert.ok(missing.length);
  assert.throws(
    () => dashboard.validateDashboardSchema(partial, { sourceMode: 'dashboard' }),
    error => {
      assert.equal(error.code, 'POWERBI_DASHBOARD_SCHEMA_INVALID');
      assert.deepEqual(error.details.missing, missing); // tek doğruluk kaynağı
      return true;
    });
});

/* ---- kök neden: bekleme kararı ---- */

test('REGRESYON: ilk görselin yanıtı geldi diye "hazır" denmez', () => {
  // Eski kod burada döngüden çıkıp eksik şemayla doğrulamaya giderdi.
  assert.equal(powerBiSchemaWaitDecision({
    templates: 1, orderTemplates: 1, schema: VISUAL_A, pendingReads: 0, msSinceGrowth: 0,
  }), 'wait');
});

test('gerekli alanların TAMAMI toplanınca hazır olunur', () => {
  assert.equal(powerBiSchemaWaitDecision({
    templates: 1, orderTemplates: 1, schema: FULL, pendingReads: 0, msSinceGrowth: 0,
  }), 'ready');
});

test('görseller sırayla geldikçe karar wait → wait → ready ilerler', () => {
  const seen = [];
  let schema = [];
  for (const visual of [VISUAL_A, VISUAL_B, VISUAL_C]) {
    schema = [...new Set([...schema, ...visual])]; // connector ile aynı biriktirme
    seen.push(powerBiSchemaWaitDecision({ templates: 1, orderTemplates: 1, schema, pendingReads: 0, msSinceGrowth: 0 }));
  }
  assert.deepEqual(seen, ['wait', 'wait', 'ready']);
});

test('görsellerin GELİŞ SIRASI sonucu değiştirmez (eksik listesinin oynamasının sebebi buydu)', () => {
  const orders = [
    [VISUAL_A, VISUAL_B, VISUAL_C], [VISUAL_C, VISUAL_A, VISUAL_B],
    [VISUAL_B, VISUAL_C, VISUAL_A], [VISUAL_C, VISUAL_B, VISUAL_A],
  ];
  for (const order of orders) {
    let schema = [];
    const decisions = order.map(visual => {
      schema = [...new Set([...schema, ...visual])];
      return powerBiSchemaWaitDecision({ templates: 1, orderTemplates: 1, schema, pendingReads: 0, msSinceGrowth: 0 });
    });
    // Hangi sırayla gelirse gelsin: yalnız sonuncusunda hazır olunur.
    assert.deepEqual(decisions, ['wait', 'wait', 'ready'], `sıra: ${order.map(v => v[0]).join(' → ')}`);
  }
});

test('uçuşta okuma varken sessizlik penceresi dolsa bile pes edilmez', () => {
  assert.equal(powerBiSchemaWaitDecision({
    templates: 1, orderTemplates: 1, schema: VISUAL_A, pendingReads: 2, msSinceGrowth: POWERBI_SCHEMA_QUIET_MS + 5000,
  }), 'wait');
});

test('akış gerçekten durduysa "incomplete" ile çıkılır — sonsuza kadar beklenmez', () => {
  assert.equal(powerBiSchemaWaitDecision({
    templates: 1, orderTemplates: 1, schema: VISUAL_A, pendingReads: 0, msSinceGrowth: POWERBI_SCHEMA_QUIET_MS + 1,
  }), 'incomplete');
  // Ve bu durumda doğrulama, GERÇEKTEN eksik olanları bildirir.
  const { missing } = dashboard.dashboardSchemaMissingFields(VISUAL_A, { sourceMode: 'dashboard' });
  assert.ok(missing.includes('Supplier Portal Statü'));
  assert.ok(missing.includes('İthalat Dosya No'));
  assert.ok(!missing.includes('Sipariş Kod'), 'VISUAL_A sipariş kodunu zaten içeriyor');
});

test('querydata şablonu veya kolon henüz yokken beklenir', () => {
  assert.equal(powerBiSchemaWaitDecision({ templates: 0, orderTemplates: 0, schema: FULL, pendingReads: 0, msSinceGrowth: 99999 }), 'wait');
  assert.equal(powerBiSchemaWaitDecision({ templates: 1, orderTemplates: 1, schema: [], pendingReads: 0, msSinceGrowth: 99999 }), 'wait');
  assert.equal(powerBiSchemaWaitDecision(), 'wait');
});

/* ---- döngünün gerçekten bu kararı kullandığı ---- */

test('bekleme döngüsü artık "ilk yanıt" koşulunu kullanmıyor', () => {
  const start = CONNECTOR_SRC.indexOf('const deadline = Date.now() + POWERBI_SCHEMA_TIMEOUT_MS');
  const end = CONNECTOR_SRC.indexOf('const pageState = await powerBiPageState(page)', start);
  assert.ok(start >= 0 && end > start, 'bekleme döngüsü bulunamadı');
  const block = CONNECTOR_SRC.slice(start, end);
  // Hatalı eski koşul geri gelmemeli.
  assert.doesNotMatch(block, /!templates\.length \|\| !schema\.length/);
  assert.match(block, /powerBiSchemaWaitDecision\(\{/);
  assert.match(block, /if \(decision !== 'wait'\) break;/);
  // Uçuşta kalan okumalar şemayı büyütebilir; döngüden sonra beklenmeli.
  assert.match(block, /await Promise\.allSettled\(\[\.\.\.tasks\]\)/);
});

/* ===================================================================
   v9.12b — "Sipariş Kod alanı bulunamadı" (şema geçti, şablon yok)

   Şema düzeltmesinden sonra ortaya çıkan İKİNCİ duvar. Kanıt, sunucu
   tanılamasındaki iki satırın çelişkisiydi:
     POWERBI_QUERY_READY { templates: 4, schemaColumns: 80 }   → şema TAM
     PowerBiDashboardError: ...sorgu şablonunda Sipariş Kod bulunamadı

   Şema, yakalanan isteklerin YANITLARINDAN; şablon ise İSTEK GÖVDESİNDEN
   gelir. CDP, requestWillBeSent olayında büyük gövdeleri taşımaz —
   hasPostData:true der ve gövdeyi ayrıca istemenizi bekler. Sipariş Kod'u
   taşıyan görsel raporun en çok kolonlu (en büyük gövdeli) sorgusu olduğu
   için tam da o şablon eleniyor, yanıtı ise şemaya giriyordu.
   =================================================================== */

const powerBiTemplateHasOrderField = dashboard.powerBiTemplateHasOrderField;

// Gerçek Power BI querydata gövdesinin ilgili iskeleti.
const templateWithOrder = {
  queries: [{ Query: { Commands: [{ SemanticQueryDataShapeCommand: { Query: {
    Select: [
      { Column: { Expression: { SourceRef: { Source: 's' } }, Property: 'Sipariş Kod' }, Name: 'Siparis Bilgileri.Sipariş Kod' },
      { Column: { Expression: { SourceRef: { Source: 'i' } }, Property: 'Model Adı' }, Name: 'Ithalat.Model Adı' },
    ],
  } } }] } }],
};
const templateWithoutOrder = {
  queries: [{ Query: { Commands: [{ SemanticQueryDataShapeCommand: { Query: {
    Select: [
      { Column: { Expression: { SourceRef: { Source: 'i' } }, Property: 'Yükleme Toplam Adet' }, Name: 'Ithalat.Yükleme Toplam Adet' },
    ],
  } } }] } }],
};

test('Sipariş Kod taşıyan şablon tanınır, taşımayan tanınmaz', () => {
  assert.equal(powerBiTemplateHasOrderField(templateWithOrder), true);
  assert.equal(powerBiTemplateHasOrderField(templateWithoutOrder), false);
});

test('REGRESYON: şema TAM olsa bile kullanılabilir şablon yoksa hazır denmez', () => {
  // Kullanıcının yaşadığı durumun birebir kendisi: 80 kolonluk tam şema,
  // ama Sipariş Kod'a göre filtrelenebilecek şablon yok.
  assert.equal(powerBiSchemaWaitDecision({
    templates: 4, orderTemplates: 0, schema: FULL, pendingReads: 1, msSinceGrowth: 0,
  }), 'wait');
});

test('şema TAM ve kullanılabilir şablon geldiyse hazır olunur', () => {
  assert.equal(powerBiSchemaWaitDecision({
    templates: 4, orderTemplates: 1, schema: FULL, pendingReads: 0, msSinceGrowth: 0,
  }), 'ready');
});

test('şablon hiç gelmeyecekse sonsuza kadar beklenmez', () => {
  assert.equal(powerBiSchemaWaitDecision({
    templates: 4, orderTemplates: 0, schema: FULL, pendingReads: 0,
    msSinceGrowth: POWERBI_SCHEMA_QUIET_MS + 1,
  }), 'incomplete');
});

test('hata, görülen Select adlarını taşır — bir dahakine tahmin gerekmesin', () => {
  assert.throws(
    () => dashboard.buildPowerBiOrderQueryPayload(templateWithoutOrder, ['ABC123']),
    error => {
      assert.equal(error.code, 'POWERBI_DASHBOARD_ORDER_FIELD_MISSING');
      // selectNames artık öğenin TÜM adlarını taşır — tanılamada hangi adın
      // neden eşleşmediğini görebilmek için.
      assert.deepEqual(error.details.selectNames, ['Ithalat.Yükleme Toplam Adet | Yükleme Toplam Adet']);
      return true;
    });
});

test('şablon bulununca sorguya Sipariş Kod filtresi eklenir', () => {
  const body = dashboard.buildPowerBiOrderQueryPayload(templateWithOrder, ['ABC123', 'DEF456', 'ABC123']);
  const query = body.queries[0].Query.Commands[0].SemanticQueryDataShapeCommand.Query;
  assert.equal(query.Where.length, 1);
  const values = query.Where[0].Condition.In.Values;
  assert.deepEqual(values.map(v => v[0].Literal.Value), ["'ABC123'", "'DEF456'"]); // tekrar eden atılır
  // Şablonun kendisi bozulmamalı (clone edilerek çalışılır).
  assert.equal(templateWithOrder.queries[0].Query.Commands[0].SemanticQueryDataShapeCommand.Query.Where, undefined);
});

test('tırnak içeren sipariş kodu SQL benzeri kaçışla korunur', () => {
  const body = dashboard.buildPowerBiOrderQueryPayload(templateWithOrder, ["O'BRIEN"]);
  const query = body.queries[0].Query.Commands[0].SemanticQueryDataShapeCommand.Query;
  assert.equal(query.Where[0].Condition.In.Values[0][0].Literal.Value, "'O''BRIEN'");
});

test('CDP büyük gövdeleri ayrıca istenir — sessizce elenmez', () => {
  const start = CONNECTOR_SRC.indexOf('const requested = params =>');
  const end = CONNECTOR_SRC.indexOf('const response = params =>', start);
  assert.ok(start >= 0 && end > start);
  const block = CONNECTOR_SRC.slice(start, end);
  // Hatalı eski eleme geri gelmemeli.
  assert.doesNotMatch(block, /\|\| !request\.postData\) return;/);
  assert.match(block, /request\.hasPostData/);
  assert.match(block, /Network\.getRequestPostData/);
  // Bu okuma da bekleme döngüsünün saydığı işler arasında olmalı.
  assert.match(block, /tasks\.add\(task\)/);
});

/* ===================================================================
   v9.12c — GERÇEK KÖK NEDEN (canlı Power BI oturumundan ÖLÇÜLDÜ)

   Kullanıcının raporunda İTHALAT sayfası 4 querydata isteği atıyor; büyük
   tablo görselinin gövdesi ~24 KB ve 42 kolon taşıyor. O gövdedeki Sipariş
   Kod ögesi AYNEN şöyle:

     { "Column": { "Expression": { "SourceRef": { "Source": "s" } },
                   "Property": "Sipariş Kod" },
       "Name": "Sum(Siparis Bilgileri.Sipariş Kod)",
       "NativeReferenceName": "Sipariş Kod1" }

   Yani alan GERÇEK bir Column ve Property'si tam olarak "Sipariş Kod" —
   alias listesiyle birebir eşleşir. Ama eşleştirme adı seçerken
   `Name || QueryName || Property || Column.Property` zincirini kullanıyordu;
   Name dolu olduğu için ilk terimde kısa devre yapıp "Sum(...)" döndürüyor,
   bu da ne alias'a eşit ne de ".Sipariş Kod" ile bitiyordu (sonda parantez).

   Şema çıkarımı (semanticQueryColumns) zaten TÜM adları topladığı için şema
   doğrulaması geçiyordu. "templates:4, schemaColumns:80 ama Sipariş Kod
   bulunamadı" çelişkisinin sebebi tam olarak buydu.
   =================================================================== */

// Canlı trafikten alınan ÖLÇÜLMÜŞ öge — elle sadeleştirilmedi.
const REAL_ORDER_SELECT_ITEM = {
  Column: { Expression: { SourceRef: { Source: 's' } }, Property: 'Sipariş Kod' },
  Name: 'Sum(Siparis Bilgileri.Sipariş Kod)',
  NativeReferenceName: 'Sipariş Kod1',
};
const realTemplate = {
  queries: [{ Query: { Commands: [{ SemanticQueryDataShapeCommand: { Query: {
    Select: [
      { Column: { Expression: { SourceRef: { Source: 'i' } }, Property: 'Final Destination' }, Name: 'Ithalat.Final Destination' },
      REAL_ORDER_SELECT_ITEM,
    ],
  } } }] } }],
};

test('REGRESYON: Name "Sum(...)" ile süslenmişse bile Sipariş Kod tanınır', () => {
  // Eski davranış: tek ad seçilir ve "Sum(...)" hiçbir alias'a uymaz.
  assert.equal(dashboard.powerBiQueryColumnName(REAL_ORDER_SELECT_ITEM), 'Sum(Siparis Bilgileri.Sipariş Kod)');
  // Yeni davranış: tüm adlar denenir, Column.Property gerçek adı verir.
  assert.ok(dashboard.powerBiQueryColumnNames(REAL_ORDER_SELECT_ITEM).includes('Sipariş Kod'));
  assert.equal(dashboard.powerBiTemplateHasOrderField(realTemplate), true);
});

test('gerçek şablondan doğru Column ifadesiyle Where kurulur', () => {
  const body = dashboard.buildPowerBiOrderQueryPayload(realTemplate, ['SIP-1', 'SIP-2']);
  const query = body.queries[0].Query.Commands[0].SemanticQueryDataShapeCommand.Query;
  // Filtre, süslü Name'e değil GERÇEK kolona bağlanmalı — ve Power BI'nin
  // beklediği { Column: ... } sarmalayıcısıyla (bkz. v9.12d).
  assert.deepEqual(query.Where[0].Condition.In.Expressions[0], {
    Column: { Expression: { SourceRef: { Source: 's' } }, Property: 'Sipariş Kod' },
  });
  assert.deepEqual(query.Where[0].Condition.In.Values.map(v => v[0].Literal.Value), ["'SIP-1'", "'SIP-2'"]);
});

test('Aggregation ile sarılmış kolon da tanınır ve içindeki kolonla filtrelenir', () => {
  const item = { Aggregation: { Expression: { Column: { Expression: { SourceRef: { Source: 's' } }, Property: 'Sipariş Kod' } }, Function: 0 },
                 Name: 'Sum(Siparis Bilgileri.Sipariş Kod)' };
  assert.ok(dashboard.powerBiQueryColumnNames(item).includes('Sipariş Kod'));
  assert.deepEqual(dashboard.powerBiSelectColumn(item), { Expression: { SourceRef: { Source: 's' } }, Property: 'Sipariş Kod' });
});

test('ölçüm (Measure) Sipariş Kod sanılıp filtre kurulmaz', () => {
  const measureOnly = {
    queries: [{ Query: { Commands: [{ SemanticQueryDataShapeCommand: { Query: {
      Select: [{ Measure: { Expression: { SourceRef: { Source: 'i' } }, Property: 'Yükleme Toplam Adet' }, Name: 'Ithalat.Yükleme Toplam Adet' }],
    } } }] } }],
  };
  assert.equal(dashboard.powerBiTemplateHasOrderField(measureOnly), false);
});

test('gerçek sayfadaki DİĞER üç sorgu Sipariş Kod taşımaz — yanlış şablon seçilmez', () => {
  // İTHALAT sayfasından ölçülen diğer görsellerin ayırt edici alanları.
  for (const names of [['Ithalat.Final Destination'], ['Ithalat.Supplier Portal Statü'], ['Dim_Ithalat.Antrepo Firma']]) {
    const body = { queries: [{ Query: { Commands: [{ SemanticQueryDataShapeCommand: { Query: {
      Select: names.map(n => ({ Column: { Expression: { SourceRef: { Source: 'x' } }, Property: n.split('.')[1] }, Name: n })),
    } } }] } }] };
    assert.equal(dashboard.powerBiTemplateHasOrderField(body), false, names.join());
  }
});

/* ===================================================================
   v9.12d — HTTP 400 ve "tek tek arama" görüntüsü

   Canlı checkpoint'ten ÖLÇÜLEN durum:
     toplam sipariş : 7192
     işlenen        : 71   (hepsi FAILED)
     son parti boyu : 1        ← 250'lik parti 1'e kadar bölünmüş
     son parti hata : Power BI querydata HTTP 400

   Kök neden: In koşulundaki Expressions ögesi { Column: {...} } ile
   SARILMAMIŞTI. Power BI'nin kendi slicer'ının ürettiği filtre canlı olarak
   yakalandı ve sarmalayıcının zorunlu olduğu görüldü. HTTP 400 kalıcı bir
   hata olduğu hâlde splitOnFailure onu geçici sanıp partiyi 1'e kadar
   bölüyordu — kullanıcının "tek tek mi arıyorsun?" sorusunun kaynağı buydu.
   =================================================================== */

// Power BI'nin KENDİ slicer'ının ürettiği filtre — canlı oturumdan ölçüldü.
const POWERBI_OWN_FILTER = {
  Condition: { In: {
    Expressions: [{ Column: { Expression: { SourceRef: { Source: 's' } }, Property: 'Sipariş Kod' } }],
    Values: [[{ Literal: { Value: "'1265562'" } }], [{ Literal: { Value: "'1000000'" } }]],
  } },
};

test('REGRESYON: ürettiğimiz filtre Power BI\'nin kendi filtresiyle BİREBİR aynı', () => {
  const body = dashboard.buildPowerBiOrderQueryPayload(realTemplate, ['1265562', '1000000']);
  const where = body.queries[0].Query.Commands[0].SemanticQueryDataShapeCommand.Query.Where;
  assert.equal(where.length, 1);
  // Column sarmalayıcısı olmadan Power BI HTTP 400 döndürüyordu.
  assert.deepEqual(where[0], POWERBI_OWN_FILTER);
  assert.ok(where[0].Condition.In.Expressions[0].Column, 'Column sarmalayıcısı şart');
});

test('kodlar tamamen rakam olsa bile TIRNAKLI metin literali gönderilir', () => {
  // Ölçüldü: Power BI 1265562 gibi kodları da "'1265562'" olarak yolluyor.
  const body = dashboard.buildPowerBiOrderQueryPayload(realTemplate, ['1083193']);
  const value = body.queries[0].Query.Commands[0].SemanticQueryDataShapeCommand.Query
    .Where[0].Condition.In.Values[0][0].Literal.Value;
  assert.equal(value, "'1083193'");
});

test('çoklu arama gerçekten çoklu: tüm kodlar TEK In koşuluna girer', () => {
  const codes = Array.from({ length: 250 }, (_, i) => String(1000000 + i));
  const body = dashboard.buildPowerBiOrderQueryPayload(realTemplate, codes);
  const where = body.queries[0].Query.Commands[0].SemanticQueryDataShapeCommand.Query.Where;
  assert.equal(where.length, 1, 'sipariş başına ayrı koşul üretilmemeli');
  assert.equal(where[0].Condition.In.Values.length, 250);
});

test('parti boyutu: 7192 sipariş 250\'şerlik partilere bölünür, tek tek değil', () => {
  const codes = Array.from({ length: 7192 }, (_, i) => String(1000000 + i));
  const batches = dashboard.buildDashboardBatches(codes, 250);
  assert.equal(batches.length, 29);
  assert.equal(batches[0].length, 250);
});

test('kalıcı hatalar tekrar denenmez ve parti bölünmez', () => {
  // HTTP 4xx ve oturum hatası: istek küçültülse de aynı yanıt gelir.
  assert.ok(dashboard.PERMANENT_DASHBOARD_ERRORS.includes('POWERBI_DASHBOARD_QUERY_REJECTED'));
  assert.ok(dashboard.PERMANENT_DASHBOARD_ERRORS.includes('POWERBI_AUTH_REQUIRED'));
  assert.ok(dashboard.PERMANENT_DASHBOARD_ERRORS.includes('POWERBI_DASHBOARD_ORDER_FIELD_MISSING'));
});

test('bölme 1\'e kadar inebilir — bu KASITLI; çözüm kalıcı hataları ayırmakta', () => {
  /* "İstek gövdesi çok büyük" gibi hatalar YALNIZ parti küçülünce düzelir; bu
     kurtarma yeteneği korunmalı (bkz. power-bi-import-dashboard.test.js
     içindeki "adaptively splits a permanently failing batch"). Kullanıcının
     gördüğü "tek tek arıyor" davranışının sebebi bölme değil, kalıcı bir
     hatanın (HTTP 400) geçici sanılmasıydı. */
  const src = fs.readFileSync(path.join(root, 'server/lib/power-bi-import-dashboard.js'), 'utf8');
  assert.match(src, /this\.splitOnFailure && batch\.length > 1/);
  assert.match(src, /PERMANENT_DASHBOARD_ERRORS\.includes\(error\.code\)\) throw error/);
});

test('connector 4xx ile 5xx\'i ayırır (429 ve 408 geçici sayılır)', () => {
  // Node tarafındaki sınıflandırma bloğuna sabitlen (ilk geçtiği yer,
  // tarayıcıya enjekte edilen JS metnidir).
  const start = CONNECTOR_SRC.indexOf('if (value && value.__powerBiHttpError)');
  assert.ok(start >= 0, 'HTTP hatası sınıflandırması yok');
  const block = CONNECTOR_SRC.slice(start, start + 700);
  assert.match(block, /status >= 400 && status < 500 && status !== 408 && status !== 429/);
  assert.match(block, /POWERBI_DASHBOARD_QUERY_REJECTED/);
  // Artık ham Error fırlatılmıyor; kod sınıflandırılabilir olmalı.
  assert.doesNotMatch(CONNECTOR_SRC, /throw new Error\('Power BI querydata HTTP '/);
});

/* ===================================================================
   v9.12e — "Sipariş Kod, Ürün Adı ve Renk Tanım birlikte bulunamadı"

   Aynı "Sum(...)" süslemesi, bu kez YANIT tarafında. Canlı querydata
   yanıtının descriptor'ı ölçüldü (38 kolon) ve ilgili üçlü aynen şöyle:

     { "Name": "Sum(Siparis Bilgileri.Sipariş Kod)" }   ← süslü
     { "Name": "Siparis Bilgileri.Ürün Ad" }            ← temiz
     { "Name": "Siparis Bilgileri.Renk Tanım" }         ← temiz

   Descriptor girdilerinde Property ya da iç içe Column YOK; descriptorColumns
   yalnız Name'i görebildiği için satır anahtarı süslü metin oluyordu ve
   sourceValue "Sipariş Kod" alias'ını yakalayamıyordu. Üçlüden yalnız sipariş
   kodu düşüyor, ama Antrepo bütünlük kontrolü üçünü BİRLİKTE aradığı için
   hata mesajı üçünü birden sayıyordu.
   =================================================================== */

// Canlı yanıt descriptor'ından ÖLÇÜLEN satır anahtarları.
const MEASURED_RESPONSE_ROW = {
  'Sum(Siparis Bilgileri.Sipariş Kod)': '1083193',
  'Siparis Bilgileri.Ürün Ad': 'PSG-5-YD',
  'Siparis Bilgileri.Renk Tanım': 'SIYAH',
  'Ithalat.Supplier Portal Statü': 'Yolda',
  'Ithalat.Tahmini Antrepo Giriş Tarihi': '2026-10-01',
  'Dim_Ithalat.İthalat Dosya No': 'IT-1',
  'Ithalat.Yükleme Toplam Adet': '500',
};

test('REGRESYON: "Sum(...)" ile süslü satır anahtarından Sipariş Kod okunur', () => {
  const [row] = dashboard.normalizeDashboardRows([MEASURED_RESPONSE_ROW]);
  assert.equal(row['Sipariş Kod'], '1083193');
  assert.equal(row.orderCode, '1083193');
  // Süslü olmayan diğer ikisi zaten çalışıyordu; bozulmadıklarını da doğrula.
  assert.equal(row['Model Adı'], 'PSG-5-YD');
  assert.equal(row['Renk Tanım'], 'SIYAH');
});

test('bütünlük kontrolünün aradığı üçlü artık birlikte bulunur', () => {
  const [row] = dashboard.normalizeDashboardRows([MEASURED_RESPONSE_ROW]);
  for (const field of ['Sipariş Kod', 'Model Adı', 'Renk Tanım']) {
    assert.ok(row[field], `${field} boş kalmamalı`);
  }
});

test('süsleme soyma yalnız gerçek sarmalayıcıya uygulanır', () => {
  const unwrap = dashboard.unwrapAggregatedName;
  assert.equal(unwrap('Sum(Siparis Bilgileri.Sipariş Kod)'), 'Siparis Bilgileri.Sipariş Kod');
  assert.equal(unwrap('Min(Küp Güncellenme Zamanı.Güncellenme Zamanı)'), 'Küp Güncellenme Zamanı.Güncellenme Zamanı');
  // Sarmalayıcı olmayan adlar aynen kalır.
  assert.equal(unwrap('Siparis Bilgileri.Ürün Ad'), 'Siparis Bilgileri.Ürün Ad');
  assert.equal(unwrap('Antrepo / Depo Statü'), 'Antrepo / Depo Statü');
  // İçinde parantez geçen ama sarmalayıcı olmayan ad bozulmaz.
  assert.equal(unwrap('BO_Hesaplanmış Süre(sa)'), 'BO_Hesaplanmış Süre(sa)');
});

test('süslü ad, adı ÇAKIŞAN temiz bir kolonu gölgelemez', () => {
  // Hem süslü hem temiz varsa temiz olan tercih edilmeli (birebir eşleşme önce).
  const row = {
    'Sum(Siparis Bilgileri.Sipariş Kod)': 'YANLIS',
    'Sipariş Kod': 'DOGRU',
    'Siparis Bilgileri.Ürün Ad': 'M',
    'Siparis Bilgileri.Renk Tanım': 'C',
  };
  const [out] = dashboard.normalizeDashboardRows([row]);
  assert.equal(out['Sipariş Kod'], 'DOGRU');
});

test('üç eşleştirme noktası da aynı soyma kuralını paylaşır', () => {
  // 1) şema doğrulaması
  const schema = ['Sum(Siparis Bilgileri.Sipariş Kod)', 'Siparis Bilgileri.Ürün Ad',
    'Siparis Bilgileri.Renk Tanım', 'Ithalat.Supplier Portal Statü',
    'Ithalat.Tahmini Antrepo Giriş Tarihi', 'Ithalat.Yükleme Toplam Adet',
    'Dim_Ithalat.İthalat Dosya No'];
  assert.deepEqual(dashboard.dashboardSchemaMissingFields(schema, { sourceMode: 'dashboard' }).missing, []);
  // 2) sorgu şablonu — Column.Property üzerinden zaten yakalanıyor
  assert.equal(dashboard.powerBiTemplateHasOrderField(realTemplate), true);
  // 3) satır okuma
  const [row] = dashboard.normalizeDashboardRows([MEASURED_RESPONSE_ROW]);
  assert.equal(row.orderCode, '1083193');
});

/* ===================================================================
   v9.12f — Tek yanıtta ÇOK sonuç kümesi, tek descriptor uygulanıyordu

   Bütünlük hatası, "Sum(...)" düzeltmesinden sonra da sürdü. Checkpoint'ten
   ÖLÇÜLEN durum:
     durumlar : { NOT_FOUND: 7192 }
     satır    : 58
     ilk satır anahtarı: "Min(Küp Güncellenme Zamanı.Güncellenme Zamanı)"

   O anahtar büyük tablonun değil, "son güncellenme" kartının kolonu. Canlı
   istek gövdesi incelendiğinde sebep görüldü: Antrepo'nun kullandığı 24 KB'lık
   sorgu ÜÇ ayrı Select düğümü taşıyor, yani yanıt ÜÇ sonuç kümesi döndürüyor
   ve her birinin kendi descriptor'ı var. decodePowerBiResponse ise
   findDescriptor ile yalnız İLK descriptor'ı alıp TÜM veri bloklarına
   uyguluyordu; büyük tablonun satırları başka bir görselin kolon adlarıyla
   etiketleniyordu.
   =================================================================== */

// Gerçek yapının sadeleştirilmiş ama şekil olarak aynı hâli.
const MULTI_RESULT_PAYLOAD = {
  results: [
    { result: { data: {
      descriptor: { Select: [{ Name: 'Min(Küp Güncellenme Zamanı.Güncellenme Zamanı)' }] },
      dsr: { DS: [{ PH: [{ DM0: [{ C: ['2026-09-03'] }] }] }] },
    } } },
    { result: { data: {
      descriptor: { Select: [
        { Name: 'Sum(Siparis Bilgileri.Sipariş Kod)' },
        { Name: 'Siparis Bilgileri.Ürün Ad' },
        { Name: 'Siparis Bilgileri.Renk Tanım' },
      ] },
      dsr: { DS: [{ PH: [{ DM0: [
        { C: ['1083193', 'PSG-5-YD', 'SIYAH'] },
        { C: ['1083252', 'PSG-6-YD', 'BEYAZ'] },
      ] }] }] },
    } } },
  ],
};

test('REGRESYON: her sonuç kümesi KENDİ descriptor\'ıyla çözülür', () => {
  const rows = dashboard.decodePowerBiResponse(MULTI_RESULT_PAYLOAD);
  assert.equal(rows.length, 3);
  // Kart görselinin satırı kendi kolonuyla.
  assert.equal(rows[0]['Min(Küp Güncellenme Zamanı.Güncellenme Zamanı)'], '2026-09-03');
  // Büyük tablonun satırları KENDİ kolonlarıyla — eskiden kartın kolon adını alıyorlardı.
  assert.equal(rows[1]['Sum(Siparis Bilgileri.Sipariş Kod)'], '1083193');
  assert.equal(rows[1]['Siparis Bilgileri.Ürün Ad'], 'PSG-5-YD');
  assert.equal(rows[2]['Siparis Bilgileri.Renk Tanım'], 'BEYAZ');
});

test('çok sonuçlu yanıttan sipariş kodları okunabilir (NOT_FOUND selinin sebebi)', () => {
  const rows = dashboard.normalizeDashboardRows(dashboard.decodePowerBiResponse(MULTI_RESULT_PAYLOAD));
  const codes = rows.map(row => row.orderCode).filter(Boolean);
  assert.deepEqual(codes, ['1083193', '1083252']);
  // Bütünlük kontrolünün aradığı üçlü, büyük tablo satırlarında birlikte var.
  const table = rows.filter(row => row.orderCode);
  for (const row of table) {
    assert.ok(row['Sipariş Kod'] && row['Model Adı'] && row['Renk Tanım']);
  }
});

test('tek sonuç kümeli yanıtlar eskisi gibi çalışmaya devam eder', () => {
  const single = { result: { data: {
    descriptor: { Select: [{ Name: 'Sipariş Kod' }, { Name: 'Ürün Ad' }] },
    dsr: { DS: [{ PH: [{ DM0: [{ C: ['A1', 'M1'] }] }] }] },
  } } };
  const rows = dashboard.decodePowerBiResponse(single);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]['Sipariş Kod'], 'A1');
});

test('descriptor hiç yoksa yine net bir hata verilir', () => {
  assert.throws(() => dashboard.decodePowerBiResponse({ result: { data: { dsr: { DS: [] } } } }),
    error => error.code === 'POWERBI_DASHBOARD_DESCRIPTOR_MISSING');
});

/* ===================================================================
   v9.12g — "Tarama bitti ama Lojistik alanları güncellenmedi"

   CP'nin Lojistik grubu (STATUS / Ant. Arrival / Del. Type) IAS eşleşmelerinden
   doldurulur. Tarama başarıyla bittiği hâlde bu alanlar boş kaldıysa, ASAS
   siparişleri ile IAS satırları eşleşmemiş demektir.

   Bu sessiz kalabilen bir başarısızlıktı: validateAntrepoIntegrity yalnız IAS
   tarafının YAPISINI doğrular (sütunlar var mı, satır tanesi korundu mu),
   EŞLEŞME ORANINI hiç ölçmez. "Sütunlar yerinde ama sıfır eşleşme" durumunda
   refresh başarılı görünür, Backlog üretilir, Lojistik boş kalır.
   =================================================================== */
const parseLib = require(path.join(root, 'server/lib/parse.js'));
const SERVER_SRC = fs.readFileSync(path.join(root, 'server/server.js'), 'utf8');

test('uçtan uca: ölçülen yanıt anahtarlarından üretilen IAS kaydı ASAS siparişiyle eşleşir', () => {
  const rule = dashboard.dashboardAntrepoMatchRule();
  const raw = {
    'Sum(Siparis Bilgileri.Sipariş Kod)': '1083193',
    'Siparis Bilgileri.Ürün Ad': 'PSG-5-YD',
    'Siparis Bilgileri.Renk Tanım': 'SIYAH',
    'Ithalat.Supplier Portal Statü': 'Antrepoda',
    'Ithalat.Antrepo / Depo Statü': 'Antrepo',
    'Dim_Ithalat.Antrepo Firma': 'ABC Antrepo',
    'Ithalat.Tahmini Antrepo Giriş Tarihi': '2026-10-01',
    'Dim_Ithalat.İthalat Dosya No': 'IT-1',
    'Ithalat.Yükleme Toplam Adet': 500,
  };
  const rows = dashboard.normalizeDashboardRows([raw])
    .map(row => { const { _sourceFields, ...rest } = row; return rest; });
  const parsed = parseLib.parseAntrepoRows(rows, rule);
  assert.equal(parseLib.antrepoParseMeta(parsed).ok, true);

  const hit = Object.values(parsed)[0];
  assert.equal(hit.ocode, '1083193');
  assert.equal(hit.model, 'PSG-5-YD');
  assert.equal(hit.colour, 'SIYAH');

  // İki tarafın anahtarı aynı olmalı — eşleşmenin tek şartı budur.
  const asasOrder = { ocode: '1083193', model: 'PSG-5-YD', colour: 'SIYAH' };
  assert.equal(
    parseLib.dynamicAntrepoMatchKey(hit, 'ias', rule),
    parseLib.dynamicAntrepoMatchKey(asasOrder, 'asas', rule));
  assert.equal(parseLib.findAntrepoHits(parsed, asasOrder, { rule }).length, 1);
});

test('eşleşmeyen değer sessizce geçmez: diag sayacı sebebi ayırt eder', () => {
  const rule = dashboard.dashboardAntrepoMatchRule();
  const parsed = parseLib.parseAntrepoRows(
    dashboard.normalizeDashboardRows([{
      'Sum(Siparis Bilgileri.Sipariş Kod)': '1083193',
      'Siparis Bilgileri.Ürün Ad': 'PSG-5-YD',
      'Siparis Bilgileri.Renk Tanım': 'SIYAH',
      'Ithalat.Yükleme Toplam Adet': 1,
    }]).map(row => { const { _sourceFields, ...rest } = row; return rest; }), rule);

  // Renk farklı → karşılığı yok.
  const wrongColour = {};
  parseLib.findAntrepoHits(parsed, { ocode: '1083193', model: 'PSG-5-YD', colour: 'BEYAZ' }, { rule, diag: wrongColour });
  assert.equal(wrongColour.unmatched, 1);

  // Renk hiç yok → ASAS anahtarı üretilemiyor (farklı sorun, farklı çözüm).
  const noColour = {};
  parseLib.findAntrepoHits(parsed, { ocode: '1083193', model: 'PSG-5-YD', colour: '' }, { rule, diag: noColour });
  assert.equal(noColour.targetIncomplete, 1);
});

test('sıfır eşleşme artık uyarı üretir — sessizce başarılı sayılmaz', () => {
  const start = SERVER_SRC.indexOf('EŞLEŞME ORANI ÖLÇÜMÜ');
  assert.ok(start >= 0, 'eşleşme ölçümü eklenmemiş');
  const block = SERVER_SRC.slice(start, SERVER_SRC.indexOf('checkpointStore.clear()', start));
  assert.match(block, /findAntrepoHits\(parsed, order, \{ rule: dashboardRule, diag: matchDiag \}\)/);
  assert.match(block, /hiçbiri IAS satırlarıyla eşleşmedi/);
  assert.match(block, /STATUS, Ant\. Arrival, Del\. Type/);
  // Düşük eşleşme de bildirilmeli (sıfır olmasa bile veri eksik demektir).
  /* Düşük eşleşme oranı UYARI DEĞİLDİR (iş kuralı): Dashboard'da görünmeyen
     siparişler üretimdedir ve bir siparişin birden çok parsiyeli olabilir
     (ör. 5000 adedin 2000'i depoda, 2000'i yolda, 1000'i üretimde). Yalnız
     SIFIR eşleşme gerçek arıza işaretidir. */
  assert.doesNotMatch(block, /percent < 50/);
  assert.match(block, /ÜRETİMDEDİR/);
  // Ölçüm, tanılama fonksiyonunu örnek anahtarlarla besliyor olmalı.
  assert.match(block, /ias: Object\.values\(parsed\)\.map/);
  assert.match(block, /asas: orderList\.map/);
  // Tanılama iki taraftan örnek anahtar yazmalı ki biçim farkı görülebilsin
  // (fonksiyon loadAntrepoFromDashboard'dan önce tanımlı, o yüzden tüm kaynakta aranır).
  assert.match(SERVER_SRC, /iasSampleKeys: trim\(samples\.ias\)/);
  assert.match(SERVER_SRC, /asasSampleKeys: trim\(samples\.asas\)/);
});

/* ===================================================================
   v9.12h — Doğru şablon eskiyip listeden düşüyordu

   ÖLÇÜLEN (POWERBI_MATCH_RATE, akış-yukarısı sayaçlarıyla):
     manifestSuccess 0 · manifestNotFound 7192
     rawRows 58 · normalizedRows 58 · parseOk true · parseDataRows 0
     firstRowKeys: ['Min(Küp Güncellenme Zamanı.Güncellenme Zamanı)',
                    '__isSubtotal', ...]

   Yani gönderilen sorgu büyük tablonun değil, "son güncellenme" KARTININ
   şablonuydu; yanıt 58 ara toplam satırı döndürüyor, hiçbirinde sipariş kodu
   olmuyordu. Sebep: templates dizisi 20'de bir en eskiyi atıyor (shift) ve
   oturum önbellekten yeniden kullanılıyor; kendini periyodik yenileyen
   görseller listeyi doldurdukça Antrepo'nun ihtiyaç duyduğu şablon düşüyordu.
   =================================================================== */

test('Sipariş Kod taşıyan en iyi şablon sabitlenir ve eskitilmez', () => {
  const start = CONNECTOR_SRC.indexOf('const addTemplate =');
  const end = CONNECTOR_SRC.indexOf('const requested = params =>', start);
  assert.ok(start >= 0 && end > start);
  const block = CONNECTOR_SRC.slice(start, end);
  assert.match(block, /powerBiTemplateHasOrderField\(body\)/);
  assert.match(block, /bestOrderTemplate = \{ template, score \}/);
  // Sabitleme, eskitmeden ÖNCE yapılmalı; yoksa düşen şablon hiç saklanmaz.
  assert.ok(block.indexOf('bestOrderTemplate = { template, score }') < block.indexOf('templates.length > 20'));
});

test('seçim, sabitlenmiş şablonu da aday olarak değerlendirir', () => {
  const start = CONNECTOR_SRC.indexOf('async queryBatch(orderCodes');
  const end = CONNECTOR_SRC.indexOf('if (!template) {', start);
  const block = CONNECTOR_SRC.slice(start, end);
  assert.match(block, /const candidates = bestOrderTemplate \? \[\.\.\.templates, bestOrderTemplate\.template\] : templates/);
  // Döngü artık templates yerine candidates üzerinde dönmeli.
  assert.match(block, /for \(let index = candidates\.length - 1/);
  assert.doesNotMatch(block, /for \(let index = templates\.length - 1/);
  // Hangi şablonun seçildiği ölçülebilir olmalı.
  assert.match(block, /POWERBI_QUERY_TEMPLATE/);
});

test('kart görselinin şablonu Sipariş Kod taşımaz — sabitlenmeye aday değildir', () => {
  // Canlı yakalanan kart sorgusunun Select ögesi (yalnız bir toplama alanı).
  const cardTemplate = {
    queries: [{ Query: { Commands: [{ SemanticQueryDataShapeCommand: { Query: {
      Select: [{
        Aggregation: { Expression: { Column: { Expression: { SourceRef: { Source: 'k' } }, Property: 'Güncellenme Zamanı' } }, Function: 3 },
        Name: 'Min(Küp Güncellenme Zamanı.Güncellenme Zamanı)',
      }],
    } } }] } }],
  };
  assert.equal(dashboard.powerBiTemplateHasOrderField(cardTemplate), false);
  assert.throws(() => dashboard.buildPowerBiOrderQueryPayload(cardTemplate, ['1083193']),
    error => error.code === 'POWERBI_DASHBOARD_ORDER_FIELD_MISSING');
});

/* ===================================================================
   v9.12i — Sayfadaki Sipariş Kod filtresi bizimkiyle ÇAKIŞIYORDU

   ÖLÇÜLEN: POWERBI_QUERY_TEMPLATE score 7 / columns 74 → DOĞRU şablon
   seçiliyor; sorgu 200 dönüyor; ama manifestNotFound 7192, yani hiçbir
   sipariş gelmiyor.

   Sebep: yakalanan şablon raporun O ANKİ filtrelerini de taşır. Kullanıcının
   Sipariş Kod slicer'ında bir seçim varsa (canlı ölçüm: In ('1265562')),
   bizim In(7192 kod) koşulumuz onun ÜSTÜNE ekleniyor, iki koşul VE'leniyor
   ve kesişim boş kalıyordu.
   =================================================================== */

const ORDER_COLUMN = { Expression: { SourceRef: { Source: 's' } }, Property: 'Sipariş Kod' };
function templateWithPageFilters() {
  return { queries: [{ Query: { Commands: [{ SemanticQueryDataShapeCommand: { Query: {
    Select: [{ Column: ORDER_COLUMN, Name: 'Sum(Siparis Bilgileri.Sipariş Kod)' }],
    Where: [
      { Condition: { In: { Expressions: [{ Column: { Expression: { SourceRef: { Source: 'i' } }, Property: 'Hedef Sevkiyat' } }], Values: [[{ Literal: { Value: "'TURKIYE'" } }]] } } },
      { Condition: { In: { Expressions: [{ Column: ORDER_COLUMN }], Values: [[{ Literal: { Value: "'1265562'" } }]] } } },
      { Condition: { In: { Expressions: [{ Column: { Expression: { SourceRef: { Source: 'i' } }, Property: 'Dosya Tipi' } }], Values: [[{ Literal: { Value: "'T'" } }]] } } },
    ],
  } } }] } }] };
}

test('REGRESYON: sayfadaki Sipariş Kod filtresi bizimkiyle VE\'lenmez', () => {
  const body = dashboard.buildPowerBiOrderQueryPayload(templateWithPageFilters(), ['1083193', '1083252']);
  const where = body.queries[0].Query.Commands[0].SemanticQueryDataShapeCommand.Query.Where;
  const orderConditions = where.filter(item => JSON.stringify(item).includes('Sipariş Kod'));
  assert.equal(orderConditions.length, 1, 'Sipariş Kod için tek koşul kalmalı');
  assert.deepEqual(
    orderConditions[0].Condition.In.Values.map(value => value[0].Literal.Value),
    ["'1083193'", "'1083252'"]);
  // Kullanıcının eski seçimi kalmamalı — kalırsa kesişim boşalır.
  assert.doesNotMatch(JSON.stringify(where), /1265562/);
});

test('raporun DİĞER filtreleri korunur — kapsam daraltmaları meşrudur', () => {
  const body = dashboard.buildPowerBiOrderQueryPayload(templateWithPageFilters(), ['1083193']);
  const where = body.queries[0].Query.Commands[0].SemanticQueryDataShapeCommand.Query.Where;
  const text = JSON.stringify(where);
  assert.match(text, /Hedef Sevkiyat/);
  assert.match(text, /TURKIYE/);
  assert.match(text, /Dosya Tipi/);
  assert.equal(where.length, 3);
});

test('filtre yokken davranış değişmez', () => {
  const body = dashboard.buildPowerBiOrderQueryPayload(realTemplate, ['1083193']);
  const where = body.queries[0].Query.Commands[0].SemanticQueryDataShapeCommand.Query.Where;
  assert.equal(where.length, 1);
});

test('aynı adlı ama BAŞKA tablodan gelen kolon yanlışlıkla silinmez', () => {
  const other = { Expression: { SourceRef: { Source: 'z' } }, Property: 'Sipariş Kod' };
  const template = { queries: [{ Query: { Commands: [{ SemanticQueryDataShapeCommand: { Query: {
    Select: [{ Column: ORDER_COLUMN, Name: 'Siparis Bilgileri.Sipariş Kod' }],
    Where: [{ Condition: { In: { Expressions: [{ Column: other }], Values: [[{ Literal: { Value: "'X'" } }]] } } }],
  } } }] } }] };
  const body = dashboard.buildPowerBiOrderQueryPayload(template, ['1083193']);
  const where = body.queries[0].Query.Commands[0].SemanticQueryDataShapeCommand.Query.Where;
  // Farklı SourceRef → farklı kolon; korunmalı.
  assert.equal(where.length, 2);
  assert.match(JSON.stringify(where), /'X'/);
});

/* ===================================================================
   v9.12j — Sözlük çözümlemesi: kolon→sözlük bağı S[i].DN ile kurulur

   Filtre düzeltmesinden sonra veri akmaya başladı ama eşleşme yine 0'dı:
     iasKeys 4979 · parseDataRows 4979 · matched 0
     iasSampleKeys: ['["0","0","0"]', '["1","1","1"]']   ← değer değil, İNDİS

   Power BI metin kolonlarını sözlükleyip hücrede indis gönderiyor. Canlı
   yanıttan ÖLÇÜLEN biçim:

     "S":[ {"DN":"D0","N":"G0","T":1},   ← kolon 0'ın sözlüğü D0
           {"N":"G19","T":7},            ← DN yok → ham değer
           {"N":"M0","T":4} ]            ← ölçüm

   ValueDicts de D0..D20 ile anahtarlı. Eski kod sözlüğü kolon ADI veya
   İNDİSİ ile arıyordu; hiçbiri tutmadığı için ham indis kalıyordu.
   Ayrıca "S var" ara toplam sanılıyordu — oysa S kolon ŞEMASIDIR ve DSR onu
   yalnız ilk veri satırında gönderir. =================================== */

const MEASURED_DSR = () => ({
  results: [{ result: { data: {
    descriptor: { Select: [
      { Name: 'Ithalat.Supplier Portal Statü' },
      { Name: 'Ithalat.Vasita Tanim' },
      { Name: 'Sum(Siparis Bilgileri.Sipariş Kod)' },
      { Name: 'Siparis Bilgileri.Ürün Ad' },
      { Name: 'Siparis Bilgileri.Renk Tanım' },
      { Name: 'Ithalat.Tahmini Antrepo Giriş Tarihi' },
    ] },
    dsr: { DS: [{
      ValueDicts: {
        D0: ['Antrepoda', 'Yolda'], D1: ['GEMI', 'UCAK'],
        D2: ['1083193', '1083252'], D3: ['UK.TSH,JAPAN', 'UK.TSH,COLLECTIVE'],
        D4: ['GREY PRINTED', 'ECRU'],
      },
      PH: [{ DM0: [
        { C: [999], S: [{ N: 'A0', T: 4 }] },                       // genel toplam
        { C: [0, 0, 0, 0, 0, 1726012800000], S: [                   // şema burada
          { DN: 'D0', N: 'G0', T: 1 }, { DN: 'D1', N: 'G1', T: 1 }, { DN: 'D2', N: 'G2', T: 1 },
          { DN: 'D3', N: 'G3', T: 1 }, { DN: 'D4', N: 'G4', T: 1 }, { N: 'G5', T: 7 },
        ] },
        { C: [1, 1, 1, 1, 1, 1725926400000] },                      // şema tekrar gelmez
      ] }],
    }] },
  } } }],
});

test('REGRESYON: sözlüklü hücreler indis değil GERÇEK değer olarak çözülür', () => {
  const rows = dashboard.decodePowerBiResponse(MEASURED_DSR());
  const data = rows.filter(row => !row.__isSubtotal);
  assert.equal(data.length, 2);
  assert.equal(data[0]['Sum(Siparis Bilgileri.Sipariş Kod)'], '1083193');
  assert.equal(data[0]['Siparis Bilgileri.Ürün Ad'], 'UK.TSH,JAPAN');
  assert.equal(data[0]['Ithalat.Supplier Portal Statü'], 'Antrepoda');
  // Eskiden bunların hepsi 0 / 1 gibi ham indis oluyordu.
  assert.notEqual(data[0]['Sum(Siparis Bilgileri.Sipariş Kod)'], 0);
});

test('şema yalnız ilk satırda gelir, sonraki satırlar onu yeniden kullanır', () => {
  const rows = dashboard.decodePowerBiResponse(MEASURED_DSR()).filter(row => !row.__isSubtotal);
  // İkinci satırda S yok; yine de sözlükler doğru uygulanmalı.
  assert.equal(rows[1]['Sum(Siparis Bilgileri.Sipariş Kod)'], '1083252');
  assert.equal(rows[1]['Siparis Bilgileri.Renk Tanım'], 'ECRU');
  assert.equal(rows[1]['Ithalat.Vasita Tanim'], 'UCAK');
});

test('DN taşımayan kolon (tarih/ölçüm) ham değeriyle kalır', () => {
  const rows = dashboard.decodePowerBiResponse(MEASURED_DSR()).filter(row => !row.__isSubtotal);
  assert.equal(rows[0]['Ithalat.Tahmini Antrepo Giriş Tarihi'], 1726012800000);
});

test('"S" varlığı ara toplam sanılmaz — yalnız ölçüm yuvalı satır toplamdır', () => {
  const rows = dashboard.decodePowerBiResponse(MEASURED_DSR());
  assert.equal(rows.filter(row => row.__isSubtotal).length, 1, 'yalnız genel toplam işaretlenmeli');
  // Şema taşıyan ilk VERİ satırı toplam sayılmamalı.
  assert.ok(!rows[1].__isSubtotal);
});

test('çözülen satırlar ASAS anahtarıyla BİREBİR eşleşir (uçtan uca)', () => {
  const rule = dashboard.dashboardAntrepoMatchRule();
  const rows = dashboard.normalizeDashboardRows(dashboard.decodePowerBiResponse(MEASURED_DSR()))
    .filter(row => row.orderCode)
    .map(row => { const { _sourceFields, ...rest } = row; return rest; });
  const parsed = parseLib.parseAntrepoRows(rows, rule);
  // Ölçülen gerçek ASAS anahtarı: ["1083193","UK.TSH,JAPAN","GREY PRINTED"]
  const asasOrder = { ocode: '1083193', model: 'UK.TSH,JAPAN', colour: 'GREY PRINTED' };
  const hits = parseLib.findAntrepoHits(parsed, asasOrder, { rule });
  assert.equal(hits.length, 1, 'ASAS siparişi IAS satırıyla eşleşmeli');
  // Kullanıcının beklediği üç Lojistik alanı da taşınmalı.
  assert.equal(hits[0].statu, 'Antrepoda');   // → STATUS
  assert.equal(hits[0].vasita, 'GEMI');       // → Del. Type
});

/* ===================================================================
   v9.12k — "1000 adet varken milyarlarca adet" (32 bit maske taşması)

   Veri akmaya başladıktan sonra Yükleme Toplam Adet parsiyel bazlı saçma
   büyüklükte geliyordu. Sebep hizalama kaymasıydı:

   DSR'de null (Ø) ve tekrar (R) maskeleri bit alanıdır. JS'in bitsel &
   operatörü işlenenleri 32 BİT işaretli tamsayıya çevirir; index >= 32 için
   maske sıfırlanır ve bit hiç okunamaz. Eski kod "index < 53" yazarak 53 bit
   desteklediğini SANIYORDU.

   Antrepo tablosu 38 kolon; ölçümler (Net Alım Sipariş Miktarı, Yükleme
   Toplam Adet, Kap Adet) son üç kolon. 32-37 arasındaki bir null biti
   görülmeyince hücre imleci kayıyor ve miktar alanına bir TARİH hücresi
   (epoch ms, ~1.7 trilyon) düşüyordu. =============================== */

test('REGRESYON: 32. bitten sonraki null biti okunur (maske taşması)', () => {
  assert.equal(dashboard.bitmapHas(Math.pow(2, 33), 33), true, '33. bit okunmalı');
  assert.equal(dashboard.bitmapHas(Math.pow(2, 37), 37), true, '37. bit okunmalı');
  assert.equal(dashboard.bitmapHas(Math.pow(2, 33), 34), false);
  // 32 altı davranış korunmalı.
  assert.equal(dashboard.bitmapHas(1161822208, 30), true);
  assert.equal(dashboard.bitmapHas(1161822208, 29), false);
  assert.equal(dashboard.bitmapHas(null, 0), false);
  assert.equal(dashboard.bitmapHas(8, -1), false);
});

test('38 kolonlu satırda ölçüm alanları doğru hücreyi alır', () => {
  const COLS = 38;
  const names = Array.from({ length: COLS }, (_, i) => (i < 35 ? `G${i}` : `M${i - 35}`));
  const cells = [];
  for (let i = 0; i < COLS; i++) {
    if (i === 33) continue;                                   // null kolon
    if (i >= 19 && i <= 28) cells.push(1726012800000 + i);    // tarih (epoch ms)
    else if (i === 35) cells.push(6288);
    else if (i === 36) cells.push(6454);                      // Yükleme Toplam Adet
    else if (i === 37) cells.push(139);
    else cells.push(0);
  }
  const payload = { results: [{ result: { data: {
    descriptor: { Select: names.map(name => ({ Name: name })) },
    dsr: { DS: [{ ValueDicts: {}, PH: [{ DM0: [{
      C: cells, 'Ø': Math.pow(2, 33),
      S: names.map((name, i) => ({ N: name, T: i >= 35 ? 4 : 1 })),
    }] }] }] },
  } } }] };
  const row = dashboard.decodePowerBiResponse(payload)[0];
  assert.equal(row.G33, null, 'null kolon null kalmalı');
  assert.equal(row.M1, 6454, 'Yükleme Toplam Adet doğru hücreyi almalı');
  assert.equal(row.M2, 139);
  // Asıl belirti: miktar alanına tarih düşmesi.
  assert.ok(Math.abs(row.M1) < 1e10, 'miktar alanına tarih değeri kaymamalı');
});

test('tekrar (R) maskesi de 32 bit üstünde doğru çalışır', () => {
  const names = Array.from({ length: 36 }, (_, i) => `C${i}`);
  const descriptor = { Select: names.map(name => ({ Name: name })) };
  const schema = names.map(name => ({ N: name, T: 1 }));
  const payload = { results: [{ result: { data: { descriptor, dsr: { DS: [{ ValueDicts: {}, PH: [{ DM0: [
    { C: names.map((_, i) => i), S: schema },
    // 35. kolon öncekiyle aynı: tekrar biti 35'te.
    { C: names.slice(0, 35).map((_, i) => 100 + i), R: Math.pow(2, 35) },
  ] }] }] } } } }] };
  const rows = dashboard.decodePowerBiResponse(payload);
  assert.equal(rows[1].C35, 35, 'tekrar eden kolon önceki satırdan alınmalı');
  assert.equal(rows[1].C34, 134, 'diğer kolonlar kaymamalı');
});

/* ===================================================================
   v9.12l — Descriptor sırası ≠ hücre sırası (miktar yanlış kolondan)

   32 bit maske düzeltmesinden sonra Yükleme Toplam Adet hâlâ yanlıştı.
   Canlı yanıttan ÖLÇÜLEN sebep: descriptor girdilerinin sırası ile satır
   hücrelerinin sırası AYNI DEĞİL.

     descriptor[20] = "Ithalat.Yükleme Toplam Adet", Value: "M1"
     gerçek hücresi  = 36 (S[36].N === "M1")

   Descriptor gruplama kolonlarını önce, ölçümleri sonda listeliyor; hücreler
   ise G0..G34 sonra M0..M2 sırasında geliyor. Kod "descriptor indeksi = hücre
   indeksi" varsaydığı için miktar alanına başka bir kolonun (çoğu kez tarih)
   değeri düşüyordu. Doğru bağ: descriptor.Value === S[i].N. ============= */

const SLOT_SELECT = [
  { Name: 'Ithalat.Supplier Portal Statü', Value: 'G0', Kind: 1 },
  { Name: 'Ithalat.Vasita Tanim', Value: 'G1', Kind: 1 },
  { Name: 'Sum(Siparis Bilgileri.Sipariş Kod)', Value: 'G2', Kind: 1 },
  { Name: 'Siparis Bilgileri.Ürün Ad', Value: 'G3', Kind: 1 },
  { Name: 'Siparis Bilgileri.Renk Tanım', Value: 'G4', Kind: 1 },
  { Name: 'Siparis Bilgileri.Net Alım Sipariş Miktarı', Value: 'M0', Kind: 2 },
  { Name: 'Ithalat.Yükleme Toplam Adet', Value: 'M1', Kind: 2 },
  { Name: 'Ithalat.Kap Adet', Value: 'M2', Kind: 2 },
];
const SLOT_SCHEMA = [
  { DN: 'D0', N: 'G0', T: 1 }, { DN: 'D1', N: 'G1', T: 1 }, { DN: 'D2', N: 'G2', T: 1 },
  { DN: 'D3', N: 'G3', T: 1 }, { DN: 'D4', N: 'G4', T: 1 },
  { N: 'M0', T: 4 }, { N: 'M1', T: 4 }, { N: 'M2', T: 4 },
];
const slotPayload = (cells, extra = {}) => ({ results: [{ result: { data: {
  descriptor: { Select: SLOT_SELECT },
  dsr: { DS: [{
    ValueDicts: { D0: ['Antrepoda'], D1: ['GEMI'], D2: ['1121311'], D3: ['ŞRT,MOLES'], D4: ['MID GREEN'] },
    PH: [{ DM0: [{ C: cells, S: SLOT_SCHEMA, ...extra }] }],
  }] },
} } }] });

test('REGRESYON: kolon adı yuva adından çözülür, descriptor sırasından değil', () => {
  const row = dashboard.decodePowerBiResponse(slotPayload([0, 0, 0, 0, 0, 8665, 4821, 58]))[0];
  assert.equal(row['Siparis Bilgileri.Net Alım Sipariş Miktarı'], 8665);
  assert.equal(row['Ithalat.Yükleme Toplam Adet'], 4821, 'miktar kendi hücresini almalı');
  assert.equal(row['Ithalat.Kap Adet'], 58);
  // Gruplama kolonları da doğru sözlükten çözülmeli.
  assert.equal(row['Sum(Siparis Bilgileri.Sipariş Kod)'], '1121311');
  assert.equal(row['Siparis Bilgileri.Renk Tanım'], 'MID GREEN');
});

test('miktar alanına tarih/başka kolon değeri düşmez', () => {
  // Gerçek yanıtta gruplama bölgesinde epoch ms tarihler var.
  const row = dashboard.decodePowerBiResponse(slotPayload([0, 0, 0, 0, 0, 8665, 4821, 58]))[0];
  const qty = row['Ithalat.Yükleme Toplam Adet'];
  assert.ok(typeof qty === 'number' && qty < 1e6, `miktar makul olmalı, gelen: ${qty}`);
});

test('yuva haritası yokken eski konumsal davranış korunur', () => {
  // Value taşımayan basit descriptor: konumsal eşleme sürmeli.
  const payload = { results: [{ result: { data: {
    descriptor: { Select: [{ Name: 'A' }, { Name: 'B' }] },
    dsr: { DS: [{ ValueDicts: {}, PH: [{ DM0: [{ C: [1, 2] }] }] }] },
  } } }] };
  const row = dashboard.decodePowerBiResponse(payload)[0];
  assert.equal(row.A, 1);
  assert.equal(row.B, 2);
});

test('yuva eşlemesi null maskesiyle birlikte doğru çalışır', () => {
  // Kolon G3 (Ürün Ad) null; kalan 7 hücre gönderiliyor.
  const row = dashboard.decodePowerBiResponse(
    slotPayload([0, 0, 0, 0, 8665, 4821, 58], { 'Ø': Math.pow(2, 3) }))[0];
  assert.equal(row['Siparis Bilgileri.Ürün Ad'], null);
  assert.equal(row['Ithalat.Yükleme Toplam Adet'], 4821, 'null sonrası hizalama bozulmamalı');
  assert.equal(row['Ithalat.Kap Adet'], 58);
});

/* ===================================================================
   v9.12m — Çoklu parsiyel beklenen durumdur (iş kuralı)

   Kullanıcı açıklaması: Dashboard'da görünmeyen siparişler ÜRETİMDEDİR;
   ayrıca bir siparişin birden çok parsiyeli olabilir — ör. 5000 adedin
   2000'i depoda, 2000'i yolda, kalan 1000 üretimde veya eksik yükleme.

   Bu yüzden eşleşme oranının düşük olması ve aynı siparişin birden fazla IAS
   satırıyla eşleşmesi ARIZA DEĞİLDİR. Aşağıdaki testler bu kuralı kilitler:
   parsiyeller birleştirilip tek satıra indirgenmemeli. ================== */

test('aynı sipariş birden çok parsiyelle eşleşir ve hepsi korunur', () => {
  const rule = dashboard.dashboardAntrepoMatchRule();
  const partial = (statu, qty, dosya) => ({
    'Sum(Siparis Bilgileri.Sipariş Kod)': '1121311',
    'Siparis Bilgileri.Ürün Ad': 'ŞRT,MOLES',
    'Siparis Bilgileri.Renk Tanım': 'MID GREEN',
    'Ithalat.Supplier Portal Statü': statu,
    'Ithalat.Yükleme Toplam Adet': qty,
    'Dim_Ithalat.İthalat Dosya No': dosya,
    'Ithalat.Vasita Tanim': 'GEMI',
  });
  const rows = dashboard.normalizeDashboardRows([
    partial('Depoda', 2000, 'IT-1'),
    partial('Yolda', 2000, 'IT-2'),
  ]).map(row => { const { _sourceFields, ...rest } = row; return rest; });

  const parsed = parseLib.parseAntrepoRows(rows, rule);
  const hits = parseLib.findAntrepoHits(parsed, { ocode: '1121311', model: 'ŞRT,MOLES', colour: 'MID GREEN' }, { rule });
  assert.equal(hits.length, 2, 'iki parsiyel de dönmeli — biri diğerini ezmemeli');
  assert.deepEqual(hits.map(hit => hit.statu).sort(), ['Depoda', 'Yolda']);
  // Miktarlar parsiyel bazında ayrı kalmalı; toplanıp tek satıra indirgenmemeli.
  assert.deepEqual(hits.map(hit => Number(hit.loadedQty)).sort((a, b) => a - b), [2000, 2000]);
});

test('"ambiguous" sayacı hata değil, çoklu parsiyelin göstergesidir', () => {
  const rule = dashboard.dashboardAntrepoMatchRule();
  const rows = dashboard.normalizeDashboardRows([
    { 'Sum(Siparis Bilgileri.Sipariş Kod)': '1121311', 'Siparis Bilgileri.Ürün Ad': 'ŞRT,MOLES',
      'Siparis Bilgileri.Renk Tanım': 'MID GREEN', 'Ithalat.Yükleme Toplam Adet': 2000, 'Dim_Ithalat.İthalat Dosya No': 'IT-1' },
    { 'Sum(Siparis Bilgileri.Sipariş Kod)': '1121311', 'Siparis Bilgileri.Ürün Ad': 'ŞRT,MOLES',
      'Siparis Bilgileri.Renk Tanım': 'MID GREEN', 'Ithalat.Yükleme Toplam Adet': 2000, 'Dim_Ithalat.İthalat Dosya No': 'IT-2' },
  ]).map(row => { const { _sourceFields, ...rest } = row; return rest; });
  const parsed = parseLib.parseAntrepoRows(rows, rule);
  const diag = {};
  parseLib.findAntrepoHits(parsed, { ocode: '1121311', model: 'ŞRT,MOLES', colour: 'MID GREEN' }, { rule, diag });
  assert.equal(diag.ambiguous, 1, 'çoklu parsiyel ambiguous sayılır — bu beklenen durumdur');
  assert.ok(!diag.unmatched);
});

test('dashboard\'da bulunmayan sipariş üretimde sayılır — hata üretilmez', () => {
  const rule = dashboard.dashboardAntrepoMatchRule();
  const parsed = parseLib.parseAntrepoRows(
    dashboard.normalizeDashboardRows([{
      'Sum(Siparis Bilgileri.Sipariş Kod)': '1121311', 'Siparis Bilgileri.Ürün Ad': 'ŞRT,MOLES',
      'Siparis Bilgileri.Renk Tanım': 'MID GREEN', 'Ithalat.Yükleme Toplam Adet': 1,
    }]).map(row => { const { _sourceFields, ...rest } = row; return rest; }), rule);
  const diag = {};
  const hits = parseLib.findAntrepoHits(parsed, { ocode: '9999999', model: 'YOK', colour: 'YOK' }, { rule, diag });
  assert.equal(hits.length, 0);
  assert.equal(diag.unmatched, 1, 'karşılığı olmayan sipariş yalnız sayılır, hata değildir');
});
