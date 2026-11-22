/* Pivot alanı ayarları — ortak sürükle-bırak sıralama.
 *
 * OAB (PASS), INTAKE, FOB Sonrası, TR/YD ve OAB (Küp) kalem pencerelerindeki
 * satır/sütun/değer/filtre listeleri (.oabPivotConfigList > .oabConfigRow) aynı
 * davranışı paylaşır. Desen PASS OAB / INTAKE'te çalışan modal içi
 * dragstart/dragover/drop/dragend dinleyicisidir; tek yerde tutulur.
 *
 * - Sürükleme "⋮⋮" tutamağından başlar: tutamağa basılınca satır geçici olarak
 *   draggable olur (seçim kutusunda metin seçimi/açılır liste bozulmaz).
 *   Satır işaretlemesinde draggable="true" olan eski satırlar da çalışır.
 * - Satır yalnız kendi listesinde yer değiştirir (satır alanı sütunlara kaçmaz).
 * - Dinleyiciler pencere kabuğuna (modal) bağlıdır; sonradan eklenen satırlar
 *   ek bağlama gerektirmez.
 * - Kendi animasyon motoru yoktur: sürüklenen satır yalnız mevcut .isDragging
 *   sınıfını alır; prefers-reduced-motion etkilenmez. Klavye için widget'ın
 *   yukarı/aşağı düğmeleri olduğu gibi kalır.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (!root) return;
  // Modülden önce açılan pencereler (app-main bekleyen bind listesi) hâlâ açıksa şimdi bağlanır.
  const pending = root.BLPivotConfigReorder && Array.isArray(root.BLPivotConfigReorder.pending) ? root.BLPivotConfigReorder.pending : [];
  root.BLPivotConfigReorder = api;
  pending.forEach(([container, options]) => { if (container && container.isConnected) api.bind(container, options); });
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const ROW = '.oabConfigRow';

  /* Bırakma konumu: imleç satırın üst yarısındaysa önüne, alt yarısındaysa arkasına. */
  function placement(rect, clientY) {
    return clientY > rect.top + rect.height / 2 ? 'after' : 'before';
  }

  function bind(container, options = {}) {
    if (!container || container.__blPivotConfigReorder) return;
    container.__blPivotConfigReorder = true;
    const onReorder = typeof options.onReorder === 'function' ? options.onReorder : () => {};
    let dragged = null, startOrder = null;
    const rowOf = target => (target && target.closest ? target.closest(ROW) : null);
    const disarm = row => { if (row && row.dataset.blReorderArmed) { row.removeAttribute('draggable'); delete row.dataset.blReorderArmed; } };

    container.addEventListener('pointerdown', event => {
      const handle = event.target && event.target.closest ? event.target.closest('.oabConfigDrag') : null;
      const row = rowOf(handle);
      if (!row || !container.contains(row) || row.getAttribute('draggable') === 'true') return;
      row.setAttribute('draggable', 'true');
      row.dataset.blReorderArmed = '1';
    });
    container.addEventListener('pointerup', event => { if (!dragged) disarm(rowOf(event.target)); });
    container.addEventListener('dragstart', event => {
      const row = rowOf(event.target);
      if (!row || !container.contains(row) || row !== event.target) return;
      dragged = row;
      startOrder = [...row.parentElement.children];
      row.classList.add('isDragging');
      if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', 'pivot-config-row'); }
    });
    container.addEventListener('dragover', event => {
      if (!dragged) return;
      const target = rowOf(event.target);
      const list = target ? target.parentElement : (event.target && event.target.closest ? event.target.closest('.oabPivotConfigList') : null);
      if (list !== dragged.parentElement) return;
      // Aynı listede (satır arası boşluk dahil) bırakmaya izin ver.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      if (!target || target === dragged || target.parentElement !== dragged.parentElement) return;
      const where = placement(target.getBoundingClientRect(), event.clientY);
      list.insertBefore(dragged, where === 'after' ? target.nextElementSibling : target);
    });
    container.addEventListener('drop', event => { if (dragged) event.preventDefault(); });
    container.addEventListener('dragend', () => {
      if (!dragged) return;
      const row = dragged, list = row.parentElement;
      row.classList.remove('isDragging');
      disarm(row);
      dragged = null;
      const changed = list && startOrder && [...list.children].some((child, index) => child !== startOrder[index]);
      startOrder = null;
      if (list) onReorder(list, Boolean(changed));
    });
  }

  return { loaded: true, bind, placement };
}));
