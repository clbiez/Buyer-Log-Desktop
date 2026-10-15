'use strict';

/*
 * Collection-only PLM drag import.
 *
 * Browser -> Electron drag payloads are not stable across Chromium versions:
 * a model image may arrive as text/uri-list, text/html, DownloadURL, a custom
 * string DataTransferItem, or an image File accompanied by one of those text
 * records. Capture the event at document level before grid handlers can stop
 * propagation, then normalize every available string into the canonical
 * CoreNectum Attachment URL.
 *
 * A drag is always an ADD command, never an edit command:
 *   PLM image drag -> resolve attachment -> fetch canonical PLM record ->
 *   create new Collection model -> sync its canonical PLM image.
 * Existing PLM IDs are rejected without changing the Collection row.
 */
(function initCollectionPlmDrag(global) {
  const ATTACHMENT_PATH = /\/lcw\/live\/corenectum\/service\/api\/Attachment\/GetAttachment\/([A-Za-z0-9_-]{8,180})(?:[/?#]|$)/i;
  const ATTACHMENT_BASE = 'https://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/Attachment/GetAttachment/';
  const KNOWN_TEXT_TYPES = [
    'text/uri-list',
    'text/plain',
    'text/html',
    'DownloadURL',
    'text/x-moz-url',
    'application/x-moz-file-promise-url',
  ];

  function normalizeAttachmentUrl(value) {
    let raw = String(value == null ? '' : value).trim();
    if (!raw) return '';
    raw = raw.replace(/&amp;/gi, '&').replace(/^["']|["']$/g, '');
    if (raw.startsWith('//')) raw = 'https:' + raw;
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:' || !/(^|\.)lcwaikiki\.com$/i.test(url.hostname)) return '';
      const match = ATTACHMENT_PATH.exec(url.pathname);
      if (!match) return '';
      return url.origin + url.pathname.replace(/\/+$/, '');
    } catch (_) { return ''; }
  }

  function attachmentUrlFromText(value) {
    const text = String(value == null ? '' : value).replace(/&amp;/gi, '&');
    if (!text) return '';
    const exact = normalizeAttachmentUrl(text);
    if (exact) return exact;

    // DownloadURL commonly looks like:
    // image/png:filename.png:https://.../Attachment/GetAttachment/<id>
    // HTML/background-image/custom payloads may contain the same URL inside
    // markup or CSS. Scan every https/protocol-relative URL rather than
    // assuming an <img src> shape.
    const matches = text.match(/(?:https:)?\/\/[^\s"'<>()[\]{}]+/gi) || [];
    for (const candidate of matches) {
      const normalized = normalizeAttachmentUrl(candidate.replace(/[),.;]+$/g, ''));
      if (normalized) return normalized;
    }
    return '';
  }

  function fileAttachment(file) {
    if (!file) return '';
    const name = String(file.name || '').trim();
    const direct = attachmentUrlFromText(name);
    if (direct) return direct;
    const match = /([A-Za-z0-9_-]{8,180})\.(?:png|jpe?g|webp|gif)$/i.exec(name);
    if (!match) return '';
    // Only accept hash/id-looking names to avoid converting arbitrary product
    // filenames into fake CoreNectum URLs.
    if (!/\d/.test(match[1]) && !/[a-f]/i.test(match[1])) return '';
    return ATTACHMENT_BASE + match[1];
  }

  function transferTypeList(dataTransfer) {
    try { return Array.from(dataTransfer && dataTransfer.types || []).map(String); }
    catch (_) { return []; }
  }

  function transferFiles(dataTransfer) {
    try { return Array.from(dataTransfer && dataTransfer.files || []); }
    catch (_) { return []; }
  }

  // Chrome/CoreNectum image drags carry BOTH Files and browser URL/HTML
  // formats. Explorer Excel drags carry Files only. This distinction is the
  // routing contract between the Collection PLM importer and Buyer Log's
  // legacy global Excel dropzone.
  function isCandidateTransfer(dataTransfer) {
    const types = transferTypeList(dataTransfer).map(type => String(type).toLowerCase());
    if (!types.includes('files')) return false;
    const browserTypes = new Set([
      'text/uri-list',
      'text/html',
      'downloadurl',
      'chromium/x-drag-id',
      'text/x-moz-url',
      'application/x-moz-file-promise-url',
    ]);
    if (types.some(type => browserTypes.has(type))) return true;
    try {
      const items = Array.from(dataTransfer && dataTransfer.items || []);
      const imageFile = items.some(item => item && item.kind === 'file' && /^image\//i.test(String(item.type || '')));
      return imageFile && types.some(type => type !== 'files');
    } catch (_) { return false; }
  }

  function imageFileFromTransfer(dataTransfer) {
    return transferFiles(dataTransfer).find(file => /^image\//i.test(String(file && file.type || ''))) || null;
  }

  function syncTransferStrings(dataTransfer) {
    if (!dataTransfer) return [];
    const out = [];
    const seen = new Set();
    const push = value => {
      const text = String(value == null ? '' : value);
      if (!text || seen.has(text)) return;
      seen.add(text);
      out.push(text);
    };
    const types = [...KNOWN_TEXT_TYPES, ...transferTypeList(dataTransfer)]
      .filter((type, index, list) => type && String(type).toLowerCase() !== 'files' && list.indexOf(type) === index);
    for (const type of types) {
      try { push(dataTransfer.getData(type)); } catch (_) {}
    }
    return out;
  }

  function readTransferItemString(item) {
    return new Promise(resolve => {
      if (!item || item.kind !== 'string' || typeof item.getAsString !== 'function') return resolve('');
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        resolve(String(value == null ? '' : value));
      };
      try {
        item.getAsString(finish);
        setTimeout(() => finish(''), 800);
      } catch (_) { finish(''); }
    });
  }

  async function asyncTransferStrings(dataTransfer) {
    const out = syncTransferStrings(dataTransfer);
    const seen = new Set(out);
    let items = [];
    try { items = Array.from(dataTransfer && dataTransfer.items || []); } catch (_) {}
    for (const item of items) {
      if (!item || item.kind !== 'string') continue;
      const value = await readTransferItemString(item);
      if (value && !seen.has(value)) { seen.add(value); out.push(value); }
    }
    return out;
  }

  function payloadFromStrings(strings, imageFile) {
    for (const text of strings || []) {
      const attachmentUrl = attachmentUrlFromText(text);
      if (attachmentUrl) return { attachmentUrl, file:imageFile || null };
    }
    const fromFile = fileAttachment(imageFile);
    return fromFile ? { attachmentUrl:fromFile, file:imageFile || null } : null;
  }

  function extractDropPayload(dataTransfer) {
    if (!dataTransfer) return null;
    return payloadFromStrings(syncTransferStrings(dataTransfer), imageFileFromTransfer(dataTransfer));
  }

  async function extractDropPayloadAsync(dataTransfer) {
    if (!dataTransfer) return null;
    return payloadFromStrings(await asyncTransferStrings(dataTransfer), imageFileFromTransfer(dataTransfer));
  }

  function diagnosticsForTransfer(dataTransfer) {
    const file = imageFileFromTransfer(dataTransfer);
    return {
      types:transferTypeList(dataTransfer),
      fileName:file && file.name || '',
      fileType:file && file.type || '',
    };
  }

  function injectStyle() {
    if (document.getElementById('blKolPlmDragStyle')) return;
    const style = document.createElement('style');
    style.id = 'blKolPlmDragStyle';
    style.textContent = [
      '#view-koleksiyon.blPlmDragOver{position:relative;outline:2px dashed var(--acc);outline-offset:-4px;}',
      '#view-koleksiyon.blPlmDragOver::after{content:"PLM modelini bırak → Koleksiyona ekle";position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:9998;padding:14px 20px;border-radius:12px;background:var(--card);border:1px solid var(--acc);box-shadow:0 12px 40px rgba(0,0,0,.22);font-weight:650;color:var(--ink);pointer-events:none;}',
      '#view-koleksiyon.blPlmDragBusy::after{content:"PLM modeli Koleksiyona ekleniyor…";}',
    ].join('');
    document.head.appendChild(style);
  }

  function samePlmId(value, expected) {
    try { return kolPlmNormalizeId(value) === kolPlmNormalizeId(expected); }
    catch (_) { return String(value || '').trim() === String(expected || '').trim(); }
  }

  function existingRowsFor(plmId) {
    return (Array.isArray(kolRows) ? kolRows : []).filter(row => samePlmId(row && row.plmId, plmId));
  }

  async function fallbackDraggedImage(created, file) {
    if (!file || !created.length) return false;
    try {
      const dataUrl = await kolReadFileAsDataUrl(file);
      await kolPersistImageData(created[0], dataUrl, file.name || ('plm-' + created[0].plmId + '.png'));
      return true;
    } catch (error) {
      console.warn('PLM drag image fallback failed:', error);
      return false;
    }
  }

  async function ensurePlmReady() {
    if (typeof ensureCoreNectumApiConnection !== 'function') return true;
    try { return await ensureCoreNectumApiConnection({ requireStyleListTemplate:true }); }
    catch (error) {
      console.warn('PLM drag CoreNectum preflight failed:', error);
      return false;
    }
  }

  async function importPayload(payload, root) {
    if (!payload || !payload.attachmentUrl) return { ok: false, reason: 'invalid-drop' };
    if (!kolRequireWorkspaceEdit()) return { ok: false, reason: 'view-only' };
    if (root) root.classList.add('blPlmDragBusy');

    try {
      showToast(appLang === 'en' ? 'Identifying the PLM model…' : 'PLM modeli tanımlanıyor…', { icon: false });

      if (!await ensurePlmReady()) {
        showToast(appLang === 'en'
          ? 'PLM connection is not ready. Sign in to CoreNectum and try the drag again.'
          : 'PLM bağlantısı hazır değil. CoreNectum oturumunu açıp görseli tekrar bırakın.', { icon:false, duration:9000 });
        return { ok:false, reason:'plm-not-ready' };
      }

      const resolved = await plmJsonRequest('/api/corenectum-api/resolve-attachment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attachmentUrl: payload.attachmentUrl, language: appLang === 'en' ? 'en' : 'tr' }),
      });
      const plmId = String(resolved && resolved.plmId || '').trim();
      if (!plmId) throw new Error(appLang === 'en' ? 'PLM ID could not be resolved.' : 'PLM ID çözümlenemedi.');

      if (existingRowsFor(plmId).length) {
        showToast(appLang === 'en'
          ? `PLM ${plmId} is already in Collection. Drag & drop never changes an existing model.`
          : `PLM ${plmId} zaten Koleksiyon’da. Sürükle-bırak mevcut modeli değiştirmez.`, { icon: false, duration: 8000 });
        return { ok: false, reason: 'duplicate', plmId };
      }

      const fetchResult = await plmJsonRequest('/api/plm-sync/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plmIds: [plmId], language: appLang === 'en' ? 'en' : 'tr' }),
      });
      if (fetchResult.styleLinks) applyPlmStyleLinksPayload(fetchResult.styleLinks);
      const records = Array.isArray(fetchResult.records) ? fetchResult.records : [];
      if (!records.length) throw new Error(appLang === 'en' ? 'The PLM model could not be read.' : 'PLM model kaydı okunamadı.');

      const translated = await kolPlmNormalizeAndTranslate(records);
      if (translated.cancelled) return { ok: false, reason: 'translation-cancelled', plmId };

      // Race guard: another sync/user may have added the same PLM while the
      // remote lookup was running. A drag must never become an update.
      if (existingRowsFor(plmId).length) {
        showToast(appLang === 'en'
          ? `PLM ${plmId} was added while the lookup was running; no duplicate was created.`
          : `PLM ${plmId} sorgu sırasında Koleksiyona eklendi; ikinci kayıt oluşturulmadı.`, { icon: false });
        return { ok: false, reason: 'duplicate-race', plmId };
      }

      const plan = kolBuildPlmImportPlan(translated.rows);
      if (plan.existing.length || plan.ambiguous.length) {
        showToast(appLang === 'en'
          ? `PLM ${plmId} matches an existing Collection model. Nothing was changed.`
          : `PLM ${plmId} mevcut bir Koleksiyon modeliyle eşleşiyor. Hiçbir kayıt değiştirilmedi.`, { icon: false });
        return { ok: false, reason: 'existing-match', plmId };
      }

      kolPushUndo();
      let created = plan.creates.map(row => {
        row.id = kolNextId++;
        row.img = '';
        row.imgRef = '';
        delete row._plmImportRow;
        const next = kolApplyNewModelDefaults(migrateKolRow(row));
        kolApplyRulePricing(next);
        return next;
      });
      created = kolLinkImportedColourVariants(created);
      if (!created.length) throw new Error(appLang === 'en' ? 'No new Collection row was produced.' : 'Yeni Koleksiyon satırı üretilemedi.');

      kolRows = [...created, ...kolRows];
      kolSelected = new Set(created.map(row => row.id));
      saveKolRows();
      renderKol();

      // "Olduğu gibi taşı" dahil tüm seçimler kaydedilir; bir sonraki eklemede işaretli gelir.
      const teachable = translated.translationInfo && translated.translationInfo.reviewedMappings || [];
      if (teachable.length) {
        try { await kolPlmSaveApprovedTranslations(teachable); }
        catch (error) { console.warn('PLM drag translation save failed:', error); }
      }

      let images = null;
      try { images = await updateModelImages({ source: MODEL_ASSET_SOURCE_PLM, mode: 'selected', button: null }); }
      catch (error) { console.warn('PLM drag image sync failed:', error); }
      let fallbackSaved = false;
      if (!images || images.ok === false) fallbackSaved = await fallbackDraggedImage(created, payload.file);

      saveKolRows();
      renderKol();
      showToast(appLang === 'en'
        ? `${created.length} Collection row(s) created from PLM ${plmId}.`
        : `PLM ${plmId} Koleksiyona eklendi · ${created.length} satır oluşturuldu.`, { icon: false, duration: 7000 });
      return { ok: true, plmId, created: created.length, fallbackSaved };
    } catch (error) {
      showToast((appLang === 'en' ? 'PLM model could not be added: ' : 'PLM modeli Koleksiyona eklenemedi: ') + (error && error.message || String(error)), { icon: false, duration: 10000 });
      return { ok: false, reason: 'failed', error };
    } finally {
      if (root) root.classList.remove('blPlmDragBusy');
    }
  }

  function install() {
    const root = document.getElementById('view-koleksiyon');
    if (!root || root.dataset.plmDragImportBound === '1') return false;
    root.dataset.plmDragImportBound = '1';
    injectStyle();
    let depth = 0;

    const active = event => document.body.dataset.activeTab === 'koleksiyon'
      && isCandidateTransfer(event && event.dataTransfer);

    const suppressLegacyDropzone = () => {
      const legacy = document.getElementById('dropzone');
      if (legacy) legacy.classList.remove('show');
    };

    const enter = event => {
      if (!active(event)) return;
      depth += 1;
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressLegacyDropzone();
      root.classList.add('blPlmDragOver');
    };
    const over = event => {
      if (!active(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressLegacyDropzone();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      root.classList.add('blPlmDragOver');
    };
    const leave = event => {
      if (!active(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      depth = Math.max(0, depth - 1);
      if (!depth) root.classList.remove('blPlmDragOver');
    };
    const drop = event => {
      if (!active(event)) return;
      depth = 0;
      root.classList.remove('blPlmDragOver');
      suppressLegacyDropzone();

      // Capture phase is deliberate: Collection grid/editor code and the
      // global Excel dropzone must never steal a CoreNectum image drop.
      event.preventDefault();
      event.stopImmediatePropagation();
      const transfer = event.dataTransfer;
      void (async () => {
        const payload = await extractDropPayloadAsync(transfer);
        if (!payload) {
          const diag = diagnosticsForTransfer(transfer);
          console.warn('[PLM_DRAG_UNRESOLVED_PAYLOAD]', diag);
          const looksRelevant = Boolean(diag.fileName) || diag.types.some(type => /uri|html|url|image|file/i.test(type));
          if (looksRelevant) {
            showToast(appLang === 'en'
              ? 'The dropped item did not expose its CoreNectum image link. Drag the model image itself from Style List and try again.'
              : 'Bırakılan öğede CoreNectum görsel bağlantısı okunamadı. Style List’te model görselinin kendisini sürükleyip tekrar bırakın.', { icon:false, duration:9000 });
          }
          return;
        }
        await importPayload(payload, root);
      })();
    };

    document.addEventListener('dragenter', enter, true);
    document.addEventListener('dragover', over, true);
    document.addEventListener('dragleave', leave, true);
    document.addEventListener('drop', drop, true);
    return true;
  }

  const api = {
    normalizeAttachmentUrl,
    attachmentUrlFromText,
    fileAttachment,
    syncTransferStrings,
    asyncTransferStrings,
    extractDropPayload,
    extractDropPayloadAsync,
    diagnosticsForTransfer,
    isCandidateTransfer,
    install,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.BLCollectionPlmDragImport = api;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
    else install();
  }
})(typeof window !== 'undefined' ? window : globalThis);
