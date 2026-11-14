/* ==========================================================================
   main.js — tab router and application boot
   ========================================================================== */
'use strict';

(() => {
    const U = KX.utils;

    function showBootError(title, detail) {
        const box = U.$('boot-error');
        if (!box) {
            U.toast(title, 'error');
            return;
        }
        const heading = document.createElement('strong');
        heading.textContent = title;
        const body = document.createElement('p');
        body.textContent = detail;
        box.replaceChildren(heading, body);
        box.hidden = false;
        const shell = U.$('app-shell');
        if (shell) shell.hidden = true;
    }

    function initRouter() {
        const buttons = Array.from(document.querySelectorAll('.tab-btn'));

        const activate = (btn, updateHash) => {
            buttons.forEach((b) => {
                const active = b === btn;
                b.classList.toggle('active', active);
                b.setAttribute('aria-selected', active ? 'true' : 'false');
                b.tabIndex = active ? 0 : -1;
            });
            document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
            const panel = U.$('tab-' + btn.dataset.tab);
            if (panel) panel.classList.add('active');
            if (updateHash) {
                try {
                    if (history.replaceState) history.replaceState(null, '', '#' + btn.dataset.tab);
                } catch (e) { /* file:// or another locked-down context */ }
                window.scrollTo({ top: 0, behavior: 'auto' });
            }
        };

        buttons.forEach((btn, index) => {
            btn.setAttribute('role', 'tab');
            btn.setAttribute('aria-controls', 'tab-' + btn.dataset.tab);
            btn.setAttribute('aria-selected', btn.classList.contains('active') ? 'true' : 'false');
            btn.tabIndex = btn.classList.contains('active') ? 0 : -1;

            btn.addEventListener('click', () => activate(btn, true));

            btn.addEventListener('keydown', (event) => {
                const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
                if (!keys.includes(event.key)) return;
                event.preventDefault();
                let next = index;
                if (event.key === 'ArrowRight') next = (index + 1) % buttons.length;
                if (event.key === 'ArrowLeft') next = (index - 1 + buttons.length) % buttons.length;
                if (event.key === 'Home') next = 0;
                if (event.key === 'End') next = buttons.length - 1;
                activate(buttons[next], true);
                buttons[next].focus();
            });
        });

        // Deep links: /#vault opens the vault tab directly.
        const requested = (location.hash || '').replace(/^#/, '').trim();
        if (requested) {
            const match = buttons.find((btn) => btn.dataset.tab === requested);
            if (match) activate(match, false);
        }

        document.querySelectorAll('.tab-content').forEach((panel) => {
            panel.setAttribute('role', 'tabpanel');
        });
    }

    function checkEnvironment() {
        if (!window.isSecureContext || !globalThis.crypto || !crypto.subtle) {
            showBootError(
                'Secure context required',
                'The Web Crypto API is only available over HTTPS (or on localhost). ' +
                'Open this page over https:// or from a local server — do not use plain http://.'
            );
            return false;
        }
        if (typeof pako === 'undefined' || typeof CryptoJS === 'undefined') {
            showBootError(
                'Application files did not load',
                'The bundled compression or hashing library is missing. ' +
                'Re-download the project and verify it with assets/vendor/CHECKSUMS.txt.'
            );
            return false;
        }
        if (!KX.wordlist || !KX.wordlist.length) {
            showBootError(
                'Wordlist missing',
                'The passphrase wordlist did not load. Re-download the project.'
            );
            return false;
        }
        return true;
    }

    /** Dropzones are divs for layout reasons; make them keyboard-operable. */
    function initDropzones() {
        document.querySelectorAll('.dropzone').forEach((zone) => {
            zone.tabIndex = 0;
            zone.setAttribute('role', 'button');
            zone.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    zone.click();
                }
            });
        });
    }

    function boot() {
        if (!checkEnvironment()) return;

        KX.fx.init();
        initRouter();
        initDropzones();

        KX.tabs.encrypt.init();
        KX.tabs.file.init();
        KX.tabs.compress.init();
        KX.tabs.hash.init();
        KX.tabs.generator.init();
        KX.tabs.notes.init();
        KX.tabs.settings.init();
    }

    function start() {
        try {
            boot();
        } catch (err) {
            showBootError('Startup failed', String(err && err.message ? err.message : err));
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
