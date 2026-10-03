/* ===================================================================
   v7.31 — MODEL ADINA SAĞ TIK MENÜSÜ

   Kullanıcı talebi (birebir): "e-mail tarama butonlarını tablolardan kaldır.
   E-mail taramasını model adına sağ tıklayarak açılacak olan pencerede seçmek
   istiyorum. Ayrıca tools kısmındaki araçlar da modellere sağ tıkladığımda
   açılır pencere ile görebileyim."

   TASARIM KARARLARI

   1) ARAÇLAR KOPYALANMAZ, ÇALIŞTIRILIR. Araçlar menüsündeki düğmeler gerçek
      DOM düğümleridir (app-main.js onları araç çubuğundan menüye TAŞIR). Menü
      burada yeniden yazılsaydı iki ayrı işlem yolu doğar ve zamanla birbirinden
      ayrılırdı. Bu yüzden sağ tık menüsü o düğmeleri canlı okur, seçilince
      GERÇEK düğmeye tıklar. Yeni bir araç eklendiğinde burada hiçbir şey
      değişmesi gerekmez.

   2) HANGİ SATIRA UYGULANACAĞI GİZLİ KALMAZ. Araçların çoğu SEÇİLİ satırlara
      göre çalışır. Sağ tıklanan satır seçili değilken aracı çalıştırmak,
      kullanıcının bakmadığı bir kümeye işlem yapmak olurdu. Bu yüzden sağ
      tıklanan satır seçili değilse yalnız o satır seçilir (Excel/Dosya
      Gezgini davranışı) ve menü başlığı neye uygulanacağını yazar.

   3) MODEL ADI HÜCRESİ. Satır araçları yalnız burada açılır; CP / Orders
      tablolarında tüm hücreler ayrıca ortak kopyalama menüsünü taşır.
   =================================================================== */
