'use strict';

/* ===================================================================
   v7.20 — OAB ÇOKLU SEÇİM (Season × MAG × Buyer Group)

   Kullanıcı talebi: "Season, MAG, Buyer Group filtreleri OAB sitesinde çoklu
   seçime kapalı. Buyer Log'da çoklu seçim yaptırıp, arka planda seçim yapılmış
   tüm verileri OAB'dan getirtebilir miyiz?"

   Bu modül işin SAF kısmıdır: hangi kombinasyonların çekileceğini planlar,
   sonuçları tek rapora birleştirir ve maliyeti tahmin eder. PASS'e gitmez,
   dosya yazmaz, zaman ölçmez — bu sayede tamamı testlerle çalıştırılabilir.

   TASARIM KARARLARI

   1) GEÇERSİZ KOMBİNASYON SESSİZCE ATLANMAZ.
      Bir MAG her sezonda bulunmayabilir; bir Buyer Group her MAG'da olmayabilir.
      Kullanıcı S6+S7 ve CU4E+CK1E seçtiğinde bu çarpımın bir kısmı OAB'da
      karşılıksız olabilir. Karşılıksız üçlüler ATILIR ama SAYILIR ve
      SEBEBİYLE raporlanır. Sessizce eksik rapor vermek, bu zincirdeki en
      pahalı hata türüdür (§142).

   2) İSTEK SAYISI, SEÇİM SAYISI DEĞİL, PLANLANAN ÜÇLÜ SAYISIDIR.
      Tahmin ve ilerleme aynı plandan üretilir; ekranda gösterilen "N
      kombinasyon" ile gerçekte çekilen sayı ayrışamaz.

   3) TOPLU BuyerGroupRefs.
      PASS rapor parametresi `BuyerGroupRefs` — ÇOĞUL. OAB arayüzü tek seçime
      kapalı olsa da servis virgüllü liste kabul ediyor OLABİLİR. Doğrulanırsa
      (Sezon × MAG) başına tek istek yeter ve Buyer Group çoklu seçimi bedava
      olur. Bu modül planı ikiye ayırabilir; doğrulama ve karar server.js'te,
      gerçek yanıt içeriğine bakılarak yapılır — varsayımla değil.
   =================================================================== */

// PASS raporunda satırın hangi Buyer Group'a ait olduğunu taşıyan alan.
// Toplu istek yanıtının gerçekten çok gruplu olup olmadığı bu alandan
// doğrulanır; parametrenin kabul edilmiş görünmesi tek başına kanıt değildir.
const BUYER_GROUP_ROW_FIELD = 'Buyer Grup Tanımı';
const SEASON_ROW_FIELD = 'Sezon';
const MAG_ROW_FIELD = 'Merch Alt Grup';

function cleanRef(value) { return String(value == null ? '' : value).trim(); }
function uniqueRefs(list) {
  const seen = new Set(), out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const ref = cleanRef(item);
    if (!ref || seen.has(ref)) continue;
    seen.add(ref); out.push(ref);
  }
  return out;
}

/* Seçimden geçerli (Season, MAG, BuyerGroup) üçlülerini üretir.

   metadata: { seasonRefs(), magRefsForSeason(seasonRef), buyerGroupRefsFor(seasonRef, magRef) }
   selection: { seasonRefs:[], merchSubGroupRefs:[], buyerGroupRefs:[], allBuyerGroups:false }

   allBuyerGroups=true iken buyerGroupRefs yok sayılır ve her (Sezon, MAG) için
   o ikilinin BÜTÜN Buyer Group'ları alınır. Bu bilinçli bir bayraktır: boş
   dizinin "hepsi" anlamına gelmesi, kazara devasa bir iş başlatırdı. */
function planCombinations(metadata, selection) {
  const seasonRefs = uniqueRefs(selection && selection.seasonRefs);
  const magRefs = uniqueRefs(selection && selection.merchSubGroupRefs);
  const wantedBuyerRefs = uniqueRefs(selection && selection.buyerGroupRefs);
  const allBuyerGroups = Boolean(selection && selection.allBuyerGroups);

  const combinations = [], skipped = [];
  if (!seasonRefs.length) return { combinations, skipped, error: 'season-required' };
  if (!magRefs.length) return { combinations, skipped, error: 'mag-required' };
  if (!allBuyerGroups && !wantedBuyerRefs.length) return { combinations, skipped, error: 'buyer-group-required' };

  const knownSeasons = new Set(metadata.seasonRefs().map(cleanRef));
  for (const seasonRef of seasonRefs) {
    if (!knownSeasons.has(seasonRef)) { skipped.push({ reason: 'season-not-found', seasonRef }); continue; }
    const seasonMags = new Set(metadata.magRefsForSeason(seasonRef).map(cleanRef));
    for (const merchSubGroupRef of magRefs) {
      if (!seasonMags.has(merchSubGroupRef)) { skipped.push({ reason: 'mag-not-in-season', seasonRef, merchSubGroupRef }); continue; }
      const available = metadata.buyerGroupRefsFor(seasonRef, merchSubGroupRef).map(cleanRef);
      if (allBuyerGroups) {
        if (!available.length) { skipped.push({ reason: 'no-buyer-group', seasonRef, merchSubGroupRef }); continue; }
        for (const buyerGroupRef of available) combinations.push({ seasonRef, merchSubGroupRef, buyerGroupRef });
        continue;
      }
      const availableSet = new Set(available);
      for (const buyerGroupRef of wantedBuyerRefs) {
        if (!availableSet.has(buyerGroupRef)) { skipped.push({ reason: 'buyer-group-not-in-mag', seasonRef, merchSubGroupRef, buyerGroupRef }); continue; }
        combinations.push({ seasonRef, merchSubGroupRef, buyerGroupRef });
      }
    }
  }
  return { combinations, skipped, error: '' };
}

