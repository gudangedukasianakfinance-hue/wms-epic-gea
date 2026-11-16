/**
 * mod-outbound.js — Modul 2 Outbound (Picking, Dispatch, KPI OTD)
 */

(function (global) {
  'use strict';

  var WMS = global.WMS;
  if (!WMS || !WMS.registerModule) return;

  var ui = WMS.ui;
  var COLSPAN = 7;
  var state = { items: [], groups: [], expanded: {}, loaded: false };
  var panel = null;
  var filterCtl = null;
  var stockMap = null;
  var outboundSummary = null;

  function template() {
    return '' +
      '<div class="module-head">' +
        '<div>' +
          '<p class="eyebrow">Modul 2 · Barang Keluar</p>' +
          '<h2>Outbound — Picking &amp; Dispatch</h2>' +
          '<p class="module-head__desc">Buat picking order, unggah surat jalan saat dispatch, lalu konfirmasi kedatangan untuk menghitung KPI On-Time Delivery.</p>' +
        '</div>' +
        '<div class="module-head__actions">' +
          '<button type="button" class="btn btn--ghost btn--sm" data-action="refresh">' + ui.ICONS.refresh + ' Muat Ulang</button>' +
          '<button type="button" class="btn btn--secondary btn--sm" data-action="sync-staging">' + ui.ICONS.refresh + ' Tarik Order Sales</button>' +
          '<button type="button" class="btn btn--primary btn--sm" data-action="picking">Buat Picking Order</button>' +
        '</div>' +
      '</div>' +

      '<div class="stat-grid">' +
        '<article class="stat-card stat-card--accent">' +
          '<span class="stat-card__label">Total Order</span>' +
          '<strong class="stat-card__value" data-stat="total">—</strong>' +
          '<span class="stat-card__meta">Total No. DO unik</span>' +
        '</article>' +
        '<article class="stat-card">' +
          '<span class="stat-card__label">Dalam Proses</span>' +
          '<strong class="stat-card__value" data-stat="progress">—</strong>' +
          '<span class="stat-card__meta">Status PICKED + DISPATCHED</span>' +
        '</article>' +
        '<article class="stat-card">' +
          '<span class="stat-card__label">Sudah Terkirim</span>' +
          '<strong class="stat-card__value" data-stat="delivered">—</strong>' +
          '<span class="stat-card__meta">Status DELIVERED</span>' +
        '</article>' +
        '<article class="stat-card">' +
          '<span class="stat-card__label">KPI OTD</span>' +
          '<strong class="stat-card__value" data-stat="otd">—</strong>' +
          '<span class="stat-card__meta" data-stat="otd-meta">On-time / terkirim</span>' +
        '</article>' +
      '</div>' +

      '<div class="card">' +
        '<div class="card__head">' +
          '<div>' +
            '<h3>Daftar Outbound</h3>' +
            '<p>Dispatch hanya dapat dilakukan untuk order berstatus PICKED.</p>' +
          '</div>' +
          '<span class="pill" id="outbound-count">0 order</span>' +
        '</div>' +
        '<div class="toolbar">' +
          ui.searchField('outbound-search', 'Cari ID, No DO, customer, SKU…') +
          '<select id="outbound-filter" class="select select--sm" aria-label="Filter status kirim">' +
            '<option value="">Semua status</option>' +
            '<option value="PICKED">PICKED</option>' +
            '<option value="DISPATCHED">DISPATCHED</option>' +
            '<option value="DELIVERED">DELIVERED</option>' +
          '</select>' +
          '<select id="outbound-otd-filter" class="select select--sm" aria-label="Filter status OTD">' +
            '<option value="">Semua OTD</option>' +
            '<option value="ON_TIME">ON_TIME</option>' +
            '<option value="DELAY">DELAY</option>' +
            '<option value="NONE">Belum dinilai</option>' +
          '</select>' +
          '<span class="toolbar__spacer"></span>' +
          '<span class="toolbar__note">Sumber: <code>Outbound_Log</code></span>' +
        '</div>' +
        '<div class="table-wrap">' +
          '<table class="data-table data-table--compact" id="outbound-table">' +
            '<thead><tr>' +
              '<th>No DO / Tujuan</th>' +
              '<th>Barang</th>' +
              '<th class="num">Qty</th>' +
              '<th>Jadwal Kirim</th>' +
              '<th>OTD</th>' +
              '<th>Status Kirim</th>' +
              '<th class="actions-cell">Aksi</th>' +
            '</tr></thead>' +
            '<tbody id="outbound-body">' + ui.tableLoadingRow(COLSPAN, 5) + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>';
  }

  function setStats() {
    if (!panel) return;
    var groups = groupOutboundItems_(state.items);
    var total = groups.length, progress = 0, delivered = 0, onTime = 0, delay = 0;
    groups.forEach(function (group) {
      if (group.statuses.PICKED || group.statuses.DISPATCHED) progress++;
      if (group.statuses.DELIVERED) {
        delivered++;
        if (group.otd.ON_TIME) onTime++;
        else if (group.otd.DELAY) delay++;
      }
    });

    var otdValue = delivered > 0 ? Math.round((onTime / delivered) * 100) + '%' : '—';
    var otdMeta = delivered > 0
      ? onTime + ' on-time · ' + delay + ' delay dari ' + delivered + ' terkirim'
      : 'Belum ada delivery terkonfirmasi';

    var map = {
      total: total,
      progress: progress,
      delivered: delivered,
      otd: otdValue
    };

    Object.keys(map).forEach(function (key) {
      var el = panel.querySelector('[data-stat="' + key + '"]');
      if (el) el.textContent = map[key];
    });

    var meta = panel.querySelector('[data-stat="otd-meta"]');
    if (meta) meta.textContent = otdMeta;
  }

  function groupOutboundItems_(items) {
    var groups = [], index = {};
    (items || []).forEach(function (item) {
      var noDo = String(item.No_DO || '').trim();
      var key = noDo ? noDo.toUpperCase() : String(item.ID_Outbound || '').trim().toUpperCase();
      if (!key) return;
      if (!index[key]) {
        index[key] = { key:key, noDo:noDo || item.ID_Outbound || '', items:[], statuses:{}, otd:{}, qty:0, customers:{}, targets:{}, actuals:{}, links:{} };
        groups.push(index[key]);
      }
      var group = index[key];
      group.items.push(item);
      group.qty += ui.num(item.Qty);
      var status = String(item.Status_Kirim || '').trim().toUpperCase();
      var otd = String(item.Status_OTD || '').trim().toUpperCase();
      if (status) group.statuses[status] = true;
      if (otd) group.otd[otd] = true;
      if (item.Tujuan_Customer) group.customers[String(item.Tujuan_Customer).trim()] = true;
      if (item.Tgl_Target_Kirim) group.targets[String(item.Tgl_Target_Kirim).slice(0,10)] = true;
      if (item.Tgl_Aktual_Tiba) group.actuals[String(item.Tgl_Aktual_Tiba).slice(0,10)] = true;
      if (item.Link_PDF) group.links[String(item.Link_PDF)] = true;
    });
    return groups;
  }

  function renderRows() {
    var tbody = panel && panel.querySelector('#outbound-body');
    if (!tbody) return;

    if (!state.items.length) {
      tbody.innerHTML = ui.tableEmptyRow(COLSPAN, 'Belum ada order outbound', 'Buat picking order pertama atau tunggu data dari tim penjualan.');
      if (filterCtl) filterCtl.apply();
      return;
    }

    state.groups = groupOutboundItems_(state.items);
    tbody.innerHTML = state.groups.map(function (group) {
      var statuses = Object.keys(group.statuses), otds = Object.keys(group.otd);
      var status = group.statuses.PICKED ? 'PICKED' : group.statuses.DISPATCHED ? 'DISPATCHED' : group.statuses.DELIVERED ? 'DELIVERED' : (statuses[0] || '');
      var otd = group.otd.ON_TIME ? 'ON_TIME' : group.otd.DELAY ? 'DELAY' : (otds[0] || '');
      var expanded = !!state.expanded[group.key];
      var customer = Object.keys(group.customers).join(', ');
      var target = Object.keys(group.targets)[0] || '';
      var actual = Object.keys(group.actuals)[0] || '';
      var first = group.items[0];
      var search = group.items.map(function (i) { return [i.ID_Outbound,i.No_DO,i.Tujuan_Customer,i.Kode_SKU,i.Nama_Barang,i.Status_Kirim,i.Status_OTD].join(' '); }).join(' ').toLowerCase();
      var action = '';
      if (group.statuses.PICKED) action += '<button type="button" class="btn btn--primary btn--sm" data-dispatch="'+ui.esc(first.ID_Outbound)+'">Dispatch</button>';
      if (group.statuses.DISPATCHED) action += '<button type="button" class="btn btn--secondary btn--sm" data-delivered="'+ui.esc(first.ID_Outbound)+'">Konfirmasi Tiba</button>';
      if (group.statuses.DELIVERED && !group.statuses.PICKED && !group.statuses.DISPATCHED) action += '<span class="muted" style="font-size:11.5px">Selesai</span>';
      action += '<button type="button" class="btn btn--ghost btn--sm" data-edit-dates="'+ui.esc(first.ID_Outbound)+'">Edit Tanggal</button>';
      var detailRows = group.items.map(function (item) {
        return '<tr><td>'+ui.esc(item.ID_Outbound||'�')+'</td><td>'+ui.esc(item.Kode_SKU||'�')+'</td><td>'+ui.esc(item.Nama_Barang||'�')+'</td><td class="num">'+ui.formatQty(item.Qty)+'</td></tr>';
      }).join('');
      return '<tr data-row data-status="'+ui.esc(status)+'" data-otd="'+ui.esc(otd||'NONE')+'" data-search="'+ui.esc(search)+'">'+
        '<td class="outbound-group-toggle" colspan="2"><button type="button" class="outbound-expand" data-toggle-group="'+ui.esc(group.key)+'" aria-expanded="'+expanded+'"><span class="outbound-expand__arrow">'+(expanded?'&#9662;':'&#9656;')+'</span><strong>'+ui.esc(group.noDo)+'</strong><span class="muted">'+ui.esc(customer)+'</span></button></td>'+
        '<td><button type="button" class="outbound-summary-toggle" data-toggle-group="'+ui.esc(group.key)+'" aria-expanded="'+expanded+'">'+group.items.length+' Item SKU &bull; Total '+ui.formatNumber(group.qty)+' pcs</button></td>'+
        '<td class="num">'+ui.formatNumber(group.qty)+'</td><td>'+ui.cellStack(ui.formatDate(target),'Tiba: '+ui.formatDate(actual))+'</td><td>'+(otd?ui.badge(otd):'<span class="muted">�</span>')+'</td><td>'+ui.badge(status)+'</td><td class="actions-cell"><div class="table-actions">'+ui.pdfLink(Object.keys(group.links)[0])+action+'</div></td></tr>'+
        '<tr class="outbound-detail-row" data-detail-for="'+ui.esc(group.key)+'" '+(expanded?'':'hidden')+'><td colspan="'+COLSPAN+'"><div class="outbound-detail-wrap"><table class="data-table data-table--compact"><thead><tr><th>ID Outbound</th><th>Kode SKU</th><th>Nama Barang</th><th class="num">Qty</th></tr></thead><tbody>'+detailRows+'</tbody></table></div></td></tr>';
    }).join('') +
      '<tr class="table-state" data-empty-row hidden><td colspan="' + COLSPAN + '">' +
        ui.emptyState('Tidak ada hasil', 'Ubah kata kunci pencarian atau filter status.') +
      '</td></tr>';
    if (filterCtl) filterCtl.apply();
  }

  function renderError(error) {
    var tbody = panel && panel.querySelector('#outbound-body');
    if (!tbody) return;
    tbody.innerHTML = ui.tableErrorRow(COLSPAN, error && error.message);
    ui.bindRetry(tbody, function () { load({ silent: false }); });
  }

  async function load(options) {
    var opts = options || {};
    var tbody = panel && panel.querySelector('#outbound-body');

    if (!opts.silent && tbody) tbody.innerHTML = ui.tableLoadingRow(COLSPAN, 5);

    try {
      var data = await WMS.api.request('OUTBOUND_LIST');
      state.items = data && Array.isArray(data.items) ? data.items : [];
      outboundSummary = data && data.summary ? data.summary : null;
      state.loaded = true;
      setStats();
      renderRows();
    } catch (error) {
      if (WMS.api.isAuthError(error)) return;
      if (opts.silent && state.loaded) {
        ui.toast((error && error.message) || 'Gagal memuat daftar outbound.', 'danger');
        return;
      }
      renderError(error);
    }
  }

  function findItem(id) {
    return state.items.find(function (item) {
      return String(item.ID_Outbound) === String(id);
    }) || null;
  }

  function findGroupById(id) {
    return state.groups.find(function (group) {
      return group.items.some(function (item) { return String(item.ID_Outbound) === String(id); });
    }) || null;
  }

  function openEditDates(group) {
    if (!group) return;
    var target = Object.keys(group.targets)[0] || '';
    var actual = Object.keys(group.actuals)[0] || '';
    var body = '<form id="outbound-dates-form" class="form-grid" novalidate>' +
      '<div class="field"><label for="edit-target-date">Tanggal Kirim / Target</label><input class="input" id="edit-target-date" type="date" value="'+ui.esc(target)+'"></div>' +
      '<div class="field"><label for="edit-actual-date">Tanggal Aktual Terima</label><input class="input" id="edit-actual-date" type="date" value="'+ui.esc(actual)+'"></div>' +
      '<div class="form-alert" id="edit-dates-error" hidden role="alert"></div></form>';
    ui.openModal({eyebrow:'Outbound � Tanggal',title:'Edit Tanggal Pengiriman',subtitle:group.noDo,body:body,
      footer:'<button type="button" class="btn btn--ghost" data-modal-close>Batal</button><button type="submit" class="btn btn--primary" form="outbound-dates-form" data-submit>Simpan Tanggal</button>',
      onMount:function(modal,close){
        modal.querySelector('#outbound-dates-form').addEventListener('submit',async function(event){
          event.preventDefault(); var err=modal.querySelector('#edit-dates-error'); var submit=modal.querySelector('[data-submit]');
          var targetValue=modal.querySelector('#edit-target-date').value; var actualValue=modal.querySelector('#edit-actual-date').value;
          if(!targetValue&&!actualValue){err.textContent='Isi setidaknya satu tanggal.';err.hidden=false;return;}
          var params={noDo:group.noDo}; if(targetValue)params.tglTargetKirim=targetValue; if(actualValue)params.tglAktualTiba=actualValue;
          ui.setBusy(submit,true,'Menyimpan�');
          try{await WMS.api.request('OUTBOUND_UPDATE_DATES',params);close('saved');ui.toast('Tanggal seluruh item '+group.noDo+' berhasil diperbarui.','success');await load({silent:false});}
          catch(error){if(WMS.api.isAuthError(error)){close('auth');return;}ui.setBusy(submit,false);err.textContent=error.message||'Tanggal gagal diperbarui.';err.hidden=false;}
        });
      }
    });
  }

  function ensureStockMap() {
    if (stockMap) return Promise.resolve(stockMap);

    return WMS.api.request('INVENTORY_LIST')
      .then(function (data) {
        stockMap = {};
        var items = data && Array.isArray(data.items) ? data.items : [];
        items.forEach(function (item) {
          var code = String(item.Kode_SKU || '').trim().toUpperCase();
          if (!code) return;
          stockMap[code] = {
            stok: ui.num(item.Stok_Aktif),
            nama: String(item.Nama_Barang || ''),
            rak: String(item.Lokasi_Rak || '')
          };
        });
        return stockMap;
      })
      .catch(function (error) {
        if (WMS.api.isAuthError(error)) throw error;
        stockMap = stockMap || {};
        return stockMap;
      });
  }

  function openPicking() {
    var body =
      '<form id="picking-form" novalidate>' +
        '<div class="form-grid">' +
          '<div class="field">' +
            '<label for="picking-do">No Delivery Order <span class="req">*</span></label>' +
            '<input class="input" id="picking-do" name="noDo" type="text" placeholder="DO-2026-001" maxlength="60" required autocomplete="off">' +
          '</div>' +
          '<div class="field">' +
            '<label for="picking-tujuan">Tujuan Customer <span class="req">*</span></label>' +
            '<input class="input" id="picking-tujuan" name="tujuanCustomer" type="text" placeholder="Nama toko / customer" maxlength="120" required autocomplete="off">' +
          '</div>' +
          '<div class="field">' +
            '<label for="picking-sku">Kode SKU <span class="req">*</span></label>' +
            '<input class="input" id="picking-sku" name="kodeSku" type="text" list="picking-sku-list" placeholder="Pilih atau ketik SKU" required autocomplete="off">' +
            ui.skuDatalist('picking-sku-list') +
            '<p class="field-hint" data-stock-hint>Stok aktual akan divalidasi oleh server.</p>' +
          '</div>' +
          '<div class="field">' +
            '<label for="picking-qty">Qty <span class="req">*</span></label>' +
            '<input class="input" id="picking-qty" name="qty" type="number" min="1" step="1" value="1" required>' +
          '</div>' +
          '<div class="field field--full">' +
            '<label for="picking-target">Target Tanggal Kirim <span class="req">*</span></label>' +
            '<input class="input" id="picking-target" name="tglTargetKirim" type="date" value="' + ui.esc(ui.addDaysIso(2)) + '" required>' +
            '<p class="field-hint">Tanggal ini menjadi pembanding KPI OTD saat konfirmasi tiba.</p>' +
          '</div>' +
        '</div>' +
        '<div class="form-alert" id="picking-error" hidden role="alert"></div>' +
      '</form>' +
      '<div class="confirm-panel" style="margin-top:14px">' +
        ui.ICONS.info +
        '<span>Picking order akan tercatat dengan status <strong>PICKED</strong>. Stok belum dipotong sampai proses dispatch.</span>' +
      '</div>';

    ui.openModal({
      eyebrow: 'Outbound · Picking',
      title: 'Buat Picking Order',
      subtitle: 'Alokasikan permintaan barang keluar baru.',
      size: 'lg',
      body: body,
      footer:
        '<button type="button" class="btn btn--ghost" data-modal-close>Batal</button>' +
        '<button type="submit" class="btn btn--primary" form="picking-form" data-submit>Simpan Picking</button>',
      onMount: function (modal, close) {
        var form = modal.querySelector('#picking-form');
        var skuInput = modal.querySelector('#picking-sku');
        var qtyInput = modal.querySelector('#picking-qty');
        var hint = modal.querySelector('[data-stock-hint]');
        var errorBox = modal.querySelector('#picking-error');
        var submit = modal.querySelector('[data-submit]');

        function updateHint() {
          var code = String(skuInput.value || '').trim().toUpperCase();
          if (!code) {
            hint.textContent = 'Stok aktual akan divalidasi oleh server.';
            hint.classList.remove('field-error');
            return;
          }
          var info = stockMap ? stockMap[code] : null;
          if (!info) {
            hint.textContent = 'SKU belum terdaftar pada stok gudang ini — stok akan divalidasi server.';
            hint.classList.add('field-error');
            return;
          }
          hint.classList.remove('field-error');
          hint.textContent = 'Tersedia ' + ui.formatNumber(info.stok) + ' unit' +
            (info.rak ? ' di ' + info.rak : '') + (info.nama ? ' · ' + info.nama : '') + '.';
        }

        skuInput.addEventListener('input', updateHint);
        ensureStockMap().then(updateHint).catch(function () { /* diamkan */ });

        form.addEventListener('submit', async function (event) {
          event.preventDefault();
          ui.showInlineError(errorBox, '');

          var noDo = String(modal.querySelector('#picking-do').value || '').trim();
          var tujuan = String(modal.querySelector('#picking-tujuan').value || '').trim();
          var kodeSku = String(skuInput.value || '').trim().toUpperCase();
          var qty = ui.num(qtyInput.value);
          var target = String(modal.querySelector('#picking-target').value || '').trim();

          if (!noDo) {
            ui.showInlineError(errorBox, 'No Delivery Order wajib diisi.');
            return;
          }
          if (!tujuan) {
            ui.showInlineError(errorBox, 'Tujuan customer wajib diisi.');
            return;
          }
          if (!kodeSku) {
            ui.showInlineError(errorBox, 'Kode SKU wajib diisi.');
            return;
          }
          if (!(qty > 0)) {
            ui.showInlineError(errorBox, 'Qty harus lebih besar dari 0.');
            return;
          }
          if (!target) {
            ui.showInlineError(errorBox, 'Target tanggal kirim wajib diisi.');
            return;
          }

          ui.setBusy(submit, true, 'Menyimpan…');

          try {
            var result = await WMS.api.request('OUTBOUND_PICKING', {
              noDo: noDo,
              tujuanCustomer: tujuan,
              kodeSku: kodeSku,
              qty: qty,
              tglTargetKirim: target
            });
            close('saved');
            ui.toast('Order ' + (result.idOutbound || '') + ' untuk ' + tujuan + ' berstatus PICKED.', 'success', 'Picking order dibuat');
            await load({ silent: true });
          } catch (error) {
            if (WMS.api.isAuthError(error)) {
              close('auth');
              return;
            }
            ui.setBusy(submit, false);
            ui.showInlineError(errorBox, (error && error.message) || 'Picking order gagal dibuat.');
          }
        });
      }
    });
  }

  function fileDrop(id) {
    return '<div class="file-drop" data-dropzone>' +
      '<input type="file" id="' + id + '" accept="application/pdf,.pdf" data-file-input>' +
      '<span class="file-drop__icon">' + ui.ICONS.file + '</span>' +
      '<span class="file-drop__title">Pilih atau tarik berkas PDF ke sini</span>' +
      '<span class="file-drop__hint">Wajib PDF · maksimal 5 MB</span>' +
      '</div>' +
      '<div class="file-chip" data-file-chip hidden></div>';
  }

  function bindFilePicker(modal, inputId, onValid) {
    var input = modal.querySelector('#' + inputId);
    var chip = modal.querySelector('[data-file-chip]');
    var drop = modal.querySelector('[data-dropzone]');
    var file = null;

    function clear() {
      file = null;
      input.value = '';
      chip.hidden = true;
      chip.innerHTML = '';
      if (onValid) onValid(null);
    }

    function show(value) {
      if (!value) {
        clear();
        return;
      }
      file = value;
      chip.hidden = false;
      chip.innerHTML =
        '<span class="file-chip__icon">' + ui.ICONS.file + '</span>' +
        '<span class="file-chip__name">' + ui.esc(value.name) + '</span>' +
        '<span class="file-chip__meta">' + ui.esc(WMS.file.formatSize(value.size)) + '</span>' +
        '<button type="button" class="file-chip__remove" data-file-remove aria-label="Hapus berkas">' + ui.ICONS.close + '</button>';
      chip.querySelector('[data-file-remove]').addEventListener('click', clear);
      if (onValid) onValid(value);
    }

    input.addEventListener('change', function () {
      var value = input.files && input.files[0];
      if (!value) return;
      try {
        WMS.file.validate(value);
        show(value);
      } catch (error) {
        clear();
        ui.toast(error.message, 'danger', 'Berkas ditolak');
      }
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
        if (!dropped) return;
        try {
          WMS.file.validate(dropped);
          show(dropped);
        } catch (error) {
          clear();
          ui.toast(error.message, 'danger', 'Berkas ditolak');
        }
      });
    }

    return {
      getFile: function () { return file; },
      clear: clear
    };
  }

  function outboundDetail(item) {
    return '<div class="detail-grid">' +
      '<div class="detail"><span class="detail__label">ID Outbound</span><span class="detail__value">' + ui.esc(item.ID_Outbound) + '</span></div>' +
      '<div class="detail"><span class="detail__label">No DO</span><span class="detail__value">' + ui.esc(item.No_DO || '—') + '</span></div>' +
      '<div class="detail"><span class="detail__label">Tujuan</span><span class="detail__value">' + ui.esc(item.Tujuan_Customer || '—') + '</span></div>' +
      '<div class="detail"><span class="detail__label">Qty</span><span class="detail__value">' + ui.formatQty(item.Qty) + ' unit</span></div>' +
      '<div class="detail detail--full"><span class="detail__label">Barang</span><span class="detail__value">' + ui.esc(item.Kode_SKU || '—') + ' · ' + ui.esc(item.Nama_Barang || '') + '</span></div>' +
      '<div class="detail"><span class="detail__label">Target Kirim</span><span class="detail__value">' + ui.esc(ui.formatDate(item.Tgl_Target_Kirim)) + '</span></div>' +
      '<div class="detail"><span class="detail__label">Status Kirim</span><span class="detail__value">' + ui.badge(item.Status_Kirim) + '</span></div>' +
    '</div>';
  }

  function openDispatch(item) {
    if (!item) return;

    var body =
      outboundDetail(item) +
      '<form id="dispatch-form" novalidate>' +
        '<div class="field">' +
          '<label for="dispatch-target">Tanggal Kirim / Target Kirim</label>' +
          '<input class="input" id="dispatch-target" type="date" value="' + ui.esc(String(item.Tgl_Target_Kirim || '').slice(0, 10)) + '">' +
        '</div>' +
        '<div class="field">' +
          '<label>Surat Jalan / Bukti Kirim <span class="req">*</span></label>' +
          fileDrop('dispatch-file') +
          '<p class="field-hint">Berkas disimpan ke Google Drive gudang aktif. Validasi MIME PDF dilakukan sebelum upload.</p>' +
        '</div>' +
        '<div class="form-alert" id="dispatch-error" hidden role="alert"></div>' +
      '</form>' +
      '<div class="confirm-panel confirm-panel--warning" style="margin-top:14px">' +
        ui.ICONS.alert +
        '<span>Dispatch akan <strong>memotong Stok_Aktif</strong> sebesar <strong>' + ui.formatQty(item.Qty) + ' unit</strong> dan mencatat mutasi OUTBOUND pada Kartu_Stok.</span>' +
      '</div>';

    ui.openModal({
      eyebrow: 'Outbound · Dispatch',
      title: 'Dispatch Pengiriman',
      subtitle: item.ID_Outbound + ' · ' + (item.No_DO || 'Tanpa DO'),
      size: 'lg',
      body: body,
      footer:
        '<button type="button" class="btn btn--ghost" data-modal-close>Batal</button>' +
        '<button type="submit" class="btn btn--primary" form="dispatch-form" data-submit>Dispatch Sekarang</button>',
      onMount: function (modal, close) {
        var form = modal.querySelector('#dispatch-form');
        var errorBox = modal.querySelector('#dispatch-error');
        var submit = modal.querySelector('[data-submit]');
        var picker = bindFilePicker(modal, 'dispatch-file');

        form.addEventListener('submit', async function (event) {
          event.preventDefault();
          ui.showInlineError(errorBox, '');

          var file = picker.getFile();
          if (!file) {
            ui.showInlineError(errorBox, 'Surat jalan PDF wajib diunggah sebelum dispatch.');
            return;
          }

          try {
            WMS.file.validate(file);
          } catch (error) {
            ui.showInlineError(errorBox, error.message);
            return;
          }

          ui.setBusy(submit, true, 'Mengunggah PDF…');

          try {
            var prepared = await WMS.file.prepare(file);
            var targetDate = String(modal.querySelector('#dispatch-target').value || '').trim();
            var result = await WMS.api.request('OUTBOUND_DISPATCH', {
              noDo: item.No_DO,
              idOutbound: item.ID_Outbound,
              tglTargetKirim: targetDate,
              fileBase64: prepared.base64,
              fileName: prepared.fileName
            }, { timeout: (WMS.config && WMS.config.UPLOAD_TIMEOUT) || 120000 });

            stockMap = null;
            close('saved');
            ui.toast(
              'Berhasil dispatch ' + (result.itemCount || 1) + ' item untuk No DO ' + (result.noDo || item.No_DO) + '.',
              'success',
              'Dispatch ' + item.ID_Outbound + ' berhasil'
            );
            await load({ silent: true });
          } catch (error) {
            if (WMS.api.isAuthError(error)) {
              close('auth');
              return;
            }
            ui.setBusy(submit, false);
            ui.showInlineError(errorBox, (error && error.message) || 'Dispatch gagal diproses.');
          }
        });
      }
    });
  }

  function openDelivered(item) {
    if (!item) return;

    var body =
      outboundDetail(item) +
      '<form id="delivered-form" novalidate>' +
        '<div class="field">' +
          '<label for="delivered-date">Tanggal Aktual Tiba <span class="req">*</span></label>' +
          '<input class="input" id="delivered-date" name="tglAktualTiba" type="date" value="' + ui.esc(ui.todayIso()) + '" required>' +
          '<p class="field-hint">Sistem membandingkan tanggal ini dengan target kirim untuk menetapkan ON_TIME / DELAY.</p>' +
        '</div>' +
        '<div class="confirm-panel" style="margin-top:12px" data-otd-preview></div>' +
        '<div class="form-alert" id="delivered-error" hidden role="alert"></div>' +
      '</form>';

    ui.openModal({
      eyebrow: 'Outbound · OTD',
      title: 'Konfirmasi Barang Tiba',
      subtitle: item.ID_Outbound + ' · ' + (item.Tujuan_Customer || ''),
      size: 'lg',
      body: body,
      footer:
        '<button type="button" class="btn btn--ghost" data-modal-close>Batal</button>' +
        '<button type="submit" class="btn btn--primary" form="delivered-form" data-submit>Simpan Konfirmasi</button>',
      onMount: function (modal, close) {
        var form = modal.querySelector('#delivered-form');
        var dateInput = modal.querySelector('#delivered-date');
        var preview = modal.querySelector('[data-otd-preview]');
        var errorBox = modal.querySelector('#delivered-error');
        var submit = modal.querySelector('[data-submit]');
        var target = String(item.Tgl_Target_Kirim || '').slice(0, 10);

        function updatePreview() {
          var actual = String(dateInput.value || '').slice(0, 10);
          if (!actual || !target) {
            preview.innerHTML = ui.ICONS.info + '<span>Target kirim: <strong>' + ui.esc(ui.formatDate(target)) + '</strong>.</span>';
            return;
          }
          var onTime = actual <= target;
          preview.className = 'confirm-panel ' + (onTime ? 'confirm-panel--success' : 'confirm-panel--danger');
          preview.innerHTML = ui.ICONS.info +
            '<span>Target <strong>' + ui.esc(ui.formatDate(target)) + '</strong> · aktual <strong>' + ui.esc(ui.formatDate(actual)) + '</strong> → ' +
            (onTime ? 'pengiriman <strong>ON_TIME</strong>.' : 'pengiriman <strong>DELAY</strong>.') + '</span>';
        }

        dateInput.addEventListener('change', updatePreview);
        updatePreview();

        form.addEventListener('submit', async function (event) {
          event.preventDefault();
          ui.showInlineError(errorBox, '');

          var actual = String(dateInput.value || '').trim();
          if (!actual) {
            ui.showInlineError(errorBox, 'Tanggal aktual tiba wajib diisi.');
            return;
          }

          ui.setBusy(submit, true, 'Menyimpan…');

          try {
            var result = await WMS.api.request('OUTBOUND_DELIVERED', {
              noDo: item.No_DO,
              idOutbound: item.ID_Outbound,
              tglAktualTiba: actual
            });
            close('saved');
            ui.toast(
              'Status OTD: ' + (result.statusOtd || '—') + ' untuk ' + item.ID_Outbound + '.',
              result.statusOtd === 'ON_TIME' ? 'success' : 'warning',
              'Delivery terkonfirmasi'
            );
            await load({ silent: true });
          } catch (error) {
            if (WMS.api.isAuthError(error)) {
              close('auth');
              return;
            }
            ui.setBusy(submit, false);
            ui.showInlineError(errorBox, (error && error.message) || 'Konfirmasi gagal disimpan.');
          }
        });
      }
    });
  }

  function mount(root) {
    panel = root;
    root.innerHTML = template();

    filterCtl = ui.filterTable({
      table: '#outbound-table',
      search: '#outbound-search',
      count: '#outbound-count',
      countLabel: 'order',
      filters: [
        { selector: '#outbound-filter', attr: 'data-status' },
        { selector: '#outbound-otd-filter', attr: 'data-otd' }
      ]
    });

    root.querySelector('[data-action="refresh"]').addEventListener('click', function () {
      load({ silent: false });
    });

    root.querySelector('[data-action="picking"]').addEventListener('click', openPicking);

    root.querySelector('[data-action="sync-staging"]').addEventListener('click', async function (event) {
      var button = event.currentTarget;
      if (button.disabled) return;
      ui.setBusy(button, true, 'Menarik order…');
      try {
        var result = await WMS.api.request('OUTBOUND_SYNC_STAGING');
        var count = Number(result && result.syncedCount) || 0;
        ui.toast(
          'Berhasil menarik ' + count + ' order baru dari Staging' +
            (result && result.skippedCount ? ' (' + result.skippedCount + ' baris dilewati).' : '.'),
          'success',
          'Sinkronisasi selesai'
        );
        await load({ silent: false });
      } catch (error) {
        if (!WMS.api.isAuthError(error)) {
          ui.toast((error && error.message) || 'Gagal menarik order dari Staging.', 'danger');
        }
      } finally {
        ui.setBusy(button, false);
      }
    });

    var tbody = root.querySelector('#outbound-body');
    tbody.addEventListener('click', function (event) {
      var toggle = event.target.closest ? event.target.closest('[data-toggle-group]') : null;
      if (toggle) {
        var groupKey = toggle.getAttribute('data-toggle-group');
        state.expanded[groupKey] = !state.expanded[groupKey];
        renderRows();
        return;
      }
      var editDatesBtn = event.target.closest ? event.target.closest('[data-edit-dates]') : null;
      if (editDatesBtn) { openEditDates(findGroupById(editDatesBtn.getAttribute('data-edit-dates'))); return; }
      var dispatchBtn = event.target.closest ? event.target.closest('[data-dispatch]') : null;
      if (dispatchBtn) {
        openDispatch(findItem(dispatchBtn.getAttribute('data-dispatch')));
        return;
      }
      var deliveredBtn = event.target.closest ? event.target.closest('[data-delivered]') : null;
      if (deliveredBtn) {
        openDelivered(findItem(deliveredBtn.getAttribute('data-delivered')));
      }
    });

    return load({ silent: false });
  }

  WMS.registerModule({
    id: 'outbound',
    label: 'Outbound',
    eyebrow: 'Modul 2 · Barang Keluar',
    title: 'Outbound',
    description: 'Picking, dispatch & OTD',
    mount: mount,
    refresh: function () { return load({ silent: true }); }
  });
})(window);