(() => {
  'use strict';

  const MODEL_COLUMN_KEYS = new Set(['Model Name', 'Model Adı', 'modelName', 'model']);
  const TABLES = [
    { sel: '#cpTable', module: 'cp', tools: 'cpToolsMenu' },
    { sel: '#ordersTable', module: 'orders', tools: 'ordersToolsMenu' },
    { sel: '#kolTable', module: 'collection', tools: 'kolToolsMenu' },
  ];

  const en = () => typeof appLang !== 'undefined' && appLang === 'en';
  const T = (tr, enText) => (en() ? enText : tr);
  const esc = value => (typeof escapeHtml === 'function' ? escapeHtml(String(value == null ? '' : value))
    : String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])));

  let menu = null;

  function close() {
    menu?.remove();
    menu = null;
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onOutside, true);
  }
  function onKey(event) {
    if (event.key !== 'Escape' || !menu) return;
    event.preventDefault(); event.stopImmediatePropagation();
    close();
  }
  function onOutside(event) { if (menu && !menu.contains(event.target)) close(); }

  /* Sağ tıklanan hücrenin sütun anahtarı. Hücrelerde data-k yok; başlık
     satırındaki th'lerde var, aynı sıradaki th okunur. */
  function columnKeyOfCell(table, cell) {
    const row = cell.parentElement;
    if (!row) return '';
    const index = [...row.children].indexOf(cell);
    if (index < 0) return '';
    const heads = table.querySelectorAll('thead tr.colRow th');
    const head = heads[index];
    return head ? String(head.dataset.k || '') : '';
  }

  function rowIdOfCell(cell) {
    const row = cell.closest('tr');
    if (!row) return '';
    return String(row.dataset.id || row.getAttribute('data-shipid') || row.getAttribute('data-kolid') || '');
  }

  function selectionSetFor(module) {
    if (module === 'collection') return typeof window.BLGetCollectionSelected === 'function' ? window.BLGetCollectionSelected() : null;
    const state = window.state;
    if (!state) return null;
    if (module === 'cp') return state.cpSelected;
    if (module === 'orders') return state.ordersSelected;
    return null;
  }

  /* Araçlar menüsündeki GERÇEK düğümleri okur. Etiket ve simge o düğmeden
     alınır; seçilince o düğmeye tıklanır. */
  function toolEntries(toolsMenuId) {
    const host = document.getElementById(toolsMenuId);
    if (!host) return [];
    return [...host.querySelectorAll('button')]
      .filter(button => !button.disabled && button.offsetParent !== null || !button.disabled)
      .map(button => {
        const label = String(button.textContent || '').trim() || String(button.title || '').trim();
        const icon = button.querySelector('use')?.getAttribute('href') || '';
        return label ? { label, icon, run: () => button.click() } : null;
      })
      .filter(Boolean);
  }

  function render(items, x, y, headline) {
    close();
    menu = document.createElement('div');
    menu.className = 'rowCtxMenu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = `${headline ? `<div class="rowCtxHead">${esc(headline)}</div>` : ''}${items.map((item, index) => (item.separator
      ? '<div class="rowCtxSep"></div>'
      : `<button type="button" class="rowCtxItem" role="menuitem" data-ctx="${index}">${item.icon ? `<svg class="ic"><use href="${esc(item.icon)}"/></svg>` : '<span class="rowCtxDot"></span>'}<span>${esc(item.label)}</span></button>`)).join('')}`;
    document.body.appendChild(menu);

    // Ekrandan taşmasın: menü imlecin yanına, sığmıyorsa içeri doğru açılır.
    const rect = menu.getBoundingClientRect();
    const left = Math.max(6, Math.min(x, window.innerWidth - rect.width - 6));
    const top = Math.max(6, Math.min(y, window.innerHeight - rect.height - 6));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    menu.addEventListener('click', event => {
      const button = event.target.closest('[data-ctx]');
      if (!button) return;
      const item = items[Number(button.dataset.ctx)];
      close();
      try { item?.run?.(); } catch (error) { if (typeof showToast === 'function') showToast(String(error && error.message || error)); }
    });
    document.addEventListener('keydown', onKey, true);
    // pointerdown: menü açıkken başka bir yere basıldığında kapansın.
    setTimeout(() => document.addEventListener('pointerdown', onOutside, true), 0);
  }

  function managedClipboardEntries(config, table, cell) {
    if (config.module !== 'cp' && config.module !== 'orders') return [];
    if (!window.BLGridClipboard?.prepareContextMenu?.(table.id, cell)) return [];
    const copyEvent = { preventDefault() {}, stopImmediatePropagation() {} };
    return [
      { label: T('Başlıklarla kopyala', 'Copy with headers'), key: 'Ctrl+C', run: () => void window.BLGridClipboard?.copyActive?.(copyEvent, { includeHeaders: true }) },
      { label: T('Kopyala', 'Copy'), run: () => void window.BLGridClipboard?.copyActive?.(copyEvent, { includeHeaders: false }) },
    ];
  }

  function openManagedGridCopyMenu(config, table, cell, event) {
    const items = managedClipboardEntries(config, table, cell);
    if (!items.length) return false;
    event.preventDefault();
    render(items, event.clientX, event.clientY, T('Kopyalama', 'Copy'));
    return true;
  }

  function openForCell(config, table, cell, event) {
    const id = rowIdOfCell(cell);
    if (!id) return false;
    const row = typeof window.BLGetOutlookRow === 'function' ? window.BLGetOutlookRow(config.module, id) : null;
    const modelName = String((row && (row['Model Name'] || row.modelName || row.model)) || cell.textContent || '').trim();
    const clipboardItems = managedClipboardEntries(config, table, cell);

    /* Araçlar seçili satırlara göre çalışır: sağ tıklanan satır seçili değilse
       yalnız o satır seçilir, böylece işlem görünmeyen bir kümeye uygulanmaz. */
    const selection = selectionSetFor(config.module);
    let scopeText = '';
    if (selection) {
      if (!selection.has(id) && !selection.has(Number(id))) {
        selection.clear();
        selection.add(row && row._id != null ? row._id : id);
        const rerender = config.module === 'orders' ? window.renderOrders : config.module === 'collection' ? window.renderKol : window.renderCP;
        if (typeof rerender === 'function') rerender();
      }
      scopeText = selection.size > 1
        ? T(`${selection.size} seçili satır`, `${selection.size} selected rows`)
        : (modelName || T('bu satır', 'this row'));
    } else {
      scopeText = modelName || T('bu satır', 'this row');
    }

    const items = [...clipboardItems];
    if (clipboardItems.length) items.push({ separator: true });
    const outlook = window.BLOutlook;
    if (outlook && typeof outlook.canUse === 'function' && outlook.canUse() && row) {
      items.push({
        label: T('Outlook maillerini ara', 'Search Outlook emails'),
        icon: '#i-mail-send',
        run: () => outlook.openRow(row, config.module),
      });
    }
    // PLM numune talepleri (CoreNectum Requests): CP aşamasında takip edilir,
    // koleksiyonda numune çalışılmaz. Yalnız PLM ID'si olan CP/Sipariş satırı.
    const sampleRequests = window.BLPlmSampleRequests;
    if (sampleRequests && row && config.module !== 'collection' && sampleRequests.plmIdOfRow(row, config.module)) {
      items.push({
        label: T('PLM numune talepleri', 'PLM sample requests'),
        run: () => sampleRequests.openForRow(row, config.module),
      });
    }
    const tools = toolEntries(config.tools);
    if (items.length && tools.length) items.push({ separator: true });
    items.push(...tools);
    if (!items.length) return false;

    event.preventDefault();
    render(items, event.clientX, event.clientY, scopeText);
    return true;
  }

  document.addEventListener('contextmenu', event => {
    const cell = event.target.closest('td');
    if (!cell) return;
    for (const config of TABLES) {
      const table = cell.closest(config.sel);
      if (!table) continue;
      // Koleksiyon'da model adı hücresi kendi sınıfını taşır; CP/Siparişler'de
      // sütun anahtarından bulunur.
      const isModelCell = cell.classList.contains('plmModelLinkCell')
        || MODEL_COLUMN_KEYS.has(columnKeyOfCell(table, cell));
      if (isModelCell) { openForCell(config, table, cell, event); return; }
      if (cell.dataset.ordercodeCell === '1') { openManagedGridCopyMenu(config, table, cell, event); return; }
      if (config.module === 'cp' || config.module === 'orders') { openManagedGridCopyMenu(config, table, cell, event); return; }
      return;
    }
  });

  // render/close dışa açılır: Nakliye Kıyaslama satırları (kart tablosu, TABLES
  // listesindeki cp/orders/collection hücre modeline uymuyor) aynı menü kabuğunu
  // kendi öğe listesiyle yeniden kullanır — ikinci bir popover bileşeni kurulmaz.
  window.BLRowMenu = { close, render, toolEntries, columnKeyOfCell, MODEL_COLUMN_KEYS, TABLES };

})();
