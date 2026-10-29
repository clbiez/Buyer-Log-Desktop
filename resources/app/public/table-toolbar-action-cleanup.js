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
    'kolAddRowBtn',
  ]);

  function el(id) { return document.getElementById(id); }

  function activePage() {
    return String(document.body && document.body.dataset.activeTab || '').trim();
  }

  function makeIconOnly(button) {
    if (!button) return;
    // Excel çekmecesi gibi menülerde düğme etiketiyle görünür.
    if (button.closest('.toolbarMoreMenu')) {
      button.classList.remove('tableActionIconOnly');
      return;
    }
    button.classList.add('tableActionIconOnly');
    if (!button.getAttribute('aria-label')) {
      const label = button.getAttribute('title') || button.textContent.trim();
      if (label) button.setAttribute('aria-label', label);
    }
  }

  function resolveButton(buttonOrId) {
    return typeof buttonOrId === 'string' ? el(buttonOrId) : buttonOrId;
  }

  function finish(buttonOrId, ok = null) {
    const button = resolveButton(buttonOrId);
    if (!button) return;
    clearTimeout(button._blActionAutoTimer);
    clearTimeout(button._blActionFinishTimer);
    button.classList.remove('isActionWorking', 'isActionDone', 'isActionFailed');
    button.removeAttribute('aria-busy');
    if (ok === true || ok === false) {
      void button.offsetWidth;
      button.classList.add(ok ? 'isActionDone' : 'isActionFailed');
      button._blActionFinishTimer = setTimeout(() => {
        if (button.isConnected) button.classList.remove('isActionDone', 'isActionFailed');
      }, 850);
    }
  }

  function begin(buttonOrId, options) {
    const button = resolveButton(buttonOrId);
    if (!button) return null;
    clearTimeout(button._blActionAutoTimer);
    clearTimeout(button._blActionFinishTimer);
    button.classList.remove('isActionDone', 'isActionFailed');
    button.classList.add('isActionWorking');
    button.setAttribute('aria-busy', 'true');
    if (options && options.auto) button._blActionAutoTimer = setTimeout(() => finish(button, null), 650);
    return button;
  }

  function animatedActionButton(target) {
    const button = target && target.closest ? target.closest('button') : null;
    if (!button || button.disabled || !button.querySelector('svg.ic')) return null;
    const root = button.closest(
      '#cpTableToolbar,#ordersTableToolbar,#kolTableToolbar,' +
      '#cpToolsMenu,#ordersToolsMenu,#kolToolsMenu,#cpExcelMenu,#kolExcelMenu,' +
      '#cpMoreMenu,#ordersMoreMenu,#kolMoreMenu'
    );
    return root ? button : null;
  }

  function bindActionAnimations() {
    document.addEventListener('click', event => {
      const button = animatedActionButton(event.target);
      if (button) begin(button, { auto: true });
    }, true);
  }

  function moveNode(node, parent, before) {
    if (!node || !parent) return false;
    // before === node: düğüm zaten hedef konumda. insertBefore(node, node)
    // düğümü söküp yeniden takar; gözlemci bunu yakalayıp her karede
    // enforce'u tekrarlar ve basılı tıklama click üretmeden kaybolur.
    if (node.parentNode === parent && (!before || before === node || node.nextSibling === before)) return false;
    parent.insertBefore(node, before || null);
    return true;
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
          return node.id === 'navColsBtn'
            || node.classList?.contains('navColsRight')
            || node.querySelector?.('#navColsBtn');
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
    bindActionAnimations();

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
    begin,
    finish,
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})(typeof window !== 'undefined' ? window : globalThis);
