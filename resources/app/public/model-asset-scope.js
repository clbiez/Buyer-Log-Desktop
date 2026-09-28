/* GÜNCEL GÖRÜNÜM MODEL VARLIK KAPSAMI (v11.10)
 *
 * SORUN. "Model görsellerini tamamla" eskiden yalnız CP / Siparişler /
 * Koleksiyon ana tablolarından çalıştırılabiliyordu. Bir LFL drilldown'ında,
 * Backlog detayında ya da Pricing History ekranında eksik görsel gören
 * kullanıcının tek yolu ekranı kapatıp ana tabloya dönmekti — ve orada kapsam
 * artık o detayın 24 modeli değil, tablonun tamamıydı.
 *
 * ÇÖZÜM. Görsel taşıyan her görünüm KENDİ kanonik kimlik kümesini bildirir.
 * Buradaki kayıt defteri "şu anda hangi görünüm etkin ve o görünüm hangi
 * modelleri içeriyor" sorusunun TEK cevap yeridir. Modül başına ayrı bir
 * indirici yazılmaz; her modül yalnız bir sağlayıcı kaydeder.
 *
 * KİMLİK ASLA EKRANDAKİ METİNDEN ÇIKARILMAZ. Bulanık eşleşme yanlış modelin
 * görselini yanlış renge bağlayabilir; kimlik her zaman PLM ID + Renk Kodu
 * (+ varsa renk adı) üzerinden kurulur.
 *
 * ANLIK GÖRÜNTÜ. Bir iş başladığında kapsam DONDURULUR. Kullanıcı iş sürerken
 * filtreyi değiştirirse iş ilk kümeyle devam eder; aksi hâlde "18 model
 * güncelleniyor" ortasında küme 4.000 modele çıkabilirdi.
 *
 * GÖRÜNÜM JETONU. Uzak iş bittiğinde ekran çoktan değişmiş olabilir. Kanonik
 * kalıcılık her hâlükârda tamamlanır; ama YENİDEN ÇİZİM yalnız işi başlatan
 * görünüm hâlâ açıksa yapılır. Kapanmış bir modal geri açılmaz.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BLModelAssetScope = factory();
})(typeof window !== 'undefined' ? window : globalThis, function createModelAssetScope() {
  'use strict';

  const providers = new Map();

  const clean = value => String(value == null ? '' : value).trim();
  /* turknorm — server/lib/parse.js ve app-main.js ile BİREBİR aynı.
     Burada `toLocaleUpperCase('tr-TR')` KULLANILAMAZ: o "Kirmizi" için
     "KİRMİZİ", turknorm ise "KIRMIZI" üretir. İki taraf farklı anahtar
     üretirse istemci "görsel var" der, sunucu "yok" der ve kimse sebebini
     bulamaz — bu yüzden normalizasyon tek bir algoritmadır. */
  const upper = value => {
    let text = clean(value).toUpperCase();
    const pairs = [['İ', 'I'], ['I', 'I'], ['Ş', 'S'], ['Ç', 'C'], ['Ö', 'O'], ['Ü', 'U'], ['Ğ', 'G']];
    pairs.forEach(([a, b]) => { text = text.split(a).join(b); });
    return text.replace(/\s+/g, ' ').trim();
  };
  const normalizePlmId = value => {
    let text = clean(value);
    if (/^\d+(?:\.0+)?$/.test(text)) text = text.replace(/\.0+$/, '').replace(/^0+(?=\d)/, '');
    return upper(text);
  };

  /* Kanonik görsel anahtarı sunucudaki parse.plmColourImageNameKey ile AYNI
     biçimi üretir. İki tarafın anahtarı ayrışırsa istemci "görsel var" der,
     sunucu "yok" der ve kimse sebebini bulamaz. */
  function canonicalImageKey(plmId, colourCode, colourName) {
    const plm = normalizePlmId(plmId);
    const colour = upper(colourCode);
    const name = upper(colourName);
    if (!plm) return '';
    if (!colour) return `plm:${plm}`;
    const base = `plm:${plm}|colour:${colour}`;
    return name ? `${base}|name:${name}` : base;
  }

  /* KİMLİK ANAHTARI — PLM ID YOKSA MODEL ADI.
   *
   * Alt detay ekranlarının çoğu PLM ID sütunu taşımaz (OAB yalnız "Option
   * Adı"nı, LFL yalnız "MODEL ADI"nı bilir) ve bu adlar PLM style adlarıyla
   * eşleşmeyebilir. Kimliği burada DÜŞÜRMEK, "bu görünümde model görseli yok"
   * demekle sonuçlanıyordu: ekranda 11 satır varken eylem hiç açılmıyordu.
   * Model adı taşıyan kimlik KORUNUR; PLM ID'yi sunucu kendi ASAS sipariş
   * kaynağından çözer. Uydurma bir ID üretilmez. */
  function identityKey(plmId, colourCode, colour, styleName, orderCode = '') {
    if (plmId) return canonicalImageKey(plmId, colourCode, colour);
    const name = upper(styleName);
    if (!name) return '';
    const code = upper(colourCode);
    const order = upper(orderCode);
    const orderSuffix = order ? `|order:${order}` : '';
    return code ? `name:${name}|colour:${code}${orderSuffix}` : `name:${name}${orderSuffix}`;
  }

  function normalizeIdentity(raw) {
    const plmId = normalizePlmId(raw && raw.plmId);
    const styleName = clean(raw && raw.styleName);
    if (!plmId && !styleName) return null;
    const colourCode = clean(raw && (raw.colourCode != null ? raw.colourCode : raw.ccode));
    const colour = clean(raw && (raw.colour != null ? raw.colour : raw.color));
    const orderCode = clean(raw && (raw.orderCode != null ? raw.orderCode : raw.ocode));
    const key = identityKey(plmId, colourCode, colour, styleName, orderCode);
    if (!key) return null;
    return {
      modelId: clean(raw && raw.modelId),
      rowId: clean(raw && (raw.rowId != null ? raw.rowId : raw.modelId)),
      plmId,
      colourCode,
      colour,
      styleName,
      orderCode,
      specialCode: clean(raw && raw.specialCode),
      /* Görünümün GERÇEKTE görsel gösterip göstermediği. Kanonik kayıt "var"
         dese bile dosya yoksa kullanıcı görsel görmez; "eksik" kararı bu
         gerçeğe de bakar. */
      hasImage: raw && raw.hasImage != null ? Boolean(raw.hasImage) : null,
      // Gerçek kullanıcı/manüel görseli varsa contextual PLM tamamlama bunu
      // eksik sayıp üzerine yazmamalıdır. Bu flag yalnız eksik-kararı içindir;
      // uzak indirme/persistence mantığını değiştirmez.
      manualProtected: Boolean(raw && raw.manualProtected),
      canonicalImageKey: key,
    };
  }

  /* Kimlik tekilleştirme. Aynı model 20 satırda geçse de TEK bir çözümdür.
     Renk kimliği KORUNUR: aynı modelin iki rengi iki ayrı kimliktir, yoksa
     bir rengin görseli sessizce ötekine yazılırdı. */
  function dedupe(list) {
    const unique = new Map();
    for (const raw of Array.isArray(list) ? list : []) {
      const identity = normalizeIdentity(raw);
      if (!identity) continue;
      const key = identity.canonicalImageKey || identity.plmId;
      if (!unique.has(key)) unique.set(key, identity);
    }
    return [...unique.values()];
  }

  /* Sağlayıcı kaydı.
     `isActive()` bu görünümün ŞU AN önde olup olmadığını söyler; birden fazla
     görünüm etkinse en yüksek `priority` kazanır (drilldown ana tablonun
     üstündedir — kullanıcının baktığı yer odur). */
  function registerProvider(name, definition) {
    const id = clean(name);
    if (!id || !definition || typeof definition.resolve !== 'function') return () => {};
    providers.set(id, {
      id,
      priority: Number(definition.priority) || 0,
      isActive: typeof definition.isActive === 'function' ? definition.isActive : () => false,
      resolve: definition.resolve,
    });
    return () => { providers.delete(id); };
  }

  function listProviders() {
    return [...providers.values()].map(provider => ({ id: provider.id, priority: provider.priority }));
  }

  /* Etkin görünümün kapsamı. Hiçbir sağlayıcı etkin değilse null döner ve
     çağıran "bu ekranda model görseli yok" der — sessizce tüm veritabanına
     genişletmez. */
  function resolveProviderScope(provider) {
    if (!provider) return null;
    let resolved = null;
    try { resolved = provider.resolve(); } catch (_) { resolved = null; }
    if (!resolved) return null;
    const identities = dedupe(resolved.identities);
    const selectedKeys = new Set(dedupe(resolved.selectedIdentities).map(item => item.canonicalImageKey || item.plmId));
    return {
      contextType: clean(resolved.contextType) || provider.id,
      viewToken: clean(resolved.viewToken) || provider.id,
      label: clean(resolved.label) || clean(resolved.contextType) || provider.id,
      providerId: provider.id,
      identities,
      selectedIdentities: identities.filter(item => selectedKeys.has(item.canonicalImageKey || item.plmId)),
      /* Görünüm hâlâ aynı mı? Uzak iş dönerken sayfa değişmiş olabilir. */
      isStillCurrent: typeof resolved.isStillCurrent === 'function' ? resolved.isStillCurrent : null,
      repaint: typeof resolved.repaint === 'function' ? resolved.repaint : null,
      hasMissingImage: typeof resolved.hasMissingImage === 'function' ? resolved.hasMissingImage : null,
    };
  }

  /* Ana sayfa eylemleri hangi sağlayıcıya ait olduklarını zaten bilir.
     Örneğin Collection PLM SYNC, görünür bir drilldown/modal sağlayıcısı
     daha yüksek öncelikli olsa bile Collection seçimini okumalıdır.
     currentScope() bağlamsal eylemler için kalır; scopeForProvider() ise
     sayfa-kökü eylemlerinin kapsamının yanlış sağlayıcı tarafından
     gölgelenmesini engeller. */
  function scopeForProvider(name) {
    return resolveProviderScope(providers.get(clean(name)));
  }

  function currentScope() {
    let best = null;
    for (const provider of providers.values()) {
      let active = false;
      try { active = Boolean(provider.isActive()); } catch (_) { active = false; }
      if (!active) continue;
      if (!best || provider.priority > best.priority) best = provider;
    }
    return resolveProviderScope(best);
  }

  /* İŞ KAPSAMININ ANLIK GÖRÜNTÜSÜ. Buradan sonra kapsam yeniden HESAPLANMAZ. */
  function snapshot(scope, { mode = 'missing', source = '', asset = 'images' } = {}) {
    if (!scope) return null;
    const requested = mode === 'selected' ? scope.selectedIdentities : scope.identities;
    return Object.freeze({
      asset, mode, source: clean(source),
      contextType: scope.contextType,
      viewToken: scope.viewToken,
      label: scope.label,
      providerId: scope.providerId,
      identities: Object.freeze(requested.slice()),
      startedAt: new Date().toISOString(),
      isStillCurrent: scope.isStillCurrent,
      repaint: scope.repaint,
    });
  }

  /* İşi başlatan görünüm hâlâ açık mı? Değilse kanonik yazma yine tamamlanır,
     yalnız yeniden çizim yapılmaz: kapanmış bir rapor geri AÇILMAZ. */
  function isViewCurrent(operation) {
    if (!operation) return false;
    const scope = currentScope();
    if (!scope) return false;
    if (typeof operation.isStillCurrent === 'function') {
      try { return Boolean(operation.isStillCurrent()); } catch (_) { return false; }
    }
    return scope.viewToken === operation.viewToken;
  }

  /* "Eksik" tanımı. DOM'un henüz hidratlanmamış olması eksiklik DEĞİLDİR:
     kanonik kayıtta görsel varsa uzak kaynağa gidilmez, yalnız tazelenir. */
  function missingIdentities(operationOrScope, hasCanonicalImage) {
    const list = (operationOrScope && operationOrScope.identities) || [];
    if (typeof hasCanonicalImage !== 'function') return list.slice();
    return list.filter(identity => {
      try { return !hasCanonicalImage(identity); } catch (_) { return true; }
    });
  }

  /* İKİ AŞAMALI PLM SYNC PLANI.
   *
   * Scope burada bir kez dondurulup seçilen her asset için ayrı kuyruk
   * üretilir. `missing` modunda her asset kendi kanonik eksik predicate'ini
   * kullanır; böylece linki olan model link kuyruğuna, görseli olan model de
   * görsel kuyruğuna girmez. Seçilmeyen asset için anahtar bile üretilmez. */
  function planAssetQueues(scope, { mode = 'all', assets = [], missing = {} } = {}) {
    const requested = mode === 'selected'
      ? (scope && scope.selectedIdentities)
      : (scope && scope.identities);
    const identities = dedupe(requested);
    const queues = {};
    [...new Set(Array.isArray(assets) ? assets.map(clean).filter(Boolean) : [])].forEach(asset => {
      const predicate = missing && missing[asset];
      queues[asset] = mode === 'missing' && typeof predicate === 'function'
        ? identities.filter(identity => {
          try { return Boolean(predicate(identity)); } catch (_) { return true; }
        })
        : identities.slice();
    });
    return Object.freeze({ mode, identities: Object.freeze(identities), queues: Object.freeze(queues) });
  }

  return {
    registerProvider, listProviders, currentScope, scopeForProvider, snapshot, isViewCurrent,
    missingIdentities, planAssetQueues, dedupe, normalizeIdentity, canonicalImageKey, identityKey, normalizePlmId,
  };
});
