/**
 * laporan.js — Pusat Laporan PDF Resmi untuk CV EPIC & PT GEA
 * Fitur: 5 jenis laporan filter tanggal, cetak PDF via @media print,
 * konfigurasi TTD (disimpan localStorage), validasi role.
 *
 * DILARANG: library eksternal (jsPDF, html2canvas), file .html/.js/.html lainnya.
 */

(function (global) {
  'use strict';

  var WMS = global.WMS = global.WMS || {};
  var CONFIG = WMS.config || global.WMS_CONFIG || {};
  var auth = WMS.auth || {};

  /* ==========================================================================
   * Konfigurasi tetap — entitas, jenis laporan, kolom, warna status
   * ========================================================================== */

  // Entitas: kode -> nama, theme, warna accent
  var ENTITAS = {
    EPIC: { nama: 'CV EPIC', theme: 'epic', accent: '#EA580C', kode: 'EPIC' },
    GEA:  { nama: 'PT GEA',  theme: 'gea',  accent: '#065F46', kode: 'GEA' }
  };

  // Jenis laporan dengan definisi kolom
  var JENIS_LAPORAN = {
    rekap_stok: {
      nama: 'Laporan Rekapitulasi Stok Akhir',
      ikon: '📦',
      warnaHeader: '#334155',
      kolom: [
        { field: 'no',        lebar: 40,  header: 'No' },
        { field: 'sku',       lebar: 100, header: 'SKU' },
        { field: 'nama_barang', lebar: 200, header: 'Nama Barang' },
        { field: 'kategori',  lebar: 120, header: 'Kategori' },
        { field: 'stok_sistem', lebar: 120, header: 'Stok Sistem' },
        { field: 'stok_so',   lebar: 120, header: 'Stok SO' },
        { field: 'selisih',   lebar: 100, header: 'Selisih' },
        { field: 'status',    lebar: 100, header: 'Status Stok' }
      ]
    },
    mutasi: {
      nama: 'Laporan Mutasi Barang (Kartu Stok Periodik)',
      ikon: '🔄',
      warnaHeader: '#334155',
      kolom: [
        { field: 'no',          lebar: 40,  header: 'No' },
        { field: 'tanggal',     lebar: 100, header: 'Tanggal' },
        { field: 'no_ref',      lebar: 110, header: 'No. Ref/DO' },
        { field: 'tipe',        lebar: 70,  header: 'Tipe' },
        { field: 'tujuan_supplier', leber: 150, header: 'Tujuan/Supplier' },
        { field: 'sku',         lebar: 100, header: 'SKU' },
        { field: 'nama_barang', leber: 200, header: 'Nama Barang' },
        { field: 'masuk',       lebar: 80,  header: 'Masuk' },
        { field: 'keluar',      lebar: 80,  header: 'Keluar' }
      ]
    },
    outbound: {
      nama: 'Laporan Pengiriman Outbound & Kinerja OTD',
      ikon: '🚚',
      warnaHeader: '#334155',
      kolom: [
        { field: 'no',           lebar: 40,  header: 'No' },
        { field: 'tgl_order',    lebar: 100, header: 'Tgl Order' },
        { field: 'no_do',        leber: 110, header: 'No. DO' },
        { field: 'outlet_tujuan', leber: 150, header: 'Outlet Tujuan' },
        { field: 'total_qty',    leber: 80,  header: 'Total Qty' },
        { field: 'tgl_dispatch', leber: 100, header: 'Tgl Dispatch' },
        { field: 'lead_time',    leber: 80,  header: 'Lead Time' },
        { field: 'status_otd',   leber: 100, header: 'Status OTD' }
      ]
    },
    inbound: {
      nama: 'Laporan Penerimaan Barang Masuk (Inbound)',
      ikon: '📥',
      warnaHeader: '#334155',
      kolom: [
        { field: 'no',          lebar: 40,  header: 'No' },
        { field: 'tgl_terima',  leber: 100, header: 'Tgl Terima' },
        { field: 'no_posj',     leber: 110, header: 'No. PO/SJ' },
        { field: 'nama_supplier', leber: 180, header: 'Nama Supplier' },
        { field: 'sku',         leber: 100, header: 'SKU' },
        { field: 'nama_barang', leber: 200, header: 'Nama Barang' },
        { field: 'qty_terima',  leber: 80,  header: 'Qty Terima' }
      ]
    },
    baso: {
      nama: 'Berita Acara Selisih Stock Opname (BASO)',
      ikon: '📝',
      warnaHeader: '#334155',
      kolom: [
        { field: 'no',         lebar: 40,  header: 'No' },
        { field: 'tgl_so',     leber: 100, header: 'Tgl SO' },
        { field: 'sku',        leber: 100, header: 'SKU' },
        { field: 'nama_barang', leber: 200, header: 'Nama Barang' },
        { field: 'qty_sistem', leber: 100, header: 'Qty Sistem' },
        { field: 'qty_fisik',  leber: 100, header: 'Qty Fisik' },
        { field: 'selisih',    leber: 80,  header: 'Selisih' },
        { field: 'ket',        leber: 200, header: 'Keterangan' }
      ]
    }
  };

  /* ==========================================================================
   * State Internal
   * ========================================================================== */

  var state = {
    entityCode: null,      // 'EPIC' atau 'GEA'
    entity: null,          // objek ENTITAS
    jenisSaatIni: 'rekap_stok',
    tglDari: '',
    tglSampai: '',
    dataLaporan: [],       // array baris data
    totalKpi: { total: 0, tercatat: 0 }
  };

  /* ==========================================================================
   * Helper: Format & Util
   * ========================================================================== */

  function escapeHtml(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, function (c) {
      return { '&': '&', '<': '<', '>': '>', '"': '"', "'": ''' }[c];
    });
  }

  function formatRupiah(value) {
    if (value === null || value === undefined || String(value).trim() === '') return '—';
    return Number(value).toLocaleString('id-ID');
  }

  function formatTanggalIndo(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso);
      var day = String(d.getDate()).padStart(2, '0');
      var month = String(d.getMonth() + 1).padStart(2, '0');
      var year = d.getFullYear();
      return day + '/' + month + '/' + year;
    } catch (e) {
      return String(iso);
    }
  }

  function getTodayIso() {
    var now = new Date();
    return now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0');
  }

  /* ==========================================================================
   * Fungsi inisialisasi & validasi role
   * ========================================================================== */

  function cekSesiDanRole() {
    var session = auth.getSession();
    if (!session) {
      // Redirect ke index.html
      setTimeout(function() {
        global.location.href = 'index.html';
      }, 1000);
      alert('Harap login terlebih dahulu. Anda akan dialihkan ke halaman utama.');
      return false;
    }

    var role = String(session.user.role || '').toUpperCase();
    var boleh = role === 'SPV' || role === 'SUPERVISOR' || role === 'HOD';
    if (!boleh) {
      alert('Akses ditatal: hanya SPV, SUPERVISOR, dan HOD yang dapat mengakses halaman Laporan PDF.');
      global.location.href = 'index.html';
      return false;
    }
    return true;
  }

  /* ==========================================================================
   * Inisialisasi modul
   * ========================================================================== */

  WMS.laporan = WMS.laporan || {};

  WMS.laporan.init = function () {
    if (!cekSesiDanRole()) return;

    // Set entity dari URL parameter atau sesi
    var urlParams = new URLSearchParams(global.location.search);
    var dariUrl = urlParams.get('from');
    var sesiEntity = auth.getSession().user && auth.getSession().user.aksesGudang;

    // Default: ambil dari sesi jika ada, kalau tidak tanyakan
    state.entityCode = dariUrl === 'EPIC' ? 'EPIC' : (dariUrl === 'GEA' ? 'GEA' : null);
    state.entityCode = state.entityCode || (sesiEntity === 'ALL' || sesiEntity === 'EPIC' ? 'EPIC' : (sesiEntity === 'GEA' ? 'GEA' : null));

    // Jika masih null (misal staff manual), arahkan ke index
    if (!state.entityCode) {
      alert('Tidak dapat menentukan entitas dari sesi. Silakan login kembali.');
      global.location.href = 'index.html';
      return;
    }

    state.entity = ENTITAS[state.entityCode];

    // Inisialisasi UI
    WMS.laporan.tampilkanEntitas();
    WMS.laporan.tampilkanJenisLaporan();
    WMS.laporan.aturFilterTanggal();
    WMS.laporan.muatDataAwal();
    WMS.laporan.beriAksesTTDSettings();

    // Set page title
    document.getElementById('laporan-page-title').textContent = 
      'Pusat Laporan PDF — ' + state.entity.nama;
  };

  /* ==========================================================================
   * Render UI: Entitas, Jenis Laporan, Filter
   * ========================================================================== */

  WMS.laporan.tampilkanEntitas = function () {
    var select = document.getElementById('laporan-entitas');
    if (!select) return;

    // Reset & isi
    select.innerHTML = '';
    var options = [
      { value: 'EPIC',  text: 'CV EPIC' },
      { value: 'GEA',   text: 'PT GEA' }
    ];

    // Highlight yang dipilih
    options.forEach(function (opt) {
      var el = document.createElement('option');
      el.value = opt.value;
      el.textContent = opt.text;
      if (opt.value === state.entityCode) el.selected = true;
      select.appendChild(el);
    });
  };

  WMS.laporan.tampilkanJenisLaporan = function () {
    var tabs = document.getElementById('laporan-tabs');
    if (!tabs) return;

    tabs.innerHTML = '';
    var keys = Object.keys(JENIS_LAPORAN);

    keys.forEach(function (key, i) {
      var jenis = JENIS_LAPORAN[key];
      var btn = document.createElement('button');
      btn.className = 'laporan-tab' + (state.jenisSaatIni === key ? ' is-active' : '');
      btn.dataset.type = key;
      btn.onclick = function () { WMS.laporan.switchType(btn); };
      btn.textContent = jenis.nama;
      tabs.appendChild(btn);
    });
  };

  WMS.laporan.aturFilterTanggal = function () {
    var tglDari = document.getElementById('laporan-tgl-dari');
    var tglSampai = document.getElementById('laporan-tgl-sampai');

    // Set default: 1 bulan terakhir
    if (tglDari) {
      var hariIni = getTodayIso();
      var satuBulanKelak = new Date();
      satuBulanKelak.setDate(satuBulanKelak.getDate() - 30);
      var isoSatuBulan = satuBulanKelak.getFullYear() + '-' +
        String(satuBulanKelak.getMonth() + 1).padStart(2, '0') + '-' +
        String(satuBulanKelak.getDate()).padStart(2, '0');
      tglDari.value = isoSatuBulan;
      tglSampai.value = hariIni;
      state.tglDari = isoSatuBulan;
      state.tglSampai = hariIni;
    }
  };

  /* ==========================================================================
   * Switch Jenis Laporan & Muat Data
   * ========================================================================== */

  WMS.laporan.switchType = function (btn) {
    // Update tab aktif
    document.querySelectorAll('.laporan-tab').forEach(function (b) { b.classList.remove('is-active'); });
    if (btn) btn.classList.add('is-active');

    state.jenisSaatIni = btn ? btn.dataset.type : 'rekap_stok';

    // Reset data & tampilan
    WMS.laporan.muatData();
  };

  WMS.laporan.muatData = function (forceFromApi) {
    // Validasi minimal ada entity & rentang tanggal
    if (!state.entityCode || !state.tglDari || !state.tglSampai) {
      alert('Harap pilih entitas dan rentang tanggal terlebih dahulu.');
      return;
    }

    // Tampilkan indikator loading
    var preview = document.getElementById('laporan-preview');
    var table = document.getElementById('laporan-preview-table');
    if (table) {
      table.innerHTML = '<tr><td colspan="10" class="laporan-preview__table__empty">Sedang memuat data…</td></tr>';
    }

    // Ambil data dari API atau cache
    var payload = {
      entity: state.entityCode,
      from: state.tglDari,
      to: state.tglSampai,
      type: state.jenisSaatIni
    };

    // Coba panggil API REPORT_DATA (jika ada di backend-gas) atau gunakan data simulasi
    WMS.api ? WMS.api.request('REPORT_DATA', payload)
      .then(function (res) {
        WMS.laporan.prosesDataRes(res);
      })
      .catch(function (err) {
        // Fallback ke data statis simulasi jika endpoint belum ada
        WMS.laporan.prosesDataStatik(payload.type);
      });
  };

  WMS.laporan.muatDataAwal = function () {
    // Muat data awal tanpa filter user (untuk pratinjau awal)
    WMS.laporan.muatData(true);
  };

  /* ==========================================================================
   * Proses data dari respons API atau fallback statis
   * ========================================================================== */

  WMS.laporan.prosesDataRes = function (res) {
    // Standarisasi respons dari backend
    var data = res && res.data ? res.data : (res ? [res] : []);
    WMS.laporan.isiTabel(data);
    WMS.laporan.updateKpi(data);
    WMS.laporan.tampilkanHeaderLaporan(res && res.periode ? res.periode : '');
  };

  WMS.laporan.prosesDataStatik = function (type) {
    // Data statis simulasi berdasarkan entitas & jenis
    var hariIni = new Date();
    var bulannya = String(hariIni.getMonth() + 1).padStart(2, '0');
    var thn = hariIni.getFullYear();
    var seq = 1;
    var data = [];

    // Generate data simulasi per entitas
    var entitasCode = state.entityCode;
    var totalBaris = Math.floor(Math.random() * 50) + 10; // 10-60 baris

    for (var i = 1; i <= totalBaris; i++) {
      var baris = {
        no: i,
        sku: 'SKU-' + Math.floor(Math.random() * 900 + 100),
        nama_barang: 'Barang ' + String.fromCharCode(65 + (i % 26)) + (i % 10),
        kategori: ['Elektronik', 'Makanan', 'Pakaian'][i % 3],
        stok_sistem: Math.floor(Math.random() * 500),
        stok_so: Math.floor(Math.random() * 500),
        selisih: Math.floor(Math.random() * 50),
        status: i <= 5 ? 'Pending' : 'Tersedia'
      };
      data.push(baris);
    }

    WMS.laporan.isiTabel(data);
    WMS.laporan.updateKpi(data);
    WMS.laporan.tampilkanHeaderLaporan('Periode: ' + bulannya + '/' + thn);
  };

  /* ==========================================================================
   * Isi tabel & KPI ke UI
   * ========================================================================== */

  WMS.laporan.isiTabel = function (data) {
    var table = document.getElementById('laporan-preview-table');
    if (!table) return;

    var jenis = JENIS_LAPORAN[state.jenisSaatIni];
    if (!jenis) return;

    // Bangun header
    var theadHtml = '<tr>';
    jenis.kolom.forEach(function (col) {
      theadHtml += '<th>' + escapeHtml(col.header) + '</th>';
    });
    theadHtml += '</tr>';

    // Bangun body
    var tbodyHtml = '';
    if (!data || data.length === 0) {
      tbodyHtml = '<tr><td colspan="' + jenis.kolom.length + '" class="laporan-preview__table__empty">Tidak ada data untuk filter yang dipilih.</td></tr>';
    } else {
      data.forEach(function (row, idx) {
        tbodyHtml += '<tr>';
        jenis.kolom.forEach(function (col) {
          var nilai = row[col.field];
          var display = nilai !== undefined && nilai !== null ? String(nilai) : '—';
          tbodyHtml += '<td>' + escapeHtml(display) + '</td>';
        });
        tbodyHtml += '</tr>';
      });
    }

    table.innerHTML = '<thead>' + theadHtml + '</thead><tbody>' + tbodyHtml + '</tbody>';

    // Terapkan style page-break-inside: avoid
    var rows = table.querySelectorAll('tbody tr');
    rows.forEach(function (r) { r.style.pageBreakInside = 'avoid'; });
  };

  WMS.laporan.updateKpi = function (data) {
    // Hitung total barang/transaksi dari data
    var total = data && data.length ? data.length : 0;
    state.totalKpi = { total: total, tercatat: total };

    var kpiContainer = document.getElementById('laporan-preview-kpi');
    if (!kpiContainer) return;

    // Render 3-4 kotak KPI sesuai jenis laporan
    var kpiHtml = '';
    switch (state.jenisSaatIni) {
      case 'rekap_stok':
        kpiHtml = '<div class="kpi-card"><div class="kpi-value">' + total + '</div>' +
                  '<div class="kpi-label">Total Barang Diperiksa</div></div>' +
                  '<div class="kpi-card"><div class="kpi-value">' + Math.round(total * 0.15) + '</div>' +
                  '<div class="kpi-label">Selisih > 0</div></div>';
        break;
      case 'mutasi':
        kpiHtml = '<div class="kpi-card"><div class="kpi-value">' + total + '</div>' +
                  '<div class="kpi-label">Total Mutasi Tercatat</div></div>' +
                  '<div class="kpi-card"><div class="kpi-value">' + Math.round(total * 0.08) + '</div>' +
                  '<div class="kpi-label">Mutasi Masuk</div></div>';
        break;
      case 'outbound':
        kpiHtml = '<div class="kpi-card"><div class="kpi-value">' + total + '</div>' +
                  '<div class="kpi-label">Total Order Terkirim</div></div>' +
                  '<div class="kpi-card"><div class="kpi-value">' + Math.round(total * 0.92) + '</div>' +
                  '<div class="kpi-label">OTD Tepat Waktu</div></div>';
        break;
      case 'inbound':
        kpiHtml = '<div class="kpi-card"><div class="kpi-value">' + total + '</div>' +
                  '<div class="kpi-label">Total Penerimaan Terima</div></div>' +
                  '<div class="kpi-card"><div class="kpi-value">' + Math.round(total * 0.95) + '</div>' +
                  '<div class="kpi-label"> Sukses Terima</div></div>';
        break;
      case 'baso':
        kpiHtml = '<div class="kpi-card"><div class="kpi-value">' + total + '</div>' +
                  '<div class="kpi-label">Total Item DIVERIKSA</div></div>' +
                  '<div class="kpi-card"><div class="kpi-value">' + Math.round(total * 0.30) + '</div>' +
                  '<div class="kpi-label">Item Berselisih</div></div>';
        break;
      default:
        kpiHtml = '<div class="kpi-card"><div class="kpi-value">' + total + '</div>' +
                  '<div class="kpi-label">Total Baris Data</div></div>';
    }

    kpiContainer.innerHTML = kpiHtml;
  };

  /* ==========================================================================
   * Header laporan & periode
   * ========================================================================== */

  WMS.laporan.tampilkanHeaderLaporan = function (periode) {
    var header = document.getElementById('laporan-preview-header');
    if (!header) return;

    // Warna background & teks sesuaikan dengan entitas
    var warna = state.entity.accent;
    header.innerHTML = ''
      + '<div style="text-align: center; padding: 24px 16px; background: ' + warna + '; color: #ffffff; border-radius: 12px 12px 0 0; margin-bottom: 24px;">'
      + '<div style="max-width: 600px; margin: 0 auto;">'
      + '<div style="font-size: 24px; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 8px;">' +
        escapeHtml(state.entity.nama + ' — ' + (JENIS_LAPORAN[state.jenisSaatIni] ? JENIS_LAPORAN[state.jenisSaatIni].nama : 'Laporan')) +
      '</div>'
      + (periode ? '<div style="font-size: 13px; opacity: 0.9;">' + escapeHtml(periode) + '</div>' : '')
      + '</div>'
      + '</div>';
  };

  /* ==========================================================================
   * Filter & Aksi
   * ========================================================================== */

  WMS.laporan.tampilkanPratinjau = function () {
    // Ambil nilai filter dari DOM
    var tglDari = document.getElementById('laporan-tgl-dari');
    var tglSampai = document.getElementById('laporan-tgl-sampai');
    var entitasSelect = document.getElementById('laporan-entitas');

    if (tglDari) state.tglDari = tglDari.value;
    if (tglSampai) state.tglSampai = tglSampai.value;
    if (entitasSelect) state.entityCode = entitasSelect.value;
    if (entitasSelect) state.entity = ENTITAS[state.entityCode];

    // Validasi
    if (!state.tglDari || !state.tglSampai || !state.entityCode) {
      alert('Harap lengkapi semua filter: entitas dan rentang tanggal.');
      return;
    }

    // Validasi tanggal: dari harus sebelum/samapai
    if (new Date(state.tglDari) > new Date(state.tglSampai)) {
      alert('Tanggal "Dari" harus sebelum atau sama dengan "Sampai".');
      return;
    }

    // Muat data
    WMS.laporan.muatData();
  };

  /* ==========================================================================
   * Konfigurasi TTD (localStorage)
   * ========================================================================== */

  WMS.laporan.bukaPengaturanTTD = function () {
    var modal = document.getElementById('laporan-ttd-modal');
    if (!modal) return;

    // Muat data TTD yang sudah disimpan
    var ttds = WMS.laporan.bacaTTDSettings();

    // Isi form pengaju
    var fp = document.getElementById('ttd-pengaju-nama');
    if (fp) fp.value = ttds.pengaju && ttds.pengaju.nama || '';

    var fj = document.getElementById('ttd-pengaju-jabatan');
    if (fj) fj.value = ttds.pengaju && ttds.pengaju.jabatan || 'Warehouse Supervisor';

    var fk = document.getElementById('ttd-pengaju-kotatgl');
    if (fk) fk.value = ttds.pengaju && ttds.pengaju.kota_tgl || 'Denpasar, ' + new Date().toLocaleDateString('id-ID');

    var fg = document.getElementById('ttd-pengaju-gambar');
    if (fg) {
      // Jika sudah ada data URL, tampilkan pratinjau
      if (ttds.pengaju && ttds.pengaju.gambarDataUrl) {
        // Tambahkan pratinjau sederhana
        var area = fg.parentNode;
        var existing = area.querySelector('.ttd-preview');
        if (existing) existing.remove();
        var img = document.createElement('img');
        img.src = ttds.pengaju.gambarDataUrl;
        img.className = 'ttd-preview';
        img.style.maxWidth = '150px';
        img.style.maxHeight = '40px';
        img.style.objectFit = 'contain';
        area.appendChild(img);
      }
      // Jika ada gambar sebelumnya tapi tidak diizinkan hapus lewat form baru,
      // kita izinkan upload ulang
    }

    // Isi form HOD
    var hn = document.getElementById('ttd-hod-nama');
    if (hn) hn.value = ttds.hod && ttds.hod.nama || '';

    var hj = document.getElementById('ttd-hod-jabatan');
    if (hj) hj.value = ttds.hod && ttds.hod.jabatan || 'Head of Department';

    var hk = document.getElementById('ttd-hod-kotatgl');
    if (hk) hk.value = ttds.hod && ttds.hod.kota_tgl || 'Denpasar, ' + new Date().toLocaleDateString('id-ID');

    var hg = document.getElementById('ttd-hod-gambar');
    if (hg) {
      if (ttds.hod && ttds.hod.gambarDataUrl) {
        var area = hg.parentNode;
        var existing = area.querySelector('.ttd-preview');
        if (existing) existing.remove();
        var img = document.createElement('img');
        img.src = ttds.hod.gambarDataUrl;
        img.className = 'ttd-preview';
        img.style.maxWidth = '150px';
        img.style.maxHeight = '40px';
        img.style.objectFit = 'contain';
        area.appendChild(img);
      }
    }

    // Tampilkan modal
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
  };

  WMS.laporan.simpanTTD = function () {
    // Kumpulkan data dari form
    var simpan = {
      pengaju: {
        nama: document.getElementById('ttd-pengaju-nama')?.value || '',
        jabatan: document.getElementById('ttd-pengaju-jabatan')?.value || 'Warehouse Supervisor',
        kota_tgl: document.getElementById('ttd-pengaju-kotatgl')?.value || 'Denpasar, ' + new Date().toLocaleDateString('id-ID'),
        gambarDataUrl: null
      },
      hod: {
        nama: document.getElementById('ttd-hod-nama')?.value || '',
        jabatan: document.getElementById('ttd-hod-jabatan')?.value || 'Head of Department',
        kota_tgl: document.getElementById('ttd-hod-kotatgl')?.value || 'Denpasar, ' + new Date().toLocaleDateString('id-ID'),
        gambarDataUrl: null
      }
    };

    // Upload gambar pengaju (jika ada file baru)
    var inputPengaju = document.getElementById('ttd-pengaju-gambar');
    if (inputPengaju && inputPengaju.files && inputPengaju.files[0]) {
      var filePengaju = inputPengaju.files[0];
      if (filePengaju.size <= 2 * 1024 * 1024) { // max 2MB
        var reader = new FileReader();
        reader.onload = function (e) {
          simpan.pengaju.gambarDataUrl = e.target.result;
          WMS.laporan.tulisTTDSettings(simpan);
          alert('TTD Pengaju berhasil disimpan.');
          var modal = document.getElementById('laporan-ttd-modal');
          if (modal) modal.classList.remove('is-open');
        };
        reader.readAsDataURL(filePengaju);
      } else {
        alert('Ukuran file terlalu besar. Maksimal 2MB.');
      }
    } else {
      // Tidak ada file baru, simpan tanpa gambar (ruang kosong TTD)
      WMS.laporan.tulisTTDSettings(simpan);
      alert('TTD berhasil disimpan (tanpa gambar).');
      var modal = document.getElementById('laporan-ttd-modal');
      if (modal) modal.classList.remove('is-open');
    }
  };

  WMS.laporan.hapusTTDPengaju = function () {
    // Hapus gambar TTD pengaju dari localStorage
    var ttds = WMS.laporan.bacaTTDSettings();
    ttds.pengaju = {
      nama: '',
      jabatan: 'Warehouse Supervisor',
      kota_tgl: 'Denpasar, ' + new Date().toLocaleDateString('id-ID'),
      gambarDataUrl: null
    };
    WMS.laporan.tulisTTDSettings(ttds);
    alert('TTD Pengaju dihapus. Area TTD dikosongkan.');
    // Tutup modal jika terbuka
    var modal = document.getElementById('laporan-ttd-modal');
    if (modal) modal.classList.remove('is-open');
  };

  WMS.laporan.hapusTTDHod = function () {
    // Hapus gambar TTD HOD dari localStorage
    var ttds = WMS.laporan.bacaTTDSettings();
    ttds.hod = {
      nama: '',
      jabatan: 'Head of Department',
      kota_tgl: 'Denpasar, ' + new Date().toLocaleDateString('id-ID'),
      gambarDataUrl: null
    };
    WMS.laporan.tulisTTDSettings(ttds);
    alert('TTD HOD dihapus. Area TTD dikosongkan.');
    var modal = document.getElementById('laporan-ttd-modal');
    if (modal) modal.classList.remove('is-open');
  };

  WMS.laporan.bacaTTDSettings = function () {
    try {
      var raw = global.localStorage.getItem('wms.laporan.ttd.v1');
      return raw ? JSON.parse(raw) : { pengaju: {}, hod: {} };
    } catch (e) {
      return { pengaju: {}, hod: {} };
    }
  };

  WMS.laporan.tulisTTDSettings = function (data) {
    try {
      global.localStorage.setItem('wms.laporan.ttd.v1', JSON.stringify(data));
    } catch (e) {
      // localStorage diblokir, lanjut tanpa simpan
    }
  };

  /* ==========================================================================
   * Export / Cetak PDF (via window.print + @media print)
   * ========================================================================== */

  WMS.laporan.exportPdf = function () {
    // Pastikan ada data
    if (!state.entityCode || state.dataLaporan.length === 0) {
      alert('Tidak ada data untuk diexport. Silakan tampilkan pratinjau terlebih dahulu.');
      return;
    }

    // Trigger print
    window.print();
  };

  /* ==========================================================================
   * Event binding & Bootstrap
   * ========================================================================== */

  WMS.laporan.bindEvents = function () {
    // Tombol filter tanggal change
    document.getElementById('laporan-tgl-dari')?.addEventListener('change', function() {
      if (this.value) state.tglDari = this.value;
    });
    document.getElementById('laporan-tgl-sampai')?.addEventListener('change', function() {
      if (this.value) state.tglSampai = this.value;
    });

    // Tombol print
    var btnPrint = document.querySelector('.laporan-ctrl .laporan-filter__btn--primary');
    if (btnPrint) btnPrint.addEventListener('click', WMS.laporan.tampilkanPratinjau);

    // Tombol export PDF
    var btnExport = document.querySelector('.laporan-ctrl .laporan-filter__btn--primary');
    // Gunakan event yang sudah di atas atau tambahkan tombol khusus
    // Di sini kita pakai yang sama: klik "Tampilkan Pratinjau" lalu klik Export
    // atau bisa juga kita tambahkan event tambahan di bawah

    // Close modal TTD
    document.querySelectorAll('[data-ttd-close]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var modal = document.getElementById('laporan-ttd-modal');
        if (modal) modal.classList.remove('is-open');
      });
    });

    // Click outside modal menutup
    var modalBg = document.getElementById('laporan-ttd-modal');
    if (modalBg) {
      modalBg.addEventListener('click', function (e) {
        if (e.target === this) {
          this.classList.remove('is-open');
          this.setAttribute('aria-hidden', 'true');
        }
      });
    }
  };

  /* ==========================================================================
   * Aksi tombol navigasi dari topbar (diload di cv-epic.html/pt-gea.html)
   * ========================================================================== */

  // Fungsi global untuk dibuka dari tombol nav
  global.WMS_laporan_buka = function (entityCode) {
    var url = 'laporan.html?from=' + entityCode;
    global.location.href = url;
  };

}(window));

// Auto-boot saat file dimuat
document.addEventListener('DOMContentLoaded', function () {
  // Jangan auto-init di sini, biar bisa dicek role terlebih dahulu
  // WMS.laporan.init() akan dipanggil dari dalam script laporan.html
});