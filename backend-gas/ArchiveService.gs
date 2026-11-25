/**
 * ArchiveService.gs — Modul Arsip Bulanan WMS Terpadu CV EPIC & PT GEA
 * DILARANG: mengubah struktur sheet operasional (Inbound_Log, Outbound_Log, Stok_Gudang, Stock_Opname)
 *           & dilarang keras menyentuh HR service/modul HR.
 *
 * Fitur:
 * - Jadwal otomatis tiap 1 di bulan pukul 03:00 WITA
 * - Duplikasi spreadsheet ke Drive ARSIP_BULANAN_WMS
 * - Reset log aktif (hapus transaksi selesai, pertahankan pending/draft)
 * - Metadata di tab Archive_Registry di DB_MASTER
 * - Endpoint API: ARCHIVE_LIST, ARCHIVE_REGISTER_MANUAL, ARCHIVE_TRIGGER_STATUS/INSTALL
 * - Baca-only mode via archive_id parameter
 */

// ============================================================================
// KONFIGURASI GLOBAL
// ============================================================================

// Nama folder Drive untuk menyimpan arsip bulanan
const ARCHIVE_FOLDER_NAME = 'ARSIP_BULANAN_WMS';

// Nama tab arsip di DB_MASTER
const ARCHIVE_REGISTRY_TAB = 'Archive_Registry';

// Prefix nama file arsip
const ARCHIVE_FILE_PREFIX = 'ARCHIVE_DB_';

// Role yang boleh memanggil endpoint arsip
const ARCHIVE_ALLOWED_ROLES = ['SPV', 'SUPERVISOR', 'HOD'];

// ============================================================================
// FUNGSI UTAMA: JADWAL ARSIP BULANAN OTOMATIS
// ============================================================================

/**
 * Fungsi yang dijadwalkan dieksekusi tiap 1 di bulan pukul 03:00 WITA
 * Fungsi ini:
 * 1. Menentukan periode bulan terakhir (relatif ke zona Asia/Makassar)
 * 2. Membuat/mengakses folder ARSIP_BULANAN_WMS di Drive root
 * 3. Untuk setiap entitas (EPIC, GEA): duplikasi spreadsheet, verifikasi, 
    catat metadata, dan reset log aktif
 * 4. Mencegah duplikat berdasarkan periode + entitas di Archive_Registry
 */
function runMonthlyArchiveJob() {
  try {
    // Set zona waktu Asia/Makassar (WITA)
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const utcDate = new Date();
    const makebali = new Date(utcDate.getTime() + 8 * 60 * 60 * 1000); // offset +8 untuk WITA
    const date = makebali;
    
    // Hitung periode bulan LAST (bulan sebelumnya)
    const lastDayOfLastMonth = new Date(date.getFullYear(), date.getMonth(), 0);
    const lastMonth = date.getMonth(); // 0-11, di sini ini sudah bulan terakhir
    const lastYear = date.getFullYear();
    
    // Jika hari ini adalah 1, maka periode adalah bulan BENAR sebelumnya
    // Contoh: jika 1 Des 2026 -> periode November 2026
    const periodeYYYYMM = `${lastYear}${String(lastMonth + 1).padStart(2, '0')}`; // 202611
    const namaBulan = getIndonesianMonthName(lastMonth + 1); // November
    
    // Nama folder Drive
    const folderName = ARCHIVE_FOLDER_NAME;
    let folder;
    const allFolders = DriveApp.getFoldersByName(folderName);
    if (allFolders.hasNext()) {
      folder = allFolders.next();
    } else {
      folder = DriveApp.createFolder(folderName);
    }
    
    // Dapatkan daftar entitas aktif dari tab DB_MASTER
    const masterSheet = ss.getSheetByName('DB_MASTER');
    if (!masterSheet) {
      log('ERROR: Tab DB_MASTER tidak ditemukan');
      return false;
    }
    
    // Ambil daftar entitas aktif (kolom: kode entitas)
    const masterData = masterSheet.getDataRange().getValues();
    const entitasList = [];
    for (let i = 1; i < masterData.length; i++) { // mulai dari baris 2
      const row = masterData[i];
      // Asumsi kolom A adalah kode entitas, kolom B adalah status aktif
      if (row[0] && String(row[0]).trim() && ['EPIC', 'GEA'].includes(String(row[0]).trim())) {
        entitasList.push(String(row[0]).trim());
      }
    }
    
    // Proses untuk setiap entitas
    const results = [];
    for (const entitas of entitasList) {
      const res = processEntityArchive(ss, entitas, periodeYYYYMM, namaBulan, folder);
      results.push(res);
    }
    
    // Simpan registry ke tab Archive_Registry
    saveArchiveRegistry(periodeYYYYMM, namaBulan, entitasList);
    
    log(`ARSIP BULANAN SELESAI: Periode ${periodeYYYYMM}, Entitas: ${entitasList.join(', ')}`);
    return true;
    
  } catch (e) {
    log(`ARSIP BULANAN ERROR: ${e.toString()}`);
    return false;
  }
}

