/* Buyer Log — ortak sütun dondurma motoru (CP, Siparişler, Koleksiyon, LFL ve
   BLTableFramework tabloları).

   Neden yeniden yazıldı: eski uygulama dondurma ofsetlerini render anında bir kez
   ölçüp her hücreye sınıf + inline `left` basıyordu. Sonradan değişen sütun
   genişlikleri (görsel boyutu, görsel yüklemesi, sekme gizliyken çizim, satır
   yenileme) ofsetleri bayatlatıyor; ayrıca altı stil dosyasına dağılmış, birbirini
   ezen z-index/position kuralları donmuş başlıkların kayan başlıkların altında
   kalmasına yol açıyordu.

   Sözleşme:
     BLTableFreeze.apply(table, {count})  soldan `count` veri sütununu dondurur
                                          (seçim kutusu sütunu varsa ona eklenir)
     BLTableFreeze.clear(table)
     BLTableFreeze.info(table)            {count, active, suspended, width}
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
   - Donmuş alan görünür tablo genişliğini aşarsa dondurma geçici olarak askıya
     alınır (tercih korunur); pencere genişleyince kendiliğinden geri gelir. */
(function (global) {
  'use strict';

  var MIN_SCROLL_VIEW = 160;            // donmuş alanın sağında kalması gereken en az kayan alan (px)
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
      rec = { count: 0, offsets: [], width: 0, css: '', style: null, observer: null, observed: [], frame: 0, suspended: false };
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
    if (wrap) targets.push(wrap);
    var same = targets.length === rec.observed.length && targets.every(function (el, i) { return rec.observed[i] === el; });
    if (same) return;
    if (!rec.observer) rec.observer = new global.ResizeObserver(function () { schedule(table); });
    rec.observer.disconnect();
    targets.forEach(function (el) { rec.observer.observe(el, el === wrap ? undefined : { box: 'border-box' }); });
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

  function buildCss(table, offsets) {
    var t = '#' + cssId(table.id) + '[data-bl-freeze]';
    // Tam genişlikli satırlar (detay, boş durum, sanal kaydırma boşlukları) hariç.
    var plain = 'tr:not(:has(>[colspan]:not([colspan="1"])))';
    var last = offsets.length;
    var out = [
      // Kayan başlık ve alt bilgi, donmuş gövdenin üstünde kalır.
      t + '>thead>tr>th{z-index:var(--ui-z-sticky)!important}',
      t + '>tfoot>tr{z-index:var(--ui-z-sticky)!important}',
      t + '>thead>tr.groupRow>th.frzL{position:sticky!important;z-index:var(--ui-z-sticky-column)!important}'
    ];
    offsets.forEach(function (left, i) {
      var n = ':nth-child(' + (i + 1) + ')', px = left + 'px';
      out.push(t + '>thead>tr.colRow>th' + n + '{position:sticky!important;left:' + px + '!important;z-index:var(--ui-z-sticky-column)!important}');
      out.push(t + '>tbody>' + plain + '>' + n + '{position:sticky!important;left:' + px + '!important;z-index:var(--ui-z-frozen-cell)!important}');
      out.push(t + '>tfoot>' + plain + '>' + n + '{position:sticky!important;left:' + px + '!important;z-index:var(--ui-z-data)!important}');
    });
    var edge = ':nth-child(' + last + ')';
    // Donmuş alanın sağ kenarı grup ayırıcısıyla aynı çizgiyi alır. Kenar
    // `border` değil iç gölgedir: sütun genişliğini değiştirip ölçümü oynatmaz.
    out.push(':is(' + t + '>:is(tbody,tfoot)>' + plain + '>' + edge + ',' + t + '>thead>tr.colRow>th' + edge + '){box-shadow:inset -2px 0 0 var(--ui-group-divider)}');
    // Donmuş hücreler altlarından kayan içeriği göstermemek için opak zemin alır.
    // Özgüllük bilerek düşük (:where): satır üzeri, seçim ve hücre dolguları
    // (hepsi opak tokenlar) yine kazanır.
    out.push(':where(' + t + '>tbody>' + plain + '>:nth-child(-n+' + last + ')){background-color:var(--ui-surface)}');
    out.push(':where(' + t + '>tfoot>' + plain + '>:nth-child(-n+' + last + ')){background-color:var(--ui-surface-soft)}');
    return out.join('\n');
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
    rec.width = acc;

    var available = wrap ? wrap.clientWidth : 0;
    rec.suspended = Boolean(available && acc > available - MIN_SCROLL_VIEW);
    if (rec.suspended) {
      table.removeAttribute('data-bl-freeze');
      table.setAttribute('data-bl-freeze-suspended', '');
      clearHeaderMarks(table);
      if (wrap) { wrap.classList.remove('hasFreeze'); wrap.style.removeProperty('scroll-padding-left'); }
      return;
    }
    table.removeAttribute('data-bl-freeze-suspended');
    table.setAttribute('data-bl-freeze', String(count));

    // Başlık satırı: başlık izleme ve seçim kipi sınıfları kullanır.
    clearHeaderMarks(table);
    cells.forEach(function (cell, i) {
      cell.classList.add('frzL');
      if (i === cells.length - 1) cell.classList.add('frzLEdge');
    });
    var groups = groupRow(table);
    if (groups) {
      var spacer = groups.querySelector('th.groupSpacer:not([data-start])');
      if (spacer && chk) { spacer.classList.add('frzL'); spacer.style.left = '0px'; }
      groups.querySelectorAll('th[data-start][data-end]').forEach(function (cell) {
        var first = Math.max(0, Number(cell.dataset.start) || 0);
        var lastIndex = Math.max(first, Number(cell.dataset.end) || first);
        if (lastIndex >= count) return;
        cell.classList.add('frzL');
        cell.style.left = (offsets[chk + first] || 0) + 'px';
        if (lastIndex === count - 1) cell.classList.add('frzLEdge');
      });
    }

    var css = buildCss(table, offsets);
    if (css !== rec.css) { styleFor(table, rec).textContent = css; rec.css = css; }
    if (wrap) {
      wrap.classList.add('hasFreeze');
      // Klavye ile gezinme / scrollIntoView etkin hücreyi donmuş alanın altına saklamasın.
      wrap.style.scrollPaddingLeft = Math.ceil(acc) + 'px';
    }
  }

  function deactivate(table, rec) {
    table.removeAttribute('data-bl-freeze');
    table.removeAttribute('data-bl-freeze-suspended');
    clearHeaderMarks(table);
    if (rec) {
      stopObserving(rec);
      rec.offsets = []; rec.width = 0; rec.suspended = false;
      if (rec.style) rec.style.textContent = '';
      rec.css = '';
    }
    var wrap = table.closest('.tablewrap');
    if (wrap) { wrap.classList.remove('hasFreeze'); wrap.style.removeProperty('scroll-padding-left'); }
  }

  function apply(table, options) {
    if (!table || !table.id) return info(table);
    var rec = entry(table);
    rec.count = Math.max(0, Number(options && options.count) || 0) | 0;
    if (!rec.count) deactivate(table, rec);
    else layout(table, rec);
    return info(table);
  }
  function clear(table) { return apply(table, { count: 0 }); }
  function info(table) {
    var rec = table && registry.get(table);
    return { count: rec ? rec.count : 0, active: Boolean(rec && rec.count && table.hasAttribute('data-bl-freeze')), suspended: Boolean(rec && rec.suspended), width: rec ? rec.width : 0, offsets: rec ? rec.offsets.slice() : [] };
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

  global.BLTableFreeze = Object.freeze({ apply: apply, clear: clear, info: info, refresh: schedule, startPick: startPick, cancelPick: cancelPick, isPicking: isPicking, _buildCss: buildCss });
})(window);
