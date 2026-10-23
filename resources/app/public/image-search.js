/* ===================================================================
   TABLO ARAMASI — GÖRSELDEN ARAMA (CP / Siparişler / Koleksiyon)

   Arama kutusuna ekran görüntüsü yapıştırılınca ortak LCW AI paneli
   (BuyerLogAI.openPanel) görselin önizlemesiyle açılır. Görsel ancak
   kullanıcı "LCW AI'dan Destek Al" dediğinde LCW AI'a yüklenir. Cevap
   public/image-search-engine.js doğrulayıcısından geçer: bulunan ve
   bulunamayan değerler ayrı gösterilir, sorgu yalnız "Aramaya uygula" ile
   arama kutusuna yazılır ve mevcut arama akışı (input olayı) çalışır.

   Pano hem metin hem görsel taşıyorsa (Excel kopyası) metin yapıştırma
   davranışı korunur. Bu dinleyici yakalama aşamasındadır; görsel arama
   kutusuna gittiğinde seçili satırın model görseline yapıştırılmaz.
   =================================================================== */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.BLImageSearch) return;

  const isEn = () => String(window.appLang || document.documentElement.lang || 'tr').toLowerCase().startsWith('en');
  const L = (trText, enText) => (isEn() ? enText : trText);
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const SEARCH_IDS = ['cpSearch', 'ordersSearch', 'kolSearch'];
  const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

  function toast(text) {
    if (typeof window.showToast === 'function') window.showToast(text);
  }

  function clipboardImage(clipboard) {
    const items = clipboard && clipboard.items ? Array.from(clipboard.items) : [];
    for (const item of items) {
      if (item && item.kind === 'file' && /^image\//.test(item.type || '')) {
        const file = item.getAsFile();
        if (file) return file;
      }
    }
    return null;
  }

  async function ensureScripts() {
    const load = window.BLPerf && window.BLPerf._loadScript;
    if (!window.BuyerLogAI && load) await load('lcwai-assistant.js?rev=1');
    if (!window.BLImageSearchEngine && load) await load('image-search-engine.js?rev=1');
    if (!window.BuyerLogAI || !window.BLImageSearchEngine) throw new Error('lcwai-unavailable');
  }

  function readDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  /* Ekrandaki aramayla aynı eşleşme: düz değer = "içerir" ölçütü. */
  function matcher() {
    const search = window.BLTableSearch;
    const parsed = new Map();
    return (haystack, value) => {
      if (!parsed.has(value)) parsed.set(value, search.parseTerms(value));
      return search.matches(haystack, parsed.get(value), { plainMode: 'contains' });
    };
  }

  function chips(list, kind) {
    return `<div class="lcwaiChips">${list.map(item => `<span class="lcwaiChip${kind ? ` is-${kind}` : ''}" data-no-i18n>${esc(item.value || item)}${item.count ? ` <small>${esc(item.count)}</small>` : ''}</span>`).join('')}</div>`;
  }

  function resultHtml(checked) {
    const parts = [];
    if (checked.field) parts.push(`<p class="lcwaiNote">${esc(L('Okunan alan', 'Field read'))}: <b data-no-i18n>${esc(checked.field)}</b></p>`);
    if (checked.found.length) {
      parts.push(`<p class="lcwaiNote">${esc(L(`Tabloda bulunan değerler (${checked.found.length}) · ${checked.rowCount} kayıt`, `Values found in the table (${checked.found.length}) · ${checked.rowCount} records`))}</p>`);
      parts.push(chips(checked.found.map(item => ({ value: item.query === item.value ? item.value : `${item.value} → ${item.query}`, count: item.count }))));
      parts.push(`<code data-no-i18n>${esc(checked.query)}</code>`);
    }
    if (checked.missing.length) {
      parts.push(`<p class="lcwaiNote">${esc(L(`Bu tabloda bulunamayan değerler (${checked.missing.length}) — aramaya eklenmez`, `Values not found in this table (${checked.missing.length}) — not added to the search`))}</p>`);
      parts.push(chips(checked.missing, 'error'));
    }
    return parts.join('');
  }

  async function openForInput(input, file) {
    if (file.size > MAX_IMAGE_BYTES) { toast(L('Görsel LCW AI için çok büyük (en fazla 20 MB).', 'The image is too large for LCW AI (20 MB max).')); return; }
    try { await ensureScripts(); } catch (_) { toast(L('LCW AI kullanılamıyor.', 'LCW AI is not available.')); return; }
    const engine = window.BLImageSearchEngine;
    const space = window.BLTableSearch && typeof window.BLTableSearch.searchSpace === 'function' ? window.BLTableSearch.searchSpace(engine.tabForInput(input.id)) : null;
    if (!space || !space.haystacks.length) { toast(L('Bu tabloda aranacak kayıt yok.', 'There are no records to search in this table.')); return; }
    const preview = await readDataUrl(file).catch(() => '');
    const upload = new File([file], `BuyerLog-search-image.${(file.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '')}`, { type: file.type || 'image/png' });
    let attachment = null;
    const ai = window.BuyerLogAI;
    const panel = ai.openPanel({
      title: L('Görselden Ara', 'Search from Image'),
      source: 'image-search',
      initialRequest: L('Bu görseldeki değerleri tabloda ara.', 'Search the table for the values in this image.'),
      placeholder: L('İsterseniz neyin aranacağını yazın (ör. yalnız sipariş kodları).', 'Optionally say what to look for (e.g. order codes only).'),
      applyLabel: L('Aramaya Uygula', 'Apply to Search'),
      async buildRequest(text) {
        // Görsel yalnız kullanıcı istediğinde ve bir kez yüklenir; "Tekrar Dene" aynı eki kullanır.
        if (!attachment) attachment = await ai.uploadFile(upload);
        return { task: text, context: engine.aiContext(space), attachments: [attachment] };
      },
      interpret(result) {
        const data = (result && (result.data || (result.structured && result.structured.partial))) || {};
        const checked = engine.validate(data, space, matcher());
        return {
          ok: checked.ok,
          value: checked.query,
          html: resultHtml(checked),
          explanation: String(data.explanation || ''),
          issues: checked.ok ? [] : [L('Görselden okunan değerlerin hiçbiri bu tabloda bulunamadı.', 'None of the values read from the image were found in this table.')],
        };
      },
      onApply(query) {
        input.value = query;
        try { input.setSelectionRange(query.length, query.length); } catch (_) {}
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      },
    });
    const host = panel && document.querySelector('#_lcwaiPanel [data-lcwai-panel-host]');
    if (host && preview) {
      host.insertAdjacentHTML('beforebegin', `<figure class="lcwaiImagePreview"><img src="${esc(preview)}" alt="${esc(L('Yapıştırılan görsel', 'Pasted image'))}"><figcaption class="lcwaiNote">${esc(L('Görsel, siz “LCW AI’dan Destek Al” deyince LCW AI’a gönderilir. Sonuç aramaya yalnız “Aramaya Uygula” ile yazılır.', 'The image is sent to LCW AI only when you press “Get help from LCW AI”. The result is written to the search box only with “Apply to Search”.'))}</figcaption></figure>`);
    }
  }

  function onPaste(event) {
    const target = event && event.target;
    if (!target || !SEARCH_IDS.includes(target.id)) return;
    const clipboard = event.clipboardData || window.clipboardData;
    if (!clipboard) return;
    // Excel kopyası metin + görsel taşır: metin varsa mevcut metin yapıştırma çalışır.
    const text = typeof clipboard.getData === 'function' ? clipboard.getData('text/plain') : '';
    if (text && text.trim()) return;
    const file = clipboardImage(clipboard);
    if (!file) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openForInput(target, file).catch(() => toast(L('Görsel araması açılamadı.', 'Image search could not be opened.')));
  }

  document.addEventListener('paste', onPaste, true);
  window.BLImageSearch = { onPaste, openForInput, resultHtml };
})();