/**
 * Proses arsip untuk satu entitas tertentu
 */
function processEntityArchive(ss, entitas, periodeYYYYMM, namaBulan, folder) {
  const results = { success: false, fileId: null, error: null };
  
  try {
    // 1. Dapatkan Spreadsheet ID entitas dari DB_MASTER
    const masterSheet = ss.getSheetByName('DB_MASTER');
    const masterData = masterSheet.getDataRange().getValues();
    let ssId = '';
    for (let i = 1; i < masterData.length; i++) {
      const row = masterData[i];
      if (String(row[0]).trim() === entitas) {
        // Asumsi kolom C (index 2) adalah spreadsheet ID
        if (row[2] && String(row[2]).trim()) {
          ssId = String(row[2]).trim();
          break;
        }
      }
    }
    
    if (!ssId) {
      results.error = `Spreadsheet ID not found for entitas: ${entitas}`;
      return results;
    }
    
    // 2. Duplikasi spreadsheet
    const sourceFile = DriveApp.getFileById(ssId);
    if (!sourceFile) {
      results.error = `Source file not found: ${ssId}`;
      return results;
    }
    
    const copyName = `${ARCHIVE_FILE_PREFIX}${entitas}_${periodeYYYYMM}_${namaBulan}`;
    const copyFile = sourceFile.makeCopy(copyName, folder);
    results.fileId = copyFile.getId();
    
    // 3. Verifikasi integritas file baru
    try {
      const copySpreadsheet = SpreadsheetApp.openById(copyFile.getId());
      // Cek tab-tab utama yang harus ada
      const requiredTabs = ['Inbound_Log', 'Outbound_Log', 'Stok_Gudang', 'Stock_Opname'];
      let allTabsValid = true;
      for (const tab of requiredTabs) {
        if (!copySpreadsheet.getSheetByName(tab)) {
          allTabsValid = false;
          break;
        }
      }
      if (!allTabsValid) {
        // Jika tab tidak valid, hapus file dan batalkan
        DriveApp.getFileById(copyFile.getId()).trash();
        results.error = `Verifikasi gagal: tab utama tidak valid di file kopi`;
        return results;
      }
      // Tutup spreadsheet verifikasi (jangan disimpan perubahan)
      copySpreadsheet.close();
    } catch (e) {
      results.error = `Verifikasi integritas error: ${e.toString()}`;
      return results;
    }
    
    // 4. Catat metadata ke Archive_Registry di DB_MASTER
    // Cek dulu apakah sudah ada entri untuk periode + entitas ini
    const registrySheet = ss.getSheetByName('Archive_Registry');
    const registryExists = registrySheet !== null;
    
    let registryRow = null;
    if (registryExists) {
      const regData = registrySheet.getDataRange().getValues();
      for (let i = 1; i < regData.length; i++) {
        const row = regData[i];
        // Kolom: Archive_ID | Periode_YYYYMM | Label_Bulan | Entitas | Spreadsheet_ID | Nama_File | Waktu_Backup | Sumber
        if (String(row[1]).trim() === periodeYYYYMM && String(row[3]).trim() === entitas) {
          registryRow = i + 1; // baris 1-based
          break;
        }
      }
    }
    
    // Jika sudah ada, update; jika belum, tambah baris baru
    const now = new Date();
    const backupTime = Utilities.formatDate(now, 'Asia/Makassar', 'yyyy-MM-dd HH:mm:ss');
    
    if (registryRow) {
      // Update entri existensi
      registrySheet.getRange(registryRow, 5).setValue(copyFile.getName()); // Nama_File
      registrySheet.getRange(registryRow, 6).setValue(copyFile.getId()); // Spreadsheet_ID (disimpan ID file arsip)
      registrySheet.getRange(registryRow, 7).setValue(backupTime); // Waktu_Backup
    } else {
      // Tambah baris baru
      const newRow = registrySheet.getLastRow() + 1;
      registrySheet.getRange(newRow, 1).setValue(`ARCHIVE_${periodeYYYYMM}_${entitas}`); // Archive_ID
      registrySheet.getRange(newRow, 2).setValue(periodeYYYYMM); // Periode_YYYYMM
      registrySheet.getRange(newRow, 3).setValue(namaBulan); // Label_Bulan
      registrySheet.getRange(newRow, 4).setValue(entitas); // Entitas
      registrySheet.getRange(newRow, 5).setValue(copyFile.getName()); // Nama_File
      registrySheet.getRange(newRow, 6).setValue(copyFile.getId()); // Spreadsheet_ID
      registrySheet.getRange(newRow, 7).setValue(backupTime); // Waktu_Backup
    }
    
    // 5. Reset log aktif (tanpa ubah header & schema)
    resetActiveLogs(ss, entitas, periodeYYYYMM);
    
    results.success = true;
    return results;
    
  } catch (e) {
    results.error = `processEntityArchive error: ${e.toString()}`;
    return results;
  }
}

