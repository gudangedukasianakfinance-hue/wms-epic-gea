/**
 * mod-procurement.js — Modul 5 Pengajuan Order & Surat Kesepakatan
 * ---------------------------------------------------------------------------
 * - Daftar dokumen pengajuan dikelompokkan per No_Surat (PROCUREMENT_LIST).
 * - Form pengajuan dinamis: Tanpa Kesepakatan (PR) / Dengan Kesepakatan (SPK)
 *   dengan kalkulasi subtotal, total harga, nominal DP, dan jatuh tempo
 *   otomatis (PROCUREMENT_CREATE).
 * - Approval / reject khusus SUPERVISOR (PROCUREMENT_APPROVE).
 * - Dua format cetak A4 hanya untuk status APPROVED:
 *     Format A — FORM PENGAJUAN PEMESANAN BARANG (internal)
 *     Format B — SURAT KESEPAKATAN (vendor / SPK)
 */

(function (global) {
  'use strict';

  var WMS = global.WMS;
  if (!WMS || !WMS.registerModule) return;

  var ui = WMS.ui;
  var loadGen = 0;
  var COLSPAN = 8;
  var DEFAULT_DP = 50;
  var DEFAULT_DURATION = 21;
  var DEFAULT_JABATAN = 'Product & Distribution Supervisor';
  var DEFAULT_CITY = 'Tangerang, Banten';

  var JENIS_TANPA = 'TANPA_KESEPAKATAN';
  var JENIS_DENGAN = 'DENGAN_KESEPAKATAN';

  var state = { items: [], loaded: false, visibleLimit: 100 };
  var panel = null;
  var filterCtl = null;

  var MONTH_NAMES = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];
  var DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

  var PRINT_ENTITIES = {
    GEA: {
      legalName: 'PT. GUDANG EDUKASI ANAK',
      city: DEFAULT_CITY,
      address: 'Tangerang, Banten',
      letterhead: 'Tangerang, Banten | gudangedukasianakfinance@gmail.com | 08212112661',
      contacts: ['gudangedukasianakfinance@gmail.com', '08212112661'],
      logo: 'assets/img/logo-gea.png'
    },
    EPIC: {
      legalName: 'CV EPIC',
      city: 'Denpasar',
      address: 'Jl. Tukad Sanghyang No. 9, Panjer, Denpasar',
      letterhead: 'Jl. Tukad Sanghyang No. 9, Panjer, Denpasar | pratamainsanc@gmail.com | 085113120260',
      contacts: ['085113120260', 'pratamainsanc@gmail.com'],
      logo: 'assets/img/logo-epic.png'
    }
  };

  /* ------------------------------------------------------------------------
   * Util tampilan
   * ---------------------------------------------------------------------- */

  function sessionUser() {
    var session = WMS.auth && WMS.auth.getSession ? WMS.auth.getSession() : null;
    return (session && session.user) || {};
  }

  function isSupervisor() {
    return !!(WMS.auth && typeof WMS.auth.isSupervisor === 'function' && WMS.auth.isSupervisor());
  }

  function rupiah(value) {
    return 'Rp ' + ui.formatNumber(Math.round(ui.num(value)));
  }

  function docStatus(doc) {
    return String((doc && doc.statusPengajuan) || 'PENDING_APPROVAL').trim().toUpperCase();
  }

  function docJenis(doc) {
    var raw = String((doc && doc.jenisPengajuan) || '').trim().toUpperCase();
    return raw === JENIS_TANPA ? JENIS_TANPA : JENIS_DENGAN;
  }

  function isTanpaJenis(doc) {
    return docJenis(doc) === JENIS_TANPA;
  }

  function jenisLabel(doc) {
    return isTanpaJenis(doc) ? 'Pengajuan Internal' : 'Surat Kesepakatan';
  }

  function jenisBadge(doc) {
    var tanpa = isTanpaJenis(doc);
    return '<span class="badge badge--' + (tanpa ? 'neutral' : 'accent') + '">' +
      '<span class="badge__dot"></span>' + jenisLabel(doc) +
    '</span>';
  }

  function parseIsoDate(value) {
    var match = String(value == null ? '' : value).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);

    if (!match) return null;

    var date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));

    if (
      date.getFullYear() !== Number(match[1]) ||
      date.getMonth() !== Number(match[2]) - 1 ||
      date.getDate() !== Number(match[3])
    ) {
      return null;
    }

    return date;
  }

  function toIsoDate(date) {
    return date.getFullYear() + '-' +
      String(date.getMonth() + 1).padStart(2, '0') + '-' +
      String(date.getDate()).padStart(2, '0');
  }

  function addDaysIso(value, days) {
    var date = parseIsoDate(value);
    if (!date) return '';
    date.setDate(date.getDate() + Math.round(days));
    return toIsoDate(date);
  }

  function tanggalPanjang(value) {
    var date = parseIsoDate(value);
    if (!date) return String(value == null ? '' : value).trim() || '—';
    return date.getDate() + ' ' + MONTH_NAMES[date.getMonth()] + ' ' + date.getFullYear();
  }

  function tanggalLengkap(value) {
    var date = parseIsoDate(value);
    if (!date) return tanggalPanjang(value);
    return DAY_NAMES[date.getDay()] + ', ' + tanggalPanjang(value);
  }

  function docItems(doc) {
    return doc && Array.isArray(doc.items) ? doc.items : [];
  }

  function docTotalQty(doc) {
    var total = ui.num(doc && doc.totalQty);
    if (total) return total;
    return docItems(doc).reduce(function (sum, item) {
      return sum + ui.num(item.qty);
    }, 0);
  }

  function docTotalHarga(doc) {
    var total = ui.num(doc && doc.totalHarga);
    if (total) return total;
    return docItems(doc).reduce(function (sum, item) {
      var sub = ui.num(item.subtotal);
      return sum + (sub || ui.num(item.qty) * ui.num(item.hargaSatuan));
    }, 0);
  }

  function itemHasPrice(doc) {
    return docItems(doc).some(function (item) {
      return ui.num(item.hargaSatuan) > 0 || ui.num(item.subtotal) > 0;
    });
  }

  function docDpPercent(doc) {
    var raw = doc ? doc.persenDp : '';
    if (raw === undefined || raw === null || String(raw).trim() === '') return DEFAULT_DP;
    return ui.num(raw);
  }

  function docDpAmount(doc) {
    var nominal = ui.num(doc && doc.nominalDp);
    if (nominal) return nominal;
    return Math.round(docTotalHarga(doc) * docDpPercent(doc) / 100);
  }

  function docDuration(doc) {
    var raw = doc ? doc.durasiHari : '';
    if (raw === undefined || raw === null || String(raw).trim() === '') return DEFAULT_DURATION;
    return ui.num(raw);
  }

  function docDueDate(doc) {
    var iso = String((doc && (doc.tglJatuhTempo || doc.tanggalJatuhTempo)) || '').trim();

    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;

    return addDaysIso(String((doc && doc.tanggal) || '').slice(0, 10), docDuration(doc));
  }

  function findDoc(noSurat) {
    var key = String(noSurat == null ? '' : noSurat).trim().toUpperCase();

    return state.items.find(function (doc) {
      return String(doc.noSurat || '').trim().toUpperCase() === key;
    }) || null;
  }

  function printEntity() {
    var code = String(WMS.warehouseCode || '').toUpperCase();
    return PRINT_ENTITIES[code] || PRINT_ENTITIES.GEA;
  }

  /* ------------------------------------------------------------------------
   * Template modul
   * ---------------------------------------------------------------------- */

  function template() {
    return '' +
      '<div class="module-head">' +
        '<div>' +
        '</div>' +
        '<div class="module-head__actions">' +
          '<button type="button" class="btn btn--ghost btn--sm" data-action="refresh">' + ui.ICONS.refresh + ' Muat Ulang</button>' +
          '<button type="button" class="btn btn--primary btn--sm" data-action="create">+ Buat Pengajuan</button>' +
        '</div>' +
      '</div>' +

      '<div class="stat-grid">' +
        '<article class="stat-card stat-card--accent">' +
          '<span class="stat-card__label">Total Dokumen</span>' +
          '<strong class="stat-card__value" data-stat="total">—</strong>' +
          '<span class="stat-card__meta">Seluruh nomor dokumen</span>' +
        '</article>' +
        '<article class="stat-card">' +
          '<span class="stat-card__label">Menunggu Approval</span>' +
          '<strong class="stat-card__value" data-stat="pending">—</strong>' +
          '<span class="stat-card__meta">Status PENDING_APPROVAL</span>' +
        '</article>' +
        '<article class="stat-card">' +
          '<span class="stat-card__label">Disetujui</span>' +
          '<strong class="stat-card__value" data-stat="approved">—</strong>' +
          '<span class="stat-card__meta">Siap cetak A4</span>' +
        '</article>' +
        '<article class="stat-card">' +
          '<span class="stat-card__label">Nilai Disetujui</span>' +
          '<strong class="stat-card__value" data-stat="value">—</strong>' +
          '<span class="stat-card__meta">Akumulasi total harga</span>' +
        '</article>' +
      '</div>' +

      '<div class="card">' +
        '<div class="card__head">' +
          '<div><h3>Daftar Pengajuan</h3><p>Satu baris mewakili satu nomor dokumen beserta rincian item di dalamnya.</p></div>' +
          '<span class="pill" id="procurement-count">0 dokumen</span>' +
        '</div>' +
        '<div class="toolbar">' +
          ui.searchField('procurement-search', 'Cari nomor dokumen, perihal, supplier…') +
          '<select id="procurement-filter" class="select select--sm" aria-label="Filter status pengajuan">' +
            '<option value="">Semua status</option>' +
            '<option value="PENDING_APPROVAL">Menunggu approval</option>' +
            '<option value="APPROVED">Disetujui</option>' +
            '<option value="REJECTED">Ditolak</option>' +
          '</select>' +
          '<span class="toolbar__spacer"></span>' +
          '<span class="toolbar__note">Sumber: <code>Pengajuan_Order</code></span>' +
        '</div>' +
        '<div class="table-wrap">' +
          '<table class="data-table" id="procurement-table">' +
            '<thead><tr>' +
              '<th>Tanggal</th><th>No. Dokumen</th><th>Jenis</th><th>Perihal</th>' +
              '<th>Supplier / Vendor</th><th class="num">Total Qty</th><th>Status</th>' +
              '<th class="actions-cell">Aksi</th>' +
            '</tr></thead>' +
            '<tbody id="procurement-body">' + ui.tableLoadingRow(COLSPAN, 4) + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>';
  }

  /* ------------------------------------------------------------------------
   * Daftar pengajuan
   * ---------------------------------------------------------------------- */

  function setStats() {
    if (!panel) return;

    var pending = 0;
    var approved = 0;
    var value = 0;

    state.items.forEach(function (doc) {
      var status = docStatus(doc);
      if (status === 'PENDING_APPROVAL') pending++;
      if (status === 'APPROVED') {
        approved++;
        value += docTotalHarga(doc);
      }
    });

    var values = {
      total: state.items.length,
      pending: pending,
      approved: approved,
      value: rupiah(value)
    };

    Object.keys(values).forEach(function (key) {
      var el = panel.querySelector('[data-stat="' + key + '"]');
      if (el) el.textContent = values[key];
    });
  }

  function rowActions(doc) {
    var status = docStatus(doc);
    var noSurat = String(doc.noSurat || '');
    var actions = [
      '<button type="button" class="btn btn--ghost btn--sm" data-detail="' + ui.esc(noSurat) + '">Detail</button>'
    ];

    if (status === 'PENDING_APPROVAL' && isSupervisor()) {
      actions.push('<button type="button" class="btn btn--primary btn--sm" data-approve="' + ui.esc(noSurat) + '">Approve</button>');
      actions.push('<button type="button" class="btn btn--danger-ghost btn--sm" data-reject="' + ui.esc(noSurat) + '">Reject</button>');
    }

    if (status === 'APPROVED') {
      actions.push('<button type="button" class="btn btn--primary btn--sm" data-print="' + ui.esc(noSurat) + '">Cetak / Simpan PDF</button>');
    }

    return '<div class="btn-row" style="justify-content:flex-end">' + actions.join('') + '</div>';
  }

  function supplierCell(doc) {
    var tanpa = isTanpaJenis(doc);
    var supplier = String(doc.pihakKeduaNama || '').trim();

    if (!supplier || supplier === '-') {
      return '<span class="muted">—</span>';
    }

    return ui.cellStack(supplier, tanpa ? '' : doc.pihakKeduaJabatan || '');
  }

  function renderRows() {
    var tbody = panel && panel.querySelector('#procurement-body');
    if (!tbody) return;

    if (!state.items.length) {
      tbody.innerHTML = ui.tableEmptyRow(
        COLSPAN,
        'Belum ada pengajuan order',
        'Buat pengajuan pertama melalui tombol “Buat Pengajuan”. Nomor dokumen dibuat otomatis.'
      );
      var emptyCount = panel.querySelector('#procurement-count');
      if (emptyCount) emptyCount.textContent = '0 dokumen';
      return;
    }

    var sorted = state.items.slice().sort(function (a, b) {
      return String(b.tanggal || '').localeCompare(String(a.tanggal || '')) ||
        String(b.noSurat || '').localeCompare(String(a.noSurat || ''));
    });

    var query = String((panel.querySelector('#procurement-search') && panel.querySelector('#procurement-search').value) || '').trim().toLowerCase();
    var statusFilter = String((panel.querySelector('#procurement-filter') && panel.querySelector('#procurement-filter').value) || '');
    var filtered = sorted.filter(function (doc) {
      var search = [doc.noSurat, doc.perihal, doc.pihakKeduaNama, doc.pihakKeduaJabatan, jenisLabel(doc), docStatus(doc), doc.diajukanOleh, doc.approvedBy, doc.tanggal].join(' ').toLowerCase();
      return (!query || search.indexOf(query) !== -1) && (!statusFilter || docStatus(doc) === statusFilter);
    });

    var visible = filtered.slice(0, state.visibleLimit);
    tbody.innerHTML = visible.map(function (doc) {
      var status = docStatus(doc);
      var search = [
        doc.noSurat, doc.perihal, doc.pihakKeduaNama, doc.pihakKeduaJabatan,
        jenisLabel(doc), status, doc.diajukanOleh, doc.approvedBy, doc.tanggal
      ].join(' ').toLowerCase();

      return '<tr data-row data-status="' + ui.esc(status) + '" data-search="' + ui.esc(search) + '">' +
        '<td class="nowrap muted">' + ui.esc(ui.formatDate(doc.tanggal)) + '</td>' +
        '<td class="nowrap"><strong>' + ui.esc(doc.noSurat || '—') + '</strong></td>' +
        '<td>' + jenisBadge(doc) + '</td>' +
        '<td>' + ui.cellStack(doc.perihal || '—', doc.diajukanOleh ? 'Diajukan: ' + doc.diajukanOleh : '') + '</td>' +
        '<td>' + supplierCell(doc) + '</td>' +
        '<td class="num">' + ui.formatQty(docTotalQty(doc)) + '</td>' +
        '<td>' + ui.badge(status) + '</td>' +
        '<td class="actions-cell">' + rowActions(doc) + '</td>' +
      '</tr>';
    }).join('') +
      ui.showMoreRow(COLSPAN, visible.length, filtered.length, 'dokumen') +
      '<tr class="table-state" data-empty-row hidden><td colspan="' + COLSPAN + '">' +
        ui.emptyState('Tidak ada hasil', 'Ubah kata kunci pencarian atau filter status pengajuan.') +
      '</td></tr>';

    var count = panel.querySelector('#procurement-count');
    if (count) count.textContent = filtered.length + ' dokumen';
  }

  function renderError(error) {
    var tbody = panel && panel.querySelector('#procurement-body');
    if (!tbody) return;
    tbody.innerHTML = ui.tableErrorRow(COLSPAN, error && error.message);
    ui.bindRetry(tbody, function () { load({ silent: false }); });
  }

  async function load(options) {
    var gen = ++loadGen;
    var opts = options || {};
    var tbody = panel && panel.querySelector('#procurement-body');

    if (!opts.silent && !state.loaded && tbody) tbody.innerHTML = ui.tableLoadingRow(COLSPAN, 4);

    try {
      var data = await WMS.api.request('PROCUREMENT_LIST');
      if (gen !== loadGen) return;
      state.items = data && Array.isArray(data.items) ? data.items : [];
      state.loaded = true;
      if (!opts.silent) state.visibleLimit = ui.TABLE_PAGE_SIZE;
      setStats();
      renderRows();
    } catch (error) {
      if (gen !== loadGen) return;
      if (WMS.api.isAuthError(error)) return;
      if (opts.silent && state.loaded) {
        ui.toast((error && error.message) || 'Gagal memuat pengajuan order.', 'danger');
        return;
      }
      renderError(error);
    }
  }

  /* ------------------------------------------------------------------------
   * Detail & approval
   * ---------------------------------------------------------------------- */

  function detailPart(label, value, full) {
    return '<div class="detail' + (full ? ' detail--full' : '') + '">' +
      '<span class="detail__label">' + ui.esc(label) + '</span>' +
      '<span class="detail__value">' + value + '</span>' +
    '</div>';
  }

  function documentSummary(doc) {
    var status = docStatus(doc);
    var tanpa = isTanpaJenis(doc);
    var due = docDueDate(doc);
    var supplier = String(doc.pihakKeduaNama || '').trim();
    var parts = [
      detailPart('Jenis Dokumen', jenisBadge(doc)),
      detailPart('No. Dokumen', '<strong>' + ui.esc(doc.noSurat || '—') + '</strong>', true),
      detailPart('Tanggal', ui.esc(ui.formatDate(doc.tanggal))),
      detailPart('Status', ui.badge(status)),
      detailPart('Perihal', ui.esc(doc.perihal || '—'), true),
      detailPart(tanpa ? 'Nama Supplier' : 'Pihak Kedua',
        ui.esc(supplier && supplier !== '-' ? supplier : '—') +
        (tanpa ? '' : '<br><span class="muted">' + ui.esc(doc.pihakKeduaJabatan || '') + '</span>')),
      detailPart('Total Qty', ui.formatQty(docTotalQty(doc)) + ' unit')
    ];

    if (!tanpa) {
      parts.push(detailPart('Pihak Pertama',
        ui.esc(doc.pihakPertamaNama || '—') +
        '<br><span class="muted">' + ui.esc(doc.pihakPertamaJabatan || '') + '</span>'));
      parts.push(detailPart('Total Harga', '<strong>' + rupiah(docTotalHarga(doc)) + '</strong>'));
      parts.push(detailPart('DP ' + ui.esc(String(docDpPercent(doc))) + '%', rupiah(docDpAmount(doc))));
      parts.push(detailPart('Jatuh Tempo',
        ui.esc(due ? tanggalPanjang(due) + ' (' + docDuration(doc) + ' hari)' : '—')));
    }

    parts.push(detailPart('Diajukan Oleh', ui.esc(doc.diajukanOleh || '—')));
    parts.push(detailPart('Disetujui Oleh', ui.esc(doc.approvedBy || '—')));

    return '<div class="detail-grid">' + parts.join('') + '</div>';
  }

  function itemsTable(doc) {
    var items = docItems(doc);

    if (!items.length) {
      return '<p class="muted">Dokumen ini tidak memiliki baris item.</p>';
    }

    var showPrice = !isTanpaJenis(doc) || itemHasPrice(doc);
    var rows = items.map(function (item, index) {
      return '<tr>' +
        '<td class="muted">' + (index + 1) + '</td>' +
        '<td class="nowrap">' + ui.esc(item.kodeSku || '—') + '</td>' +
        '<td>' + ui.esc(item.namaBarang || ui.skuLabel(item.kodeSku) || '—') + '</td>' +
        '<td class="num">' + ui.formatQty(item.qty) + '</td>' +
        (showPrice
          ? '<td class="num nowrap">' + rupiah(item.hargaSatuan) + '</td>' +
            '<td class="num nowrap">' + rupiah(item.subtotal) + '</td>'
          : '') +
      '</tr>';
    }).join('');

    var head = '<thead><tr><th>#</th><th>SKU</th><th>Nama Barang</th><th class="num">Qty</th>' +
      (showPrice ? '<th class="num">Harga Satuan</th><th class="num">Subtotal</th>' : '') +
      '</tr></thead>';

    var totals = '<div class="proc-inline-totals">' +
      '<span>Total Qty <strong>' + ui.formatQty(docTotalQty(doc)) + ' unit</strong></span>' +
      (showPrice ? '<span>Total Harga <strong>' + rupiah(docTotalHarga(doc)) + '</strong></span>' : '') +
      (!isTanpaJenis(doc)
        ? '<span>DP ' + ui.esc(String(docDpPercent(doc))) + '% <strong>' + rupiah(docDpAmount(doc)) + '</strong></span>'
        : '') +
    '</div>';

    return '<div class="table-wrap proc-detail-table">' +
      '<table class="data-table">' + head + '<tbody>' + rows + '</tbody></table>' +
    '</div>' + totals;
  }

  function openDetail(doc) {
    var approved = docStatus(doc) === 'APPROVED';
    var body = documentSummary(doc) +
      '<h4 class="proc-detail-heading">Rincian Item</h4>' +
      itemsTable(doc);

    var footer = '<button type="button" class="btn btn--ghost" data-modal-close>Tutup</button>' +
      (approved
        ? '<button type="button" class="btn btn--primary" data-print-doc>Cetak / Simpan PDF</button>'
        : '');

    ui.openModal({
      eyebrow: 'Pengajuan Order · Detail',
      title: doc.perihal || 'Detail Pengajuan',
      subtitle: doc.noSurat || '',
      size: 'lg',
      body: body,
      footer: footer,
      onMount: function (modal) {
        var printBtn = modal.querySelector('[data-print-doc]');
        if (printBtn) {
          printBtn.addEventListener('click', function () { printDocument(doc); });
        }
      }
    });
  }

  /**
   * Menyegarkan antrean Inbound agar baris rencana hasil approval pengajuan
   * langsung tampil saat menu Inbound dibuka, tanpa reload manual.
   *
   * Dipanggil setelah approval sukses. Aman bila modul Inbound belum pernah
   * dimount: load() pada Inbound menyimpan data ke state dan hanya menyentuh
   * DOM bila panel tersedia.
   *
   * @return {Promise<void>}
   */
  async function refreshInboundData() {
    var modules = WMS.router && WMS.router.getModules ? WMS.router.getModules() : {};
    var inboundModule = modules && modules.inbound;

    if (!inboundModule || typeof inboundModule.refresh !== 'function') return;

    try {
      await inboundModule.refresh();
    } catch (error) {
      // Kegagalan refresh tidak boleh membatalkan approval yang sudah tersimpan;
      // data Inbound tetap dimuat ulang saat modul dibuka.
      if (WMS.api && typeof WMS.api.isAuthError === 'function' && WMS.api.isAuthError(error)) return;
    }
  }

  function openDecision(doc, decision) {
    var approving = decision === 'APPROVED';
    var body = documentSummary(doc) +
      '<div class="confirm-panel ' + (approving ? 'confirm-panel--success' : 'confirm-panel--danger') + '">' +
        ui.ICONS.alert +
        '<span>' +
          (approving
            ? 'Dokumen akan berubah menjadi <strong>APPROVED</strong>. Tombol <strong>Cetak / Simpan PDF</strong> akan tersedia setelah keputusan disimpan.'
            : 'Dokumen akan berubah menjadi <strong>REJECTED</strong>. Pengajuan yang ditolak tidak dapat dicetak.') +
        '</span>' +
      '</div>';

    ui.confirm({
      eyebrow: 'Pengajuan Order · Approval',
      title: approving ? 'Setujui Pengajuan' : 'Tolak Pengajuan',
      subtitle: doc.noSurat,
      size: 'lg',
      body: body,
      confirmLabel: approving ? 'Approve Pengajuan' : 'Reject Pengajuan',
      cancelLabel: 'Batal',
      confirmClass: approving ? 'btn--primary' : 'btn--danger',
      busyLabel: 'Menyimpan keputusan…',
      onConfirm: async function () {
        var result = await WMS.api.request('PROCUREMENT_APPROVE', {
          noSurat: doc.noSurat,
          decision: decision
        });
        if (approving && WMS.touch) WMS.touch('inbound');
        if (approving && WMS.master && WMS.master.invalidate) WMS.master.invalidate();
        var inboundCreated = Math.max(0, Number(result && result.inboundCreatedCount) || 0);

        if (approving && inboundCreated > 0) {
          ui.toast(
            'Pengajuan ' + doc.noSurat + ' disetujui. ' + inboundCreated +
              ' item otomatis masuk antrean Inbound (PENDING).',
            'success',
            'Keputusan tersimpan'
          );
        } else {
          ui.toast(
            'Pengajuan ' + doc.noSurat + ' ' + (approving ? 'disetujui dan siap dicetak.' : 'ditolak.'),
            approving ? 'success' : 'warning',
            'Keputusan tersimpan'
          );
        }

        await load({ silent: true });
        if (approving) await refreshInboundData();
        return true;
      }
    });
  }

  /* ------------------------------------------------------------------------
   * Form pengajuan baru (dinamis per jenis)
   * ---------------------------------------------------------------------- */

  function itemRowHtml() {
    return '<div class="proc-item" data-item>' +
      '<input class="input proc-item__sku" list="procurement-sku-list" placeholder="Ketik / pilih SKU" autocomplete="off" aria-label="Kode SKU">' +
      '<input class="input proc-item__name" placeholder="Nama barang" autocomplete="off" aria-label="Nama barang">' +
      '<input class="input proc-item__qty num" type="number" min="1" step="1" placeholder="0" aria-label="Qty">' +
      '<input class="input proc-item__price num" type="number" min="0" step="1" placeholder="0" aria-label="Harga satuan">' +
      '<span class="proc-item__subtotal proc-col-subtotal">Rp 0</span>' +
      '<button type="button" class="icon-btn proc-item__remove" data-remove-item aria-label="Hapus item">&times;</button>' +
    '</div>';
  }

  function itemsEditorHtml() {
    return '<div class="proc-items">' +
      '<div class="proc-items__head">' +
        '<span>SKU</span><span>Nama Barang</span><span class="num">Qty</span>' +
        '<span class="num" data-col-price>Harga Satuan</span>' +
        '<span class="num proc-col-subtotal">Subtotal</span><span></span>' +
      '</div>' +
      '<div data-item-list>' + itemRowHtml() + '</div>' +
      '<div class="proc-items__foot">' +
        '<button type="button" class="btn btn--ghost btn--sm" data-add-item>+ Tambah Item</button>' +
        '<span class="muted" data-item-note>Pilih dari Master Barang atau ketik SKU manual, lalu isi nama, qty, dan harga.</span>' +
      '</div>' +
      ui.skuDatalist('procurement-sku-list') +
    '</div>';
  }

  function summaryHtml(persenDp, durasiHari, tanggal) {
    return '<div class="proc-summary">' +
      '<div><span>Total Qty</span><strong data-total-qty>0</strong></div>' +
      '<div><span data-label-total-harga>Total Harga</span><strong data-total-harga>Rp 0</strong></div>' +
      '<div class="proc-summary__dp"><span>DP <span data-dp-percent>' + ui.esc(String(persenDp)) + '</span>%</span><strong data-total-dp>Rp 0</strong></div>' +
      '<div class="proc-summary__due"><span>Jatuh Tempo</span><strong data-due-date>' + ui.esc(durasiHari ? tanggalPanjang(addDaysIso(tanggal, durasiHari)) : '—') + '</strong></div>' +
    '</div>';
  }

  function openCreate() {
    var user = sessionUser();
    var defaultName = String(user.namaLengkap || user.username || '').trim() || 'Pengaju Internal';
    var tanggal = ui.todayIso();

    var body = '<form id="procurement-form" class="proc-form proc-form--tanpa" novalidate>' +
      '<div class="form-grid">' +
        '<div class="field field--full">' +
          '<label for="proc-jenis">Jenis Pengajuan <span class="req">*</span></label>' +
          '<select class="select" id="proc-jenis" aria-label="Jenis pengajuan">' +
            '<option value="' + JENIS_TANPA + '" selected>Tanpa Kesepakatan (Pengajuan Internal / PR)</option>' +
            '<option value="' + JENIS_DENGAN + '">Dengan Kesepakatan (Kontrak Vendor / SPK)</option>' +
          '</select>' +
          '<span class="proc-hint" data-jenis-hint>Pengajuan internal tanpa kontrak vendor. Identitas lengkap dan ketentuan DP tidak diperlukan.</span>' +
        '</div>' +
        '<div class="field"><label for="proc-tanggal">Tanggal</label>' +
          '<input class="input" id="proc-tanggal" type="date" value="' + ui.esc(tanggal) + '" required>' +
        '</div>' +
        '<div class="field"><label for="proc-perihal">Perihal / Kebutuhan <span class="req">*</span></label>' +
          '<input class="input" id="proc-perihal" type="text" placeholder="contoh: Produksi Kaos Seragam Anemone" maxlength="180" required>' +
        '</div>' +
        '<div class="field proc-agg"><label for="proc-pihak1-nama">Pihak Pertama — Nama</label>' +
          '<input class="input" id="proc-pihak1-nama" type="text" value="' + ui.esc(defaultName) + '" placeholder="Nama perwakilan perusahaan">' +
        '</div>' +
        '<div class="field proc-agg"><label for="proc-pihak1-jabatan">Pihak Pertama — Jabatan</label>' +
          '<input class="input" id="proc-pihak1-jabatan" type="text" value="' + ui.esc(DEFAULT_JABATAN) + '" placeholder="contoh: Product &amp; Distribution Supervisor">' +
        '</div>' +
        '<div class="field"><label for="proc-pihak2-nama" data-label-pihak2>Nama Supplier <span class="muted">(Opsional)</span></label>' +
          '<input class="input" id="proc-pihak2-nama" type="text" placeholder="Opsional — nama supplier / vendor" maxlength="180">' +
        '</div>' +
        '<div class="field proc-agg"><label for="proc-pihak2-jabatan">Pihak Kedua — Jabatan / Nama Usaha</label>' +
          '<input class="input" id="proc-pihak2-jabatan" type="text" placeholder="contoh: Supplier / Pemilik">' +
        '</div>' +
        '<div class="field proc-agg"><label for="proc-dp">Persentase DP (%)</label>' +
          '<input class="input" id="proc-dp" type="number" min="0" max="100" step="1" value="' + DEFAULT_DP + '">' +
        '</div>' +
        '<div class="field proc-agg"><label for="proc-durasi">Lama Pengerjaan (Hari)</label>' +
          '<input class="input" id="proc-durasi" type="number" min="0" step="1" value="' + DEFAULT_DURATION + '">' +
        '</div>' +
        '<div class="field field--full"><label>Rincian Item</label>' + itemsEditorHtml() + '</div>' +
        '<div class="field field--full">' + summaryHtml(DEFAULT_DP, DEFAULT_DURATION, tanggal) + '</div>' +
      '</div>' +
      '<div class="form-alert" id="procurement-form-error" hidden role="alert"></div>' +
    '</form>';

    ui.openModal({
      eyebrow: 'Pengajuan Order',
      title: 'Buat Pengajuan Pemesanan',
      subtitle: 'Nomor dokumen dibuat otomatis per tahun sesuai entitas gudang.',
      size: 'xl',
      body: body,
      footer:
        '<button type="button" class="btn btn--ghost" data-modal-close>Batal</button>' +
        '<button type="submit" class="btn btn--primary" form="procurement-form" data-submit-create>Simpan Pengajuan</button>',
      onMount: function (modal, close) {
        var form = modal.querySelector('#procurement-form');
        var list = modal.querySelector('[data-item-list]');
        var addBtn = modal.querySelector('[data-add-item]');
        if (!form || !list || !addBtn) return;

        var jenisSelect = form.querySelector('#proc-jenis');
        var pihak2Input = form.querySelector('#proc-pihak2-nama');
        var pihak2Label = form.querySelector('[data-label-pihak2]');

        function isTanpa() {
          return jenisSelect && jenisSelect.value === JENIS_TANPA;
        }

        function refreshSummary() {
          var totals = { qty: 0, harga: 0 };
          var rows = form.querySelectorAll('[data-item]');

          rows.forEach(function (row) {
            var qtyInput=row.querySelector('.proc-item__qty'), priceInput=row.querySelector('.proc-item__price'), subtotalEl=row.querySelector('.proc-item__subtotal');
            var qty = ui.num(qtyInput && qtyInput.value);
            var price = ui.num(priceInput && priceInput.value);
            var subtotal = qty * price;
            if (subtotalEl) subtotalEl.textContent = rupiah(subtotal);
            totals.qty += qty;
            totals.harga += subtotal;
          });

          var dpInput=form.querySelector('#proc-dp'), durationInput=form.querySelector('#proc-durasi'), dateInput=form.querySelector('#proc-tanggal');
          var pct = ui.num(dpInput && dpInput.value);
          var durasi = ui.num(durationInput && durationInput.value);
          var tanggalValue = dateInput ? dateInput.value : '';
          var due = durasi ? addDaysIso(tanggalValue, durasi) : '';

          var qtyEl=form.querySelector('[data-total-qty]'), hargaEl=form.querySelector('[data-total-harga]'), dpPercentEl=form.querySelector('[data-dp-percent]'), dpEl=form.querySelector('[data-total-dp]'), dueEl=form.querySelector('[data-due-date]');
          if (qtyEl) qtyEl.textContent = ui.formatQty(totals.qty);
          if (hargaEl) hargaEl.textContent = rupiah(totals.harga);
          if (dpPercentEl) dpPercentEl.textContent = String(pct);
          if (dpEl) dpEl.textContent = rupiah(totals.harga * pct / 100);
          if (dueEl) dueEl.textContent = due ? tanggalPanjang(due) : '—';

          if (rows.length <= 1) {
            rows[0].querySelector('[data-remove-item]').disabled = true;
          } else {
            rows.forEach(function (row) {
              row.querySelector('[data-remove-item]').disabled = false;
            });
          }
        }

        function syncJenis() {
          var tanpa = isTanpa();

          form.classList.toggle('proc-form--tanpa', tanpa);

          if (pihak2Input) {
            pihak2Input.required = !tanpa;
            pihak2Input.placeholder = tanpa
              ? 'Opsional — nama supplier / vendor'
              : 'contoh: CV Anemone Textile';
          }

          if (pihak2Label) {
            pihak2Label.innerHTML = tanpa
              ? 'Nama Supplier <span class="muted">(Opsional)</span>'
              : 'Pihak Kedua — Nama PIC Vendor <span class="req">*</span>';
          }

          var hint = form.querySelector('[data-jenis-hint]');
          if (hint) {
            hint.textContent = tanpa
              ? 'Pengajuan internal tanpa kontrak vendor. Identitas lengkap dan ketentuan DP tidak diperlukan.'
              : 'Kontrak vendor/SPK. Lengkapi identitas kedua pihak, DP, dan lama pengerjaan untuk surat kesepakatan.';
          }

          var priceHead = form.querySelector('[data-col-price]');
          if (priceHead) priceHead.textContent = tanpa ? 'Estimasi Harga (Opsional)' : 'Harga Satuan';

          var totalLabel = form.querySelector('[data-label-total-harga]');
          if (totalLabel) totalLabel.textContent = tanpa ? 'Estimasi Total' : 'Total Harga';

          var note = form.querySelector('[data-item-note]');
          if (note) {
            note.textContent = tanpa
              ? 'Harga satuan bersifat opsional. Kosongkan bila nominal belum diketahui.'
              : 'Pilih dari Master Barang atau ketik SKU manual, lalu isi nama, qty, dan harga satuan.';
          }

          refreshSummary();
        }

        function addRow() {
          list.insertAdjacentHTML('beforeend', itemRowHtml());
          var rows = list.querySelectorAll('[data-item]');
          var last = rows[rows.length - 1];
          if (last) last.querySelector('.proc-item__sku').focus();
          refreshSummary();
        }

        addBtn.addEventListener('click', addRow);

        list.addEventListener('input', function (event) {
          var row = event.target.closest ? event.target.closest('[data-item]') : null;
          if (!row) return;

          if (event.target.classList.contains('proc-item__sku')) {
            var input = event.target;
            var cursor = input.selectionStart;
            input.value = input.value.toUpperCase();
            try { input.setSelectionRange(cursor, cursor); } catch (error) { /* abaikan */ }

            var nameInput = row.querySelector('.proc-item__name');
            var master = WMS.master && typeof WMS.master.find === 'function' ? WMS.master.find(input.value) : null;
            var autoFilled = row.getAttribute('data-auto-name') !== '0';

            if (master && (autoFilled || !nameInput.value.trim())) {
              nameInput.value = String(master.Nama_Barang || '');
              row.setAttribute('data-auto-name', '1');
            }
          } else if (event.target.classList.contains('proc-item__name')) {
            row.setAttribute('data-auto-name', '0');
          }

          refreshSummary();
        });

        list.addEventListener('click', function (event) {
          var remove = event.target.closest ? event.target.closest('[data-remove-item]') : null;
          if (!remove) return;
          var row = remove.closest('[data-item]');
          if (!row) return;
          if (list.querySelectorAll('[data-item]').length <= 1) return;
          row.parentNode.removeChild(row);
          refreshSummary();
        });

        ['#proc-dp', '#proc-durasi', '#proc-tanggal'].forEach(function (selector) {
          var field = form.querySelector(selector);
          if (field) field.addEventListener('input', refreshSummary);
        });

        if (jenisSelect) jenisSelect.addEventListener('change', syncJenis);

        form.addEventListener('submit', function (event) {
          event.preventDefault();
          submitCreate(modal, close);
        });

        syncJenis();
        if (WMS.master && typeof WMS.master.load === 'function') {
          WMS.master.load().catch(function () { /* cache tetap dipakai */ });
        }
      }
    });
  }

  function collectPayload(form) {
    var jenisSelect = form.querySelector('#proc-jenis');
    var jenisPengajuan = jenisSelect && jenisSelect.value === JENIS_TANPA ? JENIS_TANPA : JENIS_DENGAN;
    var tanpa = jenisPengajuan === JENIS_TANPA;
    var tanggal = String((form.querySelector('#proc-tanggal') || {}).value || '').trim();

    if (!parseIsoDate(tanggal)) {
      throw new Error('Tanggal pengajuan wajib diisi dengan tanggal yang valid.');
    }

    var perihal = String((form.querySelector('#proc-perihal') || {}).value || '').trim();
    var pihakPertamaNama = String((form.querySelector('#proc-pihak1-nama') || {}).value || '').trim();
    var pihakPertamaJabatan = String((form.querySelector('#proc-pihak1-jabatan') || {}).value || '').trim();
    var pihakKeduaNama = String((form.querySelector('#proc-pihak2-nama') || {}).value || '').trim();
    var pihakKeduaJabatan = String((form.querySelector('#proc-pihak2-jabatan') || {}).value || '').trim();
    var persenDp = ui.num((form.querySelector('#proc-dp') || {}).value);
    var durasiHari = ui.num((form.querySelector('#proc-durasi') || {}).value);

    if (!perihal) throw new Error('Perihal / kebutuhan wajib diisi.');

    if (tanpa) {
      // Identitas internal tetap dikirim (backend mewajibkan), memakai default login.
      var user = sessionUser();
      pihakPertamaNama = pihakPertamaNama ||
        String(user.namaLengkap || user.username || '').trim() || 'Pengaju Internal';
      pihakPertamaJabatan = pihakPertamaJabatan || DEFAULT_JABATAN;
      pihakKeduaNama = pihakKeduaNama || '-';
      pihakKeduaJabatan = '-';
      persenDp = 0;
      durasiHari = 0;
    } else {
      if (!pihakPertamaNama) throw new Error('Nama Pihak Pertama wajib diisi.');
      if (!pihakPertamaJabatan) throw new Error('Jabatan Pihak Pertama wajib diisi.');
      if (!pihakKeduaNama) throw new Error('Nama PIC Vendor wajib diisi.');
      if (!pihakKeduaJabatan) throw new Error('Jabatan / nama usaha supplier wajib diisi.');
      if (!(persenDp >= 0 && persenDp <= 100)) throw new Error('Persentase DP harus berada pada rentang 0 sampai 100.');
      if (!(durasiHari >= 0)) throw new Error('Lama pengerjaan harus berupa angka 0 atau lebih.');
    }

    var items = [];

    form.querySelectorAll('[data-item]').forEach(function (row, index) {
      var skuInput=row.querySelector('.proc-item__sku'), nameInput=row.querySelector('.proc-item__name'), qtyInput=row.querySelector('.proc-item__qty'), priceInput=row.querySelector('.proc-item__price');
      if (!skuInput || !nameInput || !qtyInput || !priceInput) throw new Error('Baris item #' + (index + 1) + ' tidak lengkap.');
      var kodeSku = String(skuInput.value || '').trim().toUpperCase();
      var namaBarang = String(nameInput.value || '').trim();
      var qty = ui.num(qtyInput.value);
      var hargaSatuan = ui.num(priceInput.value);

      if (!kodeSku && !namaBarang && !qty && !hargaSatuan) return;

      var label = 'Item #' + (index + 1);

      if (!kodeSku) throw new Error(label + ': kode SKU wajib diisi.');
      if (!(qty > 0)) throw new Error(label + ': qty harus lebih besar dari 0.');
      if (hargaSatuan < 0) throw new Error(label + ': harga satuan tidak valid.');

      if (!namaBarang) {
        var master = WMS.master && typeof WMS.master.find === 'function' ? WMS.master.find(kodeSku) : null;
        namaBarang = master ? String(master.Nama_Barang || '').trim() : '';
      }

      if (!namaBarang) throw new Error(label + ': nama barang wajib diisi.');

      items.push({
        kodeSku: kodeSku,
        namaBarang: namaBarang,
        qty: qty,
        hargaSatuan: tanpa ? hargaSatuan || 0 : hargaSatuan
      });
    });

    if (!items.length) throw new Error('Tambahkan minimal satu item pengajuan.');

    return {
      jenisPengajuan: jenisPengajuan,
      tanggal: tanggal,
      perihal: perihal,
      pihakPertamaNama: pihakPertamaNama,
      pihakPertamaJabatan: pihakPertamaJabatan,
      pihakKeduaNama: pihakKeduaNama,
      pihakKeduaJabatan: pihakKeduaJabatan,
      persenDp: persenDp,
      durasiHari: durasiHari,
      items: items
    };
  }

  async function submitCreate(modal, close) {
    var form = modal.querySelector('#procurement-form');
    var errorBox = modal.querySelector('#procurement-form-error');
    var submit = modal.querySelector('[data-submit-create]');
    var payload;

    ui.showInlineError(errorBox, '');

    try {
      payload = collectPayload(form);
    } catch (error) {
      ui.showInlineError(errorBox, error.message);
      return;
    }

    ui.setBusy(submit, true, 'Menyimpan pengajuan…');

    try {
      var result = await WMS.api.request('PROCUREMENT_CREATE', payload);
      close('saved');
      ui.toast(
        'Pengajuan ' + result.noSurat + ' tersimpan dengan status PENDING_APPROVAL.',
        'success',
        'Pengajuan dibuat'
      );
      await load({ silent: false });
    } catch (error) {
      if (WMS.api.isAuthError(error)) {
        close('auth');
        return;
      }
      ui.setBusy(submit, false);
      ui.showInlineError(errorBox, (error && error.message) || 'Pengajuan gagal disimpan.');
    }
  }

  /* ------------------------------------------------------------------------
   * Cetak A4 — Format A (Pengajuan Internal) & Format B (Surat Kesepakatan)
   * ---------------------------------------------------------------------- */

  function absoluteUrl(path) {
    try {
      return new global.URL(path, global.location.href).href;
    } catch (error) {
      return path;
    }
  }

  function printKopHtml(entity, useLetterhead) {
    var contactLine = useLetterhead ? (entity.letterhead || entity.address) : entity.address;

    return '<header class="kop">' +
      '<img src="' + ui.esc(absoluteUrl(entity.logo)) + '" alt="Logo perusahaan" onerror="this.style.display=\'none\'">' +
      '<div class="kop__text">' +
        '<h1>' + ui.esc(entity.legalName) + '</h1>' +
        (contactLine ? '<p>' + ui.esc(contactLine) + '</p>' : '') +
      '</div>' +
    '</header>';
  }

  function printStyles() {
    return '<style>' +
      '@page { size: A4 portrait; margin: 15mm 18mm 13mm; }' +
      '* { box-sizing: border-box; }' +
      'html, body { margin: 0; padding: 0; background: #e9edf2; }' +
      'body { font-family: "Times New Roman", Times, serif; font-size: 11.5pt; color: #111; }' +
      '.toolbar { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px; background: #0f172a; color: #fff; font-family: Arial, Helvetica, sans-serif; font-size: 12px; }' +
      '.toolbar strong { display: block; font-size: 13px; }' +
      '.toolbar span { opacity: .75; }' +
      '.toolbar__actions { display: flex; gap: 8px; }' +
      '.toolbar button { border: 0; border-radius: 6px; padding: 8px 14px; font-size: 12px; font-weight: 600; cursor: pointer; background: #e2e8f0; color: #0f172a; }' +
      '.toolbar button.primary { background: #2563eb; color: #fff; }' +
      '.doc { max-width: 210mm; margin: 18px auto; padding: 18mm; background: #fff; box-shadow: 0 10px 30px rgba(15,23,42,.18); }' +
      '.kop { display: flex; align-items: center; gap: 14px; padding-bottom: 10px; border-bottom: 3px double #111; }' +
      '.kop img { width: 64px; height: 64px; object-fit: contain; flex: 0 0 auto; }' +
      '.kop__text { flex: 1; text-align: center; }' +
      '.kop h1 { margin: 0; font-size: 16pt; letter-spacing: .4px; text-transform: uppercase; }' +
      '.kop p { margin: 3px 0 0; font-size: 9.5pt; }' +
      'h2.title { margin: 16px 0 2px; text-align: center; font-size: 14pt; letter-spacing: 1px; text-decoration: underline; text-transform: uppercase; }' +
      '.nomor { margin: 0 0 4px; text-align: center; font-size: 11pt; }' +
      '.perihal { margin: 0 0 14px; text-align: center; font-size: 10.5pt; }' +
      'p { margin: 6px 0; line-height: 1.5; text-align: justify; }' +
      'table.meta { width: 100%; border-collapse: collapse; margin: 12px 0 10px; font-size: 11pt; }' +
      'table.meta th, table.meta td { padding: 4px 6px; vertical-align: top; text-align: left; }' +
      'table.meta th { width: 112px; font-weight: bold; }' +
      'table.meta td.split { width: 40px; }' +
      '.parties { display: grid; grid-template-columns: 108px 10px 1fr; gap: 3px 0; margin: 8px 0 10px 12px; font-size: 11pt; }' +
      '.parties dt { font-weight: bold; }' +
      '.parties dd { margin: 0; }' +
      'h3.pasal { margin: 12px 0 4px; font-size: 11.5pt; }' +
      'ol.clauses { margin: 0 0 0 2px; padding-left: 18px; }' +
      'ol.clauses li { margin: 3px 0; line-height: 1.45; text-align: justify; }' +
      'table.items { width: 100%; border-collapse: collapse; margin: 8px 0 4px; font-size: 10.5pt; page-break-inside: auto; }' +
      'table.items th, table.items td { border: 1px solid #444; padding: 5px 6px; vertical-align: top; }' +
      'table.items thead th { background: #eef1f4; font-size: 10pt; }' +
      'table.items tfoot td { font-weight: bold; background: #fafbfc; }' +
      'table.items tfoot tr.dp td { background: #f1f5f0; }' +
      '.num { text-align: right; white-space: nowrap; }' +
      '.center { text-align: center; }' +
      '.nowrap { white-space: nowrap; }' +
      '.sign-date { margin: 16px 0 0; text-align: right; }' +
      '.ttd { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-top: 6px; page-break-inside: avoid; }' +
      '.ttd__box { text-align: center; }' +
      '.ttd__label { font-weight: bold; letter-spacing: .5px; }' +
      '.ttd__company { font-size: 10pt; min-height: 16px; }' +
      '.materai { width: 84px; height: 50px; margin: 6px auto 4px; border: 1px dashed #666; color: #666; font-size: 8pt; line-height: 1.25; display: flex; align-items: center; justify-content: center; }' +
      '.ttd__name { margin-top: 6px; font-weight: bold; text-decoration: underline; }' +
      '.ttd__role { font-size: 10pt; }' +
      '.sign-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 30px; text-align: center; page-break-inside: avoid; }' +
      '.sign-grid__label { font-weight: bold; }' +
      '.sign-grid__space { height: 66px; }' +
      '.sign-grid__name { font-weight: bold; text-decoration: underline; }' +
      '.sign-grid__role { font-size: 10pt; color: #333; }' +
      '.footnote { margin-top: 16px; padding-top: 6px; border-top: 1px solid #999; font-size: 8.5pt; color: #444; text-align: left; }' +
      '@media print {' +
        'html, body { background: #fff; }' +
        '.toolbar { display: none !important; }' +
        '.doc { max-width: none; margin: 0; padding: 0; box-shadow: none; }' +
        'table.items tr { page-break-inside: avoid; }' +
      '}' +
    '</style>';
  }

  function printPageHtml(title, subtitle, body) {
    return '<!DOCTYPE html>' +
      '<html lang="id"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>' + ui.esc(title) + (subtitle ? ' ' + ui.esc(subtitle) : '') + '</title>' +
      printStyles() +
      '</head><body>' +
      '<div class="toolbar">' +
        '<div><strong>Pratinjau ' + ui.esc(title) + '</strong><span>A4 portrait · ' + ui.esc(subtitle || '') + '</span></div>' +
        '<div class="toolbar__actions">' +
          '<button type="button" onclick="window.print()" class="primary">Cetak / Simpan PDF</button>' +
          '<button type="button" onclick="window.close()">Tutup</button>' +
        '</div>' +
      '</div>' +
      '<main class="doc">' + body + '</main>' +
      '</body></html>';
  }

  /* -------------------- Format A — Pengajuan Internal -------------------- */

  function pengajuanItemsTable(doc) {
    var items = docItems(doc);
    var showPrice = itemHasPrice(doc);
    var rows = items.map(function (item, index) {
      return '<tr>' +
        '<td class="center">' + (index + 1) + '</td>' +
        '<td class="nowrap">' + ui.esc(item.kodeSku || '—') + '</td>' +
        '<td>' + ui.esc(item.namaBarang || ui.skuLabel(item.kodeSku) || '—') + '</td>' +
        '<td class="num">' + ui.formatQty(item.qty) + '</td>' +
        (showPrice
          ? '<td class="num nowrap">' + rupiah(item.hargaSatuan) + '</td>' +
            '<td class="num nowrap">' + rupiah(item.subtotal) + '</td>'
          : '') +
      '</tr>';
    }).join('');

    var colgroup = showPrice
      ? '<colgroup><col style="width:34px"><col style="width:92px"><col><col style="width:62px"><col style="width:112px"><col style="width:118px"></colgroup>'
      : '<colgroup><col style="width:34px"><col style="width:110px"><col><col style="width:70px"></colgroup>';

    var head = '<thead><tr><th class="center">No</th><th>Kode SKU</th><th>Nama Barang</th><th class="num">Qty</th>' +
      (showPrice ? '<th class="num">Harga Satuan</th><th class="num">Subtotal</th>' : '') +
      '</tr></thead>';

    var foot = '<tfoot><tr class="totals"><td colspan="3" class="num">Total Qty</td>' +
      '<td class="num">' + ui.formatQty(docTotalQty(doc)) + '</td>' +
      (showPrice ? '<td></td><td class="num">' + rupiah(docTotalHarga(doc)) + '</td>' : '') +
      '</tr></tfoot>';

    return '<table class="items">' + colgroup + head + '<tbody>' + rows + '</tbody>' + foot + '</table>';
  }

  function pengajuanSignatureHtml(doc, entity, tanggalSurat) {
    return '<p class="sign-date">' + ui.esc(entity.city) + ', ' + ui.esc(tanggalPanjang(tanggalSurat)) + '</p>' +
      '<div class="sign-grid">' +
        '<div>' +
          '<div class="sign-grid__label">Diajukan Oleh</div>' +
          '<div class="sign-grid__space"></div>' +
          '<div class="sign-grid__name">' + ui.esc(doc.diajukanOleh || '—') + '</div>' +
          '<div class="sign-grid__role">Pengaju</div>' +
        '</div>' +
        '<div>' +
          '<div class="sign-grid__label">Disetujui Oleh</div>' +
          '<div class="sign-grid__space"></div>' +
          '<div class="sign-grid__name">' + ui.esc(doc.approvedBy || '—') + '</div>' +
          '<div class="sign-grid__role">Supervisor</div>' +
        '</div>' +
      '</div>';
  }

  function buildPengajuanHtml(doc) {
    var entity = printEntity();
    var supplier = String(doc.pihakKeduaNama || '').trim();
    var supplierText = supplier && supplier !== '-' ? supplier : '—';
    var tanggalSurat = String(doc.tanggal || '').slice(0, 10);

    var body = printKopHtml(entity, false) +
      '<h2 class="title">FORM PENGAJUAN PEMESANAN BARANG</h2>' +
      '<p class="nomor">Nomor Dokumen: ' + ui.esc(doc.noSurat || '—') + '</p>' +
      '<table class="meta">' +
        '<tr><th>Tanggal</th><td>' + ui.esc(tanggalPanjang(tanggalSurat)) + '</td>' +
          '<th>Jenis</th><td>Pengajuan Internal (PR)</td></tr>' +
        '<tr><th>Perihal</th><td colspan="3">' + ui.esc(doc.perihal || '—') + '</td></tr>' +
        '<tr><th>Nama Supplier</th><td colspan="3">' + ui.esc(supplierText) + '</td></tr>' +
      '</table>' +
      '<p>Dengan ini mengajukan permintaan pemesanan barang dengan rincian sebagai berikut:</p>' +
      pengajuanItemsTable(doc) +
      pengajuanSignatureHtml(doc, entity, tanggalSurat) +
      '<p class="footnote">Dokumen ini merupakan pengajuan internal (PR) dan tidak memerlukan kontrak vendor. ' +
        'Dicetak dari WMS Terpadu pada ' + ui.esc(new Date().toLocaleString('id-ID')) + '.</p>';

    return printPageHtml('Form Pengajuan Pemesanan Barang', doc.noSurat, body);
  }

  /* -------------------- Format B — Surat Kesepakatan -------------------- */

  function kesepakatanItemsTable(doc, pct, dp, remaining) {
    var items = docItems(doc);
    var rows = items.map(function (item, index) {
      return '<tr>' +
        '<td class="center">' + (index + 1) + '</td>' +
        '<td class="nowrap">' + ui.esc(item.kodeSku || '—') + '</td>' +
        '<td>' + ui.esc(item.namaBarang || ui.skuLabel(item.kodeSku) || '—') + '</td>' +
        '<td class="num">' + ui.formatQty(item.qty) + '</td>' +
        '<td class="num nowrap">' + rupiah(item.hargaSatuan) + '</td>' +
        '<td class="num nowrap">' + rupiah(item.subtotal) + '</td>' +
      '</tr>';
    }).join('');

    return '<table class="items">' +
      '<colgroup>' +
        '<col style="width:32px"><col style="width:92px"><col>' +
        '<col style="width:62px"><col style="width:112px"><col style="width:118px">' +
      '</colgroup>' +
      '<thead><tr>' +
        '<th class="center">No</th><th>Kode SKU</th><th>Nama Barang</th>' +
        '<th class="num">Qty</th><th class="num">Harga Satuan</th><th class="num">Subtotal</th>' +
      '</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '<tfoot>' +
        '<tr class="totals"><td colspan="3" class="num">Total</td><td class="num">' + ui.formatQty(docTotalQty(doc)) + '</td><td></td><td class="num">' + rupiah(docTotalHarga(doc)) + '</td></tr>' +
        '<tr class="dp"><td colspan="5" class="num">DP (' + ui.esc(String(pct)) + '%)</td><td class="num">' + rupiah(dp) + '</td></tr>' +
        '<tr><td colspan="5" class="num">Sisa Pembayaran</td><td class="num">' + rupiah(remaining) + '</td></tr>' +
      '</tfoot>' +
    '</table>';
  }

  function kesepakatanSignatureHtml(doc, entity, tanggalSurat) {
    var pihak2Company = String(doc.pihakKeduaJabatan || '').trim();
    if (!pihak2Company || pihak2Company === '-') pihak2Company = 'Perwakilan Supplier';

    return '<p class="sign-date">' + ui.esc(entity.city) + ', ' + ui.esc(tanggalPanjang(tanggalSurat)) + '</p>' +
      '<div class="ttd">' +
        '<div class="ttd__box">' +
          '<div class="ttd__label">PIHAK PERTAMA</div>' +
          '<div class="ttd__company">' + ui.esc(entity.legalName) + '</div>' +
          '<div class="materai">Meterai<br>Rp 10.000</div>' +
          '<div class="ttd__name">' + ui.esc(doc.pihakPertamaNama || '—') + '</div>' +
          '<div class="ttd__role">' + ui.esc(doc.pihakPertamaJabatan || '') + '</div>' +
        '</div>' +
        '<div class="ttd__box">' +
          '<div class="ttd__label">PIHAK KEDUA</div>' +
          '<div class="ttd__company">' + ui.esc(pihak2Company) + '</div>' +
          '<div class="materai">Meterai<br>Rp 10.000</div>' +
          '<div class="ttd__name">' + ui.esc(doc.pihakKeduaNama || '—') + '</div>' +
          '<div class="ttd__role">' + ui.esc(doc.pihakKeduaJabatan || '') + '</div>' +
        '</div>' +
      '</div>';
  }

  function buildKesepakatanHtml(doc) {
    var entity = printEntity();
    var pct = docDpPercent(doc);
    var total = docTotalHarga(doc);
    var dp = docDpAmount(doc);
    var remaining = Math.max(0, total - dp);
    var durasi = docDuration(doc);
    var due = docDueDate(doc);
    var tanggalSurat = String(doc.tanggal || '').slice(0, 10);
    var approvedNote = doc.approvedBy
      ? 'Disetujui oleh Supervisor: ' + ui.esc(doc.approvedBy) + '.'
      : '';

    var body = printKopHtml(entity, true) +
      '<h2 class="title">SURAT KESEPAKATAN</h2>' +
      '<p class="nomor">Nomor: ' + ui.esc(doc.noSurat || '—') + '</p>' +
      '<p class="perihal">Perihal: <strong>' + ui.esc(doc.perihal || '—') + '</strong></p>' +
      '<p>Pada hari ini, ' + ui.esc(tanggalLengkap(tanggalSurat)) + ', bertempat di ' + ui.esc(entity.city) +
        ', para pihak yang bertanda tangan di bawah ini:</p>' +
      '<dl class="parties">' +
        '<dt>PIHAK PERTAMA</dt><dd>:</dd><dd><strong>' + ui.esc(doc.pihakPertamaNama || '—') + '</strong>, ' + ui.esc(doc.pihakPertamaJabatan || '—') + ', bertindak untuk dan atas nama <strong>' + ui.esc(entity.legalName) + '</strong>.</dd>' +
        '<dt>PIHAK KEDUA</dt><dd>:</dd><dd><strong>' + ui.esc(doc.pihakKeduaNama || '—') + '</strong>, ' + ui.esc(doc.pihakKeduaJabatan || '—') + ', selaku penyedia barang/jasa.</dd>' +
      '</dl>' +
      '<p>Sepakat untuk mengikatkan diri dalam Surat Kesepakatan Pemesanan dengan ketentuan sebagai berikut:</p>' +

      '<h3 class="pasal">Pasal 1 — Objek dan Rincian Pesanan</h3>' +
      '<ol class="clauses">' +
        '<li>PIHAK PERTAMA memesan kepada PIHAK KEDUA, dan PIHAK KEDUA menyatakan sanggup menyediakan serta menyelesaikan pesanan dengan perihal <strong>' + ui.esc(doc.perihal || '—') + '</strong>.</li>' +
        '<li>Rincian barang, kuantitas, dan harga satuan disepakati sebagaimana tabel berikut:</li>' +
      '</ol>' +
      kesepakatanItemsTable(doc, pct, dp, remaining) +

      '<h3 class="pasal">Pasal 2 — Harga dan Tata Cara Pembayaran</h3>' +
      '<ol class="clauses">' +
        '<li>Nilai kesepakatan seluruh pesanan adalah <strong>' + rupiah(total) + '</strong> dan telah disetujui oleh kedua belah pihak.</li>' +
        '<li>PIHAK PERTAMA membayar uang muka (DP) sebesar <strong>' + ui.esc(String(pct)) + '%</strong> yaitu <strong>' + rupiah(dp) + '</strong>, dibayarkan pada saat penandatanganan Surat Kesepakatan ini.</li>' +
        '<li>Sisa pembayaran sebesar <strong>' + rupiah(remaining) + '</strong> dibayarkan setelah seluruh pesanan selesai dikerjakan dan diterima dengan baik oleh PIHAK PERTAMA.</li>' +
        '<li>Seluruh pembayaran dilakukan melalui transfer bank ke rekening yang ditunjuk oleh PIHAK KEDUA, dan bukti transfer disimpan sebagai dokumen sah.</li>' +
      '</ol>' +

      '<h3 class="pasal">Pasal 3 — Waktu Pengerjaan dan Jatuh Tempo</h3>' +
      '<ol class="clauses">' +
        '<li>Jangka waktu pengerjaan ditetapkan selama <strong>' + ui.esc(String(durasi)) + ' (hari kalender)</strong>, terhitung sejak tanggal Surat Kesepakatan ini ditandatangani.</li>' +
        '<li>Batas akhir penyerahan pesanan (Tanggal Jatuh Tempo) adalah <strong>' + ui.esc(due ? tanggalLengkap(due) : '—') + '</strong>' + (due ? ' (' + ui.esc(due) + ')' : '') + '.</li>' +
      '</ol>' +

      '<h3 class="pasal">Pasal 4 — Pembatalan dan Pengembalian DP</h3>' +
      '<ol class="clauses">' +
        '<li>Apabila PIHAK KEDUA membatalkan pesanan atau tidak dapat menyelesaikan pekerjaan sesuai kesepakatan, maka PIHAK KEDUA wajib mengembalikan DP sebesar <strong>100% (seratus persen)</strong> kepada PIHAK PERTAMA.</li>' +
        '<li>Pengembalian DP dilakukan paling lambat 7 (tujuh) hari kerja sejak permintaan pengembalian diterima oleh PIHAK KEDUA.</li>' +
      '</ol>' +

      '<h3 class="pasal">Pasal 5 — Denda Keterlambatan</h3>' +
      '<ol class="clauses">' +
        '<li>Keterlambatan penyelesaian pesanan dikenakan denda sebesar <strong>Rp 5.000 (lima ribu rupiah) per pcs</strong> untuk setiap kelipatan <strong>7 (tujuh) hari kalender</strong> keterlambatan.</li>' +
        '<li>Denda diperhitungkan dan dipotong dari sisa nilai pembayaran yang menjadi kewajiban PIHAK PERTAMA.</li>' +
      '</ol>' +

      '<h3 class="pasal">Pasal 6 — Ketentuan Penutup</h3>' +
      '<ol class="clauses">' +
        '<li>Hal-hal yang belum diatur dalam Surat Kesepakatan ini akan diselesaikan secara musyawarah oleh kedua belah pihak.</li>' +
        '<li>Surat Kesepakatan ini dibuat dalam 2 (dua) rangkap bermaterai cukup, masing-masing mempunyai kekuatan hukum yang sama.</li>' +
      '</ol>' +

      kesepakatanSignatureHtml(doc, entity, tanggalSurat) +
      '<p class="footnote">' + approvedNote + ' Dokumen dicetak dari WMS Terpadu pada ' + ui.esc(new Date().toLocaleString('id-ID')) + '.</p>';

    return printPageHtml('Surat Kesepakatan', doc.noSurat, body);
  }

  function buildPrintHtml(doc) {
    return isTanpaJenis(doc) ? buildPengajuanHtml(doc) : buildKesepakatanHtml(doc);
  }

  function triggerPrint(win) {
    var printed = false;

    function fire() {
      if (printed) return;
      printed = true;
      try {
        win.focus();
        win.print();
      } catch (error) {
        /* dialog cetak dapat ditutup pengguna */
      }
    }

    try {
      win.addEventListener('load', function () {
        global.setTimeout(fire, 250);
      });
    } catch (error) {
      /* abaikan */
    }

    global.setTimeout(fire, 800);
  }

  function printDocument(doc) {
    if (docStatus(doc) !== 'APPROVED') {
      ui.toast('Dokumen harus berstatus APPROVED sebelum dicetak.', 'warning');
      return;
    }

    var html = buildPrintHtml(doc);
    var win = null;

    try {
      win = global.open('', '_blank');
    } catch (error) {
      win = null;
    }

    if (win && win.document) {
      win.document.open();
      win.document.write(html);
      win.document.close();
      triggerPrint(win);
      return;
    }

    // Fallback bila popup diblokir browser: cetak melalui iframe tersembunyi.
    var frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    frame.onload = function () {
      global.setTimeout(function () {
        try {
          frame.contentWindow.focus();
          frame.contentWindow.print();
        } catch (error) {
          ui.toast('Pratinjau cetak tidak dapat dibuka. Izinkan popup untuk halaman ini.', 'danger');
        }
        global.setTimeout(function () {
          if (frame.parentNode) frame.parentNode.removeChild(frame);
        }, 60000);
      }, 300);
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  }

  /* ------------------------------------------------------------------------
   * Mount & registrasi modul
   * ---------------------------------------------------------------------- */

  function onRowAction(event) {
    var target = event.target;

    var printBtn = target.closest ? target.closest('[data-print]') : null;
    if (printBtn) {
      var printable = findDoc(printBtn.getAttribute('data-print'));
      if (printable) printDocument(printable);
      return;
    }

    var approveBtn = target.closest ? target.closest('[data-approve]') : null;
    if (approveBtn) {
      var approveDoc = findDoc(approveBtn.getAttribute('data-approve'));
      if (approveDoc) openDecision(approveDoc, 'APPROVED');
      return;
    }

    var rejectBtn = target.closest ? target.closest('[data-reject]') : null;
    if (rejectBtn) {
      var rejectDoc = findDoc(rejectBtn.getAttribute('data-reject'));
      if (rejectDoc) openDecision(rejectDoc, 'REJECTED');
      return;
    }

    var detailBtn = target.closest ? target.closest('[data-detail]') : null;
    if (detailBtn) {
      var detailDoc = findDoc(detailBtn.getAttribute('data-detail'));
      if (detailDoc) openDetail(detailDoc);
    }
  }

  function mount(root) {
    panel = root;
    root.innerHTML = template();

    filterCtl = ui.filterTable({
      table: '#procurement-table',
      search: '#procurement-search',
      count: '#procurement-count',
      countLabel: 'dokumen',
      filters: [{ selector: '#procurement-filter', attr: 'data-status' }],
      onFilter: function () {
        state.visibleLimit = ui.TABLE_PAGE_SIZE;
        renderRows();
      }
    });

    var refreshButton = root.querySelector('[data-action="refresh"]');
    if (refreshButton) refreshButton.addEventListener('click', function () {
      if (WMS.master && WMS.master.invalidate) WMS.master.invalidate();
      load({ silent: false });
    });
    var createButton = root.querySelector('[data-action="create"]');
    if (createButton) createButton.addEventListener('click', openCreate);

    var tbody = root.querySelector('#procurement-body');
    if (tbody) tbody.addEventListener('click', function (event) {
      var moreButton = event.target.closest ? event.target.closest('[data-show-more]') : null;
      if (moreButton) {
        state.visibleLimit += ui.TABLE_PAGE_SIZE;
        renderRows();
        return;
      }
      onRowAction(event);
    });

    if (WMS.master && typeof WMS.master.load === 'function') {
      WMS.master.load().catch(function () { /* master opsional saat daftar dimuat */ });
    }

    return load({ silent: false });
  }

  WMS.registerModule({
    id: 'procurement',
    label: 'Pengajuan Order',
    eyebrow: 'Modul 5 · Procurement',
    title: 'Pengajuan Order',
    mount: mount,
    refresh: function () { return load({ silent: true }); }
  });
})(window);
