/* Buyer Log — ortak sütun dondurma motoru (CP, Siparişler, Koleksiyon, LFL ve
   BLTableFramework tabloları).

   Neden yeniden yazıldı: eski uygulama dondurma ofsetlerini render anında bir kez
   ölçüp her hücreye sınıf + inline `left` basıyordu. Sonradan değişen sütun
   genişlikleri (görsel boyutu, görsel yüklemesi, sekme gizliyken çizim, satır
   yenileme) ofsetleri bayatlatıyor; ayrıca altı stil dosyasına dağılmış, birbirini
   ezen z-index/position kuralları donmuş başlıkların kayan başlıkların altında
   kalmasına yol açıyordu.

   Sözleşme:
     BLTableFreeze.apply(table, {count, pane, onPaneResize(px)})
                                          soldan `count` veri sütununu dondurur
                                          (seçim kutusu sütunu varsa ona eklenir);
                                          `pane` donmuş bölmenin kullanıcı genişliği
     BLTableFreeze.clear(table)
     BLTableFreeze.info(table)            {count, active, suspended, width, pane, inner, scroll}
     BLTableFreeze.scrollPane(table, px)  donmuş bölmeyi kendi içinde kaydırır
     BLTableFreeze.startPick(table, {onPick(count), onCancel()})
     BLTableFreeze.cancelPick() / isPicking(table?)

   Tasarım:
   - Tek doğruluk kaynağı başlıktaki `tr.colRow` hücrelerinin GERÇEK genişliğidir.
     Donmuş başlık hücreleri ResizeObserver ile izlenir; genişlik ne sebeple
     değişirse değişsin ofsetler aynı karede yeniden yazılır.
   - Gövde/alt bilgi hücrelerine sınıf veya inline stil BASILMAZ. Tablo başına
     üretilen tek <style> `:nth-child` ile çalışır; kademeli çizim, sanal kaydırma
     ve tek satır yenilemesi otomatik olarak doğru konumu alır. Tam genişlikli
     (colspan) detay/boş durum satırları dondurulmaz.
   - Katman sırası tektir ve yalnız burada yönetilir: kayan gövde < donmuş gövde
     (--ui-z-frozen-cell) < kayan başlık/alt bilgi (--ui-z-sticky) < donmuş başlık
     (--ui-z-sticky-column).
   - İki bağımsız bölme: donmuş sol bölmenin genişliği (W) donmuş sütunların
     toplamından (F) dar olabilir. O zaman donmuş sütunlar bölme içinde kendi
     kaydırma çubuğuyla (ve bölme üzerinde yatay tekerlek/trackpad ile) sağa sola
     kayar, bölme sınırında kırpılır; sağ bölme tablonun normal kaydırmasıyla
     bağımsız kayar. Tablo `margin-left: -(F-W)` alır, böylece sağ bölmenin ilk
     sütunu tam W'den başlar. Bölme sınırı sürüklenerek genişletilip daraltılır.
   - Donmuş sütunlar görünür alanı kaplıyorsa bölme otomatik daralır ve iç
     kaydırma açılır; yalnız tablo aşırı darsa dondurma askıya alınır. */
