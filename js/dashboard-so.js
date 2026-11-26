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
  function collectPostLogs(data) {
    var logs = data && Array.isArray(data.postCountTransactions) ? data.postCountTransactions.slice() : [];
    if (!logs.length) {
      items.forEach(function (item) {
        details(item).forEach(function (line) {
          (line.postCountTransactions || []).forEach(function (log) { logs.push(log); });
        });
      });
    }
    return logs;
  }
  function renderPostLogs() {
    var select = $('post-filter-sku'), body = $('post-count-body');
    if (!select || !body) return;

    var skuMap = {};
    postLogs.forEach(function (log) { var sku = String(log.Kode_SKU || ''); if (sku) skuMap[sku] = true; });
    select.innerHTML = '<option value="">Semua SKU</option>' + Object.keys(skuMap).sort().map(function (sku) {
      return '<option value="' + esc(sku) + '">' + esc(sku) + '</option>';
    }).join('');
    if (postSku && !skuMap[postSku]) postSku = '';
    select.value = postSku;

    var shown = postSku ? postLogs.filter(function (log) { return String(log.Kode_SKU || '') === postSku; }) : postLogs;
    var totalQty = shown.reduce(function (sum, log) { return sum + number(log.Qty); }, 0);
    var badge = $('post-count-badge');
    if (badge) badge.textContent = shown.length + ' transaksi' + (postSku ? ' · ' + postSku : '');
    var summary = $('post-count-summary');
    if (summary) summary.textContent = shown.length ? 'Total qty keluar: ' + fmt(totalQty) + ' unit' : '';

    if (!shown.length) {
      body.innerHTML = '<tr><td colspan="7" class="empty">Belum ada transaksi outbound setelah waktu hitung fisik SO.</td></tr>';
      return;
    }

    body.innerHTML = shown.map(function (log) {
      var noDo = String(log.No_DO || '').trim();
      return '<tr><td>' + esc(log.Tanggal_Transaksi || '—') + '</td>' +
        '<td><strong>' + esc(log.ID_Outbound || '—') + '</strong>' + (noDo ? '<div class="muted">No. DO: ' + esc(noDo) + '</div>' : '') + '</td>' +
        '<td><strong>' + esc(log.Kode_SKU || '—') + '</strong><div class="muted">' + esc(log.Nama_Barang || '') + '</div></td>' +
        '<td>' + esc(log.Nama_Outlet || '—') + '</td>' +
        '<td>' + esc(log.Status_Kirim || '—') + '</td>' +
        '<td class="num"><strong>−' + fmt(log.Qty) + '</strong></td>' +
        '<td>' + esc(log.Keterangan_Potongan || 'Dipotong dari hitungan SO berjalan') + '</td></tr>';
    }).join('');
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
      return '<tr data-index="' + items.indexOf(r) + '"><td>' + esc(r.Entitas === 'EPIC' ? 'CV EPIC' : 'PT GEA') + '</td><td>' + esc(r.Jenis_SO || '—') + '</td><td>' + esc(r.Periode_SO || '—') + '</td><td>' + esc(r.Tanggal_SO || '—') + '</td><td class="num">' + fmt(r.Total_SKU_Dihitung) + '</td><td class="num">' + fmt(r.Total_SKU_Selisih) + '</td><td>' + Number(r.Akurasi_Persen || 0).toFixed(1) + '%</td><td><span class="so-status so-status--' + esc(String(r.Status_Sesi || '').toLowerCase()) + '">' + esc(r.Status_Sesi || '—') + '</span></td></tr>';
    }).join('') : '<tr><td colspan="8" class="empty">Tidak ada sesi sesuai filter.</td></tr>';
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
    var differences = lines.filter(function (x) { return number(x.selisih) !== 0 || number(x.qtyPickedBerjalan) > 0; });
    $('dialog-title').textContent = (item.Entitas === 'EPIC' ? 'CV EPIC' : 'PT GEA') + ' · ' + item.ID_Sesi_SO;
    $('dialog-meta').textContent = (item.Jenis_SO || 'SO') + ' · ' + (item.Periode_SO || '') + ' · ' + (item.Status_Sesi || '');
    $('detail-body').innerHTML = differences.length ? differences.map(function (x) {
      var picked = number(x.qtyPickedBerjalan);
      var awal = x.stokSistemAwal !== undefined && x.stokSistemAwal !== null ? x.stokSistemAwal : x.stokSistem;
      return '<tr><td>' + esc(x.kodeSku) + '</td><td>' + esc(x.namaBarang) + '</td>' +
        '<td class="num">' + fmt(awal) + '</td>' +
        '<td class="num">' + (picked > 0
          ? '<button type="button" class="btn btn--ghost btn--sm" style="cursor:pointer" title="' + esc((x.postCountTransactions || []).map(function (log) { return [log.Tanggal_Transaksi, log.ID_Outbound, log.Kode_SKU, log.Qty].join(' · '); }).join('\n')) + '" data-post-sku="' + esc(x.kodeSku) + '">−' + fmt(picked) + '</button>'
          : '—') + '</td>' +
        '<td class="num">' + fmt(x.stokSistem) + '</td><td class="num">' + fmt(x.stokFisik) + '</td>' +
        '<td class="num">' + fmt(x.selisih) + '</td></tr>';
    }).join('') : '<tr><td colspan="7" class="empty">Tidak ada SKU selisih atau potongan pasca-hitung.</td></tr>';
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
  $('reload').addEventListener('click', load);
  $('back').href = operationalPage();
  ['filter-entity','filter-type','filter-period','filter-status'].forEach(function (id) { $(id).addEventListener('change', render); });
  $('sessions-body').addEventListener('click', function (e) { var row = e.target.closest('[data-index]'); if (row) openDetail(items[Number(row.getAttribute('data-index'))]); });
  $('dialog-close').addEventListener('click', function () { $('detail-dialog').hidden = true; });
  $('post-filter-sku').addEventListener('change', function () { postSku = this.value || ''; renderPostLogs(); });
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
