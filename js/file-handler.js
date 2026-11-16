/**
 * file-handler.js
 * ---------------------------------------------------------------------------
 * Validasi berkas PDF di sisi klien dan konversi ke Base64 bersih.
 *
 * Aturan mutlak (SPEC bagian 6B):
 *   - MIME type wajib "application/pdf"
 *   - Ukuran maksimal 5 MB
 *   - String Base64 yang dikirim tidak boleh mengandung prefix data URL
 */

(function (global) {
  'use strict';

  var WMS = global.WMS = global.WMS || {};
  var CONFIG = WMS.config || global.WMS_CONFIG || {};
  var MAX = CONFIG.MAX_FILE_SIZE || (5 * 1024 * 1024);
  var PDF_MIME = 'application/pdf';

  function formatSize(bytes) {
    var size = Number(bytes) || 0;
    if (size < 1024) return size + ' B';
    if (size < 1024 * 1024) return (size / 1024).toFixed(1).replace('.0', '') + ' KB';
    return (size / (1024 * 1024)).toFixed(2).replace('.00', '') + ' MB';
  }

  function validate(file) {
    if (!file) {
      throw new Error('Lampiran PDF wajib diunggah.');
    }

    if (file.type !== PDF_MIME) {
      throw new Error('Format berkas wajib PDF (MIME application/pdf).');
    }

    if (!(file.size > 0)) {
      throw new Error('Berkas PDF kosong atau tidak dapat dibaca.');
    }

    if (file.size > MAX) {
      throw new Error('Ukuran berkas ' + formatSize(file.size) + ' melebihi batas 5 MB.');
    }

    if (file.name && !/\.pdf$/i.test(file.name)) {
      throw new Error('Ekstensi berkas wajib .pdf.');
    }

    return true;
  }

  function toBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var result = String(reader.result || '');
        var comma = result.indexOf(',');
        var base64 = comma >= 0 ? result.slice(comma + 1) : result;
        base64 = base64.replace(/\s+/g, '');
        if (!base64) {
          reject(new Error('Gagal mengubah berkas menjadi Base64.'));
          return;
        }
        resolve(base64);
      };
      reader.onerror = function () {
        reject(new Error('Berkas tidak dapat dibaca. Coba unggah ulang.'));
      };
      reader.readAsDataURL(file);
    });
  }

  async function prepare(file) {
    validate(file);
    var base64 = await toBase64(file);
    return {
      base64: base64,
      fileName: file.name || 'LAMPIRAN.pdf',
      mimeType: file.type,
      size: file.size,
      sizeLabel: formatSize(file.size)
    };
  }

  WMS.file = {
    PDF_MIME: PDF_MIME,
    MAX_FILE_SIZE: MAX,
    validate: validate,
    toBase64: toBase64,
    prepare: prepare,
    formatSize: formatSize
  };
})(window);