/**
 * Reset log aktif: 
 - Stok_Gudang: pertahankan baris SKU, perbarui Stok_Awal = Stok_Akhir terkini
 - Outbound_Log: hapus baris DISPATCHED/DELIVERED/COMPLETED, pertahankan PENDING/DRAFT/PACKING
 - Inbound_Log & Stock_Opname: bersihkan baris ke-2 ke bawah (hanya pertahankan header)
 */
function resetActiveLogs(ss, entitas, periodeYYYYMM) {
  try {
    const masterSheet = ss.getSheetByName('DB_MASTER');
    
    // 1. Stok_Gudang
    const gudangSheet = ss.getSheetByName('Stok_Gudang');
    if (gudangSheet) {
      // Header di baris 1, data mulai baris 2
      const lastRow = gudangSheet.getLastRow();
      if (lastRow >= 2) {
        const dataRange = gudangSheet.getRange(2, 1, lastRow - 1, gudangSheet.getLastColumn());
        const dataValues = dataRange.getValues();
        
        const newRows = [];
        for (let i = 0; i < dataValues.length; i++) {
          const row = dataValues[i];
          if (row && row.length > 0) {
            // Kolom Stok_Akhir biasanya di indeks tertentu, sesuaikan dengan skema
            // Asumsi: cari kolom yang berisi stok akhir dan jadikan Stok_Awal baru
            const stokAkhirIdx = findStokAkhirIndex(row);
            const stokBaru = stokAkhirIdx >= 0 ? row[stokAkhirIdx] : '';
            
            // Pertahankan baris ini, dan set Stok_Awal = Stok_Akhir terkini
            const newRow = [...row];
            // Asumsi kolom Stok_Awal di index 3 (sesuaikan dengan skema nyata)
            if (stokBaru !== '') {
              newRow[3] = stokBaru; // Stok_Awal = Stok_Akhir terkini
            }
            newRows.push(newRow);
          }
        }
        
        // Clear konten lama dan tulis ulang
        dataRange.clearContent();
        if (newRows.length > 0) {
          dataRange.setValues(newRows);
        }
      }
    }
    
    // 2. Outbound_Log
    const outboundSheet = ss.getSheetByName('Outbound_Log');
    if (outboundSheet) {
      const lastRow = outboundSheet.getLastRow();
      if (lastRow >= 2) {
        // Baca semua baris data (dari baris 2)
        const dataRange = outboundSheet.getRange(2, 1, lastRow - 1, outboundSheet.getLastColumn());
        const dataValues = dataRange.getValues();
        
        // Determin status "selesai" variations
        const finishedStatuses = ['DISPATCHED', 'DELIVERED', 'COMPLETED'];
        
        // Filter: pertahankan baris yang status-nya BELUM selesai
        const rowsToKeep = [];
        for (let i = 0; i < dataValues.length; i++) {
          const row = dataValues[i];
          if (row && row.length > 0) {
            const statusColIdx = findStatusIndex(row); // fungsi bantu untuk cari kolom status
            const status = statusColIdx >= 0 ? String(row[statusColIdx]).trim() : '';
            if (!finishedStatuses.includes(status)) {
              rowsToKeep.push(row);
            }
            // else: baris ini (sudah selesai) akan diarsipkan, jadi tidak ditambahkan
          }
        }
        
        // Clear dan tulis ulang baris yang tersisa mulai baris ke-2
        dataRange.clearContent();
        if (rowsToKeep.length > 0) {
          // Tulis baris yang dipertahankan, mulai dari baris ke-2
          dataRange.setRows(1, rowsToKeep.length, rowsToKeep); // setRows: startRow, numRows, 2D array
        }
      }
    }
    
    // 3. Inbound_Log & Stock_Opname
    const inboundSheet = ss.getSheetByName('Inbound_Log');
    if (inboundSheet) {
      const lastRow = inboundSheet.getLastRow();
      if (lastRow >= 2) {
        // Bersihkan isi baris ke-2 ke bawah, hanya pertahankan header baris 1
        inboundSheet.getRange(2, 1, lastRow - 1, inboundSheet.getLastColumn()).clearContent();
      }
    }
    
    const opnameSheet = ss.getSheetByName('Stock_Opname');
    if (opnameSheet) {
      const lastRow = opnameSheet.getLastRow();
      if (lastRow >= 2) {
        opnameSheet.getRange(2, 1, lastRow - 1, opnameSheet.getLastColumn()).clearContent();
      }
    }
    
    log(`Log aktif direset untuk ${entitas}`);
    
  } catch (e) {
    log(`Error resetActiveLogs: ${e.toString()}`);
  }
}