(function (global) {
  'use strict';

  var MIN_SCROLL_VIEW = 160;            // donmuş bölmenin sağında kalması gereken en az kayan alan (px)
  var MIN_PANE = 80;                    // donmuş bölmenin en dar hâli (px)
  var registry = new WeakMap();         // table -> kayıt
  var pick = null;                      // etkin seçim kipi

  function cssId(id) {
    return global.CSS && typeof global.CSS.escape === 'function' ? global.CSS.escape(id) : String(id).replace(/[^\w-]/g, '\\$&');
  }
  function headerRow(table) { return table && table.tHead ? table.tHead.querySelector('tr.colRow') : null; }
  function groupRow(table) { return table && table.tHead ? table.tHead.querySelector('tr.groupRow') : null; }
  function hasCheckColumn(row) { return Boolean(row && row.firstElementChild && row.firstElementChild.classList.contains('chkTh')); }
  function dataHeaderCells(table) {
    var row = headerRow(table);
    if (!row) return [];
    return Array.prototype.filter.call(row.children, function (cell) { return !cell.classList.contains('chkTh') && !cell.classList.contains('groupSpacer'); });
  }

  function entry(table) {
    var rec = registry.get(table);
    if (!rec) {
      rec = { count: 0, offsets: [], widths: [], width: 0, pane: 0, paneWidth: 0, inner: false, scroll: 0, css: '', style: null,
        observer: null, observed: [], frame: 0, suspended: false, onPaneResize: null, paneEl: null, wheelWrap: null };
      registry.set(table, rec);
    }
    return rec;
  }

  function styleFor(table, rec) {
    if (rec.style && rec.style.isConnected) return rec.style;
    var id = 'blFreezeStyle-' + table.id;
    var existing = document.getElementById(id);
    rec.style = existing || document.createElement('style');
    rec.style.id = id;
    if (!existing) document.head.appendChild(rec.style);
    return rec.style;
  }

  function clearHeaderMarks(table) {
    if (!table.tHead) return;
    table.tHead.querySelectorAll('.frzL').forEach(function (cell) {
      cell.classList.remove('frzL', 'frzLEdge');
      cell.style.removeProperty('left');
      cell.style.removeProperty('clip-path');
    });
  }

  function stopObserving(rec) {
    if (rec.observer) rec.observer.disconnect();
    rec.observed = [];
  }

  function observe(table, rec, cells) {
    if (typeof global.ResizeObserver !== 'function') return;
    var wrap = table.closest('.tablewrap');
    var targets = cells.slice();
    targets.push(table);                // satır eklenince bölme ayırıcısının boyu güncellenir
    if (wrap) targets.push(wrap);
    var same = targets.length === rec.observed.length && targets.every(function (el, i) { return rec.observed[i] === el; });
    if (same) return;
    if (!rec.observer) rec.observer = new global.ResizeObserver(function () { schedule(table); });
    rec.observer.disconnect();
    targets.forEach(function (el) { rec.observer.observe(el, el === wrap || el === table ? undefined : { box: 'border-box' }); });
    rec.observed = targets;
  }

  function schedule(table) {
    var rec = registry.get(table);
    if (!rec || rec.frame) return;
    rec.frame = global.requestAnimationFrame(function () {
      rec.frame = 0;
      if (table.isConnected) layout(table, rec);
    });
  }

  // İç kaydırma açıkken her donmuş hücre bölme kaydırmasıyla (--blfz-s) sola kayar
  // ve bölme sınırında [0, --blfz-w] aralığına kırpılır. Kırpılan kısım tıklamayı da
  // almaz; tamamen dışarıda kalan hücre görünmez olur.
  function placement(left, right, inner) {
    if (!inner) return 'left:' + left + 'px!important';
    return 'left:calc(' + left + 'px - var(--blfz-s))!important;' +
      'clip-path:inset(0 max(0px,calc(' + right + 'px - var(--blfz-s) - var(--blfz-w))) 0 max(0px,calc(var(--blfz-s) - ' + left + 'px)))!important';
  }

  function buildCss(table, offsets, widths, inner) {
    var t = '#' + cssId(table.id) + '[data-bl-freeze]';
    // Tam genişlikli satırlar (detay, boş durum, sanal kaydırma boşlukları) hariç.
    var plain = 'tr:not(:has(>[colspan]:not([colspan="1"])))';
    var last = offsets.length;
    widths = widths || [];
    var out = [
      // Kayan başlık ve alt bilgi, donmuş gövdenin üstünde kalır.
      t + '>thead>tr>th{z-index:var(--ui-z-sticky)!important}',
      t + '>tfoot>tr{z-index:var(--ui-z-sticky)!important}',
      t + '>thead>tr.groupRow>th.frzL{position:sticky!important;z-index:var(--ui-z-sticky-column)!important}'
    ];
    offsets.forEach(function (left, i) {
      var n = ':nth-child(' + (i + 1) + ')', place = placement(left, Math.round((left + (widths[i] || 0)) * 100) / 100, inner);
      out.push(t + '>thead>tr.colRow>th' + n + '{position:sticky!important;' + place + ';z-index:var(--ui-z-sticky-column)!important}');
      out.push(t + '>tbody>' + plain + '>' + n + '{position:sticky!important;' + place + ';z-index:var(--ui-z-frozen-cell)!important}');
      out.push(t + '>tfoot>' + plain + '>' + n + '{position:sticky!important;' + place + ';z-index:var(--ui-z-data)!important}');
    });
    // Donmuş hücreler altlarından kayan içeriği göstermemek için opak zemin alır.
    // Özgüllük bilerek düşük (:where): satır üzeri, seçim ve hücre dolguları
    // (hepsi opak tokenlar) yine kazanır. Bölme sınırı ayrı ayırıcı öğedir.
    out.push(':where(' + t + '>tbody>' + plain + '>:nth-child(-n+' + last + ')){background-color:var(--ui-surface)}');
    out.push(':where(' + t + '>tfoot>' + plain + '>:nth-child(-n+' + last + ')){background-color:var(--ui-surface-soft)}');
    return out.join('\n');
  }

  /* ---- Bölme denetimi: sınır ayırıcısı (sürüklenir) + iç kaydırma çubuğu ---- */
  function paneControls(table, rec, wrap) {
    if (rec.paneEl && rec.paneEl.isConnected && rec.paneEl.parentElement === wrap) return rec.paneEl;
    if (rec.paneEl) rec.paneEl.remove();
    var pane = document.createElement('div');
    pane.className = 'blFreezePane';
    pane.innerHTML = '<div class="blFreezePaneBar" tabindex="-1"><div class="blFreezePaneTrack"></div></div><div class="blFreezePaneDivider" role="separator" aria-orientation="vertical"></div>';
    var bar = pane.firstChild, divider = pane.lastChild;
    bar.addEventListener('scroll', function () { setScroll(table, registry.get(table), bar.scrollLeft, true); }, { passive: true });
    divider.addEventListener('pointerdown', function (event) { startPaneDrag(table, event); });
    divider.addEventListener('dblclick', function (event) {
      // Çift tık: bölmeyi tüm donmuş sütunları gösterecek genişliğe döndürür.
      event.preventDefault();
      var r = registry.get(table); if (!r) return;
      r.pane = 0; layout(table, r);
      if (typeof r.onPaneResize === 'function') r.onPaneResize(0);
    });
    wrap.appendChild(pane);
    rec.paneEl = pane;
    return pane;
  }

  function paneLabel(divider) {
    var en = false;
    try { en = appLang === 'en'; } catch (_) { en = document.documentElement.lang === 'en'; }
    var text = en ? 'Drag to resize the frozen pane; double-click to show all frozen columns' : 'Donmuş bölmeyi genişletmek/daraltmak için sürükle; tüm donmuş sütunları göstermek için çift tıkla';
    if (divider.title !== text) { divider.title = text; divider.setAttribute('aria-label', text); }
  }

  function startPaneDrag(table, event) {
    var rec = registry.get(table);
    if (!rec || !rec.count || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    var divider = event.currentTarget, startX = event.clientX, startW = rec.paneWidth;
    try { divider.setPointerCapture(event.pointerId); } catch (_) {}
    divider.classList.add('isDragging');
    function move(ev) {
      rec.pane = Math.max(MIN_PANE, Math.round(startW + ev.clientX - startX));
      layout(table, rec);
    }
    function up() {
      divider.removeEventListener('pointermove', move);
      divider.removeEventListener('pointerup', up);
      divider.removeEventListener('pointercancel', up);
      divider.classList.remove('isDragging');
      // Bölme tüm donmuş sütunları kapsıyorsa özel genişlik saklanmaz.
      if (rec.pane >= rec.width - 0.5) rec.pane = 0;
      if (typeof rec.onPaneResize === 'function') rec.onPaneResize(rec.pane);
    }
    divider.addEventListener('pointermove', move);
    divider.addEventListener('pointerup', up);
    divider.addEventListener('pointercancel', up);
  }

  function setScroll(table, rec, value, fromBar) {
    if (!rec) return;
    var max = rec.inner ? Math.max(0, rec.width - rec.paneWidth) : 0;
    var next = Math.max(0, Math.min(max, Math.round(Number(value) || 0)));
    var changed = next !== rec.scroll;
    rec.scroll = next;
    table.style.setProperty('--blfz-s', next + 'px');
    var bar = rec.paneEl && rec.paneEl.firstChild;
    if (bar && !fromBar && Math.abs(bar.scrollLeft - next) > 0.5) bar.scrollLeft = next;
    if (changed) {
      var wrap = table.closest('.tablewrap');
      if (wrap && typeof global.CustomEvent === 'function') wrap.dispatchEvent(new global.CustomEvent('blfreezepanescroll'));
    }
  }

  // Bölme üzerindeki yatay tekerlek/trackpad (veya Shift+tekerlek) yalnız donmuş
  // bölmeyi kaydırır; sınıra gelince olay normal tablo kaydırmasına bırakılır.
  function bindWheel(table, rec, wrap) {
    if (rec.wheelWrap === wrap) return;
    rec.wheelWrap = wrap;
    wrap.addEventListener('wheel', function (event) {
      var r = registry.get(table);
      if (!r || !r.inner || !table.hasAttribute('data-bl-freeze')) return;
      var box = wrap.getBoundingClientRect(), x = event.clientX - box.left - wrap.clientLeft;
      if (x < 0 || x > r.paneWidth) return;
      var dx = event.deltaX;
      if (!dx && event.shiftKey) dx = event.deltaY;
      if (!dx || Math.abs(dx) < Math.abs(event.shiftKey ? 0 : event.deltaY)) return;
      if (event.deltaMode === 1) dx *= 16;
      var before = r.scroll;
      setScroll(table, r, before + dx);
      if (r.scroll !== before) event.preventDefault();
    }, { passive: false });
    // Klavye/odak donmuş bölmede gizli kalan bir hücreye giderse bölme onu gösterir.
    table.addEventListener('focusin', function (event) {
      var r = registry.get(table);
      if (!r || !r.inner) return;
      var cell = event.target && event.target.closest && event.target.closest('td,th');
      if (!cell || cell.parentElement.classList.contains('groupRow')) return;
      var i = Array.prototype.indexOf.call(cell.parentElement.children, cell);
      if (i < 0 || i >= r.offsets.length || cell.colSpan > 1) return;
      var left = r.offsets[i], right = left + (r.widths[i] || 0);
      if (left < r.scroll) setScroll(table, r, left);
      else if (right > r.scroll + r.paneWidth) setScroll(table, r, right - r.paneWidth);
    });
  }

  function suspend(table, rec, wrap) {
    table.removeAttribute('data-bl-freeze');
    table.setAttribute('data-bl-freeze-suspended', '');
    clearPaneStyles(table, rec, wrap);
  }

  function clearPaneStyles(table, rec, wrap) {
    clearHeaderMarks(table);
    table.style.removeProperty('margin-left');
    table.style.removeProperty('--blfz-s');
    table.style.removeProperty('--blfz-w');
    table.removeAttribute('data-bl-freeze-pane');
    if (rec) {
      rec.inner = false;
      if (rec.paneEl) { rec.paneEl.remove(); rec.paneEl = null; }
      if (rec.style) rec.style.textContent = '';
      rec.css = '';
    }
    if (wrap) { wrap.classList.remove('hasFreeze', 'hasFreezePaneScroll'); wrap.style.removeProperty('scroll-padding-left'); }
  }

  function layout(table, rec) {
    var row = headerRow(table);
    var wrap = table.closest('.tablewrap');
    if (!row || !rec.count) { deactivate(table, rec); return; }
    var chk = hasCheckColumn(row) ? 1 : 0;
    var cells = Array.prototype.slice.call(row.children, 0, chk + rec.count).filter(function (cell) { return !cell.classList.contains('groupSpacer'); });
    var dataCount = dataHeaderCells(table).length;
    var count = Math.min(rec.count, dataCount);
    cells = cells.slice(0, chk + count);
    if (!count || !cells.length) { deactivate(table, rec); return; }
    observe(table, rec, cells);
    var widths = cells.map(function (cell) { return cell.getBoundingClientRect().width; });
    // Gizli sekmede (display:none) ölçü yoktur; ResizeObserver görünür olunca yeniden çağırır.
    if (!widths.every(function (w) { return Number.isFinite(w) && w > 0; })) return;
    var offsets = [], acc = 0;
    widths.forEach(function (w) { offsets.push(Math.round(acc * 100) / 100); acc += w; });
    rec.offsets = offsets;
    rec.widths = widths;
    rec.width = acc;

    var available = wrap ? wrap.clientWidth : 0;
    var maxPane = available ? available - MIN_SCROLL_VIEW : acc;
    rec.suspended = Boolean(available && maxPane < Math.min(MIN_PANE, acc));
    if (rec.suspended) { suspend(table, rec, wrap); return; }
    // Bölme genişliği: kullanıcı genişliği (varsa) → donmuş toplam → görünür sınır.
    var wanted = rec.pane > 0 ? rec.pane : acc;
    var paneWidth = Math.round(Math.max(Math.min(MIN_PANE, acc), Math.min(wanted, acc, maxPane)) * 100) / 100;
    var inner = acc - paneWidth > 0.5;
    rec.paneWidth = inner ? paneWidth : acc;
    rec.inner = inner;

    table.removeAttribute('data-bl-freeze-suspended');
    table.setAttribute('data-bl-freeze', String(count));
    table.setAttribute('data-bl-freeze-pane', String(rec.paneWidth));
    if (inner) {
      table.style.marginLeft = -(Math.round((acc - rec.paneWidth) * 100) / 100) + 'px';
      table.style.setProperty('--blfz-w', rec.paneWidth + 'px');
    } else {
      table.style.removeProperty('margin-left');
      table.style.removeProperty('--blfz-w');
    }

    // Başlık satırı: başlık izleme ve seçim kipi sınıfları kullanır.
    clearHeaderMarks(table);
    cells.forEach(function (cell, i) {
      cell.classList.add('frzL');
      if (i === cells.length - 1) cell.classList.add('frzLEdge');
    });
    var groups = groupRow(table);
    if (groups) {
      var spacer = groups.querySelector('th.groupSpacer:not([data-start])');
      if (spacer && chk) groupPlace(spacer, 0, widths[0] || 0, inner);
      groups.querySelectorAll('th[data-start][data-end]').forEach(function (cell) {
        var first = Math.max(0, Number(cell.dataset.start) || 0);
        var lastIndex = Math.max(first, Number(cell.dataset.end) || first);
        if (lastIndex >= count) return;
        var from = offsets[chk + first] || 0, to = (offsets[chk + lastIndex] || 0) + (widths[chk + lastIndex] || 0);
        groupPlace(cell, from, to, inner);
        if (lastIndex === count - 1) cell.classList.add('frzLEdge');
      });
    }

    var css = buildCss(table, offsets, widths, inner);
    if (css !== rec.css) { styleFor(table, rec).textContent = css; rec.css = css; }
    if (wrap) {
      wrap.classList.add('hasFreeze');
      wrap.classList.toggle('hasFreezePaneScroll', inner);
      // Klavye ile gezinme / scrollIntoView etkin hücreyi donmuş bölmenin altına saklamasın.
      wrap.style.scrollPaddingLeft = Math.ceil(rec.paneWidth) + 'px';
      var pane = paneControls(table, rec, wrap);
      pane.style.width = rec.paneWidth + 'px';
      pane.lastChild.style.height = Math.max(0, Math.min(wrap.clientHeight, table.offsetHeight)) + 'px';
      paneLabel(pane.lastChild);
      var bar = pane.firstChild;
      bar.hidden = !inner;
      bar.firstChild.style.width = acc + 'px';
      bindWheel(table, rec, wrap);
    }
    setScroll(table, rec, rec.scroll);
  }

  function groupPlace(cell, from, to, inner) {
    cell.classList.add('frzL');
    if (!inner) { cell.style.left = from + 'px'; cell.style.removeProperty('clip-path'); return; }
    cell.style.left = 'calc(' + from + 'px - var(--blfz-s))';
    cell.style.clipPath = 'inset(0 max(0px,calc(' + to + 'px - var(--blfz-s) - var(--blfz-w))) 0 max(0px,calc(var(--blfz-s) - ' + from + 'px)))';
  }

  function deactivate(table, rec) {
    table.removeAttribute('data-bl-freeze');
    table.removeAttribute('data-bl-freeze-suspended');
    if (rec) {
      stopObserving(rec);
      rec.offsets = []; rec.widths = []; rec.width = 0; rec.suspended = false; rec.scroll = 0; rec.paneWidth = 0;
    }
    clearPaneStyles(table, rec, table.closest('.tablewrap'));
  }

  function apply(table, options) {
    if (!table || !table.id) return info(table);
    var rec = entry(table);
    var count = Math.max(0, Number(options && options.count) || 0) | 0;
    if (count !== rec.count) rec.scroll = 0;
    rec.count = count;
    rec.pane = Math.max(0, Math.round(Number(options && options.pane) || 0));
    rec.onPaneResize = options && typeof options.onPaneResize === 'function' ? options.onPaneResize : null;
    if (!rec.count) deactivate(table, rec);
    else layout(table, rec);
    return info(table);
  }
  function clear(table) { return apply(table, { count: 0 }); }
  function scrollPane(table, px) { var rec = table && registry.get(table); if (rec && rec.count) setScroll(table, rec, px); return info(table); }
  function info(table) {
    var rec = table && registry.get(table);
    return { count: rec ? rec.count : 0, active: Boolean(rec && rec.count && table.hasAttribute('data-bl-freeze')), suspended: Boolean(rec && rec.suspended),
      width: rec ? rec.width : 0, pane: rec ? rec.paneWidth : 0, inner: Boolean(rec && rec.inner), scroll: rec ? rec.scroll : 0, offsets: rec ? rec.offsets.slice() : [] };
  }

  /* ---------------------- seçim kipi: lazer çizgisi ---------------------- */
  function pickTarget(table, clientX) {
    var cells = dataHeaderCells(table);
    for (var i = 0; i < cells.length; i++) {
      var r = cells[i].getBoundingClientRect();
      if (r.width > 0 && clientX >= r.left && clientX <= r.right) return { index: i, cell: cells[i], cells: cells };
    }
    return null;
  }
  function paintPreview(index) {
    if (!pick) return;
    var table = pick.table, wrap = table.closest('.tablewrap');
    var cells = dataHeaderCells(table);
    cells.forEach(function (cell, i) {
      cell.classList.toggle('freezePreview', index != null && i <= index);
      cell.classList.toggle('freezeHover', index != null && i === index);
    });
    if (!wrap) return;
    if (index == null) { if (pick.laser) pick.laser.hidden = true; return; }
    if (!pick.laser || !pick.laser.isConnected) {
      pick.laser = document.createElement('div');
      pick.laser.className = 'freezeLaser';
      pick.laser.setAttribute('aria-hidden', 'true');
      wrap.appendChild(pick.laser);
    }
    var wrapRect = wrap.getBoundingClientRect(), cellRect = cells[index].getBoundingClientRect();
    pick.laser.hidden = false;
    pick.laser.style.left = (cellRect.right - wrapRect.left - wrap.clientLeft + wrap.scrollLeft - 1) + 'px';
    pick.laser.style.top = (table.offsetTop) + 'px';
    pick.laser.style.height = table.offsetHeight + 'px';
  }
  function onPointerMove(event) {
    if (!pick) return;
    var rect = pick.table.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
      pick.index = null; paintPreview(null); return;
    }
    var hit = pickTarget(pick.table, event.clientX);
    if (!hit) return;
    pick.index = hit.index;
    paintPreview(hit.index);
  }
  function swallow(event) {
    if (!pick || !pick.table.contains(event.target)) return;
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
  }
  function onClick(event) {
    if (!pick || !pick.table.contains(event.target)) return;
    swallow(event);
    var hit = pickTarget(pick.table, event.clientX);
    var index = hit ? hit.index : pick.index;
    if (index == null) return;
    var done = pick.onPick;
    finishPick();
    if (typeof done === 'function') done(index + 1);
  }
  function onKey(event) {
    if (pick && event.key === 'Escape') { event.preventDefault(); cancelPick(); }
  }
  function finishPick() {
    if (!pick) return;
    var p = pick;
    pick = null;
    document.removeEventListener('pointermove', onPointerMove, true);
    document.removeEventListener('pointerdown', swallow, true);
    document.removeEventListener('mousedown', swallow, true);
    document.removeEventListener('dragstart', swallow, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    if (p.laser) p.laser.remove();
    var wrap = p.table.closest('.tablewrap');
    if (wrap) wrap.classList.remove('freezePick');
    p.table.querySelectorAll('.freezePreview,.freezeHover').forEach(function (cell) { cell.classList.remove('freezePreview', 'freezeHover'); });
  }
  function startPick(table, handlers) {
    cancelPick();
    if (!table) return false;
    pick = { table: table, index: null, laser: null, onPick: handlers && handlers.onPick, onCancel: handlers && handlers.onCancel };
    var wrap = table.closest('.tablewrap');
    if (wrap) wrap.classList.add('freezePick');
    document.addEventListener('pointermove', onPointerMove, true);
    // Seçim sırasında sıralama, filtre, sütun sürükleme ve yeniden boyutlandırma çalışmaz.
    document.addEventListener('pointerdown', swallow, true);
    document.addEventListener('mousedown', swallow, true);
    document.addEventListener('dragstart', swallow, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    return true;
  }
  function cancelPick() {
    if (!pick) return false;
    var done = pick.onCancel;
    finishPick();
    if (typeof done === 'function') done();
    return true;
  }
  function isPicking(table) { return Boolean(pick && (!table || pick.table === table || pick.table.id === table)); }

  global.BLTableFreeze = Object.freeze({ apply: apply, clear: clear, info: info, refresh: schedule, scrollPane: scrollPane, startPick: startPick, cancelPick: cancelPick, isPicking: isPicking, _buildCss: buildCss });
})(window);
