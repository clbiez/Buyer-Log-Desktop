/* ===================================================================
   ORTAK SEÇİCİ (v7.81)

   Aranabilir, yüzen bir liste. Filtre düzenleyicisi (alan ve değer seçimi)
   ile eşleme düzenleyicisi (sütun seçimi) aynı etkileşimi istiyor; ikisine
   ayrı birer kopya yazmak CLAUDE.md §9'a aykırı olurdu ("aynı işlev için
   ikinci bir component üretme").

   Bilinçli olarak KÜÇÜK: veri getirmez, durum tutmaz, kim çağırdıysa ona
   seçilen değeri döndürür. Liste kaynağını çağıran belirler.
   =================================================================== */
(() => {
  'use strict';

  const en = () => typeof appLang !== 'undefined' && appLang === 'en';
  const T = (tr, enText) => (en() ? enText : tr);
  const esc = value => (typeof escapeHtml === 'function'
    ? escapeHtml(String(value == null ? '' : value))
    : String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])));

  const ID = '_dmPicker';
  let cleanup = null;

  function close() {
    document.getElementById(ID)?.remove();
    if (cleanup) { cleanup(); cleanup = null; }
  }

  /**
   * @param {HTMLElement} anchor  konumun hesaplanacağı öğe
   * @param {Array} items         [{value, label, hint}]
   * @param {Function} onPick     (value) => void
   * @param {Object} options
   *   placeholder  arama kutusu metni
   *   search       false ise arama kutusu çizilmez
   *   allowFree    true ise Enter ile yazılan metin değer olarak döner
   *   limit        listede gösterilecek azami satır (varsayılan 300)
   */
  function open(anchor, items, onPick, options = {}) {
    close();
    const list = Array.isArray(items) ? items : [];
    const search = options.search !== false;
    const limit = Number(options.limit) > 0 ? Number(options.limit) : 300;

    const picker = document.createElement('div');
    picker.id = ID;
    picker.className = 'dmfPicker';
    picker.innerHTML = `
      ${search ? `<input type="text" class="dmfPickerSearch" placeholder="${esc(options.placeholder || T('Ara…', 'Search…'))}" autocomplete="off">` : ''}
      <div class="dmfPickerList"></div>`;
    document.body.appendChild(picker);

    const listEl = picker.querySelector('.dmfPickerList');
    const draw = entries => {
      /* Uzun listeler KESİLİR ve bu SÖYLENİR. Sessizce ilk 300'ü göstermek,
         kullanıcının aradığı sütunu "yok" sanmasına yol açardı. */
      const shown = entries.slice(0, limit);
      listEl.innerHTML = shown.length
        ? shown.map(entry => `<button type="button" class="dmfPickerItem" data-value="${esc(entry.value)}">
            ${esc(entry.label)}${entry.hint ? `<span class="dmfPickerHint">${esc(entry.hint)}</span>` : ''}
          </button>`).join('')
          + (entries.length > shown.length
            ? `<p class="dmfPickerEmpty">${esc(T(`${entries.length - shown.length} sonuç daha var — aramayı daraltın.`, `${entries.length - shown.length} more results — narrow your search.`))}</p>`
            : '')
        : `<p class="dmfPickerEmpty">${esc(T('Sonuç yok', 'No results'))}</p>`;
    };
    draw(list);

    const rect = anchor.getBoundingClientRect();
    picker.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 300))}px`;
    picker.style.top = `${Math.min(window.innerHeight - 320, rect.bottom + 4)}px`;

    const field = picker.querySelector('.dmfPickerSearch');
    if (field) {
      field.addEventListener('input', () => {
        const needle = field.value.trim().toLocaleLowerCase('tr');
        draw(needle ? list.filter(entry => String(entry.label).toLocaleLowerCase('tr').includes(needle)) : list);
      });
      if (options.allowFree) {
        field.addEventListener('keydown', event => {
          if (event.key !== 'Enter') return;
          const typed = field.value.trim();
          if (!typed) return;
          close();
          onPick(typed);
        });
      }
      requestAnimationFrame(() => field.focus());
    }

    picker.addEventListener('click', event => {
      const button = event.target.closest('[data-value]');
      if (!button) return;
      close();
      onPick(button.dataset.value);
    });

    const outside = event => { if (!picker.contains(event.target) && event.target !== anchor) close(); };
    const escape = event => { if (event.key === 'Escape') close(); };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape);
    cleanup = () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape);
    };
  }

  window.BLDataPicker = { open, close };
})();
