/**
 * mod-procurement.js — Modul 5 Pengajuan Order & Surat Kesepakatan
 * ---------------------------------------------------------------------------
 * - Daftar dokumen pengajuan dikelompokkan per No_Surat (PROCUREMENT_LIST).
 * - Form pengajuan multi-SKU dengan kalkulasi subtotal otomatis
 *   (PROCUREMENT_CREATE).
 * - Approval / reject khusus SUPERVISOR (PROCUREMENT_APPROVE).
 * - Cetak / Simpan PDF Surat Kesepakatan A4 hanya untuk status APPROVED.
 */

(function (global) {
  'use strict';

  var WMS = global.WMS;
  if (!WMS || !WMS.registerModule) return;

  var ui = WMS.ui;
  var COLSPAN = 8;
  var DEFAULT_DP = 50;
  var DEFAULT_DURATION = 21;
  var DEFAULT_CITY = 'Tangerang, Banten';

  var state = { items: [], loaded: false };
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
      contacts: ['gudangedukasianakfinance@gmail.com', '08212112661'],
      logo: 'assets/img/logo-gea.png'
    },
    EPIC: {
      legalName: 'CV EPIC',
      city: 'Denpasar',
      address: 'Jl. Tukad Sanghyang No. 9, Panjer, Denpasar',
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
    var iso = String((doc && doc.tanggalJatuhTempo) || '').trim();

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
          '<p class="eyebrow">Modul 5 · Procurement</p>' +
          '<h2>Pengajuan Order</h2>' +
          '<p class="module-head__desc">Ajukan pemesanan ke supplier, setujui bersama Supervisor, lalu cetak Surat Kesepakatan A4 siap tanda tangan.</p>' +
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
          '<span class="stat-card__meta">Nomor surat kesepakatan</span>' +
        '</article>' +
        '<article class="stat-card">' +
          '<span class="stat-card__label">Menunggu Approval</span>' +
          '<strong class="stat-card__value" data-stat="pending">—</strong>' +
          '<span class="stat-card__meta">Status PENDING_APPROVAL</span>' +
        '</article>' +
        '<article class="stat-card">' +
          '<span class="stat-card__label">Disetujui</span>' +
          '<strong class="stat-card__value" data-stat="approved">—</strong>' +
          '<span class="stat-card__meta">Siap cetak Surat Kesepakatan</span>' +
        '</article>' +
        '<article class="stat-card">' +
          '<span class="stat-card__label">Nilai Disetujui</span>' +
          '<strong class="stat-card__value" data-stat="value">—</strong>' +
          '<span class="stat-card__meta">Akumulasi total harga</span>' +
        '</article>' +
      '</div>' +

      '<div class="card">' +
        '<div class="card__head">' +
          '<div><h3>Daftar Pengajuan</h3><p>Satu baris mewakili satu nomor surat kesepakatan beserta rincian item di dalamnya.</p></div>' +
          '<span class="pill" id="procurement-count">0 dokumen</span>' +
        '</div>' +
        '<div class="toolbar">' +
          ui.searchField('procurement-search', 'Cari nomor surat, perihal, supplier…') +
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
              '<th>Tanggal</th><th>Nomor Surat</th><th>Perihal</th><th>Pihak Kedua</th>' +
              '<th class="num">Total Qty</th><th class="num">Total Harga</th><th>Status</th>' +
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

  function renderRows() {
    var tbody = panel && panel.querySelector('#procurement-body');
    if (!tbody) return;

    if (!state.items.length) {
      tbody.innerHTML = ui.tableEmptyRow(
        COLSPAN,
        'Belum ada pengajuan order',
        'Buat pengajuan pertama melalui tombol “Buat Pengajuan”. Nomor surat dibuat otomatis.'
      );
      if (filterCtl) filterCtl.apply();
      return;
    }

    var sorted = state.items.slice().sort(function (a, b) {
      return String(b.tanggal || '').localeCompare(String(a.tanggal || '')) ||
        String(b.noSurat || '').localeCompare(String(a.noSurat || ''));
    });

    tbody.innerHTML = sorted.map(function (doc) {
      var status = docStatus(doc);
      var items = docItems(doc);
      var search = [
        doc.noSurat, doc.perihal, doc.pihakKeduaNama, doc.pihakKeduaJabatan,
        status, doc.diajukanOleh, doc.approvedBy, doc.tanggal
      ].join(' ').toLowerCase();

      return '<tr data-row data-status="' + ui.esc(status) + '" data-search="' + ui.esc(search) + '">' +
        '<td class="nowrap muted">' + ui.esc(ui.formatDate(doc.tanggal)) + '</td>' +
        '<td class="nowrap"><strong>' + ui.esc(doc.noSurat || '—') + '</strong></td>' +
        '<td>' + ui.cellStack(doc.perihal || '—', doc.diajukanOleh ? 'Diajukan: ' + doc.diajukanOleh : '') + '</td>' +
        '<td>' + ui.cellStack(doc.pihakKeduaNama || '—', doc.pihakKeduaJabatan || '') + '</td>' +
        '<td class="num">' + ui.formatQty(docTotalQty(doc)) + '</td>' +
        '<td class="num nowrap">' + rupiah(docTotalHarga(doc)) + '</td>' +
        '<td>' + ui.badge(status) + '</td>' +
        '<td class="actions-cell">' + rowActions(doc) + '</td>' +
      '</tr>';
    }).join('') +
      '<tr class="table-state" data-empty-row hidden><td colspan="' + COLSPAN + '">' +
        ui.emptyState('Tidak ada hasil', 'Ubah kata kunci pencarian atau filter status pengajuan.') +
      '</td></tr>';

    if (filterCtl) filterCtl.apply();
  }

  function renderError(error) {
    var tbody = panel && panel.querySelector('#procurement-body');
    if (!tbody) return;
    tbody.innerHTML = ui.tableErrorRow(COLSPAN, error && error.message);
    ui.bindRetry(tbody, function () { load({ silent: false }); });
  }

  async function load(options) {
    var opts = options || {};
    var tbody = panel && panel.querySelector('#procurement-body');

    if (!opts.silent && tbody) tbody.innerHTML = ui.tableLoadingRow(COLSPAN, 4);

    try {
      var data = await WMS.api.request('PROCUREMENT_LIST');
      state.items = data && Array.isArray(data.items) ? data.items : [];
      state.loaded = true;
      setStats();
      renderRows();
    } catch (error) {
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

  function documentSummary(doc) {
    var status = docStatus(doc);
    var due = docDueDate(doc);

    return '<div class="detail-grid">' +
      '<div class="detail detail--full"><span class="detail__label">Nomor Surat</span><span class="detail__value"><strong>' + ui.esc(doc.noSurat || '—') + '</strong></span></div>' +
      '<div class="detail"><span class="detail__label">Tanggal</span><span class="detail__value">' + ui.esc(ui.formatDate(doc.tanggal)) + '</span></div>' +
      '<div class="detail"><span class="detail__label">Status</span><span class="detail__value">' + ui.badge(status) + '</span></div>' +
      '<div class="detail detail--full"><span class="detail__label">Perihal</span><span class="detail__value">' + ui.esc(doc.perihal || '—') + '</span></div>' +
      '<div class="detail"><span class="detail__label">Pihak Pertama</span><span class="detail__value">' + ui.esc(doc.pihakPertamaNama || '—') + '<br><span class="muted">' + ui.esc(doc.pihakPertamaJabatan || '') + '</span></span></div>' +
      '<div class="detail"><span class="detail__label">Pihak Kedua</span><span class="detail__value">' + ui.esc(doc.pihakKeduaNama || '—') + '<br><span class="muted">' + ui.esc(doc.pihakKeduaJabatan || '') + '</span></span></div>' +
      '<div class="detail"><span class="detail__label">Total Qty</span><span class="detail__value">' + ui.formatQty(docTotalQty(doc)) + ' unit</span></div>' +
      '<div class="detail"><span class="detail__label">Total Harga</span><span class="detail__value"><strong>' + rupiah(docTotalHarga(doc)) + '</strong></span></div>' +
      '<div class="detail"><span class="detail__label">DP ' + ui.esc(String(docDpPercent(doc))) + '%</span><span class="detail__value">' + rupiah(docDpAmount(doc)) + '</span></div>' +
      '<div class="detail"><span class="detail__label">Jatuh Tempo</span><span class="detail__value">' + ui.esc(due ? tanggalPanjang(due) + ' (' + docDuration(doc) + ' hari)' : '—') + '</span></div>' +
      '<div class="detail"><span class="detail__label">Diajukan Oleh</span><span class="detail__value">' + ui.esc(doc.diajukanOleh || '—') + '</span></div>' +
      '<div class="detail"><span class="detail__label">Approved By</span><span class="detail__value">' + ui.esc(doc.approvedBy || '—') + '</span></div>' +
    '</div>';
  }

  function itemsTable(doc) {
    var items = docItems(doc);

    if (!items.length) {
      return '<p class="muted">Dokumen ini tidak memiliki baris item.</p>';
    }

    var rows = items.map(function (item, index) {
      return '<tr>' +
        '<td class="muted">' + (index + 1) + '</td>' +
        '<td class="nowrap">' + ui.esc(item.kodeSku || '—') + '</td>' +
        '<td>' + ui.esc(item.namaBarang || ui.skuLabel(item.kodeSku) || '—') + '</td>' +
        '<td class="num">' + ui.formatQty(item.qty) + '</td>' +
        '<td class="num nowrap">' + rupiah(item.hargaSatuan) + '</td>' +
        '<td class="num nowrap">' + rupiah(item.subtotal) + '</td>' +
      '</tr>';
    }).join('');

    return '<div class="table-wrap proc-detail-table">' +
      '<table class="data-table">' +
        '<thead><tr><th>#</th><th>SKU</th><th>Nama Barang</th><th class="num">Qty</th><th class="num">Harga Satuan</th><th class="num">Subtotal</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
    '</div>' +
    '<div class="proc-inline-totals">' +
      '<span>Total Qty <strong>' + ui.formatQty(docTotalQty(doc)) + ' unit</strong></span>' +
      '<span>Total Harga <strong>' + rupiah(docTotalHarga(doc)) + '</strong></span>' +
      '<span>DP ' + ui.esc(String(docDpPercent(doc))) + '% <strong>' + rupiah(docDpAmount(doc)) + '</strong></span>' +
    '</div>';
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

  function openDecision(doc, decision) {
    var approving = decision === 'APPROVED';
    var body = documentSummary(doc) +
      '<div class="confirm-panel ' + (approving ? 'confirm-panel--success' : 'confirm-panel--danger') + '">' +
        ui.ICONS.alert +
        '<span>' +
          (approving
            ? 'Dokumen akan berubah menjadi <strong>APPROVED</strong>. Tombol <strong>Cetak / Simpan PDF</strong> akan tersedia setelah keputusan disimpan.'
            : 'Dokumen akan berubah menjadi <strong>REJECTED</strong>. Pengajuan yang ditolak tidak dapat dicetak sebagai Surat Kesepakatan.') +
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
        await WMS.api.request('PROCUREMENT_APPROVE', {
          noSurat: doc.noSurat,
          decision: decision
        });
        ui.toast(
          'Pengajuan ' + doc.noSurat + ' ' + (approving ? 'disetujui dan siap dicetak.' : 'ditolak.'),
          approving ? 'success' : 'warning',
          'Keputusan tersimpan'
        );
        await load({ silent: true });
        return true;
      }
    });
  }

  /* ------------------------------------------------------------------------
   * Form pengajuan baru
   * ---------------------------------------------------------------------- */

  function itemRowHtml() {
    return '<div class="proc-item" data-item>' +
      '<input class="input proc-item__sku" list="procurement-sku-list" placeholder="Ketik / pilih SKU" autocomplete="off" aria-label="Kode SKU">' +
      '<input class="input proc-item__name" placeholder="Nama barang" autocomplete="off" aria-label="Nama barang">' +
      '<input class="input proc-item__qty num" type="number" min="1" step="1" placeholder="0" aria-label="Qty">' +
      '<input class="input proc-item__price num" type="number" min="0" step="1" placeholder="0" aria-label="Harga satuan">' +
      '<span class="proc-item__subtotal">Rp 0</span>' +
      '<button type="button" class="icon-btn proc-item__remove" data-remove-item aria-label="Hapus item">&times;</button>' +
    '</div>';
  }

  function itemsEditorHtml() {
    return '<div class="proc-items">' +
      '<div class="proc-items__head">' +
        '<span>SKU</span><span>Nama Barang</span><span class="num">Qty</span>' +
        '<span class="num">Harga Satuan</span><span class="num">Subtotal</span><span></span>' +
      '</div>' +
      '<div data-item-list>' + itemRowHtml() + '</div>' +
      '<div class="proc-items__foot">' +
        '<button type="button" class="btn btn--ghost btn--sm" data-add-item>+ Tambah Item</button>' +
        '<span class="muted">Pilih dari Master Barang atau ketik SKU manual, lalu isi nama, qty, dan harga.</span>' +
      '</div>' +
      ui.skuDatalist('procurement-sku-list') +
    '</div>';
  }

  function summaryHtml(persenDp, durasiHari, tanggal) {
    return '<div class="proc-summary">' +
      '<div><span>Total Qty</span><strong data-total-qty>0</strong></div>' +
      '<div><span>Total Harga</span><strong data-total-harga>Rp 0</strong></div>' +
      '<div class="proc-summary__dp"><span>DP <span data-dp-percent>' + ui.esc(String(persenDp)) + '</span>%</span><strong data-total-dp>Rp 0</strong></div>' +
      '<div><span>Jatuh Tempo</span><strong data-due-date>' + ui.esc(durasiHari ? tanggalPanjang(addDaysIso(tanggal, durasiHari)) : '—') + '</strong></div>' +
    '</div>';
  }

  function openCreate() {
    var user = sessionUser();
    var defaultName = user.namaLengkap || user.username || '';
    var tanggal = ui.todayIso();

    var body = '<form id="procurement-form" novalidate>' +
      '<div class="form-grid">' +
        '<div class="field"><label for="proc-tanggal">Tanggal Pengajuan</label>' +
          '<input class="input" id="proc-tanggal" type="date" value="' + ui.esc(tanggal) + '" required>' +
        '</div>' +
        '<div class="field"><label for="proc-perihal">Perihal <span class="req">*</span></label>' +
          '<input class="input" id="proc-perihal" type="text" placeholder="contoh: Produksi Kaos Seragam Anemone" maxlength="180" required>' +
        '</div>' +
        '<div class="field"><label for="proc-pihak1-nama">Pihak Pertama — Nama</label>' +
          '<input class="input" id="proc-pihak1-nama" type="text" value="' + ui.esc(defaultName) + '" placeholder="Nama perwakilan perusahaan" required>' +
        '</div>' +
        '<div class="field"><label for="proc-pihak1-jabatan">Pihak Pertama — Jabatan</label>' +
          '<input class="input" id="proc-pihak1-jabatan" type="text" placeholder="contoh: Direktur" required>' +
        '</div>' +
        '<div class="field"><label for="proc-pihak2-nama">Pihak Kedua — Nama / Usaha Supplier</label>' +
          '<input class="input" id="proc-pihak2-nama" type="text" placeholder="contoh: CV Anemone Textile" required>' +
        '</div>' +
        '<div class="field"><label for="proc-pihak2-jabatan">Pihak Kedua — Jabatan / Usaha</label>' +
          '<input class="input" id="proc-pihak2-jabatan" type="text" placeholder="contoh: Supplier / Pemilik" required>' +
        '</div>' +
        '<div class="field"><label for="proc-dp">Persentase DP (%)</label>' +
          '<input class="input" id="proc-dp" type="number" min="0" max="100" step="1" value="' + DEFAULT_DP + '">' +
        '</div>' +
        '<div class="field"><label for="proc-durasi">Lama Pengerjaan (hari)</label>' +
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
      subtitle: 'Nomor surat dibuat otomatis per tahun sesuai entitas gudang.',
      size: 'xl',
      body: body,
      footer:
        '<button type="button" class="btn btn--ghost" data-modal-close>Batal</button>' +
        '<button type="submit" class="btn btn--primary" form="procurement-form" data-submit-create>Simpan Pengajuan</button>',
      onMount: function (modal, close) {
        var form = modal.querySelector('#procurement-form');
        var list = modal.querySelector('[data-item-list]');
        var addBtn = modal.querySelector('[data-add-item]');

        function refreshSummary() {
          var totals = { qty: 0, harga: 0 };
          var rows = form.querySelectorAll('[data-item]');

          rows.forEach(function (row) {
            var qty = ui.num(row.querySelector('.proc-item__qty').value);
            var price = ui.num(row.querySelector('.proc-item__price').value);
            var subtotal = qty * price;
            row.querySelector('.proc-item__subtotal').textContent = rupiah(subtotal);
            totals.qty += qty;
            totals.harga += subtotal;
          });

          var pct = ui.num(modal.querySelector('#proc-dp').value);
          var durasi = ui.num(modal.querySelector('#proc-durasi').value);
          var tanggalValue = modal.querySelector('#proc-tanggal').value;
          var due = durasi ? addDaysIso(tanggalValue, durasi) : '';

          modal.querySelector('[data-total-qty]').textContent = ui.formatQty(totals.qty);
          modal.querySelector('[data-total-harga]').textContent = rupiah(totals.harga);
          modal.querySelector('[data-dp-percent]').textContent = String(pct);
          modal.querySelector('[data-total-dp]').textContent = rupiah(totals.harga * pct / 100);
          modal.querySelector('[data-due-date]').textContent = due ? tanggalPanjang(due) : '—';

          if (rows.length <= 1) {
            rows[0].querySelector('[data-remove-item]').disabled = true;
          } else {
            rows.forEach(function (row) {
              row.querySelector('[data-remove-item]').disabled = false;
            });
          }
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
          var field = modal.querySelector(selector);
          if (field) field.addEventListener('input', refreshSummary);
        });

        form.addEventListener('submit', function (event) {
          event.preventDefault();
          submitCreate(modal, close);
        });

        refreshSummary();
        if (WMS.master && typeof WMS.master.load === 'function') {
          WMS.master.load().catch(function () { /* cache tetap dipakai */ });
        }
      }
    });
  }

  function collectPayload(form) {
    var tanggal = String(form.querySelector('#proc-tanggal').value || '').trim();

    if (!parseIsoDate(tanggal)) {
      throw new Error('Tanggal pengajuan wajib diisi dengan tanggal yang valid.');
    }

    var perihal = String(form.querySelector('#proc-perihal').value || '').trim();
    var pihakPertamaNama = String(form.querySelector('#proc-pihak1-nama').value || '').trim();
    var pihakPertamaJabatan = String(form.querySelector('#proc-pihak1-jabatan').value || '').trim();
    var pihakKeduaNama = String(form.querySelector('#proc-pihak2-nama').value || '').trim();
    var pihakKeduaJabatan = String(form.querySelector('#proc-pihak2-jabatan').value || '').trim();
    var persenDp = ui.num(form.querySelector('#proc-dp').value);
    var durasiHari = ui.num(form.querySelector('#proc-durasi').value);

    if (!perihal) throw new Error('Perihal pengajuan wajib diisi.');
    if (!pihakPertamaNama) throw new Error('Nama Pihak Pertama wajib diisi.');
    if (!pihakPertamaJabatan) throw new Error('Jabatan Pihak Pertama wajib diisi.');
    if (!pihakKeduaNama) throw new Error('Nama / usaha Pihak Kedua wajib diisi.');
    if (!pihakKeduaJabatan) throw new Error('Jabatan Pihak Kedua wajib diisi.');
    if (!(persenDp >= 0 && persenDp <= 100)) throw new Error('Persentase DP harus berada pada rentang 0 sampai 100.');
    if (!(durasiHari >= 0)) throw new Error('Lama pengerjaan harus berupa angka 0 atau lebih.');

    var items = [];

    form.querySelectorAll('[data-item]').forEach(function (row, index) {
      var kodeSku = String(row.querySelector('.proc-item__sku').value || '').trim().toUpperCase();
      var namaBarang = String(row.querySelector('.proc-item__name').value || '').trim();
      var qty = ui.num(row.querySelector('.proc-item__qty').value);
      var hargaSatuan = ui.num(row.querySelector('.proc-item__price').value);

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
        hargaSatuan: hargaSatuan
      });
    });

    if (!items.length) throw new Error('Tambahkan minimal satu item pengajuan.');

    return {
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
   * Cetak Surat Kesepakatan A4
   * ---------------------------------------------------------------------- */

  function absoluteUrl(path) {
    try {
      return new global.URL(path, global.location.href).href;
    } catch (error) {
      return path;
    }
  }

  function printHeaderHtml(entity) {
    var contacts = Array.isArray(entity.contacts) ? entity.contacts : [];

    return '<header class="kop">' +
      '<img src="' + ui.esc(absoluteUrl(entity.logo)) + '" alt="Logo perusahaan" onerror="this.style.display=\'none\'">' +
      '<div class="kop__text">' +
        '<h1>' + ui.esc(entity.legalName) + '</h1>' +
        '<p>' + ui.esc(entity.address || entity.city) + '</p>' +
        contacts.map(function (line) {
          return '<p>' + ui.esc(line) + '</p>';
        }).join('') +
      '</div>' +
    '</header>';
  }

  function printItemsTableHtml(doc, pct, dp, remaining) {
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

  function printSignatureHtml(doc, entity, tanggalSurat) {
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
          '<div class="ttd__company">Perwakilan Supplier</div>' +
          '<div class="materai">Meterai<br>Rp 10.000</div>' +
          '<div class="ttd__name">' + ui.esc(doc.pihakKeduaNama || '—') + '</div>' +
          '<div class="ttd__role">' + ui.esc(doc.pihakKeduaJabatan || '') + '</div>' +
        '</div>' +
      '</div>';
  }

  function buildPrintHtml(doc) {
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

    return '<!DOCTYPE html>' +
      '<html lang="id"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>Surat Kesepakatan ' + ui.esc(doc.noSurat || '') + '</title>' +
      '<style>' +
        '@page { size: A4 portrait; margin: 16mm 18mm 14mm; }' +
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
        '.kop p { margin: 2px 0; font-size: 10pt; }' +
        'h2.title { margin: 18px 0 2px; text-align: center; font-size: 14pt; letter-spacing: 1px; text-decoration: underline; }' +
        '.nomor { margin: 0 0 4px; text-align: center; font-size: 11pt; }' +
        '.perihal { margin: 0 0 14px; text-align: center; font-size: 10.5pt; }' +
        'p { margin: 6px 0; line-height: 1.5; text-align: justify; }' +
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
        '.footnote { margin-top: 16px; padding-top: 6px; border-top: 1px solid #999; font-size: 8.5pt; color: #444; text-align: left; }' +
        '@media print {' +
          'html, body { background: #fff; }' +
          '.toolbar { display: none !important; }' +
          '.doc { max-width: none; margin: 0; padding: 0; box-shadow: none; }' +
          'table.items tr { page-break-inside: avoid; }' +
        '}' +
      '</style></head><body>' +
      '<div class="toolbar">' +
        '<div><strong>Pratinjau Surat Kesepakatan</strong><span>A4 portrait · ' + ui.esc(doc.noSurat || '') + '</span></div>' +
        '<div class="toolbar__actions">' +
          '<button type="button" onclick="window.print()" class="primary">Cetak / Simpan PDF</button>' +
          '<button type="button" onclick="window.close()">Tutup</button>' +
        '</div>' +
      '</div>' +
      '<main class="doc">' +
        printHeaderHtml(entity) +
        '<h2 class="title">SURAT KESEPAKATAN PEMESANAN</h2>' +
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
        printItemsTableHtml(doc, pct, dp, remaining) +

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
          '<li>Batas akhir penyerahan pesanan (jatuh tempo) adalah <strong>' + ui.esc(due ? tanggalLengkap(due) : '—') + '</strong>' + (due ? ' (' + ui.esc(due) + ')' : '') + '.</li>' +
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

        printSignatureHtml(doc, entity, tanggalSurat) +
        '<p class="footnote">' + approvedNote + ' Dokumen dicetak dari WMS Terpadu pada ' + ui.esc(new Date().toLocaleString('id-ID')) + '.</p>' +
      '</main>' +
      '</body></html>';
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
      filters: [{ selector: '#procurement-filter', attr: 'data-status' }]
    });

    root.querySelector('[data-action="refresh"]').addEventListener('click', function () {
      load({ silent: false });
    });
    root.querySelector('[data-action="create"]').addEventListener('click', openCreate);

    var tbody = root.querySelector('#procurement-body');
    if (tbody) tbody.addEventListener('click', onRowAction);

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
    description: 'Pengajuan & surat kesepakatan',
    mount: mount,
    refresh: function () { return load({ silent: true }); }
  });
})(window);
