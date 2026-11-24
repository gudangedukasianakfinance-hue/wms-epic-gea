(function (global) {
  'use strict';
  var KEY = 'wms.theme';
  function apply(theme) {
    theme = theme === 'dark' ? 'dark' : 'light';
    if (global.document) global.document.documentElement.setAttribute('data-theme', theme);
    try { global.localStorage.setItem(KEY, theme); } catch (e) {}
    global.document && global.document.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
      button.textContent = theme === 'dark' ? '☀️' : '🌙';
      button.setAttribute('aria-label', theme === 'dark' ? 'Gunakan tema terang' : 'Gunakan tema gelap');
    });
    return theme;
  }
  var initial = 'light';
  try { initial = global.localStorage.getItem(KEY) || 'light'; } catch (e) {}
  apply(initial);
  global.WMSTheme = {
    get: function () { return global.document.documentElement.getAttribute('data-theme') || 'light'; },
    set: apply,
    toggle: function () { return apply(this.get() === 'dark' ? 'light' : 'dark'); },
    bind: function () { global.document.querySelectorAll('[data-theme-toggle]').forEach(function (button) { button.onclick = function () { global.WMSTheme.toggle(); }; }); }
  };
  if (global.document) global.document.addEventListener('DOMContentLoaded', global.WMSTheme.bind);
})(window);
