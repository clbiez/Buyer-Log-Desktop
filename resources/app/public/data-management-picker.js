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
   *   allowFree     true ise Enter ile yazılan metin değer olarak döner
   *   keepOpen      true ise seçimden sonra pencere açık kalır (çoklu seçim)
   *   selectedValues önceden seçili değerler; keepOpen ile tekrar seçimi engeller
   *   limit         listede gösterilecek azami satır (varsayılan 300)
   * Öğe `group: ['Tablo', 'Klasör']` taşıyorsa liste hiyerarşik başlıklarla çizilir.
   */
  function open(anchor, items, onPick, options = {}) {
    close();
    const list = Array.isArray(items) ? items.slice() : [];
    const search = options.search !== false;
    const keepOpen = options.keepOpen === true;
    const selected = new Set((Array.isArray(options.selectedValues) ? options.selectedValues : [])
      .map(value => String(value)));
    const limit = Number(options.limit) > 0 ? Number(options.limit) : 300;

    const picker = document.createElement('div');
    picker.id = ID;
    picker.className = 'dmfPicker';
    picker.innerHTML = `
      ${search ? `<input type="text" class="dmfPickerSearch" placeholder="${esc(options.placeholder || T('Ara…', 'Search…'))}" autocomplete="off">` : ''}
      <div class="dmfPickerList"></div>`;
    document.body.appendChild(picker);

    const listEl = picker.querySelector('.dmfPickerList');
    /* HİYERARŞİ (isteğe bağlı): öğe `group` dizisi taşıyorsa (ör. [tablo,
       klasör]) liste o yola göre sıralanır ve yol değiştikçe başlık satırı
       çizilir — Excel alan listesindeki Tablo → Klasör düzeni. Görünüm aynı
       yüzen liste olarak kalır; başlıklar tıklanmaz, yalnız yön gösterir. */
    const pathOf = entry => (Array.isArray(entry.group) ? entry.group.map(part => String(part || '').trim()).filter(Boolean) : []);
    const grouped = list.some(entry => pathOf(entry).length);
    if (grouped) {
      const cmp = (a, b) => String(a).localeCompare(String(b), 'tr', { sensitivity: 'base', numeric: true });
      list.sort((a, b) => {
        const pa = pathOf(a), pb = pathOf(b);
        for (let i = 0; i < Math.min(pa.length, pb.length); i += 1) { const c = cmp(pa[i], pb[i]); if (c) return c; }
        // Aynı yol içinde çağıranın sırası korunur (sort kararlıdır).
        return pa.length - pb.length;
      });
    }
    const headersFor = (previous, path) => {
      let same = 0;
      while (same < path.length && same < previous.length && previous[same] === path[same]) same += 1;
      return path.slice(same).map((part, offset) => {
        const depth = same + offset;
        return `<p class="dmfPickerGroup${depth ? '' : ' isTable'}" style="--tree-depth:${depth}" role="presentation" data-no-i18n title="${esc(path.slice(0, depth + 1).join(' › '))}">${esc(part)}</p>`;
      }).join('');
    };
    const draw = entries => {
      /* Uzun listeler KESİLİR ve bu SÖYLENİR. Sessizce ilk 300'ü göstermek,
         kullanıcının aradığı sütunu "yok" sanmasına yol açardı. */
      const shown = entries.slice(0, limit);
      let previousPath = [];
      listEl.innerHTML = shown.length
        ? shown.map(entry => {
            const value = String(entry.value == null ? '' : entry.value);
            const isSelected = selected.has(value);
            const path = grouped ? pathOf(entry) : [];
            const headers = grouped ? headersFor(previousPath, path) : '';
            previousPath = path;
            const depthAttr = grouped ? ` data-tree-depth="${path.length}" style="--tree-depth:${path.length}"` : '';
            return `${headers}<button type="button" class="dmfPickerItem${isSelected ? ' isSelected' : ''}" data-value="${esc(value)}"${depthAttr}
              aria-selected="${isSelected ? 'true' : 'false'}"${isSelected && keepOpen ? ' disabled' : ''}>
              ${grouped ? `<span data-no-i18n>${esc(entry.label)}</span>` : esc(entry.label)}${entry.hint ? `<span class="dmfPickerHint">${esc(entry.hint)}</span>` : ''}
            </button>`;
          }).join('')
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
        /* Gruplu listede tablo/klasör adıyla da aranır (Excel alan listesi gibi). */
        draw(needle ? list.filter(entry => `${grouped ? pathOf(entry).join(' ') + ' ' + (entry.hint || '') + ' ' : ''}${entry.label}`.toLocaleLowerCase('tr').includes(needle)) : list);
      });
      if (options.allowFree) {
        field.addEventListener('keydown', event => {
          if (event.key !== 'Enter') return;
          const typed = field.value.trim();
          if (!typed) return;
          if (keepOpen) {
            if (selected.has(typed)) return;
            selected.add(typed);
            onPick(typed);
            field.value = '';
            draw(list);
            requestAnimationFrame(() => field.focus());
            return;
          }
          close();
          onPick(typed);
        });
      }
      requestAnimationFrame(() => field.focus());
    }

    picker.addEventListener('click', event => {
      const button = event.target.closest('[data-value]');
      if (!button) return;
      const value = String(button.dataset.value || '');
      if (keepOpen) {
        if (selected.has(value)) return;
        selected.add(value);
        button.classList.add('isSelected');
        button.setAttribute('aria-selected', 'true');
        button.disabled = true;
        onPick(value);
        requestAnimationFrame(() => field?.focus());
        return;
      }
      close();
      onPick(value);
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
