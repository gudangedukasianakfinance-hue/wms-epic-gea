/**
 * api.js
 * ---------------------------------------------------------------------------
 * Fetch wrapper untuk Google Apps Script Web App.
 *
 * - Selalu POST dengan Content-Type "text/plain;charset=utf-8" agar request
 *   dianggap simple request dan tidak memicu preflight CORS di GAS.
 * - Token sesi & kode warehouse otomatis disisipkan pada setiap request
 *   kecuali LOGIN.
 * - Body response GAS selalu HTTP 200, sehingga field `code` pada JSON adalah
 *   status otoritatif. `code === 401` memicu auto-logout.
 */

(function (global) {
  'use strict';

  var WMS = global.WMS = global.WMS || {};
  var CONFIG = WMS.config || global.WMS_CONFIG || {};

  var connection = { state: 'idle', message: '' };

  function isAuthError(error) {
    return !!(error && (error.code === 401 || error.code === 403));
  }

  function updateConnection(state, message) {
    connection.state = state || 'idle';
    connection.message = message || '';

    var el = document.getElementById('api-status');
    if (!el) return;

    el.setAttribute('data-api-status', connection.state);
    var label = el.querySelector('.api-status__label');
    var text = message || ({
      idle: 'Menunggu login',
      checking: 'Menghubungkan API…',
      online: 'API terhubung',
      offline: 'API tidak terjangkau'
    }[connection.state] || 'Status API');

    if (label) label.textContent = text;
    el.setAttribute('title', text);
  }

  function getSession() {
    if (WMS.auth && typeof WMS.auth.getSession === 'function') {
      return WMS.auth.getSession();
    }
    return null;
  }

  function resolveWarehouse(session) {
    return (session && session.warehouse) || WMS.warehouseCode || '';
  }

  function buildPayload(action, params, options) {
    var payload = Object.assign({ action: String(action || '').trim().toUpperCase() }, params || {});
    var session = getSession();
    var skipAuth = options && options.skipAuth === true;

    if (!skipAuth) {
      if (session && session.token) payload.token = session.token;
      payload.warehouse = (options && options.warehouse) || resolveWarehouse(session);
    } else if (options && options.warehouse) {
      payload.warehouse = options.warehouse;
    }

    return payload;
  }

  function friendlyNetworkError(error) {
    if (error && error.name === 'AbortError') {
      return new Error('Permintaan melebihi batas waktu. Periksa koneksi lalu coba lagi.');
    }
    return new Error('Tidak dapat menghubungi server WMS. Periksa koneksi internet Anda lalu coba lagi.');
  }

  async function request(action, params, options) {
    var opts = options || {};
    var payload = buildPayload(action, params, opts);
    var retryCount = 0;
    var maxRetries = 2;

    function isRetryable(error) {
      var message = String(error && error.message || '');
      return !!(error && (Number(error.code) === 409 || Number(error.code) === 503)) ||
        /sedang diproses|coba lagi beberapa saat/i.test(message);
    }

    async function sendWithRetry() {
      try {
        return await sendRequestOnce(payload, opts);
      } catch (error) {
        if (retryCount >= maxRetries || !isRetryable(error)) throw error;
        retryCount++;
        await new Promise(function (resolve) { global.setTimeout(resolve, 1500); });
        return sendWithRetry();
      }
    }

    return sendWithRetry();
  }

  async function sendRequestOnce(payload, opts) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timeout = opts.timeout || CONFIG.REQUEST_TIMEOUT || 60000;
    var timer = null;

    if (controller) {
      timer = global.setTimeout(function () { controller.abort(); }, timeout);
    }

    if (!connection.lastState || connection.state === 'idle') {
      updateConnection('checking');
    }

    var response;
    try {
      response = await fetch(CONFIG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        redirect: 'follow',
        cache: 'no-store',
        signal: controller ? controller.signal : undefined
      });
    } catch (error) {
      if (timer) global.clearTimeout(timer);
      updateConnection('offline');
      throw friendlyNetworkError(error);
    }

    if (timer) global.clearTimeout(timer);

    var raw = '';
    try {
      raw = await response.text();
    } catch (error) {
      updateConnection('offline');
      throw new Error('Respons server tidak dapat dibaca.');
    }

    var body = null;
    try {
      body = JSON.parse(raw);
    } catch (error) {
      updateConnection('offline');
      throw new Error(
        'Respons server bukan JSON. Pastikan API_URL menunjuk ke deployment Web App GAS yang aktif (akses: Anyone).'
      );
    }

    if (!body || typeof body !== 'object' || !body.status) {
      updateConnection('offline');
      throw new Error('Format respons API tidak dikenali.');
    }

    var code = Number(body.code) || 200;
    var isLoginRequest = payload.action === 'LOGIN';

    if (code === 401 && !isLoginRequest) {
      updateConnection('offline', 'Sesi berakhir');
      if (WMS.auth && typeof WMS.auth.handleUnauthorized === 'function') {
        WMS.auth.handleUnauthorized(body.message || 'Sesi Anda telah berakhir. Silakan login kembali.');
      }
      var authError = new Error(body.message || 'Sesi tidak valid. Silakan login kembali.');
      authError.code = 401;
      throw authError;
    }

    if (body.status !== 'success' || code >= 400) {
      updateConnection('online');
      var appError = new Error(body.message || 'Permintaan gagal diproses.');
      appError.code = code;
      appError.data = body.data === undefined ? null : body.data;
      throw appError;
    }

    updateConnection('online');
    return body.data;
  }

  WMS.api = {
    request: request,
    isAuthError: isAuthError,
    updateConnection: updateConnection,
    getConnection: function () { return Object.assign({}, connection); }
  };
})(window);
