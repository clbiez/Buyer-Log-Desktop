/* Shared LCW Merch Calendar bootstrap.
 * Loads the persisted business calendar once and feeds BLDateDimension before
 * business reports render. The promise stays public so lazy modules can await it.
 */
(() => {
  'use strict';
  let snapshot = { configured:false, calendar:null, summary:null };
  let inFlight = null;

  function apply(payload) {
    snapshot = payload && typeof payload === 'object' ? payload : { configured:false, calendar:null, summary:null };
    if (window.BLDateDimension) {
      if (snapshot.configured && snapshot.calendar) window.BLDateDimension.setMerchCalendar(snapshot.calendar);
      else window.BLDateDimension.clearMerchCalendar();
    }
    try {
      window.dispatchEvent(new CustomEvent('bl:merch-calendar-change', { detail:snapshot }));
    } catch (_) {}
    return snapshot;
  }

  async function load() {
    if (inFlight) return inFlight;
    inFlight = fetch('/api/merch-calendar', { cache:'no-store' })
      .then(async response => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) throw new Error(payload.error || 'Merch Calendar could not be loaded.');
        return apply(payload);
      })
      .catch(error => {
        // Calendar availability must never prevent Buyer Log from opening.
        snapshot = { configured:false, calendar:null, summary:null, error:String(error && error.message || error) };
        return snapshot;
      })
      .finally(() => { inFlight = null; });
    return inFlight;
  }

  window.BLMerchCalendarRuntime = {
    get current(){ return snapshot; },
    load,
    reload:load,
    apply,
  };
  window.BLMerchCalendarReady = load();
})();
