/* Shift ile satır aralığı seçimi — CP, Siparişler, Koleksiyon ve tik kutusu
   taşıyan diğer tablolar.

   NEDEN TEK MODÜL: üç tablo seçim defterini üç ayrı yerde tutuyor —
   Siparişler tbody üzerinde devredilmiş bir 'change' dinleyicisi
   (tbody._chkMeta), CP satır başına dinleyici, Koleksiyon ise kendi
   kolSelected kümesi. Aralık mantığını üç kez yazmak bu defterleri de
   çoğaltırdı. Bunun yerine aralıktaki kutuların durumu değiştirilir ve her
   birine 'change' gönderilir: hangi tablo olursa olsun kendi mevcut
   defterini kendisi günceller. Yeni bir seçim yolu üretilmiyor.

   Davranış Excel/Gmail ile aynı: tık = çıpa; shift+tık = çıpadan tıklanan
   satıra kadar olan aralığı TIKLANAN kutunun yeni durumuna eşitler. Yani
   shift+tık işaretliyse aralık işaretlenir, kaldırıyorsa aralık kaldırılır. */
(function (global) {
  'use strict';

  const BOX = 'input.rowChk';

  /* Çıpa, element olarak değil data-id olarak saklanır. Tablolar tbody'yi
     innerHTML ile yeniden kuruyor; element referansı ilk çizimde kopardı,
     id ise filtre/sıralama sonrasında bile doğru satırı bulur. */
  const anchorByBody = new WeakMap();

  function boxesIn(tbody) {
    return Array.prototype.slice.call(tbody.querySelectorAll(BOX));
  }

  function indexOfId(boxes, id) {
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].dataset.id === id) return i;
    }
    return -1;
  }

  /* Aralığı hedef duruma eşitler. Tıklanan kutuya dokunulmaz: tarayıcı onu
     zaten çevirdi ve kendi 'change' olayını gönderdi. */
  function applyRange(tbody, anchorId, target) {
    const boxes = boxesIn(tbody);
    const from = indexOfId(boxes, anchorId);
    const to = boxes.indexOf(target);
    if (from < 0 || to < 0 || from === to) return 0;

    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const checked = target.checked;
    let changed = 0;

    for (let i = lo; i <= hi; i++) {
      const box = boxes[i];
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
    return node.classList.contains('rowChk') ? node : null;
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

    const anchorId = anchorByBody.get(tbody);
    if (event.shiftKey && anchorId != null && anchorId !== box.dataset.id) {
      applyRange(tbody, anchorId, box);
      /* Çıpa korunur: Excel'de olduğu gibi aynı çıpadan farklı aralıklar
         denenebilsin. */
      return;
    }
    anchorByBody.set(tbody, box.dataset.id);
  }

  /* Tarayıcıda kendini bağlar; node'da (test) yalnız saf işlevler kalır. */
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('click', onClick);
  }

  const api = { applyRange: applyRange, onClick: onClick, onMouseDown: onMouseDown };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.BLGridRangeSelect = api;
})(typeof window !== 'undefined' ? window : globalThis);