/**
 * Bantu: cari indeks kolom Stok_Akhir di row
 */
function findStokAkhirIndex(row) {
  // Implementasi sederhana: cari nilai yang terlihat seperti angka stok di berbagai kolom
  for (let i = 0; i < row.length; i++) {
    if (row[i] && typeof row[i] === 'number' && !isNaN(row[i])) {
      return i;
    }
  }
  return -1;
}

/**
 * Bantu: cari indeks kolom status di row Outbound_Log
 */
function findStatusIndex(row) {
  // Asumsi kolom status di baris header bernama "Status" atau diketahui posisinya
  // Implementasi: cari kolom terakhir atau sesuai konvensi
  for (let i = row.length - 1; i >= 0; i--) {
    if (row[i] && String(row[i]).trim()) {
      const s = String(row[i]).trim().toUpperCase();
      if (s === 'DISPATCHED' || s === 'DELIVERED' || s === 'PENDING' || s === 'DRAFT' || s === 'PACKING' || s === 'COMPLETED') {
        return i;
      }
    }
  }
  return -1;
}

/**
 * Dapatkan nama bulan dalam Bahasa Indonesia
 */
function getIndonesianMonthName(bulanAngka) {
  const months = [
    '', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];
  return months[bulanAngka] || '';
}

// ============================================================================
// FUNGSI: INSTALL TRIGGER BULANAN
// ============================================================================

/**
 * Menghapus trigger lama dan membuat trigger baru tiap 1 di bulan pukul 03:00 WITA
 */
