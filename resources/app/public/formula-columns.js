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
    /* Boş "Ondalık basamak" OTOMATİK demektir. Number('') 0 verdiği için boş
       kutu eskiden 0 basamak sayılıyor, %12,5 "13%" görünüyordu. */
    const rawDecimals = definition ? definition.decimals : null;
    const decimals = rawDecimals !== '' && rawDecimals != null && Number.isFinite(Number(rawDecimals)) ? Math.max(0, Math.min(6, Number(rawDecimals))) : null;
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
    migrateReferences(tableKey);
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
    const knownBefore = new Set(manager.order);
    const persistedBefore = new Set(window.BLColumnState && typeof window.BLColumnState.persistedOrder === 'function'
      ? window.BLColumnState.persistedOrder(tableKey) : []);
    if (window.BLColumnState && typeof window.BLColumnState.restoreLate === 'function') window.BLColumnState.restoreLate(tableKey);
    else {
      manager.order = manager.order.filter(key => valid.includes(key));
      valid.forEach(key => { if (!manager.order.includes(key)) manager.order.push(key); });
      manager.hidden = new Set([...manager.hidden].filter(key => valid.includes(key)));
    }
    dynamic.forEach(col => {
      const isNew = !knownBefore.has(col.k) && !persistedBefore.has(col.k);
      /* Kayıtlı bir sütun geç yüklenmişse "yeni" değildir. Ayrıca eski
         tanımlarda _placedGroup hiç yoktu; boş metadata yüzünden kullanıcının
         elle verdiği sıra yeniden grup sonuna taşınmamalı. */
      const placed = col.formulaDef && col.formulaDef._placedGroup;
      const groupChanged = Boolean(placed) && nameKey(placed) !== nameKey(col.group);
      if (isNew || groupChanged) {
        placeInGroup(tableKey, col.k, col.group);
        rememberPlacedGroup(tableKey, col.formulaId, col.group);
      }
    });
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
    const index = columnIndex(tableKey);
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
          if (!firstError) firstError = friendlyError(result, index, definition.refs);
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
        out.push({ key: name, label: name, calculated: true, ref: col.k });
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
      /* Checklist sütunları da gerçek CP satır alanlarıdır. İç anahtarları
         __checklist__<id> ile başladığı için genel "__ alanlarını gizle" kuralı
         bunları yanlışlıkla formül sözlüğünden atıyordu. Kullanıcıya başlığı
         gösterilir; kayıtta değişmeyen iç anahtar tutulur. */
      if (col.checklistSupplierColumn) {
        const name = String(col.label || '').trim();
        if (!name || seen.has(nameKey(name))) continue;
        seen.add(nameKey(name));
        out.push({ key: name, label: name, checklist: true, source: 'Checklist', ref: col.k });
        continue;
      }
      if (col.modelCustom) {
        const name = String(col.label || '').trim();
        if (!name || seen.has(nameKey(name))) continue;
        seen.add(nameKey(name));
        out.push({ key: name, label: name, model: true, source: modelSourceLabel(col), ref: col.k });
        continue;
      }
      if (String(col.k).startsWith('__')) continue;
      if (seen.has(col.k)) continue;
      seen.add(col.k);
      const label = typeof window.tableColumnLabel === 'function' ? window.tableColumnLabel(tableKey, col) : (col.label || col.k);
      out.push({ key: col.k, label: label || col.k, ref: col.k });
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

  /* ---------------- KALICI SÜTUN BAŞVURUSU ----------------

     Kullanıcı sorusu (birebir): "Calculated column ile oluşturulan bir sütun;
     eğer formülün içerdiği diğer sütunların isimlerinde değişiklik olursa,
     formülü bozulur mu? Bozulmamasını sağlayalım."

     BOZULUYORDU. Formül, hesaplanan ve veri tabanı sütunlarına ADIYLA
     başvuruyordu ([Üretim Süresi], [Üretici Kodu]) ve ad düz metin olarak
     saklanıyordu. Sütun yeniden adlandırılınca eski ad hiçbir şeye çözülmüyor,
     sütun "Sütun bulunamadı" ile boş kalıyordu.

     ÇÖZÜM: formül DEPODA değişmeyen anahtarlarla tutulur, EKRANDA güncel
     adlarla gösterilir.
       · hesaplanan sütun → [__f_<id>]   (tanımın kimliği)
       · veri tabanı sütunu → [__CPX_<id>] (sunucudaki sütun kimliği)
       · checklist sütunu → [__checklist__<id>] (checklist tanım kimliği)
       · not sütunu / temel sütun → satırdaki kendi anahtarı (zaten sabit)
     Satırda bu anahtarlar doğrudan durduğu için hesaplama bir çeviri
     katmanına ihtiyaç duymaz. Kullanıcı formülü her zaman okunur adlarla görür
     ve yazar; kaydederken adlar anahtara, açarken anahtarlar o anki adlara
     çevrilir. `refs` son bilinen adı saklar: başvurulan sütun silinirse hata
     iç anahtarı değil kullanıcının tanıdığı adı söyler.

     Eski (ad ile saklanmış) formüller syncColumns sırasında AYNI öncelikle
     (satırın kendi alanı > hesaplanan > veri tabanı) anahtara taşınır;
     çözülemeyen ad olduğu gibi kalır ve eski davranış sürer. */
  function columnIndex(tableKey) {
    const cols = (window.COLS_BY_TABLE && window.COLS_BY_TABLE[tableKey]) || [];
    const byKey = new Map();
    const calculated = new Map(), model = new Map(), checklist = new Map(), base = new Map();
    const remember = (map, name, key) => { const k = nameKey(name); if (k && !map.has(k)) map.set(k, key); };
    for (const definition of definitions(tableKey)) {
      const key = columnKey(definition);
      byKey.set(key, { key, name: clean(definition.label) || key, kind: 'calculated' });
      remember(calculated, definition.label, key);
    }
    for (const col of cols) {
      if (!col || !col.k || col.formulaCustom) continue;
      if (col.checklistSupplierColumn) {
        byKey.set(col.k, { key: col.k, name: clean(col.label) || col.k, kind: 'checklist' });
        remember(checklist, col.label, col.k);
        continue;
      }
      if (col.modelCustom) {
        byKey.set(col.k, { key: col.k, name: clean(col.label) || col.k, kind: 'model' });
        remember(model, col.label, col.k);
        continue;
      }
      if (String(col.k).startsWith('__')) continue;
      const label = clean(typeof window.tableColumnLabel === 'function' ? window.tableColumnLabel(tableKey, col) : (col.label || col.k)) || col.k;
      byKey.set(col.k, { key: col.k, name: label, kind: 'base' });
      remember(base, label, col.k);
      remember(base, col.label, col.k);
      remember(base, col.k, col.k);
    }
    return { byKey, calculated, model, checklist, base };
  }
  /* Bir adı (ya da anahtarı) kalıcı anahtara çözer. `legacy` yalnız eski
     çalışma zamanının tanıdığı yolları kullanır: taşıma, formülün ANLAMINI
     değiştirmemelidir. Kullanıcının yeni yazdığı adda ise ekrandaki başlık
     (Türkçe/İngilizce) da tanınır. */
  function resolveRef(index, name, legacy) {
    const raw = String(name == null ? '' : name).trim();
    if (!raw) return null;
    if (index.byKey.has(raw)) return raw;
    const key = nameKey(raw);
    return index.calculated.get(key) || index.model.get(key) || index.checklist.get(key) || (legacy ? null : index.base.get(key)) || null;
  }
  // Anahtarın EKRANDA görünen adı. Temel sütunda başlık yalnız geri aynı
  // anahtara çözülüyorsa kullanılır; yoksa belirsizlik olmasın diye anahtar.
  function refName(index, key, refs) {
    const entry = index.byKey.get(key);
    if (entry) {
      if (entry.kind !== 'base') return entry.name;
      return resolveRef(index, entry.name, false) === key ? entry.name : key;
    }
    return (refs && refs[key]) || key;
  }
  function refsFor(index, formula, previous) {
    const E = engine();
    const out = {};
    const program = E ? E.compile(formula) : null;
    for (const key of (program && program.ok ? program.columns : [])) {
      if (index.byKey.has(key)) { if (index.byKey.get(key).kind !== 'base') out[key] = index.byKey.get(key).name; }
      else if (previous && previous[key]) out[key] = previous[key];
    }
    return out;
  }
  // Ekranda yazılan formül → depodaki formül (+ son bilinen adlar).
  function toStorage(tableKey, text, previousRefs) {
    const E = engine();
    const source = clean(text);
    if (!E || !source) return { formula: source, refs: {} };
    const index = columnIndex(tableKey);
    const previous = previousRefs || {};
    const formula = E.rewriteColumns(source, name => {
      const key = resolveRef(index, name, false);
      if (key) return key;
      // Silinmiş bir sütunun eski adı: kimliği korunur, geri gelirse çalışır.
      const kept = Object.keys(previous).find(item => nameKey(previous[item]) === nameKey(name));
      return kept || null;
    });
    return { formula, refs: refsFor(index, formula, previous) };
  }
  // Depodaki formül → ekranda gösterilen formül.
  function displayFormula(tableKey, definitionOrFormula, refs) {
    const E = engine();
    const definition = typeof definitionOrFormula === 'string' ? { formula: definitionOrFormula, refs } : (definitionOrFormula || {});
    const source = String(definition.formula == null ? '' : definition.formula);
    if (!E || !source) return source;
    const index = columnIndex(tableKey);
    return E.rewriteColumns(source, key => refName(index, key, definition.refs));
  }
  // Eski, ad ile saklanmış başvuruları kalıcı anahtara taşır; adları tazeler.
  function migrateReferences(tableKey) {
    const E = engine();
    if (!E) return false;
    const list = definitions(tableKey);
    if (!list.length) return false;
    const index = columnIndex(tableKey);
    const sample = tableRows(tableKey).slice(0, 50);
    const rowsHave = name => sample.some(row => row && Object.prototype.hasOwnProperty.call(row, name));
    let changed = false;
    for (const definition of list) {
      if (!definition.formula) continue;
      const formula = E.rewriteColumns(definition.formula, name => {
        if (index.byKey.has(name) || rowsHave(name)) return null;
        return resolveRef(index, name, true);
      });
      const refs = refsFor(index, formula, definition.refs);
      if (formula !== definition.formula || JSON.stringify(refs) !== JSON.stringify(definition.refs || {})) {
        definition.formula = formula;
        definition.refs = refs;
        changed = true;
      }
    }
    if (changed) { save(tableKey, list); compiledCache.clear(); }
    return changed;
  }
  // "Sütun bulunamadı: __f_fc_x" yerine kullanıcının tanıdığı ad.
  function friendlyError(result, index, refs) {
    if (!result || !Array.isArray(result.missing) || !result.missing.length || !/Sütun bulunamadı/.test(result.error || '')) return result && result.error;
    const names = result.missing.map(key => refName(index, key, refs)).join(', ');
    return T(`Sütun bulunamadı: ${names}`, `Column not found: ${names}`);
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

     v7.175 — Kullanıcı talebi (birebir): "Calculated Column modülünü uçtan uca
     elden geçirmeni istiyorum. Hiç excel bilmeyen biri bile kolaylıkla
     kullanabilsin. Çok basitleştir. İsteyen advanced modda formül de yazsın,
     formül yazmak için bir sözlük de sun ... karmaşıksa AI'a formül yazma
     kurallarını anlatıp istediklerini söylesinler ve çıktıyı buyer loga
     kopyalasınlar, buyer log da analiz edip varsa hata söylesin."

     Pencere artık "hangi araç?" değil "NE YAPMAK İSTİYORSUNUZ?" sorusuyla
     açılır. Her kart düz bir cümledir ("iki tarih arasında kaç gün var?");
     kullanıcı yalnız cümledeki boşlukları sütun seçerek doldurur:

       · GÜN FARKI     — [tarih] ile [tarih] arasında kaç gün
       · HESAPLAMA     — [sütun] [işlem] [sütun] … kutuları (+ − × ÷)
       · YÜZDE         — A, B'nin yüzde kaçı / yüzde değişim
       · TARİHE GÜN EKLE
       · BİRLEŞTİRME   — sütunları ayraçla tek hücrede toplar
       · KOŞUL         — "Eğer … ise … yaz, değilse … yaz"
       · GELİŞMİŞ      — formülü elle yazma + sözlük + canlı analiz
       · AI İLE YAZ    — AI'a kuralları anlatan yönerge + cevabı analiz

     Depoda saklanan şey yine TEK bir FORMÜL METNİDİR; kartlar yalnız o metni
     üretir. Sebebi: tek bir hesaplama yolu kalsın. Düzenlemeye açarken metin
     motorun kendi ayrıştırıcısıyla geri çözülür; hiçbir karta sığmayan formül
     Gelişmiş kipte açılır. */

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
  // Koşul kartındaki karşılaştırmalar — düz cümle olarak.
  const COMPARISONS = [
    { id: 'gt', op: '>', tr: 'büyükse', en: 'is greater than' },
    { id: 'ge', op: '>=', tr: 'büyük ya da eşitse', en: 'is at least' },
    { id: 'lt', op: '<', tr: 'küçükse', en: 'is less than' },
    { id: 'le', op: '<=', tr: 'küçük ya da eşitse', en: 'is at most' },
    { id: 'eq', op: '=', tr: 'eşitse', en: 'equals' },
    { id: 'ne', op: '<>', tr: 'eşit değilse', en: 'does not equal' },
    { id: 'contains', op: null, tr: 'içeriyorsa', en: 'contains' },
    { id: 'blank', op: null, tr: 'boşsa', en: 'is blank' },
    { id: 'notblank', op: null, tr: 'doluysa', en: 'is not blank' },
  ];
  const NUMBER_OPERAND = '__fc_number__';
  // v7.42 — "yeni başlık" seçeneği; bir grup adıyla çakışmasın diye eğik yazım.
  const NEW_GROUP = '__fc_new_group__';

  function quoteText(text) { return `"${String(text == null ? '' : text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`; }
  // Kullanıcının kutuya yazdığı değer: sayıya benziyorsa sayı, değilse metin.
  function literal(value) {
    const text = String(value == null ? '' : value);
    const trimmed = text.trim();
    if (/^-?\d+(?:[.,]\d+)?$/.test(trimmed)) return String(Number(trimmed.replace(',', '.')));
    return quoteText(text);
  }
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
  function daysFormula(builder) {
    const days = builder.days || {};
    return days.start && days.end ? `DAYS([${days.start}], [${days.end}])` : '';
  }
  /* Yüzde kartı ×100 üretir ve biçimi "Yüzde" yapar (biçim yalnız "%" ekler,
     çarpmaz). Tek ondalık, ekrandaki diğer yüzde sütunlarıyla aynıdır. */
  function percentFormula(builder) {
    const percent = builder.percent || {};
    if (!percent.a || !percent.b) return '';
    return percent.kind === 'change'
      ? `ROUND(([${percent.a}] - [${percent.b}]) / [${percent.b}] * 100, 1)`
      : `ROUND([${percent.a}] / [${percent.b}] * 100, 1)`;
  }
  function addDaysFormula(builder) {
    const add = builder.adddays || {};
    const raw = clean(add.days).replace(',', '.');
    if (!add.date || raw === '' || !Number.isFinite(Number(raw))) return '';
    const amount = Math.abs(Number(raw));
    return `ADDDAYS([${add.date}], ${add.dir === '-' ? -amount : amount})`;
  }
  // Tek bir koşul satırı → formül parçası; eksik satır '' döner.
  function singleCondition(cond) {
    if (!cond || !cond.left) return '';
    const left = `[${cond.left}]`;
    const right = cond.right || {};
    if (cond.cmp === 'blank') return `ISBLANK(${left})`;
    if (cond.cmp === 'notblank') return `NOT(ISBLANK(${left}))`;
    let value = '';
    if (right.kind === 'column') { if (!right.column) return ''; value = `[${right.column}]`; }
    else { if (clean(right.value) === '') return ''; value = cond.cmp === 'contains' ? quoteText(right.value) : literal(right.value); }
    const compare = COMPARISONS.find(item => item.id === cond.cmp) || COMPARISONS[0];
    return cond.cmp === 'contains' ? `CONTAINS(${left}, ${value})` : `${left} ${compare.op} ${value}`;
  }
  /* v7.177 — Birden çok sütunun durumu birbirine bağlanabilir: ilk koşul
     rule.left/cmp/right'ta (eski kayıtlarla uyumlu), ek koşullar rule.more
     listesinde. rule.join "and" ise HEPSİ, "or" ise EN AZ BİRİ sağlanmalı. */
  // Bir kuralın koşul grubu → formül parçası; eksik satır varsa ''.
  function caseCondition(rule) {
    const parts = [];
    for (const cond of [rule, ...(Array.isArray(rule.more) ? rule.more : [])]) {
      const part = singleCondition(cond);
      if (!part) return '';
      parts.push(part);
    }
    return parts.length > 1 ? `${rule.join === 'or' ? 'OR' : 'AND'}(${parts.join(', ')})` : parts[0];
  }
  /* v7.178 — BİRDEN ÇOK KURAL ("değilse eğer").

     Kullanıcı talebi (birebir): "label by condition alanında çoklu eğer koşulu
     koyamıyorum. Mesela X = 0 veya X = "" ise "N/A", X = 1 ve Y = 0 ise
     "Pending", X = 1 ve Y = 1 ise "OK" yazdırmak istiyorum."

     İlk kural eski yerinde durur (rule.left/cmp/right/more/join/then — eski
     kayıtlar aynen açılır); ek kurallar rule.cases listesindedir, her birinin
     kendi koşul grubu ve kendi sonucu vardır. Tek kuralda formül eskisi gibi
     IF(...) olur; birden çok kuralda IFS(k1, s1, k2, s2, …, TRUE, değilse).
     Kurallar YUKARIDAN AŞAĞI denenir ve İLK uyan kuralın sonucu yazılır —
     Excel'deki iç içe EĞER ile aynı anlam. */
  function conditionFormula(builder) {
    const rule = builder.ifelse || {};
    const cases = [rule, ...(Array.isArray(rule.cases) ? rule.cases : [])];
    const conditions = cases.map(caseCondition);
    if (conditions.some(item => !item)) return '';
    if (cases.length === 1) return `IF(${conditions[0]}, ${literal(rule.then)}, ${literal(rule.else)})`;
    return `IFS(${cases.map((item, index) => `${conditions[index]}, ${literal(item.then)}`).join(', ')}, TRUE, ${literal(rule.else)})`;
  }
  function builderFormula(builder) {
    if (!builder) return '';
    if (builder.mode === 'calc') return calcFormula(builder);
    if (builder.mode === 'join') return joinFormula(builder);
    if (builder.mode === 'days') return daysFormula(builder);
    if (builder.mode === 'percent') return percentFormula(builder);
    if (builder.mode === 'adddays') return addDaysFormula(builder);
    if (builder.mode === 'ifelse') return conditionFormula(builder);
    if (builder.mode === 'ai') return clean(builder.ai && builder.ai.formula);
    return clean(builder.advanced);
  }

  /* Formül metnini karta geri çözer. Motorun kendi ayrıştırıcısı kullanılır;
     düzenli ifadeyle tahmin etmek, kullanıcının formülünü sessizce yanlış
     göstermenin en kolay yoludur. Hiçbir karta BİREBİR sığmıyorsa null döner →
     Gelişmiş kip. Birebir: kartın yeniden ürettiği metin aynı hesaplamayı
     yapmalıdır; "neredeyse" uyan bir formül karta düşürülmez. */
  function builderFromFormula(source) {
    const text = clean(source);
    if (!text) return null;
    const E = engine();
    if (!E) return null;
    const program = E.compile(text);
    if (!program.ok || !program.ast) return null;
    const ast = program.ast;
    const isCol = node => node && node.kind === 'column';
    const isNum = (node, value) => node && node.kind === 'number' && (value == null || node.value === value);
    const isLiteral = node => node && (node.kind === 'string' || node.kind === 'number');
    const bin = (node, op) => node && node.kind === 'binary' && node.op === op;
    const call = (node, name, count) => node && node.kind === 'call' && node.name === name && node.args.length === count;

    if (ast.kind === 'call' && (ast.name === 'TEXTJOIN' || ast.name === 'BIRLESTIR') && ast.args.length >= 3) {
      const [separator, skip, ...rest] = ast.args;
      if (separator.kind !== 'string' || skip.kind !== 'boolean') return null;
      if (!rest.every(node => node.kind === 'column')) return null;
      return { mode: 'join', columns: rest.map(node => node.name), separator: separator.value, skipEmpty: skip.value };
    }
    if (ast.kind === 'call' && ast.name === 'TEXT' && ast.args.length === 1 && ast.args[0].kind === 'column') {
      return { mode: 'join', columns: [ast.args[0].name], separator: ' - ', skipEmpty: true };
    }
    if (call(ast, 'DAYS', 2) && isCol(ast.args[0]) && isCol(ast.args[1])) {
      return { mode: 'days', days: { start: ast.args[0].name, end: ast.args[1].name } };
    }
    if (call(ast, 'ADDDAYS', 2) && isCol(ast.args[0])) {
      const amount = ast.args[1];
      if (isNum(amount)) return { mode: 'adddays', adddays: { date: ast.args[0].name, days: String(amount.value), dir: '+' } };
      if (amount.kind === 'unary' && isNum(amount.argument)) return { mode: 'adddays', adddays: { date: ast.args[0].name, days: String(amount.argument.value), dir: '-' } };
      return null;
    }
    if (call(ast, 'ROUND', 2) && isNum(ast.args[1], 1) && bin(ast.args[0], '*') && isNum(ast.args[0].right, 100) && bin(ast.args[0].left, '/')) {
      const division = ast.args[0].left;
      if (isCol(division.left) && isCol(division.right)) return { mode: 'percent', percent: { kind: 'ratio', a: division.left.name, b: division.right.name } };
      if (bin(division.left, '-') && isCol(division.left.left) && isCol(division.left.right) && isCol(division.right)
        && division.left.right.name === division.right.name) {
        return { mode: 'percent', percent: { kind: 'change', a: division.left.left.name, b: division.right.name } };
      }
      return null;
    }
    const readCondition = node => {
      const cond = { left: '', cmp: 'gt', right: { kind: 'value', column: '', value: '' } };
      if (call(node, 'ISBLANK', 1) && isCol(node.args[0])) { cond.left = node.args[0].name; cond.cmp = 'blank'; return cond; }
      if (call(node, 'NOT', 1) && call(node.args[0], 'ISBLANK', 1) && isCol(node.args[0].args[0])) { cond.left = node.args[0].args[0].name; cond.cmp = 'notblank'; return cond; }
      if (call(node, 'CONTAINS', 2) && isCol(node.args[0]) && node.args[1].kind === 'string') {
        cond.left = node.args[0].name; cond.cmp = 'contains'; cond.right.value = node.args[1].value; return cond;
      }
      const compare = node && node.kind === 'binary' && COMPARISONS.find(item => item.op === node.op || (node.op === '==' && item.op === '=') || (node.op === '!=' && item.op === '<>'));
      if (compare && isCol(node.left) && (isCol(node.right) || isLiteral(node.right))) {
        cond.left = node.left.name;
        cond.cmp = compare.id;
        cond.right = isCol(node.right) ? { kind: 'column', column: node.right.name, value: '' } : { kind: 'value', column: '', value: String(node.right.value) };
        return cond;
      }
      return null;
    };
    // Bir koşul grubu (tek koşul ya da AND/OR) → { ...ilk, more, join }.
    const readCase = (condition, result) => {
      if (!isLiteral(result)) return null;
      const grouped = condition && condition.kind === 'call' && (condition.name === 'AND' || condition.name === 'OR') && condition.args.length >= 2;
      const conditions = (grouped ? condition.args : [condition]).map(readCondition);
      if (conditions.some(item => !item)) return null;
      const [first, ...more] = conditions;
      return { ...first, more, join: grouped && condition.name === 'OR' ? 'or' : 'and', then: String(result.value) };
    };
    if (call(ast, 'IF', 3)) {
      /* Tek kural: IF(k, s, değilse). İç içe IF(k1, s1, IF(k2, s2, …)) de
         kurallara açılır (AI ya da Excel alışkanlığı bu biçimi üretir); karta
         dönüşte IFS olarak yazılır, anlamı aynıdır. */
      const cases = [];
      let node = ast;
      while (call(node, 'IF', 3)) {
        const item = readCase(node.args[0], node.args[1]);
        if (!item) return null;
        cases.push(item);
        node = node.args[2];
      }
      if (!isLiteral(node)) return null;
      const [first, ...rest] = cases;
      return { mode: 'ifelse', ifelse: { ...first, cases: rest, else: String(node.value) } };
    }
    if (ast.kind === 'call' && ast.name === 'IFS' && ast.args.length >= 4 && !(ast.args.length % 2)) {
      const last = ast.args[ast.args.length - 2];
      if (!(last && last.kind === 'boolean' && last.value === true) || !isLiteral(ast.args[ast.args.length - 1])) return null;
      const cases = [];
      for (let index = 0; index < ast.args.length - 2; index += 2) {
        const item = readCase(ast.args[index], ast.args[index + 1]);
        if (!item) return null;
        cases.push(item);
      }
      const [first, ...rest] = cases;
      return { mode: 'ifelse', ifelse: { ...first, cases: rest, else: String(ast.args[ast.args.length - 1].value) } };
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

  // Kartın ürettiği sütuna uygun görünüm; kullanıcı biçimi elle seçtiyse dokunulmaz.
  const SUGGESTED_FORMAT = { days: 'integer', percent: 'percent', adddays: 'date', join: 'text', ifelse: 'text' };

  /* Sütun türü tahmini — yalnız AI yönergesine "tarih / sayı / metin" yazmak
     için. Değerin kendisi yönergeye girmez. */
  function columnType(tableKey, ref) {
    const cols = (window.COLS_BY_TABLE && window.COLS_BY_TABLE[tableKey]) || [];
    const col = cols.find(item => item && item.k === ref);
    const declared = String((col && (col.dataType || (col._blSchema && col._blSchema.dataType))) || '').toLowerCase();
    if (/date/.test(declared)) return 'date';
    if (/int|num|dec|float|money|curr|perc/.test(declared)) return 'number';
    if (/text|string|char/.test(declared)) return 'text';
    const E = engine();
    const values = [];
    for (const row of tableRows(tableKey)) {
      const value = row ? row[ref] : null;
      if (value != null && value !== '') values.push(value);
      if (values.length >= 30) break;
    }
    if (!E || !values.length) return '';
    if (values.filter(value => E.looksLikeDate(value)).length >= values.length * 0.8) return 'date';
    if (values.filter(value => E.toNumber(value) != null).length >= values.length * 0.8) return 'number';
    return 'text';
  }

  function copyText(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(text).then(() => true, () => fallbackCopy(text));
    }
    return Promise.resolve(fallbackCopy(text));
  }
  function fallbackCopy(text) {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    area.remove();
    return ok;
  }

  /* ---------------- pencere ---------------- */

  let modal = null;
  function close() { modal?.remove(); modal = null; document.removeEventListener('keydown', onKey, true); }
  function onKey(event) {
    if (event.key !== 'Escape' || !modal) return;
    event.preventDefault(); event.stopImmediatePropagation();
    close();
  }

  function emptyBuilder() {
    return {
      mode: 'days',
      operands: [{ kind: 'column', column: '', number: '' }, { kind: 'column', column: '', number: '' }],
      operators: ['-'],
      columns: [],
      separator: ' - ',
      skipEmpty: true,
      advanced: '',
      days: { start: '', end: '' },
      percent: { kind: 'ratio', a: '', b: '' },
      adddays: { date: '', days: '30', dir: '+' },
      ifelse: { left: '', cmp: 'gt', right: { kind: 'value', column: '', value: '' }, more: [], join: 'and', then: '', else: '', cases: [] },
      ai: { request: '', answer: '', formula: '' },
    };
  }

  function open(tableKey, editId, onDone) {
    if (!TABLES[tableKey]) return;
    if (!engine()) { toast(T('Formül motoru yüklenemedi.', 'The formula engine could not be loaded.')); return; }
    close();
    const E = engine();
    const defs = definitions(tableKey);
    const existing = editId ? defs.find(item => item.id === editId) : null;
    const draft = existing ? { ...existing } : {
      id: `fc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      label: '', formula: '', format: 'auto', decimals: '',
    };
    // Düzenlenen sütun kendi listesinde görünmez: kendine gönderme çevrimdir.
    let columns = sourceColumns(tableKey, existing ? existing.id : null);
    const shown = formula => displayFormula(tableKey, formula, draft.refs);
    const nameOfRef = ref => {
      const col = columns.find(item => item.ref === ref);
      return col ? col.label : refName(columnIndex(tableKey), ref, draft.refs);
    };

    /* Açılış kipi: yeni sütunda GÜN FARKI (en sık istenen iş), düzenlemede
       formülün geri çözüldüğü kart, çözülemiyorsa GELİŞMİŞ. Kartlar kalıcı
       anahtarlarla (ref) çalışır; eski, ad ile saklanmış başvurular burada
       anahtara çevrilir ki açılır kutuda doğru sütun seçili gelsin. */
    const builder = emptyBuilder();
    const index = columnIndex(tableKey);
    const toRef = name => (name ? resolveRef(index, name, false) || name : name);
    const restored = existing ? builderFromFormula(existing.formula) : null;
    if (restored) {
      if (restored.operands) restored.operands.forEach(operand => { operand.column = toRef(operand.column); });
      if (restored.columns) restored.columns = restored.columns.map(toRef);
      if (restored.days) { restored.days.start = toRef(restored.days.start); restored.days.end = toRef(restored.days.end); }
      if (restored.percent) { restored.percent.a = toRef(restored.percent.a); restored.percent.b = toRef(restored.percent.b); }
      if (restored.adddays) restored.adddays.date = toRef(restored.adddays.date);
      if (restored.ifelse) {
        [restored.ifelse, ...(restored.ifelse.cases || [])].forEach(item => {
          [item, ...(item.more || [])].forEach(cond => { cond.left = toRef(cond.left); cond.right.column = toRef(cond.right.column); });
        });
      }
      Object.assign(builder, restored);
    } else if (existing) {
      builder.mode = 'advanced';
    }
    if (!builder.operands.length) builder.operands = [{ kind: 'column', column: '', number: '' }];
    builder.advanced = existing ? shown(existing.formula) : '';
    let labelTouched = Boolean(existing);
    let formatTouched = Boolean(existing);

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
            `${en() ? TABLES[tableKey].en : TABLES[tableKey].tr} tablosuna, diğer sütunlardan hesaplanan yeni bir sütun ekler. Yalnız sizin ekranınızda görünür; kaynak veriye dokunmaz.`,
            `Adds a column to the ${TABLES[tableKey].en} table, calculated from other columns. It appears only on your screen and never changes the source data.`,
          ))}</p>
        </div>
        <button type="button" class="pricingRuleIconBtn" data-fc-close aria-label="${esc(T('Kapat', 'Close'))}">✕</button>
      </div>
      <div class="fcBody">
        <div class="fcStep"><span class="fcStepNo">1</span>${esc(T('Ne yapmak istiyorsunuz?', 'What do you want to do?'))}</div>
        <div class="fcModes" data-bl-tabs="segment" role="tablist" aria-label="${esc(T('Hesaplama türü', 'Calculation type'))}">
          ${[['days', T('Gün farkı', 'Days between'), T('İki tarih arasında kaç gün var?', 'How many days between two dates?')],
             ['calc', T('Hesaplama', 'Calculation'), T('Topla, çıkar, çarp, böl', 'Add, subtract, multiply, divide')],
             ['percent', T('Yüzde', 'Percent'), T('Yüzde kaçı / yüzde değişim', 'Share or change in percent')],
             ['adddays', T('Tarihe gün ekle', 'Add days'), T('Ör. Ex-factory + 30 gün', 'e.g. Ex-factory + 30 days')],
             ['join', T('Birleştirme', 'Join'), T('Sütunları tek hücrede birleştir', 'Put several columns in one cell')],
             ['ifelse', T('Koşula göre yaz', 'Label by condition'), T('Eğer … ise “…” yaz', 'If … then write “…”')],
             ['advanced', T('Gelişmiş', 'Advanced'), T('Formülü kendim yazarım (sözlüklü)', 'I will type the formula (with dictionary)')],
             ['ai', T('AI ile yaz', 'Write with AI'), T('Karmaşık iş: AI yazsın, Buyer Log denetlesin', 'Complex: AI writes, Buyer Log checks')]]
            .map(([id, label, tip]) => `<button type="button" id="fcMode-${id}" role="tab" class="fcMode fcRecipe${id === 'ai' ? ' fcRecipeAi' : ''}${builder.mode === id ? ' active' : ''}" data-fc-mode="${id}" title="${esc(tip)}" aria-controls="fcModePanel" aria-selected="${builder.mode === id}" tabindex="${builder.mode === id ? '0' : '-1'}"><b>${esc(label)}</b><small>${esc(tip)}</small></button>`).join('')}
        </div>
        <div class="fcStep" data-fc-step2></div>
        <div class="fcBuild" id="fcModePanel" data-fc-build role="tabpanel" aria-labelledby="fcMode-${builder.mode}" tabindex="0"></div>
        <div class="fcSourceAdd" data-fc-source-add></div>
        <div class="fcEcho" data-fc-echo hidden></div>
        <div class="fcPreview" data-fc-preview></div>
        <div class="fcStep"><span class="fcStepNo">3</span>${esc(T('Sütuna bir ad verin', 'Name the column'))}</div>
        <!-- Başlık iki dilde girilir; formül referanslarının kimliği TR (yoksa EN) başlıktır. -->
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
        <details class="fcMore">
          <summary>${esc(T('Görünüm ayarları (isteğe bağlı)', 'Display settings (optional)'))}</summary>
          <div class="fcFormatRow">
            <label class="fcField">${esc(T('Biçim', 'Format'))}
              <select data-fc-format>${Object.entries(FORMATS).map(([id, item]) => `<option value="${id}"${draft.format === id ? ' selected' : ''}>${esc(en() ? item.en : item.tr)}</option>`).join('')}</select>
            </label>
            <label class="fcField">${esc(T('Ondalık basamak', 'Decimals'))}
              <input type="number" min="0" max="6" data-fc-decimals value="${esc(draft.decimals)}" placeholder="${esc(T('otomatik', 'auto'))}">
            </label>
          </div>
          <p class="fcNote">${esc(T(
            'Sütun, seçtiğiniz üst başlığın en sonuna yerleşir. Biçim yalnız görünümü değiştirir; hesaplanan değer aynı kalır.',
            'The column is placed at the end of the heading you pick. The format only changes how the value looks.',
          ))}</p>
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
    const step2 = modal.querySelector('[data-fc-step2]');
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
    /* Açılır kutunun DEĞERİ kalıcı anahtardır (ref), YAZISI güncel addır.
       Kayıtlı formülün başvurduğu sütun artık yoksa seçili bir "bulunamadı"
       seçeneği gösterilir: boş kutu, kullanıcının seçimini sessizce silmiş
       gibi görünürdü. */
    const columnOptions = (selected, kind, placeholder) => {
      const missing = selected && kind !== 'number' && !columns.some(col => col.ref === selected)
        ? `<option value="${esc(selected)}" selected>${esc(`${nameOfRef(selected)} (${T('bulunamadı', 'not found')})`)}</option>` : '';
      return `<option value="">${esc(placeholder || T('Sütun seçin…', 'Pick a column…'))}</option>${missing}`
        + columns.map(col => `<option value="${esc(col.ref)}"${kind !== 'number' && selected === col.ref ? ' selected' : ''}>${esc(optionLabel(col))}</option>`).join('')
        + (kind === 'column-only' ? '' : `<option value="${NUMBER_OPERAND}"${kind === 'number' ? ' selected' : ''}>${esc(T('— sabit sayı yaz —', '— type a fixed number —'))}</option>`);
    };
    const pick = (attr, selected, placeholder) => `<select class="fcPick" ${attr}>${columnOptions(selected, 'column-only', placeholder)}</select>`;
    /* Koşul kartı: kural 0 builder.ifelse'in kendisi, 1+ builder.ifelse.cases.
       Bir kuralda koşul 0 kuralın kendisi (left/cmp/right), 1+ kural.more. */
    const ifCase = caseIndex => {
      const rule = builder.ifelse;
      if (!Array.isArray(rule.cases)) rule.cases = [];
      const c = Number(caseIndex) || 0;
      return c ? rule.cases[c - 1] || rule : rule;
    };
    const caseOf = el => Number(el && el.closest && el.closest('[data-fc-case]') ? el.closest('[data-fc-case]').dataset.fcCase : 0) || 0;
    const ifCondition = (index, caseIndex) => {
      const rule = ifCase(caseIndex);
      const i = Number(index) || 0;
      if (!i) return rule;
      if (!Array.isArray(rule.more)) rule.more = [];
      return rule.more[i - 1] || rule;
    };

    const STEP2 = {
      days: T('Hangi iki tarih?', 'Which two dates?'),
      calc: T('Sütunları ve işlemleri seçin', 'Pick the columns and operations'),
      percent: T('Hangi sayılar?', 'Which numbers?'),
      adddays: T('Hangi tarihe kaç gün?', 'Which date, how many days?'),
      join: T('Hangi sütunlar, hangi sırayla?', 'Which columns, in which order?'),
      ifelse: T('Koşulu cümle gibi kurun', 'Build the condition like a sentence'),
      advanced: T('Formülü yazın', 'Type the formula'),
      ai: T('AI ile formül yazın', 'Write the formula with AI'),
    };

    function renderBuild() {
      step2.innerHTML = `<span class="fcStepNo">2</span>${esc(STEP2[builder.mode] || '')}`;
      build.setAttribute('aria-labelledby', `fcMode-${builder.mode}`);
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
            'İşlemler soldan sağa, gördüğünüz sırayla uygulanır. İki TARİH sütununu − ile çıkarırsanız sonuç GÜN farkıdır. Sabit bir sayı için listeden “sabit sayı yaz”ı seçin.',
            'Operations apply left to right, in the order you see. Subtracting two DATE columns with − gives a DAY difference. For a fixed number pick “type a fixed number”.',
          ))}</p>`;
      } else if (builder.mode === 'join') {
        const list = builder.columns.length
          ? builder.columns.map((key, index) => `<div class="fcJoinRow">
              <span class="fcJoinNo">${index + 1}</span>
              <select data-fc-join="${index}">${columnOptions(key, 'column-only')}</select>
              <button type="button" class="fcMini" data-fc-join-up="${index}"${index === 0 ? ' disabled' : ''} title="${esc(T('Yukarı', 'Move up'))}">↑</button>
              <button type="button" class="fcMini" data-fc-join-down="${index}"${index === builder.columns.length - 1 ? ' disabled' : ''} title="${esc(T('Aşağı', 'Move down'))}">↓</button>
              <button type="button" class="fcMini fcMiniDrop" data-fc-join-drop="${index}" title="${esc(T('Kaldır', 'Remove'))}">×</button>
            </div>`).join('')
          : `<p class="fcNote">${esc(T('Henüz sütun eklenmedi. “+ sütun ekle” ile başlayın.', 'No columns yet. Start with “+ add column”.'))}</p>`;
        const custom = SEPARATORS.every(item => item.value !== builder.separator);
        build.innerHTML = `<div class="fcJoinList">${list}</div>
          <button type="button" class="fcMini fcMiniAdd" data-fc-join-add>+ ${esc(T('sütun ekle', 'add column'))}</button>
          <div class="fcSepRow">
            <span class="fcSepLabel">${esc(T('Araya ne gelsin?', 'What goes between?'))}</span>
            ${SEPARATORS.map(item => `<button type="button" class="fcChip${builder.separator === item.value ? ' active' : ''}" data-fc-separator="${esc(item.value)}">${esc(item.value.trim() || '␣')}<small>${esc(en() ? item.en : item.tr)}</small></button>`).join('')}
            <input type="text" class="fcSepCustom${custom ? ' active' : ''}" data-fc-separator-custom value="${esc(custom ? builder.separator : '')}" maxlength="12" placeholder="${esc(T('özel…', 'custom…'))}" autocomplete="off">
          </div>
          <label class="fcCheck"><input type="checkbox" data-fc-skip-empty${builder.skipEmpty === false ? '' : ' checked'}> ${esc(T('Boş hücreleri atla', 'Skip blank cells'))}</label>
          <p class="fcNote">${esc(T(
            'Boş hücreleri atlamak açıkken aradaki bir sütun boşsa ayraç çift kalmaz. Kapalıyken boş hücre de bir alan olarak yerini korur.',
            'With skip-blanks on, a blank column in the middle does not leave a doubled separator. With it off, a blank cell keeps its place.',
          ))}</p>`;
      } else if (builder.mode === 'days') {
        build.innerHTML = `<div class="fcSentence">
            ${pick('data-fc-days="start"', builder.days.start, T('Başlangıç tarihi…', 'Start date…'))}
            <span>${esc(T('ile', 'and'))}</span>
            ${pick('data-fc-days="end"', builder.days.end, T('Bitiş tarihi…', 'End date…'))}
            <span>${esc(T('arasında kaç gün var?', '— how many days apart?'))}</span>
          </div>
          <p class="fcNote">${esc(T('Sonuç “bitiş − başlangıç” gün sayısıdır. Bitiş daha erkense sonuç eksi çıkar (ör. −5 = 5 gün önce).', 'The result is “end − start” in days. When the end is earlier the result is negative (e.g. −5 = 5 days before).'))}</p>`;
      } else if (builder.mode === 'percent') {
        const change = builder.percent.kind === 'change';
        build.innerHTML = `<div class="fcChoiceRow" role="radiogroup" aria-label="${esc(T('Yüzde türü', 'Percent type'))}">
            <label class="fcChoice"><input type="radio" name="fcPercentKind" value="ratio" data-fc-percent-kind${change ? '' : ' checked'}> ${esc(T('A, B’nin yüzde kaçı?', 'A is what percent of B?'))}</label>
            <label class="fcChoice"><input type="radio" name="fcPercentKind" value="change" data-fc-percent-kind${change ? ' checked' : ''}> ${esc(T('Yüzde kaç değişti? (eski → yeni)', 'Percent change (old → new)'))}</label>
          </div>
          <div class="fcSentence">${change
            ? `${pick('data-fc-percent="a"', builder.percent.a, T('Yeni değer…', 'New value…'))}<span>${esc(T('değeri,', 'compared with'))}</span>${pick('data-fc-percent="b"', builder.percent.b, T('Eski değer…', 'Old value…'))}<span>${esc(T('değerine göre yüzde kaç değişti?', '— percent change?'))}</span>`
            : `${pick('data-fc-percent="a"', builder.percent.a, T('Parça (A)…', 'Part (A)…'))}<span>${esc(T('sayısı,', 'is what percent of'))}</span>${pick('data-fc-percent="b"', builder.percent.b, T('Bütün (B)…', 'Whole (B)…'))}<span>${esc(T('sayısının yüzde kaçı?', ''))}</span>`}
          </div>
          <p class="fcNote">${esc(change
            ? T('Örnek: eski 80, yeni 100 → %25 artış. Azalış eksi çıkar. Eski değer 0 ise o satır hesaplanamaz (sıfıra bölme).', 'Example: old 80, new 100 → 25% increase. A decrease is negative. When the old value is 0 that row cannot be calculated (divide by zero).')
            : T('Örnek: 25, 200’ün %12,5’idir. Sonuç bir ondalıkla yuvarlanır. B 0 ise o satır hesaplanamaz (sıfıra bölme).', 'Example: 25 is 12.5% of 200. Rounded to one decimal. When B is 0 that row cannot be calculated (divide by zero).'))}</p>`;
      } else if (builder.mode === 'adddays') {
        build.innerHTML = `<div class="fcSentence">
            ${pick('data-fc-adddays-date', builder.adddays.date, T('Tarih…', 'Date…'))}
            <span>${esc(T('tarihine', 'plus / minus'))}</span>
            <input type="text" class="fcOperandNum" data-fc-adddays-days value="${esc(builder.adddays.days)}" inputmode="numeric" autocomplete="off" aria-label="${esc(T('Gün sayısı', 'Number of days'))}">
            <span>${esc(T('gün', 'days'))}</span>
            <select class="fcPick fcPickShort" data-fc-adddays-dir aria-label="${esc(T('Yön', 'Direction'))}">
              <option value="+"${builder.adddays.dir === '-' ? '' : ' selected'}>${esc(T('ekle', 'add'))}</option>
              <option value="-"${builder.adddays.dir === '-' ? ' selected' : ''}>${esc(T('çıkar', 'subtract'))}</option>
            </select>
          </div>
          <p class="fcNote">${esc(T('Sonuç bir TARİHTİR ve tablodaki diğer tarihler gibi gösterilir. Ör. Ex-factory’den 30 gün öncesi için “çıkar”ı seçin.', 'The result is a DATE shown like the other dates. For 30 days before Ex-factory pick “subtract”.'))}</p>`;
      } else if (builder.mode === 'ifelse') {
        const rule = builder.ifelse;
        if (!Array.isArray(rule.cases)) rule.cases = [];
        const cases = [rule, ...rule.cases];
        const many = cases.length > 1;
        // Türkçede yüklem sonda ("Adet 1000'den büyükse"), İngilizcede ortada.
        const caseHtml = (item, caseIndex) => {
          if (!Array.isArray(item.more)) item.more = [];
          const conditions = [item, ...item.more];
          const joinWord = item.join === 'or' ? T('veya', 'or') : T('ve', 'and');
          const conditionRow = (cond, index) => {
            const needsRight = cond.cmp !== 'blank' && cond.cmp !== 'notblank';
            const rightKind = cond.right && cond.right.kind === 'column' ? 'column' : 'value';
            const right = cond.right || { kind: 'value', column: '', value: '' };
            const leftHtml = pick(`data-fc-if-left="${index}"`, cond.left, T('Sütun…', 'Column…'));
            const cmpHtml = `<select class="fcPick" data-fc-if-cmp="${index}" aria-label="${esc(T('Koşul', 'Condition'))}">${COMPARISONS.map(entry => `<option value="${entry.id}"${cond.cmp === entry.id ? ' selected' : ''}>${esc(en() ? entry.en : entry.tr)}</option>`).join('')}</select>`;
            const rightHtml = needsRight ? `<select class="fcPick fcPickShort" data-fc-if-right-kind="${index}" aria-label="${esc(T('Neyle karşılaştırılsın?', 'Compare with'))}">
                  <option value="value"${rightKind === 'value' ? ' selected' : ''}>${esc(T('şu değer:', 'this value:'))}</option>
                  <option value="column"${rightKind === 'column' ? ' selected' : ''}>${esc(T('şu sütun:', 'this column:'))}</option>
                </select>
                ${rightKind === 'column'
                  ? pick(`data-fc-if-right-column="${index}"`, right.column, T('Sütun…', 'Column…'))
                  : `<input type="text" class="fcSentenceInput" data-fc-if-right-value="${index}" value="${esc(right.value)}" placeholder="${esc(T('ör. 1000 ya da ELBİSE', 'e.g. 1000 or DRESS'))}" autocomplete="off">`}` : '';
            // İlk satır "Eğer" (sonraki kurallarda "Değilse, eğer"), sonrakiler kuralın "ve / veya" seçimiyle bağlanır.
            const lead = index === 0
              ? `<span>${esc(caseIndex ? T('Değilse, eğer', 'Otherwise, if') : T('Eğer', 'If'))}</span>`
              : `<select class="fcPick fcPickShort" data-fc-if-join aria-label="${esc(T('Koşullar nasıl bağlansın?', 'How are the conditions combined?'))}">
                  <option value="and"${item.join === 'or' ? '' : ' selected'}>${esc(T('ve', 'and'))}</option>
                  <option value="or"${item.join === 'or' ? ' selected' : ''}>${esc(T('veya', 'or'))}</option>
                </select>`;
            const drop = index > 0 ? `<button type="button" class="fcMini fcMiniDrop" data-fc-if-drop="${index}" title="${esc(T('Koşulu kaldır', 'Remove condition'))}">×</button>` : '';
            return `<div class="fcSentence" data-fc-if-row="${index}">${lead}${leftHtml}${en() ? cmpHtml + rightHtml : rightHtml + cmpHtml}${drop}</div>`;
          };
          const summary = conditions.length > 1
            ? (item.join === 'or'
              ? T(`${conditions.length} koşuldan EN AZ BİRİ sağlanırsa`, `If AT LEAST ONE of the ${conditions.length} conditions is met`)
              : T(`${conditions.length} koşulun HEPSİ sağlanırsa`, `If ALL ${conditions.length} conditions are met`))
            : '';
          return `<div class="fcCase${many ? ' isMany' : ''}" data-fc-case="${caseIndex}">
            ${many ? `<div class="fcCaseHead"><span>${esc(T(`Kural ${caseIndex + 1}`, `Rule ${caseIndex + 1}`))}</span>${caseIndex ? `<button type="button" class="fcMini fcMiniDrop" data-fc-case-drop="${caseIndex}" title="${esc(T('Kuralı kaldır', 'Remove rule'))}">×</button>` : ''}</div>` : ''}
            ${conditions.map(conditionRow).join('')}
            <div class="fcSentence">
              <button type="button" class="fcMini fcMiniAdd" data-fc-if-add>+ ${esc(T(`koşul ekle (${joinWord})`, `add condition (${joinWord})`))}</button>
              ${summary ? `<span class="fcNote">${esc(summary)}</span>` : ''}
            </div>
            <div class="fcSentence">
              <span>${esc(T('→ şunu yaz:', '→ write:'))}</span>
              <input type="text" class="fcSentenceInput" data-fc-if-then value="${esc(item.then)}" placeholder="${esc(T('ör. Gecikmeli', 'e.g. Late'))}" autocomplete="off">
            </div>
          </div>`;
        };
        build.innerHTML = `${cases.map(caseHtml).join('')}
          <div class="fcSentence">
            <button type="button" class="fcMini fcMiniAdd" data-fc-case-add>+ ${esc(T('başka bir kural ekle (değilse eğer…)', 'add another rule (otherwise if…)'))}</button>
          </div>
          <div class="fcSentence fcElseRow">
            <span>${esc(many ? T('Hiçbir kural tutmazsa şunu yaz:', 'If no rule matches, write:') : T('değilse:', 'otherwise:'))}</span>
            <input type="text" class="fcSentenceInput" data-fc-if-else value="${esc(rule.else)}" placeholder="${esc(T('ör. Zamanında (boş bırakılabilir)', 'e.g. On time (may be left empty)'))}" autocomplete="off">
          </div>
          <p class="fcNote">${esc(many
            ? T('Kurallar YUKARIDAN AŞAĞI denenir; bir satıra İLK uyan kuralın sonucu yazılır (Excel’deki iç içe EĞER gibi). Bu yüzden daha özel kuralı üste koyun. Boş hücre için “boşsa” seçin.', 'Rules are tried FROM TOP TO BOTTOM; a row gets the result of the FIRST rule it matches (like nested IF in Excel). Put the more specific rule first. For an empty cell pick “is blank”.')
            : T('Tarihleri, sayıları ve metinleri karşılaştırabilirsiniz; büyük/küçük harf fark etmez. Birden çok sütunu “+ koşul ekle” ile bağlayın: “ve” hepsinin, “veya” en az birinin sağlanmasını ister. Duruma göre FARKLI sonuçlar için “+ başka bir kural ekle” (ör. X = 0 ise “N/A”, X = 1 ve Y = 0 ise “Pending”, X = 1 ve Y = 1 ise “OK”).', 'You can compare dates, numbers and text; case does not matter. Link several columns with “+ add condition”: “and” needs all, “or” needs at least one. For DIFFERENT results per situation use “+ add another rule” (e.g. X = 0 → “N/A”, X = 1 and Y = 0 → “Pending”, X = 1 and Y = 1 → “OK”).'))}</p>`;
      } else if (builder.mode === 'ai') {
        build.innerHTML = aiPanelHtml();
        renderAiPrompt();
        renderAiResult();
      } else {
        build.innerHTML = `<label class="fcField">${esc(T('Formül', 'Formula'))}
            <textarea data-fc-formula rows="3" spellcheck="false" placeholder="${esc('DAYS([Ex-factory], [Retail Date])')}">${esc(builder.advanced)}</textarea>
          </label>
          <div class="fcInsertRow">
            <label class="fcField fcInsertField">${esc(T('Sütun ekle', 'Insert column'))}
              <select data-fc-insert><option value="">${esc(T('Sütun seçin…', 'Pick a column…'))}</option>${columns.map(col => `<option value="${esc(col.label)}">${esc(optionLabel(col))}</option>`).join('')}</select>
            </label>
            <p class="fcNote fcInsertNote">${esc(T('Sütunlar ADIYLA yazılır; sütunun adını sonradan değiştirseniz de formül bozulmaz.', 'Columns are written by NAME; renaming a column later does not break the formula.'))}</p>
          </div>
          <div class="fcAnalysis" data-fc-analysis aria-live="polite"></div>
          ${dictionaryHtml()}`;
        renderAnalysis();
      }
      renderFormulaEcho();
    }

    /* ---- sözlük ---- */
    function dictionaryHtml() {
      const docs = E.FUNCTION_DOCS || [];
      const categories = (E.CATEGORIES || []).map(category => {
        const items = docs.filter(item => item.cat === category.id);
        return `<div class="fcDictGroup"><div class="fcDictHead">${esc(en() ? category.en : category.tr)}</div>${items.map(item => `
          <div class="fcDictItem" data-fc-dict-item="${esc(`${item.name} ${(item.also || []).join(' ')} ${item.tr} ${item.en}`.toLocaleLowerCase('tr-TR'))}">
            <div class="fcDictTop"><code>${esc(en() ? item.syntaxEn : item.syntax)}</code><button type="button" class="fcMini" data-fc-dict-insert="${esc(item.name)}" title="${esc(T('Formüle ekle', 'Insert into formula'))}">${esc(T('Ekle', 'Insert'))}</button></div>
            <div class="fcDictText">${esc(en() ? item.en : item.tr)}</div>
            <div class="fcDictExample"><code>${esc(item.example)}</code> → ${esc(en() ? item.resultEn : item.resultTr)}</div>
          </div>`).join('')}</div>`;
      }).join('');
      return `<details class="fcDict" data-fc-dict>
          <summary>${esc(T('📖 Formül sözlüğü — nasıl çalışır, hangi iş için hangi formül', '📖 Formula dictionary — how it works, which formula for which job'))}</summary>
          <input type="search" class="fcDictSearch" data-fc-dict-search placeholder="${esc(T('Ara: gün, yüzde, koşul, birleştir…', 'Search: days, percent, condition, join…'))}" autocomplete="off">
          <div class="fcDictGroup" data-fc-dict-block>
            <div class="fcDictHead">${esc(T('Nasıl çalışır?', 'How does it work?'))}</div>
            <ol class="fcRules">${(E.RULES || []).map(rule => `<li>${esc(en() ? rule.en : rule.tr)}</li>`).join('')}</ol>
          </div>
          <div class="fcDictGroup">
            <div class="fcDictHead">${esc(T('Hangi iş için hangi formül?', 'Which formula for which job?'))}</div>
            ${(E.RECIPE_DOCS || []).map(item => `<div class="fcDictItem fcDictRecipe" data-fc-dict-item="${esc(`${item.tr} ${item.en} ${item.formula}`.toLocaleLowerCase('tr-TR'))}">
              <div class="fcDictText">${esc(en() ? item.en : item.tr)}</div>
              <div class="fcDictTop"><code>${esc(item.formula)}</code><button type="button" class="fcMini" data-fc-dict-use="${esc(item.formula)}" title="${esc(T('Örneği formül kutusuna ekler; köşeli parantezdeki adları kendi sütunlarınızla değiştirin.', 'Inserts the example; replace the names in brackets with your own columns.'))}">${esc(T('Kullan', 'Use'))}</button></div>
            </div>`).join('')}
          </div>
          <div class="fcDictGroup">
            <div class="fcDictHead">${esc(T('İşlem işaretleri', 'Operators'))}</div>
            ${(E.OPERATOR_DOCS || []).map(item => `<div class="fcDictItem" data-fc-dict-item="${esc(`${item.sign} ${item.tr} ${item.en}`.toLocaleLowerCase('tr-TR'))}">
              <div class="fcDictTop"><code>${esc(item.sign)}</code><span class="fcDictText">${esc(en() ? item.en : item.tr)}</span></div>
              <div class="fcDictExample"><code>${esc(item.example)}</code></div>
            </div>`).join('')}
          </div>
          ${categories}
        </details>`;
    }

    /* ---- analiz (Gelişmiş ve AI) ---- */
    const resolvable = name => Boolean(resolveRef(columnIndex(tableKey), name, false));
    const knownNames = () => columns.map(col => col.label);
    function analyzeText(text) {
      return E.analyze(text, { columns: knownNames(), resolve: resolvable });
    }
    function issuesHtml(result, options = {}) {
      if (!result) return '';
      const icon = level => (level === 'error' ? '✕' : level === 'warn' ? '!' : 'i');
      const rows = result.issues.map(item => `<li class="fcIssue is-${item.level}"><span class="fcIssueIcon" aria-hidden="true">${icon(item.level)}</span><span><b>${esc(en() ? item.en : item.tr)}</b>${(en() ? item.hintEn : item.hintTr) ? `<br>${esc(en() ? item.hintEn : item.hintTr)}` : ''}${item.position != null && options.caret !== false ? `<br><code class="fcCaret">${esc(caretSnippet(result.formula, item.position))}</code>` : ''}${item.suggestion ? ` <button type="button" class="fcMini" data-fc-fix-column="${esc(item.column)}" data-fc-fix-to="${esc(item.suggestion)}">${esc(T(`[${item.suggestion}] yap`, `Use [${item.suggestion}]`))}</button>` : ''}</span></li>`).join('');
      const fixes = result.fixes.length && options.fixes !== false
        ? `<li class="fcIssue is-info"><span class="fcIssueIcon" aria-hidden="true">✓</span><span><b>${esc(options.applied ? T('Otomatik düzeltildi:', 'Fixed automatically:') : T('Otomatik düzeltilebilir:', 'Can be fixed automatically:'))}</b> ${esc(result.fixes.map(item => (en() ? item.en : item.tr)).join(' '))}${options.applied ? '' : ` <button type="button" class="fcMini" data-fc-autofix>${esc(T('Düzelt', 'Fix'))}</button>`}</span></li>` : '';
      const ok = result.ok && !result.issues.some(item => item.level === 'warn')
        ? `<li class="fcIssue is-ok"><span class="fcIssueIcon" aria-hidden="true">✓</span><span><b>${esc(T('Formül geçerli.', 'The formula is valid.'))}</b> ${esc(T('Sonucu aşağıdaki önizlemede kontrol edin.', 'Check the result in the preview below.'))}</span></li>` : '';
      return `<ul class="fcIssues">${fixes}${rows}${ok}</ul>`;
    }
    function caretSnippet(text, position) {
      const start = Math.max(0, position - 18);
      return `${start ? '…' : ''}${text.slice(start, position)} ⟶ ${text.slice(position, position + 18)}${position + 18 < text.length ? '…' : ''}`;
    }
    function renderAnalysis() {
      const box = modal.querySelector('[data-fc-analysis]');
      if (!box) return;
      const text = clean(builder.advanced);
      box.innerHTML = text ? issuesHtml(analyzeText(text)) : `<p class="fcNote">${esc(T('Yazdıkça formül burada denetlenir: eksik parantez, olmayan sütun, yanlış fonksiyon adı…', 'The formula is checked here as you type: missing brackets, unknown columns, wrong function names…'))}</p>`;
    }

    /* ---- AI ile yaz ---- */
    function aiPanelHtml() {
      return `<ol class="fcAiSteps">
          <li>
            <b>${esc(T('Ne istediğinizi kendi cümlenizle yazın', 'Describe what you want in your own words'))}</b>
            <textarea data-fc-ai-request rows="3" placeholder="${esc(T('Örn. Ex-factory, Retail Date’ten sonraysa “Gecikmeli”, 7 günden az fark varsa “Riskli”, değilse “Zamanında” yazsın.', 'e.g. If Ex-factory is after Retail Date write “Late”, if they are less than 7 days apart write “At risk”, otherwise “On time”.'))}">${esc(builder.ai.request)}</textarea>
          </li>
          <li>
            <b>${esc(T('Yönergeyi kopyalayın ve kullandığınız AI aracına yapıştırın', 'Copy the instructions and paste them into your AI tool'))}</b>
            <div class="fcAiRow">
              <button type="button" class="fcBtn fcPrimary" data-fc-ai-copy>${esc(T('AI yönergesini kopyala', 'Copy AI instructions'))}</button>
              <details class="fcAiPromptWrap"><summary>${esc(T('Yönergeyi göster', 'Show instructions'))}</summary><pre class="fcAiPrompt" data-fc-ai-prompt></pre></details>
            </div>
            <p class="fcNote">${esc(T('Yönerge formül kurallarını, fonksiyon sözlüğünü ve bu tablonun yalnız sütun ADLARINI içerir; hiçbir satır verisi (sipariş, fiyat, tedarikçi) eklenmez. Şirketinizin izin verdiği bir AI aracını kullanın.', 'The instructions contain the formula rules, the dictionary and only the column NAMES of this table; no row data (orders, prices, suppliers) is included. Use an AI tool your company allows.'))}</p>
          </li>
          <li>
            <b>${esc(T('AI’ın cevabını buraya yapıştırın', 'Paste the AI’s answer here'))}</b>
            <textarea data-fc-ai-answer rows="4" spellcheck="false" placeholder="${esc(T('Cevabın tamamını yapıştırabilirsiniz; formül kendiliğinden bulunur ve denetlenir.', 'You can paste the whole answer; the formula is found and checked automatically.'))}">${esc(builder.ai.answer)}</textarea>
            <div class="fcAiResult" data-fc-ai-result aria-live="polite"></div>
          </li>
        </ol>`;
    }
    function aiPrompt() {
      const request = clean(builder.ai.request);
      return E.buildAiPrompt({
        lang: en() ? 'en' : 'tr',
        tableName: en() ? TABLES[tableKey].en : TABLES[tableKey].tr,
        columns: columns.map(col => ({ name: col.label, type: columnType(tableKey, col.ref) })),
        request,
      });
    }
    function renderAiPrompt() {
      const box = modal.querySelector('[data-fc-ai-prompt]');
      if (box) box.textContent = aiPrompt();
    }
    function renderAiResult() {
      const box = modal.querySelector('[data-fc-ai-result]');
      if (!box) return;
      const answer = clean(builder.ai.answer);
      if (!answer) { builder.ai.formula = ''; box.innerHTML = ''; return; }
      const extracted = E.extractFormula(answer);
      const result = analyzeText(extracted);
      // Otomatik düzeltmeler (EĞER → IF, kıvrık tırnak…) AI çıktısında hemen uygulanır.
      builder.ai.formula = result.ok ? result.formula : '';
      box.innerHTML = `<div class="fcAiFound"><span>${esc(T('Bulunan formül', 'Formula found'))}</span><code>${esc(result.formula || extracted)}</code></div>
        ${issuesHtml(result, { applied: true })}
        <div class="fcAiRow">
          <button type="button" class="fcMini" data-fc-ai-edit>${esc(T('Gelişmiş kipte düzenle', 'Edit in Advanced'))}</button>
          ${result.ok ? '' : `<span class="fcNote">${esc(T('Hatayı AI’a da söyleyebilirsiniz: yukarıdaki mesajı kopyalayıp “bunu düzelt” deyin.', 'You can also tell the AI: copy the message above and say “fix this”.'))}</span>`}
        </div>`;
    }

    /* Üretilen formül HER ZAMAN gösterilir: kartların ne ürettiği sır kalmaz,
       kullanıcı isterse Gelişmiş kipe geçip aynı yerden devam eder. */
    function renderFormulaEcho() {
      const echo = modal.querySelector('[data-fc-echo]');
      if (!echo) return;
      const formula = builderFormula(builder);
      echo.hidden = builder.mode === 'advanced' || builder.mode === 'ai' || !formula;
      if (!echo.hidden) echo.innerHTML = `<span>${esc(T('Formül', 'Formula'))}</span><code>${esc(shown(formula))}</code><button type="button" class="fcMini" data-fc-mode-jump="advanced">${esc(T('Elle düzenle', 'Edit by hand'))}</button>`;
    }

    // Kaydedilecek biçim: ekrandaki adlar kalıcı anahtara çevrilir.
    const storedFormula = () => toStorage(tableKey, builderFormula(builder), draft.refs);
    const currentDraft = () => {
      const stored = storedFormula();
      return {
        ...draft,
        label: (clean(labelInput.value) || clean(labelEnInput.value)).replace(/[\[\]]/g, ''),
        labelTr: clean(labelInput.value).replace(/[\[\]]/g, ''),
        labelEn: clean(labelEnInput.value).replace(/[\[\]]/g, ''),
        formula: stored.formula,
        refs: stored.refs,
        format: formatInput.value,
        decimals: clean(decimalsInput.value),
        group: chosenGroup(),
      };
    };

    /* Ad önerisi: kullanıcı başlığa henüz dokunmadıysa kart doldukça anlamlı
       bir ad yazılır. Boş başlık yüzünden "Kaydet" hata vermesin. */
    function suggestedLabel() {
      const n = ref => (ref ? nameOfRef(ref) : '');
      if (builder.mode === 'days' && builder.days.start && builder.days.end) return T(`${n(builder.days.start)} → ${n(builder.days.end)} (gün)`, `${n(builder.days.start)} → ${n(builder.days.end)} (days)`);
      if (builder.mode === 'percent' && builder.percent.a && builder.percent.b) return builder.percent.kind === 'change' ? T(`${n(builder.percent.a)} değişim %`, `${n(builder.percent.a)} change %`) : `${n(builder.percent.a)} / ${n(builder.percent.b)} %`;
      if (builder.mode === 'adddays' && builder.adddays.date && clean(builder.adddays.days)) return `${n(builder.adddays.date)} ${builder.adddays.dir === '-' ? '−' : '+'} ${clean(builder.adddays.days)} ${T('gün', 'days')}`;
      if (builder.mode === 'join' && builder.columns.filter(Boolean).length) return builder.columns.filter(Boolean).map(n).join(' + ');
      if (builder.mode === 'ifelse' && builder.ifelse.left) return T(`${n(builder.ifelse.left)} kontrolü`, `${n(builder.ifelse.left)} check`);
      if (builder.mode === 'calc' && builder.operands.every(operand => operandExpression(operand))) {
        return builder.operands.map((operand, index) => `${index ? ` ${(OPERATORS.find(item => item.op === builder.operators[index - 1]) || OPERATORS[0]).sign} ` : ''}${operand.kind === 'number' ? operand.number : n(operand.column)}`).join('');
      }
      return '';
    }

    function renderPreview() {
      renderFormulaEcho();
      if (!labelTouched) (en() ? labelEnInput : labelInput).value = suggestedLabel().slice(0, 60);
      if (!formatTouched) formatInput.value = SUGGESTED_FORMAT[builder.mode] || 'auto';
      const item = currentDraft();
      if (!item.formula) {
        preview.className = 'fcPreview';
        preview.textContent = builder.mode === 'advanced'
          ? T('Formülü yazdıkça sonucu burada göreceksiniz.', 'You will see the result here as you type.')
          : builder.mode === 'ai'
            ? T('AI’ın cevabını yapıştırınca sonucu burada göreceksiniz.', 'Paste the AI’s answer to see the result here.')
            : T('Kutuları doldurun; sonucu ilk satırlarda burada göreceksiniz.', 'Fill in the boxes; you will see the result on the first rows here.');
        return;
      }
      const program = E.compile(item.formula);
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
      const refIndex = columnIndex(tableKey);
      const results = rows.map(row => program.evaluate(row, { strictColumns: true }));
      const failed = results.find(result => !result.ok);
      const lines = results.map((result, rowIndex) => {
        const label = rowLabel(tableKey, rows[rowIndex], rowIndex);
        const value = result.ok ? formatValue(result.value, item) : '—';
        return `<div class="fcPreviewRow"><span>${esc(label)}</span><b>${esc(value || '—')}</b></div>`;
      }).join('');
      preview.className = failed ? 'fcPreview isWarn' : 'fcPreview isOk';
      preview.innerHTML = `<div class="fcPreviewHead">${esc(T('İlk satırlarda sonuç', 'Result on the first rows'))}${failed ? ` · ${esc(friendlyError(failed, refIndex, item.refs))}` : ''}</div>${lines}`;
    }

    const firstFreeColumn = () => {
      const used = new Set(builder.mode === 'join' ? builder.columns : []);
      const free = columns.find(col => !used.has(col.ref));
      return free ? free.ref : (columns[0] ? columns[0].ref : '');
    };
    const setMode = next => {
      if (next === builder.mode) return;
      // Gelişmiş kipe geçerken kartın ürettiği formül taşınır: kullanıcı
      // kurduğu şeyi kaybetmeden elle geliştirmeye devam edebilsin.
      if (next === 'advanced') builder.advanced = shown(builderFormula(builder)) || builder.advanced;
      builder.mode = next;
      modal.querySelectorAll('[data-fc-mode]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.fcMode === next);
        btn.setAttribute('aria-selected', String(btn.dataset.fcMode === next));
        btn.setAttribute('tabindex', btn.dataset.fcMode === next ? '0' : '-1');
      });
      renderBuild(); renderPreview();
    };

    modal.addEventListener('input', event => {
      const target = event.target;
      if (target.matches('[data-fc-formula]')) { builder.advanced = target.value; renderAnalysis(); renderPreview(); return; }
      if (target.matches('[data-fc-ai-request]')) { builder.ai.request = target.value; renderAiPrompt(); return; }
      if (target.matches('[data-fc-ai-answer]')) { builder.ai.answer = target.value; renderAiResult(); renderPreview(); return; }
      if (target.matches('[data-fc-dict-search]')) {
        const query = clean(target.value).toLocaleLowerCase('tr-TR');
        modal.querySelectorAll('[data-fc-dict-item]').forEach(item => { item.hidden = Boolean(query) && !item.dataset.fcDictItem.includes(query); });
        modal.querySelectorAll('.fcDictGroup').forEach(group => {
          const items = group.querySelectorAll('[data-fc-dict-item]');
          group.hidden = Boolean(query) && (items.length ? [...items].every(item => item.hidden) : true);
        });
        return;
      }
      if (target.matches('[data-fc-operand-number]')) {
        builder.operands[Number(target.dataset.fcOperandNumber)].number = target.value;
        renderPreview(); return;
      }
      if (target.matches('[data-fc-adddays-days]')) { builder.adddays.days = target.value; renderPreview(); return; }
      if (target.matches('[data-fc-if-right-value]')) { ifCondition(target.dataset.fcIfRightValue, caseOf(target)).right.value = target.value; renderPreview(); return; }
      if (target.matches('[data-fc-if-then]')) { ifCase(caseOf(target)).then = target.value; renderPreview(); return; }
      if (target.matches('[data-fc-if-else]')) { builder.ifelse.else = target.value; renderPreview(); return; }
      if (target.matches('[data-fc-separator-custom]')) {
        builder.separator = target.value;
        modal.querySelectorAll('[data-fc-separator]').forEach(chip => chip.classList.toggle('active', chip.dataset.fcSeparator === builder.separator));
        target.classList.add('active');
        renderPreview(); return;
      }
      if (target.matches('[data-fc-label],[data-fc-label-en]')) {
        labelTouched = Boolean(clean(labelInput.value) || clean(labelEnInput.value));
        return;
      }
      if (target.closest('[data-fc-decimals]')) renderPreview();
    });
    modal.addEventListener('change', event => {
      const target = event.target;
      if (target.matches('[data-fc-format]')) { formatTouched = true; renderPreview(); return; }
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
      if (target.matches('[data-fc-days]')) { builder.days[target.dataset.fcDays] = target.value; renderPreview(); return; }
      if (target.matches('[data-fc-percent-kind]')) { builder.percent.kind = target.value; renderBuild(); renderPreview(); return; }
      if (target.matches('[data-fc-percent]')) { builder.percent[target.dataset.fcPercent] = target.value; renderPreview(); return; }
      if (target.matches('[data-fc-adddays-date]')) { builder.adddays.date = target.value; renderPreview(); return; }
      if (target.matches('[data-fc-adddays-dir]')) { builder.adddays.dir = target.value; renderPreview(); return; }
      if (target.matches('[data-fc-if-left]')) { ifCondition(target.dataset.fcIfLeft, caseOf(target)).left = target.value; renderPreview(); return; }
      if (target.matches('[data-fc-if-cmp]')) { ifCondition(target.dataset.fcIfCmp, caseOf(target)).cmp = target.value; renderBuild(); renderPreview(); return; }
      if (target.matches('[data-fc-if-right-kind]')) { ifCondition(target.dataset.fcIfRightKind, caseOf(target)).right.kind = target.value; renderBuild(); renderPreview(); return; }
      if (target.matches('[data-fc-if-right-column]')) { ifCondition(target.dataset.fcIfRightColumn, caseOf(target)).right.column = target.value; renderPreview(); return; }
      if (target.matches('[data-fc-if-join]')) { ifCase(caseOf(target)).join = target.value === 'or' ? 'or' : 'and'; renderBuild(); renderPreview(); return; }
      const insert = target.closest('[data-fc-insert]');
      if (insert && insert.value) {
        const field = modal.querySelector('[data-fc-formula]');
        if (field) { insertAtCursor(field, `[${insert.value}]`); builder.advanced = field.value; }
        insert.value = '';
        renderAnalysis();
        renderPreview();
      }
    });
    modal.addEventListener('click', event => {
      if (event.target === modal || event.target.closest('[data-fc-close]')) { close(); return; }
      const mode = event.target.closest('[data-fc-mode]');
      if (mode) { setMode(mode.dataset.fcMode); return; }
      const jump = event.target.closest('[data-fc-mode-jump]');
      if (jump) { setMode(jump.dataset.fcModeJump); modal.querySelector('[data-fc-formula]')?.focus(); return; }
      const separator = event.target.closest('[data-fc-separator]');
      if (separator) { builder.separator = separator.dataset.fcSeparator; renderBuild(); renderPreview(); return; }
      if (event.target.closest('[data-fc-case-add]')) {
        const rule = builder.ifelse;
        if (!Array.isArray(rule.cases)) rule.cases = [];
        if (rule.cases.length >= 19) { toast(T('En fazla 20 kural eklenebilir.', 'At most 20 rules can be added.')); return; }
        rule.cases.push({ left: '', cmp: 'eq', right: { kind: 'value', column: '', value: '' }, more: [], join: 'and', then: '' });
        renderBuild(); renderPreview();
        modal.querySelector(`[data-fc-case="${rule.cases.length}"] [data-fc-if-left]`)?.focus();
        return;
      }
      const dropCase = event.target.closest('[data-fc-case-drop]');
      if (dropCase) {
        const index = Number(dropCase.dataset.fcCaseDrop);
        if (index > 0) builder.ifelse.cases.splice(index - 1, 1);
        renderBuild(); renderPreview(); return;
      }
      const addCondition = event.target.closest('[data-fc-if-add]');
      if (addCondition) {
        const rule = ifCase(caseOf(addCondition));
        if (!Array.isArray(rule.more)) rule.more = [];
        if (rule.more.length >= 9) { toast(T('En fazla 10 koşul bağlanabilir.', 'At most 10 conditions can be linked.')); return; }
        rule.more.push({ left: '', cmp: 'eq', right: { kind: 'value', column: '', value: '' } });
        renderBuild(); renderPreview(); return;
      }
      const dropCondition = event.target.closest('[data-fc-if-drop]');
      if (dropCondition) {
        const index = Number(dropCondition.dataset.fcIfDrop);
        if (index > 0) ifCase(caseOf(dropCondition)).more.splice(index - 1, 1);
        renderBuild(); renderPreview(); return;
      }
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
      const dictInsert = event.target.closest('[data-fc-dict-insert],[data-fc-dict-use]');
      if (dictInsert) {
        const field = modal.querySelector('[data-fc-formula]');
        if (field) {
          if (dictInsert.dataset.fcDictUse) insertAtCursor(field, dictInsert.dataset.fcDictUse);
          else { insertAtCursor(field, `${dictInsert.dataset.fcDictInsert}()`); try { field.setSelectionRange(field.selectionStart - 1, field.selectionStart - 1); } catch (_) { /* imleç taşınamazsa sorun değil */ } }
          builder.advanced = field.value;
        }
        renderAnalysis(); renderPreview();
        return;
      }
      if (event.target.closest('[data-fc-autofix]')) {
        const field = modal.querySelector('[data-fc-formula]');
        builder.advanced = E.autoFix(builder.advanced).formula;
        if (field) field.value = builder.advanced;
        renderAnalysis(); renderPreview();
        return;
      }
      const fixColumn = event.target.closest('[data-fc-fix-column]');
      if (fixColumn) {
        const from = fixColumn.dataset.fcFixColumn, to = fixColumn.dataset.fcFixTo;
        const rename = text => E.rewriteColumns(text, name => (nameKey(name) === nameKey(from) ? to : null));
        if (builder.mode === 'ai') {
          builder.ai.answer = rename(E.autoFix(E.extractFormula(builder.ai.answer)).formula);
          const answer = modal.querySelector('[data-fc-ai-answer]');
          if (answer) answer.value = builder.ai.answer;
          renderAiResult();
        } else {
          builder.advanced = rename(builder.advanced);
          const field = modal.querySelector('[data-fc-formula]');
          if (field) field.value = builder.advanced;
          renderAnalysis();
        }
        renderPreview();
        return;
      }
      if (event.target.closest('[data-fc-ai-copy]')) {
        const text = aiPrompt();
        copyText(text).then(ok => toast(ok
          ? T('AI yönergesi kopyalandı. AI aracınıza yapıştırın, cevabı 3. adıma geri getirin.', 'AI instructions copied. Paste them into your AI tool and bring the answer back to step 3.')
          : T('Kopyalanamadı; “Yönergeyi göster”den seçip kopyalayın.', 'Could not copy; select it under “Show instructions” and copy.')));
        return;
      }
      if (event.target.closest('[data-fc-ai-edit]')) {
        const found = builder.ai.formula || E.autoFix(E.extractFormula(builder.ai.answer)).formula;
        builder.advanced = found;
        setMode('advanced');
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
        if (!item.label) { toast(T('Sütun başlığı gerekli.', 'A column heading is required.')); (en() ? labelEnInput : labelInput).focus(); return; }
        if (groupInput.value === NEW_GROUP && !item.group) {
          toast(T('Yeni başlık adı gerekli.', 'A new heading name is required.'));
          groupNewInput.focus();
          return;
        }
        if (!item.formula) {
          toast(builder.mode === 'join'
            ? T('Birleştirilecek en az bir sütun seçin.', 'Pick at least one column to join.')
            : builder.mode === 'advanced'
              ? T('Formül gerekli.', 'A formula is required.')
              : builder.mode === 'ai'
                ? T('Önce AI’ın cevabını 3. adıma yapıştırın; formülde hata varsa düzeltin.', 'First paste the AI’s answer into step 3 and fix any error.')
                : T('Kutuların hepsini doldurun.', 'Fill in all the boxes.'));
          modal.querySelector('[data-fc-formula],[data-fc-ai-answer],.fcBuild select')?.focus();
          return;
        }
        const program = E.compile(item.formula);
        if (!program.ok) {
          toast(`${T('Formül hatası', 'Formula error')}: ${program.error.message}`);
          modal.querySelector('[data-fc-formula]')?.focus();
          return;
        }
        if (program.columns.includes(columnKey(item))) {
          toast(T('Sütun kendi değerini kullanamaz; formülden kendi adını çıkarın.', 'A column cannot use its own value; remove its own name from the formula.'));
          return;
        }
        /* Analiz HATA buluyorsa kayıt durur: bilinmeyen fonksiyon ya da yanlış
           argüman sayısı hiçbir satırda çalışmaz. Tabloda olmayan bir sütun ise
           geçici olabilir (veri tabanı sütunu henüz yüklenmemiş); kullanıcıya
           sorulur. */
        const analysis = analyzeText(shown(item.formula));
        const blocking = analysis.issues.filter(entry => entry.level === 'error' && entry.code !== 'UNKNOWN_COLUMN');
        if (blocking.length) { toast(`${T('Formülde hata var', 'The formula has an error')}: ${en() ? blocking[0].en : blocking[0].tr}`); return; }
        const missing = analysis.issues.filter(entry => entry.code === 'UNKNOWN_COLUMN').map(entry => `[${entry.column}]`);
        if (missing.length && !confirm(T(`Bu tabloda bulunamayan sütun var: ${missing.join(', ')}. Bu sütun hesaplanamaz ve “—” gösterir. Yine de kaydedilsin mi?`, `Some columns were not found in this table: ${missing.join(', ')}. The column cannot be calculated and shows “—”. Save anyway?`))) return;
        /* Aynı adda iki sütun, formülde [ad] yazıldığında hangisinin kastedildiğini
           belirsizleştirir. Yeni ya da yeniden adlandırılan sütunda engellenir. */
        const renamed = !existing || nameKey(existing.label) !== nameKey(item.label);
        const clash = renamed && (definitions(tableKey).some(entry => entry.id !== item.id && nameKey(entry.label) === nameKey(item.label))
          || sourceColumns(tableKey, item.id).some(col => !col.calculated && nameKey(col.label) === nameKey(item.label)));
        if (clash) { toast(T('Bu tabloda aynı adda bir sütun zaten var; farklı bir ad verin.', 'This table already has a column with that name; pick another name.')); (en() ? labelEnInput : labelInput).focus(); return; }
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
    setTimeout(() => {
      const preferredLabel = en() ? labelEnInput : labelInput;
      (existing ? preferredLabel : modal.querySelector('.fcRecipe.active') || preferredLabel).focus();
    }, 0);
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
    if (window.BLColumnState && typeof window.BLColumnState.forget === 'function') window.BLColumnState.forget(tableKey, [key]);
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
    calcFormula, joinFormula, builderFormula, builderFromFormula, OPERATORS, SEPARATORS, COMPARISONS,
    // v7.175 — yeniden adlandırmaya dayanıklı başvuru katmanı.
    columnIndex, resolveRef, toStorage, displayFormula, migrateReferences,
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
