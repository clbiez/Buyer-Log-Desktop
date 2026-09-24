/* Buyer Log — OAB ve INTAKE tabloları için Excel benzeri sütun genişliği kontrolü.

   Neden ayrı bir modül: app-main.js içindeki yönetilen tablo resize zinciri
   (attachResize/buildColgroup/defaultMinPx) `colmgr[tableKey]` ve
   `COLS_BY_TABLE[tableKey]` global'lerine bağlı ve minimum genişliği BAŞLIK
   metninden türetiyor. OAB pivot/raw ve INTAKE kolon kimlikleri bu modele
   girmiyor; ayrıca burada istenen kural tam tersi: başlık sarılır, minimumu
   ALT HÜCRE içeriği belirler. Bu dosya o iki modülün ORTAK kullandığı tek
   uygulamadır; app-main'in kendi sistemine dokunulmaz ve davranış başka
   tablolara kendiliğinden yayılmaz.

   Sözleşme:
     BLTableColumnResize.apply(table, {
       scope:   'oab.pivot' gibi kalıcılık kapsamı (varsayılan localStorage deposu)
       columns: [{key, label, type}]  type: num | pct | date | code | text
       store:   {get(key), set(key,px), save()}  — verilirse depo yerine bu kullanılır
     })
   `columns` sırası thead'in ilk satırındaki th sırasıyla birebir eşleşmelidir. */
