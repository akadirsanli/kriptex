/* ==========================================================================
   tabs/settings-tab.js — themes and fx preferences (persisted locally)
   ========================================================================== */
'use strict';

KX.tabs = KX.tabs || {};

KX.tabs.settings = (() => {
    const U = KX.utils;

    function applyTheme(theme, notify) {
        document.documentElement.setAttribute('data-theme', theme);
        document.querySelectorAll('.theme-btn').forEach((b) =>
            b.classList.toggle('active', b.dataset.theme === theme));
        localStorage.setItem('kriptex-theme', theme);
        KX.fx.readThemeColors();
        if (notify) U.toast('Theme: ' + theme, 'info');
    }

    function init() {
        applyTheme(localStorage.getItem('kriptex-theme') || 'fsociety', false);

        document.querySelectorAll('.theme-btn').forEach((btn) => {
            btn.addEventListener('click', () => applyTheme(btn.dataset.theme, true));
        });

        const fxToggle = U.$('fx-toggle');
        fxToggle.checked = KX.fx.isEnabled();
        fxToggle.addEventListener('change', () => {
            KX.fx.setEnabled(fxToggle.checked);
            localStorage.setItem('kriptex-fx', fxToggle.checked ? 'on' : 'off');
            U.toast(fxToggle.checked ? 'Visual fx enabled.' : 'Visual fx disabled — quiet mode.', 'info');
        });
    }

    return { init };
})();