/* v7.23 — AÇIKÇA VERİLEN ÜÇLÜLERDEN PLAN.

   "Başarısızları yeniden dene" akışı için: yalnız alınamayan kombinasyonlar
   istenir, çarpım yeniden kurulmaz. Üçlüler yine metadata ile DOĞRULANIR;
   istemciden gelen bir kombinasyon doğrudan PASS'e sorulmaz. */
function planFromCombinations(metadata, combinations) {
  const list = Array.isArray(combinations) ? combinations : [];
  const out = [], skipped = [], seen = new Set();
  if (!list.length) return { combinations: out, skipped, error: 'combinations-required' };
  const knownSeasons = new Set(metadata.seasonRefs().map(cleanRef));
  for (const item of list) {
    const seasonRef = cleanRef(item && item.seasonRef);
    const merchSubGroupRef = cleanRef(item && item.merchSubGroupRef);
    const buyerGroupRef = cleanRef(item && item.buyerGroupRef);
    const key = `${seasonRef}|${merchSubGroupRef}|${buyerGroupRef}`;
    if (!seasonRef || !merchSubGroupRef || !buyerGroupRef || seen.has(key)) continue;
    seen.add(key);
    if (!knownSeasons.has(seasonRef)) { skipped.push({ reason: 'season-not-found', seasonRef }); continue; }
    if (!metadata.magRefsForSeason(seasonRef).map(cleanRef).includes(merchSubGroupRef)) { skipped.push({ reason: 'mag-not-in-season', seasonRef, merchSubGroupRef }); continue; }
    if (!metadata.buyerGroupRefsFor(seasonRef, merchSubGroupRef).map(cleanRef).includes(buyerGroupRef)) { skipped.push({ reason: 'buyer-group-not-in-mag', seasonRef, merchSubGroupRef, buyerGroupRef }); continue; }
    out.push({ seasonRef, merchSubGroupRef, buyerGroupRef });
  }
  return { combinations: out, skipped, error: '' };
}

/* Toplu BuyerGroupRefs kullanılabildiğinde plan (Sezon, MAG) başına tek isteğe
   iner. Sıra korunur: kullanıcı seçim sırasını ekranda geri görebilsin. */
function groupBySeasonMag(combinations) {
  const groups = new Map();
  for (const item of Array.isArray(combinations) ? combinations : []) {
    const key = `${cleanRef(item.seasonRef)}|${cleanRef(item.merchSubGroupRef)}`;
    if (!groups.has(key)) groups.set(key, { seasonRef: cleanRef(item.seasonRef), merchSubGroupRef: cleanRef(item.merchSubGroupRef), buyerGroupRefs: [] });
    groups.get(key).buyerGroupRefs.push(cleanRef(item.buyerGroupRef));
  }
  return [...groups.values()];
}

/* Toplu istek yanıtının GERÇEKTEN çok gruplu olduğunu satır içeriğinden
   doğrular. PASS fazladan parametreyi sessizce yok sayıp tek grubun verisini
   döndürebilir; o durumda toplu mod kullanılırsa rapor sessizce eksik olurdu.

   Kesin kanıt: yanıtta en az iki FARKLI Buyer Grup Tanımı bulunmalı. Tek grup
   dönerse "doğrulanmadı" sayılır — istenen liste zaten çok gruplu olduğu için
   tek grup dönmesi parametrenin yok sayıldığı anlamına gelir. */
function verifyBatchedBuyerGroupResponse(rows, requestedBuyerGroupRefs) {
  const requested = uniqueRefs(requestedBuyerGroupRefs);
  if (requested.length < 2) return { verified: false, reason: 'not-enough-groups-to-prove', distinct: 0 };
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return { verified: false, reason: 'empty-response', distinct: 0 };
  const distinct = new Set();
  for (const row of list) {
    const value = row && row[BUYER_GROUP_ROW_FIELD];
    const text = cleanRef(value);
    if (text) distinct.add(text);
  }
  if (!distinct.size) return { verified: false, reason: 'buyer-group-field-missing', distinct: 0 };
  if (distinct.size < 2) return { verified: false, reason: 'single-group-returned', distinct: distinct.size };
  return { verified: true, reason: '', distinct: distinct.size };
}