(function (global) {
  'use strict';

  var ABS_MIN = 60;      // sunucu tarafı INTAKE clamp'i ile aynı alt sınır
  var ABS_MAX = 900;
  var DEFAULT_MAX = 300;
  var HEADER_DEFAULT_CAP = 210;

  // Minimumlar YALNIZ veri hücresinin kullanılabilirliğine bakar; başlık uzunluğu
  // buraya hiç girmez (uzun başlık sarılır, sütunu geniş tutmaz).
  var TYPE_MIN = { num: 60, pct: 60, date: 86, code: 74, text: 96 };
  // Kullanıcı henüz dokunmadıysa kullanılan başlangıç genişliği. Başlık burada
  // etkilidir ama tavanla sınırlıdır ve minimumu şişirmez.
  var TYPE_DEFAULT = { num: 96, pct: 88, date: 108, code: 112, text: 156 };

  var measureCtx = null;
  function headerTextPx(label) {
    var text = String(label == null ? '' : label);
    try {
      if (!measureCtx) {
        var canvas = document.createElement('canvas');
        measureCtx = canvas.getContext('2d');
      }
      if (measureCtx) {
        measureCtx.font = '600 11px Arial, sans-serif';
        return Math.ceil(measureCtx.measureText(text).width);
      }
    } catch (_) { /* ölçüm yoksa karakter tahminine düşülür */ }
    return Math.ceil(text.length * 6.2);
  }

  function typeOf(col) {
    var t = String((col && col.type) || 'text');
    return TYPE_MIN[t] ? t : 'text';
  }
  function minPxOf(col) {
    var explicit = Math.round(Number(col && col.minPx) || 0);
    return Math.max(ABS_MIN, explicit || TYPE_MIN[typeOf(col)]);
  }
  function defaultPxOf(col) {
    var t = typeOf(col);
    var header = Math.min(headerTextPx(col && col.label) + 30, HEADER_DEFAULT_CAP);
    return Math.max(minPxOf(col), Math.min(DEFAULT_MAX, Math.max(TYPE_DEFAULT[t], header)));
  }
  function clampPx(px, col) {
    return Math.max(minPxOf(col), Math.min(ABS_MAX, Math.round(Number(px) || 0)));
  }

  function storageGet(key) {
    try {
      if (global.BLStorage && global.BLStorage.getItem) return global.BLStorage.getItem(key);
      return global.localStorage ? global.localStorage.getItem(key) : null;
    } catch (_) { return null; }
  }
  function storageSet(key, value) {
    try {
      if (global.BLStorage && global.BLStorage.setItem) global.BLStorage.setItem(key, value);
      else if (global.localStorage) global.localStorage.setItem(key, value);
    } catch (_) { /* kota dolu: genişlik ekranda çalışır, yalnız hatırlanmaz */ }
  }

  var localStores = Object.create(null);
  function localStore(scope) {
    var name = String(scope || 'default');
    if (localStores[name]) return localStores[name];
    var storageKey = 'lcw.tableColWidth.' + name + '.v1';
    var data = null;
    function load() {
      if (data) return data;
      try {
        var parsed = JSON.parse(storageGet(storageKey) || '{}');
        data = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch (_) { data = {}; }
      return data;
    }
    var store = {
      get: function (key) { var px = Number(load()[key]); return Number.isFinite(px) ? px : null; },
      set: function (key, px) { load()[key] = Math.round(px); },
      save: function () { storageSet(storageKey, JSON.stringify(load())); },
    };
    localStores[name] = store;
    return store;
  }

  var badge = null;
  function showBadge(px, clientX, clientY) {
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'blColResizeBadge';
      document.body.appendChild(badge);
    }
    badge.textContent = Math.round(px) + ' px';
    badge.style.left = Math.min(Math.max(8, clientX + 14), global.innerWidth - 70) + 'px';
    badge.style.top = Math.min(Math.max(8, clientY + 16), global.innerHeight - 30) + 'px';
    badge.hidden = false;
  }
  function hideBadge() { if (badge) badge.hidden = true; }

  function apply(table, options) {
    if (!table || !options) return null;
    var columns = (options.columns || []).filter(function (c) { return c && c.key != null && c.key !== ''; });
    var headRow = table.tHead && table.tHead.rows[0];
    if (!columns.length || !headRow) return null;
    var cells = [];
    for (var i = 0; i < headRow.cells.length; i++) cells.push(headRow.cells[i]);
    if (cells.length !== columns.length) return null; // güvenli çıkış: eşleşmeyen başlık düzeni

    var store = options.store || localStore(options.scope);
    table.classList.add('blResizableTable');

    var colgroup = table.querySelector('colgroup');
    if (!colgroup) {
      colgroup = document.createElement('colgroup');
      table.insertBefore(colgroup, table.firstChild);
    }
    var colEls = [];
    colgroup.innerHTML = '';
    columns.forEach(function () {
      var col = document.createElement('col');
      colgroup.appendChild(col);
      colEls.push(col);
    });

    function widthOf(col) {
      var saved = store.get(col.key);
      return saved == null ? defaultPxOf(col) : clampPx(saved, col);
    }

    /* Önce viewport'a sığdırmayı dener: kullanıcının elle ayarlamadığı sütunlar
       kendi minimumlarına kadar orantılı kısılır. Kullanıcının verdiği genişlik
       asla kendiliğinden küçültülmez. Hâlâ sığmıyorsa yatay kaydırma tablonun
       kendi kabında kalır; sayfa sağa taşmaz. */
    function computeWidths() {
      var list = columns.map(function (col) {
        var saved = store.get(col.key);
        return { col: col, px: saved == null ? defaultPxOf(col) : clampPx(saved, col), fixed: saved != null };
      });
      var available = table.parentElement ? table.parentElement.clientWidth : 0;
      var total = list.reduce(function (sum, item) { return sum + item.px; }, 0);
      if (!available || total <= available) return list;
      var flexible = list.filter(function (item) { return !item.fixed; });
      if (!flexible.length) return list;
      var flexTotal = flexible.reduce(function (sum, item) { return sum + item.px; }, 0);
      var flexMin = flexible.reduce(function (sum, item) { return sum + minPxOf(item.col); }, 0);
      var target = available - (total - flexTotal);
      if (target <= flexMin) {
        flexible.forEach(function (item) { item.px = minPxOf(item.col); });
        return list;
      }
      var ratio = target / flexTotal;
      flexible.forEach(function (item) { item.px = Math.max(minPxOf(item.col), Math.round(item.px * ratio)); });
      return list;
    }

    function layout() {
      var list = computeWidths();
      var total = 0;
      list.forEach(function (item, index) {
        colEls[index].style.width = item.px + 'px';
        total += item.px;
      });
      table.style.minWidth = total + 'px';
      table.style.width = 'max(100%, ' + total + 'px)';
      return list;
    }

    function setWidth(col, px) {
      store.set(col.key, clampPx(px, col));
      layout();
    }

    cells.forEach(function (th, index) {
      var col = columns[index];
      th.classList.add('blResizableTh');
      var grip = document.createElement('div');
      grip.className = 'colResizer blColResizer';
      th.appendChild(grip);

      grip.addEventListener('mouseenter', function () {
        grip.title = (typeof global.appLang !== 'undefined' && global.appLang === 'en')
          ? 'Drag to resize · double-click to collapse'
          : 'Sürükleyerek genişliği ayarla · çift tıklayarak daralt';
      });
      // Tutamak üzerindeki etkileşim başlığın sıralama/filtre/yeniden adlandırma
      // işlemlerini tetiklememeli.
      grip.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); });
      grip.addEventListener('contextmenu', function (e) { e.stopPropagation(); });
      grip.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        var startPx = Math.round(cells[index].getBoundingClientRect().width) || widthOf(col);
        var startX = e.clientX;
        var floor = minPxOf(col);
        document.body.classList.add('blColResizing');
        showBadge(startPx, e.clientX, e.clientY);
        function onMove(ev) {
          var next = Math.max(floor, Math.min(ABS_MAX, startPx + (ev.clientX - startX)));
          store.set(col.key, next);
          layout();
          showBadge(next, ev.clientX, ev.clientY);
        }
        function onUp() {
          document.body.classList.remove('blColResizing');
          hideBadge();
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          if (store.save) store.save();
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
      // Çift tıklama: en dar kullanılabilir genişliğe indirir, ikinci çift tıklama geri açar.
      grip.addEventListener('dblclick', function (e) {
        e.preventDefault(); e.stopPropagation();
        var floor = minPxOf(col);
        var current = Math.round(cells[index].getBoundingClientRect().width) || widthOf(col);
        var restore = Number(grip.dataset.restorePx) || 0;
        if (current > floor) { grip.dataset.restorePx = String(current); setWidth(col, floor); }
        else if (restore > floor) { grip.dataset.restorePx = ''; setWidth(col, restore); }
        else return;
        if (store.save) store.save();
      });
    });

    layout();
    return { relayout: layout, columns: columns };
  }

  global.BLTableColumnResize = { apply: apply, minPxOf: minPxOf, defaultPxOf: defaultPxOf };
})(window);
