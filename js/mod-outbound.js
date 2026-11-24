/**
 * mod-outbound.js — Modul 2 Outbound (Picking, Dispatch, KPI OTD)
 */

(function (global) {
  'use strict';

  var WMS = global.WMS;
  if (!WMS || !WMS.registerModule) return;

  var ui = WMS.ui;
  var COLSPAN = 8;
  var state = { items: [], groups: [], expanded: {}, loaded: false, visibleLimit: 100 };
  var panel = null;
  var loadGen = 0;
  var activeStatusTab = 'PICKED';
  var activeOtdFilter = '';
  var searchQuery = '';
  var stockMap = null;
  var outboundSummary = null;
  var leadTimeMap = null;
  var leadTimeItems = [];

  var DEFAULT_HEADER_ACTIONS = '<button type="button" class="btn btn--secondary btn--sm" data-action="lead-time">Atur Lead Time Outlet</button>';

  function template(presetHeaderActions) {
    return '' +
      '<div class="module-head">' +
        '<div>' +
          '<p class="eyebrow">Modul 2 · Barang Keluar</p>' +
          '<h2>Outbound — Picking &amp; Dispatch</h2>' +
          '<p class="module-head__desc">Buat picking order, unggah surat jalan saat dispatch, lalu konfirmasi kedatangan untuk menghitung KPI On-Time Delivery.</p>' +
        '</div>' +
        '<div class="module-head__actions">' +
          (presetHeaderActions || DEFAULT_HEADER_ACTIONS) +
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
          '<div class="status-tabs" role="tablist" aria-label="Filter status outbound">' +
            '<button type="button" class="status-tabs__tab is-active" role="tab" aria-selected="true" data-status="PICKED">Perlu Dispatch (Picked) <span class="tab-badge tab-badge--task" data-tab-count="picked">0</span></button>' +
            '<button type="button" class="status-tabs__tab" role="tab" aria-selected="false" data-status="DISPATCHED">Dalam Pengiriman (Dispatched) <span class="tab-badge tab-badge--task" data-tab-count="dispatched">0</span></button>' +
            '<button type="button" class="status-tabs__tab" role="tab" aria-selected="false" data-status="DELIVERED">Delivered <span class="tab-badge" data-tab-count="delivered">0</span></button>' +
            '<button type="button" class="status-tabs__tab" role="tab" aria-selected="false" data-status="">Semua Order <span class="tab-badge" data-tab-count="all">0</span></button>' +
          '</div>' +
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
              '<th colspan="2">No DO / Tujuan</th>' +
              '<th>Barang</th>' +
              '<th class="num">Qty</th>' +
              '<th>Jadwal &amp; Lead Time</th>' +
              '<th>OTD</th>' +
              '<th>Status Kirim</th>' +
              '<th class="actions-cell">Aksi</th>' +
            '</tr></thead>' +
            '<tbody id="outbound-body">' + ui.tableLoadingRow(COLSPAN, 5) + '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>';
  }

  function setStats(groups) {
    if (!panel) return;
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
        index[key] = { key:key, noDo:noDo || item.ID_Outbound || '', items:[], statuses:{}, otd:{}, qty:0, customers:{}, targets:{}, dispatches:{}, actuals:{}, links:{} };
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
      var targetDate = item.Target_Tiba || item.Tgl_Target_Kirim;
      if (targetDate) group.targets[String(targetDate).slice(0,10)] = true;
      if (item.Tanggal_Dispatch) group.dispatches[String(item.Tanggal_Dispatch).slice(0,10)] = true;
      if (item.Tgl_Aktual_Tiba) group.actuals[String(item.Tgl_Aktual_Tiba).slice(0,10)] = true;
      if (item.Link_PDF) group.links[String(item.Link_PDF)] = true;
    });
    return groups;
  }

  /* ------------------------------------------------------------------------
   * Master Lead Time Outlet (OUTLET_LEADTIME_LIST / OUTLET_LEADTIME_SAVE)
   * ---------------------------------------------------------------------- */

  function outletKey(name) {
    return String(name == null ? '' : name).trim().toUpperCase();
  }

  function applyLeadTimeItems(items) {
    leadTimeItems = Array.isArray(items) ? items : [];
    leadTimeMap = {};

    leadTimeItems.forEach(function (item) {
      var key = outletKey(item && item.Nama_Outlet);
      var days = ui.num(item && item.Lead_Time_Hari);
      if (key && !Object.prototype.hasOwnProperty.call(leadTimeMap, key)) leadTimeMap[key] = days;
      var id = outletKey(item && item.ID_Outlet);
      if (id && !Object.prototype.hasOwnProperty.call(leadTimeMap, id)) leadTimeMap[id] = days;
    });
  }

  function loadLeadTimeMap(force) {
    if (leadTimeMap && !force) return Promise.resolve(leadTimeMap);

    return WMS.api.request('OUTLET_LEADTIME_LIST')
      .then(function (data) {
        applyLeadTimeItems(data && data.items);
        return leadTimeMap;
      })
      .catch(function (error) {
        if (WMS.api.isAuthError(error)) throw error;
        leadTimeMap = leadTimeMap || {};
        return leadTimeMap;
      });
  }

  function leadTimeInfo(name) {
    var key = outletKey(name);
    var known = !!key && !!leadTimeMap &&
      Object.prototype.hasOwnProperty.call(leadTimeMap, key);

    return {
      days: known ? ui.num(leadTimeMap[key]) : 0,
      known: known
    };
  }

  function leadTimeTag(name) {
    var info = leadTimeInfo(name);

    return '<span class="leadtime-tag' + (info.known ? '' : ' leadtime-tag--default') + '">' +
      'Lead time: <strong>' + ui.esc(info.days) + ' hari</strong>' +
      (info.known ? '' : ' <span class="muted">(default)</span>') +
      '</span>';
  }

  function scheduleCell(group) {
    var target = Object.keys(group.targets)[0] || '';
    var dispatch = Object.keys(group.dispatches)[0] || '';
    var actual = Object.keys(group.actuals)[0] || '';
    var customer = Object.keys(group.customers)[0] || '';

    return '<div class="outbound-schedule">' +
      '<span>Tgl Kirim: <strong>' + ui.esc(ui.formatDate(dispatch)) + '</strong></span>' +
      '<span class="outbound-schedule__target">Target Tiba: <strong>' + ui.esc(ui.formatDate(target)) + '</strong></span>' +
      '<span class="outbound-schedule__meta">' + leadTimeTag(customer) +
        '<span class="muted"> · Tiba: ' + ui.esc(ui.formatDate(actual)) + '</span></span>' +
      '</div>';
  }

  function parseLeadTimeValue(value) {
    var text = String(value == null ? '' : value).trim();

    if (!/^\d+$/.test(text)) return null;

    var days = parseInt(text, 10);

    if (!isFinite(days) || days < 0 || days > 365) return null;

    return days;
  }

  function openLeadTime() {
    var body =
      '<div class="leadtime-panel">' +
        '<form id="outlet-create-form" class="leadtime-form" novalidate>' +
          '<div class="field">' +
            '<label for="outlet-new-name">Nama Outlet <span class="req">*</span></label>' +
            '<input class="input" id="outlet-new-name" type="text" maxlength="150" placeholder="Contoh: Toko Nusa Jaya" autocomplete="off" required>' +
          '</div>' +
          '<div class="field">' +
            '<label for="outlet-new-area">Wilayah / Kota</label>' +
            '<input class="input" id="outlet-new-area" type="text" maxlength="100" placeholder="Contoh: Makassar" autocomplete="off">' +
          '</div>' +
          '<div class="field">' +
            '<label for="outlet-new-lead">Lead Time (Hari)</label>' +
            '<input class="input" id="outlet-new-lead" type="number" min="0" max="365" step="1" value="0">' +
          '</div>' +
          '<div class="field leadtime-form__action">' +
            '<button type="submit" class="btn btn--primary" data-submit>Tambah Outlet</button>' +
          '</div>' +
        '</form>' +
        '<div class="form-alert" id="outlet-create-error" hidden role="alert"></div>' +
        '<div class="leadtime-toolbar">' +
          ui.searchField('outlet-leadtime-search', 'Cari nama outlet atau wilayah…') +
          '<span class="toolbar__spacer"></span>' +
          '<span class="pill pill--muted" id="outlet-leadtime-count">0 outlet</span>' +
          '<button type="button" class="btn btn--secondary btn--sm" data-action="recalc-otd">' +
            ui.ICONS.refresh + ' Hitung Ulang OTD Semua Order' +
          '</button>' +
        '</div>' +
        '<div class="form-alert" id="outlet-leadtime-error" hidden role="alert"></div>' +
        '<div class="leadtime-table-wrap">' +
          '<table class="data-table data-table--compact" id="outlet-leadtime-table">' +
            '<thead><tr>' +
              '<th>Nama Outlet</th>' +
              '<th>Wilayah / Kota</th>' +
              '<th class="num">Lead Time (Hari)</th>' +
              '<th class="actions-cell">Simpan</th>' +
            '</tr></thead>' +
            '<tbody id="outlet-leadtime-body">' + ui.tableLoadingRow(4, 4) + '</tbody>' +
          '</table>' +
        '</div>' +
        '<div class="confirm-panel">' + ui.ICONS.info +
          '<span>Lead time dihitung dalam hari kalender: <strong>Target Tiba = tanggal dispatch + lead time</strong>. ' +
          'Perubahan master hanya memengaruhi dispatch berikutnya — gunakan <strong>Hitung Ulang OTD Semua Order</strong> untuk menyelaraskan order yang sudah ada.</span>' +
        '</div>' +
      '</div>';

    ui.openModal({
      eyebrow: 'Outbound · Lead Time',
      title: 'Master Lead Time Pengiriman Outlet',
      subtitle: 'Atur lead time per outlet, tambah outlet baru, dan selaraskan target OTD.',
      size: 'xl',
      body: body,
      footer:
        '<button type="button" class="btn btn--ghost" data-action="reload-outlets">Muat Ulang Data</button>' +
        '<button type="button" class="btn btn--primary" data-modal-close>Tutup</button>',
      onMount: function (modal, close) {
        var createForm = modal.querySelector('#outlet-create-form');
        var createError = modal.querySelector('#outlet-create-error');
        var listError = modal.querySelector('#outlet-leadtime-error');
        var listBody = modal.querySelector('#outlet-leadtime-body');
        var searchInput = modal.querySelector('#outlet-leadtime-search');
        var countEl = modal.querySelector('#outlet-leadtime-count');
        var recalcButton = modal.querySelector('[data-action="recalc-otd"]');
        var reloadButton = modal.querySelector('[data-action="reload-outlets"]');
        var createSubmit = modal.querySelector('#outlet-create-form [data-submit]');

        function findOutlet(id) {
          var key = String(id == null ? '' : id).trim().toUpperCase();

          return leadTimeItems.find(function (item) {
            return String(item && item.ID_Outlet).trim().toUpperCase() === key;
          }) || null;
        }

        function applyOutletFilter() {
          if (!listBody) return;

          var query = String(searchInput && searchInput.value || '').trim().toLowerCase();
          var visible = 0;

          listBody.querySelectorAll('tr[data-outlet-row]').forEach(function (row) {
            var show = !query || String(row.getAttribute('data-search') || '').indexOf(query) !== -1;
            row.hidden = !show;
            if (show) visible++;
          });

          var emptyRow = listBody.querySelector('[data-empty-row]');
          if (emptyRow) emptyRow.hidden = visible > 0;
          if (countEl) countEl.textContent = visible + ' outlet';
        }

        function renderOutletRows() {
          if (!listBody) return;

          if (!leadTimeItems.length) {
            listBody.innerHTML = ui.tableEmptyRow(4, 'Belum ada outlet', 'Tambahkan outlet baru atau muat ulang untuk menarik nama dari Outbound_Log.');
            applyOutletFilter();
            return;
          }

          listBody.innerHTML = leadTimeItems.map(function (item) {
            var name = String(item && item.Nama_Outlet || '').trim();
            var id = String(item && item.ID_Outlet || '').trim();
            var area = String(item && item.Wilayah_Kota || '');
            var days = ui.num(item && item.Lead_Time_Hari);
            var search = [name, area, id].join(' ').toLowerCase();

            return '<tr data-outlet-row data-search="' + ui.esc(search) + '">' +
              '<td><strong>' + ui.esc(name) + '</strong>' +
                (id ? '<span class="muted leadtime-id">' + ui.esc(id) + '</span>' : '') + '</td>' +
              '<td><input class="input input--inline" type="text" maxlength="100" data-outlet-area value="' + ui.esc(area) + '" aria-label="Wilayah / kota ' + ui.esc(name) + '"></td>' +
              '<td class="num"><input class="input input--inline input--number" type="number" min="0" max="365" step="1" data-outlet-lead value="' + ui.esc(days) + '" aria-label="Lead time hari ' + ui.esc(name) + '"></td>' +
              '<td class="actions-cell"><button type="button" class="btn btn--secondary btn--sm" data-save-outlet="' + ui.esc(id) + '">Simpan</button></td>' +
              '</tr>';
          }).join('') +
            '<tr class="table-state" data-empty-row hidden><td colspan="4">' +
              ui.emptyState('Tidak ada outlet', 'Ubah kata kunci pencarian.') +
            '</td></tr>';
          applyOutletFilter();
        }

        async function loadOutletList() {
          if (!listBody) return;

          listBody.innerHTML = ui.tableLoadingRow(4, 4);
          if (searchInput) searchInput.value = '';
          ui.showInlineError(listError, '');

          try {
            var data = await WMS.api.request('OUTLET_LEADTIME_LIST');
            applyLeadTimeItems(data && data.items);
            renderOutletRows();
            renderRows();
          } catch (error) {
            if (WMS.api.isAuthError(error)) {
              close('auth');
              return;
            }
            listBody.innerHTML = ui.tableErrorRow(4, (error && error.message) || 'Daftar outlet gagal dimuat.');
            ui.bindRetry(listBody, loadOutletList);
          }
        }

        async function saveOutletRow(button) {
          var row = button.closest ? button.closest('tr[data-outlet-row]') : null;
          var item = findOutlet(button.getAttribute('data-save-outlet'));

          if (!row || !item) {
            ui.showInlineError(listError, 'Baris outlet tidak ditemukan. Muat ulang daftar lalu coba lagi.');
            return;
          }

          var areaInput = row.querySelector('[data-outlet-area]');
          var leadInput = row.querySelector('[data-outlet-lead]');
          var lead = parseLeadTimeValue(leadInput && leadInput.value);

          ui.showInlineError(listError, '');

          if (lead === null) {
            ui.showInlineError(listError, 'Lead time harus bilangan bulat antara 0 dan 365 hari.');
            if (leadInput) leadInput.focus();
            return;
          }

          ui.setBusy(button, true, 'Menyimpan…');

          try {
            var result = await WMS.api.request('OUTLET_LEADTIME_SAVE', {
              idOutlet: item.ID_Outlet,
              namaOutlet: item.Nama_Outlet,
              wilayahKota: areaInput ? String(areaInput.value || '').trim() : '',
              leadTimeHari: lead
            });
            var saved = result && result.outlet ? result.outlet : {
              ID_Outlet: item.ID_Outlet,
              Nama_Outlet: item.Nama_Outlet,
              Wilayah_Kota: areaInput ? String(areaInput.value || '').trim() : '',
              Lead_Time_Hari: lead,
              Status_Aktif: item.Status_Aktif
            };

            applyLeadTimeItems(leadTimeItems.map(function (candidate) {
              return String(candidate && candidate.ID_Outlet) === String(item.ID_Outlet) ? saved : candidate;
            }));
            row.setAttribute('data-search', [
              saved.Nama_Outlet || item.Nama_Outlet,
              saved.Wilayah_Kota || '',
              saved.ID_Outlet || item.ID_Outlet
            ].join(' ').toLowerCase());
            applyOutletFilter();
            renderRows();
            ui.toast('Lead time "' + (item.Nama_Outlet || '') + '" disimpan (' + lead + ' hari).', 'success', 'Master lead time');
          } catch (error) {
            if (WMS.api.isAuthError(error)) {
              close('auth');
              return;
            }
            ui.showInlineError(listError, (error && error.message) || 'Lead time gagal disimpan.');
          } finally {
            ui.setBusy(button, false);
          }
        }

        if (listBody) {
          listBody.addEventListener('click', function (event) {
            var button = event.target.closest ? event.target.closest('[data-save-outlet]') : null;
            if (button) saveOutletRow(button);
          });
        }

        if (searchInput) searchInput.addEventListener('input', ui.debounce(applyOutletFilter, 300));

        if (createForm) {
          createForm.addEventListener('submit', async function (event) {
            event.preventDefault();
            ui.showInlineError(createError, '');

            var nameInput = modal.querySelector('#outlet-new-name');
            var areaInput = modal.querySelector('#outlet-new-area');
            var leadInput = modal.querySelector('#outlet-new-lead');
            var name = nameInput ? String(nameInput.value || '').trim() : '';
            var lead = parseLeadTimeValue(leadInput && leadInput.value);

            if (!name) {
              ui.showInlineError(createError, 'Nama outlet wajib diisi.');
              if (nameInput) nameInput.focus();
              return;
            }

            if (lead === null) {
              ui.showInlineError(createError, 'Lead time harus bilangan bulat antara 0 dan 365 hari.');
              if (leadInput) leadInput.focus();
              return;
            }

            ui.setBusy(createSubmit, true, 'Menyimpan…');

            try {
              var result = await WMS.api.request('OUTLET_LEADTIME_SAVE', {
                namaOutlet: name,
                wilayahKota: areaInput ? String(areaInput.value || '').trim() : '',
                leadTimeHari: lead
              });
              createForm.reset();
              if (leadInput) leadInput.value = '0';
              ui.toast(
                result && result.created === false
                  ? 'Outlet "' + name + '" sudah terdaftar; data master diperbarui.'
                  : 'Outlet "' + name + '" berhasil ditambahkan.',
                'success',
                'Master lead time'
              );
              await loadOutletList();
            } catch (error) {
              if (WMS.api.isAuthError(error)) {
                close('auth');
                return;
              }
              ui.showInlineError(createError, (error && error.message) || 'Outlet baru gagal disimpan.');
            } finally {
              ui.setBusy(createSubmit, false);
            }
          });
        }

        if (reloadButton) reloadButton.addEventListener('click', loadOutletList);

        if (recalcButton) {
          if (WMS.auth && typeof WMS.auth.isSupervisor === 'function' && !WMS.auth.isSupervisor()) {
            recalcButton.disabled = true;
            recalcButton.title = 'Hitung ulang OTD hanya dapat dijalankan oleh Supervisor.';
            recalcButton.insertAdjacentHTML('afterend', '<span class="muted" style="font-size:11px">Khusus Supervisor</span>');
          }

          recalcButton.addEventListener('click', async function () {
            if (recalcButton.disabled) return;

            ui.showInlineError(listError, '');
            ui.setBusy(recalcButton, true, 'Menghitung ulang…');

            try {
              var result = await WMS.api.request('OUTBOUND_RECALC_OTD', { scope: 'ALL' });
              var processed = Number(result && result.processedCount) || 0;
              var updated = Number(result && result.updatedCount) || 0;
              var onTime = Number(result && result.onTimeCount) || 0;
              var delay = Number(result && result.delayCount) || 0;

              ui.toast(
                processed + ' baris diperiksa, ' + updated + ' baris diperbarui (ON_TIME ' + onTime + ' · DELAY ' + delay + ').',
                'success',
                'OTD dihitung ulang'
              );
              leadTimeMap = null;
              await loadOutletList();
              await load({ silent: true });
            } catch (error) {
              if (WMS.api.isAuthError(error)) {
                close('auth');
                return;
              }
              ui.showInlineError(listError, (error && error.message) || 'Perhitungan ulang OTD gagal.');
            } finally {
              ui.setBusy(recalcButton, false);
            }
          });
        }

        loadOutletList();
      }
    });
  }

  function updateStatusTabs(groups) {
    if (!panel) return;
    var counts = { picked: 0, dispatched: 0, delivered: 0, all: groups.length };
    groups.forEach(function (group) {
      if (group.statuses.PICKED) counts.picked++;
      if (group.statuses.DISPATCHED) counts.dispatched++;
      if (group.statuses.DELIVERED) counts.delivered++;
    });
    Object.keys(counts).forEach(function (key) {
      var badge = panel.querySelector('[data-tab-count="' + key + '"]');
      if (badge) { badge.textContent = counts[key]; badge.classList.toggle('tab-badge--zero', counts[key] === 0); }
    });
  }

  function getFilteredData(groups) {
    var status = String(activeStatusTab || '').trim().toUpperCase();
    var otd = String(activeOtdFilter || '').trim().toUpperCase();
    var query = String(searchQuery || '').trim().toLowerCase();
    return groups.filter(function (group) {
      var statuses = Object.keys(group.statuses).map(function (value) { return String(value).trim().toUpperCase(); });
      var otds = Object.keys(group.otd).map(function (value) { return String(value).trim().toUpperCase(); });
      var rowStatus = statuses.indexOf('PICKED') !== -1 ? 'PICKED' : statuses.indexOf('DISPATCHED') !== -1 ? 'DISPATCHED' : statuses.indexOf('DELIVERED') !== -1 ? 'DELIVERED' : (statuses[0] || '');
      var rowOtd = otds.indexOf('ON_TIME') !== -1 ? 'ON_TIME' : otds.indexOf('DELAY') !== -1 ? 'DELAY' : (otds[0] || 'NONE');
      var text = group.items.map(function (item) { return [item.ID_Outbound, item.No_DO, item.Tujuan_Customer, item.Kode_SKU, item.Nama_Barang, item.Status_Kirim, item.Status_OTD].join(' '); }).join(' ').toLowerCase();
      return (!status || rowStatus === status) && (!otd || rowOtd === otd) && (!query || text.indexOf(query) !== -1);
    });
  }

  function renderRows() {
    var tbody = panel && panel.querySelector('#outbound-body');
    if (!tbody) return;

    // Satu kali pengelompokan per siklus render, dipakai ulang untuk statistik,
    // tab status, filter, dan pembangunan baris.
    var groups = groupOutboundItems_(state.items);
    state.groups = groups;
    updateStatusTabs(groups);
    setStats(groups);

    if (!state.items.length) {
      tbody.innerHTML = ui.tableEmptyRow(COLSPAN, 'Belum ada order outbound', 'Buat picking order pertama atau tunggu data dari tim penjualan.');
      var emptyCount = panel.querySelector('#outbound-count');
      if (emptyCount) emptyCount.textContent = '0 order';
      return;
    }

    var filteredGroups = getFilteredData(groups);
    var visibleGroups = filteredGroups.slice(0, state.visibleLimit);
    tbody.innerHTML = visibleGroups.map(function (group) {
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
        return '<tr><td>'+ui.esc(item.ID_Outbound||'�')+'</td><td>'+ui.esc(item.Kode_SKU||'�')+'</td><td>'+ui.esc(item.Nama_Barang||'�')+'</td><td class="num">'+ui.formatQty(item.Qty)+'</td><td>'+ui.esc(ui.formatDate(item.Tanggal_Dispatch))+'</td><td>'+ui.esc(ui.formatDate(item.Target_Tiba || item.Tgl_Target_Kirim))+'</td></tr>';
      }).join('');
      return '<tr data-row data-status="'+ui.esc(status)+'" data-otd="'+ui.esc(otd||'NONE')+'" data-search="'+ui.esc(search)+'">'+
        '<td class="outbound-group-toggle" colspan="2"><button type="button" class="outbound-expand" data-toggle-group="'+ui.esc(group.key)+'" aria-expanded="'+expanded+'"><span class="outbound-expand__arrow">'+(expanded?'&#9662;':'&#9656;')+'</span><strong>'+ui.esc(group.noDo)+'</strong><span class="muted">'+ui.esc(customer)+'</span></button></td>'+
        '<td><button type="button" class="outbound-summary-toggle" data-toggle-group="'+ui.esc(group.key)+'" aria-expanded="'+expanded+'">'+group.items.length+' Item SKU &bull; Total '+ui.formatNumber(group.qty)+' pcs</button></td>'+
        '<td class="num">'+ui.formatNumber(group.qty)+'</td><td>'+scheduleCell(group)+'</td><td>'+(otd?ui.badge(otd):'<span class="muted">�</span>')+'</td><td>'+ui.badge(status)+'</td><td class="actions-cell"><div class="table-actions">'+ui.pdfLink(Object.keys(group.links)[0])+action+'</div></td></tr>'+
        '<tr class="outbound-detail-row" data-detail-for="'+ui.esc(group.key)+'" '+(expanded?'':'hidden')+'><td colspan="'+COLSPAN+'"><div class="outbound-detail-meta">'+leadTimeTag(customer)+'<span class="muted">Tgl Kirim: '+ui.esc(ui.formatDate(Object.keys(group.dispatches)[0] || ''))+'</span><span class="muted">Target Tiba: '+ui.esc(ui.formatDate(target))+'</span><span class="muted">Tiba: '+ui.esc(ui.formatDate(actual))+'</span></div><div class="outbound-detail-wrap"><table class="data-table data-table--compact"><thead><tr><th>ID Outbound</th><th>Kode SKU</th><th>Nama Barang</th><th class="num">Qty</th><th>Tgl Kirim</th><th>Target Tiba</th></tr></thead><tbody>'+detailRows+'</tbody></table></div></td></tr>';
    }).join('') +
      ui.showMoreRow(COLSPAN, visibleGroups.length, filteredGroups.length, 'order') +
      '<tr class="table-state" data-empty-row hidden><td colspan="' + COLSPAN + '">' +
        ui.emptyState('Tidak ada hasil', 'Ubah kata kunci pencarian atau filter status.') +
      '</td></tr>';
    var emptyRow = tbody.querySelector('[data-empty-row]');
    if (emptyRow) emptyRow.hidden = filteredGroups.length > 0;
    var count = panel.querySelector('#outbound-count');
    if (count) count.textContent = filteredGroups.length + ' order';
  }

  function renderError(error) {
    var tbody = panel && panel.querySelector('#outbound-body');
    if (!tbody) return;
    tbody.innerHTML = ui.tableErrorRow(COLSPAN, error && error.message);
    ui.bindRetry(tbody, function () { load({ silent: false }); });
  }

  async function load(options) {
    var gen = ++loadGen;
    var opts = options || {};
    var tbody = panel && panel.querySelector('#outbound-body');

    if (!opts.silent && !state.loaded && tbody) tbody.innerHTML = ui.tableLoadingRow(COLSPAN, 5);

    try {
      var results = await Promise.all([
        WMS.api.request('OUTBOUND_LIST'),
        loadLeadTimeMap()
      ]);
      var data = results[0];
      if (gen !== loadGen) return;
      state.items = data && Array.isArray(data.items) ? data.items : [];
      outboundSummary = data && data.summary ? data.summary : null;
      state.loaded = true;
      // Silent refresh mempertahankan jumlah baris yang sedang dibuka user.
      if (!opts.silent) state.visibleLimit = ui.TABLE_PAGE_SIZE;
      renderRows();
    } catch (error) {
      if (gen !== loadGen) return;
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
    var dispatch = Object.keys(group.dispatches)[0] || '';
    var actual = Object.keys(group.actuals)[0] || '';
    var body = '<form id="outbound-dates-form" class="form-grid" novalidate>' +
      '<div class="field"><label for="edit-dispatch-date">Tanggal Kirim</label><input class="input" id="edit-dispatch-date" type="date" value="'+ui.esc(dispatch)+'"></div>' +
      '<div class="field"><label for="edit-actual-date">Tanggal Aktual Terima</label><input class="input" id="edit-actual-date" type="date" value="'+ui.esc(actual)+'"></div>' +
      '<div class="form-alert" id="edit-dates-error" hidden role="alert"></div></form>';
    ui.openModal({eyebrow:'Outbound � Tanggal',title:'Edit Tanggal Pengiriman',subtitle:group.noDo,body:body,
      footer:'<button type="button" class="btn btn--ghost" data-modal-close>Batal</button><button type="submit" class="btn btn--primary" form="outbound-dates-form" data-submit>Simpan Tanggal</button>',
      onMount:function(modal,close){
        var datesForm = modal.querySelector('#outbound-dates-form');
        if (!datesForm) return;
        datesForm.addEventListener('submit',async function(event){
          event.preventDefault(); var err=modal.querySelector('#edit-dates-error'); var submit=modal.querySelector('[data-submit]');
          var dispatchInput=modal.querySelector('#edit-dispatch-date'), actualInput=modal.querySelector('#edit-actual-date');
          if(!err||!dispatchInput||!actualInput){ui.toast('Form tanggal tidak lengkap. Muat ulang modul lalu coba lagi.','danger');return;}
          var dispatchValue=dispatchInput.value; var actualValue=actualInput.value;
          if(!dispatchValue&&!actualValue){err.textContent='Isi setidaknya satu tanggal.';err.hidden=false;return;}
          var params={noDo:group.noDo}; if(dispatchValue)params.tglDispatch=dispatchValue; if(actualValue)params.tglAktualTiba=actualValue;
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

          var noDoInput=modal.querySelector('#picking-do'), tujuanInput=modal.querySelector('#picking-tujuan'), targetInput=modal.querySelector('#picking-target');
          if(!noDoInput||!tujuanInput||!targetInput){ui.showInlineError(errorBox,'Form picking tidak lengkap. Buka kembali form lalu coba lagi.');return;}
          var noDo = String(noDoInput.value || '').trim();
          var tujuan = String(tujuanInput.value || '').trim();
          var kodeSku = String(skuInput.value || '').trim().toUpperCase();
          var qty = ui.num(qtyInput.value);
          var target = String(targetInput.value || '').trim();

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
      '<span class="file-drop__hint">PDF opsional · maksimal 5 MB</span>' +
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
      var removeButton = chip.querySelector('[data-file-remove]');
      if (removeButton) removeButton.addEventListener('click', clear);
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
      '<div class="detail"><span class="detail__label">Lead Time Outlet</span><span class="detail__value">' + leadTimeTag(item.Tujuan_Customer) + '</span></div>' +
      '<div class="detail"><span class="detail__label">Tgl Kirim</span><span class="detail__value">' + ui.esc(ui.formatDate(item.Tanggal_Dispatch)) + '</span></div>' +
      '<div class="detail"><span class="detail__label">Target Tiba</span><span class="detail__value">' + ui.esc(ui.formatDate(item.Target_Tiba || item.Tgl_Target_Kirim)) + '</span></div>' +
      '<div class="detail"><span class="detail__label">Status Kirim</span><span class="detail__value">' + ui.badge(item.Status_Kirim) + '</span></div>' +
    '</div>';
  }

  function openDispatch(item) {
    if (!item) return;

    var initialDispatch = String(item.Tanggal_Dispatch || '').slice(0, 10) || ui.todayIso();
    var initialLeadTime = leadTimeInfo(item.Tujuan_Customer || item.Kode_Outlet).days;
    function addDaysIso(date, days) {
      if (!date) return '';
      var parts = date.split('-');
      var value = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
      value.setUTCDate(value.getUTCDate() + Math.max(0, Number(days) || 0));
      return value.toISOString().slice(0, 10);
    }

    var body =
      outboundDetail(item) +
      '<form id="dispatch-form" novalidate>' +
        '<div class="field">' +
          '<label for="dispatch-date">Tanggal Kirim</label>' +
          '<input class="input" id="dispatch-date" type="date" value="' + ui.esc(initialDispatch) + '">' +
          '<p class="field-hint">Target Tiba dihitung otomatis dari lead time outlet.</p>' +
        '</div>' +
        '<div class="confirm-panel" style="margin-bottom:12px" data-dispatch-target-preview></div>' +
        '<div class="field">' +
          '<label>Lampiran Bukti Kirim / Resi PDF (Opsional)</label>' +
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
        var dispatchInput = modal.querySelector('#dispatch-date');
        var targetPreview = modal.querySelector('[data-dispatch-target-preview]');
        function updateTargetPreview() {
          var dispatchDate = String(dispatchInput.value || '').trim();
          var targetDate = addDaysIso(dispatchDate, initialLeadTime);
          targetPreview.innerHTML = ui.ICONS.info + '<span>Target Tiba: <strong>' + ui.esc(ui.formatDate(targetDate)) +
            '</strong> (' + ui.esc(initialLeadTime) + ' hari lead time).</span>';
        }
        dispatchInput.addEventListener('input', updateTargetPreview);
        updateTargetPreview();

        form.addEventListener('submit', async function (event) {
          event.preventDefault();
          ui.showInlineError(errorBox, '');

          var file = picker.getFile();
          ui.setBusy(submit, true, file ? 'Mengunggah PDF?' : 'Memproses dispatch?');

          try {
            var prepared = file ? await WMS.file.prepare(file) : null;
            var dispatchDate = String(dispatchInput.value || '').trim();
            var result = await WMS.api.request('OUTBOUND_DISPATCH', {
              noDo: item.No_DO,
              idOutbound: item.ID_Outbound,
              tglDispatch: dispatchDate,
              fileBase64: prepared ? prepared.base64 : '',
              fileName: prepared ? prepared.fileName : ''
            }, { timeout: (WMS.config && WMS.config.UPLOAD_TIMEOUT) || 120000 });

            stockMap = null;
            if (WMS.touch) WMS.touch('inventory');
            if (WMS.master && WMS.master.invalidate) WMS.master.invalidate();
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
          } finally { ui.setBusy(submit, false); }
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
        var target = String(item.Target_Tiba || item.Tgl_Target_Kirim || '').slice(0, 10);

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
            if (WMS.touch) WMS.touch('inventory');
            if (WMS.master && WMS.master.invalidate) WMS.master.invalidate();
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
          } finally { ui.setBusy(submit, false); }
        });
      }
    });
  }

  function mount(root) {
    panel = root;
    var presetHeader = root.querySelector('template[data-outbound-header-actions]');
    var presetActions = presetHeader ? String(presetHeader.innerHTML || '').trim() : '';
    root.innerHTML = template(presetActions);

    root.addEventListener('click', function (event) {
      var tab = event.target.closest ? event.target.closest('.status-tabs [data-status]') : null;
      if (!tab || !root.contains(tab)) return;
      activeStatusTab = String(tab.getAttribute('data-status') || '').trim().toUpperCase();
      state.visibleLimit = ui.TABLE_PAGE_SIZE;
      root.querySelectorAll('.status-tabs [data-status]').forEach(function (candidate) {
        var selected = candidate === tab;
        candidate.classList.toggle('is-active', selected);
        candidate.setAttribute('aria-selected', selected ? 'true' : 'false');
      });
      renderRows();
    });
    var searchInput = root.querySelector('#outbound-search');
    if (searchInput) searchInput.addEventListener('input', ui.debounce(function () {
      searchQuery = searchInput.value || '';
      state.visibleLimit = ui.TABLE_PAGE_SIZE;
      renderRows();
    }, 300));
    var otdFilter = root.querySelector('#outbound-otd-filter');
    if (otdFilter) otdFilter.addEventListener('change', function () {
      activeOtdFilter = otdFilter.value || '';
      state.visibleLimit = ui.TABLE_PAGE_SIZE;
      renderRows();
    });
    var refreshButton = root.querySelector('[data-action="refresh"]');
    if (refreshButton) refreshButton.addEventListener('click', function () {
      if (WMS.master && WMS.master.invalidate) WMS.master.invalidate();
      load({ silent: false });
    });

    var pickingButton = root.querySelector('[data-action="picking"]');
    if (pickingButton) pickingButton.addEventListener('click', openPicking);

    var leadTimeButton = root.querySelector('[data-action="lead-time"]');
    if (leadTimeButton) leadTimeButton.addEventListener('click', openLeadTime);

    var syncButton = root.querySelector('[data-action="sync-staging"]');
    if (syncButton) syncButton.addEventListener('click', async function (event) {
      var button = event.currentTarget;
      if (button.disabled) return;
      ui.setBusy(button, true, 'Menarik order…');
      try {
        var result = await WMS.api.request('OUTBOUND_SYNC_STAGING');
        var inserted = Number(result && result.insertedCount) || 0;
        var updated = Number(result && result.updatedCount) || 0;
        var deleted = Number(result && result.deletedCount) || 0;
        var skippedShipped = Number(result && result.skippedShippedCount) || 0;
        var skippedSource = Number(result && result.skippedCount) || 0;
        var details = '+' + inserted + ' baru, ' + updated + ' diperbarui, ' + deleted + ' dihapus';
        if (skippedShipped) details += ', ' + skippedShipped + ' dilewati (sudah SHIPPED)';
        if (skippedSource) details += ', ' + skippedSource + ' baris sumber tidak valid';
        ui.toast(
          (result && result.message) || ('Sync SO selesai: ' + details + '.'),
          skippedShipped ? 'info' : 'success',
          'Sinkronisasi Sales Order'
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
      var moreButton = event.target.closest ? event.target.closest('[data-show-more]') : null;
      if (moreButton) {
        state.visibleLimit += ui.TABLE_PAGE_SIZE;
        renderRows();
        return;
      }
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
