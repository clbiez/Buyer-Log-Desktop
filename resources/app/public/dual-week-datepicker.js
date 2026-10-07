/* Buyer Log dual week date picker.
 * Replaces Chromium's opaque week context with a Buyer Log picker that keeps
 * Gregorian dates but shows LCW Merch Week and GLB/ISO Week side by side.
 */
(() => {
  'use strict';
  const DAY_MS = 86400000;
  let host = null;
  let input = null;
  let cursor = null;

  const en = () => typeof window.appLang !== 'undefined' && window.appLang === 'en';
  const T = (tr, english) => en() ? english : tr;
  const pad = value => String(value).padStart(2, '0');
  const iso = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const localDate = value => {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const add = (date, days) => {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + days);
    return copy;
  };
  const monday = date => {
    const copy = new Date(date);
    copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7));
    copy.setHours(0, 0, 0, 0);
    return copy;
  };
  const sameDay = (a, b) => Boolean(a && b) && iso(a) === iso(b);
  const isVisibleDateInput = target => target instanceof HTMLInputElement
    && target.type === 'date'
    && !target.disabled
    && !target.readOnly
    && target.getClientRects().length > 0
    && !target.closest('[aria-hidden="true"]');

  function ensureHost() {
    if (host) return host;
    host = document.createElement('div');
    host.className = 'blDualDatePicker';
    host.hidden = true;
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'false');
    document.body.appendChild(host);
    host.addEventListener('click', onPickerClick);
    return host;
  }

  function monthTitle(date) {
    const monthsTr = window.BLDateDimension?.MONTHS_TR || [];
    const monthsEn = window.BLDateDimension?.MONTHS_EN || [];
    const names = en() ? monthsEn : monthsTr;
    return `${names[date.getMonth()] || pad(date.getMonth() + 1)} ${date.getFullYear()}`;
  }

  function pairFor(date) {
    const dimension = window.BLDateDimension;
    if (!dimension) return { lcw:null, glb:null, mapped:false };
    if (typeof dimension.weekPair === 'function') return dimension.weekPair(date);
    const p = dimension.describe(date);
    return {
      lcw:p && p.businessValid ? p.lcwWeek : null,
      glb:p && p.isoWeek,
      mapped:Boolean(p && p.businessValid),
    };
  }

  function allowed(value) {
    if (!input) return false;
    const min = String(input.min || '').slice(0, 10);
    const max = String(input.max || '').slice(0, 10);
    return (!min || value >= min) && (!max || value <= max);
  }

  function render() {
    if (!input || !cursor) return close();
    const root = ensureHost();
    const selected = localDate(input.value);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const gridStart = monday(first);
    const weekdays = en()
      ? ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
      : ['Pzt','Sal','Çar','Per','Cum','Cmt','Paz'];

    let rows = '';
    for (let weekIndex = 0; weekIndex < 6; weekIndex++) {
      const start = add(gridStart, weekIndex * 7);
      const pair = pairFor(start);
      const lcw = pair.lcw == null ? '—' : String(pair.lcw);
      const glb = pair.glb == null ? '—' : String(pair.glb);
      const weekTitle = T(
        `LCW Merch Hafta: ${lcw} · Global Hafta: ${glb}`,
        `LCW Merch Week: ${lcw} · Global Week: ${glb}`,
      );
      let days = '';
      for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
        const date = add(start, dayIndex);
        const value = iso(date);
        const outside = date.getMonth() !== cursor.getMonth();
        const selectedDay = sameDay(date, selected);
        const todayDay = sameDay(date, today);
        const disabled = !allowed(value);
        days += `<button type="button" class="blDualDateDay${outside ? ' isOutside' : ''}${selectedDay ? ' isSelected' : ''}${todayDay ? ' isToday' : ''}"
          data-date="${value}"${disabled ? ' disabled' : ''} aria-label="${date.toLocaleDateString(en() ? 'en-GB' : 'tr-TR')}">${date.getDate()}</button>`;
      }
      rows += `<div class="blDualDateWeekRow">
        <div class="blDualDateWeekNo" title="${weekTitle}" aria-label="${weekTitle}"><strong>${lcw}</strong><span>/</span><strong>${glb}</strong></div>
        ${days}
      </div>`;
    }

    root.innerHTML = `
      <div class="blDualDateHead">
        <button type="button" class="blDualDateNav" data-shift="-1" aria-label="${T('Önceki ay','Previous month')}">‹</button>
        <strong class="blDualDateTitle">${monthTitle(cursor)}</strong>
        <button type="button" class="blDualDateNav" data-shift="1" aria-label="${T('Sonraki ay','Next month')}">›</button>
      </div>
      <div class="blDualDateLegend"><span>LCW / GLB</span><small>${T('Merch hafta / global hafta','Merch week / global week')}</small></div>
      <div class="blDualDateWeekdays"><span>LCW / GLB</span>${weekdays.map(day => `<span>${day}</span>`).join('')}</div>
      <div class="blDualDateGrid">${rows}</div>
      <div class="blDualDateFoot">
        <button type="button" class="tbtn blDualDateToday" data-today>${T('Bugün','Today')}</button>
        <button type="button" class="tbtn" data-close>${T('Kapat','Close')}</button>
      </div>`;
    position();
  }

  function position() {
    if (!host || host.hidden || !input) return;
    const rect = input.getBoundingClientRect();
    const width = Math.min(470, Math.max(350, window.innerWidth - 16));
    host.style.width = width + 'px';
    const measured = host.getBoundingClientRect();
    let left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - measured.width - 8));
    let top = rect.bottom + 5;
    if (top + measured.height > window.innerHeight - 8 && rect.top > measured.height + 8) top = rect.top - measured.height - 5;
    host.style.left = Math.round(left) + 'px';
    host.style.top = Math.round(Math.max(8, top)) + 'px';
  }

  function openFor(target) {
    if (!isVisibleDateInput(target)) return;
    input = target;
    const selected = localDate(target.value);
    const now = selected || new Date();
    cursor = new Date(now.getFullYear(), now.getMonth(), 1);
    const root = ensureHost();
    root.hidden = false;
    root.dataset.open = '1';
    target.setAttribute('aria-expanded', 'true');
    render();
  }

  function close() {
    if (input) input.setAttribute('aria-expanded', 'false');
    input = null;
    cursor = null;
    if (host) { host.hidden = true; delete host.dataset.open; }
  }

  function choose(value) {
    if (!input || !allowed(value)) return;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles:true }));
    input.dispatchEvent(new Event('change', { bubbles:true }));
    input.focus({ preventScroll:true });
    close();
  }

  function onPickerClick(event) {
    const shift = event.target.closest('[data-shift]');
    if (shift) {
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + Number(shift.dataset.shift || 0), 1);
      render();
      return;
    }
    const day = event.target.closest('[data-date]');
    if (day && !day.disabled) { choose(day.dataset.date); return; }
    if (event.target.closest('[data-today]')) { choose(iso(new Date())); return; }
    if (event.target.closest('[data-close]')) close();
  }

  document.addEventListener('pointerdown', event => {
    const target = event.target;
    if (!isVisibleDateInput(target)) return;
    event.preventDefault();
    target.focus({ preventScroll:true });
    openFor(target);
  }, true);

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && input) { event.preventDefault(); close(); return; }
    if (!isVisibleDateInput(event.target)) return;
    if (event.key === 'Enter' || event.key === ' ' || (event.altKey && event.key === 'ArrowDown')) {
      event.preventDefault();
      openFor(event.target);
    }
  }, true);

  document.addEventListener('pointerdown', event => {
    if (!input || !host || host.contains(event.target) || event.target === input) return;
    close();
  });

  window.addEventListener('resize', position);
  window.addEventListener('scroll', position, true);
  window.addEventListener('bl:merch-calendar-change', () => { if (input) render(); });

  window.BLDualWeekDatePicker = { open:openFor, close, render };
})();
