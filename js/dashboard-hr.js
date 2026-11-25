/**
 * dashboard-hr.js
 * ---------------------------------------------------------------------------
 * Dashboard HR - Monitoring Pengiriman Cabang Baru.
 *
 * Aturan kelengkapan 100% (baru berdasarkan 28 SKU resmi):
 * - 100%: minimal 1 transaksi Outbound status DISPATCHED/DELIVERED/Terkirim/COMPLETED
 *   yang memuat minimal 1 item dengan SKU dari daftar 28 SKU resmi.
 * - 0%: belum ada transaksi Dispatch untuk SKU tersebut atau belum ada order sama sekali.
 * - Jika outlet 100%, tampilkan 100% saja, jangan hitung transaksi selanjutnya.
 *
 * Halaman ini tidak memakai login/token. Seluruh request dikirim dengan opsi
 * skipAuth karena endpoint HR bersifat publik. Tombol kembali bersifat
 * adaptif: mengikuti ?from=EPIC/GEA, sesi gudang aktif, atau disembunyikan.
 */

(function (global) {
  'use strict';

  var WMS = global.WMS = global.WMS || {};
  var API = WMS.api;
  var SESSION_KEY = 'wms.session.v1';

  var state = {
    data: null,
    loading: false,
    universe: [],
    viewShipments: [],
    filters: { branch: '', status: '' },
    manageQuery: ''
  };

  function $(id) {
    return document.getElementById(id);
  }

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&', '<': '<', '>': '>' }[char];
    });
  }

  function num(value) {
    if (typeof value === 'number') return isFinite(value) ? value : 0;

    var raw = String(value == null ? '' : value).replace(/[^0-9.,-]/g, '');
    var parsed = Number(raw.replace(/\./g, '').replace(',', '.'));
    return isFinite(parsed) ? parsed : 0;
  }

  var numberFormatter = null;
  try {
    numberFormatter = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });
  } catch (error) {
    numberFormatter = null;
  }

  function fmt(value) {
    var n = num(value);
    if (numberFormatter) return numberFormatter.format(n);
    return String(n);
  }

  function pct(value) {
    return fmt(value) + '%';
  }

  function fmtDate(value) {
    var raw = text(value);

    if (!raw) return '—';

    var match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);

    if (match) {
      var date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));

      if (!isNaN(date.getTime())) {
        try {
          return new Intl.DateTimeFormat('id-ID', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            timeZone: 'UTC'
          }).format(date);
        } catch (error) {
          return raw.slice(0, 10);
        }
      }
    }

    return raw;
  }

  /* ------------------------------------------------------------------------
   * Daftar 28 SKU resmi (mirror backend HR_CONFIG.SKU_ALL)
   * ---------------------------------------------------------------------- */

  var SKU_RESMI_SET = new Set([
    '100053', '100052', '100051',                          // Buku Panduan
    '100025', '100026', '100027', '100028', '100029', '100030', '100031', '100032', // Modul Expro MD
    '100018', '100019', '100023', '100024',                  // Modul Expro PU
    '100004', '100005', '100006', '100007', '100009', '100010', '100011', '100012', '100013', '100014', '100015', '100016', '100017' // Modul Membaca
  ]);

  function isSkuResmi(sku) {
    if (!sku) return false;
    return SKU_RESMI_SET.has(String(sku).trim());
  }

  /* ------------------------------------------------------------------------
   * API & state
   * ---------------------------------------------------------------------- */

  function api(action, params) {
    return API.request(action, params || {}, { skipAuth: true });
  }

  function readSession() {
    try {
      var raw = global.sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && parsed.user ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  function resolveBackButton() {
    var back = $('hr-back');
    if (!back) return;

    var params;
    try {
      params = new URLSearchParams(global.location.search || '');
    } catch (error) {
      params = null;
    }

    var from = params ? String(params.get('from') || '').toUpperCase() : '';
    var session = readSession();
    var target = '';

    if (from === 'EPIC') {
      target = 'cv-epic.html';
    } else if (from === 'GEA') {
      target = 'pt-gea.html';
    } else if (session) {
      var code = String(
        session.warehouse ||
        (session.user && session.user.aksesGudang) ||
        ''
      ).toUpperCase();
      target = code === 'GEA' ? 'pt-gea.html' : 'cv-epic.html';
    }

    if (!target) {
      back.hidden = true;
      back.setAttribute('aria-hidden', 'true');
      return;
    }

    back.href = target;
    back.hidden = false;
    back.setAttribute('aria-hidden', 'false');
  }

  function setLoadState(message) {
    var el = $('hr-load-state');
    if (el) el.textContent = message;
  }

  function setText(id, value) {
    var el = $(id);
    if (el) el.textContent = value;
  }

  function load() {
    if (state.loading) return Promise.resolve(state.data);

    state.loading = true;
    setLoadState('Memuat data…');

    return api('HR_CABANG_DASHBOARD').then(function (data) {
      state.data = data || {};
      state.universe = Array.isArray(data && data.outletUniverse)
        ? data.outletUniverse.slice()
        : [];
      render();
      setLoadState('Diperbarui ' + (data && data.generatedAt ? data.generatedAt : ''));
      return state.data;
    }).catch(function (error) {
      setLoadState('Gagal memuat');
      renderError(error);
      throw error;
    }).finally(function () {
      state.loading = false;
    });
  }

  /* ------------------------------------------------------------------------
   * Filter
   * ---------------------------------------------------------------------- */

  function matchesBranchName(name) {
    var query = state.filters.branch.toLowerCase();
    return !query || String(name == null ? '' : name).toLowerCase().indexOf(query) !== -1;
  }

  function filteredStatus(statusFilter) {
    if (!statusFilter) return true;
    return statusFilter === 'SELESAI'
      ? function (b) { return b.isCompleted; }
      : function (b) { return !b.isCompleted; };
  }

  function filteredBranches() {
    var source = state.data && Array.isArray(state.data.branches) ? state.data.branches : [];

    return source.filter(function (branch) {
      if (!matchesBranchName(branch.Nama_Outlet_Resmi)) return false;

      var statusFilter = state.filters.status;
      if (statusFilter) {
        var filterFn = filteredStatus(statusFilter);
        if (!filterFn(branch)) return false;
      }

      return true;
    });
  }

  function collectShipments(branches) {
    var shipments = [];

    (branches || []).forEach(function (branch) {
      (branch.shipments || []).forEach(function (shipment) {
        shipments.push(shipment);
      });
    });

    return shipments.sort(function (left, right) {
      if (left.entitas !== right.entitas) return left.entitas < right.entitas ? -1 : 1;
      return String(left.noDo || '').localeCompare(String(right.noDo || ''));
    });
  }

  function computeKpis(branches) {
    return {
      cabangDipantau: branches.length,
      cabangSelesai: branches.filter(function (b) { return b.isCompleted; }).length,
      menunggu: branches.filter(function (b) { return !b.isCompleted; }).length,
      totalDoKelengkapan: branches.reduce(function (sum, branch) {
        return sum + (Number(branch.totalDo) || 0);
      }, 0)
    };
  }

  /* ------------------------------------------------------------------------
   * Render
   * ---------------------------------------------------------------------- */

  function render() {
    var branches = filteredBranches();

    renderKpis(branches);
    renderBranches(branches);
    renderShipments(branches);

    if ($('hr-manage-modal') && !$('hr-manage-modal').hidden) {
      renderManageList();
    }
  }

  function renderKpis(branches) {
    var kpi = computeKpis(branches);

    setText('hr-kpi-branches', fmt(kpi.cabangDipantau));
    setText('hr-kpi-completed', fmt(kpi.cabangSelesai));
    setText('hr-kpi-waiting', fmt(kpi.menunggu));
    setText('hr-kpi-total-do', fmt(kpi.totalDoKelengkapan));
  }

  function statusLabelBadge(statusLabel) {
    if (statusLabel && statusLabel.indexOf('100%') !== -1) {
      return '<span class="badge badge--success">' + esc(statusLabel) + '</span>';
    }
    if (statusLabel && statusLabel.indexOf('0%') !== -1) {
      return '<span class="badge badge--neutral">' + esc(statusLabel) + '</span>';
    }
    return '<span class="badge badge--warning">' + esc(statusLabel) + '</span>';
  }

  function shipmentStatusLabel(statusKirim) {
    var value = text(statusKirim).toUpperCase();

    if (value === 'DELIVERED' || value === 'TERKIRIM' || value === 'COMPLETED') {
      return '100% — Sudah Dikirim';
    }
    if (value === 'DISPATCHED') {
      return '0% — Menunggu Pengiriman';
    }
    return '0% — Menunggu Pengiriman';
  }

  function renderBranches(branches) {
    var grid = $('hr-branch-grid');
    if (!grid) return;

    setText('hr-branch-count', branches.length + ' cabang');

    if (!branches.length) {
      grid.innerHTML = '<div class="hr-empty">Belum ada cabang baru yang sesuai filter. ' +
        'Klik <strong>Kelola Cabang Baru</strong> untuk menambahkan outlet.</div>';
      return;
    }

    grid.innerHTML = branches.map(function (branch) {
      var isCompleted = !!branch.isCompleted;
      var progress = isCompleted ? 100 : 0;
      var statusBadge = statusLabelBadge(branch.statusLabel);

      return '<article class="hr-branch-card' + (isCompleted ? ' is-completed' : '') + '">' +
        '<header class="hr-branch-card__head">' +
          '<div>' +
            '<h3>' + esc(branch.Nama_Outlet_Resmi) + '</h3>' +
            '<p class="hr-branch-card__meta">Acuan: Pengiriman Outbound (status Dispatched) yang memuat SKU Buku Panduan atau Modul.</p>' +
          '</div>' +
          '<strong class="hr-branch-card__pct">' + pct(progress) + '</strong>' +
        '</header>' +
        '<div class="hr-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + progress + '">' +
          '<span style="width:' + progress + '%"></span>' +
        '</div>' +
        '<div class="hr-branch-card__foot">' + statusBadge + '</div>' +
      '</article>';
    }).join('');
  }

  function renderShipments(branches) {
    var body = $('hr-shipment-body');
    if (!body) return;

    var shipments = collectShipments(branches);
    state.viewShipments = shipments;

    setText('hr-shipment-count', shipments.length + ' DO');

    if (!shipments.length) {
      body.innerHTML = '<tr><td colspan="8" class="hr-empty">Belum ada DO Buku Panduan / Modul yang cocok dengan filter.</td></tr>';
      return;
    }

    body.innerHTML = shipments.map(function (shipment, index) {
      var sku = shipment && shipment.kodeSku;
      var isResmi = isSkuResmi(sku);
      var status = shipmentStatusLabel(shipment && shipment.statusKirim);
      var pdf = shipment.linkPdf
        ? '<a class="link" href="' + esc(shipment.linkPdf) + '" target="_blank" rel="noopener noreferrer" data-pdf-link>Lihat PDF</a>'
        : '<span class="muted">—</span>';

      return '<tr data-shipment-index="' + index + '" tabindex="0" role="button" aria-label="Buka detail ' + esc(shipment.noDo) + '">' +
        '<td><strong>' + esc(shipment.noDo) + '</strong></td>' +
        '<td>' + esc(shipment.tujuan) + '</td>' +
        '<td><span class="badge badge--' + (shipment.entitas === 'EPIC' ? 'accent' : 'info') + '\">' + esc(shipment.entitas) + '</span></td>' +
        '<td>' + esc(fmtDate(shipment.tanggalOrder)) + '</td>' +
        '<td>' + (isResmi ? '<span class="badge badge--success">Resmi</span>' : '<span class="badge badge--neutral">Non-resmi</span>') + '</td>' +
        '<td class="num">' + fmt(shipment.qty) + '</td>' +
        '<td>' + status + '</td>' +
        '<td class="actions-cell">' + pdf + '</td>' +
      '</tr>';
    }).join('');
  }

  function renderError(error) {
    var message = (error && error.message) || 'Data dashboard gagal dimuat.';

    var grid = $('hr-branch-grid');
    if (grid) {
      grid.innerHTML = '<div class="hr-empty hr-empty--error">' + esc(message) + '</div>';
    }

    var body = $('hr-shipment-body');
    if (body) {
      body.innerHTML = '<tr><td colspan="8" class="hr-empty hr-empty--error">' + esc(message) + '</td></tr>';
    }

    toast(message, 'danger');
  }

  /* ------------------------------------------------------------------------
   * Modal detail pengiriman
   * ---------------------------------------------------------------------- */

  function openDetail(shipment) {
    if (!shipment) return;

    var modal = $('hr-detail-modal');
    if (!modal) return;

    setText('hr-detail-eyebrow', 'Detail Pengiriman · ' + (shipment.entitas || ''));
    setText('hr-detail-title', shipment.noDo || 'Tanpa No DO');
    setText('hr-detail-meta', [
      shipment.tujuan,
      'Order ' + fmtDate(shipment.tanggalOrder),
      shipment.statusLabel || ''
    ].filter(Boolean).join(' · '));

    var body = $('hr-detail-body');
    var items = Array.isArray(shipment.items) ? shipment.items : [];

    body.innerHTML = items.length
      ? items.map(function (item) {
          var pdf = item && item.linkPdf
            ? '<a class="link" href="' + esc(item.linkPdf) + '" target="_blank" rel="noopener noreferrer">PDF</a>'
            : '<span class="muted">—</span>';

          var pilarBadge = '';
          if (item && item.pilar) {
            pilarBadge = '<span class="badge badge--info">' + esc(item.pilar) + '</span>';
          }

          return '<tr>' +
            '<td><strong>' + esc(item && item.kodeSku) + '</strong></td>' +
            '<td>' + esc(item && item.namaBarang) + '</td>' +
            '<td>' + (pilarBadge || '<span class="muted">—</span>') + '</td>' +
            '<td class="num">' + fmt(item && item.qty) + '</td>' +
            '<td>' + (item && item.statusLabel ? '<span class="badge badge--' + (item.statusLabel.indexOf('100%') !== -1 ? 'success' : 'neutral') + '">' + esc(item.statusLabel) + '</span>' : '') + '</td>' +
            '<td class="actions-cell">' + pdf + '</td>' +
          '</tr>';
        }).join('')
      : '<tr><td colspan="6" class="hr-empty">Tidak ada item pada snapshot pengiriman.</td></tr>';

    var pdfLink = $('hr-detail-pdf');
    var groupPdf = shipment.linkPdf || (items[0] && items[0].linkPdf) || '';

    if (pdfLink) {
      if (groupPdf) {
        pdfLink.href = groupPdf;
        pdfLink.hidden = false;
      } else {
        pdfLink.href = '#';
        pdfLink.hidden = true;
      }
    }

    modal.hidden = false;
    syncModalState();
  }

  function closeDetail() {
    var modal = $('hr-detail-modal');
    if (modal) modal.hidden = true;
    syncModalState();
  }

  /* ------------------------------------------------------------------------
   * Modal kelola cabang baru
   * ---------------------------------------------------------------------- */

  function openManage() {
    var modal = $('hr-manage-modal');
    if (!modal) return;

    modal.hidden = false;
    syncModalState();
    renderManageList();

    var search = $('hr-outlet-search');
    if (search) {
      search.value = '';
      state.manageQuery = '';
      global.setTimeout(function () { search.focus(); }, 60);
    }
  }

  function closeManage() {
    var modal = $('hr-manage-modal');
    if (modal) modal.hidden = true;
    syncModalState();
  }

  function syncModalState() {
    var open = false;

    ['hr-manage-modal', 'hr-detail-modal'].forEach(function (id) {
      var modal = $(id);
      if (modal && !modal.hidden) open = true;
    });

    document.body.classList.toggle('hr-modal-open', open);
  }

  function findUniverseEntry(key) {
    var normalized = text(key);

    return (state.universe || []).find(function (item) {
      var itemKey = text(item && item.Nama_Normalized) ||
        normalizeOutletName(item && (item.Nama_Outlet || item.Nama_Outlet_Resmi));
      return itemKey === normalized;
    }) || null;
  }

  function sourceBadges(sources) {
    var list = Array.isArray(sources) ? sources : [];

    return list.map(function (source) {
      var label = source === 'MASTER'
        ? 'Master'
        : source === 'WATCHLIST'
          ? 'Watchlist'
          : source === 'OUTBOUND'
            ? 'Outbound'
            : source;

      return '<span class="hr-source">' + esc(label) + '</span>';
    }).join('');
  }

  function renderManageList() {
    var list = $('hr-outlet-list');
    if (!list) return;

    var query = state.manageQuery.toLowerCase();
    var items = (state.universe || []).filter(function (item) {
      var name = text(item && (item.Nama_Outlet || item.Nama_Outlet_Resmi));
      return !query || name.toLowerCase().indexOf(query) !== -1;
    });

    setText('hr-outlet-count', items.length + ' outlet');

    if (!items.length) {
      list.innerHTML = '<div class="hr-empty">Tidak ada outlet yang cocok dengan pencarian.</div>';
      return;
    }

    list.innerHTML = items.map(function (item) {
      var name = text(item.Nama_Outlet || item.Nama_Outlet_Resmi);
      var normalized = text(item.Nama_Normalized) || normalizeOutletName(name);
      var status = text(item.Status_Monitoring).toUpperCase();
      var isCompleted = status === 'SELESAI'; // SELESAI dipakai saat sudah pernah 100%
      var target = item.Target_Opening ? ' · Target ' + fmtDate(item.Target_Opening) : '';

      return '<label class="hr-outlet-item' + (isCompleted ? ' is-completed' : '') + '">' +
        '<input type="checkbox" data-outlet-checkbox data-outlet-key="' + esc(normalized) + '"' +
          (isCompleted ? ' checked' : '') + ' disabled>' +
        '<span class="hr-outlet-item__main">' +
          '<strong>' + esc(name) + '</strong>' +
          '<span class="hr-outlet-item__meta">' + sourceBadges(item.Sumber) + esc(target) + '</span>' +
        '</span>' +
        '<span class="hr-outlet-item__status ' + (isCompleted ? 'is-completed' : '') + '">' +
          (isCompleted ? '100% Selesai' : 'Belum Selesai') +
        '</span>' +
      '</label>';
    }).join('');
  }

  function handleOutletToggle(checkbox) {
    if (!checkbox) return;

    var entry = findUniverseEntry(checkbox.getAttribute('data-outlet-key'));
    if (!entry) return;

    var name = text(entry.Nama_Outlet || entry.Nama_Outlet_Resmi);
    var activate = checkbox.checked;

    checkbox.disabled = true;

    var request = activate
      ? api('HR_WATCHLIST_SAVE', {
          namaOutlet: name,
          targetOpening: entry.Target_Opening || '',
          statusMonitoring: 'AKTIF',
          forceCreate: true,
          dibuatOleh: 'HR Dashboard'
        })
      : api('HR_WATCHLIST_TOGGLE', {
          idWatchlist: entry.ID_Watchlist || '',
          namaOutlet: name,
          statusMonitoring: 'NONAKTIF'
        });

    request.then(function () {
      toast(activate ? 'Outlet "' + name + '" diaktifkan.' : 'Outlet "' + name + '" dinonaktifkan.', 'success');
      return load();
    }).then(function () {
      renderManageList();
    }).catch(function (error) {
      checkbox.checked = !activate;
      toast((error && error.message) || 'Gagal memperbarui watchlist.', 'danger');
    }).finally(function () {
      checkbox.disabled = false;
    });
  }

  /* ------------------------------------------------------------------------
   * Form outlet baru
   * ---------------------------------------------------------------------- */

  function updateMatch() {
    var input = $('hr-new-name');
    var result = $('hr-match-result');
    var submit = $('hr-new-submit');

    if (!input || !result || !submit) return;

    var name = text(input.value);

    if (!name) {
      result.hidden = true;
      result.className = 'hr-match';
      result.innerHTML = '';
      submit.disabled = true;
      return;
    }

    // Cari match di universe
    var matches = [];
    (state.universe || []).forEach(function (item) {
      var candidate = text(item && (item.Nama_Outlet || item.Nama_Outlet_Resmi));
      var candidateNormalized = text(item && item.Nama_Normalized) || normalizeOutletName(candidate);
      var normalized = normalizeOutletName(name);
      var score = normalized === candidateNormalized ? 1 : 0; // sederhana

      if (score === 1) {
        matches.push(item);
      }
    });

    if (matches.length) {
      var exact = matches.some(function (item) {
        return item.Nama_Normalized === normalizeOutletName(name);
      });

      result.hidden = false;
      result.className = 'hr-match hr-match--warning';
      result.innerHTML =
        '<p class="hr-match__title">' +
          (exact ? 'Nama outlet sudah terdaftar: ' : 'Ditemukan nama terdaftar: ') +
          '<strong>' + esc(matches[0].Nama_Outlet) + '</strong>' +
        '</p>' +
        '<p class="muted">Gunakan nama resmi berikut agar tidak terjadi duplikasi outlet.</p>' +
        '<div class="hr-match__actions">' +
          matches.slice(0, 3).map(function (item) {
            return '<button type="button" class="btn btn--secondary btn--sm" data-use-name="' + esc(item.Nama_Outlet) + '">Gunakan Nama Ini</button>';
          }).join('') +
        '</div>';

      submit.disabled = true;
      return;
    }

    result.hidden = false;
    result.className = 'hr-match hr-match--success';
    result.innerHTML = '<p class="hr-match__title">Nama baru tersedia — otomatis sinkron ke dropdown Outbound gudang.</p>';
    submit.disabled = false;
  }

  function showServerCandidates(candidates) {
    var result = $('hr-match-result');
    var submit = $('hr-new-submit');

    if (!result) return;

    var list = Array.isArray(candidates) ? candidates : [];

    result.hidden = false;
    result.className = 'hr-match hr-match--warning';
    result.innerHTML =
      '<p class="hr-match__title">Ditemukan nama terdaftar: <strong>' +
        esc(list.length ? list[0].Nama_Outlet : 'nama resmi') +
      '</strong></p>' +
      '<p class="muted">Gunakan nama resmi berikut agar tidak terjadi duplikasi outlet.</p>' +
      '<div class="hr-match__actions">' +
        list.slice(0, 3).map(function (item) {
          return '<button type="button" class="btn btn--secondary btn--sm" data-use-name="' + esc(item.Nama_Outlet) + '">Gunakan Nama Ini</button>';
        }).join('') +
      '</div>';

    if (submit) submit.disabled = true;
  }

  function setBusy(button, busy, label) {
    if (!button) return;

    if (busy) {
      button.dataset.originalText = button.textContent;
      button.disabled = true;
      button.textContent = label || 'Memproses…';
      return;
    }

    button.disabled = false;

    if (button.dataset.originalText) {
      button.textContent = button.dataset.originalText;
      delete button.dataset.originalText;
    }
  }

  function saveNewOutlet(name, targetOpening, forceCreate) {
    var submit = $('hr-new-submit');

    setBusy(submit, true, 'Menyimpan…');

    return api('HR_WATCHLIST_SAVE', {
      namaOutlet: name,
      targetOpening: targetOpening || '',
      statusMonitoring: 'AKTIF',
      forceCreate: !!forceCreate,
      dibuatOleh: 'HR Dashboard'
    }).then(function (result) {
      toast(
        result && result.result === 'UPDATED'
          ? 'Pantauan outlet "' + name + '" diperbarui.'
          : 'Cabang baru "' + name + '" berhasil didaftarkan.',
        'success'
      );

      var input = $('hr-new-name');
      var target = $('hr-new-target');

      if (input) input.value = '';
      if (target) target.value = '';

      return load();
    }).then(function () {
      updateMatch();
      renderManageList();
    }).catch(function (error) {
      if (error && error.data && error.data.code === 'DUPLICATE_MATCH') {
        showServerCandidates(error.data.candidates);
        return;
      }

      toast((error && error.message) || 'Gagal mendaftarkan cabang baru.', 'danger');
    }).finally(function () {
      setBusy(submit, false);
      updateMatch();
    });
  }

  function useOfficialName(name) {
    var input = $('hr-new-name');
    var target = $('hr-new-target');

    if (input) input.value = name;
    updateMatch();

    // Satu klik: daftarkan/pantau nama resmi tanpa memicu peringatan duplikat.
    saveNewOutlet(name, target ? target.value : '', true);
  }

  /* ------------------------------------------------------------------------
   * Toast
   * ---------------------------------------------------------------------- */

  function toast(message, type) {
    var root = $('hr-toast-root');
    if (!root) return;

    var el = document.createElement('div');
    el.className = 'hr-toast hr-toast--' + (type || 'info');
    el.textContent = message;
    root.appendChild(el);

    global.setTimeout(function () {
      el.classList.add('is-leaving');
      global.setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 220);
    }, 3800);
  }

  /* ------------------------------------------------------------------------
   * Event binding & init
   * ---------------------------------------------------------------------- */

  function bindEvents() {
    var branchFilter = $('hr-filter-branch');
    if (branchFilter) {
      branchFilter.addEventListener('input', function () {
        state.filters.branch = branchFilter.value;
        render();
      });
    }

    var statusFilter = $('hr-filter-status');
    if (statusFilter) {
      statusFilter.addEventListener('change', function () {
        state.filters.status = statusFilter.value;
        render();
      });
    }

    document.querySelectorAll('[data-hr-reload]').forEach(function (button) {
      button.addEventListener('click', function () {
        load().catch(function () { /* toast sudah ditampilkan */ });
      });
    });

    var manageOpen = $('hr-manage-open');
    if (manageOpen) manageOpen.addEventListener('click', openManage);

    document.querySelectorAll('[data-hr-manage-close]').forEach(function (element) {
      element.addEventListener('click', closeManage);
    });

    document.querySelectorAll('[data-hr-detail-close]').forEach(function (element) {
      element.addEventListener('click', closeDetail);
    });

    var outletSearch = $('hr-outlet-search');
    if (outletSearch) {
      outletSearch.addEventListener('input', function () {
        state.manageQuery = outletSearch.value;
        renderManageList();
      });
    }

    var outletList = $('hr-outlet-list');
    if (outletList) {
      outletList.addEventListener('change', function (event) {
        var checkbox = event.target.closest ? event.target.closest('[data-outlet-checkbox]') : null;
        if (checkbox) handleOutletToggle(checkbox);
      });
    }

    var newName = $('hr-new-name');
    if (newName) newName.addEventListener('input', updateMatch);

    var newForm = $('hr-new-form');
    if (newForm) {
      newForm.addEventListener('submit', function (event) {
        event.preventDefault();

        var name = text($('hr-new-name') ? $('hr-new-name').value : '');
        var target = $('hr-new-target') ? $('hr-new-target').value : '';

        if (!name) {
          toast('Nama outlet baru wajib diisi.', 'warning');
          return;
        }

        saveNewOutlet(name, target, false);
      });
    }

    var matchResult = $('hr-match-result');
    if (matchResult) {
      matchResult.addEventListener('click', function (event) {
        var button = event.target.closest ? event.target.closest('[data-use-name]') : null;
        if (!button) return;
        useOfficialName(button.getAttribute('data-use-name'));
      });
    }

    var shipmentBody = $('hr-shipment-body');
    if (shipmentBody) {
      shipmentBody.addEventListener('click', function (event) {
        if (event.target.closest && event.target.closest('a[data-pdf-link]')) return;

        var row = event.target.closest ? event.target.closest('tr[data-shipment-index]') : null;
        if (!row) return;

        var index = Number(row.getAttribute('data-shipment-index'));
        openDetail(state.viewShipments[index]);
      });

      shipmentBody.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;

        var row = event.target.closest ? event.target.closest('tr[data-shipment-index]') : null;
        if (!row) return;

        event.preventDefault();
        var index = Number(row.getAttribute('data-shipment-index'));
        openDetail(state.viewShipments[index]);
      });
    }

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;

      var detail = $('hr-detail-modal');
      var manage = $('hr-manage-modal');

      if (detail && !detail.hidden) {
        closeDetail();
        return;
      }

      if (manage && !manage.hidden) closeManage();
    });
  }

  function init() {
    resolveBackButton();
    bindEvents();
    updateMatch();
    load().catch(function () { /* error sudah dirender */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Hook test/console
  WMS.hrDashboard = {
    isSkuResmi: isSkuResmi,
    load: load,
    computeKpis: computeKpis
  };
})(window);