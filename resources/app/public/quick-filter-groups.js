/* ===================================================================
   v7.36 — HIZLI FİLTRE BAŞLIKLARI (kullanıcı ekler/çıkarır)

   Kullanıcı talebi (birebir): "modüllerdeki hızlı filtre alanlarına yeni
   hızlı filtreleme başlıkları ekleyip çıkarabilsin kullanıcı."

   TASARIM KARARLARI

   1) HAZIR BAŞLIKLAR KORUNUR. Sezon, Unified Action Priority, Status,
      Ex-Factory ve Del. Type kendi filtre davranışlarını kullanır. Priority
      artık Handover/Delay gibi çoklu warning metni değil, tek kanonik severity
      kodudur; Ex-Factory tarih kovaları ve diğer görünüm dönüşümleri korunur.

   2) EKLENEN BAŞLIK GERÇEK SÜTUNDUR. Kullanıcı tablonun herhangi bir
      sütununu başlık yapabilir; çipler o sütunun DEĞERLERİdir ve sayıları
      gerçek satır sayımıdır. Hesaplanan sütunlar ve ASAS/IAS'tan eklenen
      sütunlar da seçilebilir (v7.31/v7.34).

   3) SAYIM KAPSAMI DÜRÜSTTÜR. Bir başlıkta değer seçiliyken o başlığın
      çipleri, KENDİ filtresi hariç tutularak sayılır. Aksi hâlde seçim
      yapıldığı anda diğer değerler 0 olup kaybolur ve kullanıcı seçimini
      temizlemeden başka bir değere geçemezdi.

   4) AYAR KİŞİSELDİR. Kullanıcının kendi çalışma alanına yazılır ("columns"
      kategorisi), böylece Profil Kopyalama ile aktarılabilir. Başkasının
      ekranını değiştirmez.

   5) SIFIR VERİ KAYBI. Başlık çıkarmak yalnız ŞERİDİ değiştirir; sütun,
      satır ya da filtre silinmez. Çıkarılan başlığın o an aktif bir filtresi
      varsa filtre olduğu gibi çalışmaya devam eder ve üstteki "Aktif
      Filtreler" alanında görünür — sessizce kaybolmaz.
   =================================================================== */
