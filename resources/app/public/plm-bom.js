/* Buyer Log — PLM BOM / Baskı Detayı
 *
 * PLM Sync sırasında sunucunun kaydettiği normalize BOM analizini model adına
 * sağ tık menüsünden gösterir. Bu istemci CoreNectum'a doğrudan bağlanmaz;
 * token/çerez görmez ve LCW AI çağrısı yapmaz.
 */
(function () {
  'use strict';
  if (window.BLPlmBom) return;

  const isEn = () => typeof appLang !== 'undefined' && appLang === 'en';
  const L = (tr, en) => (isEn() ? en : tr);
  const esc = value => (typeof escapeHtml === 'function' ? escapeHtml(String(value == null ? '' : value))
    : String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])));
  function numericId(value) {
    let text = String(value == null ? '' : value).trim().replace(/^_+/, '');
    if (/^\d+\.0+$/.test(text)) text = text.slice(0, text.indexOf('.'));
    text = text.replace(/^0+(?=\d)/, '');
    return /^\d+$/.test(text) && Number(text) > 0 ? text : '';
  }
  function plmIdOfRow(row, moduleId) {
    if (!row) return '';
    const canonical = window.BLCanonicalFields;
    let value = '';
    try { value = canonical && canonical.normalizedValue ? canonical.normalizedValue(row, moduleId || 'collection', 'plmId') : ''; } catch (_) { value = ''; }
    return numericId(value || row['PLM ID'] || row.plmId || row._plmId);
  }
  function dateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(isEn() ? 'en-GB' : 'tr-TR');
  }
  async function entryForPlm(plmId) {
    const id = numericId(plmId);
    if (!id) return null;
    const response = await fetch('/api/plm-sync/bom/' + encodeURIComponent(id), { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 404) return null;
    if (!response.ok || !payload.ok) throw new Error(payload.error || L('BOM bilgisi okunamadı.', 'BOM data could not be read.'));
    return payload.entry || null;
  }
  function aiText(ai) {
    const status = ai && ai.status || 'not-needed';
    if (status === 'resolved') return L('LCW AI belirsiz yerleşimi çözdü', 'LCW AI resolved the ambiguous placement');
    if (status === 'partial') return L('LCW AI kısmen çözümledi · kontrol gerekli', 'LCW AI partially resolved it · review required');
    if (status === 'failed') return L('LCW AI kullanılamadı · kural sonucu korundu', 'LCW AI unavailable · rule result preserved');
    if (status === 'deferred') return L('LCW AI analizi bu senkron için ertelendi', 'LCW AI analysis deferred for this sync');
    return L('BOM net · LCW AI gerekmedi', 'BOM clear · LCW AI not needed');
  }
  function toneForAi(ai) {
    const status = ai && ai.status || 'not-needed';
    return status === 'resolved' || status === 'not-needed' ? 'ok' : status === 'failed' ? 'bad' : 'wait';
  }

  function openForPlm(plmId, title) {
    const id = numericId(plmId);
    const modal = document.createElement('div');
    modal.className = 'cpaModalOverlay';
    const close = () => modal.remove();
    modal.innerHTML = `<div class="cpaModal"><header>
      <div><b>${esc(L('PLM BOM · Baskı Detayı', 'PLM BOM · Print Details'))}</b><small>${esc([id && 'PLM ' + id, title].filter(Boolean).join(' · '))}</small></div>
      <button type="button" data-bom-close aria-label="${esc(L('Kapat', 'Close'))}">×</button></header>
      <div class="cpaModalBody"><p class="cpaEmpty">${esc(L('BOM bilgisi yükleniyor…', 'Loading BOM data…'))}</p></div>
      <footer><button type="button" class="cpaBtn ghost" data-bom-close>${esc(L('Kapat', 'Close'))}</button></footer></div>`;
    modal.querySelectorAll('[data-bom-close]').forEach(el => { el.onclick = close; });
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    modal.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
    document.body.appendChild(modal);

    const body = modal.querySelector('.cpaModalBody');
    (async () => {
      if (!id) {
        body.innerHTML = `<p class="cpaEmpty">${esc(L('Bu satırda PLM ID yok.', 'This row has no PLM ID.'))}</p>`;
        return;
      }
      try {
        const entry = await entryForPlm(id);
        if (!modal.isConnected) return;
        if (!entry) {
          body.innerHTML = `<p class="cpaEmpty">${esc(L('Bu model için henüz BOM kaydı yok. PLM SYNC çalıştırıldığında BOM da otomatik okunur.', 'No BOM record exists for this style yet. BOM is read automatically during PLM SYNC.'))}</p>`;
          return;
        }
        const placements = Array.isArray(entry.placements) ? entry.placements : [];
        const rows = placements.map(item => `<tr>
          <td>${esc(isEn() ? (item.placementEn || item.placement) : (item.placementTr || item.placement))}${item.aiResolved ? ` <span class="cpaPlm tone-ok">AI</span>` : ''}</td>
          <td>${esc(item.printType || item.categoryName || 'Print')}</td>
          <td>${esc(item.componentCode || '—')}</td>
          <td>${esc(item.description || '—')}</td>
          <td>${esc(item.count || 1)}</td>
          <td>${item.quantity == null ? '—' : esc(item.quantity)}</td>
          <td>${esc(item.graphicApprovalStatusName || '—')}</td>
        </tr>`).join('');
        const ai = entry.ai || {};
        const summary = entry.hasPrint ? entry.summary : L('Baskı yok', 'No print');
        body.innerHTML = `
          <div class="cpaChips">
            <div class="cpaChip is-static"><span class="l">${esc(L('Baskı', 'Print'))}</span><b>${esc(summary)}</b></div>
            <div class="cpaChip is-static"><span class="l">${esc(L('Kaynak', 'Source'))}</span><span class="q">CoreNectum BOM · ${esc(dateTime(entry.fetchedAt))}</span></div>
            <div class="cpaChip is-static"><span class="l">AI</span><span class="cpaPlm tone-${toneForAi(ai)}">${esc(aiText(ai))}</span>${ai.model ? `<span class="q">${esc(ai.model)}${ai.confidence ? ' · ' + esc(ai.confidence) : ''}</span>` : ''}</div>
          </div>
          ${rows ? `<div class="cpaScroll"><table class="cpaTable"><thead><tr>
            <th>${esc(L('Yerleşim', 'Placement'))}</th><th>${esc(L('Teknik', 'Technique'))}</th><th>Component</th>
            <th>${esc(L('PLM Açıklaması', 'PLM Description'))}</th><th>${esc(L('Baskı Adedi', 'Print Count'))}</th>
            <th>${esc(L('BOM Miktarı', 'BOM Quantity'))}</th><th>${esc(L('Grafik Onayı', 'Graphic Approval'))}</th>
          </tr></thead><tbody>${rows}</tbody></table></div>`
            : `<p class="cpaEmpty">${esc(L('BOM içinde Print kategorisinde bileşen yok.', 'No component is classified as Print in the BOM.'))}</p>`}
          ${entry.needsAi ? `<p class="cpaEmpty">${esc(L('Bazı baskı yerleşimleri hâlâ belirsiz. Manuel kontrol önerilir.', 'Some print placements remain ambiguous. Manual review is recommended.'))}</p>` : ''}
          ${ai.error ? `<p class="cpaEmpty">${esc(ai.error)}</p>` : ''}
        `;
      } catch (error) {
        if (modal.isConnected) body.innerHTML = `<p class="cpaEmpty">${esc(L('BOM bilgisi okunamadı: ', 'BOM data could not be read: ') + String(error && error.message || error))}</p>`;
      }
    })();
  }

  function openForRow(row, moduleId) {
    const title = String((row && (row['Model Name'] || row.modelName || row.model || row.modelKod)) || '').trim();
    openForPlm(plmIdOfRow(row, moduleId), title);
  }

  window.BLPlmBom = { numericId, plmIdOfRow, entryForPlm, openForPlm, openForRow };
})();
