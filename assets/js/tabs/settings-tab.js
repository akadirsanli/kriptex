/* ==========================================================================
   tabs/settings-tab.js — themes and effect preferences (persisted locally)
   ========================================================================== */
'use strict';

KX.tabs = KX.tabs || {};

KX.tabs.settings = (() => {
    const U = KX.utils;

    /** Kept in sync with the palette in base.css; used for the browser chrome. */
    const THEME_COLORS = {
        fsociety: '#05080a',
        darkarmy: '#080507',
        ecorp: '#05070d',
        whiterose: '#f1f3f6'
    };

    function applyTheme(theme, notify) {
        const next = THEME_COLORS[theme] ? theme : 'fsociety';
        document.documentElement.setAttribute('data-theme', next);

        document.querySelectorAll('.theme-btn, .theme-dot').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.theme === next);
            btn.setAttribute('aria-pressed', btn.dataset.theme === next ? 'true' : 'false');
        });

        localStorage.setItem('kriptex-theme', next);

        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', THEME_COLORS[next]);

        KX.fx.readThemeColors();
        if (notify) U.toast('Theme: ' + next, 'info');
    }

    function init() {
        applyTheme(localStorage.getItem('kriptex-theme') || 'fsociety', false);

        document.querySelectorAll('.theme-btn, .theme-dot').forEach((btn) => {
            btn.addEventListener('click', () => applyTheme(btn.dataset.theme, true));
        });

        const fxToggle = U.$('fx-toggle');
        fxToggle.checked = KX.fx.isEnabled();
        fxToggle.addEventListener('change', () => {
            KX.fx.setEnabled(fxToggle.checked);
            localStorage.setItem('kriptex-fx', fxToggle.checked ? 'on' : 'off');
            U.toast(fxToggle.checked ? 'Ambient effects enabled.' : 'Ambient effects disabled — quiet mode.', 'info');
        });
    }

    return { init, applyTheme };
})();
