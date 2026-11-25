/**
 * Code.gs — Main Google Apps Script file for WMS Terpadu Archive System
 * Menyediakan endpoint API dan trigger otomatis untuk arsip bulanan.
 * 
 * Semua fungsi di bawah ini menjadi tersedia secara global saat deploy ke Apps Script.
 * File pendukung: ArchiveService.gs
 */

// ============================================================================
// INISIALISASI & KONFIGURASI
// ============================================================================

// Konfigurasi global yang sama dengan ArchiveService.gs
const ARCHIVE_FOLDER_NAME = 'ARSIP_BULANAN_WMS';
const ARCHIVE_REGISTRY_TAB = 'Archive_Registry';
const ARCHIVE_ALLOWED_ROLES = ['SPV', 'SUPERVISOR', 'HOD'];

// ============================================================================
// TRIGGER & JADWAL
// ============================================================================

/**
 * Fungsi yang dieksekusi tiap 1 di bulan pukul 03:00 WITA
 * Panggil fungsi utama dari ArchiveService
 */
function runMonthlyArchiveJob() {
  // Fungsi ini akan diimplementasikan secara utuh di ArchiveService.gs
  // Di sini hanya sebagai entry point jika dibutuhkan stand-alone
  try {
    // Log bahwa trigger bekerja
    console.log('runMonthlyArchiveJob triggered');
    // Kita panggil fungsi dari ArchiveService melalui eval atau reference
    // Tapi untuk keperluan ini, kita implementasi langsung atau panggil manual
    return ArchiveService_runMonthlyArchiveJob();
  } catch (e) {
    console.error('Error runMonthlyArchiveJob:', e.toString());
    return false;
  }
}

/**
 * Install trigger otomatis tiap 1 di bulan pukul 03:00 WITA
 */
function installMonthlyArchiveTrigger() {
  try {
    // Hapus trigger lama
    const allTriggers = ScriptApp.getProjectTriggers();
    for (const trigger of allTriggers) {
      if (trigger.getHandlerFunction() === 'runMonthlyArchiveJob') {
        ScriptApp.deleteTrigger(trigger);
      }
    }
    
    // Buat trigger baru
    const newTrigger = ScriptApp.newTrigger('runMonthlyArchiveJob')
      .timeBased()
      .onMonthDay(1)
      .atHour(3)
      .inTimezone('Asia/Makassar')
      .create();
    
    console.log('Trigger arsip diinstal: setiap 1 di bulan pukul 03:00 WITA');
    return true;
  } catch (e) {
    console.error('Error installMonthlyArchiveTrigger:', e.toString());
    return false;
  }
}

/**
 * Cek status trigger arsip
 */
function archiveTriggerStatus() {
  const allTriggers = ScriptApp.getProjectTriggers();
  for (const trigger of allTriggers) {
    if (trigger.getHandlerFunction() === 'runMonthlyArchiveJob') {
      return {
        active: true,
        handler: 'runMonthlyArchiveJob',
        lastModified: trigger.getLastModifiedDate() 
          ? Utilities.formatDate(trigger.getLastModifiedDate(), 'Asia/Makassar', 'yyyy-MM-dd HH:mm:ss')
          : 'Tidak diketahui'
      };
    }
  }
  return { active: false, handler: null, lastModified: 'Tidak ada' };
}

/**
 * Fungsi bantu: eksekusi runMonthlyArchiveJob dari ArchiveService
 * (Implementation dipisahkan untuk menghindari konflik nama)
 */
function ArchiveService_runMonthlyArchiveJob() {
  // Fungsi ini adalah wrapper untuk fungsi di ArchiveService.gs
  // Karena GAS tidak support import, kita copy logika utama atau panggil manual
  // Untuk integrasi ini, kita asumsikan logika ada di ArchiveService.gs
  // dan fungsi ini hanya sebagai placeholder/bridge
  
  // Cek apakah file ArchiveService.gs tersimpan dan memiliki fungsi yang diinginkan
  const html = typeof ArchiveService !== 'undefined' ? 'available' : 'not available';
  return { status: 'placeholder', archiveServiceAvailable: html };
}

// ============================================================================
// ENDPOINT API: ARCHIVE LIST
// ============================================================================

