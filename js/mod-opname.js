/**
 * mod-opname.js — Modul 4 Stock Opname (Approval Supervisor)
 */

(function (global) {
  'use strict';

  var WMS = global.WMS;
  if (!WMS || !WMS.registerModule) return;

  var ui = WMS.ui;
  var COLSPAN = 8;
  var state = { items: [], drafts: [], stocks: [], loaded: false, locked: false };
  var panel = null;
  var filterCtl = null;

  function template() {
    return '' +
      '<div class="module-head">' +
        '<div>' +
          '<p class="eyebrow">Modul 4 · Stock Opname</p>' +
          '<h2>Stock Opname</h2>' +
          '<p class="module-head__desc">Terbitkan perintah hitung untuk tim lapangan dan tinjau hasil fisik dari AppSheet.</p>' +
        '</div>' +
        '<div class="module-head__actions">' +
          '<button type="button" class="btn btn--ghost btn--sm" data-action="refresh">' + ui.ICONS.refresh + ' Muat Ulang</button>' +
          '<button type="button" class="btn btn--primary btn--sm" data-action="create">+ Buat Perintah SO</button>' +
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

      '<div class="card opname-draft-card"><div class="card__head"><div><h3>Perintah SO Aktif di AppSheet</h3><p>Perintah DRAFT menunggu tim lapangan mengisi hasil hitung fisik.</p></div><span class="pill" id="opname-draft-count">0 perintah</span></div>' +
        '<div class="table-wrap"><table class="data-table"><thead><tr><th>ID SO</th><th>Tanggal</th><th>Kode SKU</th><th>Nama Barang</th><th class="num">Stok Sistem</th><th>Status</th></tr></thead><tbody id="opname-draft-body">' + ui.tableLoadingRow(6, 3) + '</tbody></table></div></div>' +

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
              '<th>ID SO</th><th>Tanggal SO</th><th>Kode SKU</th><th>Nama Barang</th>' +
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
        '<td>' + ui.esc(ui.skuLabel(item.Kode_SKU) || '—') + '</td>' +
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
      '<tr class="table-state" data-empty-row hidden><td colspan="' + (COLSPAN + 1) + '">' +
        ui.emptyState('Tidak ada hasil', 'Ubah kata kunci pencarian atau filter selisih.') +
      '</td></tr>';

    if (filterCtl) filterCtl.apply();
  }

  function renderDraftRows() {
    var body = panel && panel.querySelector('#opname-draft-body');
    if (!body) return;
    var count = panel.querySelector('#opname-draft-count');
    if (count) count.textContent = state.drafts.length + ' perintah';
    if (!state.drafts.length) {
      body.innerHTML = ui.tableEmptyRow(6, 'Tidak ada perintah DRAFT', 'Perintah baru akan muncul di sini setelah dibuat.');
      return;
    }
    body.innerHTML = state.drafts.slice().sort(function(a,b){return String(b.Tanggal_SO||'').localeCompare(String(a.Tanggal_SO||''));}).map(function(item){
      return '<tr><td>'+ui.esc(item.ID_SO||'—')+'</td><td class="nowrap muted">'+ui.esc(ui.formatDateTime(item.Tanggal_SO))+'</td><td>'+ui.esc(item.Kode_SKU||'—')+'</td><td>'+ui.esc(ui.skuLabel(item.Kode_SKU)||'—')+'</td><td class="num">'+ui.formatQty(item.Stok_Sistem)+'</td><td>'+ui.badge('DRAFT')+'</td></tr>';
    }).join('');
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
      state.drafts = data && Array.isArray(data.draftItems) ? data.draftItems : [];
      state.loaded = true;
      setStats();
      renderRows();
      renderDraftRows();
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

    var refreshButton = root.querySelector('[data-action="refresh"]');
    if (refreshButton) refreshButton.addEventListener('click', function () {
      load({ silent: false });
    });
    var createButton = root.querySelector('[data-action="create"]');
    if (createButton) createButton.addEventListener('click', openCreateOrder);

    var tbody = root.querySelector('#opname-body');
    if (tbody) tbody.addEventListener('click', function (event) {
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
