/* ==========================================================================
   tabs/text-tab.js — text encryption with selectable security profiles
   ========================================================================== */
'use strict';

KX.tabs = KX.tabs || {};

KX.tabs.encrypt = (() => {
    const U = KX.utils;
    let selectedLevel = 'advanced';

    function setBusy(btn, busy, busyLabel) {
        if (busy) {
            btn.dataset.orig = btn.innerHTML;
            btn.disabled = true;
            btn.textContent = busyLabel;
        } else {
            btn.disabled = false;
            if (btn.dataset.orig) btn.innerHTML = btn.dataset.orig;
        }
    }

    function renderLevelInfo() {
        const level = KX.crypto.LEVELS[selectedLevel];
        U.$('level-info').innerHTML =
            `<strong>[${level.name}]</strong> ${level.cipher} &middot; ${level.info}`;
    }

    function init() {
        const input = U.$('enc-input');
        const pass = U.$('enc-password');
        const pass2 = U.$('enc-pass2');
        const output = U.$('enc-output');

        input.addEventListener('input', () => {
            U.$('enc-char-count').textContent = U.formatCount(input.value.length);
        });

        pass.addEventListener('input', () => {
            U.renderStrength(U.$('strength-bar'), U.$('strength-text'), pass.value);
        });

        U.$('enc-pass-toggle').addEventListener('click', function () {
            const show = pass.type === 'password';
            pass.type = show ? 'text' : 'password';
            if (pass2) pass2.type = show ? 'text' : 'password';
            this.innerHTML = `<i class="fas ${show ? 'fa-eye-slash' : 'fa-eye'}"></i>`;
        });

        U.$('enc-pass-gen').addEventListener('click', () => {
            const generated = KX.generators.password(24, true, true, true, true);
            pass.value = generated;
            pass2.value = generated;
            pass.dispatchEvent(new Event('input'));
            U.toast('Strong passphrase generated into both fields.', 'info');
        });

        document.querySelectorAll('#level-grid .level-card').forEach((card) => {
            card.addEventListener('click', () => {
                document.querySelectorAll('#level-grid .level-card').forEach((c) => {
                    c.classList.remove('active');
                    c.setAttribute('aria-pressed', 'false');
                });
                card.classList.add('active');
                card.setAttribute('aria-pressed', 'true');
                selectedLevel = card.dataset.level;
                renderLevelInfo();
            });
        });
        renderLevelInfo();

        U.$('encrypt-btn').addEventListener('click', async () => {
            const text = input.value;
            if (!text) return U.toast('Enter some text first.', 'warning');
            if (!pass.value) return U.toast('Enter a passphrase.', 'warning');
            if (!pass2.value) return U.toast('Repeat the passphrase in the confirm field.', 'warning');
            if (pass.value !== pass2.value) return U.toast('Passphrases do not match.', 'error');
            if (typeof pako === 'undefined') return U.toast('Compression library failed to load.', 'error');

            const btn = U.$('encrypt-btn');
            const verify = U.$('enc-verify') ? U.$('enc-verify').checked : true;
            setBusy(btn, true, verify ? '[ sealing + verifying... ]' : '[ sealing... ]');
            try {
                const { result, stats } = await KX.crypto.encryptText(text, pass.value, selectedLevel);
                let verified = false;
                if (verify) verified = await KX.crypto.verifySeal(text, pass.value, selectedLevel);
                if (verify && !verified) throw new Error('verification failed');

                output.value = result;
                U.animateValue(U.$('stat-original'), stats.original, (v) => U.formatBytes(Math.round(v)));
                U.animateValue(U.$('stat-compressed'), stats.compressed, (v) => U.formatBytes(Math.round(v)));
                U.animateValue(U.$('stat-ratio'), parseFloat(stats.ratio), (v) => v.toFixed(1) + '%');
                U.animateValue(U.$('stat-time'), parseFloat(stats.time), (v) => Math.round(v) + ' ms');
                U.toast(
                    `Sealed with ${selectedLevel} profile (${stats.time} ms)` +
                    (verified ? ' — round-trip verified.' : '.'),
                    'success'
                );
            } catch (err) {
                U.toast('Encryption failed: ' + err.message, 'error');
            } finally {
                setBusy(btn, false);
            }
        });

        U.$('decrypt-btn').addEventListener('click', async () => {
            const text = input.value.trim();
            if (!text) return U.toast('Paste the ciphertext first.', 'warning');
            if (!pass.value) return U.toast('Enter the passphrase.', 'warning');
            if (typeof pako === 'undefined') return U.toast('Compression library failed to load.', 'error');

            const btn = U.$('decrypt-btn');
            setBusy(btn, true, '[ opening... ]');
            try {
                const { result, stats, meta } = await KX.crypto.decryptText(text, pass.value);
                output.value = result;
                U.animateValue(U.$('stat-time'), parseFloat(stats.time), (v) => Math.round(v) + ' ms');
                const detail = meta && meta.version === 5
                    ? ` (v${meta.version} · ${meta.level} · ${U.formatCount(meta.iterations)} iterations)`
                    : meta && meta.version === 4
                        ? ` (legacy v4 envelope${meta.level ? ' · ' + meta.level : ''})`
                        : ' (legacy v3 payload)';
                U.toast(`Decrypted${detail} in ${stats.time} ms.`, 'success');
            } catch (err) {
                U.toast('Decryption failed — wrong passphrase or corrupted data.', 'error');
            } finally {
                setBusy(btn, false);
            }
        });

        U.$('enc-copy-btn').addEventListener('click', () => {
            U.copyText(output.value, 'Output copied to clipboard.');
        });

        U.$('enc-download-btn').addEventListener('click', () => {
            if (!output.value) return;
            U.downloadBlob(
                new Blob([output.value], { type: 'text/plain;charset=utf-8' }),
                U.timestampedName('kriptex-output', 'txt')
            );
            U.toast('Output downloaded as .txt', 'success');
        });

        U.$('enc-clear-btn').addEventListener('click', () => {
            U.clearFields(['enc-input', 'enc-output', 'enc-password', 'enc-pass2']);
            U.$('enc-char-count').textContent = '0';
            U.renderStrength(U.$('strength-bar'), U.$('strength-text'), '');
            U.toast('Fields cleared.', 'info');
        });
    }

    return { init };
})();
