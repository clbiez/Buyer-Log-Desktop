/* ===================================================================
   v7.28 — HESAPLANAN SÜTUNLAR (formül sütunu)

   Kullanıcı talebi (birebir): "tablolara sütunları birleştiren, sütunlar arası
   hesaplama yapabilen bir yeni sütun ekle sistemi kurmak istiyorum ... X ve Y
   tarih, Z sütununda kaç gün fark var ... A ve B rakam, farkı/çarpımı/bölme
   sonucunu C sütununda görebileyim. mevcut durumda columns başlığı altında add
   column var, oradan yürüyebilirsin."

   TASARIM KARARLARI

   1) GERÇEK BİR SÜTUN OLUR. Hesaplanan değer satırın üzerine yazılır; böylece
      sıralama, sayfa filtreleri, Excel'e aktarma ve sütun paneli hiçbir özel
      duruma ihtiyaç duymadan çalışır. Ayrı bir "sanal sütun" katmanı kurmak,
      her özelliği ikinci kez yazmak demekti.

   2) KİŞİSELDİR. Formül sütunu kullanıcının kendi çalışma alanına yazılır
      (bl.formulaColumns.*, "columns" kategorisi). Sebebi hem gizlilik hem de
      yetki: CP'deki mevcut "Sütun Ekle" ortak Data Model bağlantısına yazdığı
      için yalnız Moderatör kullanabiliyor. Formül sütununu herkes kurabilmeli.
      Kategori "columns" olduğu için Profil Kopyalama panelinden başka bir
      kullanıcıya aktarılabilir.

   3) HATA GİZLENMEZ. Formül bozuksa veya bir sütun bulunamıyorsa hücrede "—"
      görünür; sütun başlığı ve düzenleme penceresi sebebi yazar. Yanlış sayıyı
      doğruymuş gibi göstermek en pahalı hatadır (§152).

   4) SONUÇ ÖNCE GÖRÜLÜR. Pencerede ilk satırlar üzerinde canlı önizleme var;
      kullanıcı kaydetmeden önce formülün ne ürettiğini görür.
   =================================================================== */
