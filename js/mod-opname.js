/**
 * mod-opname.js — Modul 4 Stock Opname (Approval Supervisor)
 *
 * Tabel utama menampilkan perintah SO per sesi/tanggal. Klik sesi untuk
 * membuka daftar seluruh item, memfilter status hitung, dan menyetujui hasil
 * SO sehingga Stok_Gudang + Kartu_Stok diperbarui oleh backend.
 */

(function (global) {
  'use strict';

  var WMS = global.WMS;
  if (!WMS || !WMS.registerModule) return;

  var ui = WMS.ui;
  var SESSION_COLSPAN = 5;
  var ITEM_COLSPAN = 9;
  var state = {
    items: [],
    drafts: [],
    active: [],
    sessions: [],
    selectedSession: null,
    itemFilter: '',
    stocks: [],
    progress: null,
    loaded: false,
    locked: false
  };
  var panel = null;

  function template() {
    return '' +
      '<div class="module-head">' +
        '<div>' +
          '<p class="eyebrow">Modul 4 · Stock Opname</p>' +
          '<h2>Stock Opname</h2>' +
          '<p class="module-head__desc">Terbitkan perintah hitung untuk tim lapangan dan tinjau hasil fisik dari AppSheet.</p>' +
        '</div>' +
        '<div class="module-head__actions">' +
          '<button type="button" class="btn btn--secondary btn--sm" data-action="sync-so">' + ui.ICONS.refresh + ' Sync SO AppSheet</button>' +
          '<button type="button" class="btn btn--ghost btn--sm" data-action="refresh">' + ui.ICONS.refresh + ' Muat Ulang</button>' +
          '<button type="button" class="btn btn--primary btn--sm" data-action="create">+ Buat Perintah SO</button>' +
        '</div>' +
      '</div>' +

      '<div class="stat-grid">' +
        '<article class="stat-card stat-card--accent">' +
          '<span class="stat-card__label">Menunggu Approval</span>' +
          '<strong class="stat-card__value" data-stat="pending">—</strong>' +
          '<span class="stat-card__meta">Item PENDING_APPROVAL</span>' +
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
            '<h3>Daftar Perintah SO</h3>' +
            '<p>Dikelompokkan per sesi/tanggal. Klik baris untuk membuka seluruh item dan menyetujui hasil hitung.</p>' +
          '</div>' +
          '<div class="opname-progress">' +
            '<span class="pill pill--muted" id="opname-session-count">0 sesi</span>' +
            '<span class="pill" id="opname-progress-label">0 / 0 dihitung</span>' +
          '</div>' +
        '</div>' +
        '<div class="table-wrap">' +
          '<table class="data-table" id="opname-session-table">' +
            '<thead><tr>' +
              '<th>Tanggal Perintah SO</th>' +
              '<th class="num">Total Item</th>' +
              '<th>Progres Hitung</th>' +
              '<th>Status</th>' +
              '<th class="actions-cell">Aksi</th>' +
            '</tr></thead>' +
            '<tbody id="opname-session-body">' + ui.tableLoadingRow(SESSION_COLSPAN, 4) + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>' +

      '<div class="card opname-detail-card" id="opname-detail-card" hidden>' +
        '<div class="card__head">' +
          '<div>' +
            '<h3 id="opname-detail-title">Detail Perintah SO</h3>' +
            '<p id="opname-detail-subtitle">Pilih perintah SO pada daftar di atas.</p>' +
          '</div>' +
          '<div class="opname-progress">' +
            '<span class="pill" id="opname-detail-progress">0 / 0 dihitung</span>' +
            '<button type="button" class="btn btn--ghost btn--sm" data-action="close-detail">Tutup</button>' +
          '</div>' +
        '</div>' +
        '<div class="toolbar">' +
          '<select id="opname-item-filter" class="select select--sm" aria-label="Filter status item">' +
            '<option value="">Semua</option>' +
            '<option value="DRAFT">Belum Dihitung (DRAFT)</option>' +
            '<option value="PENDING_APPROVAL">Sudah Dihitung (PENDING_APPROVAL)</option>' +
          '</select>' +
          '<span class="toolbar__spacer"></span>' +
          '<span class="pill pill--muted" id="opname-item-count">0 item</span>' +
        '</div>' +
        '<div class="table-wrap">' +
          '<table class="data-table" id="opname-item-table">' +
            '<thead><tr>' +
              '<th>ID SO</th><th>Kode SKU</th><th>Nama Barang</th>' +
              '<th class="num">Stok Sistem</th><th class="num">Stok Fisik</th><th class="num">Selisih</th>' +
              '<th>PIC</th><th>Status</th><th class="actions-cell">Keputusan</th>' +
            '</tr></thead>' +
            '<tbody id="opname-item-body">' + ui.tableLoadingRow(ITEM_COLSPAN, 4) + '</tbody>' +
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

  /**
   * Kunci sesi: tanggal ISO (yyyy-MM-dd) bila tersedia agar item dengan jam
   * berbeda tetap bergabung pada sesi yang sama.
   */
  function sessionKey(item) {
    var raw = String(item && item.Tanggal_SO != null ? item.Tanggal_SO : '').trim();
    if (!raw) return 'TANPA TANGGAL';

    var iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    return iso ? iso[1] : raw;
  }

  function isPending(item) {
    return String(item && item.Status_SO != null ? item.Status_SO : '').toUpperCase() === 'PENDING_APPROVAL';
  }

  function buildSessions() {
    var map = {};
    var order = [];

    state.active.forEach(function (item) {
      var key = sessionKey(item);

      if (!map[key]) {
        map[key] = { key: key, tanggalSo: key, items: [] };
        order.push(key);
      }

      map[key].items.push(item);
    });

    state.sessions = order.map(function (key) {
      var session = map[key];
      var items = session.items.slice().sort(function (a, b) {
        return String(a.ID_SO || '').localeCompare(String(b.ID_SO || ''));
      });
      var total = items.length;
      var counted = items.filter(isPending).length;

      return {
        key: key,
        tanggalSo: session.tanggalSo,
        items: items,
        total: total,
        counted: counted,
        remaining: total - counted,
        percent: total ? Math.round((counted / total) * 100) : 0
      };
    }).sort(function (a, b) {
      return String(b.tanggalSo || '').localeCompare(String(a.tanggalSo || ''));
    });
  }

  function findSession(key) {
    if (!key) return null;

    return state.sessions.find(function (session) {
      return session.key === key;
    }) || null;
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

  function resolveProgress(data) {
    if (data && data.progress && typeof data.progress === 'object') {
      return data.progress;
    }

    var counted = state.items.length;
    var total = state.active.length || (counted + state.drafts.length);

    return {
      total: total,
      counted: counted,
      remaining: Math.max(0, total - counted),
      percent: total ? Math.round((counted / total) * 100) : 0
    };
  }

  function setProgress(progress) {
    if (!panel) return;

    var total = Number(progress && progress.total) || 0;
    var counted = Number(progress && progress.counted) || 0;
    var label = panel.querySelector('#opname-progress-label');

    if (label) label.textContent = counted + ' / ' + total + ' dihitung';
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

  function sessionStatusBadge(session) {
    if (!session.counted) {
      return '<span class="badge badge--neutral"><span class="badge__dot"></span>Belum Dihitung</span>';
    }

    if (session.counted < session.total) {
      return '<span class="badge badge--warning"><span class="badge__dot"></span>Sebagian Dihitung</span>';
    }

    return '<span class="badge badge--warning"><span class="badge__dot"></span>Siap Approval</span>';
  }

  function renderSessions() {
    var tbody = panel && panel.querySelector('#opname-session-body');
    if (!tbody) return;

    var count = panel.querySelector('#opname-session-count');
    if (count) count.textContent = state.sessions.length + ' sesi';

    if (!state.sessions.length) {
      tbody.innerHTML = ui.tableEmptyRow(
        SESSION_COLSPAN,
        'Belum ada perintah SO',
        'Terbitkan perintah baru atau jalankan Sync SO AppSheet untuk menarik hasil hitung tim lapangan.'
      );
      return;
    }

    tbody.innerHTML = state.sessions.map(function (session) {
      var active = session.key === state.selectedSession;

      return '<tr class="opname-session-row' + (active ? ' is-active' : '') + '" data-session="' + ui.esc(session.key) + '" tabindex="0" role="button" aria-label="Buka daftar item ' + ui.esc(ui.formatDate(session.tanggalSo)) + '">' +
        '<td><strong>' + ui.esc(ui.formatDate(session.tanggalSo)) + '</strong></td>' +
        '<td class="num">' + ui.formatNumber(session.total) + ' item</td>' +
        '<td>' +
          '<div class="opname-session-progress">' +
            '<span class="opname-session-progress__bar"><span style="width:' + session.percent + '%"></span></span>' +
            '<span class="muted">' + session.counted + ' / ' + session.total + ' dihitung</span>' +
          '</div>' +
        '</td>' +
        '<td>' + sessionStatusBadge(session) + '</td>' +
        '<td class="actions-cell">' +
          '<div class="btn-row" style="justify-content:flex-end">' +
            '<button type="button" class="btn btn--ghost btn--sm" data-open-session="' + ui.esc(session.key) + '">Buka Daftar Item</button>' +
          '</div>' +
        '</td>' +
      '</tr>';
    }).join('');
  }

  function renderDetail() {
    var card = panel && panel.querySelector('#opname-detail-card');
    if (!card) return;

    var session = findSession(state.selectedSession);

    if (!session) {
      card.hidden = true;
      return;
    }

    card.hidden = false;

    var title = panel.querySelector('#opname-detail-title');
    if (title) title.textContent = 'Perintah SO ' + ui.formatDate(session.tanggalSo);

    var subtitle = panel.querySelector('#opname-detail-subtitle');
    if (subtitle) {
      subtitle.textContent = session.total + ' item · ' + session.remaining + ' belum dihitung · ' + session.counted + ' siap approval';
    }

    var progress = panel.querySelector('#opname-detail-progress');
    if (progress) progress.textContent = session.counted + ' / ' + session.total + ' dihitung';

    var items = session.items.filter(function (item) {
      if (!state.itemFilter) return true;
      return String(item.Status_SO || '').toUpperCase() === state.itemFilter;
    });

    var count = panel.querySelector('#opname-item-count');
    if (count) count.textContent = items.length + ' item';

    var tbody = panel.querySelector('#opname-item-body');
    if (!tbody) return;

    if (!items.length) {
      tbody.innerHTML = ui.tableEmptyRow(
        ITEM_COLSPAN,
        'Tidak ada item pada filter ini',
        'Ubah filter status untuk melihat item lainnya pada sesi ini.'
      );
      return;
    }

    tbody.innerHTML = items.map(function (item) {
      var pending = isPending(item);
      var diff = ui.num(item.Selisih);
      var idSo = ui.esc(item.ID_SO || '—');

      return '<tr data-row>' +
        '<td>' + idSo + '</td>' +
        '<td>' + ui.esc(item.Kode_SKU || '—') + '</td>' +
        '<td>' + ui.esc(ui.skuLabel(item.Kode_SKU) || '—') + '</td>' +
        '<td class="num">' + ui.formatQty(item.Stok_Sistem) + '</td>' +
        '<td class="num">' + (pending ? ui.formatQty(item.Stok_Fisik) : '—') + '</td>' +
        '<td class="num ' + diffClass(diff) + '"><strong>' + (pending ? diffLabel(diff) : '—') + '</strong></td>' +
        '<td>' + ui.esc(item.Approved_By || '—') + '</td>' +
        '<td>' + ui.badge(item.Status_SO || 'DRAFT') + '</td>' +
        '<td class="actions-cell">' +
          (pending
            ? '<div class="btn-row" style="justify-content:flex-end">' +
                '<button type="button" class="btn btn--primary btn--sm" data-approve="' + idSo + '">Approve</button>' +
                '<button type="button" class="btn btn--danger-ghost btn--sm" data-reject="' + idSo + '">Reject</button>' +
              '</div>'
            : '<span class="muted">Menunggu hitung</span>') +
        '</td>' +
      '</tr>';
    }).join('');
  }

  function renderError(error) {
    var tbody = panel && panel.querySelector('#opname-session-body');
    if (tbody) {
      tbody.innerHTML = ui.tableErrorRow(SESSION_COLSPAN, error && error.message);
      ui.bindRetry(tbody, function () { load({ silent: false }); });
    }

    var card = panel && panel.querySelector('#opname-detail-card');
    if (card) card.hidden = true;
  }

  async function load(options) {
    if (state.locked) return;
    var opts = options || {};
    var tbody = panel && panel.querySelector('#opname-session-body');

    if (!opts.silent && !state.loaded && tbody) tbody.innerHTML = ui.tableLoadingRow(SESSION_COLSPAN, 4);

    try {
      var data = await WMS.api.request('OPNAME_PENDING');
      state.items = data && Array.isArray(data.items) ? data.items : [];
      state.drafts = data && Array.isArray(data.draftItems) ? data.draftItems : [];
      state.active = data && Array.isArray(data.activeItems)
        ? data.activeItems
        : state.drafts.concat(state.items);
      state.loaded = true;
      state.progress = resolveProgress(data);
      buildSessions();

      if (state.selectedSession && !findSession(state.selectedSession)) {
        state.selectedSession = null;
      }

      setStats();
      setProgress(state.progress);
      renderSessions();
      renderDetail();
    } catch (error) {
      if (WMS.api.isAuthError(error)) return;
      if (opts.silent && state.loaded) {
        ui.toast((error && error.message) || 'Gagal memuat daftar opname.', 'danger');
        return;
      }
      renderError(error);
    }
  }

  /**
   * Menarik hasil scan AppSheet (PENDING_APPROVAL) dan menyatukannya ke
   * perintah SO DRAFT aktif dengan Kode_SKU yang sama.
   *
   * @param {{silent?: boolean}} [options] Opsi toast.
   * @return {Promise<Object>} Ringkasan hasil sinkronisasi backend.
   */
  async function syncAppSheet(options) {
    var opts = options || {};
    var result = await WMS.api.request('SYNC_SO_APPSHEET');

    if (!opts.silent) {
      var synced = Number(result && result.syncedCount);
      if (!isFinite(synced)) synced = Number(result && result.mergedCount) || 0;

      var deleted = Number(result && result.deletedCount) || 0;
      var withoutDraft = result && Array.isArray(result.pendingWithoutDraft) ? result.pendingWithoutDraft.length : 0;
      var message;

      if (synced > 0) {
        message = synced + ' item SO berhasil disinkronkan ke perintah aktif' +
          (deleted > 0 ? ' dan ' + deleted + ' baris duplikat AppSheet dihapus' : '') + '.';
      } else if (withoutDraft > 0) {
        message = withoutDraft + ' hasil hitung AppSheet menunggu approval tanpa perintah DRAFT pasangan.';
      } else {
        message = 'Tidak ada hasil hitung AppSheet baru untuk disinkronkan.';
      }

      ui.toast(message, synced > 0 ? 'success' : 'info', 'Sinkronisasi SO selesai');
    }

    return result;
  }

  function findItem(id) {
    return state.items.find(function (item) {
      return String(item.ID_SO) === String(id);
    }) || null;
  }

  async function loadStockOptions() {
    if (state.stocks.length) return state.stocks;
    var data = await WMS.api.request('INVENTORY_LIST');
    state.stocks = data && Array.isArray(data.items) ? data.items.filter(function(item){return String(item.Status_Aktif||'AKTIF').toUpperCase()==='AKTIF';}) : [];
    return state.stocks;
  }

  function openCreateOrder() {
    var body = '<form id="opname-create-form" novalidate>' +
      '<div class="field"><label for="opname-order-date">Tanggal Perintah SO</label><input class="input" id="opname-order-date" type="date" value="'+ui.esc(ui.todayIso())+'" required></div>' +
      '<fieldset class="field"><legend>Cakupan Opname</legend><label class="radio-option"><input type="radio" name="opname-scope" value="ALL" checked> Seluruh Stok Gudang (Full Opname)</label><label class="radio-option"><input type="radio" name="opname-scope" value="SELECTED"> Pilih SKU Tertentu (Cycle Count)</label></fieldset>' +
      '<div id="opname-sku-picker" hidden><label for="opname-sku-search">Cari SKU / nama barang</label><input class="input" id="opname-sku-search" type="search" placeholder="Cari SKU atau nama barang"><div class="opname-sku-list" id="opname-sku-list"><div class="muted">Memuat stok gudang…</div></div><p class="field-hint" id="opname-selected-count">0 SKU dipilih</p></div>' +
      '<div class="form-alert" id="opname-create-error" hidden role="alert"></div></form>';
    ui.openModal({eyebrow:'Stock Opname',title:'Buat Perintah Stock Opname',size:'lg',body:body,
      footer:'<button type="button" class="btn btn--ghost" data-modal-close>Batal</button><button type="submit" class="btn btn--primary" form="opname-create-form" data-submit>Buat Perintah</button>',
      onMount:function(modal,close){
        var picker=modal.querySelector('#opname-sku-picker'),list=modal.querySelector('#opname-sku-list'),search=modal.querySelector('#opname-sku-search'),selectedCount=modal.querySelector('#opname-selected-count');
        if (!picker || !list || !search || !selectedCount) return;
        var selected={};
        function draw(){var query=String(search.value||'').trim().toLowerCase();var stocks=state.stocks.filter(function(item){return !query||[item.Kode_SKU,item.Nama_Barang].join(' ').toLowerCase().indexOf(query)!==-1;});list.innerHTML=stocks.map(function(item){var sku=String(item.Kode_SKU||'');return '<label class="opname-sku-option"><input type="checkbox" data-sku="'+ui.esc(sku)+'" '+(selected[sku]?'checked':'')+'><span><strong>'+ui.esc(sku)+'</strong><small>'+ui.esc(item.Nama_Barang||'')+'</small></span><span class="muted">Stok '+ui.formatQty(item.Stok_Aktif)+'</span></label>';}).join('')||'<div class="muted">SKU tidak ditemukan.</div>';selectedCount.textContent=Object.keys(selected).length+' SKU dipilih';}
        modal.querySelectorAll('[name="opname-scope"]').forEach(function(radio){radio.addEventListener('change',function(){picker.hidden=radio.value!=='SELECTED'||!radio.checked;});});
        search.addEventListener('input',draw);
        list.addEventListener('change',function(event){var box=event.target.closest('[data-sku]');if(!box)return;var sku=box.getAttribute('data-sku');if(box.checked)selected[sku]=true;else delete selected[sku];draw();});
        loadStockOptions().then(draw).catch(function(error){list.textContent=error.message||'Daftar stok gagal dimuat.';});
        var createForm = modal.querySelector('#opname-create-form');
        if (!createForm) return;
        createForm.addEventListener('submit',async function(event){event.preventDefault();var errorBox=modal.querySelector('#opname-create-error'),submit=modal.querySelector('[data-submit]');errorBox.hidden=true;var scope=modal.querySelector('[name="opname-scope"]:checked').value;var skuList=Object.keys(selected);if(scope==='SELECTED'&&!skuList.length){errorBox.textContent='Pilih minimal satu SKU untuk Cycle Count.';errorBox.hidden=false;return;}ui.setBusy(submit,true,'Membuat perintah…');try{var result=await WMS.api.request('OPNAME_CREATE',{scope:scope,skuList:skuList,tanggalSo:modal.querySelector('#opname-order-date').value});close('saved');var message='Berhasil menerbitkan '+(result.createdCount||0)+' SKU ke AppSheet.';if(result.skippedCount)message+=' '+result.skippedCount+' SKU dilewati: '+(result.skippedSkus||[]).join(', ')+'.';ui.toast(message,result.skippedCount?'warning':'success','Perintah SO dibuat');await load({silent:false});}catch(error){if(WMS.api.isAuthError(error)){close('auth');return;}ui.setBusy(submit,false);errorBox.textContent=error.message||'Perintah SO gagal dibuat.';errorBox.hidden=false;}});
      }
    });
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
      '<div class="detail"><span class="detail__label">PIC</span><span class="detail__value">' + ui.esc(item.Approved_By || '—') + '</span></div>' +
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

  function openSession(key) {
    state.selectedSession = key;
    state.itemFilter = '';

    var filter = panel && panel.querySelector('#opname-item-filter');
    if (filter) filter.value = '';

    renderSessions();
    renderDetail();

    var card = panel && panel.querySelector('#opname-detail-card');
    if (card && !card.hidden && typeof card.scrollIntoView === 'function') {
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function closeSession() {
    state.selectedSession = null;
    state.itemFilter = '';

    var filter = panel && panel.querySelector('#opname-item-filter');
    if (filter) filter.value = '';

    renderSessions();
    renderDetail();
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

    var refreshButton = root.querySelector('[data-action="refresh"]');
    if (refreshButton) refreshButton.addEventListener('click', async function (event) {
      var button = event.currentTarget;
      if (button.disabled) return;
      ui.setBusy(button, true, 'Menyinkronkan…');
      try {
        await syncAppSheet({ silent: true });
      } catch (error) {
        if (WMS.api.isAuthError(error)) {
          ui.setBusy(button, false);
          return;
        }
        ui.toast((error && error.message) || 'Gagal menyinkronkan SO AppSheet.', 'warning', 'Sinkronisasi dilewati');
      } finally {
        ui.setBusy(button, false);
      }
      await load({ silent: false });
    });

    var syncButton = root.querySelector('[data-action="sync-so"]');
    if (syncButton) syncButton.addEventListener('click', async function (event) {
      var button = event.currentTarget;
      if (button.disabled) return;
      ui.setBusy(button, true, 'Menyinkronkan…');
      try {
        await syncAppSheet({ silent: false });
        await load({ silent: false });
      } catch (error) {
        if (!WMS.api.isAuthError(error)) {
          ui.toast((error && error.message) || 'Gagal menyinkronkan SO AppSheet.', 'danger');
        }
      } finally {
        ui.setBusy(button, false);
      }
    });

    var createButton = root.querySelector('[data-action="create"]');
    if (createButton) createButton.addEventListener('click', openCreateOrder);

    var sessionBody = root.querySelector('#opname-session-body');
    if (sessionBody) {
      sessionBody.addEventListener('click', function (event) {
        var row = event.target.closest ? event.target.closest('[data-session]') : null;
        if (row) openSession(row.getAttribute('data-session'));
      });

      sessionBody.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
        var row = event.target.closest ? event.target.closest('[data-session]') : null;
        if (!row) return;
        event.preventDefault();
        openSession(row.getAttribute('data-session'));
      });
    }

    var closeButton = root.querySelector('[data-action="close-detail"]');
    if (closeButton) closeButton.addEventListener('click', closeSession);

    var itemFilter = root.querySelector('#opname-item-filter');
    if (itemFilter) itemFilter.addEventListener('change', function () {
      state.itemFilter = itemFilter.value || '';
      renderDetail();
    });

    var itemBody = root.querySelector('#opname-item-body');
    if (itemBody) itemBody.addEventListener('click', function (event) {
      var approveBtn = event.target.closest ? event.target.closest('[data-approve]') : null;
      if (approveBtn) {
        var approved = findItem(approveBtn.getAttribute('data-approve'));
        if (approved) approve(approved);
        return;
      }

      var rejectBtn = event.target.closest ? event.target.closest('[data-reject]') : null;
      if (rejectBtn) {
        var rejected = findItem(rejectBtn.getAttribute('data-reject'));
        if (rejected) reject(rejected);
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
