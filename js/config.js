/**
 * config.js
 * ---------------------------------------------------------------------------
 * Konfigurasi tunggal frontend WMS Terpadu CV EPIC & PT GEA.
 * File ini dimuat pertama kali dan tidak melakukan request jaringan.
 */

(function (global) {
  'use strict';

  var API_URL = 'https://script.google.com/macros/s/AKfycbznLUopfEd6ava4S7mqg6sh4p50TjqErEjG_7zjGmvP17nUaIR4Vd8NLbBbALDpU-hB/exec';
  var MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
  var MASTER_CACHE_TTL = 12 * 60 * 60 * 1000; // 12 jam

  var WAREHOUSES = {
    EPIC: {
      code: 'EPIC',
      name: 'Gudang CV EPIC',
      company: 'CV EPIC',
      short: 'EPIC',
      theme: 'epic',
      accent: '#EA580C',
      logo: 'assets/img/logo-epic.png',
      page: 'cv-epic.html'
    },
    GEA: {
      code: 'GEA',
      name: 'Gudang PT GEA',
      company: 'PT GEA',
      short: 'GEA',
      theme: 'gea',
      accent: '#065F46',
      logo: 'assets/img/logo-gea.png',
      page: 'pt-gea.html'
    }
  };

  var MODULES = [
    { id: 'inbound', label: 'Inbound', caption: 'Putaway penerimaan', requiresRole: null },
    { id: 'outbound', label: 'Outbound', caption: 'Picking, dispatch & OTD', requiresRole: null },
    { id: 'inventory', label: 'Inventory & Transfer', caption: 'Stok, kartu stok & mutasi', requiresRole: null },
    { id: 'procurement', label: 'Pengajuan Order', caption: 'Pengajuan & surat kesepakatan', requiresRole: null },
    { id: 'opname', label: 'Stock Opname', caption: 'Approval supervisor', requiresRole: 'SUPERVISOR' }
  ];

  var initialWarehouse = '';
  try {
    initialWarehouse = String((global.document && global.document.body && global.document.body.dataset.warehouse) || '')
      .trim()
      .toUpperCase();
  } catch (error) {
    initialWarehouse = '';
  }

  var CONFIG = {
    API_URL: API_URL,
    MAX_FILE_SIZE: MAX_FILE_SIZE,
    MASTER_CACHE_TTL: MASTER_CACHE_TTL,
    SESSION_KEY: 'wms.session.v1',
    MASTER_CACHE_KEY: 'wms.master.v1',
    REQUEST_TIMEOUT: 60 * 1000,
    UPLOAD_TIMEOUT: 120 * 1000,
    LOW_STOCK_THRESHOLD: 10,
    ROLE_RANK: { STAFF: 1, SUPERVISOR: 2 },
    STORAGE_PREFIX: 'wms.'
  };

  var WMS = global.WMS = global.WMS || {};
  WMS.config = CONFIG;
  WMS.warehouses = WAREHOUSES;
  WMS.modules = MODULES;
  WMS.warehouseCode = initialWarehouse;
  WMS.entity = WAREHOUSES[initialWarehouse] || null;

  // Alias global agar konstanta mudah dikonsumsi dari console / skrip lain.
  global.API_URL = API_URL;
  global.MAX_FILE_SIZE = MAX_FILE_SIZE;
  global.MASTER_CACHE_TTL = MASTER_CACHE_TTL;
  global.WMS_CONFIG = CONFIG;
})(window);
