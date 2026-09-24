'use strict';

(function backlogSettingsModal(global) {
  function el(id) { return document.getElementById(id); }
  function lang() { return (typeof global.appLang !== 'undefined' ? global.appLang : document.documentElement.lang) === 'en'; }
  function t(tr, en) { return lang() ? en : tr; }

  function remember(node) {
    if (!node || !node.parentNode) return null;
    return { node, parent: node.parentNode, next: node.nextSibling };
  }

  function restore(place) {
    if (!place || !place.node || !place.parent) return;
    if (place.next && place.next.parentNode === place.parent) place.parent.insertBefore(place.node, place.next);
    else place.parent.appendChild(place.node);
  }

  function moveInto(node, target, places) {
    const place = remember(node);
    if (!place || !target) return false;
    places.push(place);
    target.appendChild(node);
    return true;
  }

  function rangeCard(title, fromId, toId, places) {
    const card = document.createElement('div');
    card.className = 'backlogSettingsRangeCard';
    const heading = document.createElement('span');
    heading.className = 'backlogSettingsRangeTitle';
    heading.textContent = title;
    const row = document.createElement('div');
    row.className = 'backlogSettingsRange';
    const from = el(fromId);
    const to = el(toId);
    if (from) moveInto(from, row, places);
    const sep = document.createElement('span');
    sep.className = 'backlogSettingsRangeSep';
    sep.textContent = '—';
    row.appendChild(sep);
    if (to) moveInto(to, row, places);
    card.append(heading, row);
    return card;
  }

  function settingsSection(title, bodyNode, places, options = {}) {
    const section = document.createElement('div');
    section.className = 'oabSettingsSection';
    const head = document.createElement('div');
    head.className = 'oabSettingsSectionHead';
    const label = document.createElement('span');
    label.textContent = title;
    head.appendChild(label);
    if (options.addField) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'navActionBtn';
      add.id = 'backlogSettingsAddFieldBtn';
      add.textContent = '+ ' + t('Alan ekle', 'Add field');
      add.addEventListener('click', () => {
        const legacy = document.querySelector('[data-backlog-dim-add]');
        if (legacy && typeof legacy.click === 'function') legacy.click();
      });
      head.appendChild(add);
    }
    const list = document.createElement('div');
    list.className = 'oabPivotConfigList backlogSettingsConfigList';
    if (bodyNode) moveInto(bodyNode, list, places);
    section.append(head, list);
    return section;
  }

  function openSettings() {
    el('_backlogSettingsModal')?.remove();

    const required = ['backlogFrom', 'backlogTo', 'backlogInStoreFrom', 'backlogInStoreTo',
      'backlogAntrepoFrom', 'backlogAntrepoTo', 'backlogDimPicker', 'backlogDimOrder'];
    if (required.some(id => !el(id))) return;

    const places = [];
    const modal = document.createElement('div');
    modal.id = '_backlogSettingsModal';
    modal.className = 'autoModalOverlay';

    const card = document.createElement('div');
    card.className = 'autoModal oabSettingsModal backlogSettingsModal';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'backlogSettingsTitle');

    const header = document.createElement('header');
    const title = document.createElement('h3');
    title.id = 'backlogSettingsTitle';
    title.textContent = t('Backlog Ayarları', 'Backlog Settings');
    const x = document.createElement('button');
    x.type = 'button';
    x.setAttribute('aria-label', t('Kapat', 'Close'));
    x.textContent = '×';
    header.append(title, x);

    const body = document.createElement('div');
    body.className = 'autoModalBody';

    const meta = document.createElement('div');
    meta.className = 'backlogSettingsMeta';
    const rangeLabel = el('backlogRangeLabel');
    if (rangeLabel) moveInto(rangeLabel, meta, places);
    body.appendChild(meta);

    const pre = document.createElement('div');
    pre.className = 'oabSettingsSection';
    const preHead = document.createElement('div');
    preHead.className = 'oabSettingsSectionHead';
    const preTitle = document.createElement('span');
    preTitle.textContent = t('Ön Filtreler', 'Pre-filters');
    preHead.appendChild(preTitle);
    const preGrid = document.createElement('div');
    preGrid.className = 'backlogSettingsPrefilters';
    preGrid.append(
      rangeCard(t('Retail Tarihi', 'Retail Date'), 'backlogFrom', 'backlogTo', places),
      rangeCard('In Store', 'backlogInStoreFrom', 'backlogInStoreTo', places),
      rangeCard(t('Antrepo Giriş Tarihi', 'Warehouse Entry Date'), 'backlogAntrepoFrom', 'backlogAntrepoTo', places)
    );
    pre.append(preHead, preGrid);
    body.appendChild(pre);

    body.appendChild(settingsSection(t('Pivot Satırları', 'Pivot Rows'), el('backlogDimPicker'), places, { addField: true }));
    body.appendChild(settingsSection(t('Hiyerarşi Sırası', 'Hierarchy Order'), el('backlogDimOrder'), places));

    const dateWrap = el('backlogDateLevelWrap');
    if (dateWrap) body.appendChild(settingsSection(t('Antrepo Giriş Tarihi Görünümü', 'Warehouse Entry Date View'), dateWrap, places));

    const hint = document.createElement('p');
    hint.className = 'oabSettingsHint';
    hint.textContent = t(
      'Ön filtreler rapor kapsamını belirler. Pivot Satırları alanlarının sırası gruplama hiyerarşisini oluşturur; alan bazlı filtreler aynı satırlardaki filtre düğmelerinden yönetilir.',
      'Pre-filters define the report scope. The order of Pivot Rows defines the grouping hierarchy; field filters are managed from the filter controls on each row.'
    );
    body.appendChild(hint);

    const footer = document.createElement('footer');
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'tbtn';
    closeBtn.textContent = t('Kapat', 'Close');
    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'tbtn primary';
    applyBtn.textContent = t('Uygula', 'Apply');
    footer.append(closeBtn, applyBtn);

    card.append(header, body, footer);
    modal.appendChild(card);
    document.body.appendChild(modal);

    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      for (let i = places.length - 1; i >= 0; i -= 1) restore(places[i]);
      modal.remove();
    }

    x.addEventListener('click', close);
    closeBtn.addEventListener('click', close);
    applyBtn.addEventListener('click', () => {
      el('backlogApplyBtn')?.click();
      close();
    });

    let pressedOnBackdrop = false;
    modal.addEventListener('pointerdown', event => { pressedOnBackdrop = event.target === modal; });
    modal.addEventListener('pointerup', event => {
      if (pressedOnBackdrop && event.target === modal) close();
      pressedOnBackdrop = false;
    });
    modal.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
    });
  }

  function init() {
    el('backlogSettingsBtn')?.addEventListener('click', openSettings);
  }

  global.BLBacklogSettings = { open: openSettings };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})(typeof window !== 'undefined' ? window : globalThis);
