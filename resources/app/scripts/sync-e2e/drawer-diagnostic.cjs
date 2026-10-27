'use strict';
// Opt-in, bounded native event trace. Never intercept/replace a success response.
async function install(session) {
  await session.page.evaluate(() => {
    const trace = window.__blDrawerTrace = [];
    const record = (type, data = {}) => {
      trace.push({ at: Date.now(), type, pointer: kolPointerActive, ...data });
      if (trace.length > 300) trace.shift();
    };
    const rect = element => element?.getBoundingClientRect().toJSON() || null;
    const state = () => ({
      open: BLCollectionPriceDrawer.isOpen(), owner: kolWorkspaceOwnerId,
      drawers: [...document.querySelectorAll('.cpdDrawer')].map(element => ({
        rect: rect(element), visibility: getComputedStyle(element).visibility,
        display: getComputedStyle(element).display, opacity: getComputedStyle(element).opacity,
      })),
    });
    const append = document.body.appendChild;
    document.body.appendChild = function (node) {
      if (node.classList?.contains('cpdBackdrop')) {
        record('append', state());
        const remove = node.remove;
        node.remove = function () {
          record('remove', { ...state(), stack: new Error('drawer removed').stack });
          return remove.call(node);
        };
      }
      return append.call(this, node);
    };
    const api = BLCollectionPriceDrawer, open = api.open, refresh = api.refresh, close = api.close;
    api.open = function (row, ...args) {
      record('open-called', { id: row?.id, model: row?.modelKod, binding: row ? BLPriceLineageBridge.binding(row) : null });
      try {
        const result = open.call(this, row, ...args);
        record('open-returned', state());
        return result;
      } catch (error) { record('open-threw', { error: error.stack }); throw error; }
    };
    api.refresh = function (...args) {
      const before = api.isOpen();
      try {
        const result = refresh.apply(this, args);
        if (before && !api.isOpen()) record('refresh-closed', state());
        return result;
      } catch (error) { record('refresh-threw', { error: error.stack }); throw error; }
    };
    api.close = function (...args) {
      record('external-close', { ...state(), stack: new Error('external close').stack });
      return close.apply(this, args);
    };
    for (const type of ['pointerdown', 'pointerup', 'click', 'focusout']) {
      document.addEventListener(type, event => {
        const button = event.target.closest?.('[data-kol-drawer-open]');
        const cell = event.target.closest?.('#kolTable td');
        if (button || cell) record(type, {
          target: event.target.outerHTML.slice(0, 200), id: button?.dataset.kolDrawerOpen,
          point: { x: event.clientX, y: event.clientY },
          buttonRect: rect(button), cellRect: rect(cell), connected: event.target.isConnected,
          ...state(),
        });
      }, true);
    }
    for (const type of ['blur', 'focus']) window.addEventListener(type, () => record('window-' + type, state()));
  });
}
module.exports = { install };
