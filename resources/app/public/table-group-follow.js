/* Buyer Log — Keep grouped table labels centered in the visible portion of a group.
 * The group cells remain in their original table layout: no cloned sticky overlays.
 */
(function (root) {
  'use strict';
  const TABLE_IDS = ['cpTable', 'ordersTable', 'kolTable'];

  // Geometry-only helper: also tested in Node without a browser.
  function visibleGroupLabelOffset(group, viewport, frozenRight, pinned) {
    if (!group || !viewport) return null;
    const edge = Number.isFinite(frozenRight) ? frozenRight : viewport.left;
    const left = Math.max(group.left, viewport.left, pinned ? viewport.left : edge);
    const right = Math.min(group.right, viewport.right, pinned ? edge : viewport.right);
    if (![group.left, group.right, viewport.left, viewport.right, left, right].every(Number.isFinite) || right <= left) return null;
    return {
      offset: (left + right - group.left - group.right) / 2,
      maxWidth: Math.max(0, right - left - 12)
    };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { visibleGroupLabelOffset };
  const document = root && root.document;
  if (!document) return;

  function mount(table) {
    const wrap = table.closest('.tablewrap');
    const head = table.tHead;
    if (!wrap || !head || table.dataset.blGroupFollowMounted === '1') return;
    table.dataset.blGroupFollowMounted = '1';
    let pending = false;
    const observer = new MutationObserver(schedule);
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    const observedCells = new Set();
    if (resizeObserver) { resizeObserver.observe(wrap); resizeObserver.observe(table); }
    function prepare() {
      const cells = [...head.querySelectorAll('tr.groupRow th[data-grp]')];
      for (const cell of cells) {
        if (cell.querySelector(':scope > .blGroupFollowLabel')) continue;
        const label = document.createElement('span');
        label.className = 'blGroupFollowLabel';
        while (cell.firstChild) label.appendChild(cell.firstChild);
        cell.appendChild(label);
      }
      if (resizeObserver) {
        const live = new Set(cells);
        for (const cell of observedCells) {
          if (!live.has(cell)) { resizeObserver.unobserve(cell); observedCells.delete(cell); }
        }
        for (const cell of cells) {
          if (!observedCells.has(cell)) { resizeObserver.observe(cell); observedCells.add(cell); }
        }
      }
      return cells;
    }
    function update() {
      pending = false;
      const cells = prepare();
      const viewport = wrap.getBoundingClientRect();
      const frozenEdge = head.querySelector('tr.colRow th.frzLEdge, tr.groupRow th.frzLEdge');
      const frozenRight = frozenEdge ? Math.max(viewport.left, frozenEdge.getBoundingClientRect().right) : viewport.left;
      for (const cell of cells) {
        const label = cell.querySelector(':scope > .blGroupFollowLabel');
        if (!label) continue;
        const fit = visibleGroupLabelOffset(cell.getBoundingClientRect(), viewport, frozenRight, cell.classList.contains('frzL'));
        label.style.visibility = fit && fit.maxWidth >= 12 ? '' : 'hidden';
        if (!fit) continue;
        label.style.maxWidth = `${fit.maxWidth}px`;
        label.style.transform = `translate3d(${fit.offset.toFixed(2)}px,0,0)`;
      }
    }
    function schedule() {
      if (pending) return;
      pending = true;
      root.requestAnimationFrame(update);
    }
    observer.observe(head, { childList: true, subtree: true });
    wrap.addEventListener('scroll', schedule, { passive: true });
    root.addEventListener('resize', schedule, { passive: true });
    // A resize can change a column width without changing the overall table width.
    table.addEventListener('pointerup', schedule, { passive: true });
    schedule();
  }

  function start() {
    TABLE_IDS.forEach(id => { const table = document.getElementById(id); if (table) mount(table); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})(typeof window === 'undefined' ? globalThis : window);