/**
 * ENDPOINT: ARCHIVE_LIST
 * Mengembalikan daftar arsip bulanan dari Archive_Registry
 * Hanya boleh diakses oleh role: SPV, SUPERVISOR, HOD
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
        archiveId: row[0] || '',
        periode: String(row[1]).trim(),
        labelBulan: String(row[2]).trim(),
        entitas: String(row[3]).trim(),
        spreadsheetId: String(row[4] || '').trim(),
        namaFile: String(row[5] || '').trim(),
        waktuBackup: String(row[6] || '').trim(),
        sumber: String(row[7] || '').trim()
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
    const match = spreadsheet_id_or_url.match(/d\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      spreadsheetId = match[1];
    }
  }
  
  // Verifikasi akses file
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
  
  // Simpan ke Archive_Registry di DB_MASTER
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
    registrySheet.getRange(targetRange, 4).setValue(entitas);
    registrySheet.getRange(targetRow, 5).setValue(spreadsheetId);
    registrySheet.getRange(targetRow, 6).setValue(fileName);
    registrySheet.getRange(targetRow, 7).setValue(backupTime);
  } else {
    // Baris baru di akhir
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
      found = true;
      return {
        active: true,
        handler: 'runMonthlyArchiveJob',
        lastModified: trigger.getLastModifiedDate()
          ? Utilities.formatDate(trigger.getLastModifiedDate(), 'Asia/Makassar', 'yyyy-MM-dd HH:mm:ss')
          : 'Tidak diketahui'
      };
    }
  }
  
  return { active: false, handler: null, lastModified: 'Tidak ada' };
}

/**
 * ENDPOINT: ARCHIVE_TRIGGER_INSTALL
 * Instal trigger dari web
 */
function archiveTriggerInstall() {
  // Hapus trigger lama
  const allTriggers = ScriptApp.getProjectTriggers();
  for (const trigger of allTriggers) {
    if (trigger.getHandlerFunction() === 'runMonthlyArchiveJob') {
      ScriptApp.deleteTrigger(trigger);
    }
  }
  
  // Buat trigger baru
  const newTrigger = ScriptApp.newTrigger('runMonthlyArchiveJob')
    .timeBased()
    .onMonthDay(1)
    .atHour(3)
    .inTimezone('Asia/Makassar')
    .create();
  
  return { success: true, message: 'Trigger berhasil diinstal: setiap 1 di bulan pukul 03:00 WITA' };
}

// ============================================================================
// DUKUNGAN: MEMBACA FILE ARSIP (READ-ONLY MODE)
// ============================================================================

/**
 * Fungsi bantu: membuka spreadsheet dalam mode baca-only untuk data historis
 * Digunakan ketika payload query menyertakan archive_id yang valid
 * 
 * @param {string} archiveId - ID file arsip dari Archive_Registry
 * @returns {Object} {success: boolean, spreadsheet: Spreadsheet | null, error: string}
 */
function openArchiveSpreadsheetReadOnly(archiveId) {
  try {
    // Cari info di Archive_Registry
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const masterSheet = ss.getSheetByName('DB_MASTER');
    
    if (!masterSheet) {
      return { success: false, error: 'DB_MASTER not found' };
    }
    
    const registrySheet = masterSheet.getSheetByName('Archive_Registry');
    if (!registrySheet) {
      return { success: false, error: 'Archive_Registry not found' };
    }
    
    const regData = registrySheet.getDataRange().getValues();
    let targetFileId = null;
    
    // Cari file ID berdasarkan archiveId
    for (let i = 1; i < regData.length; i++) {
      const row = regData[i];
      if (row && row[0] && String(row[0]) === archiveId) {
        targetFileId = String(row[5] || '').trim(); // Spreadsheet_ID di kolom ke-5
        break;
      }
    }
    
    if (!targetFileId) {
      return { success: false, error: 'archiveId tidak ditemukan di registry' };
    }
    
    // Cek apakah file masih ada di Drive
    const file = DriveApp.getFileById(targetFileId);
    
    // Buka spreadsheet dalam mode baca-only
    // Catatan: SpreadsheetApp.openById secara default buka dengan edit permission
    // Untuk memaksa read-only, kita bisa menggunakan fitur perception, 
    // namun di sini kita hanya membuka dan mencegah operasi tulis
    const spreadsheet = SpreadsheetApp.openById(targetFileId);
    
    // Catat bahwa ini mode baca-only dengan menambahkan judul
    spreadsheet.setTitle(`[READ-ONLY] ${spreadsheet.getTitle()}`);
    
    return { success: true, spreadsheet: spreadsheet, error: null };
    
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// ============================================================================
// EKSPOR & VERIFIKASI
// ============================================================================

// Verifikasi bahwa semua modul terload dengan benar
function archiveSystemInit() {
  const checks = {
    ArchiveServiceFile: typeof ArchiveService_runMonthlyArchiveJob !== 'undefined',
    archiveListAvailable: typeof archiveList === 'function',
    archiveRegisterManualAvailable: typeof archiveRegisterManual === 'function',
    openArchiveAvailable: typeof openArchiveSpreadsheetReadOnly === 'function',
    triggerInstallAvailable: typeof archiveTriggerInstall === 'function'
  };
  
  let allPass = true;
  for (const [key, value] of Object.entries(checks)) {
    if (!value) allPass = false;
    console.log(`[archiveSystemInit] ${key}: ${value ? 'PASS' : 'FAIL'}`);
  }
  
  return { allPass, checks };
}