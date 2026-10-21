/* Buyer Log v7.0.290 — MODERATÖR KURAL YAYINI (istemci kanalı)
 *
 * Moderatörün "tüm kullanıcılara uygula" dediği CP öncelik kuralları /
 * checklist soruları ve "tüm kullanıcılardan sil" dediği kimlikler sunucuda
 * tek kayıtta durur (/api/cp-managed-rules) ve Master kural yayınıyla her
 * cihaza dağılır. Bu dosya yalnız okuma/yazma kanalıdır; birleştirme kuralı
 * cp-rules-engine.js › effectiveRules içindedir, ekran cp-overview-assistant.js.
 *
 * Kullanıcıların kendi oluşturdukları kurallara dokunulmaz.
 */
(function () {
  'use strict';
  const API = '/api/cp-managed-rules';
  const CACHE_KEY = 'lcw.cp.managedRules.cache.v1';
  const isEn = () => typeof appLang !== 'undefined' && appLang === 'en';
  const L = (tr, en) => (isEn() ? en : tr);

  // Önbellek yalnız ilk çizimi hızlandırır; kesin kaynak sunucu cevabıdır.
  function cached() {
    try { return JSON.parse(window.localStorage.getItem(CACHE_KEY) || 'null'); } catch (_) { return null; }
  }
  function remember(value) {
    try { window.localStorage.setItem(CACHE_KEY, JSON.stringify(value)); } catch (_) { /* önbellek isteğe bağlı */ }
  }
  function headers(extra) {
    const out = { ...(extra || {}) };
    if (window.BL_CLIENT_ID) out['X-Client-Id'] = window.BL_CLIENT_ID;
    return out;
  }
  async function load() {
    if (typeof fetch !== 'function') return null;
    const response = await fetch(API, { cache: 'no-store', credentials: 'same-origin', headers: headers() });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    if (payload) remember(payload);
    return payload;
  }
  async function save(next, revision) {
    const response = await fetch(API, {
      method: 'PUT', credentials: 'same-origin',
      headers: headers({ 'Content-Type': 'application/json', 'If-Match': `"${Number(revision) || 0}"` }),
      body: JSON.stringify({ rules: next.rules || [], deletedRuleIds: next.deletedRuleIds || [] }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error((payload && (isEn() ? payload.errorEn || payload.error : payload.error))
        || L('Moderatör kuralları kaydedilemedi.', 'Moderator rules could not be saved.'));
      error.status = response.status;
      throw error;
    }
    if (payload) remember(payload);
    return payload;
  }
  window.BLCpManagedRules = { cached, load, save };
})();
