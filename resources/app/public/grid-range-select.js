/* Shift ile satır aralığı seçimi — CP, Siparişler, Koleksiyon ve tik kutusu
   taşıyan diğer tablolar.

   NEDEN TEK MODÜL: üç tablo seçim defterini üç ayrı yerde tutuyor —
   Siparişler tbody üzerinde devredilmiş bir 'change' dinleyicisi
   (tbody._chkMeta), CP satır başına dinleyici, Koleksiyon ise kendi
   kolSelected kümesi. Aralık mantığını üç kez yazmak bu defterleri de
   çoğaltırdı. Bunun yerine aralıktaki kutuların durumu değiştirilir ve her
   birine 'change' gönderilir: hangi tablo olursa olsun kendi mevcut
   defterini kendisi günceller. Rapor tek yerel change olayıyla aralığın
   tamamını mevcut seçim sahibine iletir.

   Davranış Excel/Gmail ile aynı: tık = çıpa; shift+tık = çıpadan tıklanan
   satıra kadar olan aralığı TIKLANAN kutunun yeni durumuna eşitler. Yani
   shift+tık işaretliyse aralık işaretlenir, kaldırıyorsa aralık kaldırılır. */
(function (global) {
  'use strict';

  const BOX = 'input.rowChk';
  const REPORT_BOX = 'input[data-tr-check]:not([data-tr-check="all"])';

  /* Çıpa, element olarak değil data-id olarak saklanır. Tablolar tbody'yi
     innerHTML ile yeniden kuruyor; element referansı ilk çizimde kopardı,
     id ise filtre/sıralama sonrasında bile doğru satırı bulur. */
  const anchorByBody = new WeakMap();
  const reportRanges = new WeakMap();

  function boxKey(box) {
    if (box.dataset.id != null) return box.dataset.id;
    const row = box.closest('tr');
    const id = row?.dataset.id;
    const partial = row?.dataset.selectionPartialIndex;
    return partial == null ? id : JSON.stringify([id, partial]);
  }

  function rangeBoxes(tbody, anchorId, target, selector) {
    const boxes = Array.from(tbody.querySelectorAll(selector));
    const from = boxes.findIndex(box => boxKey(box) === anchorId);
    const to = boxes.indexOf(target);
    if (from < 0 || to < 0 || from === to) return [];
    return boxes.slice(Math.min(from, to), Math.max(from, to) + 1);
  }

  /* Aralığı hedef duruma eşitler. Tıklanan kutuya dokunulmaz: tarayıcı onu
     zaten çevirdi ve kendi 'change' olayını gönderdi. */
  function applyRange(tbody, anchorId, target) {
    const checked = target.checked;
    let changed = 0;

    for (const box of rangeBoxes(tbody, anchorId, target, BOX)) {
      if (box === target || box.disabled || box.checked === checked) continue;
      box.checked = checked;
      box.dispatchEvent(new Event('change', { bubbles: true }));
      changed++;
    }
    return changed;
  }

  function rowBox(node) {
    if (!node || node.nodeType !== 1) return null;
    if (node.tagName !== 'INPUT' || node.type !== 'checkbox') return null;
    return node.classList.contains('rowChk') || node.matches?.(REPORT_BOX) ? node : null;
  }

  function onMouseDown(event) {
    /* Shift basılıyken tarayıcı metin seçmeye çalışır ve tablo mavi boyanır.
       mousedown'ın varsayılanı engellense de tıklama/çevirme çalışır. */
    if (!event.shiftKey) return;
    if (rowBox(event.target)) event.preventDefault();
  }

  function onClick(event) {
    const box = rowBox(event.target);
    if (!box) return;
    const tbody = box.closest('tbody');
    if (!tbody) return;

    const anchorId = anchorByBody.get(tbody), key = boxKey(box);
    if (event.shiftKey && anchorId != null && anchorId !== key) {
      if (box.matches?.(REPORT_BOX)) {
        const range = rangeBoxes(tbody, anchorId, box, REPORT_BOX);
        reportRanges.set(box, range.filter(input => !input.disabled).map(input => Number(input.dataset.trCheck)));
      } else applyRange(tbody, anchorId, box);
      /* Çıpa korunur: Excel'de olduğu gibi aynı çıpadan farklı aralıklar
         denenebilsin. */
      return;
    }
    reportRanges.delete(box);
    anchorByBody.set(tbody, key);
  }

  function takeReportRange(box) {
    const range = reportRanges.get(box);
    reportRanges.delete(box);
    return range?.length ? range : null;
  }

  /* Tarayıcıda kendini bağlar; node'da (test) yalnız saf işlevler kalır. */
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('click', onClick);
  }

  const api = { applyRange, onClick, onMouseDown, takeReportRange };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.BLGridRangeSelect = api;
})(typeof window !== 'undefined' ? window : globalThis);