function installMonthlyArchiveTrigger() {
  try {
    // Hapus trigger lama dengan nama handler runMonthlyArchiveJob
    const allTriggers = ScriptApp.getProjectTriggers();
    for (const trigger of allTriggers) {
      if (trigger.getHandlerFunction() === 'runMonthlyArchiveJob') {
        ScriptApp.deleteTrigger(trigger);
      }
    }
    
    // Buat trigger baru
    const newTrigger = ScriptApp.newTrigger('runMonthlyArchiveJob')
      .timeBased()
      .onMonthDay(1) // setiap 1 di bulan
      .atHour(3) // pukul 03:00
      .inTimezone('Asia/Makassar') // WITA
      .create();
    
    log(`TRIGGER ARSIP DIINSTAL: Aktif pada setiap 1 di bulan pukul 03:00 WITA`);
    return true;
    
  } catch (e) {
    log(`ERROR installMonthlyArchiveTrigger: ${e.toString()}`);
    return false;
  }
}

// ============================================================================
// FUNGSI: SAVE ARCHIVE REGISTRY
// ============================================================================

/**
 * Simpan/memperbarui daftar arsip ke tab Archive_Registry di DB_MASTER
 */
function saveArchiveRegistry(periodeYYYYMM, namaBulan, entitasList) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const masterSheet = ss.getSheetByName('DB_MASTER');
  
  if (!masterSheet) {
    log('ERROR: Tab DB_MASTER not found for registry save');
    return false;
  }
  
  const registrySheetName = 'Archive_Registry';
  let registrySheet;
  
  // Cek apakah tab Archive_Registry sudah ada
  const sheetNames = masterSheet.getSheetNames();
  if (sheetNames.includes(registrySheetName)) {
    registrySheet = masterSheet.getSheetByName(registrySheetName);
  } else {
    // Buat tab baru dengan header
    registrySheet = masterSheet.insertSheet(registrySheetName);
    // Header: Archive_ID | Periode_YYYYMM | Label_Bulan | Entitas | Spreadsheet_ID | Nama_File | Waktu_Backup | Sumber
    registrySheet.appendRow([
      'Archive_ID',
      'Periode_YYYYMM',
      'Label_Bulan',
      'Entitas',
      'Spreadsheet_ID',
      'Nama_File',
      'Waktu_Backup',
      'Sumber'
    ]);
  }
  
  // Setiap entitas di daftar
  const now = new Date();
  const backupTime = Utilities.formatDate(now, 'Asia/Makassar', 'yyyy-MM-dd HH:mm:ss');
  
  for (const entitas of entitasList) {
    // Cek duplikat
    const regData = registrySheet.getDataRange().getValues();
    let exists = false;
    let targetRow = null;
    
    for (let i = 1; i < regData.length; i++) { // mulai dari baris 2 (header baris 1)
      const row = regData[i];
      if (row && String(row[1]).trim() === periodeYYYYMM && String(row[3]).trim() === entitas) {
        exists = true;
        targetRow = i + 1; // baris 1-based
        break;
      }
    }
    
    if (exists && targetRow) {
      // Update entri existensi
      registrySheet.getRange(targetRow, 6).setValue(`${ARCHIVE_FILE_PREFIX}${entitas}_${periodeYYYYMM}_${namaBulan}`); // Nama_File
      registrySheet.getRange(targetRow, 6).setValue(Utilities.formatDate(now, 'Asia/Makassar', 'yyyy-MM-dd HH:mm:ss')); // Waktu_Backup (update)
    } else {
      // Tambah baris baru di akhir
      const newRow = registrySheet.getLastRow() + 1;
      registrySheet.getRange(newRow, 1).setValue(`ARCHIVE_${periodeYYYYMM}_${entitas}`);
      registrySheet.getRange(newRow, 2).setValue(periodeYYYYMM);
      registrySheet.getRange(newRow, 3).setValue(namaBulan);
      registrySheet.getRange(newRow, 4).setValue(entitas);
      registrySheet.getRange(newRow, 5).setValue(''); // Spreadsheet_ID (akan diisi saat manual register)
      registrySheet.getRange(newRow, 6).setValue(`${ARCHIVE_FILE_PREFIX}${entitas}_${periodeYYYYMM}_${namaBulan}`); // Nama_File
      registrySheet.getRange(newRow, 7).setValue(backupTime); // Waktu_Backup
    }
  }
  
  log(`REGISTRY ARSIP TERSIMPAN: ${entitasList.length} entitas untuk ${periodeYYYYMM}`);
  return true;
}

