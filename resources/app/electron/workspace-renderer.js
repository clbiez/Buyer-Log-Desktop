'use strict';

const bridge = window.buyerLogWorkspace;
const strip = document.getElementById('tabStrip');
const newTabButton = document.getElementById('newTabButton');
const dropHint = document.getElementById('dropHint');
let state = null;
let draggedTabId = '';
let draggedSourceWindowId = 0;
let dropAccepted = false;

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
}

function tabInsertIndex(clientX) {
  const tabs = [...strip.querySelectorAll('.workspaceTab:not(.isDragging)')];
  const index = tabs.findIndex(tab => clientX < tab.getBoundingClientRect().left + tab.getBoundingClientRect().width / 2);
  return index < 0 ? tabs.length : index;
}

function render(next) {
  if (!next) return;
  state = next;
  strip.innerHTML = state.tabs.map(tab => {
    const selected = tab.id === state.activeTabId;
    return `<div class="workspaceTab${selected?' isActive':''}" draggable="true" data-tab-id="${escapeHtml(tab.id)}">
      <button class="tabActivate" type="button" role="tab" tabindex="${selected?'0':'-1'}" aria-selected="${selected}" title="${escapeHtml(tab.title)}">
        ${tab.loading?'<span class="tabSpinner" aria-hidden="true"></span>':''}
        <span class="tabTitle">${escapeHtml(tab.title)}</span>
      </button>
      <span class="tabActions">
        <button class="tabIconButton detachButton" type="button" data-detach aria-label="Sekmeyi yeni pencereye ayır" title="Yeni pencereye ayır"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 3.5h6v6M12.5 3.5l-7 7M10 8.5v4H3.5V6h4"/></svg></button>
        <button class="tabIconButton closeButton" type="button" data-close aria-label="Sekmeyi kapat" title="Sekmeyi kapat">×</button>
      </span>
    </div>`;
  }).join('');
  strip.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest',inline:'nearest'});
}

strip.addEventListener('click', event => {
  const tab = event.target.closest('.workspaceTab');
  if (!tab) return;
  if (event.target.closest('[data-close]')) bridge.closeTab(tab.dataset.tabId);
  else if (event.target.closest('[data-detach]')) bridge.detachTab(tab.dataset.tabId, state.windowId, { x:window.screenX + 180, y:window.screenY + 28 });
  else bridge.activateTab(tab.dataset.tabId);
});

strip.addEventListener('keydown', event => {
  const activator = event.target.closest('.tabActivate');
  const tab = activator?.closest('.workspaceTab');
  if (!tab || !state) return;
  const index = state.tabs.findIndex(item => item.id === tab.dataset.tabId);
  if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !event.altKey) {
    event.preventDefault();
    const next = event.key === 'ArrowLeft' ? Math.max(0,index-1) : Math.min(state.tabs.length-1,index+1);
    bridge.activateTab(state.tabs[next].id);
    return;
  }
  if (event.altKey && event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
    event.preventDefault();
    bridge.moveTab(tab.dataset.tabId, event.key === 'ArrowLeft' ? index-1 : index+2);
    return;
  }
  if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'm') {
    event.preventDefault();
    bridge.detachTab(tab.dataset.tabId, state.windowId, { x:window.screenX + 180, y:window.screenY + 28 });
  }
});

strip.addEventListener('dragstart', event => {
  const tab = event.target.closest('.workspaceTab');
  if (!tab || !state) return;
  draggedTabId = tab.dataset.tabId;
  draggedSourceWindowId = state.windowId;
  dropAccepted = false;
  tab.classList.add('isDragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('application/x-buyerlog-tab', draggedTabId);
  event.dataTransfer.setData('text/plain', draggedTabId);
});

strip.addEventListener('dragend', event => {
  event.target.closest('.workspaceTab')?.classList.remove('isDragging');
  const tabId = draggedTabId;
  const sourceWindowId = draggedSourceWindowId;
  const accepted = dropAccepted;
  draggedTabId = '';
  draggedSourceWindowId = 0;
  dropAccepted = false;
  dropHint.hidden = true;
  if (!accepted && tabId) bridge.detachTab(tabId, sourceWindowId, { x:event.screenX, y:event.screenY });
});

document.addEventListener('dragenter', event => {
  if (!state) return;
  const tabId = event.dataTransfer && (event.dataTransfer.getData('application/x-buyerlog-tab') || event.dataTransfer.getData('text/plain'));
  if (tabId || draggedTabId) dropHint.hidden = false;
});
document.addEventListener('dragover', event => {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
});
document.addEventListener('dragleave', event => {
  if (!event.relatedTarget) dropHint.hidden = true;
});
document.addEventListener('drop', event => {
  event.preventDefault();
  dropHint.hidden = true;
  const tabId = event.dataTransfer && (event.dataTransfer.getData('application/x-buyerlog-tab') || event.dataTransfer.getData('text/plain'));
  if (!tabId) return;
  dropAccepted = true;
  bridge.receiveTab(tabId, tabInsertIndex(event.clientX));
});

newTabButton.addEventListener('click', () => bridge.showModuleMenu());

bridge.onState(render);
void bridge.snapshot().then(render);
