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
  /* Veri Yönetimi grubu ve widget select yakalayıcısı aynı dosyayı yükleyebilir;
     ikinci yürütme açık seçicinin durumunu ezmez. */
  if (window.BLDataPicker) return;

  const en = () => typeof appLang !== 'undefined' && appLang === 'en';
  const T = (tr, enText) => (en() ? enText : tr);
  const esc = value => (typeof escapeHtml === 'function'
    ? escapeHtml(String(value == null ? '' : value))
    : String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])));

  const ID = '_dmPicker';
  let cleanup = null;
  let currentAnchor = null;

  function close() {
    document.getElementById(ID)?.remove();
    currentAnchor = null;
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
   *   keepOrder     true ise gruplu liste çağıranın sırasıyla çizilir (sıralanmaz)
   *   matchWidth    true ise liste en az anchor genişliğinde açılır
   *   returnFocus   true ise seçim/Escape sonrası odak anchor'a döner
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
    currentAnchor = anchor;

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
    if (grouped && !options.keepOrder) {
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

    /* Konum: altta yer yoksa üstte açılır (alt kenara sabitlenir; arama
       listeyi kısaltınca anchor'dan kopmaz), her durumda ekranda kalır. */
    const PAD = 8;
    const rect = anchor.getBoundingClientRect();
    if (options.matchWidth) picker.style.width = `${Math.min(window.innerWidth - PAD * 2, Math.max(288, Math.round(rect.width)))}px`;
    const pw = picker.offsetWidth || 288, ph = picker.offsetHeight || 300;
    picker.style.left = `${Math.max(PAD, Math.min(rect.left, window.innerWidth - pw - PAD))}px`;
    if (rect.bottom + 4 + ph > window.innerHeight - PAD && rect.top - 4 - ph >= PAD) {
      picker.style.top = 'auto';
      picker.style.bottom = `${Math.round(window.innerHeight - rect.top + 4)}px`;
    } else {
      picker.style.top = `${Math.max(PAD, Math.min(rect.bottom + 4, window.innerHeight - ph - PAD))}px`;
    }
    listEl.querySelector('.dmfPickerItem.isSelected')?.scrollIntoView?.({ block: 'nearest' });
    const visibleItems = () => [...listEl.querySelectorAll('.dmfPickerItem:not(:disabled)')];
    const finish = () => { if (options.returnFocus && anchor.isConnected) anchor.focus({ preventScroll: true }); };

    const field = picker.querySelector('.dmfPickerSearch');
    if (field) {
      field.addEventListener('input', () => {
        const needle = field.value.trim().toLocaleLowerCase('tr');
        /* Gruplu listede tablo/klasör adıyla, her listede ikinci satırla (ör. MAG'ın MMYG adı) da aranır. */
        draw(needle ? list.filter(entry => `${grouped ? pathOf(entry).join(' ') + ' ' : ''}${entry.hint || ''} ${entry.label}`.toLocaleLowerCase('tr').includes(needle)) : list);
      });
      /* Klavye: ↓ listeye iner; Enter (serbest değer yoksa) ilk eşleşmeyi seçer. */
      field.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown') { event.preventDefault(); visibleItems()[0]?.focus(); return; }
        if (event.key !== 'Enter' || options.allowFree || keepOpen) return;
        const first = visibleItems()[0];
        if (!first) return;
        event.preventDefault();
        const value = String(first.dataset.value || '');
        close(); onPick(value); finish();
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
      finish();
    });
    listEl.addEventListener('keydown', event => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const list = visibleItems(), index = list.indexOf(document.activeElement);
      if (index < 0) return;
      event.preventDefault();
      if (event.key === 'ArrowUp' && index === 0) { (field || list[0]).focus(); return; }
      list[Math.max(0, Math.min(list.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))].focus();
    });
    const outside = event => { if (!picker.contains(event.target) && event.target !== anchor) close(); };
    /* Escape capture aşamasında yalnız seçiciyi kapatır; odak anchor'da olsa
       bile altta açık ayar penceresinin Escape işleyicisine ulaşmaz. */
    const escape = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      close(); finish();
    };
    /* Yüzen liste fixed konumludur; altındaki pencere kayarsa anchor'dan kopmasın. */
    const scroll = event => { if (!(event.target instanceof Node) || !picker.contains(event.target)) close(); };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', close);
    cleanup = () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', close);
    };
  }

  /* ---------- Uzun açılır listelere arama (widget'lar) ----------
     ui-primitives.js'teki küçük eager yakalayıcı, widget ayar pencerelerindeki
     ve Genel Bakış widget'larındaki uzun yerel <select>'e tıklanınca bu dosyayı
     ilk kullanımda yükler ve openForSelect'i çağırır. <select> DOM'da kalır:
     seçilen değer ona yazılır ve `input`/`change` olayı tetiklenir; modüllerin
     kaydetme/okuma kodu değişmez. */
  function openForSelect(select) {
    const entries = [...select.options].filter(option => !option.disabled).map(option => {
      const group = option.parentElement && option.parentElement.tagName === 'OPTGROUP' ? option.parentElement.label : '';
      return { value: option.value, label: option.textContent.trim() || option.value, ...(group ? { group: [group] } : {}) };
    });
    open(select, entries, value => {
      if (!select.isConnected || select.value === value) return;
      select.value = value;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }, { selectedValues: [select.value], keepOrder: true, matchWidth: true, returnFocus: true, limit: 1000 });
  }
  const isOpenFor = anchor => Boolean(anchor) && currentAnchor === anchor && Boolean(document.getElementById(ID));

  window.BLDataPicker = { open, close, openForSelect, isOpenFor };
})();