(() => {
  'use strict';

  const TABLES = {
    cp: { tr: 'CP', en: 'CP' },
    orders: { tr: 'Siparişler', en: 'Orders' },
    ship: { tr: 'Nakliye Kıyaslama', en: 'Shipping Comparison' },
  };
  const KEY_PREFIX = 'bl.formulaColumns.';
  const COLUMN_KEY_PREFIX = '__f_';
  const MAX_PER_TABLE = 30;

  const en = () => typeof appLang !== 'undefined' && appLang === 'en';
  const T = (tr, enText) => (en() ? enText : tr);
  const esc = value => (typeof escapeHtml === 'function' ? escapeHtml(String(value == null ? '' : value))
    : String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])));
  const clean = value => String(value == null ? '' : value).trim();
  // Motor tarayıcıda window'a, düğüm ortamındaki testlerde globalThis'e yazılır.
  const engine = () => (typeof window !== 'undefined' && window.BLFormulaEngine)
    || (typeof globalThis !== 'undefined' && globalThis.BLFormulaEngine)
    || null;

  /* ---------------- depo ---------------- */

  function storageKey(tableKey) { return `${KEY_PREFIX}${tableKey}.v1`; }
  function load(tableKey) {
    try {
      const raw = window.BLStorage ? BLStorage.getItem(storageKey(tableKey)) : localStorage.getItem(storageKey(tableKey));
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed.filter(item => item && item.id && item.label).slice(0, MAX_PER_TABLE) : [];
    } catch (_) { return []; }
  }
  function save(tableKey, list) {
    const value = JSON.stringify((Array.isArray(list) ? list : []).slice(0, MAX_PER_TABLE));
    try {
      if (window.BLStorage) BLStorage.setItem(storageKey(tableKey), value);
      else localStorage.setItem(storageKey(tableKey), value);
    } catch (_) { /* kota dolu: kayıt yapılamaz, ekrandaki tanım yine de çalışır */ }
  }
  function definitions(tableKey) { return load(tableKey); }

  /* ---------------- biçimlendirme ---------------- */

  const FORMATS = {
    auto: { tr: 'Otomatik', en: 'Automatic' },
    number: { tr: 'Sayı', en: 'Number' },
    integer: { tr: 'Tam sayı', en: 'Whole number' },
    percent: { tr: 'Yüzde', en: 'Percent' },
    date: { tr: 'Tarih', en: 'Date' },
    text: { tr: 'Metin', en: 'Text' },
  };

  /* Tarih GÖSTERİMİ uygulamanın geri kalanıyla aynı olmalıdır (gg.aa.yy).
     Satırda saklanan değer ISO'dur (2026-03-02): metin olarak sıralandığında
     doğru sıraya girer. Ekranda ise ISO göstermek, programın diğer bütün tarih
     sütunlarından farklı bir biçim demek olurdu. */
  function dateDisplay(value) {
    if (typeof window.fmtDate === 'function') { const text = window.fmtDate(value); if (text) return text; }
    const E = engine();
    const date = E ? E.toDate(value) : null;
    if (!date) return '';
    const pad = x => String(x).padStart(2, '0');
    return `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}.${String(date.getUTCFullYear()).slice(-2)}`;
  }

  function formatValue(value, definition) {
    const E = engine();
    if (value == null || value === '') return '';
    const format = definition && definition.format ? definition.format : 'auto';
    const decimals = Number.isFinite(Number(definition && definition.decimals)) ? Math.max(0, Math.min(6, Number(definition.decimals))) : null;
    if (format === 'text') return E ? E.toText(value) : String(value);
    if (format === 'date') return dateDisplay(value) || (E ? E.toText(value) : String(value));
    if (value instanceof Date) return dateDisplay(value);
    // "auto": ISO tarih metni de tarih gibi gösterilir (formül ADDDAYS/TODAY döndürmüş olabilir).
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return dateDisplay(value);
    if (typeof value === 'boolean') return value ? T('Evet', 'Yes') : T('Hayır', 'No');
    const number = E ? E.toNumber(value) : Number(value);
    if (number == null || !Number.isFinite(number)) return E ? E.toText(value) : String(value);
    const digits = decimals != null ? decimals
      : format === 'integer' ? 0
      : format === 'percent' ? 1
      : Number.isInteger(number) ? 0 : 2;
    const text = number.toLocaleString(en() ? 'en-GB' : 'tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    return format === 'percent' ? `${text}%` : text;
  }

  /* ---------------- sütun tanımları ---------------- */

  function columnKey(definition) { return `${COLUMN_KEY_PREFIX}${definition.id}`; }

  // Uygulamanın sütun listesine (CP_COLS / ORDERS_COLS / SHIP_COLS) formül
  // sütunlarını ekler. Mevcut sütunlar korunur; yalnız bizim eklediklerimiz
  // yenilenir.
  /* ---------------- sütun grubu (başlık bandı) ----------------

     v7.42 — Kullanıcı talebi (birebir): "sütun ve hesaplamalı sütun eklerken
     temel sütun başlığını da ayarlayabileyim. Şu an Calculated Column adı
     altında görünüyor, dilersem Order Info'ya dahil edebileyim, dilersem yeni
     alan adı yaratabileyim."

     Grup adı serbest metindir; tablo başlığı bandı zaten bilinmeyen bir adı da
     çizer (renk bilinmiyorsa varsayılan vurgu kullanılır). Ama BANDIN BİRLEŞMESİ
     sütun SIRASINA bağlıdır: başlık satırı, yan yana duran aynı gruplu sütunları
     tek bir bant yapar. Bu yüzden bir sütuna var olan bir grup verildiğinde
     sütun, o grubun SONUNA taşınır — yoksa ekranda ikinci bir "Order Info"
     bandı belirir ve kullanıcı "dahil edemedim" derdi. */
  const DEFAULT_GROUP = 'Hesaplanan';
  function definitionGroup(definition) {
    return clean(definition && definition.group) || DEFAULT_GROUP;
  }
  /* Grup listesi ve yerleştirme app-main.js'te TEK yerde durur (BLColumnGroups):
     veri tabanı sütunu ile hesaplanan sütun aynı davranışı paylaşır, iki ayrı
     kopya birbirinden ayrılamaz. */
  function existingGroups(tableKey) {
    const shared = window.BLColumnGroups;
    return shared && typeof shared.list === 'function' ? shared.list(tableKey) : [];
  }
  function placeInGroup(tableKey, key, group) {
    const shared = window.BLColumnGroups;
    if (shared && typeof shared.placeInGroup === 'function') shared.placeInGroup(tableKey, key, group);
  }

  function syncColumns(tableKey) {
    const cols = window.COLS_BY_TABLE && window.COLS_BY_TABLE[tableKey];
    const manager = window.colmgr && window.colmgr[tableKey];
    if (!cols || !manager) return [];
    const defs = definitions(tableKey);
    const base = cols.filter(col => !col.formulaCustom);
    const dynamic = defs.map(definition => {
      const column = {
        k: columnKey(definition),
        label: definition.label,
        // v7.42 — grup kullanıcının seçimidir; seçilmemişse eski varsayılan.
        type: 'formula',
        weight: 10,
        group: definitionGroup(definition),
        formulaCustom: true,
        formulaId: definition.id,
        formulaDef: definition,
        dataType: definition.format === 'date' ? 'date' : definition.format === 'percent' ? 'percentage' : definition.format === 'integer' ? 'integer' : undefined,
      };
      const resolver = window.resolveColumnSchema;
      const rows = window.BLFormulaRows && typeof window.BLFormulaRows[tableKey] === 'function' ? window.BLFormulaRows[tableKey]() : [];
      if (typeof resolver === 'function') column._blSchema = resolver(column, rows, column.metadata);
      return column;
    });
    cols.splice(0, cols.length, ...base, ...dynamic);
    if (typeof window.invalidateColumnIndex === 'function') window.invalidateColumnIndex(tableKey);
    const valid = cols.map(col => col.k);
    manager.order = manager.order.filter(key => valid.includes(key));
    dynamic.forEach(col => {
      const isNew = !manager.order.includes(col.k);
      if (isNew) manager.order.push(col.k);
      /* Sıra YALNIZ sütun yeni eklendiğinde ya da grubu değiştiğinde kurulur;
         her eşitlemede taşımak, kullanıcının elle sürüklediği sırayı bozardı. */
      const placed = col.formulaDef && col.formulaDef._placedGroup;
      if (isNew || nameKey(placed || '') !== nameKey(col.group)) {
        placeInGroup(tableKey, col.k, col.group);
        rememberPlacedGroup(tableKey, col.formulaId, col.group);
      }
    });
    manager.hidden = new Set([...manager.hidden].filter(key => valid.includes(key)));
    return dynamic;
  }
  // Sütunun en son hangi grup için yerleştirildiğini tanımın yanında saklar.
  function rememberPlacedGroup(tableKey, id, group) {
    const list = definitions(tableKey);
    const item = list.find(entry => entry.id === id);
    if (!item || nameKey(item._placedGroup || '') === nameKey(group)) return;
    item._placedGroup = group;
    save(tableKey, list);
  }

  /* ---------------- hesaplama ---------------- */

  const compiledCache = new Map();
  function compiled(definition) {
    const cacheKey = `${definition.id}|${definition.formula}`;
    if (!compiledCache.has(cacheKey)) {
      const E = engine();
      compiledCache.set(cacheKey, E ? E.compile(definition.formula) : null);
      if (compiledCache.size > 200) compiledCache.clear();
    }
    return compiledCache.get(cacheKey);
  }

  /* Satırlara hesaplanan değerleri yazar.

     Değer HAM olarak yazılır (sayı / Date / metin); biçimlendirme çizim
     anında yapılır. Böylece sıralama sayıyı sayı gibi sıralar, Excel'e sayı
     olarak gider ve sayfa filtreleri doğru çalışır. */
  function applyToRows(tableKey, rows) {
    const list = Array.isArray(rows) ? rows : [];
    const defs = definitions(tableKey);
    if (!defs.length || !list.length || !engine()) return { applied: 0, errors: {} };
    const errors = {};
    /* v7.31 — hesaplanan sütunlar birbirine dayanabildiği için BAĞIMLILIK
       SIRASINA göre işlenir: "Gecikme" sütunu "Üretim Süresi"ne dayanıyorsa
       önce o hesaplanır, yoksa boş okurdu. Çevrime girenler hiç hesaplanmaz. */
    const alias = aliasMap(defs);
    const { ordered, cyclic } = orderedDefinitions(defs);
    for (const id of cyclic) {
      const definition = defs.find(item => item.id === id);
      if (!definition) continue;
      errors[id] = T('Döngü: bu sütun kendine dönen bir zincirin parçası, hesaplanamaz.',
        'Loop: this column is part of a chain that refers back to itself and cannot be calculated.');
      const cycleKey = columnKey(definition);
      for (const row of list) row[cycleKey] = null;
    }
    /* Hesaplanan sütuna formülde ADIYLA başvurulur; satırdaki gerçek anahtar
       __f_fc_... olduğu için ad burada çözülür. Önce satırın kendi alanına
       bakılır: aynı adı taşıyan gerçek bir veri sütunu varsa davranış
       değişmez. */
    /* v7.33 — "Sütun Ekle" ile eklenen ASAS/IAS sütunları da adıyla çözülür;
       satırdaki anahtarları __CPX_... olduğu için formülde okunur bir ad
       kullanılabilsin diye. Sıra önemlidir: satırın kendi alanı > hesaplanan
       sütun > veri tabanı sütunu. Aynı adı taşıyan gerçek bir veri sütunu
       varsa davranış hiç değişmez. */
    const modelAlias = modelAliasMap(tableKey);
    const lookup = (name, row) => {
      if (row && Object.prototype.hasOwnProperty.call(row, name)) return row[name];
      const key = nameKey(name);
      const aliasedKey = alias.get(key) || modelAlias.get(key);
      if (aliasedKey && row && Object.prototype.hasOwnProperty.call(row, aliasedKey)) return row[aliasedKey];
      return undefined;
    };
    for (const definition of ordered) {
      const program = compiled(definition);
      const key = columnKey(definition);
      if (!program || !program.ok) {
        const message = program && program.error ? program.error.message : T('Formül geçersiz.', 'Invalid formula.');
        errors[definition.id] = message;
        for (const row of list) row[key] = null;
        continue;
      }
      /* Kaç satırda hesaplanamadığı SAYILIR. Gerçek veride bir formül çoğu
         satırda çalışıp birkaçında (boş tarih, eksik hücre) çalışmayabilir;
         "hata var" demek o sütunu bütünüyle bozukmuş gibi gösterirdi. Kullanıcı
         "10.864 satırın 23'ünde hesaplanamadı" ile ne olduğunu görür. */
      let failed = 0;
      let firstError = '';
      for (const row of list) {
        const result = program.evaluate(row, { strictColumns: true, lookup });
        if (result.ok) {
          row[key] = result.value instanceof Date ? engine().dateText(result.value) : result.value;
        } else {
          row[key] = null;
          failed++;
          if (!firstError) firstError = result.error;
        }
      }
      if (failed) {
        errors[definition.id] = failed === list.length
          ? firstError
          : T(`${list.length.toLocaleString('tr-TR')} satırın ${failed.toLocaleString('tr-TR')} tanesinde hesaplanamadı: ${firstError}`,
              `Could not be calculated on ${failed.toLocaleString('en-GB')} of ${list.length.toLocaleString('en-GB')} rows: ${firstError}`);
      }
    }
    return { applied: defs.length, errors };
  }

  /* Son hesaplamanın hata özeti. Tanım başına TEK giriş tutulur ve her
     hesaplamada o tanımın girişi tazelenir; hata giderildiğinde eski uyarının
     ekranda asılı kalmaması için silinir. */
  let lastErrors = {};
  function refresh(tableKey, rows) {
    const result = applyToRows(tableKey, rows);
    for (const definition of definitions(tableKey)) {
      if (result.errors[definition.id]) lastErrors[definition.id] = result.errors[definition.id];
      else delete lastErrors[definition.id];
    }
    return result;
  }
  function errorFor(id) { return lastErrors[id] || ''; }

  /* ---------------- kaynak sütun listesi ---------------- */

  // Formülde kullanılabilecek sütunlar: tablonun kendi sütunları (formül
  // sütunları dâhil değil — kendine gönderme yapan bir formül sonsuz döngüdür).
  /* Formülde kullanılabilecek sütunlar.

     v7.31 — HESAPLANAN SÜTUNLAR DA LİSTEYE GİRER. Önce dışarıda
     bırakılmışlardı, çünkü kendine gönderme yapan bir formül sonsuz döngüdür.
     Ama kullanıcı haklı: bir hesaplamanın üzerine ikincisini kurmak (ör.
     "Üretim Süresi"nden "Gecikme" üretmek) doğal bir istek. Döngü artık
     yasaklanmak yerine TESPİT ediliyor (bkz. orderedDefinitions).

     Düzenlenmekte olan sütun listeden çıkarılır: kendine gönderme kurmanın tek
     doğrudan yolu buydu.

     Hesaplanan sütuna formülde ADIYLA başvurulur ([Üretim Süresi]); iç anahtar
     (__f_fc_...) kullanıcıya hiç gösterilmez. */
  function sourceColumns(tableKey, excludeId) {
    const cols = (window.COLS_BY_TABLE && window.COLS_BY_TABLE[tableKey]) || [];
    const seen = new Set();
    const out = [];
    for (const col of cols) {
      if (!col || !col.k) continue;
      if (col.formulaCustom) {
        if (!col.formulaId || col.formulaId === excludeId) continue;
        const name = String(col.label || '').trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        out.push({ key: name, label: name, calculated: true });
        continue;
      }
      /* v7.33 — "SÜTUN EKLE" İLE EKLENEN VERİ TABANI SÜTUNLARI DA LİSTEDE.
         Kullanıcının bildirdiği kusur buydu: ASAS/IAS'tan eklenen sütunlar
         burada hiç görünmüyordu. Sebep, bu sütunların satır anahtarının
         sunucuda "__CPX_<id>" olarak üretilmesi ve aşağıdaki "__ ile başlayan
         her şeyi atla" kuralının onları da elemesiydi. Kural iç yardımcı
         alanları (görsel, en iyi fiyat gibi) elemek için vardı; veri tabanı
         sütunu iç alan değil, kullanıcının kendi eklediği gerçek bir sütun.
         Formülde İÇ ANAHTARLA değil ADIYLA anılır ([Üretici Kodu]); anahtar
         çözümü applyToRows içindeki modelAliasMap ile yapılır. */
      if (col.modelCustom) {
        const name = String(col.label || '').trim();
        if (!name || seen.has(nameKey(name))) continue;
        seen.add(nameKey(name));
        out.push({ key: name, label: name, model: true, source: modelSourceLabel(col) });
        continue;
      }
      if (String(col.k).startsWith('__')) continue;
      if (seen.has(col.k)) continue;
      seen.add(col.k);
      const label = typeof window.tableColumnLabel === 'function' ? window.tableColumnLabel(tableKey, col) : (col.label || col.k);
      out.push({ key: col.k, label: label || col.k });
    }
    return out.sort((a, b) => String(a.label).localeCompare(String(b.label), 'tr', { sensitivity: 'base' }));
  }

  // Veri tabanı sütununun hangi kaynaktan geldiği. Kullanıcı ASAS ile
  // IAS/Antrepo'yu ayırt edebilmeli; ikisi aynı adı taşıyabilir.
  function modelSourceLabel(col) {
    const role = String(col && col.role || '').toLowerCase();
    if (role === 'antrepo') return T('IAS · Antrepo', 'IAS · Bonded');
    if (role === 'asas') return 'ASAS';
    return T('Veri tabanı', 'Database');
  }

  /* Veri tabanı sütunu ADI → satırdaki gerçek anahtar (__CPX_...).
     Hesaplanan sütunlardaki aliasMap ile aynı işi görür. */
  function modelAliasMap(tableKey) {
    const cols = (window.COLS_BY_TABLE && window.COLS_BY_TABLE[tableKey]) || [];
    const map = new Map();
    for (const col of cols) {
      if (!col || !col.modelCustom || !col.k) continue;
      const label = nameKey(col.label);
      if (label && !map.has(label)) map.set(label, col.k);
    }
    return map;
  }

  /* ---------------- hesaplanan sütunlar arası bağımlılık ---------------- */

  const nameKey = value => String(value == null ? '' : value).trim().toLocaleLowerCase('tr-TR');

  // Hesaplanan sütun ADI → satırdaki anahtar. [Üretim Süresi] yazan kullanıcı
  // aslında row['__f_fc_a'] değerini okur.
  function aliasMap(defs) {
    const map = new Map();
    for (const definition of defs) {
      const label = nameKey(definition.label);
      if (label && !map.has(label)) map.set(label, columnKey(definition));
    }
    return map;
  }

  // Bir tanımın hangi HESAPLANAN sütunlara dayandığı.
  function dependenciesOf(definition, defs) {
    const program = compiled(definition);
    if (!program || !program.ok || !Array.isArray(program.columns)) return [];
    const byLabel = new Map(defs.map(item => [nameKey(item.label), item.id]));
    const byKey = new Map(defs.map(item => [columnKey(item), item.id]));
    const out = new Set();
    for (const name of program.columns) {
      const id = byLabel.get(nameKey(name)) || byKey.get(String(name).trim());
      /* KENDİNE GÖNDERME DE BAĞIMLILIKTIR. Dışarıda bırakılırsa "Z = [Z] + 1"
         çevrim sayılmaz; değer bir önceki yenilemenin sonucundan okunur ve her
         yenilemede sessizce büyür. Kilitlenme olmaz ama sayı yanlıştır — bu
         daha kötüsüdür. */
      if (id) out.add(id);
    }
    return [...out];
  }

  /* Bağımlılık sırası + ÇEVRİM TESPİTİ.
     A, B'ye; B de A'ya dayanıyorsa hiçbir sıra doğru değildir. Böyle sütunlar
     hesaplanmaz ve sebebi yazılır — sessizce eksik değer üretmek ya da
     tarayıcıyı kilitlemek yerine. */
  function orderedDefinitions(defs) {
    const byId = new Map(defs.map(item => [item.id, item]));
    const deps = new Map(defs.map(item => [item.id, dependenciesOf(item, defs).filter(id => byId.has(id))]));
    const state = new Map(); // 0 = işleniyor, 1 = bitti
    const ordered = [];
    const cyclic = new Set();
    const visit = (id, stack) => {
      if (state.get(id) === 1) return;
      if (state.get(id) === 0) { // yığında geri dönüş = çevrim
        const from = stack.indexOf(id);
        (from >= 0 ? stack.slice(from) : stack).forEach(item => cyclic.add(item));
        cyclic.add(id);
        return;
      }
      state.set(id, 0);
      for (const next of deps.get(id) || []) visit(next, [...stack, id]);
      state.set(id, 1);
      ordered.push(byId.get(id));
    };
    for (const item of defs) visit(item.id, []);
    return { ordered: ordered.filter(item => item && !cyclic.has(item.id)), cyclic };
  }

  /* Önizleme satırları. Tabloların satır dizileri app-main.js içinde farklı
     yerlerde durur (state.cp.rows / state.orders.rows / shipRows). Tek tek
     erişmek yerine app-main.js orada window.BLFormulaRows sağlayıcısını
     yayımlar; burada yalnız onu okuruz. */
  function tableRows(tableKey) {
    const provider = window.BLFormulaRows && window.BLFormulaRows[tableKey];
    if (typeof provider === 'function') {
      try { const rows = provider(); return Array.isArray(rows) ? rows : []; } catch (_) { return []; }
    }
    const state = window.state || {};
    const source = state[tableKey] && state[tableKey].rows;
    return Array.isArray(source) ? source : [];
  }
  function sampleRows(tableKey, count = 5) { return tableRows(tableKey).slice(0, count); }

  /* ---------------- KURUCU (formül yazmadan sütun kurma) ----------------

     Kullanıcı geri bildirimi (birebir): "formülleri bu şekilde kod gibi yazmak
     kullanıcı dostu değil, exceldeki gibi matematik işlemleri ile belirtmek
     daha basit olacak."

     Bu yüzden pencere artık ÜÇ kipte açılır ve varsayılan kip formül yazmayı
     hiç gerektirmez:

       · HESAPLAMA  — [sütun] [işlem] [sütun] [işlem] … kutuları. İşlem
         listesi + − × ÷; operandlar sütun ya da elle yazılan sabit sayı.
       · BİRLEŞTİRME — seçilen sütunları araya AYRAÇ koyarak birleştirir.
       · GELİŞMİŞ    — eski formül kutusu; fonksiyonların tamamı burada.

     Depoda saklanan şey yine FORMÜL METNİDİR. Kurucu yalnız o metni üretir.
     Sebebi: tek bir hesaplama yolu kalsın. İki ayrı yürütücü (biri kurucu
     için, biri formül için) olsaydı ikisi zamanla birbirinden ayrılır ve aynı
     sütun iki farklı sonuç verirdi. Düzenlemeye açarken metin geri
     ÇÖZÜMLENİR (motorun kendi ayrıştırıcısıyla, tahminle değil); kurucuya
     sığmayan bir formül Gelişmiş kipte açılır. */

  const OPERATORS = [
    { op: '+', sign: '+', tr: 'topla', en: 'add' },
    { op: '-', sign: '−', tr: 'çıkar', en: 'subtract' },
    { op: '*', sign: '×', tr: 'çarp', en: 'multiply' },
    { op: '/', sign: '÷', tr: 'böl', en: 'divide' },
  ];
  const SEPARATORS = [
    { value: ' - ', tr: 'tire', en: 'dash' },
    { value: ' / ', tr: 'eğik çizgi', en: 'slash' },
    { value: ' · ', tr: 'nokta', en: 'dot' },
    { value: ' ', tr: 'boşluk', en: 'space' },
    { value: ', ', tr: 'virgül', en: 'comma' },
    { value: ' | ', tr: 'dik çizgi', en: 'pipe' },
  ];
  const NUMBER_OPERAND = '__fc_number__';
  // v7.42 — "yeni başlık" seçeneği; bir grup adıyla çakışmasın diye eğik yazım.
  const NEW_GROUP = '__fc_new_group__';

  function quoteText(text) { return `"${String(text == null ? '' : text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`; }
  function operandExpression(operand) {
    if (!operand) return '';
    if (operand.kind === 'number') {
      const raw = clean(operand.number).replace(',', '.');
      return raw === '' || !Number.isFinite(Number(raw)) ? '' : String(Number(raw));
    }
    return operand.column ? `[${operand.column}]` : '';
  }

  /* Kutulardan formül metni üretir.

     PARANTEZ BİLEREK KONUR. Kutular soldan sağa okunur; ama matematikte × ve ÷
     önce işlenir. "A − B × 2" kutu sırasına göre (A−B)×2 beklenirken
     A−(B×2) hesaplanırdı — kullanıcının göremeyeceği, sessiz bir fark. Her
     adım parantezlenerek kutu sırası ile hesap sırası aynı tutulur, ve üretilen
     formül pencerede AÇIKÇA gösterilir. */
  function calcFormula(builder) {
    const operands = (builder.operands || []).map(operandExpression);
    if (!operands.length || !operands[0]) return '';
    let expression = operands[0];
    for (let index = 1; index < operands.length; index++) {
      if (!operands[index]) return '';
      const op = (builder.operators || [])[index - 1] || '+';
      expression = `(${expression} ${op} ${operands[index]})`;
    }
    return expression;
  }
  function joinFormula(builder) {
    const columns = (builder.columns || []).filter(Boolean);
    if (!columns.length) return '';
    const separator = builder.separator == null ? ' - ' : builder.separator;
    const args = columns.map(key => `[${key}]`).join(', ');
    if (columns.length === 1) return `TEXT([${columns[0]}])`;
    return `TEXTJOIN(${quoteText(separator)}, ${builder.skipEmpty === false ? 'false' : 'true'}, ${args})`;
  }
  function builderFormula(builder) {
    if (!builder) return '';
    if (builder.mode === 'calc') return calcFormula(builder);
    if (builder.mode === 'join') return joinFormula(builder);
    return clean(builder.advanced);
  }

  /* Formül metnini kutulara geri çözer. Motorun kendi ayrıştırıcısı kullanılır;
     düzenli ifadeyle tahmin etmek, kullanıcının formülünü sessizce yanlış
     göstermenin en kolay yoludur. Sığmıyorsa null döner → Gelişmiş kip. */
  function builderFromFormula(source) {
    const text = clean(source);
    if (!text) return null;
    const E = engine();
    if (!E) return null;
    const program = E.compile(text);
    if (!program.ok || !program.ast) return null;
    const ast = program.ast;

    if (ast.kind === 'call' && (ast.name === 'TEXTJOIN' || ast.name === 'BIRLESTIR') && ast.args.length >= 3) {
      const [separator, skip, ...rest] = ast.args;
      if (separator.kind !== 'string' || skip.kind !== 'boolean') return null;
      if (!rest.every(node => node.kind === 'column')) return null;
      return { mode: 'join', columns: rest.map(node => node.name), separator: separator.value, skipEmpty: skip.value };
    }
    if (ast.kind === 'call' && ast.name === 'TEXT' && ast.args.length === 1 && ast.args[0].kind === 'column') {
      return { mode: 'join', columns: [ast.args[0].name], separator: ' - ', skipEmpty: true };
    }

    const operands = [];
    const operators = [];
    const leaf = node => {
      if (node.kind === 'column') return { kind: 'column', column: node.name, number: '' };
      if (node.kind === 'number') return { kind: 'number', column: '', number: String(node.value) };
      return null;
    };
    const walk = node => {
      if (node.kind === 'binary' && OPERATORS.some(item => item.op === node.op)) {
        if (!walk(node.left)) return false;
        const right = leaf(node.right);
        if (!right) return false;
        operators.push(node.op);
        operands.push(right);
        return true;
      }
      const only = leaf(node);
      if (!only || operands.length) return false;
      operands.push(only);
      return true;
    };
    if (!walk(ast) || operands.length < 1) return null;
    return { mode: 'calc', operands, operators };
  }

  /* ---------------- pencere ---------------- */

  let modal = null;
  function close() { modal?.remove(); modal = null; document.removeEventListener('keydown', onKey, true); }
  function onKey(event) {
    if (event.key !== 'Escape' || !modal) return;
    event.preventDefault(); event.stopImmediatePropagation();
    close();
  }

  function open(tableKey, editId, onDone) {
    if (!TABLES[tableKey]) return;
    if (!engine()) { toast(T('Formül motoru yüklenemedi.', 'The formula engine could not be loaded.')); return; }
    close();
    const defs = definitions(tableKey);
    const existing = editId ? defs.find(item => item.id === editId) : null;
    const draft = existing ? { ...existing } : {
      id: `fc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      label: '', formula: '', format: 'auto', decimals: '',
    };
    // Düzenlenen sütun kendi listesinde görünmez: kendine gönderme çevrimdir.
    let columns = sourceColumns(tableKey, existing ? existing.id : null);

    /* Açılış kipi: yeni sütunda HESAPLAMA, düzenlemede formülün geri çözülmüş
       hâli, çözülemiyorsa GELİŞMİŞ. */
    const restored = existing ? builderFromFormula(existing.formula) : null;
    const builder = restored || (existing
      ? { mode: 'advanced', advanced: existing.formula }
      : { mode: 'calc', operands: [{ kind: 'column', column: '', number: '' }, { kind: 'column', column: '', number: '' }], operators: ['-'] });
    if (builder.mode === 'calc' && !builder.operands.length) builder.operands = [{ kind: 'column', column: '', number: '' }];
    builder.advanced = builder.advanced != null ? builder.advanced : (existing ? existing.formula : '');
    if (builder.mode === 'join' && builder.separator == null) builder.separator = ' - ';

    /* v7.42 — üst başlık seçenekleri. Tabloda var olan gruplar EKRANDAKİ sırayla
       listelenir; varsayılan "Hesaplanan" listede yoksa eklenir ki yeni sütun
       eski davranışını seçenek olarak korusun. */
    const draftGroup = definitionGroup(draft);
    const groupChoices = existingGroups(tableKey);
    if (!groupChoices.some(group => nameKey(group) === nameKey(DEFAULT_GROUP))) groupChoices.push(DEFAULT_GROUP);
    /* Kayıtlı sütunun grubu zaten sütun listesinde olduğu için normalde
       seçenektedir; değilse pencere "yeni başlık" kipinde ve adı yazılı açılır —
       kullanıcının verdiği ad sessizce kaybolmasın (§142). */
    const isNewGroup = !groupChoices.some(group => nameKey(group) === nameKey(draftGroup));

    modal = document.createElement('div');
    modal.id = '_formulaColumnModal';
    modal.className = 'warnOverlay fcOverlay';
    modal.innerHTML = `<div class="modalCard fcCard" role="dialog" aria-modal="true" aria-labelledby="_fcTitle">
      <div class="fcHead">
        <div>
          <div class="modalTitle" id="_fcTitle">${esc(existing ? T('Hesaplanan sütunu düzenle', 'Edit calculated column') : T('Hesaplanan sütun ekle', 'Add calculated column'))}</div>
          <p class="fcSub">${esc(T(
            `${en() ? TABLES[tableKey].en : TABLES[tableKey].tr} tablosuna, diğer sütunlardan hesaplanan yeni bir sütun ekler. Yalnız sizin ekranınızda görünür.`,
            `Adds a column to the ${TABLES[tableKey].en} table, calculated from other columns. It appears only on your screen.`,
          ))}</p>
        </div>
        <button type="button" class="pricingRuleIconBtn" data-fc-close aria-label="${esc(T('Kapat', 'Close'))}">✕</button>
      </div>
      <div class="fcBody">
        <!-- Başlık iki dilde girilir; formül referansları için kimlik TR (yoksa EN) başlıktır. -->
        <div class="fcFormatRow">
          <label class="fcField">${esc(T('İngilizce başlık (EN)', 'English heading (EN)'))}
            <input type="text" data-fc-label-en maxlength="60" value="${esc(draft.labelEn || draft.label)}" placeholder="${esc(T('Örn. Lead time (days)', 'e.g. Lead time (days)'))}" autocomplete="off">
          </label>
          <label class="fcField">${esc(T('Türkçe başlık (TR)', 'Turkish heading (TR)'))}
            <input type="text" data-fc-label maxlength="60" value="${esc(draft.labelTr || draft.label)}" placeholder="${esc(T('Örn. Üretim Süresi (gün)', 'e.g. Üretim Süresi (gün)'))}" autocomplete="off">
          </label>
        </div>
        <!-- v7.42 — ÜST BAŞLIK (BANT) SEÇİMİ. Sütun, seçilen grubun sonuna
             taşınır; bant birleşmesi bitişikliğe bağlı olduğu için taşımadan
             "Order Info" demek ikinci bir Order Info bandı üretirdi. -->
        <div class="fcFormatRow">
          <label class="fcField">${esc(T('Üst başlık (grup)', 'Heading group'))}
            <select data-fc-group>
              ${groupChoices.map(group => `<option value="${esc(group)}"${nameKey(group) === nameKey(draftGroup) ? ' selected' : ''}>${esc(group)}</option>`).join('')}
              <option value="${NEW_GROUP}"${isNewGroup ? ' selected' : ''}>${esc(T('＋ Yeni başlık oluştur…', '＋ Create a new heading…'))}</option>
            </select>
          </label>
          <label class="fcField" data-fc-group-new-wrap${isNewGroup ? '' : ' hidden'}>${esc(T('Yeni başlık adı', 'New heading name'))}
            <input type="text" data-fc-group-new maxlength="40" value="${esc(isNewGroup ? draftGroup : '')}" placeholder="${esc(T('Örn. Üretim Takibi', 'e.g. Production'))}" autocomplete="off">
          </label>
        </div>
        <p class="fcNote">${esc(T(
          'Sütun, seçtiğiniz başlığın en sonuna yerleştirilir; böylece tablo üstünde o başlığın altında görünür.',
          'The column is placed at the end of the heading you pick, so it appears under that heading in the table.',
        ))}</p>
        <div class="fcModes" data-bl-tabs="segment" role="tablist" aria-label="${esc(T('Formül oluşturma yöntemi', 'Formula building method'))}">
          ${[['calc', T('Hesaplama', 'Calculation'), T('+ − × ÷ ile sütunlar arası işlem', 'Arithmetic across columns with + − × ÷')],
             ['join', T('Birleştirme', 'Join'), T('Sütunları ayraçla tek hücrede toplar', 'Joins columns into one cell with a separator')],
             ['advanced', T('Gelişmiş', 'Advanced'), T('Formülü elle yazın (tüm fonksiyonlar)', 'Type the formula yourself (all functions)')]]
            .map(([id, label, tip]) => `<button type="button" id="fcMode-${id}" role="tab" class="fcMode${builder.mode === id ? ' active' : ''}" data-fc-mode="${id}" title="${esc(tip)}" aria-controls="fcModePanel" aria-selected="${builder.mode === id}" tabindex="${builder.mode === id ? '0' : '-1'}">${esc(label)}</button>`).join('')}
        </div>
        <div class="fcBuild" id="fcModePanel" data-fc-build role="tabpanel" aria-labelledby="fcMode-${builder.mode}" tabindex="0"></div>
        <div class="fcSourceAdd" data-fc-source-add></div>
        <div class="fcFormatRow">
          <label class="fcField">${esc(T('Biçim', 'Format'))}
            <select data-fc-format>${Object.entries(FORMATS).map(([id, item]) => `<option value="${id}"${draft.format === id ? ' selected' : ''}>${esc(en() ? item.en : item.tr)}</option>`).join('')}</select>
          </label>
          <label class="fcField">${esc(T('Ondalık basamak', 'Decimals'))}
            <input type="number" min="0" max="6" data-fc-decimals value="${esc(draft.decimals)}" placeholder="${esc(T('otomatik', 'auto'))}">
          </label>
        </div>
        <div class="fcEcho" data-fc-echo hidden></div>
        <div class="fcPreview" data-fc-preview></div>
        <details class="fcHelp">
          <summary>${esc(T('Kullanılabilir fonksiyonlar', 'Available functions'))}</summary>
          <p class="fcNote">${esc(T(
            'Bunları bilmeniz gerekmez — Hesaplama ve Birleştirme kipleri formülü sizin yerinize kurar. Elle yazmak isterseniz: sütun adları köşeli parantez içinde yazılır ([Ex-factory]), ondalık ayırıcı noktadır (virgül argümanları ayırır), iki tarih sütununu çıkarınca sonuç GÜN farkı olur.',
            'You do not need these — the Calculation and Join modes build the formula for you. If you would rather type it: column names go in square brackets ([Ex-factory]), the decimal separator is a dot (a comma separates arguments), and subtracting two date columns gives a DAY difference.',
          ))}</p>
          <ul class="fcHelpList">${(engine().FUNCTION_HELP || []).map(item => `<li><code>${esc(item.name)}</code> — ${esc(en() ? item.en : item.tr)}</li>`).join('')}</ul>
        </details>
      </div>
      <div class="fcFoot">
        ${existing ? `<button type="button" class="fcBtn fcDanger" data-fc-delete>${esc(T('Sütunu sil', 'Delete column'))}</button>` : ''}
        <span style="flex:1"></span>
        <button type="button" class="fcBtn" data-fc-close>${esc(T('Vazgeç', 'Cancel'))}</button>
        <button type="button" class="fcBtn fcPrimary" data-fc-save>${esc(T('Kaydet', 'Save'))}</button>
      </div>
    </div>`;
    document.body.appendChild(modal);

    const labelInput = modal.querySelector('[data-fc-label]');
    const labelEnInput = modal.querySelector('[data-fc-label-en]');
    const formatInput = modal.querySelector('[data-fc-format]');
    const decimalsInput = modal.querySelector('[data-fc-decimals]');
    const groupInput = modal.querySelector('[data-fc-group]');
    const groupNewInput = modal.querySelector('[data-fc-group-new]');
    const groupNewWrap = modal.querySelector('[data-fc-group-new-wrap]');
    // Seçilen üst başlık: listeden bir grup ya da elle yazılan yeni ad.
    const chosenGroup = () => (groupInput.value === NEW_GROUP ? clean(groupNewInput.value) : clean(groupInput.value));
    const preview = modal.querySelector('[data-fc-preview]');
    const build = modal.querySelector('[data-fc-build]');
    const sourceAdd = modal.querySelector('[data-fc-source-add]');

    /* v7.33 — TABLONUN DIŞINDAN SÜTUN GETİRME.

       Kullanıcı talebi: "Add calculated column alanında tablonun dışında
       ASAS'dan ve IAS - ANTREPO'dan da sütun ekleyebilmek istiyorum."

       Bunu yapan akış zaten var (Sütunlar panelindeki "Sütun Ekle"); ikinci bir
       kopyasını yazmak, iki ayrı yerde bakımı gereken iki ayrı tanım demekti.
       Buradaki düğme AYNI pencereyi açar; kaydedildiğinde kaynak listesi
       yerinde tazelenir, kullanıcı formül penceresini kapatmak zorunda kalmaz.

       Yetki SUNUCUDA (§32): veri tabanı sütunu ortak Data Model bağlantısına
       yazılır ve yalnız manageModelConnections yetkisi olan kullanıcı
       kaydedebilir. Düğme yetkisiz kullanıcıya gösterilmez; yerine sebebi
       yazılır — tıklayıp 403 almak, ne yapması gerektiğini söylemez. */
    const canAddModelColumn = () => tableKey !== 'ship'
      && typeof window.openCpModelColumnModal === 'function'
      && (typeof window.BLHasPermission !== 'function' || window.BLHasPermission('manageModelConnections'));

    function renderSourceAdd() {
      if (!sourceAdd) return;
      if (tableKey === 'ship') { sourceAdd.innerHTML = ''; return; }
      const modelCount = columns.filter(col => col.model).length;
      const summary = modelCount
        ? T(`${modelCount} veri tabanı sütunu kaynak listesinde kullanılabilir.`,
            `${modelCount} database column${modelCount === 1 ? '' : 's'} available in the source list.`)
        : T('Kaynak listesinde henüz veri tabanı sütunu yok.', 'No database column is in the source list yet.');
      sourceAdd.innerHTML = canAddModelColumn()
        ? `<button type="button" class="fcMini fcMiniAdd" data-fc-add-model>+ ${esc(T('ASAS / IAS-Antrepo\'dan sütun getir', 'Bring a column from ASAS / IAS-Bonded'))}</button>
           <span class="fcNote fcSourceNote">${esc(summary)} ${esc(T('Yeni getirilen sütunun DEĞERLERİ ilk CP yenilemesinde dolar.', 'The VALUES of a newly added column arrive with the next CP refresh.'))}</span>`
        : `<span class="fcNote fcSourceNote">${esc(summary)} ${esc(T('Tabloya ASAS/IAS sütunu eklemek Data Model bağlantısı yetkisi ister; Moderatörünüzden isteyebilirsiniz.', 'Adding an ASAS/IAS column needs the Data Model connection permission; ask your Moderator.'))}</span>`;
      sourceAdd.querySelector('[data-fc-add-model]')?.addEventListener('click', () => {
        window.openCpModelColumnModal(null, () => {
          // Pencere açık kalır; kaynak listesi yeni sütunla yeniden kurulur.
          columns = sourceColumns(tableKey, existing ? existing.id : null);
          renderBuild();
          renderPreview();
          renderSourceAdd();
        });
      });
    }

    // v7.33 — sütunun nereden geldiği yazılır: hesaplanan mı, ASAS/IAS'tan mı.
    const optionLabel = col => (col.calculated ? `${col.label} (${T('hesaplanan', 'calculated')})`
      : col.model ? `${col.label} (${col.source})` : col.label);
    const columnOptions = (selected, kind) => `<option value="">${esc(T('Sütun seçin…', 'Pick a column…'))}</option>`
      + columns.map(col => `<option value="${esc(col.key)}"${kind !== 'number' && selected === col.key ? ' selected' : ''}>${esc(optionLabel(col))}</option>`).join('')
      + `<option value="${NUMBER_OPERAND}"${kind === 'number' ? ' selected' : ''}>${esc(T('— sabit sayı yaz —', '— type a fixed number —'))}</option>`;

    function renderBuild() {
      if (builder.mode === 'calc') {
        const rows = builder.operands.map((operand, index) => `
          ${index ? `<select class="fcOpSel" data-fc-operator="${index - 1}" aria-label="${esc(T('İşlem', 'Operation'))}">${OPERATORS.map(item => `<option value="${item.op}"${(builder.operators[index - 1] || '+') === item.op ? ' selected' : ''}>${item.sign}</option>`).join('')}</select>` : ''}
          <span class="fcOperand">
            <select data-fc-operand="${index}">${columnOptions(operand.column, operand.kind)}</select>
            ${operand.kind === 'number' ? `<input type="text" class="fcOperandNum" data-fc-operand-number="${index}" value="${esc(operand.number)}" placeholder="${esc(T('sayı', 'number'))}" inputmode="decimal" autocomplete="off">` : ''}
            ${builder.operands.length > 1 ? `<button type="button" class="fcMini fcMiniDrop" data-fc-operand-drop="${index}" title="${esc(T('Kaldır', 'Remove'))}">×</button>` : ''}
          </span>`).join('');
        build.innerHTML = `<div class="fcCalcRow">${rows}
            <button type="button" class="fcMini fcMiniAdd" data-fc-operand-add>+ ${esc(T('işlem', 'operation'))}</button>
          </div>
          <p class="fcNote">${esc(T(
            'İşlemler soldan sağa uygulanır. İki TARİH sütununu − ile çıkarırsanız sonuç GÜN farkıdır. Yüzde için: [A] ÷ [B] × 100.',
            'Operations apply left to right. Subtracting two DATE columns with − gives a DAY difference. For a percentage: [A] ÷ [B] × 100.',
          ))}</p>`;
      } else if (builder.mode === 'join') {
        const list = builder.columns.length
          ? builder.columns.map((key, index) => `<div class="fcJoinRow">
              <span class="fcJoinNo">${index + 1}</span>
              <select data-fc-join="${index}">${columnOptions(key, 'column')}</select>
              <button type="button" class="fcMini" data-fc-join-up="${index}"${index === 0 ? ' disabled' : ''} title="${esc(T('Yukarı', 'Move up'))}">↑</button>
              <button type="button" class="fcMini" data-fc-join-down="${index}"${index === builder.columns.length - 1 ? ' disabled' : ''} title="${esc(T('Aşağı', 'Move down'))}">↓</button>
              <button type="button" class="fcMini fcMiniDrop" data-fc-join-drop="${index}" title="${esc(T('Kaldır', 'Remove'))}">×</button>
            </div>`).join('')
          : `<p class="fcNote">${esc(T('Henüz sütun eklenmedi.', 'No columns added yet.'))}</p>`;
        const custom = SEPARATORS.every(item => item.value !== builder.separator);
        build.innerHTML = `<div class="fcJoinList">${list}</div>
          <button type="button" class="fcMini fcMiniAdd" data-fc-join-add>+ ${esc(T('sütun ekle', 'add column'))}</button>
          <div class="fcSepRow">
            <span class="fcSepLabel">${esc(T('Ayraç', 'Separator'))}</span>
            ${SEPARATORS.map(item => `<button type="button" class="fcChip${builder.separator === item.value ? ' active' : ''}" data-fc-separator="${esc(item.value)}">${esc(item.value.trim() || '␣')}<small>${esc(en() ? item.en : item.tr)}</small></button>`).join('')}
            <input type="text" class="fcSepCustom${custom ? ' active' : ''}" data-fc-separator-custom value="${esc(custom ? builder.separator : '')}" maxlength="12" placeholder="${esc(T('özel…', 'custom…'))}" autocomplete="off">
          </div>
          <label class="fcCheck"><input type="checkbox" data-fc-skip-empty${builder.skipEmpty === false ? '' : ' checked'}> ${esc(T('Boş hücreleri atla', 'Skip blank cells'))}</label>
          <p class="fcNote">${esc(T(
            'Boş hücreleri atlamak açıkken aradaki bir sütun boşsa ayraç çift kalmaz. Kapalıyken boş hücre de bir alan olarak yerini korur.',
            'With skip-blanks on, a blank column in the middle does not leave a doubled separator. With it off, a blank cell keeps its place.',
          ))}</p>`;
      } else {
        build.innerHTML = `<label class="fcField">${esc(T('Formül', 'Formula'))}
            <textarea data-fc-formula rows="3" spellcheck="false" placeholder="${esc('DAYS([Ex-factory], [Retail Date])')}">${esc(builder.advanced)}</textarea>
          </label>
          <div class="fcInsertRow">
            <label class="fcField fcInsertField">${esc(T('Sütun ekle', 'Insert column'))}
              <select data-fc-insert><option value="">${esc(T('Sütun seçin…', 'Pick a column…'))}</option>${columns.map(col => `<option value="${esc(col.key)}">${esc(col.calculated ? `${col.label} (${T('hesaplanan', 'calculated')})` : col.label)}</option>`).join('')}</select>
            </label>
            <div class="fcQuick">
              ${[['DAYS([A], [B])', T('Gün farkı', 'Day difference')], ['TEXTJOIN(" - ", true, [A], [B])', T('Birleştir', 'Join')], ['ROUND([A] / [B] * 100, 1)', T('Yüzde', 'Percent')], ['IF([A] > [B], "EVET", "HAYIR")', T('Koşul', 'Condition')], ['IFERROR([A] / [B], 0)', T('Hataya karşı', 'Guard errors')]]
                .map(([snippet, label]) => `<button type="button" class="fcChip" data-fc-snippet="${esc(snippet)}">${esc(label)}</button>`).join('')}
            </div>
          </div>`;
      }
      renderFormulaEcho();
    }

    /* Üretilen formül HER ZAMAN gösterilir: kutuların ne ürettiği sır kalmaz,
       kullanıcı isterse Gelişmiş kipe geçip aynı yerden devam eder. */
    function renderFormulaEcho() {
      const echo = modal.querySelector('[data-fc-echo]');
      if (!echo) return;
      const formula = builderFormula(builder);
      echo.hidden = builder.mode === 'advanced' || !formula;
      if (!echo.hidden) echo.innerHTML = `<span>${esc(T('Formül', 'Formula'))}</span><code>${esc(formula)}</code>`;
    }

    const currentDraft = () => ({
      ...draft,
      label: clean(labelInput.value) || clean(labelEnInput.value),
      labelTr: clean(labelInput.value),
      labelEn: clean(labelEnInput.value),
      formula: builderFormula(builder),
      format: formatInput.value,
      decimals: clean(decimalsInput.value),
      group: chosenGroup(),
    });

    function renderPreview() {
      renderFormulaEcho();
      const item = currentDraft();
      if (!item.formula) {
        preview.className = 'fcPreview';
        preview.textContent = builder.mode === 'join'
          ? T('Birleştirilecek sütunları seçin; sonucu burada göreceksiniz.', 'Pick the columns to join; you will see the result here.')
          : builder.mode === 'calc'
            ? T('Sütunları ve işlemi seçin; sonucu burada göreceksiniz.', 'Pick the columns and the operation; you will see the result here.')
            : T('Formülü yazdıkça sonucu burada göreceksiniz.', 'You will see the result here as you type.');
        return;
      }
      const program = engine().compile(item.formula);
      if (!program.ok) {
        preview.className = 'fcPreview isError';
        preview.textContent = `${T('Formül hatası', 'Formula error')}: ${program.error.message}`;
        return;
      }
      const rows = sampleRows(tableKey, 5);
      if (!rows.length) {
        preview.className = 'fcPreview';
        preview.textContent = T('Önizleme için bu tabloda henüz satır yok; formül geçerli görünüyor.', 'There are no rows in this table yet; the formula looks valid.');
        return;
      }
      const results = rows.map(row => program.evaluate(row, { strictColumns: true }));
      const failed = results.find(result => !result.ok);
      const lines = results.map((result, index) => {
        const label = rowLabel(tableKey, rows[index], index);
        const value = result.ok ? formatValue(result.value, item) : '—';
        return `<div class="fcPreviewRow"><span>${esc(label)}</span><b>${esc(value || '—')}</b></div>`;
      }).join('');
      preview.className = failed ? 'fcPreview isWarn' : 'fcPreview isOk';
      preview.innerHTML = `<div class="fcPreviewHead">${esc(T('İlk satırlarda sonuç', 'Result on the first rows'))}${failed ? ` · ${esc(failed.error)}` : ''}</div>${lines}`;
    }

    const firstFreeColumn = () => {
      const used = new Set(builder.mode === 'join' ? builder.columns : []);
      const free = columns.find(col => !used.has(col.key));
      return free ? free.key : (columns[0] ? columns[0].key : '');
    };

    modal.addEventListener('input', event => {
      const target = event.target;
      if (target.matches('[data-fc-formula]')) { builder.advanced = target.value; renderPreview(); return; }
      if (target.matches('[data-fc-operand-number]')) {
        builder.operands[Number(target.dataset.fcOperandNumber)].number = target.value;
        renderPreview(); return;
      }
      if (target.matches('[data-fc-separator-custom]')) {
        builder.separator = target.value;
        modal.querySelectorAll('[data-fc-separator]').forEach(chip => chip.classList.toggle('active', chip.dataset.fcSeparator === builder.separator));
        target.classList.add('active');
        renderPreview(); return;
      }
      if (target.closest('[data-fc-label],[data-fc-label-en],[data-fc-decimals]')) renderPreview();
    });
    modal.addEventListener('change', event => {
      const target = event.target;
      if (target.matches('[data-fc-format]')) { renderPreview(); return; }
      if (target.matches('[data-fc-group]')) {
        // Yeni başlık seçilince ad kutusu açılır ve odak oraya gider.
        const wantsNew = target.value === NEW_GROUP;
        groupNewWrap.hidden = !wantsNew;
        if (wantsNew) groupNewInput.focus();
        return;
      }
      if (target.matches('[data-fc-skip-empty]')) { builder.skipEmpty = target.checked; renderPreview(); return; }
      if (target.matches('[data-fc-operator]')) { builder.operators[Number(target.dataset.fcOperator)] = target.value; renderPreview(); return; }
      if (target.matches('[data-fc-operand]')) {
        const index = Number(target.dataset.fcOperand);
        const operand = builder.operands[index];
        if (target.value === NUMBER_OPERAND) { operand.kind = 'number'; operand.column = ''; }
        else { operand.kind = 'column'; operand.column = target.value; }
        renderBuild(); renderPreview(); return;
      }
      if (target.matches('[data-fc-join]')) {
        const index = Number(target.dataset.fcJoin);
        if (target.value === NUMBER_OPERAND || !target.value) { renderBuild(); renderPreview(); return; }
        builder.columns[index] = target.value;
        renderBuild(); renderPreview(); return;
      }
      const insert = target.closest('[data-fc-insert]');
      if (insert && insert.value) {
        const field = modal.querySelector('[data-fc-formula]');
        if (field) { insertAtCursor(field, `[${insert.value}]`); builder.advanced = field.value; }
        insert.value = '';
        renderPreview();
      }
    });
    modal.addEventListener('click', event => {
      if (event.target === modal || event.target.closest('[data-fc-close]')) { close(); return; }
      const mode = event.target.closest('[data-fc-mode]');
      if (mode) {
        const next = mode.dataset.fcMode;
        if (next !== builder.mode) {
          // Gelişmiş kipe geçerken kutuların ürettiği formül taşınır: kullanıcı
          // kurduğu şeyi kaybetmeden elle geliştirmeye devam edebilsin.
          if (next === 'advanced') builder.advanced = builderFormula(builder) || builder.advanced;
          if (next === 'calc' && !builder.operands) builder.operands = [{ kind: 'column', column: '', number: '' }, { kind: 'column', column: '', number: '' }];
          if (next === 'calc' && !builder.operators) builder.operators = ['-'];
          if (next === 'join' && !builder.columns) builder.columns = [];
          if (next === 'join' && builder.separator == null) builder.separator = ' - ';
          if (next === 'join' && formatInput.value === 'auto') formatInput.value = 'text';
          builder.mode = next;
          modal.querySelectorAll('[data-fc-mode]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.fcMode === next);
            btn.setAttribute('aria-selected', String(btn.dataset.fcMode === next));
          });
          renderBuild(); renderPreview();
        }
        return;
      }
      const separator = event.target.closest('[data-fc-separator]');
      if (separator) { builder.separator = separator.dataset.fcSeparator; renderBuild(); renderPreview(); return; }
      if (event.target.closest('[data-fc-operand-add]')) {
        builder.operators.push('+');
        builder.operands.push({ kind: 'column', column: '', number: '' });
        renderBuild(); renderPreview(); return;
      }
      const dropOperand = event.target.closest('[data-fc-operand-drop]');
      if (dropOperand) {
        const index = Number(dropOperand.dataset.fcOperandDrop);
        builder.operands.splice(index, 1);
        builder.operators.splice(index ? index - 1 : 0, 1);
        renderBuild(); renderPreview(); return;
      }
      if (event.target.closest('[data-fc-join-add]')) {
        if (builder.columns.length >= 12) { toast(T('En fazla 12 sütun birleştirilebilir.', 'At most 12 columns can be joined.')); return; }
        builder.columns.push(firstFreeColumn());
        renderBuild(); renderPreview(); return;
      }
      const joinUp = event.target.closest('[data-fc-join-up]');
      if (joinUp) { const i = Number(joinUp.dataset.fcJoinUp); if (i > 0) { const [item] = builder.columns.splice(i, 1); builder.columns.splice(i - 1, 0, item); renderBuild(); renderPreview(); } return; }
      const joinDown = event.target.closest('[data-fc-join-down]');
      if (joinDown) { const i = Number(joinDown.dataset.fcJoinDown); if (i < builder.columns.length - 1) { const [item] = builder.columns.splice(i, 1); builder.columns.splice(i + 1, 0, item); renderBuild(); renderPreview(); } return; }
      const joinDrop = event.target.closest('[data-fc-join-drop]');
      if (joinDrop) { builder.columns.splice(Number(joinDrop.dataset.fcJoinDrop), 1); renderBuild(); renderPreview(); return; }
      const snippet = event.target.closest('[data-fc-snippet]');
      if (snippet) {
        const field = modal.querySelector('[data-fc-formula]');
        if (field) { insertAtCursor(field, snippet.dataset.fcSnippet); builder.advanced = field.value; }
        renderPreview();
        return;
      }
      if (event.target.closest('[data-fc-delete]')) {
        if (!confirm(T(`“${draft.label || existing.label}” sütunu kaldırılsın mı?`, `Remove the “${draft.label || existing.label}” column?`))) return;
        remove(tableKey, draft.id, onDone);
        close();
        toast(T('Sütun kaldırıldı.', 'Column removed.'));
        return;
      }
      if (event.target.closest('[data-fc-save]')) {
        const item = currentDraft();
        if (!item.label) { toast(T('Sütun başlığı gerekli.', 'A column heading is required.')); labelInput.focus(); return; }
        if (groupInput.value === NEW_GROUP && !item.group) {
          toast(T('Yeni başlık adı gerekli.', 'A new heading name is required.'));
          groupNewInput.focus();
          return;
        }
        if (!item.formula) {
          toast(builder.mode === 'join'
            ? T('Birleştirilecek en az bir sütun seçin.', 'Pick at least one column to join.')
            : builder.mode === 'calc'
              ? T('Her kutuda bir sütun ya da sayı seçin.', 'Choose a column or a number in every box.')
              : T('Formül gerekli.', 'A formula is required.'));
          modal.querySelector('[data-fc-formula],[data-fc-operand],[data-fc-join-add]')?.focus();
          return;
        }
        const program = engine().compile(item.formula);
        if (!program.ok) {
          toast(`${T('Formül hatası', 'Formula error')}: ${program.error.message}`);
          modal.querySelector('[data-fc-formula]')?.focus();
          return;
        }
        const list = definitions(tableKey);
        const index = list.findIndex(entry => entry.id === item.id);
        if (index >= 0) list[index] = item; else list.push(item);
        if (list.length > MAX_PER_TABLE) { toast(T(`En fazla ${MAX_PER_TABLE} hesaplanan sütun eklenebilir.`, `At most ${MAX_PER_TABLE} calculated columns are allowed.`)); return; }
        save(tableKey, list);
        compiledCache.clear();
        finish(onDone, tableKey);
        close();
        setTimeout(() => revealColumn(tableKey, item), 350);
        toast(T('Sütun kaydedildi.', 'Column saved.'));
      }
    });
    document.addEventListener('keydown', onKey, true);
    renderBuild();
    renderPreview();
    renderSourceAdd();
    setTimeout(() => (en() ? labelEnInput : labelInput).focus(), 0);
  }

  function rowLabel(tableKey, row, index) {
    if (!row) return `#${index + 1}`;
    const candidates = ['Order Code', 'Model', 'Model Adı', '_shipId', 'PLM ID'];
    for (const key of candidates) {
      const value = row[key];
      if (value != null && value !== '') return String(value);
    }
    return `#${index + 1}`;
  }

  function insertAtCursor(field, text) {
    const start = field.selectionStart != null ? field.selectionStart : field.value.length;
    const end = field.selectionEnd != null ? field.selectionEnd : field.value.length;
    field.value = `${field.value.slice(0, start)}${text}${field.value.slice(end)}`;
    const caret = start + text.length;
    field.focus();
    try { field.setSelectionRange(caret, caret); } catch (_) { /* setSelectionRange desteklenmiyorsa sorun değil */ }
  }

  function toast(message) { if (typeof showToast === 'function') showToast(message); }

  function finish(onDone, tableKey) {
    compiledCache.clear();
    lastErrors = {};
    syncColumns(tableKey);
    refresh(tableKey, tableRows(tableKey));
    if (typeof window.saveAutoTableColumnState === 'function') window.saveAutoTableColumnState();
    if (typeof onDone === 'function') onDone();
    else rerender(tableKey);
  }
  /* Sütunu kaldırır. Yalnız TANIM silinir; satırlardaki hesaplanmış değer de
     temizlenir ki eski bir sütun anahtarı Excel çıktısında artık kalmasın.
     Kaynak veriye dokunulmaz (§142). */
  function remove(tableKey, id, onDone) {
    const list = definitions(tableKey);
    if (!list.some(item => item.id === id)) return false;
    const key = `${COLUMN_KEY_PREFIX}${id}`;
    for (const row of tableRows(tableKey)) { if (row && Object.prototype.hasOwnProperty.call(row, key)) delete row[key]; }
    save(tableKey, list.filter(item => item.id !== id));
    finish(onDone, tableKey);
    return true;
  }

  function rerender(tableKey) {
    const fn = tableKey === 'cp' ? window.renderCP : tableKey === 'orders' ? window.renderOrders : window.renderShipTable;
    if (typeof fn === 'function') fn();
  }

  /* Yeni sütun listenin SONUNA eklenir; geniş tablolarda bu ekranın çok
     sağındadır. Kaydettikten sonra hiçbir şey olmamış gibi görünmesin diye
     tablo o sütuna kaydırılır ve sütun kısa süre vurgulanır. */
  const TABLE_IDS = { cp: 'cpTable', orders: 'ordersTable', ship: 'shipTable' };
  function revealColumn(tableKey, definition) {
    const table = document.getElementById(TABLE_IDS[tableKey]);
    if (!table || !definition) return;
    const key = columnKey(definition);
    const head = table.querySelector(`thead .colRow th[data-k="${window.CSS && CSS.escape ? CSS.escape(key) : key}"]`);
    if (!head) return;
    const wrap = table.closest('.tablewrap');
    if (wrap) {
      const left = head.offsetLeft - Math.max(0, (wrap.clientWidth - head.offsetWidth) / 2);
      try { wrap.scrollTo({ left: Math.max(0, left), behavior: 'smooth' }); } catch (_) { wrap.scrollLeft = Math.max(0, left); }
    }
    head.classList.add('fcJustAdded');
    setTimeout(() => head.classList.remove('fcJustAdded'), 2200);
  }

  function init() {
    Object.keys(TABLES).forEach(tableKey => { try { syncColumns(tableKey); } catch (_) { /* sütun listesi henüz kurulmamış olabilir */ } });
  }

  window.BLFormulaColumns = {
    TABLES, definitions, syncColumns, applyToRows, refresh, formatValue, errorFor,
    open, close, init, columnKey, sourceColumns, tableRows, storageKey, remove, save, dateDisplay,
    aliasMap, dependenciesOf, orderedDefinitions,
    // Kurucu — sınanabilmesi için dışa açılır.
    calcFormula, joinFormula, builderFormula, builderFromFormula, OPERATORS, SEPARATORS,
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