/* Kombinasyon sonuçlarını TEK rapora birleştirir.

   · Satır düşürülmez, kırpılmaz, tekilleştirilmez. Aynı satırın iki
     kombinasyondan gelmesi ancak kombinasyonlar çakışıyorsa mümkündür; plan
     tekil üçlüler ürettiği için bu durum oluşmaz.
   · Alan listesi bütün satırların anahtar BİRLEŞİMİDİR: bir kombinasyonda
     olup diğerinde olmayan alan kaybolmaz.
   · Satırlar zaten Sezon / Merch Alt Grup / Buyer Grup Tanımı taşır; kırılım
     rapor içinde korunur ve pivotta doğrudan kullanılabilir. */
function mergeReportResults(results) {
  const rows = [], fields = [], fieldSeen = new Set();
  const sources = [];
  for (const result of Array.isArray(results) ? results : []) {
    if (!result || !Array.isArray(result.rows)) continue;
    for (const row of result.rows) rows.push(row);
    for (const field of Array.isArray(result.fields) ? result.fields : []) {
      if (field == null || fieldSeen.has(field)) continue;
      fieldSeen.add(field); fields.push(field);
    }
    sources.push({
      seasonRef: cleanRef(result.seasonRef),
      merchSubGroupRef: cleanRef(result.merchSubGroupRef),
      buyerGroupRefs: uniqueRefs(result.buyerGroupRefs || [result.buyerGroupRef]),
      rows: result.rows.length,
      fromCache: Boolean(result.fromCache),
      fetchedAt: result.fetchedAt || '',
    });
  }
  // Alan listesi boşsa (yalnız cache'ten gelen eski kayıtlar alan taşımıyorsa)
  // satırlardan türet — rapor alansız kalmasın.
  if (!fields.length) {
    for (const row of rows) for (const key of Object.keys(row || {})) {
      if (fieldSeen.has(key)) continue;
      fieldSeen.add(key); fields.push(key);
    }
  }
  return { rows, fields, sources };
}

/* v7.23 — YENİDEN DENEMEDEN SONRA SNAPSHOT BİRLEŞTİRME.

   "Başarısız kombinasyonları yeniden dene" işi yalnız o üçlüleri çeker. Bu
   işin sonucu kullanıcının son snapshot'ının ÜZERİNE YAZILIRSA, program
   yeniden açıldığında elde yalnız yeniden denenen kombinasyonlar kalır ve
   önceki kombinasyonların verisi kaybolur (§142). Bu yüzden kalıcı snapshot,
   eldeki snapshot ile yeni satırların BİRLEŞİMİ olarak yazılır.

   Tekilleştirme anahtarı satırın kendi (Sezon, MAG, Buyer Grup) değerleridir:
   yeniden denenen bir kombinasyondan kısmi bir sonuç kalmışsa eski satırları
   çıkarılır, yenileri konur. Satır DÜŞÜRÜLMEZ: anahtarı yeni sonuçta yer
   almayan her eski satır aynen korunur. Ayraç U+001F'tir; alan değerlerinde
   bulunmayacağı için "AB|C" ile "A|BC" çakışması oluşamaz. */
const ROW_KEY_SEP = '';
function snapshotRowKey(row) {
  return [
    cleanRef(row && row[SEASON_ROW_FIELD]),
    cleanRef(row && row[MAG_ROW_FIELD]),
    cleanRef(row && row[BUYER_GROUP_ROW_FIELD]),
  ].join(ROW_KEY_SEP);
}
function mergeSnapshotRows(previousRows, incomingRows) {
  const previous = Array.isArray(previousRows) ? previousRows : [];
  const incoming = Array.isArray(incomingRows) ? incomingRows : [];
  const replaced = new Set(incoming.map(snapshotRowKey));
  const kept = previous.filter(row => !replaced.has(snapshotRowKey(row)));
  return { rows: kept.concat(incoming), keptCount: kept.length, replacedCount: previous.length - kept.length };
}
function mergeRefLists(previous, incoming) {
  return uniqueRefs([...(Array.isArray(previous) ? previous : []), ...(Array.isArray(incoming) ? incoming : [])]);
}

/* Süre tahmini. Ölçülmüş bir sabit kullanılır ve NEREDEN geldiği yazılır:
   OAB rapor çağrısı kullanıcının ortamında 15-25 saniye sürüyor (oab-store.js
   başlığındaki saha notu). Tahmin üst sınıra değil ORTALAMAYA göre verilir ve
   ekranda "~" ile gösterilir; uydurma kesinlik iddia edilmez. */
const SECONDS_PER_REQUEST = 20;
function estimateSeconds(requestCount) {
  const count = Math.max(0, Number(requestCount) || 0);
  return count * SECONDS_PER_REQUEST;
}

module.exports = {
  BUYER_GROUP_ROW_FIELD, SEASON_ROW_FIELD, MAG_ROW_FIELD, SECONDS_PER_REQUEST,
  planCombinations, planFromCombinations, groupBySeasonMag, verifyBatchedBuyerGroupResponse, mergeReportResults, estimateSeconds,
  mergeSnapshotRows, mergeRefLists, snapshotRowKey,
  _uniqueRefs: uniqueRefs,
};