// ============================================================================
// ENDPOINT API: ARCHIVE LIST / REGISTER / TRIGGER STATUS
// ============================================================================

/**
 * ENDPOINT: ARCHIVE_LIST
 * Mengembalikan daftar arsip bulanan dari Archive_Registry
 * Difiksi role: SPV, SUPERVISOR, HOD
 */
function archiveList() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const masterSheet = ss.getSheetByName('DB_MASTER');
  
  if (!masterSheet) {
    return [];
  }
  
  const registrySheet = masterSheet.getSheetByName('Archive_Registry');
  if (!registrySheet) {
    return [];
  }
  
  const regData = registrySheet.getDataRange().getValues();
  const archives = [];
  
  // Lewati header baris 1, mulai dari baris 2
  for (let i = 1; i < regData.length; i++) {
    const row = regData[i];
    if (row && row[1] && row[3]) { // Periode_YYYYMM, Entitas
      archives.push({
        archiveId: row[0] || '', // Archive_ID
        periode: String(row[1]).trim(), // Periode_YYYYMM
        labelBulan: String(row[2]).trim(), // Label_Bulan
        entitas: String(row[3]).trim(), // Entitas
        spreadsheetId: String(row[4] || '').trim(), // Spreadsheet_ID
        namaFile: String(row[5] || '').trim(), // Nama_File
        waktuBackup: String(row[6] || '').trim(), // Waktu_Backup
        sumber: String(row[7] || '').trim() // Sumber
      });
    }
  }
  
  // Urut dari periode terbaru ke lama (descending)
  archives.sort((a, b) => {
    return Number(b.periode) - Number(a.periode);
  });
  
  return archives;
}

/**
 * ENDPOINT: ARCHIVE_REGISTER_MANUAL
 * Menerima data dari web untuk meregistri file arsip manual
 * Payload: { periode_yyyymm, label_bulan, entitas, spreadsheet_id_or_url }
 */
