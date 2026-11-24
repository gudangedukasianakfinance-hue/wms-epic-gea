/**
 * mod-inventory.js — Modul 3 Inventory & Transfer
 * Sub-tab: Stok real-time, Kartu Stok, Transfer antar gudang.
 */

(function (global) {
  'use strict';

  var WMS = global.WMS;
  if (!WMS || !WMS.registerModule) return;

  var ui = WMS.ui;
  var STOCK_COLSPAN = 7;
  var KARTU_COLSPAN = 9;
  var state = {
    sub: 'stock',
    stockItems: [],
    stockLoaded: false,
    stockVisibleLimit: 100,
    stockCriteria: null,
    kartuItems: [],
    kartuLoaded: false,
    kartuVisibleLimit: 100,
    kartuCriteria: null,
    kartuSku: '',
    stockFilter: null,
    kartuFilter: null
  };
  var panel = null;
  var stockLoadGen = 0;
  var kartuLoadGen = 0;
  var transferFile = null;

  function entity(code) {
    return WMS.warehouses[code] || null;
  }

  function otherWarehouse() {
    return WMS.warehouseCode === 'EPIC' ? 'GEA' : 'EPIC';
  }

  function template() {
    var target = otherWarehouse();
    var sourceEntity = WMS.entity || {};
    var targetEntity = entity(target) || {};

    return '' +
      '<div class="module-head">' +
        '<div>' +
        '</div>' +
        '<div class="module-head__actions">' +
          '<button type="button" class="btn btn--ghost btn--sm" data-action="refresh">' + ui.ICONS.refresh + ' Muat Ulang</button>' +
        '</div>' +
      '</div>' +

      '<div class="subnav" role="tablist" aria-label="Sub-modul inventory">' +
        '<button type="button" class="subnav__btn is-active" data-sub="stock" role="tab" aria-selected="true">Stok Real-time</button>' +
        '<button type="button" class="subnav__btn" data-sub="kartu" role="tab" aria-selected="false">Kartu Stok</button>' +
        '<button type="button" class="subnav__btn" data-sub="transfer" role="tab" aria-selected="false">Transfer Antar Gudang</button>' +
      '</div>' +

      '<section class="subpanel" data-subpanel="stock">' +
        '<div class="stat-grid">' +
          '<article class="stat-card stat-card--accent">' +
            '<span class="stat-card__label">SKU Terdaftar</span>' +
            '<strong class="stat-card__value" data-stat="sku">—</strong>' +
            '<span class="stat-card__meta">Baris pada Stok_Gudang</span>' +
          '</article>' +
          '<article class="stat-card">' +
            '<span class="stat-card__label">Total Stok Aktif</span>' +
            '<strong class="stat-card__value" data-stat="aktif">—</strong>' +
            '<span class="stat-card__meta">Unit siap dialokasikan</span>' +
          '</article>' +
          '<article class="stat-card">' +
            '<span class="stat-card__label">Total Karantina</span>' +
            '<strong class="stat-card__value" data-stat="karantina">—</strong>' +
            '<span class="stat-card__meta">Unit tertahan hasil QC</span>' +
          '</article>' +
          '<article class="stat-card">' +
            '<span class="stat-card__label">Stok Menipis</span>' +
            '<strong class="stat-card__value" data-stat="menipis">—</strong>' +
            '<span class="stat-card__meta">≤ ' + ui.esc(String((WMS.config && WMS.config.LOW_STOCK_THRESHOLD) || 10)) + ' unit aktif</span>' +
          '</article>' +
        '</div>' +

        '<div class="card">' +
          '<div class="card__head">' +
            '<div><h3>Rincian Stok</h3><p>Posisi stok terkini per SKU. Klik nama barang untuk membuka Kartu Stok Detail.</p></div>' +
            '<span class="pill" id="stock-count">0 SKU</span>' +
          '</div>' +
          '<div class="toolbar">' +
            ui.searchField('stock-search', 'Cari SKU, nama barang, rak…') +
            '<select id="stock-filter" class="select select--sm" aria-label="Filter status stok">' +
              '<option value="">Semua status</option>' +
              '<option value="TERSEDIA">Tersedia</option>' +
              '<option value="MENIPIS">Menipis</option>' +
              '<option value="KARANTINA">Ada karantina</option>' +
            '</select>' +
            '<span class="toolbar__spacer"></span>' +
            '<span class="toolbar__note">Urut A–Z · Sumber: <code>Stok_Gudang</code></span>' +
          '</div>' +
          '<div class="table-wrap">' +
            '<table class="data-table" id="stock-table">' +
              '<thead><tr>' +
                '<th>SKU</th><th>Nama Barang (A–Z)</th><th>Lokasi Rak</th>' +
                '<th class="num">Stok Aktif</th><th class="num">Stok Karantina</th>' +
                '<th>Status</th><th>Pembaruan Terakhir</th>' +
              '</tr></thead>' +
              '<tbody id="stock-body">' + ui.tableLoadingRow(STOCK_COLSPAN, 5) + '</tbody>' +
            '</table>' +
          '</div>' +
        '</div>' +
      '</section>' +

      '<section class="subpanel" data-subpanel="kartu" hidden>' +
        '<div class="card">' +
          '<div class="card__head">' +
            '<div><h3>Buku Besar Kartu Stok</h3><p>Setiap baris mencatat Saldo_Awal, Qty_Masuk, Qty_Keluar, dan Saldo_Akhir.</p></div>' +
            '<span class="pill" id="kartu-count">0 mutasi</span>' +
          '</div>' +
          '<div class="toolbar">' +
            '<select id="kartu-sku" class="select select--sm" data-sku-select data-sku-all="true" aria-label="Filter SKU kartu stok" style="min-width:240px">' +
              ui.skuSelectOptions('', true, 'Semua SKU') +
            '</select>' +
            ui.searchField('kartu-search', 'Cari outlet, referensi, jenis, PIC…') +
            '<span class="toolbar__spacer"></span>' +
            '<span class="toolbar__note">Urut kronologis · <code>Kartu_Stok</code></span>' +
          '</div>' +
          '<div class="table-wrap">' +
            '<table class="data-table" id="kartu-table">' +
              '<thead><tr>' +
                '<th>Tanggal</th><th>SKU</th><th>Nama Outlet / Keterangan</th><th>Jenis</th>' +
                '<th class="num">Saldo Awal</th><th class="num">Masuk</th><th class="num">Keluar</th>' +
                '<th class="num">Saldo Akhir</th><th>PIC</th>' +
              '</tr></thead>' +
              '<tbody id="kartu-body">' + ui.tableLoadingRow(KARTU_COLSPAN, 4) + '</tbody>' +
            '</table>' +
          '</div>' +
        '</div>' +
      '</section>' +

      '<section class="subpanel" data-subpanel="transfer" hidden>' +
        '<div class="split-grid">' +
          '<div class="card">' +
            '<div class="card__head">' +
              '<div><h3>Form Transfer Antar Gudang</h3><p>Stok asal dipotong dan stok tujuan ditambahkan secara langsung (Direct Transfer).</p></div>' +
            '</div>' +
            '<div class="card__body">' +
              '<form id="transfer-form" novalidate>' +
                '<div class="form-grid">' +
                  '<div class="field">' +
                    '<label for="transfer-source">Gudang Asal</label>' +
                    '<input class="input" id="transfer-source" type="text" value="' + ui.esc(sourceEntity.name || WMS.warehouseCode) + ' (' + ui.esc(WMS.warehouseCode) + ')" readonly>' +
                  '</div>' +
                  '<div class="field">' +
                    '<label for="transfer-target">Gudang Tujuan <span class="req">*</span></label>' +
                    '<select class="select" id="transfer-target" required>' +
                      '<option value="' + ui.esc(target) + '">' + ui.esc(targetEntity.name || target) + ' (' + ui.esc(target) + ')</option>' +
                    '</select>' +
                  '</div>' +
                  '<div class="field">' +
                    '<label for="transfer-sku">Kode SKU <span class="req">*</span></label>' +
                    '<input class="input" id="transfer-sku" type="text" list="transfer-sku-list" placeholder="Pilih atau ketik SKU" required autocomplete="off">' +
                    ui.skuDatalist('transfer-sku-list') +
                    '<p class="field-hint" data-transfer-stock>Stok asal akan ditampilkan setelah SKU dipilih.</p>' +
                  '</div>' +
                  '<div class="field">' +
                    '<label for="transfer-qty">Qty Transfer <span class="req">*</span></label>' +
                    '<input class="input" id="transfer-qty" type="number" min="1" step="1" placeholder="0" required>' +
                  '</div>' +
                  '<div class="field field--full">' +
                    '<label>Surat Jalan / Bukti Transfer <span class="req">*</span></label>' +
                    '<div class="file-drop" data-transfer-drop>' +
                      '<input type="file" id="transfer-file" accept="application/pdf,.pdf">' +
                      '<span class="file-drop__icon">' + ui.ICONS.file + '</span>' +
                      '<span class="file-drop__title">Pilih atau tarik berkas PDF ke sini</span>' +
                      '<span class="file-drop__hint">Wajib PDF · maksimal 5 MB · disalin ke kedua GDrive</span>' +
                    '</div>' +
                    '<div class="file-chip" data-transfer-chip hidden></div>' +
                  '</div>' +
                '</div>' +
                '<div class="form-alert" id="transfer-error" hidden role="alert"></div>' +
                '<div class="form-actions">' +
                  '<button type="button" class="btn btn--ghost" data-transfer-reset>Reset</button>' +
                  '<button type="submit" class="btn btn--primary">Lanjut ke Konfirmasi</button>' +
                '</div>' +
              '</form>' +
            '</div>' +
          '</div>' +

          '<div class="card">' +
            '<div class="card__head"><div><h3>Ketentuan Transfer</h3><p>Operasi dual-write atomik.</p></div></div>' +
            '<div class="card__body">' +
              '<ul class="info-list">' +
                '<li>' + ui.ICONS.info + '<span><strong>Direct Transfer.</strong> Stok asal langsung dipotong <code>-Qty</code> dan stok tujuan ditambah <code>+Qty</code>, status transaksi <code>SELESAI</code>.</span></li>' +
                '<li>' + ui.ICONS.info + '<span><strong>Dual-write.</strong> Tercatat <code>TRANSFER_OUT</code> pada Kartu_Stok gudang asal dan <code>TRANSFER_IN</code> pada gudang tujuan.</span></li>' +
                '<li>' + ui.ICONS.file + '<span><strong>Multi-Drive.</strong> PDF disimpan ke GDrive gudang asal lalu disalin ke GDrive gudang tujuan.</span></li>' +
                '<li>' + ui.ICONS.lock + '<span><strong>LockService.</strong> Backend mengunci proses agar saldo tidak bentrok saat transaksi bersamaan.</span></li>' +
              '</ul>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</section>';
  }

  /* ------------------------------------------------------------------------
   * Stok real-time
   * ---------------------------------------------------------------------- */

  function stockStatus(item) {
    var karantina = ui.num(item.Stok_Karantina);
    if (karantina > 0) return 'KARANTINA';
    var threshold = (WMS.config && WMS.config.LOW_STOCK_THRESHOLD) || 10;
    return ui.num(item.Stok_Aktif) <= threshold ? 'MENIPIS' : 'TERSEDIA';
  }

  function compareStockRows(a, b) {
    var namaA = String(a.Nama_Barang || '').trim();
    var namaB = String(b.Nama_Barang || '').trim();
    var byName = namaA.localeCompare(namaB, undefined, { sensitivity: 'base' });

    if (byName !== 0) return byName;

    return String(a.Kode_SKU || '').trim().localeCompare(
      String(b.Kode_SKU || '').trim(),
      undefined,
      { sensitivity: 'base' }
    );
  }

  function stockSort(items) {
    return items.slice().sort(compareStockRows);
  }

  function setStockStats() {
    if (!panel) return;
    var totalAktif = 0;
    var totalKarantina = 0;
    var menipis = 0;

    state.stockItems.forEach(function (item) {
      totalAktif += ui.num(item.Stok_Aktif);
      totalKarantina += ui.num(item.Stok_Karantina);
      if (stockStatus(item) === 'MENIPIS') menipis++;
    });

    var values = {
      sku: state.stockItems.length,
      aktif: ui.formatNumber(totalAktif),
      karantina: ui.formatNumber(totalKarantina),
      menipis: menipis
    };

    Object.keys(values).forEach(function (key) {
      var el = panel.querySelector('[data-stat="' + key + '"]');
      if (el) el.textContent = values[key];
    });
  }

  /**
   * Teks pencarian satu baris stok (dipakai filter dari array penuh).
   *
   * @param {Object} item Baris Stok_Gudang.
   * @return {string} Teks gabungan huruf kecil.
   */
  function stockSearchText(item) {
    return [item.Kode_SKU, item.Nama_Barang, item.Lokasi_Rak, stockStatus(item)].join(' ').toLowerCase();
  }

  /**
   * Cocokkan teks baris dengan kriteria pencarian ui.filterTable.
   *
   * @param {string} text Teks baris (huruf kecil).
   * @param {Object} criteria Kriteria dari ui.filterTable.
   * @return {boolean} True bila cocok.
   */
  function matchesCriteria(text, criteria) {
    if (!criteria) return true;
    var query = String(criteria.query || '').trim().toLowerCase();
    if (!query) return true;
    return String(text || '').toLowerCase().indexOf(query) !== -1;
  }

  function renderStock() {
    var tbody = panel && panel.querySelector('#stock-body');
    if (!tbody) return;

    var count = panel.querySelector('#stock-count');

    if (!state.stockItems.length) {
      tbody.innerHTML = ui.tableEmptyRow(STOCK_COLSPAN, 'Belum ada posisi stok', 'Stok akan muncul setelah putaway inbound pertama diposting.');
      if (count) count.textContent = '0 SKU';
      return;
    }

    var criteria = state.stockCriteria || null;
    var statusFilter = String((criteria && criteria.values && criteria.values['data-status']) || '').trim();
    var filtered = state.stockItems.filter(function (item) {
      if (statusFilter && stockStatus(item) !== statusFilter) return false;
      return matchesCriteria(stockSearchText(item), criteria);
    });
    var visible = filtered.slice(0, state.stockVisibleLimit);

    tbody.innerHTML = visible.map(function (item) {
      var status = stockStatus(item);
      var kodeSku = String(item.Kode_SKU || '').trim();
      var namaBarang = String(item.Nama_Barang || '').trim();
      var search = stockSearchText(item);
      var namaCell = kodeSku
        ? '<button type="button" class="table-link" data-kartu-sku="' + ui.esc(kodeSku) + '" title="Buka Kartu Stok ' + ui.esc(namaBarang || kodeSku) + '">' +
            ui.esc(namaBarang || '—') +
          '</button>'
        : ui.esc(namaBarang || '—');

      return '<tr data-row data-kartu-sku="' + ui.esc(kodeSku) + '" data-status="' + ui.esc(status) + '" data-search="' + ui.esc(search) + '">' +
        '<td class="nowrap">' + ui.esc(kodeSku || '—') + '</td>' +
        '<td>' + namaCell + '</td>' +
        '<td class="nowrap"><code>' + ui.esc(item.Lokasi_Rak || '—') + '</code></td>' +
        '<td class="num">' + ui.formatQty(item.Stok_Aktif) + '</td>' +
        '<td class="num ' + (ui.num(item.Stok_Karantina) > 0 ? 'num--neg' : '') + '">' + ui.formatQty(item.Stok_Karantina) + '</td>' +
        '<td>' + ui.badge(status) + '</td>' +
        '<td class="nowrap muted">' + ui.esc(ui.formatDateTime(item.Last_Update)) + '</td>' +
      '</tr>';
    }).join('') +
      ui.showMoreRow(STOCK_COLSPAN, visible.length, filtered.length, 'SKU') +
      '<tr class="table-state" data-empty-row hidden><td colspan="' + STOCK_COLSPAN + '">' +
        ui.emptyState('Tidak ada hasil', 'Ubah kata kunci pencarian atau filter status.') +
      '</td></tr>';

    var emptyRow = tbody.querySelector('[data-empty-row]');
    if (emptyRow) emptyRow.hidden = filtered.length > 0;
    if (count) count.textContent = filtered.length + ' SKU';
  }

  function renderStockError(error) {
    var tbody = panel && panel.querySelector('#stock-body');
    if (!tbody) return;
    tbody.innerHTML = ui.tableErrorRow(STOCK_COLSPAN, error && error.message);
    ui.bindRetry(tbody, function () { loadStock({ silent: false }); });
  }

  async function loadStock(options) {
    var gen = ++stockLoadGen;
    var opts = options || {};
    var tbody = panel && panel.querySelector('#stock-body');

    if (!opts.silent && !state.stockLoaded && tbody) tbody.innerHTML = ui.tableLoadingRow(STOCK_COLSPAN, 5);

    try {
      var data = await WMS.api.request('INVENTORY_LIST');
      if (gen !== stockLoadGen) return;
      state.stockItems = stockSort(data && Array.isArray(data.items) ? data.items : []);
      state.stockLoaded = true;
      // Silent refresh mempertahankan jumlah baris yang sedang dibuka user.
      if (!opts.silent) state.stockVisibleLimit = ui.TABLE_PAGE_SIZE;
      setStockStats();
      renderStock();
      updateTransferHint();
    } catch (error) {
      if (gen !== stockLoadGen) return;
      if (WMS.api.isAuthError(error)) return;
      if (opts.silent && state.stockLoaded) {
        ui.toast((error && error.message) || 'Gagal memuat stok.', 'danger');
        return;
      }
      renderStockError(error);
    }
  }

  /* ------------------------------------------------------------------------
   * Kartu stok
   * ---------------------------------------------------------------------- */

  function kartuSort(items) {
    return items.slice().sort(function (a, b) {
      var left = String(a.Tanggal || '') + '|' + String(a.ID_Mutasi || '');
      var right = String(b.Tanggal || '') + '|' + String(b.ID_Mutasi || '');
      return left.localeCompare(right);
    });
  }

  /**
   * Teks pencarian satu baris kartu stok (dipakai filter dari array penuh).
   *
   * @param {Object} item Baris Kartu_Stok.
   * @return {string} Teks gabungan huruf kecil.
   */
  function kartuSearchText(item) {
    var referensi = String(item.Referensi_ID || '').trim();
    var namaOutlet = String(item.namaOutlet || '').trim() || referensi;
    var noDokumen = String(item.noDokumen || '').trim();
    return [
      item.ID_Mutasi, item.Kode_SKU, referensi, namaOutlet, noDokumen,
      item.Jenis_Transaksi, item.PIC
    ].join(' ').toLowerCase();
  }

  function renderKartu() {
    var tbody = panel && panel.querySelector('#kartu-body');
    if (!tbody) return;

    var count = panel.querySelector('#kartu-count');

    if (!state.kartuItems.length) {
      tbody.innerHTML = ui.tableEmptyRow(KARTU_COLSPAN, 'Belum ada mutasi', state.kartuSku
        ? 'Tidak ada pergerakan stok untuk SKU ' + state.kartuSku + '.'
        : 'Mutasi akan tercatat setelah ada transaksi inbound, outbound, transfer, atau adjustment SO.');
      if (count) count.textContent = '0 mutasi';
      return;
    }

    var criteria = state.kartuCriteria || null;
    var filtered = state.kartuItems.filter(function (item) {
      return matchesCriteria(kartuSearchText(item), criteria);
    });
    var visible = filtered.slice(0, state.kartuVisibleLimit);

    tbody.innerHTML = visible.map(function (item) {
      var referensi = String(item.Referensi_ID || '').trim();
      var namaOutlet = String(item.namaOutlet || '').trim() || referensi;
      var noDokumen = String(item.noDokumen || '').trim();
      var subtext = noDokumen || referensi;

      // Hindari sub-teks yang mengulang nama outlet/keterangan utama.
      if (subtext && namaOutlet.toUpperCase().indexOf(subtext.toUpperCase()) !== -1) {
        subtext = '';
      }

      var search = kartuSearchText(item);

      return '<tr data-row data-search="' + ui.esc(search) + '">' +
        '<td class="nowrap muted">' + ui.esc(ui.formatDateTime(item.Tanggal)) + '</td>' +
        '<td class="nowrap">' + ui.esc(item.Kode_SKU || '—') + '</td>' +
        '<td>' + ui.cellStack(namaOutlet || '—', subtext) + '</td>' +
        '<td>' + ui.badge(item.Jenis_Transaksi) + '</td>' +
        '<td class="num">' + ui.formatQty(item.Saldo_Awal) + '</td>' +
        '<td class="num ' + (ui.num(item.Qty_Masuk) > 0 ? 'num--pos' : '') + '">' + ui.formatQty(item.Qty_Masuk) + '</td>' +
        '<td class="num ' + (ui.num(item.Qty_Keluar) > 0 ? 'num--neg' : '') + '">' + ui.formatQty(item.Qty_Keluar) + '</td>' +
        '<td class="num"><strong>' + ui.formatQty(item.Saldo_Akhir) + '</strong></td>' +
        '<td class="nowrap">' + ui.esc(item.PIC || '—') + '</td>' +
      '</tr>';
    }).join('') +
      ui.showMoreRow(KARTU_COLSPAN, visible.length, filtered.length, 'mutasi') +
      '<tr class="table-state" data-empty-row hidden><td colspan="' + KARTU_COLSPAN + '">' +
        ui.emptyState('Tidak ada hasil', 'Ubah kata kunci pencarian atau pilih SKU lain.') +
      '</td></tr>';

    var emptyRow = tbody.querySelector('[data-empty-row]');
    if (emptyRow) emptyRow.hidden = filtered.length > 0;
    if (count) count.textContent = filtered.length + ' mutasi';
  }

  function renderKartuError(error) {
    var tbody = panel && panel.querySelector('#kartu-body');
    if (!tbody) return;
    tbody.innerHTML = ui.tableErrorRow(KARTU_COLSPAN, error && error.message);
    ui.bindRetry(tbody, function () { loadKartu({ silent: false }); });
  }

  async function loadKartu(options) {
    var gen = ++kartuLoadGen;
    var opts = options || {};
    var tbody = panel && panel.querySelector('#kartu-body');
    var select = panel && panel.querySelector('#kartu-sku');
    state.kartuSku = select ? String(select.value || '').trim().toUpperCase() : '';

    if (!opts.silent && !state.kartuLoaded && tbody) tbody.innerHTML = ui.tableLoadingRow(KARTU_COLSPAN, 4);

    try {
      var data = await WMS.api.request('KARTU_STOK', state.kartuSku ? { kodeSku: state.kartuSku } : {});
      if (gen !== kartuLoadGen) return;
      state.kartuItems = kartuSort(data && Array.isArray(data.items) ? data.items : []);
      state.kartuLoaded = true;
      // Silent refresh mempertahankan jumlah baris yang sedang dibuka user.
      if (!opts.silent) state.kartuVisibleLimit = ui.TABLE_PAGE_SIZE;
      renderKartu();
    } catch (error) {
      if (gen !== kartuLoadGen) return;
      if (WMS.api.isAuthError(error)) return;
      if (opts.silent && state.kartuLoaded) {
        ui.toast((error && error.message) || 'Gagal memuat kartu stok.', 'danger');
        return;
      }
      renderKartuError(error);
    }
  }

  /**
   * Buka sub-tab Kartu Stok dan terapkan filter SKU secara otomatis.
   *
   * @param {string} kodeSku Kode SKU dari baris stok yang diklik.
   */
  function openKartuForSku(kodeSku) {
    var sku = String(kodeSku || '').trim().toUpperCase();
    if (!sku || !panel) return;

    var select = panel.querySelector('#kartu-sku');

    if (select) {
      var matched = null;

      Array.prototype.some.call(select.options, function (option) {
        if (String(option.value || '').trim().toUpperCase() === sku) {
          matched = option.value;
          return true;
        }
        return false;
      });

      if (matched === null) {
        var option = document.createElement('option');
        option.value = sku;
        option.textContent = sku;
        select.appendChild(option);
        matched = sku;
      }

      select.value = matched;
    }

    showSub('kartu');
  }

  /* ------------------------------------------------------------------------
   * Transfer antar gudang
   * ---------------------------------------------------------------------- */

  function findStock(kodeSku) {
    var key = String(kodeSku || '').trim().toUpperCase();
    if (!key) return null;
    return state.stockItems.find(function (item) {
      return String(item.Kode_SKU || '').trim().toUpperCase() === key;
    }) || null;
  }

  function updateTransferHint() {
    var hint = panel && panel.querySelector('[data-transfer-stock]');
    var input = panel && panel.querySelector('#transfer-sku');
    if (!hint || !input) return;

    var code = String(input.value || '').trim().toUpperCase();

    if (!code) {
      hint.textContent = 'Stok asal akan ditampilkan setelah SKU dipilih.';
      hint.classList.remove('field-error');
      return;
    }

    var item = findStock(code);

    if (!item) {
      hint.textContent = 'SKU tidak ditemukan pada Stok_Gudang gudang asal.';
      hint.classList.add('field-error');
      return;
    }

    hint.classList.remove('field-error');
    hint.textContent = 'Tersedia ' + ui.formatNumber(ui.num(item.Stok_Aktif)) + ' unit' +
      (item.Lokasi_Rak ? ' di ' + item.Lokasi_Rak : '') +
      (item.Nama_Barang ? ' · ' + item.Nama_Barang : '') + '.';
  }

  function renderTransferChip() {
    var chip = panel && panel.querySelector('[data-transfer-chip]');
    if (!chip) return;

    if (!transferFile) {
      chip.hidden = true;
      chip.innerHTML = '';
      return;
    }

    chip.hidden = false;
    chip.innerHTML =
      '<span class="file-chip__icon">' + ui.ICONS.file + '</span>' +
      '<span class="file-chip__name">' + ui.esc(transferFile.name) + '</span>' +
      '<span class="file-chip__meta">' + ui.esc(WMS.file.formatSize(transferFile.size)) + '</span>' +
      '<button type="button" class="file-chip__remove" data-transfer-file-remove aria-label="Hapus berkas">' + ui.ICONS.close + '</button>';

    var removeButton = chip.querySelector('[data-transfer-file-remove]');
    if (!removeButton) return;
    removeButton.addEventListener('click', function () {
      transferFile = null;
      var input = panel.querySelector('#transfer-file');
      if (input) input.value = '';
      renderTransferChip();
    });
  }

  function resetTransferForm() {
    transferFile = null;
    var input = panel && panel.querySelector('#transfer-file');
    var qty = panel && panel.querySelector('#transfer-qty');
    if (input) input.value = '';
    if (qty) qty.value = '';
    ui.showInlineError(panel && panel.querySelector('#transfer-error'), '');
    renderTransferChip();
    updateTransferHint();
  }

  function bindTransferFile() {
    var input = panel && panel.querySelector('#transfer-file');
    var drop = panel && panel.querySelector('[data-transfer-drop]');
    if (!input) return;

    function setFile(file) {
      if (!file) return;
      try {
        WMS.file.validate(file);
        transferFile = file;
        ui.showInlineError(panel.querySelector('#transfer-error'), '');
        renderTransferChip();
      } catch (error) {
        transferFile = null;
        input.value = '';
        renderTransferChip();
        ui.toast(error.message, 'danger', 'Berkas ditolak');
      }
    }

    input.addEventListener('change', function () {
      setFile(input.files && input.files[0]);
    });

    if (drop) {
      ['dragenter', 'dragover'].forEach(function (name) {
        drop.addEventListener(name, function (event) {
          event.preventDefault();
          drop.classList.add('is-dragover');
        });
      });
      drop.addEventListener('dragleave', function () {
        drop.classList.remove('is-dragover');
      });
      drop.addEventListener('drop', function (event) {
        event.preventDefault();
        drop.classList.remove('is-dragover');
        var dropped = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
        setFile(dropped);
      });
    }
  }

  function openTransferConfirm(data) {
    var source = WMS.warehouseCode;
    var target = data.targetWarehouse;
    var sourceEntity = entity(source) || {};
    var targetEntity = entity(target) || {};

    var body =
      '<div class="transfer-route">' +
        '<div class="transfer-node">' +
          '<span class="transfer-node__label">Gudang Asal</span>' +
          '<span class="transfer-node__code">' + ui.esc(source) + '</span>' +
          '<span class="transfer-node__name">' + ui.esc(sourceEntity.name || source) + '</span>' +
        '</div>' +
        '<div class="transfer-arrow">' + ui.ICONS.arrow + '</div>' +
        '<div class="transfer-node transfer-node--target">' +
          '<span class="transfer-node__label">Gudang Tujuan</span>' +
          '<span class="transfer-node__code">' + ui.esc(target) + '</span>' +
          '<span class="transfer-node__name">' + ui.esc(targetEntity.name || target) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="transfer-summary">' +
        '<div class="detail"><span class="detail__label">SKU / Barang</span><span class="detail__value">' + ui.esc(data.kodeSku) + ' · ' + ui.esc(data.namaBarang || '—') + '</span></div>' +
        '<div class="detail"><span class="detail__label">Qty Transfer</span><span class="detail__value">' + ui.formatNumber(data.qty) + ' unit</span></div>' +
        '<div class="detail"><span class="detail__label">Stok Asal Setelah</span><span class="detail__value">' + ui.formatNumber(data.sourceAfter) + ' unit</span></div>' +
        '<div class="detail"><span class="detail__label">Penambahan Stok Tujuan</span><span class="detail__value">+' + ui.formatNumber(data.qty) + ' unit</span></div>' +
        '<div class="detail detail--full"><span class="detail__label">Surat Jalan</span><span class="detail__value">' + ui.esc(data.file.name) + ' · ' + ui.esc(WMS.file.formatSize(data.file.size)) + '</span></div>' +
      '</div>' +
      '<div class="confirm-panel confirm-panel--warning">' +
        ui.ICONS.alert +
        '<span>Arah transfer <strong>' + ui.esc(source) + ' → ' + ui.esc(target) + '</strong> tidak dapat dibatalkan. Pastikan gudang asal dan tujuan sudah benar.</span>' +
      '</div>';

    ui.confirm({
      eyebrow: 'Inventory · Transfer',
      title: 'Konfirmasi Transfer',
      subtitle: 'Periksa arah perpindahan stok sebelum eksekusi.',
      body: body,
      confirmLabel: 'Eksekusi Transfer',
      cancelLabel: 'Periksa Kembali',
      busyLabel: 'Memproses dual-write…',
      onConfirm: async function () {
        var prepared = await WMS.file.prepare(data.file);
        var result = await WMS.api.request('TRANSFER_GUDANG', {
          targetWarehouse: data.targetWarehouse,
          kodeSku: data.kodeSku,
          qty: data.qty,
          pdfBase64: prepared.base64,
          pdfFileName: prepared.fileName
        }, { timeout: (WMS.config && WMS.config.UPLOAD_TIMEOUT) || 120000 });

        resetTransferForm();
        ui.toast(
          (result.idTransfer || 'Transfer') + ': ' + data.kodeSku + ' ' + ui.formatNumber(data.qty) +
          ' unit dari ' + data.source + ' ke ' + data.target + ' selesai.',
          'success',
          'Transfer berhasil'
        );
        loadStock({ silent: true });
        return true;
      }
    });
  }

  function submitTransfer(event) {
    event.preventDefault();
    var errorBox = panel.querySelector('#transfer-error');
    ui.showInlineError(errorBox, '');

    var targetSelect = panel.querySelector('#transfer-target');
    var skuInput = panel.querySelector('#transfer-sku');
    var qtyInput = panel.querySelector('#transfer-qty');
    var target = String((targetSelect && targetSelect.value) || '').trim().toUpperCase();
    var kodeSku = String((skuInput && skuInput.value) || '').trim().toUpperCase();
    var qty = ui.num(qtyInput && qtyInput.value);

    if (!target) {
      ui.showInlineError(errorBox, 'Gudang tujuan wajib dipilih.');
      return;
    }

    if (target === WMS.warehouseCode) {
      ui.showInlineError(errorBox, 'Gudang tujuan harus berbeda dari gudang asal.');
      return;
    }

    if (!kodeSku) {
      ui.showInlineError(errorBox, 'Kode SKU wajib diisi.');
      return;
    }

    var stock = findStock(kodeSku);

    if (!stock) {
      ui.showInlineError(errorBox, 'SKU ' + kodeSku + ' tidak ditemukan pada stok gudang asal.');
      return;
    }

    if (!(qty > 0)) {
      ui.showInlineError(errorBox, 'Qty transfer harus lebih besar dari 0.');
      return;
    }

    var available = ui.num(stock.Stok_Aktif);

    if (qty > available) {
      ui.showInlineError(errorBox, 'Stok aktif tidak mencukupi. Tersedia ' + ui.formatNumber(available) + ' unit.');
      return;
    }

    if (!transferFile) {
      ui.showInlineError(errorBox, 'Surat jalan PDF wajib diunggah.');
      return;
    }

    try {
      WMS.file.validate(transferFile);
    } catch (error) {
      ui.showInlineError(errorBox, error.message);
      return;
    }

    openTransferConfirm({
      targetWarehouse: target,
      kodeSku: kodeSku,
      namaBarang: String(stock.Nama_Barang || ''),
      qty: qty,
      sourceNow: available,
      sourceAfter: available - qty,
      targetNow: 0,
      file: transferFile
    });
  }

  /* ------------------------------------------------------------------------
   * Sub-tab & mount
   * ---------------------------------------------------------------------- */

  function showSub(name) {
    state.sub = name;
    var forceFresh = WMS.consumeDirty && WMS.consumeDirty('inventory');

    panel.querySelectorAll('[data-sub]').forEach(function (button) {
      var active = button.getAttribute('data-sub') === name;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    panel.querySelectorAll('[data-subpanel]').forEach(function (section) {
      section.hidden = section.getAttribute('data-subpanel') !== name;
    });

    if (name === 'stock') {
      // SWR: saat kembali ke sub-tab yang sudah punya data, tampilkan data lama
      // dan perbarui diam-diam di latar belakang.
      if (forceFresh || !state.stockLoaded) loadStock({ silent: false });
      else loadStock({ silent: true });
    } else if (name === 'kartu') {
      if (forceFresh || !state.kartuLoaded) loadKartu({ silent: false });
      else loadKartu({ silent: true });
    } else if (name === 'transfer') {
      if (!state.stockLoaded) loadStock({ silent: true });
      updateTransferHint();
    }
  }

  function refreshCurrent() {
    if (WMS.master && WMS.master.invalidate) WMS.master.invalidate();
    if (WMS.consumeDirty) WMS.consumeDirty('inventory');
    if (state.sub === 'kartu') return loadKartu({ silent: false });
    return loadStock({ silent: false });
  }

  function mount(root) {
    panel = root;
    root.innerHTML = template();

    state.stockFilter = ui.filterTable({
      table: '#stock-table',
      search: '#stock-search',
      count: '#stock-count',
      countLabel: 'SKU',
      filters: [{ selector: '#stock-filter', attr: 'data-status' }],
      onFilter: function (criteria) {
        // Filter dari seluruh array, lalu render ulang dengan cap 100 baris.
        state.stockCriteria = criteria;
        state.stockVisibleLimit = ui.TABLE_PAGE_SIZE;
        renderStock();
      }
    });

    state.kartuFilter = ui.filterTable({
      table: '#kartu-table',
      search: '#kartu-search',
      count: '#kartu-count',
      countLabel: 'mutasi',
      onFilter: function (criteria) {
        state.kartuCriteria = criteria;
        state.kartuVisibleLimit = ui.TABLE_PAGE_SIZE;
        renderKartu();
      }
    });

    root.querySelectorAll('[data-sub]').forEach(function (button) {
      button.addEventListener('click', function () {
        showSub(button.getAttribute('data-sub'));
      });
    });

    var stockBody = root.querySelector('#stock-body');
    if (stockBody) {
      stockBody.addEventListener('click', function (event) {
        var moreButton = event.target.closest ? event.target.closest('[data-show-more]') : null;
        if (moreButton) {
          state.stockVisibleLimit += ui.TABLE_PAGE_SIZE;
          renderStock();
          return;
        }
        var trigger = event.target.closest ? event.target.closest('[data-kartu-sku]') : null;
        if (!trigger) return;
        openKartuForSku(trigger.getAttribute('data-kartu-sku'));
      });
    }

    var kartuBody = root.querySelector('#kartu-body');
    if (kartuBody) {
      kartuBody.addEventListener('click', function (event) {
        var moreButton = event.target.closest ? event.target.closest('[data-show-more]') : null;
        if (!moreButton) return;
        state.kartuVisibleLimit += ui.TABLE_PAGE_SIZE;
        renderKartu();
      });
    }

    var refreshButton = root.querySelector('[data-action="refresh"]');
    if (refreshButton) refreshButton.addEventListener('click', refreshCurrent);

    var kartuSelect = root.querySelector('#kartu-sku');
    if (kartuSelect) {
      kartuSelect.addEventListener('change', function () { loadKartu({ silent: false }); });
    }

    var skuInput = root.querySelector('#transfer-sku');
    if (skuInput) {
      skuInput.addEventListener('input', function () {
        skuInput.value = skuInput.value.toUpperCase();
        updateTransferHint();
      });
    }

    var transferForm = root.querySelector('#transfer-form');
    if (transferForm) transferForm.addEventListener('submit', submitTransfer);
    var resetButton = root.querySelector('[data-transfer-reset]');
    if (resetButton) resetButton.addEventListener('click', resetTransferForm);

    bindTransferFile();

    return loadStock({ silent: false });
  }

  WMS.registerModule({
    id: 'inventory',
    label: 'Inventory & Transfer',
    eyebrow: 'Modul 3 · Persediaan',
    title: 'Inventory & Transfer',
    mount: mount,
    refresh: function () {
      if (WMS.consumeDirty) WMS.consumeDirty('inventory');
      if (state.sub === 'kartu') return loadKartu({ silent: true });
      return loadStock({ silent: true });
    },
    refreshAllData: async function () {
      await Promise.all([
        loadStock({ silent: true }),
        loadKartu({ silent: true })
      ]);
    }
  });
})(window);