(() => {
  'use strict';

  const KEY_PREFIX = 'bl.quickFilterGroups.';
  const MAX_EXTRA = 6;      // şerit okunabilir kalsın
  const MAX_CHIPS = 12;     // bir başlıkta gösterilecek en çok çip
  const MAX_DISTINCT = 400; // sayım sırasında izlenecek en çok farklı değer

  const en = () => typeof appLang !== 'undefined' && appLang === 'en';
  const T = (tr, enText) => (en() ? enText : tr);
  const esc = value => (typeof escapeHtml === 'function' ? escapeHtml(String(value == null ? '' : value))
    : String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])));
  const clean = value => String(value == null ? '' : value).trim();

  /* Modüller. tableKey, sütun listesinin ve filtre kabının anahtarıdır;
     Genel Bakış şeridi CP sütunlarını kullanır ama tıklandığında CP'ye
     GİDER (yerinde filtrelemez) — bu, şeridin v1'den beri süregelen
     davranışıdır ve korunur. */
  const MODULES = {
    overview: { tableKey: 'cp', host: 'kpiCP', navigates: true, label: { tr: 'Genel Bakış', en: 'Overview' } },
    cp: { tableKey: 'cp', host: 'cpKpi', navigates: false, label: { tr: 'CP', en: 'CP' } },
    orders: { tableKey: 'orders', host: 'ordersKpi', navigates: false, label: { tr: 'Siparişler', en: 'Orders' } },
  };
  /* Hazır başlıklar. Sıra, şeritte çizildikleri sıradır. Etiketler ŞERİTTE
     yazanın aynısıdır: pencerede "Order Status", şeritte "Sipariş Durumu"
     yazsaydı kullanıcı hangi başlığı kapattığını eşleştiremezdi. */
  const BUILT_INS = {
    overview: [['season', { tr: 'Sezon', en: 'SEASON' }], ['pri', 'Priority'], ['status', 'Status'], ['exf', 'Ex-Factory'], ['del', 'Del. Type']],
    cp: [['season', 'Season'], ['pri', 'Priority'], ['status', 'Status'], ['exf', 'Ex-Factory'], ['del', 'Del. Type']],
    orders: [['orderStatus', { tr: 'Sipariş Durumu', en: 'Order Status' }], ['season', 'Season'], ['pri', 'Priority'], ['status', 'Status'], ['exf', 'Ex-Factory'], ['del', 'Del. Type']],
  };
  const builtInLabel = label => (label && typeof label === 'object' ? (en() ? label.en : label.tr) : label);
  // Hazır başlıkların dayandığı sütunlar; ekleme listesinde ikinci kez çıkmasınlar.
  const BUILT_IN_COLUMNS = new Set(['Season', 'Priority', 'STATUS', 'Ex-factory', 'Del. Type', 'Active/Inactive']);

  /* ---------------- ayar deposu ---------------- */

  function storageKey(moduleKey) { return `${KEY_PREFIX}${moduleKey}.v1`; }
  function config(moduleKey) {
    if (!MODULES[moduleKey]) return { hidden: [], extra: [] };
    try {
      const raw = window.BLStorage ? BLStorage.getItem(storageKey(moduleKey)) : localStorage.getItem(storageKey(moduleKey));
      const parsed = JSON.parse(raw || '{}');
      const known = new Set((BUILT_INS[moduleKey] || []).map(([id]) => id));
      return {
        hidden: (Array.isArray(parsed.hidden) ? parsed.hidden : []).filter(id => known.has(id)),
        extra: (Array.isArray(parsed.extra) ? parsed.extra : []).map(clean).filter(Boolean).slice(0, MAX_EXTRA),
      };
    } catch (_) { return { hidden: [], extra: [] }; }
  }
  function saveConfig(moduleKey, next) {
    const value = JSON.stringify({ hidden: next.hidden || [], extra: (next.extra || []).slice(0, MAX_EXTRA) });
    try {
      if (window.BLStorage) BLStorage.setItem(storageKey(moduleKey), value);
      else localStorage.setItem(storageKey(moduleKey), value);
    } catch (_) { /* kota dolu: ekrandaki ayar yine de çalışır */ }
  }
  function isVisible(moduleKey, id) { return !config(moduleKey).hidden.includes(id); }

  /* ---------------- eklenebilir sütunlar ---------------- */

  function availableColumns(moduleKey) {
    const module = MODULES[moduleKey];
    if (!module) return [];
    const cols = (window.COLS_BY_TABLE && window.COLS_BY_TABLE[module.tableKey]) || [];
    const out = [];
    const seen = new Set();
    for (const col of cols) {
      if (!col || !col.k) continue;
      if (BUILT_IN_COLUMNS.has(col.k)) continue;      // hazır başlık zaten var
      if (col.type === 'cpImage' || col.k === '__picture') continue; // görselin çipi olmaz
      if (String(col.k).startsWith('__') && !col.formulaCustom && !col.modelCustom) continue;
      if (seen.has(col.k)) continue;
      seen.add(col.k);
      const label = typeof window.tableColumnLabel === 'function'
        ? window.tableColumnLabel(module.tableKey, col) : (col.label || col.k);
      out.push({ key: col.k, label: label || col.k, calculated: Boolean(col.formulaCustom), model: Boolean(col.modelCustom) });
    }
    return out.sort((a, b) => String(a.label).localeCompare(String(b.label), 'tr', { sensitivity: 'base' }));
  }
  function columnLabel(moduleKey, key) {
    const found = availableColumns(moduleKey).find(item => item.key === key);
    return found ? found.label : key;
  }

  /* ---------------- eklenen başlıkların çipleri ---------------- */

  /* Değer sayımı. Boş hücreler "—" altında toplanır: kaç kaydın o alanı boş
     olduğunu görmek çoğu zaman en çok işe yarayan bilgidir ve gizlenirse
     toplam tutmaz. */
  function countValues(rows, key) {
    const counts = new Map();
    for (const row of rows || []) {
      const raw = row ? row[key] : '';
      const value = clean(raw instanceof Date ? (typeof window.fmtDate === 'function' ? window.fmtDate(raw) : raw.toISOString().slice(0, 10)) : raw) || '—';
      if (!counts.has(value) && counts.size >= MAX_DISTINCT) continue;
      counts.set(value, (counts.get(value) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'tr'));
  }

  function activeValues(tableKey, key) {
    const entry = state && state.colFilters && state.colFilters[tableKey] && state.colFilters[tableKey][key];
    return entry && entry.values ? new Set([...entry.values].map(value => clean(value))) : new Set();
  }

  /* Bir başlığın sayım kapsamı: KENDİ filtresi hariç. scopeFor, modülün
     kendi değerlendiricisini çağıran işlevdir (CP/Siparişler'de tam tarama).
     Kendi filtresi yoksa fazladan tarama yapılmaz. */
  function scopedRows(tableKey, key, baseRows, scopeFor) {
    const bucket = state && state.colFilters && state.colFilters[tableKey];
    const saved = bucket && bucket[key];
    if (!saved || typeof scopeFor !== 'function') return baseRows;
    delete bucket[key];
    try { return scopeFor() || baseRows; }
    catch (_) { return baseRows; }
    finally { bucket[key] = saved; }
  }

  function groupHtml(moduleKey, key, baseRows, scopeFor) {
    const module = MODULES[moduleKey];
    const rows = scopedRows(module.tableKey, key, baseRows, scopeFor);
    const entries = countValues(rows, key);
    if (!entries.length) return '';
    const active = activeValues(module.tableKey, key);
    const shown = entries.slice(0, MAX_CHIPS);
    const hiddenCount = entries.length - shown.length;
    const chips = shown.map(([value, count]) => {
      const on = active.has(value) ? ' active' : '';
      return `<div class="kpi tone-gray${on}" data-qfg-col="${esc(key)}" data-qfg-value="${esc(value)}"><span class="n">${count}</span><span class="l">${esc(value)}</span></div>`;
    }).join('');
    /* Kesilen çip sayısı SÖYLENİR. Sessizce kesmek, kullanıcıya "başka değer
       yok" demek olurdu; sütun başlığındaki tam filtre hâlâ hepsini gösterir.
       Sayı BAŞLIĞIN içine yazılır: şerit, çipleri başlığın altına toplayan bir
       katmandan geçiyor ve başlıkla çipler arasındaki her yabancı düğüm o
       grubun çip toplamasını erken keserdi. */
    const more = hiddenCount > 0
      ? ` <span class="kpiGroupMore" title="${esc(T('Tümü için sütun başlığındaki filtreyi kullanın.', 'Use the column header filter to see them all.'))}">+${hiddenCount}</span>`
      : '';
    return `<div class="kpiSep"></div><span class="kpiGroupLabel">${esc(columnLabel(moduleKey, key))}${more}</span>${chips}`;
  }

  function extraHtml(moduleKey, baseRows, scopeFor) {
    return config(moduleKey).extra.map(key => groupHtml(moduleKey, key, baseRows, scopeFor)).join('');
  }

  /* Eklenen çiplerin tıklaması. Hazır başlıklarla aynı mekanizmayı kullanır:
     değer state.colFilters'a yazılır, yani sütun başlığındaki filtre ile
     AYNI kaynağı paylaşır ve "Aktif Filtreler" alanında görünür. */
  function bindExtra(moduleKey, host, rerender) {
    if (!host) return;
    host.querySelectorAll('[data-qfg-col]').forEach(el => {
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => {
        const module = MODULES[moduleKey];
        const key = el.dataset.qfgCol, value = el.dataset.qfgValue;
        if (typeof window.toggleMirroredQuickFilter === 'function') {
          window.toggleMirroredQuickFilter(module.tableKey, key, null, value === '—' ? '' : value);
        }
        if (module.navigates && typeof window.switchTab === 'function') {
          window.switchTab(module.tableKey);
          if (typeof window.renderCP === 'function' && module.tableKey === 'cp') window.renderCP();
          return;
        }
        if (typeof rerender === 'function') rerender();
      });
    });
  }

  /* ---------------- düzenleme penceresi ---------------- */

  let modal = null;
  function close() { modal?.remove(); modal = null; document.removeEventListener('keydown', onKey, true); }
  function onKey(event) { if (event.key === 'Escape') { event.preventDefault(); close(); } }

  function open(moduleKey, rerender) {
    if (!MODULES[moduleKey]) return;
    close();
    const cfg = config(moduleKey);
    const hidden = new Set(cfg.hidden);
    const extra = [...cfg.extra];
    const columns = availableColumns(moduleKey);

    modal = document.createElement('div');
    modal.id = '_quickFilterGroups';
    modal.className = 'warnOverlay qfgOverlay';
    const render = () => {
      const builtIns = (BUILT_INS[moduleKey] || []).map(([id, label]) => `
        <label class="qfgRow">
          <input type="checkbox" data-qfg-builtin="${esc(id)}"${hidden.has(id) ? '' : ' checked'}>
          <span>${esc(builtInLabel(label))}</span>
          <em>${esc(T('hazır', 'built-in'))}</em>
        </label>`).join('');
      const added = extra.length ? extra.map(key => `
        <label class="qfgRow">
          <input type="checkbox" data-qfg-extra="${esc(key)}" checked>
          <span>${esc(columnLabel(moduleKey, key))}</span>
          <em>${esc(T('eklendi', 'added'))}</em>
        </label>`).join('') : `<p class="qfgNote">${esc(T('Henüz başlık eklemediniz.', 'You have not added a heading yet.'))}</p>`;
      modal.querySelector('[data-qfg-list]').innerHTML = builtIns + added;
      const picker = modal.querySelector('[data-qfg-picker]');
      const full = extra.length >= MAX_EXTRA;
      picker.disabled = full;
      picker.innerHTML = full
        ? `<option value="">${esc(T(`En çok ${MAX_EXTRA} başlık eklenebilir`, `At most ${MAX_EXTRA} headings`))}</option>`
        : `<option value="">${esc(T('Başlık olarak ekle…', 'Add as a heading…'))}</option>`
          + columns.filter(col => !extra.includes(col.key))
            .map(col => `<option value="${esc(col.key)}">${esc(col.label)}${col.calculated ? ` (${esc(T('hesaplanan', 'calculated'))})` : col.model ? ' (ASAS/IAS)' : ''}</option>`).join('');
    };

    modal.innerHTML = `<div class="modalCard qfgCard" role="dialog" aria-modal="true" aria-labelledby="_qfgTitle">
      <div class="qfgHead">
        <div>
          <div class="modalTitle" id="_qfgTitle">${esc(T('Hızlı filtre başlıkları', 'Quick filter headings'))}</div>
          <p class="qfgSub">${esc(T(
            `${en() ? MODULES[moduleKey].label.en : MODULES[moduleKey].label.tr} şeridinde hangi başlıkların görüneceğini siz seçersiniz. Yalnız sizin ekranınızı etkiler; başlık çıkarmak hiçbir veriyi ya da filtreyi silmez.`,
            `You choose which headings appear on the ${MODULES[moduleKey].label.en} strip. It affects only your screen; removing a heading deletes no data and no filter.`,
          ))}</p>
        </div>
        <button type="button" class="pricingRuleIconBtn" data-qfg-close aria-label="${esc(T('Kapat', 'Close'))}">✕</button>
      </div>
      <div class="qfgBody">
        <div class="qfgList" data-qfg-list></div>
        <label class="qfgAdd">${esc(T('Yeni başlık', 'New heading'))}
          <select data-qfg-picker></select>
        </label>
      </div>
      <div class="qfgFoot">
        <button type="button" class="fcBtn" data-qfg-reset>${esc(T('Varsayılana dön', 'Reset to default'))}</button>
        <span style="flex:1"></span>
        <button type="button" class="fcBtn" data-qfg-close>${esc(T('Kapat', 'Close'))}</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    render();

    const apply = () => { saveConfig(moduleKey, { hidden: [...hidden], extra }); if (typeof rerender === 'function') rerender(); };
    modal.addEventListener('change', event => {
      const builtIn = event.target.closest('[data-qfg-builtin]');
      if (builtIn) {
        if (builtIn.checked) hidden.delete(builtIn.dataset.qfgBuiltin); else hidden.add(builtIn.dataset.qfgBuiltin);
        apply(); return;
      }
      const added = event.target.closest('[data-qfg-extra]');
      if (added) {
        const index = extra.indexOf(added.dataset.qfgExtra);
        if (index >= 0) extra.splice(index, 1);
        apply(); render(); return;
      }
      const picker = event.target.closest('[data-qfg-picker]');
      if (picker && picker.value) {
        if (!extra.includes(picker.value) && extra.length < MAX_EXTRA) extra.push(picker.value);
        picker.value = '';
        apply(); render();
      }
    });
    modal.addEventListener('click', event => {
      if (event.target === modal || event.target.closest('[data-qfg-close]')) { close(); return; }
      if (event.target.closest('[data-qfg-reset]')) {
        hidden.clear(); extra.length = 0; apply(); render();
      }
    });
    document.addEventListener('keydown', onKey, true);
  }

  /* Şeride düzenleme düğmesi. Şerit her çizimde yeniden kurulduğu için düğme
     de her çizimde eklenir; iki kez eklenmemesi için varlığı kontrol edilir. */
  function attachEditButton(moduleKey, rerender) {
    const module = MODULES[moduleKey];
    const host = module && document.getElementById(module.host);
    if (!host || host.querySelector('[data-qfg-open]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'kpiGroupEdit';
    button.dataset.qfgOpen = moduleKey;
    button.title = T('Hızlı filtre başlıklarını düzenle', 'Edit quick filter headings');
    button.setAttribute('aria-label', button.title);
    button.innerHTML = '<svg class="ic"><use href="#i-settings"/></svg>';
    button.addEventListener('click', event => { event.stopPropagation(); open(moduleKey, rerender); });
    host.prepend(button);
  }

  window.BLQuickFilterGroups = {
    MODULES, BUILT_INS, MAX_EXTRA, MAX_CHIPS,
    config, saveConfig, isVisible, availableColumns, columnLabel,
    countValues, extraHtml, groupHtml, bindExtra, attachEditButton, open, close,
  };
})();
