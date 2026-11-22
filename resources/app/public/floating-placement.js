/* Ortak yüzen panel yerleştirme (filtre popover'ları, sütun filtre panelleri).
   Sorun: paneller tetikleyicinin altına açılıyor ve yüksekliği çoğu zaman
   değerler yüklenmeden ("Yükleniyor…") ölçülüyordu; liste gelince panel
   pencerenin altına taşıyor, değer listesi ve Uygula düğmesi görünmüyordu.
   Kural:
   - Doğal yükseklik altta sığıyorsa alta, yoksa üstte sığıyorsa üste açılır.
   - İki tarafta da sığmıyorsa geniş taraf seçilir ve panel o alana sınırlanır
     (max-height); panel içi liste kaydırılır, başlık/arama/düğmeler görünür kalır.
   - Bir tarafta bile kullanılabilir alan yoksa panel tetikleyicinin üzerine
     binerek pencere içinde tutulur.
   - İçerik sonradan büyüyüp küçülünce (ResizeObserver) ve pencere boyutu
     değişince yeniden konumlanır; açık panel yazarken taraf değiştirmez. */
(function (root) {
  'use strict';
  const MARGIN = 8;
  const GAP = 4;
  const MIN_SPACE = 180;

  function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  /* Saf hesap: DOM'a dokunmaz; birim test edilir. */
  function compute(input) {
    const options = input || {};
    const anchor = options.anchor || { top: 0, bottom: 0, left: 0, right: 0 };
    const viewport = options.viewport || { width: 0, height: 0 };
    const size = options.size || { width: 0, height: 0 };
    const margin = finite(options.margin, MARGIN);
    const gap = finite(options.gap, GAP);
    const minSpace = finite(options.minSpace, MIN_SPACE);
    const vw = Math.max(0, finite(viewport.width, 0));
    const vh = Math.max(0, finite(viewport.height, 0));
    const usableHeight = Math.max(0, vh - margin * 2);
    const width = Math.min(Math.max(0, finite(size.width, 0)), Math.max(0, vw - margin * 2));
    const natural = Math.max(0, finite(size.height, 0));
    const below = Math.max(0, vh - anchor.bottom - gap - margin);
    const above = Math.max(0, anchor.top - gap - margin);
    const space = side => (side === 'above' ? above : below);
    const order = options.prefer === 'above' ? ['above', 'below'] : ['below', 'above'];
    let side = order.find(candidate => natural <= space(candidate));
    if (!side) side = above > below ? 'above' : 'below';
    let top;
    let maxHeight = null;
    if (natural <= space(side)) {
      top = side === 'above' ? anchor.top - gap - natural : anchor.bottom + gap;
    } else if (space(side) >= minSpace) {
      maxHeight = Math.floor(space(side));
      top = side === 'above' ? anchor.top - gap - maxHeight : anchor.bottom + gap;
    } else {
      const height = Math.min(natural, usableHeight);
      if (height < natural) maxHeight = Math.floor(height);
      top = Math.max(margin, vh - margin - height);
      side = 'overlap';
    }
    const desiredLeft = finite(options.left, anchor.left);
    const left = Math.max(margin, Math.min(desiredLeft, vw - margin - width));
    return { top: Math.max(margin, Math.round(top)), left: Math.round(left), maxHeight, side };
  }

  const states = typeof WeakMap === 'function' ? new WeakMap() : null;

  function viewportSize() {
    const doc = root.document && root.document.documentElement;
    return {
      width: finite(root.innerWidth, 0) || finite(doc && doc.clientWidth, 0),
      height: finite(root.innerHeight, 0) || finite(doc && doc.clientHeight, 0)
    };
  }

  function anchorRect(state) {
    const anchor = state.anchor;
    if (anchor && typeof anchor.getBoundingClientRect === 'function' && anchor.isConnected !== false) {
      const rect = anchor.getBoundingClientRect();
      if (rect && (rect.width || rect.height || rect.top || rect.left)) state.lastRect = rect;
    } else if (anchor && typeof anchor.top === 'number' && typeof anchor.bottom === 'number') {
      state.lastRect = anchor;
    }
    return state.lastRect || { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
  }

  function apply(panel, state) {
    const opts = state.opts || {};
    const rect = anchorRect(state);
    state.applying = true;
    panel.style.maxHeight = '';
    const size = { width: panel.offsetWidth, height: panel.offsetHeight };
    let left = opts.left;
    if (typeof left === 'function') left = left(rect, size.width);
    else if (opts.align === 'end') left = rect.right - size.width;
    else if (left == null) left = rect.left + finite(opts.offsetX, 0);
    const result = compute({
      anchor: rect, size, viewport: viewportSize(), left,
      prefer: state.side === 'overlap' ? undefined : state.side,
      margin: opts.margin, gap: opts.gap, minSpace: opts.minSpace
    });
    panel.style.top = `${result.top}px`;
    panel.style.left = `${result.left}px`;
    panel.style.maxHeight = result.maxHeight == null ? '' : `${result.maxHeight}px`;
    panel.dataset.placement = result.side;
    state.side = result.side;
    state.applying = false;
    return result;
  }

  function release(panel) {
    const state = states && states.get(panel);
    if (!state) return;
    if (state.observer) state.observer.disconnect();
    if (state.onResize) root.removeEventListener('resize', state.onResize);
    states.delete(panel);
  }

  function place(panel, anchor, options) {
    if (!panel || !panel.style) return null;
    let state = states && states.get(panel);
    if (!state) {
      state = {};
      if (states) states.set(panel, state);
    }
    state.anchor = anchor;
    state.opts = options || {};
    const result = apply(panel, state);
    if (states && state.opts.track !== false && !state.observer && typeof root.ResizeObserver === 'function') {
      const refresh = () => {
        if (!panel.isConnected) { release(panel); return; }
        if (!state.applying) apply(panel, state);
      };
      state.observer = new root.ResizeObserver(refresh);
      state.observer.observe(panel);
      state.onResize = refresh;
      root.addEventListener('resize', state.onResize);
    }
    return result;
  }

  const api = { place, release, compute, MARGIN, GAP, MIN_SPACE };
  root.BLFloatingPlacement = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
