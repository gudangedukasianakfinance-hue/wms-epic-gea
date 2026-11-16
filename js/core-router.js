/**
 * core-router.js
 * ---------------------------------------------------------------------------
 * Mesin utama frontend single-core:
 *   - Navigasi 4 modul tanpa reload (tab router + hash)
 *   - State global & registry modul
 *   - Cache Master_Barang di localStorage (TTL 12 jam, instant UI + refresh)
 *   - Kumpulan helper UI: badge, tabel, filter, modal, toast, format
 */

(function (global) {
  'use strict';

  var WMS = global.WMS = global.WMS || {};
  var CONFIG = WMS.config || global.WMS_CONFIG || {};
  var ui = WMS.ui = WMS.ui || {};

  var state = WMS.state = {
    warehouse: WMS.warehouseCode || '',
    entity: WMS.entity || null,
    session: null,
    activeModule: null,
    modules: {},
    master: { items: [], savedAt: 0, source: 'none' }
  };

  /* ------------------------------------------------------------------------
   * Util dasar
   * ---------------------------------------------------------------------- */

  var HTML_ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return HTML_ESCAPE[char];
    });
  }

  function num(value) {
    if (typeof value === 'number') return isFinite(value) ? value : 0;
    var text = String(value == null ? '' : value).trim();
    if (!text) return 0;
    text = text.replace(/\s/g, '').replace(/[^0-9.,-]/g, '');
    if (!text) return 0;

    var hasComma = text.indexOf(',') !== -1;
    var hasDot = text.indexOf('.') !== -1;

    if (hasComma && hasDot) {
      if (text.lastIndexOf(',') > text.lastIndexOf('.')) {
        text = text.replace(/\./g, '').replace(/,/g, '.');
      } else {
        text = text.replace(/,/g, '');
      }
    } else if (hasComma) {
      var parts = text.split(',');
      if (parts.length === 2 && parts[1].length === 3 && parts[0].length > 0) {
        text = parts.join('');
      } else {
        text = text.replace(/,/g, '.');
      }
    } else if (hasDot) {
      if (/^-?\d{1,3}(\.\d{3})+$/.test(text)) {
        text = text.replace(/\./g, '');
      }
    }

    var parsed = Number(text);
    return isFinite(parsed) ? parsed : 0;
  }

  var numberFormatter = null;
  try {
    numberFormatter = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });
  } catch (error) {
    numberFormatter = null;
  }

  function formatNumber(value) {
    var n = num(value);
    if (numberFormatter) return numberFormatter.format(n);
    return String(n);
  }

  function formatQty(value) {
    if (value === null || value === undefined || String(value).trim() === '') return '—';
    return formatNumber(value);
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

  function parseDateParts(value) {
    var match = String(value == null ? '' : value).match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
    if (!match) return null;
    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: match[4] === undefined ? null : Number(match[4]),
      minute: match[5] === undefined ? null : Number(match[5])
    };
  }

  function formatDate(value) {
    var text = String(value == null ? '' : value).trim();
    if (!text) return '—';
    var parts = parseDateParts(text);
    if (!parts) return text;
    return parts.day + ' ' + (MONTHS[parts.month - 1] || '') + ' ' + parts.year;
  }

  function formatDateTime(value) {
    var text = String(value == null ? '' : value).trim();
    if (!text) return '—';
    var parts = parseDateParts(text);
    if (!parts) return text;
    var date = formatDate(text);
    if (parts.hour === null) return date;
    return date + ' · ' + String(parts.hour).padStart(2, '0') + ':' + String(parts.minute).padStart(2, '0');
  }

  function todayIso() {
    var now = new Date();
    return now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0');
  }

  function addDaysIso(days) {
    var date = new Date();
    date.setDate(date.getDate() + Number(days || 0));
    return date.getFullYear() + '-' +
      String(date.getMonth() + 1).padStart(2, '0') + '-' +
      String(date.getDate()).padStart(2, '0');
  }

  ui.esc = esc;
  ui.num = num;
  ui.formatNumber = formatNumber;
  ui.formatQty = formatQty;
  ui.formatDate = formatDate;
  ui.formatDateTime = formatDateTime;
  ui.todayIso = todayIso;
  ui.addDaysIso = addDaysIso;

  /* ------------------------------------------------------------------------
   * Badge status semantik
   * ---------------------------------------------------------------------- */

  var BADGE_TONES = {
    PENDING_PUTAWAY: 'warning',
    PENDING_APPROVAL: 'warning',
    MENIPIS: 'warning',
    SELESAI: 'success',
    ON_TIME: 'success',
    APPROVED: 'success',
    PUTAWAY_COMPLETED: 'success',
    DELIVERED: 'success',
    TERSEDIA: 'success',
    AKTIF: 'success',
    DELAY: 'danger',
    KARANTINA: 'danger',
    REJECTED: 'danger',
    NONAKTIF: 'danger',
    PICKED: 'info',
    DISPATCHED: 'accent',
    INBOUND: 'info',
    OUTBOUND: 'accent',
    TRANSFER_IN: 'success',
    TRANSFER_OUT: 'accent',
    ADJUSTMENT_SO: 'neutral',
    DRAFT: 'neutral'
  };

  function badge(status) {
    var raw = String(status == null ? '' : status).trim().toUpperCase();
    if (!raw) return '<span class="badge badge--neutral">—</span>';
    var tone = BADGE_TONES[raw] || 'neutral';
    return '<span class="badge badge--' + tone + '"><span class="badge__dot"></span>' + esc(raw) + '</span>';
  }

  ui.badge = badge;

  /* ------------------------------------------------------------------------
   * Master data cache (localStorage, TTL 12 jam)
   * ---------------------------------------------------------------------- */

  var masterInflight = null;
  var masterLastAttempt = 0;

  function readMasterCache() {
    try {
      var raw = global.localStorage.getItem(CONFIG.MASTER_CACHE_KEY || 'wms.master.v1');
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.items)) return null;
      return parsed;
    } catch (error) {
      return null;
    }
  }

  function writeMasterCache(items) {
    try {
      global.localStorage.setItem(
        CONFIG.MASTER_CACHE_KEY || 'wms.master.v1',
        JSON.stringify({ savedAt: Date.now(), items: items })
      );
    } catch (error) {
      // Kuota/localStorage diblokir: cache hanya hidup di memori.
    }
  }

  function normalizeMasterItems(data) {
    var items = data && Array.isArray(data.items) ? data.items : [];
    return items.filter(function (item) {
      return item && String(item.Kode_SKU == null ? '' : item.Kode_SKU).trim() !== '';
    });
  }

  function loadMasterCacheIntoState() {
    var cached = readMasterCache();
    if (!cached) return false;
    state.master.items = normalizeMasterItems(cached);
    state.master.savedAt = Number(cached.savedAt) || 0;
    state.master.source = 'cache';
    return true;
  }

  function masterIsFresh() {
    return state.master.savedAt > 0 &&
      (Date.now() - state.master.savedAt) < (CONFIG.MASTER_CACHE_TTL || 12 * 60 * 60 * 1000);
  }

  function loadMasterData(options) {
    var opts = options || {};

    if (!opts.skipCache) loadMasterCacheIntoState();

    if (!WMS.auth || typeof WMS.auth.getSession !== 'function' || !WMS.auth.getSession()) {
      return Promise.resolve(state.master.items);
    }

    if (masterInflight) return masterInflight;

    var recentlyAttempted = masterLastAttempt > 0 && (Date.now() - masterLastAttempt) < (5 * 60 * 1000);
    if (!opts.force && masterIsFresh() && recentlyAttempted) {
      return Promise.resolve(state.master.items);
    }

    masterLastAttempt = Date.now();

    masterInflight = WMS.api.request('GET_MASTER_DATA')
      .then(function (data) {
        var items = normalizeMasterItems(data);
        state.master.items = items;
        state.master.savedAt = Date.now();
        state.master.source = 'network';
        writeMasterCache(items);
        document.dispatchEvent(new CustomEvent('wms:master', { detail: { items: items } }));
        return items;
      })
      .catch(function (error) {
        if (WMS.api.isAuthError(error)) return state.master.items;
        // Cache tetap dipakai; modul menampilkan pesan bila benar-benar kosong.
        return state.master.items;
      })
      .then(function (items) {
        masterInflight = null;
        return items;
      });

    return masterInflight;
  }

  function masterItems() {
    return state.master.items.slice();
  }

  function findMasterItem(kodeSku) {
    var key = String(kodeSku == null ? '' : kodeSku).trim().toUpperCase();
    if (!key) return null;
    return state.master.items.find(function (item) {
      return String(item.Kode_SKU == null ? '' : item.Kode_SKU).trim().toUpperCase() === key;
    }) || null;
  }

  WMS.master = {
    load: loadMasterData,
    items: masterItems,
    find: findMasterItem,
    isFresh: masterIsFresh,
    refresh: function () { return loadMasterData({ force: true }); }
  };

  /* ------------------------------------------------------------------------
   * Ikon inline & potongan markup umum
   * ---------------------------------------------------------------------- */

  var ICONS = {
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    search: '<svg class="search-field__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>',
    arrow: '<svg viewBox="0 0 40 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12h33"/><path d="m28 5 7 7-7 7"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m20 6-11 11-5-5"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/></svg>',
    box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21 8-9-5-9 5v8l9 5 9-5z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/></svg>',
    empty: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h18v13H3z"/><path d="M3 7l2-4h14l2 4"/><path d="M9 12h6"/></svg>'
  };

  ui.ICONS = ICONS;

  ui.searchField = function (id, placeholder, value) {
    return '<label class="search-field">' +
      '<span class="sr-only">Cari data</span>' +
      ICONS.search +
      '<input type="search" id="' + esc(id) + '" class="input" placeholder="' + esc(placeholder) + '"' +
      (value ? ' value="' + esc(value) + '"' : '') + ' autocomplete="off">' +
      '</label>';
  };

  ui.emptyState = function (title, message) {
    return '<div class="state-panel">' +
      '<span class="state-panel__icon">' + ICONS.empty + '</span>' +
      '<h4>' + esc(title) + '</h4>' +
      '<p>' + esc(message || '') + '</p>' +
      '</div>';
  };

  ui.errorState = function (message, retryLabel) {
    return '<div class="state-panel state-panel--error">' +
      '<span class="state-panel__icon">' + ICONS.alert + '</span>' +
      '<h4>Gagal memuat data</h4>' +
      '<p>' + esc(message || 'Terjadi kesalahan saat menghubungi server.') + '</p>' +
      '<button type="button" class="btn btn--ghost btn--sm" data-retry>' + esc(retryLabel || 'Coba lagi') + '</button>' +
      '</div>';
  };

  ui.tableLoadingRow = function (colspan, rows) {
    var total = Math.max(2, Math.min(Number(rows) || 4, 6));
    var bars = '';
    for (var i = 0; i < total; i++) {
      bars += '<div class="skeleton-row"><span class="skeleton skeleton--sm"></span><span class="skeleton"></span><span class="skeleton skeleton--md"></span></div>';
    }
    return '<tr class="table-state"><td colspan="' + Number(colspan || 1) + '"><div class="skeleton-stack">' + bars + '</div></td></tr>';
  };

  ui.tableEmptyRow = function (colspan, title, message) {
    return '<tr class="table-state" data-empty-row><td colspan="' + Number(colspan || 1) + '">' +
      ui.emptyState(title || 'Belum ada data', message || 'Data akan tampil setelah tersedia.') +
      '</td></tr>';
  };

  ui.tableErrorRow = function (colspan, message) {
    return '<tr class="table-state"><td colspan="' + Number(colspan || 1) + '">' + ui.errorState(message) + '</td></tr>';
  };

  ui.bindRetry = function (container, handler) {
    if (!container) return;
    var button = container.querySelector('[data-retry]');
    if (button) button.addEventListener('click', handler);
  };

  ui.cellStack = function (primary, secondary) {
    return '<span class="cell-stack"><span class="strong">' + esc(primary || '—') + '</span>' +
      (secondary ? '<span class="muted">' + esc(secondary) + '</span>' : '') + '</span>';
  };

  ui.pdfLink = function (url) {
    if (!url) return '<span class="muted">—</span>';
    return '<a class="link" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">Lihat PDF</a>';
  };

  /* ------------------------------------------------------------------------
   * SKU options (master data)
   * ---------------------------------------------------------------------- */

  function skuList() {
    return state.master.items.filter(function (item) {
      var status = String(item.Status_Aktif == null ? '' : item.Status_Aktif).trim().toUpperCase();
      return !status || status === 'AKTIF';
    });
  }

  ui.skuDatalist = function (id) {
    var options = skuList().map(function (item) {
      var label = [item.Nama_Barang, item.Kategori, item.Satuan].filter(Boolean).join(' · ');
      return '<option value="' + esc(item.Kode_SKU) + '">' + esc(label) + '</option>';
    }).join('');
    return '<datalist id="' + esc(id) + '" data-sku-datalist>' + options + '</datalist>';
  };

  ui.skuSelectOptions = function (selected, includeAll, allLabel) {
    var current = String(selected == null ? '' : selected).trim().toUpperCase();
    var options = '';
    if (includeAll) {
      options += '<option value="">' + esc(allLabel || 'Semua SKU') + '</option>';
    } else {
      options += '<option value="">Pilih SKU…</option>';
    }
    skuList().forEach(function (item) {
      var code = String(item.Kode_SKU || '');
      var label = code + ' — ' + String(item.Nama_Barang || '');
      options += '<option value="' + esc(code) + '"' + (code.toUpperCase() === current ? ' selected' : '') + '>' + esc(label) + '</option>';
    });
    return options;
  };

  ui.skuLabel = function (kodeSku) {
    var item = findMasterItem(kodeSku);
    return item ? String(item.Nama_Barang || '') : '';
  };

  document.addEventListener('wms:master', function () {
    document.querySelectorAll('datalist[data-sku-datalist]').forEach(function (list) {
      var options = skuList().map(function (item) {
        var label = [item.Nama_Barang, item.Kategori, item.Satuan].filter(Boolean).join(' · ');
        return '<option value="' + esc(item.Kode_SKU) + '">' + esc(label) + '</option>';
      }).join('');
      list.innerHTML = options;
    });

    document.querySelectorAll('select[data-sku-select]').forEach(function (select) {
      var current = select.value;
      var includeAll = select.getAttribute('data-sku-all') === 'true';
      select.innerHTML = ui.skuSelectOptions(current, includeAll);
    });
  });

  /* ------------------------------------------------------------------------
   * Filter tabel generik (pencarian + filter status)
   * ---------------------------------------------------------------------- */

  ui.filterTable = function (options) {
    var table = document.querySelector(options.table);
    if (!table) return { apply: function () {} };

    var search = options.search ? document.querySelector(options.search) : null;
    var countEl = options.count ? document.querySelector(options.count) : null;
    var label = options.countLabel || 'baris';
    var filters = (options.filters || []).map(function (filter) {
      return {
        el: document.querySelector(filter.selector),
        attr: filter.attr,
        mode: filter.mode || 'equals'
      };
    }).filter(function (filter) { return !!filter.el; });

    function apply() {
      var query = search ? String(search.value || '').trim().toLowerCase() : '';
      var rows = table.querySelectorAll('tbody tr[data-row]');
      var visible = 0;

      rows.forEach(function (row) {
        var show = !query || String(row.getAttribute('data-search') || '').indexOf(query) !== -1;

        filters.forEach(function (filter) {
          if (!show) return;
          var value = filter.el.value;
          if (!value) return;
          var rowValue = String(row.getAttribute(filter.attr) || '');
          if (filter.mode === 'includes') {
            show = rowValue.indexOf(value) !== -1;
          } else {
            show = rowValue === value;
          }
        });

        row.hidden = !show;
        if (show) visible++;
      });

      var emptyRow = table.querySelector('tbody tr[data-empty-row]');
      if (emptyRow) emptyRow.hidden = visible !== 0;
      if (countEl) countEl.textContent = visible + ' ' + label;
    }

    if (search) search.addEventListener('input', apply);
    filters.forEach(function (filter) {
      filter.el.addEventListener('change', apply);
    });

    return { apply: apply };
  };

  /* ------------------------------------------------------------------------
   * Modal, konfirmasi & toast
   * ---------------------------------------------------------------------- */

  var modalSeq = 0;

  function syncModalState() {
    var open = document.querySelectorAll('.modal-backdrop.is-open');
    document.body.classList.toggle('modal-open', open.length > 0);
  }

  ui.syncModalState = syncModalState;

  function openModal(options) {
    var opts = options || {};
    var root = document.getElementById('modal-root');
    if (!root) return null;

    var seq = ++modalSeq;
    var titleId = 'dynamic-modal-title-' + seq;
    var backdrop = document.createElement('div');
    var sizeClass = opts.size ? ' modal--' + opts.size : '';

    backdrop.className = 'modal-backdrop is-open';
    backdrop.setAttribute('data-modal-seq', String(seq));
    backdrop.innerHTML =
      '<div class="modal' + sizeClass + '" role="dialog" aria-modal="true" aria-labelledby="' + titleId + '">' +
        '<div class="modal__header">' +
          '<div>' +
            (opts.eyebrow ? '<p class="eyebrow">' + esc(opts.eyebrow) + '</p>' : '') +
            '<h3 id="' + titleId + '">' + esc(opts.title || '') + '</h3>' +
            (opts.subtitle ? '<p>' + esc(opts.subtitle) + '</p>' : '') +
          '</div>' +
          '<button type="button" class="icon-btn modal__close" data-modal-close aria-label="Tutup">' + ICONS.close + '</button>' +
        '</div>' +
        '<div class="modal__body">' + (opts.body || '') + '</div>' +
        (opts.footer ? '<div class="modal__footer">' + opts.footer + '</div>' : '') +
      '</div>';

    var previousFocus = document.activeElement;
    var isClosed = false;

    function close(result) {
      if (isClosed) return;
      isClosed = true;
      if (typeof opts.onClose === 'function') opts.onClose(result);
      backdrop.classList.remove('is-open');
      global.setTimeout(function () {
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        syncModalState();
      }, 180);
      syncModalState();
      if (previousFocus && typeof previousFocus.focus === 'function') {
        try { previousFocus.focus(); } catch (error) { /* abaikan */ }
      }
    }

    backdrop.addEventListener('click', function (event) {
      if (event.target === backdrop && opts.backdropClose !== false) close('backdrop');
    });

    backdrop.querySelectorAll('[data-modal-close]').forEach(function (button) {
      button.addEventListener('click', function () { close('cancel'); });
    });

    root.appendChild(backdrop);
    syncModalState();

    if (typeof opts.onMount === 'function') opts.onMount(backdrop, close);

    global.setTimeout(function () {
      if (isClosed) return;
      var target = backdrop.querySelector(
        '.modal__body input:not([type="hidden"]):not([disabled]), .modal__body select:not([disabled]), .modal__body textarea:not([disabled]), [data-autofocus], .modal__footer .btn--primary, .modal__close'
      );
      if (target) {
        try { target.focus(); } catch (error) { /* abaikan */ }
      }
    }, 50);

    return { element: backdrop, close: close };
  }

  ui.openModal = openModal;

  function setBusy(button, busy, label) {
    if (!button) return;
    if (busy) {
      if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
      button.disabled = true;
      button.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>' + esc(label || 'Memproses…') + '</span>';
    } else {
      button.disabled = false;
      if (button.dataset.originalHtml) {
        button.innerHTML = button.dataset.originalHtml;
        delete button.dataset.originalHtml;
      }
    }
  }

  ui.setBusy = setBusy;

  function showInlineError(container, message) {
    if (!container) return;
    if (!message) {
      container.textContent = '';
      container.hidden = true;
      return;
    }
    container.textContent = message;
    container.hidden = false;
  }

  ui.showInlineError = showInlineError;

  function confirmAction(options) {
    var opts = options || {};

    return new Promise(function (resolve) {
      var settled = false;
      var running = false;
      var ref = openModal({
        eyebrow: opts.eyebrow,
        title: opts.title || 'Konfirmasi',
        subtitle: opts.subtitle,
        size: opts.size || 'sm',
        body: (opts.body || '<p>' + esc(opts.message || '') + '</p>') +
          '<div class="form-alert" data-confirm-error hidden role="alert"></div>',
        footer:
          '<button type="button" class="btn btn--ghost" data-modal-close>' + esc(opts.cancelLabel || 'Batal') + '</button>' +
          '<button type="button" class="btn ' + (opts.confirmClass || 'btn--primary') + '" data-confirm>' +
            esc(opts.confirmLabel || 'Lanjutkan') +
          '</button>',
        onClose: function () {
          if (!settled) {
            settled = true;
            resolve(false);
          }
        },
        onMount: function (modal, close) {
          var button = modal.querySelector('[data-confirm]');
          var errorBox = modal.querySelector('[data-confirm-error]');

          if (!button) return;

          button.addEventListener('click', function () {
            if (running) return;

            function finish() {
              if (settled) return;
              settled = true;
              resolve(true);
              close('confirm');
            }

            if (typeof opts.onConfirm !== 'function') {
              finish();
              return;
            }

            running = true;
            showInlineError(errorBox, '');
            setBusy(button, true, opts.busyLabel || 'Memproses…');

            Promise.resolve()
              .then(function () { return opts.onConfirm(); })
              .then(function (result) {
                running = false;
                setBusy(button, false);
                if (result === false) return;
                finish();
              })
              .catch(function (error) {
                running = false;
                setBusy(button, false);
                if (WMS.api.isAuthError(error)) return;
                showInlineError(errorBox, (error && error.message) || 'Terjadi kesalahan. Coba lagi.');
              });
          });
        }
      });

      if (!ref && !settled) {
        settled = true;
        resolve(false);
      }
    });
  }

  ui.confirm = confirmAction;

  function toast(message, tone, title) {
    var root = document.getElementById('toast-root');
    if (!root) return;

    var variant = tone || 'success';
    var icon = variant === 'success' ? ICONS.check : (variant === 'danger' ? ICONS.alert : ICONS.info);
    var element = document.createElement('div');
    element.className = 'toast toast--' + variant;
    element.setAttribute('role', 'status');

    element.innerHTML =
      '<span class="toast__icon">' + icon + '</span>' +
      '<span class="toast__content">' +
        (title ? '<strong>' + esc(title) + '</strong>' : '') +
        '<p>' + esc(message) + '</p>' +
      '</span>' +
      '<button type="button" class="toast__close" aria-label="Tutup notifikasi">' + ICONS.close + '</button>';

    var removed = false;

    function remove() {
      if (removed) return;
      removed = true;
      element.classList.add('is-leaving');
      global.setTimeout(function () {
        if (element.parentNode) element.parentNode.removeChild(element);
      }, 180);
    }

    element.querySelector('.toast__close').addEventListener('click', remove);
    root.appendChild(element);
    global.setTimeout(remove, 5500);
  }

  ui.toast = toast;

  /* ------------------------------------------------------------------------
   * Registry modul & router tab
   * ---------------------------------------------------------------------- */

  function registerModule(definition) {
    if (!definition || !definition.id) return null;

    var def = {
      id: String(definition.id),
      label: definition.label || definition.id,
      eyebrow: definition.eyebrow || '',
      title: definition.title || definition.label || definition.id,
      description: definition.description || '',
      requiresRole: definition.requiresRole || null,
      mount: definition.mount,
      refresh: definition.refresh,
      mounted: false,
      element: null
    };

    state.modules[def.id] = def;
    return def;
  }

  WMS.registerModule = registerModule;

  function roleRank(role) {
    return (CONFIG.ROLE_RANK || {})[String(role || '').toUpperCase()] || 0;
  }

  function canAccess(def) {
    if (!def) return false;
    if (!def.requiresRole) return true;
    return roleRank(WMS.auth && WMS.auth.getRole()) >= roleRank(def.requiresRole);
  }

  function modulePanel(id) {
    return document.querySelector('[data-module-panel="' + id + '"]');
  }

  function setActiveNav(id) {
    document.querySelectorAll('.sidebar__nav [data-module]').forEach(function (button) {
      var active = button.getAttribute('data-module') === id;
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  }

  function setPageTitle(def) {
    var titleEl = document.getElementById('page-title');
    var eyebrowEl = document.getElementById('page-eyebrow');
    if (titleEl) titleEl.textContent = def ? (def.title || def.label) : 'Dashboard Gudang';
    if (eyebrowEl) eyebrowEl.textContent = def ? (def.eyebrow || 'Modul Operasional') : 'WMS Terpadu';
    var entityName = state.entity ? state.entity.name : 'WMS Terpadu';
    document.title = (def ? (def.title || def.label) + ' · ' : '') + entityName + ' · WMS Terpadu';
  }

  function showFatal(panel, error, retry) {
    if (!panel) return;
    panel.innerHTML = '<div class="card"><div class="card__body">' +
      ui.errorState((error && error.message) || 'Modul tidak dapat dimuat.') +
      '</div></div>';
    ui.bindRetry(panel, retry);
  }

  function mountModule(def) {
    var panel = def.element || modulePanel(def.id);
    if (!panel) return Promise.resolve();

    def.element = panel;
    return Promise.resolve()
      .then(function () { return def.mount(panel); })
      .catch(function (error) {
        if (WMS.api.isAuthError(error)) return;
        def.mounted = false;
        showFatal(panel, error, function () {
          def.mounted = true;
          mountModule(def);
        });
      });
  }

  function activate(id, options) {
    var opts = options || {};
    var def = state.modules[id];

    if (!def) return;

    if (!WMS.auth || !WMS.auth.getSession()) {
      WMS.auth.showLogin('');
      return;
    }

    if (id === 'users' && String(WMS.auth && WMS.auth.getRole() || '').toUpperCase() !== 'SUPERVISOR') {
      ui.toast('Fitur ini hanya tersedia untuk Supervisor.', 'warning', 'Akses ditolak');
      activate('inbound', { silent: true });
      return;
    }

    if (!canAccess(def)) {
      ui.toast('Fitur ini hanya tersedia untuk Supervisor.', 'warning', 'Akses ditolak');
      if (state.activeModule !== 'inbound') activate('inbound', { silent: true });
      return;
    }

    var panel = modulePanel(id);
    if (!panel) return;

    document.querySelectorAll('[data-module-panel]').forEach(function (section) {
      section.hidden = section.getAttribute('data-module-panel') !== id;
    });

    state.activeModule = id;
    WMS.activeModule = id;
    setActiveNav(id);
    setPageTitle(def);

    if (global.history && global.history.replaceState) {
      try { global.history.replaceState(null, '', '#' + id); } catch (error) { /* abaikan */ }
    }

    closeMobileNav();

    if (!def.mounted) {
      def.mounted = true;
      def.element = panel;
      return mountModule(def);
    }

    if (typeof def.refresh === 'function') {
      return Promise.resolve()
        .then(function () { return def.refresh({ silent: !!opts.silent }); })
        .catch(function (error) {
          if (WMS.api.isAuthError(error)) return;
          ui.toast((error && error.message) || 'Gagal memuat ulang data.', 'danger');
        });
    }

    return Promise.resolve();
  }

  function refreshActive() {
    var def = state.modules[state.activeModule];
    if (def && typeof def.refresh === 'function') {
      return Promise.resolve(def.refresh({ silent: true })).catch(function (error) {
        if (WMS.api.isAuthError(error)) return;
        ui.toast((error && error.message) || 'Gagal memuat ulang data.', 'danger');
      });
    }
    return Promise.resolve();
  }

  function resetModules() {
    Object.keys(state.modules).forEach(function (id) {
      var def = state.modules[id];
      def.mounted = false;
      def.element = null;
      var panel = modulePanel(id);
      if (panel) panel.innerHTML = '';
    });
    state.activeModule = null;
    WMS.activeModule = null;
    setActiveNav('');
  }

  function onAuthenticated(event) {
    var detail = event && event.detail ? event.detail : {};
    state.session = detail.session || (WMS.auth && WMS.auth.getSession());
    WMS.session = state.session;

    loadMasterData();

    var hash = String(global.location.hash || '').replace('#', '').trim().toLowerCase();
    var target = state.modules[hash] && canAccess(state.modules[hash]) ? hash : 'inbound';
    if (hash === 'users' && String(WMS.auth && WMS.auth.getRole() || '').toUpperCase() !== 'SUPERVISOR') target = 'inbound';

    if (!state.modules[target]) target = Object.keys(state.modules)[0];
    if (!target) return;

    activate(target, { silent: true });
  }

  function onLogout() {
    state.session = null;
    WMS.session = null;
    resetModules();
    setPageTitle(null);
    setActiveNav('');
  }

  /* ------------------------------------------------------------------------
   * Mobile sidebar
   * ---------------------------------------------------------------------- */

  function openMobileNav() {
    document.body.classList.add('nav-open');
  }

  function closeMobileNav() {
    document.body.classList.remove('nav-open');
  }

  function bindShell() {
    document.querySelectorAll('.sidebar__nav [data-module]').forEach(function (button) {
      button.addEventListener('click', function () {
        var id = button.getAttribute('data-module') || button.getAttribute('data-tab');
        if (!WMS.auth.getSession()) {
          WMS.auth.showLogin('');
          return;
        }
        activate(id);
      });
    });

    document.addEventListener('click', function (event) {
      var goto = event.target.closest ? event.target.closest('[data-goto]') : null;
      if (!goto) return;
      event.preventDefault();
      activate(goto.getAttribute('data-goto'));
    });

    var navToggle = document.getElementById('nav-toggle');
    if (navToggle) {
      navToggle.addEventListener('click', function () {
        if (document.body.classList.contains('nav-open')) closeMobileNav();
        else openMobileNav();
      });
    }

    var overlay = document.getElementById('sidebar-overlay');
    if (overlay) overlay.addEventListener('click', closeMobileNav);

    global.addEventListener('hashchange', function () {
      var id = String(global.location.hash || '').replace('#', '').trim().toLowerCase();
      if (!id || id === state.activeModule) return;
      if (id === 'users' && String(WMS.auth && WMS.auth.getRole() || '').toUpperCase() !== 'SUPERVISOR') {
        global.history.replaceState(null, '', '#inbound');
        if (WMS.auth.getSession()) activate('inbound', { silent: true });
        return;
      }
      if (state.modules[id] && canAccess(state.modules[id]) && WMS.auth.getSession()) {
        activate(id, { silent: true });
      } else if (id && WMS.auth && WMS.auth.getSession()) {
        global.history.replaceState(null, '', '#' + (state.activeModule || 'inbound'));
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;

      var openModals = Array.prototype.slice.call(document.querySelectorAll('#modal-root .modal-backdrop.is-open'));
      if (openModals.length) {
        var last = openModals[openModals.length - 1];
        var closeBtn = last.querySelector('[data-modal-close]');
        if (closeBtn) {
          closeBtn.click();
          return;
        }
      }

      if (document.body.classList.contains('nav-open')) closeMobileNav();
    });

    document.addEventListener('wms:session', onAuthenticated);
    document.addEventListener('wms:logout', onLogout);

    document.addEventListener('wms:master', function () {
      var def = state.modules[state.activeModule];
      if (def && def.mounted && typeof def.onMaster === 'function') {
        try { def.onMaster(); } catch (error) { /* abaikan */ }
      }
    });
  }

  function boot() {
    if (boot.done) return;
    boot.done = true;

    state.warehouse = WMS.warehouseCode;
    state.entity = WMS.entity;

    bindShell();
    loadMasterCacheIntoState();
    setPageTitle(null);

    if (!WMS.warehouseCode || !WMS.entity) {
      document.body.classList.remove('auth-gate');
      var main = document.getElementById('module-root');
      if (main) {
        main.innerHTML = '<div class="card"><div class="card__body">' +
          ui.errorState('Halaman ini tidak memiliki atribut data-warehouse yang valid (EPIC / GEA).') +
          '</div></div>';
      }
      return;
    }

    WMS.auth.init();
  }

  WMS.router = {
    boot: boot,
    activate: activate,
    refreshActive: refreshActive,
    getActive: function () { return state.activeModule; },
    getModules: function () { return state.modules; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
