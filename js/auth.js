/**
 * auth.js
 * ---------------------------------------------------------------------------
 * Manajemen sesi, Modal Login, hashing PIN SHA-256, guard role & gudang.
 *
 * Sesi disimpan pada sessionStorage (hilang saat tab ditutup). Token asli
 * berasal dari AuthService.gs dan berlaku 8 jam di server.
 */

(function (global) {
  'use strict';

  var WMS = global.WMS = global.WMS || {};
  var CONFIG = WMS.config || global.WMS_CONFIG || {};
  var SESSION_KEY = CONFIG.SESSION_KEY || 'wms.session.v1';

  var session = null;
  var initialized = false;
  var authPrompted = false;

  function readSession() {
    try {
      var raw = global.sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !parsed.token || !parsed.user) return null;
      return parsed;
    } catch (error) {
      return null;
    }
  }

  function writeSession(value) {
    try {
      global.sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
    } catch (error) {
      // sessionStorage bisa diblokir oleh mode privasi; sesi tetap hidup di memori.
    }
  }

  function clearStoredSession() {
    try {
      global.sessionStorage.removeItem(SESSION_KEY);
    } catch (error) {
      // abaikan
    }
  }

  function syncBodyModalState() {
    var open = document.querySelectorAll('.modal-backdrop.is-open');
    document.body.classList.toggle('modal-open', open.length > 0);
  }

  function loginBackdrop() {
    return document.getElementById('login-backdrop');
  }

  function setLoginError(message) {
    var box = document.getElementById('login-error');
    if (!box) return;
    if (message) {
      box.textContent = message;
      box.hidden = false;
    } else {
      box.textContent = '';
      box.hidden = true;
    }
  }

  function showLogin(message) {
    var backdrop = loginBackdrop();
    document.body.classList.add('auth-gate');
    document.body.classList.remove('is-authenticated');
    if (!backdrop) return;
    backdrop.classList.add('is-open');
    backdrop.setAttribute('aria-hidden', 'false');
    setLoginError(message || '');
    syncBodyModalState();
    var input = document.getElementById('login-username');
    if (input) global.setTimeout(function () { input.focus(); }, 80);
  }

  function hideLogin() {
    var backdrop = loginBackdrop();
    if (backdrop) {
      backdrop.classList.remove('is-open');
      backdrop.setAttribute('aria-hidden', 'true');
    }
    setLoginError('');
    syncBodyModalState();
  }

  function initials(name) {
    var parts = String(name || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return 'WM';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function roleLabel(role) {
    var value = String(role || '').toUpperCase();
    if (value === 'SUPERVISOR') return 'Supervisor';
    if (value === 'SPV') return 'SPV';
    if (value === 'HOD') return 'Head of Department';
    if (value === 'STAFF') return 'Staff';
    return value || 'Pengguna';
  }

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function applySessionToUi() {
    var user = session && session.user ? session.user : {};
    var role = String(user.role || '').toUpperCase();
    var name = user.namaLengkap || user.username || 'Pengguna';
    var rank = (CONFIG.ROLE_RANK || {})[role] || 0;

    document.body.classList.add('is-authenticated');
    document.body.classList.remove('auth-gate');

    setText('user-name', name);
    setText('user-role', roleLabel(role));
    setText('user-initials', initials(name));
    setText('sidebar-user-name', name);
    setText('sidebar-user-role', roleLabel(role) + ' · ' + (user.username || '-'));

    var switchBtn = document.getElementById('switch-warehouse');
    if (switchBtn) {
      var canSwitch = String(user.aksesGudang || '').toUpperCase() === 'ALL';
      switchBtn.hidden = !canSwitch;
      switchBtn.setAttribute('aria-hidden', canSwitch ? 'false' : 'true');
    }

    document.querySelectorAll('[data-requires-role]').forEach(function (el) {
      var required = String(el.getAttribute('data-requires-role') || '').toUpperCase();
      var requiredRank = (CONFIG.ROLE_RANK || {})[required] || 0;
      var allowed = !required || rank >= requiredRank;
      el.hidden = !allowed;
      el.setAttribute('aria-hidden', allowed ? 'false' : 'true');
    });

    // Keep the users tab available to supervisors; role visibility must not
    // disable its button or alter pointer handling.
    var usersTab = document.querySelector('.sidebar__nav [data-module="users"]');
    if (usersTab) {
      var canManageUsers = role === 'SUPERVISOR';
      usersTab.hidden = !canManageUsers;
      usersTab.disabled = false;
      usersTab.removeAttribute('disabled');
      usersTab.setAttribute('aria-hidden', canManageUsers ? 'false' : 'true');
      usersTab.style.removeProperty('pointer-events');
    }

    WMS.session = session;
  }

  function resetUiForLogout() {
    document.body.classList.remove('is-authenticated');
    setText('user-name', '—');
    setText('user-role', '—');
    setText('user-initials', 'WM');
    setText('sidebar-user-name', 'Belum login');
    setText('sidebar-user-role', 'Silakan masuk kembali');
    var switchBtn = document.getElementById('switch-warehouse');
    if (switchBtn) switchBtn.hidden = true;
    document.querySelectorAll('[data-requires-role]').forEach(function (el) {
      el.hidden = true;
    });
    var usersTab = document.querySelector('.sidebar__nav [data-module="users"]');
    if (usersTab) {
      usersTab.disabled = false;
      usersTab.removeAttribute('disabled');
      usersTab.style.removeProperty('pointer-events');
    }
  }

  async function sha256Hex(text) {
    if (!global.crypto || !global.crypto.subtle || typeof global.TextEncoder === 'undefined') {
      throw new Error('Browser tidak mendukung Web Crypto API. Gunakan browser modern dan koneksi HTTPS.');
    }
    var bytes = new TextEncoder().encode(text);
    var digest = await global.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map(function (byte) { return byte.toString(16).padStart(2, '0'); })
      .join('');
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    if (busy) {
      if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
      button.disabled = true;
      button.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>' + (label || 'Memproses…') + '</span>';
    } else {
      button.disabled = false;
      if (button.dataset.originalHtml) {
        button.innerHTML = button.dataset.originalHtml;
        delete button.dataset.originalHtml;
      }
    }
  }

  function toast(message, tone) {
    if (WMS.ui && typeof WMS.ui.toast === 'function') WMS.ui.toast(message, tone || 'info');
  }

  async function performLogin(event) {
    event.preventDefault();
    setLoginError('');

    var usernameEl = document.getElementById('login-username');
    var pinEl = document.getElementById('login-pin');
    var submitEl = document.getElementById('login-submit');
    var username = String((usernameEl && usernameEl.value) || '').trim();
    var pin = String((pinEl && pinEl.value) || '');

    if (!username) {
      setLoginError('Username wajib diisi.');
      if (usernameEl) usernameEl.focus();
      return;
    }

    if (!pin) {
      setLoginError('PIN / Password wajib diisi.');
      if (pinEl) pinEl.focus();
      return;
    }

    if (!WMS.warehouseCode || !WMS.entity) {
      setLoginError('Halaman ini tidak memiliki identitas gudang yang valid.');
      return;
    }

    setBusy(submitEl, true, 'Memverifikasi…');

    try {
      var pinHash = await sha256Hex(pin);
      var data = await WMS.api.request(
        'LOGIN',
        {
          username: username,
          pinHash: pinHash,
          targetWarehouse: WMS.warehouseCode
        },
        { skipAuth: true, timeout: 45000 }
      );

      if (!data || !data.token || !data.user) {
        throw new Error('Respons login tidak lengkap. Hubungi administrator.');
      }

      var expiresIn = Number(data.expiresIn) || 28800;
      session = {
        token: data.token,
        user: {
          idUser: data.user.idUser || '',
          username: data.user.username || username,
          namaLengkap: data.user.namaLengkap || data.user.username || username,
          role: String(data.user.role || '').toUpperCase(),
          aksesGudang: String(data.user.aksesGudang || '').toUpperCase()
        },
        warehouse: WMS.warehouseCode,
        issuedAtMs: Date.now(),
        expiresAtMs: Date.now() + (expiresIn * 1000)
      };

      var access = session.user.aksesGudang;
      if (access !== 'ALL' && access !== WMS.warehouseCode) {
        session = null;
        throw new Error('Anda tidak memiliki hak akses untuk Gudang ini');
      }

      writeSession(session);
      authPrompted = false;
      if (pinEl) pinEl.value = '';
      applySessionToUi();
      hideLogin();
      WMS.api.updateConnection('online', 'API terhubung');
      toast('Selamat datang, ' + (session.user.namaLengkap || username) + '.', 'success');

      document.dispatchEvent(new CustomEvent('wms:session', { detail: { session: session } }));
    } catch (error) {
      setLoginError(error && error.message ? error.message : 'Login gagal. Coba lagi.');
      if (WMS.api && WMS.api.isAuthError(error)) {
        WMS.api.updateConnection('online');
      }
    } finally {
      setBusy(submitEl, false);
    }
  }

  function handleUnauthorized(message) {
    if (authPrompted) return;
    authPrompted = true;
    session = null;
    clearStoredSession();
    resetUiForLogout();

    var dynamicModals = document.querySelectorAll('#modal-root .modal-backdrop.is-open');
    dynamicModals.forEach(function (backdrop) {
      var closeBtn = backdrop.querySelector('[data-modal-close]');
      if (closeBtn) closeBtn.click();
    });

    showLogin(message || 'Sesi Anda telah berakhir. Silakan login kembali.');
    document.dispatchEvent(new CustomEvent('wms:logout', { detail: { reason: 'expired' } }));
  }

  async function logout() {
    var current = session;
    session = null;
    clearStoredSession();
    resetUiForLogout();

    if (current && current.token) {
      try {
        await WMS.api.request('LOGOUT', {}, { timeout: 12000 });
      } catch (error) {
        // Logout lokal tetap berhasil walau server tidak terjangkau.
      }
    }

    WMS.api.updateConnection('idle');
    showLogin('');
    document.dispatchEvent(new CustomEvent('wms:logout', { detail: { reason: 'manual' } }));
  }

  function switchWarehouse() {
    if (!session) return;
    var access = String((session.user && session.user.aksesGudang) || '').toUpperCase();
    if (access !== 'ALL') {
      toast('Akun Anda tidak memiliki akses ke kedua gudang.', 'warning');
      return;
    }
    var other = WMS.warehouseCode === 'EPIC' ? WMS.warehouses.GEA : WMS.warehouses.EPIC;
    if (!other) return;
    var hash = global.location.hash || '';
    global.location.href = other.page + hash;
  }

  function togglePinVisibility(button) {
    var input = document.getElementById('login-pin');
    if (!input) return;
    var showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    button.textContent = showing ? 'Lihat' : 'Sembunyikan';
    button.setAttribute('aria-label', showing ? 'Tampilkan PIN' : 'Sembunyikan PIN');
  }

  function bindEvents() {
    var form = document.getElementById('login-form');
    if (form) form.addEventListener('submit', performLogin);

    var toggle = document.getElementById('toggle-pin');
    if (toggle) toggle.addEventListener('click', function () { togglePinVisibility(toggle); });

    var logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', function () { logout(); });

    var switchBtn = document.getElementById('switch-warehouse');
    if (switchBtn) switchBtn.addEventListener('click', switchWarehouse);
  }

  function init() {
    if (!initialized) {
      initialized = true;
      bindEvents();
    }

    var stored = readSession();
    session = null;

    if (!stored) {
      resetUiForLogout();
      showLogin('');
      return false;
    }

    if (!stored.expiresAtMs || Number(stored.expiresAtMs) <= Date.now()) {
      clearStoredSession();
      resetUiForLogout();
      showLogin('Sesi sebelumnya telah berakhir. Silakan login kembali.');
      return false;
    }

    var access = String((stored.user && stored.user.aksesGudang) || '').toUpperCase();

    if (!WMS.warehouseCode || (access !== 'ALL' && access !== WMS.warehouseCode)) {
      clearStoredSession();
      resetUiForLogout();
      showLogin('Anda tidak memiliki hak akses untuk Gudang ini');
      return false;
    }

    stored.warehouse = WMS.warehouseCode;
    session = stored;
    writeSession(session);
    authPrompted = false;
    applySessionToUi();
    hideLogin();

    document.dispatchEvent(new CustomEvent('wms:session', { detail: { session: session } }));
    return true;
  }

  WMS.auth = {
    init: init,
    getSession: function () { return session; },
    getRole: function () { return (session && session.user && session.user.role) || null; },
    isSupervisor: function () { return String((session && session.user && session.user.role) || '').toUpperCase() === 'SUPERVISOR'; },
    isSoApprover: function () { var role = String((session && session.user && session.user.role) || '').toUpperCase(); return role === 'SUPERVISOR' || role === 'SPV' || role === 'HOD'; },
    canAccessWarehouse: function (code) {
      if (!session) return false;
      var access = String((session.user && session.user.aksesGudang) || '').toUpperCase();
      return access === 'ALL' || access === String(code || '').toUpperCase();
    },
    showLogin: showLogin,
    hideLogin: hideLogin,
    logout: logout,
    handleUnauthorized: handleUnauthorized,
    hashPin: sha256Hex
  };
})(window);
