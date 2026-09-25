'use strict';

/*
 * Collection-only PLM drag import.
 *
 * A CoreNectum Style List image is an ADD command, never an edit command:
 *   PLM image drag -> resolve attachment -> fetch canonical PLM record ->
 *   create new Collection model -> sync its canonical PLM image.
 * Existing PLM IDs are rejected without changing the Collection row.
 */
(function initCollectionPlmDrag(global) {
  const ATTACHMENT_PATH = /\/lcw\/live\/corenectum\/service\/api\/Attachment\/GetAttachment\/([a-f0-9]{16,80})(?:[/?#]|$)/i;
  const ATTACHMENT_BASE = 'https://mym-api.lcwaikiki.com/lcw/live/corenectum/service/api/Attachment/GetAttachment/';

  function normalizeAttachmentUrl(value) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return '';
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:' || !/(^|\.)lcwaikiki\.com$/i.test(url.hostname)) return '';
      const match = ATTACHMENT_PATH.exec(url.pathname);
      if (!match) return '';
      return url.origin + url.pathname.replace(/\/+$/, '');
    } catch (_) { return ''; }
  }

  function urlFromHtml(value) {
    const html = String(value == null ? '' : value);
    const match = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i.exec(html);
    return match ? normalizeAttachmentUrl(match[1].replace(/&amp;/g, '&')) : '';
  }

  function fileAttachment(file) {
    if (!file) return '';
    const match = /^([a-f0-9]{16,80})\.(?:png|jpe?g|webp|gif)$/i.exec(String(file.name || '').trim());
    return match ? ATTACHMENT_BASE + match[1] : '';
  }

  function extractDropPayload(dataTransfer) {
    if (!dataTransfer) return null;
    const get = type => { try { return String(dataTransfer.getData(type) || ''); } catch (_) { return ''; } };
    const candidates = [
      ...get('text/uri-list').split(/\r?\n/).filter(line => line && !line.startsWith('#')),
      get('text/plain'),
      urlFromHtml(get('text/html')),
    ];
    let attachmentUrl = '';
    for (const candidate of candidates) {
      attachmentUrl = normalizeAttachmentUrl(candidate);
      if (attachmentUrl) break;
    }
    const files = Array.from(dataTransfer.files || []);
    const imageFile = files.find(file => /^image\//i.test(String(file.type || ''))) || null;
    if (!attachmentUrl) attachmentUrl = fileAttachment(imageFile);
    if (!attachmentUrl) return null;
    return { attachmentUrl, file: imageFile };
  }

  function injectStyle() {
    if (document.getElementById('blKolPlmDragStyle')) return;
    const style = document.createElement('style');
    style.id = 'blKolPlmDragStyle';
    style.textContent = [
      '#view-koleksiyon.blPlmDragOver{position:relative;outline:2px dashed var(--acc);outline-offset:-4px;}',
      '#view-koleksiyon.blPlmDragOver::after{content:"PLM modelini bırak → Koleksiyona ekle";position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:9998;padding:14px 20px;border-radius:12px;background:var(--panel);border:1px solid var(--acc);box-shadow:0 12px 40px rgba(0,0,0,.22);font-weight:650;color:var(--ink);pointer-events:none;}',
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

  async function importPayload(payload, root) {
    if (!payload || !payload.attachmentUrl) return { ok: false, reason: 'invalid-drop' };
    if (!kolRequireWorkspaceEdit()) return { ok: false, reason: 'view-only' };
    if (root) root.classList.add('blPlmDragBusy');

    try {
      showToast(appLang === 'en' ? 'Identifying the PLM model…' : 'PLM modeli tanımlanıyor…', { icon: false });

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

      const teachable = (translated.translationInfo && translated.translationInfo.reviewedMappings || []).filter(item => !item.keepAsIs);
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

    root.addEventListener('dragenter', event => {
      if (document.body.dataset.activeTab !== 'koleksiyon') return;
      depth += 1;
      event.preventDefault();
      root.classList.add('blPlmDragOver');
    });
    root.addEventListener('dragover', event => {
      if (document.body.dataset.activeTab !== 'koleksiyon') return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      root.classList.add('blPlmDragOver');
    });
    root.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (!depth) root.classList.remove('blPlmDragOver');
    });
    root.addEventListener('drop', event => {
      if (document.body.dataset.activeTab !== 'koleksiyon') return;
      depth = 0;
      root.classList.remove('blPlmDragOver');
      const payload = extractDropPayload(event.dataTransfer);
      if (!payload) return;
      event.preventDefault();
      event.stopPropagation();
      void importPayload(payload, root);
    });
    return true;
  }

  const api = { normalizeAttachmentUrl, urlFromHtml, fileAttachment, extractDropPayload, install };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.BLCollectionPlmDragImport = api;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
    else install();
  }
})(typeof window !== 'undefined' ? window : globalThis);