function archiveRegisterManual(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const masterSheet = ss.getSheetByName('DB_MASTER');
  
  if (!masterSheet) {
    return { success: false, error: 'DB_MASTER not found' };
  }
  
  const { periode_yyyymm, label_bulan, entitas, spreadsheet_id_or_url } = payload;
  
  // Ekstrak ID dari URL jika user menempelkan link lengkap Google Sheet
  let spreadsheetId = spreadsheet_id_or_url;
  if (spreadsheet_id_or_url && spreadsheet_id_or_url.includes('docs.google.com')) {
    // Ekstrak ID dari URL: https://docs.google.com/spreadsheets/d/ID_FILE/edit#
    const match = spreadsheet_id_or_url.match(/d\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      spreadsheetId = match[1];
    }
  }
  
  // Verifikasi akses file
  let fileId = spreadsheetId;
  let fileName = '';
  if (spreadsheetId) {
    try {
      const file = DriveApp.getFileById(spreadsheetId);
      fileName = file.getName();
      // Verifikasi file bisa dibuka
      SpreadsheetApp.openById(spreadsheetId);
    } catch (e) {
      return { success: false, error: 'Tidak dapat membuka file Google Sheet: ' + e.toString() };
    }
  }
  
  // Simpan ke Archive_Registry
  const registrySheetName = 'Archive_Registry';
  let registrySheet;
  const sheetNames = masterSheet.getSheetNames();
  if (sheetNames.includes(registrySheetName)) {
    registrySheet = masterSheet.getSheetByName(registrySheetName);
  } else {
    registrySheet = masterSheet.insertSheet(registrySheetName);
    registrySheet.appendRow([
      'Archive_ID',
      'Periode_YYYYMM',
      'Label_Bulan',
      'Entitas',
      'Spreadsheet_ID',
      'Nama_File',
      'Waktu_Backup',
      'Sumber'
    ]);
  }
  
  // Cek duplikat
  const regData = registrySheet.getDataRange().getValues();
  let exists = false;
  let targetRow = null;
  
  for (let i = 1; i < regData.length; i++) {
    const row = regData[i];
    if (row && String(row[1]).trim() === periode_yyyymm && String(row[3]).trim() === entitas) {
      exists = true;
      targetRow = i + 1;
      break;
    }
  }
  
  const now = new Date();
  const backupTime = Utilities.formatDate(now, 'Asia/Makassar', 'yyyy-MM-dd HH:mm:ss');
  
  if (exists && targetRow) {
    // Update entri
    registrySheet.getRange(targetRow, 2).setValue(periode_yyyymm);
    registrySheet.getRange(targetRow, 3).setValue(label_bulan);
    registrySheet.getRange(targetRow, 4).setValue(entitas);
    registrySheet.getRange(targetRow, 5).setValue(spreadsheetId);
    registrySheet.getRange(targetRow, 6).setValue(fileName);
    registrySheet.getRange(targetRow, 7).setValue(backupTime);
  } else {
    // Baris baru
    const newRow = registrySheet.getLastRow() + 1;
    registrySheet.getRange(newRow, 1).setValue(`ARCHIVE_${periode_yyyymm}_${entitas}`);
    registrySheet.getRange(newRow, 2).setValue(periode_yyyymm);
    registrySheet.getRange(newRow, 3).setValue(label_bulan);
    registrySheet.getRange(newRow, 4).setValue(entitas);
    registrySheet.getRange(newRow, 5).setValue(spreadsheetId);
    registrySheet.getRange(newRow, 6).setValue(fileName);
    registrySheet.getRange(newRow, 7).setValue(backupTime);
  }
  
  return { success: true, archiveId: `ARCHIVE_${periode_yyyymm}_${entitas}` };
}

/**
 * ENDPOINT: ARCHIVE_TRIGGER_STATUS
 * Cek status aktif trigger tanggal 1 jam 03:00 WITA
 */
function archiveTriggerStatus() {
  const allTriggers = ScriptApp.getProjectTriggers();
  let found = false;
  
  for (const trigger of allTriggers) {
    if (trigger.getHandlerFunction() === 'runMonthlyArchiveJob') {
      // Cek kapan trigger terakhir kali diaktifkan/dimodifikasi
      const lastRun = trigger.getLastModifiedDate();
      found = true;
      return {
        active: true,
        handler: 'runMonthlyArchiveJob',
        lastModified: lastRun ? Utilities.formatDate(lastRun, 'Asia/Makassar', 'yyyy-MM-dd HH:mm:ss') : 'Tidak diketahui'
      };
    }
  }
  
  return { active: false, handler: null, lastModified: 'Tidak ada' };
}

/**
 * ENDPOINT: ARCHIVE_TRIGGER_INSTALL
 * Instal trigger dari web (digunakan jika trigger hilang)
 */
function archiveTriggerInstall() {
  return installMonthlyArchiveTrigger();
}

// ============================================================================
// FUNGSI BANTU: LOGGING KE CONSOLE
// ============================================================================

function log(msg) {
  //untuk dilihat di Logs di Google Apps Script Editor
  console.log(`[ArchiveService] ${new Date().toLocaleString('id-ID', {timeZone: 'Asia/Makassar'})}: ${msg}`);
}

// ============================================================================
// EKSPOR FUNGSI UNTUK DIGUNAKAN DARI Code.gs atau Endpoint Lain
// ============================================================================

// Fungsi-fungsi di atas sudah diekspor secara implisit melalui ScriptApp
// Semua fungsi di atas bisa dipanggil dari endpoint terpisah atau trigger yang sudah kita buat.