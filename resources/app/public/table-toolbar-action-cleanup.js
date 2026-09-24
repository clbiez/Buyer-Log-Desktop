'use strict';

(function tableToolbarActionCleanup(global) {
  const PAGE_MAP = Object.freeze({
    cp: { tools: 'cpToolsMenu', more: 'cpMoreMenu' },
    orders: { tools: 'ordersToolsMenu', more: 'ordersMoreMenu' },
    koleksiyon: { tools: 'kolToolsMenu', more: 'kolMoreMenu' },
  });

  const ICON_ONLY_IDS = Object.freeze([
    'navCopy',
    'navExcelBtn',
    'kolCopySelectedBtn',
    'kolExportImgBtn',
  ]);

  function el(id) { return document.getElementById(id); }

  function activePage() {
    return String(document.body && document.body.dataset.activeTab || '').trim();
  }

  function makeIconOnly(button) {
    if (!button) return;
    button.classList.add('tableActionIconOnly');
    if (!button.getAttribute('aria-label')) {
      const label = button.getAttribute('title') || button.textContent.trim();
      if (label) button.setAttribute('aria-label', label);
    }
  }

  function moveNode(node, parent, before) {
    if (!node || !parent) return false;
    if (node.parentNode === parent && (!before || node.nextSibling === before)) return false;
    parent.insertBefore(node, before || null);
    return true;
  }

  function placeCopyToCollection(page) {
    const button = el('cpCopyToKolBtn');
    if (!button) return false;
    if (page !== 'cp' && page !== 'orders') return false;
    const menu = el(PAGE_MAP[page].tools);
    if (!menu) return false;
    button.classList.add('toolbarMenuNativeItem');
    return moveNode(button, menu, menu.firstElementChild);
  }

  function placeColumns(page) {
    const config = PAGE_MAP[page];
    if (!config) return false;
    const button = el('navColsBtn');
    const menu = el(config.more);
    const wrap = button && button.closest('.colPanelWrap');
    if (!button || !menu || !wrap) return false;
    wrap.classList.add('toolbarMenuColumns');
    return moveNode(wrap, menu, menu.firstElementChild);
  }

  function enforce() {
    for (const id of ICON_ONLY_IDS) makeIconOnly(el(id));
    const page = activePage();
    let moved = false;
    moved = placeCopyToCollection(page) || moved;
    moved = placeColumns(page) || moved;
    if (moved) {
      requestAnimationFrame(() => {
        global.BLToolbarResponsive?.refresh?.(null, { remeasure: true });
        global.repositionVisiblePanels?.();
      });
    }
  }

  let queued = false;
  function queueEnforce() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      enforce();
    });
  }

  function observePlacementRoots() {
    const ids = [
      'cpTableActions', 'ordersTableActions', 'kolTableActions',
      'cpTableViewActions', 'ordersTableViewActions', 'kolTableViewActions',
      'cpToolsMenu', 'ordersToolsMenu',
      'cpMoreMenu', 'ordersMoreMenu', 'kolMoreMenu',
    ];
    const roots = ids.map(el).filter(Boolean);
    const sharedBar = document.querySelector('.vfBar');
    if (sharedBar) roots.push(sharedBar);
    if (!roots.length) return;

    const observer = new MutationObserver(mutations => {
      const relevant = mutations.some(mutation => {
        const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
        return nodes.some(node => {
          if (!node || node.nodeType !== 1) return false;
          return node.id === 'cpCopyToKolBtn'
            || node.id === 'navColsBtn'
            || node.classList?.contains('navColsRight')
            || node.querySelector?.('#cpCopyToKolBtn,#navColsBtn');
        });
      });
      if (relevant) queueEnforce();
    });
    roots.forEach(root => observer.observe(root, { childList: true }));
  }

  function init() {
    ICON_ONLY_IDS.forEach(id => makeIconOnly(el(id)));
    enforce();
    observePlacementRoots();

    if (document.body) {
      new MutationObserver(queueEnforce).observe(document.body, {
        attributes: true,
        attributeFilter: ['data-active-tab'],
      });
    }
    global.addEventListener('resize', queueEnforce, { passive: true });
  }

  global.BLTableToolbarActionCleanup = Object.freeze({
    enforce,
    activePage,
    PAGE_MAP,
    ICON_ONLY_IDS,
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})(typeof window !== 'undefined' ? window : globalThis);
