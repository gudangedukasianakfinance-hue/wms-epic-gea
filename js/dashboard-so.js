(function (global) {
  'use strict';
  var raw = null;
  try { raw = JSON.parse(global.sessionStorage.getItem('wms.session.v1') || 'null'); } catch (e) {}
  var role = String(raw && raw.user && raw.user.role || '').toUpperCase();
  var allowed = ['SUPERVISOR', 'SPV', 'HOD'].indexOf(role) >= 0;
  function operationalPage() {
    var code = String(raw && raw.warehouse || raw && raw.user && raw.user.aksesGudang || '').toUpperCase();
    return code === 'GEA' ? 'pt-gea.html' : 'cv-epic.html';
  }
  if (!raw || !raw.token || !raw.user || !allowed) { global.location.replace(operationalPage()); return; }
  var WMS = global.WMS = global.WMS || {};
  WMS.auth = { getSession: function () { return raw; }, getRole: function () { return role; }, handleUnauthorized: function () { global.location.replace(operationalPage()); } };
  var items = [];
  var selected = null;
  var postLogs = [];
  var postSku = '';
  var $ = function (id) { return document.getElementById(id); };
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]; }); }
  function number(value) { return Number(value) || 0; }
  function fmt(value) { return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(number(value)); }
  function details(item) { try { var data = JSON.parse(item.Detail_JSON || '[]'); return Array.isArray(data) ? data : []; } catch (e) { return []; } }
  function postEntity(log) {
    var code = String(log && log.Entitas || '').toUpperCase();
    return code === 'EPIC' || code === 'GEA' ? code : '';
  }
  function postEntityLabel(code) { return code === 'EPIC' ? 'CV EPIC' : 'PT GEA'; }
  function uniqueText(values) {
    var seen = {}, out = [];
    (values || []).forEach(function (value) {
      var text = String(value == null ? '' : value).trim();
      if (!text || seen[text]) return;
      seen[text] = true;
      out.push(text);
    });
    return out;
  }
  function postGroupKey(log) {
    return String(log.No_DO || '').trim() || String(log.ID_Outbound || '').trim() || '—';
  }
  function collectPostLogs(data) {
    var logs = data && Array.isArray(data.postCountTransactions) ? data.postCountTransactions.slice() : [];
    if (!logs.length) {
      var seen = {};
      items.forEach(function (item) {
        details(item).forEach(function (line) {
          (line.postCountTransactions || []).forEach(function (log) {
            var entity = postEntity(log) || String(item.Entitas || '').toUpperCase();
            var key = entity + '|' + String(log.ID_Outbound || '') + '|' + String(log.Kode_SKU || '');
            if (seen[key]) return;
            seen[key] = true;
            var copy = Object.assign({}, log, { Entitas: entity });
            logs.push(copy);
          });
        });
      });
    }
    return logs.map(function (log) {
      return postEntity(log) ? log : Object.assign({}, log, { Entitas: '' });
    });
  }
  function buildPostGroups(logs) {
    var groups = [], index = {};
    logs.forEach(function (log) {
      var key = postGroupKey(log);
      if (!index[key]) {
        index[key] = { key: key, logs: [] };
        groups.push(index[key]);
      }
      index[key].logs.push(log);
    });
    groups.forEach(function (group) {
      group.qty = group.logs.reduce(function (sum, log) { return sum + number(log.Qty); }, 0);
      group.date = group.logs.reduce(function (best, log) {
        var text = String(log.Tanggal_Transaksi || '');
        return text > best ? text : best;
      }, '');
      group.ids = uniqueText(group.logs.map(function (log) { return log.ID_Outbound; }));
      group.outlets = uniqueText(group.logs.map(function (log) { return log.Nama_Outlet; }));
      group.statuses = uniqueText(group.logs.map(function (log) { return log.Status_Kirim; }));
      group.skus = uniqueText(group.logs.map(function (log) { return log.Kode_SKU; }));
    });
    groups.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    return groups;
  }
  function renderPostLogs() {
    var select = $('post-filter-sku'), container = $('post-count-groups');
    if (!select || !container) return;

    var activeEntity = String(($('filter-entity') || {}).value || '').toUpperCase();
    var entities = activeEntity === 'EPIC' || activeEntity === 'GEA' ? [activeEntity] : ['EPIC', 'GEA'];
    var entityLogs = postLogs.filter(function (log) { return entities.indexOf(postEntity(log)) >= 0; });

    var skuMap = {};
    entityLogs.forEach(function (log) { var sku = String(log.Kode_SKU || ''); if (sku) skuMap[sku] = true; });
    select.innerHTML = '<option value="">Semua SKU</option>' + Object.keys(skuMap).sort().map(function (sku) {
      return '<option value="' + esc(sku) + '">' + esc(sku) + '</option>';
    }).join('');
    if (postSku && !skuMap[postSku]) postSku = '';
    select.value = postSku;

    var shown = postSku ? entityLogs.filter(function (log) { return String(log.Kode_SKU || '') === postSku; }) : entityLogs;
    var totalQty = shown.reduce(function (sum, log) { return sum + number(log.Qty); }, 0);
    var badge = $('post-count-badge');
    if (badge) badge.textContent = shown.length + ' transaksi' + (postSku ? ' · ' + postSku : '');
    var summary = $('post-count-summary');
    if (summary) summary.textContent = shown.length ? 'Total qty keluar: ' + fmt(totalQty) + ' unit' : '';

    if (!shown.length) {
      container.innerHTML = '<div class="empty">Belum ada transaksi outbound setelah waktu hitung fisik SO.</div>';
      return;
    }

    container.innerHTML = entities.map(function (entity) {
      var logs = shown.filter(function (log) { return postEntity(log) === entity; });
      if (!logs.length) return '';

      var groups = buildPostGroups(logs);
      var totalEntityQty = groups.reduce(function (sum, group) { return sum + group.qty; }, 0);
      var rows = groups.map(function (group, groupIndex) {
        var token = entity + '-' + groupIndex;
        var detailRows = group.logs.map(function (log) {
          return '<tr><td>' + esc(log.Kode_SKU || '—') + '</td>' +
            '<td>' + esc(log.Nama_Barang || '—') + '</td>' +
            '<td>' + esc(log.ID_Outbound || '—') + '</td>' +
            '<td class="num">−' + fmt(log.Qty) + '</td>' +
            '<td>' + esc(log.Keterangan_Potongan || 'Dipotong dari hitungan SO berjalan') + '</td></tr>';
        }).join('');
        var idInfo = fmt(group.ids.length) + ' ID Outbound' +
          (group.ids.length > 1 ? ': ' + esc(group.ids.join(', ')) : '');

        return '<tr class="post-group-row">' +
          '<td>' + esc(group.date || '—') + '</td>' +
          '<td><strong>' + esc(group.key) + '</strong><div class="muted">' + idInfo + '</div></td>' +
          '<td>' + esc(group.outlets.join(', ') || '—') + '</td>' +
          '<td>' + esc(group.statuses.join(', ') || '—') + '</td>' +
          '<td>' + fmt(group.skus.length) + ' SKU</td>' +
          '<td class="num"><strong>−' + fmt(group.qty) + ' unit</strong></td>' +
          '<td><button type="button" class="btn btn--ghost btn--sm post-toggle" data-post-detail="' + esc(token) + '">Lihat Rincian</button></td></tr>' +
          '<tr class="post-detail" data-post-detail-row="' + esc(token) + '" hidden><td colspan="7"><div class="post-detail__wrap">' +
          '<p class="post-detail__title">Rincian SKU · ' + esc(group.key) + '</p><div style="overflow:auto"><table class="so-table">' +
          '<thead><tr><th>Kode SKU</th><th>Nama Barang</th><th>ID Outbound</th><th class="num">Qty Keluar</th><th>Keterangan Potongan</th></tr></thead>' +
          '<tbody>' + detailRows + '</tbody></table></div></div></td></tr>';
      }).join('');

      return '<div class="post-entity" data-post-entity="' + esc(entity) + '">' +
        '<div class="post-entity__head"><h3>Log Outbound Pasca-Hitung — ' + esc(postEntityLabel(entity)) + '</h3>' +
        '<span class="post-badge">' + fmt(groups.length) + ' PR/DO</span>' +
        '<span class="post-badge">−' + fmt(totalEntityQty) + ' unit</span></div>' +
        '<div style="overflow:auto"><table class="so-table"><thead><tr><th>TANGGAL / WAKTU</th><th>NO. PR / DO</th><th>TUJUAN OUTLET</th><th>STATUS</th><th>RINGKASAN ITEM</th><th class="num">TOTAL QTY KELUAR</th><th>RINCIAN</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div></div>';
    }).filter(Boolean).join('');
  }
  function setAllPostDetails(open) {
    var container = $('post-count-groups');
    if (!container) return;
    container.querySelectorAll('[data-post-detail-row]').forEach(function (row) { row.hidden = !open; });
    container.querySelectorAll('[data-post-detail]').forEach(function (button) {
      button.textContent = open ? 'Tutup Rincian' : 'Lihat Rincian';
    });
  }
  function canCancelSession(item) {
    var status = String(item && item.Status_Sesi || '').toUpperCase();
    return ['DRAFT', 'PENDING_APPROVAL', 'SUBMITTED', 'OPEN', 'PENDING'].indexOf(status) >= 0;
  }
  function filtered() {
    return items.filter(function (item) {
      var ent = $('filter-entity').value, type = $('filter-type').value, period = $('filter-period').value, status = $('filter-status').value;
      return (!ent || item.Entitas === ent) && (!type || item.Jenis_SO === type) && (!period || item.Periode_SO === period) && (!status || item.Status_Sesi === status);
    });
  }
  function render() {
    var rows = filtered();
    var counted = rows.reduce(function (sum, r) { return sum + number(r.Total_SKU_Dihitung); }, 0);
    var matches = rows.reduce(function (sum, r) { return sum + number(r.Total_SKU_Sesuai); }, 0);
    $('kpi-accuracy').textContent = counted ? (matches * 100 / counted).toFixed(1) + '%' : '—';
    $('kpi-sessions').textContent = fmt(rows.length);
    $('kpi-diff').textContent = fmt(rows.reduce(function (sum, r) { return sum + number(r.Total_SKU_Selisih); }, 0));
    $('kpi-pending').textContent = fmt(rows.filter(function (r) { return r.Status_Sesi === 'PENDING_APPROVAL'; }).length);
    ['EPIC','GEA'].forEach(function (entity) {
      var group = rows.filter(function (r) { return r.Entitas === entity; });
      var total = group.reduce(function (sum, r) { return sum + number(r.Total_SKU_Dihitung); }, 0);
      var good = group.reduce(function (sum, r) { return sum + number(r.Total_SKU_Sesuai); }, 0);
      var accuracy = total ? good * 100 / total : 0;
      $('compare-' + entity.toLowerCase()).innerHTML = '<strong>' + accuracy.toFixed(1) + '%</strong><span>Akurasi · ' + fmt(group.reduce(function (sum, r) { return sum + number(r.Total_SKU_Selisih); }, 0)) + ' SKU selisih</span><i style="width:' + Math.min(100, accuracy) + '%"></i>';
    });
    $('sessions-body').innerHTML = rows.length ? rows.map(function (r, i) {
      var index = items.indexOf(r);
      return '<tr data-index="' + index + '"><td>' + esc(r.Entitas === 'EPIC' ? 'CV EPIC' : 'PT GEA') + '</td><td>' + esc(r.Jenis_SO || '—') + '</td><td>' + esc(r.Periode_SO || '—') + '</td><td>' + esc(r.Tanggal_SO || '—') + '</td><td class="num">' + fmt(r.Total_SKU_Dihitung) + '</td><td class="num">' + fmt(r.Total_SKU_Selisih) + '</td><td>' + Number(r.Akurasi_Persen || 0).toFixed(1) + '%</td><td><span class="so-status so-status--' + esc(String(r.Status_Sesi || '').toLowerCase()) + '">' + esc(r.Status_Sesi || '—') + '</span></td>' +
        '<td class="actions-cell">' + (canCancelSession(r)
          ? '<button type="button" class="btn btn--danger-ghost btn--sm" data-cancel-session="' + index + '">Batalkan Perintah</button>'
          : '—') + '</td></tr>';
    }).join('') : '<tr><td colspan="9" class="empty">Tidak ada sesi sesuai filter.</td></tr>';
  }
  async function load() {
    $('reload').disabled = true; $('load-state').textContent = 'Memuat data terbaru…';
    try {
      var data = await WMS.api.request('SO_DASHBOARD_SUMMARY');
      items = data && Array.isArray(data.items) ? data.items : [];
      postLogs = collectPostLogs(data);
      var periods = Array.from(new Set(items.map(function (x) { return x.Periode_SO; }).filter(Boolean))).sort().reverse();
      var select = $('filter-period'), previous = select.value;
      select.innerHTML = '<option value="">Semua Periode</option>' + periods.map(function (p) { return '<option value="' + esc(p) + '">' + esc(p) + '</option>'; }).join('');
      if (periods.indexOf(previous) >= 0) select.value = previous;
      render(); renderPostLogs(); $('load-state').textContent = items.length + ' sesi';
    } catch (e) { $('load-state').textContent = e.message || 'Gagal memuat rekap.'; }
    finally { $('reload').disabled = false; }
  }
  function openDetail(item) {
    selected = item;
    var lines = details(item);
    $('dialog-title').textContent = (item.Entitas === 'EPIC' ? 'CV EPIC' : 'PT GEA') + ' · ' + item.ID_Sesi_SO;
    $('dialog-meta').textContent = (item.Jenis_SO || 'SO') + ' · ' + (item.Periode_SO || '') + ' · ' + (item.Status_Sesi || '');
    $('detail-body').innerHTML = lines.length ? lines.map(function (x) {
      var picked = number(x.qtyPickedBerjalan);
      var awal = x.stokSistemAwal !== undefined && x.stokSistemAwal !== null ? x.stokSistemAwal : x.stokSistem;
      return '<tr><td>' + esc(x.kodeSku) + '</td><td>' + esc(x.namaBarang || x.kodeSku || '—') + '</td>' +
        '<td class="num">' + fmt(awal) + '</td>' +
        '<td class="num">' + (picked > 0
          ? '<button type="button" class="btn btn--ghost btn--sm" style="cursor:pointer" title="' + esc((x.postCountTransactions || []).map(function (log) { return [log.Tanggal_Transaksi, log.ID_Outbound, log.Kode_SKU, log.Qty].join(' · '); }).join('\n')) + '" data-post-sku="' + esc(x.kodeSku) + '">−' + fmt(picked) + '</button>'
          : '—') + '</td>' +
        '<td class="num">' + fmt(x.stokSistem) + '</td><td class="num">' + fmt(x.stokFisik) + '</td>' +
        '<td class="num">' + fmt(x.selisih) + '</td></tr>';
    }).join('') : '<tr><td colspan="7" class="empty">Tidak ada item pada sesi SO ini.</td></tr>';
    var canDecide = ['SUPERVISOR','SPV','HOD'].indexOf(role) >= 0 && item.Status_Sesi === 'PENDING_APPROVAL';
    $('decision-actions').hidden = !canDecide;
    $('detail-dialog').hidden = false;
  }
  async function decide(decision) {
    if (!selected || !global.confirm((decision === 'APPROVED' ? 'Approve' : 'Reject') + ' sesi SO ' + selected.ID_Sesi_SO + '?')) return;
    var buttons = $('decision-actions').querySelectorAll('button'); buttons.forEach(function (b) { b.disabled = true; });
    try {
      await WMS.api.request('SO_DASHBOARD_DECISION', { entitas: selected.Entitas, idSesiSo: selected.ID_Sesi_SO, decision: decision });
      $('detail-dialog').hidden = true; await load();
    } catch (e) { global.alert(e.message || 'Keputusan gagal disimpan.'); }
    finally { buttons.forEach(function (b) { b.disabled = false; }); }
  }
  async function cancelSession(index) {
    var item = items[Number(index)];
    if (!item || !canCancelSession(item)) return;
    var message = 'Batalkan perintah SO ' + item.ID_Sesi_SO + ' (' + item.Entitas + ')?\n\n' +
      'Status sesi menjadi CANCELLED. Stok gudang tidak diubah dan perintah baru untuk SKU/periode yang sama dapat dibuat ulang.';
    if (!global.confirm(message)) return;
    var alasan = typeof global.prompt === 'function'
      ? (global.prompt('Alasan pembatalan (opsional):', '') || '') : '';
    try {
      await WMS.api.request('CANCEL_OPNAME', {
        idSesiSo: item.ID_Sesi_SO,
        alasan: String(alasan).trim()
      });
      await load();
      $('load-state').textContent = 'Perintah SO ' + item.ID_Sesi_SO + ' dibatalkan.';
    } catch (e) {
      global.alert(e.message || 'Pembatalan perintah SO gagal.');
    }
  }
  $('reload').addEventListener('click', load);
  $('back').href = operationalPage();
  ['filter-entity','filter-type','filter-period','filter-status'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      render();
      if (id === 'filter-entity') renderPostLogs();
    });
  });
  $('sessions-body').addEventListener('click', function (e) {
    var cancelBtn = e.target.closest ? e.target.closest('[data-cancel-session]') : null;
    if (cancelBtn) {
      e.stopPropagation();
      cancelSession(cancelBtn.getAttribute('data-cancel-session'));
      return;
    }
    var row = e.target.closest('[data-index]');
    if (row) openDetail(items[Number(row.getAttribute('data-index'))]);
  });
  $('dialog-close').addEventListener('click', function () { $('detail-dialog').hidden = true; });
  $('post-filter-sku').addEventListener('change', function () { postSku = this.value || ''; renderPostLogs(); });
  $('post-count-groups').addEventListener('click', function (e) {
    var button = e.target.closest ? e.target.closest('[data-post-detail]') : null;
    if (!button) return;
    var token = button.getAttribute('data-post-detail');
    var row = this.querySelector('[data-post-detail-row="' + token + '"]');
    if (!row) return;
    row.hidden = !row.hidden;
    button.textContent = row.hidden ? 'Lihat Rincian' : 'Tutup Rincian';
  });
  $('post-expand-all').addEventListener('click', function () { setAllPostDetails(true); });
  $('post-collapse-all').addEventListener('click', function () { setAllPostDetails(false); });
  $('detail-body').addEventListener('click', function (e) {
    var button = e.target.closest ? e.target.closest('[data-post-sku]') : null;
    if (!button) return;
    postSku = button.getAttribute('data-post-sku') || '';
    renderPostLogs();
    $('detail-dialog').hidden = true;
    var panel = $('post-count-panel');
    if (panel && panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('approve').addEventListener('click', function () { decide('APPROVED'); });
  $('reject').addEventListener('click', function () { decide('REJECTED'); });
  load();
})(window);
