/**
 * mod-inbound.js — Modul 1 Inbound (Putaway penerimaan)
 * Sumber data: Inbound_Log dengan status PENDING_PUTAWAY (dibuat AppSheet).
 */

(function (global) {
  'use strict';

  var WMS = global.WMS;
  if (!WMS || !WMS.registerModule) return;

  var ui = WMS.ui;
  var COLSPAN = 8;
  var state = { items: [], loaded: false };
  var panel = null;
  var filterCtl = null;

  function template() {
    return '' +
      '<div class="module-head">' +
        '<div>' +
          '<p class="eyebrow">Modul 1 · Barang Masuk</p>' +
          '<h2>Inbound — Putaway</h2>' +
          '<p class="module-head__desc">Finalisasi penerimaan hasil RCV &amp; QC AppSheet. Posting <code>Qty_QC_Pass</code> ke stok aktif dan catat sisa reject ke stok karantina.</p>' +
        '</div>' +
        '<div class="module-head__actions">' +
          '<button type="button" class="btn btn--ghost btn--sm" data-action="refresh">' + ui.ICONS.refresh + ' Muat Ulang</button>' +
        '</div>' +
      '</div>' +

      '<div class="stat-grid">' +
        '<article class="stat-card stat-card--accent">' +
          '<span class="stat-card__label">Menunggu Putaway</span>' +
          '<strong class="stat-card__value" data-stat="pending">—</strong>' +
          '<span class="stat-card__meta">Transaksi PENDING_PUTAWAY</span>' +
        '</article>' +
        '<article class="stat-card">' +
          '<span class="stat-card__label">Total QC Pass</span>' +
          '<strong class="stat-card__value" data-stat="qc">—</strong>' +
          '<span class="stat-card__meta">Unit siap masuk stok aktif</span>' +
        '</article>' +
        '<article class="stat-card">' +
          '<span class="stat-card__label">Total Karantina</span>' +
          '<strong class="stat-card__value" data-stat="karantina">—</strong>' +
          '<span class="stat-card__meta">Unit reject menunggu keputusan</span>' +
        '</article>' +
        '<article class="stat-card">' +
          '<span class="stat-card__label">Supplier</span>' +
          '<strong class="stat-card__value" data-stat="supplier">—</strong>' +
          '<span class="stat-card__meta">Pemasok pada antrean ini</span>' +
        '</article>' +
      '</div>' +

      '<div class="card">' +
        '<div class="card__head">' +
          '<div>' +
            '<h3>Antrean Penerimaan</h3>' +
            '<p>Pilih transaksi lalu tentukan lokasi rak tujuan.</p>' +
          '</div>' +
          '<span class="pill" id="inbound-count">0 transaksi</span>' +
        '</div>' +
        '<div class="toolbar">' +
          ui.searchField('inbound-search', 'Cari ID, PO, supplier, SKU…') +
          '<select id="inbound-filter" class="select select--sm" aria-label="Filter status inbound">' +
            '<option value="">Semua status</option>' +
            '<option value="PENDING_PUTAWAY">PENDING_PUTAWAY</option>' +
            '<option value="PUTAWAY_COMPLETED">PUTAWAY_COMPLETED</option>' +
          '</select>' +
          '<select id="inbound-qc-filter" class="select select--sm" aria-label="Filter kondisi QC">' +
            '<option value="">Semua kondisi QC</option>' +
            '<option value="karantina">Ada karantina</option>' +
            '<option value="lolos">Tanpa karantina</option>' +
          '</select>' +
          '<span class="toolbar__spacer"></span>' +
          '<span class="toolbar__note">Sumber: <code>Inbound_Log</code></span>' +
        '</div>' +
        '<div class="table-wrap">' +
          '<table class="data-table data-table--compact" id="inbound-table">' +
            '<thead><tr>' +
              '<th>ID Inbound</th>' +
              '<th>No PO / Supplier</th>' +
              '<th>Barang</th>' +
              '<th class="num">Qty RCV</th>' +
              '<th class="num">QC Pass</th>' +
              '<th class="num">Karantina</th>' +
              '<th>Status</th>' +
              '<th class="actions-cell">Aksi</th>' +
            '</tr></thead>' +
            '<tbody id="inbound-body">' +
              ui.tableLoadingRow(COLSPAN, 5) +
            '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>';
  }

  function setStats() {
    if (!panel) return;
    var pending = state.items.filter(function (item) {
      return String(item.Status_Inbound || '').toUpperCase() === 'PENDING_PUTAWAY';
    });
    var qc = 0;
    var karantina = 0;
    var suppliers = {};
    pending.forEach(function (item) {
      qc += ui.num(item.Qty_QC_Pass);
      karantina += ui.num(item.Qty_Karantina);
      var supplier = String(item.Supplier || '').trim();
      if (supplier) suppliers[supplier.toLowerCase()] = true;
    });

    var values = {
      pending: pending.length,
      qc: ui.formatNumber(qc),
      karantina: ui.formatNumber(karantina),
      supplier: Object.keys(suppliers).length
    };

    Object.keys(values).forEach(function (key) {
      var el = panel.querySelector('[data-stat="' + key + '"]');
      if (el) el.textContent = values[key];
    });
  }

  function renderRows() {
    var tbody = panel && panel.querySelector('#inbound-body');
    if (!tbody) return;

    if (!state.items.length) {
      tbody.innerHTML = ui.tableEmptyRow(COLSPAN, 'Antrean putaway kosong', 'Semua penerimaan sudah difinalisasi atau belum ada data QC masuk.');
      if (filterCtl) filterCtl.apply();
      return;
    }

    tbody.innerHTML = state.items.map(function (item) {
      var status = String(item.Status_Inbound || '').trim().toUpperCase();
      var karantina = ui.num(item.Qty_Karantina);
      var isPending = status === 'PENDING_PUTAWAY';
      var search = [
        item.ID_Inbound, item.No_PO_SJ, item.Supplier, item.Kode_SKU, item.Nama_Barang, status
      ].join(' ').toLowerCase();

      return '<tr data-row data-status="' + ui.esc(status) + '" data-qc="' + (karantina > 0 ? 'karantina' : 'lolos') + '" data-search="' + ui.esc(search) + '">' +
        '<td>' + ui.cellStack(item.ID_Inbound || '—', ui.formatDate(item.Tanggal)) + '</td>' +
        '<td>' + ui.cellStack(item.No_PO_SJ || '—', item.Supplier || '') + '</td>' +
        '<td>' + ui.cellStack(item.Kode_SKU, item.Nama_Barang) + '</td>' +
        '<td class="num">' + ui.formatQty(item.Qty_RCV) + '</td>' +
        '<td class="num num--pos">' + ui.formatQty(item.Qty_QC_Pass) + '</td>' +
        '<td class="num ' + (karantina > 0 ? 'num--neg' : '') + '">' + ui.formatQty(item.Qty_Karantina) + '</td>' +
        '<td>' + ui.badge(status) + '</td>' +
        '<td class="actions-cell">' +
          '<div class="table-actions">' +
            ui.pdfLink(item.Link_PDF) +
            (isPending
              ? '<button type="button" class="btn btn--primary btn--sm" data-putaway="' + ui.esc(item.ID_Inbound) + '">Alokasikan Rak</button>'
              : '<span class="muted" style="font-size:11.5px">Selesai</span>') +
          '</div>' +
        '</td>' +
      '</tr>';
    }).join('') +
      '<tr class="table-state" data-empty-row hidden><td colspan="' + COLSPAN + '">' +
        ui.emptyState('Tidak ada hasil', 'Ubah kata kunci pencarian atau filter status.') +
      '</td></tr>';

    if (filterCtl) filterCtl.apply();
  }

  function renderError(error) {
    var tbody = panel && panel.querySelector('#inbound-body');
    if (!tbody) return;
    tbody.innerHTML = ui.tableErrorRow(COLSPAN, error && error.message);
    ui.bindRetry(tbody, function () { load({ silent: false }); });
  }

  async function load(options) {
    var opts = options || {};
    var tbody = panel && panel.querySelector('#inbound-body');

    if (!opts.silent && tbody) tbody.innerHTML = ui.tableLoadingRow(COLSPAN, 5);

    try {
      var data = await WMS.api.request('INBOUND_PENDING');
      state.items = data && Array.isArray(data.items) ? data.items : [];
      state.loaded = true;
      setStats();
      renderRows();
    } catch (error) {
      if (WMS.api.isAuthError(error)) return;
      if (opts.silent && state.loaded) {
        ui.toast((error && error.message) || 'Gagal memuat antrean inbound.', 'danger');
        return;
      }
      renderError(error);
    }
  }

  function findItem(id) {
    return state.items.find(function (item) {
      return String(item.ID_Inbound) === String(id);
    }) || null;
  }

  function openPutaway(item) {
    if (!item) return;

    var detail =
      '<div class="detail-grid">' +
        '<div class="detail"><span class="detail__label">ID Inbound</span><span class="detail__value">' + ui.esc(item.ID_Inbound) + '</span></div>' +
        '<div class="detail"><span class="detail__label">No PO / Surat Jalan</span><span class="detail__value">' + ui.esc(item.No_PO_SJ || '—') + '</span></div>' +
        '<div class="detail"><span class="detail__label">Supplier</span><span class="detail__value">' + ui.esc(item.Supplier || '—') + '</span></div>' +
        '<div class="detail"><span class="detail__label">Tanggal</span><span class="detail__value">' + ui.esc(ui.formatDateTime(item.Tanggal)) + '</span></div>' +
        '<div class="detail detail--full"><span class="detail__label">Barang</span><span class="detail__value">' + ui.esc(item.Kode_SKU || '—') + ' · ' + ui.esc(item.Nama_Barang || '') + '</span></div>' +
        '<div class="detail"><span class="detail__label">Qty RCV</span><span class="detail__value">' + ui.formatQty(item.Qty_RCV) + '</span></div>' +
        '<div class="detail"><span class="detail__label">QC Pass → Stok Aktif</span><span class="detail__value">' + ui.formatQty(item.Qty_QC_Pass) + '</span></div>' +
        '<div class="detail"><span class="detail__label">Karantina</span><span class="detail__value">' + ui.formatQty(item.Qty_Karantina) + '</span></div>' +
        '<div class="detail"><span class="detail__label">Dokumen</span><span class="detail__value">' + ui.pdfLink(item.Link_PDF) + '</span></div>' +
      '</div>';

    var body =
      detail +
      '<form id="putaway-form" novalidate>' +
        '<div class="field">' +
          '<label for="putaway-rak">Lokasi Rak <span class="req">*</span></label>' +
          '<input class="input" id="putaway-rak" name="lokasiRak" type="text" placeholder="Contoh: RAK-A-03" maxlength="40" required autocomplete="off">' +
          '<p class="field-hint">Gunakan kode rak fisik yang berlaku di gudang. Lokasi ini tersimpan pada baris stok SKU.</p>' +
        '</div>' +
        '<div class="form-alert" id="putaway-error" hidden role="alert"></div>' +
        '<div class="confirm-panel" style="margin-top:14px">' +
          ui.ICONS.info +
          '<span>Setelah diposting, <strong>' + ui.formatQty(item.Qty_QC_Pass) + ' unit</strong> masuk ke <strong>Stok_Aktif</strong> dan transaksi berubah menjadi <strong>PUTAWAY_COMPLETED</strong>.</span>' +
        '</div>' +
      '</form>';

    var ref = ui.openModal({
      eyebrow: 'Inbound · Putaway',
      title: 'Alokasikan Lokasi Rak',
      subtitle: item.ID_Inbound + ' · ' + (item.No_PO_SJ || 'Tanpa PO'),
      size: 'lg',
      body: body,
      footer:
        '<button type="button" class="btn btn--ghost" data-modal-close>Batal</button>' +
        '<button type="submit" class="btn btn--primary" form="putaway-form" data-submit>Posting Putaway</button>',
      onMount: function (modal, close) {
        var form = modal.querySelector('#putaway-form');
        var input = modal.querySelector('#putaway-rak');
        var errorBox = modal.querySelector('#putaway-error');
        var submit = modal.querySelector('[data-submit]');

        form.addEventListener('submit', async function (event) {
          event.preventDefault();
          ui.showInlineError(errorBox, '');

          var lokasi = String(input.value || '').trim();

          if (lokasi.length < 2) {
            ui.showInlineError(errorBox, 'Lokasi rak wajib diisi minimal 2 karakter.');
            input.focus();
            return;
          }

          ui.setBusy(submit, true, 'Memposting…');

          try {
            var result = await WMS.api.request('INBOUND_PUTAWAY', {
              idInbound: item.ID_Inbound,
              lokasiRak: lokasi
            });

            close('saved');
            ui.toast(
              'Saldo aktif ' + (result.kodeSku || item.Kode_SKU) + ' menjadi ' + ui.formatNumber(ui.num(result.saldoAkhir)) + ' unit di ' + lokasi + '.',
              'success',
              'Putaway ' + item.ID_Inbound + ' selesai'
            );
            await load({ silent: true });
          } catch (error) {
            if (WMS.api.isAuthError(error)) {
              close('auth');
              return;
            }
            ui.setBusy(submit, false);
            ui.showInlineError(errorBox, (error && error.message) || 'Putaway gagal diproses.');
          }
        });
      }
    });

    if (ref) {
      var input = ref.element.querySelector('#putaway-rak');
      if (input) {
        input.addEventListener('input', function () {
          input.value = input.value.toUpperCase();
        });
      }
    }
  }

  function mount(root) {
    panel = root;
    root.innerHTML = template();

    filterCtl = ui.filterTable({
      table: '#inbound-table',
      search: '#inbound-search',
      count: '#inbound-count',
      countLabel: 'transaksi',
      filters: [
        { selector: '#inbound-filter', attr: 'data-status' },
        { selector: '#inbound-qc-filter', attr: 'data-qc' }
      ]
    });

    root.querySelector('[data-action="refresh"]').addEventListener('click', function () {
      load({ silent: false });
    });

    var tbody = root.querySelector('#inbound-body');
    tbody.addEventListener('click', function (event) {
      var button = event.target.closest ? event.target.closest('[data-putaway]') : null;
      if (!button) return;
      openPutaway(findItem(button.getAttribute('data-putaway')));
    });

    return load({ silent: false });
  }

  WMS.registerModule({
    id: 'inbound',
    label: 'Inbound',
    eyebrow: 'Modul 1 · Barang Masuk',
    title: 'Inbound',
    description: 'Putaway penerimaan',
    mount: mount,
    refresh: function () { return load({ silent: true }); }
  });
})(window);
