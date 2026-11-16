/**
 * mod-opname.js — Modul 4 Stock Opname (Approval Supervisor)
 */

(function (global) {
  'use strict';

  var WMS = global.WMS;
  if (!WMS || !WMS.registerModule) return;

  var ui = WMS.ui;
  var COLSPAN = 8;
  var state = { items: [], loaded: false, locked: false };
  var panel = null;
  var filterCtl = null;

  function template() {
    return '' +
      '<div class="module-head">' +
        '<div>' +
          '<p class="eyebrow">Modul 4 · Stock Opname</p>' +
          '<h2>Approval Stock Opname</h2>' +
          '<p class="module-head__desc">Verifikasi selisih hasil hitung fisik dari AppSheet. Approval akan menyesuaikan Stok_Aktif dan mencatat mutasi ADJUSTMENT_SO.</p>' +
        '</div>' +
        '<div class="module-head__actions">' +
          '<button type="button" class="btn btn--ghost btn--sm" data-action="refresh">' + ui.ICONS.refresh + ' Muat Ulang</button>' +
        '</div>' +
      '</div>' +

      '<div class="stat-grid">' +
        '<article class="stat-card stat-card--accent">' +
          '<span class="stat-card__label">Menunggu Approval</span>' +
          '<strong class="stat-card__value" data-stat="pending">—</strong>' +
          '<span class="stat-card__meta">Sesi PENDING_APPROVAL</span>' +
        '</article>' +
        '<article class="stat-card">' +
          '<span class="stat-card__label">Surplus</span>' +
          '<strong class="stat-card__value" data-stat="plus">—</strong>' +
          '<span class="stat-card__meta">Stok fisik &gt; stok sistem</span>' +
        '</article>' +
        '<article class="stat-card">' +
          '<span class="stat-card__label">Minus</span>' +
          '<strong class="stat-card__value" data-stat="minus">—</strong>' +
          '<span class="stat-card__meta">Stok fisik &lt; stok sistem</span>' +
        '</article>' +
        '<article class="stat-card">' +
          '<span class="stat-card__label">Total Selisih</span>' +
          '<strong class="stat-card__value" data-stat="total">—</strong>' +
          '<span class="stat-card__meta">Akumulasi nilai absolut</span>' +
        '</article>' +
      '</div>' +

      '<div class="card">' +
        '<div class="card__head">' +
          '<div>' +
            '<h3>Antrean Persetujuan</h3>' +
            '<p>Keputusan hanya dapat dilakukan oleh Supervisor.</p>' +
          '</div>' +
          '<span class="pill" id="opname-count">0 sesi</span>' +
        '</div>' +
        '<div class="toolbar">' +
          ui.searchField('opname-search', 'Cari ID SO, SKU…') +
          '<select id="opname-filter" class="select select--sm" aria-label="Filter jenis selisih">' +
            '<option value="">Semua selisih</option>' +
            '<option value="surplus">Surplus (+)</option>' +
            '<option value="minus">Minus (−)</option>' +
            '<option value="zero">Cocok (0)</option>' +
          '</select>' +
          '<span class="toolbar__spacer"></span>' +
          '<span class="toolbar__note">Sumber: <code>Stock_Opname</code></span>' +
        '</div>' +
        '<div class="table-wrap">' +
          '<table class="data-table" id="opname-table">' +
            '<thead><tr>' +
              '<th>ID SO</th><th>Tanggal SO</th><th>SKU</th>' +
              '<th class="num">Stok Sistem</th><th class="num">Stok Fisik</th><th class="num">Selisih</th>' +
              '<th>Status</th><th class="actions-cell">Keputusan</th>' +
            '</tr></thead>' +
            '<tbody id="opname-body">' + ui.tableLoadingRow(COLSPAN, 4) + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>';
  }

  function lockedTemplate() {
    return '' +
      '<div class="locked-panel">' +
        '<span class="locked-panel__icon">' + ui.ICONS.lock + '</span>' +
        '<h3>Akses Terbatas</h3>' +
        '<p>Approval &amp; adjustment Stock Opname hanya dapat dijalankan oleh pengguna dengan role <strong>SUPERVISOR</strong>. Hubungi supervisor gudang untuk meninjau selisih hitung fisik.</p>' +
        '<button type="button" class="btn btn--primary" data-goto="inbound">Kembali ke Inbound</button>' +
      '</div>';
  }

  function setStats() {
    if (!panel) return;
    var plus = 0;
    var minus = 0;
    var total = 0;

    state.items.forEach(function (item) {
      var diff = ui.num(item.Selisih);
      if (diff > 0) plus++;
      else if (diff < 0) minus++;
      total += Math.abs(diff);
    });

    var values = {
      pending: state.items.length,
      plus: plus,
      minus: minus,
      total: ui.formatNumber(total)
    };

    Object.keys(values).forEach(function (key) {
      var el = panel.querySelector('[data-stat="' + key + '"]');
      if (el) el.textContent = values[key];
    });
  }

  function diffClass(diff) {
    if (diff > 0) return 'num--pos';
    if (diff < 0) return 'num--neg';
    return '';
  }

  function diffLabel(diff) {
    if (diff > 0) return '+' + ui.formatNumber(diff);
    if (diff < 0) return '−' + ui.formatNumber(Math.abs(diff));
    return '0';
  }

  function renderRows() {
    var tbody = panel && panel.querySelector('#opname-body');
    if (!tbody) return;

    if (!state.items.length) {
      tbody.innerHTML = ui.tableEmptyRow(COLSPAN, 'Tidak ada SO menunggu approval', 'Sesi opname baru akan tampil setelah tim lapangan menyelesaikan hitung fisik di AppSheet.');
      if (filterCtl) filterCtl.apply();
      return;
    }

    var sorted = state.items.slice().sort(function (a, b) {
      return String(b.Tanggal_SO || '').localeCompare(String(a.Tanggal_SO || ''));
    });

    tbody.innerHTML = sorted.map(function (item) {
      var diff = ui.num(item.Selisih);
      var kind = diff > 0 ? 'surplus' : (diff < 0 ? 'minus' : 'zero');
      var search = [item.ID_SO, item.Kode_SKU, item.Status_SO].join(' ').toLowerCase();

      return '<tr data-row data-selisih="' + kind + '" data-search="' + ui.esc(search) + '">' +
        '<td>' + ui.esc(item.ID_SO || '—') + '</td>' +
        '<td class="nowrap muted">' + ui.esc(ui.formatDateTime(item.Tanggal_SO)) + '</td>' +
        '<td>' + ui.esc(item.Kode_SKU || '—') + '</td>' +
        '<td class="num">' + ui.formatQty(item.Stok_Sistem) + '</td>' +
        '<td class="num">' + ui.formatQty(item.Stok_Fisik) + '</td>' +
        '<td class="num ' + diffClass(diff) + '"><strong>' + diffLabel(diff) + '</strong></td>' +
        '<td>' + ui.badge(item.Status_SO || 'PENDING_APPROVAL') + '</td>' +
        '<td class="actions-cell">' +
          '<div class="btn-row" style="justify-content:flex-end">' +
            '<button type="button" class="btn btn--primary btn--sm" data-approve="' + ui.esc(item.ID_SO) + '">Approve</button>' +
            '<button type="button" class="btn btn--danger-ghost btn--sm" data-reject="' + ui.esc(item.ID_SO) + '">Reject</button>' +
          '</div>' +
        '</td>' +
      '</tr>';
    }).join('') +
      '<tr class="table-state" data-empty-row hidden><td colspan="' + COLSPAN + '">' +
        ui.emptyState('Tidak ada hasil', 'Ubah kata kunci pencarian atau filter selisih.') +
      '</td></tr>';

    if (filterCtl) filterCtl.apply();
  }

  function renderError(error) {
    var tbody = panel && panel.querySelector('#opname-body');
    if (!tbody) return;
    tbody.innerHTML = ui.tableErrorRow(COLSPAN, error && error.message);
    ui.bindRetry(tbody, function () { load({ silent: false }); });
  }

  async function load(options) {
    if (state.locked) return;
    var opts = options || {};
    var tbody = panel && panel.querySelector('#opname-body');

    if (!opts.silent && tbody) tbody.innerHTML = ui.tableLoadingRow(COLSPAN, 4);

    try {
      var data = await WMS.api.request('OPNAME_PENDING');
      state.items = data && Array.isArray(data.items) ? data.items : [];
      state.loaded = true;
      setStats();
      renderRows();
    } catch (error) {
      if (WMS.api.isAuthError(error)) return;
      if (opts.silent && state.loaded) {
        ui.toast((error && error.message) || 'Gagal memuat antrean opname.', 'danger');
        return;
      }
      renderError(error);
    }
  }

  function findItem(id) {
    return state.items.find(function (item) {
      return String(item.ID_SO) === String(id);
    }) || null;
  }

  function soDetail(item) {
    var diff = ui.num(item.Selisih);
    return '<div class="detail-grid">' +
      '<div class="detail"><span class="detail__label">ID SO</span><span class="detail__value">' + ui.esc(item.ID_SO) + '</span></div>' +
      '<div class="detail"><span class="detail__label">Tanggal SO</span><span class="detail__value">' + ui.esc(ui.formatDateTime(item.Tanggal_SO)) + '</span></div>' +
      '<div class="detail detail--full"><span class="detail__label">Kode SKU</span><span class="detail__value">' + ui.esc(item.Kode_SKU || '—') + ' · ' + ui.esc(ui.skuLabel(item.Kode_SKU) || 'Nama barang tidak ditemukan pada master') + '</span></div>' +
      '<div class="detail"><span class="detail__label">Stok Sistem</span><span class="detail__value">' + ui.formatQty(item.Stok_Sistem) + ' unit</span></div>' +
      '<div class="detail"><span class="detail__label">Stok Fisik</span><span class="detail__value">' + ui.formatQty(item.Stok_Fisik) + ' unit</span></div>' +
      '<div class="detail"><span class="detail__label">Selisih</span><span class="detail__value ' + (diff === 0 ? '' : (diff > 0 ? 'num--pos' : 'num--neg')) + '">' + diffLabel(diff) + ' unit</span></div>' +
      '<div class="detail"><span class="detail__label">Status</span><span class="detail__value">' + ui.badge(item.Status_SO || 'PENDING_APPROVAL') + '</span></div>' +
    '</div>';
  }

  function approve(item) {
    var diff = ui.num(item.Selisih);
    var body = soDetail(item) +
      '<div class="confirm-panel ' + (diff === 0 ? 'confirm-panel--success' : 'confirm-panel--warning') + '">' +
        ui.ICONS.alert +
        '<span>' +
          (diff === 0
            ? 'Stok fisik sama dengan stok sistem. Tidak ada adjustment yang diperlukan, status SO tetap menjadi <strong>APPROVED</strong>.'
            : 'Stok_Aktif akan disetel dari <strong>' + ui.formatQty(item.Stok_Sistem) + '</strong> menjadi <strong>' + ui.formatQty(item.Stok_Fisik) + '</strong> unit' +
              (diff !== 0 ? ', lalu selisih <strong>' + diffLabel(diff) + '</strong> dicatat sebagai <strong>ADJUSTMENT_SO</strong>.' : '.')) +
        '</span>' +
      '</div>';

    ui.confirm({
      eyebrow: 'Stock Opname · Approval',
      title: 'Setujui Stock Opname',
      subtitle: item.ID_SO + ' · ' + item.Kode_SKU,
      body: body,
      confirmLabel: 'Approve & Adjust',
      cancelLabel: 'Batal',
      busyLabel: 'Menyimpan keputusan…',
      onConfirm: async function () {
        var result = await WMS.api.request('OPNAME_DECISION', {
          idSo: item.ID_SO,
          decision: 'APPROVED'
        });
        ui.toast(
          'SO ' + item.ID_SO + ' disetujui. Saldo aktif ' + item.Kode_SKU + ' menjadi ' +
          ui.formatNumber(ui.num(result.saldoAkhir)) + ' unit.',
          'success',
          'Adjustment diposting'
        );
        await load({ silent: true });
        return true;
      }
    });
  }

  function reject(item) {
    var body = soDetail(item) +
      '<div class="confirm-panel confirm-panel--danger">' +
        ui.ICONS.alert +
        '<span>Reject akan menutup sesi ini tanpa mengubah stok. Tim lapangan perlu membuat sesi opname baru bila hitung fisik harus diulang.</span>' +
      '</div>';

    ui.confirm({
      eyebrow: 'Stock Opname · Approval',
      title: 'Tolak Stock Opname',
      subtitle: item.ID_SO + ' · ' + item.Kode_SKU,
      body: body,
      confirmLabel: 'Reject Sesi',
      cancelLabel: 'Batal',
      confirmClass: 'btn--danger',
      busyLabel: 'Menyimpan keputusan…',
      onConfirm: async function () {
        await WMS.api.request('OPNAME_DECISION', {
          idSo: item.ID_SO,
          decision: 'REJECTED'
        });
        ui.toast('SO ' + item.ID_SO + ' ditolak. Stok tidak berubah.', 'warning', 'Sesi ditolak');
        await load({ silent: true });
        return true;
      }
    });
  }

  function mount(root) {
    panel = root;

    if (!WMS.auth.isSupervisor()) {
      state.locked = true;
      root.innerHTML = lockedTemplate();
      return Promise.resolve();
    }

    state.locked = false;
    root.innerHTML = template();

    filterCtl = ui.filterTable({
      table: '#opname-table',
      search: '#opname-search',
      count: '#opname-count',
      countLabel: 'sesi',
      filters: [{ selector: '#opname-filter', attr: 'data-selisih' }]
    });

    root.querySelector('[data-action="refresh"]').addEventListener('click', function () {
      load({ silent: false });
    });

    var tbody = root.querySelector('#opname-body');
    tbody.addEventListener('click', function (event) {
      var approveBtn = event.target.closest ? event.target.closest('[data-approve]') : null;
      if (approveBtn) {
        approve(findItem(approveBtn.getAttribute('data-approve')));
        return;
      }
      var rejectBtn = event.target.closest ? event.target.closest('[data-reject]') : null;
      if (rejectBtn) {
        reject(findItem(rejectBtn.getAttribute('data-reject')));
      }
    });

    return load({ silent: false });
  }

  WMS.registerModule({
    id: 'opname',
    label: 'Stock Opname',
    eyebrow: 'Modul 4 · Stock Opname',
    title: 'Stock Opname',
    description: 'Approval supervisor',
    requiresRole: 'SUPERVISOR',
    mount: mount,
    refresh: function () { return load({ silent: true }); }
  });
})(window);
